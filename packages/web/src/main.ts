import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { DOCUMENT_URI, registerEasyLanguage, EASY_LANGUAGE_ID, EASY_THEME } from './easy-language.js';
import { createChatPane, type ChatEntry } from './chat-pane.js';
import { createDcrView } from './dcr-pane.js';
import { createDomainPage } from './domain-page.js';
import { createExportMenu } from './export-menu.js';
import { createProblemsPanel } from './problems.js';
import { createReadView } from './read-view.js';
import { createViewBar } from './views.js';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';

/** The server that holds each session's document (packages/chatbot: npm run documents). */
const DOCUMENT_SERVER = 'ws://localhost:1234';

// Monaco's own background work (e.g. word positions) runs in a worker
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

registerEasyLanguage();

const editor = monaco.editor.create(document.getElementById('editor')!, {
    model: monaco.editor.createModel('', EASY_LANGUAGE_ID, monaco.Uri.parse(DOCUMENT_URI)),
    theme: EASY_THEME,
    automaticLayout: true,
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 14,
    bracketPairColorization: { enabled: true },
    'semanticHighlighting.enabled': false,
    readOnlyMessage: { value: 'The agents are working on the document: you can edit it again once they are done.' }
});

// the text is the server's: it arrives once connected, and every edit goes both ways
const shared = new Y.Doc();
const sessionId = session();
const provider = new WebsocketProvider(DOCUMENT_SERVER, sessionId, shared);
new MonacoBinding(shared.getText('dsl'), editor.getModel()!, new Set([editor]), provider.awareness);

// the document as DSL text, as tables, or as a DCR graph
createReadView(document.getElementById('read')!);
const views = createViewBar(document.getElementById('view-bar')!, [
    { name: 'DSL', element: document.getElementById('editor')! },
    { name: 'Read', element: document.getElementById('read')! },
    { name: 'DCR graph', element: document.getElementById('dcr')!, shown: createDcrView(document.getElementById('dcr')!) }
]);
// or as files, from the menu bar at the top
createExportMenu(document.getElementById('menu-bar')!);

createProblemsPanel(document.getElementById('panel')!, editor);
const agents = shared.getMap<string>('agent');
createChatPane(document.getElementById('chat')!, shared.getArray<ChatEntry>('chat'), agents, sessionId);

// while the agents work, the document is theirs: the editor is read-only until they are done
const lockWhileWorking = () => {
    const working = agents.get('state') === 'working';
    editor.updateOptions({ readOnly: working });
    views.say(working ? 'Read-only while the agents work' : '');
};
agents.observe(lockWhileWorking);
lockWhileWorking();

// before the editor and the chat: the session's domain description
createDomainPage(document.getElementById('domain')!, shared.getText('domain'), provider, () => editor.focus());

/**
 * This tab's session: a new tab starts a new one, with an empty document and chat; a reload keeps it. Without
 * sessionStorage (a private window may refuse it) every load is a new session.
 */
function session(): string {
    const key = 'easy-session';
    try {
        const kept = sessionStorage.getItem(key);
        if (kept) {
            return kept;
        }
    } catch {
        // no sessionStorage: a new session
    }
    const id = `session-${crypto.randomUUID()}`;
    try {
        sessionStorage.setItem(key, id);
    } catch {
        // not kept: the next load is a new session
    }
    return id;
}
