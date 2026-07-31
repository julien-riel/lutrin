/**
 * The kit gallery — examples/kits/, site/gallery.html, and the promise that
 * ties them together.
 *
 * The gallery makes one claim, and everything here defends it: eight kits,
 * ONE deck, and every difference a visitor sees comes from the kit. Three ways
 * that claim can rot without anyone noticing:
 *
 *   1. A kit is added to the repository and no card is written for it — it
 *      ships, is served, and is invisible. Or the reverse: a card survives a
 *      kit that was deleted, and its install command 404s on a page that says
 *      "installable in one command". So the two lists are compared, in both
 *      directions, and the URLs are compared against the archive names
 *      scripts/gallery.mjs actually writes.
 *   2. A kit is authored with a colour pair the engine itself would warn
 *      about. A gallery of specimens compiled with accessibility warnings
 *      would be advertising the opposite of what the product sells, so
 *      themeContrastDiagnostics() has to be empty for every one of them —
 *      and the whole specimen is compiled in each kit, which is the only way
 *      to catch a kit whose type scale overflows a slot.
 *   3. A kit names a font nobody has. No kit here ships `fonts.files`, and a
 *      theme that changes the family without them embeds NOTHING (deliberately
 *      — see applyTheme): both outputs then fall back on whatever is installed.
 *      That is safe only for the few families that always are, so the family
 *      is checked against that list.
 *
 * The tiles are also required to point at the SAME slide, and at one that
 * exists: "the same slide in eight kits" is the entire argument of the page,
 * and a deck shortened by one slide would leave eight blank frames behind.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readKit } from '../src/deck/kit.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { applyTheme, resolveTheme, themeContrastDiagnostics } from '../src/deck/theme.mjs';
import { validateDeck } from '../src/deck/validate.mjs';

const CORE = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(CORE, '..', '..');
const KITS_DIR = path.join(REPO, 'examples', 'kits');
const SPECIMEN = path.join(KITS_DIR, 'specimen.deck.md');
const PAGE = path.join(REPO, 'site', 'gallery.html');

/**
 * Families installed on essentially every machine that opens a deck. Not a
 * style guide: a kit here ships no font file, so this list is the set of
 * names whose glyphs are already on the reader's system — the browser and
 * PowerPoint both fall back on the same thing, which is the only reason the
 * two outputs stay comparable at all.
 */
const UNIVERSAL_FONTS = new Set([
  'Arial',
  'Arial Black',
  'Courier New',
  'Georgia',
  'Impact',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]);

const kitNames = fs
  .readdirSync(KITS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(KITS_DIR, e.name, 'kit.json')))
  .map((e) => e.name)
  .sort();

const page = fs.readFileSync(PAGE, 'utf8');
const specimenSource = fs.readFileSync(SPECIMEN, 'utf8');

/** One entry per card: what its frame shows, what its command reads, and what
 *  its button would put on the clipboard. Split out of the markup rather than
 *  grepped page-wide so that the three can be compared WITHIN a card — a tile
 *  framing one kit above a command installing another would pass every
 *  page-wide count. */
const cards = [...page.matchAll(/<article class="kit">([\s\S]*?)<\/article>/g)].map(([, html]) => ({
  framed: html.match(/data-src="gallery\/([a-z0-9-]+)\.html"/)?.[1] ?? null,
  shown: html.match(/<code>([^<]+)<\/code>/)?.[1] ?? null,
  copied: html.match(/data-copy="([^"]+)"/)?.[1] ?? null,
}));
const urlOf = (name) => `lutrin kit install https://info.lutrin.app/kits/${name}.deckkit`;

test('the gallery holds enough kits to be a comparison', () => {
  assert.ok(
    kitNames.length >= 6,
    `${kitNames.length} kit(s) in examples/kits/ — the gallery compares brands, and fewer than six is a sample rather than a range`,
  );
});

test('every kit is a valid kit, named after its own directory', () => {
  for (const name of kitNames) {
    const { manifest, diagnostics } = readKit(path.join(KITS_DIR, name));
    assert.ok(manifest, `${name}: ${diagnostics.map((d) => d.message).join(' / ')}`);
    assert.deepEqual(
      diagnostics,
      [],
      `${name} raises ${diagnostics.map((d) => d.message).join(' / ')}`,
    );
    // The archive is written under manifest.name and installs under it too, so
    // a directory that disagrees would publish /kits/<dir>.deckkit for a kit
    // that then answers to another name in `build --kit`.
    assert.equal(manifest.name, name, `${name}/kit.json names itself "${manifest.name}"`);
    assert.ok(manifest.description, `${name} has no description — the card is written from it`);
  }
});

test('no kit names a font it does not ship and the reader may not have', () => {
  for (const name of kitNames) {
    const { theme } = resolveTheme({}, { baseDir: REPO, themePath: path.join(KITS_DIR, name) });
    const fonts = theme?.fonts ?? {};
    if (fonts.files) continue; // ships its own glyphs — any family is fair game
    for (const [slot, family] of Object.entries(fonts)) {
      assert.ok(
        UNIVERSAL_FONTS.has(family),
        `${name}: fonts.${slot} = "${family}" — the kit ships no fonts.files, so nothing is embedded and the reader falls back on what they have. Use one of: ${[...UNIVERSAL_FONTS].join(', ')}.`,
      );
    }
  }
});

test('every kit clears the contrast thresholds the engine holds itself to', (t) => {
  t.after(() => applyTheme(null));
  for (const name of kitNames) {
    const { theme, diagnostics } = resolveTheme(
      {},
      { baseDir: REPO, themePath: path.join(KITS_DIR, name) },
    );
    assert.deepEqual(diagnostics, [], `${name}: theme.json is not clean`);
    applyTheme(theme);
    assert.deepEqual(
      themeContrastDiagnostics(),
      [],
      `${name} would compile a deck the engine itself warns about`,
    );
  }
});

test('the specimen compiles in every kit, without one diagnostic', (t) => {
  t.after(() => applyTheme(null));
  for (const name of kitNames) {
    const kitDir = path.join(KITS_DIR, name);
    const deck = parseDeck(specimenSource);
    const { theme } = resolveTheme(deck.meta, { baseDir: KITS_DIR, themePath: kitDir });
    applyTheme(theme);
    const scenes = buildScenes(deck);
    const diagnostics = validateDeck(specimenSource, {
      baseDir: KITS_DIR,
      themePath: kitDir,
      deck,
      scenes,
    });
    assert.deepEqual(
      diagnostics,
      [],
      `${name}: ${diagnostics.map((d) => `${d.severity} ${d.code}`).join(', ')}`,
    );
  }
});

test('the page shows every kit, and offers no kit the repository has not got', () => {
  assert.deepEqual(
    cards.map((c) => c.framed).sort(),
    kitNames,
    'the tiles and examples/kits/ disagree — a kit with no tile is invisible, a tile with no kit frames a 404',
  );
  for (const card of cards) {
    // scripts/gallery.mjs writes exactly <out>/kits/<name>.deckkit, so this is
    // the one URL that can be true; and the command a reader reads has to be
    // the command the button hands them.
    assert.equal(card.shown, urlOf(card.framed), `${card.framed}: the command shown is wrong`);
    assert.equal(
      card.copied,
      card.shown,
      `${card.framed}: copy gives something else than it shows`,
    );
  }
});

test('every tile shows the same slide, and that slide exists', () => {
  const slides = [...page.matchAll(/data-slide="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(slides.length, kitNames.length, 'one framed slide per kit, no more and no less');
  assert.equal(
    new Set(slides).size,
    1,
    `the tiles show slides ${[...new Set(slides)].join(', ')} — the page's whole claim is that the content is held constant`,
  );

  applyTheme(null);
  const scenes = buildScenes(parseDeck(specimenSource));
  assert.ok(
    slides[0] >= 1 && slides[0] <= scenes.length,
    `the tiles frame slide ${slides[0]} of a ${scenes.length}-slide specimen — the frames would come out blank`,
  );
});

test('the deploy and `npm run site` both build the gallery', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(
    workflow,
    /scripts\/gallery\.mjs _site/,
    'pages.yml does not build the gallery — the page would ship with eight framed 404s',
  );
  const { scripts } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.match(
    scripts.site ?? '',
    /scripts\/gallery\.mjs/,
    '`npm run site` does not build the gallery, so `npm run site:serve` shows it empty',
  );
});

test('the gallery page is listed, and the specimens are kept out of the index', () => {
  const sitemap = fs.readFileSync(path.join(REPO, 'site', 'sitemap.xml'), 'utf8');
  assert.match(
    sitemap,
    /https:\/\/info\.lutrin\.app\/gallery\.html/,
    'sitemap.xml lists every page',
  );

  // Same reasoning as demo.html: the eight specimens carry identical prose and
  // would compete with the page that presents them. The trailing slash is what
  // keeps /gallery.html itself crawlable.
  const robots = fs.readFileSync(path.join(REPO, 'site', 'robots.txt'), 'utf8');
  assert.match(robots, /^Disallow: \/gallery\/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/gallery\.html$/m);
});
