// The DCR page as a component for other pages (COMPONENT.md): DcrPage for a React page, and mountDcrPage for any
// other page, which shows it in an element and gives it graphs as DCR.js editor XML.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type DCRModeler from "modeler";
import DcrPage, { type DcrPageProps } from "./DcrPage";
import { checkDcrXml } from "./checkDcrXml";

export { default as DcrPage, type DcrPageProps } from "./DcrPage";
export { checkDcrXml } from "./checkDcrXml";
export type { ModelerOption } from "../components/ModelerState";

export type DcrPageOptions = Omit<DcrPageProps, "xml" | "name" | "onModeler">;

/** The DCR page in an element, for the page it is in. */
export interface DcrPageHandle {
  /**
   * Shows `xml` in place of the graph shown (also the same XML again, undoing what the user moved), once checkDcrXml
   * accepts it; resolves with its warnings, and rejects, leaving the graph shown, when it is not DCR.js editor XML.
   */
  show(xml: string, name?: string): Promise<string[]>;
  /** The graph shown, as DCR.js editor XML, with what the user changed in it. */
  xml(): Promise<string>;
  /** Fits the graph shown into the element. */
  fit(): void;
  /** Call it when the element's size changes, or when it is shown after it was hidden. */
  resized(): void;
  /** Takes the page out of the element. */
  destroy(): void;
}

/**
 * Shows the DCR page in `element`, empty until show gives it a graph. It fits the first graph into the element, and
 * shows each later one where the user looked at the one before.
 */
export function mountDcrPage(element: HTMLElement, options: DcrPageOptions = {}): DcrPageHandle {
  const root = createRoot(element);
  let modeler: DCRModeler | null = null;
  let shown: { xml: string; name?: string } | undefined;
  let fitted = false;
  /** Where the user looked when show gave a newer graph, to look there again once it is shown. */
  let view: unknown;
  /** The calls of show so far: one that a newer call overtook while it checked its XML shows nothing. */
  let shows = 0;

  const canvas = () => modeler?.get("canvas");
  const fitFirst = () => {
    if (shown && !fitted && element.clientWidth > 0) {
      canvas()?.zoom("fit-viewport");
      fitted = true;
    }
  };
  const imported = () => {
    if (view) {
      canvas()?.viewbox(view);
      view = undefined;
    } else {
      fitFirst();
    }
  };
  const onModeler = (next: DCRModeler | null) => {
    modeler = next;
    next?.on("import.done", imported);
  };
  const render = () =>
    root.render(
      <StrictMode>
        <DcrPage {...options} xml={shown?.xml} name={shown?.name} onModeler={onModeler} />
      </StrictMode>,
    );
  render();

  return {
    async show(xml, name) {
      const call = ++shows;
      const warnings = await checkDcrXml(xml);
      if (call !== shows) {
        return warnings;
      }
      view = fitted && element.clientWidth > 0 ? canvas()?.viewbox() : undefined;
      if (modeler && shown?.xml === xml) {
        await modeler.importXML(xml);   // the page imports a graph again only when it changes
      }
      shown = { xml, name };
      render();
      return warnings;
    },
    async xml() {
      if (!modeler) {
        throw new Error("The DCR page has no editor yet.");
      }
      return (await modeler.saveXML({ format: true })).xml;
    },
    fit() {
      if (shown) {
        canvas()?.zoom("fit-viewport");
        fitted = true;
      }
    },
    resized() {
      canvas()?.resized();
      fitFirst();
    },
    destroy() {
      root.unmount();
    },
  };
}
