import type * as monaco from 'monaco-editor';

/** A Langium (LSP) range, 0-based, as a Monaco range, 1-based. */
export function toMonacoRange(range: { start: { line: number, character: number }, end: { line: number, character: number } }): monaco.IRange {
    return {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1
    };
}
