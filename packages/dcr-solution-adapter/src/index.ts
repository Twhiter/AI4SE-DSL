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
    /** The fixer: an action that no include relation goes to starts included (the DCR.js graph's). True by default. */
    fixInclusion?: boolean;
    /**
     * How the event of a data property, Data (their nesting) or an action (an activity or a form) starts; what it leaves
     * out is false. An event in a form always starts included, neither executed nor pending. By default as the model
     * says (DEFAULT_MARKING).
     */
    marking?: (event: SolutionEvent) => Partial<Marking>;
}

/**
 * As the model says: Data and the data properties' events start included, an action's as its Action … { … } says
 * (Initially available, Initially pending), or included by the fixer; none starts executed.
 */
export const DEFAULT_MARKING = ({ included, pending }: SolutionEvent): Partial<Marking> => ({ included, pending });

/** The model of a document without errors (easy-language's buildModel) as DCR Solutions XML, laid out. */
export async function toDcrSolutionXml(model: EasyModel.Model, { title = 'DCR graph', fixInclusion, marking = DEFAULT_MARKING }: Options = {}): Promise<string> {
    return toXml(toDcrSolutionGraph(model, { fixInclusion }), title, marking);
}
