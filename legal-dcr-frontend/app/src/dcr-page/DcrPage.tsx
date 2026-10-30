// The DCR page as a React component: DCR.js's editor (and its simulator) showing a graph given as DCR.js editor XML,
// with its own saved graphs and settings. It fills the element it is in, which needs a height.

import { useMemo } from "react";
import { ToastContainer } from "react-toastify";
import App, { type AppProps } from "../App";
import type { ModelerOption } from "../components/ModelerState";
import "./dcr-page.css";

export interface DcrPageProps extends Omit<AppProps, "graph" | "hiddenOptions"> {
  /** The graph, as DCR.js editor XML (COMPONENT.md), shown again whenever it changes; none: an empty graph. */
  xml?: string;
  /** Its name, at the top of the page. */
  name?: string;
  /** The options of the page to hide and disable: "newDiagram", "open", "examples", "simulation", "layout". */
  hiddenOptions?: Iterable<ModelerOption>;
}

const DcrPage = ({ xml, name = "DCR graph", hiddenOptions = [], embedded = true, ...props }: DcrPageProps) => {
  const graph = useMemo(() => (xml === undefined ? undefined : { name, graph: xml }), [xml, name]);
  const hidden = useMemo(() => new Set(hiddenOptions), [hiddenOptions]);
  return (
    <>
      <App {...props} graph={graph} embedded={embedded} hiddenOptions={hidden} />
      <ToastContainer position="top-left" />
    </>
  );
};

export default DcrPage;
