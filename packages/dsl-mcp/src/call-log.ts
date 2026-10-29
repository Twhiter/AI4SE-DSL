// The log of the calls: every tool call, with its arguments and the answer the client got, errors included, as a line
// of JSON in the log of its document (documents/<id>/log.jsonl). The log stands between the server and its transport,
// so it records each answer as it is sent: a refusal, an error of the arguments that the SDK finds before any tool
// runs, an error of the server. A tool adds what the answer's text does not hold (note): the outcome of a plan, the
// id create_dsl made. A call on no document (the grammar hints, an id that does not exist) goes to documents/log.jsonl.

import {
    isJSONRPCErrorResponse, isJSONRPCRequest, isJSONRPCResultResponse, type JSONRPCMessage, type MessageExtraInfo, type RequestId,
    type Transport, type TransportSendOptions
} from '@modelcontextprotocol/server';
import type { Mistake, Problem } from 'dsl-controller';
import type { Documents } from './documents.ts';

/** What a plan did: whether its steps all ran, else where it stopped; the check after it; whether it was written. */
export interface PlanRecord {
    ran: boolean;
    /** When it stopped: the kind of mistake, and the reason with its step. */
    mistake?: Mistake;
    reason?: string;
    /** When it ran: the check of the document after it. */
    newErrors?: Problem[];
    earlierErrors?: Problem[];
    warnings?: Problem[];
    applied: boolean;
}

/** What a tool adds to its call's line. */
export interface Note {
    /** The document of the call, when its arguments do not give it: the id create_dsl made. */
    dsl?: string;
    plan?: PlanRecord;
}

/** A line of the log. */
interface Entry extends Note {
    time: string;
    tool: string;
    arguments: Record<string, unknown>;
    /** Whether the answer is an error: a refusal, or any other error. */
    error: boolean;
    /** The answer's text. */
    answer: string;
}

export class CallLog {
    private readonly documents: Documents;
    /** The calls waiting for their answers, by request id. */
    private readonly calls = new Map<RequestId, Omit<Entry, 'error' | 'answer'>>();

    constructor(documents: Documents) {
        this.documents = documents;
    }

    /** Adds to the line of the call with `id`. */
    note(id: RequestId, note: Note): void {
        const call = this.calls.get(id);
        if (call) {
            Object.assign(call, note);
        }
    }

    /** `transport`, with each tool call and its answer logged. */
    around(transport: Transport): Transport {
        return new LoggedTransport(transport, this);
    }

    /** A request that came in: a tool call waits for its answer. */
    received(message: JSONRPCMessage): void {
        if (isJSONRPCRequest(message) && message.method === 'tools/call') {
            const { name, arguments: given } = message.params as { name: string, arguments?: Record<string, unknown> };
            this.calls.set(message.id, { time: new Date().toISOString(), tool: name, arguments: given ?? {} });
        }
    }

    /** An answer going out: the line of its call. */
    sent(message: JSONRPCMessage): void {
        if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) {
            return;
        }
        const call = message.id === undefined ? undefined : this.calls.get(message.id);
        if (!call || message.id === undefined) {
            return;
        }
        this.calls.delete(message.id);
        const entry: Entry = isJSONRPCErrorResponse(message)
            ? { ...call, error: true, answer: message.error.message }
            : { ...call, error: message.result.isError === true, answer: text(message.result.content) };
        this.write(entry);
    }

    /** The line, in the log of its document, or in the folder's own log for a call on no document. */
    private write(entry: Entry): void {
        const dsl = entry.dsl ?? entry.arguments.dsl;
        try {
            this.documents.log(this.documents.existing(String(dsl)), entry);
        } catch {
            this.documents.logWithoutDocument(entry);
        }
    }
}

/** The text of an answer's content. */
function text(content: unknown): string {
    return Array.isArray(content)
        ? content.map(part => (part as { text?: string }).text ?? '').join('\n')
        : '';
}

/** A transport that tells the log what comes in and what goes out. */
class LoggedTransport implements Transport {
    private readonly inner: Transport;
    private readonly log: CallLog;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

    constructor(inner: Transport, log: CallLog) {
        this.inner = inner;
        this.log = log;
    }

    start(): Promise<void> {
        this.inner.onclose = () => this.onclose?.();
        this.inner.onerror = error => this.onerror?.(error);
        this.inner.onmessage = (message, extra) => {
            this.log.received(message);
            this.onmessage?.(message, extra);
        };
        return this.inner.start();
    }

    send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
        this.log.sent(message);
        return this.inner.send(message, options);
    }

    close(): Promise<void> {
        return this.inner.close();
    }
}
