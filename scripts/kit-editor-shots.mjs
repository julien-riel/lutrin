#!/usr/bin/env node
/**
 * Screenshots of the kit editor, for the landing page's kit-editor tour.
 *
 * The page at site/kit-editor.html cannot BE the editor — the editor is a UI in
 * front of a local Node server that compiles and writes files, and GitHub Pages
 * serves static bytes. So the page shows the editor instead, and these shots are
 * the closest a static page can get to honest: each one is the real SPA, driven
 * by the real `startKitEditServer`, with previews compiled by the engine at
 * HEAD. Nothing here is a mockup or a touched-up capture.
 *
 *   node scripts/kit-editor-shots.mjs [--out <dir>] [--port 4399] [--keep]
 *
 * The kit under the lens is `examples/kit-slate` (the repo's example kit —
 * fictional, so no third-party brand is published on the page), copied to a
 * temporary directory and dressed for the shoot: a generated SVG signature in
 * the logo slots, and two `images:` aliases so the Images panel has content.
 * The copy is what gets edited; examples/kit-slate is never written to.
 *
 * --keep leaves that copy in place and prints its path, so a shot that looks
 * wrong can be reproduced by hand with `lutrin kit edit <path>`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startKitEditServer } from '../packages/core/src/kit/edit-server.mjs';
import { findBrowser } from '../packages/core/src/deck/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Chrome renders at 2× so the shots stay sharp on the retina displays the
// landing page is read on; the CSS width they are displayed at is half this.
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

/**
 * The shots, in the order the page tells the story. `slide` indexes the
 * specimen WITH its implicit cover, so 1 is the cover; the interesting ones
 * are 8 (a chart), 11 (the four semantic callouts) and 13 (the pull quote).
 *
 * `contrast` is the last shot on purpose: it types an unreadable accent into
 * the primary token to photograph the WCAG warning the engine answers with,
 * and that edit stays in the working copy (never saved) for whatever follows.
 */
const SHOTS = [
  { file: 'overview.png', panel: 'tokens', slide: '8' },
  { file: 'tokens.png', panel: 'tokens', slide: '11' },
  { file: 'fonts.png', panel: 'fonts', slide: '13' },
  { file: 'layouts.png', panel: 'layouts', slide: '10', editLayout: true },
  { file: 'images.png', panel: 'images', slide: '1' },
  { file: 'kit.png', panel: 'kit', slide: '1' },
  { file: 'contrast.png', panel: 'tokens', slide: '11', breakContrast: true, drawer: true },
];

/** A pale accent that cannot carry white text — picked to trip THEME_CONTRAST. */
const UNREADABLE_ACCENT = 'E8D9A0';

// ---------------------------------------------------------------- the kit

/** A signature for a kit that does not exist — drawn here rather than
 *  committed, so no logo file in the repo can be mistaken for a real one. */
const SIGNATURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 48" role="img" aria-label="Slate+">
  <rect x="0" y="8" width="32" height="32" rx="8" fill="#B45309"/>
  <path d="M10 24h12M16 18v12" stroke="#FFFBEB" stroke-width="3" stroke-linecap="round"/>
  <text x="44" y="32" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#1F2937">Slate</text>
  <text x="108" y="32" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#B45309">+</text>
</svg>
`;

const SIGNATURE_REVERSED_SVG = SIGNATURE_SVG.replace('#1F2937', '#FFFBEB').replace(
  'fill="#B45309"/>',
  'fill="#FBBF24"/>',
);

/** A neutral placeholder a kit would use as a cover texture. */
const TEXTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <rect width="400" height="240" fill="#78350F"/>
  <g stroke="#B45309" stroke-width="2" fill="none">
    ${Array.from({ length: 12 }, (_, i) => `<circle cx="${40 + i * 30}" cy="${120}" r="${20 + i * 8}"/>`).join('\n    ')}
  </g>
</svg>
`;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

/**
 * Copy examples/kit-slate to a temp directory and give it the assets the
 * Images and Fonts panels are about. Returns the directory.
 */
function prepareKit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-shots-'));
  const kitDir = path.join(dir, 'slate-plus');
  copyDir(path.join(ROOT, 'examples/kit-slate'), kitDir);

  fs.mkdirSync(path.join(kitDir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(kitDir, 'images/signature.svg'), SIGNATURE_SVG);
  fs.writeFileSync(path.join(kitDir, 'images/signature-reversed.svg'), SIGNATURE_REVERSED_SVG);
  fs.writeFileSync(path.join(kitDir, 'images/texture.svg'), TEXTURE_SVG);

  // fonts/ stays EMPTY on purpose. The repo has no .ttf under a redistributable
  // licence, and a kit carrying woff2 files with no .ttf twin shows up in the
  // panel as "Not referenced" — a shot of a kit assembled wrong. Empty, the
  // panel says what it is for: two families, three variants, each a .ttf plus
  // its .woff2 twin.
  fs.mkdirSync(path.join(kitDir, 'fonts'), { recursive: true });

  // Wire the assets into the theme: logo slots (the SVG ones — this kit has no
  // bitmap twin) and the `images:` aliases a deck reaches as ![role](kit:alias).
  const themeFile = path.join(kitDir, 'theme.json');
  const theme = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
  theme.logos = {
    coverSvg: './images/signature.svg',
    sectionSvg: './images/signature-reversed.svg',
  };
  theme.images = {
    signature: './images/signature.svg',
    texture: './images/texture.svg',
  };
  fs.writeFileSync(themeFile, `${JSON.stringify(theme, null, 2)}\n`);

  return { dir, kitDir };
}

// ------------------------------------------------------------------ shoot

/** Let the UI finish what the last interaction started. */
const settle = (page, ms) => page.evaluate((d) => new Promise((r) => setTimeout(r, d)), ms);

/** Write one shot (a page or a single element) and report its weight. */
async function shoot(target, file) {
  await target.screenshot({ path: file });
  console.log(`  ${path.basename(file)}  ${Math.round(fs.statSync(file).size / 1024)} kB`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const outDir = path.resolve(flag('--out', path.join(ROOT, 'site/assets/img/kit-editor')));
  // Not 4322: a kit editor the author has open must survive the shoot.
  const port = Number(flag('--port', '4399'));
  const keep = argv.includes('--keep');

  const browserInfo = findBrowser();
  if (!browserInfo?.path) {
    console.error(
      'No Chromium-family browser found. Set LUTRIN_BROWSER, or run `lutrin setup-mermaid`.',
    );
    process.exit(1);
  }

  const { dir, kitDir } = prepareKit();
  fs.mkdirSync(outDir, { recursive: true });

  const { port: actualPort, close } = await startKitEditServer(kitDir, { port });
  const origin = `http://127.0.0.1:${actualPort}`;
  console.log(`kit editor on ${origin} — kit: ${kitDir}`);

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: browserInfo.path,
    headless: true,
    args: ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

    await page.goto(`${origin}/`, { waitUntil: 'networkidle2', timeout: 30_000 });
    // The first compile has to land before anything is worth capturing.
    await page.waitForFunction(
      () => document.querySelector('#preview-canvas')?.children.length > 0,
      {
        timeout: 60_000,
      },
    );

    for (const shot of SHOTS) {
      await page.click(`.rail-item[data-panel="${shot.panel}"]`);
      await settle(page, 600);
      await page.select('#slide-select', shot.slide).catch(() => {
        /* the selector's option set depends on the specimen; keep what is shown */
      });
      await page.evaluate((open) => {
        const t = document.querySelector('#drawer-toggle');
        if (t && t.getAttribute('aria-expanded') !== String(open)) t.click();
      }, Boolean(shot.drawer));

      // Open the first layout in the layout editor: the panel's list says what
      // a kit's layouts ARE, the editor says what editing one looks like.
      if (shot.editLayout) {
        await page.evaluate(() => {
          const edit = [...document.querySelectorAll('#panel-host button')].find(
            (b) => b.textContent.trim() === 'Edit',
          );
          edit?.click();
        });
        await settle(page, 800);
      }

      if (shot.breakContrast) {
        // Set the value and fire `input` rather than typing it: keystrokes walk
        // the field through invalid prefixes ("E", "E8", …) and maxlength=7
        // turns an unselected field into "B45309E", which never commits.
        const set = await page.evaluate((v) => {
          const el = document.querySelector('#panel-host .p-tokens-hex');
          if (!el) return false;
          el.focus();
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }, UNREADABLE_ACCENT);
        if (!set) throw new Error('Tokens panel: no hex field found for the contrast shot.');
        // The warning only exists once the recompile has landed.
        await page
          .waitForFunction(
            () => Number(document.querySelector('#count-warning')?.textContent) > 0,
            {
              timeout: 30_000,
            },
          )
          .catch(() => {
            throw new Error(
              `The engine raised no contrast warning for accent ${UNREADABLE_ACCENT} — pick a colour that actually fails, or drop the shot.`,
            );
          });
      }

      // Recompile + fonts + the panel's own transitions.
      await settle(page, 2500);
      await shoot(page, path.join(outDir, shot.file));

      // A close-up of the card the warning is anchored in: the whole window
      // shows THAT it answers, the crop shows what it says. Taken from the
      // element rather than cropped in CSS, so it survives a new viewport.
      if (shot.breakContrast) {
        const card = await page.$('#panel-host .card:has(.p-tokens-diag)');
        if (!card) throw new Error('Contrast shot: no token card carries a diagnostic.');
        // 3× for this one: it is a ~400 CSS-px card the page shows large, and
        // 2× would land at barely 1× on the reader's display. Raising the
        // scale factor does not change the CSS width, so the layout holds.
        await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 3 });
        await settle(page, 400);
        await shoot(card, path.join(outDir, 'contrast-detail.png'));
        await page.setViewport(VIEWPORT);
      }
    }

    // A page error means the shot shows a broken editor: fail rather than
    // publish it.
    if (problems.length) {
      console.error(`\nThe editor reported errors while shooting:\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await close();
    if (keep) console.log(`\nkit kept at ${kitDir}`);
    else fs.rmSync(dir, { recursive: true, force: true });
  }
}

await main();
