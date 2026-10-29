// The Z3 checks of the language server, as the browser editor runs them (packages/web/src/checks.ts): after every
// validation of a document without errors, the Declarative and enabled specifications together, each scenario on its
// own, and the scenarios with the same When against each other. Their problems are sent with the language's own
// diagnostics, so VS Code underlines them and its Problems panel lists them; then the document's DCR graph goes to the
// extension (DCR_GRAPH), for its DCR graph panel. A document with errors gets no Z3 problems, and its graph is out of
// date. One check runs at a time; a check of a text that changed meanwhile is dropped, and a text checked before is
// not checked again (Langium validates a document again when another one changes).
// Z3 is z3-solver's WebAssembly, left out of the bundle (esbuild.mjs), as it starts its threads from its own files.

import { DocumentState, GrammarUtils, type LangiumDocument, type LangiumSharedCoreServices } from 'langium';
import type { Connection, Diagnostic, DiagnosticRelatedInformation, Position, Range } from 'vscode-languageserver';
import { createApi } from 'z3-solver/build/high-level/index.js';
import { init as initLowLevel } from 'z3-solver/build/low-level/index.js';
// @ts-expect-error: z3-solver has no types for its Emscripten module
import initModule from 'z3-solver/build/z3-built.js';
import {
    buildModel, checkConsistency, checkCrossScenarios, checkScenarios, isDeclarativeSpec, isEnabledSpec, isScenario, toDcrGraph,
    type ConsistencyResult, type CrossScenarioResult, type DcrGraph, type EasyModel, type Model as ModelNode, type ScenarioResult, type Z3Context
} from 'easy-language';
import { DCR_GRAPH, type DcrGraphParams } from '../protocol.js';

/** A text that was checked: its Z3 problems and its DCR graph. */
interface Checked {
    text: string;
    diagnostics: Diagnostic[];
    graph: DcrGraph;
}

/** Checks every document Langium validates, and sends what the checks find to the client of `connection`. */
export function startZ3Checks(connection: Connection, shared: LangiumSharedCoreServices): void {
    /** The text of each document as it was validated last. */
    const latest = new Map<string, string>();
    const checked = new Map<string, Checked>();
    let queue: Promise<void> = Promise.resolve();
    const sendGraph = (params: DcrGraphParams) => void connection.sendNotification(DCR_GRAPH, params);

    // after Langium's own listener (startLanguageServer), which sends the language's diagnostics
    shared.workspace.DocumentBuilder.onDocumentPhase(DocumentState.Validated, document => {
        const uri = document.uri.toString();
        const text = document.textDocument.getText();
        latest.set(uri, text);
        const { model } = buildModel(document);   // only without errors
        if (!model) {
            sendGraph({ uri, outOfDate: 'fix the errors first' });
            return;
        }
        const language = document.diagnostics ?? [];
        const locations = locate(document, model);   // now, as the next build replaces the document
        const stale = () => latest.get(uri) !== text;
        queue = queue.then(async () => {
            if (stale()) {
                return;
            }
            let result = checked.get(uri);
            if (result?.text !== text) {
                const found = await runChecks(await loadZ3(), model, locations, uri, stale);
                if (!found) {
                    return;
                }
                result = { text, ...found };
                checked.set(uri, result);
            }
            if (!stale()) {
                void connection.sendDiagnostics({ uri, diagnostics: [...language, ...result.diagnostics] });
                sendGraph({ uri, graph: result.graph });
            }
        }).catch((error: unknown) => {
            const message = `Z3 failed: ${error instanceof Error ? error.message : String(error)}`;
            connection.console.error(message);
            if (!stale()) {
                sendGraph({ uri, outOfDate: message });
            }
        }).finally(freeGarbage);   // no Z3 call is in flight between checks
    });
    shared.workspace.DocumentBuilder.onUpdate((_changed, deleted) => deleted.forEach(uri => {
        latest.delete(uri.toString());
        checked.delete(uri.toString());
    }));
}

// ---------------- Z3 ----------------

let z3: Promise<Z3Context> | undefined;

/** Starts Z3 once, on the first check: its WebAssembly, and a context to build formulas in. */
function loadZ3(): Promise<Z3Context> {
    z3 ??= (async () => {
        const lowLevel = await initLowLevel(initModule);
        const { Context } = withDeferredFrees(() => createApi(lowLevel.Z3, lowLevel.em));
        return new Context('main');
    })();
    return z3;
}

/**
 * z3-solver frees Z3 objects from FinalizationRegistry callbacks, which Node runs whenever it collects garbage, also
 * while solver.check() works in a Z3 thread. Two threads in one Z3 context corrupt its memory, so z3-solver's registry
 * only queues the frees, and freeGarbage() runs them between checks (as in packages/web/src/checks.ts).
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

// ---------------- The checks ----------------

/**
 * 1. the specifications, all together as rules: each head that can never hold is an error;
 * 2. each scenario on its own: a Given that can never hold with its When action enabled, or a Then that can never hold
 *    with its When action executed, is an error;
 * 3. the scenarios with the same When, of those that hold on their own: a group that can apply together (at some
 *    input) but whose Thens cannot hold together is an error;
 * 4. the DCR graph, for the DCR graph panel (built as if there were no problems).
 * Stops early, without a result, once `stale` says a newer text is waiting.
 */
async function runChecks(z3: Z3Context, model: EasyModel.Model, locations: Locations, uri: string, stale: () => boolean): Promise<Omit<Checked, 'text'> | undefined> {
    const diagnostics: Diagnostic[] = [];

    const specifications = await checkConsistency(z3, model);
    specifications.filter(({ result }) => result !== 'sat').forEach(result => diagnostics.push(specificationDiagnostic(result, locations, uri)));
    if (stale()) {
        return undefined;
    }
    const scenarios = await checkScenarios(z3, model);
    scenarios.forEach((result, i) => diagnostics.push(...scenarioDiagnostics(result, i, locations, uri)));
    if (stale()) {
        return undefined;
    }
    const groups = await checkCrossScenarios(z3, model, undefined, scenarios);
    groups.forEach(group => diagnostics.push(crossScenarioDiagnostic(group, locations, uri)));
    if (stale()) {
        return undefined;
    }
    return { diagnostics, graph: await toDcrGraph(z3, model) };
}

/** 'Printer is busy' can never hold: it conflicts with 'print is enabled'. */
function specificationDiagnostic({ specification, result, conflict }: ConsistencyResult, locations: Locations, uri: string): Diagnostic {
    if (result === 'unknown') {
        return diagnostic('warning', `Z3 cannot decide whether '${specification}' can hold.`, locations.specification(specification));
    }
    const others = conflict.filter(title => title !== specification);
    const message = others.length === 0
        ? `'${specification}' can never hold: its conditions contradict each other.`
        : `'${specification}' can never hold: it conflicts with ${others.map(title => `'${title}'`).join(', ')}.`;
    return diagnostic('error', message, locations.specification(specification), related(others, locations, uri));
}

/** A Given that can never hold, with the When action enabled, or a Then, with it executed; the conflict lists what contradicts. */
function scenarioDiagnostics({ scenario, given, then }: ScenarioResult, index: number, locations: Locations, uri: string): Diagnostic[] {
    const parts = [['Given', given], ['Then', then]] as const;
    return parts.filter(([, check]) => check.result !== 'sat').map(([part, check]) => {
        const message = check.result === 'unknown'
            ? `Z3 cannot decide whether the ${part} of '${scenario}' can hold.`
            : [`The ${part} of '${scenario}' can never hold:`, ...check.conflict.map(title => `  ${title}`)].join('\n');
        // 'spec: Printer is busy', or at the Then's time 'spec: Printer is busy (after)'
        const specifications = [...new Set(check.conflict.filter(title => title.startsWith('spec: '))
            .map(title => title.slice('spec: '.length).replace(/ \(after\)$/, '')))];
        return diagnostic(check.result === 'unknown' ? 'warning' : 'error', message, locations.keyword(index, part), related(specifications, locations, uri));
    });
}

/**
 * Scenarios with the same When that can apply together, at the inputs, but whose Thens contradict: on the Then of the
 * first, with links to the Thens of the others.
 */
function crossScenarioDiagnostic({ scenarios, indices: [first, ...others], inputs, conflict }: CrossScenarioResult, locations: Locations, uri: string): Diagnostic {
    const at = inputs.length > 0 ? ` (${inputs.join('; ')})` : '';
    const message = [`${and(scenarios.map(name => `'${name}'`))} have the same When and can apply together${at}, but their Thens contradict:`,
        ...conflict.map(title => `  ${title}`)].join('\n');
    const thens = others.map((index, k) => ({ location: { uri, range: locations.keyword(index, 'Then') }, message: `the Then of '${scenarios[k + 1]}'` }));
    return diagnostic('error', message, locations.keyword(first, 'Then'), thens);
}

function diagnostic(severity: 'error' | 'warning', message: string, range: Range, relatedInformation?: DiagnosticRelatedInformation[]): Diagnostic {
    return { severity: severity === 'error' ? 1 : 2, message, source: 'z3', range, relatedInformation };
}

/** Links to the specifications a problem names, shown under it. */
function related(specifications: string[], locations: Locations, uri: string): DiagnosticRelatedInformation[] {
    return specifications.map(title => ({ location: { uri, range: locations.specification(title) }, message: `'${title}'` }));
}

/** 'a' and 'b'; 'a', 'b' and 'c' */
function and(items: string[]): string {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------- Where the checked parts are in the text ----------------

interface Locations {
    /** The head of a specification, by its title: 'Printer is busy' (Declarative specification Printer is busy), 'print is enabled' (Action print is enabled). */
    specification(title: string): Range;
    /** The Given or Then keyword of the i-th scenario. */
    keyword(scenario: number, keyword: 'Given' | 'Then'): Range;
}

/** The model lists the specifications and scenarios in the order of the document, so the i-th of each kind matches. */
function locate(document: LangiumDocument, model: EasyModel.Model): Locations {
    const root = document.parseResult.value as ModelNode;
    const start: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const heads = new Map<string, Range>();
    const head = (title: string, from?: Position, to?: Position) => {
        if (from && to) {
            heads.set(title, { start: from, end: to });
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
        keyword: (scenario, keyword) => keywords[scenario]?.[keyword] ?? start
    };
}
