// A DSL easy model (easy-language's buildModel) as a DCR Solutions graph, before it is laid out and written (xml.ts):
// the DCR.js adapter's graph (easy-dcr-js-adapter's toDcrJsGraph), as dcrgraphs.net says it:
//   a data property                         an event in the nesting Data, initiated by its entity, with a value of its
//                                           type (Any: text)
//   an action                               an event with its initiators (roles) and observers (read roles); with one
//                                           input and no output, with a value of the input's type
//   an action with more inputs, no output   a form with its initiators and observers, holding an event per input
//   an action with outputs                  a form with its initiators and observers, holding a nesting Input (an
//                                           event per input) and Output (an event per output)
//   (an event in a form has no roles or read roles: the form's are its)
// Expressions name an event by its id: a data property's, input's or output's is its variable's name (speed, or
// Printer_speed when two have the same); an action's or a form's is its name; a nesting's in a form the form's with
// _input or _output after it; each with a number after it should another event have it already.
// The relations are the DCR.js graph's (the Givens' conditions from Data), their guards and values as they are, with
// 'is undefined' too, as DCR Solutions has null (DCR null.xml): label = null ('is not undefined': label != null); but
// with strings in single quotes, as dcrgraphs.net writes them ('eco'), and
//   setValue a → p, value v, guarded by w       an update a → p, guarded by w, with value v
//   the same relation, guarded differently      one, its guards joined with or: DCR Solutions has one of each type from
//                                               an event to another; an update's value then `if w₁ then v₁ else …`,
//                                               the guarded values first, then the one without a guard, should there be
//                                               one (its update has no guard), else the last guarded one
// ('dcr solution examples' at the root: DCR update.xml, an update with a guard and a value).

import { identifier, INPUT, toDcrJsGraph, type Activity, type Box, type Element, type Variable } from 'easy-dcr-js-adapter';
import type { EasyModel } from 'easy-language';

/** An event: an activity, or a form or a nesting, holding events. */
export interface SolutionEvent {
    id: string;
    label: string;
    type?: 'form' | 'nesting';
    /**
     * What it stands for: a data property (or Data, the nesting of them), an action, or a part of an action's form (an
     * input, an output, or a nesting of them).
     */
    kind: 'data' | 'action' | 'part';
    /** Its initiators. */
    roles: string[];
    /** Its observers. */
    readRoles: string[];
    /** The type of its value, should it have one. */
    dataType?: Variable['type'];
    children: SolutionEvent[];
}

/** A relation from an event to another, by their ids. */
export interface SolutionRelation {
    type: 'condition' | 'milestone' | 'response' | 'include' | 'exclude' | 'update';
    source: string;
    target: string;
    /** When it holds; always, when there is none. Like `value`, an expression of DCR Solutions, naming events by their ids. */
    guard?: string;
    /** An update's: what it sets its target's value to. */
    value?: string;
}

export interface DcrSolutionGraph {
    events: SolutionEvent[];
    relations: SolutionRelation[];
}

export function toDcrSolutionGraph(model: EasyModel.Model): DcrSolutionGraph {
    const graph = toDcrJsGraph(model, { noValue: 'null' });
    const first = graph.elements.length - model.actions.length;   // the actions' elements come after Data's
    const activities = (element: Element): Activity[] => element.kind === 'activity' ? [element] : element.children.flatMap(activities);
    const used = new Set(graph.elements.flatMap(activities).flatMap(({ variable }) => variable ? [variable.name] : []));
    /** `name`, or with a number after it should another event have it. */
    const unique = (name: string) => {
        let id = name;
        for (let n = 2; used.has(id); n++) {
            id = `${name}_${n}`;
        }
        used.add(id);
        return id;
    };
    /** The id of each element's event, by the element's id. */
    const ids = new Map<string, string>();
    const event = (activity: Activity, kind: SolutionEvent['kind'], roles: string[], readRoles: string[]): SolutionEvent => {
        const id = activity.variable?.name ?? unique(identifier(activity.label));
        ids.set(activity.id, id);
        return { id, label: activity.label, kind, roles, readRoles, dataType: activity.variable?.type, children: [] };
    };

    const data = graph.elements.slice(0, first).map((nesting): SolutionEvent => {   // Data, should there be data properties
        const id = unique(identifier(nesting.label));
        ids.set(nesting.id, id);
        return {
            id, label: nesting.label, type: 'nesting', kind: 'data', roles: [], readRoles: [],
            children: activities(nesting).map(activity => event(activity, 'data', activity.role, []))
        };
    });
    const actions = graph.elements.slice(first).map((element, i): SolutionEvent => {
        const action = model.actions[i];
        if (element.kind === 'activity') {
            return event(element, 'action', element.role, element.observers);
        }
        const id = unique(identifier(action));
        ids.set(element.id, id);
        const parts = element.children.filter((child): child is Box => child.kind === 'nesting');
        const inside = (part: Box) => part.children.flatMap(activities).map(activity => event(activity, 'part', [], []));
        const children = parts.length === 1 && parts[0].label === INPUT
            ? inside(parts[0])   // only inputs: in the form itself
            : parts.map((part): SolutionEvent => ({
                id: unique(`${id}_${part.label.toLowerCase()}`), label: part.label, type: 'nesting', kind: 'part', roles: [], readRoles: [],
                children: inside(part)
            }));
        return { id, label: action, type: 'form', kind: 'action', roles: model.initiators[action] ?? [], readRoles: model.observers[action] ?? [], children };
    });

    /** The relations of each type from an event to another, each guard (and an update's value) as the DCR.js graph's. */
    const merged = new Map<string, { type: SolutionRelation['type'], source: string, target: string, parts: Part[] }>();
    const relation = (type: SolutionRelation['type'], source: string, target: string) => {
        const key = `${type} ${source} ${target}`;
        if (!merged.has(key)) {
            merged.set(key, { type, source, target, parts: [] });
        }
        return merged.get(key)!;
    };
    for (const { type, source, target, guard, value } of graph.relations) {
        if (type === 'setValue') {
            relation('update', ids.get(source)!, ids.get(target)!).parts.push({ guard, value });
        } else {
            relation(type, ids.get(source)!, ids.get(target)!).parts.push({ guard });
        }
    }

    return {
        events: [...data, ...actions],
        relations: [...merged.values()].map(({ type, source, target, parts }) => ({
            type, source, target, guard: singleQuoted(guardOf(parts)), value: type === 'update' ? singleQuoted(valueOf(parts)) : undefined
        }))
    };
}

/** A relation of the DCR.js graph: its guard, and a setValue's value. */
interface Part {
    guard?: string;
    value?: string;
}

/** The guard of the same relation from several: none when one of them has none; else theirs joined with or. */
function guardOf(parts: Part[]): string | undefined {
    if (parts.some(({ guard }) => guard === undefined)) {
        return undefined;
    }
    const unique = [...new Set(parts.map(({ guard }) => guard!))];
    return unique.length === 1 ? unique[0] : unique.map(guard => `(${guard})`).join(' or ');
}

/**
 * The value of an update for several setValues from its source to its target, guarded by guardOf: the guarded first,
 * in their order, each `if guard then value else …`, then the value of one without a guard (and the update has no
 * guard), else the last guarded one's (as the update's guard says one of them holds):
 *   if copies = 1 then 10 else if copies = 100 then 1 else copies
 */
function valueOf(parts: Part[]): string {
    const guarded = parts.filter(({ guard }) => guard !== undefined);
    const otherwise = parts.find(({ guard }) => guard === undefined) ?? guarded.pop()!;
    return guarded.reduceRight((rest, { guard, value }) => `if ${guard} then ${value} else ${rest}`, otherwise.value!);
}

/** An expression with its strings (as DCR.js writes them: "eco") in single quotes, as dcrgraphs.net writes them: 'eco'. */
function singleQuoted(expression: string | undefined): string | undefined {
    return expression?.replace(/"([^"']*)"/g, `'$1'`);
}
