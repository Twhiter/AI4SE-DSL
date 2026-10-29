import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { createEasyServices } from 'easy-language';
import { startZ3Checks } from './z3-checks.js';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-easyific services
const { shared } = createEasyServices({ connection, ...NodeFileSystem });

// Start the language server with the shared services
startLanguageServer(shared);

// Then the Z3 checks, after the language's own validation, and the DCR graphs
startZ3Checks(connection, shared);
