# @lutrin/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[Lutrin](https://info.lutrin.app/), the themable Markdown → PowerPoint / HTML
presentation compiler. It turns Lutrin's `write → validate → build` loop into
first-class tool calls, so any MCP agent can drive the compiler.

This package is the server that the Lutrin **Agent Plugin** launches via
`npx -y @lutrin/mcp@<version>` (see [`../../plugin/README.md`](../../plugin/README.md)).
It is a thin adapter over [`@lutrin/core`](https://www.npmjs.com/package/@lutrin/core) —
no compiler logic lives here.

## Tools

| Tool | What it does |
|---|---|
| `validate_deck` | Positioned JSON diagnostics for a deck (the `--json` deck doctor). A deck full of errors is a normal result — check `valid`. |
| `build_deck` | Compile to `.pptx` or `.html` and write the file. Validates first: a deck in error is not written unless `force`. |
| `suggest_layout` | Per-slide inferred layouts plus structured-intent suggestions (SWOT, before/after, dated milestones…). Read-only. |

Each tool accepts a deck **inline** (`deck`) or by **path** (`path`), with
optional `baseDir` and `kit`. Errors are structured results, never a transport
crash. `build_deck` reports graceful degradations (e.g. Mermaid falling back to
text when no browser is present). PDF and image formats are out of scope: they
require a browser and cannot degrade.

## Running

```bash
npx -y @lutrin/mcp        # a stdio MCP server; point your client at it
```

The bin is `lutrin-mcp`. The transport is stdio: only MCP frames go to stdout.

## Requirements

- Node ≥ 22.
- A Chrome / Chromium is optional but recommended — `build_deck` uses it for
  Mermaid diagrams (and it is required only for the PDF/image formats, which
  this server does not expose). Without one, Mermaid degrades to a code block.

## License

MIT. Part of the [Lutrin](https://github.com/julien-riel/lutrin) monorepo; the
plugin design is documented in
[`../../docs/plans/agent-plugin.md`](../../docs/plans/agent-plugin.md).
