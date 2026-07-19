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
// deck containing all sixteen types. So we count the calls, at the source.
test('rendering the fixture ACTUALLY calls each of the sixteen entries, in both formats', async (t) => {
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

test('blockHeight returns a finite number for every block of the demo', () => {
  const scenes = buildScenes(parseDeck(readDemo()));
  for (const scene of scenes) {
    for (const el of scene.elements) {
      const h = blockHeight(el.block, el.region.w);
      assert.ok(Number.isFinite(h) && h >= 0, `invalid height for "${el.block.type}": ${h}`);
    }
  }
});
