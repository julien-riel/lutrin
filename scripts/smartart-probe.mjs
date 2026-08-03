#!/usr/bin/env node
/**
 * SmartArt probe: the files a human opens to answer the one question this
 * machine cannot.
 *
 * Everything about the OOXML half is verified by the test suite EXCEPT the
 * thing it exists for — that PowerPoint opens the package without offering to
 * repair it, shows *SmartArt Design* on the object, and lays the diagram out
 * the way the layout definition asks. There is no PowerPoint here, Keynote
 * cannot be driven without an Accessibility grant, and `soffice` is not
 * installed. So the answer comes from a person, and this script exists to
 * make asking cheap.
 *
 * It is a thin CLI over the SHIPPING code path — `lutrin build --smartart` —
 * and not a hand-written package. That matters: a probe built from XML written
 * beside the real builder would go green on bytes that never ship, and every
 * tweak to the parts would mean rewriting the probe.
 *
 *   node scripts/smartart-probe.mjs          # round A: one file per family
 *   node scripts/smartart-probe.mjs --sweep  # round B: node counts 2…8
 *
 * ROUND A first, and one file per family. PowerPoint gives no per-slide
 * attribution when it refuses a package: a single twenty-slide file that fails
 * teaches only that something in it is wrong. Four files name the culprit.
 *
 * Record what you see in docs/plans/smartart.md — the gate table is there, and
 * an answer nobody wrote down has to be obtained again.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(here, '..', 'packages', 'core', 'src');

const { parseDeck } = await import(path.join(CORE, 'deck', 'parse.mjs'));
const { buildScenes } = await import(path.join(CORE, 'deck', 'layout.mjs'));
const { renderDeck } = await import(path.join(CORE, 'pptx', 'render.mjs'));
const { FAMILIES } = await import(path.join(CORE, 'pptx', 'diagram-parts.mjs'));

const OUT = path.join(os.tmpdir(), 'lutrin-smartart-probe');

const words = ['Plan', 'Build', 'Review', 'Ship', 'Measure', 'Adjust', 'Renew', 'Retire'];

/** One slide of a family with `n` nodes. */
function slide(family, n, title) {
  const head = `# ${title}\n\n<!-- layout: ${family} -->\n\n`;
  if (family === 'hierarchy') {
    // a tree of n leaves under one root, two levels deep past three
    const lines = ['- Root'];
    for (let i = 0; i < n; i++) {
      lines.push(`  - ${words[i % words.length]}`);
      if (i === 0) lines.push('    - A leaf');
    }
    return `${head}${lines.join('\n')}\n\n`;
  }
  const lead = family === 'radial' ? 'The platform\n\n' : '';
  const secs = Array.from({ length: n }, (_, i) => `## ${words[i % words.length]} ${i + 1}\n`).join(
    '\n',
  );
  return `${head}${lead}${secs}\n`;
}

async function write(name, source) {
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(OUT, `${name}.pptx`);
  const deck = parseDeck(source);
  const stats = await renderDeck(buildScenes(deck), deck.meta, dir, out, { smartart: true });
  fs.rmSync(dir, { recursive: true, force: true });
  return { out, stats };
}

const sweep = process.argv.includes('--sweep');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const families = Object.keys(FAMILIES);
const results = [];

if (!sweep) {
  // Round A — one file per family, one diagram each.
  for (const family of families) {
    const n = family === 'venn' ? 2 : 3;
    const source = `---\ntitle: ${family} probe\n---\n\n${slide(family, n, `${family} — ${n} nodes`)}`;
    results.push({ name: family, ...(await write(family, source)) });
  }
} else {
  // Round B — every family across the node counts it accepts, plus the two
  // cases the design deliberately bet on.
  const counts = [2, 3, 6, 8];
  let body = '';
  for (const family of families) {
    for (const n of counts) {
      if (family === 'venn' && n > 4) continue;
      body += slide(family, n, `${family} — ${n}`);
    }
  }
  // TWO diagrams of the same family in one deck. The design ships no
  // per-diagram suffix machinery, on the argument that `uniqueId` identifies
  // the layout DEFINITION and each diagram binds through `dgm:relIds`. This
  // slide pair is what would falsify that.
  body += slide('cycle', 4, 'cycle — first of two in one deck');
  body += slide('cycle', 5, 'cycle — second of two in one deck');
  results.push({
    name: 'sweep',
    ...(await write('sweep', `---\ntitle: SmartArt sweep\n---\n\n${body}`)),
  });
}

console.log(`\nProbes written to ${OUT}\n`);
for (const r of results) {
  const warn = r.stats.warnings.length ? ` — ${r.stats.warnings.length} warning(s)` : '';
  console.log(
    `  ${path.basename(r.out).padEnd(14)} ${String(r.stats.smartArtDiagrams).padStart(2)} diagram(s), ${r.stats.slideCount} slides${warn}`,
  );
  for (const w of r.stats.warnings) console.log(`      ${w}`);
}

console.log(`
Open each file and record the answers in docs/plans/smartart.md:

  1. Does it open with NO repair dialog?
  2. Click the object: does the ribbon show SmartArt Design — Text Pane,
     Change Layout, Change Colors — and do those galleries show the lutrin
     entry rather than opening blank?
  3. Is the node count right, and the reading order the one in the Markdown?
  4. What does Reset Graphic do?
  5. Are the colours the deck's, or Office blue? (They must be the deck's:
     the colour part ships literal values, never theme accents.)
  6. Same files in Keynote, LibreOffice and Google Slides — what renders?
     A blank frame in Keynote is EXPECTED and documented; a blank frame in
     LibreOffice means the drawing cache is wrong.
  7. Unzip a PowerPoint-authored SmartArt .pptx and record the literal
     dsp:dataModelExt/@minVer — ours is shipped provisionally.

A family that will not lay out correctly is turned off on its own line:
FAMILIES.<family>.smartart = false in packages/core/src/pptx/diagram-parts.mjs.
It then falls back to native shapes, which are correct, and nothing else in
the build changes.
`);

if (process.platform === 'darwin' && process.argv.includes('--open')) {
  const { spawnSync } = await import('node:child_process');
  spawnSync('open', [OUT]);
}
