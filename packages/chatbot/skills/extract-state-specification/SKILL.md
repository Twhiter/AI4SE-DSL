---
name: extract-state-specification
description: Rules for state specifications (Declarative specification Entity is state means ...), the conditions a state requires (executed, enabled, pending, available, data assertions, other states) and how to tell them apart. Use when writing or reviewing what a state means.
---
# State Specification
A state specification defines a state.
A state specification consists of the following, which can be connected with AND:

1. **Executed / Not Executed**
2. **Next Executable (a.k.a. Enabled)**
3. **Pending / Not Pending** (a.k.a. Must / Not Must)
4. **Available / Not Available** (a.k.a. Relevant / Irrelevant)
5. **Data Assertions**
6. **State Assertion**


* For what the action conditions mean, load the `understand-dcr-dsl` skill.

* For data assertions, load the `understand-dsl-data` skill.

## Modelling Notes
* Include every condition the text implies for this state, and nothing it does not
* Ensure the actions referred to lie within the same lifecycle of the entity or from a global lifecycle-free action
* Ensure the states and data properties asserted are within the entity's lifecycle.


## How to write a state specification
````text
state_specification: "Declarative" "specification" <entity> is <state name> "means" "{" condition ("AND" condition)* "}"

condition: action "was" ["not"] "executed"
    | action "is" ["not"] ("pending" | "available")
    | action "is" "enabled"
    | "it" "is" <state>
    | <property> ["not"] ("equal to" | "larger than" | "smaller than") <value>
    | <value> "is" ["not"] "included in" <property>
    | <property> "is" ["not"] ("empty" | "full" | "undefined")

<property>: "its" name | "the" name | "the" <Entity>"'s" name
````
Which operations each type allows is in the `understand-dsl-data` skill. For the full grammar, call `read_state_specification_grammar`.

## Examples
- see [example 1](references/example1-state-specification.md)