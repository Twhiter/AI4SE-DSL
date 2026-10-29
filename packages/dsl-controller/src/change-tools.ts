// Every change tool, with its arguments and what it does, for the chatbot's planning agent's prompt ({change_tools} in
// packages/chatbot/prompt/planning_agent.md), or for any LLM that plans several changes at once. The controller offers
// a change tool only while the document has what the tool works on (an entity, a state, an action, …), so its tools
// alone would not tell the planner about the tools that an earlier step of a plan makes available. This list does;
// the simulation runs each step with the tools the controller offers at that point, and refuses a wrong one.
// The list is written here by hand, in step with the controller's tools (controller.ts): changeToolList stops the
// turn when the controller offers a change tool that is not here, or with other arguments.

import type { ToolDescription } from './controller.ts';

export interface ChangeTool {
    name: string;
    /** Each argument, with what it takes. */
    arguments: Record<string, string>;
    description: string;
}

const SCALAR_TYPE = '"int" | "string" | "boolean" | "Any"';
const PARTICIPANT = 'a role or an entity';
const PARAMETERS = `[{"name": a name, "type": ${SCALAR_TYPE}}, …] | null`;

export const CHANGE_TOOLS: ChangeTool[] = [
    {
        name: 'create_entity',
        arguments: { name: 'a new name' },
        description: 'Add an entity, with a name no entity or role has.'
    },
    {
        name: 'delete_entity',
        arguments: { entity: 'an entity' },
        description: 'Delete an entity with its data properties, states and actions; the state specifications of its states go too.'
    },
    {
        name: 'create_data_property',
        arguments: {
            entity: 'an entity',
            name: 'a name new in that entity',
            type: `${SCALAR_TYPE} | "list" | "queue"`,
            element_type: `${SCALAR_TYPE} | null`
        },
        description: 'Add a data property to an entity. A list or queue may give the type of its elements (element_type); '
            + 'without one it holds Any. element_type is null for the other types.'
    },
    {
        name: 'delete_data_property',
        arguments: { entity: 'an entity', property: 'a data property of that entity' },
        description: 'Delete a data property of an entity.'
    },
    {
        name: 'create_state',
        arguments: { entity: 'an entity', name: 'a name new in that entity' },
        description: 'Add a state to an entity. Its state specification can come later; a scenario or another state specification can use the state only once it has one.'
    },
    {
        name: 'delete_state',
        arguments: { entity: 'an entity', state: 'a state of that entity' },
        description: 'Delete a state of an entity, with its state specification.'
    },
    {
        name: 'add_entity_action',
        arguments: { entity: 'an entity', action: 'an action in no entity\'s lifecycle' },
        description: 'Add an action to an entity\'s lifecycle; an action is in at most one entity\'s lifecycle.'
    },
    {
        name: 'remove_entity_action',
        arguments: { entity: 'an entity', action: 'an action of that entity' },
        description: 'Remove an action from an entity\'s lifecycle. Without an action specification it is no action any more, '
            + 'and its enabled specification goes too.'
    },
    {
        name: 'create_role',
        arguments: { name: 'a new name' },
        description: 'Add a role, with a name no role or entity has.'
    },
    {
        name: 'delete_role',
        arguments: { role: 'a role' },
        description: 'Delete a role.'
    },
    {
        name: 'create_action_specification',
        arguments: {
            action: 'an action without an action specification',
            initiators: `[${PARTICIPANT}, …], at least one`,
            observers: `[${PARTICIPANT}, …] | null`,
            inputs: PARAMETERS,
            outputs: PARAMETERS
        },
        description: 'Say who initiates an action, who observes it (null for no one), its inputs (the values it takes from outside '
            + 'when executed) and its outputs (the values an external procedure gives back), each with a name and a type (null for '
            + 'none; no two with the same name); a When names them to give their values. For an action of an entity\'s lifecycle, '
            + 'or a new action that relies on no entity.'
    },
    {
        name: 'replace_action_specification',
        arguments: {
            action: 'an action with an action specification',
            initiators: `[${PARTICIPANT}, …], at least one`,
            observers: `[${PARTICIPANT}, …] | null`,
            inputs: PARAMETERS,
            outputs: PARAMETERS
        },
        description: 'Replace the initiators, observers, inputs and outputs of an action specification.'
    },
    {
        name: 'delete_action_specification',
        arguments: { action: 'an action with an action specification' },
        description: 'Delete an action specification. An action in no entity\'s lifecycle is then no action any more, and its '
            + 'enabled specification goes too.'
    },
    {
        name: 'create_enabled_specification',
        arguments: { action: 'an action without an enabled specification', text: 'its whole text' },
        description: 'Add the enabled specification of an action: "Action <action> is enabled means { … }" (see '
            + 'read_declaration_grammar); at most one per action.'
    },
    {
        name: 'replace_enabled_specification',
        arguments: { action: 'an action with an enabled specification', text: 'its whole text' },
        description: 'Replace the whole text of the enabled specification of an action.'
    },
    {
        name: 'delete_enabled_specification',
        arguments: { action: 'an action with an enabled specification' },
        description: 'Delete the enabled specification of an action.'
    },
    {
        name: 'create_state_specification',
        arguments: { entity: 'an entity', state: 'a state of that entity without a state specification', text: 'its whole text' },
        description: 'Add the state specification of a state: "Declarative specification <Entity> is <state> means { … }" '
            + '(see read_state_specification_grammar); exactly one per state.'
    },
    {
        name: 'replace_state_specification',
        arguments: { entity: 'an entity', state: 'a state of that entity with a state specification', text: 'its whole text' },
        description: 'Replace the whole text of the state specification of a state.'
    },
    {
        name: 'delete_state_specification',
        arguments: { entity: 'an entity', state: 'a state of that entity with a state specification' },
        description: 'Delete the state specification of a state.'
    },
    {
        name: 'create_scenario',
        arguments: { name: 'a new scenario name', text: 'its whole text' },
        description: 'Add a scenario: "Scenario: <name> Given … When … Then … ." (see read_scenario_grammar).'
    },
    {
        name: 'replace_scenario',
        arguments: { name: 'a scenario', text: 'its whole text' },
        description: 'Replace the whole text of a scenario; its name stays.'
    },
    {
        name: 'delete_scenario',
        arguments: { name: 'a scenario' },
        description: 'Delete a scenario.'
    },
    {
        name: 'fix_syntax',
        arguments: { old_text: 'a piece of the document that appears in it exactly once', new_text: 'what replaces it' },
        description: 'Fix a syntax error: replace old_text (as read_document shows it, without the line numbers) with new_text. '
            + 'Only while the document has syntax errors; then it is the only change tool.'
    }
];

/**
 * The list for the planning agent, one tool per line: "- create_state(entity: an entity, name: …): Add a state …".
 * First it checks the list against the change tools the controller offers now (`offered`).
 */
export function changeToolList(offered: ToolDescription[]): string {
    for (const { name, parameters } of offered) {
        const listed = CHANGE_TOOLS.find(changeTool => changeTool.name === name);
        const offeredArguments = Object.keys(parameters.shape).sort().join(', ');
        if (!listed) {
            throw new Error(`change-tools.ts does not list the change tool ${name}.`);
        }
        const listedArguments = Object.keys(listed.arguments).sort().join(', ');
        if (listedArguments !== offeredArguments) {
            throw new Error(`change-tools.ts gives ${name} the arguments ${listedArguments}, the controller ${offeredArguments}.`);
        }
    }
    return CHANGE_TOOLS.map(({ name, arguments: taken, description }) =>
        `- ${name}(${Object.entries(taken).map(([argument, what]) => `${argument}: ${what}`).join(', ')}): ${description}`).join('\n');
}
