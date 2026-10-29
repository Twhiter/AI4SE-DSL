// Checks the scenarios with the Declarative and the enabled specifications as rules (consistency.ts):
//   each on its own (checkScenarios), a step from the Given's time s to the Then's time s′:
//     Given:  its Given part can hold: its Given, its When action enabled, what its When says about its inputs   (s)
//     Then:   its Then part can follow: what its When says about its outputs, its Then, its When action executed (s′)
//   those with the same When against each other (checkCrossScenarios), as one rule over a step:
//     when(a): (G₁ ∧ In₁ ∧ Out₁ ⇒ T₁) ∧ (G₂ ∧ In₂ ∧ Out₂ ⇒ T₂) ∧ …
// A Given and a Then are about two different states, so they are checked in two solvers: a Then never changes what a
// Given says. Both use the same names for the instances.

import type { Bool, Expr } from 'z3-solver';
import { NamedConstant, type Model, type Operand, type ScalarType, type TitledFormula, type Value, type WhenRule } from './model.js';
import { conflictOf, specificationRules, type CheckResult } from './consistency.js';
import { Z3Vocabulary, type Instance, type Z3Context, type Z3VocabularyOptions } from './z3-vocabulary.js';

export interface ScenarioResult {
    scenario: string;
    /** Its Given part. unsat: the scenario can never apply. */
    given: CheckResult;
    /**
     * Its Then part, after its Given part. unsat: its Then can never follow its Given and When; not checked (sat) when
     * the scenario can never apply.
     */
    then: CheckResult;
}

export interface CrossScenarioResult {
    /** The action of their When. */
    action: string;
    /** Scenarios that can apply together, but whose Thens cannot hold together, in the order of the file. */
    scenarios: string[];
    /** Where they are in the model's scenarios. */
    indices: number[];
    /**
     * The inputs and outputs where they conflict: 'job = "draft"', 'level is an int other than 3'; none for an action
     * without inputs and outputs.
     */
    inputs: string[];
    /** The Then items that contradict, each with its scenario: "Rush job: the Printer's speed is set to 10". */
    conflict: string[];
}

/**
 * Each scenario as a step from the Given's time s to the Then's time s′, on one instance of each entity it is about at
 * each time (person at s, person′ at s′), with every specification about them as a rule at each time. Its inputs and
 * outputs are named constants, with one value throughout; a property the Then does not set is unknown at s′.
 *   Given part GP:  Given(s) ∧ enabled(A, s) ∧ In(s)       A the When action: enabled as its enabled specification
 *                                                         says, or exactly when it is available without one; In: what
 *                                                         the When says about its inputs (age = 30, age larger than 17,
 *                                                         age = the Person's age, … AND the Person's age larger than 3)
 *   Then part TP:   Out(s) ∧ Then(s′) ∧ executed(A, s′)    Out: what it says about its outputs (is_adult = true,
 *                                                         pages = the Printer's speed: data as at s)
 *   Given check:  rules(s) ∧ GP                           unsat: the scenario can never apply
 *   Then check:   rules(s) ∧ GP ∧ rules(s′) ∧ TP          unsat: its Then can never follow its Given and When
 * The conflict of an unsat check names what contradicts: the specifications ('spec: Printer is busy', at s′
 * 'spec: Printer is busy (after)'), the items of the Given or Then ('Given: print is not available') and of the When
 * ('When: age larger than 17', 'When: print is enabled').
 */
export async function checkScenarios(z3: Z3Context, model: Model, options?: Z3VocabularyOptions): Promise<ScenarioResult[]> {
    const results: ScenarioResult[] = [];
    for (const scenario of model.scenarios) {
        const { v, instances, rules, x } = setting(z3, model, scenario.instances, scenario.whenCtx, options);
        const givenPart: TitledFormula[] = [
            ...titled('spec', rules), ...titled('Given', scenario.given.conditions(v, instances)),
            ...titled('When', scenario.inputAssertions.toZ3(v, instances)),
            { title: `When: ${scenario.when} is enabled`, formula: v.status('enabled', scenario.when, x) }
        ];
        const given = await check(z3, [v], givenPart);
        if (given.result === 'unsat') {
            results.push({ scenario: scenario.name, given, then: { result: 'sat', conflict: [] } });
            continue;
        }
        const after = afterStep(v, model, scenario.instances, scenario.whenCtx);
        const then = await check(z3, [v, after.v], [
            ...givenPart,
            ...after.rules.map(({ title, formula }) => ({ title: `spec: ${title} (after)`, formula })),
            ...titled('When', scenario.outputAssertions.toZ3(v, instances)),
            ...titled('Then', scenario.then.toZ3(after.v, after.instances)),
            { title: `When: ${scenario.when} was executed`, formula: after.v.status('executed', scenario.when, after.x) }
        ]);
        results.push({ scenario: scenario.name, given, then });
    }
    return results;
}

/**
 * Checks the scenarios of each When rule against each other, as the rule says, for every step: its inputs and outputs
 * x, given at its start and given back at its end, and independent of each other:
 *   when(a, x): (G₁(s) ∧ W₁(s, x) ⇒ T₁(s′, x)) ∧ (G₂(s) ∧ W₂(s, x) ⇒ T₂(s′, x)) ∧ …    s before the step, s′ after it;
 *                                                                                  W: what the When says (In and Out)
 * Only scenarios that hold on their own take part (`self`, checkScenarios when not given).
 * Every input and output is covered by finitely many points: each is a value that occurs in the rule (in what the
 * Whens say, or in the Thens), or a fresh constant that differs from all of them (another one's fresh constant too,
 * for second = first). A Then uses inputs and outputs only in equalities, so it holds for all the values a fresh
 * constant stands for, or for none. At each point:
 *   1. the scenarios whose values for the inputs and outputs hold there may apply;
 *   2. Thens, on s′: the specifications as rules, the When action executed, the inputs and outputs at the point, and
 *      the Thens; Z3 finds each smallest group of those scenarios whose Thens cannot hold together (an unsat core),
 *      until none is left;
 *   3. Givens, on s: the specifications as rules, the When action enabled, the inputs and outputs at the point (a fresh
 *      constant: some value it stands for), and the Givens and Whens of such a group. If they can hold together, the
 *      group applies together but its Thens cannot hold: a conflict, reported once, at that point.
 * The same operation on the same property with named constants in two Thens (dequeued as job, dequeued as next) gives
 * the same value: the two are aligned.
 */
export async function checkCrossScenarios(z3: Z3Context, model: Model, options?: Z3VocabularyOptions, self?: ScenarioResult[]): Promise<CrossScenarioResult[]> {
    const own = self ?? await checkScenarios(z3, model, options);
    const holds = (index: number) => own[index].given.result === 'sat' && own[index].then.result === 'sat';
    const results: CrossScenarioResult[] = [];
    for (const rule of model.whenRules) {
        const kept = rule.indices.flatMap((index, i) => holds(index) ? [i] : []);
        if (kept.length > 1) {
            results.push(...await checkRule(z3, model, rule, kept, options));
        }
    }
    return results;
}

/** The conflicts among the scenarios `kept` (their positions in the rule) of one When rule. */
async function checkRule(z3: Z3Context, model: Model, rule: WhenRule, kept: number[], options?: Z3VocabularyOptions): Promise<CrossScenarioResult[]> {
    const { v, instances, rules, x } = setting(z3, model, rule.instances, rule.actionCtx, options);
    // the other named constants (dequeued as job) are told apart by their scenario
    for (const i of kept) {
        rule.constants[i].forEach(constant => v.nameConstant(constant, `${rule.scenarios[i]}: ${constant.name}`));
    }
    const results = new Map<string, CrossScenarioResult>();
    for (const point of points(v, rule, kept)) {
        const applying = kept.filter(i => rule.givens[i].values.every(([parameter, value]) => point.values[rule.parameters.indexOf(parameter)] === value));
        if (applying.length < 2) {
            continue;
        }
        for (const { members, conflict } of await conflictingThens(z3, v, model, rule, applying, point, rules.map(spec => spec.formula), instances, x)) {
            const key = members.join(',');
            if (results.has(key)) {
                continue;
            }
            // at the same inputs and outputs: a When may compare them (age larger than 17), so the Givens hold for some
            // values only, which must be ones where the Thens conflict
            const before = new z3.Solver();
            before.add(...rules.map(spec => spec.formula), v.status('enabled', rule.action, x), ...point.facts,
                ...rule.parameters.map((parameter, p) => v.constant(parameter).eq(point.terms[p])));
            for (const i of members) {
                before.add(...rule.givens[i].conditions(v, instances).map(condition => condition.formula));
            }
            before.add(...v.constraints());
            if (await before.check() === 'sat') {
                results.set(key, {
                    action: rule.action, scenarios: members.map(i => rule.scenarios[i]), indices: members.map(i => rule.indices[i]),
                    inputs: point.titles, conflict
                });
            }
        }
    }
    return [...results.values()].sort((a, b) => a.indices.join(',').localeCompare(b.indices.join(','), undefined, { numeric: true }));
}

/**
 * Every smallest group of the scenarios `applying` whose Thens cannot hold together at the point, with the Then items
 * that contradict ("Rush job: the Printer's speed is set to 10", in the scenario's own words). A seed of scenarios is
 * either grown to a largest group whose Thens can hold, or shrunk to a smallest one whose Thens cannot; either way it is
 * ruled out from then on.
 */
async function conflictingThens(z3: Z3Context, v: Z3Vocabulary, model: Model, rule: WhenRule, applying: number[], point: Point,
    rules: Array<Bool<'main'>>, instances: Record<string, Instance>, x: Instance | undefined): Promise<Array<{ members: number[], conflict: string[] }>> {
    const after = new z3.Solver();
    after.set('core.minimize', true);
    after.add(...rules, v.status('executed', rule.action, x), ...point.facts,
        ...rule.parameters.map((parameter, p) => v.constant(parameter).eq(point.terms[p])));
    // each Then item of scenario i behind a literal of its own
    const items: Array<{ i: number, title: string, literal: Bool<'main'> }> = [];
    for (const i of applying) {
        const titles = model.scenarios[rule.indices[i]].then.titles();
        rule.thens[i].toZ3(v, instances).forEach(({ formula }, k) => {
            const literal = z3.Bool.const(`item ${items.length}`);
            after.add(z3.Implies(literal, formula));
            items.push({ i, title: `${rule.scenarios[i]}: ${titles[k]}`, literal });
        });
    }
    for (const [i, j] of applying.flatMap((i, k) => applying.slice(k + 1).map(j => [i, j]))) {
        for (const { a, b, formula } of alignments(v, instances, rule, i, j)) {
            after.add(z3.Implies(z3.And(assignmentLiteral(items, rule, i, a), assignmentLiteral(items, rule, j, b)), formula));
        }
    }
    after.add(...v.constraints());
    const thens = async (group: number[]) => {
        const result = await after.check(...items.filter(item => group.includes(item.i)).map(item => item.literal));
        const core = result === 'unsat' ? new Set([...after.unsatCore()].map(literal => literal.toString())) : new Set<string>();
        return { result, core: items.filter(item => core.has(item.literal.toString())) };
    };

    const groups: Array<{ members: number[], conflict: string[] }> = [];
    const seeds = new z3.Solver();
    const chosen = new Map(applying.map(i => [i, z3.Bool.const(`chosen ${i}`)]));
    while (await seeds.check() === 'sat') {
        const seedModel = seeds.model();
        let members = applying.filter(i => seedModel.eval(chosen.get(i)!, true).sexpr() === 'true');
        let checked = await thens(members);
        if (checked.result === 'sat') {
            for (const i of applying.filter(i => !members.includes(i))) {
                if ((await thens([...members, i])).result === 'sat') {
                    members = [...members, i];
                }
            }
            const outside = applying.filter(i => !members.includes(i));
            if (outside.length === 0) {
                break;
            }
            seeds.add(z3.Or(...outside.map(i => chosen.get(i)!)));
        } else if (checked.result === 'unsat') {
            members = applying.filter(i => checked.core.some(item => item.i === i));
            for (const i of [...members]) {
                const without = await thens(members.filter(j => j !== i));
                if (without.result === 'unsat') {
                    members = members.filter(j => j !== i);
                    checked = without;
                }
            }
            groups.push({ members, conflict: checked.core.map(item => item.title) });
            seeds.add(z3.Or(...members.map(i => z3.Not(chosen.get(i)!))));
        } else {
            break;
        }
    }
    return groups;
}

/** A point of the inputs and outputs of a step: each a value that occurs in the rule, or a fresh constant. */
interface Point {
    /** Each parameter's term at the point: 3, "draft", or a fresh constant (other 1). */
    terms: Array<Expr<'main'>>;
    /** Each parameter's value at the point; undefined for a fresh constant. */
    values: Array<Value | undefined>;
    /** The fresh constants differ from the values of their type in the rule, and from each other. */
    facts: Array<Bool<'main'>>;
    /** job = "draft", job is a string other than "draft", second = first */
    titles: string[];
}

/**
 * The points that cover every input and output of the rule's parameters: for each, the values of its type that occur in
 * the rule (in what the Whens say and in the Thens), a new fresh constant ("other"), and each fresh constant of an
 * earlier parameter of the same type (second = first); a boolean is true or false, an Any is any of these of each
 * type. Fresh constants come first, so that a conflict for all values but some is reported at "other". A parameter
 * that none of the scenarios says anything about is a fresh constant only, left out of the titles: any value.
 */
function points(v: Z3Vocabulary, rule: WhenRule, kept: number[]): Point[] {
    const literal = (operand: Operand | undefined) => operand !== undefined && !(operand instanceof NamedConstant) ? [operand] : [];
    const occurring = [...new Set([
        ...kept.flatMap(i => rule.givens[i].values.map(([, value]) => value)),
        ...kept.flatMap(i => rule.givens[i].comparisons.flatMap(({ value }) => literal(value))),
        ...kept.flatMap(i => rule.thens[i].dataAssignments.flatMap(({ value }) => literal(value)))
    ])];
    const ofType = (type: ScalarType) => type === 'boolean' ? [true, false] : occurring.filter(value => typeOfValue(value) === type);
    type Partial = Point & { fresh: Array<{ constant: NamedConstant, input: string }> };
    let partials: Partial[] = [{ terms: [], values: [], facts: [], titles: [], fresh: [] }];
    const used = mentioned(rule, kept);
    rule.parameters.forEach((parameter, p) => {
        if (!used.has(parameter)) {
            const any = v.constant(new NamedConstant(`any ${p + 1}`, parameter.type));
            partials = partials.map(partial => ({ ...partial, terms: [...partial.terms, any], values: [...partial.values, undefined] }));
            return;
        }
        const types: ScalarType[] = parameter.type === 'Any' ? ['int', 'string', 'boolean'] : [parameter.type];
        partials = partials.flatMap(partial => {
            const extend = (term: Expr<'main'>, value: Value | undefined, title: string, facts: Array<Bool<'main'>> = [], fresh = partial.fresh): Partial => ({
                terms: [...partial.terms, term], values: [...partial.values, value], facts: [...partial.facts, ...facts],
                titles: [...partial.titles, title], fresh
            });
            const extensions: Partial[] = [];
            for (const type of types.filter(type => type !== 'boolean')) {
                for (const earlier of partial.fresh.filter(({ constant }) => constant.type === type)) {
                    extensions.push(extend(v.convert(earlier.constant, parameter.type).term, undefined, `${parameter.name} = ${earlier.input}`));
                }
                const constant = new NamedConstant(`other ${p + 1}${parameter.type === 'Any' ? ` ${type}` : ''}`, type);
                const values = ofType(type);
                const others = partial.fresh.filter(({ constant: other }) => other.type === type);
                const unlike = [...[...values].sort(byValue).map(operandTitle), ...others.map(({ input }) => input)];
                extensions.push(extend(v.convert(constant, parameter.type).term, undefined,
                    `${parameter.name} is ${unlike.length > 0 ? `${describe(type)} other than ${unlike.join(', ')}` : `any ${type}`}`,
                    [...values.map(value => v.constant(constant).neq(v.value(value))), ...others.map(({ constant: other }) => v.constant(constant).neq(v.constant(other)))],
                    [...partial.fresh, { constant, input: parameter.name }]));
            }
            for (const type of types) {
                for (const value of ofType(type)) {
                    extensions.push(extend(v.convert(value, parameter.type).term, value, `${parameter.name} = ${operandTitle(value)}`));
                }
            }
            return extensions;
        });
    });
    return partials.map(({ terms, values, facts, titles }) => ({ terms, values, facts, titles }));
}

/** The parameters that the scenarios `kept` say something about, in what their Whens say or in their Thens. */
function mentioned(rule: WhenRule, kept: number[]): Set<NamedConstant> {
    const used = new Set<NamedConstant>();
    const add = (operand: Operand | undefined) => {
        if (operand instanceof NamedConstant && rule.parameters.includes(operand)) {
            used.add(operand);
        }
    };
    for (const i of kept) {
        const { values, comparisons, dataAssertions } = rule.givens[i];
        values.forEach(([parameter]) => add(parameter));
        comparisons.forEach(({ subject, value }) => [subject, value].forEach(add));
        dataAssertions.forEach(({ value }) => add(value));
        rule.thens[i].dataAssignments.forEach(({ value, constant }) => [value, constant].forEach(add));
    }
    return used;
}

/** 1 before 3, "a" before "b" */
function byValue(a: Value, b: Value): number {
    return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

function typeOfValue(value: Value): ScalarType {
    return typeof value === 'number' ? 'int' : typeof value === 'boolean' ? 'boolean' : 'string';
}

/** an int, a string */
function describe(type: ScalarType): string {
    return type === 'int' ? 'an int' : `a ${type}`;
}

/** 3, "draft", true */
function operandTitle(value: Value): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * The same operation on the same property in the Thens of scenarios i and j, each with a named constant (… is dequeued
 * as job, … is added with job): equal, as the two scenarios apply to the same step. By the positions of the two
 * assignments in their Thens.
 */
function alignments(v: Z3Vocabulary, instances: Record<string, Instance>, rule: WhenRule, i: number, j: number): Array<{ a: number, b: number, formula: Bool<'main'> }> {
    const constantOf = (then: WhenRule['thens'][number], k: number) => {
        const assignment = then.dataAssignments[k];
        const constant = assignment.operation === 'dequeued' ? assignment.constant : assignment.value;
        return typeof constant === 'object' ? constant : undefined;
    };
    const key = (then: WhenRule['thens'][number], k: number) =>
        `${then.dataAssignmentsCtx[k][0]} ${then.dataAssignments[k].property} ${then.dataAssignments[k].operation}`;
    const result: Array<{ a: number, b: number, formula: Bool<'main'> }> = [];
    const [first, second] = [rule.thens[i], rule.thens[j]];
    first.dataAssignments.forEach((assignment, a) => second.dataAssignments.forEach((_, b) => {
        const [one, other] = [constantOf(first, a), constantOf(second, b)];
        if (one && other && key(first, a) === key(second, b)) {
            const x = instances[first.dataAssignmentsCtx[a][0]];
            const [term, otherTerm] = [v.operand(x, assignment.property, one).term, v.operand(x, assignment.property, other).term];
            if (!term.eqIdentity(otherTerm)) {
                result.push({ a, b, formula: term.eq(otherTerm) });
            }
        }
    }));
    return result;
}

/** The literal of the k-th data assignment of scenario i's Then: its status items come first, then its assignments. */
function assignmentLiteral(items: Array<{ i: number, literal: Bool<'main'> }>, rule: WhenRule, i: number, k: number): Bool<'main'> {
    const then = rule.thens[i];
    const statuses = then.availables.length + then.notAvailables.length + then.pendings.length;
    return items.filter(item => item.i === i)[statuses + k].literal;
}

/** The instances, the specifications about them as rules, and x, the instance of the When action (none in no lifecycle). */
function setting(z3: Z3Context, model: Model, names: Record<string, string>, whenCtx: string[], options?: Z3VocabularyOptions) {
    const v = new Z3Vocabulary(z3, model, options);
    const instances: Record<string, Instance> = {};
    const byEntity = new Map<string, Instance>();
    for (const [name, entity] of Object.entries(names)) {
        instances[name] = v.instance(entity, name);
        byEntity.set(entity, instances[name]);
    }
    const [x] = whenCtx.map(name => instances[name]);
    return { v, instances, rules: specificationRules(v, model, byEntity), x };
}

/**
 * The setting of the state after a step: the vocabulary of that state (Z3Vocabulary.after), the instances of that
 * time under the same names (printer: printer′), the specifications about them as rules, and x′.
 */
function afterStep(before: Z3Vocabulary, model: Model, names: Record<string, string>, whenCtx: string[]) {
    const v = before.after();
    const instances: Record<string, Instance> = {};
    const byEntity = new Map<string, Instance>();
    for (const [name, entity] of Object.entries(names)) {
        instances[name] = v.instance(entity, `${name}′`);
        byEntity.set(entity, instances[name]);
    }
    const [x] = whenCtx.map(name => instances[name]);
    return { v, instances, rules: specificationRules(v, model, byEntity), x };
}

/** 'Given: the Printer is busy' */
function titled(prefix: string, formulas: TitledFormula[]): TitledFormula[] {
    return formulas.map(({ title, formula }) => ({ title: `${prefix}: ${title}`, formula }));
}

/** Can the formulas hold together, with the rules of the language (of each vocabulary they use)? If not, those that conflict. */
async function check(z3: Z3Context, vocabularies: Z3Vocabulary[], formulas: TitledFormula[]): Promise<CheckResult> {
    const solver = new z3.Solver();
    solver.set('core.minimize', true);
    formulas.forEach(({ title, formula }) => solver.addAndTrack(formula, z3.Bool.const(title)));
    solver.add(...vocabularies.flatMap(v => v.constraints()));
    const result = await solver.check();
    return { result, conflict: result === 'unsat' ? conflictOf(solver, formulas) : [] };
}
