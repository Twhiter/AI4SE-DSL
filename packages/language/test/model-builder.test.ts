import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEasyServices } from '../src/easy-module.js';
import { buildModel } from '../src/model-builder.js';
import { Comparison, NamedConstant } from '../src/model.js';

/** Parses and validates `text` in a workspace of its own. */
async function build(text: string, validation = true) {
    return buildModel(await parseHelper(createEasyServices(EmptyFileSystem).Easy)(text, { validation }));
}

describe('buildModel', () => {

    it('builds the declarations of the example', async () => {
        const { model } = await build(readFileSync('../../examples/sample.easy', 'utf8'));
        expect(model?.entities).toMatchObject([{
            name: 'Printer',
            actions: ['start', 'print'],
            states: ['online', 'idle', 'busy'],
            dataProperties: [
                { name: 'speed', type: 'int' }, { name: 'ready', type: 'boolean' }, { name: 'jobs', type: 'list' }, { name: 'waiting', type: 'queue' }
            ]
        }]);
        expect(model?.actions).toEqual(['start', 'print', 'reboot']);
        expect(model?.inputs).toEqual({ start: [], print: [{ name: 'file', type: 'string' }, { name: 'copies', type: 'int' }], reboot: [] });
        expect(model?.outputs).toEqual({ start: [], print: [], reboot: [] });
    });

    it('builds specifications, with the implicit entity filled in', async () => {
        const { model } = await build(readFileSync('../../examples/sample.easy', 'utf8'));
        expect(model?.stateSpecifications[0]).toEqual({
            entity: 'Printer', state: 'busy', states: ['online'],
            availables: ['print'], notAvailables: [], pendings: ['print'], notPendings: [], executed: [], notExecuted: [], enableds: [],
            dataAssertions: [{ entity: 'Printer', property: 'jobs', negated: true, operation: 'empty', value: undefined, byEquals: false }]
        });
        expect(model?.enabledSpecifications).toEqual([{ action: 'print', conditions: ['start'], milestones: ['reboot'] }]);
    });

    it("builds 'is enabled' in a Declarative specification and a Given", async () => {
        const { model } = await build(`
            Entity Printer { Actions: start, print  States: busy }
            Role Operator.
            Action start { Initiators: Operator }
            Action print { Initiators: Operator }
            Action reboot { Initiators: Operator }
            Declarative specification Printer is busy means { print is enabled AND reboot is enabled }
            Action print is enabled means { start was executed or is not available AND start is not pending or is not available }
            Scenario: Restart
            Given reboot is enabled AND print is enabled
            When start is executed
            Then print is pending AND reboot is not available.`);
        expect(model!.stateSpecifications[0].enableds).toEqual(['print', 'reboot']);
        expect(model!.enabledSpecifications).toEqual([{ action: 'print', conditions: ['start'], milestones: ['start'] }]);
        const [restart] = model!.scenarios;
        expect(restart.given).toMatchObject({ enableds: ['reboot', 'print'], enabledsCtx: [[], ['printer']] });   // reboot is in no lifecycle
        expect(restart.then).toMatchObject({ pendings: ['print'], pendingsCtx: [['printer']], notAvailables: ['reboot'], notAvailablesCtx: [[]] });
        // a Then records only pending, available, not available and its data constraints
        expect(Object.keys(restart.then)).toEqual(
            ['availables', 'availablesCtx', 'notAvailables', 'notAvailablesCtx', 'pendings', 'pendingsCtx', 'dataAssignments', 'dataAssignmentsCtx']);
    });

    it('builds scenarios on named instances, with inputs and contexts', async () => {
        const { model } = await build(readFileSync('../../examples/sample.easy', 'utf8'));
        const [print, next] = model!.scenarios;
        expect(print).toMatchObject({
            name: 'Print job', instances: { printer: 'Printer' }, when: 'print', whenCtx: ['printer'],
            inputs: [{ name: 'file', type: 'string' }, { name: 'copies', type: 'int' }]
        });
        expect(print.inputAssertions.comparisons.map(comparison => comparison.title)).toEqual(['file = "report.pdf"', 'copies = 2']);
        expect(print.given).toMatchObject({
            states: [['Printer', 'busy']], statesCtx: [['printer']],
            dataAssertions: [
                { entity: 'Printer', property: 'jobs', negated: false, operation: 'included in', value: 'report.pdf' },
                { entity: 'Printer', property: 'speed', negated: false, operation: 'larger than', value: 2 }
            ],
            dataAssertionsCtx: [['printer'], ['printer']]
        });
        expect(print.then).toMatchObject({
            notAvailables: ['print'], notAvailablesCtx: [['printer']],
            dataAssignments: [
                { entity: 'Printer', property: 'jobs', operation: 'removed with', value: 'report.pdf' },
                { entity: 'Printer', property: 'waiting', operation: 'enqueued with', value: 'report.pdf' }
            ]
        });
        // '42 is added to the Printer's jobs' is stored as 'the Printer's jobs is added with 42'
        expect(next.then.dataAssignments).toEqual([
            { entity: 'Printer', property: 'waiting', operation: 'dequeued', value: undefined, constant: undefined },
            { entity: 'Printer', property: 'jobs', operation: 'added with', value: 42, constant: undefined }
        ]);
    });

    it('builds element types, and named constants with the element type of their queue', async () => {
        const { model } = await build(`
            Entity Printer { Actions: start  Data properties: waiting: a queue of string, jobs: a list, label: Any }
            Role Operator.
            Action start { Initiators: Operator }
            Scenario: Next
            Given start is available
            When start is executed
            Then the Printer's waiting is dequeued as job AND job is added to the Printer's jobs AND the Printer's label is set to job.`);
        expect(model!.entities[0].dataProperties).toMatchObject([
            { name: 'waiting', type: 'queue', elementType: 'string' }, { name: 'jobs', type: 'list', elementType: 'Any' }, { name: 'label', type: 'Any' }
        ]);
        const [next] = model!.scenarios;
        const [job] = next.constants;
        expect(next.constants).toEqual([new NamedConstant('job', 'string')]);
        expect(next.then.dataAssignments).toEqual([
            { entity: 'Printer', property: 'waiting', operation: 'dequeued', value: undefined, constant: job },
            { entity: 'Printer', property: 'jobs', operation: 'added with', value: job, constant: undefined },
            { entity: 'Printer', property: 'label', operation: 'set to', value: job, constant: undefined }
        ]);
        // one object for the name: where it is bound and where it is used
        expect(next.then.dataAssignments.map(assignment => assignment.constant ?? assignment.value).every(operand => operand === job)).toBe(true);
        expect(model!.scenarios[0].then.dataAssignments.map(assignment => assignment.title)).toEqual([
            "the Printer's waiting is dequeued as job", "the Printer's jobs is added with job", "the Printer's label is set to job"
        ]);
    });

    it('builds each input and output of a When as a named constant of its type, in the order the action declares them', async () => {
        const { model } = await build(`
            Entity Printer { Actions: print  Data properties: names: a queue of string }
            Role Operator.
            Action print { Initiators: Operator, Input: file: string, copies: int }
            Scenario: Submit
            Given print is available
            When print is executed with inputs copies = 2, file
            Then the Printer's names is dequeued as name AND the Printer's names is enqueued with file.
            Scenario: Any copies
            Given print is available
            When print is executed with inputs file = "a.pdf"
            Then print is pending.`);
        const [submit, any] = model!.scenarios;
        const [file, copies, name] = submit.constants;   // the inputs, then '… dequeued as'
        expect(submit.constants).toEqual([new NamedConstant('file', 'string'), new NamedConstant('copies', 'int'), new NamedConstant('name', 'string')]);
        expect(submit.inputs).toEqual([file, copies]);
        expect(submit.inputAssertions.comparisons).toEqual([new Comparison(copies, false, 'equal to', 2, true)]);   // copies = 2
        expect(submit.then.dataAssignments[0].constant).toBe(name);
        expect(submit.then.dataAssignments[1].value).toBe(file);
        // an input the When leaves out is any value
        expect(any.inputs).toEqual([new NamedConstant('file', 'string'), new NamedConstant('copies', 'int')]);
        expect(any.inputAssertions.comparisons.map(comparison => comparison.title)).toEqual(['file = "a.pdf"']);
    });

    it('builds what a When says: its outputs, data for an input, its assertions; its When rule takes all of it into its Given, and keeps it apart', async () => {
        const { model } = await build(`
            Entity Printer { Actions: print  Data properties: speed: int, jobs: a list }
            Role Operator.
            Action print { Initiators: Operator, Input: copies: int, Output: pages: int }
            Scenario: Print
            Given the Printer's speed is not undefined
            When print is executed with inputs copies = the Printer's speed, outputs pages = 3 AND copies larger than 1 AND the Printer's jobs is empty
            Then the Printer's jobs is set to empty AND the Printer's speed is set to pages.
            Scenario: Plain
            Given print is available
            When print is executed with inputs copies = 2
            Then print is pending.`);
        const [print, plain] = model!.scenarios;
        const [copies, pages] = print.constants;
        expect(print.outputs).toEqual([pages]);
        // about the inputs, at the Given's time; about the outputs, at the Then's
        expect(print.inputAssertions.comparisons.map(comparison => comparison.title)).toEqual(['copies larger than 1']);
        expect(print.inputAssertions.dataAssertions.map(assertion => assertion.title))
            .toEqual(["the Printer's speed equal to copies", "the Printer's jobs is empty"]);
        expect(print.inputAssertions.dataAssertions[0].value).toBe(copies);
        expect(print.inputAssertions.dataAssertions.map(assertion => assertion.byEquals)).toEqual([true, false]);   // copies = the Printer's speed
        expect(print.inputAssertions.dataAssertionsCtx).toEqual([['printer'], ['printer']]);
        expect(print.outputAssertions.comparisons.map(comparison => comparison.title)).toEqual(['pages = 3']);
        expect(print.outputAssertions.dataAssertions).toEqual([]);
        expect(print.given.dataAssertions.map(assertion => assertion.title)).toEqual(["the Printer's speed is not undefined"]);
        expect(print.then.dataAssignments.map(assignment => assignment.title))
            .toEqual(["the Printer's jobs is set to empty", "the Printer's speed is set to pages"]);
        expect(print.then.dataAssignments[1].value).toBe(pages);
        // the When rule: the inputs and outputs by name, all that the When says in the Given, renamed to them
        const [rule] = model!.whenRules;
        const [copiesOfStep, pagesOfStep] = rule.parameters;
        expect(rule.scenarios).toEqual(['Print', 'Plain']);
        expect(rule.parameters).toEqual([new NamedConstant('copies', 'int'), new NamedConstant('pages', 'int')]);
        expect(rule.givens.map(given => given.values)).toEqual([[[pagesOfStep, 3]], [[copiesOfStep, 2]]]);
        expect(rule.givens[0].values[0][0]).toBe(pagesOfStep);
        expect(rule.givens[0].comparisons.map(comparison => comparison.title)).toEqual(['copies larger than 1']);
        expect(rule.givens[0].comparisons[0].subject).toBe(copiesOfStep);
        expect(rule.givens[0].dataAssertions.map(assertion => assertion.title))
            .toEqual(["the Printer's speed is not undefined", "the Printer's speed equal to copies", "the Printer's jobs is empty"]);
        expect(rule.givens[0].dataAssertions[1].value).toBe(copiesOfStep);
        expect(rule.thens[0].dataAssignments[1].value).toBe(pagesOfStep);
        expect(rule.constants).toEqual([[], []]);
        // and each When alone, its inputs and outputs together, renamed to the parameters
        expect(rule.whens.map(when => when.comparisons.map(comparison => comparison.title))).toEqual([['copies larger than 1', 'pages = 3'], ['copies = 2']]);
        expect(rule.whens[0].comparisons.map(comparison => comparison.subject)).toEqual([copiesOfStep, pagesOfStep]);
        expect(rule.whens[0].comparisons[0].subject).toBe(copiesOfStep);
        expect(rule.whens.map(when => when.dataAssertions.map(assertion => assertion.title)))
            .toEqual([["the Printer's speed equal to copies", "the Printer's jobs is empty"], []]);
        expect(rule.whens[0].dataAssertions[0].value).toBe(copiesOfStep);
        expect(rule.whens[0].dataAssertions[0].byEquals).toBe(true);
        expect(rule.whens[0].dataAssertionsCtx).toEqual([['printer'], ['printer']]);
        expect(plain.inputAssertions.comparisons.map(comparison => comparison.title)).toEqual(['copies = 2']);
        // the action's inputs and outputs
        expect([model!.inputs, model!.outputs]).toEqual([{ print: [{ name: 'copies', type: 'int' }] }, { print: [{ name: 'pages', type: 'int' }] }]);
    });

    it('groups the scenarios by the action of their When into When rules: givens[i] ⇒ thens[i], over the inputs of a step', async () => {
        const { model } = await build(readFileSync('../../examples/cross-scenario.easy', 'utf8'));
        expect(model!.whenRules.map(rule => [rule.action, rule.actionCtx, rule.scenarios, rule.indices, rule.parameters])).toEqual([
            ['print', ['printer'], ['Rush job', 'Fast job', 'Slow job'], [0, 1, 2], []],
            ['submit', [], ['Submit', 'Resubmit', 'Submit draft'], [3, 4, 5], [new NamedConstant('job', 'string')]],   // submit is in no lifecycle
            ['take', [], ['Take job', 'Drop job'], [6, 7], []]
        ]);
        const [, submit, take] = model!.whenRules;
        const [input] = submit.parameters;
        // when(submit, job): each scenario's job is renamed to the rule's, and "draft" is a condition of its Given
        expect(submit.thens.map(then => then.dataAssignments[0].value)).toEqual([input, input, 'draft']);
        expect(submit.thens.slice(0, 2).every(then => then.dataAssignments[0].value === input)).toBe(true);
        expect(submit.givens.map(given => given.values)).toEqual([[], [], [[input, 'draft']]]);
        expect(submit.givens.map(given => given.availables)).toEqual([['submit'], ['submit'], ['submit']]);
        expect(submit.constants).toEqual([[], [], []]);
        expect(submit.instances).toEqual({ printer: 'Printer' });
        // the other named constants stay with their scenario
        expect(take.constants).toEqual([[new NamedConstant('job', 'string')], [new NamedConstant('next', 'string')]]);
        // the scenarios themselves keep their own variables and Givens
        expect(model!.scenarios[3].then.dataAssignments[0].value).toEqual(new NamedConstant('job', 'string'));
        expect(model!.scenarios[5].given.values).toEqual([]);
    });

    it('saturates a Given: each state replaced until only statuses and property assertions remain, then only the property assertions kept', async () => {
        const { model, errors } = await build(`
            Entity Printer {
                Actions: print
                Data properties: speed: int, ready: boolean, jobs: a list
                States: online, busy, idle
            }
            Role Operator.
            Action print { Initiators: Operator, Input: file: string }
            Declarative specification Printer is online means { the ready equal to true AND print is available }
            Declarative specification Printer is busy means { it is online AND the jobs is not empty AND it is idle }
            Declarative specification Printer is idle means { it is busy AND the speed equal to 0 }
            Scenario: Print
            Given the Printer is busy AND the Printer's jobs is not empty AND print is pending AND print is enabled
            When print is executed with inputs file = "a.pdf"
            Then print is not available.`);
        expect(errors).toBeUndefined();
        const [rule] = model!.whenRules;
        const given = rule.givens[0].saturated(model!.stateSpecifications);
        // busy -> online (ready, not 'print is available') and idle (speed; its 'busy' is already replaced) and the jobs,
        // which the Given says too; 'print is pending' and 'print is enabled' are left out
        expect(given.dataAssertions.map(assertion => assertion.title))
            .toEqual(["the Printer's ready equal to true", "the Printer's speed equal to 0", "the Printer's jobs is not empty"]);
        expect(given.dataAssertionsCtx).toEqual([['printer'], ['printer'], ['printer']]);
        expect(given.values).toEqual([[rule.parameters[0], 'a.pdf']]);
        expect([given.states, given.availables, given.pendings, given.enableds, given.statusTitles()]).toEqual([[], [], [], [], []]);
        // the Given itself is not changed
        expect(rule.givens[0].states).toEqual([['Printer', 'busy']]);
    });

    it('returns the errors instead of a model when the document has errors', async () => {
        const result = await build('Entity Printer { Data properties: speed: int }  Declarative specification Printer is busy means { the speed equal to 1 }');
        expect(result.model).toBeUndefined();
        expect(result.errors?.map(error => error.message)).toEqual(["The Printer has no state 'busy'."]);
    });

    it('refuses a document that is not validated', async () => {
        await expect(build('Entity Printer { }', false)).rejects.toThrow('not validated');
    });
});
