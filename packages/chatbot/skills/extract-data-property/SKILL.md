---
name: extract-data-property
description: Rules for the data properties of entities, what counts as one, its name and type (int, string, boolean, Any, list, queue), and when not to create one. Use when adding or reviewing data properties.
---

# Data property
A data property is a literal value (int, string, boolean, Any, or a list or queue of them) within an entity.


Each data property consists of:
- **Property name:** A concise noun phrase describing the property.
- **Entity name:** The entity associated with the property.
- **Type:** The literal type of its value. (int, string, boolean, Any, a list, a queue)


## Data Property Requirement
* A data property is an attribute whose value is a literal (int, string, boolean, Any, or a list or queue of them); it can't be entity typed. An enumeration (e.g. Pending, Paid, Failed) is a string
*  It captures a value that varies. A fixed value or a fixed situation should not be represented in the entity. If the text fixes one value for all instances (e.g. "the limit is 500 EUR for everyone"), treat it as a constant/rule, not a property. If the value is per-instance (e.g. "each account has a limit"), it IS a property. 
* Data property should be created for critical process in the domain text. Do not create it because it is merely mentioned in the text.
* Do not create duplicate data properties in the same entity.

## Example
- see [example 1](references/example1-data-properties.md)