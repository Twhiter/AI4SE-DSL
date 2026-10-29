---
name: extract-scenario
description: Rules for BDD scenarios (Scenario, Given, When, Then), what each part may say, and what the action conditions in them mean. Use when writing or reviewing scenarios.
---
# Scenario DSL

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


## When

`When` contains exactly one action execution:

```text
<action> is executed with inputs <named arguments>, outputs <named argument> (AND  <data assertion>)*
```


```text
<name argument> can be specific argument with values, e.g., arg1=value
or unspecific arg1
And <data assertion> can assert the entity's data and the args
```

## Then

`Then` describes the consequences of executing the `When` action.

A Then condition can be:

- data property assignment
- what becomes relevant (a.k.a. available)
- what becomes irrelevant (a.k.a. not available)
- what becomes pending


## Notes
* Assume there is at most one instance of entity in the scenario. (always access via  `the Entity name`)
* Mentioning an `action` of an entity implies the entity instance in the scenario.
* The data assertions in when becomes the guard of the activity in dcr graph.
* Ensure the Given & data assertion in when is consistent:
  * No contradiction of dcr marking assertions (e.g., action is both available and not available)
  * No data assertion contradiction
* Ensure the data assignment and actions in Then consistent (e.g., a can not be set to 1 while set to 2, ...etc)

For what the action conditions mean, load the `understand-dcr-dsl` skill; for data assertions and assignments, `understand-dsl-data`.




## Grammar Overview
```text
Scenario: <name>
Given <given> (AND <given>)*
When <action> is executed [with inputs <arg> (, <arg>)*] [, outputs <arg> (, <arg>)*] (AND <data assertion>)*
     (with no inputs: When <action> is executed with outputs <arg> (, <arg>)* …)
<arg>: name | name = <value> | name = the <Entity>'s <property>

Then <then spec> (AND <then spec>)* .

<given>:  the <Entity> is <state>
        | <action> was [not] executed
        | <action> is [not] (pending | available)
        | <action> is enabled
        | <data assertion>

<then spec>: <action> is pending
        | <action> is [not] available
        | <data assignment>
```
For the full grammar, call `read_scenario_grammar`.

## Example
- see [example 1](references/example1-extract-scenario.md)