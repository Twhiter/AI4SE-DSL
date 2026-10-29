// The log of the calls: a line per call, with its answer, errors included, in the log of its document or the folder's.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CallLog } from './call-log.ts';
import { Documents } from './documents.ts';

/** A log on a new, empty folder, with a document in it. */
function newLog() {
    const folder = mkdtempSync(join(tmpdir(), 'dsl-mcp-'));
    const documents = new Documents(pathToFileURL(`${folder}/`));
    return { log: new CallLog(documents), dsl: documents.create('A printer.'), folder };
}

/** The lines of a log file. */
function lines(file: string): Record<string, unknown>[] {
    return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

/** A tool call, as a request. */
function call(id: number, name: string, input: object) {
    return { jsonrpc: '2.0' as const, id, method: 'tools/call', params: { name, arguments: input } };
}

describe('the log of the calls', () => {
    it('logs a call with its answer, and what the tool noted', () => {
        const { log, dsl, folder } = newLog();
        log.received(call(1, 'simulate_plan', { dsl, steps: [] }));
        log.note(1, { plan: { ran: false, mistake: 'tool', reason: 'The plan has no steps.', applied: false } });
        log.sent({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'The plan stops: …' }] } });
        expect(lines(join(folder, dsl, 'log.jsonl'))).toMatchObject([{
            tool: 'simulate_plan', arguments: { dsl, steps: [] }, error: false, answer: 'The plan stops: …',
            plan: { ran: false, mistake: 'tool' }
        }]);
    });

    it('logs an error answer, and a protocol error', () => {
        const { log, dsl, folder } = newLog();
        log.received(call(1, 'apply_plan', { dsl }));
        log.sent({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Input validation error: …' }], isError: true } });
        log.received(call(2, 'read_document', { dsl }));
        log.sent({ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'Tool read_documents not found' } });
        expect(lines(join(folder, dsl, 'log.jsonl'))).toMatchObject([
            { tool: 'apply_plan', error: true, answer: 'Input validation error: …' },
            { tool: 'read_document', error: true, answer: 'Tool read_documents not found' }
        ]);
    });

    it('logs create_dsl with the document it made, and a call on no document in the folder', () => {
        const { log, dsl, folder } = newLog();
        log.received(call(1, 'create_dsl', { domain: 'A printer.' }));
        log.note(1, { dsl });
        log.sent({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: `Created the DSL ${dsl}` }] } });
        log.received(call(2, 'read_document', { dsl: 'nothing' }));
        log.sent({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: "There is no DSL 'nothing'" }], isError: true } });
        expect(lines(join(folder, dsl, 'log.jsonl'))).toMatchObject([{ tool: 'create_dsl', dsl }]);
        expect(lines(join(folder, 'log.jsonl'))).toMatchObject([{ tool: 'read_document', error: true }]);
    });
});
