#!/usr/bin/env node
/**
 * Does a `.pptx` exported FROM THE PAGE actually carry its pictures?
 *
 *     node scripts/playground-raster-check.mjs [--keep]
 *
 * The unit tests (packages/core/test/raster.test.mjs) cover what can be checked
 * without a browser: the aspect ratio read off the markup, the `@font-face`
 * inlining, the no-DOM contract. None of them can see the failure this script
 * exists for, and that failure is invisible from every other angle:
 *
 *   pptxgenjs takes a DIFFERENT branch in a page. Given `path`, Node reads the
 *   file; a browser fetches the string. A compiler temp path
 *   (`/tmp/lutrin-…/chart-0.png`) answers 404 there, and pptxgenjs embeds THE
 *   BODY OF THE 404 as the image. The deck opens without a complaint, the
 *   slide has a picture frame on it, and inside that frame are the bytes
 *   `404 /tmp/lutrin-playground1/chart-0.png`. That is what `localImage()`
 *   (pptx/render.mjs) now prevents, and this is what proves it.
 *
 * So the check is end to end and deliberately dumb: serve the site, drive the
 * real playground in a real browser, click the real button, open the file it
 * downloaded and assert that every media part is a PNG by its magic bytes and
 * its dimensions — not merely present, and not merely non-empty.
 *
 * NOT wired into CI, for the reason `reference-pptx.mjs` and
 * `pptx-fidelity.mjs` are not: it needs a browser on the machine, and the
 * canvas paints with the fonts that machine happens to resolve.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser } from '../packages/core/src/deck/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');

/** A deck that asks for exactly the two things this path had to unlock: a
 *  diagram (native SmartArt asks for the raster fallback) and a chart. */
const DECK = `---
title: Raster check
smartart: true
---

# A cycle

<!-- layout: cycle -->

## Collect
We gather.

## Analyse
We measure.

## Decide
We choose.

# A chart

\`\`\`chart
type: bar
categories: Q1, Q2, Q3
Planned: 120, 150, 180
\`\`\`
`;

/** PNG signature + the IHDR dimensions, or null when the bytes are not a PNG.
 *  Read here rather than trusted from a library: the whole point is that the
 *  bytes in the zip were once a 404 page with a .png name. */
function pngInfo(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('No browser found — this check drives a real page. Install Chrome or Chromium.');
    process.exit(2);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-raster-'));
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'site-serve.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // the server prints its own URL, port included: it moves when 4400 is taken,
  // and a port written down here would be the copy that goes stale
  const origin = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error('the site server did not announce a URL')),
      15_000,
    );
    server.stdout.on('data', (d) => {
      buf += String(d);
      const m = buf.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
  });

  const { default: puppeteer } = await import('puppeteer-core');
  const chrome = await puppeteer.launch({
    executablePath: browser.path,
    headless: true,
    args: ['--no-sandbox', '--force-color-profile=srgb'],
  });

  let failures = 0;
  try {
    const page = await chrome.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // `domcontentloaded`, never `networkidle2`: site-serve.mjs holds a live
    // reload channel open, so the network NEVER goes idle and the wait would
    // time out on a page that has been ready for seconds. What readiness means
    // here is the page's own signal — the export button leaving its disabled
    // state, which happens when a compile has actually produced scenes — and
    // that is waited on below.
    await page.goto(`${origin}/playground.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // The page opens on a sample deck and compiles it by itself. Typing before
    // that first compile has landed loses the text — and the failure is a
    // convincing one: the button IS enabled (the sample compiled), the export
    // succeeds, and what comes out is the sample. This check once passed a
    // "request-triage.pptx" that had nothing to do with the deck below.
    await page.waitForFunction(() => !document.getElementById('pg-dl-pptx')?.disabled, {
      timeout: 30_000,
    });

    // typed the way a visitor types: through the textarea's own input event, so
    // the page's real compile path runs
    await page.evaluate((src) => {
      const ta = document.getElementById('pg-source');
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(
        ta,
        src,
      );
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, DECK);

    // Wait for OUR deck to be the compiled one — its own title on a rendered
    // slide, which is the page's own evidence where a fixed sleep is a guess.
    // The preview lives in an IFRAME, so this cannot be a page.waitForFunction:
    // that runs in the top document, where the slides never appear.
    const compiled = async () => {
      for (const frame of page.frames()) {
        try {
          if (/A cycle/.test(await frame.evaluate(() => document.body?.innerText ?? '')))
            return true;
        } catch {
          // a frame that navigated mid-read: the next poll sees its successor
        }
      }
      return false;
    };
    const deadline = Date.now() + 30_000;
    while (!(await compiled())) {
      if (Date.now() > deadline) throw new Error('the deck under test never reached the preview');
      await new Promise((r) => setTimeout(r, 250));
    }

    const cdp = await page.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: outDir,
      eventsEnabled: true,
    });
    await page.click('#pg-dl-pptx');

    const file = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no .pptx was downloaded')), 60_000);
      const tick = setInterval(() => {
        const done = fs.readdirSync(outDir).filter((f) => f.endsWith('.pptx'));
        if (done.length) {
          clearInterval(tick);
          clearTimeout(timer);
          resolve(path.join(outDir, done[0]));
        }
      }, 250);
    });

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const media = Object.keys(zip.files).filter((n) => n.startsWith('ppt/media/'));
    const pngs = media.filter((n) => n.endsWith('.png'));

    console.log(`\n${path.basename(file)} — ${media.length} media part(s)\n`);
    if (!pngs.length) {
      console.log('  ✗ not one PNG: the page rasterized nothing at all');
      failures++;
    }
    for (const name of pngs) {
      const bytes = await zip.file(name).async('uint8array');
      const info = pngInfo(bytes);
      if (!info) {
        const head = Buffer.from(bytes.slice(0, 48)).toString('utf8').replace(/\s+/g, ' ');
        console.log(`  ✗ ${name} — ${bytes.length} B, not a PNG: "${head}"`);
        failures++;
      } else {
        console.log(`  ✓ ${name} — ${info.w}×${info.h}, ${Math.round(bytes.length / 1024)} kB`);
      }
    }
    if (problems.length) {
      console.log(`\n  page errors: ${problems.slice(0, 3).join(' | ')}`);
    }
  } finally {
    await chrome.close();
    server.kill();
    if (KEEP) console.log(`\nkept: ${outDir}`);
    else fs.rmSync(outDir, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} problem(s).` : '\nEvery picture in the deck is a picture.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
