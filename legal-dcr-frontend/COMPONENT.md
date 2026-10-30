# The DCR page as a component

DCR.js's editor (and its simulator), showing a graph given as **DCR.js editor XML**. Code: `app/src/dcr-page/`.

## In a page that is not React

```bash
yarn build:component        # app/dist-component/dcr-page.js and dcr-page.css: React and the rest inside
```

```html
<link rel="stylesheet" href="dcr-page.css">
<div id="dcr" style="position: relative; height: 600px"></div>
<script type="module">
  import { mountDcrPage } from "./dcr-page.js";
  const page = mountDcrPage(document.getElementById("dcr"), { hiddenOptions: ["newDiagram", "open", "examples", "simulation"] });
  const warnings = await page.show(xml, "My graph");   // rejects, leaving the graph shown, when xml is not DCR.js editor XML
</script>
```

| `mountDcrPage(element, options)` gives | |
|---|---|
| `show(xml, name?)` | checks `xml` (`checkDcrXml`) and shows it in place of the graph shown, where the user looked at the one before (the same XML again undoes what the user moved); resolves with warnings, rejects when it is not DCR.js editor XML |
| `xml()` | the graph shown, as DCR.js editor XML, with what the user changed |
| `fit()` | fits the graph shown into the element |
| `resized()` | call it when the element's size changes, or it is shown after being hidden |
| `destroy()` | takes the page out of the element |

The page fills its element, which needs a height. It fits the first graph into the element. `app/component-demo.html`
(`yarn start`, then `/dcr-js/component-demo.html`) is such a page, with the XML on the left.

## In a React page

`<DcrPage xml={xml} name="My graph" hiddenOptions={[…]} />` from `app/src/dcr-page`, shown again whenever `xml` changes.

## Options (both)

| Option | Default | |
|---|---|---|
| `hiddenOptions` | none | hidden and disabled: `newDiagram`, `open`, `examples`, `simulation`, `layout` (DCR.js's own layout refuses graphs with roles) |
| `embedded` | `true` | inside its element; `false`: the whole window |
| `markerNotation` | `HM2011` | `HM2011`, `DCR Solutions` or `TAL2023`, at the start |
| `coloredRelations` | `true` | at the start |
| `checksGuards` | `true` | Save, Download and Simulation first check the guards: DCR.js's guard syntax, each variable declared |

## The XML

A `dcr:definitions` with the graph (`dcr:dcrGraph`) and its layout (`dcrDi:dcrRootBoard`, a shape for every element and
waypoints for every relation); `app/src/dcr-page/sample.xml` has each part below.

| Element | Attributes |
|---|---|
| `dcr:event` | `id`, `label`, `role`, `observers` (drawn in a strip at the bottom), `description`, `included`, `executed`, `pending`, `takesInput` |
| `dcr:eventData` (in an event or sub-process) | its variable: `name`, `type` (`Int`, `String`, `Bool`), `default` |
| `dcr:nesting` | `id`, `label`; holds events (a relation from it is from each of them) |
| `dcr:subProcess` | `id`, `label`, `role`, `included`, `executed`, `pending`; holds events and sub-processes |
| `dcr:relation` | `id`, `type` (`condition`, `response`, `include`, `exclude`, `milestone`, `noresponse`, `setValue`, `spawn`), `sourceRef`, `targetRef`, `guard`, `value` (a `setValue`'s), `time` |
| `dcrDi:dcrShape` | `boardElement`, with `dc:Bounds x y width height` (an event: 130 × 150, 180 with observers) |
| `dcrDi:relation` | `boardElement`, with two or more `dcrDi:waypoint x y` |

An element the DCR.js schema does not know is an error; `checkDcrXml` says which.
