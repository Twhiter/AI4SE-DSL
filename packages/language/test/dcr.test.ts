import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { init, killThreads } from 'z3-solver';
import { guardText, toDcrGraph, type DcrGraph } from '../src/dcr.js';
import { createEasyServices } from '../src/easy-module.js';
import { buildModel } from '../src/model-builder.js';
import { PropertyAssertion, type AssertionOperation, type Value } from '../src/model.js';
import type { Z3Context } from '../src/z3-vocabulary.js';

const DECLARATIONS = `
Entity Printer {
    Actions: start, print
    Data properties: speed: int, ready: boolean, jobs: a list of string
    States: online, busy, idle
}
Entity Tray {
    Actions: refill
    Data properties: level: int
}
Role Operator.
Role Viewer.
Action start { Initiators: Operator, Observers: Viewer }
Action print { Initiators: Operator, Input: file: string, copies: int, Output: pages: int }
Action reboot { Initiators: Operator, Viewer }
Declarative specification Printer is online means { the ready equal to true }
Declarative specification Printer is busy means { it is online AND the speed larger than 5 AND print is pending }
Declarative specification Printer is idle means { print is not pending }
`;

let api: Awaited<ReturnType<typeof init>>;
let z3: Z3Context;

beforeAll(async () => {
    api = await init();
    z3 = new api.Context('main');
});

afterAll(async () => {
    await killThreads(api.em);
});

/** toDcrGraph of `text` (after the declarations, unless `declarations` says otherwise). */
async function graphOf(text: string, declarations = DECLARATIONS): Promise<DcrGraph> {
    const { model, errors } = buildModel(await parseHelper(createEasyServices(EmptyFileSystem).Easy)(declarations + text, { validation: true }));
    expect(errors).toBeUndefined();
    return toDcrGraph(z3, model!);
}

/**
 * The relations of the graph of `text` (after the declarations, unless `declarations` says otherwise), as [relation,
 * from, to, guard], but Data's condition to itself and the relations of the states: between them, and between States and
 * the end state.
 */
async function relationsOf(text: string, declarations = DECLARATIONS): Promise<Array<[string, string, string, string | undefined]>> {
    const graph = await graphOf(text, declarations);
    const states = new Set(['States', 'end state', ...graph.groups.find(({ name }) => name === 'States')?.events ?? []]);
    return graph.relations.filter(({ from, to }) => !(from === 'Data' && to === 'Data') && !(states.has(from) && states.has(to)))
        .map(({ relation, from, to, guard }) => [relation, from, to, guard]);
}

describe('toDcrGraph', () => {

    it('makes an activity of every data property, initiated by its entity, in the group Data, which has a condition to itself, of every state, in the group States, with an end state beside it, and of every action, with its inputs and outputs; only the data and the states included', async () => {
        const none = { observers: [], inputs: [], outputs: [], defaultIncluded: false, defaultPending: false };
        const data = { ...none, defaultIncluded: true };
        const state = { ...none, initiators: ['Robot:Terminator'], defaultIncluded: true, defaultPending: true };
        const graph = await graphOf('');
        expect(graph.events).toEqual([
            { name: 'speed', initiators: ['Printer'], ...data },
            { name: 'ready', initiators: ['Printer'], ...data },
            { name: 'jobs', initiators: ['Printer'], ...data },
            { name: 'level', initiators: ['Tray'], ...data },
            { ...state, name: 'online', computation: 'ready = true' },
            { ...state, name: 'busy', computation: 'print@pending and online = true and speed > 5' },
            { ...state, name: 'idle', computation: 'not(print@pending)' },
            { ...none, name: 'end state', initiators: ['Robot:Terminator'], defaultIncluded: true },
            { ...none, name: 'start', initiators: ['Operator'], observers: ['Viewer'] },
            { ...none, name: 'print', initiators: ['Operator'], inputs: [{ name: 'file', type: 'string' }, { name: 'copies', type: 'int' }], outputs: [{ name: 'pages', type: 'int' }] },
            { ...none, name: 'refill', initiators: [] },   // no 'Action refill { … }'
            { ...none, name: 'reboot', initiators: ['Operator', 'Viewer'] }
        ]);
        expect(graph.groups).toEqual([{ name: 'Data', events: ['speed', 'ready', 'jobs', 'level'] }, { name: 'States', events: ['online', 'busy', 'idle'] }]);
        expect(graph.relations.map(({ relation, from, to, guard }) => [relation, from, to, guard])).toEqual([
            ['condition', 'Data', 'Data', undefined],
            ['milestone', 'online', 'busy', undefined],   // busy is computed after online, which its specification names
            ['milestone', 'States', 'end state', undefined],   // the round ends once no state is pending
            ['response', 'end state', 'States', undefined]     // and makes them all pending again
        ]);
    });

    it("computes a state from its specification: an action's status as its marking, 'enabled' as its enabled specification and its availability, a state as its value, data as a guard says it", async () => {
        const graph = await graphOf('', `
            Entity Printer {
                Actions: start, print, reboot
                Data properties: speed: int, jobs: a list of string
                States: ready, waiting, working, plain
            }
            Role Operator.
            Action start { Initiators: Operator }
            Action print { Initiators: Operator }
            Action reboot { Initiators: Operator }
            Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available }
            Declarative specification Printer is ready means { print is enabled AND reboot is enabled }
            Declarative specification Printer is waiting means { start is available AND reboot is not available AND print is pending AND start was not executed }
            Declarative specification Printer is working means { it is waiting AND the jobs is not empty AND reboot was executed AND print is not pending }
        `);
        expect(graph.events.filter(({ initiators }) => initiators.includes('Robot:Terminator')).map(({ name, computation }) => [name, computation])).toEqual([
            ['ready', '(start@executed or not(start@included)) and (not(reboot@pending) or not(reboot@included)) and print@included and reboot@included'],
            ['waiting', 'start@included and not(reboot@included) and print@pending and not(start@executed)'],
            ['working', 'not(print@pending) and reboot@executed and waiting = true and count(jobs) > 0'],
            ['plain', undefined],   // no specification
            ['end state', undefined]
        ]);
    });

    it('names the activity of a state Entity.state when another entity has a state of that name, or another activity or an input or output has it', async () => {
        const graph = await graphOf('', `
            Entity Printer {
                Actions: print
                Data properties: speed: int
                States: idle, speed, print, file, on
            }
            Entity Tray { States: idle }
            Role Operator.
            Action print { Initiators: Operator, Input: file: string }
        `);
        expect(graph.groups.find(({ name }) => name === 'States')?.events).toEqual(['Printer.idle', 'Printer.speed', 'Printer.print', 'Printer.file', 'on', 'Tray.idle']);
    });

    it("names the end state 'end state 2' when another activity has its name", async () => {
        const graph = await graphOf('', `
            Entity Printer {
                Actions: end state
                States: idle
            }
            Role Operator.
            Action end state { Initiators: Operator }
        `);
        expect(graph.events.filter(({ initiators }) => initiators.includes('Robot:Terminator')).map(({ name }) => name)).toEqual(['idle', 'end state 2']);
    });

    it("starts an action included and pending as its Action … { … } says; one without the lines, or without one, neither", async () => {
        const declarations = DECLARATIONS
            .replace('Observers: Viewer }', 'Observers: Viewer, Initially available: true }')
            .replace('Output: pages: int }', 'Output: pages: int, Initially available: false, Initially pending: true }');
        const graph = await graphOf('', declarations);
        expect(graph.events.filter(({ initiators }) => !initiators.includes('Robot:Terminator')).map(({ name, defaultIncluded, defaultPending }) => [name, defaultIncluded, defaultPending]).slice(4)).toEqual([
            ['start', true, false],
            ['print', false, true],
            ['refill', false, false],
            ['reboot', false, false]
        ]);
    });

    it('turns an enabled specification into a condition from each of its conditions and a milestone from each of its milestones', async () => {
        expect(await relationsOf(`
            Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available }
        `)).toEqual([
            ['condition', 'start', 'print', undefined],
            ['milestone', 'reboot', 'print', undefined]
        ]);
    });

    it('one scenario: a condition from Data guarded by not its Given, its states and data, and its Then from the When, guarded by what its When says', async () => {
        // the state itself, whose activity computes what its specification says
        const inputs = 'file = "report.pdf"';
        expect(await relationsOf(`
            Scenario: Print report
            Given the Printer is busy AND "report.pdf" is included in the Printer's jobs
            When print is executed with inputs file = "report.pdf", copies
            Then the Printer's jobs is removed with "report.pdf" AND reboot is pending AND print is not available AND start is available
                AND the Printer's speed is set to copies.
        `)).toEqual([
            ['condition', 'Data', 'print', 'not(busy = true and list contains(jobs, "report.pdf"))'],
            ['include', 'print', 'start', inputs],
            ['exclude', 'print', 'print', inputs],
            ['response', 'print', 'reboot', inputs],
            ['include', 'print', 'jobs', inputs],   // an assignment: DCR has no relation for one
            ['include', 'print', 'speed', inputs]
        ]);
    });

    it('several scenarios: the condition from Data guarded by none of their Givens, each Then only by its own When, the same relation merged', async () => {
        expect(await relationsOf(`
            Scenario: Rush
            Given the Printer is busy
            When start is executed
            Then the Printer's speed is set to 10 AND reboot is pending.
            Scenario: Slow
            Given the Printer's speed smaller than 3 AND the Printer's ready equal to true
            When start is executed
            Then the Printer's speed is set to 1 AND reboot is pending AND print is available.
        `)).toEqual([
            ['condition', 'Data', 'start', 'not(busy = true or (speed < 3 and ready = true))'],
            ['response', 'start', 'reboot', undefined],   // the Whens say nothing
            ['include', 'start', 'speed', undefined],
            ['include', 'start', 'print', undefined]
        ]);
        // with inputs: a Then's guard has its input values, and one When that says nothing makes it always hold
        expect(await relationsOf(`
            Scenario: Draft
            Given the Printer's speed smaller than 2
            When print is executed with inputs file = "draft", copies
            Then "draft" is removed from the Printer's jobs.
            Scenario: Any
            Given the Printer's speed larger than 2
            When print is executed with inputs file, copies
            Then file is added to the Printer's jobs.
        `)).toEqual([
            ['condition', 'Data', 'print', 'not(speed < 2 or speed > 2)'],
            ['include', 'print', 'jobs', undefined]
        ]);
    });

    it('has a placeholder in Data for the condition from it without data properties, and no condition when the Givens together always hold', async () => {
        const machine = [`
            Scenario: Run
            Given the Machine is off
            When run is executed
            Then stop is available.
        `, `
            Entity Machine {
                Actions: run, stop
                States: off
            }
            Role Operator.
            Action run { Initiators: Operator }
            Action stop { Initiators: Operator }
            Declarative specification Machine is off means { run is available }
        `] as const;
        expect((await graphOf(...machine)).groups).toEqual([{ name: 'Data', events: ['placeholder'] }, { name: 'States', events: ['off'] }]);
        expect(await relationsOf(...machine)).toEqual([['condition', 'Data', 'run', 'not(off = true)'], ['include', 'run', 'stop', undefined]]);
        expect(await relationsOf(`
            Scenario: Fast
            Given the Printer's speed larger than 3
            When start is executed
            Then reboot is pending.
            Scenario: Slow
            Given the Printer's speed smaller than 4
            When start is executed
            Then reboot is pending.
            Scenario: Unknown speed
            Given the Printer's speed is undefined
            When start is executed
            Then reboot is pending.
            Scenario: Ready
            Given the Printer's ready equal to true
            When print is executed with inputs copies = 1, file = "a"
            Then reboot is pending.
            Scenario: Also ready
            Given the Printer is idle
            When print is executed with inputs file = "b", copies = 2
            Then reboot is pending.
        `)).toEqual([
            ['response', 'start', 'reboot', undefined],   // speed > 3 or speed < 4 or no speed at all always holds
            ['condition', 'Data', 'print', 'not(ready = true or idle = true)'],
            ['response', 'print', 'reboot', '(file = "a" and copies = 1) or (file = "b" and copies = 2)']   // in the order print declares them
        ]);
    });

    it("guards a Then by its When: the data it gives an input, its outputs, its comparisons and data assertions, but not by its Given", async () => {
        const graph = await graphOf(`
            Scenario: Adult joins
            Given the Person's age larger than 0
            When register is executed with inputs name, age = the Person's age, outputs is_adult
                AND is_adult equal to true AND the Person's blocked equal to false
            Then name is added to the Library's members AND borrow is available.
        `, `
            Entity Person {
                Actions: register, borrow
                Data properties: age: int, name: string, blocked: boolean
            }
            Entity Library { Data properties: members: a list of string }
            Role Clerk.
            Action register { Initiators: Clerk, Input: name: string, age: int, Output: is_adult: boolean }
            Action borrow { Initiators: Clerk }
        `);
        // register has an input age and an input name: the Person's are Person.age and Person.name
        expect(graph.groups).toEqual([{ name: 'Data', events: ['Person.age', 'Person.name', 'blocked', 'members'] }]);
        const guard = 'age = Person.age and is_adult = true and blocked = false';
        expect(graph.relations.map(({ relation, from, to, guard }) => [relation, from, to, guard])).toEqual([
            ['condition', 'Data', 'Data', undefined],
            ['condition', 'Data', 'register', 'not(Person.age > 0)'],
            ['include', 'register', 'borrow', guard],
            ['include', 'register', 'members', guard]
        ]);
    });

    it('writes an input or output the When gives a value or data as that value or data, and one it gives nothing by its name', async () => {
        expect(await relationsOf(`
            Scenario: Two copies
            Given the Printer is idle
            When print is executed with inputs file, copies = 2, outputs pages AND pages larger than copies AND the Printer's speed smaller than copies
            Then reboot is pending.
            Scenario: Copies from speed
            Given the Printer is idle
            When print is executed with inputs file, copies = the Printer's speed AND copies larger than 1 AND "a" is included in the Printer's jobs
            Then start is available.
            Scenario: Any copies
            Given the Printer is idle
            When print is executed with inputs file, copies AND the Printer's speed equal to copies AND file not equal to "b"
            Then start is pending.
        `)).toEqual([
            ['condition', 'Data', 'print', 'not(idle = true)'],
            ['response', 'print', 'reboot', 'copies = 2 and pages > 2 and speed < 2'],
            ['include', 'print', 'start', 'copies = speed and speed > 1 and list contains(jobs, "a")'],
            ['response', 'print', 'start', 'file != "b" and speed = copies']
        ]);
    });

    it('names the activity of a data property Entity.property when another activity has that name', async () => {
        const graph = await graphOf(`
            Scenario: Low
            Given the Printer's level smaller than 2
            When start is executed
            Then the Tray's level is set to 0.
        `, `
            Entity Printer {
                Actions: start
                Data properties: level: int, speed: int
            }
            Entity Tray { Data properties: level: int }
            Role Operator.
            Action start { Initiators: Operator }
        `);
        expect(graph.groups).toEqual([{ name: 'Data', events: ['Printer.level', 'speed', 'Tray.level'] }]);
        expect(graph.relations.map(({ relation, from, to, guard }) => [relation, from, to, guard])).toEqual([
            ['condition', 'Data', 'Data', undefined],
            ['condition', 'Data', 'start', 'not(Printer.level < 2)'],
            ['include', 'start', 'Tray.level', undefined]
        ]);
    });
});

describe('guardText', () => {

    const assertion = (operation: AssertionOperation, value?: Value, negated = false) => new PropertyAssertion('Printer', operation === 'equal to' || operation.endsWith('than') ? 'speed' : 'jobs', negated, operation, value);

    it('writes each property assertion as DCR Solutions writes a guard, and its negation without not()', () => {
        const cases: Array<[PropertyAssertion, string, string]> = [
            [assertion('equal to', 5), 'speed = 5', 'speed != 5'],
            [assertion('larger than', 5), 'speed > 5', 'speed <= 5'],
            [assertion('smaller than', 5), 'speed < 5', 'speed >= 5'],
            [assertion('included in', 'a.pdf'), 'list contains(jobs, "a.pdf")', 'list contains(jobs, "a.pdf") = false'],
            [assertion('empty'), 'count(jobs) = 0', 'count(jobs) > 0'],
            [assertion('full'), 'count(jobs) >= 150', 'count(jobs) < 150']   // the capacity
        ];
        for (const [positive, expected, negatedExpected] of cases) {
            expect(guardText([positive])).toBe(expected);
            expect(guardText([new PropertyAssertion(positive.entity, positive.property, true, positive.operation, positive.value)])).toBe(negatedExpected);
        }
    });

    it('writes values as literals, a property as its activity, and joins assertions with and', () => {
        expect(guardText([
            new PropertyAssertion('Printer', 'label', false, 'equal to', 'say "hi"'),
            new PropertyAssertion('Printer', 'ready', false, 'equal to', true),
            new PropertyAssertion('Print job', 'waiting jobs', false, 'included in', 3),
            new PropertyAssertion('Form', 'time_to_wait', false, 'equal to', 0)
        ], new Map([['Printer.ready', 'Printer.ready']]))).toBe('label = "say \\"hi\\"" and Printer.ready = true and list contains(waiting jobs, 3) and time_to_wait = 0');
        expect(guardText([])).toBeUndefined();
    });
});
