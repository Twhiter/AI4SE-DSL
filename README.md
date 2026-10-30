# DSL easy

A Langium language with a VS Code extension and a browser editor

| Package | What it is |
|---|---|
| `packages/language` | grammar, parser, validator and tests |
| `packages/extension` | VS Code extension (language server) for `.easy` files: the language's errors and, without them, the Z3 checks, as the browser editor runs them, in the Problems panel; and a DCR graph panel ('DSL easy: Show DCR graph', the button on an `.easy` file's title bar) with the graph of the `.easy` file shown last |
| `packages/dcr-view` | the DCR graph viewer of [dcr-js](https://github.com/hugoalopez-dtu/dcr-js) (MIT), copied and changed to show initiators and observers, to draw relations in DCR Solutions' notation, and to let events and relations be dragged; and its view of DSL easy's DCR graphs (`src/graph-view.ts`), laid out by elkjs, for the VS Code panel |
| `packages/dcr-js-adapter` | a DSL easy model as DCR.js editor XML, laid out by elkjs, for the DCR page of `legal-dcr-frontend` (its `COMPONENT.md`): `toDcrJsXml(model)`. A data property is an activity with a variable, in the nesting Data; an action with one input and no output is an activity with the input's variable; one with more inputs, or with outputs, is a nesting holding the nestings Input and Output, an activity with a variable for each; 'is set to' is a setValue. Variable names have `_` for spaces, and their entity's or action's name before them when two would be the same (`Printer_speed`). Lists, queues and 'is undefined' are left out for now (`src/graph.ts`) |
| `packages/dcr-solution-adapter` | the same graph as DCR Solutions XML, as dcrgraphs.net exports a graph (`dcr solution examples`): `toDcrSolutionXml(model, { title, marking })`. A data property is an event with its entity as role, in the nesting Data, from which the Givens' conditions go, as in `packages/dcr-js-adapter`; an action is an event with its initiators (roles) and observers (read roles), with the input's value when it has one input and no output; one with more inputs is a form holding them, one with outputs a form holding the nestings Input and Output. An event's id is what the FEEL expressions name it by: a variable's name (as in `packages/dcr-js-adapter`), or an action's. 'is set to' is an update, its When the guard and its value the value (`dcr solution examples/DCR update.xml`); an action's several for the same property are one, their Whens joined with or and their values as `if … then … else …`; strings are in single quotes; 'is undefined' is `= null` ('is not undefined' `!= null`), and each data property starts with no value, null (`dcr solution examples/DCR null.xml`). Data is above the actions, its data properties a row for each entity's; the actions are laid out as in `packages/dcr-js-adapter`, with the relations between them only. By default only data properties start included, events in a form always do (`marking`). The browser editor exports it; showing it there is future work |
| `packages/web` | browser editor: Monaco, the language and Z3, no server; its Problems panel lists the errors and the Z3 checks, and its DCR graph view shows the DCR page of `legal-dcr-frontend`, given the XML of `packages/dcr-js-adapter` after every check; the Export menu in the menu bar at the top downloads the document, once it has no errors, as DCR Solutions XML (`packages/dcr-solution-adapter`, for dcrgraphs.net) or as DCR.js XML (`packages/dcr-js-adapter`) |
| `packages/dsl-controller` | DSL controller: the model of a document and the tools that read and change it, the checks (validation and Z3), and plans of changes tried on a copy; not tied to the chatbot or to an agent SDK, so an MCP server could offer the same tools |
| `packages/chatbot` | the chatbot (OpenAI Agents SDK) on the DSL controller's tools, and the document server that the editor's chat pane talks to, with the agents' prompts, skills and session logs; after a reply, an options agent (`src/options.ts`) turns the choice it leaves the user into buttons under it (`OPTIONS=off` in `.env` turns them off) |
| `packages/dsl-mcp` | an MCP server on the DSL controller's tools, for clients such as Codex and Claude Desktop (`codex mcp add dsl-easy -- node <path>/packages/dsl-mcp/src/main.ts`): `create_dsl` (the domain, in text) makes a folder `packages/dsl-mcp/documents/<id>` (`dsl.easy`, `domain.txt`, `log.jsonl`) and gives only the id, which every other tool takes as `dsl`; the read tools read the document, and it changes only through plans (`simulate_plan`, which also gives what the plan changes as a diff, and `apply_plan`). Every call and its answer, errors included, is a line of `log.jsonl`; the server keeps no state between calls |

## The web chatbot

The browser editor's chat pane talks to the chatbot's document server (`packages/chatbot`), which runs the agents.
After the setup above:

1. Start Docker: the agents read their skills in a container, one per conversation (not needed with `SKILLS=off`).
2. Write `packages/chatbot/.env` (git ignores it):
   ```
   OPENAI_API_KEY=…    # the endpoint's key
   OPENAI_BASE_URL=…   # the endpoint (OpenAI's Responses API, or one compatible with it)
   OPENAI_MODEL=…      # optional: gpt-5.4 by default; a claude-… model works too
   SKILLS=on          # optional: no skills, and no Docker
   OPTIONS=on         # optional: no option buttons under the replies
   ```
3. Build the DCR page once, and again after changing `legal-dcr-frontend` (it needs Yarn):
   ```bash
   npm run dcr-page
   ```
4. From the root folder, start the document server (ws://localhost:1234) and the browser editor together:
   ```bash
   npm run dev
   ```
5. Open http://localhost:5174, describe the domain, and chat. Each browser tab is a session, log fies are in
   `packages/chatbot/logs/session-<id>.md` (and `.json`).