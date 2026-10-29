// What a plan changes, shown like a git diff: element by element, what the plan adds (+), deletes (-) and changes (~),
// between the model before it and the model after it. The chat pane shows it on the plan's card
// (packages/web/src/chat-pane.ts has the same types):
//   Entities
//   ~ Printer
//       States: - idle, + printing
//   + Customer
//       Data properties: + name: string
// Entities, roles and action specifications are compared part by part (their states, initiators, …); the keyed texts
// (enabled and state specifications, scenarios) line by line. A document with syntax errors has no model to compare:
// then the diff is the document's text, line by line. diffText writes it as plain text, for an LLM (the MCP server's
// simulate_plan), in the form above; a line of a text has its mark before it (+, - or two spaces).

import type { ActionSpecification, Controller, DataProperty, Entity } from './controller.ts';

/** A piece of a part: a state, an initiator, a data property, … and whether the plan adds it or deletes it. */
export interface DiffPart {
    change: 'added' | 'deleted';
    text: string;
}

/**
 * A line of the diff: an element ("Printer"), a part of one ("States", with its pieces), or a line of a text as written
 * (code), and under it the lines of what changes in it.
 */
export interface DiffLine {
    change: 'added' | 'deleted' | 'changed' | 'same';
    text: string;
    parts?: DiffPart[];
    code?: boolean;
    lines?: DiffLine[];
}

/** The lines of one kind of element: "Entities", "Roles", … */
export interface DiffSection {
    title: string;
    lines: DiffLine[];
}

/** What changes from `before` to `after`, by kind of element; a kind without changes is left out. */
export function diffModels(before: Controller, after: Controller): DiffSection[] {
    const sections: DiffSection[] = before.broken || after.broken
        ? [{ title: 'Document', lines: textDiff(before.toDsl(), after.toDsl()) }]
        : [
            { title: 'Entities', lines: elementDiff(before.entities, after.entities, ({ name }) => name, entityParts) },
            { title: 'Roles', lines: elementDiff(before.roles, after.roles, ({ name }) => name, () => []) },
            { title: 'Actions', lines: elementDiff(before.actionSpecifications, after.actionSpecifications, ({ action }) => action, actionParts) },
            { title: 'Enabled specifications', lines: keyedTextDiff(before.enabledSpecifications, after.enabledSpecifications, ({ action }) => `${action} is enabled`) },
            { title: 'State specifications', lines: keyedTextDiff(before.stateSpecifications, after.stateSpecifications, ({ entity, state }) => `${entity} is ${state}`) },
            { title: 'Scenarios', lines: keyedTextDiff(before.scenarios, after.scenarios, ({ name }) => name) }
        ];
    return sections.filter(({ lines }) => lines.length > 0);
}

/** The diff as text, as the header shows it: each section's title, then its lines, each kind of change marked. */
export function diffText(sections: DiffSection[]): string {
    return sections.flatMap(({ title, lines }) => [title, ...lines.flatMap(line => lineText(line, ''))]).join('\n');
}

const MARK = { added: '+', deleted: '-', changed: '~', same: ' ' } as const;

/** A line and the lines under it, indented; a part with its pieces: States: - idle, + printing */
function lineText({ change, text, parts, lines }: DiffLine, indent: string): string[] {
    const own = parts
        ? `${indent}${text}: ${parts.map(part => `${MARK[part.change]} ${part.text}`).join(', ')}`
        : `${indent}${MARK[change]} ${text}`;
    return [own, ...(lines ?? []).flatMap(line => lineText(line, `${indent}    `))];
}

// ---------------- Structured elements ----------------

/** A part of an element, with its pieces: States: idle, busy */
interface Part {
    title: string;
    pieces: string[];
}

function entityParts({ actions, dataProperties, states }: Entity): Part[] {
    return [
        { title: 'Actions', pieces: actions },
        { title: 'Data properties', pieces: dataProperties.map(dataProperty) },
        { title: 'States', pieces: states }
    ];
}

/** Each input and output is a piece: a When names them, so their order does not count. */
function actionParts({ initiators, observers, inputs, outputs }: ActionSpecification): Part[] {
    return [
        { title: 'Initiators', pieces: initiators },
        { title: 'Observers', pieces: observers },
        { title: 'Input', pieces: inputs.map(({ name, type }) => `${name}: ${type}`) },
        { title: 'Output', pieces: outputs.map(({ name, type }) => `${name}: ${type}`) }
    ];
}

/** speed: int, jobs: a list of string */
function dataProperty({ name, type, elementType }: DataProperty): string {
    if (type !== 'list' && type !== 'queue') {
        return `${name}: ${type}`;
    }
    return elementType ? `${name}: a ${type} of ${elementType}` : `${name}: a ${type}`;
}

/**
 * The elements of one kind, matched by their key (a name): the ones the plan deletes or changes, in their order
 * before it, then the ones it adds. An added or deleted element comes with all its parts, a changed one with the
 * parts that change, and in each only the pieces that change.
 */
function elementDiff<T>(before: T[], after: T[], key: (element: T) => string, parts: (element: T) => Part[]): DiffLine[] {
    const lines: DiffLine[] = [];
    for (const old of before) {
        const now = after.find(element => key(element) === key(old));
        if (!now) {
            lines.push(whole('deleted', key(old), parts(old)));
            continue;
        }
        const changed = parts(now).flatMap((part, index) => {
            const oldPieces = parts(old)[index].pieces;
            const pieces: DiffPart[] = [
                ...oldPieces.filter(piece => !part.pieces.includes(piece)).map(text => ({ change: 'deleted' as const, text })),
                ...part.pieces.filter(piece => !oldPieces.includes(piece)).map(text => ({ change: 'added' as const, text }))
            ];
            return pieces.length > 0 ? [{ change: 'changed' as const, text: part.title, parts: pieces }] : [];
        });
        if (changed.length > 0) {
            lines.push({ change: 'changed', text: key(old), lines: changed });
        }
    }
    for (const now of after) {
        if (!before.some(element => key(element) === key(now))) {
            lines.push(whole('added', key(now), parts(now)));
        }
    }
    return lines;
}

/** An element the plan adds or deletes, with its parts. */
function whole(change: 'added' | 'deleted', name: string, parts: Part[]): DiffLine {
    const lines = parts
        .filter(({ pieces }) => pieces.length > 0)
        .map(({ title, pieces }) => ({ change, text: title, parts: pieces.map(text => ({ change, text })) }));
    return lines.length > 0 ? { change, text: name, lines } : { change, text: name };
}

// ---------------- Texts ----------------

/** The keyed texts of one kind, matched by `title`, in the order of elementDiff; each with the lines that change. */
function keyedTextDiff<T extends { text: string }>(before: T[], after: T[], title: (element: T) => string): DiffLine[] {
    const lines: DiffLine[] = [];
    for (const old of before) {
        const now = after.find(element => title(element) === title(old));
        if (!now) {
            lines.push({ change: 'deleted', text: title(old), lines: textDiff(old.text, '') });
        } else if (now.text !== old.text) {
            lines.push({ change: 'changed', text: title(old), lines: textDiff(old.text, now.text) });
        }
    }
    for (const now of after) {
        if (!before.some(element => title(element) === title(now))) {
            lines.push({ change: 'added', text: title(now), lines: textDiff('', now.text) });
        }
    }
    return lines;
}

/** How many unchanged lines a text diff keeps around a change; the others are one line "…". */
const CONTEXT = 2;

/**
 * The lines of `after` against those of `before`, as git compares them: the longest run of lines both have in common
 * stays, the rest of `before` is deleted and the rest of `after` added (in each place the deleted lines first).
 */
function textDiff(before: string, after: string): DiffLine[] {
    const a = linesOf(before);
    const b = linesOf(after);
    // common[i][j]: how many lines a[i…] and b[j…] have in common, in order
    const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
        }
    }
    const lines: DiffLine[] = [];
    let [i, j] = [0, 0];
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            lines.push({ change: 'same', text: a[i++], code: true });
            j++;
        } else if (i < a.length && (j === b.length || common[i + 1][j] >= common[i][j + 1])) {
            lines.push({ change: 'deleted', text: a[i++], code: true });
        } else {
            lines.push({ change: 'added', text: b[j++], code: true });
        }
    }
    return withContext(lines);
}

/** A text's lines, without the empty line after a last line break; none for no text. */
function linesOf(text: string): string[] {
    return text === '' ? [] : text.replace(/\n$/, '').split('\n');
}

/** The changed lines with CONTEXT unchanged lines around each; the unchanged lines between are "…". */
function withContext(lines: DiffLine[]): DiffLine[] {
    const near = (index: number) => lines
        .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
        .some(({ change }) => change !== 'same');
    const kept: DiffLine[] = [];
    lines.forEach((line, index) => {
        if (line.change !== 'same' || near(index)) {
            kept.push(line);
        } else if (kept.at(-1)?.text !== '…') {
            kept.push({ change: 'same', text: '…', code: true });
        }
    });
    return kept;
}
