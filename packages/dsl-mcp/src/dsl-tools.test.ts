// The tools on a documents folder of their own: documents by their ids, the calls on them, and their refusals.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Refusal, stopChecker } from 'dsl-controller';
import { Documents } from './documents.ts';
import { DslTools } from './dsl-tools.ts';

afterAll(stopChecker);

/** Tools on a new, empty folder, and that folder. */
function newTools() {
    const folder = mkdtempSync(join(tmpdir(), 'dsl-mcp-'));
    return { tools: new DslTools(new Documents(pathToFileURL(`${folder}/`))), folder };
}

/** The id in what create_dsl says. */
function created(said: string): string {
    return /\d{8}-\d{6}-[a-z0-9]{4}/.exec(said)![0];
}

/** The document `dsl` in `folder`, as its file holds it. */
function file(folder: string, dsl: string): string {
    return readFileSync(join(folder, dsl, 'dsl.easy'), 'utf8');
}

/** A plan step: the tool and its arguments, as JSON. */
function step(tool: string, input: object) {
    return { tool, arguments: JSON.stringify(input) };
}

describe('the tools', () => {
    it('create a document, giving its id only, and keep the domain', () => {
        const { tools, folder } = newTools();
        const said = tools.createDsl('A printer prints files.');
        expect(said).toMatch(/\d{8}-\d{6}-[a-z0-9]{4}/);
        expect(said).not.toContain(folder);
        expect(tools.readDomain(created(said))).toBe('A printer prints files.');
    });

    it('refuse an id that create_dsl did not give', async () => {
        const { tools } = newTools();
        await expect(tools.read('20260101-000000-abcd', 'read_document', {})).rejects.toThrow(/There is no DSL/);
        expect(() => tools.readDomain('../secret')).toThrow(Refusal);
    });

    it('read the grammar without a document', async () => {
        const { tools } = newTools();
        expect(await tools.read(undefined, 'read_scenario_grammar', {})).toContain('scenario');
    });

    it('call a read tool, not a change tool', async () => {
        const { tools } = newTools();
        const dsl = created(tools.createDsl('A printer.'));
        await expect(tools.read(dsl, 'create_entity', { name: 'Printer' })).rejects.toThrow(/apply_plan/);
    });

    it('apply a plan to the file, and read what an editor saved', async () => {
        const { tools, folder } = newTools();
        const dsl = created(tools.createDsl('A printer.'));
        expect(await tools.applyPlan(dsl, [step('create_entity', { name: 'Printer' })])).toMatch(/^Applied the plan/);
        expect(file(folder, dsl)).toBe('Entity Printer { }\n');
        writeFileSync(join(folder, dsl, 'dsl.easy'), 'Entity Printer { }\n\nRole Operator.\n');
        expect(await tools.read(dsl, 'read_document', {})).toContain('Role Operator.');
    });

    it('apply nothing of a plan that stops, and say why: a tool that does not apply yet', async () => {
        const { tools, folder } = newTools();
        const dsl = created(tools.createDsl('A printer.'));
        const plan = tools.applyPlan(dsl, [step('create_role', { name: 'Operator' }), step('create_state', { entity: 'Printer', name: 'idle' })]);
        await expect(plan).rejects.toThrow(Refusal);
        await expect(plan).rejects.toThrow(/Step 2 \(create_state\).*not among the tools allowed/);
        expect(file(folder, dsl)).toBe('');
    });

    it('stop a plan at a name that does not exist, with the names that do', async () => {
        const { tools } = newTools();
        const dsl = created(tools.createDsl('A printer.'));
        const said = await tools.simulatePlan(dsl, [step('create_entity', { name: 'Printer' }), step('create_state', { entity: 'Printr', name: 'idle' })]);
        expect(said).toMatch(/^The plan stops: Step 2/);
        expect(said).toContain('"Printer"');
    });

    it('simulate a plan without changing the document', async () => {
        const { tools, folder } = newTools();
        const dsl = created(tools.createDsl('A printer.'));
        const said = await tools.simulatePlan(dsl, [step('create_entity', { name: 'Printer' }), step('create_state', { entity: 'Printer', name: 'idle' })]);
        expect(said).toMatch(/^The plan runs/);
        expect(said).toContain('What the plan changes in the document:\nEntities\n+ Printer\n    States: + idle');
        expect(file(folder, dsl)).toBe('');
    });

    it('keep two documents apart, as two conversations on one server', async () => {
        const { tools } = newTools();
        const printer = created(tools.createDsl('A printer.'));
        const library = created(tools.createDsl('A library.'));
        await tools.applyPlan(printer, [step('create_entity', { name: 'Printer' })]);
        await tools.applyPlan(library, [step('create_entity', { name: 'Book' })]);
        expect(await tools.read(printer, 'read_document', {})).toBe('Entity Printer { }\n');
        expect(await tools.read(library, 'read_document', {})).toBe('Entity Book { }\n');
        expect(tools.readDomain(library)).toBe('A library.');
    });

    it('apply plans on one document one after another', async () => {
        const { tools } = newTools();
        const dsl = created(tools.createDsl('A printer.'));
        await Promise.all([
            tools.applyPlan(dsl, [step('create_entity', { name: 'Printer' })]),
            tools.applyPlan(dsl, [step('create_role', { name: 'Operator' })])
        ]);
        expect(await tools.read(dsl, 'read_document', {})).toBe('Entity Printer { }\n\nRole Operator.\n');
    });
});
