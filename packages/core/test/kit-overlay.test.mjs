/**
 * In-memory kit overlay — `kitData: { theme?, layouts? }` on compileHtml,
 * validateDeck and prepareDeckContext (the future kit editor previews an
 * UNSAVED kit state).
 *
 * The contract under test: kitData never replaces the RESOLUTION of the kit
 * (frontmatter/themePath still designate it), only the CONTENT read from its
 * disk — same validation, same diagnostics, same confinement, relative paths
 * anchored where the kit's theme.json lives or WOULD live. And no trace: a
 * compilation without kitData right after one with it reads the disk again.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTheme, resolveTheme } from '../src/deck/theme.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { validateDeck } from '../src/deck/validate.mjs';
import { compileHtml } from '../src/html/render.mjs';

// 1×1 transparent PNG — a real image, tiny enough to inline in the test
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_URI = `data:image/png;base64,${PNG_1PX.toString('base64')}`;

/** A kit on disk: kit.json + theme.json (unless null) + one real image. */
function tmpKit(t, theme, { name = 'overlay-kit' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-overlay-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const kit = path.join(base, name);
  fs.mkdirSync(path.join(kit, 'images'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name }));
  if (theme !== null) fs.writeFileSync(path.join(kit, 'theme.json'), JSON.stringify(theme));
  fs.writeFileSync(path.join(kit, 'images', 'hero.png'), PNG_1PX);
  return kit;
}

/** Adds a layouts/<name>.json definition to a kit created by tmpKit. */
function addKitLayout(kit, def) {
  fs.mkdirSync(path.join(kit, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'layouts', `${def.name}.json`), JSON.stringify(def));
}

function tmpDeckDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** compileHtml/prepareDeckContext mutate module state: restore it after each test. */
function freshStateAfter(t) {
  t.after(() => {
    applyTheme(null);
    prepareDeckContext({}, { baseDir: os.tmpdir() });
  });
}

const plainDeck = (kit) => `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\nBody text.\n`;
const imageDeck = (kit) =>
  `---\n${kit ? `kit: ${kit}\n` : ''}title: T\n---\n\n# Slide\n\n![right](kit:hero-photo)\n\nSome text beside the visual.\n`;
const layoutDeck = (kit, layout) =>
  `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\n<!-- layout: ${layout} -->\n\nBody text.\n`;

// ---------------------------------------------------------------------------
// Theme overlay
// ---------------------------------------------------------------------------

test('overlay theme: the in-memory color renders, the disk is untouched, the next compile re-reads the disk', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, { colors: { primary: '112233' } });
  const dir = tmpDeckDir(t);
  const kitData = { theme: { colors: { primary: '445566' } } };

  const overlaid = await compileHtml(plainDeck(kit), { baseDir: dir, fragment: true, kitData });
  assert.ok(overlaid.css.includes('#445566'), 'the fragment stylesheet carries the overlay color');
  assert.ok(!overlaid.css.includes('#112233'), 'the disk color is fully replaced');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(kit, 'theme.json'), 'utf8')).colors.primary,
    '112233',
    'the overlay writes nothing to disk',
  );

  // anti-leak: the same warm process, WITHOUT the overlay, is back on disk state
  const disk = await compileHtml(plainDeck(kit), { baseDir: dir, fragment: true });
  assert.ok(disk.css.includes('#112233'), 'without kitData the disk theme applies again');
  assert.ok(!disk.css.includes('#445566'), 'no overlay value survives the next compilation');
});

test('overlay theme: an in-memory images map resolves kit: aliases against the kit files on disk', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, {}); // the DISK theme declares no images
  const dir = tmpDeckDir(t);
  const kitData = { theme: { images: { 'hero-photo': './images/hero.png' } } };

  const { html, stats } = await compileHtml(imageDeck(kit), { baseDir: dir, kitData });
  assert.ok(html.includes(PNG_URI), 'the alias resolves to the kit image on disk and is inlined');
  assert.ok(!stats.warnings.some((w) => w.includes('Kit image')));

  // anti-leak: without the overlay, the disk theme still declares no images
  const bare = await compileHtml(imageDeck(kit), { baseDir: dir });
  assert.match(
    bare.stats.warnings.find((w) => w.includes('Kit image')) ?? '',
    /declares no images/,
    'the overlaid images map leaves no trace on the next compilation',
  );
});

test('overlay theme: an invalid overlay raises exactly the diagnostics of the same content on disk', (t) => {
  freshStateAfter(t);
  const bad = { colors: { primary: 'nope' }, banana: 7 };
  const dir = tmpDeckDir(t);
  const kitBad = tmpKit(t, bad, { name: 'bad-kit' });
  const kitGood = tmpKit(t, { colors: { primary: '112233' } }, { name: 'good-kit' });

  const disk = resolveTheme({ kit: kitBad }, { baseDir: dir });
  const mem = resolveTheme({ kit: kitGood }, { baseDir: dir, themeData: bad });
  assert.ok(
    disk.diagnostics.some((d) => d.code === 'THEME_BAD_VALUE'),
    'the broken hex is reported',
  );
  assert.ok(
    disk.diagnostics.some((d) => d.code === 'THEME_UNKNOWN_KEY'),
    'the unknown key is reported',
  );
  assert.deepEqual(mem.diagnostics, disk.diagnostics, 'same code path, same diagnostics');
  assert.deepEqual(mem.theme, disk.theme, 'and the same cleaned theme');

  const invalid = resolveTheme({ kit: kitGood }, { baseDir: dir, themeData: 'not-an-object' });
  assert.equal(invalid.diagnostics[0]?.code, 'THEME_INVALID');
  assert.equal(invalid.theme, null, 'a non-object overlay falls back like a non-object file');
});

// ---------------------------------------------------------------------------
// Layouts overlay
// ---------------------------------------------------------------------------

test('overlay layouts: an in-memory definition is usable by <!-- layout: -->, without mutating the host object', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, {});
  const dir = tmpDeckDir(t);
  const def = { name: 'overlay-note', base: 'content', density: 'compact' };
  const kitData = { layouts: [def] };

  const diags = validateDeck(layoutDeck(kit, 'overlay-note'), { baseDir: dir, kitData });
  assert.ok(
    !diags.some((d) => d.code === 'UNKNOWN_LAYOUT'),
    `the overlay layout is registered — seen: ${JSON.stringify(diags)}`,
  );
  const { html } = await compileHtml(layoutDeck(kit, 'overlay-note'), { baseDir: dir, kitData });
  assert.match(html, /data-layout="overlay-note"/);
  assert.deepEqual(
    def,
    { name: 'overlay-note', base: 'content', density: 'compact' },
    'the host keeps its definition object intact',
  );

  // anti-leak: the layout is gone as soon as the overlay is
  const bare = validateDeck(layoutDeck(kit, 'overlay-note'), { baseDir: dir });
  assert.ok(bare.some((d) => d.code === 'UNKNOWN_LAYOUT'));
});

test('overlay layouts: a collision with a built-in is reported exactly like from disk', (t) => {
  freshStateAfter(t);
  const collision = { name: 'content', base: 'content' };
  const kitDisk = tmpKit(t, {}, { name: 'twin-kit' });
  addKitLayout(kitDisk, collision);
  const kitMem = tmpKit(t, {}, { name: 'twin-kit' });

  const disk = prepareDeckContext({ kit: kitDisk }, { baseDir: tmpDeckDir(t) });
  const mem = prepareDeckContext(
    { kit: kitMem },
    { baseDir: tmpDeckDir(t), kitData: { layouts: [collision] } },
  );
  const find = (p) => p.diagnostics.find((d) => d.code === 'LAYOUT_DEF_INVALID');
  const dDisk = find(disk);
  const dMem = find(mem);
  assert.ok(dDisk && dMem, 'both sides report LAYOUT_DEF_INVALID');
  // same verdict; only the label differs (file name vs definition name)
  const strip = (m) => m.replace(/^Layout [^:]+: /, '');
  assert.equal(strip(dMem.message), strip(dDisk.message));
  assert.match(dMem.message, /already exists \(built-in layout\)/);
});

test('overlay layouts: an empty array masks the kit layouts on disk, and only for that compilation', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, {}, { name: 'layouts-kit' });
  addKitLayout(kit, { name: 'from-disk', base: 'content' });
  const dir = tmpDeckDir(t);
  const src = layoutDeck(kit, 'from-disk');

  assert.ok(
    !validateDeck(src, { baseDir: dir }).some((d) => d.code === 'UNKNOWN_LAYOUT'),
    'the disk layout applies without an overlay',
  );
  const masked = validateDeck(src, { baseDir: dir, kitData: { layouts: [] } });
  assert.ok(
    masked.some((d) => d.code === 'UNKNOWN_LAYOUT'),
    'an empty overlay is a kit without layouts — nothing read from disk',
  );
  assert.ok(
    !validateDeck(src, { baseDir: dir }).some((d) => d.code === 'UNKNOWN_LAYOUT'),
    'the disk layout is back as soon as the overlay is gone',
  );
});

// ---------------------------------------------------------------------------
// Resolution failures — replacing content cannot repair them
// ---------------------------------------------------------------------------

test('overlay theme: a reference to a NONEXISTENT file keeps THEME_NOT_FOUND — the overlay repairs nothing', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  // the ghost file's directory EXISTS and holds an image: before the fix, the
  // overlay silently applied, returned the nonexistent path to hosts watching
  // it, and admitted this directory as an asset-confinement root
  fs.mkdirSync(path.join(dir, 'elsewhere'));
  fs.writeFileSync(path.join(dir, 'elsewhere', 'photo.png'), PNG_1PX);
  const meta = { kit: './elsewhere/ghost.json' };
  const themeData = { colors: { primary: '445566' }, images: { pic: './photo.png' } };

  const disk = resolveTheme(meta, { baseDir: dir });
  assert.equal(disk.diagnostics[0]?.code, 'THEME_NOT_FOUND', 'disk behavior: an error');

  const mem = resolveTheme(meta, { baseDir: dir, themeData });
  assert.deepEqual(mem.diagnostics, disk.diagnostics, 'same failure as the disk compile');
  assert.equal(mem.theme, null, 'the overlay content is refused');
  assert.equal(mem.path, null, 'no host is pointed at a nonexistent theme file');
  assert.equal(mem.failed, true, 'the failure is explicit for prepareDeckContext');
});

test('overlay layouts: refused when the kit reference fails to resolve (parity with disk, both halves)', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  fs.mkdirSync(path.join(dir, 'not-a-kit')); // a directory without kit.json
  const kitData = {
    theme: { colors: { primary: '445566' } },
    layouts: [{ name: 'ghost-layout', base: 'content' }],
  };

  // KIT_INVALID (directory without manifest) and KIT_NOT_FOUND (bare name not
  // installed): in both states the disk loads nothing — neither must the overlay
  for (const [ref, code] of [
    ['./not-a-kit', 'KIT_INVALID'],
    ['kit-that-is-not-installed', 'KIT_NOT_FOUND'],
  ]) {
    const diags = validateDeck(layoutDeck(ref, 'ghost-layout'), { baseDir: dir, kitData });
    assert.ok(
      diags.some((d) => d.code === code),
      `${code} expected for ${ref} — seen: ${JSON.stringify(diags)}`,
    );
    assert.ok(
      diags.some((d) => d.code === 'UNKNOWN_LAYOUT'),
      `the overlay layout must NOT register on a failed reference (${ref})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Anchoring
// ---------------------------------------------------------------------------

test('layouts-only kit: the overlay theme anchors its relative paths at the manifest-declared theme location', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, null, { name: 'layouts-only' }); // NO theme.json on disk
  addKitLayout(kit, { name: 'kit-note', base: 'content' });
  const dir = tmpDeckDir(t);
  const kitData = {
    theme: { colors: { primary: '445566' }, images: { 'hero-photo': './images/hero.png' } },
  };

  const src = imageDeck(kit);
  const res = await compileHtml(src, { baseDir: dir, fragment: true, kitData });
  assert.ok(res.css.includes('#445566'), 'the overlay theme applies on a kit without theme.json');
  assert.ok(
    res.slides.join('').includes(PNG_URI),
    './images/hero.png is anchored at <kit>/theme.json — the default manifest location',
  );
  assert.ok(!res.stats.warnings.some((w) => w.includes('Kit image')));
  assert.ok(
    !validateDeck(layoutDeck(kit, 'kit-note'), { baseDir: dir, kitData }).some(
      (d) => d.code === 'UNKNOWN_LAYOUT',
    ),
    'the kit layouts on disk still load beside the overlaid theme',
  );
});

test('no kit resolved: the overlay theme still applies, anchored at the deck directory', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  fs.mkdirSync(path.join(dir, 'images'));
  fs.writeFileSync(path.join(dir, 'images', 'hero.png'), PNG_1PX);
  const kitData = {
    theme: { colors: { primary: '445566' }, images: { 'hero-photo': './images/hero.png' } },
  };

  const res = await compileHtml(imageDeck(null), { baseDir: dir, fragment: true, kitData });
  assert.ok(res.css.includes('#445566'), 'the overlay applies with no kit reference anywhere');
  assert.ok(
    res.slides.join('').includes(PNG_URI),
    'relative paths resolve from the deck directory (bare-theme anchor)',
  );
});

// ---------------------------------------------------------------------------
// validateDeck parity
// ---------------------------------------------------------------------------

test('validateDeck: overlay diagnostics equal the compilation warnings, positioned on the kit: line', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, { colors: { primary: '112233' } });
  const dir = tmpDeckDir(t);
  const src = plainDeck(kit);
  const kitData = { theme: { colors: { primary: 'broken' } } };

  const diags = validateDeck(src, { baseDir: dir, kitData });
  const d = diags.find((x) => x.code === 'THEME_BAD_VALUE');
  assert.ok(d, `THEME_BAD_VALUE expected — seen: ${JSON.stringify(diags)}`);
  assert.equal(d.line, 2, 'positioned on the frontmatter kit: line, like a disk theme');

  const { stats } = await compileHtml(src, { baseDir: dir, fragment: true, kitData });
  assert.ok(
    stats.warnings.includes(d.message),
    'validation and compilation speak with one voice about the overlay',
  );
});
