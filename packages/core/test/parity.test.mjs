/**
 * Parity of the two renderers: the architecture requires every block type to
 * be implemented twice (PPTX and HTML). Any divergence between the dispatch
 * tables would be silent at runtime — this is where it breaks instead.
 *
 * Three distinct safety nets, not to be confused (confusing them once cost us dearly):
 *   1. the two tables declare the same keys;
 *   2. the demo deck produces one block of each type — a net over GEOMETRY
 *      alone (buildScenes, blockHeight);
 *   3. every entry of both tables is ACTUALLY CALLED when a deck is rendered —
 *      the render net.
 *
 * No. 2 long presented itself as a "total coverage fixture". It was not: the
 * demo deck was never passed to renderDeck() nor to renderDeckHtml(), and
 * instrumenting the two tables showed that 7 entries on the PPTX side and 9 on
 * the HTML side were called by no test in the suite. Hence no. 3, which counts
 * the calls instead of assuming them — and full-render.test.mjs, which checks
 * what each call writes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOCK_RENDERERS as PPTX } from '../src/pptx/render.mjs';
import { BLOCK_RENDERERS as HTML } from '../src/html/render.mjs';
import { blockHeight } from '../src/deck/layout.mjs';
import { SEMANTIC } from '../src/deck/tokens.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeck } from '../src/pptx/render.mjs';
import { renderDeckHtml } from '../src/html/render.mjs';
import { readDemo, ALL_BLOCKS_DIR, readAllBlocks } from './helpers.mjs';

test('both renderers cover exactly the same block types', () => {
  assert.deepEqual(Object.keys(PPTX).sort(), Object.keys(HTML).sort());
});

// CAUTION: this test covers ONLY geometry. It says the demo contains one block
// of each type, hence that the goldens and blockHeight see them all — it says
// NOTHING about rendering, since the demo is passed to no renderer here.
// The render net is the next test.
test('the demo contains one block of each type (geometry net: goldens, blockHeight)', () => {
  const scenes = buildScenes(parseDeck(readDemo()));
  const types = new Set(scenes.flatMap((s) => s.elements.map((e) => e.block.type)));
  // strict equality both ways: a type added to the renderers without being
  // added to examples/demo.deck.md would fall outside the golden/blockHeight net
  assert.deepEqual([...types].sort(), Object.keys(PPTX).sort());
});

/** Wraps every entry of a dispatch table to record the types actually called,
 *  and returns the restore function. The tables are live objects whose dispatch
 *  re-reads the entries on EVERY block: replacing them in place is enough, and
 *  they must therefore be put back. */
function record(table, seen) {
  const before = { ...table };
  for (const [type, fn] of Object.entries(table)) {
    table[type] = (...args) => {
      seen.add(type);
      return fn(...args);
    };
  }
  return () => Object.assign(table, before);
}

// The net that was missing. An entry of BLOCK_RENDERERS could be deleted,
// emptied or broken without a single test flinching, because nothing rendered a
// deck containing all eighteen types. So we count the calls, at the source.
test('rendering the fixture ACTUALLY calls each of the eighteen entries, in both formats', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-parity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const seenPptx = new Set();
  const seenHtml = new Set();
  const restore = [record(PPTX, seenPptx), record(HTML, seenHtml)];
  t.after(() => {
    for (const r of restore) r();
  });

  const deck = parseDeck(readAllBlocks());
  const scenes = buildScenes(deck);
  await renderDeck(scenes, deck.meta, ALL_BLOCKS_DIR, path.join(dir, 'parity.pptx'));
  await renderDeckHtml(scenes, deck.meta, ALL_BLOCKS_DIR);

  const expected = Object.keys(PPTX).sort();
  assert.deepEqual([...seenPptx].sort(), expected, 'PPTX entries never called by the fixture');
  assert.deepEqual([...seenHtml].sort(), expected, 'HTML entries never called by the fixture');
});

// The text scale (plan 1) is a SIZE that crosses the two renderers: PPTX
// writes it as a fontSize, HTML as an inline font-size. Two literals in two
// files would drift on the first kit that changes `type.body` — hence
// blockFontSize() in deck/tokens.mjs, and hence this net, which reads what
// each side actually emitted for one block of every sizeable type.
test('a `size` on a block reaches both renderers, at the same value', () => {
  const runs = [{ text: 'Scaled text' }];
  const SIZE = 9;
  const blocks = [
    { type: 'para', runs, size: SIZE },
    { type: 'bullets', items: [{ runs, level: 0 }], size: SIZE },
    { type: 'table', header: [runs], rows: [[runs]], size: SIZE },
    { type: 'alert', kind: 'info', blocks: [{ type: 'para', runs }], size: SIZE },
  ];
  const region = { x: 48, y: 120, w: 400, h: 200 };

  for (const block of blocks) {
    const html = HTML[block.type](block, region, {});
    assert.match(
      html,
      new RegExp(`font-size:${SIZE}pt`),
      `HTML "${block.type}" does not emit the size it was given`,
    );

    // the PPTX facade: every renderer goes through addText/addShape/addTable,
    // and it is the fontSize of those calls we compare with the CSS
    const opts = [];
    const slide = {
      addText: (_t, o) => opts.push(o),
      addShape: (_s, o) => opts.push(o),
      addTable: (_r, o) => opts.push(o),
    };
    PPTX[block.type](slide, block, region, {});
    assert.ok(
      opts.some((o) => o.fontSize === SIZE),
      `PPTX "${block.type}" emits no fontSize of ${SIZE} (got ${opts.map((o) => o.fontSize)})`,
    );
    // a size without its matching pitch reintroduces the spcPct bug addPara
    // warns about — the table is the documented exception (no lineSpacing in
    // TableCellProps, see addTable)
    if (block.type !== 'table') {
      const text = opts.find((o) => o.fontSize === SIZE);
      assert.ok(
        text.lineSpacing > SIZE && text.lineSpacing <= SIZE * 1.4,
        `PPTX "${block.type}": fontSize ${SIZE} shipped with lineSpacing ${text.lineSpacing}`,
      );
    }
  }
});

// The panel radius (plan 2) is a GEOMETRY that crosses the two renderers, and
// they express it in different units: CSS border-radius in px, pptxgenjs
// rectRadius in inches. The ternary used to be written twice — one renderer
// could have learned `pill` and the other not. panelRadius() is the single
// source, and this reads back what each side emitted, converted to px.
test('a panel radius describes the same geometry in both renderers', () => {
  const region = { x: 48, y: 120, w: 400, h: 96 };
  const block = { type: 'panel', variant: 'semantic', kind: 'info' };
  // sm/md/lg are tokens; `pill` is the interesting one — half the shorter
  // side, which is the only value that keeps the ends semicircular
  const expected = { sm: 2, md: 4, lg: 8, pill: region.h / 2 };

  for (const [radius, px] of Object.entries(expected)) {
    const html = HTML.panel({ ...block, radius }, region, {});
    assert.match(
      html,
      new RegExp(`border-radius:${px}px`),
      `HTML panel "${radius}": ${px}px expected`,
    );

    const shapes = [];
    PPTX.panel({ addShape: (_s, o) => shapes.push(o) }, { ...block, radius }, region, {});
    assert.equal(
      Math.round(shapes[0].rectRadius * 96 * 1000) / 1000,
      px,
      `PPTX panel "${radius}": rectRadius must be ${px} px expressed in inches`,
    );
  }

  // and with no radius asked for, both keep the variant's own value
  assert.match(HTML.panel(block, region, {}), /border-radius:4px/);
  const shapes = [];
  PPTX.panel({ addShape: (_s, o) => shapes.push(o) }, block, region, {});
  assert.equal(shapes[0].rectRadius * 96, 4);
});

// The column alignment (plan 4) is the one IR field that is INDEXED: the
// delimiter row gives one entry per column, and each renderer has to put it
// back on the right cell. An off-by-one on one side only is exactly the kind
// of divergence nothing else in the suite would see, so this reads back the
// column INDEX each format aligned, not merely that it aligned something.
test('a table column aligns on the same index in both renderers', () => {
  const cell = (t) => [{ text: t }];
  const block = {
    type: 'table',
    header: [cell('Item'), cell('Share'), cell('Amount')],
    rows: [[cell('Licences'), cell('42 %'), cell('1 517')]],
    align: ['left', 'center', 'right'],
  };
  const region = { x: 48, y: 120, w: 800, h: 200 };

  // HTML: the style travels with the cell (no class could select a column of
  // an absolutely positioned table), so the nth cell of each row carries it
  const html = HTML.table(block, region, {});
  // the space is part of the pattern: `<thead>` also starts with "<th"
  const cells = [...html.matchAll(/<t[hd]((?: [^>]*)?)>/g)].map((m) => m[1]);
  assert.equal(cells.length, 6, 'header + one body row, three columns each');
  for (const k of [0, 3]) assert.equal(cells[k], '', 'column 0 is left: no style at all');
  for (const k of [1, 4]) assert.match(cells[k], /text-align:center/);
  for (const k of [2, 5]) assert.match(cells[k], /text-align:right/);

  // PPTX: same alignment, expressed as a cell option
  const tables = [];
  PPTX.table({ addTable: (rows, o) => tables.push({ rows, o }) }, block, region, {});
  assert.equal(tables.length, 1);
  for (const row of tables[0].rows) {
    assert.equal(row[0].options.align, undefined, 'column 0 is left: nothing imposed');
    assert.equal(row[1].options.align, 'center');
    assert.equal(row[2].options.align, 'right');
  }
});

// A progress bar is drawn from four pieces, and the ONE decision that is not
// pure geometry is where the percentage goes: inside the fill when it fits,
// beside it otherwise. Two renderers deciding that separately would put the
// number in two different places in the two deliverables — so the threshold
// lives in deck/tokens.mjs and this reads back what each side did with it.
test('a progress bar puts its percentage in the same place in both renderers', () => {
  const region = { x: 48, y: 120, w: 600, h: 28 };
  const seen = new Set();
  for (const value of [0, 0.02, 0.05, 0.1, 0.5, 1]) {
    const block = { type: 'progress', value, label: 'Form', kind: 'success' };
    const html = HTML.progress(block, region, {});
    // inside the fill the ink is the tint's own, outside it is the deck's:
    // reading the colour back is reading the decision, not restating it
    const htmlInside = html.includes(`color:#${SEMANTIC.success.solidText}`);

    const texts = [];
    PPTX.progress(
      { addShape: () => {}, addText: (t, o) => texts.push({ t, o }) },
      block,
      region,
      {},
    );
    const pct = texts.find((x) => /%/.test(x.t));
    const pptxInside = pct.o.color === SEMANTIC.success.solidText;

    assert.equal(htmlInside, pptxInside, `value ${value}: the two disagree on where the % sits`);
    // …and at the same x, to the pixel (px → inches on the PPTX side)
    const left = Number(html.match(/class="progress-pct" style="left:(-?\d+)px/)[1]);
    assert.equal(Math.round(pct.o.x * 96) - region.x, left, `value ${value}: different x`);
    seen.add(pptxInside);
  }
  assert.equal(seen.size, 2, 'the sweep must exercise BOTH sides of the threshold');
});

// The inline badge (plan 3) is the one feature that DEGRADES rather than
// travels: the HTML gets a pill, the .pptx a run highlight, because DrawingML
// gives a run no rounded background. CONTRIBUTING.md allows that; what it
// forbids is diverging in silence. So this asserts that both renderers emit
// something carrying the SAME semantic tint for the same run — never identity.
test('an inline badge is semantically tinted in both renderers, by different means', () => {
  const region = { x: 48, y: 120, w: 400, h: 60 };
  for (const kind of ['info', 'success', 'warning', 'danger']) {
    const block = { type: 'para', runs: [{ text: 'Owner', badge: kind }] };
    const sem = SEMANTIC[kind];

    const html = HTML.para(block, region, {});
    assert.match(
      html,
      new RegExp(`<span class="badge badge-${kind}">Owner</span>`),
      `HTML: the ${kind} badge must carry its tint as a class`,
    );

    const opts = [];
    PPTX.para({ addText: (t, o) => opts.push({ t, o }) }, block, region, {});
    const run = opts[0].t.find((x) => x.text === 'Owner');
    assert.equal(run.options.highlight, sem.solid, `PPTX: ${kind} highlighted in its tint`);
    assert.equal(run.options.color, sem.solidText, `PPTX: ${kind} ink readable on its highlight`);
  }
  // and a run with no badge gains neither key: an existing deck must not grow
  // a highlight because the feature exists
  const plain = [];
  PPTX.para({ addText: (t) => plain.push(...t) }, { type: 'para', runs: [{ text: 'x' }] }, region);
  assert.equal(plain[0].options.highlight, undefined);
});

test('blockHeight returns a finite number for every block of the demo', () => {
  const scenes = buildScenes(parseDeck(readDemo()));
  for (const scene of scenes) {
    for (const el of scene.elements) {
      const h = blockHeight(el.block, el.region.w);
      assert.ok(Number.isFinite(h) && h >= 0, `invalid height for "${el.block.type}": ${h}`);
    }
  }
});
