// A DSL easy model (easy-language's buildModel) as a DCR.js graph, before it is laid out (xml.ts):
//   a data property (int, string, boolean, Any)   an activity in the nesting Data, initiated by its entity, with a
//                                                  variable of its type (Any: String)
//   an action                                      an activity, with its initiators and observers; with one input
//                                                  and no output, also with a variable of the input's type
//   an action with more inputs, or with outputs    a nesting, holding a nesting Input (with inputs) and one Output
//                                                  (with outputs): an activity per input and output, with a variable
//                                                  of its type and the action's initiators and observers
//   (only the data properties' activities are included at the start, not an action's or its inputs' and outputs';
//   nothing is pending)
//   Action print is enabled means { start was executed or is not available }     condition start → print
//                                 { reboot is not pending or is not available }  milestone reboot → print
// and from the scenarios of each When rule, with action a, Givens g₁, g₂, … (each state replaced by what its
// specification says) and Whens w₁, w₂, …:
//   the Givens     condition Data → a, guarded by g₁ (one scenario), or g₁ or g₂ or … (several); none when one of them
//                  always holds
//   each Then      x is available       include a → x
//                  x is not available   exclude a → x
//                  x is pending         response a → x
//                  each guarded by its When; the same relation from several Thens is one, its guards joined with or
//                  p is set to v        setValue a → p, value v, guarded by its own When
// Guards and values name variables (variableNames). Lists and queues are left out, with what the scenarios say about
// them, and so is 'is undefined' (DCR.js has no null), but for a graph written in a language with a word for no value
// (Options.noValue: DCR Solutions' null): both are future work.

import type { EasyModel } from 'easy-language';

type Model = EasyModel.Model;

/** A variable of DCR.js: its name (letters, digits and _) and type. */
export interface Variable {
    name: string;
    type: 'Int' | 'String' | 'Bool';
}

/** An activity: a data property, an action (with its input, when it has one and no output), or an action's input or output. */
export interface Activity {
    kind: 'activity';
    id: string;
    label: string;
    /** Its initiators: DCR.js's role. */
    role: string[];
    observers: string[];
    included: boolean;
    variable?: Variable;
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

/** The nesting of the data properties' activities. */
export const DATA = 'Data';
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

/** How to say what the graph will be written in can say, but DCR.js cannot. */
export interface Options {
    /** Its word for no value (null): 'is undefined' is then '= null', and 'is not undefined' '!= null'. */
    noValue?: string;
}

export function toDcrJsGraph(model: Model, options: Options = {}): DcrJsGraph {
    const names = variableNames(model);
    const write = writer(model, names, options);
    const counts = new Map<string, number>();
    const id = (prefix: string) => {
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
        return `${prefix}_${counts.get(prefix)}`;
    };
    /** The element of each data property (propertyKey), action, and of Data. */
    const elementOf = new Map<string, string>();

    const data = model.entities.flatMap(entity => entity.dataProperties.filter(isPrimitive).map((property): Activity => {
        const key = propertyKey(entity.name, property.name);
        const activity: Activity = {
            kind: 'activity', id: id('Event'), label: property.name, role: [entity.name], observers: [], included: true,
            variable: { name: names.get(key)!, type: TYPES[property.type] }
        };
        elementOf.set(key, activity.id);
        return activity;
    }));
    const nesting: Box[] = data.length > 0 ? [{ kind: 'nesting', id: id('Nesting'), label: DATA, children: data }] : [];
    nesting.forEach(({ id }) => elementOf.set(DATA, id));

    const actions = model.actions.map((action): Element => {
        const role = model.initiators[action] ?? [];
        const observers = model.observers[action] ?? [];
        const inputs = model.inputs[action] ?? [];
        const outputs = model.outputs[action] ?? [];
        const variable = (parameter: EasyModel.Parameter, i: number): Variable =>
            ({ name: names.get(parameterKey(action, i))!, type: TYPES[parameter.type] });
        let element: Element;
        if (inputs.length + outputs.length === 0 || (inputs.length === 1 && outputs.length === 0)) {
            element = {
                kind: 'activity', id: id('Event'), label: action, role, observers, included: false,
                variable: inputs.length === 1 ? variable(inputs[0], 0) : undefined
            };
        } else {
            element = { kind: 'nesting', id: id('Nesting'), label: action, children: [] };
            const part = (label: string, parameters: EasyModel.Parameter[], first: number): Box => ({
                kind: 'nesting', id: id('Nesting'), label,
                children: parameters.map((parameter, i): Activity => ({
                    kind: 'activity', id: id('Event'), label: parameter.name, role, observers, included: false, variable: variable(parameter, first + i)
                }))
            });
            element.children = [part(INPUT, inputs, 0), part(OUTPUT, outputs, inputs.length)].filter(part => part.children.length > 0);
        }
        elementOf.set(action, element.id);
        return element;
    });

    const relations: Array<Omit<Relation, 'id'>> = [];
    const relate = (type: Relation['type'], from: string, to: string, guard?: string, value?: string) =>
        relations.push({ type, source: elementOf.get(from)!, target: elementOf.get(to)!, guard, value });
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
            for (const assignment of then.dataAssignments.filter(({ operation }) => operation === 'set to')) {
                const key = propertyKey(assignment.entity, assignment.property);
                const value = write.value(rule, assignment);
                if (elementOf.has(key) && value !== undefined) {
                    setValues.push([key, when.join(AND) || undefined, value]);
                }
            }
        });
        for (const { type, from, to, alternatives } of merged.values()) {
            const guard = guardOf(alternatives);
            if (from !== DATA || guard !== undefined) {   // a condition from Data that always holds says nothing
                relate(type, from, to, guard);
            }
        }
        setValues.forEach(([to, guard, value]) => relate('setValue', rule.action, to, guard, value));
    }

    const unique = relations.filter((relation, i) => relations.findIndex(other => sameRelation(relation, other)) === i);
    return { elements: [...nesting, ...actions], relations: unique.map((relation, i) => ({ id: `Relation_${i + 1}`, ...relation })) };
}

/**
 * How guards and values write what the scenarios say, a property or an input or output by its variable's name
 * (`names`), as DCR.js writes a guard (speed > 2 and file = "a.pdf"); a part DCR.js cannot say yet, about a list or
 * queue, or 'is undefined' without options.noValue, is left out.
 */
function writer(model: Model, names: Map<string, string>, { noValue }: Options) {
    const variableOf = ({ entity, property }: { entity: string, property: string }) => names.get(propertyKey(entity, property));
    /** A property assertion, its value as `operand` writes it: speed > 2; undefined for a part DCR.js cannot say yet. */
    const assertion = (assertion: EasyModel.PropertyAssertion, operand: (operand: EasyModel.Operand) => string) => {
        const name = variableOf(assertion);
        const operators = OPERATORS[assertion.operation];
        if (name && assertion.operation === 'undefined') {
            return noValue === undefined ? undefined : `${name} ${assertion.negated ? '!=' : '='} ${noValue}`;
        }
        return name && operators && assertion.value !== undefined ? `${name} ${operators[assertion.negated ? 1 : 0]} ${operand(assertion.value)}` : undefined;
    };
    /** An input or output of the rule's action (one of its parameters) by its variable's name; another constant by its own. */
    const constant = (rule: EasyModel.WhenRule, constant: EasyModel.NamedConstant) => {
        const i = rule.parameters.indexOf(constant);
        return i >= 0 ? names.get(parameterKey(rule.action, i))! : identifier(constant.name);
    };

    return {
        /** What a scenario's Given says about data, its states replaced by what their specifications say, as the parts of a guard. */
        given(scenario: EasyModel.Scenario): string[] {
            const parameters = [...(model.inputs[scenario.when] ?? []), ...(model.outputs[scenario.when] ?? [])];
            const operand = (operand: EasyModel.Operand) => {
                if (typeof operand !== 'object') {
                    return valueText(operand);
                }
                const i = parameters.findIndex(({ name }) => name === operand.name);
                return i >= 0 ? names.get(parameterKey(scenario.when, i))! : identifier(operand.name);
            };
            return scenario.given.saturated(model.stateSpecifications).dataAssertions.map(part => assertion(part, operand)).filter(isDefined);
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

        /** What a Then's 'is set to' sets its property to; undefined for an element dequeued from a queue (left out with it). */
        value(rule: EasyModel.WhenRule, { value }: EasyModel.PropertyAssignment): string | undefined {
            if (value === undefined || typeof value !== 'object') {
                return value === undefined ? undefined : valueText(value);
            }
            return rule.parameters.includes(value) ? constant(rule, value) : undefined;
        }
    };
}

/**
 * The variables' names, by propertyKey for a data property and parameterKey for an input or output: its name, each
 * space an _ (max speed: max_speed); when two would have the same, each has its owner's before it, its entity's or its
 * action's (Printer_speed, tune_speed), and a number after it should that still not be unique.
 */
function variableNames(model: Model): Map<string, string> {
    const owned = [
        ...model.entities.flatMap(entity => entity.dataProperties.filter(isPrimitive)
            .map(property => ({ key: propertyKey(entity.name, property.name), owner: entity.name, name: property.name }))),
        ...model.actions.flatMap(action => [...(model.inputs[action] ?? []), ...(model.outputs[action] ?? [])]
            .map((parameter, i) => ({ key: parameterKey(action, i), owner: action, name: parameter.name })))
    ];
    const plain = owned.map(({ name }) => identifier(name));
    const used = new Set<string>();
    return new Map(owned.map(({ key, owner }, i) => {
        const wanted = plain.filter(name => name === plain[i]).length > 1 ? `${identifier(owner)}_${plain[i]}` : plain[i];
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

/** 'Printer.speed' */
function propertyKey(entity: string, property: string): string {
    return `${entity}.${property}`;
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
