// Starts the MCP server on stdio, for a client that starts it, such as Codex or Claude Desktop:
//   codex mcp add dsl-easy -- node <path to>/packages/dsl-mcp/src/main.ts
// The server keeps no state between calls (every tool takes the document's id), so it does not matter whether
// the client starts a server per conversation or shares one. It ends when the client closes it.
// stdout carries the protocol, so nothing else may write to it.

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { stopChecker } from 'dsl-controller';
import { CallLog } from './call-log.ts';
import { Documents } from './documents.ts';
import { createServer } from './server.ts';

const documents = new Documents();
const log = new CallLog(documents);
const server = createServer(documents, log);
server.server.onclose = () => {
    void stopChecker().finally(() => process.exit(0));
};
await server.connect(log.around(new StdioServerTransport()));
