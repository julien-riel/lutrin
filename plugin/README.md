# Lutrin — Agent Plugin

Lutrin packaged as a portable **Agent Plugin**
([agent-plugins.org](https://agent-plugins.org) v1.0.0), so any conformant
agent client — not only Claude Code — can install it, run its skills, and
drive the compiler through standard MCP tools.

Lutrin is a themable presentation compiler: enriched Markdown (a DSL) →
PowerPoint (`.pptx`) or standalone HTML. Layout is decided by the engine; an
organization's brand comes from installing its kit.

## What this plugin ships

The spec defines exactly two portable component types, and this plugin uses
both:

| Component | Path | What it does |
|---|---|---|
| Skill `deck` | `skills/deck/SKILL.md` | Teaches the agent the DSL and the `write → validate → build` loop. |
| Skill `kit-from-site` | `skills/kit-from-site/SKILL.md` | Derives a brand kit from a website URL: harvest the design system, distill it into `theme.json`, validate, package. |
| MCP server `lutrin` | `mcp.json` | Exposes the compiler as tools: `validate_deck`, `build_deck`, `suggest_layout`. |

## Requirements — read before the first run

The MCP server is **not** bundled in this directory. `mcp.json` launches it with
`npx`, pinned to a published version:

```json
"command": "npx",
"args": ["-y", "@lutrin/mcp@1.2.0"]
```

Consequences:

- **The first run needs network access and a working `npx`** (Node ≥ 22). `npx`
  fetches [`@lutrin/mcp`](https://www.npmjs.com/package/@lutrin/mcp) and its
  dependency tree — including the native `@resvg/resvg-js` renderer — then
  caches it. Subsequent runs are offline until the cache is cleared.
- **A browser is optional but recommended.** `build_deck` locates an installed
  Chrome / Chromium for PDF output and for Mermaid diagrams. When none is found
  it degrades gracefully — Mermaid becomes a readable code block, PDF is
  reported unavailable — rather than failing. `.pptx` and `.html` never need a
  browser.

The skill works on its own even if the server is unavailable, and vice versa:
per the spec, a broken component never disables the other.

## Tool surface

- **`validate_deck`** — deck Markdown (inline or a path) → positioned JSON
  diagnostics (overflows, low-res images, layout suggestions). This is the
  `--json` "deck doctor", as a tool. A deck that fails validation returns
  structured diagnostics, never a transport error.
- **`build_deck`** — deck + `{ format: "pptx" | "html" }` → a written file and a
  render summary.
- **`suggest_layout`** — deck → the layout the engine infers for each slide,
  plus any structured-intent suggestions.

## Installing

Distribution is directory-based (the spec defines no archive or registry):
clone the repository, or copy this `plugin/` directory into your client's plugin
location. The manifest (`plugin.json`), the MCP config (`mcp.json`) and the
skill are all plain, inspectable files.

## License

MIT — see [`LICENSE`](./LICENSE).
