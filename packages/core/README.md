# @lutrin/core — the compiler

The engine behind [Lutrin](../../README.md): enriched Markdown (a DSL) →
PowerPoint `.pptx`, standalone HTML, PDF or one image per slide, with the page
layout decided by the engine. It carries the CLI implementation and serves as
a library for the editor host (the VS Code extension). The command itself is
published separately as [`lutrin`](https://www.npmjs.com/package/lutrin), a
thin entry point that depends on this package.

Neither of the two renderers is privileged: both consume the **same**
geometric **scene**, in pixels on a 1280 × 720 grid. The PDF and the images
are that same standalone HTML printed by a browser, so an exported frame and
its PDF page are one picture, not two renderings that agree today.

## Installation

To use the compiler as a library:

```bash
npm install @lutrin/core
```

```js
import { compileHtml } from '@lutrin/core';
import { parseDeck } from '@lutrin/core/parse';
import { validateDeck } from '@lutrin/core/validate';
```

For the command line, install [`lutrin`](https://www.npmjs.com/package/lutrin)
instead — or just `npx lutrin`. From a clone of the repository,
`npm link -w lutrin` puts the command on your PATH.

Node ≥ 22 (`engines.node`). The sources are executed as they are (ESM) — no
build step.

## CLI

```bash
lutrin new [<file.deck.md>] [--force]
lutrin build <deck.md> [-o output.pptx|.html|.pdf|.png] [--html|--pdf|--png|--jpeg] [--kit <ref>] [--smartart] [--vendor-assets] [--force] [--verbose]
lutrin preview <deck.md> [--port 4321] [--kit <ref>]
lutrin edit [directory] [--port 4323]
lutrin validate <deck.md> [--json] [--kit <ref>]
lutrin migrate <deck.md> [--to <rule-set>] [--dry-run]
lutrin vendor <deck.md> [--kit <ref>]
lutrin inspect <deck.md> [--kit <ref>]
lutrin config [--kit <ref>] [--unset]
lutrin kit install <file.deckkit|https://…> [--force] [--name <name>]
lutrin kit list | remove <name> | create <directory> [-o <file.deckkit>]
lutrin kit import <brand.potx|brand.pptx> [-o <directory>] [--name <name>]
lutrin kit edit <name|directory> [--port 4322] [--create] [--name <name>]
lutrin capabilities [<deck.md>] [--kit <ref>] [--json]
lutrin license activate <key> | status [--json] | deactivate
lutrin setup-mermaid [--yes]
```

The output format is deduced from the extension of `-o`. `--kit` takes
precedence over the deck's frontmatter; a bare name designates an installed
kit, everything else is a path resolved against the current directory.

**`--pdf`, `--png` and `--jpeg` need a browser**, and are the only outputs
that do: there is no degraded PDF, so the build refuses before writing a byte
and names the three ways to fix it (an installed Chromium, `lutrin
setup-mermaid`, `LUTRIN_BROWSER`). Everywhere else a missing browser or
rasterizer degrades and says so.

`lutrin migrate` writes the `inference:` pin into a deck's frontmatter and
names the slides a newer rule set would lay out differently — the escape hatch
for the versioned layout-inference rules (`docs/dsl.md`).

`lutrin edit` serves a local web editor for the `.deck.md` files of a
directory (the current one by default): tree, live preview, and per-slide
editing — a save rewrites only the lines of that slide, never the rest of
the file. It binds 127.0.0.1 only, like `lutrin kit edit` (port 4322) and
`lutrin preview` (port 4321).

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
| `src/deck/i18n.mjs` | the words the ENGINE writes, in the deck's language (`lang:`) — a leaf module tokens.mjs reads |
| `src/deck/chart.mjs` | `chart` blocks → SVG in the theme's style |
| `src/deck/assets.mjs` | remote images, Lucide icons, LaTeX, Mermaid (cache `~/.cache/lutrin/`) |
| `src/deck/browser.mjs` | finding a Chromium (Mermaid, PDF, images) — one resolution for all of them |
| `src/deck/smartart.mjs` | the geometry of the five diagram layouts, read by both renderers |
| `src/deck/highlight.mjs` | syntax highlighting of code blocks |
| `src/deck/suggest.mjs` | did you mean…? (edit distance) |
| `src/deck/anim.mjs` | the one entrance-effect table both renderers read |
| `src/deck/svg.mjs` | sanitizing outside SVG, and fitness to become an XML part |
| `src/deck/slice.mjs` | slide-level splicing — the editors rewrite one slide, never the file |
| `src/deck/marp.mjs` | the Marp dialect (`marp: true`), and what it reports rather than loses |
| `src/pptx/render.mjs` | scene → PptxGenJS |
| `src/pptx/fonts.mjs` | embedding the theme's TTFs into the `.pptx` |
| `src/pptx/anim.mjs` | native animations (`<p:timing>`, one effect per block type) |
| `src/pptx/morph.mjs` | Morph transition between consecutive slides sharing a title |
| `src/pptx/svg.mjs` | vector twin of a picture (`asvg:svgBlip`), the PNG kept as the fallback |
| `src/pptx/equations.mjs`, `omml.mjs` | the picture turned into a native OMML equation; it stays as the fallback |
| `src/pptx/smartart.mjs`, `diagram-parts.mjs` | the picture turned into a genuine SmartArt object (`--smartart`) |
| `src/pptx/zip-tidy.mjs` | the package Office writes: no zip directory entries |
| `src/pptx/proofing.mjs` | the deck's language stamped on every run — what PowerPoint spell-checks against |
| `src/kit/from-template.mjs` | kit derived from a `.potx`/`.pptx` — colours and type only, never geometry |
| `src/html/render.mjs` | scene → standalone HTML document (+ fragment mode) |
| `src/pdf/render.mjs` | the standalone HTML printed by a browser: PDF, PNG, JPEG |
| `src/kit/archive.mjs` | `.deckkit` archives — package, download, install |
| `src/kit/edit-server.mjs` | `lutrin kit edit` — the kit editor's local server |
| `src/edit-server.mjs` | `lutrin edit` — the deck editor's local server |
| `src/license/` | the seat licence: activation, cached record, the attribution |
| `src/worker/worker.mjs` | IPC worker of the editor host (types in `protocol.d.ts`) |
| `src/vendor.mjs` | `lutrin vendor` — freezing the deck's external dependencies |
| `design/themes/default.json` | canonical mirror of the default theme, a template to copy |
| `design/layouts/*.json` | the catalog of the twenty-four official layouts |

`src/deck/` is the core: it knows no output format and imports no backend
library — `test/boundary.test.mjs` verifies it.

## Tests

```bash
npm test -w @lutrin/core
UPDATE_GOLDEN=1 npm test    # from the root, after an intended engine change
```

A `node:test` harness, with no test dependency. See
[CONTRIBUTING.md](https://github.com/julien-riel/lutrin/blob/main/CONTRIBUTING.md).

## Licence and attribution

A deck compiled without a licence carries a discreet "Made with Lutrin" at the
bottom right of every slide, in the `.pptx` as in the HTML. A licence removes it
— $59 USD a year for one person, $449 for a team of ten, up to $2,990 for an
organisation. See the [pricing](https://info.lutrin.app/#pricing).
A seat is a **person**, and each one gets a key usable on every machine they
work on.

```bash
lutrin license activate <key>   # activates this machine on the key
lutrin license status           # state, last check with Polar
lutrin license deactivate       # releases this machine
```

Activation is the only step that needs the network. The state is cached in
`~/.config/lutrin/license.json`, no compilation ever waits on Polar, and a
licence keeps working for 30 days without a successful re-check. Programmatic
callers may force the mention on or off with the `branding` option of the
renderers, which is what the test suite does.

## License

MIT — the code, including the licensing check. Third-party dependencies:
[THIRD-PARTY-NOTICES.md](https://github.com/julien-riel/lutrin/blob/main/THIRD-PARTY-NOTICES.md).

"Lutrin" is a trademark of Julien Riel: the MIT licence covers the code, not the
name. Fork freely — under another name.
