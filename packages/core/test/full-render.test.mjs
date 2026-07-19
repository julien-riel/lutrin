/**
 * Scenes → deliverable translation, for the SIXTEEN block types.
 *
 * This file fills a measured hole: the suite froze the IR (goldens), the
 * geometry (blockHeight) and the parity of the dispatch tables, but half of
 * the BLOCK_RENDERERS entries were called by NO test at all. Instrumenting
 * both tables and running the whole suite counted 7 types never rendered on
 * the PPTX side (code, table, alert, metric, quote, mermaid, math) and 9 on
 * the HTML side (the same ones plus image, icon, chart). Breaking `addTable`
 * therefore passed 396/396, with lint and typecheck clean: the defect showed
 * up only when the author opened the .pptx, in a meeting.
 *
 * The net laid here:
 *   - a hermetic fixture (test/fixtures/all-blocks.deck.md) where every block
 *     type carries a `ZQ…` marker that exists nowhere else;
 *   - the deck really is passed to renderDeck() and renderDeckHtml(), and then
 *     those markers are looked for IN THE OUTPUT — the slide XML for the
 *     .pptx (archive reopened, as in pptx-e2e.test.mjs), the document for the
 *     HTML. A marker can only appear if the block was rendered: that is
 *     precisely what the earlier assertions lacked, since they made do with
 *     counting slides.
 *
 * The purely graphical blocks (panel, timeline-axis, timeline-dot) have no
 * text of their own: their marker is the primitive they alone write on THEIR
 * slide (roundRect, ellipse, triangle; class="panel", tl-dot, tl-axis). The
 * assertion therefore stays discriminating — it bears on a single slide, not
 * on the whole document.
 *
 * The optional dependencies are exercised IN BOTH DIRECTIONS: with the
 * rasterizer (chart and math become images) and without, via
 * LUTRIN_NO_RASTER (fallback to a code block). The fallback is not a
 * degenerate case — it is a code path in its own right, and it is the one
 * that produced a major defect.
 */

import './setup.mjs'; // hermetic even on direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeck } from '../src/pptx/render.mjs';
import { renderDeckHtml } from '../src/html/render.mjs';
import { rasterAvailable, renderMermaidCached } from '../src/deck/assets.mjs';
import { SEMANTIC } from '../src/deck/tokens.mjs';
import { ALL_BLOCKS_DIR, readAllBlocks } from './helpers.mjs';

/** mmdc is an optional peerDependency: without it, `mermaid` switches to its
 *  faithful fallback (source in a code block). Both branches have a marker,
 *  but one has to know which one to require — otherwise the assertion becomes
 *  an alternative, that is to say very nearly nothing. */
const mermaidAvailable = () =>
  renderMermaidCached('flowchart LR\n  A[Probe] --> B[End]\n', {
    format: 'png',
    baseDir: ALL_BLOCKS_DIR,
  }) !== null;

/** Renders the fixture in both formats, in a throwaway directory.
 *  `withoutRaster` reproduces a missing @resvg/resvg-js (VSIX built on one
 *  platform, installed on another) — see pptx-e2e.test.mjs. */
async function renderFixture(t, { withoutRaster = false } = {}) {
  if (withoutRaster) {
    const previous = process.env.LUTRIN_NO_RASTER;
    process.env.LUTRIN_NO_RASTER = '1';
    t.after(() => {
      if (previous === undefined) delete process.env.LUTRIN_NO_RASTER;
      else process.env.LUTRIN_NO_RASTER = previous;
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-blocks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const deck = parseDeck(readAllBlocks());
  const scenes = buildScenes(deck);
  const out = path.join(dir, 'blocks.pptx');
  // baseDir = the fixture's directory: that is where pixel.png resolves from
  const stats = await renderDeck(scenes, deck.meta, ALL_BLOCKS_DIR, out);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const { html, stats: htmlStats } = await renderDeckHtml(scenes, deck.meta, ALL_BLOCKS_DIR);

  /** XML of the slide carrying this title — the assertion targets ONE slide,
   *  not the document: searching everywhere would dilute the marker. */
  const xmlOf = async (title) => {
    const i = scenes.findIndex((s) => s.title === title);
    assert.notEqual(i, -1, `the fixture no longer contains a slide "${title}"`);
    const part = zip.file(`ppt/slides/slide${i + 1}.xml`);
    assert.ok(part, `slide ${i + 1} missing from the archive`);
    return part.async('string');
  };

  // same principle on the HTML side: an assertion bearing on the whole
  // document lets itself be satisfied by any other slide, and its failure
  // spits out 40 kB of stylesheet. So we cut it up by slide.
  const fragments = html.split('<div class="slide-frame"');
  const htmlOf = (title) => {
    const i = scenes.findIndex((s) => s.title === title);
    assert.notEqual(i, -1, `the fixture no longer contains a slide "${title}"`);
    const f = fragments[i + 1]; // [0] = everything preceding the first slide
    assert.ok(f, `HTML fragment of slide ${i + 1} missing`);
    return f;
  };

  return { dir, out, deck, scenes, stats, zip, html, htmlStats, xmlOf, htmlOf };
}

/** ORDER assertion: the markers looked for all appear in `text`, and in the
 *  given sequence. Looking for PRESENCE alone lets a permutation through —
 *  two header columns swapped, two milestones renumbered — that is to say
 *  precisely the defect that shows only when the file is opened. */
function assertOrder(text, markers, message) {
  let prevIndex = -1;
  let previousMarker = null;
  for (const m of markers) {
    const i = text.indexOf(m, 0);
    assert.notEqual(i, -1, `${message}: "${m}" not found`);
    assert.ok(i > prevIndex, `${message}: "${m}" precedes "${previousMarker}", order reversed`);
    prevIndex = i;
    previousMarker = m;
  }
}

/** First row of an OOXML table: column order is asserted ON the header row,
 *  not on the whole slide. */
function firstLine(xml) {
  const m = xml.match(/<a:tr[\s\S]*?<\/a:tr>/);
  assert.ok(m, 'no table row in this XML');
  return m[0];
}

// ---------------------------------------------------------------------------
// PPTX: every block type leaves its trace in the XML of ITS slide
// ---------------------------------------------------------------------------

test('pptx: each of the sixteen block types leaves its marker in the XML', async (t) => {
  const { stats, zip, xmlOf } = await renderFixture(t);
  assert.deepEqual(stats.warnings, [], 'the fixture must compile without giving anything up');

  // para, heading, bullets
  assert.match(await xmlOf('Paragraph and bullets'), /ZQPARA/, 'para');
  assert.match(await xmlOf('Paragraph and bullets'), /ZQBULLET/, 'bullets');
  assert.match(await xmlOf('Pillars'), /ZQHEADING2/, 'heading');

  // table: the header AND a cell of the last row — a column or a row lost in
  // addTable then shows, which a bare <a:tbl> does not tell you
  const table = await xmlOf('Table');
  assert.match(table, /<a:tbl>/, 'table: the OOXML table itself');
  assert.match(table, /ZQHEADER/, 'table: header cell');
  assert.match(table, /ZQCELL/, 'table: first body cell');
  assert.match(table, /ZQLAST/, 'table: last cell of the last row');
  // …and in THIS ORDER: two swapped columns keep both their markers, and the
  // defect then shows only when the file is opened
  assertOrder(
    firstLine(table),
    ['Column ZQHEADER<', 'Column ZQHEADER2<'],
    'table: order of the header columns',
  );

  assert.match(await xmlOf('Code'), /ZQCODE/, 'code');

  // alert: the CONTENT says nothing about the MEANING. A `:::warning`
  // rendered as "info" stays green if one only looks for the marker — a
  // contradiction visible in the meeting. So we require the label AND the
  // tint of the REAL type, on two callouts of different types so that no
  // single defect can satisfy both.
  const callout = await xmlOf('Callout');
  assert.match(callout, /ZQALERT/, 'alert: the content of the first callout');
  assert.match(callout, /ZQSUCCESS/, 'alert: the content of the second callout');
  assert.match(callout, /<a:t>Caution<\/a:t>/, 'alert: semantic label of :::warning');
  assert.match(callout, /<a:t>Key point<\/a:t>/, 'alert: semantic label of :::success');
  assert.match(
    callout,
    new RegExp(`srgbClr val="${SEMANTIC.warning.fill}"`),
    'alert: background tint of :::warning',
  );
  assert.match(
    callout,
    new RegExp(`srgbClr val="${SEMANTIC.success.fill}"`),
    'alert: background tint of :::success',
  );

  // metric: the three texts the block produces — the value first, since it is
  // the one carrying the information and it went through an uncovered path
  const metric = await xmlOf('Metric');
  assert.match(metric, /ZQVALUE/, 'metric: the value');
  assert.match(metric, /ZQLABEL/, 'metric: the label');
  assert.match(metric, /ZQTREND/, 'metric: the trend');

  const quote = await xmlOf('Quote');
  assert.match(quote, /ZQQUOTE/, 'quote: the text');
  assert.match(quote, /ZQSOURCE/, 'quote: the attribution');

  // image and icon: the alt text lands in `descr` (see altOf)
  const figures = await xmlOf('Image and icon');
  assert.match(figures, /descr="Sample image ZQIMAGE"/, 'image');
  assert.match(figures, /descr="Icon coffee"/, 'icon');

  // math: rasterizer present → an image whose alt text is the LaTeX source;
  // absent → the source in a code block (another test)
  const equation = await xmlOf('Equation');
  if (await rasterAvailable()) {
    assert.match(equation, /descr="Equation: E_\{ZQMATH\} = mc\^2"/, 'math: image + LaTeX alt');
    assert.match(await xmlOf('Chart'), /descr="Chart bar/, 'chart: image');
    const media = Object.keys(zip.files).filter((f) => /^ppt\/media\/.*\.png$/.test(f));
    assert.ok(media.length >= 3, `pixel, icon, equation, chart: ${media.join(', ')}`);
  } else {
    t.diagnostic('@resvg/resvg-js missing: chart and math checked through their fallback only');
    assert.match(equation, /ZQMATH/, 'math: fallback to a code block');
    assert.match(await xmlOf('Chart'), /ZQSERIES/, 'chart: fallback to a code block');
  }

  // mermaid: mmdc is optional, both branches have their marker
  const diagram = await xmlOf('Diagram');
  if (mermaidAvailable()) {
    assert.match(diagram, /descr="Mermaid diagram"/, 'mermaid: PNG rendered by mmdc');
  } else {
    assert.match(diagram, /ZQMERMAID/, 'mermaid: fallback, the source stays readable');
    assert.match(diagram, /install @mermaid-js\/mermaid-cli/, 'mermaid: mention of the fallback');
  }

  // panel, timeline-axis, timeline-dot: no text of their own — the marker is
  // the primitive they alone write ON THIS slide
  assert.match(await xmlOf('Pillars'), /prst="roundRect"/, 'panel: the pillar frame');
  const markers = await xmlOf('Milestones');
  assert.match(markers, /prst="ellipse"/, 'timeline-dot: the dot');
  assert.match(markers, /prst="triangle"/, 'timeline-axis: the arrowhead');
  // the dot carries a NUMBER: a milestone numbered 2-3 instead of 1-2 is a
  // content error, not a style one — it must go red here
  assertOrder(
    markers,
    ['<a:t>1</a:t>', '<a:t>ZQMILESTONE</a:t>', '<a:t>2</a:t>'],
    'timeline-dot: numbering of the milestones',
  );
});

// ---------------------------------------------------------------------------
// HTML: the same sixteen types, the same markers, another translation
// ---------------------------------------------------------------------------

test('html: each of the sixteen block types leaves its marker in the document', async (t) => {
  const { htmlStats, htmlOf } = await renderFixture(t);
  assert.deepEqual(htmlStats.warnings, [], 'the fixture must compile without giving anything up');

  const bullets = htmlOf('Paragraph and bullets');
  assert.match(bullets, /class="para el"[^>]*>Sample paragraph ZQPARA/, 'para');
  assert.match(bullets, /<li>Sample bullet ZQBULLET<\/li>/, 'bullets: the bullet, in its <li>');
  assert.match(htmlOf('Pillars'), /class="slot-heading el"[^>]*>ZQHEADING2/, 'heading');

  // table: no <a:tbl> here, but the same cells — header, body and last row,
  // so that a lost column or row shows
  const table = htmlOf('Table');
  assert.match(table, /<th>Column ZQHEADER<\/th>/, 'table: header cell');
  assert.match(table, /<td>Cell ZQCELL<\/td>/, 'table: first body cell');
  assert.match(table, /<td>ZQLAST<\/td>/, 'table: last cell of the last row');
  // both headers on the SAME row, the right way round: a column permutation
  // keeps both markers and would show only when the file is opened
  assert.match(
    table,
    /<tr><th>Column ZQHEADER<\/th><th>Column ZQHEADER2<\/th><\/tr>/,
    'table: order of the header columns',
  );

  assert.match(htmlOf('Code'), /class="code el"[\s\S]*ZQCODE/, 'code');

  // alert: `class="alert[^"]*"` was a wildcard that `alert-info` satisfied —
  // a warning rendered as an information went green. We require the REAL type
  // and its label, on two callouts of different types.
  const callout = htmlOf('Callout');
  assert.match(
    callout,
    /class="alert alert-warning el"[^>]*><div class="alert-label">Caution<\/div><p>Sample callout ZQALERT\./,
    'alert: :::warning rendered as a warning',
  );
  assert.match(
    callout,
    /class="alert alert-success el"[^>]*><div class="alert-label">Key point<\/div><p>Second sample callout ZQSUCCESS\./,
    'alert: :::success rendered as a success',
  );
  assert.doesNotMatch(callout, /alert-info/, 'alert: no callout falls back to the default type');

  const metric = htmlOf('Metric');
  assert.match(metric, /class="metric-value">ZQVALUE</, 'metric: the value');
  assert.match(metric, /class="metric-label">Sample metric ZQLABEL</, 'metric: label');
  assert.match(metric, /class="metric-trend"[^>]*>[^<]*ZQTREND/, 'metric: the trend');

  const quote = htmlOf('Quote');
  assert.match(quote, /<blockquote>Sample quote ZQQUOTE\.<\/blockquote>/, 'quote: text');
  assert.match(quote, /<figcaption>— Source ZQSOURCE<\/figcaption>/, 'quote: the attribution');

  const figures = htmlOf('Image and icon');
  assert.match(figures, /<img[^>]*alt="Sample image ZQIMAGE"/, 'image');
  assert.match(figures, /class="icon-box"[^>]*>\s*<svg/, 'icon: the inlined SVG');

  // math: MathJax typesets in paths, not in text — the marker is the glyph
  // U+1D438 (mathematical italic E), which can only come from THIS LaTeX
  assert.match(htmlOf('Equation'), /MJX-\d+-TEX-I-1D438/, 'math: the "E" typeset by MathJax');

  // chart: the in-house SVG writes the series names in its legend
  const chart = htmlOf('Chart');
  assert.match(chart, />ZQSERIES</, 'chart: series name in the legend');
  assert.match(chart, />ZQOTHERSERIES</, 'chart: second series');

  const diagram = htmlOf('Diagram');
  if (mermaidAvailable()) {
    assert.match(diagram, /class="figure mermaid el"[\s\S]*ZQMERMAID/, 'mermaid: inlined SVG');
  } else {
    assert.match(diagram, /ZQMERMAID/, 'mermaid: fallback, the source stays readable');
    assert.match(diagram, /install @mermaid-js\/mermaid-cli/, 'mermaid: mention of the fallback');
  }

  assert.match(htmlOf('Pillars'), /class="panel el"/, 'panel');
  const markers = htmlOf('Milestones');
  assert.match(markers, /class="tl-dot el"/, 'timeline-dot');
  assert.match(markers, /class="tl-axis el"/, 'timeline-axis');
  // the class alone does not say what the dot DISPLAYS: we assert the
  // number, and its order (1 then 2, not 2 then 3)
  assert.match(
    markers,
    /class="tl-dot el"[^>]*>1<\/div>[\s\S]*class="tl-dot el"[^>]*>2<\/div>/,
    'timeline-dot: numbering of the milestones',
  );
});

// ---------------------------------------------------------------------------
// Rasterizer missing: the fallback is a code path, not an accident
// ---------------------------------------------------------------------------

// It is that path — and not the nominal one — that produced defect M6.2:
// without a net, a broken fallback shows only when the file is opened, on the
// machine where the rasterizer is missing, that is to say never here.
test('pptx without a rasterizer: chart and math fall back to their source, readably', async (t) => {
  const { stats, xmlOf } = await renderFixture(t, { withoutRaster: true });

  const chart = await xmlOf('Chart');
  assert.match(chart, /ZQSERIES/, 'chart: the series name survives in the fallback');
  assert.match(chart, /ZQOTHERSERIES/, 'chart: the second series too');
  assert.doesNotMatch(chart, /descr="Chart/, 'no image: the rasterizer is missing');

  assert.match(
    await xmlOf('Equation'),
    /ZQMATH/,
    'math: the LaTeX source survives in the fallback',
  );

  // and the truncation must be SAID — a silently degraded export is worse
  // than a refused export (see pptx-e2e.test.mjs)
  const d = stats.diagnostics.find((x) => x.code === 'RASTER_UNAVAILABLE');
  assert.ok(d, `diagnostic expected, got: ${JSON.stringify(stats.diagnostics)}`);
  assert.ok(stats.warnings.includes(d.message), 'the diagnostic must reach the user');

  // the rest of the deck must not be carried off by the missing rasterizer
  assert.match(await xmlOf('Table'), /ZQCELL/, 'the table is rendered all the same');
  assert.match(await xmlOf('Metric'), /ZQVALUE/, 'the metric too');
});

// ---------------------------------------------------------------------------
// HTML: the same fallbacks, exercised WITHOUT DEPENDING on the machine
// ---------------------------------------------------------------------------

/**
 * HTML counterpart of the previous test. What was missing: htmlMath,
 * htmlImage and htmlMermaid could return an empty string in their fallback
 * without any test flinching. And the mermaid fallback was covered only
 * because mmdc is missing from THIS machine — a net that depends on what is
 * installed is not a net.
 *
 * So the three fallbacks are triggered by CONTENT, which is true everywhere:
 * an image that does not exist, a LaTeX that MathJax refuses (mathSvg returns
 * null on data-mjx-error), a Mermaid source mmdc cannot compile.
 * LUTRIN_NO_RASTER is set on top, to check in passing that the HTML — which
 * composes its charts in SVG — does not depend on the rasterizer.
 */
const DECK_FALLBACKS = `---
title: HTML fallbacks
---

# Missing image

![Sample image ZQMISSING](not-found-zq.png)

# Impossible equation

\`\`\`math
\\frac{ZQMATHFALLBACK
\`\`\`

# Impossible diagram

\`\`\`mermaid
flowchart LR
  ZQMERMAIDFALLBACK[[[[
\`\`\`
`;

test('html without optional dependencies: image, math and mermaid fall back readably', async (t) => {
  const previous = process.env.LUTRIN_NO_RASTER;
  process.env.LUTRIN_NO_RASTER = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.LUTRIN_NO_RASTER;
    else process.env.LUTRIN_NO_RASTER = previous;
  });

  const deck = parseDeck(DECK_FALLBACKS);
  const scenes = buildScenes(deck);
  const { html } = await renderDeckHtml(scenes, deck.meta, ALL_BLOCKS_DIR);
  const fragments = html.split('<div class="slide-frame"');
  const htmlOf = (title) => {
    const i = scenes.findIndex((s) => s.title === title);
    assert.notEqual(i, -1, `the fallback deck no longer contains "${title}"`);
    return fragments[i + 1];
  };

  // image not found: a NAMED placeholder, not a hole — the author must see
  // which of their images is missing
  assert.match(
    htmlOf('Missing image'),
    /class="placeholder el"[^>]*><span>\[image: Sample image ZQMISSING\]<\/span>/,
    'image: the replacement placeholder names the missing file',
  );

  // math: the LaTeX source stays readable, and the truncation is SAID
  const equation = htmlOf('Impossible equation');
  assert.match(equation, /class="code el"[\s\S]*ZQMATHFALLBACK/, 'math: the source survives');
  assert.match(
    equation,
    /class="fallback-caption el"[^>]*>LaTeX equation — install mathjax-full/,
    'math: mention of the fallback',
  );

  // mermaid: same, and this time independently of whether mmdc is present
  const diagram = htmlOf('Impossible diagram');
  assert.match(diagram, /class="code el"[\s\S]*ZQMERMAIDFALLBACK/, 'mermaid: the source survives');
  assert.match(
    diagram,
    /class="fallback-caption el"[^>]*>Mermaid diagram — install @mermaid-js\/mermaid-cli/,
    'mermaid: mention of the fallback',
  );
});
