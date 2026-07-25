# Plan 2 — Solid semantic fills and pill radius

## Problem

`panelStyle()` offers six variants, and every one of them is either neutral or
pale:

| Variant | Fill |
|---|---|
| `muted` | `underground1` — near-white |
| `pillar` | `ground` — white |
| `highlight` | `highlightLight` — pale primary |
| `semantic` | `SEMANTIC[kind].fill` — **the four `*Light` tints** |
| `layer` | `LAYER_SHADES[n]` — shades of the primary, and only of the primary |
| `accent` | `COLORS.primary` — one colour, not selectable |

Nothing paints a saturated green, amber or red. On the dashboard this failed
three times over, and each failure was different in kind:

1. **Status chips** — the source has filled amber and red pills with white
   text. The best the IR could do was a pale `semantic` rectangle with dark
   ink, at a fixed 4 px radius. Not a near-miss: a different object.
2. **The status bars** — three states (complete / in development / under
   analysis) needed three colours. Only `layer` offered a set, and its set is
   *shades of the primary*. Semantic encoding collapsed into a monochrome
   gradient, which is worse than no colour: it reads as an ordered scale.
3. **The banner** — a full-bleed coloured strip with white text had to be
   `layer` shade 0, so its colour is whatever the theme's primary happens to
   be. Not a choice, a side effect.

The asymmetry is what gives it away: `block.color` on a text block takes a
free hex, so **ink is fully addressable while fill is not at all**.

## Contract check

This adds no colour syntax for authors — `CONTRIBUTING.md` and `docs/dsl.md`
are explicit that there is none, and there still will not be. What is added is
a **token** (`SEMANTIC[kind].solid`) and a **variant selector** (`tone`) that
layout definitions and kits pick from. The author writes `:::success`; the
layout, or the kit, decides whether that means pale or saturated.

## Token change

`deriveTokens()` (`deck/tokens.mjs`) extends each `SEMANTIC` entry from two
colour slots to four:

```js
info:    { fill: informativeLight, text: informativeDark,
           solid: informative,     solidText: ground },
success: { fill: positiveLight,    text: positiveDark,
           solid: positive,        solidText: ground },
warning: { fill: warningLight,     text: warningDark,
           solid: warning,         solidText: warningDark },  // amber: dark ink
danger:  { fill: negativeLight,    text: negativeDark,
           solid: negative,        solidText: ground },
```

`warning.solidText` is dark on purpose. `COLORS.warning` is `FFB833`: white on
it sits near 1.8:1, far under the 4.5:1 the project holds itself to. The
recipe therefore picks the ink **per tint**, and `contrast.test.mjs` asserts
all four pairs rather than assuming a rule.

`SEMANTIC` is already a derived group re-run by `applyTheme()`, so a kit that
overrides `colors.positive` gets a matching solid for free; a kit may also
override `semantic.success.solid` outright.

## IR change

Two optional fields on `panel`, and nothing else:

```js
{ type: 'panel', variant: 'semantic', kind: 'warning', tone: 'solid' }
{ type: 'panel', variant: 'semantic', kind: 'danger', radius: 'pill' }
```

- `tone` — `'soft'` (default, today's behaviour) or `'solid'`. Meaningful on
  `variant: 'semantic'` only.
- `radius` — `'sm' | 'md' | 'lg' | 'pill'`. Absent = today's per-variant
  literal.

Both omitted when default, so existing scenes stay byte-identical.

`panelStyle()` returns the solid fill and, new, the **ink that goes with it**:

```js
// panelStyle() gains an `ink` slot — the colour text must take ON this panel.
// Today every caller in layout.mjs recomputes it as SEMANTIC[kind].text; with
// two tones that guess is wrong half the time, and wrong quietly.
{ fill, line, ink }
```

The five `buildScenes()` cases that currently write
`const ink = panel.variant === 'semantic' ? SEMANTIC[panel.kind].text : null`
read `panelStyle(panel).ink` instead. That is the real bug this plan closes:
the ink was computed at the call site, five times, from a fill assumed pale.

## Radius, shared

Both renderers hardcode the same ternary (`accent` → 2, `layer`/`semantic` →
4, else 8). Extract it, so `radius: 'pill'` cannot land in one renderer only:

```js
// tokens.mjs
export function panelRadius(block) { … }   // 'pill' → min(r.w, r.h) / 2
```

`htmlPanel` uses the value as `border-radius`, `addPanel` as `rectRadius`
(pptxgenjs takes a 0–1 ratio of the shorter side, so `pill` is `0.5` there —
the one place the two renderers legitimately differ, and it belongs inside the
helper's callers, not in a duplicated ternary).

## Author-facing surface

The existing `panels` parameter of `grid`, `comparison`, `pillars` and `steps`
takes variant names from `PANEL_VARIANTS`. Extend that list with the four
solid forms:

```json
{ "name": "status-chips", "base": "grid", "cols": 4,
  "panels": ["success-solid", "warning-solid", "danger-solid"] }
```

`checkParam`'s `enum-list` validation, the "did you mean" suggestion and
`capabilities()` all follow with no new code. A `radius` parameter joins the
same generators, enum, default per base.

## Renderers

- **HTML** — `htmlPanel` reads `style.fill` and `panelRadius`; no structural
  change.
- **PPTX** — `addPanel` likewise. Both already go through `panelStyle()`,
  which is why this plan is small.

## Tests

- `contrast.test.mjs` — all four `solid` / `solidText` pairs clear 4.5:1. This
  test fails today for a naive white-on-amber implementation; that is the
  point of writing it first.
- `theme.test.mjs` — a kit overriding `colors.positive` moves
  `SEMANTIC.success.solid`; a kit overriding `semantic.success.solid`
  directly wins over the recipe.
- `layout.test.mjs` — a layout with `panels: ["danger-solid"]` produces a
  panel with `tone: 'solid'`, and the section heading flowed into it carries
  `solidText`, not `text`.
- `parity.test.mjs` — same panel block, HTML `border-radius` and PPTX
  `rectRadius` describe the same geometry for each of the four radius values.
- `params.test.mjs` — `"succes-solid"` is rejected with a suggestion.

## Out of scope

- Free hex fills, in the DSL or in a layout JSON. Semantic values designate
  tokens; that rule is stated in `docs/dsl.md` and is what makes a kit
  swappable.
- Gradients, shadows. The system is flat by design.
- Retiring `layer`. It stays what it is — an ordered scale of the primary,
  correct for `funnel` and `pyramid`, wrong for status. This plan removes the
  reason to misuse it.
