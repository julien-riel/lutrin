/**
 * The browser rasterizer (deck/raster-browser.mjs).
 *
 * `svgToPng()` used to have one backend, a native module, and everything that
 * could not load it concluded that nothing could be rasterized at all. A
 * browser can: `<img>` decodes the SVG, a canvas paints it, `toBlob` hands back
 * PNG bytes. That path is what puts charts, equations, icons and native
 * SmartArt into a `.pptx` exported from a page.
 *
 * What is checked HERE is what can be checked without a browser — and that is
 * deliberately the majority of it, because the two things most likely to break
 * silently are pure string work:
 *
 *   1. THE ASPECT RATIO. A canvas has to be sized before anything is drawn, and
 *      the `<img>` intrinsic size is not trustworthy for every SVG we handle:
 *      mermaid emits `width="100%"`. Getting this wrong does not throw — it
 *      squashes the picture, which no test that only asserts "a PNG came out"
 *      would ever see.
 *   2. THE FONT INJECTION. An SVG in an `<img>` cannot see the page's
 *      `@font-face` rules, so a kit's font would silently become a system face.
 *      That is exactly the HTML/.pptx divergence the resvg path's `fontFiles`
 *      option exists to prevent, and the inlining is its twin.
 *
 * The end-to-end proof — a real page, a real canvas, a `.pptx` whose media are
 * real PNGs — lives in `scripts/playground-raster-check.mjs`, out of CI for the
 * reason `reference-pptx.mjs` is: it needs a browser, and the fonts it resolves
 * are the ones that machine happens to have.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  svgAspect,
  fontFaceCss,
  svgToPngCanvas,
  bytesToBase64,
} from '../src/deck/raster-browser.mjs';
import { applyTheme, resolveTheme } from '../src/deck/theme.mjs';
import { rasterAvailable } from '../src/deck/assets.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

test('svgAspect: the viewBox is the authority', () => {
  assert.deepEqual(svgAspect('<svg viewBox="0 0 800 400"></svg>'), { w: 800, h: 400 });
  // a viewBox with a non-zero origin, and comma separators
  assert.deepEqual(svgAspect('<svg viewBox="-10,-5, 200 , 100"></svg>'), { w: 200, h: 100 });
  // the viewBox wins over width/height, which may be a display size
  assert.deepEqual(svgAspect('<svg width="50" height="50" viewBox="0 0 300 100"></svg>'), {
    w: 300,
    h: 100,
  });
});

test('svgAspect: absolute width/height when there is no viewBox', () => {
  assert.deepEqual(svgAspect('<svg width="640" height="480"></svg>'), { w: 640, h: 480 });
  assert.deepEqual(svgAspect('<svg width="640px" height="480px"></svg>'), { w: 640, h: 480 });
});

// The case the helper exists for: mermaid's own output. A percentage is not a
// size, and treating it as one would draw the diagram into a canvas of the
// wrong shape — silently.
test('svgAspect: a percentage width says nothing, and is reported as nothing', () => {
  assert.equal(svgAspect('<svg width="100%" height="100%"></svg>'), null);
  assert.equal(svgAspect('<svg width="100%" height="300"></svg>'), null);
  assert.equal(svgAspect('<svg></svg>'), null);
  assert.equal(svgAspect('not an svg at all'), null);
  // a zero or negative extent is not a ratio either — it is a division by zero
  assert.equal(svgAspect('<svg viewBox="0 0 0 100"></svg>'), null);
});

test('bytesToBase64 round-trips through Node’s own decoder', () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 255, 65, 66]);
  assert.deepEqual(Uint8Array.from(Buffer.from(bytesToBase64(bytes), 'base64')), bytes);
});

test('svgToPngCanvas: no DOM, no picture — and no throw', async () => {
  assert.equal(typeof globalThis.document, 'undefined', 'this test assumes a DOM-less Node');
  assert.equal(await svgToPngCanvas('<svg viewBox="0 0 10 10"></svg>', 100), null);
});

test('fontFaceCss: nothing to inline under the default theme', (t) => {
  t.after(() => applyTheme(null));
  applyTheme(null);
  // the default theme names Arial and shifts no glyphs: a family without files
  // is a name the system resolves, exactly as in every other output
  assert.equal(fontFaceCss(), '');
});

// press-noir is the kit that ships glyphs for its DISPLAY family alone
// (Oswald), which is also the case that catches a rule keyed on the body font.
test('fontFaceCss: a kit that embeds a face travels with it', (t) => {
  t.after(() => applyTheme(null));
  const kit = path.join(REPO, 'examples', 'kits', 'press-noir');
  const { theme, diagnostics } = resolveTheme({}, { baseDir: REPO, themePath: kit });
  assert.deepEqual(diagnostics, [], 'the kit itself must be clean');
  applyTheme(theme);
  const css = fontFaceCss();
  assert.match(css, /@font-face\{font-family:"Oswald"/, 'the display family is inlined');
  assert.match(css, /src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)/);
  // the .woff2 twin, never the .ttf: the .ttf is what PowerPoint embeds, and a
  // browser does not decode it
  assert.doesNotMatch(css, /\.ttf/);
  // both weights the kit declares
  assert.match(css, /font-weight:400/);
  assert.match(css, /font-weight:700/);
});

// rasterAvailable() is what the renderers ask before saying "this deck lost its
// charts". It must answer for BOTH backends, or a page that can rasterize would
// still be told it cannot.
test('rasterAvailable follows whichever backend can answer', async () => {
  assert.equal(
    await rasterAvailable(),
    true,
    'resvg is installed in this repository, so Node must say yes',
  );
});
