// The experiment's log of a session: what happened in it, kept as data and written after each change to two files in
// packages/chatbot/logs, named after the session (its id, which the chat's header in the browser shows):
//   <session>.json  the data: the entries in order, the plans with their attempts, and the metrics computed from the
//                   plans with metrics.ts
//   <session>.md    the same to read: the metrics, then the entries, each document in a code block
// The log takes what happens from outside the workflow: from the chat list of the session's shared document (the
// user's messages and decisions, the agents' replies and plans, the proposals and the options chosen, the choices
// offered, chosen or closed) and from the experiment's events (events.ts: the tool calls, the planning runs and their
// simulations, the runs' token usage). A plan is one planning run: one call of plan_changes, or one option of a call of
// propose_changes, whose options are planned at the same time; the tool calls, simulations and run of a planning run
// carry it. An option's plan is offered when its option is among the proposals; it is decided on once the user has
// chosen it, and when the proposals close (an option approved, new proposals, a plan), the options not decided on are
// not chosen.
// A server restarted while a tab stays open continues the session's files: the tab sends its chat list again, and the
// entries already logged are skipped. The agents start over then (their memory is gone), and a plan that was waiting
// for a decision counts as undecided.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type * as Y from 'yjs';
import type { PlanStep, Problem } from 'dsl-controller';
import type { ChatEntry } from '../chat-session.ts';
import { optionsOn, type Option } from '../options.ts';
import { listen, type SessionEvent, type Tokens } from './events.ts';
import { metrics, type Metrics, type PlanOutcome } from './metrics.ts';
import { skillsOn } from './no-skills.ts';

const LOGS = fileURLToPath(new URL('../../logs', import.meta.url));

// ---------------- The data ----------------

/** A session's log, as <session>.json holds it. */
export interface SessionRecord {
    session: string;
    /** The domain the user described. */
    domain: string;
    /** Each agent's model and reasoning effort, as its runs report them. */
    agents: Record<string, { model: string, effort?: string }>;
    entries: Entry[];
    plans: PlanRecord[];
    /** The metrics of the plans (metrics.ts), as they are after the last entry. */
    metrics: Metrics;
    /** How many entries of the chat list are logged: after a restart, the ones before are skipped. */
    chatEntries: number;
    /** The plan waiting for the user's decision, by its number. */
    waiting?: number;
    /** The open proposals: their id, and the plan of each option, by its number. */
    proposals?: { id: number, plans: number[] };
}

/** What happened, in order. */
export type Entry =
    | { type: 'start', time: string, skills: boolean, options?: boolean }   // the log started, or continued after a restart
    | { type: 'user', time: string, text: string, chosen?: boolean }      // chosen: an option's message, clicked
    | { type: 'options', time: string, options: Option[] }
    | { type: 'dismissal', time: string }
    | { type: 'plan', time: string, plan: number }               // a planning run started: plans[plan - 1]
    | { type: 'proposals', time: string, plans: number[] }       // the options offered, by their plans' numbers
    | { type: 'choice', time: string, plan: number }             // the option whose plan waits for the decision
    | { type: 'decision', time: string, plan?: number, approved: boolean, reason?: string, kept?: string[] }   // kept: the changes kept, when only some
    | { type: 'reply', time: string, text: string, tools: ToolCall[], tokens?: Tokens, effort?: string, document: string }
    | { type: 'error', time: string, text: string };

/** One planning run: the planning agent's attempts and tool calls, and what became of its plan. */
export interface PlanRecord extends PlanOutcome {
    number: number;
    /** The label of the option of propose_changes it plans; none for plan_changes. */
    option?: string;
    started: string;
    seconds?: number;
    attempts: AttemptRecord[];
    /** The planning agent's tool calls, in order: what it read, the skills it loaded, its simulations. */
    tools: ToolCall[];
    /** The planning agent's token usage; missing when its run did not end (it ran out of turns). */
    tokens?: Tokens;
    /** Whether the user was offered the plan: its last attempt ran, and it was the turn's plan or among its options. */
    offered: boolean;
    decision?: 'approved' | 'partly approved' | 'rejected' | 'undecided' | 'not chosen';
    /** The keys of the changes the user kept, when they approved only some. */
    kept?: string[];
    reason?: string;
}

/** One simulation of a plan. */
export interface AttemptRecord {
    number: number;
    steps: PlanStep[];
    /** Whether its steps all ran; otherwise the mistake it stopped at, and why. */
    ran: boolean;
    mistake?: 'tool' | 'syntax';
    reason?: string;
    /** The errors the plan brought into the document, by kind; none when it did not run (nothing was checked). */
    newErrors: { kind: Problem['kind'], message: string }[];
    earlierErrors: number;
    warnings: number;
    /** The document after the attempt, or as far as it ran. */
    document: string;
}

export interface ToolCall {
    tool: string;
    arguments: string;
}

// ---------------- Keeping it ----------------

/** Keeps the log of the session `session` in its shared document `doc`, until the document is destroyed. */
export function startSessionLog(session: string, doc: Y.Doc): void {
    const record = load(session);
    const entries = doc.getArray<ChatEntry>('chat');
    const dsl = doc.getText('dsl');
    const domain = doc.getText('domain');
    const now = () => new Date().toISOString();

    if (record.waiting !== undefined) {   // a restart: the plan waiting for a decision is lost, and so are the options
        record.plans[record.waiting - 1].decision ??= 'undecided';
        record.waiting = undefined;
    }
    closeProposals(record);
    record.entries.push({ type: 'start', time: now(), skills: skillsOn(), options: optionsOn() });

    const running = new Map<string, PlanRecord>();   // the planning runs under way, by their ids
    let planned: PlanRecord | undefined;             // the last run of plan_changes, for the turn's plan
    let options: PlanRecord[] = [];                  // the runs of the last call of propose_changes, for its options
    let turn: { tools: ToolCall[], tokens?: Tokens, effort?: string } = { tools: [] };   // the chat agent's, for its next reply

    const save = () => {
        record.metrics = metrics(record.plans);
        mkdirSync(LOGS, { recursive: true });
        writeFileSync(file(session, 'json'), JSON.stringify(record, null, 2));
        writeFileSync(file(session, 'md'), markdown(record));
    };

    const onEvent = (event: SessionEvent) => {
        const open = event.planning !== undefined ? running.get(event.planning) : undefined;
        if (event.kind === 'planning_start' && event.planning !== undefined) {
            const plan: PlanRecord = {
                number: record.plans.length + 1, ...(event.option !== undefined ? { option: event.option } : {}),
                started: now(), attempts: [], tools: [], offered: false
            };
            record.plans.push(plan);
            running.set(event.planning, plan);
            if (event.option === undefined) {
                planned = plan;
            } else {
                options.push(plan);
            }
            record.entries.push({ type: 'plan', time: plan.started, plan: plan.number });
        } else if (event.kind === 'planning_end') {
            if (open) {
                open.seconds = (Date.now() - Date.parse(open.started)) / 1000;
                running.delete(event.planning!);
            }
        } else if (event.kind === 'tool_start' && event.tool === 'propose_changes' && !open) {
            options = [];
            turn.tools.push({ tool: event.tool, arguments: event.arguments });
        } else if (event.kind === 'tool_start') {
            (open ? open.tools : turn.tools).push({ tool: event.tool, arguments: event.arguments });
        } else if (event.kind === 'run_end') {
            record.agents[event.agent] = { model: event.model, ...(event.effort ? { effort: event.effort } : {}) };
            if (open) {
                open.tokens = event.tokens;
            } else {
                turn.tokens = event.tokens;
                turn.effort = event.effort;   // the user can change it between turns
            }
        } else if (event.kind === 'simulation' && open) {
            open.attempts.push(attempt(open.attempts.length + 1, event.steps, event.simulation));
        } else {
            return;
        }
        save();
    };

    const onEntry = (entry: ChatEntry) => {
        const time = now();
        const waiting = record.waiting !== undefined ? record.plans[record.waiting - 1] : undefined;
        switch (entry.kind) {
            case 'user':
                record.domain = domain.toString();
                record.entries.push({ type: 'user', time, text: entry.text, ...(entry.chosen ? { chosen: true } : {}) });
                if (waiting) {   // a message instead of a decision leaves the plan behind; an option's, the user may choose again
                    if (waiting.option === undefined) {
                        waiting.decision = 'undecided';
                    }
                    record.waiting = undefined;
                }
                break;
            case 'decision':
                record.entries.push({
                    type: 'decision', time, plan: waiting?.number, approved: entry.approved,
                    ...(entry.reason ? { reason: entry.reason } : {}), ...(entry.kept ? { kept: entry.kept } : {})
                });
                if (waiting) {
                    waiting.decision = !entry.approved ? 'rejected' : entry.kept ? 'partly approved' : 'approved';
                    if (entry.reason) {
                        waiting.reason = entry.reason;
                    }
                    if (entry.kept) {
                        waiting.kept = entry.kept;
                    }
                    record.waiting = undefined;
                    if (entry.approved && waiting.option !== undefined) {
                        closeProposals(record);
                    }
                }
                break;
            case 'proposals': {
                closeProposals(record);
                const plans = entry.options.map(({ label }) => options.find(plan => plan.option === label)?.number ?? 0);
                plans.filter(number => number > 0).forEach(number => record.plans[number - 1].offered = true);
                record.proposals = { id: entry.id, plans };
                record.entries.push({ type: 'proposals', time, plans });
                break;
            }
            case 'choice': {
                const plan = record.proposals?.id === entry.proposals ? record.proposals.plans[entry.option] : undefined;
                if (plan) {
                    record.waiting = plan;
                    record.entries.push({ type: 'choice', time, plan });
                }
                break;
            }
            case 'agent':
                record.entries.push({ type: 'reply', time, text: entry.text, ...turn, document: dsl.toString() });
                turn = { tools: [] };
                break;
            case 'options':
                record.entries.push({ type: 'options', time, options: entry.options });
                break;
            case 'dismissal':
                record.entries.push({ type: 'dismissal', time });
                break;
            case 'plan':
                // the turn's plan: the last run of plan_changes; it closes the proposals
                closeProposals(record);
                if (planned?.attempts.at(-1)?.ran) {
                    planned.offered = true;
                    record.waiting = planned.number;
                }
                break;
            case 'error':
                record.entries.push({ type: 'error', time, text: entry.text });
                break;
        }
    };

    const onChat = () => {
        for (let index = record.chatEntries; index < entries.length; index++) {
            onEntry(entries.get(index));
        }
        record.chatEntries = Math.max(record.chatEntries, entries.length);
        save();
    };

    const stop = listen(session, onEvent);
    entries.observe(onChat);
    doc.on('destroy', () => {
        stop();
        entries.unobserve(onChat);
    });
    save();
}

/** Closes the open proposals: their options not decided on were not chosen. */
function closeProposals(record: SessionRecord): void {
    for (const number of record.proposals?.plans ?? []) {
        const plan = record.plans[number - 1];
        if (plan && plan.decision === undefined) {
            plan.decision = 'not chosen';
        }
    }
    record.proposals = undefined;
}

/** The session's log so far, from its .json file, or a new one. */
function load(session: string): SessionRecord {
    const path = file(session, 'json');
    if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf8')) as SessionRecord;
    }
    return { session, domain: '', agents: {}, entries: [], plans: [], metrics: metrics([]), chatEntries: 0 };
}

function file(session: string, extension: 'json' | 'md'): string {
    return `${LOGS}/${session}.${extension}`;
}

/** A simulation as the log keeps it. */
function attempt(number: number, steps: PlanStep[], simulation: Extract<SessionEvent, { kind: 'simulation' }>['simulation']): AttemptRecord {
    const document = simulation.controller.toDsl();
    if (!simulation.succeeded) {
        const { mistake, reason } = simulation;
        return { number, steps, ran: false, mistake, reason, newErrors: [], earlierErrors: 0, warnings: 0, document };
    }
    const { newErrors, earlierErrors, warnings } = simulation.findings;
    return {
        number, steps, ran: true,
        newErrors: newErrors.map(({ kind, message }) => ({ kind, message })),
        earlierErrors: earlierErrors.length,
        warnings: warnings.length,
        document
    };
}

// ---------------- The Markdown file ----------------

/** The log as Markdown: the configuration and the metrics, then the entries in order. */
export function markdown(record: SessionRecord): string {
    const { metrics: m } = record;
    const starts = record.entries.filter(entry => entry.type === 'start');
    const lines = [
        `# ${record.session}`,
        '',
        '| Configuration | |',
        '|---|---|',
        `| Skills | ${starts.map(({ skills }) => skills ? 'on' : 'off').join(', ')} |`,
        `| Options | ${starts.map(({ options }) => options === undefined ? '—' : options ? 'on' : 'off').join(', ')} |`,
        ...Object.entries(record.agents).map(([agent, { model, effort }]) => `| ${agent} | ${model}, reasoning ${effort ?? 'default'} |`),
        '',
        '## Metrics',
        '',
        'Computed from the plans below with metrics.ts.',
        '',
        '| Metric | Count | Value |',
        '|---|---|---|',
        `| First-pass validity | ${m.firstPassValidity.count} / ${m.firstPassValidity.of} plans | ${percent(m.firstPassValidity.value)} |`,
        `| Final validation success | ${m.finalValidationSuccess.count} / ${m.finalValidationSuccess.of} plans | ${percent(m.finalValidationSuccess.value)} |`,
        `| Average iterations | ${m.averageIterations.sum} attempts / ${m.averageIterations.of} plans | ${m.averageIterations.value?.toFixed(2) ?? '—'} |`,
        `| Plan approval rate | ${m.planApprovalRate.count} / ${m.planApprovalRate.of} decided | ${percent(m.planApprovalRate.value)} |`,
        `| Partly approved plans | ${m.partlyApproved} | |`,
        `| Undecided plans | ${m.undecided} | |`,
        '',
        '## Domain',
        '',
        quote(record.domain || '(not described yet)'),
        '',
        '## Log',
        '',
        'Times are UTC.'
    ];
    for (const entry of record.entries) {
        lines.push('', ...entryLines(entry, record));
    }
    return lines.join('\n') + '\n';
}

function entryLines(entry: Entry, record: SessionRecord): string[] {
    const at = clock(entry.time);
    switch (entry.type) {
        case 'start':
            return [`### ${at} Start (skills ${entry.skills ? 'on' : 'off'}${entry.options === undefined ? '' : `, options ${entry.options ? 'on' : 'off'}`})`];
        case 'user':
            return [`### ${at} User${entry.chosen ? ' (chose an option)' : ''}`, '', quote(entry.text)];
        case 'options':
            return [`### ${at} Options`, '', ...entry.options.map(({ label, message, recommended }) => `- ${recommended ? '★ ' : ''}**${label}**: ${message}`)];
        case 'dismissal':
            return [`### ${at} Options closed`];
        case 'proposals':
            return [`### ${at} Options offered`, '', ...entry.plans.map(number =>
                `- **${record.plans[number - 1]?.option ?? '?'}**: plan ${number}`)];
        case 'choice':
            return [`### ${at} Option shown: ${record.plans[entry.plan - 1]?.option ?? '?'} (plan ${entry.plan})`];
        case 'plan':
            return planLines(record.plans[entry.plan - 1], at);
        case 'decision': {
            const what = `${!entry.approved ? 'rejected' : entry.kept ? `approved ${entry.kept.length} change(s): ${entry.kept.join(', ')}` : 'approved'}`
                + (entry.reason ? `; reason: ${entry.reason}` : '');
            return [`### ${at} Decision on plan ${entry.plan ?? '(none waiting)'}: ${what}`];
        }
        case 'reply':
            return [
                `### ${at} Reply`, '', quote(entry.text), '',
                `Reasoning: ${entry.effort ?? 'default'}. Tools: ${entry.tools.map(call).join(', ') || 'none'}. Tokens: ${tokens(entry.tokens)}.`, '',
                ...details('The document after the turn', entry.document)
            ];
        case 'error':
            return [`### ${at} Error`, '', quote(entry.text)];
    }
}

function planLines(plan: PlanRecord, at: string): string[] {
    const outcome = plan.offered ? `offered, ${plan.decision ?? 'waiting'}` : 'not offered';
    const lines = [
        `### ${at} Plan ${plan.number}${plan.option !== undefined ? `, option "${plan.option}"` : ''} (${outcome})`, '',
        `${plan.attempts.length} attempt(s), ${plan.seconds?.toFixed(1) ?? '?'} s, tokens: ${tokens(plan.tokens)}.`,
        `Tools: ${plan.tools.map(call).join(', ') || 'none'}.`
    ];
    for (const attempt of plan.attempts) {
        const result = !attempt.ran
            ? `stopped, ${attempt.mistake === 'syntax' ? 'a syntax mistake' : 'a wrong tool call'}`
            : `ran, ${attempt.newErrors.length} new error(s), ${attempt.earlierErrors} earlier error(s), ${attempt.warnings} warning(s)`;
        lines.push(
            '', `#### Attempt ${attempt.number}: ${result}`, '',
            ...attempt.steps.map((step, index) => `${index + 1}. \`${step.tool}\` \`${step.arguments}\``),
            ...(attempt.reason ? ['', quote(attempt.reason)] : []),
            ...(attempt.newErrors.length > 0 ? ['', ...attempt.newErrors.map(({ kind, message }) => `- ${kind}: ${message}`)] : []),
            '', ...details(attempt.ran ? 'The document after it' : 'The document as far as it ran', attempt.document)
        );
    }
    return lines;
}

/** A collapsed block with the document in it. */
function details(summary: string, document: string): string[] {
    return ['<details><summary>' + summary + '</summary>', '', '```text', document.trimEnd() || '(empty)', '```', '', '</details>'];
}

function quote(text: string): string {
    return text.split('\n').map(line => `> ${line}`).join('\n');
}

/** load_skill {"skill_name": …}: the tool, with its arguments when it has some (a simulation's steps are under its attempt). */
function call({ tool, arguments: args }: ToolCall): string {
    return args && args !== '{}' && tool !== 'simulate_plan' ? `${tool} ${args}` : tool;
}

function tokens(used: Tokens | undefined): string {
    return used ? `${used.total} (${used.input} in, ${used.output} out, ${used.requests} requests)` : '?';
}

function percent(value: number | undefined): string {
    return value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** 2026-10-28T10:01:02.345Z: 10:01:02 (UTC) */
function clock(time: string): string {
    return time.slice(11, 19);
}
