#!/usr/bin/env node
/**
 * PDF/image export smoke test — the one CI step that cannot pass by skipping.
 *
 * `test/pdf.test.mjs` skips where no browser exists, which is right for a
 * contributor's laptop and wrong for CI: a runner that quietly lost its
 * Chromium would leave the export untested while the suite stayed green, and
 * nobody would learn it until a user did.
 *
 * So this script REQUIRES a browser and fails loudly without one. It drives the
 * real CLI, end to end, exactly as a user would — no imports of internals — and
 * checks what a reader would notice: the PDF is a PDF, it has one page per
 * slide, it carries an outline, and the images are the slide at 2×.
 *
 *   node scripts/pdf-smoke.mjs
 *
 * Written in Node rather than shell so the same step runs under bash, pwsh and
 * cmd without three spellings.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'packages', 'core', 'src', 'cli.mjs');

const fail = (msg) => {
  console.error(`\n✖ pdf smoke: ${msg}\n`);
  process.exit(1);
};

// --- the browser, first and loudly ----------------------------------------
// `pathToFileURL`, not the bare path: on Windows a dynamic import of
// `D:\\a\\lutrin\\…` is refused outright — "absolute paths must be valid
// file:// URLs. Received protocol 'd:'". It is the whole reason this step was
// red on both Windows cells while the export itself worked there.
const { findBrowser } = await import(
  pathToFileURL(path.resolve(here, '..', 'packages', 'core', 'src', 'deck', 'browser.mjs')).href
);
const browser = findBrowser();
if (!browser)
  fail(
    'no Chromium-based browser found on this runner.\n' +
      '  The PDF export cannot be exercised, and a skipped export is not a tested one.\n' +
      '  Install one in the workflow, or set LUTRIN_BROWSER.',
  );
console.log(`browser: ${browser.path}  (${browser.source})`);

// --- a deck with something on it ------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pdf-smoke-'));
const deck = path.join(dir, 'smoke.deck.md');
fs.writeFileSync(
  deck,
  `---
title: Smoke
---

# Alpha

- One bullet

# Beta

<!-- layout: cycle -->

## Plan

## Build

## Ship
`,
);
const SLIDES = 3; // cover + Alpha + Beta

const run = (args) => {
  try {
    return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    fail(`\`lutrin ${args.join(' ')}\` failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
  }
};

// --- PDF -------------------------------------------------------------------
const pdf = path.join(dir, 'smoke.pdf');
console.log(run(['build', deck, '--pdf', '-o', pdf]).trim());

if (!fs.existsSync(pdf)) fail('no PDF was written');
const bytes = fs.readFileSync(pdf);
if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail('the output is not a PDF');
const text = bytes.toString('latin1');

const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
if (pages !== SLIDES) fail(`${pages} page(s) for ${SLIDES} slides`);

if (!text.includes('/Outlines')) fail('the PDF carries no outline');
const items = [...text.matchAll(/<<[^<>]*\/Title\s*\(([^)]*)\)[^<>]*>>/g)]
  .filter((m) => m[0].includes('/Parent'))
  .map((m) => m[1]);
for (const title of ['Alpha', 'Beta'])
  if (!items.includes(title)) fail(`"${title}" missing from the outline (${items.join(', ')})`);
console.log(`  PDF: ${pages} pages, outline: ${items.join(' · ')}`);

// --- images ----------------------------------------------------------------
const stem = path.join(dir, 'frame');
console.log(run(['build', deck, '--png', '-o', `${stem}.png`]).trim());

const files = Array.from(
  { length: SLIDES },
  (_, i) => `${stem}-${String(i + 1).padStart(2, '0')}.png`,
);
for (const file of files) {
  if (!fs.existsSync(file)) fail(`${path.basename(file)} was not written`);
  const img = fs.readFileSync(file);
  if (img.subarray(1, 4).toString('latin1') !== 'PNG') fail(`${path.basename(file)} is not a PNG`);
  const [w, h] = [img.readUInt32BE(16), img.readUInt32BE(20)];
  if (w !== 2560 || h !== 1440) fail(`${path.basename(file)} is ${w}×${h}, expected 2560×1440`);
}
console.log(`  PNG: ${files.length} files at 2560×1440`);

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n✓ pdf smoke: the export ran headless and produced what it promised\n');
