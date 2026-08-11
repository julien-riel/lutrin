# lutrin

**Write Markdown. Get a real, editable PowerPoint. The engine does the
layout.**

[![npm](https://img.shields.io/npm/v/lutrin?color=cb3837&label=npm)](https://www.npmjs.com/package/lutrin)
![CI](https://github.com/julien-riel/lutrin/actions/workflows/ci.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/julien-riel/lutrin/blob/main/LICENSE)

[🌐 Website](https://info.lutrin.app/) ·
[▶️ Try it in your browser](https://info.lutrin.app/playground.html) ·
[📖 The DSL](https://github.com/julien-riel/lutrin/blob/main/docs/dsl.md) ·
[🎨 Kit gallery](https://info.lutrin.app/gallery.html)

![Overview of Lutrin: a Markdown deck and the .pptx it produces](https://raw.githubusercontent.com/julien-riel/lutrin/main/docs/images/overview.png)

You write the content; the compiler picks the layout, places every block,
guarantees legibility, and hands you a `.pptx` anyone can open and retouch in
PowerPoint — or a single-file HTML deck with a built-in presenter mode. No
coordinates, no CSS, no theme to wire up. Change the numbers on Thursday and
rebuild: the deck relays itself.

```bash
npx lutrin new deck.md                    # a starter deck that already compiles
npx lutrin build deck.md -o deck.pptx     # PowerPoint
npx lutrin build deck.md -o deck.html     # standalone HTML
npx lutrin preview deck.md                # local server, reloads on save
npx lutrin validate deck.md               # positioned diagnostics
```

Node ≥ 22, nothing else. Install it once if you use it often:
`npm install -g lutrin`.

## What a slide looks like

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

Not a coordinate in sight — the engine infers the layout from the structure
and paginates whatever doesn't fit. The
[live demo deck](https://info.lutrin.app/) is one Markdown file with 41
slides, recompiled on every push.

## Features

- 🧠 **The engine decides the layout** — decks come out consistent because
  nobody hand-placed anything.
- 📤 **A genuinely editable `.pptx`** — native text, shapes and tables, fonts
  embedded, animations as PowerPoint animations, LaTeX as real equations. Not
  one image per slide.
- 🖥️ **Single-file HTML with presenter mode** — speaker window, notes, timer;
  printing gives a 16:9 PDF.
- 🩺 **A deck doctor that measures** — overflows, under-resolved images,
  layout suggestions, as positioned JSON (`--json`) an agent or a CI can act
  on. `build` refuses to ship a deck with errors.
- 🎨 **Brand kits** — colors, fonts, logos and layouts as an installable kit;
  start one from your designer's `.potx` with `lutrin kit import`.
- 🔁 **Marp compatible** — `marp: true` compiles an existing
  [Marp](https://marp.app) deck as it is.

The same engine also runs as a
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=lutrin.lutrin-vscode)
(live preview, quick fixes, one-click export) and
[in your browser](https://info.lutrin.app/playground.html) — nothing
uploaded, the `.pptx` is built in your own tab.

## Docs

- [The DSL](https://github.com/julien-riel/lutrin/blob/main/docs/dsl.md) —
  layouts, directives, charts, Mermaid, icons, math, animations, notes.
- [CLI reference](https://github.com/julien-riel/lutrin/blob/main/docs/cli.md)
  — every command and its exact semantics.
- [Kits](https://github.com/julien-riel/lutrin/blob/main/docs/kits.md) —
  your brand as a distributable unit.
- [Status boards](https://github.com/julien-riel/lutrin/blob/main/docs/dashboard-guide.md)
  — dense one-pagers, task by task.

## This package

`lutrin` is a thin entry point: it installs the command. Everything — the
compiler, the layout engine, the renderers and the official layout catalog —
lives in [`@lutrin/core`](https://www.npmjs.com/package/@lutrin/core), its
only dependency. Depend on `@lutrin/core` directly if you want the library.

## Free forever

No watermark limit, no slide limit, no locked feature. A deck compiled
without a licence carries a discreet "Made with Lutrin" on every slide; a
[licence](https://info.lutrin.app/pricing.html) removes it — that is the
entire difference.

MIT © Julien Riel
