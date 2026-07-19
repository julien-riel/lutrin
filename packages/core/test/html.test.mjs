/**
 * Standalone HTML document: structural invariants the hosts depend on.
 *   - a SINGLE </body> literal in the whole document — `lutrin preview`
 *     injects its SSE client before the last one; a second one (e.g. inside an
 *     inline script doing a document.write) has already broken the injection;
 *   - fragment mode (webview) contains neither a script nor any trace of
 *     presenter mode.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeckHtml, compileHtml } from '../src/html/render.mjs';
import { mermaidConfig, renderMermaidCached } from '../src/deck/assets.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SOURCE =
  '# One\n\n<!-- animate -->\n\n- a\n- b\n\n<!-- notes: speak slowly -->\n\n# Two\n\ntext\n';

test('full document: a single </body> (the lutrin preview contract)', async () => {
  const deck = parseDeck(SOURCE);
  const { html } = await renderDeckHtml(buildScenes(deck), deck.meta, process.cwd());
  assert.equal(html.indexOf('</body>'), html.lastIndexOf('</body>'), 'duplicated </body> literal');
  assert.match(html, /present-hint/, 'presenter mode expected in the full document');
});

test('accessibility: slides in named groups, never role="img" (weakness no. 9)', async () => {
  const deck = parseDeck(SOURCE);
  const { html } = await renderDeckHtml(buildScenes(deck), deck.meta, process.cwd());
  assert.doesNotMatch(html, /role="img"/, 'role="img" hides links and tables from screen readers');
  assert.match(html, /role="group" aria-roledescription="slide"/);
  assert.match(html, /aria-label="Slide 1 of 2 — One"/);
});

test('fragment mode: no script, no trace of presenter mode', async () => {
  const { slides, css } = await compileHtml(SOURCE, { fragment: true });
  const all = slides.join('\n') + css;
  assert.doesNotMatch(all, /<script/i);
  assert.doesNotMatch(all, /presenting|present-hint|__anim/);
});

// ---------------------------------------------------------------------------
// Mermaid: VISIBLE labels, or no diagram at all
// ---------------------------------------------------------------------------

// By default mmdc puts every node label inside a
// <foreignObject><div>…</div></foreignObject>, which the sanitizer removes
// ALONG WITH its content (sanitize.test.mjs): the diagram showed up as
// unlabelled rectangles in the standalone HTML, while the .pptx — rasterized
// by mmdc — had its labels. A silent HTML/PPTX divergence on the demo deck
// itself. The countermeasure is upstream, in the config passed to mmdc.
test('mermaid: the config turns htmlLabels off (labels in SVG <text>, not foreignObject)', () => {
  const cfg = mermaidConfig();
  assert.equal(cfg.htmlLabels, false);
  assert.equal(cfg.flowchart?.htmlLabels, false, 'flowchart: the demo deck case');
  assert.equal(cfg.class?.htmlLabels, false);
});

// Defence in depth: if an SVG arrives with foreignObject IN SPITE OF
// everything (mmdc from a version that ignores the option, a file vendored by
// an earlier Lutrin), better to give up on the diagram — the caller falls back
// to the source as a code block, which at least stays legible — than to produce
// a slide with unlabelled boxes.
test('mermaid: an SVG with foreignObject is refused rather than rendered unlabelled', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-mmd-vendor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const source = 'graph TD\n  A[Alpha] --> B[Beta]\n'; // test-specific source (memoized cache)
  const key = `${crypto
    .createHash('sha1')
    .update(JSON.stringify({ s: source, f: 'svg', c: mermaidConfig() }))
    .digest('hex')}.svg`;
  const vendor = path.join(dir, 'assets', 'mermaid');
  fs.mkdirSync(vendor, { recursive: true });
  fs.writeFileSync(
    path.join(vendor, key),
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="10" height="10">' +
      '<div xmlns="http://www.w3.org/1999/xhtml">Alpha</div></foreignObject></svg>',
  );

  assert.equal(renderMermaidCached(source, { format: 'svg', baseDir: dir }), null);
  // the .pptx PNG, for its part, is unaffected: it does not go through the sanitizer
  const sourcePng = 'graph TD\n  C[Gamma] --> D[Delta]\n';
  const pngKey = `${crypto
    .createHash('sha1')
    .update(JSON.stringify({ s: sourcePng, f: 'png', c: mermaidConfig() }))
    .digest('hex')}.png`;
  fs.writeFileSync(path.join(vendor, pngKey), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(
    renderMermaidCached(sourcePng, { format: 'png', baseDir: dir }),
    path.join(vendor, pngKey),
  );
});

// … but that refusal holds for THIS deck, not for the process. The preview
// worker compiles several decks in a row in the same process (see the
// isolation of prepareDeckContext, registry.test.mjs): one corrupt vendored
// SVG in a first deck must not condemn the sound SVG of a second one. The
// verdict depends on the file found under `assets/mermaid/`, hence on the
// baseDir — which must be part of the memoization key.
test('mermaid: an SVG refused in one deck does not condemn that diagram in another deck', (t) => {
  const source = 'graph TD\n  Zeta[Zeta] --> Ypsilon[Ypsilon]\n'; // source specific to this test
  const key = `${crypto
    .createHash('sha1')
    .update(JSON.stringify({ s: source, f: 'svg', c: mermaidConfig() }))
    .digest('hex')}.svg`;

  const deckWith = (svg) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-mmd-deck-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const vendor = path.join(dir, 'assets', 'mermaid');
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, key), svg);
    return dir;
  };

  // first deck: labels in foreignObject → refused (unlabelled rendering avoided)
  const corrupt = deckWith(
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="10" height="10">' +
      '<div xmlns="http://www.w3.org/1999/xhtml">Zeta</div></foreignObject></svg>',
  );
  assert.equal(renderMermaidCached(source, { format: 'svg', baseDir: corrupt }), null);

  // second deck, same process, same source: its SVG is sound, it must pass
  const sound = deckWith('<svg xmlns="http://www.w3.org/2000/svg"><text>Zeta</text></svg>');
  assert.equal(
    renderMermaidCached(source, { format: 'svg', baseDir: sound }),
    path.join(sound, 'assets', 'mermaid', key),
    'poisoned memoization: the first deck refusal spilled over onto the second',
  );
});

// End-to-end observation, when mmdc is present: the diagram inlined in the
// document really does carry its labels.
test('mermaid: labels survive the sanitizer (requires mmdc)', async (t) => {
  const { findMmdc } = await import('../src/deck/assets.mjs');
  if (!findMmdc()) return t.skip('@mermaid-js/mermaid-cli absent (optional dependency)');
  const source = '# Architecture\n\n```mermaid\ngraph TD\n  Parse[Parse] --> Render[Render]\n```\n';
  const deck = parseDeck(source);
  const { html } = await renderDeckHtml(buildScenes(deck), deck.meta, process.cwd());
  assert.doesNotMatch(html, /foreignobject/i, 'foreignObject removed by the sanitizer');
  assert.match(html, /class="figure mermaid/, 'diagram rendered, no code fallback');
  assert.match(html, /<text[\s>][\s\S]*Parse/, 'label "Parse" present in an SVG <text>');
});
