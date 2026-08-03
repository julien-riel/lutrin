# Plans — dashboard primitives

Five plans, born of one experiment: rebuilding a real project-status dashboard
**straight from the IR**. `dashboard-ir.mjs` wrote the scene by hand — 130
elements, no Markdown, no layout engine — and handed it to `renderDeckHtml`.

The script is no longer kept in the working tree. It is still in the history,
where it can be read without being restored:

```sh
git show 8eaeec9:dashboard-ir.mjs
```

Running it again takes one edit: it imports `renderDeckHtml`, `COLORS` and
`applyTheme` through **absolute paths** into `packages/core`, so it only ever
ran on the machine it was written on. Point those three imports at your own
checkout and `node dashboard-ir.mjs out.html` writes the 130 elements again.

The verdict was clear. The IR's geometry is not the problem: a scene is a flat
list of `{ block, region }` in absolute pixels, so an asymmetric panel grid
costs nothing. What the IR lacks is **block types and block properties**.
Every one of the 130 elements that needed a workaround was marked `HACK:` in
that file; the five plans below are those marks, grouped.

| # | Plan | What it unblocks |
|---|---|---|
| 1 | [Text scale](01-text-scale.md) | body text is nailed to 14 pt — 26 characters per line in a 260 px column |
| 2 | [Solid semantic fills](02-solid-fills.md) | no saturated fill, no pill radius — status colour cannot be painted |
| 3 | [`badge` and `progress` blocks](03-badge-progress.md) | the two signature components of a dashboard, absent |
| 4 | [Alignment](04-alignment.md) | no right alignment anywhere; a Markdown right-aligned column marker is parsed and dropped |
| 5 | [Auto-fit](05-auto-fit.md) | nothing shrinks: an over-long paragraph leaves its region and lands on its neighbour |

## What shipped

All five landed, in the order below. The plans are left as they were written;
where the code came out different, **the code is right** and the difference is
recorded here rather than by rewriting the plan.

1. **Text scale** — shipped. A nested bullet derives its size from the theme's
   own ratio instead of the planned `size - 1`: a fixed offset flattens a kit
   whose sub-level sits two points under its body, so `blockFontSize(block,
   part)` takes the part it is asked to size — the body, a bullet's sub-level,
   a callout's label. Plan 5 later moved the stamping out of the seven
   generator call sites and into `flowBlocks({ density })`.
2. **Solid semantic fills** — shipped, with two corrections the plan's own
   contrast test forced: white ink on the solid green measures 3.19:1, so
   `solidText` is picked tint by tint and green carries dark ink; and
   PptxGenJS 4 reads `rectRadius` as an absolute length, not as the 0–1 ratio
   assumed here, so `panelRadius(block, region)` returns px and both renderers
   pass it straight through.
3. **`badge` and `progress`** — shipped, with the inline `==badge==` form and
   the official `status-list` layout. The severity rides on each `:::status`
   item, so one line may mix severities: the one-line-per-severity example is
   a reading convention, not syntax. `badge` joined the `BLOCK_OVERFLOW` audit
   set because its row wraps; `progress`, being fixed-height, stayed out.
4. **Alignment** — shipped, and `focus.align`, which knew `center` and `left`,
   was widened to `right` like the generators that gained the parameter.
   Tabular figures reach the HTML only: DrawingML run properties carry no
   OpenType feature switch, and the one OOXML mechanism that would (a decimal
   tab stop) means writing tab characters into the cells. The degradation is
   stated in [the DSL reference](../dsl.md).
5. **Auto-fit** — shipped. `flowBlocks()` took ownership of `density`, so the
   scale is chosen in one place; overflow is measured on the **estimated**
   heights, since a block taller than its whole region is placed clamped and
   would otherwise measure as a perfect fit; a region holding nothing the
   scale can touch is never densified; and `SLIDE_DENSIFIED` is one line per
   region, named after its heading, rather than one per block.

The shared groundwork below landed as well, with wider signatures than
sketched: `blockFontSize(block, part)` and `panelRadius(block, region)`.

## What was turned down, and how to reopen it

[widgets-next.md](widgets-next.md) is the second review: four business lenses,
thirty candidates, three judges. Its shortlist shipped; its REJECTED half is
the longer one and the more useful.

Two of those refusals attract people back — Harvey balls and a person card.
[reopening-rating-and-person.md](reopening-rating-and-person.md) is the brief
for reopening either: what the objection actually is, what evidence would
overturn it, and the work that follows if it does. It exists so the next
attempt starts from the findings rather than from the idea.

## Asked for next

[logos-testimonial-icons.md](logos-testimonial-icons.md) — a logo wall, a
customer testimonial, and icons that carry a size. The first two share a
prerequisite (the deep block walker the person-card brief declined to build for
one speculative user: these two carry an image inside a block, so the objection
is answered). The third is three requests with three different verdicts — a
semantic size is an afternoon, an inline icon is most likely closed by OOXML,
and a true drop cap is closed by the absence of a text flow engine, with a
`split` layout as the honest answer.

[build-logos-and-icons.md](build-logos-and-icons.md) is the implementation
brief for the three that were asked for next — the semantic icon size, the deep
walker, the logo wall — plus the one experiment that decides the inline icon.

One verdict was overturned in the process, and it is recorded in the rating
brief: a Harvey ball does not have to be a glyph or an OOXML shape. Charts here
are already drawn as SVG and rasterised, precisely because native OOXML charts
are invisible in Keynote — a drawn disc has nothing left to substitute or
misinterpret. Which makes a scorecard a **chart type** rather than a block, at
a tenth of the cost the rejection was weighed against.

## Shipped since, outside the two reviews

[smartart.md](smartart.md) — four diagram layouts (`cycle`, `hierarchy`,
`venn`, `radial`) and, behind an opt-in flag, real OOXML SmartArt: five
`ppt/diagrams/*` parts and a `<p:graphicFrame>`, so PowerPoint opens its own
editing UI on the object. It is the first thing here that adds PARTS to the
package rather than rewriting existing ones, and the first whose acceptance
criterion cannot be asserted from a test — that plan carries the gate a human
has to answer, and the per-family switch that turns off whatever the gate
refuses.

## Order to build — what is left

Everything in the two reviews above has shipped: plans 1–5, and the six items
of the widgets shortlist. What follows is the queue, ordered by value ÷ cost
with the dependencies respected. Nothing here is committed to; it is the order
to take them in if they are taken.

| # | What | Where | Cost | Depends on |
|---|---|---|---|---|
| ~~1~~ | ~~`opener` layout — the honest answer to "drop cap"~~ — **shipped, then withdrawn**: the two lines in `split` re-laid-out every inferred split carrying an icon, and the layout's own name collided with a natural kit name. The drop cap stays refused | [logos-testimonial-icons.md](logos-testimonial-icons.md) §3c | a JSON file, plus two lines in `split` | — |
| ~~2~~ | ~~Semantic icon size (`![large](lucide:…)`)~~ — **shipped** | [build-logos-and-icons.md](build-logos-and-icons.md) §1 | an afternoon | — |
| ~~3~~ | ~~`type: rating` and `type: heat`~~ — **both shipped**, and they turned out to be one feature: the same matrix frame, filled in one and tinted in the other | [reopening-rating-and-person.md](reopening-rating-and-person.md) | a branch in `chart.mjs` | — |
| 4 | The deep block walker | [build-logos-and-icons.md](build-logos-and-icons.md) §2 | small, but its own change | — |
| 5 | The logo wall | [build-logos-and-icons.md](build-logos-and-icons.md) §3 | a block | 4 |
| 6 | The customer testimonial | [logos-testimonial-icons.md](logos-testimonial-icons.md) §2 | try it as a property of `quote` first | 4 |
| 7 | The inline-icon experiment | [build-logos-and-icons.md](build-logos-and-icons.md) §4 | an hour, to close a question | — |
| 8 | `:::person` | [reopening-rating-and-person.md](reopening-rating-and-person.md) | a block, and still contested | 4 |

Why in that order:

- **1–3 depend on nothing and cost almost nothing.** A JSON layout, an intent
  word, and one branch in `chart.mjs`. Together they close three requests that
  keep coming back. **All three have shipped.** `rating` and `heat` share a
  `matrixFrame()` and differ only in what they draw inside a cell — the
  review's guess that "whoever does one should look at whether they are one
  feature" turned out to be right.
- **1 and 2 came out with three differences from the briefs, and the code is
  right.** (a) The sketch `{ "base": "split", "ratio": 0.22, "side": "left" }`
  is inverted: `ratio` is the share taken by the TEXT, so the layout ships at
  `0.78` — 0.22 would have given the passage the narrow column and the icon the
  wide one. (b) `split` did not count an icon as a visual at all, so the icon
  flowed with the text; it does now — there, and deliberately not in
  `inferLayout()`, where it would have turned the demo's three pillars into a
  split. (c) An icon in that column was stretched to the full height and
  centred itself halfway down the slide, beside nothing: it is trimmed to the
  square it draws, which is what puts it against the first line. The icon
  sizes stayed module-private, as recommended.
- **3 jumped the queue, and the reason is recorded.** `:::rating` scored last
  of thirty candidates, because a Harvey ball was assumed to be a glyph or an
  OOXML shape and both fail somewhere. It is neither: this engine already draws
  charts as SVG and rasterises them, precisely because native OOXML charts are
  invisible in Keynote. As a chart type it costs a tenth of what the rejection
  was weighed against, and the `chart` grammar declares its own scale.
- **4 before 5 and 6.** Both carry an image inside a block, which the asset
  prepass cannot see. Land the walker alone, with the assertion that no golden
  moves.
- **7 is not a feature, it is a verdict.** Run it to bank the answer, expect it
  to be no, and record it in `widgets-next.md` either way.
- **8 last, and only if someone answers the objection** it was rejected on: a
  `grid` cell with an image, a heading and a paragraph already draws a
  governance slide.

Until the walker lands, the standing risk is a *silent* one — a future block
carrying a nested image would fail with a placeholder and no diagnostic. A
fifteen-line test asserting that no asset-bearing block appears nested in a
scene turns that into a loud failure, and is worth having whether or not item 4
is ever taken.

### The order the first five were built in

Kept because the dependencies are instructive: **1 → 5** (auto-fit needs a
typographic scale to fall back on — plan 5 is the policy, plan 1 the lever it
pulls) and **2 → 3** (badges and bars are painted with the fills plan 2 adds;
shipping 3 first would have meant two components drawable only in the primary
hue — the exact defect the dashboard exposed, moved somewhere new).

## What every one of them must honour

From `CONTRIBUTING.md`, and none of it is negotiable:

- **The author describes intent and content; the engine decides the layout.**
  No plan here gives an author a coordinate, a size in points or a colour.
  Where a value has to be chosen, it is chosen by a layout definition (JSON
  data), by a kit, or by the engine itself.
- **Output parity.** `.pptx` and HTML are born of the same scene;
  `parity.test.mjs` requires both `BLOCK_RENDERERS` tables to cover exactly
  the same block types.
- **`src/deck/` knows no output format** (`boundary.test.mjs`).
- **Every new block type goes into `examples/demo.deck.md`**, and the goldens
  are regenerated with `UPDATE_GOLDEN=1 npm test` — with the diff re-read
  before it is committed.
- Comments, diagnostics and documentation in **English**.
- No new dependency. `node:test`, no exception.

## Shared groundwork

Plans 1, 2 and 3 each want to reach into a value that today is a literal
duplicated in the two renderers. Extract it once, in `deck/tokens.mjs`, before
the first of them lands:

```js
// tokens.mjs — one source, both renderers read it
export function panelRadius(block) { … }   // today: literal 8/4/2, twice
export function blockFontSize(block) { … } // today: TYPE.body, twice
```

That is the shape parity takes here: not two tables kept in sync by hand, but
one function neither renderer can disagree with.

## Not about the engine — and no longer here

`site-and-revenue.md` and its checklist used to sit in this directory: ten
items on the landing page, the licensing path and what stands between them and
revenue. They are kept outside this repository as of 2026-08-01, because a
price considered and not announced is not the same kind of document as a plan
for auto-fit, and this directory is public.

Nothing in `site/` went with them, and nothing needs to: the pages are deployed
at `info.lutrin.app`, so they are public wherever their source is kept — and
`pages.yml` compiles the demo deck and serves `packages/core` to the playground
from `HEAD`, which is the guarantee that the site cannot drift from the
compiler. Taking the site out would have cost that guarantee to hide something
already visible.

What is left here is what it says on the tin: plans about the engine.
