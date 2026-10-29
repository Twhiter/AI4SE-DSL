// The Z3 sorts and functions of a Model, for turning conditions into formulas on instances.
// Only types come from z3-solver; the context is passed in, so the web bundle stays free of Z3.

import type { Arith, ArithSort, Bool, BoolSort, Context, DatatypeSort, Expr, Sort, SMTArray } from 'z3-solver';
import type { ActionStatus, DataProperty, Entity, Model, NamedConstant, Operand, ScalarType, Value } from './model.js';

/** The context formulas are built in: `const { Context } = await init(); const z3 = new Context('main');` */
export type Z3Context = Context<'main'>;
/** An instance of an entity: a constant such as x. */
export type Instance = Expr<'main'>;
/** A list: a set of its elements (Z3 represents a set as an array from its elements to Bool). */
export type List = SMTArray<'main', [Sort<'main'>], BoolSort<'main'>>;
/** A value or named constant as a Z3 term of some type, with the condition under which the conversion to that type holds. */
export interface Term {
    term: Expr<'main'>;
    /** Undefined when nothing needed converting. */
    guard?: Bool<'main'>;
}
/** A queue: its elements in the slots 0 … size − 1 of items, in order; slot 0 is the front. */
export interface Queue {
    items: SMTArray<'main', [ArithSort<'main'>], Sort<'main'>>;
    size: Arith<'main'>;
}

/** The capacity of a list or queue when none is given. */
export const DEFAULT_CAPACITY = 9999;

export interface Z3VocabularyOptions {
    /** The most elements a list or queue can hold; one holding that many is full. Default: DEFAULT_CAPACITY. */
    capacity?: number;
}

/**
 * Names the Z3 symbols of a model:
 *   entity                 Printer                     a sort
 *   its states             Printer state               an enumeration sort: online | idle | busy
 *   its actions            Printer action              an enumeration sort: start | print
 *   actions in no entity   Action                      an enumeration sort: reboot
 *   state                  inState(x, busy)
 *   status                 pending(x, print), or pending(reboot) for an action in no entity; an action without an
 *                          enabled specification is enabled exactly when available: enabled(x, start) ⇔ available(x, start),
 *                          in constraints() (one with an enabled specification is enabled as that specification says)
 *   Any                    Value                       int(Int) | str(String) | bool(Bool)
 *   int / string / boolean speed(x)                    speed: Printer -> Int     (an Any property: -> Value)
 *   list                   jobs(x)                     jobs: Printer -> Set(Value), with size(jobs(x)) for 'full'
 *                                                      (a list of int: Set(Int); of string: Set(String); …)
 *   queue                  waiting items(x)            waiting items: Printer -> Array(Int, Value)   (of int: Array(Int, Int); …)
 *                          waiting size(x)             waiting size: Printer -> Int
 *   has a value            defined speed(x)            defined speed: Printer -> Bool, for an int, string, boolean or Any
 *                                                      property (a list or queue always has a value: it starts empty)
 *   named constant         job                         a constant of its type: String for a queue of string, Value for Any
 *                                                      (it always has a value)
 * Z3 treats a sort or function declared twice with the same name and signature as the same one, so they are
 * declared where they are used; only the Value sort and the enumeration sorts are kept.
 * A step, from a state s to a state s′, is checked with a vocabulary for each (after()): an entity's properties,
 * states and statuses are told apart by its instances of each state (person, person′), and the statuses of an action
 * in no lifecycle by their names (pending(reboot), pending after(reboot)); named constants are the same in both.
 */
export class Z3Vocabulary {
    readonly z3: Z3Context;
    readonly capacity: number;
    private readonly model: Model;
    /** What the vocabularies of a step's two states share: the Value sort, the enumeration sorts, the names of named constants. */
    private shared: {
        valueSort?: DatatypeSort<'main'>;
        /** Enumeration sort name -> its values by name. */
        enumerations: Map<string, Map<string, Expr<'main'>>>;
        /** Named constants whose Z3 constant has another name than their own, set by nameConstant. */
        constantNames: Map<NamedConstant, string>;
    } = { enumerations: new Map(), constantNames: new Map() };
    /** The state after a step (after()): the statuses of an action in no lifecycle are its own ones, 'pending after'. */
    private time: 'after' | undefined = undefined;
    /** The lists and queues built so far, by the Z3 id of their term, for the size constraints. */
    private readonly lists = new Map<number, List>();
    private readonly queues = new Map<number, Queue>();
    /** The enabled statuses built so far, by the Z3 id of their term, with their action and its available status. */
    private readonly enabledStatuses = new Map<number, { action: string, enabled: Bool<'main'>, available: Bool<'main'> }>();

    constructor(z3: Z3Context, model: Model, options: Z3VocabularyOptions = {}) {
        this.z3 = z3;
        this.model = model;
        this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    }

    /**
     * The vocabulary of the state after a step, to check the step in one solver with this one: the same sorts and named
     * constants; give it instances of its own (printer′), and add the constraints of both.
     */
    after(): Z3Vocabulary {
        const next = new Z3Vocabulary(this.z3, this.model, { capacity: this.capacity });
        next.shared = this.shared;
        next.time = 'after';
        return next;
    }

    /** A new instance of an entity: `instance('Printer', 'p')`. */
    instance(entity: string, name: string): Instance {
        return this.z3.Const(name, this.sort(this.entity(entity)));
    }

    /** The name of an instance: instance('Printer', 'p') -> 'p'. */
    nameOf(x: Instance): string {
        return String(x.decl().name());
    }

    /** The entity x is an instance of, from its sort. */
    entityOf(x: Instance): Entity {
        return this.entity(String(x.sort.name()));
    }

    /** inState(x, busy) */
    inState(x: Instance, state: string): Bool<'main'> {
        const entity = this.entityOf(x);
        return this.predicate('inState', x, this.enumerationValue(`${entity.name} state`, entity.states, state));
    }

    /**
     * pending(x, print) for an action in the lifecycle of x's entity; pending(reboot) for an action in no lifecycle
     * (after a step: pending after(reboot)). An enabled status is noted for constraints(), which says when an action
     * without an enabled specification is enabled.
     */
    status(status: ActionStatus, action: string, x: Instance | undefined): Bool<'main'> {
        const args = this.actionArguments(action, x);
        const named = (status: ActionStatus) => this.time && !this.lifecycleOf(action) ? `${status} ${this.time}` : status;
        const term = this.predicate(named(status), ...args);
        if (status === 'enabled') {
            this.enabledStatuses.set(term.id(), { action, enabled: term, available: this.predicate(named('available'), ...args) });
        }
        return term;
    }

    /** Throws unless x is an instance of the entity that `specification` is about. */
    expectInstance(x: Instance, entity: string, specification: string): void {
        const actual = this.entityOf(x).name;
        if (actual !== entity) {
            throw new Error(`'${specification}' is about a ${entity}, but ${x} is a ${actual}.`);
        }
    }

    /** The entity whose lifecycle the action is in, if any. */
    lifecycleOf(action: string): Entity | undefined {
        return this.model.entities.find(entity => entity.actions.includes(action));
    }

    /** speed(x): an int, string, boolean or Any property. */
    dataProperty(x: Instance, name: string): Expr<'main'> {
        const property = this.property(x, name);
        if (property.type === 'list' || property.type === 'queue') {
            throw new Error(`'${name}' is a ${property.type}, not an int, string, boolean or Any.`);
        }
        return this.z3.Function.declare(name, x.sort, this.sortOf(property.type)).call(x);
    }

    /**
     * defined speed(x): the property of x has a value (is not undefined); undefined for a list or queue, which always
     * has one.
     */
    hasValue(x: Instance, name: string): Bool<'main'> | undefined {
        const property = this.property(x, name);
        if (property.type === 'list' || property.type === 'queue') {
            return undefined;
        }
        return this.z3.Function.declare(`defined ${name}`, x.sort, this.z3.Bool.sort()).call(x);
    }

    /** The Z3 constant of a named constant, of its type: job. */
    constant(constant: NamedConstant): Expr<'main'> {
        return this.z3.Const(this.shared.constantNames.get(constant) ?? constant.name, this.sortOf(constant.type));
    }

    /**
     * Gives the Z3 constant of a named constant another name than its own, when two scenarios are checked together:
     * the same name for two inputs makes them one constant, and different names keep two constants named alike apart.
     */
    nameConstant(constant: NamedConstant, name: string): void {
        this.shared.constantNames.set(constant, name);
    }

    /**
     * A value or a named constant as a term of the type the property `name` of x takes (its own type, or its element type),
     * with the guard under which the conversion holds:
     *   3 for an int                     3
     *   3 for Any (a list of Any)        int(3)
     *   job (Any) for an int             the int of job, when job is an int
     *   job (a string) for an int        the int of str(job), when str(job) is an int: never
     */
    operand(x: Instance, name: string, operand: Operand): Term {
        const property = this.property(x, name);
        return this.convert(operand, property.elementType ?? property.type as ScalarType);
    }

    /** 3, "a" or true as a Z3 value of its own type. */
    value(value: Value): Expr<'main'> {
        switch (typeof value) {
            case 'number': return this.z3.Int.val(value);
            case 'string': return this.z3.String.val(value);
            case 'boolean': return this.z3.Bool.val(value);
        }
    }

    /** An element is included in the jobs: element ∈ jobs(x); in a queue: some slot 0 ≤ i < size holds it. */
    includes(x: Instance, name: string, element: Expr<'main'>): Bool<'main'> {
        if (this.property(x, name).type === 'list') {
            return this.z3.Select(this.list(x, name), element);
        }
        const { items, size } = this.queue(x, name);
        const slot = this.z3.Int.const('slot');
        return this.z3.Exists([slot], this.z3.And(this.z3.GE(slot, 0), this.z3.LT(slot, size), items.select(slot).eq(element)));
    }

    /** jobs(x) = ∅ for a list, waiting size(x) = 0 for a queue. */
    isEmpty(x: Instance, name: string): Bool<'main'> {
        if (this.property(x, name).type === 'list') {
            const list = this.list(x, name);
            return list.eq(this.z3.EmptySet(list.sort.domain()));
        }
        return this.queue(x, name).size.eq(0);
    }

    /** Holding as many elements as the capacity: size ≥ capacity (with the size constraints, exactly the capacity). */
    isFull(x: Instance, name: string): Bool<'main'> {
        const size = this.property(x, name).type === 'list' ? this.listSize(this.list(x, name)) : this.queue(x, name).size;
        return this.z3.GE(size, this.capacity);
    }

    /** The last element of the queue is the element: size ≥ 1 and slot size − 1 holds it. */
    isLast(x: Instance, name: string, element: Expr<'main'>): Bool<'main'> {
        const { items, size } = this.queue(x, name);
        return this.z3.And(this.z3.GE(size, 1), items.select(size.sub(1)).eq(element));
    }

    /**
     * The rules of the language for every term built so far; add them to the solver together with the formulas,
     * after building those:
     *   0 ≤ size ≤ capacity            for lists and queues
     *   size = 0 ⇔ the list is ∅       for lists (a queue's elements are its slots 0 … size − 1, so it needs none)
     *   enabled ⇔ available            for every enabled status of an action without an enabled specification (one
     *                                  with an enabled specification is enabled as that specification says)
     * A list's size is not counted from its members; a queue's is, as its elements take its slots.
     */
    constraints(): Array<Bool<'main'>> {
        const bounds = (size: Arith<'main'>) => [this.z3.GE(size, 0), this.z3.LE(size, this.capacity)];
        return [
            ...[...this.lists.values()].flatMap(list => [...bounds(this.listSize(list)), this.listSize(list).eq(0).eq(list.eq(this.z3.EmptySet(list.sort.domain())))]),
            ...[...this.queues.values()].flatMap(queue => bounds(queue.size)),
            ...[...this.enabledStatuses.values()]
                .filter(({ action }) => !this.model.enabledSpecifications.some(spec => spec.action === action))
                .map(({ enabled, available }) => this.z3.Iff(enabled, available))
        ];
    }

    // ---------- Types ----------

    /** The sort of a type: Int, String, Bool, or Value for Any. */
    private sortOf(type: ScalarType): Sort<'main'> {
        switch (type) {
            case 'int': return this.z3.Int.sort();
            case 'string': return this.z3.String.sort();
            case 'boolean': return this.z3.Bool.sort();
            case 'Any': return this.values();
        }
    }

    /**
     * A value or named constant as a term of `type`: as it is when it has that type; otherwise through Value, wrapped in
     * the constructor of its own type (int(…), str(…), bool(…)) and, unless `type` is Any, unwrapped by the
     * accessor of `type`, under the guard that it was made by that type's constructor.
     */
    convert(operand: Operand, type: ScalarType): Term {
        const [term, from] = typeof operand === 'object' ? [this.constant(operand), operand.type] : [this.value(operand), typeOfValue(operand)];
        if (from === type) {
            return { term };
        }
        const value = from === 'Any' ? term : this.values().constructorDecl(CONSTRUCTOR[from]).call(term);
        if (type === 'Any') {
            return { term: value };
        }
        return {
            term: this.values().accessor(CONSTRUCTOR[type], 0).call(value),
            guard: this.values().recognizer(CONSTRUCTOR[type]).call(value) as Bool<'main'>
        };
    }

    // ---------- Declarations ----------

    private sort(entity: Entity): Sort<'main'> {
        return this.z3.Sort.declare(entity.name);
    }

    /** A Bool function of the arguments' sorts, applied to them: inState(x, busy). */
    private predicate(name: string, ...args: [Expr<'main'>, ...Array<Expr<'main'>>]): Bool<'main'> {
        const domain = args.map(arg => arg.sort) as [Sort<'main'>, ...Array<Sort<'main'>>];
        return this.z3.Function.declare(name, ...domain, this.z3.Bool.sort()).call(...args);
    }

    /** [x, print] for an action in the lifecycle of x's entity, [reboot] for an action in no lifecycle. */
    private actionArguments(action: string, x: Instance | undefined): [Expr<'main'>, ...Array<Expr<'main'>>] {
        const lifecycle = this.lifecycleOf(action);
        if (!lifecycle) {
            return [this.enumerationValue('Action', this.actionsInNoLifecycle(), action)];
        }
        if (!x || this.entityOf(x) !== lifecycle) {
            throw new Error(`'${action}' is in the lifecycle of the ${lifecycle.name}, so its status needs an instance of it.`);
        }
        return [x, this.enumerationValue(`${lifecycle.name} action`, lifecycle.actions, action)];
    }

    /** The value `name` of the enumeration sort `sort` with the values `names`, declaring the sort on first use. */
    private enumerationValue(sort: string, names: string[], name: string): Expr<'main'> {
        let values = this.shared.enumerations.get(sort);
        if (!values) {
            const datatype = this.z3.Datatype(sort);
            names.forEach(value => datatype.declare(value));
            const created = datatype.create();
            values = new Map(names.map((value, index) => [value, created.constructorDecl(index).call()]));
            this.shared.enumerations.set(sort, values);
        }
        const value = values.get(name);
        if (!value) {
            throw new Error(`'${name}' is not one of ${sort}: ${names.join(', ')}.`);
        }
        return value;
    }

    /** Value = int(Int) | str(String) | bool(Bool), declared on first use. */
    private values(): DatatypeSort<'main'> {
        if (!this.shared.valueSort) {
            const datatype = this.z3.Datatype('Value');
            datatype.declare('int', ['int value', this.z3.Int.sort()]);
            datatype.declare('str', ['str value', this.z3.String.sort()]);
            datatype.declare('bool', ['bool value', this.z3.Bool.sort()]);
            this.shared.valueSort = datatype.create();
        }
        return this.shared.valueSort;
    }

    private list(x: Instance, name: string): List {
        const element = this.sortOf(this.property(x, name).elementType ?? 'Any');
        const list = this.z3.Function.declare(name, x.sort, this.z3.Set.sort(element)).call(x) as List;
        this.lists.set(list.id(), list);
        return list;
    }

    /** size(jobs(x)), an Int function on sets. */
    private listSize(list: List): Arith<'main'> {
        return this.z3.Function.declare('size', list.sort, this.z3.Int.sort()).call(list);
    }

    private queue(x: Instance, name: string): Queue {
        const element = this.sortOf(this.property(x, name).elementType ?? 'Any');
        const items = this.z3.Function.declare(`${name} items`, x.sort, this.z3.Array.sort(this.z3.Int.sort(), element)).call(x) as Queue['items'];
        const size = this.z3.Function.declare(`${name} size`, x.sort, this.z3.Int.sort()).call(x);
        this.queues.set(size.id(), { items, size });
        return { items, size };
    }

    // ---------- Looking up the model ----------
    // The model of an error-free document has everything a condition names; these only fail for a model put together by hand.

    private entity(name: string): Entity {
        const entity = this.model.entities.find(candidate => candidate.name === name);
        if (!entity) {
            throw new Error(`The model has no entity '${name}'.`);
        }
        return entity;
    }

    private actionsInNoLifecycle(): string[] {
        return this.model.actions.filter(action => !this.lifecycleOf(action));
    }

    private property(x: Instance, name: string): DataProperty {
        const entity = this.entityOf(x);
        const property = entity.dataProperties.find(candidate => candidate.name === name);
        if (!property) {
            throw new Error(`The ${entity.name} has no data property '${name}'.`);
        }
        return property;
    }
}

/** The index of each type's constructor in Value: int(Int) | str(String) | bool(Bool). */
const CONSTRUCTOR = { int: 0, string: 1, boolean: 2 } as const;

function typeOfValue(value: Value): Exclude<ScalarType, 'Any'> {
    return typeof value === 'number' ? 'int' : typeof value === 'string' ? 'string' : 'boolean';
}
