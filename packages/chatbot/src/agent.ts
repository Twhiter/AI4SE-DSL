// The chatbot's two agents.
// The chat agent talks with the user: it reads the document with the read tools and, for a change, calls the
// planning agent (plan_changes). The planning agent works the plan out in a loop: it proposes steps (change tools with
// their arguments), simulates them on a copy of the model (simulate_plan), and after a failure proposes better ones,
// until a plan runs. Its loop stays its own: the chat agent gets the plan only, so the chat's memory holds what was said
// and done in the chat, not the planning agent's reasoning and attempts.
// The user then approves the plan, which changes the document, or rejects it, with a reason or without; either way the
// chat agent hears of it and answers.
// The model of the document, its tools, the simulation and the checks are the DSL controller's (packages/dsl-controller);
// the agents get its tools as Agents SDK tools (agentTool).
// Both agents work with the same context: the domain the user described, the document, and the conversation.
// Both are sandbox agents, in the conversation's sandbox (sandbox.ts), where they load and read the skills.
// The conversation is the chat's memory, an SDK session: the OpenAI API compacts it once it grows past COMPACT_AT
// tokens, into a compaction item (encrypted) and the items it keeps, with a GPT model and with Claude alike. The
// planning agent is a fork of the chat agent: its memory starts as a copy of the chat's, with the user's latest
// message, and is thrown away after its plan.
// Their instructions are prompt/system_prompt.md and prompt/planning_agent.md, with placeholders (prompts.ts); the
// short prompts, what the program tells them besides, are in this file (Short prompts).
// The agents run with the experiment's runner, and each simulation is announced, for the session log (experiment/).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import {
    MaxTurnsExceededError, MemorySession, OpenAIResponsesCompactionSession, setDefaultOpenAIClient, setTracingDisabled,
    system, tool, user, type AgentInputItem, type FunctionTool, type ModelSettings
} from '@openai/agents';
import { SandboxAgent, type SandboxSessionLike } from '@openai/agents/sandbox';
import { z } from 'zod';
import {
    CHANGE_TOOLS, changeToolList, Controller, describeFindings, diffModels, numbered, Refusal, simulate, type ControllerTool,
    type DiffSection, type Failed, type Mistake, type PlanStep, type Simulation, type Succeeded
} from 'dsl-controller';
import { runner, simulated } from './experiment/events.ts';
import { forTheAgents } from './experiment/no-skills.ts';
import { chatInstructions, planningInstructions } from './prompts.ts';
import { closeSandbox, inSandbox, openSandbox, sandboxCapabilities } from './sandbox.ts';

// ---------------- The connection ----------------

// packages/chatbot/.env holds OPENAI_API_KEY and OPENAI_BASE_URL, and may hold OPENAI_MODEL
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
}

export const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.4';

/** Nothing is stored at the provider, so reasoning comes back encrypted, to be sent along on the next turn. */
const NOT_STORED: ModelSettings = { store: false, providerData: { include: ['reasoning.encrypted_content'] } };
/** The chat agent's reasoning efforts the user can pick in the chat's header: it reasons a little, or not at all. */
export const CHAT_EFFORTS = ['low', 'none'] as const;
export type ChatEffort = typeof CHAT_EFFORTS[number];

/**
 * A Claude model (a deployment named claude-…, served through the same Responses API) has no effort 'none': it does not
 * reason when it is given no effort. It takes no temperature either.
 */
const CLAUDE = MODEL.startsWith('claude');

/**
 * Settings without reasoning: a GPT model's effort 'none', at temperature 0 (with reasoning the API allows only its
 * default temperature); for Claude, no effort.
 */
export const NO_REASONING: ModelSettings = CLAUDE ? {} : { reasoning: { effort: 'none' }, temperature: 0 };

/** The chat agent's settings, with the effort the user picked. */
function chatSettings(effort: ChatEffort): ModelSettings {
    return { ...NOT_STORED, ...(effort === 'none' ? NO_REASONING : { reasoning: { effort } }) };
}
/**
 * The planning agent reasons a little and simulates one plan at a time. Its first move is a simulation, so that it
 * proposes a plan before anything else; after that it chooses (the SDK resets the tool choice after a tool call).
 * Claude, through the Responses API, takes no tool choice but auto: there its prompt alone has it simulate first.
 */
const PLANNING_SETTINGS: ModelSettings = {
    ...NOT_STORED, reasoning: { effort: 'low' }, parallelToolCalls: false, ...(!CLAUDE && { toolChoice: 'simulate_plan' })
};

/** How many turns the planning agent has for a plan; each reading and each simulation takes one. */
const PLANNING_TURNS = 20;

/**
 * How many tokens the chat's memory holds before it is compacted, counted as about 4 characters each. (The SDK's own
 * default compacts every 10 items, which the agents' tool calls reach in about a turn.)
 */
const COMPACT_AT = 20_000;

setDefaultOpenAIClient(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL }));
setTracingDisabled(true);   // the SDK sends its traces to OpenAI's platform, which this key does not reach

// ---------------- A conversation ----------------

/** A plan that ran in its simulation, waiting for the user's decision. */
export interface Plan {
    /** What the planning agent says the plan does. */
    summary: string;
    steps: PlanStep[];
    /** What each step does, in order. */
    changes: string[];
    /** What the plan changes in the model, element by element, like a git diff. */
    diff: DiffSection[];
    /** What the check of the document after the plan finds: the errors it brings, the errors already there, warnings. */
    problems: string;
    /** How many errors the plan brings into the document; the user should know before deciding. */
    newErrors: number;
    /** The document after the plan. */
    document: string;
}

/** The user's decision on a plan: approved, or rejected, with a reason or without. */
export type Decision = { approved: true } | { approved: false, reason?: string };

/** What a turn gives the user: the chat agent's answer, a plan to decide on, the document after an approved plan. */
export interface Turn {
    reply: string;
    plan?: Plan;
    document?: string;
}

/** A session's conversation with the agents; it takes one turn at a time. */
export class Conversation {
    /** The domain the user described before entering the editor and the chat: {context} in the agents' prompts. */
    domain: string;
    /**
     * The chat's memory: the messages, the chat agent's tool calls and their results, in memory only. After a turn,
     * once it holds about COMPACT_AT tokens, the API compacts it.
     */
    memory = compactingMemory();
    /** The plan waiting for the user's decision. */
    plan: Plan | undefined = undefined;
    /** The chat agent's reasoning effort, as the user picked it for the next turn. */
    effort: ChatEffort = 'low';
    /** The agents' sandbox, opened at the first turn; a turn that could not open it leaves it to the next. */
    sandbox: Promise<SandboxSessionLike> | undefined = undefined;

    constructor(domain: string) {
        this.domain = domain;
    }

    /** Ends the conversation: its sandbox is closed. */
    async close(): Promise<void> {
        const sandbox = await this.sandbox?.catch(() => undefined);
        this.sandbox = undefined;
        if (sandbox) {
            await closeSandbox(sandbox);
        }
    }
}

/**
 * The chat's memory: the SDK's compaction session on ChatMemory, which the API compacts with the agents' model once it
 * holds about COMPACT_AT tokens. The SDK compacts only for a model it takes for OpenAI's by its name (gpt-…, o…); the
 * API compacts for Claude as well, so a Claude model is given to the session after that check, in the field its
 * compaction requests read (an SDK that renamed it fails here, not in a compaction).
 */
function compactingMemory(): OpenAIResponsesCompactionSession {
    const memory = new OpenAIResponsesCompactionSession({
        underlyingSession: new ChatMemory(),
        model: CLAUDE ? 'gpt-5.4' : MODEL,
        shouldTriggerCompaction: ({ sessionItems }) => JSON.stringify(sessionItems).length / 4 >= COMPACT_AT
    });
    if (CLAUDE) {
        const session = memory as unknown as { model?: string };
        if (session.model !== 'gpt-5.4') {
            throw new Error('The SDK\'s compaction session no longer keeps its model in the field model: Claude cannot be set.');
        }
        session.model = MODEL;
    }
    return memory;
}

/**
 * The chat's memory as the SDK's in-memory session, but a compacted window is stored from its compaction item on. The
 * window the API gives back holds the messages it kept before that item, which the SDK never sends to the model again;
 * stored, they would make the SDK find the memory different from what the model saw, and compact it no more.
 */
class ChatMemory extends MemorySession {
    override async addItems(items: AgentInputItem[]): Promise<void> {
        const compaction = items.map(item => item.type).lastIndexOf('compaction');
        await super.addItems(compaction > 0 ? items.slice(compaction) : items);
    }
}

/**
 * What both agents work with in a turn: the domain, the model of the document, the conversation (the chat's memory
 * before the turn, and the turn's message or notice), the sandbox.
 */
interface TurnContext {
    domain: string;
    model: Controller;
    conversation: AgentInputItem[];
    sandbox: SandboxSessionLike;
}

/** The user's message: the chat agent answers it, on `document`, the DSL text as it is now. */
export function chat(conversation: Conversation, message: string, document: string): Promise<Turn> {
    conversation.plan = undefined;   // a message instead of a decision leaves the plan behind
    return chatTurn(conversation, user(message), Controller.fromText(document));
}

/**
 * The user's decision on the plan. Approved, the plan runs again on `document`, the DSL text as it is now (the user
 * may have edited it since), and gives the document after it. Either way the chat agent hears of the decision.
 */
export async function decide(conversation: Conversation, decision: Decision, document: string): Promise<Turn> {
    const { plan } = conversation;
    if (!plan) {
        throw new Error('There is no plan to decide on.');
    }
    conversation.plan = undefined;
    const model = Controller.fromText(document);

    if (!decision.approved) {
        return chatTurn(conversation, notice(rejected(decision.reason)), model);
    }
    const simulation = await simulate(model, plan.steps);
    if (!simulation.succeeded) {
        return chatTurn(conversation, notice(noLongerRuns(simulation)), model);
    }
    const turn = await chatTurn(conversation, notice(applied(simulation)), simulation.controller);
    return { ...turn, document: simulation.controller.toDsl() };
}

/**
 * What the program tells the chat agent in the conversation, such as the user's decision on a plan: a system message,
 * which a GPT model takes where it stands. Claude, through the Responses API, does not (it takes an approval for no
 * news, and presents the plan again), so it gets the notice as a message of the user.
 */
function notice(text: string): AgentInputItem {
    return CLAUDE ? user(text) : system(text);
}

/**
 * One turn of the chat agent on `input`, with its tools on `model`: the chat's memory grows by the input and the turn,
 * and the API compacts it afterwards when it has grown past COMPACT_AT tokens.
 */
async function chatTurn(conversation: Conversation, input: AgentInputItem, model: Controller): Promise<Turn> {
    conversation.sandbox ??= openSandbox().catch(error => {
        conversation.sandbox = undefined;
        throw error;
    });
    const sandbox = await conversation.sandbox;
    const context: TurnContext = { domain: conversation.domain, model, conversation: [...await conversation.memory.getItems(), input], sandbox };
    const result = await runner.run(chatAgent(conversation, context), [input], { session: conversation.memory, sandbox: inSandbox(sandbox) });
    return { reply: result.finalOutput ?? '', plan: conversation.plan };
}

// ---------------- The chat agent ----------------

/**
 * The chat agent of a turn: the read tools, plan_changes, which has the planning agent plan in the same context, and
 * the sandbox's tools.
 */
function chatAgent(conversation: Conversation, context: TurnContext): SandboxAgent {
    return new SandboxAgent({
        name: 'Chat agent',
        baseInstructions: sandboxInstructions(),
        instructions: () => chatInstructions(context.domain),
        model: MODEL,
        modelSettings: chatSettings(conversation.effort),
        tools: [...readTools(context.model), planChangesTool(conversation, context)],
        capabilities: sandboxCapabilities()
    });
}

function planChangesTool(conversation: Conversation, context: TurnContext): FunctionTool<any, any, any> {
    const planChanges = async () => {
        const planning = await makePlan(context);
        if (!('plan' in planning)) {
            return noPlan(planning);
        }
        conversation.plan = planning.plan;
        return describePlan(planning.plan);
    };

    return tool({
        name: 'plan_changes',
        description: 'Have the planning agent work out a plan for the change the user asks for in the conversation, which it '
            + 'reads itself. The plan changes nothing yet: the user approves or rejects it next.',
        parameters: z.object({}),
        strict: true,
        execute: planChanges,
        errorFunction: null   // a fault of the program ends the turn
    });
}

// ---------------- The planning agent ----------------

/** What the planning agent gives: a plan that ran in its simulation, or what it said and its last plan, which failed. */
type Planning = { plan: Plan } | { said: string, failed: Failed | undefined };

/**
 * The planning agent's plan for the change the user asks for in the conversation, on the model in `context`. In its
 * loop it proposes steps and simulates them, and after a failure proposes better ones; its plan is the last plan it
 * simulated, when that one ran. Its memory is a fork of the chat's: a copy of the conversation (the chat's memory before
 * the turn, compaction items included, and the turn's message), so that its own steps stay out of the chat's memory.
 */
async function makePlan({ domain, model, conversation, sandbox }: TurnContext): Promise<Planning> {
    let last: { steps: PlanStep[], simulation: Simulation } | undefined;

    const parameters = z.object({
        steps: z.array(z.object({
            tool: z.enum(CHANGE_TOOLS.map(({ name }) => name) as [string, ...string[]]),   // only change tools
            arguments: z.string().describe('The tool\'s arguments as a JSON object, such as {"name": "Customer"}')
        }))
    });

    const simulatePlan = async ({ steps }: z.infer<typeof parameters>) => {
        const simulation = await simulate(model, steps);
        last = { steps, simulation };
        simulated(steps, simulation);
        return describeSimulation(simulation);
    };

    const simulatePlanTool = tool({
        name: 'simulate_plan',
        description: 'Simulate a plan: its steps, each a change tool and its arguments, run in order on a copy of the model, '
            + 'and the document they give checked. It stops at a wrong tool call (its arguments do not fit, or calling it '
            + 'raised an exception) or a syntax mistake, and says at which step; after a wrong tool call it also lists the '
            + 'tools allowed at that step. Otherwise the plan runs, and it '
            + 'says what each step does, what the check finds (the errors the plan brings, the errors already there, the '
            + 'warnings) and the document after it. Your plan is the last plan you simulate.',
        parameters,
        strict: true,
        execute: simulatePlan,
        errorFunction: null
    });

    // the same context as the chat agent: the domain and the tools in its instructions (the read tools to call and the
    // change tools for the steps of a plan), and the conversation in its memory, forked from the chat's
    const reading = readTools(model);
    const planner = new SandboxAgent({
        name: 'Planning agent',
        baseInstructions: sandboxInstructions(),
        instructions: () => planningInstructions(domain, {
            changeTools: changeToolList(model.tools().filter(({ kind }) => kind === 'change')),
            readTools: toolList(reading)
        }),
        model: MODEL,
        modelSettings: PLANNING_SETTINGS,
        tools: [...reading, simulatePlanTool],
        capabilities: sandboxCapabilities()
    });
    const input = [user(planTheChange())];

    let said: string;
    try {
        const memory = new MemorySession({ initialItems: conversation });
        said = (await runner.run(planner, input, { session: memory, maxTurns: PLANNING_TURNS, sandbox: inSandbox(sandbox) })).finalOutput ?? '';
    } catch (error) {
        if (!(error instanceof MaxTurnsExceededError)) {
            throw error;
        }
        said = didNotFinish();
    }

    if (!last) {
        return { said, failed: undefined };
    }
    const { steps, simulation } = last;
    if (!simulation.succeeded) {
        return { said, failed: simulation };
    }
    return {
        plan: {
            summary: said,
            steps,
            changes: simulation.changes,
            diff: diffModels(model, simulation.controller),
            problems: describeFindings(simulation.findings),
            newErrors: simulation.findings.newErrors.length,
            document: simulation.controller.toDsl()
        }
    };
}

// ---------------- Short prompts ----------------
// What the program tells the agents, besides their instructions (prompt/), the tools' descriptions, and the tools'
// own answers (the controller's and the simulation's messages).

/** To the chat agent: the user rejected the plan. */
function rejected(reason: string | undefined): string {
    const why = reason?.trim() ? `Their reason: ${reason.trim()}` : 'They gave no reason.';
    return `The user rejected the plan, so nothing changed. ${why} Ask how to revise it, or call plan_changes for a corrected plan.`;
}

/** To the chat agent: the user approved the plan, but the document changed since, and the plan no longer runs. */
function noLongerRuns({ reason }: Failed): string {
    return `The user approved the plan, but it no longer runs on the document as it is now, so nothing changed.\n${reason}`;
}

/** To the chat agent: the user approved the plan, and it changed the document. */
function applied({ changes, findings }: Succeeded): string {
    return `The user approved the plan, and it changed the document:\n${list(changes)}\n`
        + `The check of the document now:\n${describeFindings(findings)}`;
}

/** To the chat agent, from plan_changes: the plan, which waits for the user's decision. */
function describePlan({ summary, steps, changes, problems, newErrors }: Plan): string {
    return [
        'A plan, which now waits for the user\'s approval:',
        summary,
        'Its steps, and what each does:',
        ...steps.map((step, index) => `${index + 1}. ${step.tool} ${step.arguments}: ${changes[index]}`),
        'The check of the document after the plan:',
        problems,
        ...(newErrors > 0 ? [`The plan brings ${newErrors} error(s) into the document: tell the user, before they decide.`] : [])
    ].join('\n');
}

/** To the chat agent, from plan_changes: there is no plan that runs. */
function noPlan({ said, failed }: { said: string, failed: Failed | undefined }): string {
    const why = failed ? `The last plan it simulated fails.\n${failed.reason}` : 'It simulated no plan.';
    return `No plan was made, so there is nothing for the user to approve. ${why}\n`
        + `The planning agent said: ${said}\nTell the user what went wrong.`;
}

/**
 * Both sandbox agents' first instructions, before their own (the SDK's default ones are for agents that work on code
 * in their sandbox).
 */
function sandboxInstructions(): string {
    return forTheAgents('You have a sandbox: a container without network, which holds the skills you load. Use its shell only to '
        + 'read the skills and to run their scripts. The DSL document is not in the sandbox: your tools work on it.');
}

/** To the planning agent: what to do, the conversation being in its memory. */
function planTheChange(): string {
    return 'Plan the change the user asks for in the conversation.';
}

/** What the planning agent "said" when it ran out of turns. */
function didNotFinish(): string {
    return `(It did not finish within ${PLANNING_TURNS} turns.)`;
}

const MISTAKES: Record<Mistake, string> = {
    tool: 'a wrong tool call',
    syntax: 'a syntax mistake'
};

/**
 * To the planning agent, from simulate_plan: what the simulation found. After a wrong tool call, also the change tools
 * the controller offers at that step, with the names that exist there.
 */
function describeSimulation(simulation: Simulation): string {
    if (simulation.succeeded) {
        return [
            'The plan runs. What each step does:', list(simulation.changes),
            'The check of the document after the plan:', describeFindings(simulation.findings),
            'The document after the plan:', numbered(simulation.controller.toDsl())
        ].join('\n');
    }
    const { mistake, reason, controller } = simulation;
    return [
        `The plan stops: ${MISTAKES[mistake]}.`, reason,
        'The document as far as the plan ran:', numbered(controller.toDsl()),
        ...(mistake === 'tool' ? ['The tools allowed at that step, with what their arguments take there:', offeredChangeTools(controller)] : [])
    ].join('\n');
}

// ---------------- Helpers ----------------

/** The read tools: read_document, the grammars and check_document on `model`. */
function readTools(model: Controller): FunctionTool<any, any, any>[] {
    return model.tools().filter(({ kind }) => kind === 'read').map(agentTool);
}

/**
 * A tool of the controller as the Agents SDK's tool. A refusal reaches the LLM as its message, for it to act on; any
 * other error is a fault of the program, not something for the LLM to repair, so it ends the run.
 */
function agentTool({ name, description, parameters, run }: ControllerTool): FunctionTool<any, any, any> {
    return tool({
        name,
        description,
        strict: true,
        parameters: parameters as z.ZodObject<any, any>,   // the SDK's types need a concrete schema here
        execute: input => run(input),
        errorFunction: (_context, error) => {
            if (error instanceof Refusal) {
                return error.message;
            }
            throw error;
        }
    });
}

/** Tools, one per line with its description: "- read_document: The whole DSL easy document as it is now." */
function toolList(tools: FunctionTool<any, any, any>[]): string {
    return tools.map(({ name, description }) => `- ${name}: ${description}`).join('\n');
}

/** The change tools the controller offers on `model`, one per line: "- create_state(entity: "Printer", name: string): Add a state …" */
function offeredChangeTools(model: Controller): string {
    return model.tools()
        .filter(({ kind }) => kind === 'change')
        .map(agentTool)
        .map(({ name, description, parameters }) => `- ${name}(${argumentsOf(parameters as JsonSchema)}): ${description}`)
        .join('\n');
}

/** A JSON schema, as far as the tools' parameters use it. */
interface JsonSchema {
    type?: string;
    enum?: unknown[];
    anyOf?: JsonSchema[];
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
}

/** A tool's arguments, each with what it accepts: name: string, type: "int" | "string" | … */
function argumentsOf({ properties = {} }: JsonSchema): string {
    return Object.entries(properties).map(([name, schema]) => `${name}: ${accepted(schema)}`).join(', ');
}

/** What an argument accepts: one of its values, one of several kinds, a list, an object with its fields, or a value of its type. */
function accepted(schema: JsonSchema): string {
    if (schema.anyOf) {
        return schema.anyOf.map(accepted).join(' | ');
    }
    if (schema.enum) {
        return schema.enum.map(value => JSON.stringify(value)).join(' | ');
    }
    if (schema.type === 'array' && schema.items) {
        return `[${accepted(schema.items)}, …]`;
    }
    if (schema.properties) {
        return `{${argumentsOf(schema)}}`;
    }
    return schema.type ?? 'any';
}

/** "1. …", one item per line */
function list(items: string[]): string {
    return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}
