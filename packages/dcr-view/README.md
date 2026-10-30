# dcr-view

The DCR graph viewer of [dcr-js](https://github.com/hugoalopez-dtu/dcr-js) (MIT, see LICENSE), copied from
`dcr-js/modeler/lib` (the files `NavigatedViewer.js` needs) and changed for DSL easy:

- an event has `initiators` and `observers` (`lib/moddle/resources/dcr.json`); the top strip of its box shows the
  initiators (dcr-js shows the role there), and a strip at its bottom, as high, the observers (`lib/draw/DCRRenderer.js`;
  an event with observers needs a box 30 higher to keep the same room for its name);
- a guard is drawn on one line per `and` part, outlined in white, and over a loop from an event to itself rather than
  under it (`lib/draw/DCRRenderer.js`);
- the renderer's settings service (and the command stack it needs) is part of the viewer (`lib/draw/index.js`,
  `lib/features/settings/index.js`); dcr-js only gave it to its modeler;
- `lib/BaseViewer.js` without simulation, dcr-engine and the converters of other XML formats.

`DraggableViewer` adds dcr-js's modeling (`lib/features/modeling` and what it needs, copied unchanged) with
diagram-js's move and bendpoints, so events and relations can be dragged; nothing else can be edited.

It reads dcr-js's own XML (`dcr:definitions`), with a position for every event and relation.

`src/graph-view.ts` (`dcr-view/graph-view`) is not from dcr-js: a view of DSL easy's DCR graphs (easy-language's
`toDcrGraph`) on `DraggableViewer`, laid out by elkjs, for the browser editor and VS Code's DCR graph panel.

Two exports of the drawn graph, by the graph view's buttons ('Export DCR Solutions', 'Export dcr-js'; downloaded as
`dcr-graph.xml` and `dcr-graph.dcr-js.xml`, or saved by the `export` option of `createGraphView`, which VS Code's panel
does with a save dialog):

- `saveDcrJsXML()` (`lib/DcrJsXML.js`) is dcr-js's own XML, what its modeler opens and simulates: `saveXML()` (the graph
  as drawn, its ids too) with the data and the guards named as the modeler reads them, which is as DCR Solutions XML
  names them below: a guard's names are identifiers, each the name of some event's `dcr:eventData` (the modeler
  rejects a guard naming anything else: 'Guard references undefined variable', or 'Guard syntax error' for a name with
  a space), so a data property's data is named by the identifier of its name (`certificate genuine`:
  `certificate_genuine`), an action's only input or output by the action's (`determine_minority`), and each input or
  output a guard names of an action with several has an event of its own below it (`submit_information_caregivers`).
- `saveDCRXML()` (`lib/DCRXML.js`, from LegalDcrLlmChatbot's modeler, itself from dcr-js) is DCR Solutions XML,
  dcrgraphs.net's format, without xml2js. An event's name is a label mapped to it, its initiators its roles and its
  observers its readRoles, a group a nesting event, and where each event and relation is drawn its `custom` visualization
  and waypoints. Data and guards are written as DCR Solutions has them (and LegalDcrLlmChatbot's `DCRSolutionImport.js`
  reads them): a data property's activity has its type in its `eventData`, as dcrgraphs.net writes it (a `dataType`
  element: `int`, `text` for a string, or for a boolean a `choice` between true and false in `bool` format, with the
  event's number in the graph as its `sequence`; a DSL easy Any, any value, is `text`), and a guard names the data by
  the event's id, so that id is the name of the data made an identifier (`Person.age`: `Person_age`, kept apart from the
  other ids), in the guards too (not in their strings); each guard is an expression in `resources/expressions`, which its
  relation names by `expressionId` (a set-value's value is one, its guard is lost). An action's inputs and outputs
  (the event's `parameters`) are data too, which the guards of the action's relations name by their names (`result`,
  `satisfied`, `caregivers`): an action with one carries it, so its own id is the data's name (`determine_minority`), one
  with several has a data event of its own beside it for each a guard names (`submit_information_caregivers`, included
  at the start, with the action's roles), as DCR Solutions has one value for an event; the guards of that action's
  relations, and only of them, write that id. A list and a queue have no type to write: their activities have no data,
  and a guard naming one stays as written.

`npm test` checks them (`test/dcr-xml.test.ts`).
