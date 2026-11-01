// The DCR graph view of the editor area (views.ts): the DCR page of legal-dcr-frontend (its COMPONENT.md) showing the
// DCR.js editor XML of every check (checks.ts), where the user looked at the graph before; while the document has
// errors, it says the graph is out of date. Layout lays the graph out again, undoing what the user moved.

import { mountDcrPage } from 'dcr-page/dcr-page.js';
import 'dcr-page/dcr-page.css';
import { onCheckStatus, onDcrXml } from './checks.js';

/** What the DCR page does not offer here, as the graph comes from the document. */
const HIDDEN_OPTIONS = ['newDiagram', 'open', 'examples', 'simulation', 'layout'] as const;

/** The DCR graph view in `view`; call what it returns whenever the view is shown. */
export function createDcrView(view: HTMLElement): () => void {
    view.innerHTML = `
        <div class="dcr-toolbar">
            <div class="dcr-status">Waiting for the first check…</div>
            <button class="layout" title="Lay the graph out again, undoing what was moved">Layout</button>
            <button class="fit" title="Fit the graph into the view">Fit</button>
        </div>
        <div class="canvas"></div>`;
    const status = view.querySelector<HTMLElement>('.dcr-status')!;
    const page = mountDcrPage(view.querySelector<HTMLElement>('.canvas')!, { hiddenOptions: HIDDEN_OPTIONS });
    keepKeys(view);
    /** The XML shown last. */
    let shown: string | undefined;

    const show = (xml: string) => {
        shown = xml;
        page.show(xml, 'DCR graph').then(
            () => status.textContent = `${count(xml, '<dcr:event ', 'activity', 'activities')} · ${count(xml, '<dcr:relation ', 'relation')}`,
            (error: unknown) => status.textContent = `Cannot show the graph: ${error instanceof Error ? error.message : String(error)}`
        );
    };
    onDcrXml(xml => {
        if (xml !== shown) {   // the same graph again would undo what the user moved
            show(xml);
        }
    });
    onCheckStatus(({ state }) => {
        if (state === 'not checked') {
            status.textContent = shown ? 'Out of date: fix the errors first' : 'fix the errors first';
        }
    });
    view.querySelector<HTMLElement>('.layout')!.onclick = () => shown && show(shown);
    view.querySelector<HTMLElement>('.fit')!.onclick = () => page.fit();
    return () => page.resized();
}

/**
 * The DCR page's modeler (diagram-js) takes its keys on the window: Backspace and Delete, Space, s, l, h, e, the arrows,
 * and with Cmd: a, f, z, y, c, v, +, -, 0. It leaves alone the keys typed in an input it can see, but not one inside a
 * shadow DOM (the chat's), nor one typed with nothing focused, wherever the user is. So a key goes on to the window
 * only while the user works in `view`: typed in it, or with nothing focused while it shows and was clicked last.
 */
function keepKeys(view: HTMLElement): void {
    let clickedLast = false;
    document.addEventListener('pointerdown', event => clickedLast = event.composedPath().includes(view), true);
    const inView = (event: KeyboardEvent) => event.composedPath().includes(view)
        || (event.target === document.body && clickedLast && view.checkVisibility());
    for (const type of ['keydown', 'keyup'] as const) {
        document.addEventListener(type, event => {
            if (!inView(event)) {
                event.stopPropagation();
            }
        });
    }
}

function count(xml: string, tag: string, noun: string, plural = `${noun}s`): string {
    const n = xml.split(tag).length - 1;
    return `${n} ${n === 1 ? noun : plural}`;
}
