/**
 * Chart rendering: `chart` block → SVG (then a PNG embedded in the .pptx).
 *
 * Why not PptxGenJS's native OOXML charts? Keynote and QuickLook (macOS)
 * do not display them at all — blank slide, verified empirically. An image
 * is faithful everywhere; the trade-off (not editable in PowerPoint) is
 * documented in the SKILL.
 *
 * Dataviz rules applied (see the CHART_COLORS palette in tokens.mjs,
 * validated: lightness band, chroma, color-blindness ΔE, contrast):
 *   - thin marks: bars with a 4 px rounded top anchored to the baseline —
 *     the ZERO one, not the bottom of the frame: a loss goes below the
 *     axis (or runs leftwards in barh) instead of disappearing;
 *     2 px lines, points ≥ 8 px ringed in white;
 *   - 2 px of white breathing room between adjacent fills;
 *   - grids and axes understated (neutral), never a frame;
 *   - a legend from two identities on, never a label on every point;
 *   - text carries the text inks, never the series color.
 */

import { COLORS, CHART_COLORS, FONTS, LAYER_SHADES, SEMANTIC } from './tokens.mjs';

/**
 * Number formatting locale (ticks, legend values).
 * The engine is written for Quebec: "1 500", not "1,500". This is not a
 * brand constant — an English deck must be able to change it without
 * touching the code: chartSvg(block, W, H, { locale }) is the intended
 * extension point, and this value is only its default.
 */
const DEFAULT_LOCALE = 'fr-CA';

// font and inks read at call time (never copied at load time): a theme
// applied by applyTheme() must be reflected in the charts of the same
// process
const FONT = () => `${FONTS.body}, Helvetica, Arial, sans-serif`;
const ink = () => `#${COLORS.neutralSecondary}`;
const grid = () => `#${COLORS.underground2}`;
const axis = () => `#${COLORS.neutralStroke}`;
const bg = () => `#${COLORS.ground}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v, locale = DEFAULT_LOCALE) => v.toLocaleString(locale, { maximumFractionDigits: 2 });
const textW = (s, size) => String(s).length * size * 0.58;

/**
 * The values of a series that can actually be plotted: a value without a
 * category has nowhere to sit. The truncation must happen BEFORE the scale is
 * computed — otherwise a surplus that is never drawn sets the bounds and
 * crushes the visible plot (bars outside the frame, radar vertices collapsed
 * onto the center). The surplus is reported by chartDataDiagnostics(), not
 * lost in silence.
 */
const shownValues = (series, cats) => (series.values ?? []).slice(0, cats.length);

/** A "round" scale: pleasant bounds and step for ~n ticks. */
function niceScale(min, max, n = 5) {
  // zero always belongs to the domain: it is the baseline the bars anchor
  // to — an entirely negative series would otherwise have its axis outside
  // the frame
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  if (max <= min) max = min + 1;
  const span = max - min;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

const color = (k) => `#${CHART_COLORS[k % CHART_COLORS.length]}`;

/**
 * A bar with a rounded free end (4 px), anchored to the zero baseline.
 * `x, y, w, h` always describe the rectangle in increasing coordinates;
 * `negative` says which side the anchor is on, hence which corner is rounded:
 * top of a gain, bottom of a loss, right or left in barh.
 *
 * The radius is bounded by the HALF-THICKNESS of the bar — its width when
 * vertical, but its HEIGHT when horizontal — and by its length: a larger
 * rounding would fold the path back onto itself. Confusing the two produced
 * thin horizontal bars with absurdly round ends.
 */
function roundedBar(x, y, w, h, r = 4, horizontal = false, fill = '#000', negative = false) {
  if (h <= 0 || w <= 0) return '';
  const rr = horizontal ? Math.min(r, h / 2, w) : Math.min(r, w / 2, h);
  let d;
  if (horizontal && !negative) {
    // anchored on the left (zero), rounded on the right
    d = `M${x},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z`;
  } else if (horizontal) {
    // anchored on the right (zero), rounded on the left
    d = `M${x + w},${y} h-${w - rr} a${rr},${rr} 0 0 0 -${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 0 ${rr},${rr} h${w - rr} z`;
  } else if (!negative) {
    // anchored at the bottom (zero), rounded at the top
    d = `M${x},${y + h} v-${h - rr} a${rr},${rr} 0 0 1 ${rr},-${rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - rr} z`;
  } else {
    // anchored at the top (zero), rounded at the bottom
    d = `M${x},${y} v${h - rr} a${rr},${rr} 0 0 0 ${rr},${rr} h${w - 2 * rr} a${rr},${rr} 0 0 0 ${rr},-${rr} v-${h - rr} z`;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

function legendRow(series, x, y, w) {
  const items = series.map((s, k) => ({
    label: s.name,
    c: color(k),
    w: 14 + textW(s.name, 11) + 18,
  }));
  const total = items.reduce((a, b) => a + b.w, 0);
  let cx = x + Math.max(0, (w - total) / 2);
  const out = [];
  for (const it of items) {
    out.push(`<rect x="${cx}" y="${y - 9}" width="10" height="10" rx="2" fill="${it.c}"/>`);
    out.push(
      `<text x="${cx + 14}" y="${y}" font-family="${FONT()}" font-size="11" fill="${ink()}">${esc(it.label)}</text>`,
    );
    cx += it.w;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Cartesian: bar, barh, line, area
// ---------------------------------------------------------------------------

/** Stacked family: what the modifier says, read once rather than by comparing
 *  strings at every use. `share` normalises each category to 100 %. */
const stackOf = (t) => ({
  stacked: t.startsWith('stacked-') || t.startsWith('share-'),
  share: t.startsWith('share-'),
  horizontal: t.endsWith('barh'),
});

function cartesian(block, W, H, locale) {
  const { categories: cats, series } = block;
  const legend = series.length > 1;
  const stack = stackOf(block.chartType);
  // values truncated first: the scale must only know what will actually be
  // plotted (see shownValues)
  const shown = series.map((s) => shownValues(s, cats));
  // A stack is scaled on the per-category TOTALS, never on the individual
  // values, or the tallest column runs out of the frame. Shares are always
  // 0–100. Same discipline as shownValues(): aggregate BEFORE the bounds.
  const totalAt = (i) => shown.reduce((sum, v) => sum + Math.max(0, v[i] ?? 0), 0);
  const negAt = (i) => shown.reduce((sum, v) => sum + Math.min(0, v[i] ?? 0), 0);
  const scaleVals = stack.share
    ? [0, 100]
    : stack.stacked
      ? cats.flatMap((_, i) => [totalAt(i), negAt(i)])
      : shown.flat();
  // the target is a fact about the data: a rule drawn outside its own frame is
  // worse than no rule
  const withTarget = Number.isFinite(block.target) ? [...scaleVals, block.target] : scaleVals;
  const { lo, hi, ticks } = niceScale(Math.min(0, ...withTarget), Math.max(0, ...withTarget));
  const horizontal = block.chartType === 'barh' || stack.horizontal;

  const tickLabels = ticks.map((t) => (stack.share ? `${fmt(t, locale)} %` : fmt(t, locale)));
  const valLabelW = Math.max(...tickLabels.map((t) => textW(t, 11)));
  const catLabelW = Math.max(...cats.map((c) => textW(c, 11)));
  const pad = {
    left: 8 + (horizontal ? catLabelW : valLabelW),
    right: 12,
    top: 10,
    bottom: 24 + (legend ? 26 : 0),
  };
  const plot = {
    x: pad.left + 6,
    y: pad.top,
    w: W - pad.left - pad.right - 6,
    h: H - pad.top - pad.bottom,
  };
  const p = [];

  const vpos = (v) =>
    horizontal
      ? plot.x + ((v - lo) / (hi - lo)) * plot.w
      : plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;

  // value grid + ticks
  for (let k = 0; k < ticks.length; k++) {
    const t = ticks[k];
    const label = `<text font-family="${FONT()}" font-size="11" fill="${ink()}"`;
    if (horizontal) {
      const x = vpos(t);
      if (t !== lo)
        p.push(
          `<line x1="${x}" y1="${plot.y}" x2="${x}" y2="${plot.y + plot.h}" stroke="${grid()}" stroke-width="1"/>`,
        );
      p.push(
        `${label} x="${x}" y="${plot.y + plot.h + 16}" text-anchor="middle">${esc(tickLabels[k])}</text>`,
      );
    } else {
      const y = vpos(t);
      if (t !== lo)
        p.push(
          `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="${grid()}" stroke-width="1"/>`,
        );
      p.push(
        `${label} x="${plot.x - 8}" y="${y + 4}" text-anchor="end">${esc(tickLabels[k])}</text>`,
      );
    }
  }
  // baseline (category axis)
  p.push(
    horizontal
      ? `<line x1="${vpos(0)}" y1="${plot.y}" x2="${vpos(0)}" y2="${plot.y + plot.h}" stroke="${axis()}" stroke-width="1"/>`
      : `<line x1="${plot.x}" y1="${vpos(0)}" x2="${plot.x + plot.w}" y2="${vpos(0)}" stroke="${axis()}" stroke-width="1"/>`,
  );

  const slot = (horizontal ? plot.h : plot.w) / cats.length;
  const center = (i) => (horizontal ? plot.y : plot.x) + slot * (i + 0.5);

  // category labels
  cats.forEach((c, i) => {
    p.push(
      horizontal
        ? `<text font-family="${FONT()}" font-size="11" fill="${ink()}" x="${plot.x - 8}" y="${center(i) + 4}" text-anchor="end">${esc(c)}</text>`
        : `<text font-family="${FONT()}" font-size="11" fill="${ink()}" x="${center(i)}" y="${plot.y + plot.h + 16}" text-anchor="middle">${esc(c)}</text>`,
    );
  });

  if (stack.stacked) {
    // one bar per category, whatever the number of series: a stack is ONE
    // column — sizing it like a group would draw four quarter-width columns of
    // stacked segments
    const bw = Math.min(slot * 0.68, 64);
    cats.forEach((_, i) => {
      const c = center(i) - bw / 2;
      const total = totalAt(i);
      // a share of a category totalling zero is not a share: draw nothing
      // rather than divide by it
      const norm = stack.share ? (total > 0 ? 100 / total : 0) : 1;
      // positives stack up from zero, negatives stack down from it — stacking
      // one on the other would draw a total nobody has
      let up = 0;
      let down = 0;
      const last = shown.length - 1;
      shown.forEach((values, si) => {
        const v = (values[i] ?? 0) * norm;
        if (!v) return;
        const from = v > 0 ? up : down;
        const to = from + v;
        if (v > 0) up = to;
        else down = to;
        const [a, b] = [vpos(from), vpos(to)];
        const span = Math.abs(b - a);
        // only the free end of the whole stack is rounded: rounding an inner
        // segment notches it into its neighbour
        const r = si === last && v > 0 ? 4 : 0;
        p.push(
          horizontal
            ? roundedBar(Math.min(a, b), c, span, bw, r, true, color(si), v < 0)
            : roundedBar(c, Math.min(a, b), bw, span, r, false, color(si), v < 0),
        );
        // 2 px of ground between adjacent fills, as circular() does with bg()
        if (span > 2) {
          p.push(
            horizontal
              ? `<line x1="${b}" y1="${c}" x2="${b}" y2="${c + bw}" stroke="${bg()}" stroke-width="2"/>`
              : `<line x1="${c}" y1="${b}" x2="${c + bw}" y2="${b}" stroke="${bg()}" stroke-width="2"/>`,
          );
        }
        // in-segment label past the pie's own 7 % threshold, on shares only
        if (stack.share && Math.abs(v) >= 7) {
          const mid = (a + b) / 2;
          p.push(
            `<text x="${horizontal ? mid : c + bw / 2}" y="${(horizontal ? c + bw / 2 : mid) + 4}" font-family="${FONT()}" font-size="11" font-weight="bold" fill="${bg()}" text-anchor="middle">${Math.round(Math.abs(v))} %</text>`,
          );
        }
      });
    });
  } else if (block.chartType === 'bar' || block.chartType === 'barh') {
    // 2 px of white between neighbouring bars of the same group
    const group = Math.min(slot * 0.68, series.length * 64);
    const bw = (group - (series.length - 1) * 2) / series.length;
    shown.forEach((values, si) => {
      values.forEach((v, i) => {
        const c = center(i) - group / 2 + si * (bw + 2);
        // the bar runs from zero to the value, one way or the other: we pass
        // the rectangle in increasing coordinates and the sign separately
        const [z, t] = [vpos(0), vpos(v)];
        const span = Math.abs(t - z);
        if (horizontal) {
          p.push(roundedBar(Math.min(z, t), c, span, bw, 4, true, color(si), v < 0));
        } else {
          p.push(roundedBar(c, Math.min(z, t), bw, span, 4, false, color(si), v < 0));
        }
      });
    });
  } else {
    // line / area — 2 px stroke, 8 px points ringed in white
    shown.forEach((values, si) => {
      const pts = values.map((v, i) => [center(i), vpos(v)]);
      if (!pts.length) return; // series without a category: nothing to join
      const dLine = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
      if (block.chartType === 'area') {
        p.push(
          `<path d="${dLine} L${pts[pts.length - 1][0]},${vpos(0)} L${pts[0][0]},${vpos(0)} z" fill="${color(si)}" fill-opacity="0.16"/>`,
        );
      }
      p.push(
        `<path d="${dLine}" fill="none" stroke="${color(si)}" stroke-width="2" stroke-linejoin="round"/>`,
      );
      pts.forEach(([x, y]) =>
        p.push(
          `<circle cx="${x}" cy="${y}" r="4" fill="${color(si)}" stroke="${bg()}" stroke-width="2"/>`,
        ),
      );
    });
  }

  // The target: a dashed rule across the plot, in the page's own secondary
  // ink. NOT an identity — it stays out of legendRow and out of CHART_COLORS:
  // a commitment is not one more series in one more colour.
  if (Number.isFinite(block.target)) {
    const t = vpos(block.target);
    const label = fmt(block.target, locale);
    p.push(
      horizontal
        ? `<line x1="${t}" y1="${plot.y}" x2="${t}" y2="${plot.y + plot.h}" stroke="${ink()}" stroke-width="1" stroke-dasharray="4 3"/>` +
            `<text x="${t}" y="${plot.y - 2}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="middle">${esc(label)}</text>`
        : `<line x1="${plot.x}" y1="${t}" x2="${plot.x + plot.w}" y2="${t}" stroke="${ink()}" stroke-width="1" stroke-dasharray="4 3"/>` +
            `<text x="${plot.x + plot.w}" y="${t - 4}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(label)}</text>`,
    );
  }

  if (legend) p.push(legendRow(series, plot.x, H - 10, plot.w));
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Waterfall: the bridge — hue carries SIGN here, not identity. The exception
// in this family, and the reason it does not read CHART_COLORS.
// ---------------------------------------------------------------------------

function waterfall(block, W, H, locale) {
  const { categories: cats } = block;
  const values = shownValues(block.series[0] ?? { values: [] }, cats);
  // anchors: the first and the last by default — the common bridge types
  // nothing — overridden by `totals:` when there is a mid-bridge subtotal
  const named = block.totals?.length ? new Set(block.totals) : null;
  const isAnchor = (i) => (named ? named.has(cats[i]) : i === 0 || i === values.length - 1);

  // each bar's foot and head: an anchor runs from zero, a delta floats on the
  // running sum
  const bars = [];
  let run = 0;
  values.forEach((v, i) => {
    if (isAnchor(i)) {
      bars.push({ from: 0, to: v, anchor: true, v });
      run = v;
    } else {
      bars.push({ from: run, to: run + v, anchor: false, v });
      run += v;
    }
  });

  const extremes = bars.flatMap((b) => [b.from, b.to]);
  const { lo, hi, ticks } = niceScale(Math.min(0, ...extremes), Math.max(0, ...extremes));
  const tickLabels = ticks.map((t) => fmt(t, locale));
  const pad = {
    left: 8 + Math.max(...tickLabels.map((t) => textW(t, 11))),
    right: 12,
    top: 22,
    bottom: 24,
  };
  const plot = {
    x: pad.left + 6,
    y: pad.top,
    w: W - pad.left - pad.right - 6,
    h: H - pad.top - pad.bottom,
  };
  const vpos = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
  const p = [];

  ticks.forEach((t, k) => {
    const y = vpos(t);
    if (t !== lo)
      p.push(
        `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="${grid()}" stroke-width="1"/>`,
      );
    p.push(
      `<text font-family="${FONT()}" font-size="11" fill="${ink()}" x="${plot.x - 8}" y="${y + 4}" text-anchor="end">${esc(tickLabels[k])}</text>`,
    );
  });
  p.push(
    `<line x1="${plot.x}" y1="${vpos(0)}" x2="${plot.x + plot.w}" y2="${vpos(0)}" stroke="${axis()}" stroke-width="1"/>`,
  );

  const slot = plot.w / Math.max(values.length, 1);
  const bw = Math.min(slot * 0.62, 72);
  bars.forEach((b, i) => {
    const cx = plot.x + slot * (i + 0.5);
    const x = cx - bw / 2;
    const [a, z] = [vpos(b.from), vpos(b.to)];
    const span = Math.abs(z - a);
    const fill = b.anchor
      ? `#${COLORS.neutralSecondary}`
      : `#${(b.v >= 0 ? SEMANTIC.success : SEMANTIC.danger).solid}`;
    p.push(roundedBar(x, Math.min(a, z), bw, Math.max(span, 1), 4, false, fill, b.v < 0));
    // a connector from this bar's head to the next bar's foot
    if (i < bars.length - 1 && !bars[i + 1].anchor) {
      p.push(
        `<line x1="${x + bw}" y1="${z}" x2="${cx + slot - bw / 2}" y2="${z}" stroke="${axis()}" stroke-width="1" stroke-dasharray="3 2"/>`,
      );
    }
    // the numbers are not optional: a bridge without them is a shape
    const top = Math.min(a, z);
    p.push(
      `<text x="${cx}" y="${top - 5}" font-family="${FONT()}" font-size="11" font-weight="bold" fill="${ink()}" text-anchor="middle">${esc(
        b.anchor ? fmt(b.v, locale) : `${b.v > 0 ? '+' : ''}${fmt(b.v, locale)}`,
      )}</text>`,
    );
    p.push(
      `<text x="${cx}" y="${plot.y + plot.h + 16}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="middle">${esc(cats[i] ?? '')}</text>`,
    );
  });
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Gantt: named lanes spanning periods. The only chart here that draws a
// DURATION — nothing else in the engine takes a start and an end.
// ---------------------------------------------------------------------------

function gantt(block, W, H) {
  const { categories: cats, series } = block;
  const laneW = Math.min(W * 0.32, Math.max(...series.map((s) => textW(s.name, 11))) + 24);
  const plot = { x: laneW + 8, y: 26, w: W - laneW - 20, h: H - 26 - 16 };
  const colW = plot.w / Math.max(cats.length, 1);
  // the row pitch comes from the number of lanes, INSIDE the svg: blockHeight()
  // must not learn to branch on a chart type — charts stay out of pagination
  const rowH = plot.h / Math.max(series.length, 1);
  const barH = Math.min(rowH * 0.55, 26);
  const p = [];

  cats.forEach((c, i) => {
    const x = plot.x + colW * i;
    if (i)
      p.push(
        `<line x1="${x}" y1="${plot.y}" x2="${x}" y2="${plot.y + plot.h}" stroke="${grid()}" stroke-width="1"/>`,
      );
    p.push(
      `<text x="${x + colW / 2}" y="${plot.y - 8}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="middle">${esc(c)}</text>`,
    );
  });

  series.forEach((s, si) => {
    const cy = plot.y + rowH * (si + 0.5);
    p.push(
      `<text x="${plot.x - 12}" y="${cy + 4}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(s.name)}</text>`,
    );
    // ONE hue for every lane: the lane is already named on the left, exactly as
    // in barh, so colour would carry nothing — and cycling CHART_COLORS would
    // cap a plan at six workstreams for no gain
    for (const span of s.spans ?? []) {
      // `^Q3` — a milestone: a diamond at the CENTER of its period column
      // (the period is the unit; an edge would claim a date the data does
      // not carry). Darker than the bars so a gate reads against the work.
      if (span.milestone) {
        const mx = plot.x + colW * (span.from + 0.5);
        const r = Math.min(barH * 0.62, 11);
        p.push(
          `<path d="M${mx},${cy - r} L${mx + r},${cy} L${mx},${cy + r} L${mx - r},${cy} z" fill="#${COLORS.primaryDarker}"/>`,
        );
        continue;
      }
      const x = plot.x + colW * span.from + 3;
      const w = colW * (span.to - span.from + 1) - 6;
      p.push(roundedBar(x, cy - barH / 2, Math.max(w, 4), barH, 4, true, `#${COLORS.primary}`));
    }
  });

  // "we are here": a rule at the START of the named period, since a period is
  // the unit here — placing it mid-column would claim a precision the data
  // does not carry
  const nowAt = cats.indexOf(block.now);
  if (nowAt >= 0) {
    const x = plot.x + colW * nowAt;
    p.push(
      `<line x1="${x}" y1="${plot.y - 4}" x2="${x}" y2="${plot.y + plot.h}" stroke="#${COLORS.negative}" stroke-width="2"/>`,
    );
  }
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Bullet: the multi-KPI board — one row per indicator, its value as a bar and
// ITS OWN target as a rule standing on the track. Each row runs on its OWN
// scale (0 to a nice bound over value and target): eight KPIs share no unit —
// 99.5 % availability beside 3 612 k$ of spend — so a shared axis would be a
// lie, and the figures drawn on every row are what carries the comparison.
// The vocabulary is the one the reader already knows: the track and marker of
// :::progress, the primary hue of gantt (identity rides on the row name).
// ---------------------------------------------------------------------------

function bullet(block, W, H, locale) {
  const series = block.series;
  const labelW = Math.min(W * 0.3, Math.max(...series.map((s) => textW(s.name, 11))) + 24);
  const valueW = Math.max(...series.map((s) => textW(bulletLabel(s, locale), 11))) + 16;
  const plot = { x: labelW + 8, y: 10, w: W - labelW - valueW - 28, h: H - 20 };
  const rowH = plot.h / Math.max(series.length, 1);
  const barH = Math.min(rowH * 0.42, 18);
  const p = [];
  series.forEach((s, si) => {
    const cy = plot.y + rowH * (si + 0.5);
    // per-row bound: value and target both inside their own frame, always —
    // the same reason the cartesian `target:` enters niceScale
    const { hi } = niceScale(0, Math.max(s.value, s.target ?? s.value, 1e-9), 4);
    const xOf = (v) => plot.x + (Math.max(Math.min(v, hi), 0) / hi) * plot.w;
    p.push(
      `<text x="${plot.x - 12}" y="${cy + 4}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(s.name)}</text>`,
      `<rect x="${plot.x}" y="${cy - barH / 2}" width="${plot.w}" height="${barH}" rx="4" fill="${grid()}"/>`,
      roundedBar(
        plot.x,
        cy - barH / 2,
        Math.max(xOf(s.value) - plot.x, 2),
        barH,
        4,
        true,
        `#${COLORS.primary}`,
      ),
    );
    if (s.target != null) {
      const tx = xOf(s.target);
      p.push(
        `<line x1="${tx}" y1="${cy - barH * 0.95}" x2="${tx}" y2="${cy + barH * 0.95}" stroke="#${COLORS.neutralPrimary}" stroke-width="2"/>`,
      );
    }
    // the figures are drawn by the engine and are not optional: with each row
    // on its own scale, a board without its numbers would be a shape
    p.push(
      `<text x="${plot.x + plot.w + 12}" y="${cy + 4}" font-family="${FONT()}" font-size="11" fill="#${COLORS.neutralPrimary}">${esc(bulletLabel(s, locale))}</text>`,
    );
  });
  return p.join('\n');
}

/** "62 % / 80 %" — the row's figures, value first, exactly as written. */
function bulletLabel(s, locale) {
  const unit = s.pct ? ' %' : '';
  const v = `${fmt(s.value, locale)}${unit}`;
  return s.target != null ? `${v} / ${fmt(s.target, locale)}${unit}` : v;
}

// ---------------------------------------------------------------------------
// Dumbbell: what moved between two states — one row per category, a dot per
// state, a connector between them. The question the grouped bar shows badly:
// the eye reads the GAP, and the gap is drawn instead of inferred. Exactly
// two series; the axis is shared (unlike bullet, the rows compare).
// ---------------------------------------------------------------------------

function dumbbell(block, W, H, locale) {
  const cats = block.categories;
  const series = block.series.slice(0, 2);
  const labelW = Math.min(W * 0.3, Math.max(...cats.map((c) => textW(c, 11))) + 24);
  const plot = { x: labelW + 8, y: 26, w: W - labelW - 24, h: H - 26 - 30 };
  const rowH = plot.h / Math.max(cats.length, 1);
  const all = series.flatMap((s) => shownValues(s, cats));
  const { lo, hi, ticks } = niceScale(Math.min(...all), Math.max(...all));
  const xOf = (v) => plot.x + ((v - lo) / (hi - lo)) * plot.w;
  const p = [legendRow(series, plot.x, 16, plot.w)];
  for (const t of ticks) {
    const x = xOf(t);
    p.push(
      `<line x1="${x}" y1="${plot.y}" x2="${x}" y2="${plot.y + plot.h}" stroke="${grid()}" stroke-width="1"/>`,
      `<text x="${x}" y="${plot.y + plot.h + 16}" font-family="${FONT()}" font-size="10" fill="${ink()}" text-anchor="middle">${esc(fmt(t, locale))}</text>`,
    );
  }
  cats.forEach((c, i) => {
    const cy = plot.y + rowH * (i + 0.5);
    p.push(
      `<text x="${plot.x - 12}" y="${cy + 4}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(c)}</text>`,
    );
    const a = shownValues(series[0], cats)[i];
    const b = series[1] ? shownValues(series[1], cats)[i] : undefined;
    if (a == null) return;
    if (b != null)
      p.push(
        `<line x1="${xOf(a)}" y1="${cy}" x2="${xOf(b)}" y2="${cy}" stroke="${axis()}" stroke-width="2"/>`,
      );
    p.push(
      `<circle cx="${xOf(a)}" cy="${cy}" r="6" fill="${color(0)}" stroke="${bg()}" stroke-width="2"/>`,
    );
    if (b != null)
      p.push(
        `<circle cx="${xOf(b)}" cy="${cy}" r="6" fill="${color(1)}" stroke="${bg()}" stroke-width="2"/>`,
      );
  });
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Rating: the scorecard of part-filled discs — options down, criteria across.
//
// Drawn rather than typeset, and that is the whole design. The two obvious
// routes both fail somewhere a committee would see: ◐ (U+25D0) is NOT in WGL4,
// so a kit shipping a narrow face puts a tofu box on the slide (● U+25CF and
// ○ U+25CB are, which is why the empty and full states would have survived);
// and PptxGenJS's `angleRange` writes an OOXML shape adjustment that a viewer
// may ignore, drawing the preset's default 270° wedge — a confidently wrong
// score, which is worse than a visibly missing one. An SVG rasterised like
// every other figure here has no glyph to substitute and no adjustment to
// misread. Same reasoning as the module header: the least capable viewer
// decides.
// ---------------------------------------------------------------------------

/** A disc filled clockwise from noon. The BOUNDS LIVE HERE and nowhere else:
 *  anything at or under 0 is the empty ring, anything at or over 1 the solid
 *  disc, so a score past its scale reads as full rather than wrapping round.
 *  A caller that clamped as well would be dead code — a mutation run proved
 *  exactly that, so the clamp was removed there rather than doubled. */
function harveyBall(cx, cy, r, frac, fill) {
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg()}" stroke="${fill}" stroke-width="1.5"/>`;
  if (frac <= 0) return ring;
  if (frac >= 1) return `${ring}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
  const a = -Math.PI / 2 + frac * 2 * Math.PI;
  const [x, y] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const large = frac > 0.5 ? 1 : 0;
  return `${ring}<path d="M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${large} 1 ${x},${y} z" fill="${fill}"/>`;
}

/** Frame shared by the two MATRIX figures — `rating` and `heat`. Both read
 *  rows as series and columns as categories, so the room left for the row
 *  labels and the plot itself is computed once rather than in two places that
 *  would drift. What each does INSIDE a cell is its own business. */
function matrixFrame(block, W, H) {
  const labelW = Math.min(W * 0.34, Math.max(...block.series.map((s) => textW(s.name, 11))) + 24);
  const plot = { x: labelW + 8, y: 26, w: W - labelW - 20, h: H - 26 - 22 };
  return { plot, colW: plot.w / Math.max(block.categories.length, 1) };
}

/** Column heads, above the first row, and one row label per series. */
function matrixLabels(cats, series, plot, colW, rowH, top, headY) {
  const p = cats.map(
    (c, i) =>
      `<text x="${plot.x + colW * (i + 0.5)}" y="${headY}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="middle">${esc(c)}</text>`,
  );
  series.forEach((s, si) => {
    p.push(
      `<text x="${plot.x - 12}" y="${top + rowH * (si + 0.5) + 4}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(s.name)}</text>`,
    );
  });
  return p;
}

function rating(block, W, H, locale) {
  const { categories: cats, series } = block;
  // the denominator is the author's, never the observed maximum (see the
  // `scale:` branch in parse.mjs). Five is the idiom's own default; at
  // `scale: 4` the fills land exactly on the quarters everyone draws by hand.
  const scale = block.scale > 0 ? block.scale : 5;
  const { plot, colW } = matrixFrame(block, W, H);
  // A Harvey ball is a MARK, not a pie: capped at 22 px however much room the
  // slot offers, or a three-by-four scorecard on a full slide draws twelve
  // dinner plates. The rows are then packed to what the discs need and the
  // block centred in what is left, rather than spread to fill it.
  const r = Math.min(Math.min(colW, plot.h / Math.max(series.length, 1)) * 0.3, 22);
  const rowH = Math.min(plot.h / Math.max(series.length, 1), r * 3.4);
  const top = plot.y + Math.max(0, (plot.h - rowH * series.length) / 2);
  const p = [];

  // the column heads sit just above the FIRST ROW, not at the top of the slot:
  // rows are centred in the space, and a header pinned to the frame drifts away
  // from the grid it names as soon as the slot is tall
  p.push(...matrixLabels(cats, series, plot, colW, rowH, top, top + rowH / 2 - r - 12));

  series.forEach((s, si) => {
    const cy = top + rowH * (si + 0.5);
    // ONE hue for every disc: the row is already named on the left, so the
    // fill carries a VALUE and never an identity — cycling CHART_COLORS would
    // say "these two scores are different things" when they are the same
    // judgement on two options
    shownValues(s, cats).forEach((v, i) => {
      // bounds are harveyBall's, not ours — see its comment
      const frac = v / scale;
      p.push(harveyBall(plot.x + colW * (i + 0.5), cy, r, frac, `#${COLORS.primary}`));
    });
  });

  // the denominator, said once and quietly: a reader cannot count a fraction
  // off a disc, and a scorecard whose scale is a mystery is a decoration
  p.push(
    `<text x="${W - 12}" y="${H - 6}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(`/ ${fmt(scale, locale)}`)}</text>`,
  );
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Heat: the same matrix, tinted instead of filled — coverage, maturity, risk.
// ---------------------------------------------------------------------------

function heat(block, W, H, locale) {
  const { categories: cats, series } = block;
  const shown = series.map((s) => shownValues(s, cats));
  // The ramp is normalised against the DECLARED scale when there is one. With
  // none, it falls back on the largest value present — and then says so on the
  // figure, because that fallback is the trap: one outlier repaints the whole
  // grid, and two decks of the same data read differently. `scale:` is what
  // makes a heat map comparable from one month to the next.
  const observed = Math.max(1, ...shown.flat().map((v) => Math.abs(v)));
  const scale = block.scale > 0 ? block.scale : observed;
  const { plot, colW } = matrixFrame(block, W, H);
  // rows capped and the block centred, as `rating` does: a two-row matrix
  // stretched over a full slide draws cells the size of playing cards, and a
  // heat map is read by comparing tints, not by their area
  const rowH = Math.min(plot.h / Math.max(series.length, 1), 72);
  const top = plot.y + Math.max(0, (plot.h - rowH * series.length) / 2);
  const p = matrixLabels(cats, series, plot, colW, rowH, top, top - 10);

  series.forEach((_s, si) => {
    const y = top + rowH * si;
    shown[si].forEach((v, i) => {
      // five discrete steps, not a continuous gradient: LAYER_SHADES ships
      // five tints of the primary, each already PAIRED with an ink validated
      // at 4.5:1 — so the figure survives greyscale, a kit repaints it for
      // free, and no cell is ever legible-looking but unreadable
      const frac = Math.min(1, Math.max(0, v / scale));
      const step = Math.min(LAYER_SHADES.length - 1, Math.floor(frac * LAYER_SHADES.length));
      // high value = dark: LAYER_SHADES runs dark → light, so the index flips
      const shade = LAYER_SHADES[LAYER_SHADES.length - 1 - step] ?? LAYER_SHADES[0];
      const x = plot.x + colW * i;
      p.push(
        `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(colW - 2, 1)}" height="${Math.max(rowH - 2, 1)}" rx="2" fill="#${shade.fill}"/>`,
      );
      // the number stays: a tint says "more" and a reader still has to know
      // more than what
      p.push(
        `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" font-family="${FONT()}" font-size="11" fill="#${shade.ink}" text-anchor="middle">${esc(fmt(v, locale))}</text>`,
      );
    });
  });

  p.push(
    `<text x="${W - 12}" y="${H - 6}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="end">${esc(
      block.scale > 0 ? `/ ${fmt(scale, locale)}` : `/ ${fmt(scale, locale)} (largest value)`,
    )}</text>`,
  );
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Circular: pie, doughnut — color follows the share (a single series)
// ---------------------------------------------------------------------------

function circular(block, W, H, locale) {
  const values = shownValues(block.series[0], block.categories);
  const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const legendW = Math.min(W * 0.42, Math.max(...block.categories.map((c) => textW(c, 11))) + 90);
  const cx = (W - legendW) / 2;
  const cy = H / 2;
  const R = Math.min(cx - 10, H / 2 - 10);
  const r0 = block.chartType === 'doughnut' ? R * 0.55 : 0;
  const p = [];

  let a = -Math.PI / 2;
  const pt = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  values.forEach((v, k) => {
    const frac = Math.max(0, v) / total;
    const a2 = a + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const [x1, y1] = pt(a, R);
    const [x2, y2] = pt(a2, R);
    let d;
    if (r0) {
      const [x3, y3] = pt(a2, r0);
      const [x4, y4] = pt(a, r0);
      d = `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r0},${r0} 0 ${large} 0 ${x4},${y4} z`;
    } else {
      d = `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} z`;
    }
    // 2 px white edging = breathing room between adjacent shares
    p.push(`<path d="${d}" fill="${color(k)}" stroke="${bg()}" stroke-width="2"/>`);
    if (frac >= 0.07) {
      const [lx, ly] = pt((a + a2) / 2, r0 ? (R + r0) / 2 : R * 0.62);
      p.push(
        `<text x="${lx}" y="${ly + 4}" font-family="${FONT()}" font-size="12" font-weight="bold" fill="${bg()}" text-anchor="middle">${Math.round(frac * 100)} %</text>`,
      );
    }
    a = a2;
  });

  // legend on the right: swatch + category + value — one entry per SHOWN
  // value (never a category without a share, which would only invent a
  // "— 0": validation reports orphan categories, CHART_DATA_IGNORED)
  const lx = cx + R + 24;
  const lh = 22;
  let ly = cy - ((values.length - 1) * lh) / 2;
  values.forEach((v, k) => {
    p.push(`<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${color(k)}"/>`);
    p.push(
      `<text x="${lx + 16}" y="${ly}" font-family="${FONT()}" font-size="11" fill="${ink()}">${esc(block.categories[k])} — ${esc(fmt(v, locale))}</text>`,
    );
    ly += lh;
  });
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------

function radar(block, W, H) {
  const { categories: cats, series } = block;
  const legend = series.length > 1;
  const cx = W / 2;
  const cy = (H - (legend ? 26 : 0)) / 2;
  const R = Math.min(cx, cy) - 28;
  // same truncation as cartesian() — a vertex without a spoke is never
  // drawn, but if it entered the scale it would crush all the others onto
  // the center (a major finding: radii on the order of a tenth of a pixel)
  const shown = series.map((s) => shownValues(s, cats));
  const hi = niceScale(0, Math.max(0, ...shown.flat())).hi;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / cats.length;
  const pt = (i, v) => [
    cx + ((R * v) / hi) * Math.cos(ang(i)),
    cy + ((R * v) / hi) * Math.sin(ang(i)),
  ];
  const p = [];

  for (const f of [0.25, 0.5, 0.75, 1]) {
    const ring = cats.map((_, i) => pt(i, hi * f).join(',')).join(' ');
    p.push(`<polygon points="${ring}" fill="none" stroke="${grid()}" stroke-width="1"/>`);
  }
  cats.forEach((c, i) => {
    const [x, y] = pt(i, hi);
    p.push(`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${grid()}" stroke-width="1"/>`);
    const [tx, ty] = pt(i, hi * 1.12);
    p.push(
      `<text x="${tx}" y="${ty + 4}" font-family="${FONT()}" font-size="11" fill="${ink()}" text-anchor="middle">${esc(c)}</text>`,
    );
  });
  shown.forEach((values, si) => {
    const pts = cats.map((_, i) => pt(i, values[i] ?? 0));
    p.push(
      `<polygon points="${pts.map((q) => q.join(',')).join(' ')}" fill="${color(si)}" fill-opacity="0.14" stroke="${color(si)}" stroke-width="2"/>`,
    );
    pts.forEach(([x, y]) =>
      p.push(
        `<circle cx="${x}" cy="${y}" r="3.5" fill="${color(si)}" stroke="${bg()}" stroke-width="2"/>`,
      ),
    );
  });
  if (legend) p.push(legendRow(series, 0, H - 10, W));
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Renders a `chart` block as SVG at the dimensions of the slot (px).
 *
 * @param {object} block   `chart` block of the IR
 * @param {number} W       width of the slot (px)
 * @param {number} H       height of the slot (px)
 * @param {object} [opts]  { locale } — number formatting
 *                         (default DEFAULT_LOCALE, see the module header)
 */
export function chartSvg(block, W, H, { locale = DEFAULT_LOCALE } = {}) {
  W = Math.max(240, Math.round(W));
  H = Math.max(160, Math.round(H));
  const body =
    block.chartType === 'pie' || block.chartType === 'doughnut'
      ? circular(block, W, H, locale)
      : block.chartType === 'radar'
        ? radar(block, W, H, locale)
        : block.chartType === 'waterfall'
          ? waterfall(block, W, H, locale)
          : block.chartType === 'gantt'
            ? gantt(block, W, H)
            : block.chartType === 'rating'
              ? rating(block, W, H, locale)
              : block.chartType === 'heat'
                ? heat(block, W, H, locale)
                : block.chartType === 'bullet'
                  ? bullet(block, W, H, locale)
                  : block.chartType === 'dumbbell'
                    ? dumbbell(block, W, H, locale)
                    : cartesian(block, W, H, locale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${bg()}"/>
${body}
</svg>`;
}

/**
 * What the rendering is going to drop, said out loud as diagnostics — the
 * speaking counterpart of shownValues(). The plot truncates to stay inside the
 * frame; without this channel, the data loss would be mute. Wired into
 * validate.mjs (code CHART_DATA_IGNORED), hence visible to `lutrin validate`
 * and to VS Code.
 *
 * The circular charts (pie/doughnut) are left to validate.mjs, which handles
 * them with their own constraints (single series, positive shares): diagnosing
 * them here would duplicate that.
 *
 * @param {object} block  `chart` block of the IR — possibly malformed
 * @returns {Array<{severity:'warning', code:'CHART_DATA_IGNORED', message:string, line:number}>}
 */
export function chartDataDiagnostics(block) {
  // a single unbroken guard: the type used to be read via `block?.type` then
  // `block.series` dereferenced without a net — a block without series raised
  // "not iterable" in the caller
  if (!block || block.type !== 'chart') return [];
  if (block.chartType === 'pie' || block.chartType === 'doughnut') return [];
  const cats = block.categories;
  const series = block.series;
  if (!Array.isArray(cats) || !Array.isArray(series)) return [];

  const out = [];
  for (const s of series) {
    const n = s?.values?.length ?? 0;
    const extra = n - cats.length;
    if (extra <= 0) continue;
    out.push({
      severity: 'warning',
      code: 'CHART_DATA_IGNORED',
      message:
        `Chart "${block.chartType}": series "${s.name}" has ${n} value${n > 1 ? 's' : ''} ` +
        `for ${cats.length} ${cats.length === 1 ? 'category' : 'categories'} — ${
          extra === 1 ? 'the last one will be dropped' : `the last ${extra} will be dropped`
        }.`,
      line: block.line ?? 1,
    });
  }
  return out;
}
