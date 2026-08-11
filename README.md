<div align="center">

# Lutrin

**Write Markdown. Get a real, editable PowerPoint. The engine does the layout.**

![CI](https://github.com/julien-riel/lutrin/actions/workflows/ci.yml/badge.svg)
[![npm](https://img.shields.io/npm/v/lutrin?color=cb3837&label=npm)](https://www.npmjs.com/package/lutrin)
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-007acc)](https://marketplace.visualstudio.com/items?itemName=lutrin.lutrin-vscode)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[🌐 Website](https://info.lutrin.app/) ·
[▶️ Try it in your browser](https://info.lutrin.app/playground.html) ·
[📖 The DSL](docs/dsl.md) ·
[🎨 Kit gallery](https://info.lutrin.app/gallery.html) ·
[🧩 VS Code extension](https://marketplace.visualstudio.com/items?itemName=lutrin.lutrin-vscode)

![Overview of Lutrin: a Markdown deck and the .pptx it produces](docs/images/overview.png)

</div>

Every deck costs two kinds of time: thinking about what to say, and nudging a
box 2&nbsp;px left, picking the blue again, shrinking the text until it fits —
then redoing all of it when the numbers change on Thursday. Lutrin deletes the
second kind. You write the content in Markdown; the compiler picks the layout,
places every block, guarantees legibility, and hands you a `.pptx` anyone can
open and retouch in PowerPoint — or a single-file HTML deck with a built-in
presenter mode. Change the numbers on Thursday and rebuild: the deck relays
itself.

```bash
npx lutrin new deck.md
npx lutrin build deck.md -o deck.pptx
```

That's the whole workflow. Node ≥ 22, nothing else installed. Or skip the
install entirely: the **[playground](https://info.lutrin.app/playground.html)**
runs the real compiler in your browser — type on the left, download the
`.pptx` it builds in your own tab, nothing uploaded anywhere.

## Features

- 🧠 **The engine decides the layout.** No coordinates, no CSS, no columns to
  wire up — the layout is inferred from the structure of what you wrote, and
  whatever doesn't fit is paginated. Your decks come out consistent because
  nobody hand-placed anything.
- 📤 **A genuinely editable `.pptx`, by default.** Native text boxes, shapes
  and tables, fonts embedded, reveal animations as native PowerPoint
  animations, LaTeX as real OMML equations you can click into. Text stays
  text — not one image per slide.
- 🖥️ **Single-file HTML with presenter mode.** Full screen, overview grid,
  speaker window with notes, timer and wall clock — press `P`. Printing it
  from the browser gives a correctly sized 16:9 PDF.
- 🩺 **A deck doctor that measures.** `lutrin validate` doesn't just parse: it
  measures overflows, flags under-resolved images, suggests better-suited
  layouts — as positioned JSON (`--json`), underlined in VS Code with
  quick-fixes.
- 🎨 **Brand kits.** Colors, fonts, logos and layouts travel as an installable
  kit — data only, never code. Start one from the `.potx` your designer
  already has (`lutrin kit import`), or in the
  [visual kit editor](https://info.lutrin.app/kit-editor.html).
  [Eight kits are published](https://info.lutrin.app/gallery.html) to try on.
- 📊 **Charts, diagrams, icons, math.** ` ```chart ` charts, Mermaid, Lucide
  icons, LaTeX, metrics, progress bars, status badges, a generated agenda —
  all from plain text directives. [The full DSL →](docs/dsl.md)
- 🔁 **Marp compatible.** `marp: true` in the frontmatter compiles an existing
  [Marp](https://marp.app) deck as it is; anything without a Lutrin
  equivalent is reported, never silently lost. [Details →](docs/marp.md)
- 🤖 **Built for agents.** Diagnostics as positioned JSON, an
  [Agent Plugin](plugin/) with an MCP server and a `deck` skill — a
  write → validate → fix → build loop your agent can actually close.

## Show me the file

This is a complete slide — no styling omitted, no theme wired up:

```markdown
# Request triage

<!-- layout: funnel -->

## 2,400 received
All channels combined.

## 1,100 eligible
After checking the criteria.

## 320 selected
Funded this year.
```

Not a single coordinate was written for any of these three — they come from
[`examples/demo.deck.md`](examples/demo.deck.md), which has 41 slides and
covers every layout and block type:

| Cover | Chart | Comparison |
|---|---|---|
| ![Cover slide](docs/images/cover.png) | ![Slide with a donut chart](docs/images/chart.png) | ![Two-column "pros / cons" slide](docs/images/pros-cons.png) |

The [live demo deck](https://info.lutrin.app/) is that same file, recompiled
on every push.

## Getting started

```bash
npx lutrin new deck.md                    # a starter deck that already compiles
npx lutrin build deck.md -o deck.pptx     # PowerPoint
npx lutrin build deck.md -o deck.html     # standalone HTML
npx lutrin preview deck.md                # local server, reloads on save
```

Install it once if you use it often: `npm install -g lutrin`. To explore what
the DSL can do, build the demo deck:

```bash
git clone https://github.com/julien-riel/lutrin.git
cd lutrin && npm install
npx lutrin build examples/demo.deck.md -o demo.pptx
```

Where to go next:

- **[docs/dsl.md](docs/dsl.md)** — the whole language: layouts, directives,
  charts, animations, notes, provenance.
- **[docs/dashboard-guide.md](docs/dashboard-guide.md)** — status boards and
  dense one-pagers, task by task.
- **[docs/cli.md](docs/cli.md)** — every command and its exact semantics.
- **[docs/kits.md](docs/kits.md)** — kits, themes, user layouts,
  configuration.

Two packages are published: [`lutrin`](https://www.npmjs.com/package/lutrin)
is the command, and
[`@lutrin/core`](https://www.npmjs.com/package/@lutrin/core) is the compiler
behind it — depend on the latter to call the compiler from your own code.

## One compiler, three ways in

```text
             packages/core  (parse → IR → layout → scene → renderers)
                    │
      ┌─────────────┼──────────────────────────────┐
      ▼             ▼                              ▼
  lutrin CLI    VS Code            agent skill (.claude/skills/deck)
  build/preview extension          write → validate → fix → build,
  validate/…    preview, export    with a visual check
```

- **CLI** — `build`, `preview`, `validate --json`, a local web editor
  (`lutrin edit`), kit tooling. [Reference →](docs/cli.md)
- **[VS Code extension](https://marketplace.visualstudio.com/items?itemName=lutrin.lutrin-vscode)** —
  live preview that follows your cursor, diagnostics underlined with
  quick-fixes, one-click `.pptx` export.
- **Agent Plugin** — conforms to the
  [Agent Plugins Specification v1.0.0](https://agent-plugins.org): the `deck`
  skill plus an MCP server ([`@lutrin/mcp`](packages/mcp/)) exposing
  `validate_deck`, `build_deck` and `suggest_layout` to any conformant agent
  client. [Details →](plugin/README.md)

What is green in one is green in all three — they host the same engine.

## Your brand, as a kit

```bash
lutrin kit import brand.potx      # start from the template the designer already has
lutrin kit edit my-kit            # visual editor: tokens, fonts, layouts, live WCAG checks
lutrin kit install acme.deckkit   # install; then `kit: acme` in any deck's frontmatter
```

A kit is pure data — installation runs nothing — and travels with the deck,
not with the binary. Set a default once (`lutrin config --kit my-kit`) and
every deck on your machine wears it, CLI and editors alike.
[The full kit story →](docs/kits.md)

## How it compares

Marp, Slidev, reveal.js and Pandoc are good tools, and for many uses the
right choice. Lutrin answers a different need:

- **Editable `.pptx` as the default output** — native shapes, text and tables
  from a pure Node pipeline, no browser, no LibreOffice. Marp and Slidev
  export images by default (Marp's editable mode is experimental and needs
  LibreOffice); reveal.js has no PowerPoint path; Pandoc's PPTX is native but
  nobody is doing measured layout for you.
- **The engine owns the layout** — where the others hand you HTML/CSS or
  utility classes when a slide overflows, Lutrin gives you no coordinates at
  all, and paginates what doesn't fit. A constraint, and a deliberate one: it
  is what makes decks homogeneous and automatable.
- **Validation that measures** — overflows, image resolution, layout
  suggestions, as positioned JSON an agent can act on.

And what they do better: reveal.js and Slidev are far richer for interactive
web presentations, Marp is mature with a large ecosystem, Pandoc converts
everything to everything. If you want pixel-level control, Lutrin will tell
you no. The four dated, sourced comparison pages:
[vs Marp](https://info.lutrin.app/lutrin-vs-marp.html) ·
[vs Slidev](https://info.lutrin.app/lutrin-vs-slidev.html) ·
[vs reveal.js](https://info.lutrin.app/lutrin-vs-revealjs.html) ·
[vs Pandoc](https://info.lutrin.app/lutrin-vs-pandoc.html)

## Free forever — and the one thing a licence buys

Everything above is free, MIT-licensed, with **no watermark limit, no slide
limit, no locked feature**. A deck compiled without a licence carries a
discreet "Made with Lutrin" at the bottom right of every slide; a licence
removes it — that is the entire difference.

| Tier | Covers | USD / year |
| --- | --- | --- |
| [Solo](https://buy.polar.sh/polar_cl_iejyJbWg2Lfbyp8iPgcG9lj1y85LOqnUZmebJ0OkEcV) | one person | $59 |
| [**Team**](https://buy.polar.sh/polar_cl_XgFavyTBtWMJFMOgpLU5Dx8oL1fHSBLFho0YH1MuC0T) | up to 10 people | **$449** |
| [Studio](https://buy.polar.sh/polar_cl_PGeTLcaEKYJsJAJarSg0UkW5smAL1SidX18pm3xM9Bj) | up to 30 people, CI included | $990 |
| [Organisation](https://buy.polar.sh/polar_cl_hsMt5mxtEmNoCgGMGCOdZyS2ne33ryyuVY6w50VktGC) | one legal entity, unlimited | $2,990 |
| [Solo, lifetime](https://buy.polar.sh/polar_cl_6ab8UxGtae4pRC2PKJQbVkV1lkmmIwmQJI9nE1RwuIG) | one person, current major line | $149 once |

A seat is a **person**, not a machine — use your key on every machine you work
on. Activate once (`lutrin license activate <key>`), then compile offline: no
build ever waits on the network. Full prices in USD and CAD, and how the
licence behaves offline: [pricing](https://info.lutrin.app/pricing.html) and
[docs/cli.md](docs/cli.md#license).

And since the code is MIT, removing the attribution by hand is both easy and
permitted. The licence is not a lock — it is what makes your commercial use
defensible, and what keeps the project alive.

## Contributing

`npm test` runs every workspace on the zero-dependency `node:test` harness;
`npm run lint` (biome) is blocking in CI. What a contribution needs — and
what will be refused — is in [CONTRIBUTING.md](CONTRIBUTING.md). Repository
map:

```text
packages/core/                 the compiler + CLI (bin: lutrin)
packages/vscode-extension/     the VS Code extension (hosts the core's worker)
packages/mcp/                  @lutrin/mcp — the MCP server
plugin/                        the portable Agent Plugin (agent-plugins.org)
.claude/skills/deck/           the agent skill
examples/                      demo deck, example kits, example theme
site/                          the landing page + in-browser playground
docs/                          the DSL, CLI, kits, Marp compatibility…
```

Security vulnerabilities go through GitHub Security Advisories, never a
public issue: [SECURITY.md](SECURITY.md).

## License

MIT — the code, including the licensing check itself. Third-party
dependencies: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**"Lutrin" is a trademark of Julien Riel**, and the MIT licence covers the
code, not the name. You may fork, modify and redistribute this software —
including with the attribution removed — but not under the name "Lutrin", nor
with its logo or branding, in a way that suggests it is this project or
endorsed by it. Rename your fork and it is entirely yours.

Removing the attribution from your own decks is what a seat buys; patching it
out of a redistributed build named "Lutrin" is what the trademark forbids.
