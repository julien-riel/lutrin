#!/usr/bin/env node
/**
 * Does the .pptx look like the deck?
 *
 * Every other check in this repo reads the PowerPoint we WROTE: the XML is
 * well-formed, the shape is on the slide, the colour is the token's. None of
 * them can answer the only question a reader actually asks — does it LOOK
 * right? A shape can be perfectly spelled and land two inches off; a font can
 * resolve to something else entirely and the XML stays valid.
 *
 * So this script renders both sides and compares the pixels:
 *
 *   HTML  →  Chromium screenshot, one PNG per slide     (the reference)
 *   PPTX  →  LibreOffice Impress → PDF → pdftoppm PNG   (a third party's read)
 *
 * The HTML side is the reference because it is the scene we intended: the same
 * `renderDeckHtml` output backs `lutrin preview` and the VS Code webview, so
 * whatever the browser draws here is what the author was shown. LibreOffice is
 * on the other side precisely BECAUSE it is not us — it re-reads the OOXML with
 * an implementation that owes our renderer nothing, which is the whole value of
 * the comparison. PowerPoint would be the better judge still, and cannot be
 * driven headless on a Linux runner; Impress is the closest honest substitute.
 *
 *   node scripts/pptx-fidelity.mjs                       # examples/demo.deck.md
 *   node scripts/pptx-fidelity.mjs examples/*.deck.md
 *   node scripts/pptx-fidelity.mjs deck.md --threshold 4 --out /tmp/fid
 *
 * It writes a side-by-side contact sheet (`report.html`), worst slide first,
 * with a difference blend you can flip on per slide — reading that page is the
 * point, the numbers only decide where to look first.
 *
 * WHAT A NUMBER HERE IS AND IS NOT
 *
 * Two renderers never agree pixel for pixel: they hint text differently, round
 * subpixels differently, and antialias curves differently. A slide that a human
 * would call identical still lights up a few percent of its edge pixels. So the
 * verdict is the COARSE number — both images boxed down to 640×360 first, which
 * averages antialiasing away and leaves the things worth failing over: a block
 * in the wrong place, a missing shape, a colour that changed, text that reflowed
 * onto another line.
 *
 * Fonts are the honest caveat. LibreOffice draws with the fonts installed on
 * THIS machine, and a bare container has neither Inter nor a brand face, so it
 * substitutes and every glyph shifts. That is a property of the runner, not a
 * defect in the .pptx — the script says so out loud when it cannot find the
 * deck's fonts, rather than letting you read a font substitution as a bug.
 *
 * Written in Node rather than shell for the same reason as pdf-smoke.mjs: one
 * spelling that runs under bash, pwsh and cmd.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const CLI = path.join(ROOT, 'packages', 'core', 'src', 'cli.mjs');

/** The slide, in pixels, at the 2× the PNG export uses. Both sides are
 *  rasterised to exactly this so the comparison never resamples. */
const W = 2560;
const H = 1440;

/** The coarse grid the verdict is computed on — 640×360 is a quarter of the
 *  slide's CSS size, small enough to swallow hinting differences and still far
 *  too coarse to hide a shape that moved. */
const CW = 640;
const CH = 360;

/** How different two channel values must be before the pixel counts as
 *  changed. Below ~24 the two renderers' gamma disagreements alone trip it. */
const TOLERANCE = 28;

const fail = (msg) => {
  console.error(`\n✖ pptx fidelity: ${msg}\n`);
  process.exit(1);
};

// --- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
const decks = [];
let outDir = null;
// Percent of the coarse grid. Two defaults, because there are two machines:
// one with the deck's fonts, where 3% is already generous, and a bare runner
// where substitution alone puts every slide in a 2–5% band. Failing by default
// on the second is how a check teaches people to ignore it — so when the fonts
// are missing the bar moves and SAYS it moved. An explicit --threshold wins.
const THRESHOLD_WITH_FONTS = 3;
const THRESHOLD_SUBSTITUTED = 6;
let threshold = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') outDir = argv[++i];
  else if (a === '--threshold') threshold = Number(argv[++i]);
  else if (a === '--help' || a === '-h') {
    console.log(
      'usage: node scripts/pptx-fidelity.mjs [deck.md ...] [--out <dir>] [--threshold <percent>]',
    );
    process.exit(0);
  } else if (a.startsWith('-')) fail(`unknown option ${a}`);
  else decks.push(a);
}
if (!decks.length) decks.push(path.join(ROOT, 'examples', 'demo.deck.md'));
if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0))
  fail('--threshold takes a percentage');

// --- the three things this cannot run without ------------------------------
// Each is checked BEFORE any work, and named with what to install: a run that
// dies halfway through the fortieth slide teaches nothing that this cannot.

/** `soffice` is a launcher script on Linux and an app bundle on macOS. Look for
 *  both rather than assuming the shape of the install. */
function findSoffice() {
  if (process.env.LUTRIN_SOFFICE) return process.env.LUTRIN_SOFFICE;
  const candidates = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['soffice'], {
    encoding: 'utf8',
  });
  const hit = probe.stdout?.split(/\r?\n/).find(Boolean);
  return hit || null;
}

const soffice = findSoffice();
if (!soffice)
  fail(
    'LibreOffice not found — there is no second renderer to compare against.\n' +
      '  Debian/Ubuntu: apt-get install libreoffice-impress\n' +
      '  macOS:         brew install --cask libreoffice\n' +
      '  Elsewhere, point LUTRIN_SOFFICE at the binary.',
  );

// libreoffice-core alone installs `soffice` and CANNOT open a .pptx — it fails
// with "source file could not be loaded", which reads exactly like a corrupt
// file we wrote. Impress is a separate package on Debian; say so here, once,
// instead of letting every deck report a mysterious conversion failure.
const impressPresent = ['libsdlo.so', 'libsdlo.dylib', 'sdlo.dll'].some((lib) =>
  fs.existsSync(path.join(path.dirname(fs.realpathSync(soffice)), lib)),
);
if (!impressPresent)
  console.warn(
    'warning: found soffice but not the Impress module beside it.\n' +
      '  If every deck fails to convert, that is why — apt-get install libreoffice-impress.',
  );

const pdftoppm = (() => {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pdftoppm'], {
    encoding: 'utf8',
  });
  return probe.stdout?.split(/\r?\n/).find(Boolean) || null;
})();
if (!pdftoppm)
  fail(
    'pdftoppm not found — the PDF Impress produces cannot be turned into images.\n' +
      '  Debian/Ubuntu: apt-get install poppler-utils\n' +
      '  macOS:         brew install poppler',
  );

const { findBrowser } = await import(
  pathToFileURL(path.join(ROOT, 'packages', 'core', 'src', 'deck', 'browser.mjs')).href
);
const browser = findBrowser();
if (!browser)
  fail(
    'no Chromium-based browser found — the HTML side cannot be rasterised.\n' +
      '  Install Chrome/Chromium, run `lutrin setup-mermaid`, or set LUTRIN_BROWSER.',
  );

console.log(`soffice:  ${soffice}`);
console.log(`pdftoppm: ${pdftoppm}`);
console.log(`browser:  ${browser.path}  (${browser.source})`);

// --- fonts, said out loud --------------------------------------------------
// Not a gate: a substituted font still tells you whether the LAYOUT survived,
// and on a CI runner substitution is the normal case. But an unexplained 8%
// that is really "Impress drew DejaVu" would poison every reading of this
// report, so the families present are printed next to the ones asked for.

function installedFamilies() {
  try {
    const out = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8' });
    return new Set(
      out
        .split('\n')
        .flatMap((l) => l.split(','))
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  } catch {
    return null; // no fontconfig (macOS, Windows) — skip the note entirely
  }
}

// --- rendering both sides --------------------------------------------------

const runCli = (args, label) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${label} failed\n${(r.stdout || '') + (r.stderr || '')}`.trimEnd());
  return r.stdout || '';
};

/** Impress → PDF. Each conversion gets its own profile directory: soffice
 *  silently refuses a second `--convert-to` while another instance holds the
 *  default profile, which on a busy machine turns into an intermittent
 *  "could not be loaded" that looks like a bad file. */
function toPdf(pptx, dir) {
  const profile = path.join(dir, 'lo-profile');
  const r = spawnSync(
    soffice,
    [
      '--headless',
      '--norestore',
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      dir,
      pptx,
    ],
    { encoding: 'utf8', timeout: 300_000 },
  );
  const pdf = path.join(dir, `${path.basename(pptx, '.pptx')}.pdf`);
  if (!fs.existsSync(pdf)) {
    const said = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
    fail(
      `LibreOffice could not open the .pptx we wrote — that is a finding, not a setup problem.\n${said}`,
    );
  }
  return pdf;
}

/** PDF → one PNG per page, at exactly the slide size. `-scale-to-x/-y` rather
 *  than a DPI: the two sides must agree to the pixel or every diff is a resize. */
function toPngs(pdf, stem) {
  execFileSync(pdftoppm, ['-png', '-scale-to-x', String(W), '-scale-to-y', String(H), pdf, stem], {
    encoding: 'utf8',
  });
  const dir = path.dirname(stem);
  const base = path.basename(stem);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(dir, f));
}

// --- the comparison --------------------------------------------------------
// Done in the browser, on a canvas, rather than by decoding PNG in Node: the
// repo already requires a Chromium for the export, and it already knows how to
// decode a PNG and box-filter it. Adding `sharp` or `pixelmatch` to compare two
// images we only produced in order to compare them is the wrong trade.

/** Runs in the page. Two images in, two numbers out.
 *  `fine` is the honest full-resolution disagreement — mostly text edges.
 *  `coarse` is the verdict: both boxed to CW×CH, where antialiasing has been
 *  averaged out and only real displacement survives. */
const COMPARE = async (aUrl, bUrl, { W, H, CW, CH, TOLERANCE }) => {
  const load = (src) =>
    new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(`cannot load ${src}`));
      img.src = src;
    });

  const draw = (img, w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    // white first: a slide with a transparent background would otherwise
    // compare black-on-one-side against white-on-the-other
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };

  const ratio = (p, q, tol) => {
    let n = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (
        Math.abs(p[i] - q[i]) > tol ||
        Math.abs(p[i + 1] - q[i + 1]) > tol ||
        Math.abs(p[i + 2] - q[i + 2]) > tol
      )
        n++;
    }
    return (n / (p.length / 4)) * 100;
  };

  const [a, b] = await Promise.all([load(aUrl), load(bUrl)]);
  return {
    fine: ratio(draw(a, W, H), draw(b, W, H), TOLERANCE),
    coarse: ratio(draw(a, CW, CH), draw(b, CW, CH), TOLERANCE),
    aSize: [a.naturalWidth, a.naturalHeight],
    bSize: [b.naturalWidth, b.naturalHeight],
  };
};

/** The images reach the page as data: URLs rather than by `file://` path.
 *  Two reasons, both learned the hard way: a page at `about:blank` has an
 *  opaque origin and simply refuses to load a local file, and even once loaded
 *  a `file://` image TAINTS the canvas, so `getImageData` — the whole point —
 *  throws a SecurityError. A data: URL is same-origin by construction. */
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

async function comparePairs(pairs) {
  const { default: puppeteer } = await import('puppeteer-core');
  const chrome = await puppeteer.launch({
    executablePath: browser.path,
    headless: true,
    // same reasoning as the PDF export: the page loads no remote origin, and
    // without these no containerised or root run starts at all
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await chrome.newPage();
    await page.goto('about:blank');
    const out = [];
    for (const [i, pair] of pairs.entries()) {
      const r = await page.evaluate(COMPARE, dataUrl(pair.html), dataUrl(pair.lo), {
        W,
        H,
        CW,
        CH,
        TOLERANCE,
      });
      out.push({ slide: i + 1, ...pair, ...r });
    }
    return out;
  } finally {
    const proc = chrome.process();
    // ask, then insist — `close()` on a full Chrome can simply never resolve
    await Promise.race([chrome.close(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
    try {
      proc?.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

// --- the report ------------------------------------------------------------

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

function writeReport(file, results, meta) {
  const rel = (p) => path.relative(path.dirname(file), p).split(path.sep).join('/');
  const rows = results
    .slice()
    .sort((a, b) => b.coarse - a.coarse)
    .map(
      (r) => `<section class="pair${r.coarse > meta.threshold ? ' over' : ''}">
  <h2>${esc(r.deck)} — slide ${r.slide}
    <span class="n">coarse ${r.coarse.toFixed(2)}% · fine ${r.fine.toFixed(2)}%</span>
    <button onclick="this.closest('.pair').classList.toggle('diff')">difference</button>
  </h2>
  <div class="shots">
    <figure><img src="${esc(rel(r.html))}" loading="lazy"><figcaption>HTML — what preview shows</figcaption></figure>
    <figure><img src="${esc(rel(r.lo))}" loading="lazy"><figcaption>PPTX — as Impress reads it</figcaption></figure>
  </div>
  <div class="overlay"><img src="${esc(rel(r.html))}" loading="lazy"><img src="${esc(rel(r.lo))}" loading="lazy"></div>
</section>`,
    )
    .join('\n');

  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>pptx fidelity</title>
<style>
  :root{color-scheme:light dark}
  body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:2rem;background:Canvas;color:CanvasText}
  h1{font-size:1.3rem;margin:0 0 .25rem}
  .lede{opacity:.75;max-width:60ch;margin:0 0 2rem}
  .pair{border-top:1px solid color-mix(in srgb,CanvasText 15%,transparent);padding:1.25rem 0}
  .pair.over h2{color:#b3261e}
  h2{font-size:1rem;display:flex;gap:.75rem;align-items:baseline;margin:0 0 .75rem}
  .n{font-weight:400;opacity:.7;font-variant-numeric:tabular-nums}
  button{font:inherit;font-size:.8rem;padding:.15rem .6rem;border-radius:999px;
    border:1px solid color-mix(in srgb,CanvasText 30%,transparent);background:none;color:inherit;cursor:pointer}
  .shots{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  figure{margin:0}
  figcaption{font-size:.8rem;opacity:.7;margin-top:.35rem}
  img{width:100%;display:block;border:1px solid color-mix(in srgb,CanvasText 15%,transparent)}
  /* the difference view: the two frames stacked, blended. Black is agreement. */
  .overlay{display:none;position:relative;background:#000}
  .overlay img{position:absolute;inset:0;border:0}
  .overlay img:first-child{position:static}
  .overlay img:last-child{mix-blend-mode:difference}
  .pair.diff .shots{display:none}
  .pair.diff .overlay{display:block}
</style>
<h1>Does the .pptx look like the deck?</h1>
<p class="lede">Left: the HTML render — the same scene <code>lutrin preview</code> shows.
Right: the .pptx, reopened by LibreOffice Impress, which owes our renderer nothing.
<strong>Coarse</strong> is the verdict (both boxed to ${CW}×${CH}, so antialiasing does not count);
<strong>fine</strong> is the raw pixel disagreement and is never zero between two renderers.
Worst first. ${esc(meta.fontNote)}</p>
${rows}
`,
  );
}

// --- run -------------------------------------------------------------------

const work = outDir
  ? path.resolve(outDir)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-fidelity-'));
fs.mkdirSync(work, { recursive: true });

const fonts = installedFamilies();
const substituted = Boolean(fonts) && !['inter', 'arial', 'helvetica'].some((f) => fonts.has(f));
let fontNote = '';
if (substituted)
  fontNote =
    'Note: this machine has none of the deck\u2019s usual UI faces installed, so Impress ' +
    'substituted — expect every glyph to sit slightly differently. That is the runner, not the .pptx.';
const explicitThreshold = threshold !== null;
if (!explicitThreshold) threshold = substituted ? THRESHOLD_SUBSTITUTED : THRESHOLD_WITH_FONTS;

if (fontNote) console.warn(`\n${fontNote}`);
console.log(
  `threshold: ${threshold}%${!explicitThreshold && substituted ? ' (relaxed — fonts substituted)' : ''}\n`,
);

const results = [];
let hardFail = false;

for (const deckArg of decks) {
  const deck = path.resolve(deckArg);
  if (!fs.existsSync(deck)) fail(`no such deck: ${deckArg}`);
  const name = path.basename(deck).replace(/\.deck\.md$|\.md$/, '');
  const dir = path.join(work, name);
  fs.mkdirSync(path.join(dir, 'html'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lo'), { recursive: true });

  process.stdout.write(`\n${name}: building… `);
  const pptx = path.join(dir, `${name}.pptx`);
  runCli(['build', deck, '-o', pptx, '--force'], 'pptx build');
  runCli(
    ['build', deck, '--png', '-o', path.join(dir, 'html', 'slide.png'), '--force'],
    'png build',
  );
  const htmlPngs = fs
    .readdirSync(path.join(dir, 'html'))
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => path.join(dir, 'html', f));

  process.stdout.write('converting… ');
  const pdf = toPdf(pptx, dir);
  const loPngs = toPngs(pdf, path.join(dir, 'lo', 'slide'));

  // A slide-count mismatch is not a fidelity score, it is a missing slide.
  // Compare what pairs up and say plainly that the rest could not be read.
  if (htmlPngs.length !== loPngs.length) {
    hardFail = true;
    console.log('');
    console.error(
      `✖ ${name}: ${htmlPngs.length} slides in the HTML render, ${loPngs.length} pages out of Impress.`,
    );
  }

  process.stdout.write('comparing… ');
  const pairs = htmlPngs
    .slice(0, Math.min(htmlPngs.length, loPngs.length))
    .map((html, i) => ({ deck: name, html, lo: loPngs[i] }));
  results.push(...(await comparePairs(pairs)));
  process.stdout.write('done\n');
}

// --- verdict ---------------------------------------------------------------

const report = path.join(work, 'report.html');
writeReport(report, results, { threshold, fontNote });

const over = results.filter((r) => r.coarse > threshold).sort((a, b) => b.coarse - a.coarse);
const worst = results.slice().sort((a, b) => b.coarse - a.coarse);
const mean = results.reduce((s, r) => s + r.coarse, 0) / (results.length || 1);

console.log(`\n${results.length} slides compared · mean coarse difference ${mean.toFixed(2)}%`);
console.log('worst five:');
for (const r of worst.slice(0, 5))
  console.log(
    `  ${r.deck} slide ${String(r.slide).padStart(2)}  coarse ${r.coarse.toFixed(2).padStart(6)}%  fine ${r.fine.toFixed(2).padStart(6)}%`,
  );
console.log(`\nreport: ${report}`);

if (over.length) {
  console.error(
    `\n✖ ${over.length}/${results.length} slide${over.length > 1 ? 's' : ''} above the ${threshold}% threshold — open the report and look.`,
  );
  process.exit(1);
}
if (hardFail) process.exit(1);
console.log(`\n✓ every slide within ${threshold}%.`);
