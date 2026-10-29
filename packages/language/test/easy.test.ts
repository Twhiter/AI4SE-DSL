import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEasyServices } from '../src/easy-module.js';
import { isActionParticipants, isEntity, isScenario, type Model } from '../src/generated/ast.js';

/** Entities, a role and actions, with a specification for every state but the Printer's busy, for the tests that write that one. */
const WITHOUT_BUSY = `
Entity Printer {
    Actions: start, print
    Data properties: speed: int, label: string, ready: boolean, note: Any, jobs: a list, waiting: a queue, backlog: a queue,
        counts: a list of int, names: a queue of string
    States: online, busy
}
Entity Tray { Actions: refill  States: low }
Role Operator.
Action start { Initiators: Operator }
Action print { Initiators: Operator }
Action refill { Initiators: Operator }
Action reboot { Initiators: Operator }
Declarative specification Printer is online means { the ready equal to true }
Declarative specification Tray is low means { refill is pending }
`;

/** The same with every state specified: no problems on its own. */
const DECLARATIONS = WITHOUT_BUSY + 'Declarative specification Printer is busy means { it is online }\n';

/** Parses and validates `text` in a workspace of its own. */
async function parse(text: string) {
    return parseHelper<Model>(createEasyServices(EmptyFileSystem).Easy)(text, { validation: true });
}

/** The errors and warnings of `text`. */
async function messages(text: string): Promise<string[]> {
    return ((await parse(text)).diagnostics ?? []).map(diagnostic => String(diagnostic.message));
}

/** The same, each with its severity: 'error: …', 'warning: …'. */
async function problems(text: string): Promise<string[]> {
    return ((await parse(text)).diagnostics ?? []).map(diagnostic => `${diagnostic.severity === 1 ? 'error' : 'warning'}: ${diagnostic.message}`);
}

/** The errors of the declarations followed by a scenario with `given` and `then`. */
async function scenarioMessages(given: string, then = 'print is pending'): Promise<string[]> {
    return messages(`${DECLARATIONS}\nScenario: Check\nGiven ${given}\nWhen print is executed\nThen ${then}.`);
}

describe('Parsing', () => {

    it('reads the example without any problem', async () => {
        expect(await messages(readFileSync('../../examples/sample.easy', 'utf8'))).toEqual([]);
    });

    it('takes the parts of an entity in any order', async () => {
        const document = await parse('Entity Lamp { States: on  Data properties: watts: int, colours: a list  Actions: toggle }  Declarative specification Lamp is on means { the watts larger than 0 }');
        const lamp = document.parseResult.value.elements.find(isEntity)!;
        expect(lamp.states.map(state => state.name)).toEqual(['on']);
        expect(lamp.dataProperties.map(property => [property.name, property.type])).toEqual([['watts', 'int'], ['colours', 'list']]);
        expect(lamp.actions.map(action => action.name)).toEqual(['toggle']);
        expect(document.diagnostics?.map(diagnostic => diagnostic.message))
            .toEqual(["Initiators and observers of 'toggle' are not specified. Add 'Action toggle { Initiators: … }'."]);
    });

    it('lets a list or a queue hold any values, also mixed', async () => {
        expect(await scenarioMessages(`1 is included in the Printer's jobs AND "x" is included in the Printer's jobs AND true is included in the Printer's waiting`,
            `the Printer's jobs is added with 2 AND "y" is added to the Printer's jobs AND the Printer's waiting is enqueued with false`)).toEqual([]);
    });
});

describe('Types', () => {

    it.each([
        [`the Printer's speed equal to "x"`, "'speed' is an int, but this is a string."],
        [`"x" is included in the Printer's speed`, "'included in' cannot be used with 'speed', which is an int."],
        [`the Printer's jobs larger than 2`, "'larger than' cannot be used with 'jobs', which is a list."],
        [`the Printer's label is empty`, "'empty' cannot be used with 'label', which is a string."]
    ])('checks the assertion %s', async (given, message) => {
        expect(await scenarioMessages(given)).toEqual([message]);
    });

    it.each([
        [`the Printer's jobs is enqueued with 1`, "'enqueued with' cannot be used with 'jobs', which is a list."],
        [`the Printer's waiting is added with 1`, "'added with' cannot be used with 'waiting', which is a queue."],
        [`1 is added to the Printer's waiting`, "'added to' cannot be used with 'waiting', which is a queue."],
        [`the Printer's jobs is dequeued`, "'dequeued' cannot be used with 'jobs', which is a list."],
        [`the Printer's ready is set to 3`, "'ready' is a boolean, but this is an int."]
    ])('checks the assignment %s', async (then, message) => {
        expect(await scenarioMessages('the Printer is online', then)).toEqual([message]);
    });

    it('checks the assertions of a specification in the same way', async () => {
        expect(await messages(WITHOUT_BUSY + 'Declarative specification Printer is busy means { its speed equal to true AND the waiting is not full }'))
            .toEqual(["'speed' is an int, but this is a boolean."]);
    });
});

describe('States', () => {

    it("uses 'it is <state>' for the specified entity, and the Given names the entity", async () => {
        expect(await messages(WITHOUT_BUSY + 'Declarative specification Printer is busy means { it is online }')).toEqual([]);
        expect(await messages(WITHOUT_BUSY + 'Declarative specification Printer is busy means { it is low }')).toEqual(["The Printer has no state 'low'."]);
        expect(await scenarioMessages('the Printer is low')).toEqual(["The Printer has no state 'low'."]);
    });

    it("has no 'not' in a state assertion", async () => {
        const noNot = "A state has no 'not': only the <Entity> is <state> (it is <state> in a specification).";
        expect(await messages(WITHOUT_BUSY + 'Declarative specification Printer is busy means { it is not online }')).toEqual([noNot]);
        expect(await scenarioMessages('the Printer is not online')).toEqual([noNot]);
    });

    it('needs a Declarative specification, which says what the state means in data, for a state a scenario or a specification uses', async () => {
        const unspecified = "the state 'busy' of the Printer: it has no Declarative specification. Add 'Declarative specification Printer is busy means { … }'.";
        expect(await messages(WITHOUT_BUSY)).toEqual([]);
        expect(await messages(`${WITHOUT_BUSY}\nScenario: Check\nGiven the Printer is busy\nWhen print is executed\nThen print is pending.`))
            .toEqual([`A scenario cannot use ${unspecified}`]);
        expect(await messages(WITHOUT_BUSY.replace('States: online, busy', 'States: online, busy, idle') + 'Declarative specification Printer is idle means { it is busy }'))
            .toEqual([`A Declarative specification cannot use ${unspecified}`]);
        expect(await messages(DECLARATIONS)).toEqual([]);
    });

    it('warns about Declarative specifications that go round in a cycle, on the state that leads back', async () => {
        const specified = (specifications: string) => problems(`
            Entity Printer {
                Data properties: speed: int
                States: online, busy, idle
            }
            ${specifications}`);
        expect(await specified(`
            Declarative specification Printer is online means { the speed larger than 0 }
            Declarative specification Printer is busy means { it is online AND it is idle }
            Declarative specification Printer is idle means { the speed equal to 0 AND it is busy }`)).toEqual([
            'warning: The Declarative specifications of the Printer go round in a cycle: busy → idle → busy.',
            'warning: The Declarative specifications of the Printer go round in a cycle: idle → busy → idle.'
        ]);
        // a state specified by itself; busy leads into that cycle, but is not in it
        expect(await specified(`
            Declarative specification Printer is online means { it is online }
            Declarative specification Printer is busy means { it is online }
            Declarative specification Printer is idle means { the speed equal to 0 }`)).toEqual([
            'warning: The Declarative specifications of the Printer go round in a cycle: online → online.'
        ]);
    });
});

describe('Names', () => {

    it('can join words with underscores, also around a keyword', async () => {
        const document = await parse(`
            Entity Form { Actions: submit  Data properties: time_to_wait: int, steps: a list  States: ready_to_submit }
            Role Clerk.
            Action submit { Initiators: Clerk }
            Declarative specification Form is ready_to_submit means { the time_to_wait equal to 0 }
            Scenario: Send_to clerk
            Given the Form is ready_to_submit AND the Form's time_to_wait equal to -1
            When submit is executed
            Then the Form's time_to_wait is set to 3 AND "a" is added to the Form's steps.`);
        expect(document.diagnostics?.map(diagnostic => diagnostic.message)).toEqual([]);
        const form = document.parseResult.value.elements.find(isEntity)!;
        expect([form.states[0].name, form.dataProperties[0].name]).toEqual(['ready_to_submit', 'time_to_wait']);
    });

    it('end at a keyword, and suggest underscores', async () => {
        expect(await messages('Role Ready to submit.'))
            .toEqual(["Expected '.' but found 'to'. (If 'to' is meant to be part of a name: keywords cannot be used in names; join the words with underscores instead, as in ready_to_submit.)"]);
    });

    it('of a scenario can have keywords, but not Given or a word that starts an element', async () => {
        const scenario = (name: string) => `\nScenario: ${name}\nGiven the Printer is online\nWhen print is executed\nThen print is pending.`;
        const document = await parse(DECLARATIONS + scenario('Print the job When it is set to busy AND not full'));
        expect(document.diagnostics?.map(diagnostic => diagnostic.message)).toEqual([]);
        expect(document.parseResult.value.elements.find(isScenario)?.name).toBe('Print the job When it is set to busy AND not full');
        const hint = "(A scenario's name can have keywords, but not Given, Entity, Role, Action, Declarative or Scenario.)";
        // without a Given the name runs on to the scenario's '.'
        expect(await messages(DECLARATIONS + scenario('Print job').replace('\nGiven the Printer is online', ''))).toEqual([`Expected 'Given' but found '.'. ${hint}`]);
        // one whose Given is not written yet ends before the next element, which is still read
        expect(await messages(DECLARATIONS + '\nScenario: Print job' + scenario('Next').replace('the Printer is online', "the Printer's label equal to 3")))
            .toEqual([`Expected 'Given' but found 'Scenario'. ${hint}`, "'label' is a string, but this is an int."]);
    });

    it('cannot have hyphens', async () => {
        expect((await messages('Role ready-to-submit.'))[0]).toMatch(/^unexpected character: ->-<-/);
    });
});

describe('Actions without an entity', () => {

    it('can be specified with statuses of other actions without an entity', async () => {
        expect(await messages(DECLARATIONS + 'Action reboot is enabled means { reboot was executed or is not available }')).toEqual([]);
    });

    it('have no entity actions to talk about', async () => {
        expect(await messages(DECLARATIONS + 'Action reboot is enabled means { start was executed or is not available }'))
            .toEqual(["'start' is in the lifecycle of the Printer, but 'reboot' is in no lifecycle."]);
    });

    it("can be used in any specification, unlike another entity's actions", async () => {
        expect(await messages(WITHOUT_BUSY + 'Declarative specification Printer is busy means { reboot is pending AND refill is pending }'))
            .toEqual(["'refill' is in the lifecycle of the Tray, not of the Printer."]);
        expect(await messages(WITHOUT_BUSY + "Declarative specification Printer is busy means { the Tray's speed larger than 1 }"))
            .toEqual(["'Tray' cannot be used here; this specification is about the Printer."]);
    });
});

describe('Statuses', () => {

    const ENABLING_CONDITIONS = [
        'An enabled specification can only have these conditions, joined with AND:',
        '  <action> was executed or is not available',
        '  <action> is not pending or is not available'
    ].join('\n');

    it('takes one enabled specification per action', async () => {
        expect(await messages(DECLARATIONS + `
            Action print is enabled means { start was executed or is not available }
            Action reboot is enabled means { reboot is not pending or is not available }
            Action print is enabled means { start is not pending or is not available }`))
            .toEqual(["There is already an enabled specification for 'print'."]);
    });

    it('has no other action specifications', async () => {
        const enabled = 'Expected an enabled specification: Action <action> is enabled means { … }.';
        const either = 'Expected Action <action> { Initiators: … } or Action <action> is enabled means { … }.';
        const element = "Unexpected 'print'. Expected the start of an element: Entity, Role, Action <action> { … }, Action <action> is enabled means { … }, Declarative specification, or Scenario.";
        for (const [head, expected] of [['Action print is available means { start was executed }', enabled], ['Action print is not pending means { start was executed }', enabled],
            ['Action print is not enabled means { start was executed or is not available }', enabled], ['Action print was executed means { start is pending }', either],
            ['print is enabled means { start was executed or is not available }', element]]) {
            expect(await messages(DECLARATIONS + head)).toEqual([expected]);
        }
    });

    it("allows '<action> is enabled' as a condition only in a Declarative specification or a Given, without 'not'", async () => {
        const busy = (condition: string) => WITHOUT_BUSY + `Declarative specification Printer is busy means { it is online AND ${condition} }`;
        expect(await messages(busy('start is enabled AND reboot is enabled'))).toEqual([]);
        expect(await messages(busy('refill is enabled'))).toEqual(["'refill' is in the lifecycle of the Tray, not of the Printer."]);
        const given = (condition: string) => `${DECLARATIONS}\nScenario: Check\nGiven ${condition}\nWhen print is executed\nThen print is pending.`;
        expect(await messages(given('reboot is enabled AND the Printer is online'))).toEqual([]);
        for (const text of [busy('start is not enabled'), given('reboot is not enabled')]) {
            expect(await messages(text)).toEqual(["There is no 'not enabled': only <action> is enabled, in a Declarative specification or a Given."]);
        }
        const [then] = await scenarioMessages('the Printer is online', 'print is enabled');   // not in a Then
        expect(then).toContain('This is not a valid Then effect.');
    });

    it('allows only <action> was executed or is not available and <action> is not pending or is not available, joined with AND', async () => {
        expect(await messages(DECLARATIONS + `Action print is enabled means {
            start was executed or is not available AND reboot is not pending or is not available AND print was executed or is not available }`))
            .toEqual([]);
        for (const condition of ['start was executed', 'start is not pending', 'the speed larger than 5', 'it is online', 'start is enabled',
            'start was not executed or is not available', 'start is pending or is not available', 'start was executed or start is not available',
            'start is not available or was executed', 'start was executed or is available', 'start was executed or is not',
            'start was executed or is not available reboot is not pending or is not available']) {
            expect(await messages(DECLARATIONS + `Action print is enabled means { ${condition} }`)).toEqual([ENABLING_CONDITIONS]);
        }
    });

    it("uses only actions in the action's own lifecycle, or in none", async () => {
        expect(await messages(DECLARATIONS + 'Action print is enabled means { refill was executed or is not available }'))
            .toEqual(["'refill' is in the lifecycle of the Tray, not of the Printer."]);
    });

    it('has no states in a Then', async () => {
        for (const then of ['the Printer is busy', 'the Printer is not busy']) {
            const [message] = await scenarioMessages('the Printer is online', then);
            expect(message).toContain('This is not a valid Then effect.');
        }
    });

    it("allows only 'is pending' and 'is (not) available' in a Then", async () => {
        expect(await scenarioMessages('the Printer is online', 'print is not pending'))
            .toEqual(['In a Then effect an action can only be: <action> is pending  |  <action> is (not) available.']);
    });
});

describe('Element types and Any', () => {

    it("gives a list or queue an element type with 'of', and Any without it", async () => {
        const document = await parse(DECLARATIONS);
        const printer = document.parseResult.value.elements.find(isEntity)!;
        const types = Object.fromEntries(printer.dataProperties.map(property => [property.name, [property.type, property.elementType]]));
        expect(types).toMatchObject({ jobs: ['list', undefined], counts: ['list', 'int'], names: ['queue', 'string'], note: ['Any', undefined] });
    });

    it('checks the values of a typed list or queue, and lets Any take any value', async () => {
        expect(await scenarioMessages('the Printer is online', '"x" is added to the Printer\'s counts'))
            .toEqual(["'counts' is a list of int, but this is a string."]);
        expect(await scenarioMessages('the Printer is online', "the Printer's names is enqueued with 3"))
            .toEqual(["'names' is a queue of string, but this is an int."]);
        expect(await scenarioMessages('the Printer\'s note equal to 3', 'the Printer\'s note is set to "x" AND 4 is added to the Printer\'s counts')).toEqual([]);
        expect(await scenarioMessages("the Printer's note larger than 3")).toEqual(["'larger than' cannot be used with 'note', which is Any."]);
    });
});

describe('Variables', () => {
    const NO_JOB = "The When has no input or output 'job', and nothing is dequeued as 'job': … is executed with inputs job, … outputs job, or … is dequeued as job.";

    it("bind a dequeued element with 'as', for the effects after it", async () => {
        expect(await scenarioMessages('the Printer is online',
            "the Printer's waiting is dequeued as job AND the Printer's backlog is enqueued with job AND job is added to the Printer's jobs")).toEqual([]);
    });

    it('take the element type of their queue; only Any converts to another type, with a warning', async () => {
        const then = (effects: string) => problems(`${DECLARATIONS}\nScenario: Check\nGiven the Printer is online\nWhen print is executed\nThen ${effects}.`);
        expect(await then("the Printer's names is dequeued as job AND the Printer's label is set to job")).toEqual([]);
        expect(await then("the Printer's names is dequeued as job AND the Printer's speed is set to job"))
            .toEqual(["error: 'job' is a string, but 'speed' is an int."]);
        expect(await then("the Printer's names is dequeued as job AND the Printer's ready is set to job"))
            .toEqual(["error: 'job' is a string, but 'ready' is a boolean."]);
        expect(await then("the Printer's waiting is dequeued as job AND job is added to the Printer's counts"))
            .toEqual(["warning: 'job' can be any value, but 'counts' is a list of int."]);
        expect(await then("the Printer's waiting is dequeued as job AND the Printer's note is set to job")).toEqual([]);   // Any into Any
    });

    it('are bound once per scenario, before they are used', async () => {
        expect(await scenarioMessages('the Printer is online', "the Printer's backlog is enqueued with job AND the Printer's waiting is dequeued as job"))
            .toEqual(["'job' is used before it is bound; bind it first: … is executed with inputs job, … outputs job, or … is dequeued as job."]);
        expect(await scenarioMessages('the Printer is online', "the Printer's backlog is enqueued with job"))
            .toEqual([NO_JOB]);
        expect(await scenarioMessages('the Printer is online', "the Printer's waiting is dequeued as job AND the Printer's backlog is dequeued as job"))
            .toEqual(["'job' is already bound in this scenario."]);
    });

    it('belong to their scenario', async () => {
        expect(await messages(`${DECLARATIONS}
            Scenario: First
            Given the Printer is online
            When print is executed
            Then the Printer's waiting is dequeued as job.
            Scenario: Second
            Given the Printer is online
            When print is executed
            Then the Printer's backlog is enqueued with job.`))
            .toEqual([NO_JOB]);
    });
});

describe('Inputs and outputs', () => {
    const withValues = (values: string) => DECLARATIONS.replace('Action print { Initiators: Operator }', `Action print { Initiators: Operator, ${values} }`);
    const WITH_VALUES = withValues('Input: file: string, copies: int, Output: printed: boolean, pages: int');
    const scenario = (when: string, then = 'print is pending') =>
        messages(`${WITH_VALUES}\nScenario: Check\nGiven the Printer is online\nWhen ${when}\nThen ${then}.`);

    it("declares an action's inputs and outputs in order, each with a name and a type", async () => {
        const document = await parse(withValues('Input: file name: string, copies: int, Output: printed: boolean, pages: int'));
        const print = document.parseResult.value.elements.filter(isActionParticipants).find(block => block.name === 'print');
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(print?.inputs.map(({ name, type }) => `${name}: ${type}`)).toEqual(['file name: string', 'copies: int']);
        expect(print?.outputs.map(({ name, type }) => `${name}: ${type}`)).toEqual(['printed: boolean', 'pages: int']);
    });

    it('asks for the names of inputs written as types only', async () => {
        const expected = (type: string) => `Expected a name but found the type '${type}'. An input, like a data property, has a name before its type: Input: file: string, copies: int.`;
        expect(await messages(withValues('Input: string, int'))).toEqual([expected('string'), expected('int')]);
    });

    it('gives each input and output of an action a name of its own', async () => {
        expect(await messages(withValues('Input: file: string, file: int'))).toEqual(["'print' already has an input named 'file'."]);
        expect(await messages(withValues('Input: file: string, Output: file: boolean'))).toEqual(["'print' already has an input named 'file'."]);
        expect(await messages(withValues('Output: done: boolean, done: int'))).toEqual(["'print' already has an output named 'done'."]);
    });

    it.each([
        'print is executed with inputs copies = 2, file = "a.pdf", outputs printed = true',
        "print is executed with inputs file = the Printer's label, copies",
        'print is executed with inputs file',
        'print is executed with outputs pages = 3',
        "print is executed with outputs pages = the Printer's speed",
        'print is executed'
    ])('names them in any order, each once; one left out is any value: When %s', async when => {
        expect(await scenario(when)).toEqual([]);
    });

    it.each([
        ['print is executed with inputs fil = "a"', ["'print' has no input 'fil'; its inputs are 'file', 'copies'."]],
        ['print is executed with inputs file = "a", file = "b"', ["The input 'file' is given twice."]],
        ['print is executed with inputs file = 2, copies = "a"', ["'file' is a string, but this is an int.", "'copies' is an int, but this is a string."]],
        ['print is executed with outputs printed = 1', ["'printed' is a boolean, but this is an int."]],
        ["print is executed with inputs copies = the Printer's label", ["'label' is a string, but 'copies' is an int."]],
        ["print is executed with inputs copies = the Printer's counts", ["'counts' is a list of int, but 'copies' is an int."]],
        ['start is executed with inputs file = "a"', ["'start' has no inputs."]],
        ['start is executed with outputs done = true', ["'start' has no outputs."]]
    ])('checks: When %s', async (when, expected) => {
        expect(await scenario(when)).toEqual(expected);
    });

    it('takes a value or data on the right of =, never a new name', async () => {
        const document = await parse(`${WITH_VALUES}\nScenario: Check\nGiven the Printer is online\nWhen print is executed with inputs file = some name\nThen print is pending.`);
        expect(document.parseResult.parserErrors.length).toBeGreaterThan(0);
    });

    it('lets the Then use the inputs and outputs by their names', async () => {
        const then = (effects: string) => scenario('print is executed with inputs file, outputs pages', effects);
        expect(await then("the Printer's names is enqueued with file AND the Printer's speed is set to pages")).toEqual([]);
        expect(await then("the Printer's speed is set to file")).toEqual(["'file' is a string, but 'speed' is an int."]);
        expect(await then("the Printer's waiting is dequeued as file")).toEqual(["'file' is already bound in this scenario."]);
        expect(await then("the Printer's speed is set to copies"))
            .toEqual(["The When has no input or output 'copies', and nothing is dequeued as 'copies': … is executed with inputs copies, … outputs copies, or … is dequeued as copies."]);
    });

    it('takes assertions after the inputs and outputs: about data, or about an input or output', async () => {
        expect(await scenario("print is executed with inputs copies, outputs pages AND copies larger than 1 AND pages equal to copies AND the Printer's speed larger than copies"))
            .toEqual([]);
        expect(await scenario("print is executed AND the Printer's jobs is not empty")).toEqual([]);
        expect(await scenario('print is executed with inputs file AND file larger than 3')).toEqual(["'larger than' cannot be used with 'file', which is a string."]);
        expect(await scenario('print is executed with inputs copies AND copies equal to "a"')).toEqual(["'copies' is an int, but this is a string."]);
        expect(await scenario("print is executed with outputs pages AND the Printer's speed equal to pages")).toEqual([]);
        expect(await scenario("print is executed with outputs pages = the Printer's label")).toEqual(["'label' is a string, but 'pages' is an int."]);
    });
});

describe('Undefined', () => {

    it('says an int, string, boolean or Any property has no value, or has one', async () => {
        expect(await scenarioMessages("the Printer's speed is undefined AND the Printer's label is not undefined AND the Printer's note is undefined"))
            .toEqual([]);
        expect(await messages(`${WITHOUT_BUSY}Declarative specification Printer is busy means { its ready is not undefined AND the note is undefined }`))
            .toEqual([]);
    });

    it('never for a list or queue, which always has a value: it starts empty', async () => {
        expect(await scenarioMessages("the Printer's jobs is undefined")).toEqual(["'jobs' is a list, which always has a value: it starts empty."]);
        expect(await messages(`${WITHOUT_BUSY}Declarative specification Printer is busy means { the waiting is not undefined }`))
            .toEqual(["'waiting' is a queue, which always has a value: it starts empty."]);
    });
});

describe('Set to empty', () => {

    it('empties a list or queue again', async () => {
        expect(await scenarioMessages('the Printer is online', "the Printer's jobs is set to empty AND the Printer's waiting is set to empty")).toEqual([]);
    });

    it('only a list or queue', async () => {
        expect(await scenarioMessages('the Printer is online', "the Printer's speed is set to empty"))
            .toEqual(["'set to empty' cannot be used with 'speed', which is an int."]);
    });
});

describe('Declarations', () => {

    it('reports a part of an entity written twice', async () => {
        expect(await messages(`Entity Lamp { Data properties: watts: int  States: on  States: off }
            Declarative specification Lamp is on means { the watts larger than 0 }
            Declarative specification Lamp is off means { the watts equal to 0 }`)).toEqual(["'States' is written twice in the Lamp; list them in one place."]);
    });

    it('does not let a role and an entity share a name', async () => {
        expect(await messages(DECLARATIONS + 'Role Tray.')).toEqual(["'Tray' is already the name of an entity; a role and an entity cannot have the same name."]);
    });
});

describe('Error recovery', () => {

    it('goes on after a broken condition and still finds the problems that follow', async () => {
        const found = await messages(WITHOUT_BUSY + `
            Declarative specification Printer is busy means { the speed bigger than 1 AND it is online }
            Action print is enabled means { start was executed AND reboot is not pending or is not available }
            Scenario: Check
            Given the Printer's label equal to 3
            When print is executed
            Then print is pending.`);
        expect(found).toHaveLength(3);
        expect(found[0]).toContain('This is not a valid property assertion.');
        expect(found[1]).toContain('An enabled specification can only have these conditions');
        expect(found[2]).toBe("'label' is a string, but this is an int.");
    });

    it('goes on after an unfinished Action, or an element that does not start with a keyword', async () => {
        const scenario = "\nScenario: Check\nGiven the Printer's label equal to 3\nWhen print is executed\nThen print is pending.";
        for (const [text, error] of [['Action print', 'Expected Action <action> { Initiators: … } or Action <action> is enabled means { … }.'],
            ['scenario: Lower', "Unexpected 'scenario'. Expected the start of an element: Entity, Role, Action <action> { … }, Action <action> is enabled means { … }, Declarative specification, or Scenario."]]) {
            expect(await messages(DECLARATIONS + text + scenario)).toEqual([error, "'label' is a string, but this is an int."]);
        }
    });
});
