---
name: extract-role-entity
description: Rules for deciding which domain concepts are entities and which are roles, and for merging duplicates. Use when adding, renaming or reviewing entities or roles, or when unsure whether something is an entity, a role, or neither.
---
## Entity
An entity must satisfy all of the following:
* The entity is domain relevant: an important process, event, rule, or scenario of the domain cannot be expressed without it.
* Multiple distinguishable instances of its type can exist.
* Its instances have an independent identity in the domain and can be associated with properties, relationships, states, lifecycle information, or behavior.

## Role
* It is an actor in the domain: a human, organization, or system that performs or receives actions needed to carry out an important process or scenario of the domain, described at a high level of abstraction (e.g. Customer, Bank, Payment System). Internal parts of an actor are not roles (e.g. the ATM's card reader).
* Have actions
* Do not have data properties, object properties and states

## Requirements
1. Refer to the text as a heuristic for entity and role candidates.
2. Do not extract duplicates of entities and roles. Merge synonyms and inflected forms (e.g. plurals, abbreviations, case variants) into one candidate, keeping the singular name used most often in the text.
3. Strictly follow the Entity and Role definitions above: extract a candidate only if it satisfies every criterion of the corresponding definition; otherwise, do not extract it.