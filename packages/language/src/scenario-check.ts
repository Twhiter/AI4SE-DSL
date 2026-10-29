// Checks each scenario against the specifications, simplifies its Given, and checks scenarios with the same When
// against each other. The specifications themselves are checked by checkConsistency.

import type { Bool } from 'z3-solver';
import { Given, type Condition, type Model, type NamedConstant, type PropertyAssignment, type Scenario, type SpecificationCall, type TitledFormula } from './model.js';
import { conflictOf, specificationRules, type CheckResult } from './consistency.js';
import { Z3Vocabulary, type Instance, type Z3Context, type Z3VocabularyOptions } from './z3-vocabulary.js';

export interface ScenarioResult {
    scenario: string;
    /** The Given, with the When action able to run. */
    given: CheckResult;
    /** The Then, with the When action executed. */
    then: CheckResult;
}

export interface SimplificationStep {
    /** 'the Printer is busy' */
    term: string;
    /**
     * implied: the facts imply it, so it is removed;
     * decomposed: it is replaced by the conditions of its specification;
     * cycle: it comes from its own specification, which was used already, so it stays;
     * repeated: its specification was used already on another path, and its conditions are there, so it is removed.
     */
    step: 'implied' | 'decomposed' | 'cycle' | 'repeated';
    /** For decomposed, cycle and repeated: its specification call, 'Printer is busy(printer)'. */
    call?: string;
    /** For decomposed: what it is replaced by. */
    into?: string[];
}

/** Specifications that lead back to a term they replaced, so that term stays in the Given. */
export interface SimplificationCycle {
    /** The terms around the cycle: the first is the term that stays, and the last is that term again. */
    terms: string[];
    /** The specifications that replaced them, in the same order: 'Printer is busy', 'Printer is online'. */
    specifications: string[];
}

export interface GivenSimplification {
    scenario: string;
    /** What the Given says beyond the facts, in the same lists and contexts as a scenario's Given. */
    given: Given;
    /** The same, as titles: "the Printer's waiting is not full". */
    titles: string[];
    /** The cycles that left a term in the Given. */
    cycles: SimplificationCycle[];
    steps: SimplificationStep[];
}

export interface CrossScenarioResult {
    /** The scenario whose Given implies the other's: wherever it applies, the other applies too. */
    scenario: string;
    /** The scenario whose Given it implies. */
    other: string;
    /** Where the two are in the model's scenarios. */
    indices: [scenario: number, other: number];
    /** Whether the two Givens imply each other. */
    equivalent: boolean;
    /** Both Thens together, with the When action executed. */
    then: CheckResult;
}

/** A term of the Given, with the decompositions it comes from (outermost first), and its cycle once it is found in one. */
interface Term {
    condition: Condition;
    origin: Array<{ call: string, title: string, specification: string }>;
    cycle?: SimplificationCycle;
}

/**
 * Each scenario on its instances, with every specification as a rule on the instance of its entity:
 *   Given:  the Given conditions, and the When action enabled (available if it has no 'enabled' specification;
 *           an enabled action is also available, so its 'available' specification applies either way)
 *   Then:   the Then effects, and the When action executed
 * No time yet: the Given and the Then are checked on their own. The inputs of the When are not used yet.
 */
export async function checkScenarios(z3: Z3Context, model: Model, options?: Z3VocabularyOptions): Promise<ScenarioResult[]> {
    const results: ScenarioResult[] = [];
    for (const scenario of model.scenarios) {
        const { v, instances, rules, when, executed } = setting(z3, model, [scenario], options);
        const given = await check(z3, v, [...titled('spec', rules), ...titled('Given', scenario.given.conditions(v, instances)), when]);
        const then = await check(z3, v, [...titled('spec', rules), ...titled('Then', scenario.then.toZ3(v, instances)), executed]);
        results.push({ scenario: scenario.name, given, then });
    }
    return results;
}

/**
 * Simplifies the Given of a scenario against the facts: the specifications as rules, and the When action enabled
 * (available if it has no 'enabled' specification). Repeats until nothing is decomposed any more:
 *   1. remove every term the facts imply;
 *   2. replace every remaining state or action status by the conditions of its specification. Each specification is
 *      used once per parameters; a term whose specification was used already
 *        - stays if it comes from that specification itself: its conditions lead back to it, a cycle;
 *        - is removed otherwise, as it was reached on another path, and the conditions of its specification are there.
 * Meant for a Given that checkScenarios finds satisfiable: inconsistent facts would imply every term.
 */
export async function simplifyGiven(z3: Z3Context, model: Model, scenario: Scenario, options?: Z3VocabularyOptions): Promise<GivenSimplification> {
    const { v, instances, rules, when } = setting(z3, model, [scenario], options);
    const conditions = scenario.given.conditions(v, instances);
    const solver = new z3.Solver();
    solver.add(...rules.map(rule => rule.formula), when.formula, ...v.constraints());
    const implied = async (term: Condition): Promise<boolean> => {
        solver.push();
        solver.add(z3.Not(term.formula));
        const result = await solver.check();
        solver.pop();
        return result === 'unsat';
    };

    // each specification once per Given and per parameters: 'Printer is busy(printer)'
    const specifications = new Map(rules.map(rule => [callOf({ specification: rule.title, parameters: rule.parameters }), rule]));
    const used = new Set<string>();
    const steps: SimplificationStep[] = [];
    const cycles: SimplificationCycle[] = [];
    let terms: Term[] = conditions.map(condition => ({ condition, origin: [] }));
    for (let decomposed = true; decomposed;) {
        // 1. implication
        const open: Term[] = [];
        for (const term of terms) {
            if (await implied(term.condition)) {
                steps.push({ term: term.condition.title, step: 'implied' });
            } else {
                open.push(term);
            }
        }
        // 2. decomposition
        decomposed = false;
        terms = [];
        for (const term of open) {
            const { title, head } = term.condition;
            const call = head && callOf(head);
            const specification = call && specifications.get(call);
            if (!head || !call || !specification || term.cycle) {
                terms.push(term);
            } else if (!used.has(call)) {
                used.add(call);
                steps.push({ term: title, step: 'decomposed', call, into: specification.conditions.map(condition => condition.title) });
                const origin = [...term.origin, { call, title, specification: head.specification }];
                terms.push(...specification.conditions.map(condition => ({ condition, origin })));
                decomposed = true;
            } else {
                const start = term.origin.findIndex(decomposition => decomposition.call === call);
                if (start >= 0) {
                    const around = term.origin.slice(start);
                    term.cycle = { terms: [...around.map(decomposition => decomposition.title), title], specifications: around.map(decomposition => decomposition.specification) };
                    cycles.push(term.cycle);
                    steps.push({ term: title, step: 'cycle', call });
                    terms.push(term);
                } else {
                    steps.push({ term: title, step: 'repeated', call });
                }
            }
        }
        terms = terms.filter((term, i) => terms.findIndex(other => other.condition.title === term.condition.title) === i);
    }
    const given = new Given();
    terms.forEach(term => term.condition.addTo(given));
    return { scenario: scenario.name, given, titles: terms.map(term => term.condition.title), cycles, steps };
}

/**
 * Checks each pair of scenarios with the same When: the same action with the same inputs (equal values, or named
 * constants in the same places, which then are one input). When the Given of one implies the Given of the other,
 * with the specifications and the When action able to run as facts, the other scenario applies wherever the first
 * does, so after the When both Thens hold:
 *   implication:  facts ∧ Given A ∧ ¬Given B is unsat, where Given A can hold (an impossible Given implies anything)
 *   Thens:        the specifications as rules, Then A, Then B, their alignments and the When action executed;
 *                 unsat = they contradict
 * Only pairs with an implication are returned. A pair is left out when one of its Givens or Thens cannot hold on its
 * own, as checkScenarios reports that.
 */
export async function checkCrossScenarios(z3: Z3Context, model: Model, options?: Z3VocabularyOptions): Promise<CrossScenarioResult[]> {
    const results: CrossScenarioResult[] = [];
    for (const [i, a] of model.scenarios.entries()) {
        for (const [j, b] of model.scenarios.entries()) {
            if (i < j && sameWhen(a, b)) {
                const result = await crossCheck(z3, model, [i, a], [j, b], options);
                if (result) {
                    results.push(result);
                }
            }
        }
    }
    return results;
}

/** The same action, with the same inputs: equal values, or a named constant in the same place in both. */
function sameWhen(a: Scenario, b: Scenario): boolean {
    return a.when === b.when && a.inputs.length === b.inputs.length
        && a.inputs.every((input, k) => typeof input === 'object' ? typeof b.inputs[k] === 'object' : input === b.inputs[k]);
}

/** Two scenarios with the same When, on one set of instances: does a Given imply the other, and do the Thens then contradict? */
async function crossCheck(z3: Z3Context, model: Model, [i, a]: [number, Scenario], [j, b]: [number, Scenario], options?: Z3VocabularyOptions): Promise<CrossScenarioResult | undefined> {
    const { v, instances, rules, when, executed } = setting(z3, model, [a, b], options);
    // b's inputs are a's; its other named constants are its own, also where a has one with the same name
    b.constants.forEach(constant => v.nameConstant(constant, `${constant.name} of '${b.name}'`));
    b.inputs.forEach((input, k) => {
        const same = a.inputs[k];
        if (typeof input === 'object' && typeof same === 'object') {
            v.nameConstant(input, same.name);
        }
    });

    const solver = new z3.Solver();
    solver.add(...rules.map(rule => rule.formula), when.formula, ...v.constraints());
    const result = async (...formulas: Bool<'main'>[]) => {
        solver.push();
        solver.add(...formulas);
        const found = await solver.check();
        solver.pop();
        return found;
    };
    const givenOf = (scenario: Scenario) => z3.And(z3.Bool.val(true), ...scenario.given.conditions(v, instances).map(condition => condition.formula));
    const [givenA, givenB] = [givenOf(a), givenOf(b)];
    if (await result(givenA) !== 'sat' || await result(givenB) !== 'sat') {
        return undefined;
    }
    const implies = async (from: Bool<'main'>, to: Bool<'main'>) => await result(from, z3.Not(to)) === 'unsat';
    const [aImpliesB, bImpliesA] = [await implies(givenA, givenB), await implies(givenB, givenA)];
    if (!aImpliesB && !bImpliesA) {
        return undefined;
    }

    const specifications = titled('spec', rules);
    const [thenA, thenB] = [titled(`Then of '${a.name}'`, a.then.toZ3(v, instances)), titled(`Then of '${b.name}'`, b.then.toZ3(v, instances))];
    const then = await check(z3, v, [...specifications, ...thenA, ...thenB, ...alignments(v, instances, a, b), executed]);
    if (then.result === 'unsat') {
        for (const own of [thenA, thenB]) {
            if ((await check(z3, v, [...specifications, ...own, executed])).result !== 'sat') {
                return undefined;
            }
        }
    }
    // the stronger Given carries the result; of two that imply each other, the later one
    const [scenario, other] = bImpliesA ? [b, a] : [a, b];
    return { scenario: scenario.name, other: other.name, indices: bImpliesA ? [j, i] : [i, j], equivalent: aImpliesB && bImpliesA, then };
}

/**
 * Assignments of the two Thens with the same property (of the same instance) and the same operation, whose values
 * are both named constants, are about the same value: the k-th such assignment of a with the k-th of b.
 *   the jobs is added with job / the jobs is added with item  ->  job = item, as the jobs take them
 *   the waiting is dequeued as job / … is dequeued as item     ->  job = item
 * Named constants that are one already (the same input) need none.
 */
function alignments(v: Z3Vocabulary, instances: Record<string, Instance>, a: Scenario, b: Scenario): TitledFormula[] {
    type Aligned = { assignment: PropertyAssignment, constant: NamedConstant, x: Instance };
    const byAssignment = (scenario: Scenario) => {
        const found = new Map<string, Aligned[]>();
        scenario.then.dataAssignments.forEach((assignment, i) => {
            const constant = assignment.operation === 'dequeued' ? assignment.constant : assignment.value;
            if (typeof constant === 'object') {
                const [name] = scenario.then.dataAssignmentsCtx[i];
                const key = `${name} ${assignment.property} ${assignment.operation}`;
                found.set(key, [...found.get(key) ?? [], { assignment, constant, x: instances[name] }]);
            }
        });
        return found;
    };
    const ofB = byAssignment(b);
    return [...byAssignment(a)].flatMap(([key, ofA]) => ofA.flatMap((one, k) => {
        const other = ofB.get(key)?.[k];
        if (!other) {
            return [];
        }
        const [left, right] = [one, other].map(({ assignment, constant, x }) => v.operand(x, assignment.property, constant).term);
        if (left.eqIdentity(right)) {
            return [];
        }
        const { entity, property, operation } = one.assignment;
        return [{
            title: `alignment: ${one.constant.name} in '${a.name}' = ${other.constant.name} in '${b.name}' (the ${entity}'s ${property} is ${operation})`,
            formula: left.eq(right)
        }];
    }));
}

/**
 * The Given without the property assertions that the facts (as for simplifyGiven) and its other property assertions
 * imply, for a guard. One at a time from the last, so that of two that imply each other the first stays:
 *   the jobs is not empty AND "a" is included in the jobs AND the speed larger than 2
 *     ->  "a" is included in the jobs AND the speed larger than 2
 * Its other terms stay as they are, and only property assertions imply: a guard has nothing else.
 */
export async function removeImpliedAssertions(z3: Z3Context, model: Model, scenario: Scenario, given: Given, options?: Z3VocabularyOptions): Promise<Given> {
    const { v, instances, rules, when } = setting(z3, model, [scenario], options);
    const assertions = Object.assign(new Given(), { dataAssertions: given.dataAssertions, dataAssertionsCtx: given.dataAssertionsCtx });
    const kept = assertions.conditions(v, instances);
    const solver = new z3.Solver();
    solver.add(...rules.map(rule => rule.formula), when.formula, ...v.constraints());
    for (let i = kept.length - 1; i >= 0; i--) {
        solver.push();
        solver.add(...kept.filter((_, j) => j !== i).map(term => term.formula), z3.Not(kept[i].formula));
        const result = await solver.check();
        solver.pop();
        if (result === 'unsat') {
            kept.splice(i, 1);   // it cannot be false while the others hold
        }
    }
    const result = Object.assign(new Given(), given, { dataAssertions: [], dataAssertionsCtx: [] });
    kept.forEach(term => term.addTo(result));
    return result;
}

/** 'Printer is busy(printer)', 'reboot is available()' */
function callOf({ specification, parameters }: SpecificationCall): string {
    return `${specification}(${parameters.join(', ')})`;
}

/**
 * Scenarios on their instances (one per entity, so scenarios checked together share them): the specifications as
 * rules on them, and the When action of the first able to run or executed.
 */
function setting(z3: Z3Context, model: Model, [scenario, ...others]: Scenario[], options?: Z3VocabularyOptions) {
    const v = new Z3Vocabulary(z3, model, options);
    const instances: Record<string, Instance> = {};
    const byEntity = new Map<string, Instance>();
    for (const [name, entity] of [scenario, ...others].flatMap(each => Object.entries(each.instances))) {
        instances[name] ??= v.instance(entity, name);
        byEntity.set(entity, instances[name]);
    }
    const [x] = scenario.whenCtx.map(name => instances[name]);
    const hasEnabled = model.actionSpecifications.some(spec => spec.action === scenario.when && spec.status === 'enabled');
    const runnable = hasEnabled ? 'enabled' : 'available';
    return {
        v,
        instances,
        rules: specificationRules(v, model, byEntity),
        when: { title: `When: ${scenario.when} is ${runnable}`, formula: v.status(runnable, scenario.when, x) },
        executed: { title: `When: ${scenario.when} was executed`, formula: v.status('executed', scenario.when, x) }
    };
}

/** 'Given: the Printer is busy' */
function titled(prefix: string, formulas: TitledFormula[]): TitledFormula[] {
    return formulas.map(({ title, formula }) => ({ title: `${prefix}: ${title}`, formula }));
}

/** Can the formulas hold together, with the rules of the language (sizes, enabled ⇒ available)? If not, those that conflict. */
async function check(z3: Z3Context, v: Z3Vocabulary, formulas: TitledFormula[]): Promise<CheckResult> {
    const solver = new z3.Solver();
    solver.set('core.minimize', true);
    formulas.forEach(({ title, formula }) => solver.addAndTrack(formula, z3.Bool.const(title)));
    solver.add(...v.constraints());
    const result = await solver.check();
    return { result, conflict: result === 'unsat' ? conflictOf(solver, formulas) : [] };
}
