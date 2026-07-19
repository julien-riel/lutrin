# @lutrin/core — the compiler

The engine behind [Lutrin](../../README.md): enriched Markdown (a DSL) →
PowerPoint `.pptx` or standalone HTML, with the page layout decided by the
engine. It provides the `lutrin` CLI, and serves as a library for the editor
hosts (VS Code extension, Obsidian plugin).

Neither output format is privileged: both renderers consume the **same**
geometric **scene**, in pixels on a 1280 × 720 grid.

## Installation

The package is not published on npm yet. From a clone of the repository:

```bash
npm install                 # at the root of the monorepo
npx lutrin --help

npm link -w lutrin          # to call "lutrin" from anywhere
```

Node ≥ 22 (`engines.node`). The sources are executed as they are (ESM) — no
build step.

## CLI

```bash
lutrin build <deck.md> [-o output.pptx|output.html] [--kit <ref>] [--vendor-assets] [--force] [--verbose]
lutrin preview <deck.md> [--port 4321] [--kit <ref>]
lutrin validate <deck.md> [--json] [--kit <ref>]
lutrin vendor <deck.md> [--kit <ref>]
lutrin inspect <deck.md> [--kit <ref>]
lutrin config [--kit <ref>] [--unset]
lutrin kit install <file.deckkit|https://…> [--force] [--name <name>]
lutrin kit list | remove <name> | create <directory> [-o <file.deckkit>]
lutrin capabilities [<deck.md>] [--kit <ref>] [--json]
```

The output format is deduced from the extension of `-o`. `--kit` takes
precedence over the deck's frontmatter; a bare name designates an installed
kit, everything else is a path resolved against the current directory.

**`build` does not deliver a deck in error.** If validation returns at least
one diagnostic of severity `error` — unknown directive, non-existent layout,
kit requested EXPLICITLY (`--kit` or the frontmatter's `kit:`) but
unresolvable — the command prints the errors, exits with **exit code 1** and
writes no file. `--force` compiles anyway, errors on screen, and exits with
code 0: that is for a draft one wants to see. A kit coming from an
**implicit** default (project, user, host) and not found stays a mere
warning, and does not prevent compilation.

Exit codes: `0` success; `1` error — invalid argument or flag, input file not
found, explicit kit unresolvable, deck carrying `error` diagnostics (except
`build --force`). `validate` exits with 1 as soon as one `error` remains;
`inspect`, `vendor` and `capabilities` do not open the deck's diagnostics and
exit with 0 — with the one reservation that an explicit unresolvable kit
stops them too, with 1.

The DSL is documented in [docs/dsl.md](../../docs/dsl.md). `lutrin
capabilities` reports as JSON what the **installed** engine actually supports
(layouts, parameters, directives, chart types, diagnostic codes): it is the
source to query rather than to guess at.

Its scope depends on what it is given:

| Form | What is published |
|---|---|
| `lutrin capabilities` | the **bare** engine — built-in layouts and the official catalog; `userLayouts` always empty |
| `lutrin capabilities <deck.md>` | in addition: the frontmatter's `kit:` honoured, its layouts, and the `layouts/*.json` next to the deck |
| `lutrin capabilities --kit <ref>` | the catalog of that brand, with the current directory serving as the base |

`--kit` takes precedence over the frontmatter's `kit:`, as it does for every
other command (`--theme` remains a deprecated alias). A kit requested
explicitly and unresolvable exits with **exit code 1** without writing
anything to stdout — never a generic catalog delivered in silence. A
`layouts/*.json` that could not be read produces a warning on **stderr**:
stdout stays pure JSON, usable by `jq`. `--json` is the explicit form of the
default, and has no effect.

## API

The package is ESM and exposes subpath entry points:

```js
import { compileHtml } from '@lutrin/core/html';

const { html, stats } = await compileHtml(markdown, { baseDir });
// { fragment: true } → { slides, css, fontsCss, … } for a webview
```

| Subpath | Contents |
|---|---|
| `@lutrin/core`, `/html` | `renderDeckHtml`, `compileHtml` — standalone HTML or fragment |
| `/pptx` | `renderDeck` — writing the `.pptx` |
| `/parse` | `parseDeck` — Markdown → IR |
| `/layout` | `buildScenes`, `blockHeight`, the layout registry |
| `/validate` | `validateDeck`, `capabilities` |
| `/context` | `prepareDeckContext` — kit + layouts, to be called before `buildScenes` |
| `/theme` | `resolveTheme`, `applyTheme`, WCAG contrast |
| `/tokens` | the living design tokens |

Mandatory call order for a host: `parseDeck` →
`prepareDeckContext(meta, { baseDir, themePath, defaultTheme })` →
`buildScenes` → renderer. The tokens and the layout registry are module state
mutated in place; `prepareDeckContext` resets them on every compilation,
which makes a warm process (worker, preview server) safe between two decks.

## The pipeline

```text
Markdown → AST (markdown-it) → IR → layout engine → scene → renderer
```

| File | Role |
|---|---|
| `src/deck/parse.mjs` | Markdown → IR (`deck → slides → sections → blocks`, with the source line) |
| `src/deck/layout.mjs` | layout inference, placement in regions, pagination; the layout registry |
| `src/deck/validate.mjs` | positioned diagnostics (`validateDeck`) and `capabilities()` |
| `src/deck/context.mjs` | the single insertion point for the kit and the layouts |
| `src/deck/theme.mjs` | resolution and validation of a theme, WCAG contrast |
| `src/deck/kit.mjs` | the `kit.json` manifest — reading, validation, internal paths |
| `src/deck/tokens.mjs` | design tokens of the generic design (mirror of `design/themes/default.json`) |
| `src/deck/chart.mjs` | `chart` blocks → SVG in the theme's style |
| `src/deck/assets.mjs` | remote images, Lucide icons, LaTeX, Mermaid (cache `~/.cache/lutrin/`) |
| `src/deck/highlight.mjs` | syntax highlighting of code blocks |
| `src/deck/suggest.mjs` | did you mean…? (edit distance) |
| `src/pptx/render.mjs` | scene → PptxGenJS |
| `src/pptx/fonts.mjs` | embedding the theme's TTFs into the `.pptx` |
| `src/pptx/anim.mjs` | native animations (`<p:timing>`, one effect per block type) |
| `src/pptx/morph.mjs` | Morph transition of "(cont.)" slides |
| `src/html/render.mjs` | scene → standalone HTML document (+ fragment mode) |
| `src/kit/archive.mjs` | `.deckkit` archives — package, download, install |
| `src/worker/worker.mjs` | IPC worker of the editor hosts (types in `protocol.d.ts`) |
| `src/vendor.mjs` | `lutrin vendor` — freezing the deck's external dependencies |
| `design/themes/default.json` | canonical mirror of the default theme, a template to copy |
| `design/layouts/*.json` | the catalog of the ten official layouts |

`src/deck/` is the core: it knows no output format and imports no backend
library — `test/boundary.test.mjs` verifies it.

## Tests

```bash
npm test -w @lutrin/core
UPDATE_GOLDEN=1 npm test    # from the root, after an intended engine change
```

A `node:test` harness, with no test dependency. See
[CONTRIBUTING.md](https://github.com/julien-riel/lutrin/blob/main/CONTRIBUTING.md).

## License

MIT. Third-party dependencies:
[THIRD-PARTY-NOTICES.md](https://github.com/julien-riel/lutrin/blob/main/THIRD-PARTY-NOTICES.md).
