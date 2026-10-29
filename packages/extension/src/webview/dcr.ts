// The DCR graph panel's page (src/extension/dcr-panel.ts): a graph view (dcr-view's) for each document the panel has
// shown, the one of the document shown last in front; the others stay hidden, with what was dragged in them. Its
// styles are dcr.css, beside it.

import { createGraphView, type GraphView } from 'dcr-view/graph-view';
import type { DcrGraphMessage } from '../protocol.js';
import './dcr.css';

const graphs = document.getElementById('graphs')!;
const views = new Map<string, { element: HTMLElement, view: GraphView }>();
let front: { element: HTMLElement, view: GraphView } | undefined;

window.addEventListener('message', ({ data }: MessageEvent<DcrGraphMessage>) => {
    let shown = views.get(data.uri);
    if (!shown) {
        const element = document.createElement('div');
        element.className = 'graph';
        graphs.append(element);
        shown = { element, view: createGraphView(element) };
        views.set(data.uri, shown);
    }
    if (front !== shown) {
        views.forEach(({ element }) => element.hidden = element !== shown.element);
        front = shown;
        shown.view.shown();
    }
    if ('graph' in data) {
        shown.view.draw(data.graph);
    } else {
        shown.view.outOfDate(data.outOfDate);
    }
});
