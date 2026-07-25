# Plan 4 — Alignment

## Problem

There is exactly one alignment control in the whole IR: `heading.align`, and
it accepts only `'center'`, added for the `focus` layout's key message.
`para`, `bullets` and `table` have none. Vertical centring exists nowhere.

Two consequences on the dashboard, and the second one is a bug already present
in the shipped code:

1. **Every figure in the budget panel is placed by guesswork.** `RÉEL 147 k$`
   is a label heading at `x + 16` and a value heading at `x + w − 92`, given
   `align: 'center'` inside a 52 px box so the digits land approximately
   right. `1 517` and `147` do not align on their units — they align on their
   box centres, which is not the same thing and is visible.
2. **`|---:|` is parsed and thrown away.** markdown-it resolves column
   alignment into `style="text-align:right"` on the cell token; the run
   flattener (`parse.mjs`) reads `bold`, `italic`, `code` and `link` and drops
   the rest. An author writing a standard Markdown numeric column today gets
   silence — no alignment, no diagnostic.

## Contract check

Point 2 is not a new feature: it is honouring Markdown the engine already
accepts. Saying "this column is numeric" is content, not layout — the same
category as `**bold**`.

Point 1 is different, and it is where the line sits. `align: 'right'` as an
IR field, synthesized by layout code and by the table parser, is fine.
`align: 'right'` as something an author writes on a paragraph is positioning,
and is refused. This plan adds the field and gives it exactly two producers:
the table parser, and layout definitions.

## IR change

```js
{ type: 'table', header, rows, align?: ['left', 'left', 'right'] }
{ type: 'para',    runs, align?: 'left' | 'center' | 'right' }
{ type: 'bullets', items, align?: … }
{ type: 'heading', runs, align?: … }   // widened from 'center' only
```

`table.align` is one entry per column, from the delimiter row. Absent = all
left, so existing scenes stay byte-identical.

## Where alignment comes from

- **Tables** — the delimiter row, read in `parse.mjs`. markdown-it puts it on
  the `th_open`/`td_open` token's `style` attribute; the flattener records the
  column's alignment once from the header row rather than per cell, because a
  Markdown table cannot align cells individually and pretending otherwise
  would invent a syntax.
- **Layouts** — an `align` parameter on the generators where it means
  something (`focus` already has one; `metrics`, `grid`, `content` gain it),
  validated by the existing `paramSchema` machinery.
- **Nowhere else.** In particular, no directive, and no attribute syntax on a
  paragraph.

## Vertical alignment

`valign` is deliberately **not** added to blocks.

The dashboard needed it in one place only — text centred inside a chip — and
that is now the `badge` block's own business ([plan 3](03-badge-progress.md)),
where it is an implementation detail rather than an author-facing control.
Adding `valign` to `para` would invite laying out slides by nudging text
inside regions, which is the failure mode the contract exists to prevent.

If a later need appears, the right shape is a region property in the layout
generator, not a block property.

## Renderers

- **HTML** — `text-align` on `.para`/`.bullets`/`.slot-heading`; on tables,
  per-column CSS emitted with the cell (`<td style="text-align:right">`), not
  a class, because the table is absolutely positioned and carries no column
  identity a stylesheet could hook.
- **PPTX** — `align` on `addText` (pptxgenjs takes `left|center|right`
  directly); for tables, `align` on the cell options in `addTable`.

Both already thread `block.align` for headings, so this is a widening, not new
plumbing.

## Numeric columns

While reading the delimiter row, a right-aligned column is also given
`fontFace` tabular figures where the kit's font offers them
(`font-variant-numeric: tabular-nums` in CSS; in OOXML, the `<a:latin>` run
property plus the font's own `tnum` feature). Without it, right alignment on
proportional digits still leaves the units ragged — which is the whole reason
one right-aligns a money column.

This is one line per renderer and it is the difference between the feature
working and the feature appearing to work.

## Tests

- `parse.test.mjs` — the four delimiter forms (`---`, `:---`, `:---:`, `---:`)
  produce the expected `align` array; a table with no delimiter styling
  produces **no `align` key**.
- `parity.test.mjs` — the same table emits right alignment in both renderers
  for the same column index.
- `layout.test.mjs` — `blockHeight` of a table is unchanged by alignment
  (a regression guard: it would be easy to break the width estimate while
  touching cell rendering).
- `params.test.mjs` — `align` rejected outside its enum on the generators that
  accept it.
- `html.test.mjs` — tabular figures are requested on right-aligned columns
  only.

## Out of scope

- Per-cell alignment. Markdown has no syntax for it, and this project does not
  invent one.
- Justified text. It reads badly at projection sizes and would need hyphenation
  the engine does not have.
- `valign`, as argued above.
