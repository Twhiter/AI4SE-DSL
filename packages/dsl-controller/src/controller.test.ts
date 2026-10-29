// The controller's model against the grammar (packages/language/src/easy.langium): a document with every part of the
// grammar, read into the model and written back, stays as it is. A part the model leaves out would be lost on every
// plan, since a plan's document is written from the model; when the grammar gains a part, add it here.

import { describe, expect, it } from 'vitest';
import { CHANGE_TOOLS, changeToolList } from './change-tools.ts';
import { Controller } from './controller.ts';
import { diffModels, diffText } from './diff.ts';

/** The controller's tool `name`, as it offers it now. */
function tool(controller: Controller, name: string) {
    return controller.tools().find(controllerTool => controllerTool.name === name)!;
}

/** Every part of the grammar, in the order and layout the controller writes. */
const EVERY_PART = `Entity Printer {
    Actions: print, reset
    Data properties: speed: int, label: string, ready: boolean, note: Any, jobs: a list, names: a list of string, waiting: a queue, done: a queue of int
    States: idle, busy
}

Entity Tray { }

Role Operator.

Action print { Initiators: Operator, Observers: Printer, Input: file: string, copies: int, Output: printed: boolean }

Action reset { Initiators: Operator, Printer }

Action report { Initiators: Operator, Output: count: int }

Declarative specification Printer is idle means { reset was executed AND print was not executed AND print is enabled AND reset is not pending AND print is available AND its speed equal to 0 AND the label is not undefined AND the Printer's speed not larger than 3 AND "a" is included in its names AND its jobs is not empty AND its waiting is full }

Declarative specification Printer is busy means { it is idle AND print is pending AND reset is not available }

Action print is enabled means { reset was executed or is not available AND reset is not pending or is not available }

Scenario: Print a file
Given the Printer is idle AND print is enabled AND the Printer's speed smaller than 5 AND the Printer's note is undefined
When print is executed with inputs file = "a.pdf", copies = the Printer's speed, outputs printed AND copies larger than 0 AND printed equal to true
Then the Printer's label is set to file AND the Printer's names is added with file AND file is removed from the Printer's names AND the Printer's waiting is dequeued as job AND the Printer's done is enqueued with copies AND the Printer's jobs is set to empty AND reset is pending AND print is not available AND report is available.

Scenario: Report
Given report is available
When report is executed with outputs count = 3
Then the Printer's speed is set to count.
`;

describe('the controller against the grammar', () => {
    it('reads a document with every part of the grammar', () => {
        expect(Controller.fromText(EVERY_PART).broken).toBeUndefined();
    });

    it('writes it back as it was', () => {
        expect(Controller.fromText(EVERY_PART).toDsl()).toBe(EVERY_PART);
    });
});

/** Comments in every place: before an element, inside it, after it on its last line, and at the end. */
const COMMENTED = `// the printer
Entity Printer { // inside
    States: idle // after idle
} /* after the entity,
   on two lines */

/* the operator */
Role Operator.

Action print { Initiators: Operator } // after print

// before the specification
Declarative specification Printer is idle means { /* inside */ print is available }

// before the scenario
Scenario: Print
Given the Printer is idle
When print is executed
Then print is not available. // after the scenario

// at the end
`;

describe('comments', () => {
    it('are kept where they are', () => {
        expect(Controller.fromText(COMMENTED).toDsl()).toBe(COMMENTED);
    });

    it('around a changed element stay, and the ones inside it go', async () => {
        const controller = Controller.fromText(COMMENTED);
        await tool(controller, 'create_state').run({ entity: 'Printer', name: 'busy' });
        const written = controller.toDsl();
        expect(written).toContain('// the printer\nEntity Printer {\n    States: idle, busy\n}');
        expect(written).toContain('} /* after the entity,\n   on two lines */');
        expect(written).not.toContain('// inside');
        expect(written).toContain('/* inside */');   // in the specification, which did not change
    });

    it('around a replaced scenario stay', async () => {
        const controller = Controller.fromText(COMMENTED);
        await tool(controller, 'replace_scenario').run({
            name: 'Print', text: 'Scenario: Print\nGiven the Printer is idle\nWhen print is executed\nThen print is available.'
        });
        expect(controller.toDsl()).toContain('// before the scenario\nScenario: Print\nGiven the Printer is idle\nWhen print is executed\n'
            + 'Then print is available. // after the scenario');
    });
});

describe('outputs', () => {
    it('create_action_specification adds inputs and outputs', async () => {
        const controller = Controller.fromText('Role Operator.\n');
        await tool(controller, 'create_action_specification').run({
            action: 'check', initiators: ['Operator'], observers: null,
            inputs: [{ name: 'age', type: 'int' }], outputs: [{ name: 'adult', type: 'boolean' }]
        });
        expect(controller.toDsl()).toContain('Action check { Initiators: Operator, Input: age: int, Output: adult: boolean }');
    });

    it('refuses an input and an output with the same name', async () => {
        const controller = Controller.fromText('Role Operator.\n');
        await expect(tool(controller, 'create_action_specification').run({
            action: 'check', initiators: ['Operator'], observers: null,
            inputs: [{ name: 'age', type: 'int' }], outputs: [{ name: 'age', type: 'int' }]
        })).rejects.toThrow("cannot have two inputs or outputs named 'age'");
    });
});

describe('the catalog', () => {
    const catalog = Controller.catalog();
    const changeTools = catalog.filter(({ kind }) => kind === 'change');

    it('has every change tool, as change-tools.ts lists them', () => {
        expect(changeTools.map(({ name }) => name).sort()).toEqual(CHANGE_TOOLS.map(({ name }) => name).sort());
        expect(() => changeToolList(changeTools)).not.toThrow();
    });

    it('takes any name where a model takes only the names it has', () => {
        const deleteEntity = changeTools.find(({ name }) => name === 'delete_entity')!;
        expect(deleteEntity.parameters.parse({ entity: 'Anything' })).toEqual({ entity: 'Anything' });
    });
});

describe('the diff as text', () => {
    it('marks what changes, element by element and line by line', () => {
        const before = Controller.fromText(EVERY_PART);
        const after = Controller.fromText(EVERY_PART
            .replace('States: idle, busy', 'States: idle, busy, off')
            .replace('Entity Tray { }\n\n', '')
            .replace('When report is executed with outputs count = 3', 'When report is executed with outputs count = 4'));
        expect(diffText(diffModels(before, after))).toBe([
            'Entities',
            '~ Printer',
            '    States: + off',
            '- Tray',
            'Scenarios',
            '~ Report',
            '      Scenario: Report',
            '      Given report is available',
            '    - When report is executed with outputs count = 3',
            '    + When report is executed with outputs count = 4',
            '      Then the Printer\'s speed is set to count.'
        ].join('\n'));
    });
});
