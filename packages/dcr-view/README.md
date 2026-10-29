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
