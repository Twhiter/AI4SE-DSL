// The chat with the agents, in a pane right of the editor, shown by Deep Chat (a web component). The conversation is a
// list in the session's shared document, like the DSL text: what the user writes and decides goes to the server,
// whose agents answer into the same list (packages/chatbot/src/chat-session.ts), and what they add appears here.
// A plan shows as a card: what it changes, like a git diff (+ added, − deleted, ~ changed), its tool calls behind a
// toggle that slides them open, Approve and Reject, and a box for a reason, for either; a decision, or a new message
// that leaves the plan behind, closes the card. Each change has a toggle, on at first: one turned off is left out, and
// Approve approves the changes left on ("Approve 4 of 6"). A line's toggle turns what is under it on or off with it,
// and turning a change on turns on what it is under. A card closed after such a decision shows the changes left out
// struck through.
// The options of a change the chat agent proposes show as buttons, each with what its plan adds, deletes and changes:
// a click shows the option's plan card, with no turn of the agents; another option's card then takes its place. A
// message hides the card, but the options stay open: the agent shows the card of an option the message chooses. A
// rejected option is struck through and can still be chosen; an approved one, or new options or a plan, close them.
// Choices that are not changes show as buttons too: a click sends the choice's message as the user's, and the ×
// closes them; anything after them closes them too, and closed they are gone. The status line says whether the agents
// are at work.
// Deep Chat is connected through its custom handler in websocket mode, so that a message is not a request waiting
// for one answer: answers come whenever the list grows. The pane's left edge can be dragged.

import 'deep-chat';
import type { DeepChat } from 'deep-chat';
import type { MessageContent } from 'deep-chat/dist/types/messages';
import type * as Y from 'yjs';

/** The chat list's entries, as packages/chatbot/src/chat-session.ts writes and reads them. */
export type ChatEntry =
    | { kind: 'user', text: string, chosen?: boolean }
    | { kind: 'agent', text: string }
    | { kind: 'options', options: Option[] }
    | { kind: 'dismissal' }
    | ProposalsEntry
    | { kind: 'choice', proposals: number, option: number }   // proposals: their id
    | { kind: 'plan' } & PlanData
    | { kind: 'decision', approved: boolean, reason?: string, kept?: string[] }   // kept: the changes kept, when only some
    | { kind: 'error', text: string };

/**
 * A plan: what it changes, its steps (tool calls) and what each does, and the check of the document after it. A plan
 * from before diffs and steps were added has neither: its card lists what each step does.
 */
interface PlanData {
    diff?: DiffSection[];
    steps?: PlanStep[];
    changes: string[];
    problems: string;
    newErrors: number;
}

/** The options of a change the chat agent proposes, each with its plan, checked; the id tells them from earlier ones. */
interface ProposalsEntry {
    kind: 'proposals';
    id: number;
    options: Array<{ label: string, recommended: boolean, plan: PlanData }>;
}

/** A choice the reply leaves the user: its button, the message a click sends, and whether the reply recommends it. */
interface Option {
    label: string;
    message: string;
    recommended: boolean;
}

/** A step of a plan: a change tool, and its arguments as a JSON object. */
interface PlanStep {
    tool: string;
    arguments: string;
}

/** What a plan changes, as packages/dsl-controller/src/diff.ts gives it: the lines of one kind of element ("Entities", …). */
interface DiffSection {
    title: string;
    lines: DiffLine[];
}

/**
 * An element, a part of one with its pieces (States: − idle, + printing), or a line of a text (code); and its lines.
 * A change the user can keep or leave out has a key: an element added or deleted, a piece, a text.
 */
interface DiffLine {
    change: 'added' | 'deleted' | 'changed' | 'same';
    text: string;
    parts?: Array<{ change: 'added' | 'deleted', text: string, key?: string }>;
    code?: boolean;
    lines?: DiffLine[];
    key?: string;
}

const MARKS: Record<DiffLine['change'], string> = { added: '+', deleted: '−', changed: '~', same: '' };

/** Whether the user can write to the agents; off while the language changes. */
const CHAT_OPEN = true;

/** The origin of what this pane adds to the list itself: Deep Chat shows the user's messages already. */
const SENT_HERE = Symbol('chat pane');

/**
 * The chat pane of the session `session`, whose id the header shows (its first 8 characters after 'session-'): the
 * session's log on the server is named after it (packages/chatbot/logs). The header also picks the chat agent's
 * reasoning effort ('agent': effort), which the server reads at each turn.
 */
export function createChatPane(pane: HTMLElement, entries: Y.Array<ChatEntry>, status: Y.Map<string>, session: string): void {
    pane.innerHTML = `
        <div class="sash"></div>
        <div class="panel-header">
            <div class="panel-tab">Chat</div>
            <div class="chat-status"></div>
            <select class="chat-effort" title="The chat agent's reasoning effort, from its next turn on">
                <option value="low">Reasoning: low</option>
                <option value="none">Reasoning: none</option>
            </select>
            <div class="chat-session"></div>
        </div>
        <div class="chat-body"></div>`;
    const statusLine = pane.querySelector<HTMLElement>('.chat-status')!;
    const sessionLine = pane.querySelector<HTMLElement>('.chat-session')!;
    const effort = pane.querySelector<HTMLSelectElement>('.chat-effort')!;
    effort.addEventListener('change', () => status.set('effort', effort.value));
    sessionLine.textContent = `Session ${session.replace(/^session-/, '').slice(0, 8)}`;
    sessionLine.title = session;
    const chat = document.createElement('deep-chat') as DeepChat;

    /** The plan whose card is open, the card's place among Deep Chat's messages, and the option it is of, if any. */
    let open: { plan: PlanData, index: number, option?: number } | undefined;

    /** The place among Deep Chat's messages of the choices that are open. */
    let openOptions: number | undefined;

    /** The proposals whose options are open, the place of their buttons, and their options rejected so far. */
    let proposals: { entry: ProposalsEntry, index: number, rejected: Set<number> } | undefined;

    /**
     * Closes the open card, saying how, with the changes left out struck through when only those `kept` were approved;
     * an option's card left undecided is hidden instead, as its button shows it again.
     */
    const closeCard = (how: string | undefined, kept?: string[]) => {
        if (open) {
            const title = open.option !== undefined ? proposals?.entry.options[open.option]?.label : undefined;
            chat.updateMessage({ html: how === undefined ? HIDDEN : planCard(open.plan, title, { how, kept }) }, open.index);
            open = undefined;
        }
    };

    const closeOptions = () => {
        if (openOptions !== undefined) {
            chat.updateMessage({ html: HIDDEN }, openOptions);
            openOptions = undefined;
        }
    };

    /** Shows the proposals' buttons as they are now: the option shown, those rejected, or, closed, the one approved. */
    const updateProposals = (approved?: number) => {
        if (proposals) {
            const closed = approved !== undefined || undefined;
            chat.updateMessage({ html: proposalsCard(proposals.entry, { shown: open?.option, rejected: proposals.rejected, closed, approved }) }, proposals.index);
        }
    };

    const closeProposals = (approved?: number) => {
        if (proposals) {
            updateProposals(approved ?? -1);
            proposals = undefined;
        }
    };

    /**
     * The card of the option `option`: it takes the place of the open option's card when that is the last message (a
     * click of another option); otherwise that card is hidden, and this one comes last.
     */
    const showOption = (option: number) => {
        const chosen = proposals?.entry.options[option];
        if (!chosen) {
            return;
        }
        const html = planCard(chosen.plan, chosen.label);
        if (open?.option !== undefined && open.index === chat.getMessages().length - 1) {
            chat.updateMessage({ html }, open.index);
            open = { plan: chosen.plan, index: open.index, option };
        } else {
            closeCard(open?.option !== undefined ? undefined : 'Left behind: an option came first');
            chat.addMessage({ role: 'ai', html });
            open = { plan: chosen.plan, index: chat.getMessages().length - 1, option };
        }
        updateProposals();
    };

    /** A message of the user leaves the plan behind, and hides an option's card; the options stay open. */
    const leaveBehind = () => {
        closeCard(open?.option !== undefined ? undefined : 'Left behind: a new message came first');
        updateProposals();
    };

    const show = (entry: ChatEntry) => {
        closeOptions();
        switch (entry.kind) {
            case 'dismissal':
                return;
            case 'choice':
                if (entry.proposals === proposals?.entry.id) {
                    showOption(entry.option);
                }
                return;
            case 'decision': {
                const of = open ? changeKeys(open.plan.diff ?? []).length : undefined;
                const how = !entry.approved ? 'Rejected' : entry.kept ? `Approved ${entry.kept.length} of ${of ?? '?'} changes` : 'Approved';
                const option = open?.option;
                closeCard(how, entry.kept);
                if (option !== undefined && proposals) {
                    if (entry.approved) {
                        closeProposals(option);
                    } else {
                        proposals.rejected.add(option);
                        updateProposals();
                    }
                }
                chat.addMessage({ role: 'user', text: `${entry.approved ? (entry.kept ? how : 'Approved the plan') : 'Rejected the plan'}${entry.reason ? `: ${entry.reason}` : '.'}` });
                return;
            }
            case 'user':
                leaveBehind();
                break;
            case 'proposals':
            case 'plan':
                closeCard(open?.option !== undefined ? undefined : 'Left behind: a new plan came');
                closeProposals();
                break;
        }
        chat.addMessage(message(entry));
        const index = chat.getMessages().length - 1;
        if (entry.kind === 'plan') {
            open = { plan: entry, index };
        } else if (entry.kind === 'options') {
            openOptions = index;
        } else if (entry.kind === 'proposals') {
            proposals = { entry, index, rejected: new Set() };
        }
    };

    /** The decision on the open card, with the reason in its box; approved, with the changes kept when not all are. */
    const decide = (approved: boolean, target: EventTarget | null | undefined) => {
        const card = (target as HTMLElement | null)?.closest('.plan-card');
        const reason = card?.querySelector<HTMLInputElement>('.plan-reason')?.value.trim();
        const changes = [...card?.querySelectorAll<HTMLElement>('[data-key]') ?? []];
        const kept = changes.filter(change => change.classList.contains('on')).map(change => change.dataset.key!);
        entries.push([{
            kind: 'decision', approved, ...(reason ? { reason } : {}), ...(approved && kept.length < changes.length ? { kept } : {})
        }]);
    };

    chat.connect = {
        websocket: true,
        handler: (_body, signals) => {
            signals.onOpen();
            signals.newUserMessage.listener = (body: { messages: MessageContent[] }) => {
                const text = body.messages.map(message => message.text ?? '').join('\n').trim();
                if (text) {
                    leaveBehind();
                    closeOptions();
                    entries.doc!.transact(() => entries.push([{ kind: 'user', text }]), SENT_HERE);
                }
            };
        }
    };
    chat.htmlClassUtilities = {
        'plan-approve': { events: { click: event => decide(true, event.target) } },
        'plan-reject': { events: { click: event => decide(false, event.target) } },
        'change': { events: { click: event => toggleChange(event.target) } },
        'plan-toggle': { events: { click: event => toggleToolCalls(event.target) } },
        // a click of an open option sends its message, as a message of the user; the × closes the options
        'option-choice': { events: { click: event => {
            const text = (event.target as HTMLElement | null)?.closest<HTMLElement>('.option-choice')?.dataset.message;
            if (text && openOptions !== undefined) {
                entries.push([{ kind: 'user', text, chosen: true }]);
            }
        } } },
        'options-close': { events: { click: () => {
            if (openOptions !== undefined) {
                entries.push([{ kind: 'dismissal' }]);
            }
        } } },
        // a click of an open option shows its plan, unless it is shown already
        'proposal-choice': { events: { click: event => {
            const option = Number((event.target as HTMLElement | null)?.closest<HTMLElement>('.proposal-choice')?.dataset.option);
            if (proposals && proposals.entry.options[option] && open?.option !== option) {
                entries.push([{ kind: 'choice', proposals: proposals.entry.id, option }]);
            }
        } } }
    };
    style(chat);
    pane.querySelector('.chat-body')!.append(chat);

    entries.observe((event, transaction) => {
        if (transaction.origin === SENT_HERE) {
            return;
        }
        if (event.changes.deleted.size > 0) {
            // the list was cut, by the server or another tab: show it again as it is
            open = undefined;
            openOptions = undefined;
            proposals = undefined;
            chat.clearMessages();
            entries.forEach(show);
            return;
        }
        for (const { insert } of event.delta) {
            (insert as ChatEntry[] | undefined)?.forEach(show);
        }
    });

    const showStatus = () => {
        statusLine.textContent = status.get('state') === 'working' ? 'The agents are working…' : 'Ready';
        effort.value = status.get('effort') ?? 'low';
    };
    status.observe(showStatus);
    showStatus();

    makeResizable(pane, pane.querySelector<HTMLElement>('.sash')!);
}

/** An entry as Deep Chat shows it: the agents are its 'ai', a decision is the user's. */
function message(entry: ChatEntry): MessageContent {
    switch (entry.kind) {
        case 'user':
            return { role: 'user', text: entry.text };
        case 'agent':
            return { role: 'ai', text: entry.text };
        case 'options':
            return { role: 'ai', html: optionsCard(entry.options) };
        case 'proposals':
            return { role: 'ai', html: proposalsCard(entry, { rejected: new Set() }) };
        case 'dismissal':   // not shown: it only closes the options
        case 'choice':      // shown as its option's card
            return { role: 'user', text: '' };
        case 'plan':
            return { role: 'ai', html: planCard(entry) };
        case 'decision':   // shown with the card it closes
            return { role: 'user', text: '' };
        case 'error':
            return { role: 'ai', text: `⚠ ${entry.text}` };
    }
}

/** A message gone: closed choices, or an option's card left; it is hidden (auxiliaryStyle), as Deep Chat cannot remove one. */
const HIDDEN = '<div class="message-hidden"></div>';

/**
 * The options of proposals as buttons, each with what its plan adds, deletes and changes, the recommended ones marked:
 * the one whose card is shown highlighted, the rejected ones struck through; closed, they cannot be clicked, and the
 * approved one is ticked.
 */
function proposalsCard({ options }: ProposalsEntry, state: { shown?: number, rejected: Set<number>, closed?: boolean, approved?: number }): string {
    const buttons = options.map(({ label, recommended, plan }, index) => {
        const classes = ['proposal-choice', recommended && 'option-recommended', state.shown === index && 'proposal-shown',
            state.rejected.has(index) && 'proposal-rejected', state.approved === index && 'proposal-approved'].filter(Boolean).join(' ');
        return `<button class="${classes}" type="button" data-option="${index}"${state.closed ? ' disabled' : ''}>`
            + `${state.approved === index ? '<span class="option-star" aria-label="Approved">✓</span>' : recommended ? '<span class="option-star" aria-label="Recommended">★</span>' : ''}`
            + `${escape(label)} <span class="proposal-stat">${diffStat(plan.diff ?? [])}</span></button>`;
    }).join('');
    return `<div class="options-buttons">${buttons}</div>`;
}

/** The options under a reply: a button for each, the recommended one marked, and the × that closes them. */
function optionsCard(options: Option[]): string {
    const buttons = options.map(({ label, message, recommended }) =>
        `<button class="option-choice${recommended ? ' option-recommended' : ''}" type="button" data-message="${escape(message)}" title="${escape(message)}">`
        + `${recommended ? '<span class="option-star" aria-label="Recommended">★</span>' : ''}${escape(label)}</button>`).join('');
    return `<div class="options-card">
        <button class="options-close" type="button" title="Close the options" aria-label="Close the options">×</button>
        <div class="options-buttons">${buttons}</div>
    </div>`;
}

/** How a card shows its changes: open, each with a toggle, on; closed, those not `kept` struck through, if some are not. */
type ChangeView = { toggles: true } | { toggles: false, kept?: Set<string> };

/**
 * A plan's card, titled with its option's label when it is an option's: what it changes (or, without a diff, what each
 * step does), its check, its tool calls behind a toggle, and the reason's box, Approve and Reject while it is open, or
 * how it was closed.
 */
function planCard({ diff = [], steps = [], changes, problems, newErrors }: PlanData, title?: string, closed?: { how: string, kept?: string[] }): string {
    const view: ChangeView = closed ? { toggles: false, kept: closed.kept && new Set(closed.kept) } : { toggles: true };
    const changed = diff.length > 0
        ? `<div class="plan-diff">${diff.map(section => diffSection(section, view)).join('')}</div>`
        : `<ol class="plan-changes">${changes.map(change => `<li>${escape(change)}</li>`).join('')}</ol>`;
    const check = problems === 'No problems.' ? '' : `<div class="plan-check">${escape(problems)}</div>`;
    const warning = newErrors > 0
        ? `<div class="plan-warning">This plan brings ${newErrors} error${newErrors === 1 ? '' : 's'} into the document.</div>`
        : '';
    const actions = closed
        ? `<div class="plan-closed">${escape(closed.how)}</div>`
        : `<input class="plan-reason" placeholder="Reason (optional)">
           <div class="plan-actions"><button class="plan-reject">Reject</button><button class="plan-approve">Approve</button></div>`;
    return `<div class="plan-card">
        <div class="plan-title">Plan${title !== undefined ? `: ${escape(title)}` : ''} ${diffStat(diff)}</div>
        ${changed}${check}${warning}${steps.length > 0 ? toolCalls(steps, changes) : ''}${actions}
    </div>`;
}

/** How many elements the plan adds, deletes and changes: +2 −1 ~1 */
function diffStat(diff: DiffSection[]): string {
    const lines = diff.flatMap(({ lines }) => lines);
    return (['added', 'deleted', 'changed'] as const)
        .map(change => [change, lines.filter(line => line.change === change).length] as const)
        .filter(([, count]) => count > 0)
        .map(([change, count]) => `<span class="diff-${change}">${MARKS[change]}${count}</span>`)
        .join(' ');
}

/** Entities, then each entity the plan adds, deletes or changes, with what changes in it indented below. */
function diffSection({ title, lines }: DiffSection, view: ChangeView): string {
    return `<div class="diff-section"><div class="diff-title">${escape(title)}</div>${lines.map(line => diffLine(line, view)).join('')}</div>`;
}

/**
 * "+ Customer", "~ Printer", or a line of a text as written; a part's line ("States: − idle, + printing") has no mark of
 * its own, its pieces have. A line with the lines under it is an item. Open, a change has a toggle: a line or a piece
 * with a key, and a line without one that has changes under it (~ Printer), which turns them on or off together.
 */
function diffLine({ change, text, parts, code, lines, key }: DiffLine, view: ChangeView): string {
    const pieces = parts?.map(part => `<span class="${toggleClasses(`diff-${part.change}`, part.key, view)}"${keyAttribute(part.key, view)}>`
        + `${view.toggles && part.key ? DOT : ''}${MARKS[part.change]} ${escape(part.text)}</span>`).join(', ');
    const group = view.toggles && !key && changeKeys([{ title: '', lines: lines ?? [] }]).length > 0;
    const line = parts
        ? `<div class="diff-line"><span class="diff-mark"></span><span class="diff-text">${escape(text)}: ${pieces}</span></div>`
        : `<div class="${toggleClasses(`diff-line diff-${change}${code ? ' diff-code' : ''}${group ? ' change change-group on' : ''}`, key, view)}"${keyAttribute(key, view)}>`
            + `${(view.toggles && key) || group ? DOT : ''}<span class="diff-mark">${MARKS[change]}</span><span class="diff-text">${escape(text)}</span></div>`;
    return `<div class="diff-item">${line}${lines ? `<div class="diff-nested">${lines.map(nested => diffLine(nested, view)).join('')}</div>` : ''}</div>`;
}

/** The toggle of a change, before it. */
const DOT = '<span class="change-dot"></span>';

/** `classes`, and for a change with `key`: open, a toggle, on; closed, struck through when it was left out. */
function toggleClasses(classes: string, key: string | undefined, view: ChangeView): string {
    if (!key) {
        return classes;
    }
    return view.toggles ? `${classes} change on` : view.kept && !view.kept.has(key) ? `${classes} left-out` : classes;
}

function keyAttribute(key: string | undefined, view: ChangeView): string {
    return view.toggles && key ? ` data-key="${escape(key)}"` : '';
}

/** The keys of the changes of a diff, in order. */
function changeKeys(diff: DiffSection[]): string[] {
    const ofLine = ({ key, parts, lines }: DiffLine): string[] =>
        [...(key ? [key] : []), ...(parts ?? []).flatMap(part => part.key ? [part.key] : []), ...(lines ?? []).flatMap(ofLine)];
    return diff.flatMap(({ lines }) => lines.flatMap(ofLine));
}

/**
 * Turns the clicked change of an open card on or off, with what is under it; turned on, what it is under turns on too.
 * A line without a key of its own is on while a change under it is. Approve says how many changes are on.
 */
function toggleChange(target: EventTarget | null | undefined): void {
    const change = (target as HTMLElement | null)?.closest<HTMLElement>('.change');
    const card = change?.closest<HTMLElement>('.plan-card');
    const approve = card?.querySelector<HTMLButtonElement>('.plan-approve');
    if (!change || !card || !approve) {
        return;
    }
    const on = !change.classList.contains('on');
    const item = change.closest<HTMLElement>('.diff-item');
    const below = change.classList.contains('diff-line') && item ? [...item.querySelectorAll<HTMLElement>('.change')] : [change];
    below.forEach(element => element.classList.toggle('on', on));
    for (let above = on ? item : null; above; above = above.parentElement?.closest<HTMLElement>('.diff-item') ?? null) {
        above.querySelector(':scope > .change')?.classList.add('on');
    }
    card.querySelectorAll<HTMLElement>('.change-group').forEach(group =>
        group.classList.toggle('on', !!group.closest('.diff-item')?.querySelector('[data-key].on')));
    const changes = card.querySelectorAll('[data-key]').length;
    const kept = card.querySelectorAll('[data-key].on').length;
    approve.textContent = kept === changes ? 'Approve' : `Approve ${kept} of ${changes}`;
    approve.disabled = kept === 0;
}

/** The plan's tool calls, each with what it does, in a list that the toggle above it slides open. */
function toolCalls(steps: PlanStep[], changes: string[]): string {
    const calls = steps.map((step, index) => `<li>
        <div class="step-call"><span class="step-tool">${escape(step.tool)}</span>(${toolArguments(step.arguments)})</div>
        ${changes[index] ? `<div class="step-result">${escape(changes[index])}</div>` : ''}
    </li>`).join('');
    return `<button class="plan-toggle" type="button" aria-expanded="false"><span class="plan-chevron">›</span>`
        + `Tool calls · ${steps.length}</button>
        <div class="plan-steps"><div><ol>${calls}</ol></div></div>`;
}

/** A tool call's arguments, as in a call: entity: "Printer", name: "online"; a text keeps its line breaks. */
function toolArguments(json: string): string {
    let values: unknown;
    try {
        values = JSON.parse(json);
    } catch {
        values = undefined;
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
        return `<span class="step-value">${escape(json)}</span>`;
    }
    return Object.entries(values)
        .map(([name, value]) => `<span class="step-name">${escape(name)}</span>: <span class="step-value">${escape(argumentText(value))}</span>`)
        .join(', ');
}

/** A text in quotes, as written; a list as ["a", "b"]; an object as {name: "file"}; anything else as JSON (null, a number). */
function argumentText(value: unknown): string {
    if (typeof value === 'string') {
        return `"${value}"`;
    }
    if (Array.isArray(value)) {
        return `[${value.map(argumentText).join(', ')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        return `{${Object.entries(value).map(([name, field]) => `${name}: ${argumentText(field)}`).join(', ')}}`;
    }
    return JSON.stringify(value);
}

/** Slides the tool calls of the clicked toggle's card open, or shut; open, they are scrolled into view. */
function toggleToolCalls(target: EventTarget | null | undefined): void {
    const card = (target as HTMLElement | null)?.closest('.plan-card');
    if (!card) {
        return;
    }
    const open = card.classList.toggle('steps-open');
    card.querySelector('.plan-toggle')?.setAttribute('aria-expanded', String(open));
    const steps = card.querySelector<HTMLElement>('.plan-steps');
    if (open && steps) {
        steps.addEventListener('transitionend', () => steps.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), { once: true });
    }
}

function escape(text: string): string {
    return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}

/** VS Code's "Dark Modern", as the rest of the page; the card's styles go inside Deep Chat (auxiliaryStyle). */
function style(chat: DeepChat): void {
    chat.style.display = 'block';
    chat.chatStyle = {
        width: '100%', height: '100%', border: 'none', backgroundColor: '#181818',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", fontSize: '13px'
    };
    chat.messageStyles = {
        default: {
            shared: { bubble: { color: '#CCCCCC', maxWidth: '90%', lineHeight: '1.5' } },
            user: { bubble: { backgroundColor: '#0078D4', color: '#FFFFFF' } },
            ai: { bubble: { backgroundColor: '#2B2B2B' } }
        }
    };
    chat.textInput = {
        disabled: !CHAT_OPEN,
        placeholder: { text: CHAT_OPEN ? 'Ask the agent to write or change the DSL…' : 'The chat is off while the DSL changes', style: { color: '#9D9D9D' } },
        styles: {
            container: { backgroundColor: '#313131', border: '1px solid #3C3C3C', borderRadius: '4px', boxShadow: 'none' },
            text: { color: '#CCCCCC' },
            focus: { border: '1px solid #0078D4' }
        }
    };
    chat.auxiliaryStyle = `
        .plan-card { display: flex; flex-direction: column; gap: 8px; min-width: 240px; }
        .plan-title { display: flex; align-items: baseline; gap: 6px; font-weight: 600; color: #E7E7E7; }
        .plan-title span { font-weight: 400; font-size: 12px; }
        .plan-changes { margin: 0; padding-left: 20px; }

        .plan-diff { display: flex; flex-direction: column; gap: 6px; }
        .diff-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #9D9D9D; }
        .diff-line { display: flex; gap: 6px; }
        .diff-mark { flex: none; width: 10px; text-align: center; font-family: Menlo, Monaco, 'Courier New', monospace; }
        .diff-text { min-width: 0; overflow-wrap: anywhere; }
        .diff-nested { padding-left: 16px; }
        .diff-code { font-family: Menlo, Monaco, 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; border-radius: 2px; }
        .diff-added { color: #3FB950; }
        .diff-deleted { color: #F85149; }
        .diff-changed > .diff-mark, span.diff-changed { color: #D29922; }
        .diff-code.diff-added { background: rgba(46, 160, 67, .15); }
        .diff-code.diff-deleted { background: rgba(248, 81, 73, .15); }
        .diff-code.diff-same { color: #9D9D9D; }
        .change { cursor: pointer; }
        .diff-line.change { align-items: center; }
        .change-dot {
            display: inline-block; flex: none; box-sizing: border-box; width: 9px; height: 9px; margin-right: 4px;
            border: 1.5px solid currentColor; border-radius: 50%; vertical-align: 0;
        }
        .diff-line .change-dot { margin-right: 0; }
        .change.on .change-dot { background: currentColor; }
        .change:not(.on), .left-out { text-decoration: line-through; opacity: .5; }
        .change-group:not(.on) { opacity: .5; }

        .plan-toggle {
            align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 2px 0;
            border: none; background: none; color: #9D9D9D; font: inherit; font-size: 12px; cursor: pointer;
        }
        .plan-toggle:hover { color: #CCCCCC; }
        .plan-chevron { display: inline-block; width: 8px; transition: transform .2s ease; }
        .steps-open .plan-chevron { transform: rotate(90deg); }
        .plan-steps { display: grid; grid-template-rows: 0fr; margin-top: -8px; transition: grid-template-rows .25s ease, margin-top .25s ease; }
        .steps-open .plan-steps { grid-template-rows: 1fr; margin-top: 0; }
        .plan-steps > div { min-height: 0; overflow: hidden; }
        .plan-steps ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
        .step-call { font-family: Menlo, Monaco, 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .step-tool { color: #DCDCAA; }
        .step-name { color: #9CDCFE; }
        .step-value { color: #CE9178; }
        .step-result { font-size: 12px; color: #9D9D9D; }
        @media (prefers-reduced-motion: reduce) { .plan-chevron, .plan-steps { transition: none; } }

        .plan-check { white-space: pre-wrap; color: #9D9D9D; font-size: 12px; }
        .plan-warning { color: #CCA700; }
        .plan-reason {
            box-sizing: border-box; width: 100%; padding: 5px 8px; border-radius: 4px; outline: none;
            border: 1px solid #3C3C3C; background: #313131; color: #CCCCCC; font: inherit;
        }
        .plan-reason:focus { border-color: #0078D4; }
        .plan-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .plan-actions button { font: inherit; border: none; border-radius: 3px; padding: 4px 14px; cursor: pointer; }
        .plan-approve { background: #0078D4; color: #FFFFFF; }
        .plan-approve:hover:not(:disabled) { background: #026EC1; }
        .plan-approve:disabled { opacity: .5; cursor: default; }
        .plan-reject { background: #3C3C3C; color: #CCCCCC; }
        .plan-reject:hover { background: #45494E; }
        .plan-closed { color: #9D9D9D; font-style: italic; }

        .outer-message-container:has(.message-hidden) { display: none; }
        .options-card { position: relative; padding-right: 22px; }
        .options-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
        .option-choice {
            display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 12px; cursor: pointer;
            border: 1px solid #3C3C3C; background: #313131; color: #CCCCCC; font: inherit; font-size: 12px;
        }
        .option-choice:hover { background: #3C3C3C; border-color: #0078D4; }
        .option-recommended { border-color: #0078D4; }
        .proposal-choice {
            display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 12px; cursor: pointer;
            border: 1px solid #3C3C3C; background: #313131; color: #CCCCCC; font: inherit; font-size: 12px;
        }
        .proposal-choice:hover:not(:disabled) { background: #3C3C3C; border-color: #0078D4; }
        .proposal-choice:disabled { cursor: default; opacity: .6; }
        .proposal-choice.option-recommended { border-color: #0078D4; }
        .proposal-shown { background: #04395E; border-color: #0078D4; color: #FFFFFF; }
        .proposal-rejected { text-decoration: line-through; color: #9D9D9D; }
        .proposal-approved { opacity: 1 !important; border-color: #3FB950; }
        .proposal-stat { font-size: 11px; }
        .option-star { color: #4DAAFC; font-size: 11px; }
        .options-close {
            position: absolute; top: -4px; right: -4px; width: 20px; height: 20px; padding: 0; border: none; border-radius: 3px;
            background: none; color: #9D9D9D; font-size: 15px; line-height: 20px; cursor: pointer;
        }
        .options-close:hover { background: #3C3C3C; color: #CCCCCC; }`;
}

/** Dragging the sash on the pane's left edge changes its width. */
function makeResizable(pane: HTMLElement, sash: HTMLElement): void {
    sash.addEventListener('pointerdown', down => {
        sash.setPointerCapture(down.pointerId);
        sash.classList.add('active');
        const startWidth = pane.offsetWidth;
        const move = (event: PointerEvent) => {
            pane.style.width = `${Math.min(Math.max(startWidth + down.clientX - event.clientX, 200), window.innerWidth - 300)}px`;
        };
        sash.addEventListener('pointermove', move);
        sash.addEventListener('pointerup', () => {
            sash.removeEventListener('pointermove', move);
            sash.classList.remove('active');
        }, { once: true });
    });
}
