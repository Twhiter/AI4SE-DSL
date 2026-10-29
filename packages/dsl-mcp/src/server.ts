// The MCP server: create_dsl, which makes a document and gives its id, and the tools on a document, each taking
// that id (dsl): read_domain, the DSL controller's read tools, and the plans (dsl-tools.ts). The
// document changes only through plans, as in the chatbot: simulate_plan tries one on a copy, apply_plan writes it
// when every step runs; the change tools are steps of a plan only, listed in simulate_plan's description
// (change-tools.ts), not tools of their own.
// The server keeps no state between calls, so one server can serve many conversations at once. A refusal (a file
// id that does not exist, a plan that stops, …) is a tool error with its reason, for the LLM to act on. Every call
// and its answer are logged with the document (call-log.ts).

import { McpServer, type CallToolResult, type RequestId } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { changeToolList, Controller, Refusal } from 'dsl-controller';
import { CallLog } from './call-log.ts';
import { Documents } from './documents.ts';
import { DslTools, type Noter } from './dsl-tools.ts';

const INSTRUCTIONS = 'Tools for DSL easy documents: entities, roles, actions, their specifications and scenarios. Start '
    + 'with create_dsl (the domain described in text): it gives the id of the new document, which every other tool takes '
    + 'as dsl. To go on with a document from an earlier conversation, give its id. Read the grammar '
    + '(read_declaration_grammar, read_state_specification_grammar, read_scenario_grammar) before writing a specification '
    + 'or a scenario. Change the document only with a plan: try it with simulate_plan, then apply it with apply_plan. A '
    + 'refused call or a plan that stops says why: correct it and try again.';

/** The document a tool works on: the id create_dsl gave. */
const DSL = { dsl: z.string().describe('The id create_dsl gave, such as 20261028-221009-k3f9.') };

/** The grammar hints, the same for every document: they take no dsl. */
const GRAMMAR = /^read_.*_grammar$/;

/** The server; `log` logs its calls once its transport goes through it (CallLog.around). */
export function createServer(documents = new Documents(), log = new CallLog(documents)): McpServer {
    const tools = new DslTools(documents);
    const server = new McpServer({ name: 'dsl-easy', version: '0.0.1' }, { instructions: INSTRUCTIONS });

    server.registerTool('create_dsl', {
        description: 'Make a new DSL easy document for a domain, described in text: who takes part, what they work with, and '
            + 'what happens to it. The document starts empty. Gives its id, which the other tools take as dsl.',
        inputSchema: z.object({ domain: z.string() }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    }, ({ domain }, context) => answer(() => tools.createDsl(domain, noter(log, context))));

    server.registerTool('read_domain', {
        description: 'The domain the DSL was made for, as described to create_dsl.',
        inputSchema: z.object(DSL),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, ({ dsl }) => answer(() => tools.readDomain(dsl)));

    const catalog = Controller.catalog();
    for (const { name, description, parameters } of catalog.filter(({ kind }) => kind === 'read')) {
        if (GRAMMAR.test(name)) {
            server.registerTool(name, { description, inputSchema: parameters, annotations: { readOnlyHint: true, openWorldHint: false } },
                input => answer(() => tools.read(undefined, name, input)));
            continue;
        }
        server.registerTool(name, {
            description,
            inputSchema: z.object({ ...DSL, ...parameters.shape }),
            annotations: { readOnlyHint: true, openWorldHint: false }
        }, ({ dsl, ...input }) => answer(() => tools.read(dsl, name, input)));
    }

    const plan = z.object({
        ...DSL,
        steps: z.array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) }))
    });
    const stepsOf = ({ steps }: z.infer<typeof plan>) => steps.map(step => ({ tool: step.tool, arguments: JSON.stringify(step.arguments) }));
    const changeTools = `The change tools a step can call, with their arguments:\n${changeToolList(catalog.filter(({ kind }) => kind === 'change'))}`;

    server.registerTool('simulate_plan', {
        description: 'Try a plan on a copy of the document: its steps, each a change tool with its arguments as an object, run in '
            + 'order, then the copy is checked. Says what each step would do, what the plan changes in the document (a diff: + added, '
            + '- deleted, ~ changed), and the errors and warnings the plan would bring, '
            + 'or at which step it stops and why. The document does not change: apply the plan with apply_plan.\n' + changeTools,
        inputSchema: plan,
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, (input, context) => answer(() => tools.simulatePlan(input.dsl, stepsOf(input), noter(log, context))));

    server.registerTool('apply_plan', {
        description: 'Change the document with a plan, as simulate_plan takes it: the steps are simulated, and the document '
            + 'they give is written only if every step runs; else nothing changes, and the reason is given. The check of '
            + 'the document after it comes with the result. The change tools are those of simulate_plan.',
        inputSchema: plan,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    }, (input, context) => answer(() => tools.applyPlan(input.dsl, stepsOf(input), noter(log, context))));

    return server;
}

/** What a tool tells the log of its call, the call being the request of `context`. */
function noter(log: CallLog, context: { mcpReq: { id: RequestId } }): Noter {
    return note => log.note(context.mcpReq.id, note);
}

/** What a call gives: its text, or a refusal's reason as a tool error. Any other error is the server's fault. */
async function answer(call: () => string | Promise<string>): Promise<CallToolResult> {
    try {
        return { content: [{ type: 'text', text: await call() }] };
    } catch (error) {
        if (error instanceof Refusal) {
            return { content: [{ type: 'text', text: error.message }], isError: true };
        }
        throw error;
    }
}
