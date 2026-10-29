---
name: extract-data-property
description: Rules for the data properties of entities, what counts as one, its name and type (int, string, boolean, Any, list, queue), and when not to create one. Use when adding or reviewing data properties.
---
## Data property
* A data property is an attribute whose value is a primitive literal (string, number, boolean, date/time, or an enumeration or collections of them (list, set ...etc) from the text)

Each data property consists of:
- **Property name:** A concise noun phrase describing the property.
- **Entity name:** The entity associated with the property.
- **Type:** The literal type of its value. (int, string, bool, Any, queue, list)
## Requirements
A valid data property must hold all the following criteria:
* A data property is an attribute whose value is a literal (string, number, boolean, or an enumeration or collections of them (list, queue ...etc) from the text), it can't be entity typed 
* It describes the entity itself; it does not encode a relationship (e.g. an ID of another entity), state, or business rule.
* Data property must capture variant value, therefore, it must not be built for static / fixed situations. Do not create a data property for a value that is fixed by the domain text. 
  * different instances could have different values. If the text fixes one value for all instances (e.g. "the limit is 500 EUR for everyone"), treat it as a constant/rule, not a property. If the value is per-instance (e.g. "each account has a limit"), it IS a property. 
* Data property must be relevant to the domain. If a certain domain-relevant process, event, rule, or scenario cannot be expressed without it, it is relevant. If removing it would not affect how any important process, event, rule, or scenario of the domain is described, it is not relevant and must not be extracted.
* Data property should be from the text, do not assume data properties that can't be strongly supported from the domain text

## Modeling steps
1. First, propose all data property candidates from the text as (entity name, property name, type).
2. For each candidate, keep it only if it passes every check below; otherwise, drop it:
   - It is strongly supported by the text.
   - Its entity is one of the existing entities.
   - It satisfies all the criteria in Requirements.
   - It does not duplicate another data property of the same entity (same meaning, even under a different name).