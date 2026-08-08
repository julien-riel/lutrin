# Plan 7 — the gaps the comparison pages concede

## Where this comes from

`site/lutrin-vs-marp.html`, `-slidev`, `-revealjs` and `-pandoc` each open with
a section naming what the other tool does better. That is the project's
credibility instrument: it concedes first, and every claim is meant to be
checkable by the maintainer of the compared project.

Concede honestly for long enough and the pages become a backlog. This file is
that backlog, read out of the four pages plus the "what this release does not
do" list, and sorted by **value ÷ cost** rather than by how loudly a gap is
felt.

Nothing here is committed to. It is the order to take them in **if** they are
taken, and two of the five are argued against.

## The shortlist

| # | What | Against | Cost | Verdict |
|---|---|---|---|---|
| 1 | [The responsive breakpoint](#1-the-responsive-breakpoint) | reveal.js | a media query and a decision | do it |
| 2 | [A PDF writer, and image export](#2-a-pdf-writer-and-image-export) | Marp | medium — the browser plumbing existed | **shipped** |
| 3 | [A reveal vocabulary per element](#3-a-reveal-vocabulary-per-element) | Slidev, reveal.js | medium, and it touches the timing tree | decide the principle first |
| 4 | [Editable OMML equations](#4-editable-omml-equations) | Pandoc | medium to large | worth it, eventually |
| 5 | [Reading a `.pptx` as content](#5-reading-a-pptx-as-content) | Pandoc | large | argued against |

Items 1 and 2 close a gap outright; 2 has shipped. Item 3 cannot start until a question of
principle is answered. Items 4 and 5 are honest about being expensive.

---

## 1. The responsive breakpoint

### The concession, as the page states it

> Lutrin's HTML is already a scrollable page — that is its default, and the
> slide-at-a-time mode is the opt-in, entered with `P` — but that page has no
> breakpoint of any kind. Every slide is scaled to the width of its container,
> so on a 390 px phone a 14 pt body set on a 1280 px grid comes out too small
> to read; the honest answer there is to turn the phone sideways and press `P`.
> **What Lutrin lacks is the responsive switch, not the mode.**

reveal.js auto-activates its scroll view below a configurable viewport width.

### Why it is first

It is the smallest item on this list and the only one that is a **readability
failure today**: a link to a deck opened on a phone is unreadable, and the
remedy is a gesture nobody is told about. Everything else here is a missing
capability; this one is a page that does not work.

### What it is in this architecture

`html/render.mjs` already scales each 1280 × 720 surface to its container with
an inline script (`FIT_SCRIPT`). The surface is fixed by design and must stay
so — the whole guarantee is that the HTML is geometrically identical to the
`.pptx`.

So the work is **not** to reflow a slide. It is to decide what a narrow
viewport gets instead:

- enter the slide-at-a-time mode automatically below a width, which is what
  reveal.js does; or
- keep the scroll but let each slide fill the viewport width in landscape
  terms, which means letterboxing; or
- say so on screen — a one-line hint offering `P` — which is the cheapest and
  the least magical.

The decision is the work. Whichever is chosen, it is a media query plus a
branch in the existing script, and `html.test.mjs` already asserts the document
structure the change would touch.

**Watch for:** the fragment mode (VS Code webview) must not get any of it, and
`prefers-reduced-motion` behaviour must stay as it is.

---

## 2. A PDF writer, and image export

**Shipped.** `--pdf`, `--png`, `--jpeg`, and `-o deck.pdf` on its own. What
follows is kept as it was written, with the outcome recorded at the end — an
estimate is most useful next to what it turned out to cost.

### The concession

Marp exports PDF, PNG and JPEG, and a presenter-notes text dump. Its PDF is not
a flat print: `--pdf-notes` writes the notes as PDF annotations and
`--pdf-outlines` adds a real outline of the slides.

`docs/dsl.md` already states our side without softening it:

> Say what this is not, because the gap matters: it is the **browser's** PDF,
> not a Lutrin PDF writer. No notes annotations, no outline of the slides, no
> PNG or JPEG export.

### Why the cost is medium and not large

**The browser plumbing already exists.** `deck/browser.mjs` finds a local
Chrome and drives it through `puppeteer-core` — today only so Mermaid has a
layout engine, but it is the same CDP session a PDF needs. Chrome's
`Page.printToPDF` produces the document and can emit a document outline;
`Page.captureScreenshot` gives the PNG and the JPEG.

So this is not "add a rendering pipeline". It is: render the standalone HTML we
already produce, drive the browser we already find, and add the two things the
browser does not give for free — the notes as annotations, and the slide
outline.

### What it changes elsewhere

- A CLI surface. The natural spelling follows the existing one:
  `lutrin build deck.md --pdf -o deck.pdf`, and an export of images beside it.
  *(Shipped as written, plus `--png` / `--jpeg`, which name a stem rather than
  a file since a deck is not one image.)*
- A dependency question to answer honestly: the PDF path would make a browser
  a **requirement** for one output format, where today it is optional and its
  absence degrades a diagram with a reported diagnostic. The refusal must be as
  loud as `RASTER_UNAVAILABLE` is.
- `docs/dsl.md`'s PDF section is written as a concession. It would be rewritten
  as a feature, and the concession narrowed to what still holds.

### What it actually cost

The estimate held. `pdf/render.mjs` is one module: it takes the standalone HTML
`renderDeckHtml` already produces, opens it in the browser `browser.mjs`
already finds, and asks for `page.pdf({ outline: true })`. No geometry, no
pagination, no second stylesheet.

Three things were learned in the doing, and each is a comment in the code now:

1. **The outline needed headings.** Chrome builds it from `h1`-`h6`, and a
   slide title is a `<div class="slide-title">`. Rather than change the markup
   every consumer reads, the heading is injected into the page for the print
   only — and skipped where the slide already carries one, or the cover is
   listed twice.
2. **A screenshot is not an impression.** The first images carried
   "P: presentation mode - ?: help" over the attribution, because the
   on-screen chrome is hidden by `@media print` and a screenshot is not print.
   The fix is `emulateMediaType('print')`, which also makes an exported image
   and its PDF page the same picture by construction.
3. **`page.pdf()` resolves to a `Uint8Array`**, whose `toString('latin1')`
   ignores its argument and returns `"37,80,68,70,..."`. Every check on the
   bytes silently answered no until `Buffer.from()` went in front of it.

**Not done, deliberately:** the notes as PDF annotations. That means writing
PDF objects, which means a PDF library, and the dependency is not worth one
flag. The comparison pages were narrowed to that one remaining claim rather
than losing the concession altogether.

---

## 3. A reveal vocabulary per element

### The concession

Slidev has `v-click` / `v-clicks` / `v-after` with relative *and* absolute
click indexes, motion bound to click ranges, per-slide transitions. reveal.js
ships more than a dozen named fragment effects, explicit ordering by index, and
nesting — one element can fade in, then turn red, then fade out.

Ours, stated exactly: `<!-- animate -->` reveals **one block at a time**, lists
point by point, `##` sections as a block. Four effects — `fade`, `wipe`,
`zoom`, `appear` — imposed on a whole slide or a whole deck, or chosen per
block from its nature. Nothing addresses a single element, nothing reorders,
nothing nests.

### The question to answer before any code

**Is a reveal order content, or is it positioning?**

The project's founding rule is that the author describes intent and the engine
decides the layout. "This point lands after that one" is arguably intent —
it is the shape of an argument. "This element fades, then turns red, then
leaves" is choreography, and choreography is a coordinate by another name.

The line has to be drawn deliberately, because the cheap version of this
feature is the one that quietly turns the DSL into a positioning language. My
reading: **ordering and grouping are intent; per-element effect chains are
not.** Which would mean something like "reveal these two bullets together, then
that one" — and nothing resembling `v-after` with an effect stack.

### What it costs once the principle is settled

It touches more than it looks:

- `deck/anim.mjs` — the shared effect table both renderers read;
- `html/render.mjs` — the splice that wraps an element with `data-step`;
- `pptx/anim.mjs` — the `<p:timing>` tree, which matches scene objects to
  shapes **by order of appearance** and drops every animation on a slide whose
  counts disagree. This is the same contract the SmartArt injector had to
  respect (see [smartart.md](smartart.md)), and it is unforgiving.
- `parity.test.mjs`, which requires the two outputs to mean the same thing by
  the same name.

Medium, but only after the principle. Starting with the code first is how this
one ends up shipped and regretted.

---

## 4. Editable OMML equations

### The concession

Pandoc writes equations into the `.pptx` as OMML — real PowerPoint equations
the recipient clicks into and edits. Ours goes through MathJax and lands as a
picture, which the release notes already say out loud: *"No editable OMML
equations: an equation is still a picture."*

### The path, and where it gets hard

MathJax already produces MathML on the way to the SVG we rasterise, and
MathML → OMML is a documented transform with a long-standing XSLT behind it.
The output goes into the text body as `m:oMath`, which PowerPoint's equation
editor opens.

What makes it medium-to-large rather than medium:

- an equation that converts *almost* right is worse than a picture, because the
  reader now has something they can edit into nonsense;
- the fallback has to stay. A construct the transform does not cover must
  degrade to today's picture rather than to a broken equation, which means the
  converter has to know what it does not know;
- PptxGenJS has no notion of `m:oMath`, so this is another post-write pass on
  the zip — the fifth. The pattern is well established by now
  (`morph.mjs`, `anim.mjs`, `svg.mjs`, `smartart.mjs`), including the
  fail-safe rule: any surprise leaves the picture standing.

### The file to match

`node scripts/reference-pptx.mjs` fetches two decks that already carry OMML,
and the difference between them is the design decision
([reference packages](../reference-pptx.md)):

- **`tdf129372.pptx`**, written by PowerPoint, wraps the equation in
  `mc:AlternateContent` — `mc:Choice Requires="a14"` holds
  `a14:m/m:oMathPara/m:oMath` with runs in Cambria Math, and `mc:Fallback`
  holds a **locked picture shape** (`a:blipFill` plus `a:spLocks` on rotation,
  aspect, points and text). PowerPoint writes both halves, every time.
- **`linear_perm_slides.pptx`**, written by a generator, drops `a14:m` straight
  into `<a:p>`: no `mc:AlternateContent`, no fallback. Editable in PowerPoint,
  invisible everywhere else.

The first shape means "the fallback has to stay" is satisfied by the format
rather than by a promise — the picture we already rasterise becomes the
`mc:Fallback` body, and a construct the transform cannot handle simply never
gets an `mc:Choice`. That is the target.

Worth doing, and worth not rushing.

---

## 5. Reading a `.pptx` as content

### The concession

Since 3.8.3 Pandoc reads `.pptx` as an **input** format: hand it a deck
somebody else wrote and get Markdown, docx, LaTeX or EPUB back.

### Why this is not the item it looks like

It is easy to think this is half-done. It is not. `lutrin kit import` reads a
`.potx`/`.pptx` and takes **the brand only** — that was the deliberate scope of
the change, down to its commit title: *"Read a brand out of the file the
designer already has, and only the brand."*

Reading the *content* is a different animal. The IR has no notion of arbitrary
placement, and an imported deck is nothing but arbitrary placement: text boxes
at coordinates, shapes at coordinates, a grid nobody declared. Either the
importer throws that away — and returns something the sender would not
recognise — or the IR grows a positioning model, which is the one thing this
engine exists to refuse.

### The honest version of it

If someone wants this, the shape worth building is **not** a converter. It is
an extractor: pull the text, the tables, the notes and the images out of a
`.pptx` into a Lutrin deck that says what the original *said*, and let the
engine lay it out afresh. That is a useful tool and a much smaller one, and it
should not be sold as round-tripping.

**Argued against as stated. Reopen it as an extractor, or not at all.**

---

## What the pages concede that is NOT a project

Recorded so nobody mistakes a refusal for a backlog item:

- **Complete visual control.** Marp blesses `position: absolute`. Lutrin will
  tell you no, and that is the product.
- **Free with nothing withheld.** A deck compiled without a paid licence
  carries the mark. That is a business decision, not an engineering gap.
- **Live code on stage** (Slidev's Monaco editor) and **drawing on the slide
  with a stylus**. Both belong to a talk-giving tool; this one compiles a
  document.
- **Extensibility as a web page** — plugin registry, JS API, iframes.
  Ours is a compiler with a fixed output contract.
- **Ecosystem and maturity.** 827,000 installs, 48,000 stars, 72,000 stars, a
  decade of answers. No commit closes this, and pretending otherwise on the
  comparison pages would cost more than the gap does.

## What closed in 1.3, and should not be re-listed

The comparison pages were corrected alongside that release, in both directions.
These are already ours: the reading mode (the stacked scrollable page **is** the
default; slide-at-a-time is the opt-in behind `P`), the next-slide preview, the
overview grid on `O`, the on-screen controls, the wall clock, the printable
page size, `kit import`, and the vector twin beside every raster.

## What every one of these must honour

The same rules as [the other plans](README.md), and none of it is negotiable:
the author describes intent and the engine decides the layout; both outputs are
born of the same scene; `src/deck/` knows no output format; no new dependency
without a reason that survives being written down.
