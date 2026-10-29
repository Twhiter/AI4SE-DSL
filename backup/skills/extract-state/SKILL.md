---
name: extract-state
description: Rules for the states of an entity (lifecycle stages, statuses, modes), their names, initial states, and completeness against the actions. Use when adding or reviewing states.
---
# States
A state is one value from a finite set of conditions an entity can be in, such as a lifecycle stage, status, or mode (e.g. Account: open, frozen, closed).

Each state consists of:

- **State name:** A concise adjective or participle in plain English, using one form per entity (e.g. open, frozen, closed).
- **Entity:** The entity that can be in the state.

Example
Entity: airplane
States: [flying, taking-off, landing, taxiing, stopped]


Infer an initial or missing state only when the text strongly supports it (e.g. a 'close account' action implies closed).

## Modeling steps:
1. For each entity whose lifecycle, modes, or status changes are described, extract its states. Add an initial state only if strongly supported.
2. check completeness and remove duplicates:
   - For each action that changes an entity's lifecycle, mode, or status, check that the resulting state is extracted. Ignore effects that only change data property values.
   - Infer the missing states which is the effect of the action/event in the text only when strongly supported
   - Do not extract two states of the same entity with the same meaning, even under different names; keep only one.
3. Ensure the state is domain relevant: an important process, event, rule, or scenario of the domain cannot be expressed without it.
