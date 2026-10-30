/** dcr-js's read-only viewer: shows a graph given as dcr-js XML, with pan and zoom. */
export class NavigatedViewer {
    constructor(options: { container: HTMLElement });
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    /** The drawn graph as dcr-js XML (what importXML reads). */
    saveXML(options?: { format?: boolean, preamble?: boolean }): Promise<{ xml: string }>;
    /** The drawn graph as DCR Solutions XML, dcrgraphs.net's format (lib/DCRXML.js). */
    saveDCRXML(): Promise<{ xml: string }>;
    /** The drawn graph as dcr-js XML for its modeler (lib/DcrJsXML.js): saveXML with the data and the guards named as the modeler reads them. */
    saveDcrJsXML(options?: { format?: boolean, preamble?: boolean }): Promise<{ xml: string }>;
    get<T = any>(service: string): T;
    destroy(): void;
}

/** The viewer whose events and relations can be dragged (nothing else can be edited). */
export class DraggableViewer extends NavigatedViewer {}
