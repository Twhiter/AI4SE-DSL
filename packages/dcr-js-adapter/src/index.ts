// A DSL easy model as DCR.js editor XML, laid out: what the DCR page of legal-dcr-frontend shows (its COMPONENT.md),
// in place of DSL easy's own DCR graph view. The mapping is graph.ts's, the layout and the XML xml.ts's.

import type { EasyModel } from 'easy-language';
import { toDcrJsGraph } from './graph.ts';
import { toXml } from './xml.ts';

// for the other adapters, which say the same graph in another format (easy-dcr-solution-adapter)
export { DATA, INPUT, OUTPUT, identifier, toDcrJsGraph, type Activity, type Box, type DcrJsGraph, type Element, type Options, type Relation, type Variable } from './graph.ts';
export { layout, type Bounds, type Point } from './xml.ts';

/** The model of a document without errors (easy-language's buildModel) as DCR.js editor XML, laid out. */
export async function toDcrJsXml(model: EasyModel.Model): Promise<string> {
    return toXml(toDcrJsGraph(model));
}
