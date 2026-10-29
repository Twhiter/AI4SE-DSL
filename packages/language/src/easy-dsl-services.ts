// Custom services for the Easy language, registered in EasyModule (easy-module.ts).

import {
    AstUtils, CstUtils, DefaultLinker, DefaultScopeComputation, DefaultScopeProvider, DefaultValueConverter, GrammarAST, isLeafCstNode,
    type AstNode, type AstNodeDescription, type Cancellation, type CstNode, type LangiumDocument, type LinkingError,
    type MultiMap, type ReferenceInfo, type Scope, type ValueType
} from 'langium';
import {
    Action, Binding, DataProperty, Entity, State, isActionInput, isActionOutput, isActionParticipants, isBinding, isDeclarativeSpec, isEnabledSpec,
    isEntity, isLifecycleAction, isPropertyPath, isScenario, isSelfPath, isSelfStateCondition, isStateCondition, isVariable, isWhenInput,
    isWhenOutput, type ActionParticipants, type Model, type ScalarType, type Variable
} from './generated/ast.js';

/**
 * By default only the direct children of Model (Entity, Role, ...) are visible document-wide.
 * States, actions and properties live inside an Entity, so references to them would fail; export every
 * named node instead. An `Action print { … }` block for an entity's action is not an action of its own:
 * `print` means the entity's action, so the block is left out. The inputs and outputs of an action, of a When, and
 * the elements a Then dequeues belong to their action or scenario, which EasyScopeProvider looks them up in, so they
 * are left out too.
 */
export class EasyScopeComputation extends DefaultScopeComputation {
    override collectExportedSymbols(document: LangiumDocument, cancelToken?: Cancellation.CancellationToken): Promise<AstNodeDescription[]> {
        const children = (root: AstNode) => AstUtils.streamAllContents(root).filter(isSymbol);
        return this.collectExportedSymbolsForNode(document.parseResult.value, document, children, cancelToken);
    }

    protected override addLocalSymbol(node: AstNode, document: LangiumDocument, symbols: MultiMap<AstNode, AstNodeDescription>): void {
        if (isSymbol(node)) {
            super.addLocalSymbol(node, document, symbols);
        }
    }
}

/** A named node that other elements can refer to by name, document-wide. */
function isSymbol(node: AstNode): boolean {
    return !isParticipantsOfLifecycleAction(node) && !isBinding(node) && !isActionInput(node) && !isActionOutput(node);
}

/**
 * Properties and states are only looked up in the entity they belong to. Inside a Declarative specification the
 * entity is implicit (the specified entity): only it can be named, and only actions in its lifecycle, or in none, can
 * be used; inside an enabled specification only actions in the lifecycle of its action, or in none. A name used as a
 * value in a scenario is looked up among the inputs and outputs of its When, and the elements dequeued before it.
 */
export class EasyScopeProvider extends DefaultScopeProvider {
    override getScope(context: ReferenceInfo): Scope {
        const { container } = context;
        const type = this.reflection.getReferenceType(context);
        if (type === State.$type) {
            return this.createScopeForNodes(stateOwner(container)?.states ?? []);
        }
        if (type === DataProperty.$type) {
            return this.createScopeForNodes(propertyOwner(container)?.dataProperties ?? []);
        }
        if (type === Binding.$type) {
            return this.createScopeForNodes(bindingsBefore(container));
        }
        const implicit = implicitEntityOf(container);
        if (implicit && type === Entity.$type) {
            return this.createScopeForNodes(implicit.entity ? [implicit.entity] : []);
        }
        if (implicit && type === Action.$type) {
            return this.createScopeForNodes(allActions(modelOf(container)).filter(action => inLifecycle(action, implicit.entity)));
        }
        return super.getScope(context);
    }
}

/** Explains the lookup rules above instead of the generic "Could not resolve reference to …". */
export class EasyLinker extends DefaultLinker {
    protected override createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription): LinkingError {
        const error = super.createLinkingError(refInfo, targetDescription);
        const { container, reference } = refInfo;
        const name = reference.$refText;
        const type = this.reflection.getReferenceType(refInfo);
        const model = modelOf(container);
        const implicit = implicitEntityOf(container);
        const noEntity = implicit && !implicit.entity && implicit.action;
        if (type === DataProperty.$type || type === State.$type) {
            const owner = type === State.$type ? stateOwner(container) : propertyOwner(container);
            if (owner) {
                error.message = `The ${owner.name} has no ${type === State.$type ? 'state' : 'data property'} '${name}'.`;
            }
        } else if (type === Entity.$type && implicit?.entity && model.elements.some(element => isEntity(element) && element.name === name)) {
            error.message = `'${name}' cannot be used here; this specification is about the ${implicit.entity.name}.`;
        } else if (type === Binding.$type) {
            const binding = `… is executed with inputs ${name}, … outputs ${name}, or … is dequeued as ${name}`;
            error.message = variablesOf(container).some(variable => variable.name === name)
                ? `'${name}' is used before it is bound; bind it first: ${binding}.`
                : `The When has no input or output '${name}', and nothing is dequeued as '${name}': ${binding}.`;
        } else if (type === Action.$type && implicit) {
            const other = allActions(model).find(action => action.name === name);
            const lifecycle = other && lifecycleOf(other);
            if (lifecycle && implicit.entity) {
                error.message = `'${name}' is in the lifecycle of the ${lifecycle.name}, not of the ${implicit.entity.name}.`;
            } else if (lifecycle && noEntity) {
                error.message = `'${name}' is in the lifecycle of the ${lifecycle.name}, but '${noEntity.name}' is in no lifecycle.`;
            }
        }
        return error;
    }
}

/**
 * A data type rule concatenates its tokens without whitespace, so `Name: ID+` turns "Print job" into
 * "Printjob" and `IntOperation` "larger than" into "largerthan". Re-join the tokens with single spaces.
 */
export class EasyValueConverter extends DefaultValueConverter {
    protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
        if (GrammarAST.isParserRule(rule)) {
            return CstUtils.streamCst(cstNode)
                .filter(isLeafCstNode)
                .filter(node => !node.hidden)
                .map(node => node.text)
                .join(' ');
        }
        return super.runConverter(rule, input, cstNode);
    }
}

/** The entity whose lifecycle `action` is in, i.e. the entity listing it under 'Actions:', if any. */
export function lifecycleOf(action: Action): Entity | undefined {
    return isLifecycleAction(action) ? action.$container : undefined;
}

/**
 * The type of what a name used as a value stands for: an input or output of the When, the type the action declares
 * for it; an element a Then dequeues, the element type of the queue (Any for a queue without 'of').
 */
export function typeOfBinding(binding: Binding): ScalarType | undefined {
    if (isWhenInput(binding) || isWhenOutput(binding)) {
        const action = binding.$container.action?.ref;
        const declared = action && participantsOf(action);
        return (isWhenInput(binding) ? declared?.inputs : declared?.outputs)?.find(({ name }) => name === binding.name)?.type;
    }
    const queue = binding.$container.subject?.property?.ref;
    return queue && (queue.elementType ?? 'Any');
}

/** The `Action … { Initiators: … }` block of an action, found by name. */
export function participantsOf(action: Action): ActionParticipants | undefined {
    return isActionParticipants(action)
        ? action
        : modelOf(action).elements.filter(isActionParticipants).find(block => block.name === action.name);
}

/** An `Action print { … }` block that adds initiators and observers to an entity's action `print`. */
export function isParticipantsOfLifecycleAction(node: AstNode): node is ActionParticipants {
    return isActionParticipants(node)
        && modelOf(node).elements.filter(isEntity).some(entity => entity.actions.some(action => action.name === node.name));
}

/** The entity whose states a state reference is looked up in. */
function stateOwner(node: AstNode): Entity | undefined {
    if (isDeclarativeSpec(node) || isStateCondition(node)) {
        return node.entity?.ref;           // Declarative specification Printer is busy, the Printer is idle
    }
    return isSelfStateCondition(node) ? implicitEntityOf(node)?.entity : undefined;   // it is busy
}

/** The entity whose data properties a path's property is looked up in. */
function propertyOwner(node: AstNode): Entity | undefined {
    if (isPropertyPath(node)) {
        return node.entity?.ref;           // the Printer's speed
    }
    return isSelfPath(node) ? node.entity?.ref ?? implicitEntityOf(node)?.entity : undefined;   // its speed, the speed
}

/**
 * The entity implicit inside a specification's conditions: the specified entity of a Declarative specification,
 * or the lifecycle entity of the action of an enabled specification (none for an action in no lifecycle).
 * Undefined outside their conditions, and in an enabled specification whose action does not resolve.
 */
function implicitEntityOf(node: AstNode): { entity?: Entity, action?: Action } | undefined {
    const enabled = AstUtils.getContainerOfType(node, isEnabledSpec);
    if (enabled && enabled !== node) {   // the head's own reference is not inside the conditions
        const action = enabled.action?.ref;
        return action && { entity: lifecycleOf(action), action };
    }
    const spec = AstUtils.getContainerOfType(node, isDeclarativeSpec);
    return spec && spec !== node ? { entity: spec.entity?.ref } : undefined;
}

/** The variables of the scenario around `node`, in their order: … is dequeued as job. */
function variablesOf(node: AstNode): Variable[] {
    const scenario = AstUtils.getContainerOfType(node, isScenario);
    return scenario ? AstUtils.streamAllContents(scenario).filter(isVariable).toArray() : [];
}

/** What a name used as a value at `node` can stand for: the inputs and outputs of its When, the elements dequeued before it. */
function bindingsBefore(node: AstNode): Binding[] {
    const scenario = AstUtils.getContainerOfType(node, isScenario);
    const offset = node.$cstNode?.offset ?? 0;
    const dequeued = variablesOf(node).filter(variable => (variable.$cstNode?.offset ?? offset) < offset);
    return scenario ? [...scenario.inputs, ...scenario.outputs, ...dequeued] : [];
}

/** `action` can be used in a specification about `entity` if it is in its lifecycle, or in none. */
function inLifecycle(action: Action, entity: Entity | undefined): boolean {
    const lifecycle = lifecycleOf(action);
    return !lifecycle || lifecycle === entity;
}

/** The entities' lifecycle actions and the actions that rely on no entity. */
function allActions(model: Model): Action[] {
    const lifecycleActions = model.elements.filter(isEntity).flatMap(entity => entity.actions);
    const freeActions = model.elements.filter(isActionParticipants).filter(block => !isParticipantsOfLifecycleAction(block));
    return [...lifecycleActions, ...freeActions];
}

function modelOf(node: AstNode): Model {
    return AstUtils.findRootNode(node) as Model;
}
