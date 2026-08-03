# Status boards and dense one-pagers

This guide covers what the compiler gained for the slides that carry a lot at
once: a project board, a monthly review, a one-page summary. It assumes you
already write decks — [the DSL reference](dsl.md) documents everything else,
and `lutrin capabilities <deck.md>` is what is authoritative when this page and
the engine disagree.

## What changed, in five lines

- `:::progress` draws a labelled bar from `75 %`, `0.75` or `3/4`.
- `:::status` draws a row of badges; `==Owner==` puts one in a sentence.
- A table's `|---:|` delimiter row is honoured — figure columns line up.
- A region that will not fit is shrunk by the engine (`SLIDE_DENSIFIED`).
- Layouts gained `density`, `radius`, `align` and solid panel tints.

Everything below is a layout definition or a directive. As always, no
coordinate, no point size and no colour appears in a deck: you say what the
slide holds, the engine decides how it looks.

---

## Writing a status list

`:::progress` reads like `:::metric` — the figure first, then what it names:

```markdown
:::progress success
100 %
Online services
Delivered on 15 April
:::
```

| Line | Meaning |
|---|---|
| 1 | the **share**, `0`–`100 %` |
| 2 | the **label**, drawn to the left of the bar |
| 3 and beyond | an optional **caption**, drawn under the bar (extra lines are joined with a space) |

The word after the directive is the **tint**, and it is one of the four a
callout takes — `info`, `success`, `warning`, `danger`. Nothing after the
directive means `info`.

### Every spelling of the value

The first four spellings all produce the same bar. Pick the one that matches
how you talk about the number, not the one the parser prefers.

| You write | Value | Note |
|---|---|---|
| `75 %` | 0.75 | a space before the `%` is fine |
| `75%` | 0.75 | |
| `0.75` | 0.75 | a bare number is read as a share, not as a percentage |
| `3/4` | 0.75 | the fraction you would say out loud |
| `1` | 1 | the corollary, and the one real trap: a bare `1` is 100 %, not 1 % |
| `150 %` | 1 | **clamped** — a figure out of range is a typo in the figure, not in the syntax |
| `-10 %` | 0 | clamped the same way |
| `1/0` | — | not a share: `INVALID_PROGRESS` |
| `almost there` | — | not a share: `INVALID_PROGRESS` |

`INVALID_PROGRESS` is a warning, not an error: the card degrades to the
paragraph you actually wrote, exactly the way an unparsable ` ```chart ` falls
back to a code block. Nothing is ever drawn at a share nobody chose.

### The tint words, and what an unknown one does

```markdown
:::progress
0.45
Paper forms
:::

:::progress warning
3/4
Migration of the historical data
:::

:::progress danger
12%
Recruitment
Two positions still open
:::
```

An unknown word is **not** fatal. The bar is drawn in `info`, and validation
says which four words it knows:

```text
⚠ warning UNKNOWN_PROGRESS_KIND
  Unknown tint ":::progress critical" (tints: info, success, warning, danger)
  — the bar will be drawn in the "info" tint.
```

A word close enough to one of the four also gets a "did you mean" —
`:::progress warnin` ends the message with `(did you mean "warning"?)`. A word
as far off as `critical` does not; the list of four is all you get.

### Where the percentage sits

The engine writes the percentage **inside** the fill when the fill is wide
enough to hold it with its padding, and immediately to its right otherwise.
The threshold is computed once, in the engine, so the number is never in two
different places in the `.pptx` and the HTML. Inside the fill it takes the
tint's own ink; outside it takes the deck's secondary ink.

A bar at `0 %` draws no fill at all — an empty track already says what there
is to say, and a zero-width pill is an artefact.

### Keep the label short

The label column is **34 % of the region's width**, and it does not follow the
text scale (see [Fitting more on a slide](#fitting-more-on-a-slide)): it is
always the theme's body size. In practice, at the default 14 pt:

| The bar sits in | Label column | Fits about |
|---|---|---|
| a full-width slide (1184 px) | 403 px | 41 characters |
| a half-slide panel (548 px) | 186 px | 19 characters |

Past that, the HTML clips the label and PowerPoint wraps it out of its box —
the one place where the two outputs do not agree. "Online services" is a
label; "Migration of the historical data to the new platform" is a caption.

---

## Flagging items

### A row of badges

`:::status` is a **row**, one badge per comma. The severity rides on each
item, carried by a prefix:

| Prefix | Severity | Tint |
|---|---|---|
| *(none)* | success | green |
| `!` | caution | amber |
| `!!` | critical | red |
| `?` | for information | blue |

No prefix means success on purpose: a status board is a list of things that
are fine, with the exceptions marked.

```markdown
:::status
Scope, Schedule, Quality
!Budget, !Stakeholders
!!Recruitment
?Contract renewal
:::
```

Writing one severity per line, as above, is a **reading convenience, not
syntax** — the seven badges are one row, and the engine wraps them over as
many lines as the width needs. It reports the height it really occupies, so
pagination and `BLOCK_OVERFLOW` see the truth rather than an assumed row.

Two things to know before you copy the pattern:

- **The items are plain text.** `**Scope**`, `[Budget](…)` and `` `Quality` ``
  inside a `:::status` item are flattened to their text: bold, links and code
  spans do not survive. A badge is a word, not a sentence.
- **An item that is nothing but its prefix, or empty, is dropped silently.**
  `Scope, , !, Quality,` yields two badges and no diagnostic.

### A badge inside a sentence

The same object, written inline, with the same prefixes:

```markdown
Each commitment carries an ==Owner==; one that slips is tagged ==!At risk==,
and one that has stopped moving ==!!Blocked==. A note for information only is
==?FYI==.
```

It works anywhere inline text goes: a paragraph, a bullet, a quote, a table
cell, a `##` section heading, even the slide title.

The rule is deliberately narrow, so that `==` in ordinary prose stays what you
typed:

- the opening `==` pairs with **the next `==` on the same line** — a badge
  never spans a line break;
- a longer run of `=` is not an opening marker: in `A ==== run alone.` the
  four `=` stay four `=`;
- `` `==code==` `` inside a code span is never even visited;
- an opening marker with nothing but a prefix behind it (`==!==`) declines.

**The `.pptx` cannot draw the pill.** DrawingML gives a text run no rounded
background, so an inline badge is emitted as a run **highlight**: the tint and
the readable ink survive, the pill shape does not. In PowerPoint it reads as a
marker-pen highlight over the words; in the HTML it is a proper rounded pill.
This is a documented degradation, not a bug to report — a `:::status` row, on
the other hand, is drawn as real rounded shapes in both outputs, because there
the badges are placed by the engine rather than sitting in a paragraph.

Use the inline form for one word inside a sentence; use `:::status` when the
badges *are* the content.

---

## Money and figure columns

A table's delimiter row is now read and honoured in both outputs. Saying "this
column holds figures" is content, like `**bold**` — until this change
markdown-it resolved the marker and the engine dropped it without a word.

```markdown
| Line item          | Share | Committed | Status      |
|--------------------|:-----:|----------:|-------------|
| Licences           |  42 % |   1 517 k | ==On track== |
| Integration        |  31 % |   1 120 k | ==!Watch==  |
| Change management  |  27 % |     975 k | ==On track== |
```

- `|---:|` right-aligns the column, `|:-:|` centres it, `|:---|` and `|---|`
  leave it left.
- The alignment is read **once per column, from the header row**. Markdown has
  no per-cell syntax, and the engine does not invent one: every cell of a
  column is aligned the same way.
- A table whose delimiter row says nothing carries no alignment at all in the
  IR — an existing deck compiles byte-identically.

A right-aligned column also gets **tabular figures**
(`font-variant-numeric: tabular-nums`) in the HTML, so `1 517` and `975` line
up digit under digit rather than merely sharing a right edge. The `.pptx` does
not ask for them: DrawingML run properties carry no OpenType feature switch,
and the one OOXML mechanism that would (a decimal tab stop) means writing tab
characters into your cells. The default body face ships tabular lining figures
anyway, so the two outputs agree unless a kit ships a font with proportional
digits.

---

## Fitting more on a slide

There are two levers, and only one of them is yours.

### What the engine does by itself

Where a layout places content **without pagination** — a panel, a column, a
grid cell, a band — content that does not fit is re-flowed one step down a
three-step text scale, and a second step if it still does not. Nothing is
trimmed, ever; the engine shrinks or it complains.

Four properties are worth knowing, because each one is a mistake someone
would otherwise report as a bug:

- **The whole region steps down together**, never the offending block alone —
  three type sizes in one panel would read as a defect rather than as a fit.
- **The steps are discrete**: `comfortable`, `compact`, `dense` and nothing in
  between. A continuous best-fit factor would give every panel a size of its
  own.
- **`dense` is the floor.** Below it the engine stops and `BLOCK_OVERFLOW`
  fires. Text at 6 pt is not a fit, it is a failure with the evidence hidden.
- **Pagination wins.** A flowing `content` slide is split into "(cont.)"
  slides and is *never* densified: a flow has somewhere to put the overflow,
  and shrinking instead would trade a legible second slide for a cramped
  single one.

A region is only shrinkable if it holds something the scale can touch —
paragraphs, lists, tables, callouts. A cell holding nothing but a diagram, an
image, a code block, a progress bar or a badge row is left exactly as it is,
and no densification is announced that the rendering would deny.

Every region the engine shrank is reported:

```text
ℹ info SLIDE_DENSIFIED
  The "Major projects" region was rendered at the "compact" text scale so it
  would fit (priority-matrix layout) — shorten the content to keep the deck's
  default size.
```

One line per region, named after its `##` heading. Add more text and the same
region reaches the last rung, which the message says outright:

```text
ℹ info SLIDE_DENSIFIED
  The "Major projects" region was rendered at the "dense" text scale, the
  densest the engine has, so it would fit (priority-matrix layout) — …
```

Add more still and the scale is spent:

```text
⚠ warning BLOCK_OVERFLOW
  The "bullets" block overflows its region by about 64 px (priority-matrix
  layout), already at the densest step — cut the content or split the slide.
```

Read that clause literally: it says the engine has spent both steps of the
scale on this region, which is why the usual advice ("shorten the bullets or
spread them over two slides") is replaced by "cut the content or split the
slide". It reports that the region **moved** down the scale, not where it
ended up: a layout that already declares `density: "dense"` and overflows gets
an ordinary `BLOCK_OVERFLOW`, with the ordinary advice and no clause, because
nothing moved.

### What you can ask a layout for

`density` is the same lever, pulled on purpose rather than in reaction. It is
a **layout parameter**, so it lives in a `layouts/*.json` file beside the deck
(see below) — a deck never carries a point size, and
`<!-- layout: portfolio density=dense -->` is not a syntax: that comment takes
a layout name and nothing else.

| Base | Has `density` |
|---|---|
| `content`, `grid`, `comparison`, `pillars`, `steps`, `swot`, `layers` | yes |
| `metrics`, `split`, `timeline`, `focus` | no |
| `cycle`, `hierarchy`, `venn`, `radial` | no — a diagram's labels do not flow through the block layout |

The steps are **factors on each block's own theme token**, not absolute sizes,
so a kit shipping a 16 pt body keeps its proportions. On the default theme:

| Block | `comfortable` | `compact` (× 0.78) | `dense` (× 0.64) |
|---|---|---|---|
| paragraph | 14 pt | 11 pt | 9 pt |
| bullet | 14 pt | 11 pt | 9 pt |
| nested bullet | 13 pt | 10 pt | 8.5 pt |
| table body | 12 pt | 9.5 pt | 7.5 pt |
| callout body | 14 pt | 11 pt | 9 pt |
| callout label | 11 pt | 8.5 pt | 7 pt |

Sizes are rounded to the half point and never fall below 7 pt.

What `density` deliberately does **not** touch: slot headings (shrinking a
panel title along with its body blurs the hierarchy the panel exists to show),
quotes and code blocks (fixed frames — an overflowing panel should drop them,
not squeeze them), metric cards, charts, images, and the two components of
this guide. **A progress bar's label stays at the theme's body size and a
badge stays at its small size, even on a `dense` panel.** On a dense board
that is a 14 pt label beside a 9 pt paragraph; it is a real inconsistency, and
the honest workaround is to give bars and badges a panel of their own.

---

## Building a dashboard layout

A `layouts/` directory **next to the deck** is all it takes; nothing is
compiled or installed. Below is a complete pair, ready to copy.

### `layouts/board.json`

```json
{
  "name": "board",
  "base": "grid",
  "cols": 2,
  "sections": { "min": 2, "max": 4 },
  "headed": true,
  "density": "dense",
  "radius": "md",
  "panels": ["muted", "muted", "muted", "danger-solid"],
  "description": "Status board: four framed panels, the last one saturated for what needs escalating."
}
```

Three of the four new parameters, and why each is there:

- `density: "dense"` — four panels on one slide, so the body starts two steps
  down rather than getting there by auto-fit. That is the trade: from `dense`
  the engine has nowhere left to go, so a panel that still overflows is
  reported rather than absorbed (and reported without the "already at the
  densest step" clause — see above).
- `radius: "md"` — overrides the radius the `muted` variant carries by default
  (`lg`, 8 px) with the 4 px of the tinted surfaces. The four values are `sm`
  (2), `md` (4), `lg` (8) and `pill`; **`pill` is half the shorter side**, so
  on a 580 × 264 panel it is a 132 px radius — a stadium, not a rounded box.
  Keep `pill` for short panels.
- `panels` — a variant per cell, cycling by cell index. Each of the four tints
  now comes in two tones: `danger` is the pale callout surface,
  `danger-solid` the saturated chip. A solid panel picks its own ink (computed
  per tint at 4.5:1, which is why the solid green carries dark ink and the
  solid blue white) and **imposes it on every block that writes straight onto
  it** — paragraphs, bullets, headings, tables, quotes, the label of a bar —
  so nothing is half-repainted.

`align` is absent on purpose: `left` is its default and a status board reads
left. It earns its place on the companion layout.

### `layouts/scorecard.json`

```json
{
  "name": "scorecard",
  "base": "metrics",
  "max": 4,
  "cardHeight": 160,
  "align": "center",
  "description": "The four figures of the month, with the sentence that reads them centred underneath."
}
```

`align` — `left`, `center` or `right` — is the alignment of the text the
layout places: the blocks in the flow (`content`), the text inside the cells
(`grid`), what is written under the cards (`metrics`), the key message
(`focus`, which is centred by default and can now go `right`). It is the
**only** way to align anything: a deck never aligns a paragraph of its own,
because where the ink sits in a region is the engine's decision. The single
exception is the table column above, whose alignment is content the author
wrote.

### The deck that goes with them

```markdown
---
title: Programme review — April
subtitle: Steering committee
---

# The month in four figures

<!-- layout: scorecard -->

:::metric
3 612 k$
Committed
↑ +4 % (-)
:::

:::metric
5/8
Milestones met
:::

:::metric
94 %
Availability
:::

:::metric
12
Open risks
↓ -3
:::

Two of the eight milestones moved to May; nothing on the critical path.

# Where the programme stands

<!-- layout: board -->

## Delivery

:::progress success
100 %
Online services
:::

:::progress warning
45 %
Paper forms
:::

## Commitments

:::status
Scope, Schedule, Quality
!Budget
!!Recruitment
:::

Each commitment carries an ==Owner==; one that slips is tagged ==!At risk==.

## Budget

| Line item   | Share | Committed |
|-------------|:-----:|----------:|
| Licences    |  42 % |   1 517 k |
| Integration |  31 % |   1 120 k |
| Change      |  27 % |     975 k |

## To escalate

- Two developer positions unfilled since February
- The data-migration window closes on 30 May
```

Note where the bars and the table sit: on the three **muted** panels. That is
composition, not necessity — a table or a bar's label on the saturated panel
would be repainted with its ink and stay legible. What keeps its own ink is
whatever brings a surface of its own: a callout, a metric card, a code block,
a badge pill, and the coloured fill of a bar. Those are measured against that
surface, so repainting them would break a pair the theme already validated.

Then:

```sh
lutrin validate deck.md
lutrin build deck.md -o board.pptx        # --html for the preview
lutrin capabilities deck.md               # publishes board and scorecard
```

`lutrin capabilities <deck.md>` is the form that sees a `layouts/` directory
and an explicit or implicit kit; the bare `lutrin capabilities` describes the
engine alone and returns `userLayouts: []`. `build` exits with code 1 and
writes no file while an `error` diagnostic remains — `--force` overrides it.

### If you only need it stacked

`status-list` is an official layout, always available, no file to write: a
one-column grid at `dense`, one band per `##`.

```markdown
# Where the programme stands

<!-- layout: status-list -->

## Delivery

:::progress success
100 %
Online services
Delivered on 15 April
:::

## Commitments

:::status
Scope, Schedule, Quality
!Budget
:::
```

And for a dense one-pager, `content` takes `density` too:

```json
{
  "name": "one-pager",
  "base": "content",
  "density": "compact",
  "description": "A dense one-pager: the ordinary flow, one step down the text scale."
}
```

That is the one case where `density` changes how much fits *before* pagination
splits the slide — auto-fit will not help you here, since a flowing layout
paginates instead of shrinking.

---

## The new diagnostics

| Code | Severity | What it means | What to do |
|---|---|---|---|
| `INVALID_PROGRESS` | warning | the first line of a `:::progress` is not a share; the card was rendered as the paragraph you wrote | fix the figure — `75 %`, `0.75` or `3/4` |
| `UNKNOWN_PROGRESS_KIND` | warning | the word after `:::progress` is not a tint; the bar was drawn in `info` | use `info`, `success`, `warning` or `danger` (a near miss gets a "did you mean") |
| `SLIDE_DENSIFIED` | info | a bounded region did not fit and was re-flowed a step down the text scale | nothing, if you accept the smaller text. Otherwise shorten that region, or move some of it to another slide |
| `BLOCK_OVERFLOW` | warning | a block still overflows its region — and, when the message says *already at the densest step*, the engine has nothing left to try | cut the content or split the slide; for a badge row, shorten the labels or split it over two `:::status` blocks |
| `THEME_CONTRAST` | warning | *(existing code, new coverage)* a kit repainted a tint's saturated fill without repainting the ink that goes on it | set `semantic.<tint>.solidText` alongside `semantic.<tint>.solid` in the theme |

`SLIDE_DENSIFIED` is an **info**, so `build` still writes the file. It exists
because an automatic size is a decision, and you have to be able to refuse it.

A kit that repaints only half a solid pair gets:

```text
⚠ warning THEME_CONTRAST
  Theme: text of a solid success panel (#212529 on #0A3D2A) — contrast 1.26:1
  < 4.5:1 (the brand's WCAG threshold).
```

---

## What is still not possible

A guide that oversells is worse than none. The experiment these features came
out of — `dashboard-ir.mjs`, a real dashboard rebuilt by writing the IR by
hand, kept in the history rather than the working tree — marked every
workaround it needed with `HACK:`.
Some of those marks are now closed; the ones below are not, and the plans
under `docs/plans/` record why.

**Still no block for it.** A divider rule between two halves of a panel. A
gauge or score drawn as one object (`5 / 8` big, with its denominator). A
legend outside a chart's own SVG. A coloured bullet. A panel header as a
filled band, with an icon. In the IR experiment each of these was faked with a
`timeline-axis` used as a 2 px rule, or with a `heading` carrying a synthesized
`size` and `color` — and neither trick is reachable from Markdown at all.
There is no way to write them in a deck today.

**The two new components are rigid on purpose.** A progress bar is 28 px tall
(46 with a caption), its bar 20 px, its label column 34 % of the region; a
badge is 26 px tall with 10 px of side padding. None of it is a parameter. A
bar shows one value: no target marker, no threshold, no stacked segments, and
no colour outside the four tints.

**They also ignore the text scale**, as noted above — a bar's label and a
badge's text stay at the theme's own sizes on a `dense` panel.

**Alignment stops at two granularities**: a table column (from the delimiter
row) and a whole region (from a layout's `align`). There is no per-cell
alignment, no way to align one paragraph from the deck, and no vertical
alignment parameter at all.

**Neither component nests in a callout.** A `:::progress` or a `:::status`
inside a `:::warning` is dropped, with `ALERT_CONTENT_DROPPED` — a callout
renders paragraphs and bullet lists and nothing else. Put the bar next to the
callout, not inside it.

**Tabular figures are HTML-only**, and an inline `==badge==` is a highlight
rather than a pill in the `.pptx`. Both are stated here so they are not
discovered when the file is opened in front of a committee.

**A solid panel repaints what writes directly on it** — paragraphs, bullets,
headings, tables, quotes, a bar's label. Blocks that carry a surface of their
own (callout, metric card, code block, badge pill, the fill of a bar) keep the
ink that was validated against that surface.

**Parameters are layout-level.** There is no per-slide override: two boards at
different densities means two `layouts/*.json` files. And of the thirteen bases
that publish parameters at all, `density` reaches seven, `radius` four
(`comparison`, `pillars`, `grid`, `steps`) and `align` four (`content`,
`grid`, `metrics`, `focus`). The two diagram bases that publish anything
(`cycle`, `venn`) publish none of the three.

**Auto-fit is not a guarantee.** It never runs in a flowing layout, it never
runs in a region holding nothing the scale can touch, and it stops at `dense`.
Past that the answer is still to cut, and `BLOCK_OVERFLOW` says so.

---

See also: [the DSL reference](dsl.md) for the rest of the syntax, and
`lutrin capabilities <deck.md>` for the layouts, parameters and diagnostics
the engine you have installed actually publishes.
