// The chatbot's two agents.
// The chat agent talks with the user: it reads the document with the read tools and, for a change the user asks for,
// calls the planning agent (plan_changes). The planning agent works the plan out in a loop: it proposes steps (change
// tools with their arguments), simulates them on a copy of the model (simulate_plan), and after a failure proposes
// better ones, until a plan runs. Its loop stays its own: the chat agent gets the plan only, so the chat's memory holds
// what was said and done in the chat, not the planning agent's reasoning and attempts.
// A change the chat agent suggests itself is checked before the user sees it: it proposes it as options, one or a few
// (propose_changes), and the planning agent plans each, all at once; an option is offered only when its plan runs and
// brings no new errors. The options show as buttons, each holding its plan: a click shows the plan as it was checked
// (choose), with nothing planned or simulated again; a message that chooses one has the chat agent show it
// (show_option). The options stay open until one is approved, or new options or a new plan replace them.
// The user then approves the plan, which changes the document, or rejects it, with a reason or without; either way the
// chat agent hears of it, and of the reason, and answers. Approved on the document it was checked on, the plan gives the
// document as checked; on a document the user has edited since, its steps run again. The user may also approve only
// some of its changes: without a reason, the steps that make just those run, and change the document when they do
// (selectSteps, in the DSL controller); otherwise, or with a reason, the planning agent plans them again, fixing what
// they miss, and its plan waits for the user's decision.
// Choices that are not changes (next steps, a question's answers) the chat agent offers as buttons too (offer_choices,
// options.ts).
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
    CHANGE_TOOLS, changeToolList, changesOf, Controller, describeFindings, diffModels, numbered, Refusal, selectSteps, simulate, type ControllerTool,
    type DiffSection, type Failed, type Mistake, type PlanStep, type Simulation, type Succeeded
} from 'dsl-controller';
import { inPlanning, runner, simulated } from './experiment/events.ts';
import { forTheAgents } from './experiment/no-skills.ts';
import { offerChoicesTool, optionsOn, type Option } from './options.ts';
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

/** How many options propose_changes plans at most; it plans them all at once. */
const MOST_OPTIONS = 3;

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
    /** The document the plan was checked on. */
    base: string;
}

/** An option the chat agent proposed: its button, whether it recommends it, and its plan, which ran with no new errors. */
export interface ProposedOption {
    label: string;
    recommended: boolean;
    plan: Plan;
    /** The user rejected its plan; it can still be chosen again. */
    rejected?: boolean;
}

/** The options of a call of propose_changes, the recommended ones first; the id tells them from earlier ones. */
export interface Proposal {
    id: number;
    options: ProposedOption[];
}

/**
 * The user's decision on a plan: approved, wholly or only the changes `kept` (their keys, diff.ts: changesOf), or
 * rejected; with a reason or without.
 */
export type Decision = { approved: true, reason?: string, kept?: string[] } | { approved: false, reason?: string };

/**
 * What a turn gives the user: the chat agent's answer; a plan to decide on (plan_changes); options to choose from
 * (propose_changes), or the option whose plan it shows (show_option); choices that are not changes (offer_choices); the
 * document after an approved plan.
 */
export interface Turn {
    reply: string;
    plan?: Plan;
    proposal?: Proposal;
    shown?: number;
    choices?: Option[];
    document?: string;
}

/** What the chat agent's tools offer the user in a turn, for the turn to give (Turn). */
type Offered = Pick<Turn, 'plan' | 'proposal' | 'shown' | 'choices'>;

/** A session's conversation with the agents; it takes one turn at a time. */
export class Conversation {
    /** The domain the user described before entering the editor and the chat: {context} in the agents' prompts. */
    domain: string;
    /**
     * The chat's memory: the messages, the chat agent's tool calls and their results, in memory only. After a turn,
     * once it holds about COMPACT_AT tokens, the API compacts it.
     */
    memory = compactingMemory();
    /** The plan waiting for the user's decision: plan_changes's, or the shown option's. */
    plan: Plan | undefined = undefined;
    /** The options open for the user to choose from. */
    proposal: Proposal | undefined = undefined;
    /** The option whose plan waits for the user's decision, by its place in the proposal. */
    shown: number | undefined = undefined;
    /** How many proposals the chat agent made: the id of the last. */
    proposals = 0;
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
 * What both agents work with in a turn: the domain, the DSL text and its model, the conversation (the chat's memory
 * before the turn, and the turn's message or notice), the sandbox.
 */
interface TurnContext {
    domain: string;
    document: string;
    model: Controller;
    conversation: AgentInputItem[];
    sandbox: SandboxSessionLike;
}

/**
 * The user's message: the chat agent answers it, on `document`, the DSL text as it is now. It leaves the plan waiting
 * for a decision behind, but not the options: the message may choose one.
 */
export function chat(conversation: Conversation, message: string, document: string): Promise<Turn> {
    conversation.plan = undefined;
    conversation.shown = undefined;
    return chatTurn(conversation, user(message), document);
}

/**
 * The user clicked the option `option` of the proposal `proposal`: its plan waits for their decision, as it was
 * checked. Nothing is planned or simulated, and the chat agent hears of it with the decision. False when the proposal is
 * no longer open.
 */
export function choose(conversation: Conversation, proposal: number, option: number): boolean {
    const chosen = conversation.proposal?.id === proposal ? conversation.proposal.options[option] : undefined;
    if (!chosen) {
        return false;
    }
    conversation.plan = chosen.plan;
    conversation.shown = option;
    return true;
}

/**
 * The user's decision on the plan, with a reason or without. Approved on the document it was checked on, the plan gives
 * the document as checked; on `document`, the DSL text as it is now, when the user has edited it since, its steps run
 * again. Approved in part, it goes to approvePart. Either way the chat agent hears of the decision, and of the reason.
 * An approved option closes the options, in part too; a rejected one leaves them open.
 */
export async function decide(conversation: Conversation, decision: Decision, document: string): Promise<Turn> {
    const { plan, shown } = conversation;
    if (!plan) {
        throw new Error('There is no plan to decide on.');
    }
    const option = shown !== undefined ? conversation.proposal?.options[shown] : undefined;
    conversation.plan = undefined;
    conversation.shown = undefined;
    const reason = decision.reason?.trim() || undefined;

    if (!decision.approved) {
        if (option) {
            option.rejected = true;
        }
        return chatTurn(conversation, notice(rejected(reason, option?.label)), document);
    }
    if (option) {
        conversation.proposal = undefined;
    }
    if (decision.kept) {
        return approvePart(conversation, { plan, option: option?.label, kept: decision.kept, reason }, document);
    }
    let after: { document: string, changes: string[], problems: string };
    if (document === plan.base) {
        after = plan;
    } else {
        const simulation = await simulate(Controller.fromText(document), plan.steps);
        if (!simulation.succeeded) {
            return chatTurn(conversation, notice(noLongerRuns(simulation, option?.label)), document);
        }
        after = { document: simulation.controller.toDsl(), changes: simulation.changes, problems: describeFindings(simulation.findings) };
    }
    const turn = await chatTurn(conversation, notice(applied(after, option?.label, reason)), after.document);
    return { ...turn, document: after.document };
}

/** A plan the user approved in part: the plan, the option it is of, the keys of the changes kept, and the reason. */
interface Part {
    plan: Plan;
    option: string | undefined;
    kept: string[];
    reason: string | undefined;
}

/**
 * The user approved only some changes of the plan, on `document`, the DSL text as it is now. Without a reason, the
 * steps that make just those run; when they make just those changes, with no more new errors than the plan brought,
 * the document changes at once. Otherwise, or with a reason, the planning agent plans the kept changes again, as the
 * reason asks, and fixes what they miss; its plan waits for the user's decision.
 */
async function approvePart(conversation: Conversation, part: Part, document: string): Promise<Turn> {
    const { plan, kept, reason } = part;
    let why: string | undefined;
    if (!reason) {
        const model = Controller.fromText(document);
        const selection = await selectSteps(model, plan.steps, kept);
        const simulation = 'steps' in selection ? await simulate(model, selection.steps) : undefined;
        why = 'reason' in selection ? selection.reason : notJustThePart(model, simulation!, part);
        if (why === undefined && simulation?.succeeded) {
            const after = simulation.controller.toDsl();
            const turn = await chatTurn(conversation, notice(appliedPart(part, simulation)), after);
            return { ...turn, document: after };
        }
    }

    const told = partlyApproved(part);
    const planning = await makePlan(await turnContext(conversation, notice(told), document), { task: planThePart(part, why) });
    if (!('plan' in planning)) {
        return chatTurn(conversation, notice(`${told}\n${noPlanForThePart(planning)}`), document);
    }
    conversation.plan = planning.plan;
    const turn = await chatTurn(conversation, notice(`${told}\n${plannedThePart(planning.plan)}`), document);
    return { ...turn, plan: turn.plan ?? (conversation.plan === planning.plan ? planning.plan : undefined) };
}

/**
 * Why the steps of the part did not make just the part: they stop, they bring more new errors than the plan, or they
 * make other changes than those kept. Nothing when they make just the part.
 */
function notJustThePart(model: Controller, simulation: Simulation, { plan, kept }: Part): string | undefined {
    if (!simulation.succeeded) {
        return `Without the changes left out, the plan stops: ${simulation.reason}`;
    }
    if (simulation.findings.newErrors.length > plan.newErrors) {
        return `Without the changes left out, the plan brings errors into the document:\n${describeFindings(simulation.findings)}`;
    }
    const made = changesOf(diffModels(model, simulation.controller)).map(({ key }) => key);
    if (made.length !== kept.length || made.some(key => !kept.includes(key))) {
        return 'Without the changes left out, the plan makes other changes than those kept.';
    }
    return undefined;
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
 * One turn of the chat agent on `input`, with its tools on `document`, the DSL text: the chat's memory grows by the input
 * and the turn, and the API compacts it afterwards when it has grown past COMPACT_AT tokens.
 */
async function chatTurn(conversation: Conversation, input: AgentInputItem, document: string): Promise<Turn> {
    const context = await turnContext(conversation, input, document);
    const offered: Offered = {};
    const result = await runner.run(chatAgent(conversation, context, offered), [input], { session: conversation.memory, sandbox: inSandbox(context.sandbox) });
    return { reply: result.finalOutput ?? '', ...offered };
}

/** What the agents work with in a turn on `input`, on `document`; the sandbox opens at the first turn. */
async function turnContext(conversation: Conversation, input: AgentInputItem, document: string): Promise<TurnContext> {
    conversation.sandbox ??= openSandbox().catch(error => {
        conversation.sandbox = undefined;
        throw error;
    });
    return {
        domain: conversation.domain, document, model: Controller.fromText(document),
        conversation: [...await conversation.memory.getItems(), input], sandbox: await conversation.sandbox
    };
}

// ---------------- The chat agent ----------------

/**
 * The chat agent of a turn: the read tools; plan_changes and propose_changes, which have the planning agent plan in the
 * same context; show_option; offer_choices, unless OPTIONS=off; and the sandbox's tools. What its tools offer the user
 * goes into `offered`.
 */
function chatAgent(conversation: Conversation, context: TurnContext, offered: Offered): SandboxAgent {
    return new SandboxAgent({
        name: 'Chat agent',
        baseInstructions: sandboxInstructions(),
        instructions: () => chatInstructions(context.domain),
        model: MODEL,
        modelSettings: chatSettings(conversation.effort),
        tools: [
            ...readTools(context.model),
            planChangesTool(conversation, context, offered),
            proposeChangesTool(conversation, context, offered),
            showOptionTool(conversation, offered),
            ...(optionsOn() ? [offerChoicesTool(choices => offered.choices = choices)] : [])
        ],
        capabilities: sandboxCapabilities()
    });
}

/** plan_changes: the plan, which waits for the user's decision; it replaces the options. */
function planChangesTool(conversation: Conversation, context: TurnContext, offered: Offered): FunctionTool<any, any, any> {
    const planChanges = async () => {
        const planning = await makePlan(context);
        if (!('plan' in planning)) {
            return noPlan(planning);
        }
        conversation.plan = planning.plan;
        conversation.proposal = undefined;
        conversation.shown = undefined;
        Object.assign(offered, { plan: planning.plan, proposal: undefined, shown: undefined });
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

/**
 * propose_changes: the planning agent plans each option, all at once; the options whose plans run and bring no new
 * errors are offered, and replace the options and the plan before them. When none is, nothing changes.
 */
function proposeChangesTool(conversation: Conversation, context: TurnContext, offered: Offered): FunctionTool<any, any, any> {
    const parameters = z.object({
        options: z.array(z.object({
            label: z.string().describe('The button: two to five words, such as "Core states only".'),
            change: z.string().describe('The change in full, for the planning agent, who plans it as it is: the elements to add, change or delete, with their names and details, such as "Add the states Draft, Submitted and Approved to Application, each with its state specification".'),
            recommended: z.boolean().describe('Whether you recommend this option.')
        }))
    });

    const propose = async ({ options }: z.infer<typeof parameters>) => {
        const proposed = options.slice(0, MOST_OPTIONS);
        const plannings = await Promise.all(proposed.map(option => makePlan(context, { option: option.label, task: planTheOption(option.change) })));
        const results = proposed.map((option, index) => ({ ...option, planning: plannings[index] }));
        const offeredOptions = results.flatMap(({ label, recommended, planning }) =>
            'plan' in planning && planning.plan.newErrors === 0 ? [{ label, recommended, plan: planning.plan }] : []);
        if (offeredOptions.length > 0) {
            const proposal = {
                id: ++conversation.proposals,
                options: [...offeredOptions.filter(({ recommended }) => recommended), ...offeredOptions.filter(({ recommended }) => !recommended)]
            };
            conversation.proposal = proposal;
            conversation.plan = undefined;
            conversation.shown = undefined;
            Object.assign(offered, { plan: undefined, proposal, shown: undefined });
        }
        return describeProposal(results);
    };

    return tool({
        name: 'propose_changes',
        description: `Propose a change you suggest, as options for the user to choose from: one, or alternatives (at most ${MOST_OPTIONS}). `
            + 'Before the user sees them, the planning agent plans each, all at once, as plan_changes would, on a copy of the '
            + 'model; an option is offered only when its plan runs and brings no new errors, and it tells you which are '
            + 'offered and why the others are not. The offered ones show as buttons after your reply; a click shows the '
            + 'option\'s plan, for the user to approve or reject. Give all the options in one call: a call replaces the '
            + 'options and the plan before it.',
        parameters,
        strict: true,
        execute: propose,
        errorFunction: null
    });
}

/** show_option: the plan of an open option, as it was checked, waits for the user's decision. */
function showOptionTool(conversation: Conversation, offered: Offered): FunctionTool<any, any, any> {
    const parameters = z.object({
        label: z.string().describe('The label of the option, as propose_changes offered it.')
    });

    const show = ({ label }: z.infer<typeof parameters>) => {
        const options = conversation.proposal?.options ?? [];
        const index = options.findIndex(option => option.label.trim().toLowerCase() === label.trim().toLowerCase());
        if (index < 0) {
            return options.length > 0
                ? `No open option is called "${label}". The open options: ${options.map(option => `"${option.label}"`).join(', ')}.`
                : 'There are no open options. Call propose_changes or plan_changes.';
        }
        conversation.plan = options[index].plan;
        conversation.shown = index;
        Object.assign(offered, { plan: undefined, shown: index });
        return `The plan of the option "${options[index].label}" shows after your reply, as it was checked, and waits for the user's approval.\n`
            + describePlan(options[index].plan);
    };

    return tool({
        name: 'show_option',
        description: 'Show the user the plan of an option that propose_changes offered and that is still open, when the user '
            + 'chooses it in a message (a click on its button shows it without you). The plan is shown as it was checked, '
            + 'with nothing planned again, for the user to approve or reject. For an option the user wants changed, call '
            + 'propose_changes or plan_changes instead.',
        parameters,
        strict: true,
        execute: show,
        errorFunction: null
    });
}

// ---------------- The planning agent ----------------

/** What the planning agent gives: a plan that ran in its simulation, or what it said and its last plan, which failed. */
type Planning = { plan: Plan } | { said: string, failed: Failed | undefined };

/**
 * The planning agent's plan for the change the user asks for in the conversation, or for `request`'s task: an option
 * the chat agent proposes (labelled `option`), or a plan the user approved in part; on the model in `context`. In its loop it proposes steps and simulates them, and after a failure
 * proposes better ones; its plan is the last plan it simulated, when that one ran. Its memory is a fork of the chat's: a
 * copy of the conversation (the chat's memory before the turn, compaction items included, and the turn's message), so
 * that its own steps stay out of the chat's memory. It runs as a planning run of the experiment (inPlanning).
 */
function makePlan(context: TurnContext, request?: { option?: string, task: string }): Promise<Planning> {
    return inPlanning(request?.option, () => planningRun(context, request?.task));
}

/** makePlan's run: the change the user asks for, or `task`. */
async function planningRun({ domain, document, model, conversation, sandbox }: TurnContext, task: string | undefined): Promise<Planning> {
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
    const input = [user(task ?? planTheChange())];

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
            document: simulation.controller.toDsl(),
            base: document
        }
    };
}

// ---------------- Short prompts ----------------
// What the program tells the agents, besides their instructions (prompt/), the tools' descriptions, and the tools'
// own answers (the controller's and the simulation's messages).

/** "the plan", or "the plan of the option "Core states only"" */
function thePlan(option: string | undefined): string {
    return option === undefined ? 'the plan' : `the plan of the option "${option}"`;
}

/** To the chat agent: the user rejected the plan, or an option's. */
function rejected(reason: string | undefined, option: string | undefined): string {
    const why = reason?.trim() ? `Their reason: ${reason.trim()}` : 'They gave no reason.';
    return option === undefined
        ? `The user rejected the plan, so nothing changed. ${why} Ask how to revise it, or call plan_changes for a corrected plan.`
        : `The user rejected ${thePlan(option)}, so nothing changed. ${why} The options stay open: the user can choose another, `
            + 'or you can propose new ones with propose_changes when the reason makes the change clear.';
}

/** To the chat agent: the user approved the plan, but the document changed since, and the plan no longer runs. */
function noLongerRuns({ reason }: Failed, option: string | undefined): string {
    return `The user approved ${thePlan(option)}, but it no longer runs on the document as it is now, so nothing changed.\n${reason}`;
}

/** To the chat agent: the user approved the plan, or an option's, with a reason or without, and it changed the document. */
function applied({ changes, problems }: { changes: string[], problems: string }, option: string | undefined, reason: string | undefined): string {
    return `The user approved ${thePlan(option)}, and it changed the document:\n${list(changes)}\n`
        + `The check of the document now:\n${problems}${reason ? `\nThey wrote with their approval: ${reason}` : ''}`;
}

/** The changes of the plan the user kept and left out, as text, one per line. */
function theChanges({ plan, kept }: Part): { kept: string, left: string } {
    const changes = changesOf(plan.diff);
    const lines = (keep: boolean) => changes.filter(({ key }) => kept.includes(key) === keep).map(({ text }) => `- ${text}`).join('\n');
    return { kept: lines(true), left: lines(false) };
}

/** To the chat agent and the planning agent: the user approved only some changes of the plan, or an option's. */
function partlyApproved(part: Part): string {
    const { kept, left } = theChanges(part);
    return `The user approved only some changes of ${thePlan(part.option)}. They kept:\n${kept}\nThey left out:\n${left}`
        + (part.reason ? `\nTheir reason: ${part.reason}` : '\nThey gave no reason.');
}

/** To the chat agent: the user approved some changes of the plan, and the steps that make them changed the document. */
function appliedPart(part: Part, { changes, findings }: Succeeded): string {
    return `${partlyApproved(part)}\nThe steps that make the changes they kept ran, and changed the document:\n${list(changes)}\n`
        + `The check of the document now:\n${describeFindings(findings)}`;
}

/** To the chat agent: the planning agent planned the part the user approved again; its plan waits for their decision. */
function plannedThePart(plan: Plan): string {
    return 'So nothing changed yet: the planning agent planned the changes they kept again, and fixed what they miss.\n'
        + `${describePlan(plan)}\nTell the user how this plan differs from the changes they kept, and why.`;
}

/** To the chat agent: the planning agent made no plan for the part the user approved. */
function noPlanForThePart(planning: { said: string, failed: Failed | undefined }): string {
    return `The planning agent planned the changes they kept again, but no plan was made, so nothing changed. ${whyNoPlan(planning)}\n`
        + 'Tell the user what went wrong.';
}

/** To the chat agent, from plan_changes: the plan, which waits for the user's decision (`waiting`). */
function describePlan({ summary, steps, changes, problems, newErrors }: Plan, waiting = true): string {
    return [
        ...(waiting ? ['A plan, which now waits for the user\'s approval:'] : []),
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
    return `No plan was made, so there is nothing for the user to approve. ${whyNoPlan({ said, failed })}\nTell the user what went wrong.`;
}

/** Why the planning agent gave no plan, and what it said. */
function whyNoPlan({ said, failed }: { said: string, failed: Failed | undefined }): string {
    const why = failed ? `The last plan it simulated fails.\n${failed.reason}` : 'It simulated no plan.';
    return `${why}\nThe planning agent said: ${said}`;
}

/**
 * To the chat agent, from propose_changes: the options offered, each with its plan, and why the others are not: their
 * plans fail, or bring new errors.
 */
function describeProposal(results: Array<{ label: string, recommended: boolean, planning: Planning }>): string {
    const offered = results.filter(({ planning }) => 'plan' in planning && planning.plan.newErrors === 0);
    const lines = offered.length > 0
        ? ['The options offered to the user, as buttons after your reply; a click shows the option\'s plan, for the user to approve or reject.']
        : ['No option is offered: the user has nothing to choose, and the options before stay as they were.'];
    for (const { label, recommended, planning } of results) {
        if (!('plan' in planning)) {
            lines.push('', `Option "${label}" is not offered: no plan of it runs. ${whyNoPlan(planning)}`);
        } else if (planning.plan.newErrors > 0) {
            lines.push('', `Option "${label}" is not offered: its plan brings ${planning.plan.newErrors} error(s) into the document.`, planning.plan.problems);
        } else {
            lines.push('', `Option "${label}"${recommended ? ' (recommended)' : ''}:`, describePlan(planning.plan, false));
        }
    }
    lines.push('', offered.length > 0
        ? 'In your reply, describe the offered options briefly; mention an option not offered only to say why. Do not ask the user to reply: they choose with the buttons, or in a message.'
        : 'Tell the user what went wrong, or propose other options.');
    return lines.join('\n');
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

/** To the planning agent: what to do, for an option the chat agent proposes. */
function planTheOption(change: string): string {
    return 'Plan this option, which the chat agent proposes to the user; the user sees it as a button once its plan is '
        + `checked, and has not chosen it yet:\n${change}\nPlan exactly this change. Your plan must run and bring no new `
        + 'errors into the document (errors the document already has do not count): an option whose plan brings new '
        + 'errors is not offered. If you cannot make such a plan, say why.';
}

/** To the planning agent: what to do, for a plan the user approved in part; `why` the kept changes alone do not do. */
function planThePart(part: Part, why: string | undefined): string {
    const steps = part.plan.steps.map((step, index) => `${index + 1}. ${step.tool} ${step.arguments}: ${part.plan.changes[index]}`).join('\n');
    return `The user approved only some changes of the plan with these steps, as the conversation's last message says:\n${steps}\n`
        + `Plan the changes they kept, without those they left out${part.reason ? ', as their reason asks' : ''}.`
        + (why ? ` The kept changes alone do not do: ${why}` : '')
        + ' Where a kept change needs one left out, fix it the best way: keep as much of what they kept as you can, and leave '
        + 'out what cannot stay without it. Your plan must run, and bring no new errors into the document that the plan '
        + 'before did not bring. Say in your answer what you changed from what they kept, and why.';
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
