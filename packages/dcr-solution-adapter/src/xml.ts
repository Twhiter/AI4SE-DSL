// A DCR Solutions graph (graph.ts) as dcrgraphs.net exports one (the root's 'dcr solution examples'): each event where
// it is (place; dcrgraphs.net sizes it), with its roles, read roles, value and label; the relations, with their guards
// and an update's value (DCR update.xml); and how each event starts, a data property's with no value: null (DCR
// null.xml), as a property has none until it is set.

import { layout, type Element, type Point, type Relation } from 'easy-dcr-js-adapter';
import type { DcrSolutionGraph, SolutionEvent, SolutionRelation } from './graph.ts';

/** How an event starts. */
export interface Marking {
    included: boolean;
    executed: boolean;
    pending: boolean;
}

/** The relations of each type, in the order dcrgraphs.net writes them: conditions, of condition elements, … */
const CONSTRAINTS = ['conditions', 'responses', 'coresponses', 'includes', 'excludes', 'milestones', 'spawns', 'templateSpawns', 'updates'];

const FORM = { type: 'form', cancelText: '', sendText: '', hideCancel: false, formShowInitialPhase: 1 };
const COLORS = { bg: '#f9f7ed', textStroke: '#000000', stroke: '#cccccc' };

/** A data property's event, as dcrgraphs.net draws it; the room between two of them, and below Data, over the actions. */
const DATA = { width: 130, height: 150 };
const DATA_GAP = 30;
const BELOW_DATA = 150;
/** Where the events in a nesting begin, and the room below them, as dcrgraphs.net places them (DCR test2.xml). */
const NESTING = { left: 30, top: 50, bottom: 30 };

/**
 * The XML of `graph`, its events starting as `marking` says (what it leaves out: false), but those in a form: those
 * start included.
 */
export async function toXml(graph: DcrSolutionGraph, title: string, marking: (event: SolutionEvent) => Partial<Marking>): Promise<string> {
    const places = await place(graph);

    /** Each event, with how it starts. */
    const all = (event: SolutionEvent, inForm: boolean): Array<[SolutionEvent, Marking]> => [
        [event, { included: false, executed: false, pending: false, ...(inForm ? { included: true } : marking(event)) }],
        ...event.children.flatMap(child => all(child, inForm || event.type === 'form'))
    ];
    const events = graph.events.flatMap(event => all(event, false));
    const marked = (state: keyof Marking) => events.filter(([, marking]) => marking[state]).flatMap(([{ id }]) => tag('event', { id }));
    const roles = (name: string, roles: string[]) => tag(`${name}s`, {}, roles.flatMap(role => tag(name, { description: '', specification: '' }, role)));
    /** The ids of a relation's guard and value, as dcrgraphs.net gives them: print-path-speed--update(--value). */
    const guardId = ({ type, source, target, guard }: SolutionRelation) => guard === undefined ? undefined : `${source}-path-${target}--${type}`;
    const valueId = (relation: SolutionRelation) => relation.value === undefined ? undefined : `${relation.source}-path-${relation.target}--${relation.type}--value`;

    let sequence = 0;
    const eventXml = (event: SolutionEvent): string[] => {
        const n = ++sequence;
        const { x, y } = places.get(event.id)!;
        return tag('event', { id: event.id, ...(event.type === 'form' ? FORM : { type: event.type }) }, [
            ...tag('precondition', { message: '' }),
            ...tag('custom', {}, [
                ...tag('visualization', {}, [...tag('location', { xLoc: Math.round(x), yLoc: Math.round(y) }), ...tag('colors', COLORS)]),
                ...roles('role', event.roles),
                ...roles('readRole', event.readRoles),
                ...tag('groups', {}, tag('group')),
                ...tag('phases', {}, tag('phase')),
                ...tag('eventType'),
                ...tag('eventScope', {}, 'private'),
                ...tag('eventTypeData'),
                ...tag('eventDescription'),
                ...tag('purpose'),
                ...tag('guide'),
                ...tag('insight', { use: false }),
                ...tag('level', {}, '100'),
                ...tag('sequence', {}, String(n)),
                ...tag('costs', {}, '0'),
                ...tag('eventData', {}, [...dataXml(event.dataType, n), ...tag('styles')]),
                ...tag('interfaces')
            ]),
            ...event.children.flatMap(eventXml)
        ]);
    };

    return tag('dcrgraph', {
        title, dataTypesStatus: 'hide', filterLevel: -1, insightFilter: false, zoomLevel: 0, formGroupStyle: 'Normal', formLayoutStyle: 'Horizontal',
        formShowPendingCount: true, graphBG: '#f1f6fe', graphType: 0, exercise: false, version: '1.1'
    }, [
        ...tag('specification', {}, [
            ...tag('resources', {}, [
                ...tag('events', {}, graph.events.flatMap(eventXml)),
                ...tag('subProcesses'),
                ...tag('labels', {}, [...new Set(events.map(([{ label }]) => label))].flatMap(label => tag('label', { id: label }))),
                ...tag('labelMappings', {}, events.flatMap(([{ id, label }]) => tag('labelMapping', { eventId: id, labelId: label }))),
                ...tag('expressions', {}, graph.relations.flatMap(relation => [[guardId(relation), relation.guard], [valueId(relation), relation.value]]
                    .flatMap(([id, value]) => id === undefined ? [] : tag('expression', { id, value })))),
                ...tag('variables'),
                ...tag('variableAccesses', {}, tag('writeAccesses')),
                ...tag('custom', {}, [
                    ...tag('keywords'),
                    ...roles('role', [...new Set(events.flatMap(([event]) => [...event.roles, ...event.readRoles]))]),
                    ...['groups', 'phases', 'eventTypes', 'eventParameters'].flatMap(name => tag(name)),
                    ...tag('graphDetails', {}, 'DCR Process'),
                    ...tag('graphDocumentation'),
                    ...tag('graphLanguage', {}, 'en-US'),
                    ...tag('graphDomain', {}, 'process'),
                    ...tag('graphFilters', {}, ['filteredGroups', 'filteredRoles', 'filteredPhases'].flatMap(name => tag(name))),
                    ...tag('highlighterMarkup', {}, [...tag('highlightLayers'), ...tag('highlights')])
                ])
            ]),
            ...tag('constraints', {}, CONSTRAINTS.flatMap(group => tag(group, {}, graph.relations.filter(({ type }) => `${type}s` === group)
                .flatMap(relation => tag(relation.type, {
                    sourceId: relation.source, targetId: relation.target, filterLevel: 100, description: '', time: '', groups: '',
                    expressionId: guardId(relation), valueExpressionId: valueId(relation)
                })))))
        ]),
        ...tag('runtime', { accepting: false }, [
            ...tag('custom', {}, tag('globalMarking', {}, ['enabled', 'enabledSubprocesses', 'executed', 'pending', 'included'].flatMap(name => tag(name)))),
            ...tag('marking', {}, [
                ...tag('globalStore', {}, events.filter(([{ kind, dataType }]) => kind === 'data' && dataType !== undefined)
                    .flatMap(([{ id }]) => tag('variable', { id, value: 'null', isNull: false, type: 'expr' }))),
                ...tag('executed', {}, marked('executed')),
                ...tag('included', {}, marked('included')),
                ...tag('pendingResponses', {}, marked('pending'))
            ])
        ])
    ]).join('\n');
}

/**
 * Where each event is (its top left corner): Data above the actions, its data properties' a row for each entity's (as
 * many in a row as the actions are wide, at least four); the actions' as the DCR.js adapter lays out a graph, with the
 * relations between them only, so that those from Data and to the data properties do not pull them apart.
 */
async function place(graph: DcrSolutionGraph): Promise<Map<string, Point>> {
    const element = (event: SolutionEvent): Element => event.type
        ? { kind: 'nesting', id: event.id, label: event.label, children: event.children.map(element) }
        : { kind: 'activity', id: event.id, label: event.label, role: event.roles, observers: event.readRoles, included: true };
    const ids = (event: SolutionEvent): string[] => [event.id, ...event.children.flatMap(ids)];
    const data = graph.events.find(({ kind }) => kind === 'data');
    const actions = graph.events.filter(({ kind }) => kind !== 'data');
    const inActions = new Set(actions.flatMap(ids));
    const { bounds } = await layout({
        elements: actions.map(element),
        relations: graph.relations.filter(({ source, target }) => inActions.has(source) && inActions.has(target))
            .map(({ type, source, target, guard, value }, i): Relation =>
                ({ id: `relation ${i + 1}`, type: type === 'update' ? 'setValue' : type, source, target, guard, value }))
    });

    const width = Math.max(0, ...[...bounds.values()].map(({ x, width }) => x + width));
    const perRow = Math.max(4, Math.floor((width - NESTING.left + DATA_GAP) / (DATA.width + DATA_GAP)));
    const entities = new Map<string, SolutionEvent[]>();
    data?.children.forEach(event => entities.set(event.roles[0], [...entities.get(event.roles[0]) ?? [], event]));
    const rows = [...entities.values()].flatMap(events =>
        Array.from({ length: Math.ceil(events.length / perRow) }, (_, i) => events.slice(i * perRow, (i + 1) * perRow)));
    const places = new Map<string, Point>(data ? [[data.id, { x: 0, y: 0 }]] : []);
    rows.forEach((row, r) => row.forEach((event, c) =>
        places.set(event.id, { x: NESTING.left + c * (DATA.width + DATA_GAP), y: NESTING.top + r * (DATA.height + DATA_GAP) })));
    const top = data ? NESTING.top + rows.length * (DATA.height + DATA_GAP) - DATA_GAP + NESTING.bottom + BELOW_DATA : 0;
    bounds.forEach(({ x, y }, id) => places.set(id, { x, y: y + top }));
    return places;
}

/** How dcrgraphs.net says the type of an event's value (int, text, or a choice of true or false), with no rules for it. */
function dataXml(type: SolutionEvent['dataType'], sequence: number): string[] {
    if (type === undefined) {
        return [];
    }
    const dataType = type === 'Bool'
        ? [
            ...tag('dataType', { sequence, width: 'small', placeholder: '', hinttext: '', dataSetList: '', radio: 'horizontal', multiple: false, format: 'bool' }, 'choice'),
            ...tag('dictionary', {}, [...tag('item', { label: 'True', value: true }), ...tag('item', { label: 'False', value: false })])
        ]
        : tag('dataType', { sequence, width: 'small', min: 'NaN', max: 'NaN', placeholder: '', hinttext: '' }, type === 'Int' ? 'int' : 'text');
    return [...dataType, ...tag('validationRules')];
}

/**
 * <name a="…">text</name>, <name a="…"> with its children's lines, each indented, </name>, or <name a="…"/> without
 * either; leaving out the attributes that are undefined.
 */
function tag(name: string, attributes: Record<string, string | number | boolean | undefined> = {}, content: string | string[] = []): string[] {
    const start = `<${name}${Object.entries(attributes).filter(([, value]) => value !== undefined).map(([key, value]) => ` ${key}="${escape(String(value))}"`).join('')}`;
    if (typeof content === 'string') {
        return [`${start}>${escape(content)}</${name}>`];
    }
    return content.length === 0 ? [`${start}/>`] : [`${start}>`, ...content.map(line => `    ${line}`), `</${name}>`];
}

function escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
