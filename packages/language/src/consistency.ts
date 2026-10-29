// Can each specification's head hold (a state, an action being enabled), given all specifications as rules: the
// Declarative specifications and the enabled specifications together?

import type { Bool, Solver } from 'z3-solver';
import type { Condition, Context, Model, TitledFormula } from './model.js';
import { Z3Vocabulary, type Instance, type Z3Context, type Z3VocabularyOptions } from './z3-vocabulary.js';

export interface CheckResult {
    /** unsat: it can never hold. */
    result: 'sat' | 'unsat' | 'unknown';
    /** For unsat: the titles of the specifications that contradict each other, in the order of the file. */
    conflict: string[];
}

export interface ConsistencyResult extends CheckResult {
    /** The specification whose head is assumed: 'Printer is busy'. */
    specification: string;
}

/** A specification as a rule on an instance: head ⇒ conditions, with its head and its conditions on their own. */
export interface Rule extends TitledFormula {
    /** The names of the instances it is applied to: [Printer], or [] for an action in no lifecycle. */
    parameters: Context;
    head: Bool;
    conditions: Condition[];
}

/**
 * Assumes each head in turn, on one instance per entity; unsat means the head can never hold. Each rule is tracked,
 * so the conflict names the specifications that contradict each other; the rules of the language (an action without
 * an enabled specification is enabled exactly when available, the sizes of lists and queues) are not tracked.
 */
export async function checkConsistency(z3: Z3Context, model: Model, options?: Z3VocabularyOptions): Promise<ConsistencyResult[]> {
    const v = new Z3Vocabulary(z3, model, options);
    const instances = new Map(model.entities.map(entity => [entity.name, v.instance(entity.name, entity.name)]));
    const rules = specificationRules(v, model, instances);
    const solver = new z3.Solver();
    solver.set('core.minimize', true);
    rules.forEach(({ title, formula }) => solver.addAndTrack(formula, z3.Bool.const(title)));
    solver.add(...v.constraints());
    const results: ConsistencyResult[] = [];
    for (const { title, head } of rules) {
        solver.push();
        solver.add(head);
        const result = await solver.check();
        results.push({ specification: title, result, conflict: result === 'unsat' ? conflictOf(solver, rules) : [] });
        solver.pop();
    }
    return results;
}

/**
 * Every specification as a rule on the instance of its entity (entity name -> instance): a Declarative specification
 * (inState(x, busy) ⇒ …), an enabled specification (enabled(x, print) ⇔ …; none for an action in no lifecycle).
 * A specification whose entity has no instance is left out.
 */
export function specificationRules(v: Z3Vocabulary, model: Model, instances: Map<string, Instance>): Rule[] {
    const rules: Rule[] = [];
    for (const spec of model.stateSpecifications) {
        const x = instances.get(spec.entity);
        if (x) {
            rules.push({ title: spec.title, parameters: [v.nameOf(x)], head: spec.head(v, x), formula: spec.toZ3(v, x), conditions: spec.conditions(v, x) });
        }
    }
    for (const spec of model.enabledSpecifications) {
        const lifecycle = v.lifecycleOf(spec.action);
        const x = lifecycle && instances.get(lifecycle.name);
        if (!lifecycle || x) {
            rules.push({ title: spec.title, parameters: x ? [v.nameOf(x)] : [], head: spec.head(v, x), formula: spec.toZ3(v, x), conditions: spec.conjuncts(v, x) });
        }
    }
    return rules;
}

/** The titles of the tracked formulas in the solver's unsat core, in the order of `tracked`. */
export function conflictOf(solver: Solver<'main'>, tracked: Array<{ title: string }>): string[] {
    const core = new Set([...solver.unsatCore()].map(name => String(name.decl().name())));
    return tracked.map(({ title }) => title).filter(title => core.has(title));
}
