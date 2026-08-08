# Plan — Agent Plugin (agent-plugins.org v1.0.0)

Status: draft · Target branch: `claude/agent-plugin`

Package Lutrin as a portable **Agent Plugin** conforming to the Agent Plugins
Specification v1.0.0 (<https://agent-plugins.org>), so that *any* conformant
agent client — not only Claude Code — can install Lutrin, run its `deck` skill,
and drive the compiler through standard MCP tools.

This is the natural next step for Lutrin's agent-first thesis: today the
`write → validate → fix → build` loop is reachable only through a Claude-specific
skill that shells out to the CLI. The portable plugin makes that loop reachable
from the whole MCP/Agent-Skills ecosystem.

---

## 1. What the standard requires (the parts that bind us)

The spec is deliberately small. The normative facts that shape this work:

- **A plugin is a directory** rooted at one filesystem location, with a
  **`plugin.json` at the root** (§4, §5).
- **`plugin.json` has a *closed* schema** (§5.2). Only these top-level fields are
  allowed: `$schema`, `name`, `version`, `description`, `author`, `homepage`,
  `repository`, `license`, `keywords`, `extensions`.
  - **Required:** `$schema` (must be exactly
    `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`) and `name`.
  - `name` constraints (§5.5): 1–64 chars, `[a-z0-9.-]` only, first/last char
    alphanumeric, no `--` and no `..`. → **`lutrin`** is valid.
- **v1 defines exactly two portable component types** (§7): **Skills** and
  **MCP servers**. Commands, hooks, and agents are explicitly *out of v1* and
  belong only under a client extension namespace (§8) — see §8 of this plan.
- **Fixed discovery locations** (§6.1), non-overridable:
  - Skills → `skills/`, each immediate subdir containing a `SKILL.md`.
  - MCP servers → `mcp.json` at the plugin root.
- **Path containment** (§4.1): every plugin-relative path must start with `./`
  and resolve inside the plugin root. No `../` escapes.
- **MCP config** (§7.2): `mcp.json` is a closed object `{ "$schema", "mcpServers" }`
  where `$schema` must be `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`
  and its version **must match** `plugin.json`. Each server is a closed union
  keyed by `type` (`stdio` | `streamable-http` | `sse`).
- **stdio servers**: `command` is a *single token* — a bare name (resolved by
  the platform PATH) or a `./`-relative path — never a shell string. `args`,
  `env`, `cwd` support **`${PLUGIN_ROOT}`** and **`${PLUGIN_DATA}`** expansion
  (single, non-recursive). `env` MUST NOT define `PLUGIN_ROOT`/`PLUGIN_DATA`
  (the client provides them) and MUST NOT carry secrets.
- **Component failures are non-fatal** (§11.3): a broken MCP server must not
  disable the skill, and vice versa.

**Non-goals fixed by the spec:** no archive format, no registry, no OAuth/secret
mechanism, no `commands`/`hooks`/`agents` as portable components in v1.

---

## 2. How Lutrin maps onto the standard

Lutrin already owns both halves of a portable plugin:

| Plugin component | Lutrin asset it wraps | Portability win |
|---|---|---|
| Skill `deck` | Existing `.claude/skills/deck/SKILL.md` (already valid Agent-Skills frontmatter: `name`, `description`) | Works in any Agent-Skills client, not just `.claude/` |
| MCP server `lutrin` | `@lutrin/core` pipeline (`parse` → `validate` → `layout` → `pptx`/`html` renderers), already exported per-stage in `packages/core/package.json` | Any MCP agent can call `validate`/`build`/`suggest-layout` as tools |

The MCP server is the new engineering. It turns the CLI-shaped loop into
first-class tool calls, which is exactly what a non-Claude agent needs.

---

## 3. Proposed plugin layout

The **plugin root** is a top-level, git-tracked directory `plugin/` (the spec
favours directory-as-unit: inspectable with `ls`/`cat`/`git`, editable in place,
no archive tooling). Its build sources live in a normal workspace so the repo's
test/CI discipline still applies.

```
plugin/                              # THE PLUGIN ROOT (distributed as-is)
├── plugin.json                      # closed manifest, name: "lutrin"
├── mcp.json                         # one stdio server: "lutrin"
├── skills/
│   └── deck/
│       └── SKILL.md                 # synced from packages/core (single source)
├── bin/
│   └── lutrin-mcp.mjs               # built MCP server (see §5 packaging)
├── README.md
├── LICENSE                          # MIT
└── CHANGELOG.md

packages/mcp/                        # @lutrin/mcp — SOURCE of the server
├── package.json                     # depends on @lutrin/core
├── src/server.mjs                   # MCP stdio server (tool definitions)
├── build.mjs                        # esbuild → ../../plugin/bin/lutrin-mcp.mjs
└── test/*.test.mjs                  # node:test, matches repo convention
```

Rationale for the split: `plugin/` must stay a plain, standalone directory a
client can load directly; but the server's code deserves to be a real workspace
package with tests and a build step. `plugin/bin/lutrin-mcp.mjs` and
`plugin/skills/deck/SKILL.md` are **generated artifacts kept in sync**, verified
in CI — the same philosophy the repo already applies to the VSIX.

> **Single source of truth for the skill.** `SKILL.md` is authored once (keep
> the canonical copy in `packages/core`, where the demo/DSL it references lives)
> and copied into both `.claude/skills/deck/` and `plugin/skills/deck/` by a
> sync script, with a test asserting the three copies are byte-identical.

---

## 4. MCP server design (`@lutrin/mcp`)

A stdio MCP server (transport chosen for zero network + local file I/O) exposing
Lutrin's loop as tools. Proposed tool surface (final names TBD in §9):

| Tool | Wraps | Input → Output |
|---|---|---|
| `validate_deck` | `@lutrin/core/validate` | deck Markdown (or path) → positioned JSON diagnostics (overflows, low-res images, layout suggestions) — the `--json` doctor, as a tool |
| `build_deck` | `@lutrin/core/pptx` + `/html` | deck + `{format: pptx\|html, out}` → written file path + summary |
| `suggest_layout` | `@lutrin/core/layout` + `/suggest` | deck → per-slide inferred/alternative layouts |
| `list_kits` *(maybe)* | kit resolution | → available kits and active theme |

Design constraints:

- **Reuse, don't reimplement.** The server is a thin MCP adapter over existing
  core exports; no compiler logic moves into `packages/mcp`. This preserves the
  `deck/`-imports-no-backend boundary that `boundary.test.mjs` enforces.
- **Deck input by value or path.** Prefer accepting deck text inline (agent has
  it in context) with an optional path; write outputs under a caller-provided
  path or `${PLUGIN_DATA}`.
- **Errors are results, not crashes.** A deck that fails validation returns
  structured diagnostics (tool result), never a thrown transport error.

`mcp.json` (draft):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "lutrin": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/bin/lutrin-mcp.mjs"],
      "cwd": "${PLUGIN_ROOT}"
    }
  }
}
```

`command: "node"` (bare token, platform-resolved) + the script path in `args`
is the cross-platform-safe form; a `./bin/*.mjs` command token is not directly
executable on Windows.

---

## 5. Packaging & the native-dependency decision (the crux)

The core's heavy runtime deps do **not** bundle cleanly: `@resvg/resvg-js` is a
native `.node` binary and `puppeteer-core` needs a browser (used for Mermaid and
PDF). esbuild can bundle the pure-JS graph (as the VSIX does) but not these.

Three candidate strategies for shipping the server inside `plugin/`:

- **A — Bundle JS, degrade the native paths.** esbuild-bundle the server +
  core JS into `plugin/bin/lutrin-mcp.mjs`; expose `validate` / `build (pptx +
  html without Mermaid/PDF)` which need no native binary. Charts/equations/icons
  already carry a raster fallback; Mermaid degrades to a code block; PDF is a
  separate opt-in. **Fully offline, no install step.** *(Recommended MVP.)*
- **B — `npx @lutrin/mcp`.** `command: "npx"`, `args: ["-y", "@lutrin/mcp"]`.
  Trivial to ship, always current, native deps resolve via npm — but needs
  network on first run and an npm publish of `@lutrin/mcp`.
- **C — Install into `${PLUGIN_DATA}` on first run.** The spec blesses
  `PLUGIN_DATA` for `node_modules`/venvs that persist across updates. Most
  faithful to full-fidelity output, most moving parts.

**Recommendation:** ship **A** as the MVP (offline, self-contained, matches the
repo's "artifact verified from outside the tree" ethos), and document **B** as
the full-fidelity opt-in. Revisit **C** only if full Mermaid/PDF inside the
plugin becomes a hard requirement.

---

## 6. Conformance validation & testing

Matching the repo's testing culture (goldens, parity, "a test that fails before
the fix"):

1. **Manifest conformance test** (`packages/mcp/test/plugin-conformance.test.mjs`):
   assert `plugin.json` has only allowed top-level keys, the exact required
   `$schema`, a `name` passing every §5.5 constraint; assert `mcp.json` is the
   closed `{$schema, mcpServers}` shape, `$schema` versions match, and each
   server matches one closed variant with only `./`- or `${PLUGIN_*}`-rooted
   paths (no `../`). This encodes the spec's own checklist (Appendix A).
2. **Skill-sync test**: the `SKILL.md` in `packages/core`, `.claude/skills/deck`,
   and `plugin/skills/deck` are byte-identical.
3. **Server behaviour tests**: drive the stdio server over the MCP protocol
   against the hermetic `all-blocks.deck.md` fixture — `validate_deck` returns
   diagnostics, `build_deck` writes a real `.pptx`/`.html`.
4. **CI**: add a `plugin` step to `ci.yml` that rebuilds `plugin/bin/*` and
   `plugin/skills/*` and fails if the working tree differs (the artifacts are
   committed *and* reproducible) — the same guard used for `latest.json`/VSIX.

---

## 7. Documentation & distribution

- `plugin/README.md`: what the plugin provides, install path, the tool surface.
- Root `README.md`: a short "Agent Plugin" section beside the existing "agent
  skill" mention, linking the spec.
- `CHANGELOG.md`: an `Unreleased` entry (Keep-a-Changelog, per-package).
- Distribution is directory-based per the spec (git clone / copy `plugin/`);
  no registry work in scope.

---

## 8. Out of scope for v1 (by the spec)

`commands`, `hooks`, and `agents` are **not** portable components in v1. If
Lutrin wants Claude-Code-specific extras later, they go under a reverse-domain
client extension (`extensions["app.lutrin.claude"]` + an `app.lutrin.claude/`
directory) — additive, and invisible to clients that don't implement it. Not in
this milestone.

---

## 9. Decisions

**Locked:**

1. **MVP scope:** skill `deck` **+** MCP server `lutrin`, in one pass. The MCP
   server is the reason to go portable.
2. **Packaging (§5):** strategy **A** — esbuild-bundled, offline, self-contained
   in `plugin/bin/`. `validate` + `build (pptx/html)` need no native binary;
   Mermaid degrades to a code block and PDF is out of the bundled MVP. `npx`
   (strategy B) is documented as the full-fidelity opt-in, not shipped in M2.
3. **Plugin root location:** top-level `plugin/` (a plain, directly loadable
   directory, per the spec's directory-as-unit design).

**Still to confirm (non-blocking, can settle during M2):**

4. **Tool names & granularity** §4: `validate_deck` / `build_deck` /
   `suggest_layout` — exact names, and whether `build` splits per format.
5. **Reverse-domain namespace** for future client extensions: e.g.
   `app.lutrin.*` — reserve the convention now even if unused in v1.

---

## 10. Milestones

- **M1 — Scaffold & conformance.** `plugin/plugin.json`, `plugin/mcp.json`,
  `plugin/skills/deck/SKILL.md` (synced), conformance + sync tests green. Plugin
  is loadable and skill-valid even before the server exists.
- **M2 — MCP server.** `packages/mcp` with `validate_deck` + `build_deck`,
  esbuild build to `plugin/bin/`, behaviour tests, CI wiring.
- **M3 — Polish.** `suggest_layout`, READMEs, CHANGELOG, root-README section,
  the CI reproducibility guard.
