// The model of a DSL easy document: what an LLM reads and changes through its tools. It is not the checker's model
// (easy-language's model.ts): it may be inconsistent while the LLM works, and it keeps what the LLM wrote.
// Declarations are structured, so tools can change them piece by piece; enabled specifications, state
// specifications and scenarios are whole texts, each under its key.
// Controller.tools() gives the tools for the model as it is. Each comes from a method that, like a Python
// `create_…_tool()`, leaves the tool out while it cannot apply, limits its arguments to the names that exist (an
// entity is one of the entities), and returns a nested function as the tool, named after it: createEntity is the
// tool create_entity. A tool is not tied to an agent SDK: it has its name, description, parameters (a zod schema)
// and run, from which the chatbot makes its Agents SDK tools (packages/chatbot/src/agent.ts), and an MCP server
// could make its own.
// A document with a syntax error cannot be read into the model: the controller then keeps it as written (broken),
// and its tools are the read tools and fix_syntax, until the text reads again.
// The document is written from the model, so its comments are kept with the elements: each element keeps the
// comment lines just before it and a comment on the line where it ends, and an entity, role or action specification
// that no tool changed keeps its text as written, with the comments inside it (a changed one is written anew,
// without them). The comments after the last element stay at the end.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { checkDocument as check } from './checker.ts';
import { extract, type SyntaxProblem } from './extractor.ts';

/** Any is any value: an int, a string or a boolean. */
export type ScalarType = 'int' | 'string' | 'boolean' | 'Any';
export type DataPropertyType = ScalarType | 'list' | 'queue';

/** <name>: <type>, or <name>: a list / a queue (of <type>) */
export interface DataProperty {
    name: string;
    type: DataPropertyType;
    /** For a list or a queue: the type of its elements; without one it holds Any. */
    elementType?: ScalarType;
}

/** What every element of the document keeps of the comments around it, as written. */
export class Element {
    /** The comment lines just before it. */
    before = '';
    /** A comment on the line where it ends, after it. */
    after = '';
}

/**
 * A structured element's text as written, and the text the controller would write for it then: while the controller
 * would still write the same, the element is unchanged, and its text as written (with its comments) is kept.
 */
export interface Written {
    text: string;
    generated: string;
}

/** Entity <name> { Actions: …  Data properties: …  States: … } */
export class Entity extends Element {
    name: string;
    dataProperties: DataProperty[] = [];
    states: string[] = [];
    /** The actions in its lifecycle. */
    actions: string[] = [];
    written?: Written;

    constructor(name: string) {
        super();
        this.name = name;
    }
}

/** Role <name>. */
export class Role extends Element {
    name: string;
    written?: Written;

    constructor(name: string) {
        super();
        this.name = name;
    }
}

/**
 * <name>: <type>, an input of an action (a value it takes when it is executed) or an output (a value it gives back): its
 * name says what it is, and a When names it to give its value.
 */
export interface ActionParameter {
    name: string;
    type: ScalarType;
}

/** Action <action> { Initiators: …, Observers: …, Input: …, Output: … } */
export class ActionSpecification extends Element {
    action: string;
    /** Roles or entities, at least one. */
    initiators: string[];
    observers: string[] = [];
    inputs: ActionParameter[] = [];
    outputs: ActionParameter[] = [];
    written?: Written;

    constructor(action: string, initiators: string[]) {
        super();
        this.action = action;
        this.initiators = initiators;
    }
}

/** Action <action> is enabled means { … }, kept as written; at most one per action. */
export class EnabledSpecification extends Element {
    /** Its key. */
    action: string;
    text: string;

    constructor(action: string, text: string) {
        super();
        this.action = action;
        this.text = text;
    }
}

/** Declarative specification <Entity> is <state> means { … }, kept as written; one per state. */
export class StateSpecification extends Element {
    /** Its key, with the state. */
    entity: string;
    state: string;
    text: string;

    constructor(entity: string, state: string, text: string) {
        super();
        this.entity = entity;
        this.state = state;
        this.text = text;
    }
}

/** Scenario: <name> Given … When … Then … ., kept as written. */
export class Scenario extends Element {
    /** Its key: unique among the scenarios. */
    name: string;
    text: string;

    constructor(name: string, text: string) {
        super();
        this.name = name;
        this.text = text;
    }
}

// ---------------- Tools ----------------

/** read: the planner may call it at any time; change: changes the model, a step the planner puts in a plan. */
export type ToolKind = 'read' | 'change';

export interface ControllerTool {
    /** create_entity, read_document, … */
    name: string;
    kind: ToolKind;
    description: string;
    /** Its arguments, all of them required (an argument that may be left out takes null), as strict tools need. */
    parameters: z.ZodObject;
    /**
     * Runs the tool, as an agent's call or a step of a plan does: a ZodError when the input does not fit its
     * parameters, a Refusal when the model refuses the change, for the LLM to read and act on. Any other error is a
     * fault of the program, not something for the LLM to repair.
     */
    run(input: unknown): Promise<string>;
}

/** A tool as a client lists it, without a model to run on (Controller.catalog). */
export type ToolDescription = Omit<ControllerTool, 'run'>;

/** A change the model refuses, for the LLM to read and act on: a name taken, a key the text does not match, … */
export class Refusal extends Error {}

/** A refusal of a name or a text that the grammar does not accept. */
export class SyntaxRefusal extends Refusal {}

const SCALAR_TYPES = ['int', 'string', 'boolean', 'Any'] as const;
const DATA_PROPERTY_TYPES = [...SCALAR_TYPES, 'list', 'queue'] as const;

/** The grammar hints the LLM reads (packages/dsl-controller/grammar). */
const GRAMMAR_DIRECTORY = new URL('../grammar/', import.meta.url);

/** A document with syntax errors, as written. */
export interface BrokenDocument {
    text: string;
    errors: SyntaxProblem[];
}

/** The whole document, by kind. */
export class Controller {
    entities: Entity[] = [];
    roles: Role[] = [];
    actionSpecifications: ActionSpecification[] = [];
    enabledSpecifications: EnabledSpecification[] = [];
    stateSpecifications: StateSpecification[] = [];
    scenarios: Scenario[] = [];
    /** The comments after the last element, as written. */
    trailing = '';
    /** The document while it has syntax errors; the lists above are then empty. */
    broken: BrokenDocument | undefined = undefined;
    /** For the catalog: tools() gives every tool, whatever the model holds, its names of elements as plain strings. */
    private every = false;

    /**
     * Every tool, whatever a model holds, with the names of elements (an entity, a state, …) as plain strings: the
     * tools for a client that lists them once, such as an MCP server, while the tools of a model follow it. A call then
     * runs on the tools the model offers at that point (tools()), whose arguments are limited to the names that exist.
     */
    static catalog(): ToolDescription[] {
        const controller = new Controller();
        controller.every = true;
        return controller.tools().map(({ run, ...description }) => description);
    }

    /** The model of `text`; with syntax errors, the text as written, for the LLM to repair. */
    static fromText(text: string): Controller {
        const read = extract(text);
        if (read.controller) {
            return read.controller;
        }
        const controller = new Controller();
        controller.broken = { text, errors: read.errors };
        return controller;
    }

    /** A copy to try changes on, such as the steps of a plan: changing it leaves this model as it is. */
    copy(): Controller {
        return Controller.fromText(this.toDsl());
    }

    /**
     * The model as DSL easy text, one element after another, each with its comments: the structured parts written out
     * (as written while unchanged), the keyed texts as they are, then the comments at the end. A broken document as
     * written.
     */
    toDsl(): string {
        if (this.broken) {
            return this.broken.text;
        }
        return [
            ...this.entities.map(entity => commented(entity, structured(entity, entityDsl(entity)))),
            ...this.roles.map(role => commented(role, structured(role, roleDsl(role)))),
            ...this.actionSpecifications.map(specification => commented(specification, structured(specification, actionSpecificationDsl(specification)))),
            ...this.stateSpecifications.map(specification => commented(specification, specification.text)),
            ...this.enabledSpecifications.map(specification => commented(specification, specification.text)),
            ...this.scenarios.map(scenario => commented(scenario, scenario.text)),
            ...(this.trailing ? [this.trailing] : [])
        ].join('\n\n') + '\n';
    }

    /**
     * The tools for the model as it is now; call it again after every change, as their arguments follow the model.
     * For a broken document: the read tools and fix_syntax.
     */
    tools(): ControllerTool[] {
        if (this.broken) {
            return [this.readDocumentTool(), ...this.readGrammarTools(), this.checkDocumentTool(), this.fixSyntaxTool()];
        }
        const tools = [
            this.readDocumentTool(),
            ...this.readGrammarTools(),
            this.checkDocumentTool(),
            this.createEntityTool(),
            this.deleteEntityTool(),
            this.createDataPropertyTool(),
            this.deleteDataPropertyTool(),
            this.createStateTool(),
            this.deleteStateTool(),
            this.addEntityActionTool(),
            this.removeEntityActionTool(),
            this.createRoleTool(),
            this.deleteRoleTool(),
            this.createActionSpecificationTool(),
            this.replaceActionSpecificationTool(),
            this.deleteActionSpecificationTool(),
            this.createEnabledSpecificationTool(),
            this.replaceEnabledSpecificationTool(),
            this.deleteEnabledSpecificationTool(),
            this.createStateSpecificationTool(),
            this.replaceStateSpecificationTool(),
            this.deleteStateSpecificationTool(),
            this.createScenarioTool(),
            this.replaceScenarioTool(),
            this.deleteScenarioTool(),
            this.every ? this.fixSyntaxTool() : undefined
        ];
        return tools.filter(controllerTool => controllerTool !== undefined);
    }

    /** One of `names`: the argument can only be a name that exists; in the catalog, any name. */
    private oneOf(names: string[]) {
        return this.every ? z.string() : oneOf(names);
    }

    // ---------- read ----------

    private readDocumentTool(): ControllerTool {
        const readDocument = () => {
            if (!this.broken) {
                return this.toDsl();
            }
            return `${numbered(this.broken.text)}\n\nSyntax errors (line:column), to fix with fix_syntax:\n${syntaxErrors(this.broken.errors)}`;
        };

        return readTool(readDocument, 'The whole DSL easy document as it is now. With syntax errors: its lines numbered, and the errors.');
    }

    private readGrammarTools(): ControllerTool[] {
        const grammar = (name: string) => readFileSync(new URL(`${name}_grammar.txt`, GRAMMAR_DIRECTORY), 'utf8');

        const readDeclarationGrammar = () => grammar('declaration');
        const readStateSpecificationGrammar = () => grammar('state_specification');
        const readScenarioGrammar = () => grammar('scenario');

        return [
            readTool(readDeclarationGrammar, 'The grammar of entities, roles, action specifications and enabled specifications, as a short hint.'),
            readTool(readStateSpecificationGrammar, 'The grammar of state specifications (Declarative specification … means { … }), as a short hint.'),
            readTool(readScenarioGrammar, 'The grammar of scenarios, as a short hint.')
        ];
    }

    private checkDocumentTool(): ControllerTool {
        const checkDocument = () => check(this.toDsl());
        return readTool(checkDocument, 'Check the document: syntax and validation errors and warnings (line:column), then the Z3 checks '
            + 'of the specifications and scenarios. "No problems." when it is right.');
    }

    // ---------- entities ----------

    private createEntityTool(): ControllerTool {
        const parameters = z.object({ name: z.string() });

        const createEntity = ({ name }: z.infer<typeof parameters>) => {
            checkName(name, 'an entity');
            if (this.participants().includes(name)) {
                throw new Refusal(`There is already an entity or role '${name}'.`);
            }
            this.entities.push(new Entity(name));
            return `Added the entity '${name}'.`;
        };

        return changeTool(createEntity, 'Add an entity, with a name no entity or role has.', parameters);
    }

    private deleteEntityTool(): ControllerTool | undefined {
        if (!this.every && this.entities.length === 0) {
            return undefined;
        }
        const parameters = z.object({ entity: this.oneOf(this.entityNames()) });

        const deleteEntity = ({ entity }: z.infer<typeof parameters>) => {
            const removed = this.entity(entity);
            this.entities = this.entities.filter(candidate => candidate !== removed);
            const dropped = [
                ...this.dropStateSpecifications(entity),
                ...removed.actions.flatMap(action => this.dropEnabledSpecificationOfGoneAction(action))
            ];
            return `Deleted the entity '${entity}'${and(dropped)}.${this.stillNamed(entity)}`;
        };

        return changeTool(deleteEntity,
            'Delete an entity with its data properties, states and actions; the state specifications of its states go too.', parameters);
    }

    // ---------- data properties ----------

    private createDataPropertyTool(): ControllerTool | undefined {
        if (!this.every && this.entities.length === 0) {
            return undefined;
        }
        const parameters = z.object({
            entity: this.oneOf(this.entityNames()),
            name: z.string(),
            type: z.enum(DATA_PROPERTY_TYPES),
            element_type: z.enum(SCALAR_TYPES).nullable()
        });

        const createDataProperty = ({ entity, name, type, element_type }: z.infer<typeof parameters>) => {
            checkName(name, 'a data property');
            const owner = this.entity(entity);
            if (owner.dataProperties.some(property => property.name === name)) {
                throw new Refusal(`The ${entity} already has a data property '${name}'.`);
            }
            if (element_type !== null && type !== 'list' && type !== 'queue') {
                throw new Refusal(`Only a list or a queue has an element type; '${type}' has none.`);
            }
            owner.dataProperties.push(element_type === null ? { name, type } : { name, type, elementType: element_type });
            return `Added the data property '${name}' to the ${entity}.`;
        };

        return changeTool(createDataProperty, 'Add a data property to an entity, with a name new in that entity. A list or queue '
            + 'may give the type of its elements (element_type); without one it holds Any. element_type is null for the other types.', parameters);
    }

    private deleteDataPropertyTool(): ControllerTool | undefined {
        const properties = unique(this.entities.flatMap(entity => entity.dataProperties.map(property => property.name)));
        if (!this.every && properties.length === 0) {
            return undefined;
        }
        const parameters = z.object({ entity: this.oneOf(this.entityNames()), property: this.oneOf(properties) });

        const deleteDataProperty = ({ entity, property }: z.infer<typeof parameters>) => {
            const owner = this.entity(entity);
            if (!owner.dataProperties.some(candidate => candidate.name === property)) {
                throw new Refusal(`The ${entity} has no data property '${property}'.`);
            }
            owner.dataProperties = owner.dataProperties.filter(candidate => candidate.name !== property);
            return `Deleted the data property '${property}' of the ${entity}.`;
        };

        return changeTool(deleteDataProperty, 'Delete a data property of an entity.', parameters);
    }

    // ---------- states ----------

    private createStateTool(): ControllerTool | undefined {
        if (!this.every && this.entities.length === 0) {
            return undefined;
        }
        const parameters = z.object({ entity: this.oneOf(this.entityNames()), name: z.string() });

        const createState = ({ entity, name }: z.infer<typeof parameters>) => {
            checkName(name, 'a state');
            const owner = this.entity(entity);
            if (owner.states.includes(name)) {
                throw new Refusal(`The ${entity} already has a state '${name}'.`);
            }
            owner.states.push(name);
            return `Added the state '${name}' to the ${entity}.`;
        };

        return changeTool(createState, 'Add a state to an entity, with a name new in that entity. Its state specification can come later; a scenario or '
            + 'another state specification can use the state only once it has one.', parameters);
    }

    private deleteStateTool(): ControllerTool | undefined {
        const states = unique(this.entities.flatMap(entity => entity.states));
        if (!this.every && states.length === 0) {
            return undefined;
        }
        const parameters = z.object({ entity: this.oneOf(this.entityNames()), state: this.oneOf(states) });

        const deleteState = ({ entity, state }: z.infer<typeof parameters>) => {
            const owner = this.entity(entity);
            if (!owner.states.includes(state)) {
                throw new Refusal(`The ${entity} has no state '${state}'.`);
            }
            owner.states = owner.states.filter(candidate => candidate !== state);
            return `Deleted the state '${state}' of the ${entity}${and(this.dropStateSpecifications(entity, state))}.`;
        };

        return changeTool(deleteState, 'Delete a state of an entity, with its state specification.', parameters);
    }

    // ---------- an entity's actions ----------

    private addEntityActionTool(): ControllerTool | undefined {
        if (!this.every && this.entities.length === 0) {
            return undefined;
        }
        const parameters = z.object({ entity: this.oneOf(this.entityNames()), action: z.string() });

        const addEntityAction = ({ entity, action }: z.infer<typeof parameters>) => {
            checkName(action, 'an action');
            const owner = this.entities.find(candidate => candidate.actions.includes(action));
            if (owner) {
                throw new Refusal(`'${action}' is already an action of the ${owner.name}.`);
            }
            this.entity(entity).actions.push(action);
            return `Added the action '${action}' to the ${entity}.`;
        };

        return changeTool(addEntityAction, "Add an action to an entity's lifecycle; an action is in at most one entity's lifecycle.", parameters);
    }

    private removeEntityActionTool(): ControllerTool | undefined {
        const actions = this.entities.flatMap(entity => entity.actions);
        if (!this.every && actions.length === 0) {
            return undefined;
        }
        const parameters = z.object({ entity: this.oneOf(this.entityNames()), action: this.oneOf(actions) });

        const removeEntityAction = ({ entity, action }: z.infer<typeof parameters>) => {
            const owner = this.entity(entity);
            if (!owner.actions.includes(action)) {
                throw new Refusal(`'${action}' is not an action of the ${entity}.`);
            }
            owner.actions = owner.actions.filter(candidate => candidate !== action);
            return `Removed the action '${action}' from the ${entity}${and(this.dropEnabledSpecificationOfGoneAction(action))}.`;
        };

        return changeTool(removeEntityAction, "Remove an action from an entity's lifecycle. Without an action specification it is no "
            + 'action any more, and its enabled specification goes too.', parameters);
    }

    // ---------- roles ----------

    private createRoleTool(): ControllerTool {
        const parameters = z.object({ name: z.string() });

        const createRole = ({ name }: z.infer<typeof parameters>) => {
            checkName(name, 'a role');
            if (this.participants().includes(name)) {
                throw new Refusal(`There is already a role or entity '${name}'.`);
            }
            this.roles.push(new Role(name));
            return `Added the role '${name}'.`;
        };

        return changeTool(createRole, 'Add a role, with a name no role or entity has.', parameters);
    }

    private deleteRoleTool(): ControllerTool | undefined {
        if (!this.every && this.roles.length === 0) {
            return undefined;
        }
        const parameters = z.object({ role: this.oneOf(this.roles.map(role => role.name)) });

        const deleteRole = ({ role }: z.infer<typeof parameters>) => {
            this.roles = this.roles.filter(candidate => candidate.name !== role);
            return `Deleted the role '${role}'.${this.stillNamed(role)}`;
        };

        return changeTool(deleteRole, 'Delete a role.', parameters);
    }

    // ---------- action specifications ----------

    private createActionSpecificationTool(): ControllerTool | undefined {
        if (!this.every && this.participants().length === 0) {
            return undefined;
        }
        const parameters = this.actionSpecificationParameters(z.string());

        const createActionSpecification = ({ action, initiators, observers, inputs, outputs }: z.infer<typeof parameters>) => {
            checkName(action, 'an action');
            if (this.actionSpecifications.some(specification => specification.action === action)) {
                throw new Refusal(`'${action}' already has an action specification: use replace_action_specification.`);
            }
            this.actionSpecifications.push(actionSpecification(action, initiators, observers, inputs, outputs));
            return `Added the action specification of '${action}'.`;
        };

        return changeTool(createActionSpecification, 'Say who initiates an action (at least one role or entity), who observes it '
            + '(null for no one), its inputs (the values it takes from outside when executed) and its outputs (the values an '
            + 'external procedure gives back), each with a name and a type (null for none); a When names them to give their '
            + "values. For an action of an entity's lifecycle, or a new action that relies on no entity; at most one per action.", parameters);
    }

    private replaceActionSpecificationTool(): ControllerTool | undefined {
        const actions = this.actionSpecifications.map(specification => specification.action);
        if (!this.every && (actions.length === 0 || this.participants().length === 0)) {
            return undefined;
        }
        const parameters = this.actionSpecificationParameters(this.oneOf(actions));

        const replaceActionSpecification = ({ action, initiators, observers, inputs, outputs }: z.infer<typeof parameters>) => {
            const replaced = actionSpecification(action, initiators, observers, inputs, outputs);
            this.actionSpecifications = this.actionSpecifications.map(specification =>
                specification.action === action ? keepComments(specification, replaced) : specification);
            return `Replaced the action specification of '${action}'.`;
        };

        return changeTool(replaceActionSpecification, 'Replace the initiators, observers, inputs and outputs of an action specification.', parameters);
    }

    private deleteActionSpecificationTool(): ControllerTool | undefined {
        const actions = this.actionSpecifications.map(specification => specification.action);
        if (!this.every && actions.length === 0) {
            return undefined;
        }
        const parameters = z.object({ action: this.oneOf(actions) });

        const deleteActionSpecification = ({ action }: z.infer<typeof parameters>) => {
            this.actionSpecifications = this.actionSpecifications.filter(specification => specification.action !== action);
            return `Deleted the action specification of '${action}'${and(this.dropEnabledSpecificationOfGoneAction(action))}.`;
        };

        return changeTool(deleteActionSpecification, "Delete an action specification. An action in no entity's lifecycle is then no "
            + 'action any more, and its enabled specification goes too.', parameters);
    }

    /** The arguments of an action specification: the action is `action` (any name, or one with a specification). */
    private actionSpecificationParameters(action: z.ZodString | ReturnType<typeof oneOf>) {
        const participant = this.oneOf(this.participants());
        return z.object({
            action,
            initiators: z.array(participant).min(1),
            observers: z.array(participant).nullable(),
            inputs: z.array(z.object({ name: z.string(), type: z.enum(SCALAR_TYPES) })).nullable(),
            outputs: z.array(z.object({ name: z.string(), type: z.enum(SCALAR_TYPES) })).nullable()
        });
    }

    // ---------- enabled specifications (texts, by action) ----------

    private createEnabledSpecificationTool(): ControllerTool | undefined {
        const actions = this.actionNames().filter(action => !this.enabledSpecifications.some(specification => specification.action === action));
        if (!this.every && actions.length === 0) {
            return undefined;
        }
        const parameters = z.object({ action: this.oneOf(actions), text: z.string() });

        const createEnabledSpecification = ({ action, text }: z.infer<typeof parameters>) => {
            this.enabledSpecifications.push(new EnabledSpecification(action, keyedText(text, 'enabled', [action])));
            return `Added the enabled specification of '${action}'.`;
        };

        return changeTool(createEnabledSpecification, 'Add the enabled specification of an action: its whole text, "Action <action> is '
            + 'enabled means { … }" (see read_declaration_grammar); at most one per action.', parameters);
    }

    private replaceEnabledSpecificationTool(): ControllerTool | undefined {
        if (!this.every && this.enabledSpecifications.length === 0) {
            return undefined;
        }
        const parameters = z.object({ action: this.oneOf(this.enabledSpecifications.map(specification => specification.action)), text: z.string() });

        const replaceEnabledSpecification = ({ action, text }: z.infer<typeof parameters>) => {
            const replaced = new EnabledSpecification(action, keyedText(text, 'enabled', [action]));
            this.enabledSpecifications = this.enabledSpecifications.map(specification =>
                specification.action === action ? keepComments(specification, replaced) : specification);
            return `Replaced the enabled specification of '${action}'.`;
        };

        return changeTool(replaceEnabledSpecification, 'Replace the whole text of the enabled specification of an action.', parameters);
    }

    private deleteEnabledSpecificationTool(): ControllerTool | undefined {
        if (!this.every && this.enabledSpecifications.length === 0) {
            return undefined;
        }
        const parameters = z.object({ action: this.oneOf(this.enabledSpecifications.map(specification => specification.action)) });

        const deleteEnabledSpecification = ({ action }: z.infer<typeof parameters>) => {
            this.enabledSpecifications = this.enabledSpecifications.filter(specification => specification.action !== action);
            return `Deleted the enabled specification of '${action}'.`;
        };

        return changeTool(deleteEnabledSpecification, 'Delete the enabled specification of an action.', parameters);
    }

    // ---------- state specifications (texts, by entity and state) ----------

    private createStateSpecificationTool(): ControllerTool | undefined {
        const unspecified = this.entities.flatMap(entity => entity.states
            .filter(state => !this.stateSpecifications.some(specification => specification.entity === entity.name && specification.state === state))
            .map(state => ({ entity: entity.name, state })));
        if (!this.every && unspecified.length === 0) {
            return undefined;
        }
        const parameters = z.object({
            entity: this.oneOf(unspecified.map(({ entity }) => entity)),
            state: this.oneOf(unspecified.map(({ state }) => state)),
            text: z.string()
        });

        const createStateSpecification = ({ entity, state, text }: z.infer<typeof parameters>) => {
            if (!this.entity(entity).states.includes(state)) {
                throw new Refusal(`The ${entity} has no state '${state}'.`);
            }
            if (this.stateSpecifications.some(specification => specification.entity === entity && specification.state === state)) {
                throw new Refusal(`'${entity} is ${state}' already has a state specification: use replace_state_specification.`);
            }
            this.stateSpecifications.push(new StateSpecification(entity, state, keyedText(text, 'state', [entity, state])));
            return `Added the state specification '${entity} is ${state}'.`;
        };

        return changeTool(createStateSpecification, 'Add the state specification of a state: its whole text, "Declarative specification '
            + '<Entity> is <state> means { … }" (see read_state_specification_grammar); exactly one per state.', parameters);
    }

    private replaceStateSpecificationTool(): ControllerTool | undefined {
        if (!this.every && this.stateSpecifications.length === 0) {
            return undefined;
        }
        const parameters = z.object({ ...this.stateSpecificationKey(), text: z.string() });

        const replaceStateSpecification = ({ entity, state, text }: z.infer<typeof parameters>) => {
            const old = this.stateSpecification(entity, state);
            const replaced = keepComments(old, new StateSpecification(entity, state, keyedText(text, 'state', [entity, state])));
            this.stateSpecifications = this.stateSpecifications.map(specification => specification === old ? replaced : specification);
            return `Replaced the state specification '${entity} is ${state}'.`;
        };

        return changeTool(replaceStateSpecification, 'Replace the whole text of the state specification of a state.', parameters);
    }

    private deleteStateSpecificationTool(): ControllerTool | undefined {
        if (!this.every && this.stateSpecifications.length === 0) {
            return undefined;
        }
        const parameters = z.object(this.stateSpecificationKey());

        const deleteStateSpecification = ({ entity, state }: z.infer<typeof parameters>) => {
            const removed = this.stateSpecification(entity, state);
            this.stateSpecifications = this.stateSpecifications.filter(specification => specification !== removed);
            return `Deleted the state specification '${entity} is ${state}'.`;
        };

        return changeTool(deleteStateSpecification, 'Delete the state specification of a state.', parameters);
    }

    /** The key of an existing state specification: its entity and its state. */
    private stateSpecificationKey() {
        return {
            entity: this.oneOf(this.stateSpecifications.map(specification => specification.entity)),
            state: this.oneOf(this.stateSpecifications.map(specification => specification.state))
        };
    }

    // ---------- scenarios (texts, by name) ----------

    private createScenarioTool(): ControllerTool {
        const parameters = z.object({ name: z.string(), text: z.string() });

        const createScenario = ({ name, text }: z.infer<typeof parameters>) => {
            if (this.scenarios.some(scenario => scenario.name === name)) {
                throw new Refusal(`There is already a scenario '${name}': use replace_scenario.`);
            }
            this.scenarios.push(new Scenario(name, keyedText(text, 'scenario', [name])));
            return `Added the scenario '${name}'.`;
        };

        return changeTool(createScenario, 'Add a scenario: its whole text, "Scenario: <name> Given … When … Then … ." (see '
            + 'read_scenario_grammar), with a name no other scenario has.', parameters);
    }

    private replaceScenarioTool(): ControllerTool | undefined {
        if (!this.every && this.scenarios.length === 0) {
            return undefined;
        }
        const parameters = z.object({ name: this.oneOf(this.scenarios.map(scenario => scenario.name)), text: z.string() });

        const replaceScenario = ({ name, text }: z.infer<typeof parameters>) => {
            const replaced = new Scenario(name, keyedText(text, 'scenario', [name]));
            this.scenarios = this.scenarios.map(scenario => scenario.name === name ? keepComments(scenario, replaced) : scenario);
            return `Replaced the scenario '${name}'.`;
        };

        return changeTool(replaceScenario, 'Replace the whole text of a scenario; its name stays.', parameters);
    }

    private deleteScenarioTool(): ControllerTool | undefined {
        if (!this.every && this.scenarios.length === 0) {
            return undefined;
        }
        const parameters = z.object({ name: this.oneOf(this.scenarios.map(scenario => scenario.name)) });

        const deleteScenario = ({ name }: z.infer<typeof parameters>) => {
            this.scenarios = this.scenarios.filter(scenario => scenario.name !== name);
            return `Deleted the scenario '${name}'.`;
        };

        return changeTool(deleteScenario, 'Delete a scenario.', parameters);
    }

    // ---------- syntax repair (a broken document only) ----------

    private fixSyntaxTool(): ControllerTool {
        const parameters = z.object({ old_text: z.string(), new_text: z.string() });

        const fixSyntax = ({ old_text, new_text }: z.infer<typeof parameters>) => {
            if (!this.broken) {
                throw new Refusal('The document has no syntax errors any more: use the other tools.');
            }
            const { text } = this.broken;
            const at = old_text === '' ? -1 : text.indexOf(old_text);
            if (at < 0) {
                throw new Refusal('old_text is not in the document: copy it exactly from read_document, without the line numbers.');
            }
            if (text.indexOf(old_text, at + 1) >= 0) {
                throw new Refusal('old_text is in the document more than once: take more of the text around it.');
            }
            const fixed = text.slice(0, at) + new_text + text.slice(at + old_text.length);
            const read = extract(fixed);
            if (read.errors) {
                this.broken = { text: fixed, errors: read.errors };
                return `Replaced it; syntax errors remain:\n${syntaxErrors(read.errors)}`;
            }
            Object.assign(this, read.controller);   // its lists, and broken: undefined
            return 'Replaced it; the syntax is right now. The document is read into the model, and the other tools are back.';
        };

        return changeTool(fixSyntax, 'Fix a syntax error: replace old_text, a piece of the document that appears in it exactly once '
            + '(as read_document shows it, without the line numbers), with new_text. Only while the document has syntax errors.', parameters);
    }

    // ---------- names in the model, and what a deletion takes along ----------

    private entityNames(): string[] {
        return this.entities.map(entity => entity.name);
    }

    /** Who can initiate or observe an action: the roles and the entities. */
    private participants(): string[] {
        return [...this.roles.map(role => role.name), ...this.entityNames()];
    }

    /** Every action: in an entity's lifecycle, or with an action specification. */
    private actionNames(): string[] {
        return unique([...this.entities.flatMap(entity => entity.actions), ...this.actionSpecifications.map(specification => specification.action)]);
    }

    private entity(name: string): Entity {
        const entity = this.entities.find(candidate => candidate.name === name);
        if (!entity) {
            throw new Refusal(`There is no entity '${name}'.`);
        }
        return entity;
    }

    private stateSpecification(entity: string, state: string): StateSpecification {
        const specification = this.stateSpecifications.find(candidate => candidate.entity === entity && candidate.state === state);
        if (!specification) {
            throw new Refusal(`There is no state specification '${entity} is ${state}'.`);
        }
        return specification;
    }

    /** Drops the state specifications of the entity's states (or of one state); says which. */
    private dropStateSpecifications(entity: string, state?: string): string[] {
        const dropped = this.stateSpecifications.filter(specification =>
            specification.entity === entity && (state === undefined || specification.state === state));
        this.stateSpecifications = this.stateSpecifications.filter(specification => !dropped.includes(specification));
        return dropped.map(specification => `the state specification '${entity} is ${specification.state}'`);
    }

    /** Drops the enabled specification of `action` once it is no action any more; says so. */
    private dropEnabledSpecificationOfGoneAction(action: string): string[] {
        if (this.actionNames().includes(action) || !this.enabledSpecifications.some(specification => specification.action === action)) {
            return [];
        }
        this.enabledSpecifications = this.enabledSpecifications.filter(specification => specification.action !== action);
        return [`the enabled specification '${action} is enabled'`];
    }

    /** The action specifications that still name a deleted role or entity, for the LLM to fix. */
    private stillNamed(participant: string): string {
        const naming = this.actionSpecifications.filter(specification =>
            specification.initiators.includes(participant) || specification.observers.includes(participant));
        if (naming.length === 0) {
            return '';
        }
        return ` It is still named in the action specification of ${naming.map(specification => `'${specification.action}'`).join(', ')}: `
            + 'fix them with replace_action_specification.';
    }
}

// ---------------- Writing the model ----------------

/** Entity <name> { … }, each part on its own line; an entity without parts is Entity <name> { }. */
export function entityDsl({ name, actions, dataProperties, states }: Entity): string {
    const parts: string[] = [];
    if (actions.length > 0) {
        parts.push(`Actions: ${actions.join(', ')}`);
    }
    if (dataProperties.length > 0) {
        parts.push(`Data properties: ${dataProperties.map(dataPropertyDsl).join(', ')}`);
    }
    if (states.length > 0) {
        parts.push(`States: ${states.join(', ')}`);
    }
    if (parts.length === 0) {
        return `Entity ${name} { }`;
    }
    return [`Entity ${name} {`, ...parts.map(part => `    ${part}`), '}'].join('\n');
}

/** <name>: <type>, or <name>: a list / a queue, with "of <type>" when it has an element type. */
function dataPropertyDsl({ name, type, elementType }: DataProperty): string {
    if (type !== 'list' && type !== 'queue') {
        return `${name}: ${type}`;
    }
    return elementType ? `${name}: a ${type} of ${elementType}` : `${name}: a ${type}`;
}

export function roleDsl({ name }: Role): string {
    return `Role ${name}.`;
}

/** Action <action> { Initiators: …, Observers: …, Input: …, Output: … }, without the parts it does not have. */
export function actionSpecificationDsl({ action, initiators, observers, inputs, outputs }: ActionSpecification): string {
    const parts = [`Initiators: ${initiators.join(', ')}`];
    if (observers.length > 0) {
        parts.push(`Observers: ${observers.join(', ')}`);
    }
    if (inputs.length > 0) {
        parts.push(`Input: ${inputs.map(({ name, type }) => `${name}: ${type}`).join(', ')}`);
    }
    if (outputs.length > 0) {
        parts.push(`Output: ${outputs.map(({ name, type }) => `${name}: ${type}`).join(', ')}`);
    }
    return `Action ${action} { ${parts.join(', ')} }`;
}

/** A structured element's text: as written while unchanged (the controller would write it as `generated` still). */
function structured(element: { written?: Written }, generated: string): string {
    return element.written?.generated === generated ? element.written.text : generated;
}

/** An element's text with its comments: the lines before it, and the comment after it on its last line. */
function commented({ before, after }: Element, text: string): string {
    return (before ? `${before}\n` : '') + text + (after ? ` ${after}` : '');
}

/** The comments of `from` go to `to`, which replaces it. */
function keepComments<T extends Element>(from: Element, to: T): T {
    to.before = from.before;
    to.after = from.after;
    return to;
}

// ---------------- Making tools ----------------

type Execute<T extends z.ZodObject> = (input: z.infer<T>) => string | Promise<string>;

/** A tool that only reads, named after its function (readDocument: read_document). */
function readTool<T extends z.ZodObject>(execute: Execute<T>, description: string, parameters?: T): ControllerTool {
    return controllerTool('read', execute, description, parameters ?? z.object({}));
}

/** A tool that changes the model, a step of a plan, named after its function (createEntity: create_entity). */
function changeTool<T extends z.ZodObject>(execute: Execute<T>, description: string, parameters: T): ControllerTool {
    return controllerTool('change', execute, description, parameters);
}

function controllerTool<T extends z.ZodObject>(kind: ToolKind, execute: Execute<T>, description: string, parameters: T): ControllerTool {
    return {
        name: snakeCase(execute.name),
        kind,
        description,
        parameters,
        run: async input => execute(parameters.parse(input))
    };
}

/** createEntity: create_entity */
function snakeCase(name: string): string {
    return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// ---------------- Helpers ----------------

/** The lines of `text`, numbered from 1: "  7| …". */
export function numbered(text: string): string {
    const lines = text.split('\n');
    const width = String(lines.length).length;
    return lines.map((line, index) => `${String(index + 1).padStart(width)}| ${line}`).join('\n');
}

/** One syntax error per line: "  4:12: …". */
function syntaxErrors(errors: SyntaxProblem[]): string {
    return errors.map(({ line, column, message }) => `  ${line}:${column}: ${message}`).join('\n');
}

/** One of `names`: the argument can only be a name that exists. */
function oneOf(names: string[]) {
    return z.enum(unique(names) as [string, ...string[]]);
}

function unique(names: string[]): string[] {
    return [...new Set(names)];
}

/** ", and A, B": what a change took along, for its result. */
function and(dropped: string[]): string {
    return dropped.length > 0 ? `, and ${dropped.join(', ')}` : '';
}

/** A name as DSL easy reads one: words of letters, digits and underscores, none of them a keyword. */
function checkName(name: string, what: string): void {
    const read = extract(`Role ${name}.`);
    if (read.errors || read.controller.roles[0]?.name !== name) {
        throw new SyntaxRefusal(`'${name}' cannot be the name of ${what}: use words of letters, digits and underscores, with single spaces `
            + 'between them and no keyword among them (join the words of a name with a keyword with underscores: ready_to_submit).');
    }
}

/**
 * `text` when it is exactly one element of `kind` under `key`, without syntax errors: an enabled specification of
 * the action, a state specification of the entity and state, a scenario of the name.
 */
function keyedText(text: string, kind: 'enabled' | 'state' | 'scenario', key: string[]): string {
    const read = extract(text);
    if (read.errors) {
        throw new SyntaxRefusal(`The text has syntax errors:\n${syntaxErrors(read.errors)}`);
    }
    const { controller } = read;
    const elements = controller.entities.length + controller.roles.length + controller.actionSpecifications.length
        + controller.enabledSpecifications.length + controller.stateSpecifications.length + controller.scenarios.length;
    const keys = {
        enabled: controller.enabledSpecifications.map(({ action }) => [action]),
        state: controller.stateSpecifications.map(({ entity, state }) => [entity, state]),
        scenario: controller.scenarios.map(({ name }) => [name])
    }[kind];
    if (elements !== 1 || keys.length !== 1 || keys[0].join('\n') !== key.join('\n')) {
        const expected = {
            enabled: `Action ${key[0]} is enabled means { … }`,
            state: `Declarative specification ${key[0]} is ${key[1]} means { … }`,
            scenario: `Scenario: ${key[0]} Given … When … Then … .`
        }[kind];
        throw new Refusal(`The text must be exactly one element: "${expected}".`);
    }
    return text.trim();
}

/** An action specification; each of its inputs and outputs has a name of its own, among them all. */
function actionSpecification(action: string, initiators: string[], observers: string[] | null, inputs: ActionParameter[] | null,
    outputs: ActionParameter[] | null): ActionSpecification {
    const specification = new ActionSpecification(action, initiators);
    specification.observers = observers ?? [];
    specification.inputs = inputs ?? [];
    specification.outputs = outputs ?? [];
    const parameters = [...specification.inputs, ...specification.outputs];
    parameters.forEach(({ name }, index) => {
        checkName(name, index < specification.inputs.length ? 'an input' : 'an output');
        if (parameters.findIndex(parameter => parameter.name === name) !== index) {
            throw new Refusal(`'${action}' cannot have two inputs or outputs named '${name}'.`);
        }
    });
    return specification;
}
