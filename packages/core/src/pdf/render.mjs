/**
 * PDF and image writer: the standalone HTML, printed by a real browser.
 *
 * WHY THIS IS NOT "THE BROWSER'S PDF" ANY MORE. Printing the exported page by
 * hand already gave a usable handout — `pageCss()` sizes the page at
 * 1280 × 720 with no margin, opens every animation step and hides the notes.
 * What it could not give is what a reader actually navigates by: an outline.
 * `docs/dsl.md` conceded exactly that, and this module is the answer to its
 * own concession.
 *
 * WHAT IT REUSES, and why the cost was medium rather than large:
 *   - the document is the SAME standalone HTML `renderDeckHtml` produces, so
 *     nothing here decides geometry, colour or pagination;
 *   - the print stylesheet is the one that already shipped;
 *   - `deck/browser.mjs` already finds a Chromium and `puppeteer-core` already
 *     drives it — for Mermaid. This is the same CDP session, asked for a
 *     different artefact.
 *
 * WHAT IT DOES NOT DO, said here so nobody has to find out: **no notes
 * annotations**. Marp writes the presenter notes into the PDF as annotation
 * objects; doing that means writing PDF objects, which means a PDF library,
 * which is a dependency this project does not want for one flag. The notes
 * remain in the `.pptx` and in the HTML presenter view.
 *
 * THE BROWSER IS REQUIRED HERE, and that is a real difference from every other
 * optional-browser path in the codebase. A missing rasterizer degrades a chart
 * to its source and says so; there is no degraded PDF. So this module refuses
 * loudly and writes nothing, and the CLI asks it BEFORE compiling (rule 1: the
 * refusal is pronounced before the first byte).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser } from '../deck/browser.mjs';
import { PAGE } from '../deck/tokens.mjs';

/** px → inches, the unit CDP's printToPDF speaks. */
const IN = (px) => px / 96;

/**
 * Shuts the browser down without ever hanging on it — the lesson
 * `mermaid-render.mjs` paid an afternoon for: driving a full Chrome (rather
 * than the headless shell) `close()` can simply never resolve, and the
 * artefact is already on disk by then. Ask politely, wait five seconds, kill.
 */
async function shutdown(browser) {
  if (!browser) return;
  const proc = browser.process();
  try {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  } catch {
    /* best effort — the kill below is the guarantee */
  }
  try {
    proc?.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

/**
 * Opens the deck in a browser and hands the page to `fn`.
 *
 * The HTML goes through a temp FILE rather than `setContent`: the document
 * carries its fonts as base64 and its images as data URIs, so it is large, and
 * `file://` + `waitUntil: 'load'` is the loading path browsers are best at.
 * Nothing is fetched — the page has no remote origin, which is also why the
 * sandbox flags below are acceptable.
 */
async function withDeckPage(html, fn) {
  const browser = findBrowser();
  if (!browser) {
    throw Object.assign(new Error('no browser found'), { code: 'BROWSER_UNAVAILABLE' });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pdf-'));
  const page1 = path.join(dir, 'deck.html');
  fs.writeFileSync(page1, html);

  let chrome;
  try {
    const { default: puppeteer } = await import('puppeteer-core');
    chrome = await puppeteer.launch({
      executablePath: browser.path,
      headless: true,
      // Same reasoning as the Mermaid child: the page is one we just wrote,
      // loads no remote origin, and without these every containerised or root
      // run — CI images, devcontainers — fails to start at all.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await chrome.newPage();
    await page.goto(`file://${page1.split(path.sep).join('/')}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    // Fonts are inlined, but "inlined" is not "laid out": printing before the
    // faces are ready measures the fallback and shifts every line.
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await shutdown(chrome);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Gives each slide a heading, so the PDF gets an outline.
 *
 * Chrome builds `generateDocumentOutline` from the document's `h1`–`h6`, and a
 * slide title is a `<div class="slide-title">` — a deliberate choice in the
 * HTML renderer, which positions it absolutely. Rather than change the shipped
 * markup for every consumer (the webview and the editing SPA read it too), the
 * heading is added HERE, in the page, for the print only.
 *
 * Visually hidden, but LAID OUT: `display:none` would take it out of the box
 * tree and out of the outline with it.
 */
const OUTLINE_SCRIPT = () => {
  const hidden =
    'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;' +
    'white-space:nowrap;font-size:1px;color:transparent;pointer-events:none';
  document.querySelectorAll('.slide-frame').forEach((frame, i) => {
    // A cover already writes `<h1 class="cover-title">` and a section an
    // `<h2 class="section-title">`. Adding another would list those slides
    // twice in the outline — which is what the first version of this did.
    if (frame.querySelector('h1, h2, h3, h4, h5, h6')) return;
    const title = frame.querySelector('.slide-title')?.textContent?.trim() || `Slide ${i + 1}`;
    const h = document.createElement('h2');
    h.textContent = title;
    h.setAttribute('style', hidden);
    frame.insertBefore(h, frame.firstChild);
  });
  return document.querySelectorAll('.slide-frame').length;
};

/**
 * Writes the deck as a PDF.
 *
 * @param {string} html the standalone document from renderDeckHtml
 * @param {string} outPath where to write
 * @returns {Promise<{pages:number, outline:boolean, warnings:string[]}>}
 */
export async function renderDeckPdf(html, outPath) {
  const warnings = [];
  return withDeckPage(html, async (page) => {
    const slides = await page.evaluate(OUTLINE_SCRIPT);

    const buf = await page.pdf({
      // honours the `@page{size:1280px 720px;margin:0}` the print stylesheet
      // already declares, rather than restating it here and letting the two
      // disagree
      preferCSSPageSize: true,
      width: `${IN(PAGE.width)}in`,
      height: `${IN(PAGE.height)}in`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      // without it every panel, band and tint prints white — the deck would
      // arrive as an outline of itself
      printBackground: true,
      outline: true,
      timeout: 120_000,
    });
    fs.writeFileSync(outPath, buf);

    // `page.pdf()` resolves to a Uint8Array, whose `toString` ignores its
    // argument and returns "37,80,68,70,…". Reading the bytes as text needs
    // the Buffer view — without it every check below silently answers no.
    const text = Buffer.from(buf).toString('latin1');
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length || slides;
    const outline = text.includes('/Outlines');
    if (!outline)
      warnings.push(
        'the PDF carries no outline — the browser driving the export is older than the outline support in CDP; the pages are correct',
      );
    if (pages !== slides)
      warnings.push(
        `PDF: ${pages} page(s) for ${slides} slide(s) — the print stylesheet paginated unexpectedly`,
      );
    return { pages, outline, warnings };
  });
}

/**
 * Writes one image per slide: `<stem>-01.png`, `-02`, …
 *
 * A contact sheet rather than a single file, because a deck is not one image.
 * The stem comes from the output path with its extension dropped, so
 * `-o out/frames.png` yields `out/frames-01.png`.
 *
 * @returns {Promise<{count:number, files:string[], warnings:string[]}>}
 */
export async function renderDeckImages(html, stem, { format = 'png', scale = 2 } = {}) {
  const warnings = [];
  return withDeckPage(html, async (page) => {
    await page.setViewport({
      width: PAGE.width,
      height: PAGE.height,
      // a slide captured at 1× is a 1280 px image, which is under a phone's
      // screen: 2× is the smallest scale that survives being looked at
      deviceScaleFactor: scale,
    });
    // PRINT media, not a hand-rolled cleanup. The stylesheet already answers
    // the question "what belongs in an export": it undoes the fit transform,
    // opens every animation step, drops the step counter and the notes, and
    // hides the on-screen chrome (`.present-hint`, `.present-nav`,
    // `.present-bar`). A screenshot is not an impression, so none of that
    // applied by default — the first version of this shipped images with
    // "P: presentation mode · ?: help" sitting over the attribution.
    //
    // Emulating print is also what keeps an exported image identical to the
    // corresponding PDF page: one stylesheet decides both.
    await page.emulateMediaType('print');

    const frames = await page.$$('.slide-frame');
    const files = [];
    const width = String(frames.length).length;
    for (const [i, frame] of frames.entries()) {
      const file = `${stem}-${String(i + 1).padStart(Math.max(width, 2), '0')}.${format}`;
      await frame.screenshot({
        path: file,
        type: format,
        ...(format === 'jpeg' ? { quality: 92 } : { omitBackground: false }),
      });
      files.push(file);
    }
    return { count: files.length, files, warnings };
  });
}

/** Is a browser available at all? The CLI asks BEFORE compiling, so that a
 *  deck that cannot be exported is refused before a single byte is written. */
export const pdfAvailable = () => Boolean(findBrowser());
