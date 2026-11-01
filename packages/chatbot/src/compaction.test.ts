// The chat's memory compacted by Claude (compaction.ts), with a summarizer that stands in for Claude: what is summarized,
// what is kept, and the memory after.

import { MemorySession, assistant, system, user, type AgentInputItem } from '@openai/agents';
import { describe, expect, it } from 'vitest';
import { compactWithClaude, cutAt, messagesOf, SUMMARY_HEADING, tokensOf, type Message } from './compaction.ts';

const call = { type: 'function_call', callId: 'c1', name: 'read_document', arguments: '{}', status: 'completed' } as AgentInputItem;
const result = { type: 'function_call_result', callId: 'c1', name: 'read_document', status: 'completed', output: { type: 'text', text: 'Entity Printer { }' } } as AgentInputItem;
const reasoning = { type: 'reasoning', content: [] } as unknown as AgentInputItem;

/** Two turns: a question the agent answers after reading the document, then a notice and its answer. */
const TURNS: AgentInputItem[] = [
    user('What is in the document?'), reasoning, call, result, assistant('An entity Printer.'),
    user('The user approved the plan.'), assistant('Done.')
];

describe('messagesOf', () => {
    it('gives the messages as they are, tool calls and their results in brackets, and leaves reasoning out', () => {
        expect(messagesOf(TURNS)).toEqual([
            { role: 'user', content: 'What is in the document?' },
            { role: 'assistant', content: '[Called read_document({})]' },
            { role: 'user', content: '[Result of read_document: Entity Printer { }]' },
            { role: 'assistant', content: 'An entity Printer.' },
            { role: 'user', content: 'The user approved the plan.' },
            { role: 'assistant', content: 'Done.' }
        ]);
    });

    it('joins messages of the same role, starts with the user, and gives a system message as a note', () => {
        expect(messagesOf([assistant('Summary of the earlier conversation: …'), system('The plan was rejected.'), user('Why?')])).toEqual([
            { role: 'user', content: '(The conversation begins.)' },
            { role: 'assistant', content: 'Summary of the earlier conversation: …' },
            { role: 'user', content: '[From the program: The plan was rejected.]\n\nWhy?' }
        ]);
    });

    it('cuts a long result', () => {
        const long = { ...result, output: { type: 'text', text: 'x'.repeat(5_000) } } as AgentInputItem;
        expect(messagesOf([user('Read it.'), call, long])[2].content).toHaveLength('[Result of read_document: '.length + 2_000 + ' …]'.length);
    });
});

describe('cutAt', () => {
    const big = user('y'.repeat(4_000));   // about 1,000 tokens
    const items = [user('First.'), assistant('One.'), ...TURNS];

    it('keeps the latest two turns when they are small', () => {
        expect(cutAt(items, 1_000)).toBe(2);
    });

    it('keeps only the latest turn when the two are too large, and none when it is', () => {
        const withBig = [user('First.'), assistant('One.'), big, assistant('Two.'), user('Third.'), assistant('Three.')];
        expect(cutAt(withBig, 500)).toBe(4);
        expect(cutAt([...withBig, big], 500)).toBe(withBig.length + 1);
    });
});

describe('compactWithClaude', () => {
    const items = [user('First.'), assistant('One.'), ...TURNS];

    it('puts the summary of the older items first, and keeps the latest turns', async () => {
        const memory = new MemorySession({ initialItems: items });
        const asked: Message[][] = [];
        const compaction = await compactWithClaude(memory, 'claude-sonnet-5-5', 1_000, async messages => {
            asked.push(messages);
            return 'The user started.';
        });
        expect(asked).toEqual([[{ role: 'user', content: 'First.' }, { role: 'assistant', content: 'One.' }]]);
        expect(compaction).toEqual({ summarized: 2, kept: TURNS.length, summary: 'The user started.' });
        expect(await memory.getItems()).toEqual([assistant(`${SUMMARY_HEADING}\nThe user started.`), ...TURNS]);
        expect(tokensOf(await memory.getItems())).toBeLessThan(tokensOf(items) + 50);
    });

    it('leaves the memory as it is when no summary comes back', async () => {
        const memory = new MemorySession({ initialItems: items });
        await expect(compactWithClaude(memory, 'claude-sonnet-5-5', 1_000, async () => {
            throw new Error('No summary came back (stop reason: max_tokens).');
        })).rejects.toThrow('No summary came back');
        expect(await memory.getItems()).toEqual(items);
    });

    it('does nothing when the latest turns are all there is', async () => {
        const memory = new MemorySession({ initialItems: TURNS });
        expect(await compactWithClaude(memory, 'claude-sonnet-5-5', 1_000, async () => 'never')).toBeUndefined();
        expect(await memory.getItems()).toEqual(TURNS);
    });
});
