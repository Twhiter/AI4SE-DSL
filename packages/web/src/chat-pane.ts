// The chat with the agents, in a pane right of the editor, shown by Deep Chat (a web component). The conversation is a
// list in the session's shared document, like the DSL text: what the user writes and decides goes to the server,
// whose agents answer into the same list (packages/chatbot/src/chat-session.ts), and what they add appears here.
// A plan shows as a card: what it changes, like a git diff (+ added, − deleted, ~ changed), its tool calls behind a
// toggle that slides them open, Approve and Reject, and a box for the reason of a rejection; a decision, or a new
// message that leaves the plan behind, closes the card. A reply can have options under it, the choice it leaves the
// user, as buttons: a click sends the option's message as the user's, and the × closes them; anything after them
// closes them too, and closed they are gone. The status line says whether the agents are at work.
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
    | PlanEntry
    | { kind: 'decision', approved: boolean, reason?: string }
    | { kind: 'error', text: string };

/**
 * A plan waiting for the user's decision: what it changes, its steps (tool calls) and what each does, and the check of
 * the document after it. A plan from before diffs and steps were added has neither: its card lists what each step does.
 */
interface PlanEntry {
    kind: 'plan';
    diff?: DiffSection[];
    steps?: PlanStep[];
    changes: string[];
    problems: string;
    newErrors: number;
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

/** An element, a part of one with its pieces (States: − idle, + printing), or a line of a text (code); and its lines. */
interface DiffLine {
    change: 'added' | 'deleted' | 'changed' | 'same';
    text: string;
    parts?: Array<{ change: 'added' | 'deleted', text: string }>;
    code?: boolean;
    lines?: DiffLine[];
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

    /** The plan whose card is open, and the card's place among Deep Chat's messages. */
    let open: { plan: PlanEntry, index: number } | undefined;

    /** The place among Deep Chat's messages of the options that are open. */
    let openOptions: number | undefined;

    const closeCard = (how: string) => {
        if (open) {
            chat.updateMessage({ html: planCard(open.plan, how) }, open.index);
            open = undefined;
        }
    };

    const closeOptions = () => {
        if (openOptions !== undefined) {
            chat.updateMessage({ html: CLOSED_OPTIONS }, openOptions);
            openOptions = undefined;
        }
    };

    const show = (entry: ChatEntry) => {
        closeOptions();
        if (entry.kind === 'decision') {
            closeCard(entry.approved ? 'Approved' : 'Rejected');
        } else if (entry.kind === 'user') {
            closeCard('Left behind: a new message came first');
        }
        if (entry.kind === 'dismissal') {
            return;
        }
        chat.addMessage(message(entry));
        if (entry.kind === 'plan') {
            open = { plan: entry, index: chat.getMessages().length - 1 };
        } else if (entry.kind === 'options') {
            openOptions = chat.getMessages().length - 1;
        }
    };

    const decide = (approved: boolean, reason: string | undefined) => {
        entries.push([approved || !reason ? { kind: 'decision', approved } : { kind: 'decision', approved, reason }]);
    };

    chat.connect = {
        websocket: true,
        handler: (_body, signals) => {
            signals.onOpen();
            signals.newUserMessage.listener = (body: { messages: MessageContent[] }) => {
                const text = body.messages.map(message => message.text ?? '').join('\n').trim();
                if (text) {
                    closeCard('Left behind: a new message came first');
                    closeOptions();
                    entries.doc!.transact(() => entries.push([{ kind: 'user', text }]), SENT_HERE);
                }
            };
        }
    };
    chat.htmlClassUtilities = {
        'plan-approve': { events: { click: () => decide(true, undefined) } },
        'plan-reject': { events: { click: event => decide(false, reasonBeside(event.target)) } },
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
        case 'dismissal':   // not shown: it only closes the options
            return { role: 'user', text: '' };
        case 'plan':
            return { role: 'ai', html: planCard(entry) };
        case 'decision':
            return { role: 'user', text: entry.approved ? 'Approved the plan.' : `Rejected the plan${entry.reason ? `: ${entry.reason}` : '.'}` };
        case 'error':
            return { role: 'ai', text: `⚠ ${entry.text}` };
    }
}

/** Closed options: nothing, as their message is hidden (auxiliaryStyle); Deep Chat cannot remove a message. */
const CLOSED_OPTIONS = '<div class="options-closed"></div>';

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

/**
 * A plan's card: what it changes (or, without a diff, what each step does), its check, its tool calls behind a toggle,
 * and Approve and Reject while it is open, or how it was closed.
 */
function planCard({ diff = [], steps = [], changes, problems, newErrors }: PlanEntry, closed?: string): string {
    const changed = diff.length > 0
        ? `<div class="plan-diff">${diff.map(diffSection).join('')}</div>`
        : `<ol class="plan-changes">${changes.map(change => `<li>${escape(change)}</li>`).join('')}</ol>`;
    const check = problems === 'No problems.' ? '' : `<div class="plan-check">${escape(problems)}</div>`;
    const warning = newErrors > 0
        ? `<div class="plan-warning">This plan brings ${newErrors} error${newErrors === 1 ? '' : 's'} into the document.</div>`
        : '';
    const actions = closed
        ? `<div class="plan-closed">${escape(closed)}</div>`
        : `<input class="plan-reason" placeholder="Reason, if you reject it (optional)">
           <div class="plan-actions"><button class="plan-reject">Reject</button><button class="plan-approve">Approve</button></div>`;
    return `<div class="plan-card">
        <div class="plan-title">Plan ${diffStat(diff)}</div>
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
function diffSection({ title, lines }: DiffSection): string {
    return `<div class="diff-section"><div class="diff-title">${escape(title)}</div>${lines.map(diffLine).join('')}</div>`;
}

/**
 * "+ Customer", "~ Printer", or a line of a text as written; a part's line ("States: − idle, + printing") has no mark of
 * its own, its pieces have.
 */
function diffLine({ change, text, parts, code, lines }: DiffLine): string {
    const pieces = parts?.map(part => `<span class="diff-${part.change}">${MARKS[part.change]} ${escape(part.text)}</span>`).join(', ');
    const line = parts
        ? `<div class="diff-line"><span class="diff-mark"></span><span class="diff-text">${escape(text)}: ${pieces}</span></div>`
        : `<div class="diff-line diff-${change}${code ? ' diff-code' : ''}"><span class="diff-mark">${MARKS[change]}</span>`
            + `<span class="diff-text">${escape(text)}</span></div>`;
    return lines ? `${line}<div class="diff-nested">${lines.map(diffLine).join('')}</div>` : line;
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

/** The reason typed in the card of a clicked button, if any. */
function reasonBeside(target: EventTarget | null | undefined): string | undefined {
    const input = (target as HTMLElement | null)?.closest('.plan-card')?.querySelector<HTMLInputElement>('.plan-reason');
    return input?.value.trim() || undefined;
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
        .plan-approve:hover { background: #026EC1; }
        .plan-reject { background: #3C3C3C; color: #CCCCCC; }
        .plan-reject:hover { background: #45494E; }
        .plan-closed { color: #9D9D9D; font-style: italic; }

        .outer-message-container:has(.options-closed) { display: none; }
        .options-card { position: relative; padding-right: 22px; }
        .options-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
        .option-choice {
            display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 12px; cursor: pointer;
            border: 1px solid #3C3C3C; background: #313131; color: #CCCCCC; font: inherit; font-size: 12px;
        }
        .option-choice:hover { background: #3C3C3C; border-color: #0078D4; }
        .option-recommended { border-color: #0078D4; }
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
