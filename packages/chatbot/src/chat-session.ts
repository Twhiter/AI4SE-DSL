// The agents' side of a session's shared document. The tab and the server share its chat list ('chat'): the tab adds
// what the user writes and decides, and the server answers each with the agents (agent.ts), one turn at a time, then
// writes into the shared document what the turn gave: the chat agent's reply, a plan for the user to decide on, and,
// after an approved plan, the new DSL text ('dsl'). The tab picks the chat agent's reasoning effort ('agent': effort),
// read at each turn. The status ('agent': state) says whether a turn is under way; the
// tab's editor is read-only meanwhile. After a reply without a plan, the options agent (options.ts) adds the choice
// the reply leaves the user, if any, as options, unless the user has written meanwhile.
// The chat list's entries, which the tab's chat pane shows (packages/web/src/chat-pane.ts has the same types):
//   user      a message of the user, typed or chosen (an option's message, clicked)
//   agent     the chat agent's reply
//   options   the options of the reply before them, for the user to click, until anything comes after them
//   dismissal the user closed the options without choosing one
//   plan      a plan waiting for the user's decision: what it changes (diff), its steps (tool calls) and what each
//             does, and the check after it
//   decision  the user's decision on the plan: approved, or rejected, with a reason or without
//   error     a turn that failed, and why

import type * as Y from 'yjs';
import type { DiffSection, PlanStep } from 'dsl-controller';
import { chat, CHAT_EFFORTS, Conversation, decide, type ChatEffort, type Plan } from './agent.ts';
import { inSession } from './experiment/events.ts';
import { startSessionLog } from './experiment/session-log.ts';
import { findOptions, optionsOn, type Option } from './options.ts';

export type ChatEntry =
    | { kind: 'user', text: string, chosen?: boolean }
    | { kind: 'agent', text: string }
    | { kind: 'options', options: Option[] }
    | { kind: 'dismissal' }
    | { kind: 'plan', diff: DiffSection[], steps: PlanStep[], changes: string[], problems: string, newErrors: number }
    | { kind: 'decision', approved: boolean, reason?: string }
    | { kind: 'error', text: string };

/** What the user adds, and the agents answer. */
type Request = Extract<ChatEntry, { kind: 'user' | 'decision' }>;

/** The origin of what the agents write into the shared document: the tab's own changes come from elsewhere. */
const AGENTS = Symbol('agents');

/** Has the agents answer the user in `doc`, the shared document of the session `session`, and logs the session. */
export function connectAgents(doc: Y.Doc, session: string): void {
    startSessionLog(session, doc);
    const entries = doc.getArray<ChatEntry>('chat');
    const dsl = doc.getText('dsl');
    const domain = doc.getText('domain');
    const status = doc.getMap<string>('agent');

    // made at the first turn: the user describes the domain before they can write
    let conversation: Conversation | undefined;
    let turns = Promise.resolve();
    let working = false;

    // the session is forgotten: its conversation ends, after the turn under way, and its sandbox is closed
    doc.on('destroy', () => {
        turns = turns.then(() => conversation?.close()).catch(error =>
            console.error(`The conversation's sandbox could not be closed: ${error instanceof Error ? error.message : error}`));
    });

    const write = (change: () => void) => doc.transact(change, AGENTS);
    const setStatus = () => write(() => status.set('state', working ? 'working' : 'ready'));

    const answer = async (request: Request) => {
        conversation ??= new Conversation(domain.toString());
        const effort = status.get('effort');
        conversation.effort = CHAT_EFFORTS.includes(effort as ChatEffort) ? effort as ChatEffort : 'low';
        working = true;
        setStatus();
        try {
            if (request.kind === 'decision' && !conversation.plan) {
                write(() => entries.push([{ kind: 'error', text: 'There is no plan waiting for a decision any more.' }]));
                return;
            }
            const turn = request.kind === 'user'
                ? await chat(conversation, request.text, dsl.toString())
                : await decide(conversation, request.approved ? { approved: true } : { approved: false, reason: request.reason }, dsl.toString());
            write(() => {
                if (turn.document !== undefined) {
                    replaceText(dsl, turn.document);
                }
                entries.push([{ kind: 'agent', text: turn.reply }]);
                if (turn.plan) {
                    entries.push([planEntry(turn.plan)]);
                }
            });
            if (!turn.plan && optionsOn()) {
                void offerOptions(request, turn.reply);
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            write(() => entries.push([{ kind: 'error', text: `The agents could not answer: ${reason}` }]));
        } finally {
            working = false;
            setStatus();
        }
    };

    /**
     * The options of `reply`, the answer to `request`, after it in the list; not when anything came after the reply
     * meanwhile, such as the user's next message. They are found while the user can already write: the reply's turn is
     * over.
     */
    const offerOptions = async (request: Request, reply: string) => {
        const after = entries.length;
        const message = request.kind === 'user' ? request.text
            : request.approved ? '(approved the plan)' : `(rejected the plan${request.reason ? `: ${request.reason}` : ''})`;
        try {
            const options = await findOptions(message, reply);
            if (options.length > 0 && entries.length === after) {
                write(() => entries.push([{ kind: 'options', options }]));
            }
        } catch (error) {
            console.error(`The options agent failed: ${error instanceof Error ? error.message : error}`);
        }
    };

    // the status is the agents' to say: a tab that brings another, from before the server restarted, is set right, or
    // its editor would stay read-only
    status.observe((_event, transaction) => {
        if (transaction.origin !== AGENTS && (status.get('state') === 'working') !== working) {
            setStatus();
        }
    });

    // a new message or decision from the tab: answered after the turns before it, and once. Only the last entry
    // counts, so that a tab that sends its whole chat again (after the server restarted) does not have it answered again.
    let answered: ChatEntry | undefined;
    entries.observe((_event, transaction) => {
        const last = entries.get(entries.length - 1);
        if (transaction.origin !== AGENTS && last && last !== answered && (last.kind === 'user' || last.kind === 'decision')) {
            answered = last;
            turns = turns.then(() => inSession(session, () => answer(last)));
        }
    });
}

function planEntry({ diff, steps, changes, problems, newErrors }: Plan): ChatEntry {
    return { kind: 'plan', diff, steps, changes, problems, newErrors };
}

/**
 * Sets the text of `text` to `next`, replacing only what lies between their common start and their common end, so
 * that the user's cursor elsewhere in the editor stays where it is.
 */
function replaceText(text: Y.Text, next: string): void {
    const now = text.toString();
    let start = 0;
    while (start < now.length && start < next.length && now[start] === next[start]) {
        start++;
    }
    let end = 0;
    while (end < now.length - start && end < next.length - start && now[now.length - 1 - end] === next[next.length - 1 - end]) {
        end++;
    }
    text.delete(start, now.length - start - end);
    text.insert(start, next.slice(start, next.length - end));
}
