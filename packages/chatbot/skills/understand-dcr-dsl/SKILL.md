---
name: understand-dcr-dsl
description: Rules for executed, enabled, pending, available and their corresponding DCR meaning and how to tell them apart. Use when unsure what executed, enabled, pending or available mean in a Given, a Then or a state specification.
---
# DCR DSL

In DSL, there are several ways to express whether some activities are in the marking or not:

## DCR expression in Given & state specifications
* `<action> is available` means `<action>` is in the marking set *In*. If it is negated (not available), it asserts `<action>` is not in the marking set *In*
* `<action> is (not) pending` indicates the `<action>` is in the marking set *Re* or not.

## DCR expression in Then
* `<action> is available` means the action in the When includes `<action>`. If it is negated (not available), it indicates an exclude relation.
* `<action> is pending` indicates the action responses `<action>`.
