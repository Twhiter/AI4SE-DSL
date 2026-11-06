// The model as a DCR graph, built from its When rules. An activity for every data property, in a group called Data, for
// every state, in a group called States, its value computed from the state's Declarative specification, and for every
// action, included and pending at the start as its Action … { … } says; Data has a condition to itself; the states are
// computed in rounds, each after the states its specification names, then an end state; relations from the enabled
// specifications, and from each When rule: a condition from Data to
// its action, guarded by not what its Givens say (their states and data), and what its Thens do, each guarded by what
// its When says. Guards and computations are written as DCR Solutions writes them: speed > 2 and count(jobs) > 0,
// print@executed.
// Assumes that the specifications and the scenarios are consistent (consistency.ts, scenario-consistency.ts).

import type { Bool } from 'z3-solver';
import type { Comparison, ComparisonOperation, Model, NamedConstant, Operand, Parameter, PropertyAssertion, StateSpecification, WhenAssertions, WhenRule } from './model.js';
import { DEFAULT_CAPACITY, Z3Vocabulary, type Instance, type Z3Context, type Z3VocabularyOptions } from './z3-vocabulary.js';

/** What executing the 'from' activity does to the 'to' activity (response, include, exclude), or what the 'to' activity needs (condition, milestone). */
export type DcrRelationType = 'condition' | 'milestone' | 'response' | 'include' | 'exclude';

/** The name of the group of the data activities, and of the activity in it of a model without any. */
export const DATA_GROUP = 'Data';
export const PLACEHOLDER = 'placeholder';
/** The name of the group of the states' activities, the role that computes them, and the activity that ends a round of computing them. */
export const STATES_GROUP = 'States';
export const ROBOT = 'Robot:Terminator';
export const END_STATE = 'end state';

/** An activity: an action, a data property, or a state. */
export class DcrEvent {
    /** The action, the property or the state: 'speed' ('Printer.speed' when another activity has that name too). */
    name: string;
    /** Who initiates it: the roles and entities of an action, the entity of a data property, Robot:Terminator for a state and the end state. */
    initiators: string[];
    observers: string[];
    /** An action's inputs and outputs, by their names, as a guard names them, and types; none for a data property. */
    inputs: Parameter[];
    outputs: Parameter[];
    /** Whether it is included at the start: a data property and a state are; an action is with 'Initially available: true'. */
    defaultIncluded: boolean;
    /** Whether it is pending at the start: a state is, a data property not; an action is with 'Initially pending: true'. */
    defaultPending: boolean;
    /** A state's: what its Declarative specification says, as its value (computationOf); none without one, and for another activity. */
    computation?: string;

    constructor(name: string, initiators: string[], observers: string[], inputs: Parameter[], outputs: Parameter[], defaultIncluded = false,
        defaultPending = false, computation?: string) {
        this.name = name;
        this.initiators = initiators;
        this.observers = observers;
        this.inputs = inputs;
        this.outputs = outputs;
        this.defaultIncluded = defaultIncluded;
        this.defaultPending = defaultPending;
        this.computation = computation;
    }
}

/** Activities drawn in one box, with a name: Data, States. A relation from the group is a relation from each activity in it. */
export class DcrGroup {
    name: string;
    events: string[];

    constructor(name: string, events: string[]) {
        this.name = name;
        this.events = events;
    }
}

/** A relation from an activity or a group to an activity or a group (Data's to itself, the end state's to States), which only holds while its guard does. */
export class DcrRelation {
    from: string;
    to: string;
    /** As DCR Solutions writes a guard (guardText): speed > 2 and count(jobs) > 0; undefined when the relation always holds. */
    guard: string | undefined;
    relation: DcrRelationType;

    constructor(from: string, to: string, guard: string | undefined, relation: DcrRelationType) {
        this.from = from;
        this.to = to;
        this.guard = guard;
        this.relation = relation;
    }
}

export class DcrGraph {
    events: DcrEvent[] = [];
    groups: DcrGroup[] = [];
    relations: DcrRelation[] = [];
}

/**
 * The model as a DCR graph:
 *   every data property of an entity      an activity named after it, initiated by the entity, in the group Data;
 *                                         without any, an activity 'placeholder' in Data, should a Given name a state
 *   every state of an entity              an activity named after it (stateActivities), initiated by Robot:Terminator, in the
 *                                         group States, its value what the state's Declarative specification says
 *                                         (computationOf); beside States, an activity 'end state' of Robot:Terminator
 *   every action                          an activity, with its initiators, observers, inputs and outputs
 *   (the data properties' activities are included at the start, the states' included and pending, and an action's when
 *   its Action … { … } says 'Initially available: true'; it is pending at the start with 'Initially pending: true')
 *   Data                                  condition  Data → Data: its activities are never executed, their values change
 *                                         by the actions only, so a condition from Data holds whenever its guard does
 *   each state s, named by the specification of a state t
 *                                         milestone  s → t: t is computed after s
 *   States                                milestone  States → end state, response  end state → States: a round of
 *                                         computing the states ends once none is pending, and makes each pending, to be
 *                                         computed again
 *   Action print is enabled means { start was executed or is not available }     condition  start → print
 *                                 { reboot is not pending or is not available }  milestone  reboot → print
 * and from each When rule, with action a and its scenarios' Givens g₁, g₂, … and Whens w₁, w₂, …:
 *   the Givens      condition Data → a: guarded by not what g₁ says (one scenario), not(g₁ or g₂ or …) (several), each
 *                   its states (busy = true) and its data: a waits while none of them holds; none when one always holds
 *   each Then       x is available      include   a → x
 *                   x is not available  exclude   a → x
 *                   x is pending        response  a → x
 *                   p is set to, …      include   a → p, the activity of the property (DCR has no relation for an assignment)
 *                   each guarded by what its scenario's When wᵢ says (whenParts: file = "draft" and copies > 1), never by
 *                   its Given; the same relation from several Thens is one, its guards joined with or
 */
export async function toDcrGraph(z3: Z3Context, model: Model, options?: Z3VocabularyOptions): Promise<DcrGraph> {
    const graph = new DcrGraph();
    const activities = dataActivities(model);
    const states = stateActivities(model, activities);
    // without data properties, a placeholder in Data for the Givens' conditions (from their states): one never executed
    const taken = new Set([...states.values(), ...model.actions]);
    let placeholder = activities.size === 0 && model.scenarios.some(({ given }) => given.states.length > 0) ? PLACEHOLDER : undefined;
    for (let n = 2; placeholder && taken.has(placeholder); n++) {
        placeholder = `${PLACEHOLDER} ${n}`;
    }
    const data = placeholder ? [placeholder] : [...activities.values()];
    let endName = END_STATE;
    for (let n = 2; taken.has(endName) || data.includes(endName); n++) {
        endName = `${END_STATE} ${n}`;
    }
    const end = states.size > 0 ? endName : undefined;
    const computation = (entity: string, state: string) => {
        const spec = model.stateSpecifications.find(spec => spec.entity === entity && spec.state === state);
        return spec && computationOf(model, spec, activities, states, options?.capacity ?? DEFAULT_CAPACITY);
    };
    graph.events = [
        ...model.entities.flatMap(entity => entity.dataProperties.map(property => new DcrEvent(activities.get(propertyKey(entity.name, property.name))!, [entity.name], [], [], [], true))),
        ...(placeholder ? [new DcrEvent(placeholder, [], [], [], [], true)] : []),
        ...model.entities.flatMap(entity => entity.states.map(state =>
            new DcrEvent(states.get(propertyKey(entity.name, state))!, [ROBOT], [], [], [], true, true, computation(entity.name, state)))),
        ...(end ? [new DcrEvent(end, [ROBOT], [], [], [], true)] : []),
        ...model.actions.map(action => new DcrEvent(action, model.initiators[action] ?? [], model.observers[action] ?? [], model.inputs[action] ?? [],
            model.outputs[action] ?? [], model.initiallyAvailable.includes(action), model.initiallyPending.includes(action)))
    ];
    graph.groups = [
        ...(data.length > 0 ? [new DcrGroup(DATA_GROUP, data)] : []),
        ...(states.size > 0 ? [new DcrGroup(STATES_GROUP, [...states.values()])] : [])
    ];
    const relations: DcrRelation[] = [
        ...(data.length > 0 ? [new DcrRelation(DATA_GROUP, DATA_GROUP, undefined, 'condition')] : []),
        ...model.stateSpecifications.flatMap(spec => spec.states.map(state =>
            new DcrRelation(states.get(propertyKey(spec.entity, state))!, states.get(propertyKey(spec.entity, spec.state))!, undefined, 'milestone'))),
        ...(end ? [new DcrRelation(STATES_GROUP, end, undefined, 'milestone'), new DcrRelation(end, STATES_GROUP, undefined, 'response')] : [])
    ];
    for (const spec of model.enabledSpecifications) {
        relations.push(
            ...spec.conditions.map(action => new DcrRelation(action, spec.action, undefined, 'condition')),
            ...spec.milestones.map(action => new DcrRelation(action, spec.action, undefined, 'milestone')));
    }
    for (const rule of model.whenRules) {
        relations.push(...await ruleRelations(z3, model, rule, activities, states, options));
    }
    graph.relations = relations.filter((relation, i) => relations.findIndex(other => sameRelation(relation, other)) === i);
    return graph;
}

/**
 * One way a relation's guard holds: what a Given says (its states and data), or what a When says, as the parts of a
 * guard, joined with and (none: always), and as formulas.
 */
interface Alternative {
    parts: string[];
    formulas: (v: Z3Vocabulary, instances: Record<string, Instance>) => Bool[];
}

/** The relations of a When rule (see toDcrGraph). */
async function ruleRelations(z3: Z3Context, model: Model, rule: WhenRule, activities: Map<string, string>, states: Map<string, string>,
    options?: Z3VocabularyOptions): Promise<DcrRelation[]> {
    const capacity = options?.capacity ?? DEFAULT_CAPACITY;
    const merged = new Map<string, { from: string, to: string, relation: DcrRelationType, alternatives: Alternative[] }>();
    const add = (from: string, to: string, relation: DcrRelationType, alternative: Alternative) => {
        const key = `${relation} ${from} → ${to}`;
        if (!merged.has(key)) {
            merged.set(key, { from, to, relation, alternatives: [] });
        }
        merged.get(key)!.alternatives.push(alternative);
    };
    rule.indices.forEach((index, i) => {
        const given = model.scenarios[index].given;
        add(DATA_GROUP, rule.action, 'condition', {
            parts: [
                ...given.states.map(([entity, state]) => `${states.get(propertyKey(entity, state))} = true`),
                ...given.dataAssertions.map(assertion => assertionText(assertion, activities, capacity))
            ],
            formulas: (v, instances) => [
                ...given.states.map(([, state], k) => v.inState(instances[given.statesCtx[k][0]], state)),
                ...given.dataAssertions.map((assertion, k) => assertion.toZ3(v, instances[given.dataAssertionsCtx[k][0]]))
            ]
        });
        const when = rule.whens[i];
        const alternative: Alternative = {
            parts: whenParts(when, rule.parameters, activities, capacity),
            formulas: (v, instances) => when.toZ3(v, instances).map(({ formula }) => formula)
        };
        const then = rule.thens[i];
        then.availables.forEach(action => add(rule.action, action, 'include', alternative));
        then.notAvailables.forEach(action => add(rule.action, action, 'exclude', alternative));
        then.pendings.forEach(action => add(rule.action, action, 'response', alternative));
        then.dataAssignments.forEach(({ entity, property }) => add(rule.action, activities.get(propertyKey(entity, property))!, 'include', alternative));
    });

    const v = new Z3Vocabulary(z3, model, options);
    const instances: Record<string, Instance> = Object.fromEntries(Object.entries(rule.instances).map(([name, entity]) => [name, v.instance(entity, name)]));
    const relations: DcrRelation[] = [];
    for (const { from, to, relation, alternatives } of merged.values()) {
        const guard = await guardOf(z3, v, instances, alternatives);
        if (from !== DATA_GROUP) {
            relations.push(new DcrRelation(from, to, guard, relation));
        } else if (guard !== undefined) {   // a condition from Data whose Givens always hold says nothing
            relations.push(new DcrRelation(from, to, `not(${guard})`, relation));
        }
    }
    return relations;
}

/**
 * The alternatives joined with or, each in brackets when it has several parts (joined with and); undefined when one
 * of them, or all of them together (checked with Z3: speed > 3 or speed < 4), always holds.
 */
async function guardOf(z3: Z3Context, v: Z3Vocabulary, instances: Record<string, Instance>, alternatives: Alternative[]): Promise<string | undefined> {
    if (alternatives.some(({ parts }) => parts.length === 0)) {
        return undefined;
    }
    const unique = [...new Map(alternatives.map(({ parts }, i) => [parts.join(AND), i])).values()];
    if (unique.length > 1) {
        const solver = new z3.Solver();
        solver.add(z3.Not(z3.Or(...unique.map(i => z3.And(...alternatives[i].formulas(v, instances))))), ...v.constraints());
        if (await solver.check() === 'unsat') {
            return undefined;
        }
    }
    return unique.map(i => {
        const { parts } = alternatives[i];
        return unique.length > 1 && parts.length > 1 ? `(${parts.join(AND)})` : parts.join(AND);
    }).join(OR);
}

/**
 * What a When says, as the parts of a guard: first the value or data it gives each input or output, in the action's
 * order, then its other comparisons and data assertions, in which an input or output it gives a value or data is that
 * value or data, and one it gives nothing is its name:
 *   with inputs file = "a.pdf", copies, outputs pages AND pages larger than 1     file = "a.pdf" and pages > 1
 *   with inputs file, copies = 2, outputs pages AND pages larger than copies      copies = 2 and pages > 2
 *   with inputs age = the Person's age AND age larger than 17                    age = Person.age and Person.age > 17
 *   with inputs name AND the Person's name equal to name                         Person.name = name
 */
function whenParts({ comparisons, dataAssertions }: WhenAssertions, parameters: NamedConstant[], activities: Map<string, string>, capacity: number): string[] {
    const given = new Map<NamedConstant, string>([
        ...comparisons.filter(({ byEquals }) => byEquals).map(({ subject, value }) => [subject, valueText(value)] as const),
        ...dataAssertions.filter(({ byEquals }) => byEquals).map(assertion => [assertion.value as NamedConstant, activityOf(assertion, activities)] as const)
    ]);
    const operand = (operand: Operand) => typeof operand === 'object' ? given.get(operand) ?? operand.name : valueText(operand);
    return [
        ...parameters.filter(parameter => given.has(parameter)).map(parameter => `${parameter.name} = ${given.get(parameter)}`),
        ...comparisons.filter(({ byEquals }) => !byEquals).map(comparison => comparisonText(comparison, operand)),
        ...dataAssertions.filter(({ byEquals }) => !byEquals).map(assertion => assertionText(assertion, activities, capacity, operand))
    ];
}

/** 'Printer.speed': the key of a property in dataActivities. */
function propertyKey(entity: string, property: string): string {
    return `${entity}.${property}`;
}

/**
 * The name of the activity of each data property (by propertyKey): the property's name, or Entity.property when
 * another entity has a property of that name, or an action has it, or an action has an input or output of that name
 * (which a guard writes by its name: age = Person.age).
 */
function dataActivities(model: Model): Map<string, string> {
    const properties = model.entities.flatMap(entity => entity.dataProperties.map(property => [entity.name, property.name] as const));
    const parameters = new Set([...Object.values(model.inputs), ...Object.values(model.outputs)].flat().map(({ name }) => name));
    const shared = (name: string) => properties.filter(([, property]) => property === name).length > 1 || model.actions.includes(name)
        || parameters.has(name);
    return new Map(properties.map(([entity, property]) => [propertyKey(entity, property), shared(property) ? propertyKey(entity, property) : property]));
}

/**
 * The name of the activity of each state (by propertyKey): the state's name, or Entity.state when another entity has a
 * state of that name, or a data property's activity, an action, or an input or output has it.
 */
function stateActivities(model: Model, activities: Map<string, string>): Map<string, string> {
    const states = model.entities.flatMap(entity => entity.states.map(state => [entity.name, state] as const));
    const taken = new Set([...activities.values(), ...model.actions, ...[...Object.values(model.inputs), ...Object.values(model.outputs)].flat().map(({ name }) => name)]);
    const shared = (name: string) => states.filter(([, state]) => state === name).length > 1 || taken.has(name);
    return new Map(states.map(([entity, state]) => [propertyKey(entity, state), shared(state) ? propertyKey(entity, state) : state]));
}

/**
 * What a state's Declarative specification says, as DCR Solutions writes the computation of the state's activity
 * (dcr solution examples/DCR computation.xml), its parts joined with and; an action's status is its activity's marking:
 *   print is (not) available    print@included       (not(print@included))
 *   print is (not) pending      print@pending        (not(print@pending))
 *   print was (not) executed    print@executed       (not(print@executed))
 *   print is enabled            what its enabled specification says, and that it is available:
 *                               (start@executed or not(start@included)) and (not(reboot@pending) or not(reboot@included))
 *                               and print@included; print@included without one
 *   it is online                online = true        (the state's activity)
 *   the speed larger than 2     speed > 2            (as a guard writes it)
 */
function computationOf(model: Model, spec: StateSpecification, activities: Map<string, string>, states: Map<string, string>, capacity: number): string {
    const status = (action: string, marking: 'included' | 'pending' | 'executed', negated = false) =>
        negated ? `not(${action}@${marking})` : `${action}@${marking}`;
    const enabled = (action: string) => {
        const specification = model.enabledSpecifications.find(other => other.action === action);
        return [
            ...(specification?.conditions ?? []).map(other => `(${status(other, 'executed')} or ${status(other, 'included', true)})`),
            ...(specification?.milestones ?? []).map(other => `(${status(other, 'pending', true)} or ${status(other, 'included', true)})`),
            status(action, 'included')
        ];
    };
    return [
        ...spec.availables.map(action => status(action, 'included')),
        ...spec.notAvailables.map(action => status(action, 'included', true)),
        ...spec.pendings.map(action => status(action, 'pending')),
        ...spec.notPendings.map(action => status(action, 'pending', true)),
        ...spec.executed.map(action => status(action, 'executed')),
        ...spec.notExecuted.map(action => status(action, 'executed', true)),
        ...spec.enableds.flatMap(enabled),
        ...spec.states.map(state => `${states.get(propertyKey(spec.entity, state))} = true`),
        ...spec.dataAssertions.map(assertion => assertionText(assertion, activities, capacity))
    ].join(AND);
}

const AND = ' and ';
const OR = ' or ';

/** How a guard writes each comparison: [without 'not', with 'not'] (the language has no not()). */
const OPERATORS: Record<ComparisonOperation, [string, string]> = { 'equal to': ['=', '!='], 'larger than': ['>', '<='], 'smaller than': ['<', '>='] };

/**
 * Property assertions as DCR Solutions writes a guard (its expression language, a subset of FEEL), joined with and;
 * undefined for none. A property is the activity `activities` names for it (its own name without one). The language
 * has no not(), so 'not' is the opposite comparison, or '= false':
 *   the Printer's speed (not) equal to 5           speed = 5                       (speed != 5)
 *   the Printer's speed (not) larger than 5        speed > 5                       (speed <= 5)
 *   the Printer's speed (not) smaller than 5       speed < 5                       (speed >= 5)
 *   "a" is (not) included in the Printer's jobs    list contains(jobs, "a")        (list contains(jobs, "a") = false)
 *   the Printer's jobs is (not) empty              count(jobs) = 0                 (count(jobs) > 0)
 *   the Printer's jobs is (not) full               count(jobs) >= 150              (count(jobs) < 150: the capacity)
 *   the Printer's speed is (not) undefined         speed = null                    (speed != null)
 */
export function guardText(assertions: PropertyAssertion[], activities = new Map<string, string>(), capacity = DEFAULT_CAPACITY): string | undefined {
    return assertions.length > 0 ? assertions.map(assertion => assertionText(assertion, activities, capacity)).join(AND) : undefined;
}

/** A property assertion as a guard writes it; its value as `operand` writes it (a named constant: its name). */
function assertionText(assertion: PropertyAssertion, activities: Map<string, string>, capacity: number, operand: (operand: Operand) => string = valueText): string {
    const { entity, property, negated, operation, value } = assertion;
    const name = activityOf(assertion, activities);
    const compared = () => {
        if (value === undefined) {
            throw new Error(`'${operation}' needs a value (the ${entity}'s ${property}).`);
        }
        return operand(value);
    };
    switch (operation) {
        case 'equal to':
        case 'larger than':
        case 'smaller than': return `${name} ${OPERATORS[operation][negated ? 1 : 0]} ${compared()}`;
        case 'included in': return `list contains(${name}, ${compared()})${negated ? ' = false' : ''}`;
        case 'empty': return `count(${name}) ${negated ? '>' : '='} 0`;
        case 'full': return `count(${name}) ${negated ? '<' : '>='} ${capacity}`;
        case 'undefined': return `${name} ${negated ? '!=' : '='} null`;
    }
}

/** A comparison of a When as a guard writes it, each side as `operand` writes it: age > 17, pages != copies. */
function comparisonText({ subject, negated, operation, value }: Comparison, operand: (operand: Operand) => string): string {
    return `${operand(subject)} ${OPERATORS[operation][negated ? 1 : 0]} ${operand(value)}`;
}

/** The activity of the property an assertion is about (see dataActivities). */
function activityOf({ entity, property }: PropertyAssertion, activities: Map<string, string>): string {
    return activities.get(propertyKey(entity, property)) ?? property;
}

/** 5, "a.pdf", true; a named constant by its name */
function valueText(value: Operand): string {
    return typeof value === 'object' ? value.name : typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function sameRelation(a: DcrRelation, b: DcrRelation): boolean {
    return a.from === b.from && a.to === b.to && a.relation === b.relation && a.guard === b.guard;
}
