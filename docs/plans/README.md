# Plans — dashboard primitives

Five plans, born of one experiment: rebuilding a real project-status dashboard
**straight from the IR**. `dashboard-ir.mjs`, at the repository root, writes
the scene by hand — 130 elements, no Markdown, no layout engine — and hands it
to `renderDeckHtml`. Run it to regenerate the page:

```sh
node dashboard-ir.mjs dashboard-ir.html   # the .html is generated, not tracked
```

The verdict was clear. The IR's geometry is not the problem: a scene is a flat
list of `{ block, region }` in absolute pixels, so an asymmetric panel grid
costs nothing. What the IR lacks is **block types and block properties**.
Every one of the 130 elements that needed a workaround is marked `HACK:` in
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

## Reading order

They are ordered by dependency, not by value.

- **1 → 5**: auto-fit needs a typographic scale to fall back on. Plan 5 is the
  policy, plan 1 is the lever it pulls.
- **2 → 3**: badges and progress bars are painted with the fills plan 2 adds.
  Shipping 3 first would mean two blocks that can only be drawn in the primary
  hue — the exact defect the dashboard exposed, moved somewhere new.
- **4** stands alone and is the cheapest.

Highest value for the least code: **1 + 2**. Together they cover most of the
visible gap between `dashboard-ir.html` and the source screenshot, and neither
introduces a block type.

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
