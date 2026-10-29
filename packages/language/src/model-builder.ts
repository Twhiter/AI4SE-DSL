// Turns a parsed and validated .easy document into the classes of model.ts.

import { DocumentState, type AstNode, type LangiumDocument, type Reference } from 'langium';
import {
    isActionCondition, isActionEffect, isActionParticipants, isDeclarativeSpec, isEnabledCondition, isEnabledSpec, isEntity, isIntValue,
    isPropertyAssertion, isPropertyAssignment, isPropertyPath, isRole, isScenario, isSelfStateCondition, isStateCondition, isStringValue,
    isVariableValue, isWhenInput, isWhenOutput,
    type Action, type ActionCondition, type ActionEffect, type ActionInput, type ActionOutput, type Binding, type DeclarativeSpec, type EnabledSpec, type Model as ModelNode,
    type PropertyAssertion as PropertyAssertionNode, type PropertyPath, type EffectValue, type Scenario as ScenarioNode, type SelfAssertion,
    type SpecCondition, type Value as ValueNode, type Variable as VariableNode
} from './generated/ast.js';
import { isParticipantsOfLifecycleAction, lifecycleOf, participantsOf, typeOfBinding } from './easy-dsl-services.js';
import {
    Comparison, DataProperty, EnabledSpecification, Entity, Model, NamedConstant, PropertyAssertion, PropertyAssignment, Role, Scenario,
    StateSpecification, WhenRule,
    type AssertionOperation, type AssignmentOperation, type ComparisonOperation, type Context, type Given, type Operand, type Parameter,
    type ScalarType, type Then, type Value
} from './model.js';

type Diagnostic = NonNullable<LangiumDocument['diagnostics']>[number];

export type ModelResult =
    | { model: Model, errors?: undefined }
    | { model?: undefined, errors: Diagnostic[] };

/**
 * The content of a document as a Model, only if the document has no errors; otherwise its errors.
 * The document must be built with validation, e.g. `DocumentBuilder.build([document], { validation: true })`.
 */
export function buildModel(document: LangiumDocument): ModelResult {
    if (document.state < DocumentState.Validated) {
        throw new Error(`${document.uri} is not validated yet; build it with { validation: true } first.`);
    }
    const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
    if (errors.length > 0) {
        return { errors };
    }
    return { model: toModel(document.parseResult.value as ModelNode) };
}

function toModel(root: ModelNode): Model {
    const model = new Model();
    for (const element of root.elements) {
        if (isEntity(element)) {
            const entity = new Entity(element.name);
            entity.states = element.states.map(state => state.name);
            entity.dataProperties = element.dataProperties.map(property => new DataProperty(property.name, property.type, property.elementType));
            entity.actions = element.actions.map(action => action.name);
            model.entities.push(entity);
            model.actions.push(...entity.actions);
        } else if (isRole(element)) {
            model.roles.push(new Role(element.name));
        } else if (isActionParticipants(element)) {
            const { name } = element;
            if (!isParticipantsOfLifecycleAction(element)) {
                model.actions.push(name);  // an action without an entity
            }
            model.initiators[name] = element.initiators.map(participant => resolved(participant).name);
            model.observers[name] = element.observers.map(participant => resolved(participant).name);
            model.inputs[name] = element.inputs.map(parameter);
            model.outputs[name] = element.outputs.map(parameter);
        } else if (isDeclarativeSpec(element)) {
            model.stateSpecifications.push(stateSpecification(element));
        } else if (isEnabledSpec(element)) {
            model.enabledSpecifications.push(enabledSpecification(element));
        } else if (isScenario(element)) {
            model.scenarios.push(scenario(element));
        }
    }
    model.whenRules = whenRules(model);
    return model;
}

/**
 * when(register, age, is_adult): the scenarios whose When executes register, as one rule, for each action in the order
 * it first appears. Its parameters are the action's inputs and outputs, by their names; a When's own inputs and
 * outputs are renamed to them, and all that it says joins its Given: the values it gives them, its other comparisons,
 * and its assertions about data before the step. The rule keeps it apart too (whens), for the DCR graph.
 */
function whenRules(model: Model): WhenRule[] {
    const rules = new Map<string, WhenRule>();
    model.scenarios.forEach((scenario, i) => {
        const own = [...scenario.inputs, ...scenario.outputs];
        let rule = rules.get(scenario.when);
        if (!rule) {
            rule = new WhenRule(scenario.when, scenario.whenCtx, own.map(({ name, type }) => new NamedConstant(name, type)));
            rules.set(scenario.when, rule);
        }
        const renaming = new Map(own.map((constant, p) => [constant, rule.parameters[p]]));
        const given = scenario.given.copy();
        // all that the When says, about its inputs and about its outputs: the outputs are as independent as the inputs
        for (const { comparisons, dataAssertions, dataAssertionsCtx } of [scenario.inputAssertions, scenario.outputAssertions]) {
            for (const comparison of comparisons) {
                if (comparison.byEquals && !(comparison.value instanceof NamedConstant)) {
                    given.values.push([comparison.subject, comparison.value]);   // … with inputs job = "draft": job = "draft"
                } else {
                    given.comparisons.push(comparison);   // … AND age larger than 17
                }
            }
            given.dataAssertions.push(...dataAssertions);   // … with inputs age = the Person's age, … AND the Person's age larger than 3
            given.dataAssertionsCtx.push(...dataAssertionsCtx);
        }
        given.values.sort(([a], [b]) => own.indexOf(a) - own.indexOf(b));   // in the order the action declares them
        rule.scenarios.push(scenario.name);
        rule.indices.push(i);
        rule.givens.push(given.renamed(renaming));
        rule.whens.push(scenario.inputAssertions.joined(scenario.outputAssertions, renaming));
        rule.thens.push(scenario.then.renamed(renaming));
        rule.constants.push(scenario.constants.filter(constant => !renaming.has(constant)));
        Object.assign(rule.instances, scenario.instances);
    });
    return [...rules.values()];
}

// ---------- Specifications ----------

/** Declarative specification Printer is busy means { … }: 'its' / 'the' / 'it' mean the Printer. */
function stateSpecification(spec: DeclarativeSpec): StateSpecification {
    const entity = resolved(spec.entity).name;
    const result = new StateSpecification(entity, resolved(spec.state).name);
    spec.conditions.forEach(condition => addCondition(result, condition, entity));
    return result;
}

/**
 * Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available }:
 * a condition from start, a milestone from reboot.
 */
function enabledSpecification(spec: EnabledSpec): EnabledSpecification {
    const result = new EnabledSpecification(resolved(spec.action).name);
    for (const condition of spec.conditions) {
        (condition.status === 'executed' ? result.conditions : result.milestones).push(resolved(condition.action).name);
    }
    return result;
}

function addCondition(spec: StateSpecification, condition: SpecCondition, implicitEntity: string): void {
    if (isActionCondition(condition)) {
        addStatus(spec, condition);
    } else if (isEnabledCondition(condition)) {
        spec.enableds.push(resolved(condition.action).name);
    } else if (isSelfStateCondition(condition)) {
        spec.states.push(resolved(condition.state).name);
    } else {
        spec.dataAssertions.push(assertion(condition, implicitEntity));
    }
}

// ---------- Scenarios ----------

/**
 * Every entity the scenario mentions gets one instance, named after it; each item's context lists the instances it is
 * about. Each input and output of the When is a named constant, named and typed as the action declares it, also when
 * the When gives it a value (a comparison: name = "Ann") or data (a data assertion: age = the Person's age is the
 * Person's age equal to age), or leaves it out (any value). Each element a Then dequeues is one too. Every use of a
 * name refers to its NamedConstant.
 */
function scenario(node: ScenarioNode): Scenario {
    const instances: Record<string, string> = {};
    const instance = (entity: string): string => {
        const name = entity.toLowerCase().replace(/ /g, '_');
        instances[name] = entity;
        return name;
    };
    /** The instance of the action's lifecycle entity; none for an action in no lifecycle. */
    const actionCtx = (reference: Reference<Action>): Context => {
        const lifecycle = lifecycleOf(resolved(reference));
        return lifecycle ? [instance(lifecycle.name)] : [];
    };

    const action = resolved(node.action);
    const result = new Scenario(node.name, action.name, actionCtx(node.action));
    const { given, then } = result;
    const constant = (name: string, type: ScalarType): NamedConstant => {
        const named = new NamedConstant(name, type);
        result.constants.push(named);
        return named;
    };
    const declared = participantsOf(action);
    result.inputs = (declared?.inputs ?? []).map(({ name, type }) => constant(name, type));
    result.outputs = (declared?.outputs ?? []).map(({ name, type }) => constant(name, type));
    const dequeued = new Map<VariableNode, NamedConstant>();
    /** The named constant a name stands for: an input or output of the When, or an element a Then dequeues. */
    const binding = (node: Binding): NamedConstant => {
        if (isWhenInput(node) || isWhenOutput(node)) {
            const named = (isWhenInput(node) ? result.inputs : result.outputs).find(({ name }) => name === node.name);
            return required(named, `the ${isWhenInput(node) ? 'input' : 'output'} '${node.name}'`);
        }
        let named = dequeued.get(node);
        if (!named) {
            named = constant(node.name, required(typeOfBinding(node), `the type of '${node.name}'`));
            dequeued.set(node, named);
        }
        return named;
    };
    /** A value, or the named constant a name stands for (… is enqueued with job). */
    const operand = (node: EffectValue): Operand => isVariableValue(node) ? binding(resolved(node.variable)) : value(node);
    /** What the When says about an output is at the Then's time; anything else at the Given's. */
    const partOf = (...operands: Array<Operand | undefined>) =>
        operands.some(operand => operand instanceof NamedConstant && result.outputs.includes(operand)) ? result.outputAssertions : result.inputAssertions;
    const comparison = (compared: Comparison) => partOf(compared.subject, compared.value).comparisons.push(compared);
    /** the Person's age (not) larger than 3, about data as at the Given's time. */
    const dataAssertion = (subject: PropertyPath, negated: boolean, operation: AssertionOperation, compared: Operand | undefined, byEquals = false) => {
        const entity = resolved(subject.entity).name;
        const part = partOf(compared);
        part.dataAssertions.push(new PropertyAssertion(entity, resolved(subject.property).name, negated, operation, compared, byEquals));
        part.dataAssertionsCtx.push([instance(entity)]);
    };

    // the When: the values or data it gives its inputs and outputs, and its assertions after them
    for (const written of [...node.inputs, ...node.outputs]) {
        if (written.value && isPropertyPath(written.value)) {
            dataAssertion(written.value, false, 'equal to', binding(written), true);   // age = the Person's age
        } else if (written.value) {
            comparison(new Comparison(binding(written), false, 'equal to', value(written.value), true));   // name = "Ann"
        }
    }
    for (const condition of node.conditions) {
        if (isVariableValue(condition.subject)) {   // … AND age larger than 17
            const compared = required(condition.value, `the value '${condition.subject.$cstNode?.text}' is compared with`);
            comparison(new Comparison(binding(resolved(condition.subject.variable)), condition.negated, condition.op as ComparisonOperation, operand(compared)));
        } else {   // … AND the Person's age larger than 3
            dataAssertion(condition.subject, condition.negated, condition.op as AssertionOperation, condition.value && operand(condition.value));
        }
    }

    for (const condition of node.given) {
        if (isStateCondition(condition)) {
            const entity = resolved(condition.entity).name;
            given.states.push([entity, resolved(condition.state).name]);
            given.statesCtx.push([instance(entity)]);
        } else if (isActionCondition(condition)) {
            addScenarioStatus(given, condition, actionCtx(condition.action));
        } else if (isEnabledCondition(condition)) {
            given.enableds.push(resolved(condition.action).name);
            given.enabledsCtx.push(actionCtx(condition.action));
        } else if (isPropertyAssertion(condition)) {
            const result = assertion(condition, undefined);
            given.dataAssertions.push(result);
            given.dataAssertionsCtx.push([instance(result.entity)]);
        }
    }
    for (const effect of node.effects) {
        if (isActionEffect(effect)) {
            addThenStatus(then, effect, actionCtx(effect.action));
        } else if (isPropertyAssignment(effect)) {
            const entity = resolved(effect.subject.entity).name;
            const operation = ASSIGNMENTS[effect.op] ?? effect.op as AssignmentOperation;
            const dequeuedAs = effect.variable && binding(effect.variable);   // … is dequeued as job
            then.dataAssignments.push(new PropertyAssignment(entity, resolved(effect.subject.property).name, operation, effect.value && operand(effect.value), dequeuedAs));
            then.dataAssignmentsCtx.push([instance(entity)]);
        }
    }
    result.instances = instances;
    return result;
}

/** '<value> is added to / removed from <list>' is stored as '<list> is added with / removed with <value>'. */
const ASSIGNMENTS: Record<string, AssignmentOperation> = { 'added to': 'added with', 'removed from': 'removed with' };

// ---------- Conditions ----------

type StatusLists = Record<'availables' | 'notAvailables' | 'pendings' | 'notPendings' | 'executed' | 'notExecuted', string[]>;

/** The list for each status: [without 'not', with 'not']. */
const STATUS_LISTS = {
    available: ['availables', 'notAvailables'],
    pending: ['pendings', 'notPendings'],
    executed: ['executed', 'notExecuted']
} as const;

/** print is (not) pending -> pendings / notPendings, and so on. */
function addStatus(lists: StatusLists, condition: ActionCondition | ActionEffect): void {
    const list = STATUS_LISTS[condition.status][condition.negated ? 1 : 0];
    lists[list].push(resolved(condition.action).name);
}

/** As addStatus, with the action's context in the context list next to it: pendings -> pendingsCtx. */
function addScenarioStatus(given: Given, condition: ActionCondition, ctx: Context): void {
    const list = STATUS_LISTS[condition.status][condition.negated ? 1 : 0];
    given[list].push(resolved(condition.action).name);
    given[`${list}Ctx`].push(ctx);
}

/** print is pending -> pendings, print is (not) available -> availables / notAvailables, with the action's context. */
function addThenStatus(then: Then, effect: ActionEffect, ctx: Context): void {
    const list = effect.status === 'pending' ? 'pendings' : effect.negated ? 'notAvailables' : 'availables';
    then[list].push(resolved(effect.action).name);
    then[`${list}Ctx`].push(ctx);
}

/** its / the / the <Entity>'s <property> (in a specification), or the <Entity>'s <property> (in a scenario). */
function assertion(node: SelfAssertion | PropertyAssertionNode, implicitEntity: string | undefined): PropertyAssertion {
    const entity = required(node.subject.entity?.ref?.name ?? implicitEntity, `the entity of '${node.subject.$cstNode?.text}'`);
    return new PropertyAssertion(entity, resolved(node.subject.property).name, node.negated, node.op as AssertionOperation, node.value && value(node.value));
}

/** file: string, as its action declares it */
function parameter({ name, type }: ActionInput | ActionOutput): Parameter {
    return { name, type };
}

function value(node: ValueNode): Value {
    if (isIntValue(node) || isStringValue(node)) {
        return node.value;
    }
    return node.value === 'true';
}


// ---------- Helpers ----------
// The document has no errors, so every reference resolves and every implicit entity exists;
// these only fail if that does not hold.

function resolved<T extends AstNode & { name: string }>(reference: Reference<T>): T {
    return required(reference.ref, `'${reference.$refText}'`);
}

function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) {
        throw new Error(`Cannot build the model: ${what} is missing.`);
    }
    return value;
}
