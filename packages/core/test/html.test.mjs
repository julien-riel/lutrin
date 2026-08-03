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
import { MERMAID_PNG_SCALE, mermaidConfig, renderMermaidCached } from '../src/deck/assets.mjs';
import { presetFor } from '../src/deck/anim.mjs';
import { PAGE } from '../src/deck/tokens.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

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

// The fragment CSS lands in hosts whose OWN stylesheets restyle `code` and
// `blockquote` (VS Code webview: --vscode-textPreformat-background gives
// inline code a padded dark chip under dark themes; textBlockQuote adds a
// background and a left border). Every surface property the host paints must
// therefore be DECLARED here, even at its neutral value — an undeclared one
// is repainted by the host, dark-on-light garbage on the slide.
test('fragment mode: inline code and blockquote declare their surface, host defaults cannot bleed', async () => {
  const { css } = await compileHtml(SOURCE, { fragment: true });
  const codeRule = css.match(/^code\{([^}]*)\}/m)?.[1];
  assert.ok(codeRule, 'the fragment CSS must carry a bare `code` rule');
  for (const prop of ['background:transparent', 'padding:0', 'border-radius:0']) {
    assert.ok(codeRule.includes(prop), `code rule must declare ${prop} — got: ${codeRule}`);
  }
  const quoteRule = css.match(/\.quote blockquote\{([^}]*)\}/)?.[1];
  assert.ok(quoteRule, 'the fragment CSS must style .quote blockquote');
  for (const prop of ['background:transparent', 'border:0', 'padding:0']) {
    assert.ok(quoteRule.includes(prop), `blockquote rule must declare ${prop} — got: ${quoteRule}`);
  }
  // same hazard for the inline badge: it is a <span> INSIDE a paragraph, the
  // one place a host stylesheet reaches. Its whole point is a coloured pill —
  // an undeclared property here means a badge repainted by the editor's theme.
  const badgeRule = css.match(/\.badge\{([^}]*)\}/)?.[1];
  assert.ok(badgeRule, 'the fragment CSS must carry a bare `.badge` rule');
  for (const prop of ['background:', 'color:', 'padding:', 'border-radius:', 'font-weight:']) {
    assert.ok(badgeRule.includes(prop), `badge rule must declare ${prop} — got: ${badgeRule}`);
  }
});

// Right-aligning a money column is only half the job: with PROPORTIONAL digits
// the right edge lines up and the thousands do not — which is the very thing
// one right-aligns a numeric column for. The tabular figures therefore ride
// with the alignment, and only with the RIGHT one: a centered or left column
// has no units to line up, and asking for tabular digits there would change
// the look of ordinary prose for nothing.
test('tables: tabular figures are requested on right-aligned columns, and only there', async () => {
  const { slides } = await compileHtml(
    '# Budget\n\n| Line | Share | Amount |\n|---|:-:|--:|\n| Licences | 42 % | 1 517 |\n',
    { fragment: true },
  );
  // the space is part of the pattern: `<thead>` also starts with "<th"
  const cells = [...slides.join('\n').matchAll(/<t[hd]((?: [^>]*)?)>/g)].map((m) => m[1]);
  assert.equal(cells.length, 6, 'header + one body row, three columns each');

  for (const k of [0, 3]) {
    assert.equal(cells[k], '', 'a left column asks for nothing and must emit nothing');
  }
  for (const k of [1, 4]) {
    assert.match(cells[k], /text-align:center/);
    assert.doesNotMatch(cells[k], /tabular-nums/, 'a centered column has no units to align');
  }
  for (const k of [2, 5]) {
    assert.match(cells[k], /text-align:right/);
    assert.match(cells[k], /font-variant-numeric:tabular-nums/);
  }
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
    .update(JSON.stringify({ s: sourcePng, f: 'png', c: mermaidConfig(), px: MERMAID_PNG_SCALE }))
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

// The font memo (fontFacesCss) keys on each woff2's path + mtime + size — the
// fileToDataUri recipe. Without the digest, a warm process (preview server,
// worker, kit editor) that sees a font file REPLACED under the same path
// would serve the previous base64 forever: the theme key (family + paths)
// does not change when only the bytes do.
test('fonts: a woff2 replaced under the same path is re-embedded on the next compile (warm process)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-font-swap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Body.ttf'), 'ttf-bytes');
  fs.writeFileSync(path.join(dir, 'Body.woff2'), 'woff2-v1');
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({ fonts: { body: 'Swap Test', files: { regular: './Body.ttf' } } }),
  );
  const src = '---\nkit: ./theme.json\n---\n\n# Slide\n\ntext\n';
  const b64 = (s) => Buffer.from(s).toString('base64');

  const v1 = await compileHtml(src, { baseDir: dir, fragment: true });
  assert.ok(v1.fontsCss.includes(b64('woff2-v1')), 'first compile embeds the original bytes');

  // same path, new bytes — the font file was replaced, theme.json untouched
  fs.writeFileSync(path.join(dir, 'Body.woff2'), 'woff2-v2-replaced');
  const v2 = await compileHtml(src, { baseDir: dir, fragment: true });
  assert.ok(v2.fontsCss.includes(b64('woff2-v2-replaced')), 'the new bytes are embedded');
  assert.ok(!v2.fontsCss.includes(b64('woff2-v1')), 'the stale base64 is gone');
});

// ---------------------------------------------------------------------------
// Entrance effects, the printed page, presentation mode
// ---------------------------------------------------------------------------

// One slide holding three kinds whose default movement DIFFERS (a metric
// bursts, a bar wipes, prose and a list fade): it is the only shape of deck
// that can tell "every block received the same answer" apart from "each block
// received its own".
const ANIM_SOURCE =
  '# Delivery\n\n<!-- animate -->\n\n' +
  ':::metric\n42 %\nShare\n:::\n\n' +
  ':::progress success\n72 %\nForm\n:::\n\n' +
  'A paragraph of prose.\n\n- first\n- second\n';

/** The slides alone. The `<style>` block carries data-fx="zoom" in its
 *  SELECTORS, and the presentation script carries a stylesheet of its own as a
 *  JS string: counting attributes on the raw document counts the CSS too — a
 *  trap this file has already walked into once. */
const slidesOnly = (html) =>
  html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '');

const styleOf = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];
const scriptsOf = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

/** Every opening tag that carries a step, in document order. */
const stepTags = (html) =>
  [...slidesOnly(html).matchAll(/<[^>]*\sdata-step="\d+"[^>]*>/g)].map((m) => m[0]);

/** `[{ sel, body }]` for every rule, those nested in an at-rule INCLUDED: a
 *  selector cannot contain a brace, so `[^{}]+\{[^{}]*\}` never matches an
 *  at-rule prelude (`@media print{` is followed by a rule, not by
 *  declarations) and matches each of its inner rules on its own. Comments are
 *  stripped first — they name the very class names the tests look for. */
const cssRules = (css) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim(),
    body: m[2].trim(),
  }));

/** The declaration that leaves the element short of its resting state —
 *  invisible, shrunk or clipped — or null when they are all neutral. */
function hidingDecl(body) {
  const NEUTRAL = { opacity: '1', visibility: 'visible', transform: 'none', 'clip-path': 'none' };
  for (const [, prop, raw] of body.matchAll(
    /(?:^|;)\s*(opacity|visibility|transform|clip-path)\s*:\s*([^;]+)/g,
  )) {
    const value = raw.replace(/!important/g, '').trim();
    // inset(0 0 0 0) is the whole box: a clip-path that clips nothing
    if (value === NEUTRAL[prop] || value === 'inset(0 0 0 0)') continue;
    return `${prop}:${value}`;
  }
  return null;
}

/** Bodies of the `@media print{…}` blocks, brace-BALANCED: each one contains
 *  rules of its own, so /@media print\{([^}]*)\}/ would stop at the first
 *  inner closing brace and see almost nothing. */
function printBlocks(css) {
  const out = [];
  const AT = '@media print{';
  for (let at = css.indexOf(AT); at >= 0; at = css.indexOf(AT, at + 1)) {
    const open = at + AT.length - 1;
    for (let i = open, depth = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        out.push(css.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

/** Splits the document's stylesheet into what a HOST receives (baseCss, handed
 *  as is to the VS Code webview and to the editing SPA) and what only the
 *  complete document adds on top — the @page rule and the presentation chrome.
 *  The split is its own assertion: the host's sheet must still be embedded
 *  verbatim, or "the chrome" below would be measuring something else. */
async function stylesheetHalves(source) {
  const { html } = await compileHtml(source);
  const { css: host } = await compileHtml(source, { fragment: true });
  const doc = styleOf(html);
  assert.ok(doc.includes(host), 'the document no longer embeds the host stylesheet verbatim');
  return { html, doc, host, chrome: doc.slice(doc.indexOf(host) + host.length) };
}

// `<!-- animate: zoom -->` is a statement about the SLIDE, not about a kind of
// block: the author asked for one movement and expects one. A slide where the
// metric still bursts and the paragraph still fades in spite of the directive
// is the bug — the per-kind table is a DEFAULT, and a default that survives an
// explicit instruction is not a default.
test('effects: an imposed effect reaches every animated block of the slide', async () => {
  const bare = ANIM_SOURCE.replace('<!-- animate -->\n\n', '');
  for (const [how, source] of [
    ['slide directive', ANIM_SOURCE.replace('<!-- animate -->', '<!-- animate: zoom -->')],
    ['frontmatter', `---\nanimate: zoom\n---\n\n${bare}`],
  ]) {
    const { html } = await compileHtml(source);
    const tags = stepTags(html);
    assert.ok(
      tags.length >= 4,
      `${how}: expected a slide animated block by block, got ${tags.length}`,
    );
    for (const tag of tags) {
      assert.match(tag, /data-fx="zoom"/, `${how}: a block escaped the imposed effect — ${tag}`);
    }
  }
});

// Left to itself, each block gets the movement its KIND deserves — and the
// answer must be the one the .pptx writer gets, or the same deck exported twice
// moves in two different ways. The expected values are read from the shared
// table rather than spelled out here, so the two renderers cannot drift apart
// without this test noticing.
test('effects: with nothing imposed, each block gets the movement the .pptx gives it', async () => {
  const { html, scenes } = await compileHtml(ANIM_SOURCE);
  const slides = slidesOnly(html);
  const fxOfStep = (step) =>
    slides
      .match(new RegExp(`<[^>]*\\sdata-step="${step}"([^>]*)>`))?.[1]
      .match(/data-fx="(\w+)"/)?.[1] ?? null;

  const KINDS = ['metric', 'progress', 'para'];
  for (const kind of KINDS) {
    const el = scenes[0].elements.find((e) => e.block.type === kind);
    assert.ok(el && el.step != null, `the ${kind} block of the source should be animated`);
    assert.equal(fxOfStep(el.step), presetFor(kind), `${kind}: the HTML and the .pptx disagree`);
  }
  // …and the answer really is per block: these three kinds are three different
  // movements in the table, so "all zoom" or "all fade" could not pass above
  assert.equal(
    new Set(KINDS.map((k) => presetFor(k))).size,
    KINDS.length,
    'the table stopped distinguishing these kinds — the assertions above no longer prove anything',
  );
});

// "appear" is the ABSENCE of movement, and the absence of movement is what the
// visibility toggle already does. Writing data-fx="appear" would hand those
// blocks the opacity/transition rules for nothing.
test('effects: "appear" writes no attribute — the visibility toggle already is that effect', async () => {
  const { html } = await compileHtml(
    ANIM_SOURCE.replace('<!-- animate -->', '<!-- animate: appear -->'),
  );
  assert.ok(stepTags(html).length >= 4, 'the slide is still revealed block by block');
  assert.doesNotMatch(
    slidesOnly(html),
    /data-fx/,
    'appear must not paint an effect on top of the toggle',
  );
});

// THE regression that costs the most: an effect rule must never apply to a
// slide that is not stepping through its blocks. The deck editor STRIPS
// data-anim-steps to show a slide whole; an ungated `opacity:0` there blanks
// the slide being edited — and does the same to the print output and to the
// site's demo iframe. The gate is the whole safety of the feature, so this
// looks at every rule the stylesheet has for an animated block, not at the
// three the implementation happens to write today.
test('effects: nothing that hides a block escapes the .slide-frame[data-anim-steps] gate', async () => {
  const { doc, host } = await stylesheetHalves(ANIM_SOURCE);
  for (const [where, sheet] of [
    ['fragment CSS (the editor, the webview)', host],
    ['complete document', doc],
  ]) {
    const forAnimated = cssRules(sheet).filter((r) => /data-(step|fx)/.test(r.sel));
    assert.ok(
      forAnimated.length >= 6,
      `${where}: no effect rule found, the scan reads the wrong thing`,
    );
    let hidden = 0;
    for (const { sel, body } of forAnimated) {
      const hides = hidingDecl(body);
      if (!hides) continue;
      hidden++;
      assert.ok(
        sel.includes('.slide-frame[data-anim-steps]'),
        `${where}: "${sel}" sets ${hides} outside the gate — that blanks the editor, the print output and the demo iframe`,
      );
    }
    assert.ok(
      hidden >= 3,
      `${where}: expected the hidden half of the effects to be found, saw ${hidden}`,
    );
  }
});

// On paper there is no click to reveal anything: an effect left standing prints
// what the audience has not seen yet — a metric frozen at 40 % of its size, a
// panel clipped down to nothing. The neutralizer is deliberately written
// WITHOUT the gate, so it also reaches a host that stripped the attribute.
test('printing: an entrance effect is forced back to its resting state on paper', async () => {
  const { css } = await compileHtml(ANIM_SOURCE, { fragment: true });
  const blocks = printBlocks(css);
  assert.equal(blocks.length, 1, 'baseCss must keep exactly one @media print block');
  const rule = cssRules(blocks[0]).find((r) => /\[data-fx\]/.test(r.sel));
  assert.ok(rule, 'the print block must say something about data-fx');
  for (const decl of [
    'opacity:1 !important',
    'transform:none !important',
    'clip-path:none !important',
  ]) {
    assert.ok(rule.body.includes(decl), `printing: ${decl} missing — got: ${rule.body}`);
  }
  assert.ok(
    !rule.sel.includes('[data-anim-steps]'),
    'the neutralizer must reach a slide whose gate a host has stripped',
  );
});

// Without a size, the browser lays a 1280x720 frame onto the reader's default
// paper and scales or crops it: "print to PDF" gives a deck squeezed into A4
// portrait. With it, the browser's own print dialog is a working 16:9 export.
// It stays out of baseCss because baseCss is handed to HOSTS, and repaginating
// the VS Code webview's own printing is not ours to do — that separation is the
// entire reason pageCss() exists as a second function.
test('printing: @page carries the slide geometry, and never leaves the complete document', async () => {
  const { doc, host } = await stylesheetHalves(ANIM_SOURCE);
  const page = doc.match(/@page\{([^}]*)\}/)?.[1];
  assert.ok(page, '@page missing: the print dialog falls back to the reader’s paper');
  assert.ok(
    page.includes(`size:${PAGE.width}px ${PAGE.height}px`),
    `@page must state the frame — got: ${page}`,
  );
  assert.ok(page.includes('margin:0'), `@page must drop the printer margins — got: ${page}`);
  // …and it only ever applies on paper
  assert.equal(
    (doc.match(/@page/g) ?? []).length,
    printBlocks(doc).join('\n').match(/@page/g)?.length,
    '@page outside @media print: it would repaginate the screen rendering too',
  );

  const { slides } = await compileHtml(ANIM_SOURCE, { fragment: true });
  assert.doesNotMatch(
    host + slides.join('\n'),
    /@page/,
    'a host must not receive our page geometry',
  );
});

// The chrome the projector shows: how far along the deck is, and two targets to
// tap on a lectern or a tablet, where there is no keyboard to press.
test('presentation mode: progress bar, labelled controls and the overview grid ride in the complete document', async () => {
  const { html, chrome } = await stylesheetHalves(ANIM_SOURCE);
  const rules = cssRules(chrome);
  const ruleFor = (re) => rules.find((r) => re.test(r.sel));

  assert.ok(ruleFor(/^\.present-bar$/), 'no progress bar');
  assert.ok(ruleFor(/^\.present-bar-fill$/), 'a bar with nothing to fill it says nothing');
  assert.ok(ruleFor(/^\.present-nav button$/), 'no on-screen controls');
  // they fade with the pointer: a still slide is projected without chrome on it
  assert.ok(
    ruleFor(/^body\.presenting\.present-active \.present-nav$/),
    'the controls never come back',
  );

  const grid = ruleFor(/^body\.presenting\.present-overview \.deck$/);
  assert.ok(grid?.body.includes('display:grid'), 'the overview (O) is not a grid');
  // the current slide is pinned to the four edges while presenting: a grid that
  // does not undo that leaves one slide covering the thumbnails it is for
  const currentInGrid = ruleFor(
    /^body\.presenting\.present-overview \.slide-frame\.present-current$/,
  );
  assert.ok(currentInGrid, 'the grid never releases the pinned current slide');
  assert.doesNotMatch(
    currentInGrid.body,
    /position:fixed/,
    'the current slide stays pinned over the grid',
  );
  for (const decl of ['left:auto', 'width:auto']) {
    assert.ok(
      currentInGrid.body.includes(decl),
      `the grid must release ${decl} — got: ${currentInGrid.body}`,
    );
  }
  // …and none of it is projected onto paper
  assert.match(
    printBlocks(chrome).join('\n'),
    /\.present-nav/,
    'the chrome must hide itself when printing',
  );

  const script = scriptsOf(html).at(-1);
  assert.match(script, /'present-bar-fill'/, 'the bar is styled but never built');
  // a round button holding an arrow glyph reads as nothing at all without one
  assert.match(
    script,
    /setAttribute\('aria-label'/,
    'the controls are unnamed for a screen reader',
  );
  for (const label of ['Previous slide', 'Next slide']) {
    assert.ok(script.includes(`'${label}'`), `no ${label.toLowerCase()} control`);
  }
});

// The prefix is not decoration: .progress, .progress-track and .progress-fill
// already belong to the :::progress block of the DSL. Had the presentation bar
// taken those names, it would have repainted every bar an author wrote into
// their own slides — with a deck-wide progress colour and a width of 0.
test('presentation mode: the present- prefix leaves a :::progress block its own bar', async () => {
  const source = '# Delivery\n\n:::progress success\n72 %\nForm\n:::\n';
  const { html, chrome } = await stylesheetHalves(source);

  const slides = slidesOnly(html);
  assert.match(slides, /class="progress-track"/, 'the author’s bar left the slide');
  assert.match(slides, /class="progress-fill"/);

  const rules = cssRules(chrome);
  for (const { sel } of rules) {
    assert.doesNotMatch(
      sel,
      /\.progress(-track|-fill)?\b/,
      `the chrome claims a DSL class: ${sel}`,
    );
  }
  assert.ok(
    rules.some((r) => r.sel === '.present-bar-fill'),
    'the chrome has no bar of its own left',
  );
  // every class the script invents for the elements it creates carries it too
  for (const [, name] of scriptsOf(html)
    .at(-1)
    .matchAll(/\.className\s*=\s*'([^']+)'/g)) {
    assert.match(name, /^present-/, `a chrome element without the prefix: ${name}`);
  }
});

// The elapsed timer says how long you have been talking; the clock says whether
// you are late. A room is booked by the second of those, not the first.
test('presenter view: a wall clock, without seconds, filled before the first tick', async () => {
  const { html } = await compileHtml(ANIM_SOURCE);
  const script = scriptsOf(html).at(-1);
  assert.match(script, /id="t-clock"/, 'the presenter window carries no clock');
  assert.match(script, /getElementById\('t-clock'\)/, 'the clock is built but never filled');

  const format = script.match(/toLocaleTimeString\(([^)]*)\)/)?.[1];
  assert.ok(format, 'the clock must be formatted for the reader’s locale');
  assert.ok(
    /hour/.test(format) && /minute/.test(format),
    `hours and minutes expected — got: ${format}`,
  );
  assert.ok(!/second/.test(format), 'a clock that ticks steals the eye the notes need');

  // the interval runs every 500 ms; without one call by hand the clock is blank
  // for that long, exactly when the window has just opened
  const opener = script.slice(
    script.indexOf('function openPresenter()'),
    script.indexOf('function closePresenter()'),
  );
  assert.ok(opener.length > 0, 'openPresenter() not found — this test needs rewriting');
  assert.match(
    opener,
    /\btickTimer\(\)/,
    'openPresenter must fill the timer and the clock itself, once',
  );
});

// The scripts are built by string concatenation inside a template literal, and
// nothing between here and the browser parses them: a stray quote ships a deck
// whose slides never scale and whose P key does nothing, with no error anywhere
// but the reader's console.
test('inline scripts: every one of them parses as JavaScript', async () => {
  const { html } = await compileHtml(ANIM_SOURCE);
  const scripts = scriptsOf(html);
  assert.equal(
    scripts.length,
    3,
    'scaling, animation steps (this deck is animated), presentation mode',
  );
  for (const [i, src] of scripts.entries()) {
    // parses only — nothing is executed, there is no DOM here to execute against
    new vm.Script(src, { filename: `inline-${i}.js` });
  }
  assert.ok(
    scripts.some((s) => s.includes('openPresenter') && s.includes('t-clock')),
    'the presenter script is not among the ones just checked',
  );
});

test("a diagram is one inline SVG at the region's exact size, and animates like anything else", async () => {
  const { html } = await compileHtml(
    '---\ntitle: D\n---\n\n# Loop\n\n<!-- animate -->\n\n<!-- layout: cycle -->\n\n## Plan\n\n## Build\n\n## Ship\n',
  );
  // the animation splice adds its attributes BEFORE the class, so nothing
  // here may depend on attribute order
  const figure = /<div [^>]*class="figure el"[^>]*>(<svg[\s\S]*?<\/svg>)<\/div>/.exec(html);
  assert.ok(figure, 'no diagram figure in the document');
  const [, svg] = figure;
  const style = /style="([^"]*)"/.exec(figure[0])[1];
  const w = Number(/width:([\d.]+)px/.exec(style)[1]);
  const h = Number(/height:([\d.]+)px/.exec(style)[1]);
  assert.match(svg, new RegExp(`viewBox="0 0 ${w} ${h}"`), 'the SVG is not the size of its slot');
  // ONE top-level element: the animation splice wraps what the renderer
  // returned, and would wrap only the first of two
  assert.equal((figure[0].match(/^<div/g) ?? []).length, 1);
  assert.match(
    figure[0],
    /data-fx="fade"/,
    'the default preset, since no PRESET_BY_KIND entry is added',
  );
});
