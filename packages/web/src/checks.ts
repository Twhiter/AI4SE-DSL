// Checks the editor's document with Z3, in the page: the Declarative and enabled specifications together, each
// scenario on its own, and the scenarios with the same When against each other. All the problems become markers
// together, like the language's own errors, so the editor underlines them and the Problems panel lists them; then
// the document becomes a DCR graph, for the pane right of the editor (dcr-pane.ts).
// Z3 is WebAssembly: z3/z3-built.js, a classic script served by vite.config.ts, defines initZ3 and loads
// z3/z3-built.wasm; its threads need SharedArrayBuffer, so the page is cross-origin isolated (by the headers in
// vite.config.ts, or on another web server by the service worker of cross-origin-isolation.ts).

import * as monaco from 'monaco-editor';
import { GrammarUtils, type LangiumDocument } from 'langium';
import { createApi } from 'z3-solver/build/high-level';
import { init as initLowLevel } from 'z3-solver/build/low-level';
import {
    checkConsistency, checkCrossScenarios, checkScenarios, isDeclarativeSpec, isEnabledSpec, isScenario, toDcrGraph,
    type ConsistencyResult, type CrossScenarioResult, type DcrGraph, type EasyModel, type Model as ModelNode, type ScenarioResult, type Z3Context
} from 'easy-language';
import { crossOriginIsolation } from './cross-origin-isolation.js';
import { toMonacoRange } from './ranges.js';

declare global {
    interface Window {
        /** Defined by z3/z3-built.js. */
        initZ3?: unknown;
    }
}

export interface CheckStatus {
    state: 'loading' | 'checking' | 'done' | 'not checked' | 'failed';
    text: string;
}

const OWNER = 'easy-z3';
const statusListeners: Array<(status: CheckStatus) => void> = [];

/** Called with what the checks are doing: loading Z3, checking, done (with timings), not checked, failed. */
export function onCheckStatus(listener: (status: CheckStatus) => void): void {
    statusListeners.push(listener);
}

function report(status: CheckStatus): void {
    statusListeners.forEach(listener => listener(status));
}

const graphListeners: Array<(graph: DcrGraph) => void> = [];

/** Called with the DCR graph of every document that was checked. */
export function onDcrGraph(listener: (graph: DcrGraph) => void): void {
    graphListeners.push(listener);
}

// ---------------- Running the checks, one at a time ----------------

/** The text of the latest request; a queued check of an older text is skipped, a running one is dropped. */
let latest: string | undefined;
let queue: Promise<void> = Promise.resolve();

/**
 * Checks the content of an error-free document (`model`, built from `text`) and shows the problems as markers on
 * `editorModel`. Called after every build without errors, so it follows the typing; the locations are taken now,
 * as the document is replaced by the next build.
 */
export function checkWithZ3(editorModel: monaco.editor.ITextModel, text: string, document: LangiumDocument, model: EasyModel.Model): void {
    const locations = locate(document, model);
    latest = text;
    const stale = () => latest !== text || editorModel.isDisposed();
    queue = queue.then(async () => {
        if (stale()) {
            return;
        }
        try {
            const z3 = await loadZ3();
            report({ state: 'checking', text: 'Checking…' });
            const result = await runChecks(z3, model, locations, editorModel.uri, stale);
            if (result && !stale()) {
                monaco.editor.setModelMarkers(editorModel, OWNER, result.markers);
                report({ state: 'done', text: result.summary });
                graphListeners.forEach(listener => listener(result.graph));
            }
        } catch (error) {
            report({ state: 'failed', text: `Z3 failed: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            freeGarbage();   // no Z3 call is in flight between checks
        }
    });
}

/** Nothing is checked (the document has errors, or the checks are off), and the last results are out of date. */
export function clearChecks(editorModel: monaco.editor.ITextModel, why = 'Not checked: fix the errors first'): void {
    latest = undefined;
    monaco.editor.setModelMarkers(editorModel, OWNER, []);
    report({ state: 'not checked', text: why });
}

// ---------------- Z3 ----------------

let z3: Promise<Z3Context> | undefined;

/** Loads Z3 once: its script, its WebAssembly, and a context to build formulas in. */
function loadZ3(): Promise<Z3Context> {
    z3 ??= (async () => {
        if (!await crossOriginIsolation) {
            throw new Error('the page is not cross-origin isolated (serve it with the COOP/COEP headers, or over HTTPS so that its service worker adds them), so Z3 cannot start its threads');
        }
        report({ state: 'loading', text: 'Loading Z3…' });
        const start = performance.now();
        await loadScript(new URL('z3/z3-built.js', document.baseURI).href);
        const lowLevel = await initLowLevel(window.initZ3);
        const { Context } = withDeferredFrees(() => createApi(lowLevel.Z3, lowLevel.em));
        console.info(`Z3 loaded in ${Math.round(performance.now() - start)} ms`);
        return new Context('main');
    })();
    return z3;
}

/**
 * z3-solver frees Z3 objects from FinalizationRegistry callbacks, which the browser runs whenever it collects
 * garbage, also while solver.check() works in a Z3 thread. Two threads in one Z3 context corrupt its memory
 * ("memory access out of bounds"), so z3-solver's registry only queues the frees, and freeGarbage() runs them
 * between checks.
 */
const deferredFrees: Array<() => void> = [];

class DeferredFinalizationRegistry<T> extends FinalizationRegistry<T> {
    constructor(free: (heldValue: T) => void) {
        super(heldValue => deferredFrees.push(() => free(heldValue)));
    }
}

/** `create()`, with DeferredFinalizationRegistry as FinalizationRegistry: z3-solver makes its registry in createApi. */
function withDeferredFrees<T>(create: () => T): T {
    const original = globalThis.FinalizationRegistry;
    globalThis.FinalizationRegistry = DeferredFinalizationRegistry;
    try {
        return create();
    } finally {
        globalThis.FinalizationRegistry = original;
    }
}

/** Frees the Z3 objects collected since the last time; only call it when no Z3 call is in flight. */
function freeGarbage(): void {
    deferredFrees.splice(0).forEach(free => free());
}

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`cannot load ${src}`));
        document.head.append(script);
    });
}

// ---------------- The checks ----------------

interface CheckResult {
    markers: monaco.editor.IMarkerData[];
    summary: string;
    graph: DcrGraph;
}

/**
 * 1. the specifications, all together as rules: each head that can never hold is an error;
 * 2. each scenario on its own: a Given that can never hold with its When action enabled, or a Then that can never hold
 *    with its When action executed, is an error;
 * 3. the scenarios with the same When, of those that hold on their own: a group that can apply together (at some
 *    input) but whose Thens cannot hold together is an error;
 * 4. the DCR graph, for the pane right of the editor (built as if there were no problems).
 * Stops early, without a result, once `stale` says a newer text is waiting.
 */
async function runChecks(z3: Z3Context, model: EasyModel.Model, locations: Locations, uri: monaco.Uri, stale: () => boolean): Promise<CheckResult | undefined> {
    const markers: monaco.editor.IMarkerData[] = [];
    const lap = stopwatch();

    const specifications = await checkConsistency(z3, model);
    const consistency = lap();
    specifications.filter(({ result }) => result !== 'sat').forEach(result => markers.push(specificationMarker(result, locations, uri)));

    if (stale()) {
        return undefined;
    }
    const scenarios = await checkScenarios(z3, model);
    const scenarioTime = lap();
    scenarios.forEach((result, i) => markers.push(...scenarioMarkers(result, i, locations, uri)));

    if (stale()) {
        return undefined;
    }
    const groups = await checkCrossScenarios(z3, model, undefined, scenarios);
    const crossTime = lap();
    groups.forEach(group => markers.push(crossScenarioMarker(group, locations, uri)));

    if (stale()) {
        return undefined;
    }
    const graph = await toDcrGraph(z3, model);   // not a check: its time is not in the summary
    return {
        markers,
        graph,
        // the scenarios' time: each scenario on its own, and the scenarios with the same When against each other
        summary: `Checked in ${consistency + scenarioTime + crossTime} ms · consistency ${consistency} ms · scenarios ${scenarioTime + crossTime} ms`
    };
}

/** 'Printer is busy' can never hold: it conflicts with 'print is enabled'. */
function specificationMarker({ specification, result, conflict }: ConsistencyResult, locations: Locations, uri: monaco.Uri): monaco.editor.IMarkerData {
    if (result === 'unknown') {
        return marker('warning', `Z3 cannot decide whether '${specification}' can hold.`, locations.specification(specification));
    }
    const others = conflict.filter(title => title !== specification);
    const message = others.length === 0
        ? `'${specification}' can never hold: its conditions contradict each other.`
        : `'${specification}' can never hold: it conflicts with ${others.map(title => `'${title}'`).join(', ')}.`;
    return marker('error', message, locations.specification(specification), related(others, locations, uri));
}

/** A Given that can never hold, with the When action enabled, or a Then, with it executed; the conflict lists what contradicts. */
function scenarioMarkers({ scenario, given, then }: ScenarioResult, index: number, locations: Locations, uri: monaco.Uri): monaco.editor.IMarkerData[] {
    const parts = [['Given', given], ['Then', then]] as const;
    return parts.filter(([, check]) => check.result !== 'sat').map(([part, check]) => {
        const message = check.result === 'unknown'
            ? `Z3 cannot decide whether the ${part} of '${scenario}' can hold.`
            : [`The ${part} of '${scenario}' can never hold:`, ...check.conflict.map(title => `  ${title}`)].join('\n');
        // 'spec: Printer is busy', or at the Then's time 'spec: Printer is busy (after)'
        const specifications = [...new Set(check.conflict.filter(title => title.startsWith('spec: '))
            .map(title => title.slice('spec: '.length).replace(/ \(after\)$/, '')))];
        return marker(check.result === 'unknown' ? 'warning' : 'error', message, locations.keyword(index, part), related(specifications, locations, uri));
    });
}

/**
 * Scenarios with the same When that can apply together, at the inputs, but whose Thens contradict: on the Then of the
 * first, with links to the Thens of the others.
 */
function crossScenarioMarker({ scenarios, indices: [first, ...others], inputs, conflict }: CrossScenarioResult, locations: Locations, uri: monaco.Uri): monaco.editor.IMarkerData {
    const at = inputs.length > 0 ? ` (${inputs.join('; ')})` : '';
    const message = [`${and(scenarios.map(name => `'${name}'`))} have the same When and can apply together${at}, but their Thens contradict:`,
        ...conflict.map(title => `  ${title}`)].join('\n');
    const thens = others.map((index, k) => ({ resource: uri, message: `the Then of '${scenarios[k + 1]}'`, ...locations.keyword(index, 'Then') }));
    return marker('error', message, locations.keyword(first, 'Then'), thens);
}

function marker(severity: 'error' | 'warning', message: string, range: monaco.IRange, relatedInformation?: monaco.editor.IRelatedInformation[]): monaco.editor.IMarkerData {
    return { severity: severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message, source: 'z3', relatedInformation, ...range };
}

/** Links to the specifications a problem names, shown under it. */
function related(specifications: string[], locations: Locations, uri: monaco.Uri): monaco.editor.IRelatedInformation[] {
    return specifications.map(title => ({ resource: uri, message: `'${title}'`, ...locations.specification(title) }));
}

/** 'a' and 'b'; 'a', 'b' and 'c' */
function and(items: string[]): string {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Milliseconds since the last lap. */
function stopwatch(): () => number {
    let last = performance.now();
    return () => {
        const now = performance.now();
        const lap = Math.round(now - last);
        last = now;
        return lap;
    };
}

// ---------------- Where the checked parts are in the text ----------------

interface Locations {
    /** The head of a specification, by its title: 'Printer is busy' (Declarative specification Printer is busy), 'print is enabled' (Action print is enabled). */
    specification(title: string): monaco.IRange;
    /** The Given or Then keyword of the i-th scenario. */
    keyword(scenario: number, keyword: 'Given' | 'Then'): monaco.IRange;
}

/** The model lists the specifications and scenarios in the order of the document, so the i-th of each kind matches. */
function locate(document: LangiumDocument, model: EasyModel.Model): Locations {
    const root = document.parseResult.value as ModelNode;
    const start: monaco.IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
    const heads = new Map<string, monaco.IRange>();
    const head = (title: string, from?: { line: number, character: number }, to?: { line: number, character: number }) => {
        if (from && to) {
            heads.set(title, toMonacoRange({ start: from, end: to }));
        }
    };
    root.elements.filter(isDeclarativeSpec).forEach((node, i) =>
        head(model.stateSpecifications[i].title, node.$cstNode?.range.start, node.state.$refNode?.range.end));
    root.elements.filter(isEnabledSpec).forEach((node, i) =>
        head(model.enabledSpecifications[i].title, node.$cstNode?.range.start, GrammarUtils.findNodeForKeyword(node.$cstNode, 'enabled')?.range.end));
    // a scenario's name can have the keyword Then, so its own Then is the last
    const keywords = root.elements.filter(isScenario).map(node => ({
        Given: GrammarUtils.findNodeForKeyword(node.$cstNode, 'Given')?.range,
        Then: GrammarUtils.findNodesForKeyword(node.$cstNode, 'Then').at(-1)?.range
    }));
    return {
        specification: title => heads.get(title) ?? start,
        keyword: (scenario, keyword) => {
            const range = keywords[scenario]?.[keyword];
            return range ? toMonacoRange(range) : start;
        }
    };
}
