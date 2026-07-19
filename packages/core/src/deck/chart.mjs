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

import { COLORS, CHART_COLORS, FONTS } from './tokens.mjs';

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

function cartesian(block, W, H, locale) {
  const { categories: cats, series } = block;
  const legend = series.length > 1;
  // values truncated first: the scale must only know what will actually be
  // plotted (see shownValues)
  const shown = series.map((s) => shownValues(s, cats));
  const allVals = shown.flat();
  const { lo, hi, ticks } = niceScale(Math.min(0, ...allVals), Math.max(0, ...allVals));
  const horizontal = block.chartType === 'barh';

  const tickLabels = ticks.map((t) => fmt(t, locale));
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

  if (block.chartType === 'bar' || block.chartType === 'barh') {
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

  if (legend) p.push(legendRow(series, plot.x, H - 10, plot.w));
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
 * validate.mjs (code CHART_DATA_IGNORED), hence visible to `lutrin validate`,
 * VS Code and Obsidian.
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
