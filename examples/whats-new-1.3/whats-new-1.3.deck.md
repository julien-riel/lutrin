---
title: What the deliverable gained
subtitle: A sharper PowerPoint, an HTML that stopped being the poor relation
author: Lutrin
date: August 2026
footer: New in the compiler · one source, two deliverables
notes: This note is written in the frontmatter — the cover had no way to carry one until now. Open the presenter view with N and you are reading it.
---

# What is new

- The **HTML output** caught up: entrance effects, an overview grid, on-screen
  controls, a wall clock — and a print stylesheet that finally sizes the page
- Every **figure in the `.pptx`** now carries its vector as well as its raster
- Four **diagram layouts** — a cycle, a tree, a Venn, a hub — and, on request,
  real **SmartArt** PowerPoint will edit
- **Morph** is no longer limited to pagination: consecutive slides sharing a
  title glide into each other
- A **kit** can be derived from your brand's PowerPoint template
- Two silences were closed, and the first step got shorter
- Everything below is **this one file**, compiled to `.pptx` and to HTML

<!-- notes: the cover slide above carries a note written in the frontmatter — that is new. Every other note, like this one, is written in the slide. -->

# The HTML stopped being the poor relation

<!-- layout: pillars -->

## Effects that mean one thing

![](lucide:sparkles)

`<!-- animate: zoom -->` produced a zoom in PowerPoint and a plain toggle in
the browser. Both outputs now read the **same table**.

## Chrome a projector needs

![](lucide:presentation)

A progress bar, prev/next controls that follow the pointer, an overview grid
on `O`, and a wall clock beside the timer.

## A page that prints

![](lucide:printer)

The print stylesheet was complete but never set the page size, so a browser
laid 16:9 onto A4. One declaration later, printing gives a real deck.

# One effect, both outputs

<!-- animate: zoom -->

Every block on this slide is revealed with the **zoom** effect — in the
`.pptx` as a native on-click animation, in the HTML as the same movement.

The effect is not copied from one renderer to the other. Both ask the same
table, so a named effect cannot drift.

A reader whose system asks for stillness gets the steps without the travel.

# The keys the exported HTML answers to

| Key | What it does |
|---|---|
| `P` | Enter or leave presentation mode |
| `→` `Space` | Next step, then next slide |
| `O` | Overview: every slide as a grid, click to jump |
| `N` | Presenter view — notes, timer, wall clock, next slide |
| `Esc` | One step out at a time: help, then grid, then the mode |
| `?` | Help |

No server, no build step: double-click the `.html`.

<!-- notes: the overview grid shows animated slides with every step revealed — an overview whose job is to help you find a slide cannot show it as the blank it is before the first click. -->

# The PowerPoint got sharper

Charts, Mermaid diagrams, icons and equations were rasterised, and the SVG
they were born from was thrown away one line later.

The `.pptx` now ships **both**. The picture's fill stays the PNG; the vector
rides in an extension PowerPoint 2019 and later prefer.

The vector this chart ships weighs 2.4 kB. Measured on this very deck:

```chart
type: barh
categories: Icon, Chart, Equation
Vector added (kB): 0.4, 2.4, 8.2
```

# The PowerPoint got sharper

Zoom into the chart on the previous slide in PowerPoint 2019 or later and it
stays crisp. Open the same file in Keynote and you see exactly the image you
saw before — byte for byte.

$$ \text{deliverable} = \text{raster} + \text{vector} $$

That is the whole design: an upgrade for readers that can take it, never a
demand made of the others.

<!-- notes: these two slides share a title, so PowerPoint morphs between them — the title holds still while the content changes. Nothing was written to ask for it. -->

# What the vector changes, and what it does not

<!-- layout: comparison -->

## Left as it was

- The PNG is still the picture's fill
- Keynote, LibreOffice and Office before 2019 draw it, unchanged
- A figure is still a picture, not an editable object
- An SVG we cannot vouch for stays a raster, silently sharp-free

## Gained

- PowerPoint 2019+ draws the vector: sharp at any zoom
- Costs 12 kB here — under 5 % of the file
- Charts, diagrams, icons and equations, all four
- Nothing to write in the deck

# Four shapes an outline could not make

<!-- layout: cycle -->

<!-- notes: This slide IS a cycle layout — four `##` sections and nothing else. The other three are `hierarchy`, `venn` and `radial`. -->

## Cycle

A process that returns to where it started.

## Hierarchy

A tree, written as a nested bullet list.

## Venn

Discs that overlap; the intersection is the point.

## Radial

A hub, and whatever leans on it.

# One diagram, two ways to ship it

<!-- layout: comparison -->

## By default

- Native PowerPoint **shapes** — real discs, boxes and arrows you can select
- Pixel-identical to the HTML, because both read one set of coordinates
- Displays **everywhere**: Keynote, Quick Look, Google Slides, LibreOffice
- Nothing to ask for

## With `--smartart`

- A genuine **SmartArt object**: Text Pane, Change Layout, Change Colors
- PowerPoint re-lays it out with its own engine — the frame, the node count,
  the reading order and the palette are what carry over
- **Keynote and Quick Look show nothing**, which is why it is opt-in
- `smartart: true` in the frontmatter does the same

# Morph, without asking for it

Two consecutive slides with the same `# title` now glide into each other. It
used to happen only between the "(cont.)" pages pagination creates.

:::info
Different titles are how you opt out. A title that comes back far apart is a
coincidence, not a continuity, and gets nothing.
:::

The two "The PowerPoint got sharper" slides earlier in this deck are the
demonstration — open the `.pptx` and step through them.

# Your brand, from the file your designer already has

<!-- layout: comparison -->

## Imported

- The theme's **colour scheme** — 12 slots become 14 tokens
- The two **type families**
- The **chart palette**, accents 1 to 6 in order

## Deliberately not

- Layouts, placeholder positions, master geometry
- The embedded font data, the media
- Anything that is a coordinate

# What that refusal costs, and buys

```
lutrin kit import brand.potx -o ./brand
lutrin build deck.md --kit ./brand
```

The command **counts what it left behind** and writes a README into the kit,
so nobody assumes their layouts travelled.

:::warning
A palette that fails the WCAG thresholds is reported, never quietly adjusted.
A brand corrected behind your back is no longer your brand.
:::

# Two silences, closed

<!-- layout: comparison -->

## Was silent

- A mistyped `:::Info` in a Marp deck printed its own colons onto the slide,
  with no diagnostic at all
- The cover generated from `title:` was the one slide that could carry no
  presenter note

## Now says so

- A casing slip is reported — as a **warning**, so a third-party deck that
  compiles today still compiles
- `notes:` in the frontmatter reaches the `.pptx` notes and the presenter
  view. This deck's cover uses it

# A shorter first step

```
lutrin new pitch
lutrin preview pitch.deck.md
```

`lutrin new` writes a starter deck that compiles **without a single
diagnostic** — the same one the VS Code command opens, from the same source.

Before it, a CLI user had nothing to open the editor on: `lutrin edit` refuses
to scaffold, on purpose.

# What this release does not do

- No PDF **writer** — a browser printing the HTML is not the same thing: no
  notes annotations, no bookmarks, no image export
- No editable OMML equations: an equation is still a picture
- SmartArt is **not** the default, and will not become it: the object is
  invisible to Apple's importer, so making it automatic would silently empty a
  slide for Mac readers
- No per-element animation, no transitions engine in the HTML
- The engine still decides every layout, and always will

<!-- notes: saying what a release does not do is the part that makes the rest believable. -->

# One source, two deliverables

Everything in this deck came out of a single Markdown file, compiled twice.

> Write content, not layout.

Read the whole DSL in `docs/dsl.md`, or run
`lutrin capabilities <deck.md>` for what this build actually supports.
