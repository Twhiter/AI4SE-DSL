---
name: extract-scenario
description: Rules for BDD scenarios (Scenario, Given, When, Then), what each part may say, and what the action conditions in them mean. Use when writing or reviewing scenarios.
---
## Scenario DSL

Each scenario has the following form:

```text
Scenario: <scenario name>
Given
  <one or more conditions>
When
  <exactly one action execution>
Then
  <one or more consequences>
```

## Given

`Given` describes the situation before the action is executed.

A Given condition can be:

- state assertion
- data property assertion
- (not) executed
- enabledness
- relevant / irrelevant (a.k.a. (not) available)
- (not) pending

A state assertion has the form:

```text
<Entity> is <state>
```

A data property assertion may refer to:
```text
<Entity>'s <data property> <data property assertion>
```

* Typed comparisons such as `=`, `!=`, `<`, `<=`, `>`, and `>=` may be used when valid for the property's type. 
* For collections, assertions regarding whether it's empty or full can be used.


## When

`When` contains exactly one action execution:

```text
<action> is executed
```

## Then

`Then` describes the consequences of executing the `When` action.

A Then condition can be:

- data property assignment
- what becomes relevant (a.k.a. available)
- what becomes irrelevant (a.k.a. not available)
- what becomes pending or non-pending

A data property/object property assignment has the form:

```text
<Entity>'s <data property> = <value>
List typed: <Entity>'s <data property> is added with / removed with
Queue typed: <Entity>'s <data property> is enqueued with / dequeued with
```

## Meaning of Action Conditions

Every action condition must include the action's subject.

### Executed

```text
<action> was executed
```

The action has already happened before the that step.

### Not Executed

```text
<action> was not executed
```

The action has not happened yet.

Do not infer this merely because an action is absent from the description.

### Enabled

```text
<action> is enabled
```
The action is executable in the that situation.


### Relevant

```text
<action> is available
```
The action is relevant in the condition

### Not Executable

```text
<action> is not available
```
The action is non relevant in the condition

### Eventually
```text
<action> is pending
```

The action is a **pending promised action** that is expected to occur under the normal workflow from the that situation.

`Eventually` does not mean merely that an action may happen at some later point.

Do not propagate future actions backward through intermediate actions, states, branches, or additional conditions.

### Eventually Not

```text
<action> is not pending
```

The action is guaranteed not to occur under the normal workflow from the that situation.

Use this only when that guarantee is sufficiently established.

## Grammar Overview
```text
scenario_definition:  "Scenario:" SCENARIO_NAME given_section when_section then_section

given_section: "Given:" given_spec ("AND" given_spec )*
when_section: "When:" when_spec 
then_section: "Then:" then_spec ("AND" then_spec)* 

given_spec: entity_state
           | data_property_assertion
           | response_description
           | inclusion_description
           | execution_description
           | enabledness_description

then_spec: data_property_assignment
          | action "is" "pending"
          | inclusion_description


data_property_assertion: data_property data_assertion_expression

execution_description: action "was" "executed"
    | action "was" "not" "executed"

response_description: action "is" "pending"
    | action "is" "not" "pending"

inclusion_description: action "is" "available"
    | action "is" "not" "available"

when_spec: action "is" "executed"
....
```
For more detail of the grammar, use the tool to check.


