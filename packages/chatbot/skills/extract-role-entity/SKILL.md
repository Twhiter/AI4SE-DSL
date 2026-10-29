---
name: extract-role-entity
description: Rules for deciding which domain concepts are entities and which are roles, and for merging duplicates. Use when adding, deleting, renaming or reviewing entities or roles, or when unsure whether something is an entity, a role, or neither.
---

# Entity & Role


## Entity
An entity is a data container that can consist of:
* data properties: the necessary data that reflect the transition of the process.
* states: a shorthand to describe a situation the entity is in. It can be defined using the assertions of actions and data properties (see state specification skills)
* actions: every action defined in the entity depends on the entity's lifecycle: when the action is triggered, one instance must be specified.


## Role
* It is an actor in the domain: a human, organization, or system. It is considered as a whole, and is not necessary to distinguish instances of it. (e.g. Customer, Bank, Payment System)

## Modelling rules
* The roles and entities are from the domain text or can be constructed from it. The roles and entities are critical ones engaged in the process workflow.
* Merge synonyms and inflected forms (e.g. plurals, abbreviations, case variants) into one candidate, keeping the singular name used most often in the text.

## Examples
- see [printer example](references/printer-entities-roles.md)

The example is for reference only.