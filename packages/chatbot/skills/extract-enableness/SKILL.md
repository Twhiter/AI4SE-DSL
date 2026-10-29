---
name: extract-enableness
description: Rules for the enabled specification of an action, its conditions (a was executed or is not available) and milestones (a is not pending or is not available), and which actions it may use. Use when writing or reviewing when an action is enabled.
---
# Action enabledness

An enabled specification says the condition for an action to be enabled. It consists of several DCR conditions and milestones.

- **Condition** `<a, condition, b>`: b is enabled only if a was executed, or a is not included (not relevant) at the
  current step.
- **Milestone** `<a, milestone, b>`: b is enabled only if a is not pending, or a is not included at the current step.


## Illustration
- **`<a, condition, b>`** means a dependent execution order relation whenever a is relevant.
- **`<a, milestone, b>`** denotes the blocking relation: if a is pending and relevant, action b is not enabled.



## Grammar
```text
Action <b> is enabled means {
    <requirement> (AND <requirement>)*
}

<requirement>: <condition> | <milestone>
<condition>:   <a> was executed or is not available
<milestone>:   <a> is not pending or is not available
```

Example:
```text
Action print is enabled means {
    start was executed or is not available
    AND reboot is not pending or is not available
}
```

## Which actions a specification can use
Every action `<a>` in the specification of `<b>` must be reachable from `<b>`:
- If `<b>` is in an entity's lifecycle (listed under `Actions:` in an `Entity` block), it can use the actions of that
  same entity, and the actions that belong to no entity.
- If `<b>` belongs to no entity (declared only with `Action <b> { … }`), it can use only the actions that belong to no
  entity.