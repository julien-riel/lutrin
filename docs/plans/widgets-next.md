# Plan 6 — what to build next

## Where this comes from

Four business lenses proposed thirty widgets; three judges scored each one
blind. What survives is below. The number that matters is not the ranking: it
is that **not one of the six is a new block type**. Eighteen block types are
enough. The next year of value is in `chart.mjs` and in `design/layouts/`,
because a chart type costs one branch and a layout costs one file, while a
block costs a `CONTAINERS` entry, a `blockHeight` case, two `BLOCK_RENDERERS`
entries, a `SHAPE_LABELS` entry, a slide in `examples/demo.deck.md`, both
goldens and a `parity.test.mjs` row — before it has drawn a single pixel.

The shortlist is ordered by **value ÷ cost**, not by score. That is why a JSON
file with no code in it comes first and the most-wanted feature comes second.

## The shortlist

| # | What | Form | Why it is here |
|---|---|---|---|
| 1 | [`raid`](#1-raid--one-file-no-code) | official layout (JSON) | The R/A/I/D board is a 2 × 2 the `swot` generator already draws; one data file names it and fixes its reading order. Zero lines of code. |
| 2 | [`stacked-bar`, `share-bar`](#2-stacked-and-share-bars--one-branch-in-cartesian) | chart types | The largest hole in the chart family, and `docs/plans/03-badge-progress.md` already referred stacking here with nowhere for it to land. One branch in `cartesian()`. |
| 3 | [`target:`](#3-target--the-line-a-series-is-judged-against) | chart key | A commitment is a fact about the data; today it can only be described in the caption, beside the series it judges. One reserved key. |
| 4 | [`type: waterfall`](#4-type-waterfall--the-bridge) | chart type | "Why is the number different from the number we promised" is undrawable today, and it is the second chart of every forecast review. |
| 5 | [`type: gantt`](#5-type-gantt--the-schedule) | chart type | **Duration does not exist anywhere in this engine.** `roadmap` is `timeline` + `orientation: vertical` — dated dots in a column. The schedule page cannot be written at all. |
| 6 | [a target on `:::progress`](#6-a-target-marker-on-progress) | block property | The gap `docs/dashboard-guide.md` records against itself: "a bar shows one value: no target marker". One rect, no height change. |

Items 1–5 touch no renderer, no `blockHeight` case and no parity table. Item 6
touches both renderers and neither pagination nor `blockHeight`, which is the
whole reason it is a property and not a block.

If there is time for one thing only, do **2**. If there is an afternoon, do
**1** in the same pull request — it is one file.

---

## 1. `raid` — one file, no code

### Concept

The four registers a delivery organisation keeps — Risks, Assumptions, Issues,
Dependencies — as a 2 × 2 board in fixed reading order.

### Where it shows up

The RAID page of a monthly steering committee pack. It is the page the project
director puts up when the status slide has been accepted and somebody asks what
could still go wrong. It appears once a month, in the same deck, for the life of
the programme.

### What the author writes

```markdown
# RAID — April

<!-- layout: raid -->

## Risks

- Data migration window closes 30 May

## Assumptions

- The legacy platform stays available to Q4

## Issues

- Two developer posts unfilled since February

## Dependencies

- Identity service release, owned by Platform
```

### What it is in this architecture

`packages/core/design/layouts/raid.json`, and nothing else:

```json
{
  "name": "raid",
  "base": "swot",
  "kinds": ["warning", "info", "danger", "info"],
  "density": "compact",
  "description": "Risks, assumptions, issues, dependencies — the four registers of a delivery, in reading order."
}
```

`swot` publishes `kinds` (an `enum-list` over `SEMANTIC_KINDS`) and `density`,
and inherits `sections: { min: 4, max: 4 }` (`layout.mjs:673`). The file
therefore registers as written, and inherits section-bound validation, the "did
you mean" suggestion, `capabilities()` and the auto-fit ladder for free —
exactly as `risk-map.json` does against `grid`.

**I do not take the tints the proposal shipped with.** It gave Risks and
Dependencies the same `warning`, which says both are alarming; a dependency is
not alarming, it is *outside your control*. So Assumptions and Dependencies
share `info` — they are the same kind of statement, "we are relying on
something we do not own" — while `warning` is reserved for what might go wrong
and `danger` for what already has. Four quadrants, three tints, and the one
that means trouble means it in exactly one place.

Worth pairing with a `LAYOUT_SUGGESTION` on four `##` headings reading
Risks / Assumptions / Issues / Dependencies, beside the `pros-cons` and
`risk-map` rungs already in `validate.mjs` (line 544 onwards). Mind the guard
those rungs use: `official('raid')`, so a broken catalog suggests nothing.

### Both renderers

Nothing new is drawn. The `swot` generator emits `panel` blocks that `addPanel`
draws with `addShape('roundRect')` and `htmlPanel` draws as a div, and flows the
sections into them.

### Keynote

Identical. A panel is a preset shape and its content is ordinary runs.

### `blockHeight()`

Untouched. The generator bounds each quadrant, `flowBlocks({ paginate: false,
density })` fills it, auto-fit steps the region down the text scale and reports
`SLIDE_DENSIFIED`; a quadrant that still overflows gets `BLOCK_OVERFLOW`. Every
block inside already reports its own height.

### Cost of keeping it

Three edits in `official-layouts.test.mjs`: the `OFFICIALS` array, a body in
`BODIES`, and a line in the anti-drift test that freezes the catalog's
settings. Plus the suggestion rung and its test.

---

## 2. Stacked and share bars — one branch in `cartesian()`

### Concept

Bars whose series stack into a total instead of standing side by side, and the
100 % variant where each column is normalised to its own total.

### Where it shows up

The cost-structure page of a quarterly business review — four quarters, three
cost families, and the question is whether the mix moved, not whether the total
did. And the survey readout: five questions, four answer bands, normalised,
because nobody cares that 240 people answered question three and 260 answered
question four.

Both are written today as a grouped `bar`, which answers a different question,
or as a table, which answers none.

### What the author writes

```chart
type: stacked-bar
categories: Q1, Q2, Q3, Q4
Salaries: 1200, 1250, 1260, 1310
Infrastructure: 420, 430, 510, 480
Services: 260, 300, 280, 340
```

```chart
type: share-bar
categories: 2024, 2025, 2026
Licences: 42, 48, 55
Services: 31, 33, 30
Support: 27, 24, 22
```

Four names in `CHART_TYPES` (`parse.mjs:76`): `stacked-bar`, `stacked-barh`,
`share-bar`, `share-barh`. Modifier first, so the existing `barh` token stays
intact — `bar-stacked`/`barh-stacked` splits it, and `stacked`/`stackedh`
abandons the `h` convention altogether. `capabilities().chartTypes`
(`validate.mjs:767`) and the `INVALID_CHART` message (`validate.mjs:406`)
publish the new names for free, because both read the set.

### What it is in this architecture

A chart type: one branch inside `cartesian()`. No `BLOCK_RENDERERS` entry, no
`blockHeight` case, no parity row, no IR change, no new grammar. This is the
cheapest true feature in the whole review, and it closes a referral the project
wrote down and could not honour — `docs/plans/03-badge-progress.md`, under *Out
of scope*: "Stacked or grouped bars. That is a chart, and `chart` already
exists."

Four things the branch has to get right, and each of them was found by a
different lens:

1. **The offset is a running sum**, not `si * (bw + 2)`. And the bar takes the
   whole group: today `group = Math.min(slot * 0.68, series.length * 64)` and
   `bw = (group - (series.length - 1) * 2) / series.length`. A stack is one bar
   wide — `Math.min(slot * 0.68, 64)` — or a four-series stack draws four
   quarter-width columns of stacked segments.
2. **`niceScale` is fed the per-category TOTALS**, not the individual values,
   or the tallest column runs out of the frame. Same discipline as
   `shownValues()`: truncate and aggregate *before* the bounds are chosen.
3. **Only the topmost segment is rounded.** `roundedBar()` rounds the free end,
   which is right for a lone bar and wrong for an inner segment — the segments
   notch into one another. Pass `r = 0` for every segment but the last (SVG
   treats a zero-radius arc as a line, so the existing path is safe), or emit a
   plain `<rect>`, which is clearer.
4. **Mixed signs.** Positives stack up from the zero baseline, negatives stack
   down from it — `roundedBar()` already takes `negative` and already anchors
   to zero rather than to the bottom of the frame. Stacking a positive on a
   negative would draw a total nobody has, so a category mixing signs is worth
   a warning rather than a silent picture.

Reuse two rules already in the file: the 2 px of ground colour between adjacent
fills (`circular()` strokes each share in `bg()`), and the pie's "label a share
only past 7 %" threshold for the in-segment labels of the share variants. The
share variants also normalise per category and format the ticks as
percentages — a category totalling zero draws nothing rather than dividing by
it.

The six-series ceiling `CHART_COLORS` documents still holds, and a stack
reaches it sooner than a grouped bar does. Keep the existing advice: group the
rest under "Other".

### Both renderers

`chartSvg()` → the HTML inlines the SVG; the `.pptx` rasterises it through
resvg at 2× and places one `addImage`. Unchanged.

### Keynote

The same PNG as PowerPoint and QuickLook. There is no OOXML chart, no theme
effect and no run property anywhere in this path — which is why charts are
images here in the first place.

### `blockHeight()`

Unchanged: the `chart` case returns 280 px (`layout.mjs:122`) and a lone chart
at the end of a flow is stretched to the region by `stretchTrailingVisual()`
(`layout.mjs:1139`). Stacking changes what is inside the SVG, never the block's
measured size.

---

## 3. `target:` — the line a series is judged against

### Concept

The commitment a series is read against, drawn where the series is instead of
described in the caption.

### Where it shows up

The service-level page of a monthly operations review: availability by month
against the 99.5 % in the contract. Also the intake page — cases closed within
five days against the published standard. In both, the target is the only
reason the chart is on the slide, and today it is a sentence underneath.

### What the author writes

```chart
type: line
categories: Jan, Feb, Mar, Apr, May
Availability: 99.1, 99.4, 99.6, 99.7, 99.5
target: 99.5
```

`target:` and `cible:`, the `categories`/`catégories` precedent
(`parse.mjs:386`, and read the comment there before touching it).

### What it is in this architecture

One reserved key in `parseChartSpec()` (`parse.mjs:373`) **and only when the
value is a single number**. A list stays an ordinary series, which keeps a
legitimately named series from being swallowed and makes the rule statable in
one sentence. Then a dashed 1 px rule across the plot in
`COLORS.neutralSecondary`, with the value set at the right edge.

Two details that are not optional:

- **The target enters `niceScale`.** A rule that falls outside its own frame is
  worse than no rule, and it is the same reason `shownValues()` truncates
  before the scale is computed.
- **It is not an identity**, so it stays out of `legendRow` and out of
  `CHART_COLORS`. A target is not a fifth series in a different colour; it is
  the ink of the page, dashed.

On `pie`, `doughnut` and `radar` the key means nothing — report it and ignore
it rather than drawing a chord across a doughnut.

**I take C14's trigger and refuse C18's.** C18 proposed inferring the rule from
a one-value series (`SLA: 95`), which labels the line in the author's own words
and needs no English key at all — genuinely the better label. But a one-value
series draws a lone bar or a lone dot *today*, so every deck that has one
silently compiles to a different scene. That is the one discipline this project
has held to on every change it has shipped. An `info` diagnostic mitigates it;
it does not undo it. The judge who marked C18 fatal is right.

### Both renderers

Inside the SVG. Nothing outside `chart.mjs` changes.

### Keynote

The same PNG, dashes and all. There is no OOXML dash property involved, nothing
to drop.

### `blockHeight()`

Unchanged — the `chart` case. A rule is drawn inside the plot the slot already
gives.

---

## 4. `type: waterfall` — the bridge

### Concept

How one total became another: an opening anchor, the signed moves that explain
the gap, a closing anchor.

### Where it shows up

The variance page of a quarterly forecast review, and the budget page of a
year-end close. It is the canonical answer to the only question a finance
committee asks, and today the answer is a table of signed numbers that the room
reads one line at a time.

### What the author writes

```chart
type: waterfall
categories: Budget, Volume, Price, FX, Overruns, Actual
Committed: 3900, -180, 240, -95, -253, 3612
```

With a mid-bridge subtotal, one reserved key:

```chart
type: waterfall
categories: Budget, Volume, Price, Subtotal, FX, Overruns, Actual
Committed: 3900, -180, 240, 3960, -95, -253, 3612
totals: Budget, Subtotal, Actual
```

**Default: the first and last categories are the anchors.** `totals:` overrides
that when the bridge has an intermediate total. The common case types nothing;
the case that needs a key gets one. That is C29's convention and C17's key, and
they are not alternatives — the convention makes the key optional, the key
removes the convention's only real limit.

### What it is in this architecture

A chart type, and — this is the point — **no parser change at all** beyond the
optional `totals:` key. C3 and C15 both proposed making anchorhood ride on
whether the author typed `+18` or `18`, which forces `parseChartSpec()` to
preserve a written sign that `Number()` erases. Under a positional convention
the sign is not load-bearing: a delta's direction is already in the number
(`-180` survives `Number()` intact), and what makes a bar an anchor is where it
sits, not what punctuation preceded it. An invisible character should never
decide which of two pictures gets drawn.

Drawing: the anchors run from zero; the deltas float on the running sum; a 1 px
connector joins each bar's end to the next bar's foot. The existing
`roundedBar()` does the bars, already anchored to zero and already aware of
`negative`.

**Colour comes from the semantic tints, not from `CHART_COLORS`.** This is the
one chart in the family where hue carries *sign* rather than *identity*: rises
in `SEMANTIC.success.solid`, falls in `SEMANTIC.danger.solid`, anchors in the
neutral ink. Say so in the docs, because it is the exception.

The per-bar labels are drawn by the engine and are not optional. A bridge
without its numbers is a shape.

Two things to write down rather than discover:

- A closing anchor the author typed that does not equal opening + deltas is a
  bridge that does not add up, and the compiler can say so instead of drawing
  it. A warning, not an error — the deck still builds.
- If a *cost* bridge ever needs a fall to read as good news, the `(+)` / `(-)`
  suffix `parseTrend()` already uses for a metric's sentiment
  (`parse.mjs:437`) is the extension point. Not a new colour word, and not in
  version one.

### Both renderers

`chartSvg()` → inline SVG, or resvg → `addImage`. `addChartBlock()`
(`pptx/render.mjs:917`) is untouched, including its resvg-absent fallback,
which rebuilds the spec as a code block from `s.values.join(', ')` — signed
numbers join fine.

### Keynote

The same PNG.

### `blockHeight()`

Unchanged.

---

## 5. `type: gantt` — the schedule

### Concept

Named lanes whose bars span periods on a shared time axis, plus a "we are here"
rule.

### Where it shows up

The plan page of a project kickoff, and every gate review after it. This is the
slide that gets rebuilt by hand in PowerPoint, with rectangles dragged into
place, and then re-dragged every month — which is precisely the work this
compiler exists to delete.

### Why this one is worth a parser change

**Duration is verifiably absent from the entire engine.** `roadmap.json` is
`{ base: timeline, orientation: vertical }` — dated dots in a column.
`timeline` places milestones. `steps` places stages. Nothing anywhere takes a
start and an end. Of the thirty candidates this is the only one that unlocks a
page the DSL cannot express at all rather than one it expresses less well than
it might.

### What the author writes

```chart
type: gantt
categories: Q1, Q2, Q3, Q4, Q1 2027
now: Q2
Discovery: Q1 - Q2
Build: Q2 - Q4
Partner API: Q1, Q3 - Q4
Rollout: Q4 - Q1 2027
```

- A span is `from - to`, **both endpoints included**. One line of docs, and it
  removes the inclusive/exclusive question that `Q1-Q2` otherwise leaves open.
- The comma keeps the meaning it has on every other series line — a list — so
  `Partner API: Q1, Q3 - Q4` is two bars on one lane, for free. That is why the
  range takes a dash and not a comma: `Discovery: Q1, Q1` would collide with
  the list, and a three-comma lane would then be ambiguous rather than wrong.
- A single period is a one-period bar. It is **not** silently promoted to a
  milestone diamond: the same source must not become two different pictures
  depending on how long the task is. If milestones are wanted, they get their
  own spelling later.
- No `!` / `?` severity prefix on the lane name. Every other chart in this file
  makes hue carry identity; a status prefix would make it carry severity, in
  one type, with a second grammar to learn. The severity of a workstream
  belongs to `:::status` beside the plan.

### What it is in this architecture

A chart type — and the one real parser cost in this document, stated plainly
because it lands in the shared front end and not in `chart.mjs`:

- `parseChartSpec()` coerces every non-reserved line through `Number()` and
  returns null on anything non-finite (`parse.mjs:399-403`). A period range is
  not a number, so this type needs a **per-type value reader**.
- `type:` is handled inside the same in-order loop that parses the series
  (`parse.mjs:383`), so it may legally appear *last*. The reader therefore has
  to be known before any value is read: one cheap pre-scan for the `type:` line,
  then the ordinary loop with the reader that type declares.
- **Keep the author's raw text on the series.** `addChartBlock()`'s
  resvg-absent fallback rebuilds the spec with `s.values.join(', ')`
  (`pptx/render.mjs:933`). Store `{ raw, from, to }` and that fallback keeps
  printing what the author wrote instead of `[object Object]` — this is the
  line that would otherwise regress in silence, on the one path nobody exercises
  locally.
- `chartDataDiagnostics()` measures `values.length` against `cats.length`. A
  four-period plan with one span per lane gives `extra <= 0`, so it stays quiet
  by accident. Add the guard and the test, or a later refactor starts telling
  authors that their plan has "1 value for 5 categories".
- An unresolvable period name invalidates the spec: `INVALID_CHART`, the source
  shown as a code block. The fallback the DSL already promises.

One design call of my own: **every lane bar is drawn in `COLORS.primary`, not
in a cycled `CHART_COLORS` hue.** The lane is already named on the left, exactly
as in `barh`, so colour carries nothing — and using one hue removes the
six-series ceiling that would otherwise cap a plan at six workstreams. The
period grid is the neutral grid already drawn; `now:` is a 2 px rule in the
deck's own ink.

### Both renderers

The image path. No renderer entry, no parity row, no `BLOCK_RENDERERS` change.

### Keynote

The same PNG — the best case for this feature, since a hand-drawn PowerPoint
gantt is a group of shapes that Keynote reflows.

### `blockHeight()`

**Unchanged, deliberately.** One proposal wanted `blockHeight` to branch on
`chartType` and return `lanes × 32 + header`, which is a truer number and costs
the invariant that charts never touch pagination. Not worth it: derive the row
pitch *inside* the SVG from `series.length`, so the measured height never
depends on how many lanes the plan has, and let a lone gantt take the full area
through the `chart` layout — which the inference table already picks for a lone
chart. Honest limit, stated rather than engineered around: past about ten lanes
the pitch gets thin, and the answer is a slide per workstream.

---

## 6. A target marker on `:::progress`

### Concept

A bar that also carries the number it was supposed to reach.

### Where it shows up

The attainment page of a monthly delivery review — budget consumed against the
year elapsed, cases closed against the published standard, quota against plan.
`docs/dashboard-guide.md` records the gap against itself: "a bar shows one
value: no target marker, no threshold, no stacked segments".

### What the author writes

```markdown
:::progress warning
62 % / 80 %
Q3 quota attainment
Two large deals slipped to October
:::
```

### The spelling, and why it is none of the four proposed

All four proposals put the target somewhere different, and all four have a
defect I can point at in the code:

- `target: 85 %` on its own line introduces a `key: value` grammar into a
  container that is strictly positional — `:::metric` and `:::progress` both
  read line 1, line 2, then the rest — and the caption rule then has to learn
  to skip it.
- `plan 75 %` as the last line mirrors `parseTrend()` neatly, but the last line
  *is* the caption today, so a caption that legitimately opens with "plan" is
  eaten — and `plan` is a hard-coded English word in an engine that ships
  `catégories` and `fondu`.
- `vs 75 % of the year elapsed` reads a marker out of prose. A caption saying
  "vs 75 % of last year's volume" gets a tick that means something else, with
  no way to decline it.
- `62 % of 80 %` is on the right line — the value line, the only line whose
  grammar is already strict — but in business English "62 % of 80 %" idiomatically
  means 49.6 %. It is the one spelling a reader can compute and get wrong.

**A comma is not available either**, and this is the trap worth recording: the
engine's default locale is `fr-CA`, where the decimal separator *is* the comma.
`0,75` fails `parseProgressValue()` today and lands on `INVALID_PROGRESS`,
which is honest. Split a comma-separated value line and `0,75` silently becomes
"value 0, target 75 %". A silently wrong bar is worse than a diagnostic.

So: `62 % / 80 %`, and the rule that makes it safe is worth stating as the
rule rather than as a property of one spelling:

> The whole line is tried as a single share first. Only a line that would be
> `INVALID_PROGRESS` today is split into value and target.

`3/4` and `0.62` therefore parse exactly as they do now — the fraction form is
already matched before the bare-number form (`parse.mjs:459`) — and the target
form is only reachable when the line is not already a valid share, which in
practice means both numbers carry a `%`. **Every deck that compiles today
compiles to the same scene.** That is a stronger guarantee than any of the four
proposals offered, and it costs one `if`.

### What it is in this architecture

A block property, not a block, and the proof is the height.

- `parseProgressValue()` stays exactly as it is — exported, directly tested,
  returns a number or null. A sibling `parseProgressLine()` tries the whole
  line, then splits, then calls it twice.
- The IR gains one optional field: `target`.
- `progressLayout()` (`tokens.mjs:506`) gains a `marker: { x, y, w, h, inside }`
  slot inside the 20 px track it already reserves. Both renderers and
  `blockHeight()` read that one function, which is what stops the tick from
  landing in one place in the HTML and another in the `.pptx` — the same reason
  the percentage's inside/outside threshold lives there.

### Both renderers, and the ink

HTML: one absolutely positioned 2 px div. PPTX: one `addShape('rect')`. A plain
rectangle — no highlight, no run property, no gradient, no adjust handle.

The ink is the interesting part, and it falls straight out of the existing
code. The track is `COLORS.underground2` and the fill is `SEMANTIC[kind].solid`
(`pptx/render.mjs:535-538`), so a tick can cross either surface. Compute
`marker.inside` exactly as `pct.inside` is computed, and pick
`SEMANTIC[kind].solidText` inside the fill and `COLORS.neutralPrimary` on the
track — mirroring `g.pct.inside ? sem.solidText : onPanel` line for line. Both
pairs are already asserted by `contrast.test.mjs`; no new colour and no new
contrast case is introduced.

A target at 100 % lands on the track's right edge and is drawn inside it rather
than half outside — the same clamp the percentage already gets.

### Keynote

A rectangle. There is nothing here for any viewer to drop.

### `blockHeight()`

**Zero change.** `progressLayout().h` stays 28 px, 46 with a caption; a tick
adds no line. Pagination, auto-fit and `BLOCK_OVERFLOW` keep reading the one
function, and `progress` stays out of the `BLOCK_OVERFLOW` audit set because it
is still a fixed-height object.

---

## What a kit repaints

The premise of this project is that an organization's brand is data. Each of
the six has to be repaintable from `theme.json` alone, with no code and no
per-deck override.

| Feature | What a kit repaints | Through |
|---|---|---|
| `raid` | all four quadrant tints, their inks and their radius | `colors.warning` / `informative` / `negative` → `SEMANTIC` (a derived group re-run by `applyTheme()`), or `semantic.*` outright |
| stacked / share bars | the segment hues, the breathing room between them, the ticks and the grid, the label face | `chartColors`, `colors.ground`, `colors.underground2`, `colors.neutralSecondary`, `fonts.body` |
| `target:` | the rule and its label | `colors.neutralSecondary` — deliberately *not* `chartColors`: a target is not an identity, and a kit that repaints its series palette must not repaint the commitment |
| `waterfall` | every rise, every fall, the anchors, the connectors | `colors.positive` / `colors.negative` → `SEMANTIC.success.solid` / `danger.solid`, and `colors.neutralSecondary`. **The one chart where the semantic tints apply**: repaint the brand green and every rise on every bridge follows |
| `gantt` | every lane bar, the period grid, the `now` rule | `colors.primary`, `colors.neutralStroke`, `colors.neutralPrimary` |
| progress target | the tick, on both surfaces it can cross | `semantic.*.solidText` and `colors.neutralPrimary` — both already in the contrast suite |

Two rules this table is trying to make explicit:

1. **Nothing new is added to `theme.json`.** Every one of the six reads tokens
   that already exist, and `chart.mjs` reads its inks through call-time
   closures (`ink()`, `grid()`, `bg()`) precisely so that a theme applied by
   `applyTheme()` in the same process is honoured.
2. **A kit cannot redefine `raid` itself.** `registerLayout()` throws on a name
   collision, and the message names the origin — official catalog, or the theme
   that provided it (`layout.mjs:446`). A kit that wants a different RAID
   repaints the tints; it does not ship a second layout under the same name.
   That is the intended shape: the catalog owns the *structure*, the kit owns
   the *paint*.

---

## Rejected

More was learned here than in the accepted list. The reasons are grouped so
that the same idea coming back next quarter can be answered by pointing at a
heading.

### Merged, not rejected — the same idea under four names

Four candidates proposed **stacked bars** (`stacked-bar` / `bar-stacked` /
`stacked` / `share-bar`). One feature, four spellings. Shipped as §2 with the
modifier-first names, and each variant contributed the correctness note the
others missed: per-category totals into `niceScale`, topmost-segment-only
rounding, and positives-up / negatives-down for mixed signs.

Four proposed the **waterfall** (`bridge` / `waterfall`, twice each). Shipped as
§4 with the positional convention *and* the `totals:` key. The two that hung
anchorhood on a written `+` sign are rejected outright: `Number('+18') === 18`,
so the spelling would force a new field on the one code path every chart type
shares, and it makes an invisible character decide which picture gets drawn.

Three proposed the **gantt** (`gantt` twice, `roadmap` once). Shipped as §5.
`roadmap` is rejected as a *name* — `design/layouts/roadmap.json` already
exists, and a chart type sharing a layout's name collides in the docs and in
`capabilities()`. `Discovery: Q1, Q1` is rejected as a *spelling*, because it
takes the comma away from the list meaning that gives multi-span lanes for free.

Four proposed a **target on `:::progress`**. Shipped as §6 with a fifth
spelling and a rule none of them had.

### Already served by `table`, `chart` or `grid`

- **`:::tracker`** — a full block for a status grid: rows are workstreams,
  columns are periods, cells are severities. Its decisive argument was that the
  only current spelling — a table of inline `==!At risk==` — is the one
  documented-broken path in the `.pptx`. **That argument expired at HEAD.**
  Commit `763d877` moved the inline badge to the pale pair precisely so it
  survives where the highlight is dropped; a table of inline badges now reads
  in Keynote. What remains is a full block (CONTAINERS, `trackerLayout()`,
  `blockHeight`, both renderers, `SHAPE_LABELS`, a demo slide, both goldens) for
  a grid that a table of plain words conveys, prints in greyscale and needs no
  key for.
- **`:::rating`** — an options-against-criteria scorecard drawn as filled dots.
  `| Fit to process | 4 | 5 | 3 |` states the judgement more precisely than
  counting part-filled circles, and the scale's denominator is never declared
  anywhere in the proposed syntax: `4` is 4/5 to one author and 4/10 to
  another, and deriving it from the observed maximum means one new `5` rescales
  every row in the deck.
- **`:::phases`** — named stages with a `>` cursor. `:::status` already draws a
  row of tinted pills from `Discovery, Design, !Build, …` and delivers most of
  the object for nothing. The cursor is the only genuinely new thing, and it is
  not worth two renderer entries, a `blockHeight` case, a `CONTAINERS` entry, a
  `phaseLayout()`, a demo slide and both goldens.
- **`type: map`** — a positioning map, items against two named axes. The engine
  already ships `priority-matrix` and `risk-map` as text quadrants, which is
  what a workshop actually produces. See also the contract objection below.
- **`type: heat`** — a matrix of cells tinted by value. This one is *close*: it
  fits the existing grammar exactly (rows are series, columns are categories),
  needs no reserved key and no parse change, and its ramp argument is right —
  `LAYER_SHADES` ships five steps of the primary each already paired with an
  ink validated at 4.5:1, so a kit repaints the whole matrix for free and the
  figure survives greyscale. It is held back only because it competes for the
  same afternoon as §2 and §4 and serves a narrower page. **If a seventh item
  is ever wanted, it is this one** — with the scale's normalisation stated in
  the docs, because a ramp normalised over observed values means one outlier
  repaints the grid.

### Fails the contract

- **`type: map`**, again, and this is the sharper objection. In the "where to
  play" workshop the dot goes where the room wants it and the `4.2` is
  back-filled afterwards: the author tunes the number by looking at the
  picture, which is x-positioning wearing a data costume. The proposal also
  admits that labels are not de-collided past ~8 items, so authors would rename
  and reorder to fix overlaps — tuning presentation twice over. And
  `quadrants: Fill-ins, Quick wins, Thankless, Big bets` states no traversal
  order, so two authors map the same four words onto different corners.
- **`type: combo` + `rate:`** — bars with a rate line on a right-hand axis. A
  dual axis is the exact form the project's dataviz discipline exists to
  prevent, nothing in the proposal tells a reader which series belongs to which
  side, and the constraint offered as the fix (the second axis is a percentage
  anchored at zero, unmovable) contradicts half of its own stated use cases —
  cost-per-unit and volumes-with-service-level are not percentages. It is also
  the most `chart.mjs` code of any chart candidate: a second `vpos`, a
  right-hand tick column, `pad.right` grown by measured label widths,
  `niceScale` over the amount series only, and the rate series pulled out of
  both the bar slot allocation and the colour cycle. Two charts say it without
  the ambiguity.
- **A `**Vendor B**` column header tinting that column's band** (part of
  `:::rating`). Emphasis is content; making it a layout switch means an author
  who bolds a header for emphasis gets a coloured band they never asked for.
  Also unbuildable as written: `containerLines()` flattens every line through
  `runsToText()` (`parse.mjs:680`), so the bold arrives as plain text.
- **A variance column detected from structure** (`| Variance |` with signed
  figures tinted green and red). The mechanism is genuinely cheap — `addTable()`
  already rebuilds a per-cell options object that takes `color`
  (`pptx/render.mjs:378-383`), `cellStyle()` is its HTML twin, and run colour in
  a cell is plain `solidFill`, which Keynote honours. And `CONTRIBUTING.md`'s
  own carve-out note ends "Better would be to detect the numbers". But
  structural detection has no opt-out: a signed column that is not a judgement
  — a net position, a delta in degrees, a temperature — gets tinted with no way
  to say so. **The condition for it coming back**, and it is a short list:
  require the explicit `(+)` / `(-)` polarity marker in the header (the
  vocabulary `parseTrend()` already owns), decide once at parse time into a
  single IR field that both renderers read rather than each re-deriving, and
  settle whether `(-)` is stripped from the rendered header — because "Variance
  (-)" in front of a committee is jargon the author never meant to show.

### Cannot survive the least capable viewer

- **`:::person`** — a headshot, a name, a role, a line of context. Two hard
  failures, both verified. First, `rounding: true` applies an ellipse *geometry*
  to the picture without cropping it, so a 4:3 headshot is a distorted oval in
  PowerPoint itself, not merely in the weak viewers, and nothing in this engine
  cover-crops. Second, and worse: the asset prepass in both renderers flattens
  `sc.elements.map(e => e.block)` and nothing deeper (`html/render.mjs:1545`,
  `pptx/render.mjs:1399`), so an image nested inside a container block is never
  downloaded, never dimensioned and never inlined — `htmlImage` falls through to
  the `[image: …]` placeholder. Nested assets would have to be taught to the
  prepass in both renderers and to the vendoring path before the block could be
  written at all. An image, a heading and a paragraph in a `grid` cell already
  produce something usable.
- **A true Harvey ball** (a quarter- or half-filled disc) via PptxGenJS's
  `angleRange` on `pie`/`arc`. The option exists. A viewer that ignores the
  shape adjustment draws the preset's default 270° wedge — a *confidently wrong
  score* in front of the committee, which is a worse failure than the vanished
  badge, because nothing looks broken. If discrete marks are ever wanted, they
  are the `timeline-dot` ellipse, five of them, and the promotion to real arcs
  happens engine-wide after a Keynote check or not at all.

### Rejected on cost, with the finding banked

- **`[x]` / `[~]` / `[ ]` comparison marks in a table cell.** The engineering in
  this one is the best in the review and should be reused by anything that ever
  draws a glyph: **● (U+25CF) and ○ (U+25CB) are in WGL4** and therefore present
  in Arial and in every face that substitutes for it, while **◐ (U+25D0), the
  Harvey ball everyone reaches for, is not** — a kit shipping a narrow font puts
  a tofu box in front of the committee. Filled-versus-hollow also separates the
  two extremes without relying on hue at all. It is rejected anyway, because the
  rewrite lands in `toRuns()` and `runsHtml()`, which *every* text block shares,
  so the rule has to be fenced to table cells or it leaks into prose — and
  "Yes / Partial / No" typed in the same cells conveys the same facts, prints in
  greyscale, needs no key, and would not collide with task-list syntax if that
  is ever added.

### Closed by a measured experiment — an image inside a table cell

**Asked for on 25 July 2026:** an icon small enough to sit in a table cell, its
height following the text line. The size word shipped (`![line](lucide:…)`);
the table cell did not, and this is the evidence, because the question comes
back every time someone wants a status column.

Three walls, and editing the `.pptx` XML by hand — which this codebase already
does twice, `canonicalizeTitlePlaceholders` and `embedSlideTitles` — only
removes the first.

1. **PptxGenJS.** `TableCell` is `{ text, options }` and `TableCellProps` has
   no image; `addImage` is a method on the *slide*. Removed by writing the XML.
2. **The content model.** A cell is `<a:tc><a:txBody/><a:tcPr/></a:tc>`. A
   `<p:pic>` is not a legal child, which is also why PowerPoint's own UI
   refuses to paste a picture into a cell. Not removed by anything.
3. **Vertical geometry.** The engine writes `<a:tr h="0">` and lets the viewer
   size the rows; `h` is a *minimum* in OOXML anyway. The columns, by contrast,
   are pinned (`<a:gridCol w="2819400"/>`), so x is known and y is not — and y
   is the axis a table stacks along.

Two routes get past wall 2, and **a probe measured both in Keynote**
(`probe-inject.mjs`, four slides, eight variants):

- **A — the picture as the cell's FILL** (`a:tcPr/a:blipFill`, what PowerPoint's
  "Shading → Picture" writes). Placement is expressed relative to the cell
  (`a:stretch/a:fillRect`, thousandths of a per cent), so it should not need the
  row height. **Keynote draws it and ignores the insets entirely.** Three cells
  carrying three different `fillRect` sets — none, a centred 26 px square, a
  20 px image held left — came out at the *same* horizontal extent: `pdfimages
  -list` reports 62 ppi across and 732 ppi down for all three, an aspect ratio
  of **11.8:1** on a square source (14.5:1 in the cell that also holds text).
  62 ppi on a 384 px source is 6.19 in = 594 px rendered, which is the 592 px
  cell to within a rounding: the insets were not merely equal to each other,
  they were not read at all.
  The check mark renders as a flat zigzag spanning the column. That is not a
  degradation, it is a confidently wrong picture — finding no. 1 below, one step
  worse than the vanished badge. PowerPoint would very likely honour the insets,
  since it writes them; that makes it worse, not better, because the author
  would see the right thing and the committee the smear.
- **B — the picture FLOATED over the cell**, at coordinates derived from the
  engine's own row-height estimate. **It drifts, as predicted, and by how much
  is the useful number:** the icon was placed at y = 277 px for a row the engine
  measured at 36.4 px; Keynote gave the row ~45 px and put its text centre at
  313 px. The 26 px icon landed centred on 290 px — straddling the rule between
  two rows, **23 px out on a 26 px mark**, after only one preceding row. The
  error is per-row and accumulates downward.

**Verdict: closed.** Not on cost — on rendering, measured. The answers that do
work are already shipped: an inline badge for a status column (`==Delivered==`,
`==!At risk==`, which the same probe renders correctly in Keynote as bold
tinted text once the highlight is dropped), and `type: heat` or `type: rating`
for a whole matrix of marks, drawn as SVG for exactly this reason. A cell that
eats an image now says so — `TABLE_CONTENT_DROPPED` — and names those two.

What would reopen it: a viewer survey showing `a:fillRect` insets honoured
everywhere that matters, or a decision to draw tables as shapes the way charts
are drawn — which costs the real OOXML table (no row editing, no cell
selection) and is a regression as the default for every table.

### Do not build this — write a layout

- **`:::source`**, in both its forms. A provenance line set as a caption under
  a hairline. The contract argument is good (an author cannot write small text
  and must not be able to, so an intent word is the only legitimate route), but
  it is a full block type to fix a paragraph that renders at the wrong size.
  The band variant is worse than it looks: `metrics` pulls its cards out inside
  *one* case of the `buildScenes` switch, whereas a band reserved above every
  footer means touching `contentArea()` or all ~25 generator cases. Its own
  alternative — `<!-- source: … -->`, beside `notes` and `layout` — reaches the
  same result, touches no parity surface, and is the fork to take if the need
  proves real.
- **And generally.** `raid` is the proof of this heading: an entire official
  feature, validated, suggested, published by `capabilities()`, kept by two
  test lines, and its whole implementation is a JSON file. Before proposing a
  block, check whether the arrangement already exists under another generator's
  name — `swot`, `grid`, `steps`, `layers` and `focus` between them cover most
  two-dimensional arrangements a deck needs, and the eleven official layouts in
  `design/layouts/` are eleven demonstrations of how little a new one costs.

---

## Findings worth keeping, whatever ships

Four things this review turned up that outlive the features they came from.

1. **The inline badge's lesson generalised.** Judge every candidate by what the
   least capable app that opens the file will show, and prefer a degradation
   that *stays legible* over one that stays pretty. `763d877` chose the pale
   pair over the saturated one for exactly this reason. The Harvey-ball wedge
   above is the same failure one step worse: not invisible, but confidently
   wrong.
2. **A chart type is roughly a tenth of a block.** No `BLOCK_RENDERERS` entry,
   no `blockHeight` case, no parity row, no `SHAPE_LABELS` entry, no demo slide,
   no golden churn — and `capabilities().chartTypes` and the `INVALID_CHART`
   message publish the new name for free because both read `CHART_TYPES`. When a
   candidate is really a plot, say so and send it to `chart.mjs`.
3. **An official layout is roughly a hundredth of a block.** One file, and it
   inherits validation, section bounds, "did you mean", `capabilities()` and the
   auto-fit ladder.
4. **The safest new grammar is one that only runs where the old one failed.**
   §6's rule — try the whole line first, split only what would already be
   `INVALID_PROGRESS` — is provably deck-preserving, and the same shape works
   anywhere a spelling is being added to an existing field.

## Out of scope

- Any syntax that lets an author name a colour, a coordinate or a size. Six
  features above and not one of them adds a value the engine does not already
  own.
- Native OOXML charts, revisited for the stacked and share types. The reason
  charts are images has not changed: Keynote and QuickLook show nothing.
- Per-slide layout parameters. Two boards at two densities is still two
  `layouts/*.json` files, and that is still the right answer.
- Milestone diamonds, lane severities and mid-slide subtotals beyond `totals:`.
  Each is a real request; none of them is version one.
