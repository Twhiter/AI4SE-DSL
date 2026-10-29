import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { init, killThreads } from 'z3-solver';
import { checkConsistency, type ConsistencyResult } from '../src/consistency.js';
import { createEasyServices } from '../src/easy-module.js';
import { buildModel } from '../src/model-builder.js';
import type { Model } from '../src/model.js';
import { Z3Vocabulary, type Z3Context } from '../src/z3-vocabulary.js';

/** The declarations, with the Printer's `states` (a state a scenario or a specification uses needs a specification, so each test lists the ones it specifies). */
const declarations = (states: string) => `
Entity Printer {
    Actions: start, print
    Data properties: speed: int, jobs: a list
    ${states ? `States: ${states}` : ''}
}
Role Operator.
Action start { Initiators: Operator }
Action print { Initiators: Operator }
Action reboot { Initiators: Operator }
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

/** checkConsistency of the declarations with `states`, followed by `specifications`, as specification -> result and conflict. */
async function consistency(states: string, specifications: string): Promise<Record<string, Omit<ConsistencyResult, 'specification'>>> {
    const results = await checkConsistency(z3, await modelOf(declarations(states) + specifications));
    return Object.fromEntries(results.map(({ specification, ...result }) => [specification, result]));
}

const sat = { result: 'sat', conflict: [] };

describe('EnabledSpecification.toZ3', () => {

    it('is enabled ⇔ the conjunction of its conditions and milestones, each a disjunction, and its availability', async () => {
        const model = await modelOf(declarations('') + `
            Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available }
            Action reboot is enabled means { reboot is not pending or is not available }`);
        const v = new Z3Vocabulary(z3, model);
        const [print, reboot] = model.enabledSpecifications;
        expect(print.toZ3(v, v.instance('Printer', 'Printer')).sexpr().replace(/\s+/g, ' ')).toBe(
            '(let ((a!1 (and (or (executed Printer start) (not (available Printer start))) (or (not (pending reboot)) (not (available reboot)))'
            + ' (available Printer print)))) (= (enabled Printer print) a!1))');
        // an action in no lifecycle has no instance
        expect(reboot.toZ3(v).sexpr().replace(/\s+/g, ' ')).toBe('(let ((a!1 (and (or (not (pending reboot)) (not (available reboot))) (available reboot)))) (= (enabled reboot) a!1))');
    });

    it('makes an action without an enabled specification enabled exactly when it is available', async () => {
        const model = await modelOf(declarations('') + 'Action print is enabled means { start was executed or is not available }');
        const v = new Z3Vocabulary(z3, model);
        const x = v.instance('Printer', 'Printer');
        v.status('enabled', 'start', x);
        v.status('enabled', 'print', x);   // as its enabled specification says
        v.status('enabled', 'reboot', undefined);
        expect(v.constraints().map(constraint => constraint.sexpr())).toEqual([
            '(= (enabled Printer start) (available Printer start))', '(= (enabled reboot) (available reboot))'
        ]);
    });
});

describe('checkConsistency', () => {

    it('checks the Declarative and the enabled specifications of the example together', async () => {
        const results = await checkConsistency(z3, await modelOf(readFileSync('../../examples/sample.easy', 'utf8')));
        expect(results.map(({ specification, result }) => [specification, result])).toEqual([
            ['Printer is busy', 'sat'], ['Printer is idle', 'sat'], ['Printer is online', 'sat'], ['print is enabled', 'sat']
        ]);
    });

    it('follows a state into the specification of another state', async () => {
        expect(await consistency('busy, idle', `
            Declarative specification Printer is busy means { it is idle AND print is pending }
            Declarative specification Printer is idle means { print is not pending }
        `)).toEqual({
            'Printer is busy': { result: 'unsat', conflict: ['Printer is busy', 'Printer is idle'] },
            'Printer is idle': sat
        });
    });

    it('checks each enabled specification with its action available: its conditions and milestones can always hold', async () => {
        // print enabled, so available: 'print was executed or is not available' needs print to be executed, which it can be
        expect(await consistency('', `
            Action print is enabled means { print was executed or is not available AND print is not pending or is not available }
            Action reboot is enabled means { reboot was executed or is not available }
        `)).toEqual({ 'print is enabled': sat, 'reboot is enabled': sat });
    });

    it("follows 'is enabled' in a Declarative specification into the enabled specification", async () => {
        expect(await consistency('busy, idle', `
            Declarative specification Printer is busy means { print is enabled AND start is available AND start was not executed }
            Declarative specification Printer is idle means { print is enabled AND print is not available }
            Action print is enabled means { start was executed or is not available }
        `)).toEqual({
            'Printer is busy': { result: 'unsat', conflict: ['Printer is busy', 'print is enabled'] },
            'Printer is idle': { result: 'unsat', conflict: ['Printer is idle', 'print is enabled'] },
            'print is enabled': sat
        });
    });

    it('finds the conflicts of the spec-conflict example, with an enabled specification and with another state', async () => {
        const results = await checkConsistency(z3, await modelOf(readFileSync('../../examples/spec-conflict.easy', 'utf8')));
        expect(results).toEqual([
            { specification: 'Printer is busy', result: 'unsat', conflict: ['Printer is busy', 'print is enabled'] },
            { specification: 'Printer is printing', result: 'unsat', conflict: ['Printer is printing', 'Printer is warm'] },
            { specification: 'Printer is warm', ...sat },
            { specification: 'print is enabled', ...sat }
        ]);
    });

    it('makes an action without an enabled specification enabled exactly when it is available', async () => {
        expect(await consistency('busy, idle', `
            Declarative specification Printer is busy means { start is enabled AND start is not available }
            Declarative specification Printer is idle means { reboot is enabled AND reboot is available }
        `)).toEqual({
            'Printer is busy': { result: 'unsat', conflict: ['Printer is busy'] },
            'Printer is idle': sat
        });
    });

    it('knows that a full list is not empty', async () => {
        expect(await consistency('online, jammed', `
            Declarative specification Printer is jammed means { the jobs is empty AND the jobs is full }
            Declarative specification Printer is online means { the speed larger than 0 }
        `)).toEqual({
            'Printer is jammed': { result: 'unsat', conflict: ['Printer is jammed'] },
            'Printer is online': sat
        });
    });
});
