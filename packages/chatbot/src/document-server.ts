// The sessions' documents: for each session (a browser tab), the server's copy of its DSL text and chat, kept in sync
// with the tab over a WebSocket. The tab binds its Monaco editor to the text (y-monaco) and connects with y-websocket
// to the room of its session, so the user's edits arrive here and edits made here appear in the editor at once.
// A session's document starts empty and is forgotten a while after its last tab has gone. The agents answer the user
// in it (chat-session.ts).
// It speaks y-websocket's protocol (sync and awareness, from y-protocols) itself: y-websocket's own server
// (@y/websocket-server) loads LevelDB, a native module, even when it stores nothing.
// Run it with `npm run documents`; a tab connects to ws://localhost:1234/<its session>.

import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { connectAgents } from './chat-session.ts';

const PORT = 1234;
/** The DSL text in a session's document. */
const TEXT = 'dsl';
/** How long a session is kept after its last tab has gone, for a reload or a lost connection to come back to it. */
const KEPT_FOR = 10 * 60 * 1000;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** A session's document with the tabs connected to it, each with the awareness clients (cursors) it controls. */
export interface Room {
    doc: Y.Doc;
    awareness: awarenessProtocol.Awareness;
    connections: Map<WebSocket, Set<number>>;
    /** Set while no tab is connected: then the room is forgotten. */
    forget?: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Room>();

/** The room of a document, made on first use: every change of its document or awareness goes to every browser. */
export function room(name: string): Room {
    const existing = rooms.get(name);
    if (existing) {
        return existing;
    }
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);   // the server has no cursor of its own
    const room: Room = { doc, awareness, connections: new Map() };

    doc.on('update', (update: Uint8Array) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        broadcast(room, encoding.toUint8Array(encoder));
    });
    awareness.on('update', ({ added, updated, removed }: AwarenessChanges, origin: unknown) => {
        const controlled = room.connections.get(origin as WebSocket);
        added.forEach(client => controlled?.add(client));
        removed.forEach(client => controlled?.delete(client));
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
        broadcast(room, encoding.toUint8Array(encoder));
    });

    // for now the server only reports what it receives
    const text = doc.getText(TEXT);
    let quiet: ReturnType<typeof setTimeout> | undefined;
    text.observe(() => {
        clearTimeout(quiet);
        quiet = setTimeout(() => console.info(`${name}: ${text.length} characters, ${text.toString().split('\n').length} lines`), 250);
    });

    connectAgents(doc, name);
    rooms.set(name, room);
    console.info(`${name}: opened`);
    return room;
}

interface AwarenessChanges {
    added: number[];
    updated: number[];
    removed: number[];
}

/** A browser opens a document: the two sides exchange what the other misses, then every change. */
function connect(socket: WebSocket, name: string): void {
    const current = room(name);
    const { doc, awareness, connections } = current;
    clearTimeout(current.forget);
    connections.set(socket, new Set());
    socket.binaryType = 'arraybuffer';

    socket.on('message', (data: ArrayBuffer) => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const encoder = encoding.createEncoder();
        const type = decoding.readVarUint(decoder);
        if (type === MESSAGE_SYNC) {
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
            if (encoding.length(encoder) > 1) {
                send(socket, encoding.toUint8Array(encoder));   // the answer to its state: what it misses
            }
        } else if (type === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), socket);
        }
    });
    socket.on('close', () => {
        const controlled = connections.get(socket) ?? new Set<number>();
        connections.delete(socket);
        awarenessProtocol.removeAwarenessStates(awareness, [...controlled], null);
        if (connections.size === 0) {
            current.forget = setTimeout(() => {
                rooms.delete(name);
                doc.destroy();
                console.info(`${name}: forgotten`);
            }, KEPT_FOR);
        }
    });

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(socket, encoding.toUint8Array(encoder));
    const states = awareness.getStates();
    if (states.size > 0) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [...states.keys()]));
        send(socket, encoding.toUint8Array(awarenessEncoder));
    }
}

function broadcast({ connections }: Room, message: Uint8Array): void {
    connections.forEach((_controlled, socket) => send(socket, message));
}

function send(socket: WebSocket, message: Uint8Array): void {
    if (socket.readyState === socket.OPEN) {
        socket.send(message);
    }
}

// ---------------- The server ----------------

const server = new WebSocketServer({ host: 'localhost', port: PORT });
server.on('connection', (socket, request) => connect(socket, (request.url ?? '/').slice(1).split('?')[0]));

console.info(`Sessions at ws://localhost:${PORT}/<session>.`);
