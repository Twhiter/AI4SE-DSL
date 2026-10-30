// toDcrJsXml on DSL easy documents, its XML read back with DCR.js's own schema as the DCR page reads it
// (legal-dcr-frontend/modeler/lib/moddle): what each part of a document becomes.

import { readFileSync, readdirSync } from 'node:fs';
import { buildModel, createEasyServices } from 'easy-language';
import { EmptyFileSystem, URI } from 'langium';
// @ts-expect-error: moddle has no types
import { Moddle } from 'moddle';
// @ts-expect-error: moddle-xml has no types
import { Reader } from 'moddle-xml';
import { describe, expect, it } from 'vitest';
import { toDcrJsXml } from './index.ts';

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

/** DCR.js's schema, its editor's. */
const schema = ['dcr', 'dcrDi', 'dc'].map(name =>
    JSON.parse(readFileSync(new URL(`../../../legal-dcr-frontend/modeler/lib/moddle/resources/${name}.json`, import.meta.url), 'utf8')));

/** An element of a DCR.js graph, as its schema reads it. */
interface DcrElement {
    $type: string;
    id: string;
    label?: string;
    role?: string;
    observers?: string;
    included?: boolean;
    takesInput?: boolean;
    eventData?: { name: string, type: string };
    boardElements?: DcrElement[];
    sourceRef?: DcrElement;
    targetRef?: DcrElement;
    type?: string;
    guard?: string;
    value?: string;
}

/** Where a shape is. */
interface Box { x: number, y: number, width: number, height: number }

/**
 * The XML of a document read as the DCR page reads it, without a warning, with a shape for every element and a route
 * for every relation, no two shapes of the graph itself overlapping (boxes); its elements outlined (outline) and its
 * relations written out (condition Data → print [speed > 2]).
 */
async function dcrJs(text: string) {
    const result = await build(text);
    expect(result.errors?.map(({ message }) => message) ?? []).toEqual([]);
    const xml = await toDcrJsXml(result.model!);
    const reader = new Reader({ model: new Moddle(schema), lax: false });
    const { rootElement, warnings } = await reader.fromXML(xml, reader.handler('dcr:Definitions'));
    expect(warnings).toEqual([]);

    const all = (element: DcrElement): DcrElement[] => [element, ...(element.boardElements ?? []).flatMap(all)];
    const elements: DcrElement[] = rootElement.rootElements[0].boardElements.flatMap(all);
    const layout: Array<{ boardElement: DcrElement, bounds?: unknown, waypoint?: unknown[] }> = rootElement.rootBoards[0].plane.planeElement;
    for (const element of elements) {
        const di = layout.find(({ boardElement }) => boardElement === element);
        expect(element.$type === 'dcr:Relation' ? di?.waypoint?.length ?? 0 : di?.bounds ? 2 : 0, element.id).toBeGreaterThanOrEqual(2);
    }
    const isRelation = (element: DcrElement) => element.$type === 'dcr:Relation';
    const boxes: Box[] = rootElement.rootElements[0].boardElements.filter((element: DcrElement) => !isRelation(element))
        .map((element: DcrElement) => layout.find(({ boardElement }) => boardElement === element)!.bounds as Box);
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b =>
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'shapes overlap').toBe(true)));
    return {
        xml,
        elements,
        boxes,
        outline: rootElement.rootElements[0].boardElements.filter((element: DcrElement) => !isRelation(element)).map(outline),
        relations: elements.filter(isRelation).map(({ type, sourceRef, targetRef, guard, value }) =>
            `${type} ${sourceRef!.label} → ${targetRef!.label}${guard ? ` [${guard}]` : ''}${value ? ` := ${value}` : ''}`)
    };
}

/**
 *   speed [Printer] speed: Int                                  an activity: its role, observers, variable (or excluded)
 *   { 'nesting print': [ … ] }                                   a nesting (or a sub-process), and what it holds
 */
function outline(element: DcrElement): string | Record<string, unknown[]> {
    const role = element.role ? ` [${element.role}${element.observers ? `; observers ${element.observers}` : ''}]` : '';
    if (element.$type === 'dcr:Event') {
        return `${element.label}${role}${element.eventData ? ` ${element.eventData.name}: ${element.eventData.type}` : ''}${element.included ? '' : ' excluded'}`;
    }
    const name = element.$type === 'dcr:Nesting' ? `nesting ${element.label}${role}` : `sub-process ${element.label}${role}${element.included ? '' : ' excluded'}`;
    return { [name]: (element.boardElements ?? []).map(outline) };
}

describe('toDcrJsXml', () => {

    it('gives the data variables, an action with outputs a nesting with Input and Output, and a Then that sets data a setValue', async () => {
        const { outline, relations, elements } = await dcrJs(`
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
            { 'nesting Data': ['running [Heater] running: Bool', 'target [Heater] target: Int', 'mode [Heater] mode: String', 'note [Heater] note: String'] },
            'start [Resident] excluded',
            'stop [Resident] excluded',
            {
                'nesting adjust': [
                    { 'nesting Input': ['degrees [Resident; observers Heater] degrees: Int excluded', 'level [Resident; observers Heater] level: String excluded'] },
                    { 'nesting Output': ['accepted [Resident; observers Heater] accepted: Bool excluded'] }
                ]
            }
        ]);
        expect(relations).toEqual([
            'condition start → stop',
            'milestone adjust → stop',
            'condition Data → start [running = false]',
            'include start → stop',
            'response start → adjust',
            'setValue start → running := true',
            'condition Data → adjust [running = true]',
            'setValue adjust → target := degrees',
            'setValue adjust → mode [level = "eco"] := "eco"'
        ]);
        // an activity with a variable is given a value when it is executed
        expect(elements.filter(({ eventData }) => eventData).every(({ takesInput }) => takesInput)).toBe(true);
    });

    it('gives each scenario of a When its own setValue, guarded by its When, and joins their Givens with or', async () => {
        const { relations } = await dcrJs(`
            Entity Printer {
                Actions: print
                Data properties: speed: int, quality: string
            }
            Role Operator.
            Action print { Initiators: Operator, Observers: Printer, Input: copies: int, Output: pages: int }
            Scenario: Fast print
            Given the Printer's speed larger than 5
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

        expect(relations).toEqual([
            'condition Data → print [speed > 5 or speed < 2 or speed = 3]',
            'setValue print → speed [copies = 1] := 10',
            'setValue print → quality [copies = 1] := "draft"',
            'setValue print → speed [copies = 100] := 1',
            'setValue print → quality [copies = 100] := "fine"',
            'setValue print → speed := copies'
        ]);
    });

    it('names variables with _ for spaces, and with their owner before the name when two have the same', async () => {
        const { outline, relations, elements } = await dcrJs(`
            Entity Printer {
                Data properties: max speed: int, speed: int
            }
            Entity Scanner {
                Data properties: speed: int
            }
            Role Operator.
            Action tune { Initiators: Operator, Input: speed: int }
            Scenario: Tune
            Given the Printer's max speed larger than 3 AND the Scanner's speed equal to 1
            When tune is executed with inputs speed = 5
            Then the Printer's speed is set to speed.`);

        expect(outline).toEqual([
            { 'nesting Data': ['max speed [Printer] max_speed: Int', 'speed [Printer] Printer_speed: Int', 'speed [Scanner] Scanner_speed: Int'] },
            'tune [Operator] tune_speed: Int excluded'
        ]);
        expect(relations).toEqual([
            'condition Data → tune [max_speed > 3 and Scanner_speed = 1]',
            'setValue tune → speed [tune_speed = 5] := tune_speed'
        ]);
        expect(elements.find(({ type }) => type === 'setValue')?.targetRef?.eventData?.name).toBe('Printer_speed');
    });

    it('leaves out lists and queues, with what the scenarios say about them, and is undefined', async () => {
        const { outline, relations } = await dcrJs(`
            Entity Printer {
                Actions: print
                Data properties: speed: int, label: string, jobs: a list of string, waiting: a queue of string
            }
            Role Operator.
            Action print { Initiators: Operator, Input: file: string }
            Scenario: Print
            Given the Printer's speed larger than 2
                AND the Printer's jobs is not empty
                AND the Printer's label is not undefined
            When print is executed with inputs file
            Then file is added to the Printer's jobs
                AND the Printer's waiting is dequeued as next
                AND the Printer's label is set to next
                AND the Printer's speed is set to 1.`);

        expect(outline).toEqual([
            { 'nesting Data': ['speed [Printer] speed: Int', 'label [Printer] label: String'] },
            'print [Operator] file: String excluded'
        ]);
        expect(relations).toEqual([
            'condition Data → print [speed > 2]',
            'setValue print → speed := 1'
        ]);
    });

    it('gives an action with more inputs and no output a nesting with Input, and a document without data no Data', async () => {
        const { outline, relations } = await dcrJs(`
            Role Operator.
            Action start { Initiators: Operator }
            Action stop { Initiators: Operator }
            Action move { Initiators: Operator, Input: x: int, y: int }
            Scenario: Start
            Given start is available
            When start is executed
            Then stop is available.`);

        expect(outline).toEqual([
            'start [Operator] excluded',
            'stop [Operator] excluded',
            { 'nesting move': [{ 'nesting Input': ['x [Operator] x: Int excluded', 'y [Operator] y: Int excluded'] }] }
        ]);
        expect(relations).toEqual(['include start → stop']);
    });

    it('puts the parts of a graph that no relation connects in rows, wider than high, not in one column', async () => {
        const { boxes } = await dcrJs(`
            Role Operator.
            Action start { Initiators: Operator }
            Action stop { Initiators: Operator }
            Action open { Initiators: Operator }
            Action close { Initiators: Operator }
            Action read { Initiators: Operator }
            Action write { Initiators: Operator }
            Action scan { Initiators: Operator }
            Action send { Initiators: Operator }
            Action print { Initiators: Operator }
            Scenario: Start
            Given start is available
            When start is executed
            Then stop is available.`);

        const [left, top] = [Math.min(...boxes.map(({ x }) => x)), Math.min(...boxes.map(({ y }) => y))];
        const width = Math.max(...boxes.map(({ x, width }) => x + width)) - left;
        const height = Math.max(...boxes.map(({ y, height }) => y + height)) - top;
        expect(new Set(boxes.map(({ y }) => y)).size).toBeLessThan(boxes.length / 2);
        expect(height).toBeLessThan(width);
    });

    it('gives every example without errors XML that DCR.js reads, laid out', async () => {
        const examples = new URL('../../../examples/', import.meta.url);
        let read = 0;
        for (const file of readdirSync(examples).filter(name => name.endsWith('.easy'))) {
            const result = await build(readFileSync(new URL(file, examples), 'utf8'));
            if (result.model) {
                await dcrJs(readFileSync(new URL(file, examples), 'utf8'));
                read++;
            }
        }
        expect(read).toBeGreaterThan(3);
    });
});
