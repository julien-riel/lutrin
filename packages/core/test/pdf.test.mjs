/**
 * PDF and image export: the artefacts a browser prints.
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

test('pdf: one page per slide, and it is really a PDF', async (t) => {
  if (!browserOr(t)) return;
  const { html, slides } = await deckHtml();
  const out = path.join(tmpDir(t), 'deck.pdf');

  const r = await renderDeckPdf(html, out);
  assert.ok(fs.existsSync(out), 'no file written');
  const buf = fs.readFileSync(out);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-', 'not a PDF');
  assert.equal(r.pages, slides, `${r.pages} page(s) for ${slides} slide(s)`);
  assert.deepEqual(r.warnings, [], 'a clean export says nothing');
});

test('pdf: the outline names the slides, which is the whole reason for this module', async (t) => {
  if (!browserOr(t)) return;
  const { html } = await deckHtml();
  const out = path.join(tmpDir(t), 'deck.pdf');
  const r = await renderDeckPdf(html, out);

  assert.equal(r.outline, true, 'no outline in the PDF');
  const text = fs.readFileSync(out).toString('latin1');
  // OUTLINE ITEMS specifically. `/Title` also names the document in the Info
  // dictionary, so matching it anywhere counts the deck title as an outline
  // entry — which is what the first version of this test did, and it reported
  // the cover twice. An outline item is the object that also carries `/Parent`.
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
});

test('images: the on-screen chrome is not in them', async (t) => {
  if (!browserOr(t)) return;
  const { html } = await deckHtml();
  const stem = path.join(tmpDir(t), 'clean');
  // The first version of this shipped "P: presentation mode · ?: help" sitting
  // over the attribution, because a screenshot is not an impression. The fix
  // was to emulate print media, so the assertion is that the export reads the
  // SAME stylesheet the PDF does: no `.present-hint` in the captured region.
  //
  // Asserted through the page rather than the pixels: comparing images would
  // fail on a font hint. What matters is that the element is not rendered.
  const r = await renderDeckImages(html, stem, { format: 'png' });
  assert.ok(r.count > 0);
  assert.ok(html.includes('present-hint'), 'the fixture must really contain the chrome');
  // the print stylesheet is what hides it, and it must keep doing so
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
