// The experiment's log of a session: what happened in it, kept as data and written after each change to two files in
// packages/chatbot/logs, named after the session (its id, which the chat's header in the browser shows):
//   <session>.json  the data: the entries in order, the plans with their attempts, and the metrics computed from the
//                   plans with metrics.ts
//   <session>.md    the same to read: the metrics, then the entries, each document in a code block
// The log takes what happens from outside the workflow: from the chat list of the session's shared document (the
// user's messages and decisions, the agents' replies and plans, the options offered, chosen or closed) and from the
// experiment's events (events.ts: the tool calls, the planning agent's simulations, the runs' token usage; the options
// agent's runs are not among them). A plan is one call of plan_changes: it opens at the call and closes at its end, and
// the tool calls and the run in between are the planning agent's.
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
}

/** What happened, in order. */
export type Entry =
    | { type: 'start', time: string, skills: boolean, options?: boolean }   // the log started, or continued after a restart
    | { type: 'user', time: string, text: string, chosen?: boolean }      // chosen: an option's message, clicked
    | { type: 'options', time: string, options: Option[] }
    | { type: 'dismissal', time: string }
    | { type: 'plan', time: string, plan: number }               // plan_changes was called: plans[plan - 1]
    | { type: 'decision', time: string, plan?: number, approved: boolean, reason?: string }
    | { type: 'reply', time: string, text: string, tools: ToolCall[], tokens?: Tokens, effort?: string, document: string }
    | { type: 'error', time: string, text: string };

/** One call of plan_changes: the planning agent's attempts and tool calls, and what became of its plan. */
export interface PlanRecord extends PlanOutcome {
    number: number;
    started: string;
    seconds?: number;
    attempts: AttemptRecord[];
    /** The planning agent's tool calls, in order: what it read, the skills it loaded, its simulations. */
    tools: ToolCall[];
    /** The planning agent's token usage; missing when its run did not end (it ran out of turns). */
    tokens?: Tokens;
    /** Whether the user was offered the plan: its last attempt ran, and it was the turn's plan. */
    offered: boolean;
    decision?: 'approved' | 'rejected' | 'undecided';
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

    if (record.waiting !== undefined) {   // a restart: the plan waiting for a decision is lost
        record.plans[record.waiting - 1].decision = 'undecided';
        record.waiting = undefined;
    }
    record.entries.push({ type: 'start', time: now(), skills: skillsOn(), options: optionsOn() });

    let open: PlanRecord | undefined;              // the plan whose plan_changes call is under way
    let turn: { tools: ToolCall[], tokens?: Tokens, effort?: string } = { tools: [] };   // the chat agent's, for its next reply

    const save = () => {
        record.metrics = metrics(record.plans);
        mkdirSync(LOGS, { recursive: true });
        writeFileSync(file(session, 'json'), JSON.stringify(record, null, 2));
        writeFileSync(file(session, 'md'), markdown(record));
    };

    const onEvent = (event: SessionEvent) => {
        if (event.kind === 'tool_start' && event.tool === 'plan_changes') {
            open = { number: record.plans.length + 1, started: now(), attempts: [], tools: [], offered: false };
            record.plans.push(open);
            record.entries.push({ type: 'plan', time: open.started, plan: open.number });
        } else if (event.kind === 'tool_end' && event.tool === 'plan_changes') {
            if (open) {
                open.seconds = (Date.now() - Date.parse(open.started)) / 1000;
            }
            open = undefined;
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
                if (waiting) {   // a message instead of a decision leaves the plan behind
                    waiting.decision = 'undecided';
                    record.waiting = undefined;
                }
                break;
            case 'decision':
                record.entries.push({ type: 'decision', time, plan: waiting?.number, approved: entry.approved, ...(entry.reason ? { reason: entry.reason } : {}) });
                if (waiting) {
                    waiting.decision = entry.approved ? 'approved' : 'rejected';
                    if (entry.reason) {
                        waiting.reason = entry.reason;
                    }
                    record.waiting = undefined;
                }
                break;
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
            case 'plan': {
                // the turn's plan: the last one whose last attempt ran
                const offered = [...record.plans].reverse().find(({ attempts }) => attempts.at(-1)?.ran);
                if (offered) {
                    offered.offered = true;
                    record.waiting = offered.number;
                }
                break;
            }
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
        case 'plan':
            return planLines(record.plans[entry.plan - 1], at);
        case 'decision': {
            const what = entry.approved ? 'approved' : `rejected${entry.reason ? `: ${entry.reason}` : ''}`;
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
        `### ${at} Plan ${plan.number} (${outcome})`, '',
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
