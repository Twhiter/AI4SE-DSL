// The checker's Z3 checks run one at a time, also when several documents are checked at once (several chats, or an
// MCP client's parallel tool calls): each gives the problems it gives alone.

import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDocument, stopChecker } from './checker.ts';

afterAll(stopChecker);

/** An example document of the repository (examples/). */
function example(name: string): string {
    return readFileSync(`../../examples/${name}.easy`, 'utf8');
}

describe('checks at once', () => {

    it('give the problems each gives alone', async () => {
        const texts = ['sample', 'then-contradicts-itself', 'cross-scenario', 'spec-conflict', 'lists-and-queues'].map(example);
        const alone: string[] = [];
        for (const text of texts) {
            alone.push(await checkDocument(text));
        }
        expect(alone.map(problems => problems.includes('Z3:'))).toEqual([false, true, true, true, true]);
        expect(await Promise.all([...texts, ...texts].map(checkDocument))).toEqual([...alone, ...alone]);
    });
});
