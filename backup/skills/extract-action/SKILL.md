---
name: extract-action
description: Rules for actions, their names, initiators and observers, the entity lifecycle they belong to, and their inputs. Use when adding or reviewing actions or an Action specification.
---
## Actions
An action is something a role or entity does at a specific moment that affects or is observed by another role or entity (e.g. Customer inserts Card to ATM)

Each action consists of:
- **Action name:** A concise verb phrase in normal English, including the object if needed (e.g. insert Card, dispense Cash).
- **Initiators:** The role or entity that performs the action. Can't be Empty
- **observers:** The role or entity that receives or reacts to the action.  can be empty if not specified.
- If the action is dependent on the lifecycle of an entity, place it on the entity as well. (e.g. Pay money is depend on the card's lifecycle)
- **Inputs**: Optional. Each input has a name and a type, in order, e.g. Login takes `username: string, password: string`. A scenario's When gives the values in the same order.

## Modeling steps
1. Identify whether it refers to a specific process, event, or action that occurs. Ignore static descriptions and persistent relationships; these are data or object properties (e.g. Customer owns Account), not actions.
   * Prefer the most specific, concrete, and explicitly stated action. Avoid broad or generic actions when the context provides a more precise action describing the actual behavior, event, output, or state change. Do not extract generic, underspecified, or umbrella actions when their meaning depends on a more specific action stated in the text. Avoid vague or generic verbs such as ‘operate’, ‘handle’, ‘manage’, or ‘control’ when the text provides a more precise action
2. Determine the role or entity that performs it. If the text doesn't state it, infer it only if strongly supported; otherwise drop the action.
3. Determine whether another allowed participant receives, observes, experiences, or reacts to that action.
4. Verify that both participants are contained in the allowed role or entity list. 
5. Check whether the same action has already been extracted. 
6. Ensure the action name is in active voice
7. Ensure the action is domain relevant: The action is domain relevant: an important process, event, rule, or scenario of the domain cannot be expressed without it. 
8. Review the complete set of actions against the context before answering.