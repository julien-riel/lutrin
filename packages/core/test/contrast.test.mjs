/**
 * Accessibility: tokens.mjs claims numeric contrast thresholds (charts ≥ 3:1
 * on white, layer inks ≥ 4.5:1) — this test computes the real WCAG ratios so
 * that the promise holds through every palette tweak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, CHART_COLORS, LAYER_SHADES, SEMANTIC, TREND_INK } from '../src/deck/tokens.mjs';
// the WCAG computation lives in the core (theme.mjs): it is THE SAME code that
// validates user themes — no copy that could drift
import { contrastRatio as contrast } from '../src/deck/theme.mjs';

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

test('TREND_INK: metric trends ≥ 4.5:1 on white (small bold text)', () => {
  for (const [kind, ink] of Object.entries(TREND_INK)) {
    const r = contrast(ink, COLORS.ground);
    assert.ok(r >= 4.5, `${kind}: ${r.toFixed(2)}:1 < 4.5:1`);
  }
});
