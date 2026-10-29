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
3. From the root folder, start the document server (ws://localhost:1234) and the browser editor together:
   ```bash
   npm run dev
   ```
4. Open http://localhost:5174, describe the domain, and chat. Each browser tab is a session, log fies are in
   `packages/chatbot/logs/session-<id>.md` (and `.json`).