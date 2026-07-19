/**
 * Charts: the SVG produced by chartSvg() is checked as a drawing, not as a
 * string — the paths are walked and reduced to their bounding box, then
 * confronted with the frame and the baseline.
 *
 * Findings covered (code review): negative values were never drawn (an empty
 * bar for a loss), a series longer than the category list overflowed the
 * frame, and the rounding of horizontal bars was computed on their length
 * instead of their thickness.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSvg, chartDataDiagnostics } from '../src/deck/chart.mjs';
import { COLORS, CHART_COLORS } from '../src/deck/tokens.mjs';

const chart = (chartType, categories, series) => ({ type: 'chart', chartType, categories, series });

/** Paths of one series, in drawing order (one bar = one `<path fill=…>`). */
const barsOf = (svg, si = 0) =>
  [...svg.matchAll(/<path d="([^"]+)" fill="#([0-9a-fA-F]{6})"\/>/g)]
    .filter((m) => m[2].toLowerCase() === CHART_COLORS[si % CHART_COLORS.length].toLowerCase())
    .map((m) => m[1]);

/**
 * Bounding box of a roundedBar `d`: absolute `M`, relative `h`/`v`/`a` (only
 * the arc's end point counts — the belly of the arc stays inside the box of
 * its endpoints for a convex rounding).
 */
function bbox(d) {
  const toks = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  let x = 0;
  let y = 0;
  let cmd = '';
  let i = 0;
  const xs = [];
  const ys = [];
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) {
      cmd = toks[i++];
      continue;
    }
    if (cmd === 'M' || cmd === 'L') {
      x = n();
      y = n();
    } else if (cmd === 'h') {
      x += n();
    } else if (cmd === 'v') {
      y += n();
    } else if (cmd === 'a') {
      n();
      n();
      n();
      n();
      n();
      x += n();
      y += n();
    } else {
      break;
    }
    xs.push(x);
    ys.push(y);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Baseline (category axis): the only stroke drawn in the axis ink. */
function baseline(svg) {
  const m = svg.match(
    new RegExp(
      `<line x1="([\\d.]+)" y1="([\\d.]+)" x2="([\\d.]+)" y2="([\\d.]+)" stroke="#${COLORS.neutralStroke}"`,
      'i',
    ),
  );
  assert.ok(m, 'baseline missing from the SVG');
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

const inFrame = (b, W, H) => b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H;

test('chartSvg renders an SVG at the requested dimensions, one bar per value', () => {
  const svg = chartSvg(
    chart('bar', ['Q1', 'Q2', 'Q3'], [{ name: 'Sales', values: [120, 150, 180] }]),
    640,
    360,
  );
  assert.match(
    svg,
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="640" height="360" viewBox="0 0 640 360">/,
  );
  assert.match(svg, /<\/svg>$/);
  assert.equal(barsOf(svg).length, 3);
  assert.ok(barsOf(svg).every((d) => inFrame(bbox(d), 640, 360)));
});

// ------ major finding: negative values were not drawn -----------------------

test('bar: a loss is drawn below the baseline (it no longer vanishes)', () => {
  const svg = chartSvg(
    chart('bar', ['Q1', 'Q2', 'Q3', 'Q4'], [{ name: 'Result', values: [120, -80, 60, -40] }]),
    640,
    360,
  );
  const bars = barsOf(svg);
  assert.equal(bars.length, 4, 'negative values must produce a bar');
  const zero = baseline(svg).y1;
  const boxes = bars.map(bbox);
  // positives: from zero upwards; negatives: from zero downwards
  for (const k of [0, 2]) {
    assert.ok(Math.abs(boxes[k].y1 - zero) < 0.5, `bar ${k}: anchored at zero`);
    assert.ok(boxes[k].y0 < zero - 1, `bar ${k}: drawn upwards`);
  }
  for (const k of [1, 3]) {
    assert.ok(Math.abs(boxes[k].y0 - zero) < 0.5, `bar ${k}: anchored at zero`);
    assert.ok(boxes[k].y1 > zero + 1, `bar ${k}: drawn downwards`);
  }
  // −80 goes down twice as far as −40 goes up… well, as far as −40 goes down
  assert.ok(boxes[1].y1 - zero > boxes[3].y1 - zero);
  assert.ok(boxes.every((b) => inFrame(b, 640, 360)));
});

test('barh: a loss is drawn to the left of the baseline', () => {
  const svg = chartSvg(
    chart('barh', ['North', 'South'], [{ name: 'Margin', values: [40, -25] }]),
    640,
    360,
  );
  const boxes = barsOf(svg).map(bbox);
  assert.equal(boxes.length, 2);
  const zero = baseline(svg).x1;
  assert.ok(
    Math.abs(boxes[0].x0 - zero) < 0.5 && boxes[0].x1 > zero + 1,
    'positive value goes to the right',
  );
  assert.ok(
    Math.abs(boxes[1].x1 - zero) < 0.5 && boxes[1].x0 < zero - 1,
    'negative value goes to the left',
  );
  assert.ok(boxes.every((b) => inFrame(b, 640, 360)));
});

test('an entirely negative series: zero and every bar stay inside the frame', () => {
  const svg = chartSvg(
    chart('bar', ['Q1', 'Q2'], [{ name: 'Losses', values: [-12, -30] }]),
    640,
    360,
  );
  const zero = baseline(svg).y1;
  assert.ok(zero >= 0 && zero <= 360, `baseline outside the frame: ${zero}`);
  const boxes = barsOf(svg).map(bbox);
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every((b) => b.y0 >= zero - 0.5 && inFrame(b, 640, 360)));
});

// ------ major finding: drawing outside the frame when values > categories ---

test('a series longer than the categories: the drawing stops at the frame', () => {
  const block = chart(
    'bar',
    ['Q1', 'Q2', 'Q3'],
    [{ name: 'Sales', values: [10, 20, 30, 40, 50, 60, 70, 80] }],
  );
  const svg = chartSvg(block, 640, 360);
  const boxes = barsOf(svg).map(bbox);
  assert.equal(boxes.length, 3, 'one bar per category, not per value');
  assert.ok(
    boxes.every((b) => inFrame(b, 640, 360)),
    'no bar outside the SVG frame',
  );
});

test('line: the surplus points do not leave the frame', () => {
  const svg = chartSvg(
    chart('line', ['A', 'B'], [{ name: 'Series', values: [1, 2, 3, 4, 5] }]),
    640,
    360,
  );
  const cx = [...svg.matchAll(/<circle cx="([\d.-]+)"/g)].map((m) => +m[1]);
  assert.equal(cx.length, 2);
  assert.ok(cx.every((x) => x >= 0 && x <= 640));
});

test('chartDataDiagnostics reports dropped values, and nothing when everything matches', () => {
  const tooMany = chart(
    'bar',
    ['Q1', 'Q2'],
    [
      { name: 'Sales', values: [1, 2, 3, 4] },
      { name: 'Costs', values: [1, 2] },
    ],
  );
  const diags = chartDataDiagnostics(tooMany);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].code, 'CHART_DATA_IGNORED');
  assert.equal(diags[0].severity, 'warning');
  assert.match(diags[0].message, /Sales/);
  assert.match(diags[0].message, /the last 2 will be dropped/);
  assert.deepEqual(chartDataDiagnostics(chart('bar', ['Q1'], [{ name: 'V', values: [1] }])), []);
  // pie/doughnut: already covered by validate.mjs, no duplicate here
  assert.deepEqual(chartDataDiagnostics(chart('pie', ['A'], [{ name: 'V', values: [1, 2] }])), []);
});

test('chartDataDiagnostics: consistent guard on a malformed block (exported function)', () => {
  // `block?.type` guarded the access to the type, then `block.series` was
  // dereferenced without a guard: a block with no series raised "not
  // iterable" in the caller
  assert.deepEqual(chartDataDiagnostics(null), []);
  assert.deepEqual(
    chartDataDiagnostics({ type: 'chart', chartType: 'bar', categories: ['A'] }),
    [],
  );
  assert.deepEqual(chartDataDiagnostics({ type: 'chart', chartType: 'bar', series: [] }), []);
});

test('radar: values without a category do not weigh on the scale', () => {
  // major finding — the truncation was applied in cartesian() but not here:
  // a value that was never drawn set `hi` and crushed the visible points onto
  // the center (radii measured 0.2 / 0.3 / 0.5 px instead of ~57 / 115 / 172)
  const [W, H] = [640, 400];
  const svg = chartSvg(
    chart('radar', ['A', 'B', 'C'], [{ name: 'Score', values: [10, 20, 30, 9999] }]),
    W,
    H,
  );
  const pts = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => [
    +m[1],
    +m[2],
  ]);
  assert.equal(pts.length, 3, 'one point per category, not per value');
  const [cx, cy] = [W / 2, H / 2];
  const radii = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
  // the outer radius: min(cx, cy) - 28 — the largest drawn value (30) must
  // reach the last ring, not collapse onto the center
  const R = Math.min(cx, cy) - 28;
  assert.ok(
    Math.abs(radii[2] - R) < 1,
    `the maximum value must touch the edge (measured ${radii[2]} for ${R})`,
  );
  // proportional scale: 10 / 20 / 30 → R/3, 2R/3, R
  assert.ok(
    Math.abs(radii[0] - R / 3) < 1 && Math.abs(radii[1] - (2 * R) / 3) < 1,
    `radii not proportional: ${radii}`,
  );
});

// ------ suggestion-level finding: rounding of horizontal bars ---------------

test('barh: the corner radius follows the bar thickness, not its length', () => {
  const cats = Array.from({ length: 20 }, (_, k) => `C${k + 1}`);
  const svg = chartSvg(
    chart('barh', cats, [{ name: 'Series', values: cats.map(() => 100) }]),
    640,
    200,
  );
  for (const d of barsOf(svg)) {
    const b = bbox(d);
    const thickness = b.y1 - b.y0;
    const rr = Number(d.match(/a([\d.]+),/)[1]);
    assert.ok(thickness < 8, `this particular case requires thin bars (measured: ${thickness})`);
    assert.ok(rr <= thickness / 2 + 1e-6, `radius ${rr} > half-thickness ${thickness / 2}`);
  }
});

// ------ minor finding: number formatting -----------------------------------

test('number formatting follows the locale option, fr-CA by default', () => {
  const block = chart('bar', ['Q1'], [{ name: 'Sales', values: [1500] }]);
  assert.ok(
    chartSvg(block, 640, 360, { locale: 'en-US' }).includes('>1,500<'),
    'en-US: comma separator',
  );
  const byDefault = chartSvg(block, 640, 360);
  assert.ok(!byDefault.includes('>1,500<'), 'fr-CA remains the default');
  assert.ok(/>1\s*500</.test(byDefault), 'fr-CA: space separator');
});
