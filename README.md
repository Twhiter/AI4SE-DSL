# DSL easy

A Langium language with a VS Code extension and a browser editor

| Package | What it is |
|---|---|
| `packages/language` | grammar, parser, validator and tests |
| `packages/extension` | VS Code extension (language server) for `.easy` files: the language's errors and, without them, the Z3 checks, as the browser editor runs them, in the Problems panel; and a DCR graph panel ('DSL easy: Show DCR graph', the button on an `.easy` file's title bar) with the graph of the `.easy` file shown last |
| `packages/dcr-view` | the DCR graph viewer of [dcr-js](https://github.com/hugoalopez-dtu/dcr-js) (MIT), copied and changed to show initiators and observers, to draw relations in DCR Solutions' notation, and to let events and relations be dragged; and its view of DSL easy's DCR graphs (`src/graph-view.ts`), laid out by elkjs, for the browser editor and the VS Code panel |
| `packages/web` | browser editor: Monaco, the language and Z3, no server; its Problems panel lists the errors and the Z3 checks, and a pane on the right shows the DCR graph |
| `packages/dsl-controller` | DSL controller: the model of a document and the tools that read and change it, the checks (validation and Z3), and plans of changes tried on a copy; not tied to the chatbot or to an agent SDK, so an MCP server could offer the same tools |
| `packages/chatbot` | the chatbot (OpenAI Agents SDK) on the DSL controller's tools, and the document server that the editor's chat pane talks to, with the agents' prompts, skills and session logs; after a reply, an options agent (`src/options.ts`) turns the choice it leaves the user into buttons under it (`OPTIONS=off` in `.env` turns them off) |
| `packages/dsl-mcp` | an MCP server on the DSL controller's tools, for clients such as Codex and Claude Desktop (`codex mcp add dsl-easy -- node <path>/packages/dsl-mcp/src/main.ts`): `create_dsl` (the domain, in text) makes a folder `packages/dsl-mcp/documents/<id>` (`dsl.easy`, `domain.txt`, `log.jsonl`) and gives only the id, which every other tool takes as `dsl`; the read tools read the document, and it changes only through plans (`simulate_plan`, which also gives what the plan changes as a diff, and `apply_plan`). Every call and its answer, errors included, is a line of `log.jsonl`; the server keeps no state between calls |

**Partly disconnected until the semantics follows the new model:** the browser editor checks the model with Z3 (the
checks below) and draws its DCR graph, but it does not simplify the Givens. The model
(`packages/language/src/model.ts`) and `model-builder.ts` follow the grammar: an `EnabledSpecification` lists the
actions of its conditions and milestones (`conditions`, `milestones`); `enableds` (`print is enabled` in a Declarative
specification or a Given) is filled in, and a `Then` records only which actions are pending, available or not
available, and its data constraints. The consistency check (`checkConsistency`,
`src/consistency.ts`) takes the Declarative and the enabled specifications together as rules, and assumes each head
in turn:
  - a Declarative specification: `inState(x, busy) ⇒ …`, where `print is enabled` is `enabled(x, print)`;
  - an enabled specification, an equivalence with its body and its action's availability: `enabled(x, print) ⇔
    (executed(x, start) ∨ ¬available(x, start)) ∧ (¬pending(x, reboot) ∨ ¬available(x, reboot)) ∧ available(x, print)`;
  - an action without one is enabled exactly when it is available (`enabled ⇔ available`, in the vocabulary's constraints).
Each scenario is checked on its own (`checkScenarios`, `src/scenario-consistency.ts`), with the same specifications as
rules: its Given with its When action enabled (the state before), and its Then with its When action executed (the state
after), in two solvers, so a Then never changes what a Given says; `print is enabled` in a Given is `enabled(x, print)`.
The scenarios with the same When form a `WhenRule` (`model.whenRules`), read as
`when(a, input 1, …): (Given₁ ⇒ Then₁) ∧ (Given₂ ⇒ Then₂) ∧ …`: the action, its `parameters` (one per input of the
action), and lists `givens` and `thens`. A When's variables are local to its scenario, so they are renamed to the
parameters (`with job as input`: `job` is `input 1`), and its values become conditions of its Given (`with "draft" as
input`: `input 1 = "draft"`). `checkCrossScenarios` checks each rule over its scenarios that hold on their own, for every
input: an input occurs only in equalities, so finitely many points cover them all: each input is a value that occurs in
the rule, or a fresh constant that differs from those (and from another input's, for `input 2 = input 1`). At each point,
the scenarios whose input conditions hold apply; Z3 finds every smallest group of them whose Thens cannot hold together
(unsat cores, on the state after), and a group whose Givens can hold together (on the state before, with the When action
enabled) is a conflict, reported once with the input where it occurs (`input 1 is a string other than "draft"`).
The Given simplification and the old cross-scenario check (`scenario-check.ts`) are left out of the exports
(`src/index.ts`), the build (`tsconfig.src.json`) and the tests (`vitest.config.ts`, `tsconfig.test.json`:
`model-z3.test.ts` and `scenario-check.test.ts` do not run), and so is `scripts/check.mjs`; they are unchanged.
Reconnecting undoes the lines marked "disconnected" in those files.

```bash
npm install
npm run langium:generate
npm run build
npm test
npm run web:dev        # browser editor on http://localhost:5174
```

## The web chatbot

The browser editor's chat pane talks to the chatbot's document server (`packages/chatbot`), which runs the agents.
After the setup above:

1. Start Docker: the agents read their skills in a container, one per conversation (not needed with `SKILLS=off`).
2. Write `packages/chatbot/.env` (git ignores it):
   ```
   OPENAI_API_KEY=…    # the endpoint's key
   OPENAI_BASE_URL=…   # the endpoint (OpenAI's Responses API, or one compatible with it)
   OPENAI_MODEL=…      # optional: gpt-5.4 by default; a claude-… model works too
   SKILLS=off          # optional: no skills, and no Docker
   OPTIONS=off         # optional: no option buttons under the replies
   ```
3. From the root folder, start the document server (ws://localhost:1234) and the browser editor together:
   ```bash
   npm run dev
   ```
4. Open http://localhost:5174, describe the domain, and chat. Each browser tab is a session, logged in
   `packages/chatbot/logs/session-<id>.md` (and `.json`).

Ctrl+C stops both. Restart them after changing the chatbot's code or `.env`; the agents then start each conversation
over, as they keep its memory only while the server runs. The prompts (`prompt/`) are read at every turn, and a skill
(`skills/`) from the next conversation on, so changing them needs no restart.

The browser editor checks every error-free version of the text with Z3 (`packages/web/src/checks.ts`): the
specifications together (`checkConsistency`), each scenario on its own (`checkScenarios`), and the scenarios with the
same When against each other (`checkCrossScenarios`). The Problems panel lists what they find with the language's
errors, and its header the time each took:
  - a specification whose head can never hold, on its head (`Declarative specification Printer is busy`, `Action print
    is enabled`), with links to the specifications it conflicts with;
  - a Given that can never hold with its When action enabled, or a Then with its When action executed, on the
    scenario's `Given` or `Then`, with what contradicts (`spec: …`, `Given: …`, `When: …`, `Then: …`) and links to
    those specifications;
  - scenarios with the same When that can apply together but whose Thens contradict, on the first one's `Then`, with
    the input where they do (`input 1 = "draft"`), the Then items that contradict, and links to the other Thens.
A state that a scenario or a specification uses needs a Declarative specification, which says what it means in data,
so a Given in the end only says things about data (or what the specifications resolve); a state nothing uses yet can
wait for its specification. A specification can name another state of its
entity (`it is online`, never `it is not online`); specifications that go round in a cycle (busy → idle → busy) get a
warning, on the `it is …` that leads back.

A Declarative specification or a Given can also say that an action is enabled (`print is enabled`, never
`not enabled`; not in a Then). Besides the Declarative specifications, the only specification of an action is an enabled one, with two kinds of
condition joined with AND, each about one action: a condition (`start was executed or is not available`) and a
milestone (`reboot is not pending or is not available`):
`Action print is enabled means { start was executed or is not available AND reboot is not pending or is not available }`.

DCR graph: `toDcrGraph(z3, model)` in `packages/language/src/dcr.ts` gives a `DcrGraph`, with a list of activities
(`events`), of groups and of relations, built from the When rules, with each Given saturated (`Given.saturated`): cut
down to data, each state replaced by what its Declarative specification says (and a state there by what its own
says), until only action statuses and property assertions remain; a state met again (a cycle of specifications) is
left out. Then the action statuses are left out (`is available`, `is pending`, `was executed`, `is enabled`, …).
Assuming that the specifications and the scenarios are consistent, the graph has:
  - an activity for every data property, named after it (`Printer.speed` when another activity has that name, or an
    action has an input or output of that name), initiated by its entity, without observers, in a group called
    `Data`, included at the start;
  - an activity for every action, with its initiators, observers, inputs and outputs (by name and type), not included
    at the start; no activity is pending at the start;
  - for an enabled specification, a condition from each action of a condition (`start was executed or is not
    available`: start → print) and a milestone from each action of a milestone (`reboot is not pending or is not
    available`: reboot → print);
  - for each When rule with action a, a condition from `Data` to a, guarded by the property assertions of its Given,
    or of any of its Givens (`g₁ or g₂ or …`) when it has several scenarios; none when that always holds (a Given
    without property assertions, or, as Z3 finds, `speed > 3 or speed < 4`). The Given guards nothing else;
  - for each Then of a When rule, from a: an include for each `is available`, an exclude for each `is not available`,
    a response for each `is pending`, and an include to the data property of each assignment (DCR has no relation for
    an assignment), each guarded by what the scenario's When says: the value or data it gives each input and output
    (`file = "report.pdf"`, `age = Person.age`, in the order the action declares them), then its other comparisons
    and data assertions (`is_adult = true`, `blocked = false`), in which an input or output it gives a value or data
    is that value or data (`… copies = 2 AND pages larger than copies`: `copies = 2 and pages > 2`) and one it gives
    nothing is its name; none when the When says nothing. The same relation from several Thens is one, its guards
    joined with `or`.
Guards are written as DCR Solutions writes them (its expression language, a subset of FEEL, which has no `not()`):
`ready = true and list contains(jobs, "report.pdf") and speed > 2`, `speed <= 2`, `list contains(jobs, "a") = false`, an
empty list `count(jobs) = 0` (not empty `count(jobs) > 0`), a full one `count(jobs) >= max_capacity`, an input or
output by its name `file = "report.pdf"`, alternatives `(file = "a" and copies = 1) or (file = "b" and copies = 2)`. A
guard reads the values of the data activities; nothing in the graph sets them (an assignment is only an include).
The browser editor draws it after every check in the pane right of the editor (`packages/web/src/dcr-pane.ts`):
elkjs lays it out, the group Data as a box around its activities, and dcr-js's viewer (`packages/dcr-view`) draws
it, the group as a dcr-js nesting, with each activity's initiators in the top strip of its box and its observers in a
strip at its bottom. Activities and relations (their segments and bend points) can be dragged, and stay where they
were dragged when the graph is drawn again (the box of Data is drawn around its activities, wherever they are);
'Layout' lays it out again.

Names can have several words (`waiting jobs`); a keyword ends a name, so a name that needs one joins its words with underscores (`ready_to_submit`). A scenario's name can have keywords (`Scenario: Print the job When it is busy`), but not `Given`, which ends it, or a word that starts an element (`Entity`, `Role`, `Action`, `Declarative`, `Scenario`).

Types: `int`, `string`, `boolean` and `Any` (any of them); a list or queue can give its elements a type
(`waiting jobs: a queue of string`), and holds Any without one. Variables name values for the effects of a Then:
`When submit is executed with job as input` names what the user inputs (of the action's input type), and
`… is dequeued as job` names the dequeued element (of the queue's element type); the effects after it can use them
(`… is enqueued with job`). No type converts to another, so a value or variable of another type is an error; only
Any converts to any type (a variable of type Any where a type is needed is a warning: it may not have that type). Z3 is WebAssembly with
threads, which browsers only allow on a cross-origin isolated page. `packages/web/dist` works on any static web server
over HTTPS (or on localhost): when the server does not send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` itself (the dev server and `vite preview` do), a service worker adds them,
and the page reloads once on the first visit.
