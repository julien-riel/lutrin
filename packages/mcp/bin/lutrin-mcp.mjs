#!/usr/bin/env node
/**
 * Entry point published as the `lutrin-mcp` bin and launched by the plugin's
 * mcp.json (`npx -y @lutrin/mcp@<version>`). It speaks the Model Context
 * Protocol over stdio — the transport chosen for zero network and local file
 * I/O.
 *
 * Nothing is written to stdout except MCP frames: a stray console.log would
 * corrupt the protocol stream. Startup failures and the connection go to
 * stderr, which the client shows in its logs.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.mjs';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // A line on stderr, so a human tailing the client's MCP logs sees the server
  // came up; stdout stays reserved for the protocol.
  console.error('lutrin MCP server ready (stdio)');
}

main().catch((err) => {
  console.error(`lutrin MCP server failed to start: ${err?.stack ?? err}`);
  process.exit(1);
});
