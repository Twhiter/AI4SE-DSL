grammar Easy

entry Model:
    elements+=Element*;

Element:
    Entity | Role | ActionElement | DeclarativeSpec | Scenario;

// ---------------- Declarations ----------------

// The three parts are optional and can come in any order (the validator reports a part written twice).
Entity:
    'Entity' name=Name '{'
        ( 'Actions' ':' actions+=LifecycleAction (',' actions+=LifecycleAction)*    // the actions in this entity's lifecycle
        | 'Data' 'properties' ':' dataProperties+=DataProperty (',' dataProperties+=DataProperty)*
        | 'States' ':' states+=State (',' states+=State)* )*
    '}';

LifecycleAction: name=Name;
State:           name=Name;

// speed: int, label: string, ready: boolean, jobs: a list, waiting: a queue
// A list or a queue is untyped: it can hold any values, also mixed.
// speed: int, label: Any, jobs: a list, waiting jobs: a queue of string (a list or queue without 'of' holds Any)
DataProperty: name=Name ':' (type=ScalarType | 'a' type=('list' | 'queue') ('of' elementType=ScalarType)?);

// Any is any value: an int, a string or a boolean
ScalarType returns string: 'int' | 'string' | 'boolean' | 'Any';

Role:
    'Role' name=Name '.';

// Who initiates an action, optionally who observes it, its inputs, if it takes any, and what it gives back (its
// outputs), if anything, each with a name and a type:
//   Action print { Initiators: Operator, Observers: Printer, Input: file: string, copies: int, Output: printed: boolean }
// A When names them: When print is executed with inputs file = "a.pdf", copies = 2, outputs printed = true
// For an action an entity lists under 'Actions:' this only adds its initiators and observers (without it,
// the entity's action gets a warning). Any other name declares an action that relies on no entity.
// Action print { … } or Action print is enabled means { … } (below): 'Action' is read once, and what follows the name
// decides which, so a broken one is reported as such and the parser goes on after it
ActionElement:
    'Action' (ActionParticipants | EnabledSpec);

ActionParticipants:
    name=Name '{'
        'Initiators' ':' initiators+=[Participant:Name] (',' initiators+=[Participant:Name])*
        (','? 'Observers' ':' observers+=[Participant:Name] (',' observers+=[Participant:Name])*)?
        (','? 'Input' ':' inputs+=ActionInput (',' inputs+=ActionInput)*)?
        (','? 'Output' ':' outputs+=ActionOutput (',' outputs+=ActionOutput)*)?
    '}';

// file: string - the name says what the input is; a When gives its value by this name
ActionInput: name=Name ':' type=ScalarType;

// is_adult: boolean - a value the action gives back when it is executed
ActionOutput: name=Name ':' type=ScalarType;

type Participant = Role | Entity;

// An action: one of an entity's lifecycle actions, or an action that relies on no entity
type Action = LifecycleAction | ActionParticipants;

// ---------------- Specifications ----------------
// A Declarative specification is about one entity, implicit in its conditions: the specified entity. Only actions in
// its lifecycle, or in none, can be used.
//   its <property> / the <property> / the <Entity>'s <property>   one of its data properties
//   it is <state>                                                  one of its states
// An enabled specification says what an action needs to be enabled; it uses only actions in that action's lifecycle,
// or in none. 'enabled' is a condition only in a Declarative specification or a Given, and without 'not': print is enabled.

DeclarativeSpec:
    'Declarative' 'specification' entity=[Entity:Name] 'is' state=[State:Name] 'means'
    '{' conditions+=SpecCondition ('AND' conditions+=SpecCondition)* '}';

// Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available }
EnabledSpec:
    action=[Action:Name] 'is' 'enabled' 'means' '{' conditions+=EnablingCondition ('AND' conditions+=EnablingCondition)* '}';

// The only two conditions of an enabled specification, each about one action (two alternatives, so that anything else
// fails here, at its first word, with one message in easy-parser.ts):
//   start was executed or is not available       a condition
//   reboot is not pending or is not available    a milestone
EnablingCondition:
      action=[Action:Name] 'was' status='executed' 'or' 'is' 'not' 'available'
    | action=[Action:Name] 'is' 'not' status='pending' 'or' 'is' 'not' 'available';

SpecCondition:
    ActionCondition | EnabledCondition | SelfStateCondition | SelfAssertion;

// print is enabled (no 'not'): only in a Declarative specification or a Given
EnabledCondition:
    action=[Action:Name] 'is' status='enabled';

// it is busy (no 'not')
SelfStateCondition:
    'it' 'is' state=[State:Name];

SelfAssertion:
      subject=SelfPath negated?='not'? op=ValueOperation value=Value                 // the speed (not) larger than 3
    | value=Value 'is' negated?='not'? op=ElementOperation subject=SelfPath           // "report" is (not) included in the jobs
    | subject=SelfPath 'is' negated?='not'? op=StateOperation;                         // the jobs is (not) empty

SelfPath:
    ('its' | 'the' (entity=[Entity:Name] POSSESSIVE)?) property=[DataProperty:Name];

// print is (not) pending / available, print was (not) executed: in a Declarative specification or a Given
ActionCondition:
    action=[Action:Name]
    ( 'is'  negated?='not'? status=('pending' | 'available')
    | 'was' negated?='not'? status='executed' );

// ---------------- Scenarios ----------------
// Properties are reached through an entity name here: the <Entity>'s <property>

Scenario:
    'Scenario' ':' name=ScenarioName
    'Given' ':'? given+=GivenCondition ('AND' given+=GivenCondition)*
    'When'  ':'? action=[Action:Name] 'is' 'executed'
        ('with' ( 'inputs' inputs+=WhenInput (',' inputs+=WhenInput)* (',' 'outputs' outputs+=WhenOutput (',' outputs+=WhenOutput)*)?
                | 'outputs' outputs+=WhenOutput (',' outputs+=WhenOutput)* ))?
        ('AND' conditions+=WhenCondition)*
    'Then'  ':'? effects+=Effect ('AND' effects+=Effect)* '.';   // '.' stops a trailing multi-word Name from eating the next element

// A scenario's name can have keywords too: Scenario: Print the job When it is busy. But not Given, which ends it, or
// the words that start an element (Entity, Role, Action, Declarative, Scenario), so that a scenario whose Given is not
// written yet does not take in the element after it.
ScenarioName returns string:
    ( ID | 'Actions' | 'Data' | 'properties' | 'States' | 'a' | 'list' | 'queue' | 'of' | 'int' | 'string' | 'boolean'
    | 'Any' | 'Initiators' | 'Observers' | 'Input' | 'Output' | 'specification' | 'is' | 'means' | 'enabled' | 'was' | 'executed'
    | 'not' | 'pending' | 'or' | 'available' | 'it' | 'its' | 'the' | 'AND' | 'When' | 'with' | 'inputs' | 'outputs' | 'as'
    | 'Then' | 'equal' | 'to' | 'larger' | 'than' | 'smaller' | 'included' | 'in' | 'empty' | 'full' | 'set' | 'added'
    | 'removed' | 'enqueued' | 'from' | 'dequeued' | 'true' | 'false' | 'undefined' )+;

GivenCondition:
    StateCondition | ActionCondition | EnabledCondition | PropertyAssertion;

// the Printer is idle (no 'not')
StateCondition:
    'the' entity=[Entity:Name] 'is' state=[State:Name];

PropertyAssertion:
      subject=PropertyPath negated?='not'? op=ValueOperation value=Value
    | value=Value 'is' negated?='not'? op=ElementOperation subject=PropertyPath
    | subject=PropertyPath 'is' negated?='not'? op=StateOperation;

PropertyPath:
    'the' entity=[Entity:Name] POSSESSIVE property=[DataProperty:Name];

Effect:
    PropertyAssignment | ActionEffect;

PropertyAssignment:
      subject=PropertyPath 'is' op=ValueEffect value=EffectValue                   // the Printer's speed is set to 3, … jobs is added with "x"
    | value=EffectValue 'is' op=ElementEffect subject=PropertyPath                 // "x" is added to the Printer's jobs
    | subject=PropertyPath 'is' op=StateEffect ('as' variable=Variable)?           // the Printer's waiting is dequeued (as job)
    | subject=PropertyPath 'is' op=ClearEffect;                                    // the Printer's jobs is set to empty

// The element a Then dequeues ('… is dequeued as job'), of the queue's element type. The effects after it can use it
// as a value: '… is enqueued with job'.
Variable:
    name=Name;

// An input or output of the When, by its name in the action's Input or Output: '= <value>' says what it is, a value or
// data as it is before the execution; without it, it is any value. The right side of '=' is never a new name.
//   inputs name = "Ann", age = the Person's age     inputs name, age     outputs is_adult = true, member id
// The Then can use an input or output by its name as a value: 'name is added to the Library's members'.
WhenInput:
    name=Name ('=' value=WhenValue)?;

WhenOutput:
    name=Name ('=' value=WhenValue)?;

WhenValue:
    Value | PropertyPath;

// A data assertion of the When, after its inputs and outputs, as in a Given; an input or output of the When, by its
// name, can be the subject or the value:
//   … with inputs age, outputs is_adult AND age larger than 17 AND is_adult equal to true AND the Person's age equal to age
WhenCondition:
      subject=WhenSubject negated?='not'? op=ValueOperation value=EffectValue
    | value=EffectValue 'is' negated?='not'? op=ElementOperation subject=PropertyPath
    | subject=PropertyPath 'is' negated?='not'? op=StateOperation;

WhenSubject:
    PropertyPath | VariableValue;

// What the Then can use as a value, besides values: an input or output of the When, or an element dequeued before
type Binding = WhenInput | WhenOutput | Variable;

EffectValue:
    Value | VariableValue;

VariableValue:
    variable=[Binding:Name];

// <action> is pending  |  <action> is (not) available   (an effect cannot make an action not pending)
ActionEffect:
    action=[Action:Name] 'is' (status='pending' | negated?='not'? status='available');

// ---------------- Operations ----------------
// Each phrase once, in the place where it is written. The parser accepts any of them there; which types
// allow which phrases is in easy-validator.ts (ALLOWED), which reports the others.

// Assertions
ValueOperation   returns string: 'equal' 'to' | 'larger' 'than' | 'smaller' 'than';   // <property> (not) <operation> <value>
ElementOperation returns string: 'included' 'in';                                     // <value> is (not) included in <list or queue>
StateOperation   returns string: 'empty' | 'full' | 'undefined';                      // <list or queue> is (not) empty / full; <property> is (not) undefined: has no value (a list or queue always has one: it starts empty)

// Assignments
ValueEffect   returns string: 'set' 'to' | 'added' 'with' | 'removed' 'with' | 'enqueued' 'with';   // <property> is <effect> <value>
ElementEffect returns string: 'added' 'to' | 'removed' 'from';                                     // <value> is added to / removed from <list>
StateEffect   returns string: 'dequeued';                                                          // <queue> is dequeued
ClearEffect   returns string: 'set' 'to' 'empty';                                                  // <list or queue> is set to empty

// ---------------- Values ----------------

Value:     IntValue | StringValue | BoolValue;
IntValue:    value=INT;
StringValue: value=STRING;
BoolValue:   value=('true' | 'false');

// ---------------- Names and terminals ----------------

// Multi-word names ("Print job", "waiting jobs"); keywords end a name, so a name that needs one joins its words with
// underscores: "ready_to_submit"
Name returns string: ID+;

hidden terminal WS: /\s+/;
terminal INT returns number: /-?[0-9]+/;
terminal STRING: /"[^"]*"/;
// a word of letters, digits and underscores: submit, ready_to_submit
terminal ID: /[_a-zA-Z][\w_]*/;
// "'s" or "’s" (typographic apostrophe) - written as an escape so the grammar stays ASCII
terminal POSSESSIVE: /['’]s/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
