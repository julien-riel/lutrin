/**
 * HTML renderer: scenes → standalone HTML document.
 *
 * Same contract as the PPTX renderer: all the geometry comes from the layout
 * engine (scenes in px on the 1280 × 720 grid), the renderer takes no layout
 * decision of its own. Every slide is an absolutely positioned 1280 × 720 px
 * surface, scaled to its container by a small inline script — the HTML
 * rendering is therefore geometrically identical to the .pptx.
 *
 * The document is 100 % standalone (designed for a VS Code webview — live
 * preview — where every external request is blocked by the CSP):
 *   - theme fonts inlined as base64 (woff2) when the theme provides them;
 *   - local and remote images inlined as data URIs;
 *   - charts, Lucide icons, MathJax equations and Mermaid diagrams inlined as
 *     SVG (vector: sharp at any zoom level) — every SVG we did not author
 *     goes through sanitizeSvg first.
 *
 * Three optional inline scripts equip the complete document (never the
 * fragment mode): scaling (FIT_SCRIPT), steps on click (ANIM_SCRIPT) and the
 * standalone presenter mode (PRESENT_SCRIPT — key P: full screen; key N:
 * notes/timer view in a second window; key O: overview of every slide).
 *
 * API for a programmatic host (VS Code plugin):
 *   - renderDeckHtml(scenes, meta, baseDir) → { html, stats }
 *   - compileHtml(markdown, { baseDir })    → { html, stats, scenes, meta }
 * The DOM is stable and addressable: every slide carries `id="slide-N"`,
 * `data-slide` and `data-layout` (scroll restoration, editor → preview
 * synchronization).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CHROME,
  COLORS,
  FONTS,
  FONT_FILES,
  DISPLAY_FONT_FILES,
  LOGOS,
  ROUNDED,
  TYPE,
  SPACE,
  PAGE,
  SEMANTIC,
  SURFACE,
  ACCENT,
  TREND_INK,
  badgeLayout,
  blockFontSize,
  iconSize,
  panelRadius,
  panelStyle,
  progressLayout,
} from '../deck/tokens.mjs';
import { ALERT_BLOCK_TYPES, parseDeck } from '../deck/parse.mjs';
// The SVG sanitizer moved to deck/ when the .pptx started shipping vectors
// too (pptx/svg.mjs): same guard, one home. Re-exported below, because
// sanitize.test.mjs and external hosts import it from here.
import { sanitizeSvg } from '../deck/svg.mjs';
import { presetFor } from '../deck/anim.mjs';
import { buildScenes } from '../deck/layout.mjs';
import { prepareDeckContext } from '../deck/context.mjs';
import { chartSvg } from '../deck/chart.mjs';
import { smartArtSvg } from '../deck/smartart.mjs';
import { highlightLine } from '../deck/highlight.mjs';
import {
  fetchRemoteImage,
  iconSvg,
  kitImageWarnings,
  mathSvg,
  renderMermaidCached,
  resolveLocalImage,
  vendorRemoteAssets,
} from '../deck/assets.mjs';
import { brandMention } from '../license/index.mjs';

/** @font-face variants of the FONTS.body family — the .woff2 paths are
 *  derived from the .ttf of FONT_FILES (same names, .woff2 extension), so a
 *  theme that ships its .ttf ships its .woff2 alongside them. */
const FONT_FACE_VARIANTS = [
  { key: 'regular', weight: 400, style: 'normal' },
  { key: 'bold', weight: 700, style: 'normal' },
  { key: 'italic', weight: 400, style: 'italic' },
];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Absolute positioning style of an element inside the slide. */
const at = (r, withH = false) =>
  `left:${Math.round(r.x)}px;top:${Math.round(r.y)}px;width:${Math.round(r.w)}px;${withH ? `height:${Math.round(r.h)}px;` : ''}`;

// ---------------------------------------------------------------------------
// Text: IR runs → inline HTML
// ---------------------------------------------------------------------------

function runsHtml(runs) {
  return runs
    .map((r) => {
      let s = esc(r.text);
      if (r.code) s = `<code>${s}</code>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      if (r.italic) s = `<em>${s}</em>`;
      // inline badge (`==Action==`): a real pill here, a run highlight in the
      // .pptx — a documented degradation (docs/dsl.md), not a divergence
      if (r.badge)
        s = `<span class="badge badge-${SEMANTIC[r.badge] ? r.badge : 'info'}">${s}</span>`;
      if (r.link) s = `<a href="${esc(r.link)}">${s}</a>`;
      return s;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Inlined resources: images (data URI), SVG with unique identifiers
// ---------------------------------------------------------------------------

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Cache key carrying the file's digest (path + mtime + size). Without it, in
 *  a warm process — `lutrin preview`, the VS Code worker — an
 *  image replaced on disk would serve its old content forever: the watcher
 *  recompiles, but the cache returned the stale base64. Same recipe as the
 *  font memo (fontFacesCss). */
function fileCacheKey(file) {
  try {
    const st = fs.statSync(file);
    return `${file}|${st.mtimeMs}|${st.size}`;
  } catch {
    return file; // does not exist: the read will fail anyway
  }
}

const dataUriCache = new Map();
function fileToDataUri(file) {
  const key = fileCacheKey(file);
  if (dataUriCache.has(key)) return dataUriCache.get(key);
  let uri = null;
  try {
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    uri = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    uri = null;
  }
  dataUriCache.set(key, uri);
  return uri;
}

/** Makes an SVG's internal identifiers unique (Mermaid's styles and url(#…)
 *  collide as soon as two diagrams are inlined). */
function uniquifySvgIds(svg, prefix) {
  const id = svg.match(/<svg[^>]*\sid="([^"]+)"/)?.[1];
  if (!id) return svg;
  return svg.replaceAll(`"${id}"`, `"${prefix}"`).replaceAll(`#${id}`, `#${prefix}`);
}

export { sanitizeSvg };

// ---------------------------------------------------------------------------
// Block rendering (same regions as the PPTX renderer)
// ---------------------------------------------------------------------------

/** Ink imposed by the layout (dark layers, quadrant titles…). */
const ink = (block) => (block.color ? `color:#${block.color};` : '');

/** Text scale imposed by the layout (`density`) — emitted ONLY when the block
 *  carries one: the CSS class already declares the theme's token, and
 *  restating it on every block of every slide would bloat the document for
 *  nothing. `part` picks a block's secondary text (see blockFontSize). */
const sizeCss = (block, part = 'body') =>
  block.size ? `font-size:${blockFontSize(block, part)}pt;` : '';

/** Alignment imposed by a layout (`align` parameter) or, on a table cell, by
 *  the Markdown delimiter row. Left is the natural rendering and emits
 *  nothing — see alignAttr in deck/layout.mjs. */
const alignCss = (block) => (block.align ? `text-align:${block.align};` : '');

function htmlPara(block, r) {
  return `<p class="para el" style="${at(r)}${ink(block)}${sizeCss(block)}${alignCss(block)}">${runsHtml(block.runs)}</p>`;
}

function htmlHeading(block, r) {
  // `size` (pt): key message of the focus layout — otherwise a slot title
  const extra = `${sizeCss(block)}${alignCss(block)}`;
  return `<h3 class="slot-heading el" style="${at(r)}${ink(block)}${extra}">${runsHtml(block.runs)}</h3>`;
}

/** Rebuilds the nesting from the flattened items `{ runs, level }`. */
function htmlBullets(block, r) {
  const tag = block.ordered ? 'ol' : 'ul';
  // `startAt`: chunk of a numbered list split by pagination. Only the root
  // list resumes the count; sub-lists start again from 1.
  const start = block.ordered && block.startAt > 1 ? ` start="${block.startAt}"` : '';
  // the scale goes on the <ul>/<ol> themselves, not on the container: the
  // ".bullets ul" rule is a class selector on the list, and inheriting from
  // an inline size on the parent div would lose to it. The sub-lists carry
  // their own, proportionally smaller, size for the same reason.
  const rootSize = block.size ? ` style="${sizeCss(block)}"` : '';
  const subSize = block.size ? ` style="${sizeCss(block, 'nested')}"` : '';
  let out = '';
  let level = -1;
  for (const it of block.items) {
    while (level < it.level) {
      out += `<${tag}${level < 0 ? `${start}${rootSize}` : subSize}>`;
      level++;
    }
    while (level > it.level) {
      out += `</${tag}>`;
      level--;
    }
    out += `<li>${runsHtml(it.runs)}</li>`;
  }
  while (level >= 0) {
    out += `</${tag}>`;
    level--;
  }
  return `<div class="bullets el" style="${at(r)}${ink(block)}${alignCss(block)}">${out}</div>`;
}

function htmlCode(block, r) {
  const lines = block.source.split('\n').map((line) =>
    highlightLine(line, block.lang)
      .map((seg) => {
        const t = esc(seg.text);
        // the contract is `kind`, never the color: a theme can change the
        // design tokens without silently breaking the hl-* classes
        if (seg.kind === 'string') return `<span class="hl-str">${t}</span>`;
        if (seg.kind === 'keyword') return `<span class="hl-kw">${t}</span>`;
        if (seg.kind === 'comment') return `<span class="hl-com">${t}</span>`;
        return t;
      })
      .join(''),
  );
  return `<pre class="code el" style="${at(r, true)}${sizeCss(block)}">${lines.join('\n')}</pre>`;
}

/** Per-column style of a table, emitted ON THE CELL: the table is absolutely
 *  positioned and its columns carry no identity a stylesheet could hook, so
 *  there is nothing for a class to select. A right-aligned column also gets
 *  TABULAR figures — with proportional digits, aligning the right edge still
 *  leaves the thousands ragged, which is the whole reason a money column is
 *  right-aligned in the first place. */
function cellStyle(block, k, isHeader = false) {
  const a = block.align?.[k];
  const align = !a || a === 'left' ? '' : `text-align:${a};`;
  const figures = a === 'right' ? 'font-variant-numeric:tabular-nums;' : '';
  // On a repainted panel the header's own pale fill has to go with the ink:
  // `.table th` is a class rule, so it survives the colour inherited from the
  // table and would leave light text on light grey — worse than the 3.10:1
  // this repaint exists to fix.
  const fill = isHeader && block.color ? 'background:transparent;' : '';
  const css = `${align}${figures}${fill}`;
  return css ? ` style="${css}"` : '';
}

function htmlTable(block, r) {
  const row = (cells, tag) =>
    `<tr>${cells
      .map((c, k) => `<${tag}${cellStyle(block, k, tag === 'th')}>${runsHtml(c)}</${tag}>`)
      .join('')}</tr>`;
  const head = block.header.length ? `<thead>${row(block.header, 'th')}</thead>` : '';
  const body = block.rows.map((cells) => row(cells, 'td')).join('');
  return `<table class="table el" style="${at(r)}${sizeCss(block)}${ink(block)}">${head}<tbody>${body}</tbody></table>`;
}

function htmlAlert(block, r) {
  const kind = SEMANTIC[block.kind] ? block.kind : 'info';
  const sem = SEMANTIC[kind];
  // outside ALERT_BLOCK_TYPES: ignored (height not reserved by blockHeight,
  // reported to the author by the ALERT_CONTENT_DROPPED diagnostic)
  const inner = block.blocks
    .filter((b) => ALERT_BLOCK_TYPES.has(b.type))
    .map((b) => {
      if (b.type === 'para') return `<p>${runsHtml(b.runs)}</p>`;
      return `<ul>${b.items.map((it) => `<li>${runsHtml(it.runs)}</li>`).join('')}</ul>`;
    })
    .join('');
  // the label has its own class rule (.alert-label), so it needs its own
  // declaration — inheriting the callout's size would leave it at 11 pt on a
  // 9 pt body, larger than the text it introduces
  const label = block.size ? ` style="${sizeCss(block, 'label')}"` : '';
  return (
    `<div class="alert alert-${kind} el" style="${at(r, true)}${sizeCss(block)}">` +
    `<div class="alert-label"${label}>${esc(sem.label)}</div>${inner}</div>`
  );
}

/** Canonical trend arrow (the glyph typed in is not preserved). */
const TREND_GLYPH = { up: '↑', down: '↓', flat: '→' };

function htmlMetric(block, r) {
  const t = block.trend;
  const trend = t
    ? `<div class="metric-trend" style="color:#${TREND_INK[t.sentiment]}">${TREND_GLYPH[t.dir]} ${esc(t.text)}</div>`
    : '';
  return (
    `<div class="metric el" style="${at(r, true)}">` +
    `<div class="metric-value">${esc(block.value)}</div>` +
    `<div class="metric-label">${esc(block.label)}</div>${trend}</div>`
  );
}

/** Box of one inner part of a composite block, in coordinates LOCAL to it:
 *  the wrapper is a positioned element, so a child resolves against it. */
const box = (b) =>
  `left:${Math.round(b.x)}px;top:${Math.round(b.y)}px;width:${Math.round(b.w)}px;height:${Math.round(b.h)}px;`;

function htmlProgress(block, r) {
  const g = progressLayout(block, r.w);
  const sem = SEMANTIC[block.kind] ?? SEMANTIC.info;
  const radius = g.bar.h / 2;
  const parts = [
    `<div class="progress-label" style="${box(g.label)}">${esc(block.label ?? '')}</div>`,
    `<div class="progress-track" style="${box(g.bar)}border-radius:${radius}px"></div>`,
  ];
  // a 0 % bar writes no fill at all: a zero-width pill is a visual artefact,
  // and the empty track already says "nothing done yet"
  if (g.fill.w > 0) {
    parts.push(
      `<div class="progress-fill" style="${box(g.fill)}border-radius:${radius}px;background:#${sem.solid}"></div>`,
    );
  }
  // the target rule stands ON the track, so it takes the ink of the page and
  // not the tint of the bar: it is a commitment, not a share
  if (g.marker) {
    parts.push(
      `<div class="progress-marker" style="${box(g.marker)}background:#${COLORS.neutralPrimary}"></div>`,
    );
  }
  // Inside the fill the ink is the tint's own — the fill is the surface there,
  // whatever the panel underneath. Outside it, the text writes on the panel:
  // the deck's secondary ink normally, the panel's own when it repainted us.
  const outside = block.color ?? COLORS.neutralSecondary;
  parts.push(
    `<div class="progress-pct" style="${box(g.pct)}justify-content:${
      g.pct.align === 'right' ? 'flex-end' : 'flex-start'
    };color:#${g.pct.inside ? sem.solidText : outside}">${esc(g.pct.text)}</div>`,
  );
  if (g.caption) {
    parts.push(
      `<div class="progress-caption" style="${box(g.caption)}color:#${outside}">${esc(block.caption)}</div>`,
    );
  }
  // the label carries no colour rule of its own, so it inherits the wrapper's
  return `<div class="progress el" style="${at(r, true)}${ink(block)}">${parts.join('')}</div>`;
}

function htmlBadge(block, r) {
  const items = badgeLayout(block, r.w)
    .items.map((it) => {
      const kind = SEMANTIC[it.kind] ? it.kind : 'info';
      // positioned from the shared wrap rather than left to flex-wrap: the
      // .pptx has no flow layout, and blockHeight() already committed to a
      // number of rows — three ways of wrapping would be three geometries
      return `<span class="badge badge-${kind} badge-item" style="${box(it)}border-radius:${it.h / 2}px">${esc(it.text)}</span>`;
    })
    .join('');
  return `<div class="badge-row el" style="${at(r, true)}">${items}</div>`;
}

// ---------------------------------------------------------------------------
// Blocks synthesized by the structured layouts (comparison, pillars,
// timeline, layers, swot) — never coming straight from the DSL
// ---------------------------------------------------------------------------

function htmlPanel(block, r) {
  const style = panelStyle(block);
  const border = style.line ? `border:${style.line.width}px solid #${style.line.color};` : '';
  const radius = panelRadius(block, r);
  const accent =
    block.variant === 'pillar' && block.accent !== false ? '<div class="panel-accent"></div>' : '';
  return (
    `<div class="panel el" style="${at(r, true)}background:#${style.fill};${border}border-radius:${radius}px">` +
    `${accent}</div>`
  );
}

function htmlTimelineAxis(block, r) {
  const arrow = block.arrow !== false;
  const cls = `${block.vertical ? 'tl-axis-v' : 'tl-axis'}${arrow ? '' : ' tl-no-arrow'}`;
  const head = arrow ? `<div class="${block.vertical ? 'tl-arrow-v' : 'tl-arrow'}"></div>` : '';
  return `<div class="${cls} el" style="${at(r, true)}">${head}</div>`;
}

function htmlTimelineDot(block, r) {
  return `<div class="tl-dot el" style="${at(r, true)}">${block.numbered === false ? '' : block.index}</div>`;
}

/** A diagram: one inline SVG at the region's EXACT size, in one top-level
 *  element — the animation splice wraps what this returns, and would wrap only
 *  the first of two. No CSS of its own: everything the diagram needs is in the
 *  geometry, which is the same object the .pptx draws. */
function htmlSmartArt(block, r) {
  return `<div class="figure el" style="${at(r, true)}">${smartArtSvg(block, r.w, r.h)}</div>`;
}

function htmlQuote(block, r) {
  // `.quote-mark` and `figcaption` carry colours of their own (the primary
  // accent, the secondary ink): on a repainted panel those class rules beat
  // the inherited colour, so each is handed `color:inherit` explicitly.
  const inherit = block.color ? ' style="color:inherit"' : '';
  const cite = block.cite ? `<figcaption${inherit}>— ${esc(block.cite)}</figcaption>` : '';
  // `.quote blockquote` is a class rule and beats what the figure inherits, so
  // a size has to land on the blockquote itself — the same asymmetry the PPTX
  // side already avoids by reading blockFontSize() directly.
  const size = block.size ? ` style="${sizeCss(block)}"` : '';
  return (
    `<figure class="quote el" style="${at(r, true)}${ink(block)}">` +
    `<div class="quote-mark"${inherit}>"</div><blockquote${size}>${runsHtml(block.runs)}</blockquote>${cite}</figure>`
  );
}

function htmlImage(block, r, ctx, { fullBleed = false } = {}) {
  const file = /^https?:/.test(block.src)
    ? (ctx.remote.get(block.src) ?? null)
    : resolveLocalImage(ctx.imageRoots, block.src);
  const uri = file && fs.existsSync(file) ? fileToDataUri(file) : null;
  if (uri) {
    const cover = fullBleed || block.role === 'background' || block.role === 'cover';
    return `<img class="el ${cover ? 'img-cover' : 'img-contain'}" style="${at(r, true)}" src="${uri}" alt="${esc(block.alt ?? '')}">`;
  }
  return (
    `<div class="placeholder el" style="${at(r, true)}">` +
    `<span>[image: ${esc(block.alt || block.src)}]</span></div>`
  );
}

function htmlMermaid(block, r, ctx) {
  const svg = ctx.mermaid.get(block);
  if (svg) return `<div class="figure mermaid el" style="${at(r, true)}">${svg}</div>`;
  // faithful fallback: source shown as a code block + a caption
  return `${htmlCode({ lang: 'mermaid', source: block.source }, { ...r, h: r.h - 24 })}<div class="fallback-caption el" style="left:${Math.round(r.x)}px;top:${Math.round(r.y + r.h - 22)}px;width:${Math.round(r.w)}px;">Mermaid diagram — run \`lutrin setup-mermaid\` for graphical rendering</div>`;
}

function htmlIcon(block, r, ctx) {
  const svg = ctx.icons.get(block);
  if (!svg) return ''; // icon not found: nothing rather than a broken box
  const size = iconSize(block, r);
  // flush left, like the text (the brand is left-aligned)
  return (
    `<div class="icon el" style="${at(r, true)}">` +
    `<div class="icon-box" style="width:${size}px;height:${size}px">${sanitizeSvg(svg)}</div></div>`
  );
}

function htmlMath(block, r, ctx) {
  const m = ctx.math.get(block);
  if (m) {
    // natural size of the equation, centered; shrunk only if it overflows
    const scale = Math.min(1, r.w / m.displayW, r.h / m.displayH);
    const w = m.displayW * scale;
    const h = m.displayH * scale;
    const svg = m.svg.replace(/^<svg[^>]*>/, (tag) =>
      tag
        .replace(/width="[^"]+"/, `width="${w.toFixed(1)}px"`)
        .replace(/height="[^"]+"/, `height="${h.toFixed(1)}px"`),
    );
    return `<div class="figure el" style="${at(r, true)}">${svg}</div>`;
  }
  return `${htmlCode({ lang: 'latex', source: block.source }, { ...r, h: r.h - 24 })}<div class="fallback-caption el" style="left:${Math.round(r.x)}px;top:${Math.round(r.y + r.h - 22)}px;width:${Math.round(r.w)}px;">LaTeX equation — install mathjax-full for graphical rendering</div>`;
}

/** Charts: in-house SVG at the slot's exact dimensions, inlined as is. */
function htmlChart(block, r) {
  return `<div class="figure el" style="${at(r, true)}">${chartSvg(block, r.w, r.h)}</div>`;
}

/** Exported for the parity test with the PPTX renderer: the two tables must
 *  cover exactly the same block types. */
export const BLOCK_RENDERERS = {
  para: htmlPara,
  heading: htmlHeading,
  bullets: htmlBullets,
  code: htmlCode,
  table: htmlTable,
  alert: htmlAlert,
  metric: htmlMetric,
  progress: htmlProgress,
  badge: htmlBadge,
  quote: htmlQuote,
  image: htmlImage,
  mermaid: htmlMermaid,
  icon: htmlIcon,
  math: htmlMath,
  chart: htmlChart,
  panel: htmlPanel,
  'timeline-axis': htmlTimelineAxis,
  'timeline-dot': htmlTimelineDot,
  smartart: htmlSmartArt,
};

// ---------------------------------------------------------------------------
// Slide chrome (same geometries as the PPTX masters)
// ---------------------------------------------------------------------------

const logoSvgCache = new Map(); // key: file digest — safe across themes AND after a hot edit
function logoHtml(file, heightPx, cls = '') {
  if (!file) return ''; // theme without a signature (generic default)
  const key = fileCacheKey(file);
  let inner = logoSvgCache.get(key);
  if (inner === undefined) {
    if (!fs.existsSync(file)) inner = '';
    else if (path.extname(file).toLowerCase() === '.svg')
      inner = sanitizeSvg(fs.readFileSync(file, 'utf8'));
    else {
      // bitmap logo (theme): inlined as a data URI, resized by the style
      const uri = fileToDataUri(file);
      inner = uri ? `<img src="${uri}" alt="">` : '';
    }
    logoSvgCache.set(key, inner);
  }
  // decorative: the signature repeats on every slide, no point having screen
  // readers announce it
  return inner
    ? `<div class="logo ${cls}" aria-hidden="true" style="height:${heightPx}px">${inner}</div>`
    : '';
}

function coverHtml(scene, brand) {
  const parts = [logoHtml(LOGOS.coverSvg, CHROME.cover.logoH, 'logo-cover')];
  parts.push('<div class="cover-bar"></div>');
  parts.push(`<h1 class="cover-title">${esc(scene.title ?? '')}</h1>`);
  if (scene.subtitle) parts.push(`<p class="cover-subtitle">${esc(scene.subtitle)}</p>`);
  if (scene.byline) parts.push(`<p class="cover-byline">${esc(scene.byline)}</p>`);
  if (brand) parts.push(brandHtml(brand, 'brand-cover'));
  return parts.join('\n');
}

function sectionHtml(scene, brand) {
  return `<h2 class="section-title">${esc(scene.title ?? '')}</h2>\n${logoHtml(LOGOS.sectionSvg, CHROME.section.logoH, 'logo-section')}${brand ? `\n${brandHtml(brand, 'brand-section')}` : ''}`;
}

/** The attribution. `aria-hidden` is NOT set: it is a statement about the
 *  document, and a screen reader has as much business reading it as the footer
 *  it sits beside. */
const brandHtml = (brand, extraClass = '') =>
  `<div class="footer-brand${extraClass ? ` ${extraClass}` : ''}">${esc(brand)}</div>`;

function contentHtml(scene, num, footerText, ctx, brand) {
  const parts = [];
  const hero = scene.master === 'hero' && Boolean(scene.image);
  if (hero) {
    parts.push(
      htmlImage(scene.image, { x: 0, y: 0, w: PAGE.width, h: PAGE.height }, ctx, {
        fullBleed: true,
      }),
    );
  }
  if (scene.title) {
    const title = scene.titleRuns ? runsHtml(scene.titleRuns) : esc(scene.title);
    parts.push(`<div class="slide-title">${title}</div>`);
  }
  // hero: in PPTX, the master's rule and footer are COVERED by the full-frame
  // image — do not paint them on top in HTML (parity); the page number, for
  // its part, is written after the image and stays visible
  if (!hero) parts.push('<div class="title-accent"></div><div class="title-rule"></div>');
  for (const el of scene.elements) {
    const fn = BLOCK_RENDERERS[el.block.type];
    if (!fn) continue;
    let frag = fn(el.block, el.region, ctx);
    if (el.step != null) {
      // The movement is asked of the SAME table the .pptx reads
      // (deck/anim.mjs), so `<!-- animate: zoom -->` means one thing in both
      // outputs. `appear` is the absence of movement and carries no attribute:
      // the visibility toggle below already is that effect.
      const fx = presetFor(el.block.type, scene.animPreset);
      const fxAttr = fx === 'appear' ? '' : ` data-fx="${fx}"`;
      if (el.block.type === 'bullets' && el.stepCount > 1) {
        // list bullet by bullet: one step per <li> (the container stays visible)
        let k = el.step;
        frag = frag.replace(/<li>/g, () => `<li data-step="${k++}"${fxAttr}>`);
      } else {
        frag = frag.replace(/^<(\w+)/, `<$1 data-step="${el.step}"${fxAttr}`);
      }
    }
    parts.push(frag);
  }
  if (!hero) parts.push(`<div class="footer-text">${esc(footerText)}</div>`);
  parts.push(`<div class="footer-num">${num}</div>`);
  // written AFTER the image like the page number, for the same reason: on a hero
  // the full-frame image would cover a mention painted before it
  if (brand) parts.push(brandHtml(brand));
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Stylesheet (design tokens of the active theme — see tokens.mjs)
// ---------------------------------------------------------------------------

// ~300 kB of base64 woff2: encoded once per process — memo KEYED BY THEME
// (family + files) AND by each woff2's digest (path + mtime + size, the
// fileCacheKey recipe): a theme that changes the fonts within the same
// process (preview, warm worker) must not serve the previous ones again, and
// neither must a font file REPLACED under the same path (a kit editor
// uploading new glyphs) — the same warm-process staleness fileToDataUri was
// fixed for
let _fontFaces = null;
let _fontFacesKey = null;
function fontFacesCss() {
  // one memo key over BOTH families: the body files and the display files, plus
  // the two family names — a theme that swaps either within the same warm
  // process must not be served stale faces (the same staleness FONT_FILES was
  // keyed against).
  const cacheOf = (files) =>
    FONT_FACE_VARIANTS.map((f) => {
      const ttf = files[f.key];
      return typeof ttf === 'string' ? fileCacheKey(ttf.replace(/\.ttf$/i, '.woff2')) : '';
    });
  const key = [
    FONTS.body,
    FONTS.display ?? '',
    ...cacheOf(FONT_FILES),
    ...cacheOf(DISPLAY_FONT_FILES),
  ].join('|');
  if (_fontFaces && _fontFacesKey === key) return _fontFaces;
  const faces = [];
  // one @font-face per (family, variant): the body family from FONT_FILES, then
  // the display family from DISPLAY_FONT_FILES. DISPLAY_FONT_FILES is empty
  // unless the theme declared a display family with its files, so a deck with no
  // display font emits exactly the body faces — byte-identical to before.
  const emit = (family, files) => {
    for (const f of FONT_FACE_VARIANTS) {
      const ttf = files[f.key];
      if (typeof ttf !== 'string') continue;
      const file = ttf.replace(/\.ttf$/i, '.woff2');
      if (!fs.existsSync(file)) continue;
      const b64 = fs.readFileSync(file).toString('base64');
      faces.push(
        `@font-face{font-family:"${family}";font-weight:${f.weight};font-style:${f.style};` +
          `src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:swap}`,
      );
    }
  };
  emit(FONTS.body, FONT_FILES);
  if (FONTS.display) emit(FONTS.display, DISPLAY_FONT_FILES);
  _fontFacesKey = key;
  return (_fontFaces = { css: faces.join('\n'), count: faces.length });
}

function baseCss() {
  const C = COLORS;
  const CH = CHROME;
  // Display family declaration for the titles — EMPTY when the theme names no
  // display font, so a deck without one produces byte-identical CSS (the titles
  // inherit the body family from `body`, exactly as before). The .pptx twin
  // sets the same family through displayFace() on the same four surfaces.
  const DTF = FONTS.display
    ? `font-family:"${FONTS.display}",-apple-system,'Segoe UI',Arial,sans-serif;`
    : '';
  const S = SURFACE;
  const A = ACCENT;
  // Cover ink is inherited from the body (neutralPrimary) unless the kit gives
  // the cover its own — emitted only then, so a default cover's CSS is
  // unchanged. The cover BACKGROUND rule is emitted only when the cover differs
  // from the content page (otherwise the shared .slide rule already paints it).
  const coverInkCss = S.coverInk !== C.neutralPrimary ? `color:#${S.coverInk};` : '';
  const coverBgCss =
    S.coverBg !== S.pageBg ? `\n.slide.master-cover{background:#${S.coverBg}}` : '';
  return `
*{box-sizing:border-box}
body{margin:0;background:#${C.underground2};font-family:"${FONTS.body}",-apple-system,'Segoe UI',Arial,sans-serif;color:#${C.neutralPrimary}}
.deck{max-width:1328px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:24px}
.slide-frame{position:relative;width:100%;height:720px;overflow:hidden;background:#${C.ground};border:1px solid #${C.neutralStroke};border-radius:4px}
.slide{position:absolute;left:0;top:0;width:${PAGE.width}px;height:${PAGE.height}px;overflow:hidden;transform-origin:0 0;background:#${S.pageBg}}
.el{position:absolute;margin:0}
a{color:#${C.primary};text-decoration:none}
a:hover{text-decoration:underline}
/* inline code — every surface property EXPLICIT, not only the ones the theme
   cares about. The fragment mode injects this CSS into a host (the VS Code
   webview) whose own default stylesheet gives "code" a padded,
   theme-colored chip (--vscode-textPreformat-background); any
   property left undeclared here is repainted by the host — dark chips under
   dark editor themes, unreadable on a light slide. (No backticks in these
   comments: we are inside a JS template literal.) */
code{font-family:"${FONTS.mono}",monospace;color:#${C.primaryDarker};background:transparent;padding:0;border-radius:0}

/* chrome of content slides */
.slide-title{position:absolute;left:${PAGE.margin}px;top:${SPACE.lg}px;width:${PAGE.width - 2 * PAGE.margin}px;height:${PAGE.titleHeight - SPACE.lg - 8}px;display:flex;align-items:center;font-size:${TYPE.slideTitle}pt;font-weight:700;line-height:1.15;${DTF}}
.title-accent{position:absolute;left:${PAGE.margin}px;top:${PAGE.titleHeight}px;width:${CH.title.accentW}px;height:${CH.title.accentH}px;background:#${A.bar}}
.title-rule{position:absolute;left:${PAGE.margin + CH.title.accentW}px;top:${PAGE.titleHeight + 1}px;width:${PAGE.width - 2 * PAGE.margin - CH.title.accentW}px;height:1px;background:#${A.rule}}
.footer-text{position:absolute;left:${PAGE.margin}px;top:${PAGE.height - PAGE.footerHeight}px;width:${CH.footer.textW}px;height:${CH.footer.h}px;display:flex;align-items:center;font-size:${TYPE.caption}pt;color:#${C.neutralSecondary}}
.footer-num{position:absolute;left:${PAGE.width - PAGE.margin - CH.footer.numW}px;top:${PAGE.height - PAGE.footerHeight}px;width:${CH.footer.numW}px;height:${CH.footer.h}px;display:flex;align-items:center;justify-content:flex-end;font-size:${TYPE.caption}pt;color:#${C.neutralSecondary}}

/* Lutrin attribution — right-aligned, at the caption size and the secondary
   ink: present on every deck compiled without a licence, and deliberately quiet
   enough not to compete with the author's own footer. The .brand-cover and
   .brand-section modifiers reposition the same mention on the two layouts that
   have no footer band. (No backticks in these comments: we are inside a JS
   template literal.) */
.footer-brand{position:absolute;left:${PAGE.width - PAGE.margin - CH.footer.numW - CH.brand.w}px;top:${PAGE.height - PAGE.footerHeight}px;width:${CH.brand.w}px;height:${CH.brand.h}px;display:flex;align-items:center;justify-content:flex-end;font-size:${TYPE.caption}pt;color:#${C.neutralSecondary}}
.brand-cover{left:${PAGE.width - PAGE.margin - CH.brand.w}px;top:${PAGE.height - CH.cover.bylineBottom}px;height:${CH.cover.bylineH}px}
.brand-section{left:${PAGE.width - PAGE.margin - CH.brand.w}px;top:${PAGE.height - PAGE.margin - CH.brand.h}px;color:#${S.sectionInk}}

/* cover */
.logo{position:absolute;left:${PAGE.margin}px;top:${PAGE.margin}px}
.logo svg,.logo img{height:100%;width:auto;display:block}
.logo-section{top:auto;bottom:${PAGE.margin}px}
.cover-bar{position:absolute;left:${PAGE.margin}px;top:${CH.cover.barY}px;width:${CH.cover.barW}px;height:${CH.cover.barH}px;background:#${A.bar}}
.cover-title{position:absolute;left:${PAGE.margin}px;top:${CH.cover.titleY}px;width:${PAGE.width - 2 * PAGE.margin}px;margin:0;font-size:${TYPE.coverTitle}pt;font-weight:700;line-height:1.15;${coverInkCss}${DTF}}
.cover-subtitle{position:absolute;left:${PAGE.margin}px;top:${CH.cover.subtitleY}px;width:${PAGE.width - 2 * PAGE.margin}px;margin:0;font-size:${TYPE.coverSubtitle}pt;color:#${S.coverMutedInk};line-height:1.3}
.cover-byline{position:absolute;left:${PAGE.margin}px;top:${PAGE.height - CH.cover.bylineBottom}px;width:${PAGE.width - 2 * PAGE.margin}px;height:${CH.cover.bylineH}px;display:flex;align-items:center;margin:0;font-size:${TYPE.small}pt;color:#${S.coverMutedInk}}

/* section (accent background) */
.slide.master-section{background:#${S.sectionBg}}${coverBgCss}
.section-title{position:absolute;left:${PAGE.margin}px;top:${CH.section.titleY}px;width:${PAGE.width - 2 * PAGE.margin}px;height:${CH.section.titleH}px;display:flex;align-items:center;margin:0;font-size:${TYPE.sectionTitle}pt;font-weight:700;color:#${S.sectionInk};line-height:1.2;${DTF}}

/* blocks */
.para{font-size:${TYPE.body}pt;line-height:1.4}
.slot-heading{font-size:${TYPE.sectionHeading}pt;font-weight:700;line-height:1.3}
.bullets ul,.bullets ol{margin:0;padding-left:28px;font-size:${TYPE.bullet}pt;line-height:1.3}
.bullets ul ul,.bullets ol ol,.bullets ul ol,.bullets ol ul{font-size:${TYPE.bulletNested}pt;margin-top:6px}
.bullets li{margin-bottom:6px}
.bullets li::marker{color:#${C.neutralSecondary}}
.code{background:#${C.underground1};border:1px solid #${C.neutralStroke};border-radius:8px;padding:${SPACE.xs}px ${SPACE.sm}px;font-family:"${FONTS.mono}",monospace;font-size:${TYPE.code}pt;line-height:1.3;color:#${C.neutralPrimary};overflow:hidden;white-space:pre}
.hl-kw{color:#${C.primaryDarker};font-weight:700}
.hl-str{color:#${C.positiveDark}}
.hl-com{color:#${C.neutralSecondary};font-style:italic}
.table{border-collapse:collapse;font-size:${TYPE.tableBody}pt}
.table th{background:#${C.underground1};font-weight:700;text-align:left}
.table th,.table td{border-bottom:1px solid #${C.neutralStroke};padding:7px 8px;vertical-align:middle}
.alert{border-radius:4px;padding:${SPACE.xs}px ${SPACE.sm}px;font-size:${TYPE.body}pt;line-height:1.3;overflow:hidden}
.alert-label{font-size:${TYPE.small}pt;font-weight:700;margin-bottom:2px}
.alert p{margin:0}
.alert ul{margin:0;padding-left:24px}
.alert-info{background:#${SEMANTIC.info.fill};color:#${SEMANTIC.info.text}}
.alert-success{background:#${SEMANTIC.success.fill};color:#${SEMANTIC.success.text}}
.alert-warning{background:#${SEMANTIC.warning.fill};color:#${SEMANTIC.warning.text}}
.alert-danger{background:#${SEMANTIC.danger.fill};color:#${SEMANTIC.danger.text}}
.metric{background:#${C.ground};border:1px solid #${C.neutralStroke};border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${SPACE.xs}px}
.metric-value{font-size:${TYPE.metricValue}pt;font-weight:700;color:#${C.primary};line-height:1.05}
.metric-label{font-size:${TYPE.metricLabel}pt;color:#${C.neutralSecondary};margin-top:6px}
.metric-trend{font-size:${TYPE.small}pt;font-weight:700;margin-top:8px}
/* progress bar: every inner part is placed by progressLayout (deck/tokens.mjs),
   the same function the .pptx and blockHeight read — the classes carry the
   look only, never the geometry */
.progress>div{position:absolute}
/* the label never wraps: progressLayout() commits to a fixed height before
   either renderer runs, so a second line would leave the block's own box —
   which it did, the first time a bar was put in a three-column cell */
.progress-label{display:flex;align-items:center;font-size:${TYPE.body}pt;line-height:1.3;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.progress-track{background:#${C.underground2}}
.progress-marker{position:absolute;border-radius:1px}
.progress-pct{display:flex;align-items:center;font-size:${TYPE.small}pt;font-weight:700;white-space:nowrap}
.progress-caption{display:flex;align-items:center;font-size:${TYPE.caption}pt;color:#${C.neutralSecondary}}
/* badges — the pill of a :::status row AND of an inline ==Action==. Same
   host-default hazard as "code" above: an inline badge lands inside a
   paragraph of a webview, so every surface property is declared here, at a
   neutral value the tint classes then override. */
.badge{display:inline-block;padding:1px 8px;border-radius:${ROUNDED.pill}px;background:#${C.underground2};color:#${C.neutralPrimary};font-weight:700;line-height:1.3;white-space:nowrap}
/* No font-size on .badge: an INLINE badge takes the size of the sentence it
   sits in — pinned to TYPE.small it rendered 22 % larger than its own
   paragraph on a densified slide, while the .pptx run kept the paragraph's
   size and blockHeight() measured a third answer. The BLOCK form is the
   opposite case: badgeLayout() measured its pills at TYPE.small, so the
   geometry and the type must agree here or the text leaves the pill. */
.badge-item{position:absolute;display:flex;align-items:center;justify-content:center;padding:0 8px;font-size:${TYPE.small}pt;overflow:hidden}
.badge-info{background:#${SEMANTIC.info.solid};color:#${SEMANTIC.info.solidText}}
.badge-success{background:#${SEMANTIC.success.solid};color:#${SEMANTIC.success.solidText}}
.badge-warning{background:#${SEMANTIC.warning.solid};color:#${SEMANTIC.warning.solidText}}
.badge-danger{background:#${SEMANTIC.danger.solid};color:#${SEMANTIC.danger.solidText}}

/* structured layouts: panels, timeline */
.panel{overflow:hidden}
.panel-accent{position:absolute;left:${SPACE.xs}px;right:${SPACE.xs}px;top:0;height:4px;background:#${C.primary}}
.tl-axis{background:linear-gradient(#${C.neutralStroke},#${C.neutralStroke}) no-repeat 0 50%/calc(100% - 14px) 2px}
.tl-axis.tl-no-arrow{background-size:100% 2px}
.tl-arrow{position:absolute;right:0;top:50%;transform:translateY(-50%);width:0;height:0;border-left:14px solid #${C.neutralStroke};border-top:7px solid transparent;border-bottom:7px solid transparent}
.tl-axis-v{background:linear-gradient(#${C.neutralStroke},#${C.neutralStroke}) no-repeat 50% 0/2px calc(100% - 14px)}
.tl-axis-v.tl-no-arrow{background-size:2px 100%}
.tl-arrow-v{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-top:14px solid #${C.neutralStroke};border-left:7px solid transparent;border-right:7px solid transparent}
.tl-dot{display:flex;align-items:center;justify-content:center;background:#${C.primary};color:#${C.ground};border:2px solid #${C.ground};border-radius:50%;font-size:${TYPE.metricLabel}pt;font-weight:700;box-sizing:border-box}
/* same host-default hazard as "code" above: the webview paints blockquote
   with --vscode-textBlockQuote-background and a left border — neutralized
   explicitly */
.quote blockquote{position:absolute;left:96px;right:32px;top:0;bottom:64px;display:flex;align-items:center;margin:0;padding:0;background:transparent;border:0;font-size:${TYPE.quote}pt;font-style:italic;line-height:1.4;${DTF}}
.quote-mark{position:absolute;left:0;top:-10px;font-size:72pt;font-weight:700;color:#${A.bar};line-height:1}
.quote figcaption{position:absolute;right:32px;bottom:12px;font-size:${TYPE.body}pt;color:#${C.neutralSecondary}}
.img-contain{object-fit:contain}
.img-cover{object-fit:cover}
.placeholder{background:#${C.underground1};border:1px dashed #${C.neutralStroke};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:${TYPE.small}pt;color:#${C.neutralSecondary}}
.figure{display:flex;align-items:center;justify-content:center;overflow:hidden}
.figure svg{max-width:100%;max-height:100%}
.icon{display:flex;align-items:center}
.icon-box svg{width:100%;height:100%;display:block}
.fallback-caption{position:absolute;font-size:${TYPE.caption}pt;font-style:italic;color:#${C.neutralSecondary}}

/* animations: appear on click (slides carrying data-anim-steps) */
.slide-frame[data-anim-steps]{cursor:pointer}
.slide-frame[data-anim-steps] [data-step]{visibility:hidden}
.slide-frame[data-anim-steps] [data-step].step-shown{visibility:visible}
.anim-count{position:absolute;right:12px;top:8px;font-size:11px;color:#${C.neutralTertiary};font-variant-numeric:tabular-nums;pointer-events:none;z-index:2}
/* the entrance effect itself (data-fx, written by contentHtml from the same
   table the .pptx reads). EVERY rule here stays under
   .slide-frame[data-anim-steps]: the deck editor strips that attribute to show
   a slide whole, and an ungated opacity:0 would blank it — as it would blank
   the print rendering and the site's demo iframe.
   The "appear" preset carries no data-fx at all: the visibility toggle above
   already is that effect. (No backticks: we are inside a JS template literal.) */
@media (prefers-reduced-motion:no-preference){
  .slide-frame[data-anim-steps] [data-step][data-fx]{opacity:0}
  .slide-frame[data-anim-steps] [data-step][data-fx].step-shown{opacity:1;transition:opacity .4s ease,transform .4s ease,clip-path .4s ease}
  .slide-frame[data-anim-steps] [data-step][data-fx="zoom"]{transform:scale(.4)}
  .slide-frame[data-anim-steps] [data-step][data-fx="zoom"].step-shown{transform:none}
  /* wipe(up) — the same direction as the PowerPoint filter of pptx/anim.mjs */
  .slide-frame[data-anim-steps] [data-step][data-fx="wipe"]{clip-path:inset(100% 0 0 0)}
  .slide-frame[data-anim-steps] [data-step][data-fx="wipe"].step-shown{clip-path:inset(0 0 0 0)}
}

/* presenter notes (below the slide, outside the geometry) */
.notes{font-size:10pt;color:#${C.neutralSecondary};padding:4px 2px}
.notes summary{cursor:pointer}
.notes p{margin:4px 0 0}

@media print{
  body{background:#fff}
  .deck{max-width:none;padding:0;gap:0}
  .slide-frame{width:${PAGE.width}px;height:${PAGE.height}px !important;border:none;border-radius:0;break-after:page}
  .slide{transform:none !important}
  .slide-frame [data-step]{visibility:visible !important}
  /* an entrance effect left standing prints what the audience has not seen
     yet: a metric frozen at 40 % scale, a panel clipped down to nothing */
  .slide-frame [data-step][data-fx]{opacity:1 !important;transform:none !important;clip-path:none !important}
  .anim-count{display:none}
  .notes{display:none}
}`;
}

/** The printed page itself — a DOCUMENT-level rule, so it is injected by
 *  renderDeckHtml() only and never by the fragment mode.
 *
 *  `size` is what makes "print to PDF" produce the deck rather than a deck
 *  squeezed onto the reader's default paper: without it the browser lays a
 *  1280x720 frame onto A4 portrait and scales or crops it. With it, and with
 *  the @media print block of baseCss() (one slide per page, the fit transform
 *  undone, every animation step open), the browser's own print dialog is a
 *  working PDF export. It is not a lutrin PDF WRITER: there are no notes
 *  annotations, no outlines, and no PNG or JPEG anywhere.
 *
 *  It lives outside baseCss() because baseCss() is also handed to a HOST — the
 *  VS Code webview, the editing SPA — where an @page rule is not ours to set:
 *  it would repaginate the host's own print output. */
function pageCss() {
  return `@media print{@page{size:${PAGE.width}px ${PAGE.height}px;margin:0}}`;
}

/** Rules of the presenter mode (PRESENT_SCRIPT) — a function separate from
 *  baseCss() by design: injected into the complete document only, so the CSS
 *  of the fragment mode (webview) stays identical. Everything is scoped under
 *  `body.presenting` or under the `.present-*` elements created by the script:
 *  the normal rendering and the @media print block of baseCss() do not change. */
function presentCss() {
  const C = COLORS;
  return `
/* presentation mode: a single slide, centered, dark neutral background */
body.presenting{background:#0b0b0b;overflow:hidden}
body.presenting .deck{max-width:none;padding:0;gap:0}
body.presenting .slide-frame,body.presenting .notes{display:none}
body.presenting .slide-frame.present-current{display:block;position:fixed;left:0;top:0;right:0;bottom:0;margin:auto;border:none;border-radius:0;z-index:10}
body.presenting .anim-count{display:none} /* the step counter is not projected */
/* discreet strip: shortcut in normal mode, counter while presenting */
.present-hint{position:fixed;right:16px;bottom:12px;z-index:20;padding:4px 10px;font-size:12px;color:#${C.neutralSecondary};background:rgba(255,255,255,.85);border:1px solid #${C.neutralStroke};border-radius:4px;pointer-events:none}
body.presenting .present-hint{color:#8a8f98;background:none;border-color:transparent}
/* help (? key) */
.present-help{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;min-width:340px;padding:20px 28px;background:rgba(11,11,11,.94);color:#e9ecef;border-radius:8px;font-size:13px;line-height:2;cursor:pointer}
.present-help.open{display:block}
.present-help b{display:block;margin-bottom:6px;font-size:14px}
.present-help kbd{display:inline-block;min-width:20px;margin-right:6px;padding:0 6px;background:#2a2a2a;border-radius:4px;font-family:inherit;font-size:12px;text-align:center}

/* Progress bar and on-screen controls.
   EVERY class here is prefixed present-: .progress, .progress-track and
   .progress-fill already belong to the :::progress block of the DSL
   (baseCss above), and reusing those names would repaint every bar the
   author wrote into their own slides. */
/* The chrome sits ON TOP OF THE SLIDE, whose background is the theme's — white
   in every default kit. So none of it may be tinted for the dark backdrop of
   presentation mode: a rail at rgba(255,255,255,.14) and buttons at .10 were
   invisible on a white slide, which a screenshot showed and reading the CSS did
   not. Everything below is dark-on-translucent with a light border, the same
   bet .present-help already makes, and it reads on either. */
.present-bar{display:none;position:fixed;left:0;bottom:0;width:100%;height:3px;z-index:20;background:rgba(128,128,128,.32)}
body.presenting .present-bar{display:block}
.present-bar-fill{height:100%;width:0;background:#${C.primary};transition:width .2s ease}
/* the controls exist for the surfaces the keyboard does not reach — a tablet,
   a touch lectern, a laptop whose deck does not have focus. They fade out
   with the pointer so they are not projected onto a still slide. */
.present-nav{display:none;position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:21;gap:10px}
body.presenting .present-nav{display:flex;opacity:0;pointer-events:none;transition:opacity .3s ease}
body.presenting.present-active .present-nav{opacity:1;pointer-events:auto}
.present-nav button{width:44px;height:44px;padding:0;font:inherit;font-size:17px;line-height:1;color:#f3f5f7;background:rgba(11,11,11,.58);border:1px solid rgba(255,255,255,.28);border-radius:50%;cursor:pointer}
.present-nav button:hover{background:rgba(11,11,11,.80)}
.present-nav button[disabled]{opacity:.35;cursor:default}

/* Overview (O): the whole deck as a grid. The slides are already all in the
   document at a fixed geometry, so this is a grid plus a rescale — FIT_SCRIPT
   derives the scale from each frame's clientWidth and needs only a resize.
   The .present-current rule below is written at a higher specificity than the
   fixed-position one above ON PURPOSE: at equal specificity the source order
   would decide, and a half-reset leaves one slide pinned over the grid. */
body.presenting.present-overview{overflow:auto}
body.presenting.present-overview .deck{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;padding:14px}
/* position:relative, NOT static: .slide is absolutely positioned inside its
   frame (baseCss), so a static frame stops being its containing block and all
   the slides pile up at the top-left of the page, leaving a grid of empty
   thumbnails. Found by screenshotting the grid, not by reading the CSS. */
body.presenting.present-overview .slide-frame{display:block;position:relative;left:auto;top:auto;width:auto;border:1px solid #2a2a2a;border-radius:4px;cursor:pointer;z-index:auto}
body.presenting.present-overview .slide-frame.present-current{position:relative;left:auto;top:auto;right:auto;bottom:auto;margin:0;width:auto;border:2px solid #${C.primary};z-index:auto}
body.presenting.present-overview .present-nav,body.presenting.present-overview .present-bar{display:none}
/* an animated slide shows every step in the grid: an overview whose job is to
   let you find a slide cannot show it as the blank it is before the first
   click. Same reasoning as the print rendering, and written at a higher
   specificity than the hiding rules of baseCss so it wins wherever they sit. */
body.presenting.present-overview .slide-frame [data-step]{visibility:visible}
body.presenting.present-overview .slide-frame [data-step][data-fx]{opacity:1;transform:none;clip-path:none;transition:none}

/* the presentation-mode chrome never prints (the print rendering of baseCss()
   stays identical; PRESENT_SCRIPT exits the mode before printing) */
@media print{.present-hint,.present-help,.present-nav,.present-bar{display:none}}`;
}

/** Scaling of the slides — the only piece of JS, optional (without it, the
 *  slides stay at 1280 px and the container crops them).
 *  A function (not a module constant): PAGE must be read AFTER applyTheme. */
const fitScript = () => `
(function(){
  var frames = Array.prototype.slice.call(document.querySelectorAll('.slide-frame'));
  function fit(){
    for (var i = 0; i < frames.length; i++){
      var f = frames[i];
      var s = f.clientWidth / ${PAGE.width};
      f.style.height = (${PAGE.height} * s) + 'px';
      f.firstElementChild.style.transform = 'scale(' + s + ')';
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(document.body);
  window.addEventListener('resize', fit);
  fit();
})();`;

/** Click-to-reveal on animated slides (data-anim-steps): each click shows the
 *  next step; a click after the last one resets. Without JS (or when
 *  printing), all the content is visible.
 *  Every animated slide exposes its state on the element —
 *  `frame.__anim = { total, shown, set(n) }` — consumed by presentScript() to
 *  drive the steps from the keyboard; the click behaviour is unchanged.
 *  A function by symmetry with fitScript()/presentScript() (nothing to
 *  interpolate). */
const animScript = () => `
(function(){
  var frames = document.querySelectorAll('.slide-frame[data-anim-steps]');
  for (var i = 0; i < frames.length; i++)(function(f){
    var total = Number(f.getAttribute('data-anim-steps'));
    var els = Array.prototype.slice.call(f.querySelectorAll('[data-step]'));
    var badge = document.createElement('div');
    badge.className = 'anim-count';
    f.appendChild(badge);
    var st = f.__anim = {
      total: total,
      shown: 0,
      set: function(n){
        st.shown = n < 0 ? 0 : n > total ? total : n;
        badge.textContent = st.shown + ' / ' + total;
        for (var k = 0; k < els.length; k++)
          els[k].classList.toggle('step-shown', Number(els[k].getAttribute('data-step')) < st.shown);
      }
    };
    f.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('a')) return; // clickable links
      // in presentation mode, no reset in front of an audience: after the last
      // step, the click does nothing (the arrow keys change slide)
      if (st.shown >= total && document.body.classList.contains('presenting')) return;
      st.set(st.shown < total ? st.shown + 1 : 0);
    });
    st.set(0);
  })(frames[i]);
})();`;

/** Standalone presenter mode — complete document only, never in fragment
 *  mode. Zero dependencies, designed for a .html opened over file:// by a
 *  double click (no request, no server). Shortcuts:
 *    P                  enter / exit (full screen if allowed — the mode also
 *                       works windowed if the browser refuses);
 *    → Space PgDn       next animation step, then next slide;
 *    ← PgUp             previous step, then previous slide;
 *    Home / End         first / last slide;
 *    N                  presenter view (2nd window);
 *    O                  overview: every slide as a grid, click to jump;
 *    Esc                one step out — the help, then the overview, then the
 *                       mode itself;  ?  help.
 *  A progress bar and two on-screen controls follow the pointer: the keyboard
 *  is not reachable from a tablet or a touch lectern.
 *  The presenter view is an about:blank filled in by document.write and driven
 *  by a direct window reference: over file:// the origin is opaque and
 *  BroadcastChannel is not reliable — the direct reference is the only robust
 *  channel locally. All the logic (the timer included) lives in the main
 *  window; the second one contains no script at all.
 *  A function (not a module constant): PAGE and COLORS must be read AFTER
 *  applyTheme. */
const presentScript = () => `
(function(){
  var W = ${PAGE.width}, H = ${PAGE.height};
  var frames = Array.prototype.slice.call(document.querySelectorAll('.slide-frame'));
  if (!frames.length) return;
  var current = 0;
  var presenting = false;
  var overview = false;                            // grid of every slide (O)
  var notesWin = null;                             // presenter view
  var timer = { acc: 0, from: 0, running: false }; // timer (state on the main side)
  var tick = null;

  // Notes: innerHTML of the <p> of the <details class="notes"> that follows
  // each slide (content already escaped by the renderer, reinjectable as is).
  var notes = [];
  for (var i = 0; i < frames.length; i++){
    var sib = frames[i].nextElementSibling;
    var ps = sib && sib.classList && sib.classList.contains('notes') ? sib.querySelectorAll('p') : [];
    var list = [];
    for (var k = 0; k < ps.length; k++) list.push(ps[k].innerHTML);
    notes.push(list);
  }

  // Animation state set by ANIM_SCRIPT (absent if the slide is not animated)
  function anim(n){ return frames[n].__anim || null; }

  // ------ discreet strip + help (?) -----------------------------------------
  var hint = document.createElement('div');
  hint.className = 'present-hint';
  document.body.appendChild(hint);
  var help = document.createElement('div');
  help.className = 'present-help';
  help.innerHTML = '<b>Shortcuts</b>' +
    '<div><kbd>P</kbd>enter / exit presentation mode</div>' +
    '<div><kbd>→</kbd><kbd>Space</kbd><kbd>PgDn</kbd>next step or slide</div>' +
    '<div><kbd>←</kbd><kbd>PgUp</kbd>previous step or slide</div>' +
    '<div><kbd>Home</kbd><kbd>End</kbd>first / last slide</div>' +
    '<div><kbd>N</kbd>presenter view (notes, timer)</div>' +
    '<div><kbd>O</kbd>overview of every slide</div>' +
    '<div><kbd>Esc</kbd>exit</div>';
  document.body.appendChild(help);
  help.addEventListener('click', function(){ help.classList.remove('open'); });

  // ------ progress bar + on-screen controls ---------------------------------
  var bar = document.createElement('div');
  bar.className = 'present-bar';
  var barFill = document.createElement('div');
  barFill.className = 'present-bar-fill';
  bar.appendChild(barFill);
  document.body.appendChild(bar);

  var nav = document.createElement('div');
  nav.className = 'present-nav';
  function navButton(label, glyph, fn){
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = glyph;
    // stopPropagation, or the click also reaches the document listener that
    // resynchronizes the presenter view and the reveal handler ANIM_SCRIPT
    // put on the slide — one tap would then advance two things
    b.addEventListener('click', function(e){ e.stopPropagation(); fn(); wake(); });
    nav.appendChild(b);
    return b;
  }
  var btnPrev = navButton('Previous slide', '&#8592;', function(){ prev(); });
  var btnNext = navButton('Next slide', '&#8594;', function(){ next(); });
  document.body.appendChild(nav);

  /** The controls follow the pointer: shown while it moves, gone after a
   *  pause — a still slide is projected without chrome on it. */
  var idle = null;
  function wake(){
    if (!presenting || overview) return;
    document.body.classList.add('present-active');
    if (idle) clearTimeout(idle);
    idle = setTimeout(function(){ document.body.classList.remove('present-active'); }, 2500);
  }
  document.addEventListener('mousemove', wake);
  document.addEventListener('touchstart', wake, { passive: true });

  function updateHint(){
    hint.textContent = presenting
      ? (current + 1) + ' / ' + frames.length + ' — N: notes · O: overview · Esc: exit · ?: help'
      : 'P: presentation mode · ?: help';
    barFill.style.width = ((current + 1) / frames.length * 100) + '%';
    // a step still to reveal is a "next" even on the last slide, and a step
    // already revealed is a "previous" even on the first
    var a = anim(current);
    btnPrev.disabled = current === 0 && !(a && a.shown > 0);
    btnNext.disabled = current === frames.length - 1 && !(a && a.shown < a.total);
  }
  updateHint();

  // ------ scaling of the current slide --------------------------------------
  function fitCurrent(){
    if (!presenting || overview) return; // the grid sizes its own cells
    var f = frames[current];
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    f.style.width = (W * s) + 'px';
    f.style.height = (H * s) + 'px';
    f.firstElementChild.style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fitCurrent);

  /** Most visible slide in the window (starting point of presentation mode). */
  function mostVisible(){
    var best = 0, max = -Infinity;
    for (var n = 0; n < frames.length; n++){
      var r = frames[n].getBoundingClientRect();
      var vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (vis > max){ max = vis; best = n; }
    }
    return best;
  }

  // ------ navigation: animation steps first, slides afterwards --------------
  function goTo(n, atEnd){
    if (n < 0 || n >= frames.length) return;
    frames[current].classList.remove('present-current');
    frames[current].style.width = '';
    current = n;
    var a = anim(n);
    if (a) a.set(atEnd ? a.total : 0); // going backwards: every step already revealed
    frames[n].classList.add('present-current');
    if (overview) frames[n].scrollIntoView({ block: 'nearest' }); // follow the selection
    fitCurrent(); updateHint(); sync();
  }
  // In the grid the arrows move the SELECTION: stepping through an animation
  // there would look like nothing at all, since the overview forces every step
  // visible — the press would be swallowed until the last step was spent.
  function next(){
    var a = overview ? null : anim(current);
    if (a && a.shown < a.total){ a.set(a.shown + 1); updateHint(); sync(); return; }
    goTo(current + 1, false);
  }
  function prev(){
    var a = overview ? null : anim(current);
    if (a && a.shown > 0){ a.set(a.shown - 1); updateHint(); sync(); return; }
    goTo(current - 1, true);
  }

  // ------ overview (O): the whole deck as a grid -----------------------------
  // Nothing is rebuilt: every slide is already in the document at a fixed
  // geometry, so the grid is CSS and FIT_SCRIPT rescales each thumbnail from
  // its new clientWidth — one resize event is the whole implementation.
  function overviewEnter(){
    if (!presenting || overview) return;
    overview = true;
    // fitCurrent() sized the current frame with INLINE width/height; inline
    // beats the grid's stylesheet, so one cell would keep the full-screen size
    frames[current].style.width = '';
    frames[current].style.height = '';
    document.body.classList.add('present-overview');
    document.body.classList.remove('present-active');
    window.dispatchEvent(new Event('resize'));
    frames[current].scrollIntoView({ block: 'center' });
    updateHint();
  }
  function overviewExit(n){
    if (!overview) return;
    overview = false;
    document.body.classList.remove('present-overview');
    if (n != null && n !== current) goTo(n, false);
    else { fitCurrent(); updateHint(); sync(); }
  }
  // capture phase: a slide clicked in the grid must NOT also reach the reveal
  // handler ANIM_SCRIPT put on it, which would advance a step on the way out
  document.addEventListener('click', function(e){
    if (!overview) return;
    var f = e.target.closest && e.target.closest('.slide-frame');
    if (!f) return;
    e.stopPropagation();
    overviewExit(frames.indexOf(f));
  }, true);

  // ------ entering / leaving the mode ---------------------------------------
  function enter(){
    if (presenting) return;
    presenting = true;
    document.body.classList.add('presenting');
    current = mostVisible();
    var a = anim(current);
    if (a) a.set(0);
    frames[current].classList.add('present-current');
    fitCurrent(); updateHint(); wake(); // the controls show themselves once, then fade
    // full screen if allowed — if refused, the mode stays windowed
    var p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(function(){});
  }
  function exit(){
    if (!presenting) return;
    presenting = false;
    overview = false;
    help.classList.remove('open');
    var f = frames[current];
    f.classList.remove('present-current');
    f.style.width = '';
    document.body.classList.remove('presenting');
    document.body.classList.remove('present-overview');
    document.body.classList.remove('present-active');
    closePresenter();
    if (document.fullscreenElement && document.exitFullscreen){
      var p = document.exitFullscreen();
      if (p && p.catch) p.catch(function(){});
    }
    window.dispatchEvent(new Event('resize')); // FIT_SCRIPT rescales the slides
    f.scrollIntoView({ block: 'center' });
    updateHint();
  }
  // Esc in full screen is absorbed by the browser: we follow the real state.
  // Exception: opening the presenter view (window.open) makes the browser
  // leave full screen — within the second that follows, we stay in windowed
  // presentation mode instead of tearing everything down.
  document.addEventListener('fullscreenchange', function(){
    if (presenting && !document.fullscreenElement && Date.now() - popupAt > 1000) exit();
  });
  window.addEventListener('beforeprint', function(){ exit(); }); // printing unchanged

  // ------ presenter view (2nd window, no embedded script) -------------------
  var PRES_CSS = 'html,body{height:100%;overflow:hidden}' +
    'body{margin:0;display:flex;flex-direction:column;background:#0b0b0b;color:#e9ecef}' +
    '.p-top{flex:none;display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #2a2a2a}' +
    '#t-timer{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;color:#8a8f98;cursor:pointer}' +
    '#t-timer.run{color:#e9ecef}' +
    '#t-reset{font:inherit;font-size:14px;color:#8a8f98;background:none;border:1px solid #2a2a2a;border-radius:4px;padding:2px 10px;cursor:pointer}' +
    '#t-count{margin-left:auto;font-size:14px;color:#8a8f98;font-variant-numeric:tabular-nums}' +
    // wall clock: the elapsed timer says how long you have been talking, this
    // says whether you are late — a room books the second, not the first
    '#t-clock{font-size:14px;color:#8a8f98;font-variant-numeric:tabular-nums}' +
    '.p-cols{flex:1;min-height:0;display:flex;gap:16px;padding:16px}' +
    '.p-main{flex:3;min-width:0}' +
    '.p-side{flex:2;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px}' +
    // the cloned slides inherit their ink from body (baseCss): restore it —
    // background and ink from the design tokens, no hard-coded white (dark theme)
    '.p-frame{position:relative;overflow:hidden;background:#${COLORS.ground};border-radius:4px;color:#${COLORS.neutralPrimary}}' +
    '.p-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a8f98}' +
    '.p-notes{flex:1;min-height:0;overflow:auto;font-size:22px;line-height:1.5}' +
    '.p-notes p{margin:0 0 12px}' +
    '.p-notes .p-empty{color:#8a8f98;font-style:italic}' +
    '#p-cur [data-step]{visibility:hidden}' +          // the current slide follows
    '#p-cur [data-step].step-shown{visibility:visible}'; // the step state; the next one shows everything
  var PRES_BODY = '<div class="p-top">' +
    '<span id="t-timer" title="Start / pause">00:00</span>' +
    '<button id="t-reset" type="button" title="Reset">reset</button>' +
    '<span id="t-count"></span><span id="t-clock"></span></div>' +
    '<div class="p-cols"><div class="p-main"><div class="p-frame" id="p-cur"></div></div>' +
    '<div class="p-side"><div class="p-label">Next slide</div><div class="p-frame" id="p-next"></div>' +
    '<div class="p-label">Notes</div><div class="p-notes" id="p-notes"></div></div></div>';

  var popupAt = 0; // timestamp of the last window.open (guards fullscreenchange)
  function presOpen(){ return notesWin && !notesWin.closed; }
  function openPresenter(){
    if (presOpen()){ notesWin.focus(); sync(); return; }
    popupAt = Date.now();
    var w = window.open('', 'lutrinPresenter', 'width=1100,height=680');
    if (!w){ // window blocked: presentation mode stays usable, but say so
      hint.textContent = 'Window blocked — allow pop-ups to get the presenter view';
      return;
    }
    notesWin = w;
    var doc = w.document;
    doc.open();
    // the deck's stylesheet (fonts included) is reused as is
    // NB: the body tags are split so that their closing literal stays unique
    // in the generated document — lutrin preview injects its SSE client
    // before the LAST occurrence (a contract tested by html.test)
    doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Presenter view</title><style>' +
      document.querySelector('style').textContent + PRES_CSS +
      '</style></head><bo' + 'dy>' + PRES_BODY + '</bo' + 'dy></html>');
    doc.close();
    doc.getElementById('t-timer').onclick = toggleTimer;
    doc.getElementById('t-reset').onclick = resetTimer;
    doc.onkeydown = presenterKeys;
    w.addEventListener('resize', fitPanes);
    if (!tick) tick = setInterval(tickTimer, 500);
    tickTimer(); // the timer and the clock are filled in before the first tick
    sync();
  }
  function closePresenter(){
    if (presOpen()) notesWin.close();
    notesWin = null;
    if (tick){ clearInterval(tick); tick = null; }
  }
  window.addEventListener('beforeunload', closePresenter);

  function fitPane(pane, maxH){
    var slide = pane.firstElementChild;
    if (!slide){ pane.style.width = ''; pane.style.height = '0'; return; }
    var s = Math.min(pane.parentNode.clientWidth / W, (maxH || H) / H);
    pane.style.width = (W * s) + 'px';
    pane.style.height = (H * s) + 'px';
    slide.style.transform = 'scale(' + s + ')';
  }
  function fitPanes(){
    if (!presOpen()) return;
    var doc = notesWin.document;
    var main = doc.querySelector('.p-main');
    fitPane(doc.getElementById('p-cur'), main ? main.clientHeight : H);
    fitPane(doc.getElementById('p-next'), notesWin.innerHeight * 0.3);
  }
  /** Pushes the current state to the presenter view (direct reference). */
  function sync(){
    if (!presOpen()) return;
    var doc = notesWin.document;
    var a = anim(current);
    doc.getElementById('t-count').textContent = (current + 1) + ' / ' + frames.length +
      (a ? ' — step ' + a.shown + '/' + a.total : '');
    doc.getElementById('p-cur').innerHTML = frames[current].firstElementChild.outerHTML;
    doc.getElementById('p-next').innerHTML =
      current + 1 < frames.length ? frames[current + 1].firstElementChild.outerHTML : '';
    var list = notes[current];
    doc.getElementById('p-notes').innerHTML = list.length
      ? '<p>' + list.join('</p><p>') + '</p>'
      : '<p class="p-empty">No notes for this slide.</p>';
    fitPanes();
  }

  // ------ timer (click: start / pause; button: reset) -----------------------
  function timerText(){
    var s = Math.floor((timer.acc + (timer.running ? Date.now() - timer.from : 0)) / 1000);
    var two = function(x){ return (x < 10 ? '0' : '') + x; };
    var h = Math.floor(s / 3600);
    return (h ? h + ':' : '') + two(Math.floor(s / 60) % 60) + ':' + two(s % 60);
  }
  function tickTimer(){
    if (!presOpen()){ // window closed by hand: the interval cleans itself up
      if (tick){ clearInterval(tick); tick = null; }
      return;
    }
    var el = notesWin.document.getElementById('t-timer');
    if (el){ el.textContent = timerText(); el.className = timer.running ? 'run' : ''; }
    // no seconds: a wall clock that ticks steals the eye the notes need
    var clock = notesWin.document.getElementById('t-clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function toggleTimer(){
    if (timer.running){ timer.acc += Date.now() - timer.from; timer.running = false; }
    else { timer.from = Date.now(); timer.running = true; }
    tickTimer();
  }
  function resetTimer(){ timer.acc = 0; timer.from = Date.now(); tickTimer(); }

  // ------ keyboard (same keys in both windows) ------------------------------
  function navKey(e){
    var k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown'){ next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp'){ prev(); }
    else if (k === 'Home'){ goTo(0, false); }
    else if (k === 'End'){ goTo(frames.length - 1, false); }
    else return false;
    e.preventDefault();
    return true;
  }
  function presenterKeys(e){
    if (navKey(e)) return;
    if (e.key === 'Escape') notesWin.close();
  }
  document.addEventListener('keydown', function(e){
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key;
    if (k === '?'){ help.classList.toggle('open'); e.preventDefault(); return; }
    if (k === 'p' || k === 'P'){ presenting ? exit() : enter(); e.preventDefault(); return; }
    if (!presenting) return; // in scrolling mode, the browser keeps its keys
    if (k === 'Escape'){
      // one step out at a time: the help, then the grid, then the mode itself
      if (help.classList.contains('open')) help.classList.remove('open');
      else if (overview) overviewExit(null);
      else exit();
      return;
    }
    if (k === 'n' || k === 'N'){ openPresenter(); e.preventDefault(); return; }
    if (k === 'o' || k === 'O'){ overview ? overviewExit(null) : overviewEnter(); e.preventDefault(); return; }
    if (overview && k === 'Enter'){ overviewExit(null); e.preventDefault(); return; }
    navKey(e);
  });
  // a click on an animated slide (ANIM_SCRIPT) changes the step: resynchronize
  document.addEventListener('click', function(){
    if (presenting) setTimeout(sync, 0);
  });
})();`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Shared core: renders each scene as an HTML fragment (`<div
 * class="slide-frame">…` followed by the notes). Consumed by the complete
 * document (renderDeckHtml) and by the fragment mode of compileHtml (VS Code
 * webview, slide-by-slide update).
 *
 * @returns {Promise<{slides: string[], stats: object}>}
 */
async function renderSlideFragments(scenes, meta, baseDir, opts = {}) {
  const vendor = vendorRemoteAssets(meta, opts.vendor);
  // ------ pre-pass: everything that requires asynchronous work --------------
  const allBlocks = scenes.flatMap((sc) => [
    ...sc.elements.map((e) => e.block),
    ...(sc.image ? [sc.image] : []), // image of the hero layout, outside the elements
  ]);
  const ofType = (t) => allBlocks.filter((b) => b.type === t);

  // Mermaid diagrams → inline SVG (persistent cache, unique identifiers)
  const mermaidBlocks = ofType('mermaid');
  const mermaid = new Map();
  mermaidBlocks.forEach((b, k) => {
    const file = renderMermaidCached(b.source, { format: 'svg', baseDir });
    if (file)
      mermaid.set(b, uniquifySvgIds(sanitizeSvg(fs.readFileSync(file, 'utf8')), `mmd-${k}`));
  });

  // Remote images → user cache (or assets/remote/ if the deck vendors them),
  // then data URI: the HTML document stays standalone in both cases
  const remote = new Map();
  const remoteUrls = [
    ...new Set(
      ofType('image')
        .map((b) => b.src)
        .filter((s) => /^https?:/.test(s)),
    ),
  ];
  await Promise.all(
    remoteUrls.map(async (url) => {
      const local = await fetchRemoteImage(url, baseDir, { vendor });
      if (local) remote.set(url, local);
    }),
  );

  // Lucide icons → recolored inline SVG
  const icons = new Map();
  await Promise.all(
    ofType('icon').map(async (b) => {
      const svg = await iconSvg(b.name, { color: b.color });
      if (svg) icons.set(b, svg);
    }),
  );

  // LaTeX equations → inline MathJax SVG
  const math = new Map();
  await Promise.all(
    ofType('math').map(async (b) => {
      const m = await mathSvg(b.source);
      if (m) math.set(b, m);
    }),
  );

  // trust roots for local images: the deck's directory, plus the project
  // roots declared by the host (containment — assets.mjs)
  const imageRoots = [baseDir, ...(opts.imageRoots ?? [])];
  const ctx = { baseDir, imageRoots, mermaid, remote, icons, math };
  const footerText = meta.footer ?? meta.title ?? '';
  // resolved ONCE per deck, not per slide: reading the licence is cheap, but the
  // mention must be identical on all the slides of one compilation — a licence
  // expiring mid-render would otherwise brand half the deck
  const brand = brandMention(opts);

  const slides = scenes.map((scene, k) => {
    let body;
    let masterCls;
    if (scene.master === 'cover') {
      masterCls = 'master-cover';
      body = coverHtml(scene, brand);
    } else if (scene.master === 'section') {
      masterCls = 'master-section';
      body = sectionHtml(scene, brand);
    } else {
      masterCls = scene.master === 'hero' ? 'master-hero' : 'master-content';
      body = contentHtml(scene, k + 1, footerText, ctx, brand);
    }
    const notes = scene.notes?.length
      ? `<details class="notes"><summary>Notes</summary><p>${scene.notes.map(esc).join('</p><p>')}</p></details>`
      : '';
    const anim = scene.animSteps ? ` data-anim-steps="${scene.animSteps}"` : '';
    // role="group" + aria-roledescription (APG carousel pattern): role="img"
    // would hide all the real content — links, tables — from screen readers
    const label = `Slide ${k + 1} of ${scenes.length}${scene.title ? ` — ${scene.title}` : ''}`;
    return (
      `<div class="slide-frame" id="slide-${k + 1}" data-slide="${k + 1}" data-layout="${esc(scene.layout)}"${anim}>` +
      `<div class="slide ${masterCls}" role="group" aria-roledescription="slide" aria-label="${esc(label)}">\n${body}\n</div></div>${notes}`
    );
  });

  return {
    slides,
    stats: {
      slideCount: scenes.length,
      // `kit:` aliases no theme declared (the slide keeps a placeholder);
      // the caller appends its own (theme fallbacks, etc.)
      warnings: kitImageWarnings(allBlocks),
      fontsEmbedded: fontFacesCss().count,
      animatedSlides: scenes.filter((s) => s.animSteps).length,
      mermaidRendered: mermaid.size,
      mermaidTotal: mermaidBlocks.length,
      remoteFetched: remote.size,
      remoteTotal: remoteUrls.length,
      remoteVendored: vendor,
      iconsRendered: icons.size,
      iconsTotal: ofType('icon').length,
      mathRendered: math.size,
      mathTotal: ofType('math').length,
    },
  };
}

/**
 * @param {Array}  scenes  scenes produced by buildScenes()
 * @param {object} meta    frontmatter of the deck
 * @param {string} baseDir directory of the source file (image resolution)
 * @param {object} [opts] `vendor` forces remote images to be copied into the
 *                        project (CLI flag; otherwise frontmatter `assets:`)
 * @returns {Promise<{html: string, stats: object}>}
 */
export async function renderDeckHtml(scenes, meta, baseDir, opts = {}) {
  const { slides, stats } = await renderSlideFragments(scenes, meta, baseDir, opts);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title ?? scenes[0]?.title ?? 'Presentation')}</title>
<style>
${fontFacesCss().css}
${baseCss()}
${pageCss()}
${presentCss()}
</style>
</head>
<body>
<main class="deck">
${slides.join('\n')}
</main>
<script>${fitScript()}</script>
${scenes.some((s) => s.animSteps) ? `<script>${animScript()}</script>` : ''}
<script>${presentScript()}</script>
</body>
</html>
`;

  return { html, stats };
}

/**
 * Convenience for a programmatic host (VS Code plugin, tests): Markdown (DSL)
 * → standalone HTML document, in a single call.
 *
 * `fragment: true` (webview): instead of the complete document, returns
 * `{ slides, css, fontsCss, … }` — one standalone fragment per slide, the
 * stylesheet returned separately, and NO script (the host provides fit/animations; HTML
 * injected through innerHTML would not run its <script> anyway).
 *
 * `kitData: { theme?, layouts? }` (in-memory kit overlay — a kit editor
 * previewing an UNSAVED state): the kit is still resolved from
 * themePath/frontmatter as usual, kitData only replaces the CONTENT read from
 * its disk — see prepareDeckContext. Leaves no trace: the next compileHtml
 * without it reads the disk again.
 */
export async function compileHtml(
  source,
  {
    baseDir = process.cwd(),
    fragment = false,
    themePath = null,
    defaultTheme = null,
    vendor = undefined,
    imageRoots = [],
    kitData = null,
  } = {},
) {
  const deck = parseDeck(source);
  // theme + user layouts of the deck — BEFORE buildScenes (the geometry of the
  // scenes depends on the design tokens)
  const prep = prepareDeckContext(deck.meta, { baseDir, themePath, defaultTheme, kitData });
  const scenes = buildScenes(deck);
  if (fragment) {
    const { slides, stats } = await renderSlideFragments(scenes, deck.meta, baseDir, {
      vendor,
      imageRoots,
    });
    stats.warnings.push(...prep.diagnostics.map((d) => d.message));
    return {
      slides,
      css: baseCss(),
      fontsCss: fontFacesCss().css,
      stats,
      scenes,
      deck,
      meta: deck.meta,
      themeFile: prep.themeFile,
    };
  }
  const { html, stats } = await renderDeckHtml(scenes, deck.meta, baseDir, { vendor, imageRoots });
  stats.warnings.push(...prep.diagnostics.map((d) => d.message));
  return { html, stats, scenes, deck, meta: deck.meta, themeFile: prep.themeFile };
}
