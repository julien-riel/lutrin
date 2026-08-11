/**
 * Accessibility: tokens.mjs claims numeric contrast thresholds (charts ≥ 3:1
 * on white, layer inks ≥ 4.5:1) — this test computes the real WCAG ratios so
 * that the promise holds through every palette tweak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORS,
  CHART_COLORS,
  LAYER_SHADES,
  SEMANTIC,
  TREND_INK,
  badgeLayout,
} from '../src/deck/tokens.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes, registerLayout, resetUserLayouts } from '../src/deck/layout.mjs';
// the WCAG computation lives in the core (theme.mjs): it is THE SAME code that
// validates user themes — no copy that could drift
import { contrastRatio as contrast } from '../src/deck/theme.mjs';
import { BLOCK_RENDERERS as PPTX } from '../src/pptx/render.mjs';

test('CHART_COLORS: contrast ≥ 3:1 on a white background (claimed by tokens.mjs)', () => {
  for (const c of CHART_COLORS) {
    const r = contrast(c, COLORS.ground);
    assert.ok(r >= 3, `#${c}: ${r.toFixed(2)}:1 < 3:1`);
  }
});

test('LAYER_SHADES: ink ≥ 4.5:1 on its own shade (claimed by tokens.mjs)', () => {
  for (const s of LAYER_SHADES) {
    const r = contrast(s.ink, s.fill);
    assert.ok(r >= 4.5, `ink #${s.ink} on #${s.fill}: ${r.toFixed(2)}:1 < 4.5:1`);
  }
});

test('SEMANTIC: callout text ≥ 4.5:1 on its background (AA, body text)', () => {
  for (const [kind, sem] of Object.entries(SEMANTIC)) {
    const r = contrast(sem.text, sem.fill);
    assert.ok(r >= 4.5, `${kind}: ${r.toFixed(2)}:1 < 4.5:1`);
  }
});

// The solid tone paints the SATURATED token, so the ink cannot be deduced
// from the family the way it can on the pale tints: white clears 4.5:1 on the
// blue and the red and misses it on the amber (1.73:1) and on the green
// (3.19:1). deriveTokens() therefore picks the ink tint by tint, and this is
// where that claim is measured rather than assumed.
test('SEMANTIC: solid chip text ≥ 4.5:1 on its saturated fill (AA, body text)', () => {
  for (const [kind, sem] of Object.entries(SEMANTIC)) {
    const r = contrast(sem.solidText, sem.solid);
    assert.ok(r >= 4.5, `${kind} solid: ${r.toFixed(2)}:1 < 4.5:1`);
  }
});

// The table above says the PAIRS are legible; it says nothing about the two
// components that paint them. A renderer that reached for `sem.text` (the
// pale-callout ink) on `sem.solid` would leave every badge at 2.5:1 with the
// token test still green — so this measures what the badges and the bars
// actually emit, tint by tint.
test('badges and progress bars: the ink they EMIT clears 4.5:1 on the fill they emit', () => {
  const region = { x: 0, y: 0, w: 900, h: 40 };
  const pairs = [];

  const row = {
    type: 'badge',
    items: Object.keys(SEMANTIC).map((kind) => ({ text: 'Label', kind })),
  };
  for (const it of badgeLayout(row, region.w).items) {
    const shapes = [];
    const texts = [];
    PPTX.badge(
      {
        addShape: (_s, o) => shapes.push(o),
        addText: (_t, o) => texts.push(o),
      },
      { type: 'badge', items: [it] },
      region,
      {},
    );
    pairs.push([`badge ${it.kind}`, texts[0].color, shapes[0].fill.color]);
  }

  // the bar's percentage, when it rides INSIDE the fill (a full bar always does)
  for (const kind of Object.keys(SEMANTIC)) {
    const shapes = [];
    const texts = [];
    PPTX.progress(
      { addShape: (_s, o) => shapes.push(o), addText: (t, o) => texts.push({ t, o }) },
      { type: 'progress', value: 1, label: 'Form', kind },
      region,
      {},
    );
    const pct = texts.find((x) => /%/.test(x.t));
    pairs.push([`progress ${kind}`, pct.o.color, shapes[1].fill.color]);
  }

  assert.equal(pairs.length, 10, 'five tints, two components');
  for (const [what, ink, fill] of pairs) {
    const r = contrast(ink, fill);
    assert.ok(r >= 4.5, `${what}: ink #${ink} on #${fill} — ${r.toFixed(2)}:1 < 4.5:1`);
  }
});

test('TREND_INK: metric trends ≥ 4.5:1 on white (small bold text)', () => {
  for (const [kind, ink] of Object.entries(TREND_INK)) {
    const r = contrast(ink, COLORS.ground);
    assert.ok(r >= 4.5, `${kind}: ${r.toFixed(2)}:1 < 4.5:1`);
  }
});

/**
 * The pair a solid panel actually produces, measured on the SCENE rather than
 * on the tokens: for each block type a panel can hold, the ink the renderer
 * emits against the fill the panel emits.
 *
 * This is the test that was missing. `INKED_BLOCKS` used to repaint three
 * types out of the six that write straight onto the panel, so a table, a quote
 * or a progress label inside a solid danger panel came out at 3.10:1 — under
 * AA, in both deliverables — while the panel's own title was white. Every
 * assertion above passed: they measure the tokens, and the tokens were right.
 * What was wrong was which blocks were handed them.
 */
test('a solid panel: every block that writes on it clears 4.5:1', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'ink-probe', base: 'comparison', panels: ['danger-solid'] });

  const deck = parseDeck(`# Probe

<!-- layout: ink-probe -->

## Heading

Paragraph on the panel.

- bullet on the panel

| Col | Value |
|---|---:|
| a | 1 |

> A quote on the panel.

:::progress warning
40 %
Label on the panel
Caption on the panel
:::

## Second
`);
  const scene = buildScenes(deck).find((s) => s.layout === 'ink-probe');
  const panel = scene.elements.find((e) => e.block.type === 'panel').block;
  const fill = SEMANTIC[panel.kind].solid;
  assert.equal(panel.tone, 'solid', 'the probe layout must produce a saturated panel');

  // Every ink the PPTX renderer emits for the blocks of that panel. The
  // renderer is called for real: a field the layout stamps but a renderer
  // ignores is exactly the failure this guards against, and only the emitted
  // value can see it.
  const region = { x: 0, y: 0, w: 400, h: 60 };
  const inks = [];
  for (const el of scene.elements) {
    const type = el.block.type;
    if (type === 'panel') continue;
    const texts = [];
    const shapes = [];
    PPTX[type](
      {
        addShape: (_s, o) => shapes.push(o),
        addText: (tx, o) => texts.push({ tx, o }),
        addTable: (rows) => {
          for (const row of rows) for (const cell of row) texts.push({ tx: '', o: cell.options });
        },
      },
      el.block,
      region,
      {},
    );
    for (const { tx, o } of texts) {
      // the percentage riding INSIDE the bar's own fill is measured against
      // that fill, not against the panel — its pair is asserted above
      if (type === 'progress' && /%/.test(tx)) continue;
      if (o?.color) inks.push([`${type}${o === texts[0].o ? '' : ' (part)'}`, o.color]);
    }
  }

  assert.ok(inks.length >= 8, `expected every text part to declare a colour, got ${inks.length}`);
  for (const [what, ink] of inks) {
    const r = contrast(ink, fill);
    assert.ok(r >= 4.5, `${what}: ink #${ink} on the panel's #${fill} — ${r.toFixed(2)}:1 < 4.5:1`);
  }
});
