# Plan 1 — Text scale

## Problem

`heading` is the only block that carries a size: `block.size` (pt), added for
the key message of the `focus` layout. Every other text block reads a token
directly and cannot be told otherwise — `para` → `TYPE.body`, `bullets` →
`TYPE.bullet`, `table` → `TYPE.tableBody`, `alert` → `TYPE.body`.

At 14 pt, `textHeight()` measures ~9.7 px per average character: a 260 px
column holds **26 characters per line**. The dashboard experiment hit this on
the first render — three of six panels overflowed and overprinted each other,
and no amount of layout work could have saved them.

The only lever that exists today is a kit setting `type.body`, and it is
**global to the deck**: densifying one panel densifies the cover, the section
slides and every bullet list in the file. `dashboard-ir.mjs` had to do exactly
that (`applyTheme({ type: { body: 9, … } })`) to become readable.

## Contract check

An author never writes a point size — that would be positioning by another
name, and `CONTRIBUTING.md` refuses it. `size` here is a **synthesized IR
field**: written by the layout engine, read by the renderers. It is exactly
what `heading.size` already is. The author-facing surface is an intent word
(`density: dense`), and it is set in a layout definition — JSON data, in the
deck's `layouts/` directory or in a kit — never in the deck's prose.

## IR change

One optional field, on the four text blocks:

```js
{ type: 'para',    runs, size?: 9 }
{ type: 'bullets', items, size?: 9 }   // nested items derive: size - 1
{ type: 'table',   header, rows, size?: 8.5 }
{ type: 'alert',   kind, blocks, size?: 9 }
```

Absent = today's token. Never `null`, never `0` — an omitted key, so scenes of
decks that ask for nothing stay **byte-identical** and the goldens do not move.

`deck/tokens.mjs` gains the accessor both renderers must go through:

```js
/** Effective font size of a text block: what the block asks for, else the
 *  theme's token for its kind. Shared so the two renderers cannot drift. */
export function blockFontSize(block) { … }
```

`blockHeight()` (`deck/layout.mjs`) reads the same accessor instead of the
`TYPE.*` literals it hardcodes today. This is the whole point: a block that
renders smaller must also *measure* smaller, or pagination places it wrong.

## The scale itself

Discrete, not continuous — three steps, so that a panel's text stays
comparable to its neighbour's:

| Step | Factor | `type.body` 14 pt → |
|---|---|---|
| `comfortable` (default) | 1.0 | 14 pt |
| `compact` | 0.78 | 11 pt |
| `dense` | 0.64 | 9 pt |

Factors, not absolute sizes: a kit that ships a 16 pt body keeps its
proportions. Rounded to the half point, floored at 7 pt — below that the
output stops being projectable, and the floor is the honest place to say so.

## Author-facing surface

A `density` parameter on the panel-bearing layout generators — `grid`,
`comparison`, `pillars`, `steps`, `swot`, `layers`, `content`:

```json
{
  "name": "status-board",
  "base": "grid",
  "cols": 3,
  "density": "dense",
  "description": "Dense status panels — project dashboards."
}
```

It goes through `registerLayout()`'s existing `paramSchema` machinery for
free: type `enum`, values the three steps, default `comfortable`, "did you
mean" on a typo, published by `capabilities().layoutParams`. No new validation
code.

`buildScenes()` stamps `size` on the blocks it flows into that layout's
regions, from `layoutParams(layout).density`.

## Renderers

- **HTML** — `htmlPara`/`htmlBullets`/`htmlTable`/`htmlAlert` emit
  `font-size:Npt` inline when the block carries a size, exactly as
  `htmlHeading` already does. Line height stays the CSS ratio.
- **PPTX** — `addPara`/`addBullets`/`addTable`/`addAlert` pass `fontSize` and,
  critically, `lineSpacing: size * LINE_HEIGHT` **in exact points**. The
  comment already in `addPara` explains why a multiple is wrong (OOXML
  `spcPct` multiplies the font's own metrics, and a kit font with tall
  ascenders then renders ~20 % taller than `blockHeight` measured). A new size
  without a matching `lineSpacing` reintroduces that bug at a smaller scale.

## Tests

- `layout.test.mjs` — a deck under a `density: dense` layout produces blocks
  carrying `size`; the same deck without it produces blocks with **no `size`
  key at all** (the goldens-do-not-move guarantee, asserted directly).
- `layout.test.mjs` — `blockHeight()` of the same paragraph is strictly
  smaller at `dense` than at `comfortable`, and both are > 0.
- `params.test.mjs` — `density: "densse"` is rejected with a suggestion;
  `density` appears in `capabilities().layoutParams` for each base.
- `parity.test.mjs` — for one block of each of the four types carrying a
  `size`, HTML emits a `font-size` and PPTX a `fontSize` of the same value.
- `theme.test.mjs` — a kit at `type.body: 16` scaled to `dense` yields 10 pt,
  not 9: the factor applies to the kit's token, not to the default's.

## Out of scope

- Per-block sizing from the deck's Markdown. That is the contract's line.
- A continuous scale. Three steps is a design decision: it keeps panels
  comparable and keeps the diagnostic legible ("this panel is `dense` and
  still overflows" is actionable; "this panel is at 0.83" is not).
- Choosing the step automatically — that is [plan 5](05-auto-fit.md), and it
  consumes this scale rather than defining it.
