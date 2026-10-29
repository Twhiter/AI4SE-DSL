// The tools on the documents, without state of their own: create_dsl makes a document and gives its id, the handle
// that every other tool takes (dsl), as MCP has no sessions (2026-07-28: state across calls is a handle the server
// mints, passed as an ordinary argument). The file is the state: each call reads it, so that what an editor saved
// meanwhile counts, and a plan that runs writes it back. A client may serve many conversations from one server, each
// with documents of its own, as Claude Desktop does.
// The document changes only through plans, as in the chatbot: steps, each a change tool with its arguments, simulated
// on a copy (simulate_plan, which also tells what the plan changes, as a diff), or simulated and then written when
// every step runs (apply_plan). A step runs on the change tools the controller offers at that point, so a tool that
// does not apply yet, or a name that does not exist, stops the plan with the reason. The read tools are called directly.
// What the answer's text does not hold, a tool tells the log of its call (note): the id it made, a plan's outcome.

import { z } from 'zod';
import { Controller, describeFindings, diffModels, diffText, Refusal, simulate, type PlanStep, type Simulation, type Succeeded } from 'dsl-controller';
import type { Note, PlanRecord } from './call-log.ts';
import { Documents } from './documents.ts';

/** Tells the log of the call what its answer's text does not hold. */
export type Noter = (note: Note) => void;

const NOBODY: Noter = () => undefined;

export class DslTools {
    private readonly documents: Documents;
    /** The plans being applied, one after another, so that two never write a file from the same reading. */
    private applying: Promise<unknown> = Promise.resolve();

    constructor(documents = new Documents()) {
        this.documents = documents;
    }

    /** Makes a new, empty document for `domain`; its id is the handle of the document. */
    createDsl(domain: string, note = NOBODY): string {
        const id = this.documents.create(domain);
        note({ dsl: id });
        return `Created the DSL ${id}, empty, for the domain. Give its id as dsl to the other tools.`;
    }

    readDomain(dsl: string): string {
        return this.documents.domain(this.documents.existing(dsl));
    }

    /**
     * Runs a read tool of the controller on the document, or on none for a tool that reads no document (the grammar
     * hints). A change tool is only a step of a plan.
     */
    async read(dsl: string | undefined, tool: string, input: unknown): Promise<string> {
        const document = dsl === undefined ? new Controller() : Controller.fromText(this.documents.read(this.documents.existing(dsl)));
        const found = document.tools().find(candidate => candidate.name === tool);
        if (!found || found.kind !== 'read') {
            throw new Refusal(`${tool} is not a read tool: change the document with a plan (simulate_plan, apply_plan).`);
        }
        try {
            return await found.run(input);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new Refusal(`The arguments do not fit:\n${z.prettifyError(error)}`);
            }
            throw error;
        }
    }

    /** Tries `steps` on a copy of the document; the document stays as it is. */
    async simulatePlan(dsl: string, steps: PlanStep[], note = NOBODY): Promise<string> {
        const document = Controller.fromText(this.documents.read(this.documents.existing(dsl)));
        const simulation = await simulate(document, steps);
        note({ plan: planRecord(simulation, false) });
        if (!simulation.succeeded) {
            return `The plan stops: ${simulation.reason}\nNothing was changed.`;
        }
        const diff = diffText(diffModels(document, simulation.controller));
        return described('The plan runs; nothing was changed yet. What each step would do:', simulation,
            `What the plan changes in the document:\n${diff || 'Nothing.'}`);
    }

    /** Simulates `steps`, and writes the document they give when every step runs; else the document stays as it is. */
    applyPlan(dsl: string, steps: PlanStep[], note = NOBODY): Promise<string> {
        const applied = this.applying.then(async () => {
            const id = this.documents.existing(dsl);
            const simulation = await simulate(Controller.fromText(this.documents.read(id)), steps);
            note({ plan: planRecord(simulation, simulation.succeeded) });
            if (!simulation.succeeded) {
                throw new Refusal(`The plan stops: ${simulation.reason}\nNothing was changed.`);
            }
            this.documents.write(id, simulation.controller.toDsl());
            return described('Applied the plan. What each step did:', simulation);
        });
        this.applying = applied.catch(() => undefined);
        return applied;
    }
}

/** A simulation as the log keeps it. */
function planRecord(simulation: Simulation, applied: boolean): PlanRecord {
    if (!simulation.succeeded) {
        return { ran: false, mistake: simulation.mistake, reason: simulation.reason, applied };
    }
    const { newErrors, earlierErrors, warnings } = simulation.findings;
    return { ran: true, newErrors, earlierErrors, warnings, applied };
}

/** What each step did, what else there is to tell (`more`: the diff), and the check of the document after the plan. */
function described(title: string, { changes, findings }: Succeeded, ...more: string[]): string {
    return [
        title, ...changes.map((change, index) => `${index + 1}. ${change}`), ...more,
        'The check of the document after the plan:', describeFindings(findings)
    ].join('\n');
}
