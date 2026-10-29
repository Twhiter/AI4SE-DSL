---
name: extract-action
description: Rules for actions, their names, initiators and observers, the entity lifecycle they belong to, and their inputs and outputs. Use when adding or reviewing actions or an Action specification.
---
# Actions
An action is something a role or entity does at a specific moment that affects or is observed by another role or entity (e.g. Customer inserts Card to ATM)

Each action consists of:
- **Action name:** A concise verb phrase in normal English, including the object if needed (e.g. insert Card, dispense Cash).
- **Initiators:** The roles or entities that perform the action. Can't be empty.
- **Observers:** The roles or entities that receive or react to the action. Can be empty if not specified.
- If the action is dependent on the lifecycle of an entity, place it on the entity as well. (e.g. pay money depends on the card's lifecycle)
- **Inputs**: Optional. Each input has a name and a type, e.g. Login takes `username: string, password: string`; a When gives each value by name: `username = "ann"`. It denotes the action is an input action that takes inputs from the external environment (e.g., the user input). Instead if the required input is from the entity's data properties, this should not be an input.
- **Outputs**: Optional. Each output has a name and a type, e.g. Login outputs `status: boolean`. Output means the action is a computation activity, which will call an external procedure to return a value. If the output value is not from the external environment (e.g., the entity's properties), it should not be modelled as an output.

## Modelling requirement
* The action should be a specific process or event. If there are more specific actions, model the more specific ones. (e.g., the end user made a decision, either to approve it or not), here made a decision should be replaced by approve and disapprove.
* Avoid hat actions and broad generic actions: the user controls the cooling temperature, ...., either raise or drop it. Here **controls the cooling temperature** is a hat action and should be avoided
* Avoid actions that are not critical in the domain workflow
* Determine the correct initiator (who triggers the action) and observer (who receives the action)
* Ensure there is no duplicate action depicting the same process
* Ensure to place it in the entity, if the action depends on lifecycle of entity's instance.
* Ensure the entities and roles are already defined.

## Example
- see [example 1](references/example1-extract-action.md)