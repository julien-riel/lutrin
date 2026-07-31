#!/usr/bin/env node
/**
 * Builds the kit gallery — `node scripts/gallery.mjs [outDir]` (default `site`).
 *
 * For every kit in `examples/kits/`, two artefacts:
 *
 *     <out>/kits/<name>.deckkit    the archive `lutrin kit install <url>` fetches
 *     <out>/gallery/<name>.html    the specimen deck, compiled INTO that kit
 *
 * The same specimen for all of them, on purpose: the gallery compares kits, and
 * a comparison whose content moves compares nothing. Every difference a visitor
 * sees on site/gallery.html comes from the kit and from nowhere else.
 *
 * This script exists so that the loop exists ONCE. `npm run site` runs it with
 * `site/` and `.github/workflows/pages.yml` runs it with `_site/`; writing it
 * out in YAML as well would be the copy nobody remembers to update — the same
 * reasoning that keeps the playground's vendored package list in a single
 * place. It shells out to the real CLI rather than importing the compiler,
 * because `kit create` and `build --kit` are exactly what a reader will run,
 * and a private path here could keep working after theirs broke.
 *
 * The archive is named after the manifest's `name`, never after the directory:
 * that name is what the kit installs under, so the URL and
 * `lutrin build --kit <name>` cannot disagree. (They are equal today, and
 * packages/core/test/kit-gallery.test.mjs keeps them so.)
 *
 * `<out>/kits/` and `<out>/gallery/` are emptied first. Both are written by
 * this script alone, and a kit deleted from the repository must not go on
 * being served — locally it would linger, and in a deploy it would 404 from a
 * page that no longer mentions it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KITS = path.join(ROOT, 'examples', 'kits');
const SPECIMEN = path.join(KITS, 'specimen.deck.md');
const CLI = path.join(ROOT, 'packages', 'core', 'src', 'cli.mjs');

const out = path.resolve(ROOT, process.argv[2] ?? 'site');
const archives = path.join(out, 'kits');
const specimens = path.join(out, 'gallery');

/** Kit directories, in the order the page reads them (alphabetical). */
const kitDirs = fs
  .readdirSync(KITS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(KITS, e.name, 'kit.json')))
  .map((e) => path.join(KITS, e.name))
  .sort();

if (!kitDirs.length) {
  console.error(`✖ no kit found in ${KITS}`);
  process.exit(1);
}

for (const dir of [archives, specimens]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT }).toString();

let bytes = 0;
for (const dir of kitDirs) {
  const { name } = JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8'));
  const archive = path.join(archives, `${name}.deckkit`);
  const page = path.join(specimens, `${name}.html`);

  run(['kit', 'create', dir, '-o', archive]);
  run(['build', SPECIMEN, '--html', '--kit', dir, '-o', page]);

  const size = fs.statSync(archive).size + fs.statSync(page).size;
  bytes += size;
  console.log(`✓ ${name} — ${(size / 1024).toFixed(1)} kB`);
}

/** Relative to the repository when it is under it (`_site/kits`), absolute
 *  otherwise — a path climbing out through six `../` reads as an error. */
const show = (p) => {
  const rel = path.relative(ROOT, p);
  return rel && !rel.startsWith('..') ? rel : p;
};

console.log(
  `${kitDirs.length} kits → ${show(archives)}/ and ${show(specimens)}/ (${(bytes / 1024).toFixed(0)} kB)`,
);
