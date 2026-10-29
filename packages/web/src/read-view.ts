// The Read view: the document as tables, as the language reads it after every change of the text (onDocument): its
// entities, roles, actions, Declarative specifications and scenarios. Names are shown as written, also those that do
// not resolve; conditions and effects as written, on one line each. While the text has syntax errors, the tables stay
// as they were before them, with a note that says so.

import type { AstNode, LangiumDocument } from 'langium';
import {
    isActionParticipants, isDeclarativeSpec, isEnabledSpec, isEntity, isRole, isScenario,
    type DataProperty, type Model, type Scenario
} from 'easy-language';
import { onDocument } from './easy-language.js';

/** An action: the entity whose lifecycle it is in, who initiates and observes it, its inputs and outputs, when it is enabled. */
interface ActionRow {
    name: string;
    entity?: string;
    initiators: string[];
    observers: string[];
    inputs: string[];
    outputs: string[];
    enabled: string[];
}

export function createReadView(view: HTMLElement): void {
    view.innerHTML = '<div class="read-note" hidden>The text has syntax errors: the tables show it as it was before them.</div><div class="read-tables"></div>';
    const note = view.querySelector<HTMLElement>('.read-note')!;
    const tables = view.querySelector<HTMLElement>('.read-tables')!;

    onDocument(({ parseResult: { value, lexerErrors, parserErrors } }: LangiumDocument) => {
        const broken = lexerErrors.length > 0 || parserErrors.length > 0;
        note.hidden = !broken;
        if (!broken) {
            tables.innerHTML = tablesOf(value as Model);
        }
    });
}

function tablesOf({ elements }: Model): string {
    if (elements.length === 0) {
        return '<div class="read-empty">Nothing to show yet: the document has no elements.</div>';
    }
    const entities = elements.filter(isEntity);
    const roles = elements.filter(isRole);
    const participants = elements.filter(isActionParticipants);
    const specifications = elements.filter(isDeclarativeSpec);
    const scenarios = elements.filter(isScenario);

    // the actions, in the order they first appear: in an entity's lifecycle, an Action { … }, or an enabled specification
    const actions = new Map<string, ActionRow>();
    const action = (name: string) => {
        if (!actions.has(name)) {
            actions.set(name, { name, initiators: [], observers: [], inputs: [], outputs: [], enabled: [] });
        }
        return actions.get(name)!;
    };
    entities.forEach(entity => entity.actions.forEach(({ name }) => action(name).entity = entity.name));
    participants.forEach(({ name, initiators, observers, inputs, outputs }) => Object.assign(action(name), {
        initiators: initiators.map(({ $refText }) => $refText),
        observers: observers.map(({ $refText }) => $refText),
        inputs: inputs.map(({ name, type }) => `${name}: ${type}`),
        outputs: outputs.map(({ name, type }) => `${name}: ${type}`)
    }));
    elements.filter(isEnabledSpec).forEach(({ action: { $refText }, conditions }) => action($refText).enabled = conditions.map(written));
    const roleActions = (role: string, part: 'initiators' | 'observers') =>
        [...actions.values()].filter(row => row[part].includes(role)).map(({ name }) => name);

    return [
        table('Entities', ['Entity', 'Data properties', 'States', 'Actions'], entities.map(entity => [
            name(entity.name), chips(entity.dataProperties.map(dataProperty)), chips(entity.states.map(({ name }) => name)),
            chips(entity.actions.map(({ name }) => name))
        ])),
        table('Roles', ['Role', 'Initiates', 'Observes'], roles.map(role => [
            name(role.name), chips(roleActions(role.name, 'initiators')), chips(roleActions(role.name, 'observers'))
        ])),
        table('Actions', ['Action', 'Entity', 'Initiators', 'Observers', 'Input', 'Output', 'Enabled when'], [...actions.values()].map(row => [
            name(row.name), row.entity ? escape(row.entity) : none(), chips(row.initiators), chips(row.observers), chips(row.inputs),
            chips(row.outputs), conditions(row.enabled)
        ])),
        table('Declarative specifications', ['Entity', 'State', 'Means'], specifications.map(specification => [
            name(specification.entity.$refText), name(specification.state.$refText), conditions(specification.conditions.map(written))
        ])),
        table('Scenarios', ['Scenario', 'Given', 'When', 'Then'], scenarios.map(scenario => [
            name(scenario.name), conditions(scenario.given.map(written)), `<span class="code">${escape(when(scenario))}</span>`,
            conditions(scenario.effects.map(written))
        ]))
    ].join('');
}

/** A section with its title and count, and a table of its rows; none without rows. */
function table(title: string, head: string[], rows: string[][]): string {
    if (rows.length === 0) {
        return '';
    }
    return `<section>
        <h2>${escape(title)} <span class="badge">${rows.length}</span></h2>
        <table>
            <thead><tr>${head.map(cell => `<th>${escape(cell)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
    </section>`;
}

function name(text: string): string {
    return `<span class="name">${escape(text)}</span>`;
}

function chips(texts: string[]): string {
    return texts.length > 0 ? texts.map(text => `<span class="chip">${escape(text)}</span>`).join('') : none();
}

/** Conditions or effects, one per line, joined by AND. */
function conditions(texts: string[]): string {
    if (texts.length === 0) {
        return none();
    }
    return texts.map((text, index) => `<div class="code">${index > 0 ? '<span class="and">AND</span> ' : ''}${escape(text)}</div>`).join('');
}

function none(): string {
    return '<span class="none">—</span>';
}

/** speed: int, jobs: a list of string */
function dataProperty({ name, type, elementType }: DataProperty): string {
    if (type !== 'list' && type !== 'queue') {
        return `${name}: ${type}`;
    }
    return elementType ? `${name}: a ${type} of ${elementType}` : `${name}: a ${type}`;
}

/** print is executed with inputs file = "report.pdf", copies, outputs pages AND copies larger than 1 */
function when({ action, inputs, outputs, conditions }: Scenario): string {
    const parts = [
        ...(inputs.length > 0 ? [`inputs ${inputs.map(written).join(', ')}`] : []),
        ...(outputs.length > 0 ? [`outputs ${outputs.map(written).join(', ')}`] : [])
    ];
    const values = parts.length > 0 ? ` with ${parts.join(', ')}` : '';
    return `${action.$refText} is executed${values}${conditions.map(condition => ` AND ${written(condition)}`).join('')}`;
}

/** A node as written, on one line. */
function written(node: AstNode): string {
    return node.$cstNode?.text.replace(/\s+/g, ' ').trim() ?? '';
}

function escape(text: string): string {
    return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}
