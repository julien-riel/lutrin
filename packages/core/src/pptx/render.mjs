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
  displayFace,
  LOGOS,
  TYPE,
  SPACE,
  PAGE,
  SEMANTIC,
  SURFACE,
  ACCENT,
  TREND_INK,
  badgeLayout,
  blockFontSize,
  ICON_SCALE,
  iconSize,
  panelRadius,
  panelStyle,
  composite,
  pictogramGeometry,
  progressLayout,
  sectionAgendaLayout,
  sourceLineBox,
  px,
  LINE_HEIGHT,
} from '../deck/tokens.mjs';
import { ALERT_BLOCK_TYPES, animateFlag } from '../deck/parse.mjs';
import {
  fetchRemoteImage,
  iconSvg,
  ICON_RASTER_PX,
  imageDims,
  kitImageWarnings,
  renderMath,
  renderMermaidCached,
  rasterAvailable,
  resolveLocalImage,
  svgToPng,
  vendorRemoteAssets,
  writeTmpPng,
} from '../deck/assets.mjs';
import { bytesToBase64 } from '../deck/raster-browser.mjs';
import { chartSvg } from '../deck/chart.mjs';
import { smartArtGeometry, smartArtSvg } from '../deck/smartart.mjs';
import { FAMILIES } from './diagram-parts.mjs';
import { embedSmartArt } from './smartart.mjs';
import { highlightLine } from '../deck/highlight.mjs';
import { brandMention } from '../license/index.mjs';
import { embedFonts } from './fonts.mjs';
import { embedAnimations } from './anim.mjs';
import { embedMorph } from './morph.mjs';
import { embedVectorImages } from './svg.mjs';
import { embedEquations } from './equations.mjs';
import { dropDirectoryEntries } from './zip-tidy.mjs';
import { ZIP_BYTES } from './bytes.mjs';
import { ommlFromMathML } from './omml.mjs';
import { sanitizeSvg, svgPartSafe } from '../deck/svg.mjs';

/**
 * Text inset of a shape whose box the layout engine sized to the text itself.
 *
 * Left unsaid, OOXML applies its own default `lIns`/`rIns` of 91440 EMU —
 * 9.6 px a side, 19.2 px of the width gone. On the roomy boxes (a paragraph,
 * a slot title) that is invisible; on a box measured to fit its string it is
 * fatal: the "0 %" of an empty bar is emitted 23 px wide, which leaves 3.8 px
 * of usable text width, and PowerPoint breaks the number at its space and
 * stacks it out of a 20 px bar. The HTML twins are `white-space:nowrap` in a
 * box of exactly the same width, so the inset is also what pushes every label
 * 9.6 px off the coordinate both renderers were handed.
 */
const TEXT_INSET = 0;

/**
 * Is this Node? Decided EXACTLY as pptxgenjs decides it, because the two must
 * agree: on its "yes" branch it reads an image `path` off the disk itself, and
 * on its "no" branch it XHRs that string instead.
 *
 * The playground publishes a `window.process` (for `cwd()`), so a looser test
 * would answer yes in a page and hand pptxgenjs a path it cannot read.
 */
const isNodeRuntime = () =>
  typeof process !== 'undefined' &&
  Boolean(process.versions?.node) &&
  process.release?.name === 'node';

/**
 * How pptxgenjs should be handed a LOCAL image.
 *
 * In Node, the path: it reads the file itself, and nothing needs copying.
 * In a page it cannot read a file, so it fetches the string — and a compiler
 * temp path (`/tmp/lutrin-…/chart-0.png`) answers 404. That is not theoretical:
 * a deck exported from the playground embedded the nine bytes `404 /tmp/…`
 * WHERE ITS CHART BELONGED, in a .pptx that opened without complaining. So
 * outside Node the bytes travel inline, and `data` makes pptxgenjs skip the
 * fetch entirely (it filters its candidates on `!rel.data`).
 *
 * `path` is kept alongside `data` because that is where pptxgenjs reads the
 * extension it writes into the media part's name.
 */
function localImage(file) {
  if (isNodeRuntime() || /^https?:/i.test(String(file))) return { path: file };
  try {
    const ext = path.extname(String(file)).slice(1).toLowerCase() || 'png';
    return {
      path: file,
      data: `image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytesToBase64(fs.readFileSync(file))}`,
    };
  } catch {
    // unreadable here: leave pptxgenjs its own path, and let its own
    // broken-image placeholder be what says so
    return { path: file };
  }
}

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
    ...localImage(file),
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
  return runs.map((r) => {
    // Inline badge (`==Action==`): DrawingML gives a run no rounded background,
    // so the pill of the HTML becomes a run HIGHLIGHT here — a documented
    // degradation (docs/dsl.md); what CONTRIBUTING.md forbids is diverging in
    // silence.
    //
    // The PALE pair, not the saturated one the HTML pill uses, and that is not
    // a detail: `highlight` is a PowerPoint extension that Keynote, QuickLook
    // and LibreOffice drop on import. With the saturated pair, dropping the
    // background left `solidText` — white on the red and the blue — as white
    // text on white paper: the badge did not degrade, it VANISHED. Exported
    // through Keynote, "Blocked" and "FYI" were simply gone from the slide.
    // The pale pair survives both readings: a pastel marker-pen behind dark
    // ink in PowerPoint, and the same dark ink, bold and tinted, everywhere
    // the highlight is ignored. Same reasoning as charts being images —
    // a deliverable is only as good as the least capable app that opens it.
    //
    // Everything else about the run must match the CSS `.badge`, and the size
    // is why that rule carries none: an inline badge takes the size of the
    // sentence it sits in. Pinned to TYPE.small on one side only, it rendered
    // 22 % LARGER than its own paragraph in a densified HTML slide and at the
    // paragraph's size in the .pptx — and blockHeight() measured the third
    // answer. The weight is stated here because the CSS states it too.
    const badge = r.badge ? (SEMANTIC[r.badge] ?? SEMANTIC.info) : null;
    return {
      text: r.text,
      options: {
        bold: !!badge || r.bold || base.bold || false,
        italic: r.italic || base.italic || false,
        fontFace: r.code ? FONTS.mono : (base.fontFace ?? FONTS.body),
        color: badge
          ? badge.text
          : r.code
            ? COLORS.primaryDarker
            : (base.color ?? COLORS.neutralPrimary),
        ...(badge ? { highlight: badge.fill } : {}),
        ...(r.link ? { hyperlink: { url: r.link } } : {}),
      },
    };
  });
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
  // `size` (pt): text scale imposed by the layout (`density`) — otherwise the
  // theme's body token
  const size = blockFontSize(block);
  slide.addText(toRuns(block.runs, { color: block.color }), {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: size,
    fontFace: FONTS.body,
    color: block.color ?? COLORS.neutralPrimary,
    // `align`: imposed by a layout (`align` parameter) — left otherwise, and
    // stated rather than inherited (see the cover title's inheritance trap)
    align: block.align ?? 'left',
    valign: 'top',
    // exact points, never a multiple: OOXML's spcPct multiplies the FONT'S
    // own line metrics, so a kit font with tall ascenders rendered ~20%
    // taller than blockHeight() measured and crowded whatever followed.
    // spcPts pins the pitch to what the layout engine and the HTML (.para
    // line-height 1.4) both assume, whatever font the kit ships. A size
    // shipped without its matching pitch brings the bug back, smaller.
    lineSpacing: size * LINE_HEIGHT,
  });
}

function addHeading(slide, block, r) {
  // `size` (pt): key message of the focus layout — otherwise a slot title
  slide.addText(toRuns(block.runs, { bold: true, color: block.color }), {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    h: px(r.h),
    fontSize: blockFontSize(block),
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
  // `size` (pt): text scale imposed by the layout (`density`); the sub-level
  // keeps the ratio the theme gave it — see blockFontSize
  const size = blockFontSize(block);
  const nestedSize = blockFontSize(block, 'nested');
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
    // a ticked line steps back into the secondary ink, exactly as the HTML
    // does — done is context, not the point of the slide. Never over a colour
    // the layout imposed: on a repainted panel that ink was measured.
    if (it.checked && !block.color) {
      itemRuns.forEach((run) => {
        run.options.color = COLORS.neutralSecondary;
      });
    }
    if (it.level) {
      // nested items: same size and pitch as the HTML (.bullets ul ul)
      itemRuns.forEach((run) => {
        run.options.fontSize = nestedSize;
      });
      itemRuns[0].options.lineSpacing = nestedSize * 1.3;
    }
    itemRuns[0] = {
      ...itemRuns[0],
      options: {
        ...itemRuns[0].options,
        // a task item takes a BOX for a marker — U+2610 ☐ / U+2611 ☑, the
        // characters PowerPoint already has, so the box stays a bullet
        // (editable, re-indentable) rather than a shape floating beside the
        // text it belongs to
        bullet:
          it.checked != null
            ? { code: it.checked ? '2611' : '2610', indent: 16 }
            : block.ordered
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
    fontSize: size,
    fontFace: FONTS.body,
    color: block.color ?? COLORS.neutralPrimary,
    valign: 'top',
    ...(block.align ? { align: block.align } : {}),
    // exact pitch and gap of the HTML (.bullets: line-height 1.3, li
    // margin-bottom 6px) — spcPts + 4.5 pt (= 6 px); see addPara
    lineSpacing: size * 1.3,
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
    fontSize: blockFontSize(block),
    valign: 'top',
    // exact pitch of the HTML (.code line-height 1.3); see addPara
    lineSpacing: blockFontSize(block) * 1.3,
  });
}

function addTable(slide, block, r) {
  const border = [
    { type: 'none' },
    { type: 'none' },
    { pt: 0.75, color: COLORS.neutralStroke },
    { type: 'none' },
  ];
  // Per-column alignment (the Markdown delimiter row) is threaded PER CELL:
  // `colW` aside, PptxGenJS has no per-column option, and a cell value beats
  // the table's. The object is rebuilt for every cell on purpose — PptxGenJS
  // writes the inherited keys back INTO the options it is handed, so one
  // shared per-column object would leak those mutations across the column.
  //
  // No tabular-figure request goes with it, unlike the CSS: DrawingML run
  // properties carry no OpenType feature switch, and the only OOXML mechanism
  // that lines digits up — a decimal tab stop — would mean pushing tab
  // characters into the author's cells. The default body face (Arial) already
  // ships tabular lining figures, so PowerPoint lines them up on its own; the
  // divergence is documented in docs/dsl.md rather than papered over.
  const align = (k) =>
    block.align?.[k] && block.align[k] !== 'left' ? { align: block.align[k] } : {};
  // `block.color`: the panel repainted us (a saturated tone). The header's own
  // pale fill has to go with the ink — light text on light grey is worse than
  // the under-AA contrast the repaint exists to fix — and both rows take the
  // panel's ink rather than the deck's.
  const ink = block.color ?? COLORS.neutralPrimary;
  // `zebra` / `emphasis`: the `table` base's parameters, read off the block
  // the layout stamped. `header` is the historical emphasis and stays the
  // default, so a deck that asked for nothing exports byte for byte as before.
  const em = block.emphasis ?? 'header';
  const stub = em === 'first-column' || em === 'both';
  const headFill = em === 'first-column' || em === 'none' ? null : COLORS.underground1;
  const headerRow = block.header.map((cell, k) => ({
    text: toRuns(cell, { bold: true, color: block.color }),
    options: {
      bold: true,
      ...(block.color || !headFill ? {} : { fill: { color: headFill } }),
      border,
      color: ink,
      ...align(k),
    },
  }));
  const bodyRows = block.rows.map((row, ri) =>
    row.map((cell, k) => {
      const isStub = stub && k === 0;
      // the stub keeps its own tint over the zebra: it is the band that
      // carries the reading, and a row that swallowed it would lose the spine
      const fill = isStub
        ? block.zebra
          ? COLORS.underground2
          : COLORS.underground1
        : block.zebra && ri % 2 === 1
          ? COLORS.underground1
          : null;
      return {
        text: toRuns(cell, { bold: isStub, color: block.color }),
        options: {
          border,
          color: ink,
          ...(isStub ? { bold: true } : {}),
          ...(fill && !block.color ? { fill: { color: fill } } : {}),
          ...align(k),
        },
      };
    }),
  );
  slide.addTable([...(headerRow.length ? [headerRow] : []), ...bodyRows], {
    x: px(r.x),
    y: px(r.y),
    w: px(r.w),
    // no lineSpacing: TableCellProps has none, and a table-level one is not
    // among the options PptxGenJS pushes down into the cells. The row heights
    // are PowerPoint's own (no `h`, no `rowH`), so the pitch stays the font's
    // — blockHeight() estimates against the same size and nothing else can be
    // pinned here.
    fontSize: blockFontSize(block),
    fontFace: FONTS.body,
    valign: 'middle',
    margin: 6,
    autoPage: false,
  });
}

function addAlert(slide, block, r) {
  const sem = SEMANTIC[block.kind] ?? SEMANTIC.info;
  // `size` (pt): text scale imposed by the layout (`density`); the label
  // keeps the ratio the theme gave it — see blockFontSize
  const size = blockFontSize(block);
  const labelSize = blockFontSize(block, 'label');
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
        fontSize: labelSize,
        color: sem.text,
        breakLine: true,
        lineSpacing: labelSize * 1.3,
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
    fontSize: size,
    fontFace: FONTS.body,
    valign: 'top',
    // exact pitch of the HTML (.alert line-height 1.3); the label paragraph
    // carries its own smaller pitch in its run options — see addPara
    lineSpacing: size * 1.3,
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

/**
 * Progress bar: two rounded rectangles plus text. OOXML has no progress
 * shape, and none is wanted — a drawn bar renders identically in PowerPoint,
 * Keynote and QuickLook, the same reasoning that made the charts images.
 * Every coordinate comes from progressLayout(), which the HTML renderer and
 * blockHeight() also read.
 */
function addProgress(slide, block, r) {
  const g = progressLayout(block, r.w);
  const sem = SEMANTIC[block.kind] ?? SEMANTIC.info;
  const radius = px(g.bar.h / 2); // pill: rectRadius is an absolute length
  const bar = (box, color) =>
    slide.addShape('roundRect', {
      x: px(r.x + box.x),
      y: px(r.y + box.y),
      w: px(box.w),
      h: px(box.h),
      fill: { color },
      line: { type: 'none' },
      rectRadius: radius,
    });
  bar(g.bar, COLORS.underground2);
  // a 0 % bar writes no fill: a zero-width pill is an artefact, and the empty
  // track already says what there is to say
  if (g.fill.w > 0) bar(g.fill, sem.solid);
  // the target rule stands ON the track, so it takes the ink of the page and
  // not the tint of the bar: it is a commitment, not a share. A plain rect —
  // a rounded one at 2 px wide would draw a lozenge.
  if (g.marker) {
    slide.addShape('rect', {
      x: px(r.x + g.marker.x),
      y: px(r.y + g.marker.y),
      w: px(g.marker.w),
      h: px(g.marker.h),
      fill: { color: COLORS.neutralPrimary },
      line: { type: 'none' },
    });
  }
  // `block.color`: the panel repainted us. It governs everything that writes
  // on the panel — the label, the caption, the percentage when it sits OUTSIDE
  // the fill. The percentage inside the fill keeps the tint's own ink: there
  // the surface is the fill, whatever the panel underneath.
  const onPanel = block.color ?? COLORS.neutralSecondary;
  slide.addText(block.label ?? '', {
    x: px(r.x + g.label.x),
    y: px(r.y + g.label.y),
    w: px(g.label.w),
    h: px(g.label.h),
    fontSize: TYPE.body,
    color: block.color ?? COLORS.neutralPrimary,
    fontFace: FONTS.body,
    valign: 'middle',
    // exact pitch, never a multiple — see addPara
    lineSpacing: TYPE.body * 1.3,
    margin: TEXT_INSET,
    // the height was committed to before this ran: a wrapped label would leave
    // the block's box. The HTML counterpart clips with an ellipsis; PowerPoint
    // has no ellipsis, so it overruns — stated in docs/dsl.md.
    wrap: false,
  });
  slide.addText(g.pct.text, {
    x: px(r.x + g.pct.x),
    y: px(r.y + g.pct.y),
    w: px(g.pct.w),
    h: px(g.pct.h),
    fontSize: TYPE.small,
    bold: true,
    color: g.pct.inside ? sem.solidText : onPanel,
    fontFace: FONTS.body,
    align: g.pct.align,
    valign: 'middle',
    lineSpacing: TYPE.small * 1.3,
    margin: TEXT_INSET,
    // progressLayout sized this box to the number and nothing more, and the
    // HTML counterpart is `white-space:nowrap`: left free to wrap, PowerPoint
    // stacks "0" over "%" out of a 20 px bar
    wrap: false,
  });
  if (g.caption) {
    slide.addText(block.caption, {
      x: px(r.x + g.caption.x),
      y: px(r.y + g.caption.y),
      w: px(g.caption.w),
      h: px(g.caption.h),
      fontSize: TYPE.caption,
      color: onPanel,
      fontFace: FONTS.body,
      valign: 'middle',
      lineSpacing: TYPE.caption * 1.3,
      margin: TEXT_INSET,
    });
  }
}

/** Row of badges: one pill + one text per item, at the positions the shared
 *  wrap (badgeLayout) computed — the .pptx has no flow layout, so the wrap
 *  cannot be left to the renderer. */
function addBadge(slide, block, r) {
  for (const it of badgeLayout(block, r.w).items) {
    const sem = SEMANTIC[it.kind] ?? SEMANTIC.info;
    const box = { x: px(r.x + it.x), y: px(r.y + it.y), w: px(it.w), h: px(it.h) };
    slide.addShape('roundRect', {
      ...box,
      fill: { color: sem.solid },
      line: { type: 'none' },
      rectRadius: px(it.h / 2),
    });
    slide.addText(it.text, {
      ...box,
      fontSize: TYPE.small,
      bold: true,
      color: sem.solidText,
      fontFace: FONTS.body,
      align: 'center',
      valign: 'middle',
      // same pitch as the CSS .badge (1.3), in exact points — see addPara
      lineSpacing: TYPE.small * 1.3,
      margin: TEXT_INSET,
      // badgeLayout sized the pill to the label plus its padding, and the HTML
      // counterpart is `white-space:nowrap`: a wrapped label leaves the pill
      wrap: false,
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
    // pptxgenjs 4 takes rectRadius as an ABSOLUTE length in the shape's own
    // unit (it computes the OOXML `adj` ratio itself), so the px value the
    // HTML writes as border-radius travels here unchanged — a pill is half
    // the shorter side on both sides, not a magic 0.5 on this one
    rectRadius: px(panelRadius(block, r)),
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
  const arrow = block.arrow !== false && !block.hairline;
  // a HAIRLINE separates instead of directing — the rule under a checklist
  // line, a column gutter, the leader of a callout: same object, lighter ink
  const color = block.hairline ? COLORS.neutralTertiary : COLORS.neutralStroke;
  if (block.vertical) {
    if (block.up) {
      // the vertical axis of a matrix points UP: on a matrix "more" is at the
      // top, and an arrowhead sinking towards the origin would say so backwards
      slide.addShape('rect', {
        x: px(r.x),
        y: px(r.y + (arrow ? 14 : 0)),
        w: px(r.w),
        h: px(r.h - (arrow ? 14 : 0)),
        fill: { color },
        line: { type: 'none' },
      });
      if (arrow) {
        slide.addShape('triangle', {
          x: px(r.x + r.w / 2 - 7),
          y: px(r.y),
          w: px(14),
          h: px(14),
          fill: { color },
          line: { type: 'none' },
        });
      }
      return;
    }
    // vertical axis (roadmap in a column): time runs downwards
    slide.addShape('rect', {
      x: px(r.x),
      y: px(r.y),
      w: px(r.w),
      h: px(r.h - (arrow ? 14 : 0)),
      fill: { color },
      line: { type: 'none' },
    });
    if (arrow) {
      slide.addShape('triangle', {
        x: px(r.x + r.w / 2 - 7),
        y: px(r.y + r.h - 14),
        w: px(14),
        h: px(14),
        fill: { color },
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
    fill: { color },
    line: { type: 'none' },
  });
  if (arrow) {
    // arrowhead: time flows towards the right
    slide.addShape('triangle', {
      x: px(r.x + r.w - 14),
      y: px(r.y + r.h / 2 - 7),
      w: px(14),
      h: px(14),
      fill: { color },
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
  // `label`: a callout marker showing a letter rather than its rank
  slide.addText(String(block.label ?? block.index), {
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

/**
 * An isotype chart, drawn as NATIVE editable shapes — one disc (or one square)
 * per unit, the same discs the HTML twin puts in its SVG, because the geometry
 * comes from the same function.
 *
 * A grouped picture would have been cheaper, and wrong for the same reason
 * every other block here is native: a presenter must be able to click one dot
 * and recolour it when the number moves before the meeting.
 */
function addPictogram(slide, block, r) {
  const { units } = pictogramGeometry(block, r.w, r.h);
  const on = SEMANTIC[block.kind]?.solid ?? COLORS.primary;
  const off = COLORS.underground2;
  for (const u of units) {
    slide.addShape(block.shape === 'square' ? 'roundRect' : 'ellipse', {
      x: px(r.x + u.x),
      y: px(r.y + u.y),
      w: px(u.d),
      h: px(u.d),
      fill: { color: u.on ? on : off },
      line: { type: 'none' },
      ...(block.shape === 'square' ? { rectRadius: px(u.d * 0.16) } : {}),
    });
  }
}

/** Alt text of a diagram: the family and the labels, in reading order — the
 *  one description a screen reader can give of a shape group. */
function smartArtAltText(block) {
  const walk = (list) =>
    (list ?? []).flatMap((n) => [n.text, ...(n.children ? walk(n.children) : [])]);
  const names = [block.hub, ...walk(block.nodes)].filter(Boolean);
  return `SmartArt ${block.family}: ${names.join(', ')}`;
}

/**
 * A diagram, drawn as NATIVE editable shapes: discs, boxes, arrows and their
 * labels, each a real PowerPoint object a presenter can nudge.
 *
 * The geometry is not computed here. It comes from deck/smartart.mjs, region-
 * local, and is translated by `r.x`/`r.y` on the way out — the same numbers
 * the HTML twin lays out and the same numbers the OOXML injector serialises
 * into `drawingN.xml`. Reading it from one place is what makes those three
 * agree by construction instead of by coincidence.
 */
function drawSmartArtShapes(slide, g, r) {
  // links first: an arrow is BEHIND the discs it joins, so the shaft that
  // runs under a node's edge does not draw over it
  for (const l of g.links) {
    slide.addShape(l.prst, {
      x: px(r.x + l.x),
      y: px(r.y + l.y),
      w: px(l.w),
      h: px(l.h),
      fill: { color: l.color },
      line: { type: 'none' },
      ...(l.rotate ? { rotate: l.rotate } : {}),
    });
  }
  for (const s of g.shapes) {
    slide.addShape(s.prst, {
      x: px(r.x + s.x),
      y: px(r.y + s.y),
      w: px(s.w),
      h: px(s.h),
      // `custGeom`: the point list is the shape's OWN outline, relative to its
      // box — the same list the SVG twin draws and the drawing cache writes.
      // PptxGenJS closes nothing by itself, hence the explicit `close`.
      ...(s.points
        ? { points: [...s.points.map(([sx, sy]) => ({ x: px(sx), y: px(sy) })), { close: true }] }
        : {}),
      // PptxGenJS's `transparency` is the INVERSE of alpha, in percent: it
      // writes `<a:alpha val="(100 − transparency) × 1000"/>`, so 78 here is
      // the 0.22 the SVG writes as fill-opacity.
      fill: {
        color: s.fill,
        ...(s.alpha < 1 ? { transparency: Math.round(100 - s.alpha * 100) } : {}),
      },
      line: { type: 'none' },
      ...(s.radius ? { rectRadius: px(s.radius) } : {}),
    });
  }
  for (const l of g.labels) {
    const runs = [{ text: l.text, options: { bold: true, fontSize: l.pt } }];
    if (l.sub) runs.push({ text: `\n${l.sub}`, options: { fontSize: Math.max(8, l.pt - 2) } });
    slide.addText(runs, {
      x: px(r.x + l.x),
      y: px(r.y + l.y),
      w: px(l.w),
      h: px(l.h),
      color: l.ink,
      fontFace: FONTS.body,
      align: l.align,
      valign: l.valign,
      margin: 0,
    });
  }
}

function addSmartArt(slide, block, r, ctx) {
  const d = ctx.diagrams?.get(block);
  // SmartArt mode: ONE picture standing in for the diagram, which the
  // post-write pass swaps for a real `<p:graphicFrame>`. If the swap does not
  // happen — no rasterizer, an unrecognised family, a surprise in the zip —
  // the picture is already a correct rendering of the diagram, so nothing is
  // lost but the editability.
  if (d?.png && FAMILIES[block.family]?.smartart) {
    slide.addImage({
      ...localImage(d.png),
      altText: smartArtAltText(block),
      x: px(r.x),
      y: px(r.y),
      w: px(r.w),
      h: px(r.h),
      _dgm: { family: block.family, block, geometry: d.geometry },
    });
    return;
  }
  drawSmartArtShapes(slide, d?.geometry ?? smartArtGeometry(block, r.w, r.h), r);
}

function addQuote(slide, block, r) {
  // `block.color`: the panel repainted us. The mark and the attribution carry
  // colours of their own (the primary accent, the secondary ink) — both are
  // measured against the deck's ground, so both follow the ink onto a
  // saturated surface, exactly as the HTML gives them `color:inherit`.
  slide.addText('“', {
    x: px(r.x),
    y: px(r.y),
    w: px(80),
    h: px(96),
    fontSize: 72,
    bold: true,
    color: block.color ?? ACCENT.bar,
    fontFace: FONTS.body,
  });
  slide.addText(toRuns(block.runs, { italic: true, color: block.color, fontFace: displayFace() }), {
    x: px(r.x + 96),
    y: px(r.y),
    w: px(r.w - 128),
    h: px(r.h - 64),
    fontSize: blockFontSize(block),
    italic: true,
    color: block.color ?? COLORS.neutralPrimary,
    fontFace: displayFace(),
    valign: 'middle',
    // exact pitch of the HTML (.quote blockquote line-height 1.4); see addPara
    lineSpacing: blockFontSize(block) * LINE_HEIGHT,
  });
  if (block.cite) {
    slide.addText(`— ${block.cite}`, {
      x: px(r.x + 96),
      y: px(r.y + r.h - 56),
      w: px(r.w - 128),
      h: px(40),
      fontSize: TYPE.body,
      color: block.color ?? COLORS.neutralSecondary,
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
      ...localImage(src),
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
      ...localImage(png),
      _svg: ctx.vectorSvg?.get(block),
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
  const size = iconSize(block, r);
  // aligned on the left edge, like the text (the brand is a left-aligned
  // system — a centered icon breaks the grid of the column)
  slide.addImage({
    ...localImage(asset),
    _svg: ctx.vectorSvg?.get(block),
    altText: `Icon ${iconLabel(block.name)}`,
    x: px(r.x),
    y: px(r.y + (r.h - size) / 2),
    w: px(size),
    h: px(size),
  });
}

/** Point size of the OMML runs, so the native equation comes out at the size of
 *  the picture it replaces. MathJax measures in `ex`; `EX_TO_PX` fixes one ex at
 *  9 px, and a maths face's ex-height is about 0.45 em, which puts the em at
 *  20 px — 15 pt at 96 dpi. `scale` is the shrink `addMath` applied to fit. */
const OMML_EM_PT = 15;

function addMath(slide, block, r, ctx) {
  const asset = ctx.math.get(block);
  if (asset) {
    // natural size of the equation, centered; shrunk only if it overflows
    const scale = Math.min(1, r.w / asset.displayW, r.h / asset.displayH);
    const w = asset.displayW * scale;
    const h = asset.displayH * scale;
    // The native half, when — and ONLY when — the conversion is exact.
    // `ommlFromMathML` returns null for anything it cannot map, and null here
    // means this equation ships as the picture it already is, which is the
    // whole of "the fallback has to stay". Counted either way, so a deck that
    // quietly lost half its equations to the picture path says so.
    ctx.equations.total += 1;
    const omml = asset.mathml
      ? ommlFromMathML(asset.mathml, { sizePt: Math.max(6, Math.round(OMML_EM_PT * scale)) })
      : null;
    if (omml) ctx.equations.native += 1;
    slide.addImage({
      ...localImage(asset.path),
      _svg: ctx.vectorSvg?.get(block),
      ...(omml ? { _omml: omml } : {}),
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
      ...localImage(png),
      _svg: ctx.vectorSvg?.get(block),
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
  progress: 'Progress bar',
  badge: 'Status badges',
  quote: 'Quotation',
  image: 'Image',
  mermaid: 'Diagram',
  icon: 'Icon',
  math: 'Equation',
  chart: 'Chart',
  panel: 'Panel',
  'timeline-axis': 'Timeline axis',
  'timeline-dot': 'Milestone',
  smartart: 'Diagram',
  pictogram: 'Pictogram chart',
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
function wrapSlide(
  slide,
  { label, rec = null, current = null, vectors = null, diagrams = null, equations = null },
) {
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
      // `_svg` is ours, not PptxGenJS's: harvest it and take it back out of the
      // options before they reach the library. The vector is filed under the
      // shape's NAME, which is what lands in `cNvPr name=` — a far steadier key
      // than the ordinal of the picture in the spTree, since a hero image and a
      // logo are pictures too and would shift every count after them.
      if (opts && typeof opts === 'object' && !Array.isArray(opts) && opts._svg) {
        if (vectors) vectors.push({ name: opts.objectName, svg: opts._svg });
        opts._svg = undefined;
      }
      // `_dgm` travels the same way, and for the same reason: the SmartArt
      // injector has to find, in the written slide XML, the one picture that
      // stands in for a diagram — and the shape's name is the only handle that
      // survives PptxGenJS.
      if (opts && typeof opts === 'object' && !Array.isArray(opts) && opts._dgm) {
        if (diagrams) diagrams.push({ name: opts.objectName, payload: opts._dgm });
        opts._dgm = undefined;
      }
      // `_omml` likewise: the native equation the picture is about to be
      // wrapped in, filed under the shape's name for `equations.mjs` to find.
      if (opts && typeof opts === 'object' && !Array.isArray(opts) && opts._omml) {
        if (equations) equations.push({ name: opts.objectName, omml: opts._omml });
        opts._omml = undefined;
      }
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
  progress: addProgress,
  badge: addBadge,
  quote: addQuote,
  image: addImage,
  mermaid: addMermaid,
  icon: addIcon,
  math: addMath,
  chart: addChartBlock,
  panel: addPanel,
  'timeline-axis': addTimelineAxis,
  'timeline-dot': addTimelineDot,
  smartart: addSmartArt,
  pictogram: addPictogram,
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

/**
 * Geometry of the "Generated with Lutrin" attribution, per layout. Kept here
 * rather than in the callers so that the three masters and the hero slide cannot
 * drift apart, and so that the HTML stylesheet has a single set of numbers to
 * mirror (.footer-brand / .brand-cover / .brand-section).
 *
 * `content` stops short of the page number's zone; `cover` shares the byline's
 * baseline; `section` sits on the band of the section logo, in the ground colour
 * because that master's background is the primary.
 */
const brandBox = (placement) => {
  const w = CHROME.brand.w;
  if (placement === 'cover')
    return {
      x: px(PAGE.width - PAGE.margin - w),
      y: px(PAGE.height - CHROME.cover.bylineBottom),
      w: px(w),
      h: px(CHROME.cover.bylineH),
      color: COLORS.neutralSecondary,
    };
  if (placement === 'section')
    return {
      x: px(PAGE.width - PAGE.margin - w),
      y: px(PAGE.height - PAGE.margin - CHROME.brand.h),
      w: px(w),
      h: px(CHROME.brand.h),
      color: COLORS.ground,
    };
  return {
    x: px(PAGE.width - PAGE.margin - CHROME.footer.numW - w),
    y: px(PAGE.height - PAGE.footerHeight),
    w: px(w),
    h: px(CHROME.footer.h),
    color: COLORS.neutralSecondary,
  };
};

/** Text options of the attribution — shared by the master objects and by the
 *  per-slide copy the hero layout needs. */
const brandTextOptions = (placement) => {
  const { color, ...box } = brandBox(placement);
  return {
    ...box,
    color,
    fontSize: TYPE.caption,
    fontFace: FONTS.body,
    align: 'right',
    valign: 'middle',
    objectName: 'Lutrin attribution',
  };
};

function defineMasters(pptx, meta, brand) {
  const footerText = meta.footer ?? meta.title ?? '';
  // one master object rather than a shape per slide: the attribution then costs
  // nothing per slide and cannot be deleted slide by slide in PowerPoint
  const brandObject = (placement) =>
    brand ? [{ text: { text: brand, options: brandTextOptions(placement) } }] : [];
  pptx.defineSlideMaster({
    title: 'DECK_CONTENT',
    background: { color: SURFACE.pageBg },
    objects: [
      titlePlaceholder(contentTitleBox()),
      // title rule: accent segment (the single flourish) then a neutral rule
      {
        rect: {
          x: px(PAGE.margin),
          y: px(PAGE.titleHeight),
          w: px(CHROME.title.accentW),
          h: px(CHROME.title.accentH),
          fill: { color: ACCENT.bar },
        },
      },
      {
        rect: {
          x: px(PAGE.margin + CHROME.title.accentW),
          y: px(PAGE.titleHeight + 1.5),
          w: px(PAGE.width - 2 * PAGE.margin - CHROME.title.accentW),
          h: px(1),
          fill: { color: ACCENT.rule },
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
      ...brandObject('content'),
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
    background: { color: SURFACE.coverBg },
    objects: [titlePlaceholder(coverTitleBox()), ...brandObject('cover')],
  });
  pptx.defineSlideMaster({
    title: 'DECK_SECTION',
    background: { color: SURFACE.sectionBg },
    objects: [titlePlaceholder(sectionTitleBox()), ...brandObject('section')],
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
    color: SURFACE.coverInk,
    fontFace: displayFace(),
    // explicit: a paragraph without `algn` inherits the master's titleStyle,
    // which PptxGenJS hard-codes centered — the HTML output is left-aligned
    align: 'left',
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
    // the cover's own bar: `coverBar` falls back on `bar` (applyTheme), so a
    // theme that names neither draws exactly what it drew before
    fill: { color: ACCENT.coverBar },
    objectName: 'Accent rule',
  });
  if (scene.subtitle) {
    s.addText(scene.subtitle, {
      x: px(PAGE.margin),
      y: px(c.subtitleY),
      w: px(PAGE.width - 2 * PAGE.margin),
      h: px(c.subtitleH),
      fontSize: TYPE.coverSubtitle,
      color: SURFACE.coverMutedInk,
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
      color: SURFACE.coverMutedInk,
      fontFace: FONTS.body,
      valign: 'middle',
      objectName: 'Byline',
    });
  }
  return s;
}

function renderSection(pptx, scene, ctx, brand) {
  const s = pptx.addSlide({ masterName: 'DECK_SECTION' });
  const c = CHROME.section;
  if (scene.image) {
    // layout-declared kit image (`image` parameter of the section base):
    // full-bleed under a scrim of the section surface — the divider stays the
    // brand's colour and the sectionInk pair keeps roughly its contrast
    // whatever the photo. Slide shapes draw above the master, so the title
    // and logo below land on top; the master's attribution does NOT — it is
    // covered like on a hero, and re-added here for the same reason.
    addImage(s, scene.image, { x: 0, y: 0, w: PAGE.width, h: PAGE.height }, ctx);
    s.addShape('rect', {
      x: 0,
      y: 0,
      w: px(PAGE.width),
      h: px(PAGE.height),
      fill: {
        color: SURFACE.sectionBg,
        transparency: Math.round((1 - c.scrimAlpha) * 100),
      },
      line: { type: 'none' },
    });
    if (brand) s.addText(brand, brandTextOptions('section'));
  }
  s.addText(scene.title ?? '', {
    placeholder: 'title',
    ...sectionTitleBox(),
    fontSize: TYPE.sectionTitle,
    bold: true,
    color: SURFACE.sectionInk,
    fontFace: displayFace(),
    align: 'left', // same inheritance trap as the cover title
    valign: 'middle',
  });
  // chapter rail (frontmatter `agenda: true`): the deck's chapters under the
  // title, the current one in the full section ink, the others dimmed toward
  // the surface — geometry from sectionAgendaLayout, shared with the HTML
  if (scene.agenda?.length) {
    const g = sectionAgendaLayout(scene.agenda.length);
    const dim = composite(SURFACE.sectionInk, SURFACE.sectionBg, 0.55);
    scene.agenda.forEach((it, i) => {
      s.addText(`${i + 1}.  ${it.title}`, {
        x: px(g.x),
        y: px(g.top + i * g.lineH),
        w: px(g.w),
        h: px(g.lineH),
        fontSize: g.size,
        fontFace: FONTS.body,
        color: it.current ? SURFACE.sectionInk : dim,
        bold: it.current,
        align: 'left',
        valign: 'middle',
      });
    });
  }
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
      await zip.generateAsync({ type: ZIP_BYTES, compression: 'DEFLATE' }),
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
  fs.writeFileSync(pptxPath, await zip.generateAsync({ type: ZIP_BYTES, compression: 'DEFLATE' }));
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

/**
 * The same export, handed back as bytes rather than left on disk — for a host
 * that has no disk to leave it on.
 *
 * The playground is that host: it runs this renderer in the browser, behind the
 * `node:fs` shim, and needs the finished package to hand to a download. It goes
 * through a file anyway, and deliberately: the eight post-passes above address
 * the .pptx by PATH and reopen it between each other, so a variant that skipped
 * the file would be a second pipeline — the one that silently stops getting the
 * fixes this one gets.
 *
 * @param {Array} scenes  scenes produced by buildScenes()
 * @param {object} meta   frontmatter of the deck
 * @param {string} baseDir directory of the source file (image resolution)
 * @param {object} [opts] as renderDeck()
 * @returns {Promise<{bytes:Uint8Array, stats:object}>}
 */
export async function renderDeckBytes(scenes, meta, baseDir, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-out-'));
  const outPath = path.join(dir, 'deck.pptx');
  try {
    const stats = await renderDeck(scenes, meta, baseDir, outPath, opts);
    return { bytes: fs.readFileSync(outPath), stats };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function renderDeckTo(scenes, meta, baseDir, outPath, tmp, opts = {}) {
  const vendor = vendorRemoteAssets(meta, opts.vendor);
  // Real OOXML SmartArt is OPT-IN: `--smartart`, or `smartart:` in the
  // frontmatter. `animateFlag` rather than `=== true` because the frontmatter
  // reader hands every value over as a STRING — `smartart: true` arrives as
  // `"true"`, so an identity test against a boolean could never fire and the
  // VS Code route, which passes `meta` and no options, would be dead code.
  const smartart = opts.smartart ?? (meta.smartart != null && animateFlag(meta.smartart));
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in = 1280 × 720 px
  pptx.author = meta.author ?? '';
  pptx.title = meta.title ?? '';
  pptx.theme = { headFontFace: FONTS.body, bodyFontFace: FONTS.body };
  // resolved once for the whole export — same reason as in the HTML renderer
  const brand = brandMention(opts);
  defineMasters(pptx, meta, brand);

  // ------ pre-pass: everything that requires asynchronous work --------------
  // (Mermaid, downloading the remote images, Lucide icons, equations)
  const allBlocks = scenes.flatMap((sc) => [
    ...sc.elements.map((e) => e.block),
    ...(sc.image ? [sc.image] : []), // image of the hero layout, outside the elements
  ]);
  const ofType = (t) => allBlocks.filter((b) => b.type === t);

  // Vector twin of the rasters below: block → the SVG string its PNG was made
  // from. The .pptx ships BOTH — the PNG stays the picture's fill, the SVG
  // rides along in an extension that PowerPoint 2019+ prefers and every other
  // reader ignores (pptx/svg.mjs). A block absent from this map simply stays
  // the raster it has always been, which is why every entry goes through
  // svgPartSafe first: a malformed part would make PowerPoint call the whole
  // file corrupt, where a missing one costs nothing but sharpness.
  const vectorSvg = new Map();
  const keepVector = (block, svg) => {
    if (svg && svgPartSafe(svg)) vectorSvg.set(block, svg);
  };

  // Mermaid (optional, persistent cache)
  const mermaidBlocks = ofType('mermaid');
  const mermaid = new Map();
  for (const b of mermaidBlocks) {
    const png = renderMermaidCached(b.source, { baseDir });
    if (png) mermaid.set(b, png);
    // only once the raster is in hand: a diagram that failed to render must not
    // spend a second mmdc run to fail again. Warm cache: free.
    if (png) {
      const svgFile = renderMermaidCached(b.source, { format: 'svg', baseDir });
      if (svgFile) keepVector(b, sanitizeSvg(fs.readFileSync(svgFile, 'utf8')));
    }
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
      // two failures, two diagnostics: an icon whose SVG cannot be FOUND is a
      // deck problem (typo, package absent, offline), while an SVG found but
      // not RASTERIZED is the missing resvg binary — already reported, with
      // its remedy, by RASTER_UNAVAILABLE below. Conflating them sent Windows
      // users hunting for a network problem when their VSIX simply shipped
      // another platform's rasterizer.
      const svg = await iconSvg(b.name, { color: b.color });
      if (!svg) {
        iconWarnings[k] =
          `Icon "${iconLabel(b.name)}" not found — name unknown to Lucide, or the lucide-static package is absent and there is no network. The slide is rendered without it.`;
        return;
      }
      // The raster follows the size WORD the author asked for: a `large` icon
      // is PLACED 1.4× bigger, and a fixed density behind it dropped the
      // source-to-placement ratio from 2.4× to 1.7× — the most prominent icon
      // on the slide, and the softest of them all, while the HTML (which
      // inlines the SVG) stayed sharp. Never below the base density: a
      // smaller icon costs nothing to oversample.
      const out = await svgToPng(
        svg,
        Math.round(ICON_RASTER_PX * Math.max(1, ICON_SCALE[b.size] ?? 1)),
      );
      if (out) {
        icons.set(b, writeTmpPng(tmp(), `icon-${k}-${iconSlug(b.name)}`, out.png));
        keepVector(b, sanitizeSvg(svg)); // outside source (lucide-static or CDN)
      }
    }),
  );
  // `kit:` aliases no theme declared join the same channel as the missing
  // icons: the slide keeps the missing-image placeholder, the author is told
  const assetWarnings = [...iconWarnings.filter(Boolean), ...kitImageWarnings(allBlocks)];

  // LaTeX equations → PNG (MathJax, code fallback if absent)
  const math = new Map();
  await Promise.all(
    ofType('math').map(async (b, k) => {
      const out = await renderMath(b.source);
      if (out) {
        math.set(b, {
          ...localImage(writeTmpPng(tmp(), `math-${k}`, out.png)),
          displayW: out.displayW,
          displayH: out.displayH,
          // MathJax's own MathML for the same expression — the source of the
          // native OMML half. Null when MathJax declined to serialise it, in
          // which case the equation simply stays the picture it is here.
          mathml: out.mathml ?? null,
        });
        // MathJax sizes its root in `ex`, a unit that resolves against nothing
        // in a standalone part: rewrite it in px, exactly as htmlMath does
        keepVector(
          b,
          out.svg.replace(/^<svg[^>]*>/, (tag) =>
            tag
              .replace(/width="[^"]+"/, `width="${out.displayW.toFixed(1)}px"`)
              .replace(/height="[^"]+"/, `height="${out.displayH.toFixed(1)}px"`),
          ),
        );
      }
    }),
  );

  // Charts → SVG at the dimensions of the slot, rasterized at 2× for sharpness
  const charts = new Map();
  const chartEls = scenes.flatMap((sc) => sc.elements.filter((e) => e.block.type === 'chart'));
  await Promise.all(
    chartEls.map(async (e, k) => {
      const svg = chartSvg(e.block, e.region.w, e.region.h);
      const out = await svgToPng(svg, e.region.w * 2);
      if (out) {
        charts.set(e.block, writeTmpPng(tmp(), `chart-${k}`, out.png));
        // in-house and already entity-escaped by chart.mjs, but it goes through
        // the same gate as the rest: one rule, no exceptions to remember
        keepVector(e.block, svg);
      }
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
  // Diagrams, in SmartArt mode only. The geometry is computed ONCE here and
  // stored beside the PNG: the placeholder picture, the injected
  // `drawingN.xml` and the native fallback all read this object, so they
  // cannot drift apart the way three separate computations from three
  // separately-passed rectangles eventually would.
  const diagrams = new Map();
  const smartEls = smartart
    ? scenes.flatMap((sc) => sc.elements.filter((e) => e.block.type === 'smartart'))
    : [];
  await Promise.all(
    smartEls.map(async (e, k) => {
      const geometry = smartArtGeometry(e.block, e.region.w, e.region.h);
      const out = await svgToPng(smartArtSvg(e.block, e.region.w, e.region.h), e.region.w * 2);
      if (out)
        diagrams.set(e.block, { png: writeTmpPng(tmp(), `smartart-${k}`, out.png), geometry });
    }),
  );

  const diagnostics = [];
  // Diagrams are deliberately NOT counted here. This message says the blocks
  // were replaced by their specification in TEXT, which is true of a chart, an
  // equation and an icon and never of a diagram: with no PNG, `addSmartArt`
  // falls through to `drawSmartArtShapes` and the diagram is drawn correctly,
  // losing only the editability. Counting one inflated a number the sentence
  // then attributed to the other three.
  const rasterBlocks = chartEls.length + ofType('math').length + iconBlocks.length;
  if (rasterBlocks && !(await rasterAvailable())) {
    diagnostics.push({
      severity: 'error',
      code: 'RASTER_UNAVAILABLE',
      // `count` so that a host which cannot follow the remedy can still say how
      // much was lost without parsing the sentence back apart. The playground is
      // that host: `npm install` is not advice a browser can act on, so it
      // rewrites this one line — and a page that had to regex a count out of
      // prose would go quietly wrong the day the wording changed.
      count: rasterBlocks,
      message: `Rasterizer @resvg/resvg-js unavailable — ${rasterBlocks} chart(s), equation(s) or icon(s) are replaced by their specification in text in the .pptx. Reinstall the dependencies on this platform (\`npm install\` in the lutrin package) to restore graphical rendering.`,
    });
  }

  // Taking the diagrams out of the count above must not make their own case
  // silent: the conversion needs a stand-in picture, so with no rasterizer
  // `--smartart` asks for something that cannot happen. Its own severity,
  // because nothing is missing from the slide — the diagram is drawn, and only
  // the editability that was the whole point of the flag is gone.
  if (smartart && smartEls.length && !diagrams.size)
    diagnostics.push({
      severity: 'warning',
      code: 'SMARTART_UNAVAILABLE',
      message: `Rasterizer @resvg/resvg-js unavailable — ${smartEls.length} diagram(s) are drawn as native shapes instead of editable SmartArt. The slides are complete; only the SmartArt object asked for by \`--smartart\` is missing.`,
    });

  // trust roots of the local images: directory of the deck + project
  // roots declared by the host (containment — assets.mjs)
  const imageRoots = [baseDir, ...(opts.imageRoots ?? [])];
  // equations: how many were drawn, and how many of those got an exact OMML.
  // The gap is the number that degraded to a picture, and it is reported —
  // "some of your equations are not editable" is a fact the author needs,
  // exactly like the missing-rasterizer message.
  const equationCount = { total: 0, native: 0 };
  const ctx = {
    baseDir,
    imageRoots,
    mermaid,
    remote,
    icons,
    math,
    charts,
    vectorSvg,
    diagrams,
    equations: equationCount,
  };

  const slideAnims = new Map(); // slide no. (1-based) → log of the shapes
  const slideVectors = new Map(); // slide no. (1-based) → [{ name, svg }]
  const slideDiagrams = new Map(); // slide no. (1-based) → [{ name, payload }]
  const slideEquations = new Map(); // slide no. (1-based) → [{ name, omml }]
  scenes.forEach((scene, sceneIdx) => {
    let slide;
    if (scene.master === 'cover') slide = renderCover(pptx, scene);
    else if (scene.master === 'section') slide = renderSection(pptx, scene, ctx, brand);
    else {
      slide = pptx.addSlide({ masterName: 'DECK_CONTENT' });
      // animated slide: log every shape written (chrome included, as null)
      const rec = scene.animSteps ? [] : null;
      let cur = null;
      let shapeLabel = 'Content';
      const vectors = [];
      const diagramShapes = [];
      const equationShapes = [];
      const target = wrapSlide(slide, {
        label: () => shapeLabel,
        rec,
        current: () => cur,
        equations: equationShapes,
        vectors,
        diagrams: diagramShapes,
      });
      if (scene.master === 'hero' && scene.image) {
        addImage(target, scene.image, { x: 0, y: 0, w: PAGE.width, h: PAGE.height }, ctx);
        // the full-frame image covers the master's chrome, attribution included:
        // this layout gets its own copy, written after the image. Through
        // `target` and not `slide` so the shape is logged in `rec` — anim.mjs
        // demands an exact shape count and would give up on a mismatch.
        if (brand) {
          shapeLabel = 'Lutrin attribution';
          target.addText(brand, brandTextOptions('content'));
        }
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
        scene.titleRuns
          ? toRuns(scene.titleRuns, { bold: true, fontFace: displayFace() })
          : (scene.title ?? ''),
        {
          placeholder: 'title',
          ...contentTitleBox(),
          fontSize: TYPE.slideTitle,
          bold: true,
          color: COLORS.neutralPrimary,
          fontFace: displayFace(),
          align: 'left', // same inheritance trap as the cover title
          valign: 'middle',
        },
      );
      for (const el of scene.elements) {
        // kind → choice of the entrance effect (anim.mjs, PRESET_BY_KIND)
        //
        // A diagram about to become a `<p:graphicFrame>` is NOT animated: the
        // frame replaces the picture after the timing tree has been written,
        // and an entrance effect pointing at a shape that has changed identity
        // is the kind of mismatch anim.mjs answers by dropping every animation
        // on the slide. The HTML twin keeps its reveal; that divergence is
        // documented rather than papered over.
        cur =
          el.step != null && !(smartart && el.block.type === 'smartart')
            ? { step: el.step, paras: el.stepCount, kind: el.block.type }
            : null;
        shapeLabel = SHAPE_LABELS[el.block.type] ?? 'Content';
        const fn = BLOCK_RENDERERS[el.block.type];
        if (fn) fn(target, el.block, el.region, ctx);
      }
      // provenance line (<!-- source: … -->): chrome, never a step — `cur`
      // is reset first, or the shape would ride the LAST element's animation
      // and anim.mjs would pair it with a step the scene never declared
      if (scene.source) {
        cur = null;
        shapeLabel = 'Source';
        const b = sourceLineBox();
        target.addText(scene.source, {
          x: px(b.x),
          y: px(b.y),
          w: px(b.w),
          h: px(b.h),
          fontSize: TYPE.caption,
          fontFace: FONTS.body,
          color: COLORS.neutralSecondary,
          align: 'left',
          valign: 'middle',
        });
      }
      if (rec?.some(Boolean))
        slideAnims.set(sceneIdx + 1, { entries: rec, preset: scene.animPreset ?? null });
      if (vectors.length) slideVectors.set(sceneIdx + 1, vectors);
      if (diagramShapes.length) slideDiagrams.set(sceneIdx + 1, diagramShapes);
      if (equationShapes.length) slideEquations.set(sceneIdx + 1, equationShapes);
    }
    if (scene.notes?.length) slide.addNotes(scene.notes.join('\n'));
  });

  // Morph chains: maximal runs of CONSECUTIVE slides showing the same title,
  // as 1-based numbers. Two sources, one rule — the pages of a paginated slide
  // (identical up to the "(cont.)" suffix, hence titleKey) and the slides an
  // author deliberately gave the same title. The transition is placed on every
  // slide of the run but the first.
  //
  // Consecutive only. A title that comes back on slide 3 and slide 20 is not a
  // continuity, it is a coincidence: morphing there would dissolve slide 19
  // into slide 20 for 700 ms for no reason.
  //
  // With no title there is nothing to pair: the !!title renaming would match
  // two unrelated content blocks, so an untitled slide breaks the run.
  const morphKey = (s) => {
    const t = s.titleKey ?? s.title;
    // trimmed: leading and trailing space is INVISIBLE on the slide, so
    // refusing to pair on it would be a failure the author cannot see. Case
    // and inner spacing are visible — they are left to mean what they say.
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  };
  const chains = [];
  let run = null;
  scenes.forEach((s, i) => {
    const key = morphKey(s);
    if (key && run?.key === key) run.nums.push(i + 1);
    else run = key ? { key, nums: [i + 1] } : null;
    // registered as soon as it holds two slides; `nums` keeps growing by
    // reference afterwards, so a run of three or four extends the same chain
    if (run?.nums.length === 2) chains.push(run.nums);
  });

  // `pptx.write()` and not `pptx.writeFile()`: the latter branches on the
  // runtime and, off Node, pushes a DOWNLOAD instead of writing a file — the
  // playground would get a half-finished package before a single post-pass had
  // run. Asking for the bytes and writing them ourselves is the same zip
  // (`writeFile` defers to the same `generateAsync({ type })`, uncompressed
  // either way, and the passes below re-deflate it) and behaves identically
  // wherever `fs` does.
  fs.writeFileSync(outPath, await pptx.write({ outputType: ZIP_BYTES }));
  const phTitles = await canonicalizeTitlePlaceholders(outPath);
  const titles = await embedSlideTitles(
    outPath,
    scenes.map((s) => s.title ?? null),
  );
  const fonts = await embedFonts(outPath);
  const morph = await embedMorph(outPath, chains);
  const anims = await embedAnimations(outPath, slideAnims);
  const vectors = await embedVectorImages(outPath, slideVectors);
  // The last two REPLACE shapes: every pass above addresses the slide XML by
  // shape name or by order, and swapping a `<p:pic>` for something else is the
  // one edit that changes what those passes would have found. Equations run
  // after `embedVectorImages` on purpose — the blip fill they lift into the
  // fallback then already carries its vector twin.
  const equations = await embedEquations(outPath, slideEquations);
  const smartArt = await embedSmartArt(outPath, slideDiagrams);
  // dead last, and unconditional: every pass above may rewrite the zip, and
  // each round-trip carries JSZip's directory entries forward. Tidying before
  // one of them ran would simply put them back.
  await dropDirectoryEntries(outPath);
  return {
    slideCount: scenes.length,
    titledSlides: titles.count,
    fontsEmbedded: fonts.count,
    embeddedFontFamilies: fonts.families,
    animatedSlides: anims.count,
    morphSlides: morph.count,
    vectorImages: vectors.count,
    smartArtDiagrams: smartArt.count,
    nativeEquations: equations.count,
    // drawn vs converted — the difference is what stayed a picture, and it is
    // reported rather than inferred: `omml.mjs` refusing an expression is a
    // normal outcome, and a silent one would be a lie about editability
    equationsDrawn: equationCount.total,
    equationsConverted: equationCount.native,
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
      ...vectors.warnings,
      ...equations.warnings,
      ...smartArt.warnings,
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
