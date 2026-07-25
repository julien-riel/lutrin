# Plan 3 — `badge` and `progress` blocks

## Problem

These are the two signature components of a status board, and the IR has
neither. Rebuilding them by hand cost roughly 40 of the dashboard's 130
elements:

- **Badges** — eight compliance chips, each a `panel` plus a `heading` with a
  hand-computed 3 px vertical offset (nothing centres text in a region), at a
  radius the variant fixes and a fill that cannot be saturated.
- **Progress bars** — five rows, each a track `panel`, a fill `panel`, and a
  percentage `heading` whose x is `barX + barW × pct − 42`, a literal that
  only holds for two-digit percentages.

The second screenshot is worse: its badges (`Action`, `Approval`, `Pending`,
`Urgent`) sit **inline, inside sentences**. Runs carry `bold`, `italic`,
`code` and `link` — nothing else. An inline badge is not merely hard there, it
is unreachable.

## Dependency

Both blocks are painted with the fills from
[plan 2](02-solid-fills.md). Landing this one first would ship two components
that can only be drawn in shades of the primary — which is the defect the
dashboard exposed, relocated. Plan 2 first, or the two together.

## Phase A — the `progress` block

### IR

```js
{ type: 'progress', value: 0.75, label: 'Formulaire Cinéma',
  caption?: 'Under analysis', kind?: 'success' }
```

`value` is clamped to 0–1 at parse time. `kind` defaults to `info`.

`blockHeight` returns a constant, like `metric` does: `caption ? 46 : 28`.
A progress bar is a fixed-height object; its label wrapping is the layout's
problem, not the block's.

### DSL

Symmetric with `:::metric` — first line the value, then the label, then an
optional caption:

```markdown
:::progress success
100 %
Loisirs en ligne
15 April 2026 — complete
:::
```

The tint is the word after the directive name. `markdown-it-container` already
puts it on the open token's `.info`, so this costs one line in `parse.mjs` and
no new dependency. It is a semantic word, not a colour: the same thing
`:::warning` already lets an author write, and no more positioning than that.
An unknown word → `UNKNOWN_PROGRESS_KIND` (warning), rendered as `info`.

`value` accepts `75 %`, `75%`, `0.75` and `3/4`. Anything else →
`INVALID_PROGRESS` (warning) and the block degrades to a paragraph, following
the precedent `INVALID_CHART` set.

### Renderers

- **HTML** — track `div` + fill `div` + label + percentage, one absolutely
  positioned wrapper. The percentage sits inside the fill when it is wide
  enough to hold it, outside otherwise; that threshold is computed once in
  `deck/` and read by both renderers, because the two must not disagree about
  where the number is.
- **PPTX** — two `roundRect` shapes plus `addText`. No native progress shape
  exists in OOXML and none is wanted: a drawn bar renders identically in
  PowerPoint, Keynote and QuickLook, which is the same reasoning that made
  charts images.

### Inferred layout

Three or more `progress` blocks and little else on a slide → the existing
`content` flow already handles them. No new inferred layout: the inference
table in `docs/dsl.md` is a first-match-wins ladder, and inserting a rung
changes what existing decks compile to. An official layout
`status-list` (base `grid`, `cols: 1`, `density: dense`) covers the intent
instead — pure data, zero risk.

## Phase B — the `badge` block and inline badges

### Block form

```js
{ type: 'badge', items: [{ text: 'Scope', kind: 'success' }, …] }
```

A **row** of badges, not one badge per block. Badges come in groups (eight
compliance chips, three statuses); one block per chip would mean eight regions
to place and no wrapping between them. The block wraps its items itself and
reports its own height — that is the only place the wrap can be computed,
since `blockHeight` is what pagination trusts.

```markdown
:::status
Scope, Schedule, Quality, HR
!Budget, !Stakeholders
!!Risks
:::
```

One line per severity: plain = `success`, `!` = `warning`, `!!` = `danger`,
`?` = `info`. Rejected alternative: `kind: text` pairs on every item, which
reads as data entry and buries the one thing a reader of the source wants to
see — which items are in trouble.

### Inline form

`==Action==` inside a paragraph, with an optional tint: `==!Urgent==`.

This needs a custom inline rule (`md.inline.ruler.before('emphasis', …)`,
~40 lines). A markdown-it plugin would be a new dependency, and
`CONTRIBUTING.md` requires that to be discussed rather than assumed — so:
hand-rolled, and the rule is narrow enough to test exhaustively (`==` inside
code spans, unclosed `==`, `====`, a `==` spanning a soft break).

Runs gain one field: `badge: 'success' | 'info' | 'warning' | 'danger'`.

### Renderers

- **HTML** — block: a wrapper of `span`s, flex-wrapped, pill radius. Inline: a
  `span.badge` inside the paragraph's flow.
- **PPTX** — block: one `roundRect` + `addText` per item, positions computed
  by the same wrap function the height estimate used. Inline: pptxgenjs
  exposes `highlight` on a run, giving a filled background without a radius.

  That last one is a **deliberate, documented degradation**: the HTML gets a
  pill, the `.pptx` gets a highlight. `CONTRIBUTING.md` allows a feature to
  degrade cleanly on one side; what it forbids is diverging silently. So it is
  written in `docs/dsl.md`, and `parity.test.mjs` asserts both renderers emit
  *something* semantic-tinted for the same run rather than requiring identity.

## Tests

- `parse.test.mjs` — the four `value` spellings; `INVALID_PROGRESS` on a fifth;
  clamping of `150 %` and `-2`; the severity prefixes of `:::status`; the four
  hostile inputs of the inline rule.
- `layout.test.mjs` — `blockHeight` of a `badge` row grows by one line when
  the items no longer fit the width; a `progress` block's height is constant.
- `parity.test.mjs` — both `BLOCK_RENDERERS` tables gain `progress` and
  `badge` (this test fails the moment one renderer lands without the other,
  which is the point).
- `html.test.mjs` / `pptx-e2e.test.mjs` — a 0 % and a 100 % bar both render;
  the percentage flips outside the fill below the threshold.
- `contrast.test.mjs` — badge ink on badge fill, all four tints.
- `validate.test.mjs` — `UNKNOWN_PROGRESS_KIND`, `INVALID_PROGRESS`, and both
  codes present in the `capabilities().diagnostics` list.

## Deliverables beyond the code

- `examples/demo.deck.md` gains a slide using both blocks — required by
  `CONTRIBUTING.md` for every new block type — and the goldens are
  regenerated with `UPDATE_GOLDEN=1 npm test`, diff re-read.
- `docs/dsl.md`: `:::progress` and `:::status` in the callouts section, the
  inline form in the text section, the PPTX degradation stated plainly, the
  new diagnostics in the table.
- `.claude/skills/deck/SKILL.md`: the two directives, or agents will keep
  writing tables where a status list is meant.

## Out of scope

- Stacked or grouped bars. That is a chart, and `chart` already exists.
- Animating a bar's fill. Animation steps operate on blocks; a partial fill
  would need a sub-block timeline, and no one has asked.
- Badges as links.
