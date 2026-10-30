// The DCR graph panel: a webview beside the editor, opened by the command 'DSL easy: Show DCR graph' (the button on an
// .easy file's title bar). It shows the graph of the .easy document shown last, as the language server sends it after
// every check (DCR_GRAPH); the webview (src/webview/dcr.ts) draws it with dcr-view's graph view, and keeps what was
// dragged in each document's graph while the panel is open. Its 'Export' buttons save the graph as DCR Solutions XML or
// dcr-js XML where the user chooses (a save dialog).

import * as vscode from 'vscode';
import type { DcrExportMessage, DcrGraphMessage, DcrGraphParams } from '../protocol.js';

export class DcrPanel {
    private readonly extensionUri: vscode.Uri;
    /** The latest graph of each document, or why there is none. */
    private readonly graphs = new Map<string, DcrGraphParams>();
    /** The .easy document shown last. */
    private document: string | undefined;
    private panel: vscode.WebviewPanel | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
        this.follow(vscode.window.activeTextEditor);
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => this.follow(editor)),
            vscode.commands.registerCommand('easy.showDcrGraph', () => this.show())
        );
    }

    /** A graph from the language server. */
    update(params: DcrGraphParams): void {
        this.graphs.set(params.uri, params);
        if (params.uri === this.document) {
            this.post();
        }
    }

    /** Opens the panel beside the editor, or brings it forward. */
    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }
        const scripts = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        this.panel = vscode.window.createWebviewPanel('easy.dcrGraph', 'DCR graph', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [scripts] });
        this.panel.webview.html = html(this.panel.webview, scripts);
        this.panel.onDidDispose(() => this.panel = undefined);
        this.panel.webview.onDidReceiveMessage((message: DcrExportMessage) => void this.save(message));
        this.post();
    }

    /** Saves the exported XML as the file the user chooses, named after the document. */
    private async save({ export: xml, format, name }: DcrExportMessage): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const file = `${name.replace(/\.easy$/, '')}${format === 'dcr-js' ? '.dcr-js' : ''}.xml`;
        const target = await vscode.window.showSaveDialog({
            defaultUri: folder ? vscode.Uri.joinPath(folder, file) : vscode.Uri.file(file),
            filters: { [format === 'dcr-js' ? 'dcr-js XML' : 'DCR Solutions XML']: ['xml'] },
            title: `Save the DCR graph as ${format === 'dcr-js' ? 'dcr-js' : 'DCR Solutions'} XML`
        });
        if (target) {
            await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(xml));
        }
    }

    /** Follows the editor shown, when it shows an .easy document. */
    private follow(editor: vscode.TextEditor | undefined): void {
        if (editor?.document.languageId === 'easy' && editor.document.uri.toString() !== this.document) {
            this.document = editor.document.uri.toString();
            this.post();
        }
    }

    /** Sends the panel the graph of the document shown last. */
    private post(): void {
        const params = this.document ? this.graphs.get(this.document) ?? { uri: this.document, outOfDate: 'Waiting for the first check…' } : undefined;
        if (!this.panel || !params) {
            return;
        }
        const name = vscode.workspace.asRelativePath(vscode.Uri.parse(params.uri));
        this.panel.title = `DCR graph: ${name}`;
        void this.panel.webview.postMessage({ ...params, name } satisfies DcrGraphMessage);
    }
}

/** The webview's page: its script and styles (esbuild.mjs), and only them (its content security policy). */
function html(webview: vscode.Webview, scripts: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const file = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(scripts, name)).toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${file('dcr.css')}">
    <title>DCR graph</title>
</head>
<body>
    <div id="graphs"></div>
    <script nonce="${nonce}" src="${file('dcr.js')}"></script>
</body>
</html>`;
}
