// Readable syntax errors for the Easy language, registered in EasyModule (easy-module.ts).

import { GrammarAST, LangiumParserErrorMessageProvider, type LangiumCoreServices } from 'langium';

type MismatchOptions = Parameters<LangiumParserErrorMessageProvider['buildMismatchTokenMessage']>[0];
type NoViableAltOptions = Parameters<LangiumParserErrorMessageProvider['buildNoViableAltMessage']>[0];
type EarlyExitOptions = Parameters<LangiumParserErrorMessageProvider['buildEarlyExitMessage']>[0];
type NotAllInputParsedOptions = Parameters<LangiumParserErrorMessageProvider['buildNotAllInputParsedMessage']>[0];
type Token = MismatchOptions['actual'];
type TokenType = MismatchOptions['expected'];

const VALUE = 'where <value> is a number, "text", true or false';

const SCENARIO_NAME = "(A scenario's name can have keywords, but not Given, Entity, Role, Action, Declarative or Scenario.)";
const SCALAR_TYPES = ['int', 'string', 'boolean', 'Any'];
const NAME_BEFORE_TYPE = 'An input, like a data property, has a name before its type: Input: file: string, copies: int.';
const NO_NOT_STATE = "A state has no 'not': only the <Entity> is <state> (it is <state> in a specification).";
const NO_NOT_ENABLED = "There is no 'not enabled': only <action> is enabled, in a Declarative specification or a Given.";
const ENABLING_CONDITIONS = [
    'An enabled specification can only have these conditions, joined with AND:',
    '  <action> was executed or is not available',
    '  <action> is not pending or is not available'
].join('\n');

/** What a sentence of each kind can look like, shown when a sentence matches none of its forms. */
const SENTENCES: Record<string, string> = {
    Element: 'Expected the start of an element: Entity, Role, Action <action> { … }, Action <action> is enabled means { … }, Declarative specification, or Scenario.',
    ActionElement: 'Expected Action <action> { Initiators: … } or Action <action> is enabled means { … }.',
    EnabledSpec: 'Expected an enabled specification: Action <action> is enabled means { … }.',
    SpecCondition: [
        'This is not a valid condition of a specification. A condition is one of:',
        '  its <property> (not) equal to / larger than / smaller than <value>',
        '  <value> is (not) included in its <list or queue>',
        '  its <list or queue> is (not) empty / full',
        '  it is <state>',
        '  <action> is (not) pending / available    |    <action> was (not) executed    |    <action> is enabled',
        `('it' is the specified entity; 'the' or 'the <Entity>'s' can replace 'its'; ${VALUE})`
    ].join('\n'),
    SelfAssertion: [
        'This is not a valid property assertion. An assertion is one of:',
        '  its <property> (not) equal to / larger than / smaller than <value>',
        '  <value> is (not) included in its <list or queue>',
        '  its <list or queue> is (not) empty / full',
        `('the' or 'the <Entity>'s' can replace 'its'; ${VALUE})`
    ].join('\n'),
    GivenCondition: [
        'This is not a valid Given condition. A condition is one of:',
        '  the <Entity> is <state>',
        "  the <Entity>'s <property> (not) equal to / larger than / smaller than <value>",
        "  <value> is (not) included in the <Entity>'s <list or queue>",
        "  the <Entity>'s <list or queue> is (not) empty / full",
        '  <action> is (not) pending / available    |    <action> was (not) executed    |    <action> is enabled',
        `(${VALUE})`
    ].join('\n'),
    Effect: [
        'This is not a valid Then effect. An effect is one of:',
        "  the <Entity>'s <property> is set to <value>",
        "  the <Entity>'s <list> is added with / removed with <value>    |    <value> is added to / removed from the <Entity>'s <list>",
        "  the <Entity>'s <queue> is enqueued with <value>    |    the <Entity>'s <queue> is dequeued (as <variable>)",
        '  <action> is pending    |    <action> is (not) available',
        `(${VALUE}, or a variable bound before: … is dequeued as <variable>)`
    ].join('\n'),
    ActionEffect: 'In a Then effect an action can only be: <action> is pending  |  <action> is (not) available.'
};
// a sentence that fails inside one of these fails as a sentence of the rule it belongs to
SENTENCES.PropertyAssertion = SENTENCES.GivenCondition;
SENTENCES.PropertyAssignment = SENTENCES.Effect;

/** Syntax errors in the words of the language instead of Chevrotain's token sequences. */
export class EasyParserErrorMessageProvider extends LangiumParserErrorMessageProvider {

    private readonly terminals: Set<string>;

    constructor(services: LangiumCoreServices) {
        super();
        this.terminals = new Set(services.Grammar.rules.filter(GrammarAST.isTerminalRule).map(rule => rule.name));
    }

    override buildMismatchTokenMessage({ expected, actual, previous, ruleName }: MismatchOptions): string {
        if (ruleNameOf(ruleName) === 'ActionEffect') {
            return SENTENCES.ActionEffect;  // e.g. 'stop is not pending' or 'stop was executed' in a Then
        }
        if (ruleNameOf(ruleName) === 'EnablingCondition' || (ruleNameOf(ruleName) === 'EnabledSpec' && expected.name === '}')) {
            return ENABLING_CONDITIONS;     // e.g. 'start was executed', or two conditions without AND
        }
        if (ruleNameOf(ruleName) === 'EnabledSpec' && ['enabled', 'means'].includes(expected.name)) {
            return SENTENCES.EnabledSpec;   // e.g. 'Action print is available means { … }' or 'Action print is not enabled means { … }'
        }
        if (expected.name === 'Output' && SCALAR_TYPES.includes(actual.image)) {
            return `Expected a name but found the type ${this.describe(actual)}. ${NAME_BEFORE_TYPE}`;   // Input: string, int
        }
        if (expected.name === 'EOF') {
            return this.buildNotAllInputParsedMessage({ firstRedundant: actual, ruleName });   // e.g. 'scenario:' or a name between elements
        }
        if (ruleNameOf(ruleName) === 'Scenario' && expected.name === 'Given') {
            // e.g. no Given yet before the next element, or none at all: the name ran on to the scenario's '.'
            return `Expected 'Given' but found ${this.describe(actual)}. ${SCENARIO_NAME}`;
        }
        const keywordInName = previous?.tokenType.name === 'ID' ? this.keywordInName(actual) : '';
        return `Expected ${this.describeType(expected)} but found ${this.describe(actual)}.${keywordInName}`;
    }

    override buildNoViableAltMessage(options: NoViableAltOptions): string {
        const [actual] = options.actual;
        if (ruleNameOf(options.ruleName) === 'ActionCondition' && actual.image === 'enabled') {
            return NO_NOT_ENABLED;          // 'reboot is not enabled' in a Declarative specification or a Given
        }
        if (ruleNameOf(options.ruleName) === 'EnablingCondition') {
            return ENABLING_CONDITIONS;     // e.g. 'start is pending or …' in an enabled specification
        }
        const sentence = SENTENCES[ruleNameOf(options.ruleName)];
        if (sentence) {
            return sentence;
        }
        const firsts = [...new Set(options.expectedPathsPerAlt.flat().map(path => this.describeType(path[0])))];
        return `Expected ${firsts.join(' or ')} but found ${this.describe(options.actual[0])}.`;
    }

    override buildEarlyExitMessage(options: EarlyExitOptions): string {
        if (ruleNameOf(options.ruleName) === 'Name' && options.actual[0].image === 'not' && options.previous.image === 'is') {
            return NO_NOT_STATE;    // a name after 'is' is a state: the Printer is not busy, it is not online
        }
        if (ruleNameOf(options.ruleName) === 'Name' && SCALAR_TYPES.includes(options.actual[0].image) && [':', ','].includes(options.previous.image)) {
            return `Expected a name but found the type ${this.describe(options.actual[0])}. ${NAME_BEFORE_TYPE}`;   // Input: string, int
        }
        if (ruleNameOf(options.ruleName) === 'Name') {
            return `Expected a name but found ${this.describe(options.actual[0])}.${this.keywordInName(options.actual[0])}`;
        }
        return super.buildEarlyExitMessage(options);
    }

    override buildNotAllInputParsedMessage({ firstRedundant }: NotAllInputParsedOptions): string {
        return `Unexpected ${this.describe(firstRedundant)}. ${SENTENCES.Element}`;
    }

    /** `Scenario: Add to queue Given …`: 'to' ends the name, which is easy to miss. */
    private keywordInName(token: Token): string {
        return this.isKeyword(token) ? ` (If '${token.image}' is meant to be part of a name: keywords cannot be used in names; join the words with underscores instead, as in ready_to_submit.)` : '';
    }

    /** A word of the language, not a name, number, text or punctuation. */
    private isKeyword(token: Token): boolean {
        return !this.terminals.has(token.tokenType.name) && /^[A-Za-z_]\w*$/.test(token.image);
    }

    private describe(token: Token): string {
        return token.tokenType.name === 'EOF' ? 'the end of the file' : `'${token.image}'`;
    }

    private describeType(type: TokenType): string {
        switch (type.name) {
            case 'EOF': return 'the end of the file';
            case 'ID': return 'a name';
            case 'INT': return 'a number';
            case 'STRING': return 'a "text"';
            case 'POSSESSIVE': return "'s";
            default: return `'${type.name}'`;
        }
    }
}

/** Langium marks its rule names with a zero-width space. */
function ruleNameOf(name: string): string {
    return name.replace(/​/g, '');
}
