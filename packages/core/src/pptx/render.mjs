/**
 * PowerPoint renderer: scenes → .pptx via PptxGenJS.
 *
 * All the geometry comes from the layout engine; here we only translate
 * placed elements into PptxGenJS calls, applying the design tokens of the
 * active theme (see tokens.mjs):
 *   - `primary` = the only accent;
 *   - flat system: hairline rules and recessed fills, no shadows;
 *   - titles bold 700 in neutral-primary; theme fonts embedded in the
 *     .pptx when it provides them (fonts.mjs) — fallback on the installed
 *     font in viewers that ignore embedded fonts (Keynote, LibreOffice).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {
  CHROME,
  COLORS,
  FONTS,
  LOGOS,
  TYPE,
  SPACE,
  PAGE,
  SEMANTIC,
  TREND_INK,
  panelStyle,
  px,
  LINE_HEIGHT,
} from '../deck/tokens.mjs';
import { ALERT_BLOCK_TYPES, runsToText } from '../deck/parse.mjs';
import {
  fetchRemoteImage,
  imageDims,
  renderIcon,
  renderMath,
  renderMermaidCached,
  rasterAvailable,
  resolveLocalImage,
  svgToPng,
  vendorRemoteAssets,
  writeTmpPng,
} from '../deck/assets.mjs';
import { chartSvg } from '../deck/chart.mjs';
import { highlightLine } from '../deck/highlight.mjs';
import { embedFonts } from './fonts.mjs';
import { embedAnimations } from './anim.mjs';
import { embedMorph } from './morph.mjs';

/** addImage options for a logo at an imposed height, width at its native ratio
 *  (the paths come from LOGOS — themable, so the ratio is never presumed).
 *  Dimensions that could not be read → null: better to omit the logo than to
 *  stretch it to an invented ratio. */
function logoImage(file, h, x, y) {
  const dims = imageDims(file);
  if (!dims?.w || !dims?.h) return null;
  // altText is mandatory: without it, the path of the kit's logo — absolute
  // after resolveTheme() — lands in the `descr` of the .pptx (see altOf)
  return {
    path: file,
    altText: 'Logo',
    objectName: 'Logo',
    x: px(x),
    y: px(y),
    h: px(h),
    w: px(h * (dims.w / dims.h)),
  };
}

// ---------------------------------------------------------------------------
// Text: IR runs → PptxGenJS runs
// ---------------------------------------------------------------------------

function toRuns(runs, base = {}) {
  return runs.map((r) => ({
    text: r.text,
    options: {
      bold: r.bold || base.bold || false,
      italic: r.italic || base.italic || false,
      fontFace: r.code ? FONTS.mono : (base.fontFace ?? FONTS.body),
      color: r.code ? COLORS.primaryDarker : (base.color ?? COLORS.neutralPrimary),
      ...(r.link ? { hyperlink: { url: r.link } } : {}),
    },
  }));
}

// ---------------------------------------------------------------------------
// Images: "contain" framing (native dimensions: imageDims, assets.mjs)
// ---------------------------------------------------------------------------

/**
 * Alt text for an image, for the `descr` attribute of the OOXML.
 *
 * PptxGenJS, when it is given no `altText`, copies the PATH of the file into
 * `descr` — that is to say the author's local directory tree, username
 * included, embedded in a deliverable that goes out by email. Every image
 * written here therefore goes through this function, and it never returns an
 * empty string (an empty string would trigger the PptxGenJS fallback again).
 *
 * With no alt, we fall back on the FILE NAME alone: `![](/Users/firstname/
 * Desktop/x.png)` is a commonplace way of inserting an image, and the path it
 * carries has no more business leaking than the one we resolved. The file
 * name, on the other hand, stays useful — it is what lets one recognize the
 * image in PowerPoint's accessibility pane.
 */
function altOf(alt, src = '') {
  const text = (alt ?? '').trim();
  if (text) return text;
  // query string dropped (remote image), then DECODE BEFORE SPLIT: a path can
  // arrive already percent-encoded (a copy-pasted file URL, a drag-and-drop
  // from some browsers), and it then contains no literal `/` to split on —
  // splitting first would put the whole path, the author's directories
  // included, into a deliverable that circulates.
  const bare = String(src).split(/[?#]/)[0];
  let plain;
  try {
    plain = decodeURIComponent(bare);
  } catch {
    plain = bare; // invalid % sequence: the raw name is authoritative
  }
  const clean = plain.replace(/[\\/]+$/, '');
  const base = clean.slice(clean.search(/[^\\/]*$/));
  return base || 'Image';
}

/** "contain" box: the image fits inside the region, ratio preserved, centered.
 *  PptxGenJS does not read native dimensions — we impose them ourselves,
 *  otherwise the visual is stretched to the proportions of the slot. */
function containRect(dims, r) {
  if (!dims || !dims.w || !dims.h) return r;
  const scale = Math.min(r.w / dims.w, r.h / dims.h);
  const w = dims.w * scale;
  const h = dims.h * scale;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function addPara(slide, block, r) {
  slide.addText(toRuns(block.runs, { color: block.color }), {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: TYPE.body,
    fontFace: FONTS.body,
    color: block.color ?? COLORS.neutralPrimary,
    align: 'left',
    valign: 'top',
    // exact points, never a multiple: OOXML's spcPct multiplies the FONT'S
    // own line metrics, so a kit font with tall ascenders rendered ~20%
    // taller than blockHeight() measured and crowded whatever followed.
    // spcPts pins the pitch to what the layout engine and the HTML (.para
    // line-height 1.4) both assume, whatever font the kit ships.
    lineSpacing: TYPE.body * LINE_HEIGHT,
  });
}

function addHeading(slide, block, r) {
  // `size` (pt) and `align`: key message of the focus layout — otherwise a slot title
  slide.addText(toRuns(block.runs, { bold: true, color: block.color }), {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: block.size ?? TYPE.sectionHeading,
    fontFace: FONTS.body,
    color: block.color ?? COLORS.neutralPrimary,
    bold: true,
    valign: 'top',
    ...(block.align ? { align: block.align } : {}),
    // multi-line message: same line height as the CSS .slot-heading (1.3),
    // in exact points (spcPts) — see addPara on why never a multiple
    ...(block.size ? { lineSpacing: block.size * 1.3 } : {}),
  });
}

function addBullets(slide, block, r) {
  const runs = [];
  // `startAt`: a chunk of a numbered list split by pagination. In OOXML,
  // `buAutoNum/@startAt` RESTARTS the counter at the paragraph that carries
  // it: it only goes on the first top-level item, otherwise all the following
  // bullets would resume at the same rank.
  let rankToPlace = block.ordered && block.startAt > 1 ? block.startAt : 0;
  block.items.forEach((it) => {
    // A bullet whose only content is an image has NO run: the parser keeps
    // only the text of a list item. With no support on which to place the
    // marker, the formatting of the bullet used to collapse — and with it the
    // whole export. We keep the empty line rather than skipping it: it exists
    // in the HTML (an empty <li>) and the layout engine has already reserved
    // its height — spiriting it away would shift everything that follows.
    const itemRuns = toRuns(it.runs, { color: block.color });
    if (!itemRuns.length) {
      itemRuns.push({
        text: '',
        options: { fontFace: FONTS.body, color: block.color ?? COLORS.neutralPrimary },
      });
    }
    if (it.level) {
      // nested items: same size and pitch as the HTML (.bullets ul ul)
      itemRuns.forEach((run) => {
        run.options.fontSize = TYPE.bulletNested;
      });
      itemRuns[0].options.lineSpacing = TYPE.bulletNested * 1.3;
    }
    itemRuns[0] = {
      ...itemRuns[0],
      options: {
        ...itemRuns[0].options,
        bullet: block.ordered
          ? {
              type: 'number',
              indent: 16,
              ...(rankToPlace && !it.level ? { startAt: rankToPlace } : {}),
            }
          : { code: '2022', indent: 16 },
        indentLevel: it.level,
        breakLine: false,
      },
    };
    if (!it.level) rankToPlace = 0;
    itemRuns[itemRuns.length - 1].options.breakLine = true;
    runs.push(...itemRuns);
  });
  slide.addText(runs, {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: TYPE.bullet,
    fontFace: FONTS.body,
    color: block.color ?? COLORS.neutralPrimary,
    valign: 'top',
    // exact pitch and gap of the HTML (.bullets: line-height 1.3, li
    // margin-bottom 6px) — spcPts + 4.5 pt (= 6 px); see addPara
    lineSpacing: TYPE.bullet * 1.3,
    paraSpaceAfter: 4.5,
  });
}

function addCode(slide, block, r) {
  slide.addShape('roundRect', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fill: { color: COLORS.underground1 },
    line: { color: COLORS.neutralStroke, width: 0.75 },
    rectRadius: px(8),
  });
  const lines = block.source.split('\n');
  const runs = lines.flatMap((line, k) => {
    const hl = highlightLine(line, block.lang).map((seg) => ({
      text: seg.text,
      options: {
        fontFace: FONTS.mono,
        color: seg.color ?? COLORS.neutralPrimary,
        bold: seg.bold ?? false,
        italic: seg.italic ?? false,
        breakLine: false,
      },
    }));
    hl[hl.length - 1].options.breakLine = true;
    return hl;
  });
  slide.addText(runs, {
    x: px(r.x + SPACE.sm),
    y: px(r.y + SPACE.xs),
    w: px(r.w - 2 * SPACE.sm),
    h: px(r.h - 2 * SPACE.xs),
    fontSize: TYPE.code,
    valign: 'top',
    // exact pitch of the HTML (.code line-height 1.3); see addPara
    lineSpacing: TYPE.code * 1.3,
  });
}

function addTable(slide, block, r) {
  const border = [
    { type: 'none' },
    { type: 'none' },
    { pt: 0.75, color: COLORS.neutralStroke },
    { type: 'none' },
  ];
  const headerRow = block.header.map((cell) => ({
    text: toRuns(cell, { bold: true }),
    options: {
      bold: true,
      fill: { color: COLORS.underground1 },
      border,
      color: COLORS.neutralPrimary,
    },
  }));
  const bodyRows = block.rows.map((row) =>
    row.map((cell) => ({ text: toRuns(cell), options: { border, color: COLORS.neutralPrimary } })),
  );
  slide.addTable([...(headerRow.length ? [headerRow] : []), ...bodyRows], {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    fontSize: TYPE.tableBody,
    fontFace: FONTS.body,
    valign: 'middle',
    margin: 6,
    autoPage: false,
  });
}

function addAlert(slide, block, r) {
  const sem = SEMANTIC[block.kind] ?? SEMANTIC.info;
  slide.addShape('roundRect', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fill: { color: sem.fill },
    line: { type: 'none' },
    rectRadius: px(4),
  });
  const runs = [
    {
      text: sem.label,
      options: {
        bold: true,
        fontSize: TYPE.small,
        color: sem.text,
        breakLine: true,
        lineSpacing: TYPE.small * 1.3,
      },
    },
  ];
  // outside ALERT_BLOCK_TYPES: ignored (height not reserved by blockHeight,
  // reported to the author by the ALERT_CONTENT_DROPPED diagnostic)
  for (const b of block.blocks) {
    if (!ALERT_BLOCK_TYPES.has(b.type)) continue;
    if (b.type === 'para') {
      const rr = toRuns(b.runs, { color: sem.text });
      rr[rr.length - 1].options.breakLine = true;
      runs.push(...rr);
    } else if (b.type === 'bullets') {
      for (const it of b.items) {
        const rr = toRuns(it.runs, { color: sem.text });
        rr[0].options.bullet = { code: '2022', indent: 12 };
        rr[rr.length - 1].options.breakLine = true;
        runs.push(...rr);
      }
    }
  }
  slide.addText(runs, {
    x: px(r.x + SPACE.sm),
    y: px(r.y + SPACE.xs),
    w: px(r.w - 2 * SPACE.sm),
    h: px(r.h - 2 * SPACE.xs),
    fontSize: TYPE.body,
    fontFace: FONTS.body,
    valign: 'top',
    // exact pitch of the HTML (.alert line-height 1.3); the label paragraph
    // carries its own smaller pitch in its run options — see addPara
    lineSpacing: TYPE.body * 1.3,
  });
}

/** Canonical arrow of the trend (the glyph that was typed is not kept). */
const TREND_GLYPH = { up: '↑', down: '↓', flat: '→' };

function addMetric(slide, block, r) {
  slide.addShape('roundRect', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fill: { color: COLORS.ground },
    line: { color: COLORS.neutralStroke, width: 1 },
    rectRadius: px(8),
  });
  // with a trend, the card tightens up to make room for it
  const t = block.trend;
  slide.addText(block.value, {
    x: px(r.x),
    y: px(r.y + (t ? SPACE.xs : SPACE.sm)),
    w: px(r.w),
    h: px(r.h * (t ? 0.48 : 0.55)),
    fontSize: TYPE.metricValue,
    bold: true,
    color: COLORS.primary,
    fontFace: FONTS.body,
    align: 'center',
    valign: 'middle',
    fit: 'shrink',
  });
  slide.addText(block.label, {
    x: px(r.x + SPACE.xs),
    y: px(r.y + r.h * (t ? 0.54 : 0.62)),
    w: px(r.w - 2 * SPACE.xs),
    h: px(r.h * (t ? 0.22 : 0.3)),
    fontSize: TYPE.metricLabel,
    color: COLORS.neutralSecondary,
    fontFace: FONTS.body,
    align: 'center',
    valign: 'top',
  });
  if (t) {
    slide.addText(`${TREND_GLYPH[t.dir]} ${t.text}`.trim(), {
      x: px(r.x + SPACE.xs),
      y: px(r.y + r.h * 0.76),
      w: px(r.w - 2 * SPACE.xs),
      h: px(r.h * 0.18),
      fontSize: TYPE.small,
      bold: true,
      color: TREND_INK[t.sentiment],
      fontFace: FONTS.body,
      align: 'center',
      valign: 'middle',
    });
  }
}

// ---------------------------------------------------------------------------
// Blocks synthesized by the structured layouts (comparison, pillars,
// timeline, layers, swot) — never produced directly by the DSL
// ---------------------------------------------------------------------------

function addPanel(slide, block, r) {
  const style = panelStyle(block);
  slide.addShape('roundRect', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fill: { color: style.fill },
    line: style.line ? { color: style.line.color, width: style.line.width } : { type: 'none' },
    rectRadius: px(
      block.variant === 'accent'
        ? 2
        : block.variant === 'layer' || block.variant === 'semantic'
          ? 4
          : 8,
    ),
  });
  if (block.variant === 'pillar' && block.accent !== false) {
    // accent at the head of the pillar — the only use of green in the panel
    slide.addShape('rect', {
      x: px(r.x + SPACE.xs),
      y: px(r.y),
      w: px(r.w - 2 * SPACE.xs),
      h: px(4),
      fill: { color: COLORS.primary },
      line: { type: 'none' },
    });
  }
}

function addTimelineAxis(slide, block, r) {
  const arrow = block.arrow !== false;
  if (block.vertical) {
    // vertical axis (roadmap in a column): time runs downwards
    slide.addShape('rect', {
      x: px(r.x),
      y: px(r.y),
      w: px(r.w),
      h: px(r.h - (arrow ? 14 : 0)),
      fill: { color: COLORS.neutralStroke },
      line: { type: 'none' },
    });
    if (arrow) {
      slide.addShape('triangle', {
        x: px(r.x + r.w / 2 - 7),
        y: px(r.y + r.h - 14),
        w: px(14),
        h: px(14),
        fill: { color: COLORS.neutralStroke },
        line: { type: 'none' },
        rotate: 180,
      });
    }
    return;
  }
  slide.addShape('rect', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w - (arrow ? 14 : 0)),
    h: px(r.h),
    fill: { color: COLORS.neutralStroke },
    line: { type: 'none' },
  });
  if (arrow) {
    // arrowhead: time flows towards the right
    slide.addShape('triangle', {
      x: px(r.x + r.w - 14),
      y: px(r.y + r.h / 2 - 7),
      w: px(14),
      h: px(14),
      fill: { color: COLORS.neutralStroke },
      line: { type: 'none' },
      rotate: 90,
    });
  }
}

function addTimelineDot(slide, block, r) {
  slide.addShape('ellipse', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fill: { color: COLORS.primary },
    line: { color: COLORS.ground, width: 2 },
  });
  if (block.numbered === false) return; // solid dot, with no number
  slide.addText(String(block.index), {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: TYPE.metricLabel,
    bold: true,
    color: COLORS.ground,
    fontFace: FONTS.body,
    align: 'center',
    valign: 'middle',
  });
}

function addQuote(slide, block, r) {
  slide.addText('“', {
    x: px(r.x),
    y: px(r.y),
    w: px(80),
    h: px(96),
    fontSize: 72,
    bold: true,
    color: COLORS.primary,
    fontFace: FONTS.body,
  });
  slide.addText(toRuns(block.runs, { italic: true }), {
    x: px(r.x + 96),
    y: px(r.y),
    w: px(r.w - 128),
    h: px(r.h - 64),
    fontSize: TYPE.quote,
    italic: true,
    color: COLORS.neutralPrimary,
    fontFace: FONTS.body,
    valign: 'middle',
    // exact pitch of the HTML (.quote blockquote line-height 1.4); see addPara
    lineSpacing: TYPE.quote * LINE_HEIGHT,
  });
  if (block.cite) {
    slide.addText(`— ${block.cite}`, {
      x: px(r.x + 96),
      y: px(r.y + r.h - 56),
      w: px(r.w - 128),
      h: px(40),
      fontSize: TYPE.body,
      color: COLORS.neutralSecondary,
      fontFace: FONTS.body,
      align: 'right',
    });
  }
}

function addImage(slide, block, r, ctx) {
  const src = /^https?:/.test(block.src)
    ? (ctx.remote.get(block.src) ?? null) // local copy downloaded in the pre-pass
    : resolveLocalImage(ctx.imageRoots, block.src);
  const alt = altOf(block.alt, block.src);
  if (src && fs.existsSync(src)) {
    const fit =
      block.role === 'background' || block.role === 'cover' ? r : containRect(imageDims(src), r);
    slide.addImage({
      path: src,
      altText: alt,
      x: px(fit.x),
      y: px(fit.y),
      w: px(fit.w),
      h: px(fit.h),
    });
    return;
  }
  // not found or remote: a placeholder, never a broken slide
  slide.addShape('roundRect', {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fill: { color: COLORS.underground1 },
    line: { color: COLORS.neutralStroke, width: 0.75, dashType: 'dash' },
    rectRadius: px(8),
  });
  // same rule for the placeholder: that text is VISIBLE on the slide, an
  // absolute path there would be a leak in full view
  slide.addText(`[image: ${alt}]`, {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: TYPE.small,
    color: COLORS.neutralSecondary,
    fontFace: FONTS.body,
    align: 'center',
    valign: 'middle',
  });
}

function addMermaid(slide, block, r, ctx) {
  const png = ctx.mermaid.get(block);
  if (png) {
    const fit = containRect(imageDims(png), r);
    // the PNG comes from the user cache (~/…): altText mandatory (altOf)
    slide.addImage({
      path: png,
      altText: 'Mermaid diagram',
      x: px(fit.x),
      y: px(fit.y),
      w: px(fit.w),
      h: px(fit.h),
    });
    return;
  }
  // faithful fallback: source shown as a code block plus a caption
  addCode(slide, { type: 'code', lang: 'mermaid', source: block.source }, { ...r, h: r.h - 24 });
  slide.addText('Mermaid diagram — run `lutrin setup-mermaid` for graphical rendering', {
    x: px(r.x),
    y: px(r.y + r.h - 22),
    w: px(r.w),
    h: px(20),
    fontSize: TYPE.caption,
    italic: true,
    color: COLORS.neutralSecondary,
    fontFace: FONTS.body,
  });
}

/**
 * Icon name made readable for a message or an alt text.
 * markdown-it percent-encodes the source of an image, so much so that
 * `![](lucide:café-emoji)` arrives here in the form "caf%c3%a9-emoji":
 * a diagnostic that copied that out as is would be unreadable for the author,
 * who never wrote that string.
 */
function iconLabel(name) {
  try {
    return decodeURIComponent(name);
  } catch {
    return name; // invalid % sequence: the raw name is authoritative
  }
}

/**
 * Icon name reduced to what can serve as a temporary FILE name.
 * The name comes from the DSL, hence from the author: nothing stops a `/`
 * from lingering in it ("lucide:coffee/"). Written as is into a path, it
 * designates a directory that does not exist and used to bring the whole
 * export down with an ENOENT — even though the icon lookup itself already
 * sanitizes the name on its own side.
 */
const iconSlug = (name) => name.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'icon';

function addIcon(slide, block, r, ctx) {
  const asset = ctx.icons.get(block);
  if (!asset) return; // icon not found (diagnostic emitted in the pre-pass): nothing rather than a broken slab
  const size = Math.min(r.w, r.h, 160);
  // aligned on the left edge, like the text (the brand is a left-aligned
  // system — a centered icon breaks the grid of the column)
  slide.addImage({
    path: asset,
    altText: `Icon ${iconLabel(block.name)}`,
    x: px(r.x),
    y: px(r.y + (r.h - size) / 2),
    w: px(size),
    h: px(size),
  });
}

function addMath(slide, block, r, ctx) {
  const asset = ctx.math.get(block);
  if (asset) {
    // natural size of the equation, centered; shrunk only if it overflows
    const scale = Math.min(1, r.w / asset.displayW, r.h / asset.displayH);
    const w = asset.displayW * scale;
    const h = asset.displayH * scale;
    slide.addImage({
      path: asset.path,
      // the LaTeX source is the best possible alt text for an equation
      // rendered as an image (and avoids leaking the path, see altOf)
      altText: `Equation: ${block.source}`,
      x: px(r.x + (r.w - w) / 2),
      y: px(r.y + (r.h - h) / 2),
      w: px(w),
      h: px(h),
    });
    return;
  }
  // faithful fallback: LaTeX source as a code block plus a caption
  addCode(slide, { type: 'code', lang: 'latex', source: block.source }, { ...r, h: r.h - 24 });
  slide.addText('LaTeX equation — install mathjax-full for graphical rendering', {
    x: px(r.x),
    y: px(r.y + r.h - 22),
    w: px(r.w),
    h: px(20),
    fontSize: TYPE.caption,
    italic: true,
    color: COLORS.neutralSecondary,
    fontFace: FONTS.body,
  });
}

/** Charts: PNG pre-rendered in the pre-pass (in-house SVG → resvg), at the
 *  exact dimensions of the slot. Native OOXML charts are invisible in Keynote
 *  and QuickLook — an image, for its part, displays everywhere. */
function addChartBlock(slide, block, r, ctx) {
  const png = ctx.charts.get(block);
  if (png) {
    // a chart rendered as an image is mute for a screen reader: the `descr`
    // carries what the figure shows (and never the path, see altOf)
    slide.addImage({
      path: png,
      altText: `Chart ${block.chartType}: ${block.categories.join(', ')}`,
      x: px(r.x),
      y: px(r.y),
      w: px(r.w),
      h: px(r.h),
    });
    return;
  }
  // faithful fallback (resvg absent): the specification as a code block
  const src = [`type: ${block.chartType}`, `categories: ${block.categories.join(', ')}`]
    .concat(block.series.map((s) => `${s.name}: ${s.values.join(', ')}`))
    .join('\n');
  addCode(slide, { type: 'code', lang: 'chart', source: src }, r);
}

/** Shape label by block type. That name is not decorative: it is what the
 *  "Reading Order" pane of PowerPoint displays, and what a screen reader
 *  announces when the shape has no text of its own (image, chart). The
 *  PptxGenJS default — "Text 3", "Image 1" — teaches nobody anything. */
const SHAPE_LABELS = {
  para: 'Paragraph',
  heading: 'Subheading',
  bullets: 'List',
  code: 'Code',
  table: 'Table',
  alert: 'Callout',
  metric: 'Key figure',
  quote: 'Quotation',
  image: 'Image',
  mermaid: 'Diagram',
  icon: 'Icon',
  math: 'Equation',
  chart: 'Chart',
  panel: 'Panel',
  'timeline-axis': 'Timeline axis',
  'timeline-dot': 'Milestone',
};

/**
 * Slide facade which, on each shape written:
 *   - gives it a meaningful name (`label()` + rank, see SHAPE_LABELS) when
 *     the caller has not imposed one;
 *   - records an entry in `rec` (one per call, in the exact order of the
 *     future spTree) — that log is what lets anim.mjs find, after the fact,
 *     the ids of the shapes to animate. `rec` null = slide not animated.
 *
 * The options are always the LAST argument of the four methods used
 * (`addImage` takes only one); that is where `objectName` is set.
 */
function wrapSlide(slide, { label, rec = null, current = null }) {
  const ranks = new Map();
  const nextName = () => {
    const base = label();
    const n = (ranks.get(base) ?? 0) + 1;
    ranks.set(base, n);
    return `${base} ${n}`;
  };
  const wrap =
    (name) =>
    (...args) => {
      if (rec) rec.push(current());
      const opts = args[args.length - 1];
      // an array would be the content (runs, lines), not options
      if (opts && typeof opts === 'object' && !Array.isArray(opts) && !opts.objectName)
        opts.objectName = nextName();
      return slide[name](...args);
    };
  return {
    addText: wrap('addText'),
    addShape: wrap('addShape'),
    addImage: wrap('addImage'),
    addTable: wrap('addTable'),
  };
}

/** Exported for the parity test with the HTML renderer: the two tables must
 *  cover exactly the same block types. */
export const BLOCK_RENDERERS = {
  para: addPara,
  heading: addHeading,
  bullets: addBullets,
  code: addCode,
  table: addTable,
  alert: addAlert,
  metric: addMetric,
  quote: addQuote,
  image: addImage,
  mermaid: addMermaid,
  icon: addIcon,
  math: addMath,
  chart: addChartBlock,
  panel: addPanel,
  'timeline-axis': addTimelineAxis,
  'timeline-dot': addTimelineDot,
};

// ---------------------------------------------------------------------------
// Slide chrome (masters)
// ---------------------------------------------------------------------------

// ---- Titles: an OOXML placeholder rather than a floating text box ---------
//
// A title placed with an ordinary `addText` is, for PowerPoint, only one text
// box among others: the accessibility checker reports "missing slide title" on
// EVERY slide, Outline view stays empty (so no navigation and no reordering by
// title) and screen readers lose the main mechanism for announcing a slide.
// The title must therefore be a real `<p:ph type="title"/>` placeholder,
// declared in the master and filled by `placeholder: 'title'`.
//
// PptxGenJS makes the text INHERIT the geometry of the placeholder: the boxes
// below are therefore the single source, shared word for word between the
// declaration in the master and the call that fills it — that is what
// guarantees that the move to the placeholder does not shift the title by a
// single pixel. They are computed at call time, never frozen at module load:
// the design tokens of the theme (PAGE, SPACE, CHROME) are living objects that
// resolveTheme() rewrites.

const contentTitleBox = () => ({
  x: px(PAGE.margin),
  y: px(SPACE.lg),
  w: px(PAGE.width - 2 * PAGE.margin),
  h: px(PAGE.titleHeight - SPACE.lg - 8),
});

const coverTitleBox = () => ({
  x: px(PAGE.margin),
  y: px(CHROME.cover.titleY),
  w: px(PAGE.width - 2 * PAGE.margin),
  h: px(CHROME.cover.titleH),
});

const sectionTitleBox = () => ({
  x: px(PAGE.margin),
  y: px(CHROME.section.titleY),
  w: px(PAGE.width - 2 * PAGE.margin),
  h: px(CHROME.section.titleH),
});

/** Declaration of the title placeholder of a master. `name` is the key that
 *  `addText({ placeholder: 'title' })` comes looking for; `type: 'title'` is
 *  what produces the `<p:ph type="title"/>`. No typographic property here:
 *  the options of the placeholder OVERRIDE those of the caller in PptxGenJS,
 *  and it is the theme, at call time, that must decide the font and color. */
const titlePlaceholder = (box) => ({
  placeholder: { options: { name: 'title', type: 'title', objectName: 'Title', ...box }, text: '' },
});

function defineMasters(pptx, meta) {
  const footerText = meta.footer ?? meta.title ?? '';
  pptx.defineSlideMaster({
    title: 'DECK_CONTENT',
    background: { color: COLORS.ground },
    objects: [
      titlePlaceholder(contentTitleBox()),
      // title rule: green segment (the single accent) then a neutral rule
      {
        rect: {
          x: px(PAGE.margin),
          y: px(PAGE.titleHeight),
          w: px(CHROME.title.accentW),
          h: px(CHROME.title.accentH),
          fill: { color: COLORS.primary },
        },
      },
      {
        rect: {
          x: px(PAGE.margin + CHROME.title.accentW),
          y: px(PAGE.titleHeight + 1.5),
          w: px(PAGE.width - 2 * PAGE.margin - CHROME.title.accentW),
          h: px(1),
          fill: { color: COLORS.neutralStroke },
        },
      },
      {
        text: {
          text: footerText,
          options: {
            x: px(PAGE.margin),
            y: px(PAGE.height - PAGE.footerHeight),
            w: px(CHROME.footer.textW),
            h: px(CHROME.footer.h),
            fontSize: TYPE.caption,
            color: COLORS.neutralSecondary,
            fontFace: FONTS.body,
            valign: 'middle',
          },
        },
      },
    ],
    slideNumber: {
      x: px(PAGE.width - PAGE.margin - CHROME.footer.numW),
      y: px(PAGE.height - PAGE.footerHeight),
      w: px(CHROME.footer.numW),
      h: px(CHROME.footer.h),
      fontSize: TYPE.caption,
      color: COLORS.neutralSecondary,
      fontFace: FONTS.body,
      align: 'right',
    },
  });
  pptx.defineSlideMaster({
    title: 'DECK_COVER',
    background: { color: COLORS.ground },
    objects: [titlePlaceholder(coverTitleBox())],
  });
  pptx.defineSlideMaster({
    title: 'DECK_SECTION',
    background: { color: COLORS.primary },
    objects: [titlePlaceholder(sectionTitleBox())],
  });
}

function renderCover(pptx, scene) {
  const s = pptx.addSlide({ masterName: 'DECK_COVER' });
  const c = CHROME.cover;
  // The title is written FIRST, as on any other slide: the order of the
  // spTree is the reading order of screen readers (and the one assumed by the
  // `!!title-N` renaming in morph.mjs, which renames the first shape). The
  // logo and the rule, decorative, come afterwards; neither of them covers the
  // title (rule at 280..286, title from 304 on), so the z rank changes nothing
  // in the image.
  s.addText(scene.title ?? '', {
    placeholder: 'title',
    ...coverTitleBox(),
    fontSize: TYPE.coverTitle,
    bold: true,
    color: COLORS.neutralPrimary,
    fontFace: FONTS.body,
    valign: 'top',
  });
  if (LOGOS.cover && fs.existsSync(LOGOS.cover)) {
    const img = logoImage(LOGOS.cover, c.logoH, PAGE.margin, PAGE.margin);
    if (img) s.addImage(img);
  }
  s.addShape('rect', {
    x: px(PAGE.margin),
    y: px(c.barY),
    w: px(c.barW),
    h: px(c.barH),
    fill: { color: COLORS.primary },
    objectName: 'Accent rule',
  });
  if (scene.subtitle) {
    s.addText(scene.subtitle, {
      x: px(PAGE.margin),
      y: px(c.subtitleY),
      w: px(PAGE.width - 2 * PAGE.margin),
      h: px(c.subtitleH),
      fontSize: TYPE.coverSubtitle,
      color: COLORS.neutralSecondary,
      fontFace: FONTS.body,
      valign: 'top',
      objectName: 'Subtitle',
    });
  }
  if (scene.byline) {
    s.addText(scene.byline, {
      x: px(PAGE.margin),
      y: px(PAGE.height - c.bylineBottom),
      w: px(PAGE.width - 2 * PAGE.margin),
      h: px(c.bylineH),
      fontSize: TYPE.small,
      color: COLORS.neutralSecondary,
      fontFace: FONTS.body,
      valign: 'middle',
      objectName: 'Byline',
    });
  }
  return s;
}

function renderSection(pptx, scene) {
  const s = pptx.addSlide({ masterName: 'DECK_SECTION' });
  const c = CHROME.section;
  s.addText(scene.title ?? '', {
    placeholder: 'title',
    ...sectionTitleBox(),
    fontSize: TYPE.sectionTitle,
    bold: true,
    color: COLORS.ground,
    fontFace: FONTS.body,
    valign: 'middle',
  });
  if (LOGOS.section && fs.existsSync(LOGOS.section)) {
    const img = logoImage(LOGOS.section, c.logoH, PAGE.margin, PAGE.height - PAGE.margin - c.logoH);
    if (img) s.addImage(img);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Canonical form of the title placeholder (post-processing)
// ---------------------------------------------------------------------------

/**
 * Brings the title placeholder back to the form PowerPoint itself writes.
 *
 * PptxGenJS produces `<p:ph idx="100" type="title" hasCustomPrompt="1"/>` in
 * a `<p:sp>` whose `<p:cNvSpPr/>` is empty. Three departures from an authentic
 * title, none of which can be caught on the API side — genXmlPlaceholder()
 * serializes `_placeholderIdx` (set to `100 + rank` for EVERY master object)
 * and infers `hasCustomPrompt` from the mere presence of a runs array, whether
 * that array is empty or not. Hence this pass over the zip.
 *
 *  1. `idx` — ECMA-376 (ISO/IEC 29500-1, §19.3.1.36): "Specifies the
 *     placeholder index. This is used when applying templates or changing
 *     layouts to match a placeholder on one template/master to another."
 *     That is the mechanism of BODY placeholders, which come in numbers and
 *     therefore have to be numbered; the title, a singleton, is matched by its
 *     `type` and an absent `idx` counts as 0. No file written by PowerPoint
 *     carries an `idx` on a title — including the notesMaster that PptxGenJS
 *     ships as is, copied from a .pptx of PowerPoint origin, where the first
 *     placeholder of each type is `<p:ph type="hdr" sz="quarter"/>`, with no
 *     `idx`. The attribute remains legal per the schema: what we are fixing is
 *     the use of the wrong mechanism, not an invalid file.
 *  2. `<a:spLocks noGrp="1"/>` — that same notesMaster carries it in the
 *     `<p:cNvSpPr>` of EACH of its six placeholders. It forbids grouping the
 *     shape, which would take it out of its role as a placeholder.
 *  3. `hasCustomPrompt="1"` announces a custom prompt ("Click to add title"
 *     replaced). Our masters declare none: the `txBody` of the placeholder is
 *     empty. The attribute lies, so it goes.
 *
 * Slides AND layouts are processed: matching is now done by `type` on both
 * sides, and leaving the `idx` on one side alone would reopen the question.
 *
 * Unexpected structure → the part is left as is, and we say so.
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @returns {Promise<{count:number, warnings:string[]}>} normalized placeholders
 */
async function canonicalizeTitlePlaceholders(pptxPath) {
  const warnings = [];
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  // the `<p:ph>` never contains a `>` before it closes: `[^>]*` is enough and
  // avoids swallowing the next shape
  const pattern = /<p:cNvSpPr\s*\/>(\s*<p:nvPr>\s*)<p:ph\b[^>]*\stype="title"[^>]*\/>/g;
  // replacer as a function (we have to count): `$1` no longer means anything
  // here — the captured group comes in as the callback argument
  const canonical = (nvPr) =>
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>${nvPr}<p:ph type="title"/>`;

  let count = 0;
  const parts = Object.keys(zip.files).filter((n) =>
    /^ppt\/(slides\/slide|slideLayouts\/slideLayout)\d+\.xml$/.test(n),
  );
  for (const part of parts) {
    const xml = await zip.file(part).async('string');
    // a part with no title is normal (the slide of a layout with no
    // placeholder): only a title we DO NOT KNOW how to normalize is worth
    // giving up on
    const titles = (xml.match(/<p:ph\b[^>]*\stype="title"[^>]*\/>/g) ?? []).length;
    let normalized = 0;
    const fresh = xml.replace(pattern, (_all, nvPr) => {
      normalized += 1;
      return canonical(nvPr);
    });
    if (normalized < titles) {
      warnings.push(`${part}: title placeholder with an unexpected structure — left as is`);
      continue; // atomic edit per part: we write none of them by halves
    }
    count += normalized;
    if (fresh !== xml) zip.file(part, fresh);
  }
  if (count)
    fs.writeFileSync(
      pptxPath,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    );
  return { count, warnings };
}

// ---------------------------------------------------------------------------
// Outline titles in docProps/app.xml (post-processing)
// ---------------------------------------------------------------------------

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Writes the real titles into `docProps/app.xml`.
 *
 * PptxGenJS hard-codes "Slide 1", "Slide 2"… in there, whatever the slides
 * actually carry. Yet THAT cache is the one PowerPoint reads to present a deck
 * without opening it (preview, properties, the slide list behind a link):
 * correct titles on the slides but numeric ones here, and the deck still
 * presents itself as a run of "Slide N". A slide with no title keeps the
 * default entry — we do not invent a title in its place.
 *
 * Unexpected structure → the file is left as is, and we say so.
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @param {Array<string|null>} titles title of each slide, in order
 * @returns {Promise<{count:number, warnings:string[]}>}
 */
async function embedSlideTitles(pptxPath, titles) {
  const warnings = [];
  const named = titles.filter(Boolean).length;
  if (!named) return { count: 0, warnings };

  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const part = 'docProps/app.xml';
  const file = zip.file(part);
  if (!file)
    return { count: 0, warnings: [`${part} absent from the .pptx — outline titles unchanged`] };

  const xml = await file.async('string');
  const block = xml.match(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/);
  const entries = block
    ? [...block[0].matchAll(/<vt:lpstr>[\s\S]*?<\/vt:lpstr>/g)].map((m) => m[0])
    : [];
  // the slides occupy the END of the list; the head (fonts, theme) is not ours
  // and goes back out as it came
  if (entries.length < titles.length) {
    return {
      count: 0,
      warnings: [`${part}: unexpected structure — outline titles unchanged`],
    };
  }
  const head = entries.slice(0, entries.length - titles.length);
  const tail = titles.map((t, k) =>
    t ? `<vt:lpstr>${escXml(t)}</vt:lpstr>` : entries[head.length + k],
  );
  const fresh = `<TitlesOfParts><vt:vector size="${entries.length}" baseType="lpstr">${[...head, ...tail].join('')}</vt:vector></TitlesOfParts>`;

  zip.file(part, xml.replace(block[0], fresh));
  fs.writeFileSync(
    pptxPath,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  return { count: named, warnings };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {Array} scenes  scenes produced by buildScenes()
 * @param {object} meta   frontmatter of the deck
 * @param {string} baseDir directory of the source file (image resolution)
 * @param {string} outPath path of the .pptx
 * @param {object} [opts] `vendor` forces remote images to be copied into the
 *                        project (CLI flag; otherwise `assets:` in the frontmatter)
 */
export async function renderDeck(scenes, meta, baseDir, outPath, opts = {}) {
  let tmpDir = null;
  const tmp = () => (tmpDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-')));
  try {
    return await renderDeckTo(scenes, meta, baseDir, outPath, tmp, opts);
  } finally {
    // the temporary PNGs (icons, equations, charts) are read at the moment the
    // .pptx is written: we only clean up afterwards — but we always clean up,
    // even on error (otherwise every export leaks a directory)
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function renderDeckTo(scenes, meta, baseDir, outPath, tmp, opts = {}) {
  const vendor = vendorRemoteAssets(meta, opts.vendor);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in = 1280 × 720 px
  pptx.author = meta.author ?? '';
  pptx.title = meta.title ?? '';
  pptx.theme = { headFontFace: FONTS.body, bodyFontFace: FONTS.body };
  defineMasters(pptx, meta);

  // ------ pre-pass: everything that requires asynchronous work --------------
  // (Mermaid, downloading the remote images, Lucide icons, equations)
  const allBlocks = scenes.flatMap((sc) => [
    ...sc.elements.map((e) => e.block),
    ...(sc.image ? [sc.image] : []), // image of the hero layout, outside the elements
  ]);
  const ofType = (t) => allBlocks.filter((b) => b.type === t);

  // Mermaid (optional, persistent cache)
  const mermaidBlocks = ofType('mermaid');
  const mermaid = new Map();
  for (const b of mermaidBlocks) {
    const png = renderMermaidCached(b.source, { baseDir });
    if (png) mermaid.set(b, png);
  }

  // Remote images → user cache, or assets/remote/ if the deck vendors them
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

  // Lucide icons → recolored PNG. A missing icon does not break the slide
  // (it is simply omitted), but the author has to find out: with no
  // diagnostic, a typo in an icon name only shows up when the .pptx is
  // proofread, once it has already gone out.
  const icons = new Map();
  const iconBlocks = ofType('icon');
  // filed by index, not piled up as they come: these renders finish in an
  // arbitrary order, and diagnostics that change order from one export to the
  // next are a plague — for the author as much as for the tests
  const iconWarnings = new Array(iconBlocks.length);
  await Promise.all(
    iconBlocks.map(async (b, k) => {
      const out = await renderIcon(b.name, { color: b.color });
      if (!out) {
        iconWarnings[k] =
          `Icon "${iconLabel(b.name)}" not found — name unknown to Lucide, or the lucide-static package is absent and there is no network. The slide is rendered without it.`;
        return;
      }
      icons.set(b, writeTmpPng(tmp(), `icon-${k}-${iconSlug(b.name)}`, out.png));
    }),
  );
  const assetWarnings = iconWarnings.filter(Boolean);

  // LaTeX equations → PNG (MathJax, code fallback if absent)
  const math = new Map();
  await Promise.all(
    ofType('math').map(async (b, k) => {
      const out = await renderMath(b.source);
      if (out)
        math.set(b, {
          path: writeTmpPng(tmp(), `math-${k}`, out.png),
          displayW: out.displayW,
          displayH: out.displayH,
        });
    }),
  );

  // Charts → SVG at the dimensions of the slot, rasterized at 2× for sharpness
  const charts = new Map();
  const chartEls = scenes.flatMap((sc) => sc.elements.filter((e) => e.block.type === 'chart'));
  await Promise.all(
    chartEls.map(async (e, k) => {
      const svg = chartSvg(e.block, e.region.w, e.region.h);
      const out = await svgToPng(svg, e.region.w * 2);
      if (out) charts.set(e.block, writeTmpPng(tmp(), `chart-${k}`, out.png));
    }),
  );

  // Rasterizer absent while the deck depends on it: SAY SO.
  //
  // Without this diagnostic, the export stays an apparent success — exit
  // code 0, "✓ N slides" — and the charts, equations and icons are replaced
  // by their specification in text, which the author only discovers in the
  // meeting. The case is not theoretical: @resvg/resvg-js ships its binaries
  // as twelve optionalDependencies and npm installs only the one for the
  // current platform, so a VSIX built on macOS embeds a truncated
  // `dist/core` once it is installed under Windows.
  //
  // Severity `error`: the deliverable is truncated, not merely imperfect. The
  // fallback itself stays in place (a readable slide beats a hole) — what is
  // fixed here is the silence.
  const diagnostics = [];
  const rasterBlocks = chartEls.length + ofType('math').length + iconBlocks.length;
  if (rasterBlocks && !(await rasterAvailable())) {
    diagnostics.push({
      severity: 'error',
      code: 'RASTER_UNAVAILABLE',
      message: `Rasterizer @resvg/resvg-js unavailable — ${rasterBlocks} chart(s), equation(s) or icon(s) are replaced by their specification in text in the .pptx. Reinstall the dependencies on this platform (\`npm install\` in the lutrin package) to restore graphical rendering.`,
    });
  }

  // trust roots of the local images: directory of the deck + project/vault
  // roots declared by the host (containment — assets.mjs)
  const imageRoots = [baseDir, ...(opts.imageRoots ?? [])];
  const ctx = { baseDir, imageRoots, mermaid, remote, icons, math, charts };

  const slideAnims = new Map(); // slide no. (1-based) → log of the shapes
  scenes.forEach((scene, sceneIdx) => {
    let slide;
    if (scene.master === 'cover') slide = renderCover(pptx, scene);
    else if (scene.master === 'section') slide = renderSection(pptx, scene);
    else {
      slide = pptx.addSlide({ masterName: 'DECK_CONTENT' });
      // animated slide: log every shape written (chrome included, as null)
      const rec = scene.animSteps ? [] : null;
      let cur = null;
      let shapeLabel = 'Content';
      const target = wrapSlide(slide, { label: () => shapeLabel, rec, current: () => cur });
      if (scene.master === 'hero' && scene.image) {
        addImage(target, scene.image, { x: 0, y: 0, w: PAGE.width, h: PAGE.height }, ctx);
      }
      // The title placeholder is written EVEN on a slide with no title:
      // failing that PptxGenJS adds it itself, empty, at the END of the
      // spTree — and that shape, absent from the `rec` log, would shift the
      // shapes ↔ animations pairing of anim.mjs (which demands an exact count
      // and would give up).
      //
      // ACCEPTED LIMITATION. On those slides the placeholder goes out with an
      // empty `txBody`, and PowerPoint's accessibility checker counts an empty
      // title as a MISSING title: the benefit is obtained only on the slides
      // that are actually titled. The two ways out have been weighed and ruled
      // out: inventing a substitute title ("Slide 4") lies to the screen
      // reader as much as to Outline view, and that is exactly what
      // embedSlideTitles() already refuses to do for docProps/app.xml; marking
      // the shape decorative (`adec:decorative`) takes it out of the reading
      // order without thereby satisfying the checker's "slide title" rule,
      // which questions the placeholder, not the reading order. A slide with
      // no title therefore stays reported — which is the truth: it has no
      // title. The remedy is in the Markdown source, not in the export.
      shapeLabel = 'Title';
      target.addText(
        scene.titleRuns ? toRuns(scene.titleRuns, { bold: true }) : (scene.title ?? ''),
        {
          placeholder: 'title',
          ...contentTitleBox(),
          fontSize: TYPE.slideTitle,
          bold: true,
          color: COLORS.neutralPrimary,
          fontFace: FONTS.body,
          valign: 'middle',
        },
      );
      for (const el of scene.elements) {
        // kind → choice of the entrance effect (anim.mjs, PRESET_BY_KIND)
        cur = el.step != null ? { step: el.step, paras: el.stepCount, kind: el.block.type } : null;
        shapeLabel = SHAPE_LABELS[el.block.type] ?? 'Content';
        const fn = BLOCK_RENDERERS[el.block.type];
        if (fn) fn(target, el.block, el.region, ctx);
      }
      if (rec?.some(Boolean))
        slideAnims.set(sceneIdx + 1, { entries: rec, preset: scene.animPreset ?? null });
    }
    if (scene.notes?.length) slide.addNotes(scene.notes.join('\n'));
  });

  // pagination chains: [original slide, …(cont.)] as 1-based numbers — each
  // "(cont.)" gets the Morph transition
  const chains = [];
  scenes.forEach((s, i) => {
    // with no title, the first shape is not a title: the !!title renaming
    // would pair two different content blocks — no Morph in that case
    if (!s.continued || !s.title) return;
    const last = chains[chains.length - 1];
    if (last && last[last.length - 1] === i) last.push(i + 1);
    else chains.push([i, i + 1]);
  });

  await pptx.writeFile({ fileName: outPath });
  const phTitles = await canonicalizeTitlePlaceholders(outPath);
  const titles = await embedSlideTitles(
    outPath,
    scenes.map((s) => s.title ?? null),
  );
  const fonts = await embedFonts(outPath);
  const morph = await embedMorph(outPath, chains);
  const anims = await embedAnimations(outPath, slideAnims);
  return {
    slideCount: scenes.length,
    titledSlides: titles.count,
    fontsEmbedded: fonts.count,
    animatedSlides: anims.count,
    morphSlides: morph.count,
    // the structured diagnostics ALSO travel as warnings: that is the only
    // channel the CLI prints today, and a diagnostic we do not display is no
    // better than the silence it corrects
    diagnostics,
    warnings: [
      ...diagnostics.map((d) => d.message),
      ...assetWarnings,
      ...phTitles.warnings,
      ...titles.warnings,
      ...fonts.warnings,
      ...morph.warnings,
      ...anims.warnings,
    ],
    mermaidRendered: mermaid.size,
    mermaidTotal: mermaidBlocks.length,
    remoteFetched: remote.size,
    remoteTotal: remoteUrls.length,
    remoteVendored: vendor,
    iconsRendered: icons.size,
    iconsTotal: iconBlocks.length,
    mathRendered: math.size,
    mathTotal: ofType('math').length,
  };
}
