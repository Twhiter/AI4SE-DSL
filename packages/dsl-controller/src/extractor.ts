// Reads a DSL easy document into the controller's model (controller.ts), for when the user edited it in the editor.
// Only the syntax has to be right: the parser's tree has every name as written, so a document whose names do not
// resolve, or whose checks fail, is read all the same; the model may be inconsistent until the LLM fixes it.
// A document with a syntax error is not read at all: its tree may miss elements.
// The comments are kept with the elements (controller.ts): the comment lines between two elements go with the one
// after them, except a comment on the line where the one before ends, which stays with it; the comments after the
// last element stay at the end. An entity, role or action specification also keeps its text as written.

import { EmptyFileSystem, type AstNode } from 'langium';
import {
    createEasyServices, isActionParticipants, isDeclarativeSpec, isEnabledSpec, isEntity, isRole, isScenario, type Model
} from 'easy-language';
import {
    ActionSpecification, actionSpecificationDsl, Controller, EnabledSpecification, Entity, entityDsl, Role, roleDsl, Scenario,
    StateSpecification, type Element, type ScalarType
} from './controller.ts';

/** A syntax error, at its line and column (both from 1). */
export interface SyntaxProblem {
    line: number;
    column: number;
    message: string;
}

export type Extraction =
    | { controller: Controller, errors?: undefined }
    | { controller?: undefined, errors: SyntaxProblem[] };

const parser = createEasyServices(EmptyFileSystem).Easy.parser.LangiumParser;

/**
 * The model of `text`, or its syntax errors. Declarations become structured: entities with their data properties,
 * states and actions; roles; action specifications with their initiators, observers, inputs and outputs. Enabled
 * specifications, state specifications and scenarios are kept as written, under their keys: the action, the entity
 * and state, the name. Every element keeps the comments around it.
 */
export function extract(text: string): Extraction {
    const { value: root, lexerErrors, parserErrors } = parser.parse<Model>(text);
    const errors: SyntaxProblem[] = [
        ...lexerErrors.map(error => at(text, error.line, error.column, error.message)),
        ...parserErrors.map(error => at(text, error.token.startLine, error.token.startColumn, error.message))
    ];
    if (errors.length > 0) {
        return { errors };
    }

    const controller = new Controller();
    let previous: Element | undefined;
    let end = 0;   // where the element before ends
    for (const element of root.elements) {
        let read: Element | undefined;
        if (isEntity(element)) {
            const entity = new Entity(element.name);
            entity.dataProperties = element.dataProperties.map(({ name, type, elementType }) =>
                elementType ? { name, type, elementType: elementType as ScalarType } : { name, type });
            entity.states = element.states.map(state => state.name);
            entity.actions = element.actions.map(action => action.name);
            entity.written = { text: textOf(element), generated: entityDsl(entity) };
            controller.entities.push(read = entity);
        } else if (isRole(element)) {
            const role = new Role(element.name);
            role.written = { text: textOf(element), generated: roleDsl(role) };
            controller.roles.push(read = role);
        } else if (isActionParticipants(element)) {
            const specification = new ActionSpecification(element.name, element.initiators.map(ref => ref.$refText));
            specification.observers = element.observers.map(ref => ref.$refText);
            specification.inputs = element.inputs.map(({ name, type }) => ({ name, type }));
            specification.outputs = element.outputs.map(({ name, type }) => ({ name, type }));
            specification.written = { text: textOf(element), generated: actionSpecificationDsl(specification) };
            controller.actionSpecifications.push(read = specification);
        } else if (isEnabledSpec(element)) {
            controller.enabledSpecifications.push(read = new EnabledSpecification(element.action.$refText, textOf(element)));
        } else if (isDeclarativeSpec(element)) {
            controller.stateSpecifications.push(read = new StateSpecification(element.entity.$refText, element.state.$refText, textOf(element)));
        } else if (isScenario(element)) {
            controller.scenarios.push(read = new Scenario(element.name, textOf(element)));
        }
        if (read && element.$cstNode) {
            const { after, before } = between(text.slice(end, element.$cstNode.offset), previous !== undefined);
            if (previous) {
                previous.after = after;
            }
            read.before = before;
            previous = read;
            end = element.$cstNode.end;
        }
    }
    const { after, before } = between(text.slice(end), previous !== undefined);
    if (previous) {
        previous.after = after;
    }
    controller.trailing = before;
    return { controller };
}

/**
 * The comments between two elements (`gap`, the text between them, only spaces and comments): the ones that start on
 * the line where the element before ends, if there is one (a block comment with all its lines), and the ones after.
 */
function between(gap: string, afterAnElement: boolean): { after: string, before: string } {
    if (!afterAnElement) {
        return { after: '', before: gap.trim() };
    }
    const newline = gap.indexOf('\n');
    let cut = 0;
    for (const comment of gap.matchAll(COMMENT)) {
        if (newline >= 0 && comment.index > newline) {
            break;
        }
        cut = comment.index + comment[0].length;
    }
    return { after: gap.slice(0, cut).trim(), before: gap.slice(cut).trim() };
}

/** A comment, as the grammar's hidden terminals read one: // to the end of the line, or /* to its first closing. */
const COMMENT = /\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g;

/** An element as written, from its first word to its last. */
function textOf(node: AstNode): string {
    return node.$cstNode?.text ?? '';
}

/** An error at its position; one at the end of the text, where the parser gives none (NaN or -1), after its last character. */
function at(text: string, line: number | undefined, column: number | undefined, message: string): SyntaxProblem {
    if (line === undefined || column === undefined || Number.isNaN(line) || line < 1) {
        const lines = text.split('\n');
        return { line: lines.length, column: lines[lines.length - 1].length + 1, message };
    }
    return { line, column, message };
}
