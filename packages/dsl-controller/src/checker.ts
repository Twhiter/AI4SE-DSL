// Checks a DSL easy document for an LLM, as the editor does: syntax and validation (easy-language's parser and
// validator), then, without errors, the Z3 checks: the specifications together, each scenario on its own, and the
// scenarios with the same When against each other. The problems come one by one, so that a simulation can tell a
// syntax mistake from an inconsistency, or as text the LLM can act on. One check runs at a time, and the Z3 objects
// collected meanwhile are freed after it (as in packages/extension/src/language/z3-checks.ts).

// FinalizationRegistry, for those frees:
/// <reference lib="es2021.weakref" />

import { DocumentValidator, EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { killThreads } from 'z3-solver';
import { createApi } from 'z3-solver/build/high-level/index.js';
import { init as initLowLevel } from 'z3-solver/build/low-level/index.js';
// @ts-expect-error: z3-solver has no types for its Emscripten module
import initModule from 'z3-solver/build/z3-built.js';
import {
    buildModel, checkConsistency, checkCrossScenarios, checkScenarios, createEasyServices, type EasyModel, type Z3Context
} from 'easy-language';

/** A problem of a document. */
export interface Problem {
    severity: 'error' | 'warning';
    /** syntax: the text does not follow the grammar; validation: names that do not resolve, rules; z3: the Z3 checks. */
    kind: 'syntax' | 'validation' | 'z3';
    /** Where it is, for syntax and validation problems: line and column, from 1. */
    at?: { line: number, column: number };
    message: string;
}

type Diagnostic = NonNullable<LangiumDocument['diagnostics']>[number];

const { shared } = createEasyServices(EmptyFileSystem);
let checked = 0;

let z3: Promise<{ em: unknown, context: Z3Context }> | undefined;

/**
 * The checks, one after the other: each waits for the one before. A document's names are in the shared index while it
 * is checked, so that another document checked at the same time would link to them, and Z3 runs one check at a time.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Z3, started on the first check that needs it. */
function startZ3() {
    z3 ??= (async () => {
        const { Z3, em } = await initLowLevel(initModule);
        const { Context } = withDeferredFrees(() => createApi(Z3, em));
        return { em, context: new Context('main') };
    })();
    return z3;
}

/** Stops Z3's threads, after the check under way, so that a script can end; the next check starts it again. */
export async function stopChecker(): Promise<void> {
    await queue;
    if (z3) {
        const { em } = await z3;
        z3 = undefined;
        await killThreads(em);
    }
}

/**
 * z3-solver frees Z3 objects from FinalizationRegistry callbacks, which Node runs whenever it collects garbage, also
 * while solver.check() works in a Z3 thread. Two threads in one Z3 context corrupt its memory (Z3 then fails, or never
 * ends), so z3-solver's registry only queues the frees, and they run between checks.
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

/** `check()` after the checks before it, then the Z3 objects collected meanwhile are freed: no Z3 call is in flight. */
function oneAtATime<T>(check: () => Promise<T>): Promise<T> {
    const result = queue.then(check).finally(() => deferredFrees.splice(0).forEach(free => free()));
    queue = result.catch(() => undefined);
    return result;
}

/** The check_document tool's answer: the problems of `text`, one per line, or "No problems." */
export async function checkDocument(text: string): Promise<string> {
    return describeProblems(await findProblems(text));
}

/** The problems of `text`: its syntax and validation problems, and, when it has no errors, what Z3 finds. */
export function findProblems(text: string): Promise<Problem[]> {
    return oneAtATime(() => problemsOf(text));
}

/** findProblems(), when no other check runs. */
async function problemsOf(text: string): Promise<Problem[]> {
    const { LangiumDocumentFactory, LangiumDocuments, DocumentBuilder } = shared.workspace;
    const uri = URI.parse(`memory:///check-${++checked}.easy`);
    const document = LangiumDocumentFactory.fromString(text, uri);
    LangiumDocuments.addDocument(document);
    try {
        await DocumentBuilder.build([document], { validation: true });
        const problems = (document.diagnostics ?? []).map(languageProblem);
        const { model } = buildModel(document);   // only without errors
        if (model) {
            problems.push(...await z3Problems(model));
        }
        return problems;
    } finally {
        // through the builder, so that its names leave the index too: the next check must not link to them
        await DocumentBuilder.update([], [uri]);
    }
}

/** The problems, one per line ("error at 4:12: …", "warning: Z3: …"), or "No problems." */
export function describeProblems(problems: Problem[]): string {
    if (problems.length === 0) {
        return 'No problems.';
    }
    const lines = problems.map(describeProblem);
    if (problems.some(({ severity, kind }) => severity === 'error' && kind !== 'z3')) {
        lines.push('(The Z3 checks run once there are no errors.)');
    }
    return lines.join('\n');
}

/** "error at 4:12: …", or "warning: Z3: …" */
export function describeProblem({ severity, at, message }: Problem): string {
    return `${severity}${at ? ` at ${at.line}:${at.column}` : ''}: ${message}`;
}

function languageProblem({ severity, range, message, data }: Diagnostic): Problem {
    const syntax = [DocumentValidator.LexingError, DocumentValidator.ParsingError].includes(data?.code);
    return {
        severity: severity === 1 ? 'error' : 'warning',
        kind: syntax ? 'syntax' : 'validation',
        at: { line: range.start.line + 1, column: range.start.character + 1 },
        message: typeof message === 'string' ? message : message.value
    };
}

/** What Z3 finds: a specification or a scenario part that can never hold, and scenarios whose Thens contradict. */
async function z3Problems(model: EasyModel.Model): Promise<Problem[]> {
    const { context } = await startZ3();
    const problems: Problem[] = [];
    const error = (message: string) => problems.push({ severity: 'error', kind: 'z3', message: `Z3: ${message}` });
    const warning = (message: string) => problems.push({ severity: 'warning', kind: 'z3', message: `Z3: ${message}` });

    for (const { specification, result, conflict } of await checkConsistency(context, model)) {
        if (result === 'unknown') {
            warning(`cannot decide whether '${specification}' can hold.`);
        } else if (result === 'unsat') {
            const others = conflict.filter(title => title !== specification);
            error(others.length === 0
                ? `'${specification}' can never hold: its conditions contradict each other.`
                : `'${specification}' can never hold: it conflicts with ${others.map(title => `'${title}'`).join(', ')}.`);
        }
    }
    const scenarios = await checkScenarios(context, model);
    for (const { scenario, given, then } of scenarios) {
        for (const [part, check] of [['Given', given], ['Then', then]] as const) {
            if (check.result === 'unknown') {
                warning(`cannot decide whether the ${part} of '${scenario}' can hold.`);
            } else if (check.result === 'unsat') {
                error([`the ${part} of '${scenario}' can never hold; these contradict:`, ...check.conflict.map(title => `  ${title}`)].join('\n'));
            }
        }
    }
    for (const { scenarios: names, inputs, conflict } of await checkCrossScenarios(context, model, undefined, scenarios)) {
        const at = inputs.length > 0 ? ` (${inputs.join('; ')})` : '';
        error([`${names.map(name => `'${name}'`).join(' and ')} have the same When and can apply together${at}, but their Thens contradict:`,
            ...conflict.map(title => `  ${title}`)].join('\n'));
    }
    return problems;
}
