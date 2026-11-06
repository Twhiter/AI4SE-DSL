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
    pending?: boolean;
    takesInput?: boolean;
    computation?: string;
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
 * relations written out (condition Data → print [not(speed > 2)]). Without the fixer, unless `fixInclusion` says so.
 */
async function dcrJs(text: string, fixInclusion = false) {
    const result = await build(text);
    expect(result.errors?.map(({ message }) => message) ?? []).toEqual([]);
    const xml = await toDcrJsXml(result.model!, { fixInclusion });
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
    const labels = new Map(elements.map(({ id, label }) => [id, label ?? id]));
    return {
        xml,
        elements,
        boxes,
        outline: rootElement.rootElements[0].boardElements.filter((element: DcrElement) => !isRelation(element)).map((element: DcrElement) => outline(element, labels)),
        relations: elements.filter(isRelation).map(({ type, sourceRef, targetRef, guard, value }) =>
            `${type} ${sourceRef!.label} → ${targetRef!.label}${guard ? ` [${guard}]` : ''}${value ? ` := ${value}` : ''}`)
    };
}

/**
 *   speed [Printer] speed: Int                                  an activity: its role, observers, variable (or excluded),
 *                                                               pending or not, and its computation, each token with a
 *   busy [Robot:Terminator] busy: Bool pending = ready == true and …       space between, an element's value by its label (ready),
 *                                                               its status as print@pending
 *   { 'nesting print': [ … ] }                                   a nesting (or a sub-process), and what it holds
 */
function outline(element: DcrElement, labels: Map<string, string>): string | Record<string, unknown[]> {
    const role = element.role ? ` [${element.role}${element.observers ? `; observers ${element.observers}` : ''}]` : '';
    if (element.$type === 'dcr:Event') {
        const token = (token: unknown) => typeof token === 'object' && token !== null && 'tuple' in token
            ? (([id, part]: string[]) => part === 'data' ? labels.get(id) : `${labels.get(id)}@${part}`)((token as { tuple: string[] }).tuple)
            : String(token);
        const computation = element.computation === undefined ? '' : ` = ${(JSON.parse(element.computation) as unknown[]).map(token).join(' ')}`;
        return `${element.label}${role}${element.eventData ? ` ${element.eventData.name}: ${element.eventData.type}` : ''}${element.included ? '' : ' excluded'}`
            + (element.pending ? ' pending' : '') + computation;
    }
    const name = element.$type === 'dcr:Nesting' ? `nesting ${element.label}${role}` : `sub-process ${element.label}${role}${element.included ? '' : ' excluded'}`;
    return { [name]: (element.boardElements ?? []).map(child => outline(child, labels)) };
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
            'condition Data → Data',
            'condition start → stop',
            'milestone adjust → stop',
            'condition Data → start [not(running = false)]',
            'include start → stop',
            'response start → adjust',
            'setValue start → running := true',
            'condition Data → adjust [not(running = true)]',
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
            'condition Data → Data',
            'condition Data → print [not(speed > 5 or speed < 2 or speed = 3)]',
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
            'condition Data → Data',
            'condition Data → tune [not(max_speed > 3 and Scanner_speed = 1)]',
            'setValue tune → speed [tune_speed = 5] := tune_speed'
        ]);
        expect(elements.find(({ type }) => type === 'setValue')?.targetRef?.eventData?.name).toBe('Printer_speed');
    });

    it('names an input or output with the name of a data property, or of another input or output, after its action; the data property keeps its name', async () => {
        const { outline, relations } = await dcrJs(`
            Entity Application {
                Data properties: child age: int, is_minor: boolean
            }
            Role Citizen.
            Action submit { Initiators: Citizen, Input: child age: int }
            Action determine minor { Initiators: Citizen, Output: is_minor: boolean }
            Action assess first { Initiators: Citizen, Input: decision: boolean }
            Action assess second { Initiators: Citizen, Input: decision: boolean }
            Scenario: Submit
            Given the Application's is_minor equal to true
            When submit is executed with inputs child age
            Then the Application's child age is set to child age.`);

        expect(outline).toEqual([
            { 'nesting Data': ['child age [Application] child_age: Int', 'is_minor [Application] is_minor: Bool'] },
            'submit [Citizen] submit_child_age: Int excluded',
            { 'nesting determine minor': [{ 'nesting Output': ['is_minor [Citizen] determine_minor_is_minor: Bool excluded'] }] },
            'assess first [Citizen] assess_first_decision: Bool excluded',
            'assess second [Citizen] assess_second_decision: Bool excluded'
        ]);
        expect(relations).toEqual([
            'condition Data → Data',
            'condition Data → submit [not(is_minor = true)]',
            'setValue submit → child age := submit_child_age'
        ]);
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
            'condition Data → Data',
            'condition Data → print [not(speed > 2)]',
            'setValue print → speed := 1'
        ]);
    });

    it("gives an action with more inputs and no output a nesting with Input, and a document without data properties a placeholder in Data for its Givens' condition", async () => {
        const { outline, relations } = await dcrJs(`
            Entity Machine { States: off }
            Role Operator.
            Action start { Initiators: Operator }
            Action stop { Initiators: Operator }
            Action move { Initiators: Operator, Input: x: int, y: int }
            Declarative specification Machine is off means { start is available }
            Scenario: Start
            Given the Machine is off
            When start is executed
            Then stop is available.`);

        expect(outline).toEqual([
            { 'nesting Data': ['placeholder'] },   // never executed, as Data has a condition to itself
            { 'nesting States': ['off [Robot:Terminator] off: Bool pending = start@included'] },
            'end state [Robot:Terminator]',
            'start [Operator] excluded',
            'stop [Operator] excluded',
            { 'nesting move': [{ 'nesting Input': ['x [Operator] x: Int excluded', 'y [Operator] y: Int excluded'] }] }
        ]);
        expect(relations).toEqual([
            'condition Data → Data',
            'milestone States → end state',
            'response end state → States',
            'condition Data → start [not(off = true)]',
            'include start → stop'
        ]);
    });

    it("gives every state an activity in the nesting States, initiated by Robot:Terminator, with a Bool variable, included and pending, its specification as its computation, after the states it names (a milestone from each), and an end state beside States, after all of them, which makes them pending; a Given names its states", async () => {
        const { outline, relations, elements } = await dcrJs(`
            Entity Printer {
                Actions: start, print, reboot
                Data properties: speed: int, label: string, jobs: a list of string
                States: ready, busy, clear, plain
            }
            Role Operator.
            Action start { Initiators: Operator }
            Action print { Initiators: Operator, Input: copies: int }
            Action reboot { Initiators: Operator }
            Action print is enabled means { start was executed or is not available }
            Declarative specification Printer is ready means { print is enabled AND the label equal to "eco" }
            Declarative specification Printer is busy means { it is ready AND reboot is not pending AND the speed larger than 2 }
            Declarative specification Printer is clear means { the jobs is empty }
            Scenario: Print
            Given the Printer is busy AND the Printer's speed smaller than 9
            When print is executed with inputs copies
            Then the Printer's speed is set to copies.`);

        expect(outline).toEqual([
            { 'nesting Data': ['speed [Printer] speed: Int', 'label [Printer] label: String'] },
            {
                'nesting States': [
                    // what its enabled specification says, and that print is available
                    'ready [Robot:Terminator] ready: Bool pending = ( start@executed or not ( start@included ) ) and print@included and label == "eco"',
                    'busy [Robot:Terminator] busy: Bool pending = not ( reboot@pending ) and ready == true and speed > 2',
                    'clear [Robot:Terminator] clear: Bool pending',   // only about a list, which DCR.js has not yet
                    'plain [Robot:Terminator] plain: Bool pending'    // no specification
                ]
            },
            'end state [Robot:Terminator]',
            'start [Operator] excluded',
            'print [Operator] copies: Int excluded',
            'reboot [Operator] excluded'
        ]);
        expect(relations).toEqual([
            'condition Data → Data',
            'milestone ready → busy',   // busy is computed after ready, which its specification names
            'milestone States → end state',   // once no state is pending
            'response end state → States',    // which makes them all pending again
            'condition start → print',
            'condition Data → print [not(busy = true and speed < 9)]',
            'setValue print → speed := copies'
        ]);
        // a computed value is no input; a state without a computation's is Robot:Terminator's
        expect(['busy', 'plain'].map(state => elements.find(({ label }) => label === state)!.takesInput)).toEqual([false, true]);
        // as DCR.js's own import of a DCR Solutions expression gives it, an action's status the action's element and the status
        const id = (label: string) => elements.find(element => element.label === label && element.$type === 'dcr:Event')!.id;
        expect(JSON.parse(elements.find(({ label }) => label === 'busy')!.computation!))
            .toEqual(['not', '(', { tuple: [id('reboot'), 'pending'] }, ')', 'and', { tuple: [id('ready'), 'data'] }, '==', true, 'and', { tuple: [id('speed'), 'data'] }, '>', 2]);
    });

    it("names a state's variable with its entity before its name when another entity's state, a data property or an action has it", async () => {
        const { outline } = await dcrJs(`
            Entity Printer {
                Actions: start
                Data properties: speed: int
                States: idle, speed, start, on
            }
            Entity Tray { States: idle }
            Role Operator.
            Action start { Initiators: Operator, Input: on: boolean }`);

        expect(outline).toEqual([
            { 'nesting Data': ['speed [Printer] speed: Int'] },
            {
                'nesting States': ['idle [Robot:Terminator] Printer_idle: Bool pending', 'speed [Robot:Terminator] Printer_speed: Bool pending', 'start [Robot:Terminator] Printer_start: Bool pending',
                    'on [Robot:Terminator] on: Bool pending', 'idle [Robot:Terminator] Tray_idle: Bool pending']
            },
            'end state [Robot:Terminator]',
            'start [Operator] start_on: Bool excluded'   // an input after its action, when any other variable has its name
        ]);
    });

    it('starts an action, or the inputs and outputs in its nesting, as its Action … { … } says', async () => {
        const { outline } = await dcrJs(`
            Role Operator.
            Action start { Initiators: Operator, Initially available: true, Initially pending: true }
            Action stop { Initiators: Operator, Initially available: false }
            Action move { Initiators: Operator, Input: x: int, y: int, Initially available: true }
            Action check { Initiators: Operator, Output: ok: boolean, Initially pending: true }`);

        expect(outline).toEqual([
            'start [Operator] pending',
            'stop [Operator] excluded',
            { 'nesting move': [{ 'nesting Input': ['x [Operator] x: Int', 'y [Operator] y: Int'] }] },
            { 'nesting check': [{ 'nesting Output': ['ok [Operator] ok: Bool excluded pending'] }] }
        ]);
    });

    it('with the fixer, starts an action that no include relation goes to included, whatever its Action … { … } says, and its inputs and outputs too', async () => {
        const text = `
            Entity Heater {
                Actions: start, stop, adjust
                Data properties: running: boolean
            }
            Role Resident.
            Action start { Initiators: Resident }
            Action stop { Initiators: Resident }
            Action adjust { Initiators: Resident, Input: degrees: int, Output: accepted: boolean, Initially available: false }
            Scenario: Start
            Given the Heater's running equal to false
            When start is executed
            Then stop is available.`;
        const data = { 'nesting Data': ['running [Heater] running: Bool'] };

        expect((await dcrJs(text, true)).outline).toEqual([
            data,
            'start [Resident]',
            'stop [Resident] excluded',   // start includes it
            { 'nesting adjust': [{ 'nesting Input': ['degrees [Resident] degrees: Int'] }, { 'nesting Output': ['accepted [Resident] accepted: Bool'] }] }
        ]);
        expect((await dcrJs(text)).outline).toEqual([
            data,
            'start [Resident] excluded',
            'stop [Resident] excluded',
            { 'nesting adjust': [{ 'nesting Input': ['degrees [Resident] degrees: Int excluded'] }, { 'nesting Output': ['accepted [Resident] accepted: Bool excluded'] }] }
        ]);
    });

    it('names a variable that an expression would read as one of its words with its owner before it, in any case', async () => {
        const { outline } = await dcrJs(`
            Entity Printer {
                Actions: start
                Data properties: count: int
                States: remove, Null
            }
            Role Operator.
            Action start { Initiators: Operator, Input: index: int }`);

        expect(outline).toEqual([
            { 'nesting Data': ['count [Printer] Printer_count: Int'] },
            { 'nesting States': ['remove [Robot:Terminator] Printer_remove: Bool pending', 'Null [Robot:Terminator] Printer_Null: Bool pending'] },
            'end state [Robot:Terminator]',
            'start [Operator] start_index: Int excluded'
        ]);
    });

    it('puts the parts of a graph that no relation connects in rows, wider than high, not in one column', async () => {
        const { boxes } = await dcrJs(`
            Entity Machine { States: off }
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
            Declarative specification Machine is off means { start is available }
            Scenario: Start
            Given the Machine is off
            When start is executed
            Then stop is available.`);

        const [left, top] = [Math.min(...boxes.map(({ x }) => x)), Math.min(...boxes.map(({ y }) => y))];
        const width = Math.max(...boxes.map(({ x, width }) => x + width)) - left;
        const height = Math.max(...boxes.map(({ y, height }) => y + height)) - top;
        /** The rows of boxes: a box below all the boxes of the row before it starts the next. */
        const rows = [...boxes].sort((a, b) => a.y - b.y).reduce<number[]>((bottoms, { y, height }) =>
            bottoms.length > 0 && y < bottoms.at(-1)! ? [...bottoms.slice(0, -1), Math.max(bottoms.at(-1)!, y + height)] : [...bottoms, y + height], []);
        expect(rows.length).toBeLessThan(boxes.length / 2);
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
