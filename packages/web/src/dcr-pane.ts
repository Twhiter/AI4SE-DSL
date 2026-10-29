// The DCR graph view of the editor area (views.ts): the graph toDcrGraph gives after every check (checks.ts), drawn
// by dcr-view's graph view; while the document has errors, it says the graph is out of date.

import { createGraphView } from 'dcr-view/graph-view';
import { onCheckStatus, onDcrGraph } from './checks.js';

/** The DCR graph view in `view`; call what it returns whenever the view is shown. */
export function createDcrView(view: HTMLElement): () => void {
    const graphs = createGraphView(view);
    onDcrGraph(graph => graphs.draw(graph));
    onCheckStatus(({ state }) => {
        if (state === 'not checked') {
            graphs.outOfDate('fix the errors first');
        }
    });
    return () => graphs.shown();
}
