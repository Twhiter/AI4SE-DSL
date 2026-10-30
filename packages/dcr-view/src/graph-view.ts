// A view of DSL easy's DCR graphs (easy-language's toDcrGraph), for the browser editor (packages/web/src/dcr-pane.ts)
// and VS Code's DCR graph panel (packages/extension/src/webview): each graph is laid out by elkjs and drawn by dcr-js's
// viewer (lib), with pan and zoom; a group of activities (Data) is a box around them, a dcr-js nesting. Its activities
// and relations can be dragged (nothing else changes), and stay where they were dragged when the graph is drawn again,
// until 'Layout'. A graph that comes while the view is hidden is drawn when it is shown. 'Export' saves the graph as it is
// drawn, in dcr-js's own XML or as DCR Solutions XML (lib/DCRXML.js), downloaded as a file unless whoever made the view
// saves it otherwise. A data property's activity has the property's data (dcr:eventData, for an int, a string or a boolean),
// which a guard names, and so has an action's when it has one input or output; an action's `parameters` are all of
// them (both exports name the data as their readers do: lib/DCRXML.js, lib/DcrJsXML.js). Its page styles the toolbar
// (.dcr-toolbar, .dcr-status, buttons) and the canvas (.canvas).

import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import 'diagram-js/assets/diagram-js.css';
import type { DcrEvent, DcrGraph, DcrGroup } from 'easy-language';
import { DraggableViewer } from '../lib/index.js';

/** The size of an event's box, as in dcr-js; one with observers has a strip for them at the bottom, 30 high. */
const EVENT = { width: 130, height: 150 };
const sizeOf = (event: DcrEvent) => ({ width: EVENT.width, height: EVENT.height + (event.observers.length > 0 ? 30 : 0) });
/** The room around a group's activities: its name is drawn below a strip 30 high at its top (a dcr-js nesting). */
const GROUP_PADDING = { top: 60, left: 20, bottom: 20, right: 20 };

interface Point { x: number, y: number }
interface Viewbox { x: number, y: number, width: number, height: number }
interface Canvas {
    zoom(level: 'fit-viewport'): void;
    viewbox(box?: Viewbox): Viewbox;
}
/** The diagram-js elements the pane reads: an event's shape, or a relation's connection. */
interface Element {
    x: number;
    y: number;
    waypoints?: Point[];
    businessObject?: { $type: string, description?: string, type?: string, guard?: string, sourceRef?: { description: string }, targetRef?: { description: string } };
}

/** Where the user dragged the graph to: the events by name, the relations by relationKey. */
export interface DraggedLayout {
    events: Map<string, Point>;
    relations: Map<string, Point[]>;
}

/** include print → scan [Printer.speed > 2] */
function relationKey(relation: string, from: string, to: string, guard: string | undefined): string {
    return `${relation} ${from} → ${to} [${guard ?? ''}]`;
}

/** What a graph view does, for whoever gives it the graphs. */
export interface GraphView {
    /** Draws `graph`, now, or once the view is shown when it is hidden. */
    draw(graph: DcrGraph): void;
    /** Says why there is no newer graph (the graph drawn, if any, stays): 'fix the errors first'. */
    outOfDate(why: string): void;
    /** Call it whenever the view is shown. */
    shown(): void;
    /** The drawn graph as DCR Solutions XML (dcrgraphs.net's format), with the layout as it is drawn; undefined while no graph is drawn. */
    dcrSolutionsXml(): Promise<string | undefined>;
    /** The drawn graph as dcr-js's own XML (what its modeler opens and simulates: lib/DcrJsXML.js), with the layout as it is drawn; undefined while no graph is drawn. */
    dcrJsXml(): Promise<string | undefined>;
}

/** The formats of an export: dcr-js's own XML, or DCR Solutions XML. */
export type ExportFormat = 'dcr-js' | 'dcr-solutions';

/** What whoever makes a graph view can choose. */
export interface GraphViewOptions {
    /** Saves the XML an export button gives; by default, the browser downloads it as dcr-graph.xml (DCR Solutions) or dcr-graph.dcr-js.xml. */
    export?: (xml: string, format: ExportFormat) => void;
}

/** The DCR graph view in `view`. */
export function createGraphView(view: HTMLElement, options: GraphViewOptions = {}): GraphView {
    view.innerHTML = `
        <div class="dcr-toolbar">
            <div class="dcr-status">Waiting for the first check…</div>
            <button class="layout" title="Lay the graph out again, forgetting what was dragged">Layout</button>
            <button class="fit" title="Fit the graph into the view">Fit</button>
            <button class="export-dcr-solutions" title="Save the graph as DCR Solutions XML (dcrgraphs.net)">Export DCR Solutions</button>
            <button class="export-dcr-js" title="Save the graph as dcr-js XML (its modeler opens it)">Export dcr-js</button>
        </div>
        <div class="canvas"></div>`;
    const status = view.querySelector<HTMLElement>('.dcr-status')!;
    const viewer = new DraggableViewer({ container: view.querySelector<HTMLElement>('.canvas')! });
    const canvas = () => viewer.get<Canvas & { resized(): void }>('canvas');
    let shown = false;
    let latest: DcrGraph | undefined;
    /** The graph drawn last; a later one waits until the view is shown. */
    let drawn: DcrGraph | undefined;
    let dragged: DraggedLayout | undefined;
    let importing = false;

    // every drag of an event, a relation or a bend point is a command: remember the whole layout after it
    viewer.get<{ on(event: string, callback: (event: { trigger: string }) => void): void }>('eventBus').on('commandStack.changed', ({ trigger }) => {
        if (!importing && trigger !== 'clear') {
            dragged = layoutOf(viewer.get<{ getAll(): Element[] }>('elementRegistry').getAll());
        }
    });

    const show = async (graph: DcrGraph, fit: boolean) => {
        latest = graph;
        const { xml, unrouted } = await toDcrXml(graph, dragged);
        if (latest !== graph) {
            return;   // a newer graph is on its way
        }
        const viewbox = shown && !fit ? canvas().viewbox() : undefined;
        importing = true;
        try {
            await viewer.importXML(xml);
            // a new relation to or from a dragged event: let dcr-js route it
            const registry = viewer.get<{ get(id: string): unknown }>('elementRegistry');
            const modeling = viewer.get<{ layoutConnection(connection: unknown): void }>('modeling');
            unrouted.forEach(id => modeling.layoutConnection(registry.get(id)));
        } finally {
            importing = false;
        }
        drawn = graph;
        status.textContent = `${count(graph.events.length, 'activity', 'activities')} · ${count(graph.relations.length, 'relation')}`;
        if (viewbox) {
            canvas().viewbox(viewbox);   // keep where the user looks
        } else if (view.querySelector<HTMLElement>('.canvas')!.clientWidth > 0) {
            canvas().zoom('fit-viewport');
            shown = true;
        }
    };

    const dcrSolutionsXml = async (): Promise<string | undefined> => drawn ? (await viewer.saveDCRXML()).xml : undefined;
    const dcrJsXml = async (): Promise<string | undefined> => drawn ? (await viewer.saveDcrJsXML({ format: true })).xml : undefined;
    view.querySelector<HTMLElement>('.fit')!.onclick = () => canvas().zoom('fit-viewport');
    const exporting = (selector: string, format: ExportFormat, xmlOf: () => Promise<string | undefined>) => {
        view.querySelector<HTMLElement>(selector)!.onclick = () => {
            void xmlOf().then(xml => {
                if (xml !== undefined) {
                    (options.export ?? download)(xml, format);
                }
            });
        };
    };
    exporting('.export-dcr-solutions', 'dcr-solutions', dcrSolutionsXml);
    exporting('.export-dcr-js', 'dcr-js', dcrJsXml);
    view.querySelector<HTMLElement>('.layout')!.onclick = () => {
        dragged = undefined;
        if (latest) {
            void show(latest, true);
        }
    };
    return {
        draw: graph => {
            latest = graph;
            if (!view.hidden) {
                void show(graph, false);
            }
        },
        outOfDate: why => {
            status.textContent = drawn ? `Out of date: ${why}` : why;
        },
        shown: () => {
            canvas().resized();   // its size while hidden was none
            if (latest && latest !== drawn) {
                void show(latest, false);
            } else if (!shown && drawn) {
                canvas().zoom('fit-viewport');
                shown = true;
            }
        },
        dcrSolutionsXml,
        dcrJsXml
    };
}

/** Downloads `xml` as dcr-graph.xml (DCR Solutions) or dcr-graph.dcr-js.xml. */
function download(xml: string, format: ExportFormat): void {
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = format === 'dcr-js' ? 'dcr-graph.dcr-js.xml' : 'dcr-graph.xml';
    link.click();
    URL.revokeObjectURL(url);
}

/** Where the events and relations of the drawn graph are. */
function layoutOf(elements: Element[]): DraggedLayout {
    const layout: DraggedLayout = { events: new Map(), relations: new Map() };
    for (const { x, y, waypoints, businessObject: semantic } of elements) {
        if (semantic?.$type === 'dcr:Event' && semantic.description) {
            layout.events.set(semantic.description, { x, y });
        } else if (semantic?.$type === 'dcr:Relation' && semantic.type && semantic.sourceRef && semantic.targetRef && waypoints) {
            layout.relations.set(relationKey(semantic.type, semantic.sourceRef.description, semantic.targetRef.description, semantic.guard || undefined),
                waypoints.map(({ x, y }) => ({ x, y })));
        }
    }
    return layout;
}

/**
 * The graph as dcr-js XML: its activities, groups and relations, and where they are drawn. elkjs places the
 * activities, each group's inside its box, and routes the relations, with room for their guards (a relation from an
 * activity to itself loops over its top). A group's box is drawn around where its activities are. What the user dragged stays where it is: a dragged activity, and a
 * relation between dragged activities (or groups with one) as it was drawn; another relation to or from one is left
 * 'unrouted', for dcr-js to route once it is drawn.
 */
export async function toDcrXml(graph: DcrGraph, dragged?: DraggedLayout): Promise<{ xml: string, unrouted: string[] }> {
    const ids = new Map([
        ...graph.events.map((event, i) => [event.name, `Event_${i + 1}`] as const),
        ...graph.groups.map((group, i) => [group.name, `Nesting_${i + 1}`] as const)
    ]);
    const events = new Map(graph.events.map(event => [event.name, event]));
    const groups = new Map(graph.groups.map(group => [group.name, group]));
    const grouped = new Set(graph.groups.flatMap(group => group.events));
    const relations = graph.relations.map((relation, i) => ({ ...relation, id: `Relation_${i + 1}`, source: ids.get(relation.from)!, target: ids.get(relation.to)! }));
    const node = (event: DcrEvent): ElkNode => ({ id: ids.get(event.name)!, ...sizeOf(event) });
    const layout: ElkNode = await new ELK().layout({
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.json.shapeCoords': 'ROOT',
            'elk.json.edgeCoords': 'ROOT',
            'elk.layered.spacing.nodeNodeBetweenLayers': '120',
            'elk.spacing.nodeNode': '80',
            'elk.spacing.edgeNode': '30',
            'elk.spacing.edgeEdge': '20'
        },
        children: [
            ...graph.groups.map(group => ({
                id: ids.get(group.name)!,
                layoutOptions: { 'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]` },
                children: group.events.map(name => node(events.get(name)!))
            })),
            ...graph.events.filter(event => !grouped.has(event.name)).map(node)
        ],
        edges: relations.map(relation => ({ id: relation.id, sources: [relation.source], targets: [relation.target], labels: guardLabel(relation.guard) }))
    });
    const bounds = new Map([...(layout.children ?? []), ...(layout.children ?? []).flatMap(child => child.children ?? [])]
        .map(node => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
    const routes = new Map((layout.edges ?? []).map(edge => {
        const section = edge.sections?.[0];
        return [edge.id, section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : []];
    }));
    const positionOf = (event: DcrEvent) => dragged?.events.get(event.name) ?? bounds.get(ids.get(event.name)!)!;
    const boxOf = (group: DcrGroup) => {
        const boxes = group.events.map(name => ({ ...positionOf(events.get(name)!), ...sizeOf(events.get(name)!) }));
        const [left, top] = [Math.min(...boxes.map(box => box.x)), Math.min(...boxes.map(box => box.y))];
        const [right, bottom] = [Math.max(...boxes.map(box => box.x + box.width)), Math.max(...boxes.map(box => box.y + box.height))];
        return {
            x: left - GROUP_PADDING.left, y: top - GROUP_PADDING.top,
            width: right - left + GROUP_PADDING.left + GROUP_PADDING.right, height: bottom - top + GROUP_PADDING.top + GROUP_PADDING.bottom
        };
    };
    // an activity the user dragged, or a group with one (its box is drawn around them)
    const moved = (name: string) => dragged !== undefined
        && (dragged.events.has(name) || (groups.get(name)?.events.some(event => dragged.events.has(event)) ?? false));
    const unrouted: string[] = [];
    const pointsOf = (relation: typeof relations[number]): Point[] => {
        const ends = [relation.from, relation.to].filter(moved).length;
        if (ends === 0) {
            return routes.get(relation.id) ?? [];   // both ends where elkjs put them
        }
        const drawn = ends === 2 && dragged?.relations.get(relationKey(relation.relation, relation.from, relation.to, relation.guard));
        if (drawn) {
            return drawn;
        }
        unrouted.push(relation.id);
        return [];
    };

    const eventXml = (event: DcrEvent, indent: string) => {
        const data = dataOf(event);
        const parameters = [...event.inputs, ...event.outputs];
        return `${indent}<dcr:event id="${ids.get(event.name)}" description="${attribute(event.name)}"`
            + ` initiators="${attribute(event.initiators.join(', '))}"`
            + (event.observers.length > 0 ? ` observers="${attribute(event.observers.join(', '))}"` : '')
            + (parameters.length > 0 ? ` parameters="${attribute(parameters.map(({ name, type }) => `${name}:${type}`).join(', '))}"` : '')
            + ` included="${event.defaultIncluded}" executed="false" pending="${event.defaultPending}" enabled="false"`
            + (data ? `>\n${indent} <dcr:eventData name="${attribute(data.name)}" type="${data.type}"/>\n${indent}</dcr:event>` : '/>');
    };
    const shapeXml = (id: string, { x, y, width, height }: { x: number, y: number, width: number, height: number }) =>
        `   <dcrDi:dcrShape id="${id}_di" boardElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}"/></dcrDi:dcrShape>`;
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<dcr:definitions xmlns:dcr="http://tk/schema/dcr" xmlns:dcrDi="http://tk/schema/dcrDi" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">',
        ' <dcr:dcrGraph id="dcrGraph">',
        ...graph.groups.flatMap(group => [
            `  <dcr:nesting id="${ids.get(group.name)}" description="${attribute(group.name)}">`,
            ...group.events.map(name => eventXml(events.get(name)!, '   ')),
            '  </dcr:nesting>'
        ]),
        ...graph.events.filter(event => !grouped.has(event.name)).map(event => eventXml(event, '  ')),
        ...relations.map(relation => `  <dcr:relation id="${relation.id}" type="${relation.relation}" sourceRef="${relation.source}" targetRef="${relation.target}"`
            + (relation.guard ? ` guard="${attribute(relation.guard)}"` : '') + '/>'),
        ' </dcr:dcrGraph>',
        ' <dcrDi:dcrRootBoard id="RootBoard">',
        '  <dcrDi:dcrPlane id="Plane" boardElement="dcrGraph">',
        ...graph.groups.map(group => shapeXml(ids.get(group.name)!, boxOf(group))),
        ...graph.events.map(event => shapeXml(ids.get(event.name)!, { ...positionOf(event), ...sizeOf(event) })),
        ...relations.map(relation => {
            const points = pointsOf(relation);
            return `   <dcrDi:relation id="${relation.id}_di" boardElement="${relation.id}">`
                + points.map(({ x, y }) => `<dcrDi:waypoint x="${x}" y="${y}"/>`).join('') + '</dcrDi:relation>';
        }),
        '  </dcrDi:dcrPlane>',
        ' </dcrDi:dcrRootBoard>',
        '</dcr:definitions>'
    ];
    return { xml: lines.join('\n'), unrouted };
}

/**
 * The data of an activity, which a guard names: a data property's, or the only input or output of an action (an action
 * with several has none: each is written in `parameters`); its type as dcr-js has it: Any, any value, is text (String).
 * None for a list or a queue.
 */
function dataOf(event: DcrEvent): { name: string, type: 'Int' | 'String' | 'Bool' } | undefined {
    const parameters = [...event.inputs, ...event.outputs];
    const { name, type } = event.data ? { name: event.name, type: event.data.type } : parameters.length === 1 ? parameters[0] : { name: event.name, type: undefined };
    switch (type) {
        case 'int': return { name, type: 'Int' };
        case 'string': return { name, type: 'String' };
        case 'boolean': return { name, type: 'Bool' };
        case 'Any': return { name, type: 'String' };
        default: return undefined;
    }
}

/** Room for a guard, drawn on one line per 'and' or 'or' part (packages/dcr-view/lib/draw/DCRRenderer.js). */
function guardLabel(guard: string | undefined): Array<{ text: string, width: number, height: number }> {
    if (!guard) {
        return [];
    }
    const lines = `[${guard}]`.split(/(?<= (?:and|or)) /);
    return [{ text: guard, width: Math.max(...lines.map(line => line.length + 2)) * 6, height: lines.length * 13 + 20 }];
}

function attribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function count(n: number, noun: string, plural = `${noun}s`): string {
    return `${n} ${n === 1 ? noun : plural}`;
}
