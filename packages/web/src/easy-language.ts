// Connects Monaco to the easy language package: highlighting, theme, errors, completion and
// go-to-definition, and the Z3 checks of an error-free document. Everything runs in the page; there is no server.
// Each document it builds from the editor's text goes to the views that show it otherwise (onDocument).

import * as monaco from 'monaco-editor';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { buildModel, createEasyServices } from 'easy-language';
import monarch from '../../language/syntaxes/easy.monarch';
import { checkWithZ3, clearChecks } from './checks.js';
import { toMonacoRange } from './ranges.js';

export const EASY_LANGUAGE_ID = 'easy';
export const EASY_THEME = 'easy-dark';
export const DOCUMENT_URI = 'inmemory:///model.easy';

const { shared, Easy } = createEasyServices(EmptyFileSystem);
const documentUri = URI.parse(DOCUMENT_URI);

export function registerEasyLanguage(): void {
    monaco.languages.register({ id: EASY_LANGUAGE_ID, extensions: ['.easy'] });
    // generated from the grammar by `npm run langium:generate`
    monaco.languages.setMonarchTokensProvider(EASY_LANGUAGE_ID, monarch as monaco.languages.IMonarchLanguage);
    monaco.languages.setLanguageConfiguration(EASY_LANGUAGE_ID, {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}']],
        autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }],
        surroundingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }]
    });

    // VS Code "Dark Modern", with the same token colours as the VS Code extension and the Langium playground
    monaco.editor.defineTheme(EASY_THEME, {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: '', foreground: 'CCCCCC' },
            { token: 'keyword', foreground: 'C586C0' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'comment', foreground: '6A9955' },
            { token: 'number', foreground: 'CCCCCC' },
            { token: 'operator', foreground: 'CCCCCC' }
        ],
        colors: {
            'editor.background': '#1F1F1F',
            'editor.foreground': '#CCCCCC',
            'editorLineNumber.foreground': '#6E7681',
            'editorLineNumber.activeForeground': '#CCCCCC',
            'editorWidget.background': '#202020',
            'editor.selectionBackground': '#264F78'
        }
    });

    monaco.editor.onDidCreateModel(model => {
        if (model.getLanguageId() === EASY_LANGUAGE_ID) {
            showErrorsWhileTyping(model);
        }
    });
    monaco.languages.registerCompletionItemProvider(EASY_LANGUAGE_ID, { provideCompletionItems });
    monaco.languages.registerDefinitionProvider(EASY_LANGUAGE_ID, { provideDefinition });
}

// ---------------- Running the language on the editor's text ----------------

/**
 * Which checks the editor shows: Langium's own (syntax errors, and names that do not resolve), the language's
 * validator (easy-validator.ts), and the Z3 checks with the DCR graph after them (checks.ts). Off while the language
 * changes; the validator needs Langium's own checks on.
 */
const CHECKS = { langium: true, validator: true, z3: true };

const documentListeners: Array<(document: LangiumDocument) => void> = [];

/** Called with the document of the editor's text after every change, as the language read it, errors and all. */
export function onDocument(listener: (document: LangiumDocument) => void): void {
    documentListeners.push(listener);
}

let latest: { text: string, document: Promise<LangiumDocument> } | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Parses, links and validates `text`, one run at a time; the same text is not built twice. */
function build(text: string): Promise<LangiumDocument> {
    if (latest?.text !== text) {
        const document = queue.then(async () => {
            const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
            if (LangiumDocuments.hasDocument(documentUri)) {
                await DocumentBuilder.update([], [documentUri]);
            }
            const document = LangiumDocumentFactory.fromString(text, documentUri);
            LangiumDocuments.addDocument(document);
            const validation = CHECKS.validator ? true : CHECKS.langium && { categories: ['built-in' as const] };
            await DocumentBuilder.build([document], { validation });
            return document;
        });
        queue = document.catch(() => undefined);
        latest = { text, document };
    }
    return latest.document;
}

function showErrorsWhileTyping(model: monaco.editor.ITextModel): void {
    const MARKER_SEVERITY = [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
        const text = model.getValue();
        const document = await build(text);
        if (model.isDisposed() || model.getValue() !== text) {
            return; // the user typed on; a newer run follows
        }
        monaco.editor.setModelMarkers(model, EASY_LANGUAGE_ID, (document.diagnostics ?? []).map(diagnostic => ({
            severity: MARKER_SEVERITY[diagnostic.severity ?? 1],
            message: typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value,
            source: 'easy',
            ...toMonacoRange(diagnostic.range)
        })));
        documentListeners.forEach(listener => listener(document));
        if (!CHECKS.z3) {
            clearChecks(model, 'Z3 checks are off');
            return;
        }
        // without errors, the document is a model that Z3 can check
        const { model: content } = buildModel(document);
        if (content) {
            checkWithZ3(model, text, document, content);
        } else {
            clearChecks(model);
        }
    };
    model.onDidChangeContent(() => {
        clearTimeout(timer);
        timer = setTimeout(update, 250);
    });
    update();
}

// ---------------- Completion and go-to-definition ----------------

/** LSP completion kinds (numbers) that Langium uses, mapped to Monaco's. */
const COMPLETION_KIND: Record<number, monaco.languages.CompletionItemKind> = {
    1: monaco.languages.CompletionItemKind.Text,
    6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class,
    10: monaco.languages.CompletionItemKind.Property,
    14: monaco.languages.CompletionItemKind.Keyword,
    18: monaco.languages.CompletionItemKind.Reference
};

async function provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position): Promise<monaco.languages.CompletionList> {
    const document = await build(model.getValue());
    const completions = await Easy.lsp.CompletionProvider?.getCompletion(document, {
        textDocument: { uri: DOCUMENT_URI },
        position: { line: position.lineNumber - 1, character: position.column - 1 }
    });
    const word = model.getWordUntilPosition(position);
    const wordRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return {
        suggestions: (completions?.items ?? []).map(item => {
            const edit = item.textEdit && 'range' in item.textEdit ? item.textEdit : undefined;
            return {
                label: item.label,
                kind: COMPLETION_KIND[item.kind ?? 1] ?? monaco.languages.CompletionItemKind.Value,
                detail: item.detail,
                sortText: item.sortText,
                filterText: item.filterText,
                insertText: edit?.newText ?? item.insertText ?? item.label,
                range: edit ? toMonacoRange(edit.range) : wordRange
            };
        })
    };
}

async function provideDefinition(model: monaco.editor.ITextModel, position: monaco.Position): Promise<monaco.languages.Definition> {
    const document = await build(model.getValue());
    const links = await Easy.lsp.DefinitionProvider?.getDefinition(document, {
        textDocument: { uri: DOCUMENT_URI },
        position: { line: position.lineNumber - 1, character: position.column - 1 }
    });
    return (links ?? []).map(link => ({ uri: model.uri, range: toMonacoRange(link.targetSelectionRange) }));
}
