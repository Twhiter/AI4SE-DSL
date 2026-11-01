// The chat's memory compacted by Claude, for a Claude model. The OpenAI API's compaction (the SDK's compaction session,
// which agent.ts keeps for a GPT model) gives an encrypted item that only OpenAI's models can read: Claude, served
// through the same Responses API, fails with a 500 on every request that carries one. So for Claude the older part of
// the memory is summarized by Anthropic's compaction on demand (its Messages API, beta compact-2026-09-04), which the
// endpoint serves too (Azure AI Foundry: <origin>/anthropic/v1/messages, with the same key), and the summary, which is
// text, takes its place as an assistant message, where Anthropic puts its compaction block: Claude reads it through the
// Responses API like any message. (The signed block itself goes back only through the Messages API, which the agents
// do not use.) The latest turns stay word for word, as long as they are small enough.

import { assistant, type AgentInputItem, type Session } from '@openai/agents';

/** How many of the latest turns stay word for word, each from a message of the user (or a notice) on. */
const KEEP_TURNS = 2;

/** How much of a tool call's arguments or result the summary is made from. */
const MOST_CHARACTERS = 2_000;

/** The room the summary has, any thinking before it included. */
const SUMMARY_TOKENS = 8_192;

/** What the summarizer is told the messages are. */
const CONTEXT = 'These are the earlier messages of a chat between a user and the chat agent of DSL easy, an editor of a '
    + 'domain-specific language for processes (entities, roles, actions, specifications and scenarios). The lines in '
    + 'square brackets are the agent\'s tool calls and their results, and notes from the program, such as the user\'s '
    + 'decisions on plans.';

/** How a compacted memory begins, before the summary. */
export const SUMMARY_HEADING = 'Summary of the earlier conversation:';

/** What a compaction did: how many items it summarized, how many it kept, and the summary. */
export interface Compaction {
    summarized: number;
    kept: number;
    summary: string;
}

/** A message of Anthropic's Messages API, as text. */
export interface Message {
    role: 'user' | 'assistant';
    content: string;
}

/** About how many tokens `items` are: 4 characters each. */
export function tokensOf(items: AgentInputItem[]): number {
    return JSON.stringify(items).length / 4;
}

/**
 * Compacts `memory` with `model`: the items before its latest turns (cutAt, keeping at most `keep` tokens) become a
 * summary (`summarize`, Claude's by default). Nothing happens when there is nothing before the turns kept; when no
 * summary comes back, it throws and the memory stays as it is.
 */
export async function compactWithClaude(memory: Session, model: string, keep: number,
    summarize: (messages: Message[], model: string) => Promise<string> = summarizeWithClaude): Promise<Compaction | undefined> {
    const items = await memory.getItems();
    const cut = cutAt(items, keep);
    if (cut === 0) {
        return undefined;
    }
    const summary = await summarize(messagesOf(items.slice(0, cut)), model);
    await memory.clearSession();
    await memory.addItems([assistant(`${SUMMARY_HEADING}\n${summary}`), ...items.slice(cut)]);
    return { summarized: cut, kept: items.length - cut, summary };
}

/**
 * Where the items summarized end: at the start of the earliest of the latest KEEP_TURNS turns that together hold at
 * most `keep` tokens, so that what stays is small; at the end when even the latest turn is larger (all is summarized).
 */
export function cutAt(items: AgentInputItem[], keep: number): number {
    const starts = items.flatMap((item, index) => isUsers(item) ? [index] : []);
    let cut = items.length;
    for (const start of starts.slice(-KEEP_TURNS).reverse()) {
        if (tokensOf(items.slice(start)) > keep) {
            break;
        }
        cut = start;
    }
    return cut;
}

/**
 * The items as Anthropic's messages, in text: a message as it is (a system or developer message as a note of the
 * user's), a tool call and its result in square brackets, each cut to MOST_CHARACTERS; reasoning left out. Messages of
 * the same role in a row are one, and the first is the user's.
 */
export function messagesOf(items: AgentInputItem[]): Message[] {
    const messages: Message[] = [];
    for (const item of items) {
        const said = sayOf(item);
        if (!said?.content) {
            continue;
        }
        const last = messages.at(-1);
        if (last?.role === said.role) {
            last.content += `\n\n${said.content}`;
        } else {
            messages.push(said);
        }
    }
    if (messages[0]?.role === 'assistant') {
        messages.unshift({ role: 'user', content: '(The conversation begins.)' });
    }
    return messages;
}

/** Claude's summary of `messages`: Anthropic's compaction on demand, on the endpoint's Messages API. */
async function summarizeWithClaude(messages: Message[], model: string): Promise<string> {
    const response = await fetch(new URL('/anthropic/v1/messages', process.env.OPENAI_BASE_URL), {
        method: 'POST',
        headers: {
            'x-api-key': process.env.OPENAI_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'compact-2026-09-04',
            'content-type': 'application/json'
        },
        body: JSON.stringify({ model, max_tokens: SUMMARY_TOKENS, system: CONTEXT, messages, compaction: { type: 'summarize' } }),
        signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) {
        throw new Error(`The Messages API answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const answer = await response.json() as { stop_reason?: string, content?: Array<{ type: string, content?: unknown }> };
    const block = answer.content?.find(({ type }) => type === 'compaction');
    if (answer.stop_reason !== 'compaction' || typeof block?.content !== 'string') {
        throw new Error(`No summary came back (stop reason: ${answer.stop_reason ?? 'none'}).`);
    }
    return block.content;
}

/** Whether `item` is a message of the user: where a turn starts. */
function isUsers(item: AgentInputItem): boolean {
    return 'role' in item && item.role === 'user';
}

/** What an item says, as one of Anthropic's messages; nothing for reasoning or a compaction. */
function sayOf(item: AgentInputItem): Message | undefined {
    const { type, role } = item as { type?: string, role?: string };
    if (type === 'reasoning' || type === 'compaction') {
        return undefined;
    }
    if (role !== undefined) {
        const text = textOf((item as { content?: unknown }).content);
        return role === 'assistant' ? { role: 'assistant', content: text } : { role: 'user', content: role === 'user' ? text : `[From the program: ${text}]` };
    }
    if (type === 'function_call') {
        const { name, arguments: input } = item as { name: string, arguments: string };
        return { role: 'assistant', content: `[Called ${name}(${shortened(input)})]` };
    }
    if (type === 'function_call_result') {
        const { name, output } = item as { name?: string, output?: unknown };
        return { role: 'user', content: `[Result of ${name ?? 'a tool'}: ${shortened(textOf(output))}]` };
    }
    // another kind of call or result, such as the sandbox's, as it is
    return { role: 'output' in item ? 'user' : 'assistant', content: `[${type ?? 'item'}: ${shortened(JSON.stringify(item))}]` };
}

/** The text of a message's content, or of a tool's output: a string, a part with text, or parts. */
function textOf(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map(textOf).filter(text => text !== '').join('\n');
    }
    if (content !== null && typeof content === 'object') {
        const { text, refusal, type } = content as { text?: unknown, refusal?: unknown, type?: unknown };
        if (typeof text === 'string') {
            return text;
        }
        if (typeof refusal === 'string') {
            return refusal;
        }
        return typeof type === 'string' ? `[${type}]` : '';
    }
    return '';
}

/** `text`, cut to MOST_CHARACTERS. */
function shortened(text: string): string {
    return text.length > MOST_CHARACTERS ? `${text.slice(0, MOST_CHARACTERS)} …` : text;
}
