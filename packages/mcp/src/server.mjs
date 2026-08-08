/**
 * The Lutrin MCP server: the compiler's `write → validate → build` loop as
 * standard MCP tools, so any conformant agent — not only Claude Code — can
 * drive it.
 *
 * The server is a thin registration layer. All the work lives in `adapter.mjs`;
 * here we only declare each tool's input schema and turn the adapter's plain
 * result into an MCP tool result. Every handler goes through `runTool`, which
 * guarantees invariant 1 of the adapter at the transport edge: a thrown error
 * becomes an `isError` result, never an exception that would tear down stdio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UsageError, buildDeckTool, validateDeckTool } from './adapter.mjs';

/** The server version tracks the package: the same version the plugin's
 *  mcp.json pins, so `npx @lutrin/mcp@<v>` and the reported version agree. */
const pkg = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
);

/** Fields shared by every deck tool: a deck by value or by path, plus the
 *  optional resolution context. */
const deckSourceShape = {
  deck: z
    .string()
    .optional()
    .describe('Inline deck Markdown (the Lutrin DSL). Provide this OR `path`, not both.'),
  path: z
    .string()
    .optional()
    .describe('Path to a deck file (.md / .deck.md) on disk. Provide this OR `deck`, not both.'),
  baseDir: z
    .string()
    .optional()
    .describe(
      'Directory that relative images and `layouts/*.json` resolve against. Defaults to the deck file’s directory, or the process cwd for an inline deck.',
    ),
  kit: z
    .string()
    .optional()
    .describe(
      'Brand kit / theme: an installed kit name, `none` for the generic theme, or a path to a kit directory or a theme .json beside the deck.',
    ),
};

/** Turn an adapter result into an MCP tool result, and make invariant 1
 *  (errors are results) hold at the boundary. */
async function runTool(fn) {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    if (err instanceof UsageError)
      return { isError: true, content: [{ type: 'text', text: `Usage error: ${err.message}` }] };
    // An unexpected failure must not crash the stdio transport: report it as a
    // tool error so the session survives one bad deck.
    return {
      isError: true,
      content: [{ type: 'text', text: `Internal error: ${err?.message ?? String(err)}` }],
    };
  }
}

/** Build a configured McpServer with every tool registered. Exported so tests
 *  can drive it over an in-memory transport, exactly as a real client would. */
export function createServer() {
  const server = new McpServer({ name: 'lutrin', version: pkg.version });

  server.registerTool(
    'validate_deck',
    {
      title: 'Validate a Lutrin deck',
      description:
        'Run the Lutrin "deck doctor" over a deck and return positioned JSON diagnostics (unknown directives, non-existent layouts, missing images, overflows, layout suggestions) plus a `valid` verdict. A deck full of errors is a normal result, not a failure — check `valid`.',
      inputSchema: deckSourceShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => runTool(() => validateDeckTool(args)),
  );

  server.registerTool(
    'build_deck',
    {
      title: 'Build a Lutrin deck',
      description:
        'Compile a deck to PowerPoint (.pptx) or standalone HTML and write the file. Validates first: a deck with error diagnostics (or an empty deck) is not written unless `force` is true — the diagnostics come back so you can fix them. Returns the written path, a render summary, and any graceful degradations (e.g. Mermaid falling back to text when no browser is present).',
      inputSchema: {
        ...deckSourceShape,
        format: z.enum(['pptx', 'html']).describe('Output format: PowerPoint or standalone HTML.'),
        out: z
          .string()
          .optional()
          .describe(
            'Output file path (must end in .pptx or .html). Defaults to a file beside the source deck, or — for an inline deck — under ${PLUGIN_DATA} or the system temp directory.',
          ),
        force: z
          .boolean()
          .optional()
          .describe('Compile even if the deck carries error diagnostics or is empty.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (args) => runTool(() => buildDeckTool(args)),
  );

  return server;
}
