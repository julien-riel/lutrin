# Lutrin

![CI](https://github.com/julien-riel/lutrin/actions/workflows/ci.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[info.lutrin.app](https://info.lutrin.app/)** — the
landing page, with a live demo deck recompiled on every push.

**Lutrin compiles enriched Markdown into an editable PowerPoint or a
standalone HTML page, and it is the engine — not the author — that decides
the layout.**

![Overview of Lutrin: a Markdown deck and the .pptx it produces](docs/images/overview.png)


You write the intent and the content; the compiler picks the layout, places
the blocks, guarantees legibility and produces a `.pptx` that anyone can then
open and retouch in PowerPoint. The HTML output is a single file, with a
built-in presenter mode (full screen, notes, timer, second window — the `P`
key).

Validation ships a "deck doctor": measured overflows, layouts suggested from
the content, under-resolved images. In the CLI (`--json` for agents) and
underlined in VS Code, with a quick-fix.

Three entry points, one compiler (`packages/core`):

```text
             packages/core  (parse → IR → layout → scene → renderers)
                    │
      ┌─────────────┼──────────────────────────────┐
      ▼             ▼                              ▼
  lutrin CLI    VS Code            agent skill (.claude/skills/deck)
  build/preview extension          write → validate → fix → build,
  validate/…    preview, export    with a visual check
```

## Getting started

Node ≥ 22 is required. Nothing else — write a `deck.md` and run:

```bash
npx lutrin build deck.md -o deck.pptx     # PowerPoint
npx lutrin build deck.md -o deck.html     # standalone HTML
npx lutrin preview deck.md                # local server, reloads on save
```

Install it once if you use it often:

```bash
npm install -g lutrin
```

To see what the DSL can actually do, start from the demo — it covers every
layout and every block type:

```bash
git clone https://github.com/julien-riel/lutrin.git
cd lutrin
npm install
npx lutrin build examples/demo.deck.md -o demo.pptx
```

Two packages are published: [`lutrin`](https://www.npmjs.com/package/lutrin)
is the command, and [`@lutrin/core`](https://www.npmjs.com/package/@lutrin/core)
is the compiler behind it — depend on the latter to call the compiler from your
own code.

The DSL — inferred layouts, `:::metric` / `:::warning` directives, status
boards (`:::progress`, `:::status`), ` ```chart ` charts, Mermaid, LaTeX,
Lucide icons, animations, notes — is documented in [docs/dsl.md](docs/dsl.md).
For a status board or a dense one-pager — progress bars, badges, aligned
figure columns, the text scale and what the engine fits by itself — start with
the task-by-task guide in
[docs/dashboard-guide.md](docs/dashboard-guide.md).

A deck written for [Marp](https://marp.app) compiles as it is: `marp: true`
in the frontmatter switches the parser to the Marp dialect — `---` slide
splits, presenter notes in comments, `![bg]` images, fragmented lists.
Details and the mapping table: [docs/marp.md](docs/marp.md).

## Why not Marp / Slidev / reveal.js / Pandoc?

These tools are good, and for many uses they are the right choice. Lutrin
answers a different need, which comes down to three points:

- **A genuinely editable `.pptx`, by default and with nothing else
  installed.** Be precise about this, because the sloppy version of the claim is
  wrong. *Pandoc's* PowerPoint output is already native and editable — text
  boxes, tables, OMML equations — and it is the wrong tool to accuse of
  exporting pictures. *Marp* exports one image per slide by default and does
  have `--pptx-editable`, which its own docs call experimental and which needs
  LibreOffice Impress on top of a browser. *Slidev*'s PPTX is images, by its own
  documentation. *reveal.js* has no PowerPoint path at all. Lutrin writes native
  shapes, text boxes and tables with the fonts embedded, in its only PPTX mode,
  from a pure Node pipeline — charts, equations and icons are rasterised images
  there, and saying otherwise would be the same overstatement. See the four
  comparison pages under [info.lutrin.app](https://info.lutrin.app/), each checked against
  the other project's current documentation and dated.
- **The layout is decided by the engine.** Elsewhere, you write HTML/CSS or
  utility classes when the slide overflows. Here you cannot: there is no
  coordinate, no explicit column in the DSL. The engine infers a layout from
  the structure of the content and paginates whatever does not fit. It is a
  constraint, and a deliberate one — it makes decks homogeneous and
  automatable, and it deprives you of pixel-level control.
- **Validation that measures.** `lutrin validate` does not only check the
  syntax: it measures overflows, flags images too low-resolution for the area
  they occupy, proposes a layout better suited to the content, and returns
  all of it as positioned JSON — usable by an agent in a write → validate →
  fix loop.

What the others do better: web rendering (reveal.js and Slidev are far richer
in interactivity, transitions and Vue components), the ecosystem and the
documentation (Marp is mature, widely adopted, with familiar CSS themes),
all-format conversion (Pandoc remains unrivaled), and layout freedom — if
you want to place an element at a precise spot, Lutrin will tell you no.

## A few layouts

Not a single coordinate was written in the Markdown: the three slides below
come from `examples/demo.deck.md`, which has 27 of them.

| Cover | Chart | Comparison |
|---|---|---|
| ![Cover slide](docs/images/cover.png) | ![Slide with a donut chart](docs/images/chart.png) | ![Two-column "pros / cons" slide](docs/images/pros-cons.png) |

## CLI

```bash
npx lutrin build <deck.md> [-o output.pptx|output.html] [--kit <ref>] [--force] [--verbose]
npx lutrin preview <deck.md> [--port 4321]     # local server + auto reload
npx lutrin validate <deck.md> [--json]         # positioned diagnostics
npx lutrin inspect <deck.md>                   # IR and scenes as JSON
npx lutrin vendor <deck.md>                    # freezes the deck's external dependencies
npx lutrin capabilities [<deck.md>] [--kit <ref>]   # layouts, directives… as JSON
npx lutrin license activate <key>              # claims a seat; removes the attribution
npx lutrin license status [--json]             # state of the licence on this machine
npx lutrin license deactivate                  # frees the seat for another machine
```

The output format is deduced from the extension of `-o`. Every compilation
command accepts `--kit <name|file.json|directory>` (see "Kits").

`capabilities` with no argument describes the **bare** engine: built-in
layouts and official catalog, `userLayouts` empty. **Passing it the deck** —
`npx lutrin capabilities my-deck.md` — honors the `kit:` of its frontmatter
and additionally publishes the kit's layouts and the `layouts/*.json` sitting
next to the `.md`: that is the form to query in a project with a brand. With
no deck, `--kit <ref>` publishes the catalog of that brand, the current
directory serving as the base. A kit asked for explicitly but not found is an
error (exit code 1, nothing on standard output) rather than a generic catalog
delivered in silence; a `layouts/*.json` that could not be read warns on the
error output only, so that `| jq` remains possible.

**`build` does not deliver a deck with errors.** If validation returns at least
one diagnostic of severity `error` — unknown directive, non-existent layout,
kit asked for explicitly but unresolvable — the command prints the errors,
exits with **exit code 1** and writes no file. `--force` compiles anyway,
errors on screen, and exits with code 0: that is for a draft you want to look
at. `validate` also exits with code 1 as soon as one error remains.

An important nuance about kits: an **explicit** kit (`--kit`, or `kit:` in the
frontmatter) that does not resolve is an error, and therefore blocks `build`.
A kit coming from an **implicit** default — project, user, editor host —
and not found returns only a warning: a stale user default must not block
the compilation of a project that asked for nothing.

## Kits — an organization's brand

A **kit** gathers a theme, its layouts, its fonts and its logos into one
distributable unit: a directory carrying a `kit.json`, or a `.deckkit`
archive. A kit travels **with the deck**, not with the binary — no
re-packaging of the VSIX.

```bash
lutrin kit install <file.deckkit | https://…>   # into ~/.config/lutrin/kits/
lutrin kit list
lutrin kit remove <name>
lutrin kit create <directory>                   # produces the .deckkit
lutrin kit edit <name|directory> [--create]     # local web editor (see below)
```

**`lutrin kit edit` opens a kit in a local web editor** — tokens with live
WCAG contrast checks, embedded fonts, layouts, images, `.deckkit` export —
with a preview compiled by the real engine, on 127.0.0.1 only. `--create`
scaffolds a fresh kit from the default theme. The full tour:
[docs/kit-editor.md](docs/kit-editor.md), or
[see it in pictures](https://info.lutrin.app/kit-editor.html).

**Eight kits are published and installable right now** —
[the gallery](https://info.lutrin.app/gallery.html) shows each of them with the same
slide compiled inside it, so the only thing that changes from one to the next
is the brand. Their sources are in [`examples/kits/`](examples/kits/); the
brands are archetypes, invented so that no real organization's identity is
shipped.

A kit contains only **data** — never code: installation runs nothing, refuses
any entry that would escape the kit, bounds the size and accepts only `https`.
The sha256 printed at installation is reproducible.

**No organization brand ships with Lutrin**: brand guidelines bind a trademark
— they belong to whoever holds it and live in their own repository.
`examples/kit-slate/` shows a complete, royalty-free kit, ready to copy.

Referencing a kit, by decreasing precedence:

1. CLI flag `--kit <name|file.json|directory>`;
2. frontmatter `kit:` — the name of an installed kit, a file relative to the
   deck, a kit directory, or `none` to force the generic theme:

   ```yaml
   kit: my-kit
   ```

   (`theme:` is still accepted as a deprecated alias, with a diagnostic.)
3. project default — `"lutrin": { "kit": … }` in the nearest `package.json`
   going up from the deck;
4. user default — `~/.config/lutrin/config.json` (see below);
5. host default — kit imposed by the editor host (the VS Code extension's
   `lutrin.defaultKit`);
6. generic theme "Slate".

### JSON theme and layouts, without a kit

The two pieces of a kit can also be used separately, placed next to the deck:

- **JSON theme** — a file that overrides the design tokens of the default
  theme (colors, fonts — families and embedded files —, logos, named images,
  chrome geometry, chart palette…); the derived groups (layers, callouts,
  trends) follow the palette. Any invalid entry becomes a diagnostic (`THEME_*`), and
  the WCAG thresholds are checked (`THEME_CONTRAST`). Complete template to
  copy: `packages/core/design/themes/default.json` (canonical mirror of the
  default theme, guaranteed no-op by an anti-drift test); example:
  `examples/theme-example.json`.
- **User layouts** — a `layouts/` directory defines validated aliases of the
  built-in layouts (`{ "name": "before-after", "base": "comparison",
  "sections": { "min": 2, "max": 2 } }`). Validation, "did you mean" and
  `capabilities` cover them for free — the last one on condition that it is
  passed the deck or `--kit`, failing which it does not see that directory.
  Examples: `examples/kit-slate/layouts/`.

Warm hosts (the extensions' worker, the preview server) reapply the context on
every compilation from a snapshot — never a leak of a theme or a layout
between two decks.

### User configuration — shared across projects and plugins

A kit chosen **once** applies to all your decks, in the CLI as well as in the
plugins:

```bash
lutrin config                    # directory, default kit, installed kits
lutrin config --kit my-kit       # default shared across every project
lutrin config --unset            # back to the host/generic default
```

The configuration lives in `~/.config/lutrin/` (overridable through the
`LUTRIN_CONFIG` variable; `XDG_CONFIG_HOME` honored): `config.json` carries
the user default (level 4 above), `kits/` the installed kits, referenceable by
name from any project.

In the plugins, this default is taken into account automatically (the
compilation worker reads the same configuration). The document always wins:
the frontmatter `kit:` and the project default take precedence.

## Licence — the attribution, and how to remove it

Lutrin is free to use, and a deck compiled without a licence carries a discreet
**"Made with Lutrin"** at the bottom right of every slide — in the `.pptx`, in
the standalone HTML and in the editor previews. That is the only difference
between the free and the paid tier: no watermark, no slide limit, no locked
feature.

A **licence removes the attribution**, sold per year through
[Polar](https://polar.sh):

| Tier | Covers | USD / year | CAD / year |
| --- | --- | --- | --- |
| [Solo](https://buy.polar.sh/polar_cl_iejyJbWg2Lfbyp8iPgcG9lj1y85LOqnUZmebJ0OkEcV) | one person | $59 | $79 |
| [**Team**](https://buy.polar.sh/polar_cl_XgFavyTBtWMJFMOgpLU5Dx8oL1fHSBLFho0YH1MuC0T) | up to 10 people | **$449** | $590 |
| [Studio](https://buy.polar.sh/polar_cl_PGeTLcaEKYJsJAJarSg0UkW5smAL1SidX18pm3xM9Bj) | up to 30 people, CI included | $990 | $1,290 |
| [Organisation](https://buy.polar.sh/polar_cl_hsMt5mxtEmNoCgGMGCOdZyS2ne33ryyuVY6w50VktGC) | one legal entity, unlimited | $2,990 | $3,900 |
| [Solo, lifetime](https://buy.polar.sh/polar_cl_6ab8UxGtae4pRC2PKJQbVkV1lkmmIwmQJI9nE1RwuIG) | one person, current major line | $149 once | $199 once |

**A seat is a person, not a machine**, and the count is *declarative*: nothing in
the tool counts your colleagues. You buy a tier and invite people by email; Polar
grants the benefit to each member individually, so everyone receives **their own
licence key**, usable on **as many machines as they work on** — laptop, desktop,
the build server, a CI runner.

```bash
lutrin license activate <key>     # activates this machine on the key
lutrin license status             # state, last check with Polar
lutrin license deactivate         # releases this machine, e.g. before wiping a laptop
```

**Activate once, then compile offline.** The activation is the only step that
needs the network: the state is cached in `~/.config/lutrin/license.json`
(mode 0600, beside `config.json`) and no compilation ever waits on Polar.
Lutrin re-checks with Polar at most once a week, *after* a deck has been
written, and a licence keeps working for **30 days** without a successful
check — a plane, a VPN or a Polar outage never brings the attribution back.
Past those 30 days, `lutrin license status` while online is what restores it.

The record is sealed against the machine it was activated on: copying
`license.json` to another machine does not license that machine, it just makes
the file be ignored. Run `activate` on each of your machines instead — it costs
nothing.

And since the code is MIT, removing the attribution by hand is both easy and
permitted. The licence is not a lock, it is what makes your commercial use
defensible — a deck you hand a client, produced by a tool you actually paid for,
with an invoice in your organisation's name. That, and it is what keeps the
project alive.

## VS Code extension

Live preview (updated as you type, following the cursor), diagnostics
underlined in the editor and `.pptx` export. Files named `*.deck.md` (or
carrying `deck: true` in the frontmatter) are validated automatically; the
preview opens through the "Show Presentation Preview" command on any Markdown,
and "Lutrin: New Presentation" opens a starter deck that already compiles.

Install it from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=lutrin.lutrin-vscode)
(search for "Lutrin" in the Extensions view), or build the VSIX yourself.

Development: open this repository in VS Code and press F5 (the build task
assembles `dist/` with the core symlinked). To produce an installable package:

```bash
npm run build -w lutrin-vscode     # esbuild → dist/
npm run vsix  -w lutrin-vscode     # → lutrin-vscode-<version>.vsix + latest.json
```

(`vsix` packages `dist/`: the build must have preceded it.) Then, in VS Code:
"Extensions: Install from VSIX…".

Settings: `lutrin.files` (glob of the decks validated by default),
`lutrin.debounceMs` and `lutrin.defaultKit` (default kit for this editor —
level 5 of the precedence above).

### Automatic updates from an internal server (optional)

Ignore this if you install the VSIX by hand. VS Code does not update an
extension installed from a VSIX on its own; for a team distributing
internally, the extension ships its own checker: publish the `.vsix` **and**
the `latest.json` (generated together by `npm run vsix`) at the same place on
a web server, then point the `lutrin.updateUrl` setting at the URL of the
`latest.json`. The extension checks on activation and then once a day, and
offers "Update". `http` URLs are refused and the sha256 digest of the manifest
is verified before installation.

## Tests

```bash
npm test                    # the three packages — node:test harness, zero dependencies
npm run test:core           # the engine alone: packages/core/test/
npm run typecheck           # the two editor hosts (tsc --noEmit)
npm run lint                # biome — BLOCKING in CI
```

`npm run lint` (`biome check .`) is run by the `format` job of the CI, which is
**blocking**: run it before you push. `npm run fmt` rewrites the formatting.

The harness covers: goldens of the IR and of the scenes on
`examples/demo.deck.md`, non-mutation of the IR by pagination, parity of the
`BLOCK_RENDERERS` tables of the two renderers, validation diagnostics.
`examples/demo.deck.md` is the renderer coverage fixture: a test fails
if a block type of the renderers does not appear in it — so every new
component must be added to it.

Regenerating the goldens after an intended change to the engine, and reading
their diff: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Structure

```text
packages/core/                 the compiler + CLI (bin: lutrin)
packages/core/design/themes/   default.json — canonical mirror of the default theme
packages/core/design/layouts/  the catalog of the twelve official layouts
packages/core/src/kit/         .deckkit archives (pack, download, install)
packages/core/src/worker/      the single IPC worker of the editor hosts (+ protocol.d.ts)
packages/core/test/            the node:test harness (goldens, parity, validation, kits)
packages/vscode-extension/     the extension (webview; launches the core worker)
packages/obsidian-plugin/      an Obsidian host, work in progress — builds and
                               tests here, but is not documented or released
                               yet; nothing above depends on it
.claude/skills/deck/           the agent skill
examples/demo.deck.md          covers every layout and block type — test fixture
examples/theme-example.json    example theme
examples/kit-slate/            complete example kit (theme + layouts/, royalty-free)
site/                          the landing page — deployed to GitHub Pages with the
                               demo deck recompiled at HEAD (.github/workflows/pages.yml)
```

## Contributing, reporting

[CONTRIBUTING.md](CONTRIBUTING.md) says what is expected of a contribution —
and what will be refused. A security vulnerability goes through GitHub
Security Advisories, never through a public issue: see
[SECURITY.md](SECURITY.md).

## License

MIT — the code, including the licensing check itself. Third-party dependencies:
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**"Lutrin" is a trademark of Julien Riel**, and the MIT licence covers the code,
not the name. You may fork, modify and redistribute this software — including
with the attribution removed — but not under the name "Lutrin", nor with its
logo or branding, in a way that suggests it is this project or endorsed by it.
Rename your fork and it is entirely yours.

Removing the attribution from your own decks is what a seat buys; patching it
out of a redistributed build named "Lutrin" is what the trademark forbids.
