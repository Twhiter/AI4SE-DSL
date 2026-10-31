// toDcrSolutionXml on DSL easy documents, its XML read back: what each part of a document becomes, and that it is
// written as dcrgraphs.net exports a graph (the root's 'dcr solution examples').

import { readFileSync, readdirSync } from 'node:fs';
import { buildModel, createEasyServices } from 'easy-language';
import { EmptyFileSystem, URI } from 'langium';
// @ts-expect-error: saxen has no types
import { Parser } from 'saxen';
import { describe, expect, it } from 'vitest';
import { toDcrSolutionXml, type Options, type SolutionEvent } from './index.ts';

const { shared } = createEasyServices(EmptyFileSystem);
let documents = 0;

/** A document's model, or its errors; the document leaves the workspace again, so that another one cannot link to its names. */
async function build(text: string) {
    const { LangiumDocumentFactory, LangiumDocuments, DocumentBuilder } = shared.workspace;
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`file:///document-${++documents}.easy`));
    LangiumDocuments.addDocument(document);
    try {
        await DocumentBuilder.build([document], { validation: true });
        return buildModel(document);
    } finally {
        await DocumentBuilder.update([], [document.uri]);
    }
}

/** An XML element. */
interface Node {
    name: string;
    attributes: Record<string, string>;
    children: Node[];
    text: string;
}

function parse(xml: string): Node {
    const root: Node = { name: '', attributes: {}, children: [], text: '' };
    const open = [root];
    const parser = new Parser();
    parser.on('openTag', (name: string, attributes: () => Record<string, string>, decode: (text: string) => string) => {
        const node: Node = {
            name, attributes: Object.fromEntries(Object.entries(attributes()).map(([key, value]) => [key, decode(value)])), children: [], text: ''
        };
        open.at(-1)!.children.push(node);
        open.push(node);
    });
    parser.on('closeTag', (name: string) => {   // also for <name/>

        expect(open.pop()!.name).toBe(name);
    });
    parser.on('text', (text: string, decode: (text: string) => string) => {
        open.at(-1)!.text += decode(text);
    });
    parser.on('error', (error: Error) => {
        throw error;
    });
    parser.parse(xml);
    expect(open).toHaveLength(1);
    return root.children[0];
}

/** The element at `path` below `node`, each step the first child of that name. */
function find(node: Node, ...path: string[]): Node {
    return path.reduce((at, name) => {
        const child = at.children.find(child => child.name === name);
        expect(child, `${at.name} > ${name}`).toBeDefined();
        return child!;
    }, node);
}

/** An event and the events in it. */
const events = (event: Node): Node[] => [event, ...event.children.filter(({ name }) => name === 'event').flatMap(events)];

/** The words of DCR Solutions' expressions that do not name an event. */
const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'then', 'else', 'true', 'false', 'null']);

/**
 * The XML of a document, read back, each event with a place, a label and a unique id, every relation from an event to
 * another, and every expression naming events only; its events outlined (outline) and its relations written out
 * (condition speed → print [speed > 2], update print → speed [copies = 1] := 10).
 */
async function dcrSolution(text: string, options?: Options) {
    const result = await build(text);
    expect(result.errors?.map(({ message }) => message) ?? []).toEqual([]);
    const xml = await toDcrSolutionXml(result.model!, options);
    const root = parse(xml);
    const resources = find(root, 'specification', 'resources');
    const all = find(resources, 'events').children.flatMap(events);
    const ids = all.map(({ attributes }) => attributes.id);
    expect(new Set(ids).size).toBe(ids.length);
    all.forEach(event => expect(Object.keys(find(event, 'custom', 'visualization', 'location').attributes)).toEqual(['xLoc', 'yLoc']));

    const labels = new Map(find(resources, 'labelMappings').children.map(({ attributes }) => [attributes.eventId, attributes.labelId]));
    expect([...labels.keys()]).toEqual(ids);
    expect(find(resources, 'labels').children.map(({ attributes }) => attributes.id)).toEqual([...new Set(labels.values())]);
    const expressions = new Map(find(resources, 'expressions').children.map(({ attributes }) => [attributes.id, attributes.value]));
    for (const expression of expressions.values()) {
        const words = expression.replace(/'[^']*'/g, '').match(/[A-Za-z_]\w*/g) ?? [];
        expect(words.filter(word => !KEYWORDS.has(word) && !ids.includes(word)), expression).toEqual([]);
    }

    const marking = find(root, 'runtime', 'marking');
    const [included, executed, pending] = ['included', 'executed', 'pendingResponses']
        .map(name => new Set(find(marking, name).children.map(({ attributes }) => attributes.id)));
    const outline = (event: Node): string | Record<string, unknown[]> => {
        const { id, type } = event.attributes;
        const [roles, readRoles] = ['roles', 'readRoles'].map(name => find(event, 'custom', name).children.map(({ text }) => text));
        const dataType = find(event, 'custom', 'eventData').children.find(({ name }) => name === 'dataType');
        const name = `${type ? `${type} ` : ''}${id} "${labels.get(id)}"`
            + (roles.length + readRoles.length > 0 ? ` [${roles.join(', ')}${readRoles.length > 0 ? `; observers ${readRoles.join(', ')}` : ''}]` : '')
            + (dataType ? `: ${dataType.attributes.format ?? dataType.text}` : '')
            + `${included.has(id) ? '' : ' excluded'}${executed.has(id) ? ' executed' : ''}${pending.has(id) ? ' pending' : ''}`;
        const inside = event.children.filter(child => child.name === 'event');
        return type ? { [name]: inside.map(outline) } : name;
    };
    const relations = find(root, 'specification', 'constraints').children.flatMap(({ children }) => children).map(({ name, attributes }) => {
        expect(ids).toContain(attributes.sourceId);
        expect(ids).toContain(attributes.targetId);
        const { expressionId: guard, valueExpressionId: value } = attributes;
        return `${name} ${attributes.sourceId} → ${attributes.targetId}`
            + `${guard === undefined ? '' : ` [${expressions.get(guard)}]`}${value === undefined ? '' : ` := ${expressions.get(value)}`}`;
    });
    const locations = new Map(all.map(event => {
        const { xLoc, yLoc } = find(event, 'custom', 'visualization', 'location').attributes;
        return [event.attributes.id, { x: Number(xLoc), y: Number(yLoc) }];
    }));
    return { root, outline: find(resources, 'events').children.map(outline), relations, locations };
}

describe('toDcrSolutionXml', () => {

    it('gives each data property an event of its entity, an action with outputs a form with Input and Output, and a Then that sets data an update', async () => {
        const { outline, relations } = await dcrSolution(`
            Entity Heater {
                Actions: start, stop, adjust
                Data properties: running: boolean, target: int, mode: string, note: Any
            }
            Role Resident.
            Action start { Initiators: Resident }
            Action stop { Initiators: Resident }
            Action adjust { Initiators: Resident, Observers: Heater, Input: degrees: int, level: Any, Output: accepted: boolean }
            Action stop is enabled means {
                start was executed or is not available
                AND adjust is not pending or is not available
            }
            Scenario: Start
            Given the Heater's running equal to false
            When start is executed
            Then the Heater's running is set to true AND stop is available AND adjust is pending.
            Scenario: Adjust
            Given the Heater's running equal to true
            When adjust is executed with inputs degrees
            Then the Heater's target is set to degrees.
            Scenario: Eco
            Given the Heater's running equal to true
            When adjust is executed with inputs degrees, level = "eco"
            Then the Heater's mode is set to "eco".`);

        expect(outline).toEqual([
            { 'nesting Data "Data"': ['running "running" [Heater]: bool', 'target "target" [Heater]: int', 'mode "mode" [Heater]: text', 'note "note" [Heater]: text'] },
            'start "start" [Resident] excluded',
            'stop "stop" [Resident] excluded',
            {
                'form adjust "adjust" [Resident; observers Heater] excluded': [
                    { 'nesting adjust_input "Input"': ['degrees "degrees": int', 'level "level": text'] },
                    { 'nesting adjust_output "Output"': ['accepted "accepted": bool'] }
                ]
            }
        ]);
        expect(relations).toEqual([
            'condition Data → Data',
            'condition start → stop',
            'condition Data → start [not(running = false)]',
            'condition Data → adjust [not(running = true)]',
            'response start → adjust',
            'include start → stop',
            'milestone adjust → stop',
            'update start → running := true',
            'update adjust → target := degrees',
            "update adjust → mode [level = 'eco'] := 'eco'"
        ]);
    });

    it('gives an action and a property one update, the guarded values first, and a condition from each property its Givens name', async () => {
        const { outline, relations } = await dcrSolution(`
            Entity Printer {
                Actions: print
                Data properties: speed: int, quality: string, ready: boolean
            }
            Role Operator.
            Action print { Initiators: Operator, Observers: Printer, Input: copies: int, Output: pages: int }
            Scenario: Fast print
            Given the Printer's speed larger than 5 AND the Printer's ready equal to true
            When print is executed with inputs copies = 1
            Then the Printer's speed is set to 10 AND the Printer's quality is set to "draft".
            Scenario: Batch print
            Given the Printer's speed smaller than 2
            When print is executed with inputs copies = 100
            Then the Printer's speed is set to 1 AND the Printer's quality is set to "fine".
            Scenario: Any print
            Given the Printer's speed equal to 3
            When print is executed with inputs copies
            Then the Printer's speed is set to copies.`);

        expect(outline.at(-1)).toEqual({
            'form print "print" [Operator; observers Printer] excluded': [
                { 'nesting print_input "Input"': ['copies "copies": int'] },
                { 'nesting print_output "Output"': ['pages "pages": int'] }
            ]
        });
        const given = '(speed > 5 and ready = true) or speed < 2 or speed = 3';
        expect(relations).toEqual([
            'condition Data → Data',
            `condition Data → print [not(${given})]`,
            'update print → speed := if copies = 1 then 10 else if copies = 100 then 1 else copies',
            "update print → quality [(copies = 1) or (copies = 100)] := if copies = 1 then 'draft' else 'fine'"
        ]);
    });

    it('names events as their variables, with their owner before the name when two have the same, and with a number after it when an action has it', async () => {
        const { outline, relations } = await dcrSolution(`
            Entity Printer {
                Data properties: max speed: int, speed: int
            }
            Entity Scanner {
                Data properties: speed: int
            }
            Role Operator.
            Action tune { Initiators: Operator, Input: speed: int }
            Action max speed { Initiators: Operator }
            Scenario: Tune
            Given the Printer's max speed larger than 3 AND the Scanner's speed equal to 1
            When tune is executed with inputs speed = 5
            Then the Printer's speed is set to speed AND max speed is available.`);

        expect(outline).toEqual([
            { 'nesting Data "Data"': ['max_speed "max speed" [Printer]: int', 'Printer_speed "speed" [Printer]: int', 'Scanner_speed "speed" [Scanner]: int'] },
            'tune_speed "tune" [Operator]: int excluded',
            'max_speed_2 "max speed" [Operator] excluded'
        ]);
        expect(relations).toEqual([
            'condition Data → Data',
            'condition Data → tune_speed [not(max_speed > 3 and Scanner_speed = 1)]',
            'include tune_speed → max_speed_2 [tune_speed = 5]',
            'update tune_speed → Printer_speed [tune_speed = 5] := tune_speed'
        ]);
    });

    it('puts the inputs of an action without outputs in its form, and starts every event in a form included, whatever the marking', async () => {
        const text = `
            Entity Office {
                Data properties: open: boolean
            }
            Role Clerk.
            Action start { Initiators: Clerk }
            Action submit { Initiators: Clerk, Observers: Office, Input: text: string, age: int }
            Action check insurance { Initiators: Clerk, Input: id: int, Output: result: int }
            Action approve { Initiators: Clerk }
            Scenario: Check
            Given the Office's open equal to true
            When check insurance is executed with inputs id = 3
            Then approve is available.`;
        const submit = ['text "text": text', 'age "age": int'];
        const check = [{ 'nesting check_insurance_input "Input"': ['id "id": int'] }, { 'nesting check_insurance_output "Output"': ['result "result": int'] }];

        const byDefault = await dcrSolution(text);
        expect(byDefault.outline).toEqual([
            { 'nesting Data "Data"': ['open "open" [Office]: bool'] },
            'start "start" [Clerk] excluded',
            { 'form submit "submit" [Clerk; observers Office] excluded': submit },
            { 'form check_insurance "check insurance" [Clerk] excluded': check },
            'approve "approve" [Clerk] excluded'
        ]);
        expect(byDefault.relations).toEqual(['condition Data → Data', 'condition Data → check_insurance [not(open = true)]', 'include check_insurance → approve [id = 3]']);

        const asked: string[] = [];
        const marking = (event: SolutionEvent) => {
            asked.push(event.id);
            return { included: event.kind === 'action', executed: event.id === 'start', pending: event.id === 'approve' };
        };
        expect((await dcrSolution(text, { marking })).outline).toEqual([
            { 'nesting Data "Data" excluded': ['open "open" [Office]: bool excluded'] },
            'start "start" [Clerk] executed',
            { 'form submit "submit" [Clerk; observers Office]': submit },
            { 'form check_insurance "check insurance" [Clerk]': check },
            'approve "approve" [Clerk] pending'
        ]);
        expect(asked).toEqual(['Data', 'open', 'start', 'submit', 'check_insurance', 'approve']);
    });

    it('puts Data above the actions, its data properties a row for each entity', async () => {
        const { locations } = await dcrSolution(`
            Entity Printer {
                Data properties: speed: int, quality: string, ready: boolean
            }
            Entity Scanner {
                Data properties: resolution: int
            }
            Role Operator.
            Action print { Initiators: Operator, Input: copies: int }
            Action scan { Initiators: Operator }
            Scenario: Print
            Given the Printer's ready equal to true
            When print is executed with inputs copies
            Then the Printer's speed is set to copies AND scan is available.`);

        expect(['Data', 'speed', 'quality', 'ready', 'resolution'].map(id => locations.get(id)))
            .toEqual([{ x: 0, y: 0 }, { x: 30, y: 50 }, { x: 190, y: 50 }, { x: 350, y: 50 }, { x: 30, y: 230 }]);
        expect(Math.min(...['copies', 'scan'].map(id => locations.get(id)!.y))).toBeGreaterThanOrEqual(230 + 150 + 30 + 150);
    });

    it('writes events, forms, nestings, values and relations as dcrgraphs.net does (DCR test2.xml)', async () => {
        const example = parse(readFileSync(new URL('../../../dcr solution examples/DCR test2.xml', import.meta.url), 'utf8'));
        const { root } = await dcrSolution(`
            Entity Office {
                Data properties: open: boolean
            }
            Role Clerk.
            Action start { Initiators: Clerk }
            Action note { Initiators: Clerk, Input: text: string }
            Action check insurance { Initiators: Clerk, Input: id: int, Output: result: int }
            Scenario: Check
            Given the Office's open equal to true
            When check insurance is executed with inputs id = 3
            Then start is available.`);

        const names = (node: Node) => node.children.map(({ name }) => name);
        const keys = (node: Node) => Object.keys(node.attributes).sort();
        expect(keys(root)).toEqual(keys(example));
        for (const path of [['specification', 'resources'], ['specification', 'constraints'], ['specification', 'resources', 'custom'], ['runtime', 'custom', 'globalMarking'], ['runtime', 'marking']]) {
            expect(names(find(root, ...path)), path.join(' > ')).toEqual(names(find(example, ...path)));
        }
        /** How an event is written, but for what it says: its roles, place, label, … */
        const shape = (event: Node) => JSON.stringify({
            attributes: keys(event),
            custom: names(find(event, 'custom')),
            visualization: find(event, 'custom', 'visualization').children.map(child => [child.name, keys(child)]),
            data: find(event, 'custom', 'eventData').children.map(child => [child.name, keys(child), child.name === 'dataType' ? child.text : '', names(child)])
        });
        const shapes = (graph: Node) => new Set(find(graph, 'specification', 'resources', 'events').children.flatMap(events).map(shape));
        expect([...shapes(root)].sort()).toEqual([...shapes(example)].sort());
        const relation = (graph: Node) => find(graph, 'specification', 'constraints', 'includes').children.map(keys);
        expect(relation(root)).toEqual(relation(example));
    });

    it('writes an update with its guard and its value as dcrgraphs.net does (DCR update.xml)', async () => {
        const example = parse(readFileSync(new URL('../../../dcr solution examples/DCR update.xml', import.meta.url), 'utf8'));
        const { root, relations } = await dcrSolution(`
            Entity Case {
                Data properties: note: string
            }
            Role Clerk.
            Action write { Initiators: Clerk, Input: text: string }
            Scenario: Write
            Given write is available
            When write is executed with inputs text = "1"
            Then the Case's note is set to text.`);

        expect(relations).toEqual(['condition Data → Data', "update text → note [text = '1'] := text"]);
        /** Each update, and its expressions, with its source and target as A1 and A2, as the example's. */
        const update = (graph: Node) => {
            const [relation] = find(graph, 'specification', 'constraints', 'updates').children;
            const named = (text: string) => text.split(relation.attributes.sourceId).join('A1').split(relation.attributes.targetId).join('A2');
            return {
                attributes: Object.fromEntries(Object.entries(relation.attributes).map(([key, value]) => [key, named(value)])),
                expressions: find(graph, 'specification', 'resources', 'expressions').children.map(({ attributes }) => named(attributes.id))
            };
        };
        expect(update(root)).toEqual(update(example));
    });

    it("writes 'is undefined' with null, and starts each data property with none, as dcrgraphs.net does (DCR null.xml)", async () => {
        const example = parse(readFileSync(new URL('../../../dcr solution examples/DCR null.xml', import.meta.url), 'utf8'));
        const { root, relations } = await dcrSolution(`
            Entity Printer {
                Actions: print
                Data properties: label: string, speed: int, ready: boolean, jobs: a list of string
            }
            Role Operator.
            Action print { Initiators: Operator, Input: file: string }
            Scenario: Print
            Given the Printer's label is not undefined AND the Printer's speed is undefined AND the Printer's ready not equal to true
            When print is executed with inputs file
            Then the Printer's speed is set to 1.`);

        expect(relations).toEqual(['condition Data → Data', 'condition Data → file [not(label != null and speed = null and ready != true)]', 'update file → speed := 1']);
        const store = (graph: Node) => find(graph, 'runtime', 'marking', 'globalStore').children;
        expect(store(root).map(({ attributes }) => attributes)).toEqual(['label', 'speed', 'ready'].map(id => ({ ...store(example)[0].attributes, id })));
    });

    it('gives every example without errors XML read back as above', async () => {
        const examples = new URL('../../../examples/', import.meta.url);
        let read = 0;
        for (const file of readdirSync(examples).filter(name => name.endsWith('.easy'))) {
            const text = readFileSync(new URL(file, examples), 'utf8');
            if ((await build(text)).model) {
                await dcrSolution(text);
                read++;
            }
        }
        expect(read).toBeGreaterThan(3);
    });
});
