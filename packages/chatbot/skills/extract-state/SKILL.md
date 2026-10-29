---
name: extract-state
description: Rules for the states of an entity (lifecycle stages, statuses, modes), their names, and which states to model. Use when adding, deleting or reviewing states.
---
# States
A state is a named situation an entity can be in, such as a lifecycle stage, status, or mode (e.g. Account: open, frozen, closed).

Each state consists of:

- **State name:** A concise adjective or participle in plain English, using one form per entity (e.g. open, frozen, closed).
- **Entity:** The entity that can be in the state.

Example
Entity: airplane
States: [flying, taking_off, landing, taxiing, stopped]


## Notes
- States might not be exclusive to each other.- Build the states that are meaningful for domain modelling. Do not build states that are never engaged in the critical process of the system.

## Examples
- [example 1](references/example1-states.md)
