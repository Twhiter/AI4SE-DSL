---
name: understand-dsl-data
description: Rules for data property and data property assertion and data property assignment. Use when writing or reviewing or unclear about the data property & data assertion and assignment.
---
# DSL Data

## Types
Types supported in the DSL:
* Primitive data types: int, string, boolean
* Non-primitive: Any, can be used for any or unknown or unsupported data types.
* Collection based: list, queue. Optionally, a list or queue can specify its element type with `of` (e.g. `a queue of int`). Without it, its element type is Any.

Every data type has an initial value: for primitive types and Any, it is undefined. For list and queue, its initial value is empty.

## Supported data assertions & assignment
| Type    | Assertions                                                                    | Assignments                                                                |
|---------|-------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| int     | `(not) equal to`, `(not) larger than`, `(not) smaller than`, `is (not) undefined` | `set to`                                                                   |
| string  | `(not) equal to`, `is (not) undefined`                                        | `set to`                                                                   |
| boolean | `(not) equal to`, `is (not) undefined`                                        | `set to`                                                                   |
| Any     | `(not) equal to`, `is (not) undefined`                                        | `set to`                                                                   |
| list    | `is (not) included in`, `is (not) empty`, `is (not) full`                     | `added with` / `added to`, `removed with` / `removed from`, `set to empty` |
| queue   | `is (not) included in`, `is (not) empty`, `is (not) full`                     | `enqueued with`, `dequeued [as <name>]`, `set to empty`                    |

## Example
One example using enqueue and dequeue: In scenario then: `the Printer's waiting jobs is dequeued as current job AND the Printer's printing jobs is enqueued with current job.`.

## Notes
* If a property is asserted as undefined, ensure not to access its value (e.g., assert it with other defined values or variables or append it into a collection). Otherwise an error will be thrown. However, an undefined property can be assigned, by setting a value.
* Do not have mismatched type operations (e.g., insert an int into a string queue).
