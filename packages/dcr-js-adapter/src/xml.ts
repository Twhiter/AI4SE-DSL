// A DCR.js graph (graph.ts) as DCR.js editor XML, laid out much as DSL easy's own DCR graph view lays its graphs out
// (packages/dcr-view/src/graph-view.ts): elkjs places the activities, each nesting's inside it, and routes the
// relations, those from or to the same element together; but close, with no room for the relations' guards and values
// (DCR.js and dcrgraphs.net draw them on the relation, over what is next to it: a long one, as the merged values of the
// DCR Solutions adapter, would spread the graph far), and each part of the graph that relations connect on its own,
// the parts then in rows (layout). A relation from an element to itself (Data's condition) is a small loop over the
// element's top right corner, elkjs's way round the element being far.

import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { DcrJsGraph, Element, Relation } from './graph.ts';

/** An activity's box, as DCR.js draws it; one with observers has a strip for them at the bottom, 30 high. */
const ACTIVITY = { width: 130, height: 150 };
/** How far a loop from an element to itself reaches out of it, and into it, at its top right corner. */
const LOOP = { out: 24, in: 36 };
/** The room around a nesting's elements: its name is below a strip 30 high at its top. */
const PADDING = '[top=60,left=20,bottom=20,right=20]';

export interface Point { x: number, y: number }
export interface Bounds extends Point { width: number, height: number }

export async function toXml(graph: DcrJsGraph): Promise<string> {
    const { bounds, waypoints } = await layout(graph);
    const all = (element: Element): Element[] => [element, ...(element.kind === 'activity' ? [] : element.children.flatMap(all))];

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<dcr:definitions xmlns:dcr="http://tk/schema/dcr" xmlns:dcrDi="http://tk/schema/dcrDi" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">',
        ' <dcr:dcrGraph id="dcrGraph">',
        ...graph.elements.flatMap(element => elementXml(element, '  ')),
        ...graph.relations.map(({ id, type, source, target, guard, value }) =>
            `  <dcr:relation${attributes({ id, type, sourceRef: source, targetRef: target, guard, value })}/>`),
        ' </dcr:dcrGraph>',
        ' <dcrDi:dcrRootBoard id="RootBoard">',
        '  <dcrDi:dcrPlane id="Plane" boardElement="dcrGraph">',
        ...graph.elements.flatMap(all).map(({ id }) =>
            `   <dcrDi:dcrShape id="${id}_di" boardElement="${id}"><dc:Bounds${attributes({ ...bounds.get(id)! })}/></dcrDi:dcrShape>`),
        ...graph.relations.map(({ id }) => `   <dcrDi:relation id="${id}_di" boardElement="${id}">`
            + waypoints.get(id)!.map(({ x, y }) => `<dcrDi:waypoint${attributes({ x, y })}/>`).join('') + '</dcrDi:relation>'),
        '  </dcrDi:dcrPlane>',
        ' </dcrDi:dcrRootBoard>',
        '</dcr:definitions>'
    ].join('\n');
}

/**
 * Where each element is (its bounds, by id) and how each relation goes (its points, by id): elkjs lays out each part of
 * the graph that relations connect, and the parts go in rows, the largest first, the rows about as much wider than
 * high as a screen (elkjs would put every element without relations in one column).
 */
export async function layout(graph: DcrJsGraph): Promise<{ bounds: Map<string, Bounds>, waypoints: Map<string, Point[]> }> {
    const placed = await Promise.all(parts(graph).map(place));
    const width = Math.max(...placed.map(part => part.width),
        Math.sqrt(placed.reduce((area, part) => area + (part.width + GAP) * (part.height + GAP), 0) * ASPECT_RATIO));
    const bounds = new Map<string, Bounds>();
    const waypoints = new Map<string, Point[]>();
    let x = 0, y = 0, row = 0;
    for (const part of placed) {
        if (x > 0 && x + part.width > width) {
            [x, y, row] = [0, y + row + GAP, 0];
        }
        part.bounds.forEach((box, id) => bounds.set(id, { ...box, x: box.x + x, y: box.y + y }));
        part.waypoints.forEach((points, id) => waypoints.set(id, points.map(point => ({ x: point.x + x, y: point.y + y }))));
        [x, row] = [x + part.width + GAP, Math.max(row, part.height)];
    }
    return { bounds, waypoints };
}

/** The room between two parts of a graph, and how much wider than high their rows are about. */
const GAP = 60;
const ASPECT_RATIO = 1.6;

/** The parts of a graph that relations connect (through the elements in its nestings too), the largest first. */
function parts(graph: DcrJsGraph): DcrJsGraph[] {
    const all = (element: Element): Element[] => [element, ...(element.kind === 'activity' ? [] : element.children.flatMap(all))];
    const top = new Map(graph.elements.flatMap((element, i) => all(element).map(({ id }) => [id, i])));
    const parent = graph.elements.map((_, i) => i);
    const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
    graph.relations.forEach(({ source, target }) => parent[root(top.get(source)!)] = root(top.get(target)!));
    const parts = new Map<number, DcrJsGraph>();
    graph.elements.forEach((element, i) => {
        const part = parts.get(root(i)) ?? parts.set(root(i), { elements: [], relations: [] }).get(root(i))!;
        part.elements.push(element);
    });
    graph.relations.forEach(relation => parts.get(root(top.get(relation.source)!))!.relations.push(relation));
    const size = (part: DcrJsGraph) => part.elements.flatMap(all).length;
    return [...parts.values()].sort((a, b) => size(b) - size(a));
}

/** Where elkjs places the elements of a part of a graph and routes its relations, from (0, 0); and its size. */
async function place(graph: DcrJsGraph): Promise<{ bounds: Map<string, Bounds>, waypoints: Map<string, Point[]>, width: number, height: number }> {
    const node = (element: Element): ElkNode => element.kind === 'activity'
        ? { id: element.id, width: ACTIVITY.width, height: ACTIVITY.height + (element.observers.length > 0 ? 30 : 0) }
        : { id: element.id, layoutOptions: { 'elk.padding': PADDING }, children: element.children.map(node) };
    const placed = await new ELK().layout({
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.json.shapeCoords': 'ROOT',
            'elk.json.edgeCoords': 'ROOT',
            'elk.layered.mergeEdges': 'true',
            'elk.layered.spacing.nodeNodeBetweenLayers': '60',
            'elk.spacing.nodeNode': '30',
            'elk.spacing.edgeNode': '10',
            'elk.spacing.edgeEdge': '8'
        },
        children: graph.elements.map(node),
        edges: graph.relations.filter(({ source, target }) => source !== target)
            .map(relation => ({ id: relation.id, sources: [relation.source], targets: [relation.target] }))
    });
    const nodes = (node: ElkNode): ElkNode[] => [node, ...(node.children ?? []).flatMap(nodes)];
    const bounds = new Map<string, Bounds>((placed.children ?? []).flatMap(nodes)
        .map(({ id, x = 0, y = 0, width = 0, height = 0 }) => [id, { x, y, width, height }]));
    const edges = new Map<string, ElkExtendedEdge>((placed.edges ?? []).map(edge => [edge.id, edge]));
    /**
     * Where elkjs routed the relation; from the middle of its source to the middle of its target, should it not have;
     * from an element to itself, a loop over its top right corner.
     */
    const route = ({ id, source, target }: Relation): Point[] => {
        if (source === target) {
            const { x, y, width } = bounds.get(source)!;
            const right = x + width;
            return [{ x: right - LOOP.in, y }, { x: right - LOOP.in, y: y - LOOP.out }, { x: right + LOOP.out, y: y - LOOP.out },
                { x: right + LOOP.out, y: y + LOOP.in }, { x: right, y: y + LOOP.in }];
        }
        const section = edges.get(id)?.sections?.[0];
        const middle = ({ x, y, width, height }: Bounds) => ({ x: x + width / 2, y: y + height / 2 });
        return section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [middle(bounds.get(source)!), middle(bounds.get(target)!)];
    };
    const waypoints = new Map(graph.relations.map(relation => [relation.id, route(relation)]));

    const corners = [...[...bounds.values()].flatMap(({ x, y, width, height }) => [{ x, y }, { x: x + width, y: y + height }]), ...[...waypoints.values()].flat()];
    const [left, top] = [Math.min(...corners.map(({ x }) => x)), Math.min(...corners.map(({ y }) => y))];
    return {
        bounds: new Map([...bounds].map(([id, box]) => [id, { ...box, x: box.x - left, y: box.y - top }])),
        waypoints: new Map([...waypoints].map(([id, points]) => [id, points.map(({ x, y }) => ({ x: x - left, y: y - top }))])),
        width: Math.max(...corners.map(({ x }) => x)) - left,
        height: Math.max(...corners.map(({ y }) => y)) - top
    };
}

function elementXml(element: Element, indent: string): string[] {
    if (element.kind === 'activity') {
        const { id, label, role, observers, included, variable } = element;
        const start = `${indent}<dcr:event${attributes({
            id, label, role: role.join(', ') || undefined, observers: observers.join(', ') || undefined, included, executed: false, pending: false, enabled: false,
            takesInput: variable ? true : undefined
        })}`;
        return [variable ? `${start}><dcr:eventData${attributes({ ...variable })}/></dcr:event>` : `${start}/>`];
    }
    const { id, label, children } = element;
    return [`${indent}<dcr:nesting${attributes({ id, label })}>`, ...children.flatMap(child => elementXml(child, `${indent} `)), `${indent}</dcr:nesting>`];
}

/** id="Event_1" label="print" …, leaving out what is undefined. */
function attributes(values: Record<string, string | number | boolean | undefined>): string {
    return Object.entries(values).filter(([, value]) => value !== undefined)
        .map(([name, value]) => ` ${name}="${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"`)
        .join('');
}
