import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { init, killThreads, type Bool } from 'z3-solver';
import { createEasyServices } from '../src/easy-module.js';
import { buildModel } from '../src/model-builder.js';
import { NamedConstant, PropertyAssertion, PropertyAssignment, type Model } from '../src/model.js';
import { Z3Vocabulary, type Instance, type Z3Context } from '../src/z3-vocabulary.js';

const DECLARATIONS = `
Entity Printer {
    Actions: start, print
    Data properties: speed: int, label: string, ready: boolean, note: Any, jobs: a list, waiting: a queue, backlog: a queue,
        counts: a list of int, names: a queue of string
    States: online, busy
}
Entity Tray { Data properties: sheets: int  States: low }
Role Operator.
Action start { Initiators: Operator }
Action print { Initiators: Operator }
Action reboot { Initiators: Operator }

Declarative specification Printer is busy means {
    print is pending AND reboot was not executed AND it is online AND the jobs is not empty
}
print is available means {
    the ready equal to true AND start was executed AND it is online
}
reboot is enabled means { reboot is not pending }
start is enabled means { print was executed }
Declarative specification Printer is online means { the speed larger than 0 }
Declarative specification Tray is low means { the sheets smaller than 10 }
`;

const EMPTY_LIST = '((as const (Array Value Bool)) false)';

let api: Awaited<ReturnType<typeof init>>;
let z3: Z3Context;
let model: Model;
let v: Z3Vocabulary;
let p: Instance;

beforeAll(async () => {
    api = await init();
    z3 = new api.Context('main');
    model = buildModel(await parseHelper(createEasyServices(EmptyFileSystem).Easy)(DECLARATIONS, { validation: true })).model!;
    v = new Z3Vocabulary(z3, model);
    p = v.instance('Printer', 'p');
});

afterAll(async () => {
    await killThreads(api.em);
});

const assertion = (property: string, operation: PropertyAssertion['operation'], value?: PropertyAssertion['value'], negated = false) =>
    new PropertyAssertion('Printer', property, negated, operation, value).toZ3(v, p);
const assignment = (property: string, operation: PropertyAssignment['operation'], value?: PropertyAssignment['value'], constant?: NamedConstant) =>
    new PropertyAssignment('Printer', property, operation, value, constant).toZ3(v, p);

/** The formula on one line. */
function text(formula: Bool): string {
    return formula.toString().replace(/\s+/g, ' ');
}

/** head ⇒ c₁ ∧ c₂ ∧ … as its head and its conditions, each on one line (Z3 prints long formulas with 'let'). */
function parts(formula: Bool): { head: string, conditions: string[] } {
    const [head, conditions] = formula.children() as Bool[];
    return { head: text(head), conditions: conditions.children().map(condition => text(condition as Bool)) };
}

/** Can all `formulas` hold at once, with the rules of the language for the terms they use? */
async function check(...formulas: Bool[]): Promise<string> {
    const solver = new z3.Solver();
    solver.add(...formulas, ...v.constraints());
    return solver.check();
}

describe('toZ3 of property assertions', () => {

    it('compares an int, string or boolean property with a value of its type', () => {
        expect(text(assertion('speed', 'larger than', 3))).toBe('(> (speed p) 3)');
        expect(text(assertion('speed', 'smaller than', 3, true))).toBe('(not (< (speed p) 3))');
        expect(text(assertion('label', 'equal to', 'a'))).toBe('(= (label p) "a")');
        expect(text(assertion('ready', 'equal to', true))).toBe('(= (ready p) true)');
    });

    it('turns list assertions into set membership, emptiness and size', () => {
        expect(text(assertion('jobs', 'included in', 'a'))).toBe('(select (jobs p) (str "a"))');
        expect(text(assertion('jobs', 'included in', 3, true))).toBe('(not (select (jobs p) (int 3)))');
        expect(text(assertion('jobs', 'empty'))).toBe(`(= (jobs p) ${EMPTY_LIST})`);
        expect(text(assertion('jobs', 'full'))).toBe('(>= (size (jobs p)) 9999)');
    });

    it('turns queue assertions into slots 0 … size − 1', () => {
        expect(text(assertion('waiting', 'included in', 'a')))
            .toBe('(exists ((slot Int)) (and (>= slot 0) (< slot (|waiting size| p)) (= (select (|waiting items| p) slot) (str "a"))))');
        expect(text(assertion('waiting', 'empty'))).toBe('(= (|waiting size| p) 0)');
        expect(text(assertion('waiting', 'full', undefined, true))).toBe('(not (>= (|waiting size| p) 9999))');
    });
});

describe('toZ3 of property assignments', () => {

    it('says what holds once it is done', () => {
        expect(text(assignment('speed', 'set to', 5))).toBe('(= (speed p) 5)');
        expect(text(assignment('jobs', 'added with', 'a'))).toBe('(select (jobs p) (str "a"))');
        expect(text(assignment('jobs', 'removed with', true))).toBe('(not (select (jobs p) (bool true)))');
        // Z3 prints long formulas with 'let', so the two parts of the 'and' are compared on their own
        expect(assignment('waiting', 'enqueued with', 'a').children().map(part => text(part as Bool)))
            .toEqual(['(>= (|waiting size| p) 1)', '(= (select (|waiting items| p) (- (|waiting size| p) 1)) (str "a"))']);
        expect(text(assignment('waiting', 'dequeued'))).toBe('(not (>= (|waiting size| p) 9999))');
    });
});

describe('toZ3 of specifications', () => {

    it('turns a state specification into inState(x, state) ⇒ its conditions', () => {
        const [busy] = model.stateSpecifications;
        expect(parts(busy.toZ3(v, p))).toEqual({
            head: '(inState p busy)',
            conditions: [
                '(pending p print)',            // print is in the Printer's lifecycle
                '(not (executed reboot))',      // reboot is in no lifecycle
                '(inState p online)',           // it is online
                `(not (= (jobs p) ${EMPTY_LIST}))`
            ]
        });
        expect(busy.conditions(v, p).map(condition => condition.title))
            .toEqual(['print is pending', 'reboot was not executed', 'the Printer is online', "the Printer's jobs is not empty"]);
    });

    it('turns an action specification into (¬)status(x, action) ⇒ its conditions', () => {
        const [print, reboot] = model.actionSpecifications;
        expect(print.title).toBe('print is available');
        expect(parts(print.toZ3(v, p))).toEqual({
            head: '(available p print)',
            conditions: ['(executed p start)', '(inState p online)', '(= (ready p) true)']
        });
        // an action in no lifecycle has no instance
        expect(text(reboot.toZ3(v))).toBe('(=> (enabled reboot) (not (pending reboot)))');
    });

    it('needs an instance of the entity the specification is about', () => {
        const [busy] = model.stateSpecifications;
        const [print] = model.actionSpecifications;
        expect(() => busy.toZ3(v, v.instance('Tray', 't'))).toThrow("'Printer is busy' is about a Printer, but t is a Tray.");
        expect(() => print.toZ3(v)).toThrow("'print' is in the lifecycle of the Printer, so its status needs an instance of it.");
    });

    it('translates every specification of the example', async () => {
        const example = buildModel(await parseHelper(createEasyServices(EmptyFileSystem).Easy)(readFileSync('../../examples/sample.easy', 'utf8'), { validation: true })).model!;
        const vocabulary = new Z3Vocabulary(z3, example);
        const printer = vocabulary.instance('Printer', 'printer');
        const formulas = [
            ...example.stateSpecifications.map(spec => spec.toZ3(vocabulary, printer)),
            ...example.actionSpecifications.map(spec => spec.toZ3(vocabulary, vocabulary.lifecycleOf(spec.action) ? printer : undefined))
        ];
        expect(formulas).toHaveLength(5);
        const solver = new z3.Solver();
        solver.add(...formulas, vocabulary.inState(printer, 'busy'), ...vocabulary.constraints());
        expect(await solver.check()).toBe('sat');
    });
});

describe('checking with Z3', () => {

    it('enforces the conditions of a state when it holds', async () => {
        const [busy] = model.stateSpecifications;
        expect(await check(busy.toZ3(v, p), v.inState(p, 'busy'))).toBe('sat');
        expect(await check(busy.toZ3(v, p), v.inState(p, 'busy'), assertion('jobs', 'empty'))).toBe('unsat');
    });

    it('makes an enabled action available, with or without an enabled specification', async () => {
        const start = model.actionSpecifications[2];
        expect(text(start.toZ3(v, p))).toBe('(=> (enabled p start) (executed p print))');   // the specification is only what it says
        expect(v.constraints().map(text)).toContain('(=> (enabled p start) (available p start))');
        expect(await check(v.status('enabled', 'start', p), z3.Not(v.status('available', 'start', p)))).toBe('unsat');
        expect(await check(v.status('enabled', 'print', p), z3.Not(v.status('available', 'print', p)))).toBe('unsat');      // no 'print is enabled' specification
        expect(await check(v.status('enabled', 'reboot', undefined), z3.Not(v.status('available', 'reboot', undefined)))).toBe('unsat');
        expect(await check(v.status('available', 'print', p), z3.Not(v.status('enabled', 'print', p)))).toBe('sat');     // available, not enabled
    });

    it('enforces the conditions of an action status when it holds', async () => {
        const [print] = model.actionSpecifications;
        const available = v.status('available', 'print', p);
        expect(await check(print.toZ3(v, p), available)).toBe('sat');
        expect(await check(print.toZ3(v, p), available, assertion('ready', 'equal to', false))).toBe('unsat');
        expect(await check(print.toZ3(v, p), available, z3.Not(v.status('executed', 'start', p)))).toBe('unsat');
    });


    it('keeps list elements of different types apart', async () => {
        expect(await check(assertion('jobs', 'included in', '1'), assertion('jobs', 'included in', 1, true))).toBe('sat');
        expect(await check(assertion('jobs', 'included in', 'a'), assertion('jobs', 'empty'))).toBe('unsat');
        expect(await check(assertion('jobs', 'full'), assertion('jobs', 'empty'))).toBe('unsat');
    });

    it('makes an enqueued value the last element of the queue', async () => {
        expect(await check(assignment('waiting', 'enqueued with', 'a'), assertion('waiting', 'included in', 'a', true))).toBe('unsat');
        expect(await check(assignment('waiting', 'enqueued with', 'a'), assertion('waiting', 'empty'))).toBe('unsat');
    });

    it('leaves a dequeued queue not full', async () => {
        expect(await check(assignment('waiting', 'dequeued'), assertion('waiting', 'full'))).toBe('unsat');
        expect(await check(assignment('waiting', 'dequeued'), assertion('waiting', 'empty'))).toBe('sat');
    });

    it('counts the elements of a queue, which take its slots', async () => {
        const fiveValues = (vocabulary: Z3Vocabulary, x: Instance) =>
            [1, 2, 3, 4, 5].map(n => new PropertyAssertion('Printer', 'waiting', false, 'included in', n).toZ3(vocabulary, x));
        const small = new Z3Vocabulary(z3, model, { capacity: 3 });
        const q = small.instance('Printer', 'q');
        const solver = new z3.Solver();
        solver.add(...fiveValues(small, q), ...small.constraints());
        expect(await solver.check()).toBe('unsat');        // 5 different values do not fit in 3 slots
        expect(await check(...fiveValues(v, p))).toBe('sat');   // they fit in 9999
    });

    it('keeps the elements of a typed list or queue in their own sort, and wraps a value for Any', () => {
        expect(text(assertion('counts', 'included in', 3))).toBe('(select (counts p) 3)');
        expect(text(assignment('names', 'enqueued with', 'a')).includes('(= (select (|names items| p) (- (|names size| p) 1)) "a")')).toBe(true);
        expect(text(assertion('note', 'equal to', 3))).toBe('(= (note p) (int 3))');
        expect(text(assertion('jobs', 'included in', 'a'))).toBe('(select (jobs p) (str "a"))');   // a list of Any
    });

    it('uses a named constant as a Z3 constant of its type, and converts it where another type is taken', async () => {
        const any = new NamedConstant('job', 'Any');
        const text_ = new NamedConstant('name', 'string');
        expect(text(assignment('jobs', 'added with', any))).toBe('(select (jobs p) job)');                  // Any into Any: as it is
        expect(text(assignment('note', 'set to', text_))).toBe('(= (note p) (str name))');                 // a string into Any: wrapped
        expect(await check(assignment('speed', 'set to', any))).toBe('sat');                               // Any into an int: if it is one
        expect(await check(assignment('speed', 'set to', any), assignment('names', 'enqueued with', any))).toBe('unsat');   // an int and a string
        expect(await check(assignment('speed', 'set to', text_))).toBe('unsat');                           // a string is never an int
        expect(await check(assignment('waiting', 'dequeued', undefined, any), assignment('backlog', 'enqueued with', any))).toBe('sat');
    });

    it('stays fast at the capacity 9999', async () => {
        const start = Date.now();
        expect(await check(assertion('waiting', 'full'), assertion('waiting', 'included in', 'a', true))).toBe('sat');
        expect(Date.now() - start).toBeLessThan(5000);
    });
});
