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

function count(xml: string, tag: string, noun: string, plural = `${noun}s`): string {
    const n = xml.split(tag).length - 1;
    return `${n} ${n === 1 ? noun : plural}`;
}
