/**
 * SVG → PNG in a browser, with no native module.
 *
 * `svgToPng()` (assets.mjs) has always had exactly one backend,
 * `@resvg/resvg-js` — a native binary. Where it cannot load, the compiler
 * concluded that nothing could be rasterized at all, and the playground said so
 * in as many words ("a native rasterizer no page can load"). That was wrong:
 * every browser ships a rasterizer, and it is the one the `.pptx` needs
 * anyway — `<img>` decodes the SVG, `canvas.drawImage` paints it, `toBlob`
 * hands back PNG bytes.
 *
 * Measured before it was written, on the compiler's own `smartArtSvg` output:
 * the text renders (accents included), an INTERNAL `<style>` block is honoured
 * — the very thing that defeats LibreOffice's SVG import — and an `@font-face`
 * carrying a `data:` URI is applied, which is what lets a kit's font travel.
 * The canvas is not tainted by a `blob:` source of our own making, so
 * `toBlob` succeeds.
 *
 * Two things this path does NOT inherit, and the reason `fontFaceCss()` exists:
 *
 *   1. An SVG loaded through `<img>` is an INDEPENDENT document. It cannot see
 *      the host page's `@font-face` rules, so a kit font that the page itself
 *      displays would silently fall back to a system face here. The bytes are
 *      therefore inlined INTO the SVG before it is handed to the decoder —
 *      the same information resvg receives through its `fontFiles` option.
 *   2. It cannot fetch anything: external references in the SVG are dropped.
 *      That is a property we want (the deliverable must be self-contained) and
 *      it matches what the rest of this module already guarantees.
 *
 * Everything here degrades to `null`, never throws: `svgToPng()` treats a null
 * as "no rasterizer" and the caller already knows how to lose — a diagram
 * falls back to drawn shapes, a chart to its specification in text.
 */

import fs from 'node:fs';
import { FONTS, FONT_FILES, DISPLAY_FONT_FILES, displayFace } from './tokens.mjs';

/** The document to build a canvas in, or null outside a DOM. Read at call time:
 *  the compiler is imported once and may run in Node and in a page. */
const dom = () =>
  typeof globalThis.document !== 'undefined' && typeof globalThis.Image !== 'undefined'
    ? globalThis.document
    : null;

/** Is a browser rasterizer reachable from here? */
export const canvasRasterAvailable = () => dom() !== null;

/**
 * Intrinsic aspect ratio of an SVG, read from its own markup.
 *
 * Needed because the `<img>` intrinsic size cannot be trusted for every SVG we
 * handle: mermaid emits `width="100%"`, which has no pixel value at all, and a
 * decoder then reports either 0 or its 300 × 150 default. The `viewBox` is the
 * authority when it is there, numeric `width`/`height` otherwise.
 *
 * Exported for its own test: it is pure string work, and the one piece of this
 * module that can be checked without a browser.
 *
 * @returns {{w:number,h:number}|null} null when the markup says nothing usable
 */
export function svgAspect(svg) {
  const root = String(svg).match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return null;
  const box = root.match(
    /\bviewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/,
  );
  if (box) {
    const w = Number(box[3]);
    const h = Number(box[4]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  }
  // no viewBox: only an absolute width/height pair means anything ("100%" does
  // not, and that is exactly the case this guard exists for)
  const num = (attr) => {
    const m = root.match(new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i'));
    return m ? Number(m[1]) : Number.NaN;
  };
  const w = num('width');
  const h = num('height');
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/** Base64 of a byte buffer, in Node and in a page alike. */
export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return globalThis.btoa(bin);
}

/** The `.woff2` twin of a declared `.ttf` — the format a browser decodes, and
 *  the one the theme already guarantees sits beside the `.ttf`. */
const twin = (ttf) => String(ttf).replace(/\.ttf$/i, '.woff2');

/**
 * `@font-face` rules for the families the theme embeds, with the glyphs inlined
 * as `data:` URIs.
 *
 * Only the families whose FILES the theme ships: a family named without files
 * is a name the system resolves or does not, exactly as in every other output.
 * A file that cannot be read is skipped rather than reported — this is a
 * fidelity improvement over a system fallback, never a precondition.
 *
 * @returns {string} CSS, or '' when there is nothing to inline
 */
export function fontFaceCss() {
  const rules = [];
  const add = (family, files) => {
    if (!family) return;
    for (const [key, weight, style] of [
      ['regular', 400, 'normal'],
      ['bold', 700, 'normal'],
      ['italic', 400, 'italic'],
    ]) {
      const ttf = files[key];
      if (typeof ttf !== 'string') continue;
      let bytes;
      try {
        bytes = fs.readFileSync(twin(ttf));
      } catch {
        continue; // no twin on this machine: the system face answers instead
      }
      rules.push(
        `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};` +
          `src:url(data:font/woff2;base64,${bytesToBase64(bytes)}) format("woff2");}`,
      );
    }
  };
  add(FONTS.body, FONT_FILES);
  // the display family only when the theme really declares one — displayFace()
  // falls back to the body family, and re-inlining the body glyphs under the
  // body name would double the payload for nothing
  if (FONTS.display) add(displayFace(), DISPLAY_FONT_FILES);
  return rules.join('');
}

/** Inserts `css` as the first child of the root `<svg>` element. Placed inside
 *  the root rather than prepended to the string because a `<style>` outside the
 *  root is not part of the SVG document at all. */
function withStyle(svg, css) {
  if (!css) return svg;
  const root = String(svg).match(/<svg\b[^>]*?>/i);
  if (!root) return svg;
  const at = root.index + root[0].length;
  return `${svg.slice(0, at)}<style>${css}</style>${svg.slice(at)}`;
}

/** PNG bytes of a canvas. `toBlob` first — it is the one that does not build a
 *  base64 string of the whole image — with `toDataURL` as the fallback. */
async function canvasPng(canvas) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  }
  const url = canvas.toDataURL('image/png');
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Rasterizes `svg` to PNG bytes at `widthPx`, using the browser's own decoder.
 *
 * Same contract as the resvg path in `svgToPng()`: `{ png, w, h }` on success,
 * `null` when this environment cannot do it — so the two are interchangeable
 * behind one call site.
 */
export async function svgToPngCanvas(svg, widthPx) {
  const doc = dom();
  if (!doc) return null;
  const width = Math.max(1, Math.round(widthPx));
  const source = withStyle(String(svg), fontFaceCss());
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new globalThis.Image();
    // decoding="sync" is advisory; the load promise is what we actually wait on
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('the browser refused to decode the SVG'));
      img.src = url;
    });
    // the markup is the authority on the ratio; the decoded size is the
    // fallback, and a square is the last resort rather than a division by zero
    const ratio =
      svgAspect(source) ??
      (img.naturalWidth > 0 && img.naturalHeight > 0
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : { w: 1, h: 1 });
    const height = Math.max(1, Math.round((width * ratio.h) / ratio.w));
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // drawn to the canvas's own box: an SVG with no intrinsic size would
    // otherwise paint at its default 300 × 150 in a corner
    ctx.drawImage(img, 0, 0, width, height);
    const png = await canvasPng(canvas);
    return png?.length ? { png, w: width, h: height } : null;
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
