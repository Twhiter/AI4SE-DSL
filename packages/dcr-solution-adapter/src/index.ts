// A DSL easy model as DCR Solutions XML, as dcrgraphs.net exports a graph: its events and relations are graph.ts's,
// the XML, with where each event is and how it starts, xml.ts's. Showing it (in place of the DCR page) is future work.

import type { EasyModel } from 'easy-language';
import { toDcrSolutionGraph, type SolutionEvent } from './graph.ts';
import { toXml, type Marking } from './xml.ts';

export { toDcrSolutionGraph, type DcrSolutionGraph, type SolutionEvent, type SolutionRelation } from './graph.ts';
export type { Marking } from './xml.ts';

export interface Options {
    /** The graph's title. */
    title?: string;
    /**
     * How the event of a data property, Data (their nesting) or an action (an activity or a form) starts; what it leaves
     * out is false. An event in a form always starts included, neither executed nor pending.
     */
    marking?: (event: SolutionEvent) => Partial<Marking>;
}

/** Only Data and the data properties' events start included. */
export const DEFAULT_MARKING = ({ kind }: SolutionEvent): Partial<Marking> => ({ included: kind === 'data' });

/** The model of a document without errors (easy-language's buildModel) as DCR Solutions XML, laid out. */
export async function toDcrSolutionXml(model: EasyModel.Model, { title = 'DCR graph', marking = DEFAULT_MARKING }: Options = {}): Promise<string> {
    return toXml(toDcrSolutionGraph(model), title, marking);
}
