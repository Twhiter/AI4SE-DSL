// A part of a plan: the keys of its changes, the same in a step's diff as in the plan's, and the steps that make only
// the changes kept (selectSteps).

import { describe, expect, it } from 'vitest';
import { Controller } from './controller.ts';
import { changesOf, diffModels } from './diff.ts';
import { selectSteps, simulate } from './simulation.ts';

const MODEL = 'Entity Printer {\n    States: idle\n}\n';

const STEPS = [
    { tool: 'create_state', arguments: '{"entity": "Printer", "name": "busy"}' },
    { tool: 'create_state', arguments: '{"entity": "Printer", "name": "off"}' },
    { tool: 'create_role', arguments: '{"name": "Operator"}' }
];

describe('a part of a plan', () => {
    it('keys each change the user can keep or leave out', async () => {
        const model = Controller.fromText(MODEL);
        const simulation = await simulate(model, STEPS);
        expect(simulation.succeeded).toBe(true);
        expect(changesOf(diffModels(model, simulation.controller))).toEqual([
            { key: 'Entities/Printer/States/+busy', text: 'Entities: Printer, States: + busy' },
            { key: 'Entities/Printer/States/+off', text: 'Entities: Printer, States: + off' },
            { key: 'Roles/Operator', text: 'Roles: + Operator' }
        ]);
    });

    it('leaves out the steps whose changes are all left out', async () => {
        const selection = await selectSteps(Controller.fromText(MODEL), STEPS, ['Entities/Printer/States/+busy', 'Roles/Operator']);
        expect(selection).toEqual({ steps: [STEPS[0], STEPS[2]] });
    });

    it('cannot split a step that makes changes kept and changes left out', async () => {
        const deletion = [{ tool: 'delete_entity', arguments: '{"entity": "Printer"}' }];
        const selection = await selectSteps(Controller.fromText(MODEL), deletion, ['Entities/Printer']);
        expect(selection).toEqual({ reason: expect.stringContaining('makes changes kept and changes left out') });
    });
});
