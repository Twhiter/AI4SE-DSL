import { describe, expect, it } from "vitest";

import Modeler from "/lib/Modeler";
import createModdle from "/lib/moddle";

// An event with a role and observers, as DSL easy's graphs have them, next to one without observers.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dcr:definitions xmlns:dcr="http://tk/schema/dcr" xmlns:dcrDi="http://tk/schema/dcrDi" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
  <dcr:dcrGraph id="dcrGraph">
    <dcr:event id="Print" label="print" role="Operator" observers="Printer, Manager" included="true" executed="false" pending="false" enabled="false" />
    <dcr:event id="Start" label="start" role="Operator" included="true" executed="false" pending="false" enabled="false" />
  </dcr:dcrGraph>
  <dcrDi:dcrRootBoard id="RootBoard">
    <dcrDi:dcrPlane id="Plane" boardElement="dcrGraph">
      <dcrDi:dcrShape id="Print_di" boardElement="Print"><dc:Bounds x="0" y="0" width="130" height="180" /></dcrDi:dcrShape>
      <dcrDi:dcrShape id="Start_di" boardElement="Start"><dc:Bounds x="200" y="0" width="130" height="150" /></dcrDi:dcrShape>
    </dcrDi:dcrPlane>
  </dcrDi:dcrRootBoard>
</dcr:definitions>`;

async function createModeler() {
  const modeler = new Modeler({ container: document.createElement("div") });
  const result = await modeler.importXML(xml);
  expect(result.warnings).toEqual([]);
  return modeler;
}

describe("observers", () => {
  it("are drawn in a strip at the bottom of an event's box", async () => {
    const modeler = await createModeler();
    const registry = modeler.getElementRegistry();
    const dividers = (id) => [...registry.getGraphics(id).querySelectorAll("path")].map((path) => path.getAttribute("d"));

    expect(registry.get("Print").businessObject.observers).toBe("Printer, Manager");
    expect(registry.getGraphics("Print").textContent).toContain("Printer, Manager");
    // the role's divider at the top, and the observers' 30 above the bottom
    expect(dividers("Print")).toEqual(["M0,30L130,30", "M0,150L130,150"]);
    expect(registry.get("Start").businessObject.observers).toBeUndefined();
    expect(dividers("Start")).toEqual(["M0,30L130,30"]);
    modeler.destroy();
  });

  it("are kept in the editor's XML", async () => {
    const modeler = await createModeler();
    const saved = await modeler.saveXML({ format: true });
    const reparsed = await createModdle().fromXML(saved.xml, "dcr:Definitions");

    expect(reparsed.elementsById.Print.observers).toBe("Printer, Manager");
    expect(reparsed.elementsById.Start.observers).toBeUndefined();
    modeler.destroy();
  });
});
