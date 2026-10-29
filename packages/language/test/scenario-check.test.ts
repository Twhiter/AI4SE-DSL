import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { init, killThreads } from 'z3-solver';
import { createEasyServices } from '../src/easy-module.js';
import { buildModel } from '../src/model-builder.js';
import type { Model } from '../src/model.js';
import { checkCrossScenarios, checkScenarios, removeImpliedAssertions, simplifyGiven, type ScenarioResult } from '../src/scenario-check.js';
import { Z3Vocabulary, type Z3Context } from '../src/z3-vocabulary.js';

/** The declarations, with the Printer's `states` (a state a scenario or a specification uses needs a specification, so each test lists the ones it specifies). */
const declarations = (states: string) => `
Entity Printer {
    Actions: start, print
    Data properties: speed: int, ready: boolean, jobs: a list, finished: a list, waiting: a queue, backlog: a queue, names: a queue of string
    ${states ? `States: ${states}` : ''}
}
Role Operator.
Action start { Initiators: Operator }
Action print { Initiators: Operator }
Action reboot { Initiators: Operator }
Action submit { Initiators: Operator, Input: job: string }
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

async function modelOf(text: string): Promise<Model> {
    const { model, errors } = buildModel(await parseHelper(createEasyServices(EmptyFileSystem).Easy)(text, { validation: true }));
    expect(errors).toBeUndefined();
    return model!;
}

/** The only scenario of the declarations with `states` followed by `text`, checked. */
async function checkOne(states: string, text: string): Promise<Omit<ScenarioResult, 'scenario'>> {
    const [{ given, then }] = await checkScenarios(z3, await modelOf(declarations(states) + text));
    return { given, then };
}

const sat = { result: 'sat', conflict: [] };

describe('the conditions of a Given and toZ3 of a Then', () => {

    it('puts each item on the instance in its context', async () => {
        const model = await modelOf(readFileSync('../../examples/sample.easy', 'utf8'));
        const v = new Z3Vocabulary(z3, model);
        const instances = { printer: v.instance('Printer', 'printer') };
        const [print] = model.scenarios;
        const items = (conditions: Array<{ title: string, formula: { toString(): string } }>) =>
            conditions.map(({ title, formula }) => [title, formula.toString().replace(/\s+/g, ' ')]);
        expect(print.given.conditions(v, instances)[0].head).toEqual({ specification: 'Printer is busy', parameters: ['printer'] });
        expect(items(print.given.conditions(v, instances))).toEqual([
            ['the Printer is busy', '(inState printer busy)'],
            ['"report.pdf" is included in the Printer\'s jobs', '(select (jobs printer) (str "report.pdf"))'],
            ["the Printer's speed larger than 2", '(> (speed printer) 2)']
        ]);
        expect(items(print.then.toZ3(v, instances)).slice(0, 2)).toEqual([
            ['print is not available', '(not (available printer print))'],
            ['the Printer\'s jobs is removed with "report.pdf"', '(not (select (jobs printer) (str "report.pdf")))']
        ]);
    });
});

describe('checkScenarios', () => {

    it('finds the scenarios of the example consistent', async () => {
        const results = await checkScenarios(z3, await modelOf(readFileSync('../../examples/sample.easy', 'utf8')));
        expect(results).toEqual([
            { scenario: 'Print job', given: sat, then: sat },
            { scenario: 'Next job', given: sat, then: sat }
        ]);
    });

    it('applies the specifications to the Given', async () => {
        expect(await checkOne('idle', `
            Declarative specification Printer is idle means { the jobs is empty }
            scenario: Jam
            Given the Printer is idle AND "a" is included in the Printer's jobs
            When start is executed
            Then print is pending.
        `)).toEqual({
            given: { result: 'unsat', conflict: ['spec: Printer is idle', 'Given: the Printer is idle', 'Given: "a" is included in the Printer\'s jobs'] },
            then: sat
        });
    });

    it('adds the When action as available to the Given', async () => {
        expect(await checkOne('', `
            print is available means { the ready equal to true }
            scenario: Unready
            Given the Printer's ready equal to false
            When print is executed
            Then print is not available.
        `)).toEqual({
            given: { result: 'unsat', conflict: ['spec: print is available', "Given: the Printer's ready equal to false", 'When: print is available'] },
            then: sat
        });
    });

    it('adds it as enabled instead when it has an enabled specification', async () => {
        expect(await checkOne('', `
            print is enabled means { start was executed }
            scenario: Too early
            Given start was not executed
            When print is executed
            Then print is not available.
        `)).toEqual({
            given: { result: 'unsat', conflict: ['spec: print is enabled', 'Given: start was not executed', 'When: print is enabled'] },
            then: sat
        });
    });

    it('applies the available specification of an enabled When action too', async () => {
        expect(await checkOne('', `
            print is enabled means { start was executed }
            print is available means { the ready equal to true }
            scenario: Unready
            Given the Printer's ready equal to false
            When print is executed
            Then print is not available.
        `)).toEqual({
            given: {
                result: 'unsat',
                conflict: ['spec: print is available', "Given: the Printer's ready equal to false", 'When: print is enabled']   // enabled ⇒ available
            },
            then: sat
        });
    });

    it('converts a named constant of type Any to the type it is used as', async () => {
        expect(await checkOne('', `
            scenario: Jobs
            Given start is available
            When start is executed
            Then the Printer's waiting is dequeued as job AND the Printer's speed is set to job AND the Printer's backlog is enqueued with job.
        `)).toEqual({ given: sat, then: sat });   // an Any job may be an int
    });

    it('uses what the user inputs in the Then, with the type of that input', async () => {
        const submit = (effects: string) => checkOne('', `
            scenario: Submit
            Given submit is available
            When submit is executed with name as input
            Then ${effects}.
        `);
        expect(await submit("the Printer's names is enqueued with name")).toEqual({ given: sat, then: sat });
        expect(await checkOne('', `
            print is pending means { the names is empty }
            scenario: Submit
            Given submit is available
            When submit is executed with name as input
            Then print is pending AND the Printer's names is enqueued with name.
        `)).toEqual({
            given: sat,
            then: { result: 'unsat', conflict: ['spec: print is pending', 'Then: print is pending', "Then: the Printer's names is enqueued with name"] }
        });
    });

    it('adds the When action as executed to the Then, also for an action in no lifecycle', async () => {
        expect(await checkOne('idle', `
            Declarative specification Printer is idle means { the jobs is empty }
            reboot is pending means { reboot was not executed }
            scenario: Restart
            Given the Printer is idle
            When reboot is executed
            Then reboot is pending.
        `)).toEqual({
            given: sat,
            then: { result: 'unsat', conflict: ['spec: reboot is pending', 'Then: reboot is pending', 'When: reboot was executed'] }
        });
    });
});

describe('checkCrossScenarios', () => {

    /** checkCrossScenarios of the declarations with `states` followed by `text`. */
    const cross = async (states: string, text: string) => checkCrossScenarios(z3, await modelOf(declarations(states) + text));

    it('checks the Thens together where a Given implies the other, with the specifications', async () => {
        expect(await cross('busy', `
            Declarative specification Printer is busy means { the speed larger than 5 }
            scenario: Busy
            Given the Printer is busy
            When start is executed
            Then the Printer's speed is set to 1.
            scenario: Fast
            Given the Printer's speed larger than 3
            When start is executed
            Then the Printer's speed is set to 2.
            scenario: Slow
            Given the Printer's speed smaller than 3
            When start is executed
            Then the Printer's speed is set to 3.
        `)).toEqual([{
            scenario: 'Busy', other: 'Fast', indices: [0, 1], equivalent: false,
            then: { result: 'unsat', conflict: ["Then of 'Busy': the Printer's speed is set to 1", "Then of 'Fast': the Printer's speed is set to 2"] }
        }]);   // Busy and Slow, Fast and Slow: neither Given implies the other
    });

    it('finds Thens that agree, and gives two Givens that imply each other to the later scenario', async () => {
        expect(await cross('', `
            print is pending means { print is available }
            scenario: Queue
            Given start is available
            When start is executed
            Then print is pending.
            scenario: Block
            Given start is available
            When start is executed
            Then print is not available.
            scenario: Slow down
            Given start is available AND the Printer's speed larger than 1
            When start is executed
            Then the Printer's speed is set to 1.
        `)).toEqual([
            {
                scenario: 'Block', other: 'Queue', indices: [1, 0], equivalent: true,
                then: { result: 'unsat', conflict: ['spec: print is pending', "Then of 'Queue': print is pending", "Then of 'Block': print is not available"] }
            },
            { scenario: 'Slow down', other: 'Queue', indices: [2, 0], equivalent: false, then: sat },
            { scenario: 'Slow down', other: 'Block', indices: [2, 1], equivalent: false, then: sat }
        ]);   // the When makes start available, so 'start is available' adds nothing
    });

    it('compares scenarios with the same When only: the same action, with equal inputs or named constants in the same places', async () => {
        const submit = (name: string, input: string, effect: string) => `
            scenario: ${name}
            Given submit is available
            When submit is executed with ${input} as input
            Then the Printer's jobs is ${effect}.
        `;
        const pairs = async (text: string) => (await cross('', text)).map(({ scenario, other, then }) => [scenario, other, then.result]);
        expect(await pairs(submit('One', '"a"', 'added with "a"') + submit('Two', '"b"', 'removed with "a"'))).toEqual([]);
        expect(await pairs(submit('One', '"a"', 'added with "a"') + submit('Two', 'job', 'removed with "a"'))).toEqual([]);
        expect(await pairs(submit('One', '"a"', 'added with "a"') + submit('Two', '"a"', 'removed with "a"'))).toEqual([['Two', 'One', 'unsat']]);
        // what the user inputs is the same in both, whatever its name
        expect(await pairs(submit('One', 'job', 'added with job') + submit('Two', 'item', 'removed with item'))).toEqual([['Two', 'One', 'unsat']]);
    });

    /** Two scenarios with the same Given and When, with these Thens. */
    const twoThens = (one: string, two: string) => cross('', [['One', one], ['Two', two]].map(([name, then]) => `
        scenario: ${name}
        Given start is available
        When start is executed
        Then ${then}.
    `).join(''));

    it('aligns the named constants of the same assignment in both Thens: the same property and operation', async () => {
        expect(await twoThens(
            "the Printer's waiting is dequeued as job AND the Printer's jobs is added with job",
            "the Printer's waiting is dequeued as job AND the Printer's jobs is removed with job"
        )).toEqual([{
            scenario: 'Two', other: 'One', indices: [1, 0], equivalent: true,
            then: { result: 'unsat', conflict: ["Then of 'One': the Printer's jobs is added with job", "Then of 'Two': the Printer's jobs is removed with job",
                "alignment: job in 'One' = job in 'Two' (the Printer's waiting is dequeued)"] }
        }]);
        expect(await twoThens(
            "the Printer's waiting is dequeued as first AND the Printer's jobs is added with first AND the Printer's finished is added with first",
            "the Printer's backlog is dequeued as second AND the Printer's jobs is added with second AND the Printer's finished is removed with second"
        )).toEqual([{
            scenario: 'Two', other: 'One', indices: [1, 0], equivalent: true,
            then: { result: 'unsat', conflict: ["Then of 'One': the Printer's finished is added with first", "Then of 'Two': the Printer's finished is removed with second",
                "alignment: first in 'One' = second in 'Two' (the Printer's jobs is added with)"] }
        }]);
    });

    it('does not align other named constants, also with the same name: another property, operation, or a value', async () => {
        expect(await twoThens(
            "the Printer's waiting is dequeued as job AND the Printer's jobs is added with job",
            "the Printer's backlog is dequeued as job AND the Printer's jobs is removed with job"
        )).toEqual([{ scenario: 'Two', other: 'One', indices: [1, 0], equivalent: true, then: sat }]);
        expect(await twoThens(
            "the Printer's waiting is dequeued as first AND the Printer's jobs is added with first AND the Printer's finished is added with first",
            "the Printer's backlog is dequeued as second AND the Printer's jobs is added with 1 AND the Printer's finished is removed with second"
        )).toEqual([{ scenario: 'Two', other: 'One', indices: [1, 0], equivalent: true, then: sat }]);
    });

    it('leaves out a pair whose Given or Then cannot hold on its own, as checkScenarios reports it', async () => {
        expect(await cross('', `
            scenario: Impossible
            Given start is not available
            When start is executed
            Then the Printer's speed is set to 1.
            scenario: Contradicting
            Given start is available
            When start is executed
            Then the Printer's speed is set to 1 AND the Printer's speed is set to 3.
            scenario: Plain
            Given start is available
            When start is executed
            Then the Printer's speed is set to 2.
        `)).toEqual([]);
    });
});

describe('simplifyGiven', () => {

    /** The simplification of the only scenario of the declarations with `states` followed by `text`. */
    async function simplify(states: string, text: string) {
        const model = await modelOf(declarations(states) + text);
        return simplifyGiven(z3, model, model.scenarios[0]);
    }

    it('removes what the facts imply, also after replacing a state by its specification', async () => {
        expect(await simplify('busy', `
            Declarative specification Printer is busy means { print is available AND the speed larger than 0 }
            print is available means { the ready equal to true AND the speed larger than 1 }
            scenario: Normal
            Given the Printer is busy AND the Printer's ready equal to true
            When print is executed
            Then print is not available.
        `)).toMatchObject({
            scenario: 'Normal',
            titles: [],
            steps: [
                { term: "the Printer's ready equal to true", step: 'implied' },          // print is available (the When) means …
                { term: 'the Printer is busy', step: 'decomposed', call: 'Printer is busy(printer)', into: ['print is available', "the Printer's speed larger than 0"] },
                { term: 'print is available', step: 'implied' },                         // the When
                { term: "the Printer's speed larger than 0", step: 'implied' }           // speed > 1
            ]
        });
    });

    it('counts the available specification of an enabled When action as facts', async () => {
        expect(await simplify('', `
            print is enabled means { start was executed }
            print is available means { the ready equal to true }
            scenario: Ready
            Given print is available AND start was executed AND the Printer's ready equal to true
            When print is executed
            Then print is not available.
        `)).toMatchObject({
            titles: [],
            steps: [
                { term: 'print is available', step: 'implied' },                       // print is enabled (the When), so available
                { term: 'start was executed', step: 'implied' },                       // print is enabled means …
                { term: "the Printer's ready equal to true", step: 'implied' }         // print is available means …
            ]
        });
    });

    it('keeps what the facts do not imply and no specification can replace', async () => {
        expect(await simplify('', `
            start is available means { print is pending }
            scenario: Fast
            Given the Printer's speed larger than 3 AND print is pending
            When start is executed
            Then print is pending.
        `)).toMatchObject({
            titles: ["the Printer's speed larger than 3"],
            steps: [{ term: 'print is pending', step: 'implied' }]
        });
    });

    it('uses each specification once per parameters, so a cycle stops at the term it comes back to', async () => {
        expect(await simplify('busy, online', `
            Declarative specification Printer is busy means { it is online }
            Declarative specification Printer is online means { it is busy }
            scenario: Loop
            Given the Printer is busy
            When start is executed
            Then print is pending.
        `)).toMatchObject({
            titles: ['the Printer is busy'],
            given: { states: [['Printer', 'busy']], statesCtx: [['printer']] },   // a state only stays through a cycle
            cycles: [{ terms: ['the Printer is busy', 'the Printer is online', 'the Printer is busy'], specifications: ['Printer is busy', 'Printer is online'] }],
            steps: [
                { term: 'the Printer is busy', step: 'decomposed', call: 'Printer is busy(printer)', into: ['the Printer is online'] },
                { term: 'the Printer is online', step: 'decomposed', call: 'Printer is online(printer)', into: ['the Printer is busy'] },
                { term: 'the Printer is busy', step: 'cycle', call: 'Printer is busy(printer)' }
            ]
        });
    });

    it('finds a cycle through action statuses, and reports it once', async () => {
        const { titles, cycles, steps } = await simplify('', `
            start is pending means { print is pending }
            print is pending means { start is pending }
            scenario: Waiting
            Given start is pending AND the Printer's speed larger than 2
            When start is executed
            Then print is pending.
        `);
        expect(titles).toEqual(['start is pending', "the Printer's speed larger than 2"]);
        expect(cycles).toEqual([{
            terms: ['start is pending', 'print is pending', 'start is pending'],
            specifications: ['start is pending', 'print is pending']
        }]);
        expect(steps.filter(({ step }) => step === 'cycle')).toEqual([{ term: 'start is pending', step: 'cycle', call: 'start is pending(printer)' }]);
    });

    it('removes a term reached again on another path, without a cycle: its specification was used already', async () => {
        expect(await simplify('busy, idle, online', `
            Declarative specification Printer is busy means { it is online }
            Declarative specification Printer is idle means { print is pending }
            print is pending means { it is online }
            Declarative specification Printer is online means { the speed larger than 0 }
            scenario: Diamond
            Given the Printer is busy AND the Printer is idle
            When start is executed
            Then print is pending.
        `)).toMatchObject({
            titles: ["the Printer's speed larger than 0"],
            cycles: [],
            steps: [
                { term: 'the Printer is busy', step: 'decomposed', into: ['the Printer is online'] },
                { term: 'the Printer is idle', step: 'decomposed', into: ['print is pending'] },
                { term: 'the Printer is online', step: 'decomposed', into: ["the Printer's speed larger than 0"] },
                { term: 'print is pending', step: 'decomposed', into: ['the Printer is online'] },
                { term: 'the Printer is online', step: 'repeated', call: 'Printer is online(printer)' }   // busy → online, idle → pending → online
            ]
        });
    });

    it('gives the simplified Given back as a Given, with contexts', async () => {
        const { given, titles } = await simplify('busy, online', `
            Declarative specification Printer is busy means { it is online AND print is pending AND the jobs is not empty }
            Declarative specification Printer is online means { the ready equal to true }
            scenario: Structure
            Given the Printer is busy AND the Printer's speed larger than 3
            When start is executed
            Then print is pending.
        `);
        expect(titles).toEqual([
            'print is pending', "the Printer's ready equal to true", "the Printer's jobs is not empty",    // in place of 'busy', and of 'online'
            "the Printer's speed larger than 3"
        ]);
        expect(given).toMatchObject({
            states: [], statesCtx: [],
            pendings: ['print'], pendingsCtx: [['printer']],
            dataAssertions: [
                { entity: 'Printer', property: 'ready', negated: false, operation: 'equal to', value: true },
                { entity: 'Printer', property: 'jobs', negated: true, operation: 'empty' },
                { entity: 'Printer', property: 'speed', negated: false, operation: 'larger than', value: 3 }
            ],
            dataAssertionsCtx: [['printer'], ['printer'], ['printer']]
        });
        expect(given.statusTitles()).toEqual(['print is pending']);   // the action statuses only
    });

    it('replaces a negated status only by the specification with that negated head', async () => {
        const { titles, given, steps } = await simplify('', `
            print is available means { the speed larger than 0 }
            print is not available means { print is not pending }
            scenario: Negative
            Given print is not available
            When start is executed
            Then print is pending.
        `);
        expect(steps).toEqual([{ term: 'print is not available', step: 'decomposed', call: 'print is not available(printer)', into: ['print is not pending'] }]);
        expect(titles).toEqual(['print is not pending']);
        expect(given).toMatchObject({ notPendings: ['print'], notPendingsCtx: [['printer']] });
    });

    it('removes a data condition the facts imply, and keeps a stronger one (facts: speed > 3)', async () => {
        expect(await simplify('', `
            print is available means { the speed larger than 3 }
            scenario: Speed
            Given the Printer's speed larger than 1 AND the Printer's speed larger than 5
            When print is executed
            Then print is not available.
        `)).toMatchObject({
            titles: ["the Printer's speed larger than 5"],
            steps: [{ term: "the Printer's speed larger than 1", step: 'implied' }]
        });
    });

    it('knows that a list or queue with an element is not empty, but may be full', async () => {
        expect(await simplify('', `
            print is available means { "a" is included in the jobs AND 1 is included in the waiting }
            scenario: Lists
            Given the Printer's jobs is not empty AND the Printer's waiting is not empty AND the Printer's waiting is not full
            When print is executed
            Then print is not available.
        `)).toMatchObject({
            titles: ["the Printer's waiting is not full"],
            steps: [
                { term: "the Printer's jobs is not empty", step: 'implied' },
                { term: "the Printer's waiting is not empty", step: 'implied' }
            ]
        });
    });

    it('gives an action in no lifecycle an empty context', async () => {
        const { titles, given, steps } = await simplify('', `
            reboot is available means { reboot is pending }
            scenario: Restart
            Given reboot is available
            When start is executed
            Then print is pending.
        `);
        expect(steps).toMatchObject([{ term: 'reboot is available', call: 'reboot is available()' }]);   // no parameters
        expect(titles).toEqual(['reboot is pending']);
        expect(given).toMatchObject({ pendings: ['reboot'], pendingsCtx: [[]] });
    });
});

describe('removeImpliedAssertions', () => {

    /** The Given of the only scenario of the declarations followed by `text`, without the property assertions the others imply. */
    async function remove(text: string) {
        const model = await modelOf(declarations('') + text);
        const [scenario] = model.scenarios;
        const given = await removeImpliedAssertions(z3, model, scenario, scenario.given);
        return { assertions: given.dataAssertions.map(assertion => assertion.title), pendings: given.pendings };
    }

    /** A scenario with the Given `given`, when start is executed. */
    const scenario = (given: string) => `
        scenario: Check
        Given ${given}
        When start is executed
        Then print is not available.
    `;

    it('removes the property assertions that the others imply, and keeps the other terms', async () => {
        expect(await remove(scenario(`print is pending AND "a" is included in the Printer's jobs AND the Printer's jobs is not empty
            AND the Printer's speed larger than 2 AND the Printer's speed larger than 0`))).toEqual({
            assertions: [`"a" is included in the Printer's jobs`, "the Printer's speed larger than 2"],
            pendings: ['print']
        });
    });

    it('keeps the first of two that imply each other', async () => {
        expect((await remove(scenario("the Printer's speed larger than 2 AND the Printer's speed not smaller than 3"))).assertions)
            .toEqual(["the Printer's speed larger than 2"]);
        expect((await remove(scenario("the Printer's speed not smaller than 3 AND the Printer's speed larger than 2"))).assertions)
            .toEqual(["the Printer's speed not smaller than 3"]);
    });

    it('uses the specifications and the When as facts', async () => {
        expect((await remove(`
            start is available means { the speed smaller than 10 }
            ${scenario("the Printer's speed larger than 8 AND the Printer's speed equal to 9")}
        `)).assertions).toEqual(["the Printer's speed larger than 8"]);   // start is available, so the speed is smaller than 10: 9
    });
});
