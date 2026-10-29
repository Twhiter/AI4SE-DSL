import { AstUtils, GrammarUtils, type ValidationAcceptor, type ValidationChecks } from 'langium';
import {
    isActionInput, isActionParticipants, isBoolValue, isDeclarativeSpec, isEnabledSpec, isEntity, isIntValue, isPropertyPath, isScenario,
    isSelfStateCondition, isVariable, isVariableValue,
    type ActionInput, type ActionOutput, type ActionParticipants, type DataProperty, type PropertyPath, type WhenCondition, type WhenInput,
    type WhenOutput, type WhenValue, type DeclarativeSpec, type EasyAstType, type EffectValue, type EnabledSpec,
    type Entity, type LifecycleAction, type Model, type PropertyAssertion, type PropertyAssignment, type Role, type ScalarType, type Scenario, type SelfAssertion,
    type SelfStateCondition, type State, type StateCondition, type Value, type Variable
} from './generated/ast.js';
import { participantsOf, typeOfBinding } from './easy-dsl-services.js';
import type { EasyServices } from './easy-module.js';

type DataType = DataProperty['type'];

/**
 * The phrases each type allows, in assertions and in assignments. To change what a type allows, edit it here;
 * a new phrase also needs its place in easy.langium. The elements of a list or a queue have its 'of' type, or
 * are Any (an int, a string or a boolean).
 */
const ALLOWED: Record<DataType, { assertion: string[], assignment: string[] }> = {
    int:     { assertion: ['equal to', 'larger than', 'smaller than', 'undefined'], assignment: ['set to'] },
    string:  { assertion: ['equal to', 'undefined'], assignment: ['set to'] },
    boolean: { assertion: ['equal to', 'undefined'], assignment: ['set to'] },
    Any:     { assertion: ['equal to', 'undefined'], assignment: ['set to'] },
    list:    { assertion: ['included in', 'empty', 'full'], assignment: ['added with', 'removed with', 'added to', 'removed from', 'set to empty'] },
    queue:   { assertion: ['included in', 'empty', 'full'], assignment: ['enqueued with', 'dequeued', 'set to empty'] }
};

export function registerValidationChecks(services: EasyServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.EasyValidator;
    const checks: ValidationChecks<EasyAstType> = {
        SelfAssertion: validator.checkAssertion,
        PropertyAssertion: validator.checkAssertion,
        PropertyAssignment: validator.checkAssignment,
        Variable: validator.checkVariable,
        Entity: validator.checkEntity,
        StateCondition: validator.checkSpecifiedState,
        SelfStateCondition: validator.checkSpecifiedState,
        Role: validator.checkRole,
        ActionParticipants: validator.checkActionParticipants,
        ActionInput: validator.checkActionValue,
        ActionOutput: validator.checkActionValue,
        LifecycleAction: validator.checkLifecycleAction,
        DeclarativeSpec: [validator.checkDeclarativeSpecification, validator.checkStateCycle],
        EnabledSpec: validator.checkEnabledSpecification,
        Scenario: validator.checkWhen,
        WhenCondition: validator.checkWhenCondition
    };
    registry.register(checks, validator);
}

export class EasyValidator {

    checkAssertion(assertion: SelfAssertion | PropertyAssertion, accept: ValidationAcceptor): void {
        this.checkOperation(assertion, 'assertion', accept);
    }

    checkAssignment(assignment: PropertyAssignment, accept: ValidationAcceptor): void {
        this.checkOperation(assignment, 'assignment', accept);
    }

    /** A name is bound once per scenario: a second '… as job', or one named like an input or output of the When, would hide the first. */
    checkVariable(variable: Variable, accept: ValidationAcceptor): void {
        const scenario = AstUtils.getContainerOfType(variable, isScenario);
        const bindings = scenario ? [...scenario.inputs, ...scenario.outputs, ...AstUtils.streamAllContents(scenario).filter(isVariable)] : [];
        if (bindings.find(other => other.name === variable.name) !== variable) {
            accept('error', `'${variable.name}' is already bound in this scenario.`, { node: variable });
        }
    }

    /** Each part of an entity once: a second 'Actions:' is most likely a mistake. */
    checkEntity(entity: Entity, accept: ValidationAcceptor): void {
        for (const [keyword, part] of [['Actions', 'Actions'], ['Data', 'Data properties'], ['States', 'States']]) {
            if (GrammarUtils.findNodesForKeyword(entity.$cstNode, keyword).length > 1) {
                accept('error', `'${part}' is written twice in the ${entity.name}; list them in one place.`, { node: entity, keyword, index: 1 });
            }
        }
    }

    /** A role and an entity cannot share a name: `Initiators: Printer` would not say which one is meant. */
    checkRole(role: Role, accept: ValidationAcceptor): void {
        if (modelOf(role).elements.some(element => isEntity(element) && element.name === role.name)) {
            accept('error', `'${role.name}' is already the name of an entity; a role and an entity cannot have the same name.`, { node: role, property: 'name' });
        }
    }

    /** One `Action … { … }` block per name. */
    checkActionParticipants(block: ActionParticipants, accept: ValidationAcceptor): void {
        if (modelOf(block).elements.filter(isActionParticipants).find(other => other.name === block.name) !== block) {
            accept('error', `There is already an 'Action ${block.name} { … }' block.`, { node: block, property: 'name' });
        }
    }

    /** Each input and output of an action has a name of its own: a When names them. */
    checkActionValue(value: ActionInput | ActionOutput, accept: ValidationAcceptor): void {
        const block = value.$container;
        const first = [...block.inputs, ...block.outputs].find(other => other.name === value.name);
        if (first !== value) {
            accept('error', `'${block.name}' already has ${isActionInput(first) ? 'an input' : 'an output'} named '${value.name}'.`, { node: value, property: 'name' });
        }
    }

    /**
     * An entity's action is listed by one entity only (so it is in one lifecycle), and should say who
     * initiates and observes it in an `Action … { … }` block.
     */
    checkLifecycleAction(action: LifecycleAction, accept: ValidationAcceptor): void {
        const first = modelOf(action).elements.filter(isEntity).flatMap(entity => entity.actions).find(other => other.name === action.name);
        if (first && first !== action) {
            accept('error', `'${action.name}' is already an action of the ${first.$container.name}; an action can be in only one lifecycle.`, { node: action });
        } else if (!participantsOf(action)) {
            accept('warning', `Initiators and observers of '${action.name}' are not specified. Add 'Action ${action.name} { Initiators: … }'.`, { node: action });
        }
    }

    /**
     * A state that a scenario ('the <Entity> is <state>') or a Declarative specification ('it is <state>') uses needs a
     * Declarative specification: a state is not data, and its specification says what it means in data, so that a Given
     * in the end only says things about data (or what the specifications resolve). Without one, Z3 knows nothing of it.
     * A state nothing uses yet can wait for its specification.
     */
    checkSpecifiedState(condition: StateCondition | SelfStateCondition, accept: ValidationAcceptor): void {
        const state = condition.state?.ref;
        if (state && !isSpecified(state)) {
            const entity = state.$container;
            const user = isSelfStateCondition(condition) ? 'A Declarative specification' : 'A scenario';
            accept('error', `${user} cannot use the state '${state.name}' of the ${entity.name}: it has no Declarative specification. Add 'Declarative specification ${entity.name} is ${state.name} means { … }'.`, { node: condition, property: 'state' });
        }
    }

    /** One Declarative specification per entity and state. */
    checkDeclarativeSpecification(spec: DeclarativeSpec, accept: ValidationAcceptor): void {
        const same = (other: DeclarativeSpec) => other.entity?.ref !== undefined && other.entity.ref === spec.entity?.ref
            && other.state?.ref !== undefined && other.state.ref === spec.state?.ref;
        if (spec.state?.ref && modelOf(spec).elements.filter(isDeclarativeSpec).find(same) !== spec) {
            accept('error', `There is already a Declarative specification for '${spec.entity.ref?.name} is ${spec.state.ref.name}'.`, { node: spec, property: 'state' });
        }
    }

    /**
     * A state should in the end be specified by data and actions, not by itself: a warning on the 'it is <state>' of a
     * Declarative specification that leads back to its own state, with the cycle (busy → idle → busy). A saturated
     * When rule leaves such a state out (Given.saturated).
     */
    checkStateCycle(spec: DeclarativeSpec, accept: ValidationAcceptor): void {
        const [entity, state] = [spec.entity?.ref, spec.state?.ref];
        if (!entity || !state) {
            return;
        }
        const specs = modelOf(spec).elements.filter(isDeclarativeSpec).filter(other => other.entity?.ref === entity);
        const named = (of: State) => specs.filter(other => other.state?.ref === of)
            .flatMap(other => other.conditions.filter(isSelfStateCondition).flatMap(condition => condition.state?.ref ? [condition.state.ref] : []));
        for (const condition of spec.conditions.filter(isSelfStateCondition)) {
            const path = condition.state?.ref && pathTo(state, condition.state.ref, named);
            if (path) {
                accept('warning', `The Declarative specifications of the ${entity.name} go round in a cycle: ${[state, ...path].map(({ name }) => name).join(' → ')}.`,
                    { node: condition });
                return;
            }
        }
    }

    /** One enabled specification per action (a broken one, such as `print is available means { … }`, does not count). */
    checkEnabledSpecification(spec: EnabledSpec, accept: ValidationAcceptor): void {
        const written = (other: EnabledSpec) => GrammarUtils.findNodeForKeyword(other.$cstNode, 'enabled') !== undefined;
        const action = spec.action?.ref;
        if (action && written(spec) && modelOf(spec).elements.filter(isEnabledSpec).filter(written).find(other => other.action?.ref === action) !== spec) {
            accept('error', `There is already an enabled specification for '${action.name}'.`, { node: spec, property: 'action' });
        }
    }

    /**
     * The When names inputs and outputs the action has, each once; one it leaves out is any value. A value it gives one
     * is a value or data of its type (data as at the Given's time).
     */
    checkWhen(scenario: Scenario, accept: ValidationAcceptor): void {
        const action = scenario.action?.ref;
        if (!action) {
            return; // the linker already reports it
        }
        const declared = participantsOf(action);
        const check = (written: Array<WhenInput | WhenOutput>, kind: 'input' | 'output', declarations: Array<ActionInput | ActionOutput>) => {
            written.forEach((value, i) => {
                const declaration = declarations.find(({ name }) => name === value.name);
                if (!declaration) {
                    const names = declarations.map(({ name }) => `'${name}'`).join(', ');
                    accept('error', declarations.length === 0 ? `'${action.name}' has no ${kind}s.` : `'${action.name}' has no ${kind} '${value.name}'; its ${kind}s are ${names}.`,
                        { node: value, property: 'name' });
                } else if (written.findIndex(other => other.name === value.name) !== i) {
                    accept('error', `The ${kind} '${value.name}' is given twice.`, { node: value, property: 'name' });
                } else if (value.value) {
                    this.checkWhenValue(value.value, declaration, accept);
                }
            });
        };
        check(scenario.inputs, 'input', declared?.inputs ?? []);
        check(scenario.outputs, 'output', declared?.outputs ?? []);
    }

    /**
     * An assertion after the When's inputs and outputs: about data, as at the Given's time, or an input or output
     * compared with a value or another one (age larger than 17).
     */
    checkWhenCondition(condition: WhenCondition, accept: ValidationAcceptor): void {
        if (isPropertyPath(condition.subject)) {
            this.checkOperation(condition as WhenCondition & { subject: PropertyPath }, 'assertion', accept);
            return;
        }
        const binding = condition.subject.variable?.ref;
        const type = binding && typeOfBinding(binding);
        if (!binding || !type) {
            return; // the linker already reports it
        }
        if (!ALLOWED[type].assertion.includes(condition.op)) {
            accept('error', `'${condition.op}' cannot be used with '${binding.name}', which is ${describe(type)}.`, { node: condition.subject });
            return;
        }
        this.checkValueType(condition.value, binding.name, type, describe(type), accept);
    }

    /** name = "Ann" (a value of the input's or output's type), age = the Person's age (data of that type). */
    private checkWhenValue(value: WhenValue, declaration: ActionInput | ActionOutput, accept: ValidationAcceptor): void {
        if (!isPropertyPath(value)) {
            if (declaration.type !== 'Any' && typeOfValue(value) !== declaration.type) {
                accept('error', `'${declaration.name}' is ${describe(declaration.type)}, but this is ${describe(typeOfValue(value))}.`, { node: value });
            }
            return;
        }
        const property = value.property?.ref;
        if (property && (property.type === 'list' || property.type === 'queue')) {
            accept('error', `'${property.name}' is ${describeProperty(property)}, but '${declaration.name}' is ${describe(declaration.type)}.`, { node: value });
        } else if (property && property.type === 'Any' && declaration.type !== 'Any') {
            accept('warning', `'${property.name}' can be any value, but '${declaration.name}' is ${describe(declaration.type)}.`, { node: value });
        } else if (property && declaration.type !== 'Any' && property.type !== declaration.type) {
            accept('error', `'${property.name}' is ${describe(property.type)}, but '${declaration.name}' is ${describe(declaration.type)}.`, { node: value });
        }
    }

    /**
     * The phrase must be one the property's type allows, and a value must have the type the property takes: its own,
     * or for a list or queue its element type (anything for Any). A value or named constant of another type is an
     * error: no type converts to another. Only Any converts to any type: a named constant of type Any where a type
     * is needed is a warning, as its value may or may not have that type.
     */
    private checkOperation(node: SelfAssertion | PropertyAssertion | PropertyAssignment | WhenCondition & { subject: PropertyPath },
        kind: 'assertion' | 'assignment', accept: ValidationAcceptor): void {
        const property = node.subject?.property?.ref;
        if (!property) {
            return; // the linker already reports it
        }
        if (node.op === 'undefined' && (property.type === 'list' || property.type === 'queue')) {
            accept('error', `'${property.name}' is ${describeProperty(property)}, which always has a value: it starts empty.`, { node: node.subject });
            return;
        }
        if (!ALLOWED[property.type][kind].includes(node.op)) {
            accept('error', `'${node.op}' cannot be used with '${property.name}', which is ${describeProperty(property)}.`, { node: node.subject });
            return;
        }
        this.checkValueType(node.value, property.name, takenType(property), describeProperty(property), accept);
    }

    /**
     * A value or a name used as a value must have the type `takes` (anything for Any) of what it goes with (`name`,
     * which is `described`). A name of type Any where a type is needed is a warning: its value may or may not have it.
     */
    private checkValueType(value: EffectValue | undefined, name: string, takes: ScalarType, described: string, accept: ValidationAcceptor): void {
        if (!value || takes === 'Any') {
            return;
        }
        if (isVariableValue(value)) {
            const binding = value.variable?.ref;
            const type = binding && typeOfBinding(binding);
            if (binding && type === 'Any') {
                accept('warning', `'${binding.name}' can be any value, but '${name}' is ${described}.`, { node: value });
            } else if (binding && type && type !== takes) {
                accept('error', `'${binding.name}' is ${describe(type)}, but '${name}' is ${described}.`, { node: value });
            }
        } else if (typeOfValue(value) !== takes) {
            accept('error', `'${name}' is ${described}, but this is ${describe(typeOfValue(value))}.`, { node: value });
        }
    }
}

function typeOfValue(value: Value): ScalarType {
    return isIntValue(value) ? 'int' : isBoolValue(value) ? 'boolean' : 'string';
}

/** The type of the values a property takes: its own type, or the element type of a list or queue. */
function takenType(property: DataProperty): ScalarType {
    return property.type === 'list' || property.type === 'queue' ? property.elementType ?? 'Any' : property.type;
}

/** an int, a string, Any */
function describe(type: DataType): string {
    return type === 'Any' ? 'Any' : `${type === 'int' ? 'an' : 'a'} ${type}`;
}

/** an int, a list, a queue of string */
function describeProperty(property: DataProperty): string {
    const elements = property.elementType && property.elementType !== 'Any' ? ` of ${property.elementType}` : '';
    return describe(property.type) + elements;
}

/** Whether a state has its Declarative specification. */
function isSpecified(state: State): boolean {
    return modelOf(state).elements.filter(isDeclarativeSpec).some(spec => spec.entity?.ref === state.$container && spec.state?.ref === state);
}

function modelOf(node: Parameters<typeof AstUtils.findRootNode>[0]): Model {
    return AstUtils.findRootNode(node) as Model;
}

/** The shortest path from `from` to `target` along `next`, both included ([from] when they are the same); undefined without one. */
function pathTo<T>(target: T, from: T, next: (node: T) => T[]): T[] | undefined {
    const previous = new Map<T, T | undefined>([[from, undefined]]);
    for (const queue = [from]; queue.length > 0;) {
        const node = queue.shift()!;
        if (node === target) {
            const path: T[] = [];
            for (let at: T | undefined = node; at !== undefined; at = previous.get(at)) {
                path.unshift(at);
            }
            return path;
        }
        for (const following of next(node).filter(following => !previous.has(following))) {
            previous.set(following, node);
            queue.push(following);
        }
    }
    return undefined;
}
