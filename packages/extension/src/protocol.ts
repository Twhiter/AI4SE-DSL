// What the language server tells the extension besides the language protocol: the DCR graph of each checked document,
// for the DCR graph panel. The panel's webview gets the same, with the document's name.

import type { DcrGraph } from 'easy-language';

/** The notification with a document's DCR graph, or why there is no newer one. */
export const DCR_GRAPH = 'easy/dcrGraph';

/** A document's DCR graph after its checks, or why there is none for its latest text ('fix the errors first'). */
export type DcrGraphParams = { uri: string, graph: DcrGraph } | { uri: string, outOfDate: string };

/** What the webview shows: the graph of the document `name` (its path in the workspace). */
export type DcrGraphMessage = DcrGraphParams & { name: string };

/** What the webview tells the extension: save the graph of the document `name` as `xml`, in dcr-js's own format or DCR Solutions'. */
export type DcrExportMessage = { export: string, format: 'dcr-js' | 'dcr-solutions', name: string };
