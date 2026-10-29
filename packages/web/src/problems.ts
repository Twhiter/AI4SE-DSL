// The Problems panel below the editor, like VS Code's: every marker of the document (the language's errors and the
// Z3 checks) with its position, most severe first; clicking one moves the cursor there. Its top edge can be dragged.

import * as monaco from 'monaco-editor';
import { onCheckStatus } from './checks.js';

const ICONS: Record<number, string> = {
    [monaco.MarkerSeverity.Error]: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6" stroke="currentColor" stroke-width="1.2"/></svg>',
    [monaco.MarkerSeverity.Warning]: '<svg viewBox="0 0 16 16"><path d="M8 2l6.3 11.5H1.7z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6.3v3.6M8 11.2v1.1" stroke="currentColor" stroke-width="1.2"/></svg>',
    [monaco.MarkerSeverity.Info]: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 7v4.5M8 4.6v1.1" stroke="currentColor" stroke-width="1.2"/></svg>'
};
const SEVERITY_CLASS: Record<number, string> = {
    [monaco.MarkerSeverity.Error]: 'error', [monaco.MarkerSeverity.Warning]: 'warning', [monaco.MarkerSeverity.Info]: 'info', [monaco.MarkerSeverity.Hint]: 'info'
};

export function createProblemsPanel(panel: HTMLElement, editor: monaco.editor.IStandaloneCodeEditor): void {
    panel.innerHTML = `
        <div class="sash"></div>
        <div class="panel-header">
            <div class="panel-tab">Problems <span class="badge">0</span></div>
            <div class="check-status"></div>
        </div>
        <div class="panel-body"></div>`;
    const badge = panel.querySelector<HTMLElement>('.badge')!;
    const status = panel.querySelector<HTMLElement>('.check-status')!;
    const body = panel.querySelector<HTMLElement>('.panel-body')!;
    let collapsed = false;

    const render = () => {
        const model = editor.getModel();
        const markers = model ? monaco.editor.getModelMarkers({ resource: model.uri }).sort(bySeverityThenPosition) : [];
        badge.textContent = String(markers.length);
        if (!model || markers.length === 0) {
            body.replaceChildren(element('div', 'empty', 'No problems have been detected in the workspace.'));
            return;
        }
        const file = element('div', `file${collapsed ? ' collapsed' : ''}`);
        file.append(element('span', 'chevron', collapsed ? '›' : '⌄'), element('span', 'file-name', model.uri.path.split('/').pop() ?? ''),
            element('span', 'badge', String(markers.length)));
        file.onclick = () => {
            collapsed = !collapsed;
            render();
        };
        body.replaceChildren(file, ...(collapsed ? [] : markers.flatMap(marker => problemRows(marker, editor))));
    };

    monaco.editor.onDidChangeMarkers(uris => {
        const model = editor.getModel();
        if (model && uris.some(uri => uri.toString() === model.uri.toString())) {
            render();
        }
    });
    onCheckStatus(({ state, text }) => {
        status.dataset.state = state;
        status.textContent = text;
    });
    makeResizable(panel, panel.querySelector<HTMLElement>('.sash')!);
    render();
}

/** A problem: icon, message, source and position; then a row for each specification it names. */
function problemRows(marker: monaco.editor.IMarker, editor: monaco.editor.IStandaloneCodeEditor): HTMLElement[] {
    const row = element('div', `problem ${SEVERITY_CLASS[marker.severity]}`);
    const icon = element('span', 'icon');
    icon.innerHTML = ICONS[marker.severity] ?? ICONS[monaco.MarkerSeverity.Info];
    row.append(icon, element('span', 'message', marker.message), element('span', 'detail', `${marker.source ?? ''}  [Ln ${marker.startLineNumber}, Col ${marker.startColumn}]`));
    row.onclick = () => reveal(editor, marker.startLineNumber, marker.startColumn);
    const related = (marker.relatedInformation ?? []).map(information => {
        const link = element('div', 'related');
        link.append(element('span', 'message', information.message), element('span', 'detail', `[Ln ${information.startLineNumber}, Col ${information.startColumn}]`));
        link.onclick = () => reveal(editor, information.startLineNumber, information.startColumn);
        return link;
    });
    return [row, ...related];
}

function reveal(editor: monaco.editor.IStandaloneCodeEditor, lineNumber: number, column: number): void {
    editor.setPosition({ lineNumber, column });
    editor.revealLineInCenterIfOutsideViewport(lineNumber);
    editor.focus();
}

function bySeverityThenPosition(a: monaco.editor.IMarker, b: monaco.editor.IMarker): number {
    return b.severity - a.severity || a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn;
}

/** Dragging the sash on the top edge changes the panel's height (the editor lays itself out again). */
function makeResizable(panel: HTMLElement, sash: HTMLElement): void {
    sash.addEventListener('pointerdown', down => {
        sash.setPointerCapture(down.pointerId);
        sash.classList.add('active');
        const startHeight = panel.offsetHeight;
        const move = (event: PointerEvent) => {
            panel.style.height = `${Math.min(Math.max(startHeight + down.clientY - event.clientY, 60), window.innerHeight - 100)}px`;
        };
        sash.addEventListener('pointermove', move);
        sash.addEventListener('pointerup', () => {
            sash.removeEventListener('pointermove', move);
            sash.classList.remove('active');
        }, { once: true });
    });
}

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}
