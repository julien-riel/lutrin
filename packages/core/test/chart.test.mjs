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
import { COLORS, CHART_COLORS, LAYER_SHADES, SEMANTIC } from '../src/deck/tokens.mjs';
import { parseDeck } from '../src/deck/parse.mjs';

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

// ---------------------------------------------------------------------------
// Stacked, share, target, waterfall, gantt — the five chart types added on the
// widgets-next shortlist. Each one is checked as a DRAWING, like the rest of
// this file: what a reader would see, not what the string contains.
// ---------------------------------------------------------------------------

test('stacked-bar: one column per category, segments touching, scaled on the TOTALS', () => {
  const svg = chartSvg(
    chart(
      'stacked-bar',
      ['Q1', 'Q2'],
      [
        { name: 'A', values: [60, 40] },
        { name: 'B', values: [40, 60] },
      ],
    ),
    600,
    300,
  );
  const a = barsOf(svg, 0).map(bbox);
  const b = barsOf(svg, 1).map(bbox);
  assert.equal(a.length, 2, 'one segment of A per category');
  assert.equal(b.length, 2);

  // ONE column: both segments of a category share the same x span — sizing a
  // stack like a group would draw two half-width columns side by side
  assert.equal(a[0].x0, b[0].x0);
  assert.equal(a[0].x1, b[0].x1);
  // and they stack: B sits on top of A, touching it
  assert.ok(Math.abs(b[0].y1 - a[0].y0) < 1.5, 'the second segment starts where the first ends');
  // both categories total 100, so both columns are the same height — that is
  // the scale reading the totals rather than the individual values
  const h = (bx) => bx.y1 - bx.y0;
  assert.ok(Math.abs(h(a[0]) + h(b[0]) - (h(a[1]) + h(b[1]))) < 1.5);
  for (const bx of [...a, ...b]) assert.ok(inFrame(bx, 600, 300));
});

test('share-bar: each category is normalised to 100 %, whatever its total', () => {
  const svg = chartSvg(
    chart(
      'share-bar',
      ['Small', 'Large'],
      [
        { name: 'A', values: [1, 100] },
        { name: 'B', values: [1, 100] },
      ],
    ),
    600,
    300,
  );
  const a = barsOf(svg, 0).map(bbox);
  const b = barsOf(svg, 1).map(bbox);
  const h = (bx) => bx.y1 - bx.y0;
  // 1+1 and 100+100 are worlds apart in absolute terms and identical in share
  assert.ok(Math.abs(h(a[0]) - h(a[1])) < 1.5, 'a share ignores the magnitude');
  assert.ok(Math.abs(h(b[0]) - h(b[1])) < 1.5);
  assert.match(svg, /100 %/, 'the ticks are percentages');
  // a category totalling zero draws nothing rather than dividing by it
  const zero = chartSvg(chart('share-bar', ['Z'], [{ name: 'A', values: [0] }]), 400, 200);
  assert.equal(barsOf(zero, 0).length, 0);
});

test('target: the rule is drawn, labelled, and pulls the scale up to itself', () => {
  const withTarget = { ...chart('bar', ['Q1'], [{ name: 'A', values: [10] }]), target: 40 };
  const svg = chartSvg(withTarget, 600, 300);
  // dashed, in the page ink — never a series colour, and so never in the legend
  const rule = svg.match(/<line[^>]*stroke="#([0-9a-fA-F]{6})"[^>]*stroke-dasharray/i);
  assert.ok(rule, 'the target rule is dashed');
  assert.equal(rule[1].toLowerCase(), COLORS.neutralSecondary.toLowerCase());
  assert.ok(
    !CHART_COLORS.some((c) => c.toLowerCase() === rule[1].toLowerCase()),
    'the target is not an identity',
  );
  // a rule outside its own frame is worse than no rule: the scale must have
  // grown to hold 40, so the lone bar of 10 is now well under half the plot
  const bar = bbox(barsOf(svg, 0)[0]);
  const plain = bbox(
    barsOf(chartSvg(chart('bar', ['Q1'], [{ name: 'A', values: [10] }]), 600, 300), 0)[0],
  );
  assert.ok(bar.y1 - bar.y0 < plain.y1 - plain.y0, 'the target entered niceScale');
});

test('waterfall: anchors run from zero, deltas float, and hue carries the sign', () => {
  const svg = chartSvg(
    chart(
      'waterfall',
      ['Budget', 'Gain', 'Loss', 'Actual'],
      [{ name: 'C', values: [100, 20, -30, 90] }],
    ),
    700,
    340,
  );
  const paths = [...svg.matchAll(/<path d="([^"]+)" fill="#([0-9a-fA-F]{6})"\/>/g)];
  assert.equal(paths.length, 4, 'one bar per category');
  const kind = (k) => paths[k][2].toLowerCase();
  assert.equal(kind(0), COLORS.neutralSecondary.toLowerCase(), 'an anchor is neutral');
  assert.equal(kind(3), COLORS.neutralSecondary.toLowerCase());
  assert.equal(kind(1), SEMANTIC.success.solid.toLowerCase(), 'a rise is the success tint');
  assert.equal(kind(2), SEMANTIC.danger.solid.toLowerCase(), 'a fall is the danger tint');

  const box = paths.map((m) => bbox(m[1]));
  const base = baseline(svg).y1;
  assert.ok(Math.abs(box[0].y1 - base) < 1.5, 'the opening anchor stands on zero');
  assert.ok(Math.abs(box[3].y1 - base) < 1.5, 'so does the closing one');
  assert.ok(box[1].y1 < base - 1.5, 'a delta floats on the running sum, off the baseline');
  // the numbers are part of the chart: a bridge without them is a shape
  assert.match(svg, />\+20</);
  assert.match(svg, />-30</);
});

test('waterfall: `totals:` names the anchors when the bridge has a subtotal', () => {
  const svg = chartSvg(
    {
      ...chart(
        'waterfall',
        ['Open', 'Δ', 'Sub', 'Δ2', 'End'],
        [{ name: 'C', values: [100, 20, 120, -10, 110] }],
      ),
      totals: ['Open', 'Sub', 'End'],
    },
    700,
    340,
  );
  const paths = [...svg.matchAll(/<path d="[^"]+" fill="#([0-9a-fA-F]{6})"\/>/g)].map((m) =>
    m[1].toLowerCase(),
  );
  const neutral = COLORS.neutralSecondary.toLowerCase();
  assert.deepEqual(
    paths.map((c) => c === neutral),
    [true, false, true, false, true],
    'the three named categories are the anchors',
  );
});

test('gantt: a lane spans its periods, both ends included, and "now" is a rule', () => {
  const deck = parseDeck(
    '# Plan\n\n```chart\ntype: gantt\ncategories: Q1, Q2, Q3\nnow: Q2\nBuild: Q1 - Q2\nShip: Q3\n```\n',
  );
  const block = deck.slides[0].sections.flatMap((s) => s.blocks)[0];
  assert.equal(block.chartType, 'gantt');
  assert.deepEqual(block.series[0].spans, [{ from: 0, to: 1, raw: 'Q1 - Q2' }]);
  // the raw text is kept for the no-rasterizer fallback, which rebuilds the
  // spec with values.join(', ') — objects there would print [object Object]
  assert.deepEqual(block.series[0].values, ['Q1 - Q2']);

  const svg = chartSvg(block, 700, 300);
  const bars = [...svg.matchAll(/<path d="([^"]+)" fill="#([0-9a-fA-F]{6})"\/>/g)];
  assert.equal(bars.length, 2, 'one bar per span');
  // one hue for every lane: the lane is named on the left, so colour carries
  // nothing — and cycling the palette would cap a plan at six workstreams
  assert.equal(bars[0][2].toLowerCase(), bars[1][2].toLowerCase());
  const [build, ship] = bars.map((m) => bbox(m[1]));
  assert.ok(build.x1 - build.x0 > (ship.x1 - ship.x0) * 1.7, 'two periods are twice one period');
  assert.match(svg, new RegExp(`stroke="#${COLORS.negative}"`, 'i'), 'the "now" rule is drawn');
});

test('gantt: a period that resolves to nothing invalidates the spec', () => {
  const deck = parseDeck(
    '# Plan\n\n```chart\ntype: gantt\ncategories: Q1, Q2\nBuild: Q1 - Q9\n```\n',
  );
  const block = deck.slides[0].sections.flatMap((s) => s.blocks)[0];
  // the DSL's standing promise: the source shown as a code block, INVALID_CHART
  assert.equal(block.type, 'code');
  assert.equal(block.invalidChart, true);
});

// ---------------------------------------------------------------------------
// rating: the scorecard of part-filled discs
//
// Rejected in the widgets review because a Harvey ball was assumed to be a
// glyph (◐ U+25D0 is not in WGL4) or an OOXML shape adjustment (a viewer that
// ignores it draws the preset's 270° wedge). Drawn as SVG and rasterised like
// every other figure here, it is neither. These assertions pin the two things
// that verdict turned on: the disc is a PATH, and the denominator is the
// author's.
// ---------------------------------------------------------------------------

/**
 * Fill fraction of the first Harvey ball in an SVG, read back from the drawing
 * as an ANGLE — the only thing that carries the score.
 *
 * Two earlier versions of this helper were wrong in instructive ways. Reading
 * the path's first point compares two identical noons, so 2/4 and 2/10 looked
 * the same. Reading the arc's end point as coordinates then compares positions,
 * which move when the layout does — adding a second row shifts every disc, and
 * the assertion failed for a reason that had nothing to do with the scale. The
 * angle from the disc's own centre is invariant under both.
 */
function wedgeFraction(svg) {
  const m = svg.match(
    /<path d="M([\d.-]+),([\d.-]+) L[\d.-]+,[\d.-]+ A[\d.]+,[\d.]+ 0 \d 1 ([\d.-]+),([\d.-]+)/,
  );
  if (!m) return null;
  const [cx, cy, x, y] = m.slice(1).map(Number);
  // the wedge opens clockwise from noon, so shift atan2's origin by a quarter
  const a = Math.atan2(y - cy, x - cx) + Math.PI / 2;
  return Math.round((((a + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * 1000) / 1000;
}

test('rating: one disc per cell, drawn as paths — no glyph, no shape adjustment', () => {
  const svg = chartSvg(
    {
      ...chart(
        'rating',
        ['Fit', 'Cost'],
        [
          { name: 'Option A', values: [5, 0] },
          { name: 'Option B', values: [3, 4] },
        ],
      ),
      scale: 5,
    },
    600,
    300,
  );
  // four cells: a ring each, plus a solid for the full one and a wedge for the
  // partial ones. Nothing here is a text glyph — that is the whole point.
  const rings = [...svg.matchAll(/<circle[^>]*stroke="#/g)];
  assert.equal(rings.length, 4, 'one ring per cell');
  assert.ok(!/◐|◔|◕|●|○/.test(svg), 'no disc character anywhere: WGL4 cannot be relied on');

  // 5/5 is a solid disc (a second <circle> with a fill), 0/5 is the bare ring
  const solids = [...svg.matchAll(/<circle[^>]*fill="#[0-9a-fA-F]{6}"\/>/g)];
  assert.equal(solids.length, 1, 'exactly one full score is drawn solid');
  // the two partial scores are wedges, and a wedge is a path from the centre
  const wedges = [...svg.matchAll(/<path d="M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ A/g)];
  assert.equal(wedges.length, 2, '3/5 and 4/5 are drawn as arcs');
});

test('rating: the denominator is the author’s, never the largest value seen', () => {
  const base = chart('rating', ['A'], [{ name: 'One', values: [2] }]);
  // the same 2 must draw differently at two declared scales — and identically
  // whatever ELSE is in the deck, which is what "never inferred" buys
  assert.equal(wedgeFraction(chartSvg({ ...base, scale: 4 }, 400, 200)), 0.5, '2 of 4 is a half');
  assert.equal(
    wedgeFraction(chartSvg({ ...base, scale: 10 }, 400, 200)),
    0.2,
    '2 of 10 is a fifth',
  );

  // adding a bigger value elsewhere changes nothing about this row
  const withBigger = wedgeFraction(
    chartSvg(
      {
        ...chart(
          'rating',
          ['A'],
          [
            { name: 'One', values: [2] },
            { name: 'Two', values: [9] },
          ],
        ),
        scale: 4,
      },
      400,
      200,
    ),
  );
  assert.equal(withBigger, 0.5, 'a bigger score elsewhere must not rescale this one');

  // and the scale is stated on the figure: a reader cannot count it off a disc
  assert.match(chartSvg({ ...base, scale: 7 }, 400, 200), /\/ 7/);
});

test('rating: a value past the scale is clamped, and 0 leaves the bare ring', () => {
  const svg = chartSvg(
    {
      ...chart('rating', ['A', 'B'], [{ name: 'One', values: [99, 0] }]),
      scale: 5,
    },
    400,
    200,
  );
  const solids = [...svg.matchAll(/<circle[^>]*fill="#[0-9a-fA-F]{6}"\/>/g)];
  assert.equal(solids.length, 1, '99/5 is a full disc, not an overrun');
  const wedges = [...svg.matchAll(/<path d="M[\d.]+,[\d.]+ L/g)];
  assert.equal(wedges.length, 0, '0/5 draws no wedge at all');
});

test('rating: `scale:` is reserved only for this type, and only as a number', () => {
  const spec = (src) =>
    parseDeck(`# R\n\n\`\`\`chart\n${src}\n\`\`\`\n`).slides[0].sections.flatMap(
      (s) => s.blocks,
    )[0];

  assert.equal(spec('type: rating\ncategories: A\nOne: 2\nscale: 4').scale, 4);
  // on any other type the word is an ordinary series name — a bar chart may
  // legitimately plot a series called "scale"
  const bar = spec('type: bar\ncategories: A, B\nscale: 4, 5');
  assert.equal(bar.scale, undefined);
  assert.equal(bar.series.at(-1).name, 'scale');
  // and a non-numeric or non-positive value is not a denominator
  assert.equal(spec('type: rating\ncategories: A\nOne: 2\nscale: 0').scale, undefined);
});

// ---------------------------------------------------------------------------
// heat: the same matrix as `rating`, tinted instead of filled
// ---------------------------------------------------------------------------

/** Cell fills of a heat map, in drawing order. */
const cellFills = (svg) =>
  [
    ...svg.matchAll(
      /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="2" fill="#(\w+)"/g,
    ),
  ].map((m) => m[1].toLowerCase());

test('heat: the ramp is LAYER_SHADES, darkest for the highest value', () => {
  const svg = chartSvg(
    {
      ...chart('heat', ['A', 'B'], [{ name: 'Row', values: [4, 0] }]),
      scale: 4,
    },
    600,
    300,
  );
  const fills = cellFills(svg);
  assert.equal(fills.length, 2, 'one cell per value');
  // every fill comes from the shade ramp — never CHART_COLORS, which encodes
  // identity, and never a raw hex, which a kit could not repaint
  const ramp = LAYER_SHADES.map((s) => s.fill.toLowerCase());
  assert.ok(
    fills.every((f) => ramp.includes(f)),
    `fills outside LAYER_SHADES: ${fills}`,
  );
  // 4/4 takes the darkest end, 0/4 the lightest — the ramp runs dark → light,
  // so getting the direction wrong is an easy and invisible mistake
  assert.equal(fills[0], ramp[0], 'the full value takes the darkest shade');
  assert.equal(fills[1], ramp[ramp.length - 1], 'zero takes the lightest');
  // the number stays in the cell: a tint says "more", not "more than what"
  assert.match(svg, />4</);
  assert.match(svg, />0</);
});

test('heat: the ink of each cell is the one paired with its own shade', () => {
  const svg = chartSvg(
    { ...chart('heat', ['A', 'B'], [{ name: 'R', values: [4, 0] }]), scale: 4 },
    600,
    300,
  );
  // pairs, in drawing order: a cell painted with one shade's fill and another
  // shade's ink would pass every token-level contrast test and still be
  // unreadable — that is exactly the defect this branch fixed on solid panels
  const pairs = [...svg.matchAll(/rx="2" fill="#(\w+)"\/>\s*<text[^>]*fill="#(\w+)"/g)];
  assert.equal(pairs.length, 2);
  for (const [, fill, textInk] of pairs) {
    const shade = LAYER_SHADES.find((s) => s.fill.toLowerCase() === fill.toLowerCase());
    assert.ok(shade, `fill #${fill} is not a shade`);
    assert.equal(textInk.toLowerCase(), shade.ink.toLowerCase(), 'ink must be its shade’s own');
  }
});

test('heat: an undeclared scale falls back on the largest value AND says so', () => {
  // 50 against a declared 100 sits mid-ramp; against the inferred 50 it is the
  // top of it. Values that merely differ are not enough — 90 and 100 both land
  // in the last of five steps, and the first version of this test passed for
  // that reason rather than for the right one.
  const base = chart('heat', ['A', 'B'], [{ name: 'R', values: [10, 50] }]);
  const declared = chartSvg({ ...base, scale: 100 }, 600, 300);
  const inferred = chartSvg(base, 600, 300);

  // the figure never hides which normalisation it used
  assert.match(inferred, /\/ 50 \(largest value\)/);
  assert.match(declared, /\/ 100/);
  assert.ok(!/largest value/.test(declared), 'a declared scale is not a fallback');

  // and the pictures genuinely differ: at scale 100 the 90 is not the top of
  // the ramp, at the inferred scale it is. This is the whole reason to declare
  // one — an outlier otherwise repaints the grid from one month to the next.
  assert.notDeepEqual(cellFills(declared), cellFills(inferred));
  assert.equal(cellFills(inferred)[1], LAYER_SHADES[0].fill.toLowerCase());
});
