/** dcr-js's read-only viewer: shows a graph given as dcr-js XML, with pan and zoom. */
export class NavigatedViewer {
    constructor(options: { container: HTMLElement });
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    get<T = any>(service: string): T;
    destroy(): void;
}

/** The viewer whose events and relations can be dragged (nothing else can be edited). */
export class DraggableViewer extends NavigatedViewer {}
