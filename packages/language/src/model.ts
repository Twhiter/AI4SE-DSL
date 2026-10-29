// The content of a .easy file as plain classes, for semantic inference.
// Everything refers to entities, states, properties, actions and roles by name.
// Conditions are grouped by kind; they are all joined with AND, so only their order is lost.
// A specification is about one entity, so toZ3 turns it into a formula on x, an instance of that entity,
// and passes x on to every condition.

import type { Arith, Bool } from 'z3-solver';
import type { Instance, Z3Vocabulary } from './z3-vocabulary.js';

/** Any is any value: an int, a string or a boolean. */
export type ScalarType = 'int' | 'string' | 'boolean' | 'Any';
export type DataType = ScalarType | 'list' | 'queue';
export type Value = number | string | boolean;
/**
 * A named constant of a scenario's When or Then: a value of its type, unknown unless the scenario says what it is. Each
 * input and output of the When (… with inputs name = "Ann", age, outputs is_adult: of the type the action declares
 * for it, also when the When gives it a value, or leaves it out), or the element a Then dequeues (… is dequeued as
 * job: of the queue's element type). The scenario lists each once, and every use refers to that object; in Z3 it is
 * one constant, the same in every formula that names it. It always has a value.
 */
export class NamedConstant {
    name: string;
    type: ScalarType;

    constructor(name: string, type: ScalarType) {
        this.name = name;
        this.type = type;
    }
}

/** What an assignment puts in, takes out or sets, or an assertion compares with: a value, or a named constant. */
export type Operand = Value | NamedConstant;

/** An input or output of an action, as its Action { … } declares it: file: string. */
export interface Parameter {
    name: string;
    type: ScalarType;
}

/**
 * 'equal to', 'larger than', 'smaller than' for an int, string or boolean; 'included in', 'empty', 'full' for a list or
 * queue; 'undefined' for an int, string, boolean or Any: it has no value (a list or queue always has one).
 */
export type AssertionOperation = 'equal to' | 'larger than' | 'smaller than' | 'included in' | 'empty' | 'full' | 'undefined';
/**
 * 'set to' for an int, string or boolean; 'added with' and 'removed with' for a list ('<value> is added to /
 * removed from <list>' is stored the same way); 'enqueued with' and 'dequeued' for a queue; 'set to empty' for a list
 * or queue.
 */
export type AssignmentOperation = 'set to' | 'added with' | 'removed with' | 'enqueued with' | 'dequeued' | 'set to empty';
/** What a When can say about one of its inputs or outputs: age larger than 17. */
export type ComparisonOperation = 'equal to' | 'larger than' | 'smaller than';
export type ActionStatus = 'available' | 'pending' | 'executed' | 'enabled';

export class Model {
    entities: Entity[] = [];
    roles: Role[] = [];
    /** All action names: the entities' actions and the actions without an entity. */
    actions: string[] = [];
    /** Action name -> names of the roles and entities that initiate it; no entry for an action without an `Action … { … }` block. */
    initiators: Record<string, string[]> = {};
    /** Action name -> names of the roles and entities that observe it. */
    observers: Record<string, string[]> = {};
    /** Action name -> its inputs, in order (empty without 'Input:'); a When names them. */
    inputs: Record<string, Parameter[]> = {};
    /** Action name -> its outputs, what it gives back, in order (empty without 'Output:'). */
    outputs: Record<string, Parameter[]> = {};
    stateSpecifications: StateSpecification[] = [];
    enabledSpecifications: EnabledSpecification[] = [];
    scenarios: Scenario[] = [];
    /** The scenarios grouped by the action of their When, in the order each action first appears. */
    whenRules: WhenRule[] = [];
}

// ---------- Declarations ----------

export class Entity {
    name: string;
    states: string[] = [];
    dataProperties: DataProperty[] = [];
    /** The actions in this entity's lifecycle. */
    actions: string[] = [];

    constructor(name: string) {
        this.name = name;
    }
}

export class DataProperty {
    name: string;
    type: DataType;
    /** For a list or queue: the type of its elements, Any without 'of'. */
    elementType: ScalarType | undefined;

    constructor(name: string, type: DataType, elementType?: ScalarType) {
        this.name = name;
        this.type = type;
        this.elementType = type === 'list' || type === 'queue' ? elementType ?? 'Any' : undefined;
    }
}

export class Role {
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

// ---------- Specifications ----------

/** Declarative specification Printer is busy means { … } */
export class StateSpecification {
    entity: string;
    state: string;
    /** it is online -> 'online' */
    states: string[] = [];
    availables: string[] = [];
    notAvailables: string[] = [];
    pendings: string[] = [];
    notPendings: string[] = [];
    executed: string[] = [];
    notExecuted: string[] = [];
    /** print is enabled -> 'print' */
    enableds: string[] = [];
    dataAssertions: PropertyAssertion[] = [];

    constructor(entity: string, state: string) {
        this.entity = entity;
        this.state = state;
    }

    get title(): string {
        return `${this.entity} is ${this.state}`;
    }

    /** inState(x, state) */
    head(v: Z3Vocabulary, x: Instance): Bool {
        v.expectInstance(x, this.entity, this.title);
        return v.inState(x, this.state);
    }

    /** Its conditions on x, each on its own. */
    conditions(v: Z3Vocabulary, x: Instance): Condition[] {
        return specificationConditions(v, x, this);
    }

    /** inState(x, state) ⇒ condition₁ ∧ condition₂ ∧ …, for x an instance of the entity. */
    toZ3(v: Z3Vocabulary, x: Instance): Bool {
        return means(v, this.head(v, x), this.conditions(v, x));
    }
}

/** Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available } */
export class EnabledSpecification {
    action: string;
    /** start was executed or is not available -> 'start': a condition */
    conditions: string[] = [];
    /** reboot is not pending or is not available -> 'reboot': a milestone */
    milestones: string[] = [];

    constructor(action: string) {
        this.action = action;
    }

    get title(): string {
        return `${this.action} is enabled`;
    }

    /** enabled(x, print) */
    head(v: Z3Vocabulary, x?: Instance): Bool {
        return v.status('enabled', this.action, x);
    }

    /**
     * The conjuncts of its formula on x: its conditions and milestones, each a disjunction, and its action's availability:
     *   start was executed or is not available     ->  executed(x, start) ∨ ¬available(x, start)
     *   reboot is not pending or is not available  ->  ¬pending(reboot) ∨ ¬available(reboot)   (reboot in no lifecycle)
     *   (an enabled action is available)           ->  available(x, print)
     */
    conjuncts(v: Z3Vocabulary, x?: Instance): Condition[] {
        return [
            ...this.conditions.map(action => orNotAvailable(v, action, 'executed', x)),
            ...this.milestones.map(action => orNotAvailable(v, action, 'pending', x)),
            statusCondition(v, STATUS_LISTS[0], this.action, x, x ? [v.nameOf(x)] : [])
        ];
    }

    /**
     * enabled(x, print) ⇔ conjunct₁ ∧ conjunct₂ ∧ … ∧ available(x, print), for x an instance of the action's lifecycle
     * entity; an action in no lifecycle has no x, and its conjuncts are only about actions in none. An equivalence,
     * unlike a Declarative specification's 'means': its conditions, milestones and availability are what enabled is.
     * (An action without an enabled specification is enabled exactly when it is available: the vocabulary's constraints().)
     */
    toZ3(v: Z3Vocabulary, x?: Instance): Bool {
        return v.z3.Iff(this.head(v, x), v.z3.And(...this.conjuncts(v, x).map(conjunct => conjunct.formula)));
    }
}

// ---------- Property assertions and assignments ----------
// The entity is always filled in, also where it is not written: 'its speed' / 'the speed' in a specification
// is the specified entity.

/**
 * the Printer's speed (not) larger than 3, "x" is (not) included in the Printer's jobs, the Printer's jobs is (not) empty,
 * the Person's age is (not) undefined
 */
export class PropertyAssertion {
    entity: string;
    property: string;
    negated: boolean;
    operation: AssertionOperation;
    /**
     * The value or named constant compared with, or looked for in a list or queue (a constant in a When: the Person's
     * age equal to age); undefined for 'empty', 'full' and 'undefined'.
     */
    value: Operand | undefined;
    /**
     * Written as the data a When gives an input or output (age = the Person's age, which says the Person's age equal to
     * age), not as an assertion.
     */
    byEquals: boolean;

    constructor(entity: string, property: string, negated: boolean, operation: AssertionOperation, value: Operand | undefined, byEquals = false) {
        this.entity = entity;
        this.property = property;
        this.negated = negated;
        this.operation = operation;
        this.value = value;
        this.byEquals = byEquals;
    }

    get title(): string {
        const not = this.negated ? 'not ' : '';
        const path = `the ${this.entity}'s ${this.property}`;
        switch (this.operation) {
            case 'included in': return `${operandTitle(valueOf(this))} is ${not}included in ${path}`;
            case 'empty':
            case 'full':
            case 'undefined': return `${path} is ${not}${this.operation}`;
            default: return `${path} ${not}${this.operation} ${operandTitle(valueOf(this))}`;
        }
    }

    /**
     * On x, an instance of the entity; a value or named constant is a term of the type the property takes (see
     * Z3Vocabulary.operand). Every assertion but 'undefined' also says that the property has a value, with 'not' too:
     *   the speed larger than 3            ->  defined speed(x) ∧ speed(x) > 3
     *   the label not equal to "a"         ->  defined label(x) ∧ ¬(label(x) = "a")
     *   the age equal to age               ->  defined age(x) ∧ age(x) = age             (age a named constant)
     *   the age is (not) undefined         ->  ¬defined age(x)   (defined age(x))
     *   "a" is included in the jobs        ->  str("a") ∈ jobs(x)    (a list of Any; "a" for a list of string; a list or
     *                                                               queue always has a value)
     *   3 is included in the waiting       ->  some slot 0 ≤ i < size of waiting(x) holds int(3)
     *   the jobs is empty / full           ->  jobs(x) = ∅ / size(jobs(x)) ≥ capacity
     */
    toZ3(v: Z3Vocabulary, x: Instance): Bool {
        const defined = v.hasValue(x, this.property);
        if (this.operation === 'undefined') {
            if (!defined) {
                throw new Error(`The ${this.entity}'s ${this.property} is a list or queue, which always has a value.`);
            }
            return this.negated ? defined : v.z3.Not(defined);
        }
        const condition = this.condition(v, x);
        const asserted = this.negated ? v.z3.Not(condition) : condition;
        return defined ? v.z3.And(defined, asserted) : asserted;
    }

    /** The same assertion, a named constant in `renaming` replaced: … equal to age -> … equal to the rule's age. */
    renamed(renaming: Map<NamedConstant, NamedConstant>): PropertyAssertion {
        return new PropertyAssertion(this.entity, this.property, this.negated, this.operation, renamedOperand(this.value, renaming), this.byEquals);
    }

    /** What it says about the property's value, without 'not'. */
    private condition(v: Z3Vocabulary, x: Instance): Bool {
        const operand = () => v.operand(x, this.property, valueOf(this));
        switch (this.operation) {
            case 'equal to': {
                const { term, guard } = operand();
                return guarded(v, guard, v.dataProperty(x, this.property).eq(term));
            }
            case 'larger than': {   // ints only
                const { term, guard } = operand();
                return guarded(v, guard, (v.dataProperty(x, this.property) as Arith).gt(term as Arith));
            }
            case 'smaller than': {
                const { term, guard } = operand();
                return guarded(v, guard, (v.dataProperty(x, this.property) as Arith).lt(term as Arith));
            }
            case 'included in': {
                const { term, guard } = operand();
                return guarded(v, guard, v.includes(x, this.property, term));
            }
            case 'empty':
                return v.isEmpty(x, this.property);
            case 'full':
                return v.isFull(x, this.property);
            case 'undefined':
                throw new Error("'undefined' is about the property having a value, not about its value.");
        }
    }
}

/**
 * name = "Ann", age larger than 17, is_adult equal to true, pages not equal to copies: what a When says about one of
 * its inputs or outputs, compared with a value or with another of them.
 */
export class Comparison {
    subject: NamedConstant;
    negated: boolean;
    operation: ComparisonOperation;
    value: Operand;
    /** Written as a value the When gives the input or output (name = "Ann"), not as an assertion (name equal to "Ann"). */
    byEquals: boolean;

    constructor(subject: NamedConstant, negated: boolean, operation: ComparisonOperation, value: Operand, byEquals = false) {
        this.subject = subject;
        this.negated = negated;
        this.operation = operation;
        this.value = value;
        this.byEquals = byEquals;
    }

    get title(): string {
        return this.byEquals
            ? `${this.subject.name} = ${operandTitle(this.value)}`
            : `${this.subject.name} ${this.negated ? 'not ' : ''}${this.operation} ${operandTitle(this.value)}`;
    }

    /**
     * Both sides as terms of the subject's type ('equal to'), or of int ('larger than', 'smaller than'), under the
     * guards of their conversions (see Z3Vocabulary.convert):
     *   name = "Ann"                ->  name = "Ann"
     *   age larger than 17          ->  age > 17
     *   pages not equal to copies   ->  ¬(pages = copies)
     */
    toZ3(v: Z3Vocabulary): Bool {
        const type = this.operation === 'equal to' ? this.subject.type : 'int';
        const [left, right] = [v.convert(this.subject, type), v.convert(this.value, type)];
        const compared = this.operation === 'equal to' ? left.term.eq(right.term)
            : this.operation === 'larger than' ? (left.term as Arith).gt(right.term as Arith) : (left.term as Arith).lt(right.term as Arith);
        const guards = [left.guard, right.guard].filter(guard => guard !== undefined);
        const condition = guards.length > 0 ? v.z3.And(...guards, compared) : compared;
        return this.negated ? v.z3.Not(condition) : condition;
    }

    /** The same comparison, each named constant in `renaming` replaced: age larger than 17 -> the rule's age larger than 17. */
    renamed(renaming: Map<NamedConstant, NamedConstant>): Comparison {
        return new Comparison(renamedOperand(this.subject, renaming), this.negated, this.operation, renamedOperand(this.value, renaming), this.byEquals);
    }
}

/** the Printer's speed is set to 3, the Printer's jobs is added with "x", the Printer's waiting is dequeued (as job) */
export class PropertyAssignment {
    entity: string;
    property: string;
    operation: AssignmentOperation;
    /** The value or named constant set, added, removed or enqueued; undefined for 'dequeued'. */
    value: Operand | undefined;
    /** For 'dequeued as job': the named constant bound to the dequeued element. */
    constant: NamedConstant | undefined;

    constructor(entity: string, property: string, operation: AssignmentOperation, value: Operand | undefined, constant?: NamedConstant) {
        this.entity = entity;
        this.property = property;
        this.operation = operation;
        this.value = value;
        this.constant = constant;
    }

    get title(): string {
        const path = `the ${this.entity}'s ${this.property}`;
        const what = this.value !== undefined ? ` ${operandTitle(this.value)}` : this.constant ? ` as ${this.constant.name}` : '';   // set to empty: nothing
        return `${path} is ${this.operation}${what}`;
    }

    /**
     * What holds once it is done, on x, an instance of the entity; a value or named constant is a term of the type the
     * property takes, under the guard of that conversion (see Z3Vocabulary.operand):
     *   the speed is set to 5             ->  speed(x) = 5
     *   the speed is set to job (Any)     ->  job is an int ∧ speed(x) = the int of job
     *   the jobs is added with "a"        ->  str("a") ∈ jobs(x)
     *   the jobs is removed with "a"      ->  str("a") ∉ jobs(x)
     *   the waiting is enqueued with "a"  ->  the last element of waiting(x) is str("a")
     *   the waiting is dequeued (as job)  ->  the waiting is not full (it lost an element); without time, job is not
     *                                         constrained here: that it was the first element is a fact of the state before
     *   the jobs is set to empty          ->  jobs(x) = ∅ (a queue: its size is 0)
     * Afterwards the property has a value: the speed is set to 5 -> defined speed(x) ∧ speed(x) = 5 (a list or queue
     * always has one).
     */
    toZ3(v: Z3Vocabulary, x: Instance): Bool {
        const effect = this.effect(v, x);
        const defined = v.hasValue(x, this.property);
        return defined ? v.z3.And(defined, effect) : effect;
    }

    private effect(v: Z3Vocabulary, x: Instance): Bool {
        if (this.operation === 'dequeued') {
            return v.z3.Not(v.isFull(x, this.property));
        }
        if (this.operation === 'set to empty') {
            return v.isEmpty(x, this.property);
        }
        const { term, guard } = v.operand(x, this.property, operandOf(this));
        switch (this.operation) {
            case 'set to':
                return guarded(v, guard, v.dataProperty(x, this.property).eq(term));
            case 'added with':
                return guarded(v, guard, v.includes(x, this.property, term));
            case 'removed with':
                return guarded(v, guard, v.z3.Not(v.includes(x, this.property, term)));
            case 'enqueued with':
                return guarded(v, guard, v.isLast(x, this.property, term));
        }
    }
}

// ---------- Z3 ----------

/** A formula with a title for reporting: 'the Printer is online'. */
export interface TitledFormula {
    title: string;
    formula: Bool;
}

/**
 * A specification applied to instances, like a function to its arguments:
 * 'Printer is busy' on [printer], 'reboot is available' on [] (an action in no lifecycle).
 */
export interface SpecificationCall {
    /** The title of the specification. */
    specification: string;
    /** The names of the instances it is applied to. */
    parameters: Context;
}

/** A condition of a specification or a Given. A state or action status names the specification that has it as head. */
export interface Condition extends TitledFormula {
    /** That specification, on the instance in the condition's context. */
    head?: SpecificationCall;
    /** Puts it into a Given, in its list and with its context. */
    addTo(given: Given): void;
}

type SpecificationBody = Pick<StateSpecification,
    'states' | 'availables' | 'notAvailables' | 'pendings' | 'notPendings' | 'executed' | 'notExecuted' | 'enableds' | 'dataAssertions'>;

/** Each status list with its status and whether it is negated: notPendings -> ¬pending ('enabled' is only a head). */
const STATUS_LISTS = [
    ['availables', 'available', false], ['notAvailables', 'available', true],
    ['pendings', 'pending', false], ['notPendings', 'pending', true],
    ['executed', 'executed', false], ['notExecuted', 'executed', true]
] as const;

type StatusList = typeof STATUS_LISTS[number];
/** The status lists, and their context lists, of a Given, or of a Then (which has only some of them). */
type StatusParts = Partial<Record<StatusList[0], string[]> & Record<`${StatusList[0]}Ctx`, Context[]>>;

/** head means { condition₁ AND condition₂ … }: head ⇒ condition₁ ∧ condition₂ ∧ … */
function means(v: Z3Vocabulary, head: Bool, conditions: Condition[]): Bool {
    const formulas = conditions.map(condition => condition.formula);
    return v.z3.Implies(head, formulas.length === 1 ? formulas[0] : v.z3.And(...formulas));
}

/**
 * The conditions of a specification on x, the instance named in their context: statuses (enabled last), then
 * states, then property assertions.
 */
function specificationConditions(v: Z3Vocabulary, x: Instance | undefined, spec: SpecificationBody): Condition[] {
    const ctx: Context = x ? [v.nameOf(x)] : [];
    const statuses = [
        ...STATUS_LISTS.flatMap(list => spec[list[0]].map(action => statusCondition(v, list, action, x, v.lifecycleOf(action) ? ctx : []))),
        ...spec.enableds.map(action => enabledCondition(v, action, x, v.lifecycleOf(action) ? ctx : []))
    ];
    if (spec.states.length + spec.dataAssertions.length === 0) {
        return statuses;
    }
    if (!x) {
        throw new Error('States and properties need an instance.');
    }
    return [
        ...statuses,
        ...spec.states.map(state => stateCondition(v, state, x, ctx)),
        ...spec.dataAssertions.map(assertion => dataCondition(v, assertion, x, ctx))
    ];
}

/** The statuses of a Given or Then, each on the instance in its context (none for an action in no lifecycle). */
function statusConditions(v: Z3Vocabulary, part: StatusParts, instances: Record<string, Instance>): Condition[] {
    return STATUS_LISTS.flatMap(list => (part[list[0]] ?? []).map((action, i) => {
        const ctx = (part[`${list[0]}Ctx`] ?? [])[i];   // a list and its context list come together
        return statusCondition(v, list, action, instanceOf(instances, ctx), ctx);
    }));
}

/** print is (not) pending -> (¬)pending(x, print); its head is the specification 'print is (not) pending'. */
function statusCondition(v: Z3Vocabulary, [list, status, negated]: StatusList, action: string, x: Instance | undefined, ctx: Context): Condition {
    const formula = v.status(status, action, x);
    const title = statusTitle(action, status, negated);
    return {
        title, formula: negated ? v.z3.Not(formula) : formula, head: { specification: title, parameters: ctx },
        addTo: given => {
            given[list].push(action);
            given[`${list}Ctx`].push(ctx);
        }
    };
}

/**
 * print is enabled -> enabled(x, print): what its enabled specification says, or that it is available without one
 * (the vocabulary's constraints()); its head is the specification 'print is enabled'.
 */
function enabledCondition(v: Z3Vocabulary, action: string, x: Instance | undefined, ctx: Context): Condition {
    const title = `${action} is enabled`;
    return {
        title, formula: v.status('enabled', action, x), head: { specification: title, parameters: ctx },
        addTo: given => {
            given.enableds.push(action);
            given.enabledsCtx.push(ctx);
        }
    };
}

/**
 * start was executed or is not available -> executed(x, start) ∨ ¬available(x, start)
 * start is not pending or is not available -> ¬pending(x, start) ∨ ¬available(x, start)
 * No specification has it as head, and a Given cannot hold it.
 */
function orNotAvailable(v: Z3Vocabulary, action: string, status: 'executed' | 'pending', x: Instance | undefined): Condition {
    const first = status === 'executed' ? v.status('executed', action, x) : v.z3.Not(v.status('pending', action, x));
    const title = `${action} ${status === 'executed' ? 'was executed' : 'is not pending'} or is not available`;
    return {
        title, formula: v.z3.Or(first, v.z3.Not(v.status('available', action, x))),
        addTo: () => {
            throw new Error(`'${title}' cannot be put into a Given.`);
        }
    };
}

/** the Printer is online -> inState(x, online); its head is the specification 'Printer is online'. */
function stateCondition(v: Z3Vocabulary, state: string, x: Instance, ctx: Context): Condition {
    const entity = v.entityOf(x).name;
    return {
        title: `the ${entity} is ${state}`, formula: v.inState(x, state), head: { specification: `${entity} is ${state}`, parameters: ctx },
        addTo: given => {
            given.states.push([entity, state]);
            given.statesCtx.push(ctx);
        }
    };
}

/** the Printer's speed larger than 2 -> speed(x) > 2 (no specification has it as head). */
function dataCondition(v: Z3Vocabulary, assertion: PropertyAssertion, x: Instance, ctx: Context): Condition {
    return {
        title: assertion.title, formula: assertion.toZ3(v, x),
        addTo: given => {
            given.dataAssertions.push(assertion);
            given.dataAssertionsCtx.push(ctx);
        }
    };
}

/** print is (not) available, print was (not) executed */
function statusTitle(action: string, status: ActionStatus, negated: boolean): string {
    return `${action} ${status === 'executed' ? 'was' : 'is'} ${negated ? 'not ' : ''}${status}`;
}

/** guard ∧ formula, or the formula alone when there is no guard. */
function guarded(v: Z3Vocabulary, guard: Bool | undefined, formula: Bool): Bool {
    return guard ? v.z3.And(guard, formula) : formula;
}

/** 3, "a", true, job */
function operandTitle(operand: Operand): string {
    return typeof operand === 'object' ? operand.name : typeof operand === 'string' ? JSON.stringify(operand) : String(operand);
}

/** The operand, or the named constant `renaming` puts for it. */
function renamedOperand<T extends Operand | undefined>(operand: T, renaming: Map<NamedConstant, NamedConstant>): T {
    return (operand instanceof NamedConstant ? renaming.get(operand) ?? operand : operand) as T;
}

/** The value or named constant of an assertion whose operation has one. */
function valueOf(node: PropertyAssertion): Operand {
    if (node.value === undefined) {
        throw new Error(`'${node.operation}' needs a value (the ${node.entity}'s ${node.property}).`);
    }
    return node.value;
}

/** The value or named constant of an assignment whose operation has one. */
function operandOf(node: PropertyAssignment): Operand {
    if (node.value === undefined) {
        throw new Error(`'${node.operation}' needs a value (the ${node.entity}'s ${node.property}).`);
    }
    return node.value;
}

// ---------- Scenarios ----------
// A scenario has one set of instances for its Given, When and Then (one per entity: Print job -> print_job).
// Each list has a context list next to it: entry i holds the instances that item i is about.

/** The instances an item is about: ['printer'], or [] for an action in no lifecycle. */
export type Context = string[];

export class Scenario {
    name: string;
    /** Instance name -> its entity: { printer: 'Printer' } */
    instances: Record<string, string> = {};
    given: Given = new Given();
    /** The action executed in the When. */
    when: string;
    whenCtx: Context;
    /** The When's inputs, in the order the action declares them, each a named constant: one it leaves out is any value. */
    inputs: NamedConstant[] = [];
    /** The When's outputs, what the action gives back, in the order the action declares them, each a named constant. */
    outputs: NamedConstant[] = [];
    /**
     * What the When says about its inputs, at the Given's time: their values (age = 30), the data they are
     * (age = the Person's age), its assertions about them and about data (age larger than 17, the Person's age larger than 3).
     */
    inputAssertions: WhenAssertions = new WhenAssertions();
    /**
     * What the When says about its outputs, at the Then's time: their values (is_adult = true), the data they are
     * (pages = the Printer's speed, the data as at the Given's time), its assertions that mention an output.
     */
    outputAssertions: WhenAssertions = new WhenAssertions();
    then: Then = new Then();
    /** The named constants of the When and the Then: the inputs, the outputs, then each '… dequeued as'. */
    constants: NamedConstant[] = [];

    constructor(name: string, when: string, whenCtx: Context) {
        this.name = name;
        this.when = when;
        this.whenCtx = whenCtx;
    }
}

/**
 * What a When says besides its action, about its inputs or about its outputs, each a named constant: comparisons
 * (name = "Ann", age larger than 17, is_adult = true), and data assertions, about data as it is at the Given's time
 * (age = the Person's age, which says the Person's age equal to age; … AND the Person's age larger than 3).
 */
export class WhenAssertions {
    comparisons: Comparison[] = [];
    dataAssertions: PropertyAssertion[] = [];
    dataAssertionsCtx: Context[] = [];

    /** All of it: the comparisons, then the data assertions, each on its instance of the Given's time in `instances`. */
    toZ3(v: Z3Vocabulary, instances: Record<string, Instance>): TitledFormula[] {
        return [
            ...this.comparisons.map(comparison => ({ title: comparison.title, formula: comparison.toZ3(v) })),
            ...this.dataAssertions.map((assertion, i) =>
                ({ title: assertion.title, formula: assertion.toZ3(v, required(instanceOf(instances, this.dataAssertionsCtx[i]))) }))
        ];
    }

    /** Both together: these, then `other`'s, each named constant in `renaming` replaced. */
    joined(other: WhenAssertions, renaming: Map<NamedConstant, NamedConstant>): WhenAssertions {
        return Object.assign(new WhenAssertions(), {
            comparisons: [...this.comparisons, ...other.comparisons].map(comparison => comparison.renamed(renaming)),
            dataAssertions: [...this.dataAssertions, ...other.dataAssertions].map(assertion => assertion.renamed(renaming)),
            dataAssertionsCtx: [...this.dataAssertionsCtx, ...other.dataAssertionsCtx]
        });
    }
}

/**
 * when(a, age, is_adult): (G₁ ∧ In₁ ∧ Out₁ ⇒ T₁) ∧ (G₂ ∧ In₂ ∧ Out₂ ⇒ T₂) ∧ …: all scenarios whose When executes the
 * same action, as one rule over a step, a transition: its Given (G) about the state before it, its inputs (In) given at
 * its start, its outputs (Out) given back at its end, and its Then (T) about the state after it. Inputs and outputs are
 * values of the step, not of a state, and independent of each other: a scenario applies when its Given holds and the
 * step's inputs and outputs are as its When says. Entry i of each list is about its scenario i: givens[i] holds G, In
 * and Out (all that the When says), thens[i] holds T. A When's inputs and outputs are local to its scenario, so they
 * are renamed to the parameters, the step's, of the same names (… with inputs job: job is the rule's job); the values
 * it gives them are conditions (… with inputs job = "draft": job = "draft").
 */
export class WhenRule {
    /** The action of the When. */
    action: string;
    /** The instance of its lifecycle entity: ['printer'], or [] for an action in no lifecycle. */
    actionCtx: Context;
    /** The inputs and outputs of a step: one named constant per input of the action, then per output, by its name and type. */
    parameters: NamedConstant[];
    /** The scenarios, by name, in the order of the file. */
    scenarios: string[] = [];
    /** Where they are in the model's scenarios. */
    indices: number[] = [];
    /** Each scenario's Given and When: its Given, and what its When says about the parameters and about data before the step. */
    givens: Given[] = [];
    /** Each scenario's When alone: what it says about its inputs and its outputs, together, renamed to the parameters. */
    whens: WhenAssertions[] = [];
    /** Each scenario's Then, its inputs and outputs replaced by the parameters. */
    thens: Then[] = [];
    /** The other named constants of each scenario: each '… dequeued as'. */
    constants: NamedConstant[][] = [];
    /** Instance name -> its entity, for all its scenarios (an entity's instance has the same name in each). */
    instances: Record<string, string> = {};

    constructor(action: string, actionCtx: Context, parameters: NamedConstant[]) {
        this.action = action;
        this.actionCtx = actionCtx;
        this.parameters = parameters;
    }
}

export class Given {
    /** the Printer is idle -> ['Printer', 'idle'] */
    states: Array<[entity: string, state: string]> = [];
    statesCtx: Context[] = [];
    availables: string[] = [];
    availablesCtx: Context[] = [];
    notAvailables: string[] = [];
    notAvailablesCtx: Context[] = [];
    pendings: string[] = [];
    pendingsCtx: Context[] = [];
    notPendings: string[] = [];
    notPendingsCtx: Context[] = [];
    executed: string[] = [];
    executedCtx: Context[] = [];
    notExecuted: string[] = [];
    notExecutedCtx: Context[] = [];
    /** print is enabled -> 'print' */
    enableds: string[] = [];
    enabledsCtx: Context[] = [];
    dataAssertions: PropertyAssertion[] = [];
    dataAssertionsCtx: Context[] = [];
    /** In a When rule: the values the When gives its inputs and outputs, as conditions on the parameters (job = "draft"); none in a scenario. */
    values: Array<[parameter: NamedConstant, value: Value]> = [];
    /** In a When rule: the When's other comparisons of its inputs and outputs (age larger than 17); none in a scenario. */
    comparisons: Comparison[] = [];

    /**
     * Each condition on the instance in its context (instance name -> its Z3 constant):
     *   the Printer is busy                ->  inState(printer, busy)
     *   print is pending                   ->  pending(printer, print)
     *   print is enabled                   ->  enabled(printer, print)
     *   the Printer's speed larger than 2  ->  speed(printer) > 2
     *   job = "draft", age larger than 17  ->  job = "draft", age > 17      (in a When rule)
     */
    conditions(v: Z3Vocabulary, instances: Record<string, Instance>): Condition[] {
        const on = (ctx: Context) => required(instanceOf(instances, ctx));
        return [
            ...this.states.map(([, state], i) => stateCondition(v, state, on(this.statesCtx[i]), this.statesCtx[i])),
            ...statusConditions(v, this, instances),
            ...this.enableds.map((action, i) => enabledCondition(v, action, instanceOf(instances, this.enabledsCtx[i]), this.enabledsCtx[i])),
            ...this.dataAssertions.map((assertion, i) => dataCondition(v, assertion, on(this.dataAssertionsCtx[i]), this.dataAssertionsCtx[i])),
            ...this.valueConditions(v),
            ...this.comparisons.map(comparison => ({
                title: comparison.title, formula: comparison.toZ3(v),
                addTo: (given: Given) => {
                    given.comparisons.push(comparison);
                }
            }))
        ];
    }

    /** Its values of the parameters: job is "draft" -> job = "draft" (as a term of the parameter's type). */
    valueConditions(v: Z3Vocabulary): Condition[] {
        return this.values.map(([parameter, value]) => {
            const { term, guard } = v.convert(value, parameter.type);
            return {
                title: `${parameter.name} is ${operandTitle(value)}`, formula: guarded(v, guard, v.constant(parameter).eq(term)),
                addTo: given => {
                    given.values.push([parameter, value]);
                }
            };
        });
    }

    /** A copy, whose lists are its own. */
    copy(): Given {
        return copyLists(this, new Given());
    }

    /** The same Given, each named constant in `renaming` replaced: … equal to age -> … equal to the rule's age. */
    renamed(renaming: Map<NamedConstant, NamedConstant>): Given {
        const given = this.copy();
        given.dataAssertions = this.dataAssertions.map(assertion => assertion.renamed(renaming));
        given.values = this.values.map(([parameter, value]) => [renaming.get(parameter) ?? parameter, value]);
        given.comparisons = this.comparisons.map(comparison => comparison.renamed(renaming));
        return given;
    }

    /**
     * Only its property assertions, and what the When says about the parameters. Each state is replaced by what its Declarative specification
     * says, and a state there by what its own says, until only action statuses and property assertions remain; a state
     * met again (a cycle of specifications, which the editor warns about) is left out. Then the action statuses are
     * left out, with the Given's own (available, pending, executed, enabled). An assertion said twice is kept once.
     *   the Printer is busy AND the Printer's speed larger than 2
     *   (busy means { it is online AND the jobs is not empty AND print is pending }, online means { the ready equal to true })
     *   -> the Printer's ready equal to true AND the Printer's jobs is not empty AND the Printer's speed larger than 2
     */
    saturated(specifications: StateSpecification[]): Given {
        const given = new Given();
        given.values = [...this.values];
        given.comparisons = [...this.comparisons];
        const add = (assertion: PropertyAssertion, ctx: Context) => {
            if (!given.dataAssertions.some((other, i) => other.title === assertion.title && given.dataAssertionsCtx[i][0] === ctx[0])) {
                given.dataAssertions.push(assertion);
                given.dataAssertionsCtx.push(ctx);
            }
        };
        const replaced = new Set<string>();
        const replace = (entity: string, state: string, ctx: Context) => {
            if (!replaced.has(`${ctx[0]} ${state}`)) {
                replaced.add(`${ctx[0]} ${state}`);
                for (const spec of specifications.filter(spec => spec.entity === entity && spec.state === state)) {
                    spec.states.forEach(other => replace(entity, other, ctx));
                    spec.dataAssertions.forEach(assertion => add(assertion, ctx));
                }
            }
        };
        this.states.forEach(([entity, state], i) => replace(entity, state, this.statesCtx[i]));
        this.dataAssertions.forEach((assertion, i) => add(assertion, this.dataAssertionsCtx[i]));
        return given;
    }

    /** Its action statuses as titles, list by list: 'print is pending', 'reboot was not executed', 'print is enabled'. */
    statusTitles(): string[] {
        return [
            ...STATUS_LISTS.flatMap(([list, status, negated]) => this[list].map(action => statusTitle(action, status, negated))),
            ...this.enableds.map(action => `${action} is enabled`)
        ];
    }
}

/** What a Then says: which actions are pending, available or not available, and its data constraints. */
export class Then {
    availables: string[] = [];
    availablesCtx: Context[] = [];
    notAvailables: string[] = [];
    notAvailablesCtx: Context[] = [];
    pendings: string[] = [];
    pendingsCtx: Context[] = [];
    dataAssignments: PropertyAssignment[] = [];
    dataAssignmentsCtx: Context[] = [];

    /**
     * What holds once the When action is done, each on the instance in its context; a named constant is the
     * same Z3 constant in every effect that names it:
     *   print is not available               ->  ¬available(printer, print)
     *   the Printer's jobs is added with 42  ->  int(42) ∈ jobs(printer)
     */
    toZ3(v: Z3Vocabulary, instances: Record<string, Instance>): TitledFormula[] {
        return [
            ...statusConditions(v, this, instances),
            ...this.dataAssignments.map((assignment, i) =>
                ({ title: assignment.title, formula: assignment.toZ3(v, required(instanceOf(instances, this.dataAssignmentsCtx[i]))) }))
        ];
    }

    /** The titles of its items, in the order of toZ3: 'print is not available', "the Printer's jobs is added with job". */
    titles(): string[] {
        return [
            ...STATUS_LISTS.flatMap(([list, status, negated]) => ((this as StatusParts)[list] ?? []).map(action => statusTitle(action, status, negated))),
            ...this.dataAssignments.map(assignment => assignment.title)
        ];
    }

    /** The same Then, each named constant in `renaming` replaced: … is added with job -> … is added with input 1. */
    renamed(renaming: Map<NamedConstant, NamedConstant>): Then {
        const rename = <T>(operand: T) => (operand instanceof NamedConstant ? renaming.get(operand) ?? operand : operand) as T;
        const then = copyLists(this, new Then());
        then.dataAssignments = this.dataAssignments.map(assignment =>
            new PropertyAssignment(assignment.entity, assignment.property, assignment.operation, rename(assignment.value), rename(assignment.constant)));
        return then;
    }
}

/** `empty`, with the fields of `object` (a Given or Then), each list a copy of its own. */
function copyLists<T extends object>(object: T, empty: T): T {
    return Object.assign(empty, Object.fromEntries(Object.entries(object).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])));
}

/** The instance a context names: ['printer'] -> printer; [] (an action in no lifecycle) -> undefined. */
function instanceOf(instances: Record<string, Instance>, [name]: Context): Instance | undefined {
    if (name !== undefined && !instances[name]) {
        throw new Error(`The scenario has no instance '${name}'.`);
    }
    return name === undefined ? undefined : instances[name];
}

/** The instance of a state or property, whose context always names one. */
function required(x: Instance | undefined): Instance {
    if (!x) {
        throw new Error('A state or property needs an instance.');
    }
    return x;
}
