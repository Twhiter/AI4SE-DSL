// Simulates a plan: its steps, each a change tool with its arguments, run one after another on a copy of the model;
// then the document the copy gives is checked, as the editor checks it. The model itself does not change.
// A plan stops only at a mistake in a tool call, which is one of
//   tool    a wrong tool call: its arguments do not fit (the tool is not among the tools allowed at that step, or
//           its arguments are not what the tool takes there), or calling it raised an exception (the model refuses
//           the change: a name that is taken, a text under another key, …)
//   syntax  a name or a text that the grammar does not accept
// and it says at which step and what went wrong, so that the LLM that planned it (the chatbot's planning agent) can
// propose a better plan. A plan whose steps all run succeeds, whatever the check of the document after it finds: it
// gives the model after the plan, what each step did, and the findings of the check (validation and Z3): the errors
// the plan brought, the errors the document had before, and the warnings. The LLM decides what to do with them; in
// the chatbot, the user sees them with the plan.
// The user may keep only some of a plan's changes (diff.ts: changesOf). selectSteps finds the steps that make just those:
// it runs each step on its own to see the changes it makes, and leaves out a step whose changes are all left out; a
// step that makes changes kept and changes left out cannot be split, and then there are no such steps.

import { z } from 'zod';
import { Refusal, SyntaxRefusal, type Controller } from './controller.ts';
import { describeProblem, findProblems, type Problem } from './checker.ts';
import { changesOf, diffModels } from './diff.ts';

/** One step of a plan: a change tool, and its arguments as a JSON object, such as {"name": "Customer"}. */
export interface PlanStep {
    tool: string;
    arguments: string;
}

export type Mistake = 'tool' | 'syntax';

/** What the check of the document after a plan finds. */
export interface Findings {
    /** The errors the plan brought: the document before it did not have them. */
    newErrors: Problem[];
    /** The errors the document had before the plan, and still has. */
    earlierErrors: Problem[];
    warnings: Problem[];
}

/** A plan whose steps all run. */
export interface Succeeded {
    succeeded: true;
    /** The model after the plan. */
    controller: Controller;
    /** What each step did, in order. */
    changes: string[];
    /** What the check of the document after the plan finds; none of it stops the plan. */
    findings: Findings;
}

/** A plan that stops at a mistake in a tool call. */
export interface Failed {
    succeeded: false;
    mistake: Mistake;
    /** What went wrong, and at which step. */
    reason: string;
    /** The model as far as the plan ran. */
    controller: Controller;
}

export type Simulation = Succeeded | Failed;

/** Runs the steps on a copy of `model`, then checks the document they give. */
export async function simulate(model: Controller, steps: PlanStep[]): Promise<Simulation> {
    const controller = model.copy();
    if (steps.length === 0) {
        return { succeeded: false, mistake: 'tool', reason: 'The plan has no steps.', controller };
    }

    const changes: string[] = [];
    for (const [index, step] of steps.entries()) {
        try {
            changes.push(await runStep(controller, step));
        } catch (error) {
            if (!(error instanceof PlanMistake)) {
                throw error;
            }
            return { succeeded: false, mistake: error.mistake, reason: `Step ${index + 1} (${step.tool}): ${error.message}`, controller };
        }
    }

    return { succeeded: true, controller, changes, findings: await check(model, controller) };
}

/**
 * The steps of the plan `steps` on `model` that make only the changes whose keys are in `kept`: a step goes when every
 * change it makes is left out. Otherwise, why there are no such steps: the plan no longer runs, or a step makes changes
 * kept and changes left out.
 */
export async function selectSteps(model: Controller, steps: PlanStep[], kept: Iterable<string>): Promise<{ steps: PlanStep[] } | { reason: string }> {
    const keep = new Set(kept);
    const controller = model.copy();
    const selected: PlanStep[] = [];
    for (const [index, step] of steps.entries()) {
        const before = controller.copy();
        try {
            await runStep(controller, step);
        } catch (error) {
            if (!(error instanceof PlanMistake)) {
                throw error;
            }
            return { reason: `The plan no longer runs: step ${index + 1} (${step.tool}): ${error.message}` };
        }
        const changes = changesOf(diffModels(before, controller));
        const left = changes.filter(({ key }) => !keep.has(key));
        if (left.length > 0 && left.length < changes.length) {
            return {
                reason: `Step ${index + 1} (${step.tool} ${step.arguments}) makes changes kept and changes left out (`
                    + `${left.map(({ text }) => text).join('; ')}), so it cannot be left out, nor kept.`
            };
        }
        if (left.length === 0) {
            selected.push(step);
        }
    }
    return { steps: selected };
}

/** A mistake of a step: what simulate reports for it. */
class PlanMistake extends Error {
    mistake: Mistake;

    constructor(mistake: Mistake, message: string) {
        super(message);
        this.mistake = mistake;
    }
}

/** Runs one step on the model, with the change tools the controller allows at this step; what the tool says it did. */
async function runStep(controller: Controller, step: PlanStep): Promise<string> {
    const found = controller.tools().find(({ kind, name }) => kind === 'change' && name === step.tool);
    if (!found) {
        throw new PlanMistake('tool', `its arguments do not fit: '${step.tool}' is not among the tools allowed at this step.`);
    }

    let input: unknown;
    try {
        input = JSON.parse(step.arguments);
    } catch {
        throw new PlanMistake('tool', `its arguments do not fit: they are not a JSON object: ${step.arguments}`);
    }

    try {
        return await found.run(input);
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new PlanMistake('tool', `its arguments do not fit:\n${z.prettifyError(error)}`);
        }
        if (error instanceof SyntaxRefusal) {
            throw new PlanMistake('syntax', error.message);
        }
        if (error instanceof Refusal) {
            throw new PlanMistake('tool', `calling it raised an exception: ${error.message}`);
        }
        throw error;
    }
}

/** The findings of a check, each kind under its own title: "Errors the plan brings: …", or that there are none. */
export function describeFindings({ newErrors, earlierErrors, warnings }: Findings): string {
    const section = (title: string, problems: Problem[]) => problems.length > 0 ? [title, ...problems.map(describeProblem)] : [];
    const lines = [
        ...section('Errors the plan brings:', newErrors),
        ...section('Errors the document had before the plan:', earlierErrors),
        ...section('Warnings:', warnings)
    ];
    if ([...newErrors, ...earlierErrors].some(({ kind }) => kind !== 'z3')) {
        lines.push('(Z3 checks the specifications and scenarios only once the document has no other errors.)');
    }
    return lines.length > 0 ? lines.join('\n') : 'No problems.';
}

/** The check of the document after the plan (`after`), its errors told apart by the document before it (`before`). */
async function check(before: Controller, after: Controller): Promise<Findings> {
    const problems = await findProblems(after.toDsl());
    const errors = problems.filter(({ severity }) => severity === 'error');
    const warnings = problems.filter(({ severity }) => severity === 'warning');
    if (errors.length === 0) {
        return { newErrors: [], earlierErrors: [], warnings };
    }
    const earlier = new Set((await findProblems(before.toDsl()))
        .filter(({ severity }) => severity === 'error')
        .map(({ message }) => message));
    return {
        newErrors: errors.filter(({ message }) => !earlier.has(message)),
        earlierErrors: errors.filter(({ message }) => earlier.has(message)),
        warnings
    };
}
