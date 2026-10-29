# Background knowledge


## DCR Graph
DCR graph consists of two elements: Activity (action) and relation

Each activity can have a relation to another activity. 
There are five types of relations in DCR graph:
* **Include**: indicates making the target activity relevant
* **Exclude**: indicates making the target activity irrelevant
* **Response**: indicates an obligation(pending) that the target will happen if it is relevant
* **Milestone**: If the source is pending and relevant, the target is blocked (not enabled for execution). 
* **Condition**: If the source was not executed and relevant, the target is blocked (not enabled for execution).

### DCR Graph execution & Marking
Like Petri net, DCR graph execution is equipped with a marking *(In, Ex, Re)*, *In* denotes the set of activities that are currently included, *Ex* denotes the set of activities executed so far, and *Re* is the set of activities that are pending.

Assume an enabled activity *A* in marking *(In, Ex, Re)*, after *A* is executed, the marking changes:
* *In* removes what *A* excludes and adds what *A* includes
* *Ex* adds *A*
* *Re* removes *A* (if *A* is pending), and adds what *A* responds to.

Moreover, every relation can add guards (i.e., data expression): If the guard is evaluated as True, the relation will take effect.

### Enabledness of an action
An action is enabled iff its milestones are not blocking, its conditions are not blocking and it is currently included.

## DSL

### Entity
A data container with data properties, states, and actions that depend on its lifecycle.

### Role
An actor in the domain (a human, organization or system), taken as a whole, without instances. E.g. Customer, Bank.


### Actions
Something a role or entity does at a specific moment that affects or is observed by another role or entity (e.g. Customer inserts Card to ATM). It has a name (a verb phrase), initiators, observers, and optionally inputs and outputs (each a name and a type). An action that depends on an entity's lifecycle is placed on that entity.

For how to identify and model actions, load the `extract-action` skill.

### State
A named situation an entity can be in, such as a lifecycle stage, status or mode (e.g. Account: open, frozen, closed). An entity can be in more than one state at once. What a state means is given by its state specification.

For how to identify and name states, load the `extract-state` skill; for what they mean, `extract-state-specification`.

### Data property
A value an entity holds that changes during the process. Its type is int, string, boolean, Any, or a list or queue of them, never an entity. E.g. Account: balance: int.

For when to create one, load the `extract-data-property` skill.

### Enabledness
An action's enabled specification lists what it needs to be enabled: DCR conditions  and DCR milestones joined by AND.

For how to write one, load the `extract-enableness` skill.

### State specification
`Declarative specification <Entity> is <state> means { … }` lists conditions, joined by AND, that hold whenever the entity is in that state, however it got there: executed, enabled, pending, available, data assertions, and other states.

For how to write one, load the `extract-state-specification` skill.

### Scenario
`Scenario: <name> Given … When <action> is executed … Then … .`: the situation before (Given), exactly one action with its inputs and outputs (When), and its effects (Then). One instance per entity.

For how to write one, load the `extract-scenario` skill.
