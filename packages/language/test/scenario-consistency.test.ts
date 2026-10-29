import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { init, killThreads } from 'z3-solver';
import { createEasyServices } from '../src/easy-module.js';
import { buildModel } from '../src/model-builder.js';
import type { Model } from '../src/model.js';
import { checkCrossScenarios, checkScenarios, type ScenarioResult } from '../src/scenario-consistency.js';
import type { Z3Context } from '../src/z3-vocabulary.js';

const DECLARATIONS = `
Entity Printer {
    Actions: start, print
    Data properties: speed: int, jobs: a list of string, waiting: a queue
    States: busy
}
Role Operator.
Action start { Initiators: Operator }
Action print { Initiators: Operator }
Action reboot { Initiators: Operator }
Declarative specification Printer is busy means { the jobs is not empty }
Action print is enabled means { start was executed or is not available }
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

/** checkScenarios of one scenario after the declarations. */
async function scenario(given: string, when: string, then: string): Promise<Omit<ScenarioResult, 'scenario'>> {
    const [{ scenario: _, ...result }] = await checkScenarios(z3, await modelOf(`${DECLARATIONS}
        Scenario: Check
        Given ${given}
        When ${when} is executed
        Then ${then}.`));
    return result;
}

const sat = { result: 'sat', conflict: [] };

describe('checkScenarios', () => {

    it('finds the scenarios of the example consistent', async () => {
        const results = await checkScenarios(z3, await modelOf(readFileSync('../../examples/sample.easy', 'utf8')));
        expect(results).toEqual([
            { scenario: 'Print job', given: sat, then: sat },
            { scenario: 'Next job', given: sat, then: sat }
        ]);
    });

    it('needs the Given to hold with the Declarative specifications', async () => {
        expect(await scenario("the Printer is busy AND the Printer's jobs is empty", 'start', 'print is pending')).toEqual({
            given: { result: 'unsat', conflict: ['spec: Printer is busy', 'Given: the Printer is busy', "Given: the Printer's jobs is empty"] },
            then: sat
        });
    });

    it('needs the When action to be enabled, as its enabled specification says', async () => {
        // print is enabled exactly when start was executed or is not available, and print is available
        expect((await scenario('start is available AND start was not executed', 'print', 'reboot is pending')).given).toEqual({
            result: 'unsat',
            conflict: ['spec: print is enabled', 'Given: start is available', 'Given: start was not executed', 'When: print is enabled']
        });
        expect((await scenario('print is not available', 'print', 'reboot is pending')).given).toEqual({
            result: 'unsat', conflict: ['spec: print is enabled', 'Given: print is not available', 'When: print is enabled']
        });
    });

    it('needs the When action to be available when it has no enabled specification', async () => {
        expect((await scenario('start is not available', 'start', 'print is pending')).given)
            .toEqual({ result: 'unsat', conflict: ['Given: start is not available', 'When: start is enabled'] });
        expect((await scenario('reboot is not available', 'reboot', 'print is pending')).given)
            .toEqual({ result: 'unsat', conflict: ['Given: reboot is not available', 'When: reboot is enabled'] });
    });

    it('finds the Givens of the given-contradicts-when example that rule out their When', async () => {
        const results = await checkScenarios(z3, await modelOf(readFileSync('../../examples/given-contradicts-when.easy', 'utf8')));
        expect(results).toEqual([
            { scenario: 'Unready printer', given: { result: 'unsat', conflict: ['Given: print is not available', 'When: print is enabled'] }, then: sat },
            {
                scenario: 'Pending print',   // a pending print stops start while print is available
                given: { result: 'unsat', conflict: ['spec: start is enabled', 'Given: print is available', 'Given: print is pending', 'When: start is enabled'] },
                then: sat
            }
        ]);
    });

    it("reads 'is enabled' in a Given as the action's enabledness", async () => {
        expect((await scenario('print is enabled AND print is not available', 'start', 'reboot is pending')).given)
            .toEqual({ result: 'unsat', conflict: ['spec: print is enabled', 'Given: print is not available', 'Given: print is enabled'] });
        expect((await scenario('print is enabled AND start is not available', 'reboot', 'print is pending')).given).toEqual(sat);
    });

    it('needs the Then to hold, with the When action executed', async () => {
        expect((await scenario('start is available', 'start', 'print is available AND print is not available')).then)
            .toEqual({ result: 'unsat', conflict: ['Then: print is available', 'Then: print is not available'] });
        expect((await scenario('start is available', 'start', "the Printer's speed is set to 3 AND the Printer's speed is set to 5")).then)
            .toEqual({ result: 'unsat', conflict: ["Then: the Printer's speed is set to 3", "Then: the Printer's speed is set to 5"] });
        expect((await scenario('start is available', 'start', `"a" is added to the Printer's jobs AND the Printer's jobs is removed with "a"`)).then)
            .toEqual({ result: 'unsat', conflict: [`Then: the Printer's jobs is added with "a"`, `Then: the Printer's jobs is removed with "a"`] });
    });

    it('finds the Thens of the then-contradicts-itself example that cannot hold', async () => {
        const results = await checkScenarios(z3, await modelOf(readFileSync('../../examples/then-contradicts-itself.easy', 'utf8')));
        expect(results).toEqual([
            { scenario: 'Toggle print', given: sat, then: { result: 'unsat', conflict: ['Then: print is available', 'Then: print is not available'] } },
            { scenario: 'Set speed', given: sat, then: { result: 'unsat', conflict: ["Then: the Printer's speed is set to 3", "Then: the Printer's speed is set to 5"] } },
            {
                scenario: 'Finish job', given: sat,
                then: { result: 'unsat', conflict: [`Then: the Printer's jobs is removed with "report.pdf"`, `Then: the Printer's jobs is added with "report.pdf"`] }
            }
        ]);
    });

    it('tells the Given\'s time and the Then\'s apart: a Then does not change what the Given says', async () => {
        // before: print is available; after: it is not
        expect(await scenario('print is available AND start is not available', 'print', 'print is not available'))
            .toEqual({ given: sat, then: sat });
        // the same for an action in no lifecycle, whose statuses belong to no instance
        expect(await scenario('reboot is available', 'start', 'reboot is not available')).toEqual({ given: sat, then: sat });
    });
});

const PEOPLE = `
Entity Person {
    Actions: register
    Data properties: age: int, name: string, tags: a list of string
    States: adult
}
Role Clerk.
Action register { Initiators: Clerk, Input: name: string, age: int, Output: is_adult: boolean, member: string }
Declarative specification Person is adult means { the age larger than 17 }
`;

/** checkScenarios of one scenario whose When executes register, with what follows 'is executed' in `when`. */
async function register(given: string, when: string, then: string): Promise<Omit<ScenarioResult, 'scenario'>> {
    const [{ scenario: _, ...result }] = await checkScenarios(z3, await modelOf(`${PEOPLE}
        Scenario: Register
        Given ${given}
        When register is executed${when}
        Then ${then}.`));
    return result;
}

describe('checkScenarios: the When, and properties without a value', () => {

    it('adds what the When says to the Given; the Then uses its inputs and outputs by name', async () => {
        expect(await register("the Person's name is undefined", ' with inputs name = "Ann", age, outputs is_adult = true AND age larger than 17',
            "the Person's name is set to name AND the Person's age is set to age")).toEqual({ given: sat, then: sat });
        expect(await register('register is available', '', "the Person's age is set to 3")).toEqual({ given: sat, then: sat });   // any inputs
    });

    it("needs the When to hold with the Given: an input that is data, the When's assertions about data", async () => {
        expect(await register("the Person's age is undefined", " with inputs age = the Person's age", 'register is pending')).toEqual({
            given: { result: 'unsat', conflict: ["Given: the Person's age is undefined", "When: the Person's age equal to age"] },
            then: sat
        });
        expect((await register('the Person is adult', " AND the Person's age smaller than 10", 'register is pending')).given).toEqual({
            result: 'unsat', conflict: ['spec: Person is adult', 'Given: the Person is adult', "When: the Person's age smaller than 10"]
        });
    });

    it("checks what the When says about its inputs with the Given, and about its outputs with the Then", async () => {
        // a scenario that can never apply: its Then is not checked
        expect(await register('register is available', ' with inputs age AND age larger than 17 AND age smaller than 10', 'register is pending'))
            .toEqual({ given: { result: 'unsat', conflict: ['When: age larger than 17', 'When: age smaller than 10'] }, then: sat });
        expect(await register('register is available', ' with outputs is_adult = true AND is_adult equal to false', 'register is pending'))
            .toEqual({ given: sat, then: { result: 'unsat', conflict: ['When: is_adult = true', 'When: is_adult equal to false'] } });
    });

    it('knows in the Then what the When says about its inputs', async () => {
        expect((await register('register is available', ' with inputs age = 2', "the Person's age is set to age AND the Person's age is set to 3")).then)
            .toEqual({ result: 'unsat', conflict: ['When: age = 2', "Then: the Person's age is set to age", "Then: the Person's age is set to 3"] });
        expect((await register('register is available', ' with inputs age = 3', "the Person's age is set to age AND the Person's age is set to 3")).then)
            .toEqual(sat);
    });

    it("reads every assertion but 'is (not) undefined' as saying that the property has a value", async () => {
        expect((await register("the Person's age is undefined AND the Person's age not larger than 2", '', 'register is pending')).given)
            .toEqual({ result: 'unsat', conflict: ["Given: the Person's age is undefined", "Given: the Person's age not larger than 2"] });
        expect((await register("the Person's name is undefined AND the Person's name is not undefined", '', 'register is pending')).given)
            .toEqual({ result: 'unsat', conflict: ["Given: the Person's name is undefined", "Given: the Person's name is not undefined"] });
        expect((await register("the Person is adult AND the Person's age is undefined", '', 'register is pending')).given)
            .toEqual({ result: 'unsat', conflict: ['spec: Person is adult', 'Given: the Person is adult', "Given: the Person's age is undefined"] });
    });

    it('checks the Then over the whole step: an input or output that is data is that data at the Given\'s time', async () => {
        // the input is the Person's age before the step, which is larger than 17, so it cannot be 10
        expect((await register("the Person's age larger than 17", " with inputs age = the Person's age",
            "the Person's age is set to age AND the Person's age is set to 10")).then).toEqual({
            result: 'unsat', conflict: [
                "Given: the Person's age larger than 17", "When: the Person's age equal to age",
                "Then: the Person's age is set to age", "Then: the Person's age is set to 10"
            ]
        });
        // an output too, though what the When says about it is at the Then's time
        expect((await register(`the Person's name equal to "Ann"`, " with outputs member = the Person's name",
            `the Person's name is set to member AND the Person's name is set to "Bob"`)).then).toEqual({
            result: 'unsat', conflict: [
                `Given: the Person's name equal to "Ann"`, "When: the Person's name equal to member",
                "Then: the Person's name is set to member", `Then: the Person's name is set to "Bob"`
            ]
        });
        // a property the Then sets is that value at the Then's time, whatever it was at the Given's
        expect(await register('the Person\'s age equal to 3', ' with inputs age = 20', "the Person's age is set to age")).toEqual({ given: sat, then: sat });
    });

    it('empties a list or queue with set to empty', async () => {
        expect((await register('register is available', '', `the Person's tags is set to empty AND "a" is added to the Person's tags`)).then)
            .toEqual({ result: 'unsat', conflict: ["Then: the Person's tags is set to empty", `Then: the Person's tags is added with "a"`] });
    });
});

describe('checkCrossScenarios', () => {

    /** checkCrossScenarios of `scenarios` after the declarations, without the action and the indices. */
    async function cross(scenarios: string): Promise<Array<{ scenarios: string[], inputs: string[], conflict: string[] }>> {
        const results = await checkCrossScenarios(z3, await modelOf(DECLARATIONS + `
            Action tune { Initiators: Operator, Input: level: int }
            Action submit { Initiators: Operator, Input: job: string }
            Action pair { Initiators: Operator, Input: first: int, second: int }
            ${scenarios}`));
        return results.map(({ scenarios, inputs, conflict }) => ({ scenarios, inputs, conflict }));
    }

    it('finds the scenarios with the same When that can apply together, but whose Thens cannot hold together', async () => {
        const results = await checkCrossScenarios(z3, await modelOf(readFileSync('../../examples/cross-scenario.easy', 'utf8')));
        expect(results).toEqual([
            {
                action: 'print', scenarios: ['Rush job', 'Fast job'], indices: [0, 1], inputs: [],   // busy means a speed larger than 5
                conflict: ["Rush job: the Printer's speed is set to 10", "Fast job: the Printer's speed is set to 3"]
            },
            {
                action: 'submit', scenarios: ['Submit', 'Resubmit'], indices: [3, 4], inputs: ['job is a string other than "draft"'],
                conflict: ["Submit: the Printer's jobs is added with job", "Resubmit: the Printer's jobs is removed with job"]
            },
            {
                action: 'submit', scenarios: ['Submit', 'Submit draft'], indices: [3, 5], inputs: ['job = "draft"'],
                conflict: ["Submit: the Printer's jobs is added with job", `Submit draft: the Printer's jobs is removed with "draft"`]
            },
            {
                action: 'take', scenarios: ['Take job', 'Drop job'], indices: [6, 7], inputs: [],    // aligned: job = next
                conflict: [
                    "Take job: the Printer's waiting is dequeued as job", "Take job: the Printer's jobs is added with job",
                    "Drop job: the Printer's waiting is dequeued as next", "Drop job: the Printer's jobs is removed with next"
                ]
            }
        ]);
        // and none for Slow job, whose Given cannot hold with Rush job's or Fast job's, nor for Resubmit and Submit draft,
        // whose Thens agree
    });

    it('needs the Thens to hold for every input, not just for some', async () => {
        // only an input of 3 lets both hold
        expect(await cross(`
            Scenario: Any speed
            Given tune is available
            When tune is executed with inputs level
            Then the Printer's speed is set to level.
            Scenario: Speed three
            Given tune is available
            When tune is executed
            Then the Printer's speed is set to 3.`)).toEqual([{
            scenarios: ['Any speed', 'Speed three'], inputs: ['level is an int other than 3'],
            conflict: ["Any speed: the Printer's speed is set to level", "Speed three: the Printer's speed is set to 3"]
        }]);
        // for every input, the input can be in the jobs and the last of the waiting
        expect(await cross(`
            Scenario: Submit
            Given submit is available
            When submit is executed with inputs job
            Then job is added to the Printer's jobs.
            Scenario: Queue it
            Given submit is available
            When submit is executed with inputs job
            Then the Printer's waiting is enqueued with job.`)).toEqual([]);
    });

    it('compares a variable input with each value, but never two different values', async () => {
        // Level one and Level three never apply together (the input cannot be 1 and 3), so their Thens (2, 4) do not matter
        expect(await cross(`
            Scenario: Any level
            Given tune is available
            When tune is executed with inputs level
            Then the Printer's speed is set to level.
            Scenario: Level one
            Given tune is available
            When tune is executed with inputs level = 1
            Then the Printer's speed is set to 2.
            Scenario: Level three
            Given tune is available
            When tune is executed with inputs level = 3
            Then the Printer's speed is set to 4.`)).toEqual([
            {
                scenarios: ['Any level', 'Level one'], inputs: ['level = 1'],
                conflict: ["Any level: the Printer's speed is set to level", "Level one: the Printer's speed is set to 2"]
            },
            {
                scenarios: ['Any level', 'Level three'], inputs: ['level = 3'],
                conflict: ["Any level: the Printer's speed is set to level", "Level three: the Printer's speed is set to 4"]
            }
        ]);
    });

    it('covers two inputs: their values, and other values, equal or not', async () => {
        expect(await cross(`
            Scenario: One three
            Given pair is available
            When pair is executed with inputs first = 1, second = 3
            Then the Printer's speed is set to 2.
            Scenario: First
            Given pair is available
            When pair is executed with inputs first, second
            Then the Printer's speed is set to first.
            Scenario: Second
            Given pair is available
            When pair is executed with inputs second, first
            Then the Printer's speed is set to second.`)).toEqual([
            {
                scenarios: ['One three', 'First'], inputs: ['first = 1', 'second = 3'],
                conflict: ["One three: the Printer's speed is set to 2", "First: the Printer's speed is set to first"]
            },
            {
                scenarios: ['One three', 'Second'], inputs: ['first = 1', 'second = 3'],
                conflict: ["One three: the Printer's speed is set to 2", "Second: the Printer's speed is set to second"]
            },
            {   // first and second differ
                scenarios: ['First', 'Second'], inputs: ['first is an int other than 1, 2, 3', 'second is an int other than 1, 2, 3, first'],
                conflict: ["First: the Printer's speed is set to first", "Second: the Printer's speed is set to second"]
            }
        ]);
    });

    it('leaves out scenarios whose Givens cannot hold together, or whose inputs differ', async () => {
        expect(await cross(`
            Scenario: Busy
            Given the Printer is busy
            When print is executed
            Then reboot is available.
            Scenario: Empty
            Given the Printer's jobs is empty
            When print is executed
            Then reboot is not available.
            Scenario: Three
            Given tune is available
            When tune is executed with inputs level = 3
            Then the Printer's speed is set to 3.
            Scenario: Four
            Given tune is available
            When tune is executed with inputs level = 4
            Then the Printer's speed is set to 4.`)).toEqual([]);   // busy means the jobs is not empty
    });

    it('leaves out a scenario that does not hold on its own', async () => {
        expect(await cross(`
            Scenario: Impossible
            Given the Printer is busy AND the Printer's jobs is empty
            When print is executed
            Then reboot is pending.
            Scenario: Possible
            Given print is available
            When print is executed
            Then reboot is not available.`)).toEqual([]);
    });
});

describe('checkCrossScenarios: the inputs and outputs of a step', () => {

    /** checkCrossScenarios of `scenarios` about a Person, after PEOPLE, without the action and the indices. */
    async function cross(scenarios: string): Promise<Array<{ scenarios: string[], inputs: string[], conflict: string[] }>> {
        const results = await checkCrossScenarios(z3, await modelOf(PEOPLE + scenarios));
        return results.map(({ scenarios, inputs, conflict }) => ({ scenarios, inputs, conflict }));
    }

    const ADULT = `
        Scenario: Adult
        Given the Person's age larger than 17
        When register is executed with inputs age, outputs is_adult = true
        Then the Person's tags is set to empty.`;

    it('takes outputs as independent of the inputs: other outputs are another case, not a conflict', async () => {
        expect(await cross(`${ADULT}
            Scenario: Not adult
            Given the Person's age larger than 17
            When register is executed with inputs age, outputs is_adult = false
            Then "minor" is added to the Person's tags.`)).toEqual([]);
    });

    it('finds a conflict where the cases overlap: at the outputs both allow', async () => {
        expect(await cross(`${ADULT}
            Scenario: Anyone
            Given the Person's age larger than 17
            When register is executed
            Then "minor" is added to the Person's tags.`)).toEqual([{
            scenarios: ['Adult', 'Anyone'], inputs: ['is_adult = true'],
            conflict: ["Adult: the Person's tags is set to empty", `Anyone: the Person's tags is added with "minor"`]
        }]);
    });

    it('applies comparisons of the inputs: scenarios apply together only where all of theirs hold', async () => {
        expect(await cross(`
            Scenario: Adult age
            Given register is available
            When register is executed with inputs age AND age larger than 17
            Then the Person's age is set to 1.
            Scenario: Thirty
            Given register is available
            When register is executed with inputs age = 30
            Then the Person's age is set to 2.
            Scenario: Child age
            Given register is available
            When register is executed with inputs age AND age smaller than 10
            Then the Person's age is set to 3.`)).toEqual([{
            scenarios: ['Adult age', 'Thirty'], inputs: ['age = 30'],
            conflict: ["Adult age: the Person's age is set to 1", "Thirty: the Person's age is set to 2"]
        }]);
    });

    it('checks the Givens at the inputs where the Thens conflict', async () => {
        // the Thens differ for every age but 5, and Five applies only at 5
        expect(await cross(`
            Scenario: Five
            Given register is available
            When register is executed with inputs age AND age equal to 5
            Then the Person's age is set to age.
            Scenario: Set five
            Given register is available
            When register is executed with inputs age
            Then the Person's age is set to 5.`)).toEqual([]);
    });

    it('relates an input that is data to the state before the step', async () => {
        const known = (age: number) => cross(`
            Scenario: Known adult
            Given the Person's age larger than 17
            When register is executed with inputs age = the Person's age
            Then the Person's tags is set to empty.
            Scenario: Set age
            Given register is available
            When register is executed with inputs age = ${age}
            Then "minor" is added to the Person's tags.`);
        expect(await known(10)).toEqual([]);   // the Person's age is the input, which is 10: not larger than 17
        expect(await known(20)).toEqual([{
            scenarios: ['Known adult', 'Set age'], inputs: ['age = 20'],
            conflict: ["Known adult: the Person's tags is set to empty", `Set age: the Person's tags is added with "minor"`]
        }]);
    });
});
