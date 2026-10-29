---
name: extract-state-specification
description: Rules for state specifications (Declarative specification Entity is state means ...), the conditions a state requires (executed, enabled, pending, available, data assertions, other states) and how to tell them apart. Use when writing or reviewing what a state means.
---
## Specification
A state specification lists the necessary conditions of a state: every condition must hold whenever the entity is in this state, regardless of how it reached the state. The conditions are combined with AND

A state specification consists of the followings:

1. **Executed / Not Executed**

* Executed: on every path to this state, the action has happened at least once on this entity. 
* Not executed: on every path to this state, it has never happened.

2. **Next Executable (a.k.a. Enabled)**

Actions that can be executed at the immediate next step from this state.

3. **Eventually / Eventually Not** (a.k.a. Pendingness)**
* Pending: the action occurs on every normal-workflow path from this state.
* A pending action must be eventually executed or becomes irrelevant.

4. **Relevant / Irrelevant** (a.k.a Availability)
* The action is relevant/Irrelevant in this state.

5. **Data Assertions**
- Data-property value assertion that hold in this state.
- For data properties, support typed comparison and expressions where applicable, such as equality, inequality, bounds, and other valid predicates.
- For collection properties, assertion whether it's empty or full can be used.

6. **State assertion**
- state assertion denotes the entity is also in another state.

The state specification can only use the actions, properties and states of its own or the action that requires no lifecycle (i.e., not appearing in any entity definitions).

## Interpretation Rules
Distinguish carefully between:

- **executed**: the action has already happened,
- **not executed**: the action has not yet happened,
- **next executable**: the action can be performed immediately from the current state,
- **eventual**: the action is pending and promised to occur under the normal workflow,
- **eventually not**: the action is guaranteed not to occur under the normal workflow from the current state,
- **Relevant / Irrelevant**: the action is relevant in this state. It might be executable. Irrelevant means the action is not possible in this state.
- **possible later**: the action may occur later but depends on intermediate states; do not classify it as eventual.

An action may appear in more than one category when justified. In particular, an action may be both `next executable` and `eventual` if it is immediately enabled and also pending as part of the normal workflow.

## Requirement
- When proposing state specifications, ensure to make the action specifications comprehensive. For actions that is not certain to be specified (e.g., when the printer is printing, whether the action submit is available is not certain), do not specify them.
- Do not propagate future actions backward through intermediate states unless the current state itself establishes them as pending promised events.
- State specification can only refer to its actions and properties of the same entity or the action that requires no lifecycle (i.e., not appearing in any entity definitions).


## Grammar Overview
````text
state_specification: "Declaraive" "specification" <entity> is <state name> "means" "{{" condition ("AND" condition)* "}}"

condition: data_property_assertion
    | execution_description
    | response_description
    | inclusion_description
    | enabledness_description


data_property_assertion: data_property data_assertion_expression

execution_description: action "was" "executed"
    | action "was" "not" "executed"

response_description: action "is" "pending"
    | action "is" "not" "pending"

inclusion_description: action "is" "available"
    | action "is" "not" "available"

enabledness_description: action "is" "enabled"
......
````
For more details of the grammar, use the tool to check.