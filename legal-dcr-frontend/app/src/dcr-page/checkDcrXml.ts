import createModdle from "modeler/lib/moddle";

/**
 * Checks that `xml` is DCR.js editor XML the page can show: a dcr:definitions with a graph (dcr:dcrGraph) and its
 * layout (dcrDi:dcrRootBoard). Rejects when it is not; resolves with what the DCR.js schema does not know in it (an
 * element it leaves out), as warnings.
 */
export async function checkDcrXml(xml: string): Promise<string[]> {
  const { rootElement, warnings } = await createModdle().fromXML(xml, "dcr:Definitions");
  if (!rootElement.rootElements?.length) {
    throw new Error("The XML has no graph (dcr:dcrGraph).");
  }
  if (!rootElement.rootBoards?.length) {
    throw new Error("The XML has no layout (dcrDi:dcrRootBoard).");
  }
  return warnings.map((warning) => warning.message);
}
