/**
 * PDF and image export: the artefacts a browser prints.
 *
 * ONE BROWSER LAUNCH PER TEST, AND AS FEW TESTS AS THE ASSERTIONS ALLOW. Node's
 * runner executes test FILES in parallel — as many as there are cores — so
 * every launch here competes with the Chrome `full-render.test.mjs` starts for
 * Mermaid. The first version of this file made five, and the Mermaid assertion
 * on the Windows runner went from intermittently red to reliably so, its
 * duration climbing 49 s → 70 s → 102 s as the contention grew. Three launches
 * is the floor the three output formats impose.
 *
 * These run for real across the whole CI matrix — the runners ship a Chromium
 * and `browser.mjs` finds it, which is the same reason the Mermaid tests
 * render rather than skip. Where no browser exists the suite skips rather than
 * fails: the export legitimately does not happen there, and painting a
 * platform gap as a regression is how a test stops being read.
 *
 * What is asserted is what a reader would notice: the file is a PDF, it has
 * one page per slide, it carries an outline naming the slides, and the images
 * are the slide at twice its size with none of the on-screen chrome.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeckHtml } from '../src/html/render.mjs';
import { renderDeckPdf, renderDeckImages, pdfAvailable } from '../src/pdf/render.mjs';
import { PAGE } from '../src/deck/tokens.mjs';

const SOURCE = `---
title: Export probe
---

# First slide

- A bullet nobody will read

# Second slide

<!-- layout: cycle -->

## Plan

## Build

## Ship
`;

/** The deck as the standalone document every export starts from. */
async function deckHtml() {
  const deck = parseDeck(SOURCE);
  const scenes = buildScenes(deck);
  const out = await renderDeckHtml(scenes, deck.meta, process.cwd(), {});
  return { html: out.html, slides: scenes.length };
}

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pdf-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Skips instead of failing where no browser exists. */
function browserOr(t) {
  if (!pdfAvailable()) {
    t.skip('no Chromium-based browser on this machine');
    return false;
  }
  return true;
}

test('pdf: one page per slide, really a PDF, and an outline that names them', async (t) => {
  if (!browserOr(t)) return;
  const { html, slides } = await deckHtml();
  const out = path.join(tmpDir(t), 'deck.pdf');

  const r = await renderDeckPdf(html, out);
  assert.ok(fs.existsSync(out), 'no file written');
  const buf = fs.readFileSync(out);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-', 'not a PDF');
  assert.equal(r.pages, slides, `${r.pages} page(s) for ${slides} slide(s)`);
  assert.deepEqual(r.warnings, [], 'a clean export says nothing');

  // The outline is the whole reason this module exists: hand-printing already
  // gave a correct handout, with nothing to navigate by.
  assert.equal(r.outline, true, 'no outline in the PDF');
  const text = buf.toString('latin1');
  // OUTLINE ITEMS specifically. `/Title` also names the document in the Info
  // dictionary, so matching it anywhere counts the deck title as an outline
  // entry — which is what the first version of this did, and it reported the
  // cover twice. An outline item is the object that also carries `/Parent`.
  const items = [...text.matchAll(/<<[^<>]*\/Title\s*\(([^)]*)\)[^<>]*>>/g)]
    .filter((m) => m[0].includes('/Parent'))
    .map((m) => m[1]);
  assert.ok(items.includes('First slide'), `outline items: ${items.join(', ')}`);
  assert.ok(items.includes('Second slide'), `outline items: ${items.join(', ')}`);
  // the cover appears ONCE: it already carries an <h1>, so the injected
  // heading must skip it rather than list the slide twice
  assert.equal(
    items.filter((x) => x === 'Export probe').length,
    1,
    `the cover is listed ${items.filter((x) => x === 'Export probe').length} times: ${items.join(', ')}`,
  );
});

test('images: one file per slide, at twice the slide size', async (t) => {
  if (!browserOr(t)) return;
  const { html, slides } = await deckHtml();
  const stem = path.join(tmpDir(t), 'frame');

  const r = await renderDeckImages(html, stem, { format: 'png' });
  assert.equal(r.count, slides);
  assert.deepEqual(
    r.files.map((f) => path.basename(f)),
    Array.from({ length: slides }, (_, i) => `frame-${String(i + 1).padStart(2, '0')}.png`),
    'the numbering is zero-padded and one-based',
  );
  for (const file of r.files) {
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', `${file} is not a PNG`);
    // IHDR carries the dimensions at a fixed offset
    assert.equal(buf.readUInt32BE(16), PAGE.width * 2, `${file}: width`);
    assert.equal(buf.readUInt32BE(20), PAGE.height * 2, `${file}: height`);
  }

  // The export reads the PRINT stylesheet, which is what keeps the on-screen
  // chrome out of it: the first version shipped images with "P: presentation
  // mode · ?: help" sitting over the attribution, because a screenshot is not
  // an impression. Asserted through the stylesheet rather than the pixels —
  // comparing images would fail on a font hint.
  assert.ok(html.includes('present-hint'), 'the fixture must really contain the chrome');
  assert.match(
    html,
    /@media print\{\.present-hint,\.present-help,\.present-nav,\.present-bar\{display:none\}\}/,
  );
});

test('images: JPEG is a JPEG', async (t) => {
  if (!browserOr(t)) return;
  const { html } = await deckHtml();
  const stem = path.join(tmpDir(t), 'shot');
  const r = await renderDeckImages(html, stem, { format: 'jpeg' });
  assert.ok(r.count > 0);
  const buf = fs.readFileSync(r.files[0]);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8, 'not a JPEG');
  assert.match(r.files[0], /\.jpeg$/);
});
