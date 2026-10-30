# Source

The `frontend/` folder of https://github.com/paul-cvp/LegalDcrLlmChatbot, branch `feature/dcr-frontend-updates`, commit `a9984544aa5fff418a77357ba35b7ac99c1df586`, without its backend, and cut down to the DCR page:

- The app opens on the DCR page (the modeler, `app/src/components/ModelerState.tsx`), whose play button opens the simulator (`SimulatorState.tsx`). Saved graphs and logs are kept in memory until the page is reloaded, as in dcr-js, instead of in the backend.
- Removed, as they need the backend or are other pages: the chat (the `chat/` workspace, `app/src/chat/`), the backend calls (`app/src/api/`), the pages Home, Chat, From Text, Citizen Information, Conformance, Discovery and Event log generation, the engine's LLM text extraction (`dcr-engine/src/extraction.ts`, `src/prompts/`), and the modeler tests that read the backend's models or use the extraction.
- The modeler's metadata panel hides the tool call unless a tool registry is set (`setToolCalls`) or the activity has one.
- An event can have observers (`observers="Printer, Manager"` in the editor XML), drawn in a strip at the bottom of its box, as DSL easy's own viewer draws them (`modeler/test/spec/observers.spec.js`); only for display: the metadata panel does not edit them.
- As the chatbot would show it, the DCR page hides and disables New Diagram, Open, Examples and the simulation button (`HIDDEN_OPTIONS` in `app/src/main.tsx`, the `hiddenOptions` of `ModelerState`); their code stays, and removing one from the list brings it back.
- The DCR page is a component for other pages, given graphs as DCR.js editor XML (COMPONENT.md, `app/src/dcr-page/`); this app's own page (`main.tsx`) uses it too.

To run it: `yarn install`, then `yarn start` (http://localhost:5173/dcr-js/); `yarn test` runs the modeler's tests.
