// A DSL easy model (easy-language's buildModel) as a DCR.js graph, before it is laid out (xml.ts):
//   a data property (int, string, boolean, Any)   an activity in the nesting Data, initiated by its entity, with a
//                                                  variable of its type (Any: String); without any, an activity
//                                                  'placeholder' in Data, should a Given need a condition from it
//   a state of an entity                           an activity in the nesting States, initiated by Robot, with a Bool
//                                                  variable, which its computation gives: what the state's Declarative
//                                                  specification says (Activity.computation)
//   an action                                      an activity, with its initiators and observers; with one input
//                                                  and no output, also with a variable of the input's type
//   an action with more inputs, or with outputs    a nesting, holding a nesting Input (with inputs) and one Output
//                                                  (with outputs): an activity per input and output, with a variable
//                                                  of its type and the action's initiators and observers
//   (the data properties' activities are included at the start, the states' included and pending, and an action's, or
//   its inputs' and outputs', when its
//   Action … { … } says 'Initially available: true', or when no include relation goes to it (the fixer, which can be
//   turned off: Options.fixInclusion), as it could otherwise never happen; they are pending at the start with
//   'Initially pending: true')
//   Action print is enabled means { start was executed or is not available }     condition start → print
//                                 { reboot is not pending or is not available }  milestone reboot → print
//   (Data has a condition to itself: its activities are never executed, their values change by setValues only, so a
//   condition from it holds whenever its guard does; each state has a response to itself: it is pending again once it
//   is computed)
// and from the scenarios of each When rule, with action a, Givens g₁, g₂, … (each its states, busy = true, and its
// data) and Whens w₁, w₂, …:
//   the Givens     condition Data → a, guarded by not(g₁) (one scenario), or not(g₁ or g₂ or …) (several): a waits
//                  while none of them holds; none when one of them always holds
//   each Then      x is available       include a → x
//                  x is not available   exclude a → x
//                  x is pending         response a → x
//                  each guarded by its When; the same relation from several Thens is one, its guards joined with or
//                  p is set to v        setValue a → p, value v, guarded by its own When
// Guards, values and computations name variables (variableNames). DCR.js has no list values, nor a word for no value,
// so lists and queues are left out, with what the scenarios and the specifications say about them, and so is 'is
// undefined'; but not from a graph written in a language that has them (Options.lists and Options.noValue: DCR
// Solutions'): a list or queue is then an activity in Data with a list value, and its effects in a Then one setValue,
// written with list functions (writer's effects).

import type { EasyModel } from 'easy-language';

type Model = EasyModel.Model;

/** A variable of DCR.js: its name (letters, digits and _) and type. */
export interface Variable {
    name: string;
    /** List: a list's or queue's, only with Options.lists. */
    type: 'Int' | 'String' | 'Bool' | 'List';
}

/** An activity: a data property, an action (with its input, when it has one and no output), or an action's input or output. */
export interface Activity {
    kind: 'activity';
    id: string;
    label: string;
    /** Its initiators: DCR.js's role. */
    role: string[];
    observers: string[];
    /** Whether it is included at the start, and pending. */
    included: boolean;
    pending: boolean;
    variable?: Variable;
    /**
     * A state's: what its Declarative specification says, which its variable is computed as; written as a guard
     * (speed = 0, online = true), an action's status by its element (Event_3@executed, Event_3@pending, Event_3@included:
     * available), not(…) for not (the writer's computation). None for a state without a specification, or with one
     * about lists and queues only.
     */
    computation?: string;
}

/** Activities in a box, a nesting: Data, an action with more inputs or with outputs, or its Input or Output. */
export interface Box {
    kind: 'nesting';
    id: string;
    label: string;
    children: Element[];
}

export type Element = Activity | Box;

/** A relation between two elements, by id, which only holds while its guard does; a setValue sets its target's variable to its value. */
export interface Relation {
    id: string;
    type: 'condition' | 'milestone' | 'response' | 'include' | 'exclude' | 'setValue';
    source: string;
    target: string;
    guard?: string;
    value?: string;
}

export interface DcrJsGraph {
    elements: Element[];
    relations: Relation[];
}

/** The nesting of the data properties' activities, and the activity in it of a model without any. */
export const DATA = 'Data';
export const PLACEHOLDER = 'placeholder';
/** The nesting of the states' activities, and the role that computes them. */
export const STATES = 'States';
export const ROBOT = 'Robot';
/** The nestings of an action's inputs and of its outputs. */
export const INPUT = 'Input';
export const OUTPUT = 'Output';

const TYPES: Record<EasyModel.ScalarType, Variable['type']> = { int: 'Int', string: 'String', boolean: 'Bool', Any: 'String' };

const AND = ' and ';
const OR = ' or ';

/** How a guard writes each comparison: [without 'not', with 'not']. */
const OPERATORS: Partial<Record<EasyModel.AssertionOperation, [string, string]>> = {
    'equal to': ['=', '!='], 'larger than': ['>', '<='], 'smaller than': ['<', '>=']
};

export interface Options {
    /**
     * What the graph will be written in can say, but DCR.js cannot: its word for no value (null). 'is undefined' is then
     * '= null', and 'is not undefined' '!= null'.
     */
    noValue?: string;
    /**
     * The fixer: an action that no include relation goes to starts included, whatever its Action … { … } says, and so
     * do its inputs and outputs. True by default.
     */
    fixInclusion?: boolean;
    /**
     * What the graph will be written in can say, but DCR.js cannot: lists, with list functions (count, list contains,
     * append, remove, index of, index); a list or queue holding `capacity` elements is full.
     */
    lists?: { capacity: number };
}

export function toDcrJsGraph(model: Model, options: Options = {}): DcrJsGraph {
    const names = variableNames(model, options.lists !== undefined);
    const write = writer(model, names, options);
    const counts = new Map<string, number>();
    const id = (prefix: string) => {
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
        return `${prefix}_${counts.get(prefix)}`;
    };
    /** The element of each data property (propertyKey), action, and of Data. */
    const elementOf = new Map<string, string>();

    const data = model.entities.flatMap(entity => entity.dataProperties.filter(property => isPrimitive(property) || options.lists).map((property): Activity => {
        const key = propertyKey(entity.name, property.name);
        const activity: Activity = {
            kind: 'activity', id: id('Event'), label: property.name, role: [entity.name], observers: [], included: true, pending: false,
            variable: { name: names.get(key)!, type: isPrimitive(property) ? TYPES[property.type] : 'List' }
        };
        elementOf.set(key, activity.id);
        return activity;
    }));
    // without data properties, a placeholder, should a Given need a condition from Data: one that is never executed
    if (data.length === 0 && model.whenRules.some(rule => guardOf(rule.indices.map(index => write.given(model.scenarios[index]))) !== undefined)) {
        data.push({ kind: 'activity', id: id('Event'), label: PLACEHOLDER, role: [], observers: [], included: true, pending: false });
    }
    const nesting: Box[] = data.length > 0 ? [{ kind: 'nesting', id: id('Nesting'), label: DATA, children: data }] : [];
    nesting.forEach(({ id }) => elementOf.set(DATA, id));

    /** The activity of each state, by stateKey. */
    const states = new Map(model.entities.flatMap(entity => entity.states.map(state => {
        const key = stateKey(entity.name, state);
        const activity: Activity = {
            kind: 'activity', id: id('Event'), label: state, role: [ROBOT], observers: [], included: true, pending: true,
            variable: { name: names.get(key)!, type: 'Bool' }
        };
        elementOf.set(key, activity.id);
        return [key, activity] as const;
    })));
    const statesNesting: Box[] = states.size > 0 ? [{ kind: 'nesting', id: id('Nesting'), label: STATES, children: [...states.values()] }] : [];

    const actions = model.actions.map((action): Element => {
        const role = model.initiators[action] ?? [];
        const observers = model.observers[action] ?? [];
        const inputs = model.inputs[action] ?? [];
        const outputs = model.outputs[action] ?? [];
        const included = model.initiallyAvailable.includes(action);
        const pending = model.initiallyPending.includes(action);
        const variable = (parameter: EasyModel.Parameter, i: number): Variable =>
            ({ name: names.get(parameterKey(action, i))!, type: TYPES[parameter.type] });
        let element: Element;
        if (inputs.length + outputs.length === 0 || (inputs.length === 1 && outputs.length === 0)) {
            element = {
                kind: 'activity', id: id('Event'), label: action, role, observers, included, pending,
                variable: inputs.length === 1 ? variable(inputs[0], 0) : undefined
            };
        } else {
            element = { kind: 'nesting', id: id('Nesting'), label: action, children: [] };
            const part = (label: string, parameters: EasyModel.Parameter[], first: number): Box => ({
                kind: 'nesting', id: id('Nesting'), label,
                children: parameters.map((parameter, i): Activity => ({
                    kind: 'activity', id: id('Event'), label: parameter.name, role, observers, included, pending, variable: variable(parameter, first + i)
                }))
            });
            element.children = [part(INPUT, inputs, 0), part(OUTPUT, outputs, inputs.length)].filter(part => part.children.length > 0);
        }
        elementOf.set(action, element.id);
        return element;
    });
    for (const spec of model.stateSpecifications) {
        const activity = states.get(stateKey(spec.entity, spec.state));
        if (activity) {
            activity.computation = write.computation(spec, action => elementOf.get(action)!);
        }
    }

    const relations: Array<Omit<Relation, 'id'>> = [];
    const relate = (type: Relation['type'], from: string, to: string, guard?: string, value?: string) =>
        relations.push({ type, source: elementOf.get(from)!, target: elementOf.get(to)!, guard, value });
    nesting.forEach(() => relate('condition', DATA, DATA));
    states.forEach((_, key) => relate('response', key, key));
    for (const spec of model.enabledSpecifications) {
        spec.conditions.forEach(action => relate('condition', action, spec.action));
        spec.milestones.forEach(action => relate('milestone', action, spec.action));
    }
    for (const rule of model.whenRules) {
        const merged = new Map<string, { type: Relation['type'], from: string, to: string, alternatives: string[][] }>();
        const add = (type: Relation['type'], from: string, to: string, parts: string[]) => {
            const key = `${type} ${from} → ${to}`;
            if (!merged.has(key)) {
                merged.set(key, { type, from, to, alternatives: [] });
            }
            merged.get(key)!.alternatives.push(parts);
        };
        const setValues: Array<[to: string, guard: string | undefined, value: string]> = [];
        rule.indices.forEach((index, i) => {
            add('condition', DATA, rule.action, write.given(model.scenarios[index]));
            const when = write.when(rule, i);
            const then = rule.thens[i];
            then.availables.forEach(action => add('include', rule.action, action, when));
            then.notAvailables.forEach(action => add('exclude', rule.action, action, when));
            then.pendings.forEach(action => add('response', rule.action, action, when));
            for (const { key, needs, value } of write.effects(rule, i)) {
                setValues.push([key, [...when, ...needs].join(AND) || undefined, value]);
            }
        });
        for (const { type, from, to, alternatives } of merged.values()) {
            const guard = guardOf(alternatives);
            if (from !== DATA) {
                relate(type, from, to, guard);
            } else if (guard !== undefined) {   // a condition from Data whose Givens always hold says nothing
                relate(type, from, to, `not(${guard})`);
            }
        }
        setValues.forEach(([to, guard, value]) => relate('setValue', rule.action, to, guard, value));
    }

    if (options.fixInclusion ?? true) {
        const included = new Set(relations.filter(({ type }) => type === 'include').map(({ target }) => target));
        actions.filter(({ id }) => !included.has(id)).flatMap(activitiesOf).forEach(activity => activity.included = true);
    }

    const unique = relations.filter((relation, i) => relations.findIndex(other => sameRelation(relation, other)) === i);
    return { elements: [...nesting, ...statesNesting, ...actions], relations: unique.map((relation, i) => ({ id: `Relation_${i + 1}`, ...relation })) };
}

/**
 * How guards and values write what the scenarios say, a property or an input or output by its variable's name
 * (`names`), as DCR.js writes a guard (speed > 2 and file = "a.pdf"); a part the graph cannot say, about a list or
 * queue without options.lists, or 'is undefined' without options.noValue, is left out.
 */
function writer(model: Model, names: Map<string, string>, { noValue, lists }: Options) {
    const variableOf = ({ entity, property }: { entity: string, property: string }) => names.get(propertyKey(entity, property));
    /**
     * A property assertion, its value as `operand` writes it: speed > 2; a list's or queue's (options.lists) with list
     * functions, list contains(jobs, "a") (= false, for not), count(jobs) = 0 (> 0), count(jobs) >= capacity (<);
     * undefined for a part the graph cannot say.
     */
    const assertion = (assertion: EasyModel.PropertyAssertion, operand: (operand: EasyModel.Operand) => string) => {
        const name = variableOf(assertion);
        const { negated, operation, value } = assertion;
        if (name === undefined) {
            return undefined;
        }
        switch (operation) {
            case 'undefined':
                return noValue === undefined ? undefined : `${name} ${negated ? '!=' : '='} ${noValue}`;
            case 'included in':
                return value === undefined ? undefined : `list contains(${name}, ${operand(value)})${negated ? ' = false' : ''}`;
            case 'empty':
                return `count(${name}) ${negated ? '>' : '='} 0`;
            case 'full':
                return `count(${name}) ${negated ? '<' : '>='} ${lists?.capacity}`;
            default:
                return value === undefined ? undefined : `${name} ${OPERATORS[operation]![negated ? 1 : 0]} ${operand(value)}`;
        }
    };
    /** An input or output of the rule's action (one of its parameters) by its variable's name; another constant by its own. */
    const constant = (rule: EasyModel.WhenRule, constant: EasyModel.NamedConstant) => {
        const i = rule.parameters.indexOf(constant);
        return i >= 0 ? names.get(parameterKey(rule.action, i))! : identifier(constant.name);
    };

    return {
        /** What a scenario's Given says, its states (busy = true) and its data, as the parts of a guard. */
        given(scenario: EasyModel.Scenario): string[] {
            const parameters = [...(model.inputs[scenario.when] ?? []), ...(model.outputs[scenario.when] ?? [])];
            const operand = (operand: EasyModel.Operand) => {
                if (typeof operand !== 'object') {
                    return valueText(operand);
                }
                const i = parameters.findIndex(({ name }) => name === operand.name);
                return i >= 0 ? names.get(parameterKey(scenario.when, i))! : identifier(operand.name);
            };
            return [
                ...scenario.given.states.map(([entity, state]) => `${names.get(stateKey(entity, state))} = true`),
                ...scenario.given.dataAssertions.map(part => assertion(part, operand)).filter(isDefined)
            ];
        },

        /**
         * What a state's Declarative specification says, as the parts of its computation joined with and
         * (Activity.computation), each action's status by its element (`element`); undefined when it says nothing that a
         * computation can (only about lists and queues):
         *   print is (not) available    Event_3@included       (not(Event_3@included))
         *   print is (not) pending      Event_3@pending        (not(Event_3@pending))
         *   print was (not) executed    Event_3@executed       (not(Event_3@executed))
         *   print is enabled            what its enabled specification says, and that it is available:
         *                               (Event_1@executed or not(Event_1@included)) and … and Event_3@included;
         *                               Event_3@included without one
         *   it is online                online = true
         *   the speed larger than 2     speed > 2
         */
        computation(spec: EasyModel.StateSpecification, element: (action: string) => string): string | undefined {
            const status = (action: string, marking: 'included' | 'pending' | 'executed', negated = false) =>
                negated ? `not(${element(action)}@${marking})` : `${element(action)}@${marking}`;
            const enabled = (action: string) => {
                const specification = model.enabledSpecifications.find(other => other.action === action);
                return [
                    ...(specification?.conditions ?? []).map(other => `(${status(other, 'executed')} or ${status(other, 'included', true)})`),
                    ...(specification?.milestones ?? []).map(other => `(${status(other, 'pending', true)} or ${status(other, 'included', true)})`),
                    status(action, 'included')
                ];
            };
            const parts = [
                ...spec.availables.map(action => status(action, 'included')),
                ...spec.notAvailables.map(action => status(action, 'included', true)),
                ...spec.pendings.map(action => status(action, 'pending')),
                ...spec.notPendings.map(action => status(action, 'pending', true)),
                ...spec.executed.map(action => status(action, 'executed')),
                ...spec.notExecuted.map(action => status(action, 'executed', true)),
                ...spec.enableds.flatMap(enabled),
                ...spec.states.map(state => `${names.get(stateKey(spec.entity, state))} = true`),
                ...spec.dataAssertions.map(part => assertion(part, operand => typeof operand === 'object' ? identifier(operand.name) : valueText(operand)))
                    .filter(isDefined)
            ];
            return parts.length > 0 ? parts.join(AND) : undefined;
        },

        /**
         * What the rule's i-th When says, as the parts of a guard: first the value or data it gives each input or
         * output, in the action's order, then its other comparisons and data assertions, in which an input or output
         * it gives a value or data is that value or data:
         *   with inputs file = "a.pdf", copies AND copies larger than 1        file = "a.pdf" and copies > 1
         *   with inputs age = the Person's age AND age larger than 17          age = Person_age and Person_age > 17
         */
        when(rule: EasyModel.WhenRule, i: number): string[] {
            const { comparisons, dataAssertions } = rule.whens[i];
            const given = new Map<EasyModel.NamedConstant, string>();
            comparisons.filter(({ byEquals }) => byEquals).forEach(({ subject, value }) =>
                given.set(subject, typeof value === 'object' ? constant(rule, value) : valueText(value)));
            dataAssertions.filter(({ byEquals }) => byEquals).forEach(part => {
                const name = variableOf(part);
                if (name && typeof part.value === 'object') {
                    given.set(part.value, name);
                }
            });
            const operand = (operand: EasyModel.Operand) => typeof operand === 'object' ? given.get(operand) ?? constant(rule, operand) : valueText(operand);
            return [
                ...rule.parameters.filter(parameter => given.has(parameter)).map(parameter => `${constant(rule, parameter)} = ${given.get(parameter)}`),
                ...comparisons.filter(({ byEquals }) => !byEquals).map(({ subject, negated, operation, value }) =>
                    `${operand(subject)} ${OPERATORS[operation]![negated ? 1 : 0]} ${operand(value)}`),
                ...dataAssertions.filter(({ byEquals }) => !byEquals).map(part => assertion(part, operand)).filter(isDefined)
            ];
        },

        /**
         * What the rule's i-th Then sets, each property once, in the order of its first effect: 'is set to' its value; a
         * list's or queue's effects (options.lists) one after the other, as one value, with what each needs to hold:
         *   the jobs is added with "a" (enqueued)   append(jobs, "a")
         *   the jobs is removed with "a"            remove(jobs, index(index of(jobs, "a"), 1)), needing list contains(jobs, "a")
         *   the waiting is dequeued (as job)        remove(waiting, 1), needing count(waiting) > 0; job is index(waiting, 1)
         *   the jobs is set to empty                []
         * A later effect on the same list or queue works on its value so far: append(remove(waiting, 1), "a"). A
         * property whose value names what the graph does not have (an element dequeued from a queue without
         * options.lists) is left out.
         */
        effects(rule: EasyModel.WhenRule, i: number): Array<{ key: string, needs: string[], value: string }> {
            const values = new Map<string, { needs: string[], value: string | undefined }>();
            const dequeued = new Map<EasyModel.NamedConstant, string>();
            const operand = (operand: EasyModel.Operand | undefined) => operand === undefined ? undefined
                : typeof operand !== 'object' ? valueText(operand)
                : dequeued.get(operand) ?? (rule.parameters.includes(operand) ? constant(rule, operand) : undefined);
            for (const { entity, property, operation, value, constant: as } of rule.thens[i].dataAssignments) {
                const key = propertyKey(entity, property);
                const name = names.get(key);
                if (name === undefined) {
                    continue;   // a list or queue without options.lists
                }
                const effect = values.get(key) ?? { needs: [], value: name };
                const [list, element] = [effect.value, operand(value)];
                switch (operation) {
                    case 'set to':
                        effect.value = element;
                        break;
                    case 'added with':
                    case 'enqueued with':
                        effect.value = list && element && `append(${list}, ${element})`;
                        break;
                    case 'removed with':
                        effect.value = list && element && `remove(${list}, index(index of(${list}, ${element}), 1))`;
                        effect.needs.push(...(list && element ? [`list contains(${list}, ${element})`] : []));
                        break;
                    case 'dequeued':
                        effect.value = list && `remove(${list}, 1)`;
                        effect.needs.push(...(list ? [`count(${list}) > 0`] : []));
                        if (list && as) {
                            dequeued.set(as, `index(${list}, 1)`);
                        }
                        break;
                    case 'set to empty':
                        effect.value = '[]';
                        break;
                }
                values.set(key, effect);
            }
            return [...values].flatMap(([key, { needs, value }]) => value === undefined ? [] : [{ key, needs, value }]);
        }
    };
}

/**
 * The variables' names, by propertyKey for a data property, stateKey for a state and parameterKey for an input or
 * output: its name, each space an _ (max speed: max_speed). A data property keeps it, unless another entity's data
 * property has it too: then each has its entity's before it (Printer_speed). A state keeps it, unless another entity's
 * state, a data property or an action has it: then it has its entity's before it (Printer_idle). An input or output
 * keeps it, unless any other variable has it: then it has its action's before it (tune_speed), and the data property
 * keeps it (child_age, submit_child_age). A number comes after a name that is still not unique.
 */
function variableNames(model: Model, lists: boolean): Map<string, string> {
    const owned: Array<{ key: string, owner: string, name: string, kind: 'property' | 'state' | 'parameter' }> = [
        ...model.entities.flatMap(entity => entity.dataProperties.filter(property => lists || isPrimitive(property))
            .map(property => ({ key: propertyKey(entity.name, property.name), owner: entity.name, name: property.name, kind: 'property' as const }))),
        ...model.entities.flatMap(entity => entity.states.map(state => ({ key: stateKey(entity.name, state), owner: entity.name, name: state, kind: 'state' as const }))),
        ...model.actions.flatMap(action => [...(model.inputs[action] ?? []), ...(model.outputs[action] ?? [])]
            .map((parameter, i) => ({ key: parameterKey(action, i), owner: action, name: parameter.name, kind: 'parameter' as const })))
    ];
    const plain = owned.map(({ name }) => identifier(name));
    const actions = new Set(model.actions.map(identifier));
    const used = new Set<string>();
    return new Map(owned.map(({ key, owner, kind }, i) => {
        // a data property clashes only with another data property; a state with a data property, another state or an
        // action; an input or output with any other variable
        const clashes = (kind === 'state' && actions.has(plain[i])) || owned.some((other, j) => j !== i && plain[j] === plain[i]
            && (kind === 'parameter' || other.kind === 'property' || (kind === 'state' && other.kind === 'state')));
        const wanted = clashes ? `${identifier(owner)}_${plain[i]}` : plain[i];
        let name = wanted;
        for (let n = 2; used.has(name); n++) {
            name = `${wanted}_${n}`;
        }
        used.add(name);
        return [key, name];
    }));
}

/**
 * The guard of a relation from several scenarios: their parts joined with and, each scenario's in brackets when there
 * are several, joined with or; undefined when one of them always holds (has no parts).
 */
function guardOf(alternatives: string[][]): string | undefined {
    if (alternatives.length === 0 || alternatives.some(parts => parts.length === 0)) {
        return undefined;
    }
    const unique = [...new Map(alternatives.map(parts => [parts.join(AND), parts])).values()];
    return unique.map(parts => unique.length > 1 && parts.length > 1 ? `(${parts.join(AND)})` : parts.join(AND)).join(OR);
}

/** An int, string, boolean or Any property: one with a variable. */
function isPrimitive(property: EasyModel.DataProperty): property is EasyModel.DataProperty & { type: EasyModel.ScalarType } {
    return property.type !== 'list' && property.type !== 'queue';
}

/** The activities of an element: itself, or what its nestings hold. */
function activitiesOf(element: Element): Activity[] {
    return element.kind === 'activity' ? [element] : element.children.flatMap(activitiesOf);
}

/** 'Printer.speed' */
function propertyKey(entity: string, property: string): string {
    return `${entity}.${property}`;
}

/** 'Printer is busy' */
function stateKey(entity: string, state: string): string {
    return `${entity} is ${state}`;
}

/** 'print#0': the action's i-th input, or output after its inputs. */
function parameterKey(action: string, i: number): string {
    return `${action}#${i}`;
}

/** A name as a DCR.js variable's: max speed → max_speed. */
export function identifier(name: string): string {
    return name.trim().replace(/\s+/g, '_');
}

/** 5, "a.pdf", true */
function valueText(value: EasyModel.Value): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

function sameRelation(a: Omit<Relation, 'id'>, b: Omit<Relation, 'id'>): boolean {
    return a.type === b.type && a.source === b.source && a.target === b.target && a.guard === b.guard && a.value === b.value;
}
