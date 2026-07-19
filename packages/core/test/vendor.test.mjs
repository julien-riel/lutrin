/**
 * `lutrin vendor` — freezing external dependencies into the deck's directory.
 *
 * Two properties matter and are tested separately:
 *   1. the resulting directory is self-contained (kit copied, frontmatter consistent);
 *   2. vendoring modifies the author's source file for one reason only,
 *      and does so idempotently — it is THEIR file.
 *
 * No network: the test decks carry no remote image (the download path is
 * covered by assets-remote.test.mjs).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-vendor-cache-'));
process.env.LUTRIN_CACHE = CACHE;

const { vendorDeck, setFrontmatterKey } = await import('../src/vendor.mjs');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-vendor-'));

/** Minimal but complete kit: manifest, theme, layout, font, logo. */
function makeKit(dir, { primary = 'B45309' } = {}) {
  fs.mkdirSync(path.join(dir, 'layouts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logo'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'kit.json'),
    JSON.stringify({ name: 'sample', version: '1.0.0' }),
  );
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary } }));
  fs.writeFileSync(
    path.join(dir, 'layouts', 'custom.json'),
    JSON.stringify({ name: 'custom', slots: [] }),
  );
  fs.writeFileSync(path.join(dir, 'logo', 'mark.svg'), '<svg/>');
  return dir;
}

/** Deck with no remote image and no diagram: isolates what we want to observe. */
function makeDeck(dir, frontmatter = '') {
  const file = path.join(dir, 'deck.md');
  fs.writeFileSync(file, `---\ntitle: Sample\n${frontmatter}---\n\n# A slide\n\n- a bullet\n`);
  return file;
}

// ---------------------------------------------------------------------------
// setFrontmatterKey — we touch the author's file: precision is required
// ---------------------------------------------------------------------------

test('setFrontmatterKey adds a missing key without touching the body', () => {
  const src = '---\ntitle: Sample\n---\n\n# Body\n';
  const out = setFrontmatterKey(src, 'kit', './assets/kit');
  assert.equal(out, '---\ntitle: Sample\nkit: ./assets/kit\n---\n\n# Body\n');
});

test('setFrontmatterKey replaces an existing key, in place', () => {
  const src = '---\ntitle: Sample\nkit: old\nfooter: bottom\n---\n\n# Body\n';
  const out = setFrontmatterKey(src, 'kit', './assets/kit');
  assert.ok(out.includes('kit: ./assets/kit'));
  assert.ok(!out.includes('old'));
  assert.ok(
    out.indexOf('title') < out.indexOf('kit') && out.indexOf('kit') < out.indexOf('footer'),
    'order preserved',
  );
});

test('setFrontmatterKey is idempotent: a value that is already right rewrites nothing', () => {
  const src = '---\ntitle: Sample\nkit: ./assets/kit\n---\n\n# Body\n';
  assert.equal(
    setFrontmatterKey(src, 'kit', './assets/kit'),
    src,
    'identical string, byte for byte',
  );
});

test('setFrontmatterKey gives a frontmatter to a deck that has none', () => {
  const out = setFrontmatterKey('# Straight in\n', 'assets', 'vendor');
  assert.equal(out, '---\nassets: vendor\n---\n\n# Straight in\n');
});

test('setFrontmatterKey preserves CRLF line endings', () => {
  const out = setFrontmatterKey(
    '---\r\ntitle: Sample\r\n---\r\n\r\n# Body\r\n',
    'assets',
    'vendor',
  );
  assert.ok(
    out.includes('title: Sample\r\nassets: vendor'),
    'the added line follows the file convention',
  );
});

// ---------------------------------------------------------------------------
// vendorDeck
// ---------------------------------------------------------------------------

test('the kit is copied into assets/kit/ and the frontmatter points at it', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  const deck = makeDeck(dir);

  const r = await vendorDeck(deck, { themePath: kit });

  assert.equal(r.kit.files, 4, 'kit.json, theme.json, layouts/custom.json, logo/mark.svg');
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'kit', 'theme.json')));
  assert.ok(
    fs.existsSync(path.join(dir, 'assets', 'kit', 'layouts', 'custom.json')),
    'structure preserved',
  );
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'kit', 'logo', 'mark.svg')));
  assert.match(fs.readFileSync(deck, 'utf8'), /^kit: \.\/assets\/kit$/m);
});

test('the vendored deck resolves ITS OWN kit, no longer the original one', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'), { primary: 'AA0000' });
  const deck = makeDeck(dir);
  await vendorDeck(deck, { themePath: kit });

  // the original kit changes color: the vendored deck must not follow
  fs.writeFileSync(path.join(kit, 'theme.json'), JSON.stringify({ colors: { primary: '00BB00' } }));

  const { parseDeck } = await import('../src/deck/parse.mjs');
  const { resolveTheme } = await import('../src/deck/theme.mjs');
  const meta = parseDeck(fs.readFileSync(deck, 'utf8')).meta;
  const { theme } = resolveTheme(meta, { baseDir: dir });

  assert.equal(theme.colors.primary, 'AA0000', 'freezing is the very meaning of vendoring');
});

test('vendoring twice changes nothing further (idempotent)', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  const deck = makeDeck(dir);

  await vendorDeck(deck, { themePath: kit });
  const after1 = fs.readFileSync(deck, 'utf8');
  const r2 = await vendorDeck(deck, { themePath: kit });

  assert.equal(fs.readFileSync(deck, 'utf8'), after1, 'the source is not rewritten');
  assert.deepEqual(r2.frontmatter, [], 'nothing new to declare');
});

test('re-running vendor purges the files of a previous version of the kit', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  const deck = makeDeck(dir);
  await vendorDeck(deck, { themePath: kit });
  const orphan = path.join(dir, 'assets', 'kit', 'logo', 'old-logo.svg');
  fs.writeFileSync(orphan, '<svg/>');

  await vendorDeck(deck, { themePath: kit });

  assert.ok(!fs.existsSync(orphan), 'a logo removed from the kit does not survive in the copy');
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'kit', 'theme.json')), 'the kit stays complete');
});

test('the kit copy excludes executables and tooling', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  fs.writeFileSync(path.join(kit, 'build.mjs'), 'console.log(1)');
  fs.mkdirSync(path.join(kit, 'node_modules', 'thing'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'node_modules', 'thing', 'index.json'), '{}');
  const deck = makeDeck(dir);

  await vendorDeck(deck, { themePath: kit });

  const copy = path.join(dir, 'assets', 'kit');
  assert.ok(!fs.existsSync(path.join(copy, 'build.mjs')), 'data only: nothing executable');
  assert.ok(
    !fs.existsSync(path.join(copy, 'node_modules')),
    'the tooling belongs to the kit repository',
  );
});

test('with no remote image, `assets: vendor` is NOT added to the source', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  const deck = makeDeck(dir);

  const r = await vendorDeck(deck, { themePath: kit });

  assert.equal(r.images.total, 0);
  assert.ok(!fs.readFileSync(deck, 'utf8').includes('assets: vendor'), 'no line of noise');
  assert.deepEqual(r.frontmatter, ['kit: ./assets/kit']);
});

test('deck with no kit and no external resource: nothing is written', async () => {
  const dir = tmpDir();
  const deck = makeDeck(dir);
  const before = fs.readFileSync(deck, 'utf8');

  const r = await vendorDeck(deck, { themePath: 'none' });

  assert.equal(r.kit, null);
  assert.equal(fs.readFileSync(deck, 'utf8'), before, "the author's file is intact");
  assert.ok(!fs.existsSync(path.join(dir, 'assets')), 'no directory created for nothing');
});

test('a kit that is already vendored is not copied onto itself', async () => {
  const dir = tmpDir();
  makeKit(path.join(dir, 'assets', 'kit'));
  const deck = makeDeck(dir, 'kit: ./assets/kit\n');

  const r = await vendorDeck(deck, { themePath: null });

  assert.equal(r.kit.alreadyVendored, true);
  assert.ok(
    fs.existsSync(path.join(dir, 'assets', 'kit', 'theme.json')),
    'the copy was not erased',
  );
});

// ---------------------------------------------------------------------------
// BARE FILE theme — the third form of reference: not a kit, so nothing to
// vendor. The deck's directory is not a kit tree and must never be copied
// into itself.
// ---------------------------------------------------------------------------

test('a bare-file theme does NOT cause the deck directory to be copied', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary: 'AA0000' } }));
  fs.writeFileSync(path.join(dir, 'secret.md'), '# Private notes\n');
  fs.mkdirSync(path.join(dir, 'drafts'));
  fs.writeFileSync(path.join(dir, 'drafts', 'ideas.md'), '# to throw away\n');
  const deck = makeDeck(dir, 'kit: ./theme.json\n');
  const before = fs.readFileSync(deck, 'utf8');

  const r = await vendorDeck(deck, { themePath: null });

  assert.equal(r.kit, null, 'no kit to vendor');
  assert.ok(
    !fs.existsSync(path.join(dir, 'assets', 'kit')),
    "the author's surroundings do not end up in assets/kit/",
  );
  assert.equal(fs.readFileSync(deck, 'utf8'), before, "the author's frontmatter is intact");
});

test('a bare-theme deck still compiles with ITS OWN theme after vendoring', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary: 'AA0000' } }));
  const deck = makeDeck(dir, 'kit: ./theme.json\n');

  await vendorDeck(deck, { themePath: null });

  const { parseDeck } = await import('../src/deck/parse.mjs');
  const { resolveTheme } = await import('../src/deck/theme.mjs');
  const meta = parseDeck(fs.readFileSync(deck, 'utf8')).meta;
  const { theme, diagnostics } = resolveTheme(meta, { baseDir: dir });

  assert.equal(theme.colors.primary, 'AA0000', 'the original reference was not destroyed');
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === 'error'),
    [],
    'no KIT_INVALID: the frontmatter was not pointed at a directory without a kit.json',
  );
});

test('a bare theme OUTSIDE the directory is reported: it will not travel', async () => {
  const dir = tmpDir();
  const elsewhere = tmpDir();
  fs.writeFileSync(path.join(elsewhere, 'theme.json'), JSON.stringify({ colors: {} }));
  const deck = makeDeck(dir);

  const r = await vendorDeck(deck, { themePath: path.join(elsewhere, 'theme.json') });

  assert.equal(r.kit, null);
  assert.ok(
    r.warnings.some((w) => /will NOT travel/.test(w)),
    'the command cannot announce a self-contained directory without saying so',
  );
});

// ---------------------------------------------------------------------------
// assets/kit/: an rm -rf on a path derived from the frontmatter has to be earned
// ---------------------------------------------------------------------------

test('a foreign assets/kit/ is not erased, and the frontmatter does not point at it', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  fs.mkdirSync(path.join(dir, 'assets', 'kit'), { recursive: true });
  const mine = path.join(dir, 'assets', 'kit', 'photos.md');
  fs.writeFileSync(mine, '# my photos\n');
  const deck = makeDeck(dir);
  const before = fs.readFileSync(deck, 'utf8');

  const r = await vendorDeck(deck, { themePath: kit });

  assert.ok(fs.existsSync(mine), 'a directory without a kit.json belongs to the user');
  assert.equal(r.kit, null, 'nothing was vendored');
  assert.ok(r.warnings.some((w) => /not vendored/.test(w)));
  assert.equal(
    fs.readFileSync(deck, 'utf8'),
    before,
    'no rewrite towards a directory that was not written',
  );
});

test('a FILE standing in for assets/kit is reported as such, not as a directory', async () => {
  const dir = tmpDir();
  const kit = makeKit(path.join(dir, 'kit-source'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const occupant = path.join(dir, 'assets', 'kit');
  fs.writeFileSync(occupant, 'this is a file, not a directory\n');
  const deck = makeDeck(dir);
  const before = fs.readFileSync(deck, 'utf8');

  const r = await vendorDeck(deck, { themePath: kit });

  assert.equal(r.kit, null, 'nothing was vendored');
  const notice = r.warnings.find((w) => /not vendored/.test(w));
  assert.ok(notice, 'the refusal is stated');
  assert.match(notice, /is a file/, 'the message names what it actually encountered');
  assert.ok(
    !/no kit\.json/.test(notice),
    'a file has no kit.json to be missing: that reproach would send the reader after the wrong thing',
  );
  assert.equal(fs.readFileSync(occupant, 'utf8'), 'this is a file, not a directory\n');
  assert.equal(fs.readFileSync(deck, 'utf8'), before, 'no frontmatter rewrite');
});

// ---------------------------------------------------------------------------
// The invariant that matters, whatever line happens to produce it: after
// vendoring, if the frontmatter designates a kit DIRECTORY, that directory
// carries a kit.json. Pointing at it otherwise would make the deck impossible
// to compile (KIT_INVALID) — the worst possible outcome for a command whose
// whole purpose is to make things dependable.
// ---------------------------------------------------------------------------

test('the frontmatter is never rewritten towards a directory that has no kit.json', async () => {
  /** Sets a case up, vendors, and returns the `kit:` of the resulting frontmatter. */
  const declaredKit = async (setup) => {
    const dir = tmpDir();
    const { deck, themePath = null } = setup(dir);
    await vendorDeck(deck, { themePath });
    const m = fs.readFileSync(deck, 'utf8').match(/^kit:\s*(.+)$/m);
    return { dir, value: m ? m[1].trim() : null };
  };

  const cases = {
    // bare-file theme: the directory around it is the deck's own
    'bare theme in the deck directory': (dir) => {
      fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: {} }));
      return { deck: makeDeck(dir, 'kit: ./theme.json\n') };
    },
    'bare theme passed as --kit': (dir) => {
      fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: {} }));
      return { deck: makeDeck(dir), themePath: path.join(dir, 'theme.json') };
    },
    // the spot is taken by the user's own work
    'foreign assets/kit': (dir) => {
      const kit = makeKit(path.join(dir, 'kit-source'));
      fs.mkdirSync(path.join(dir, 'assets', 'kit'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'assets', 'kit', 'photos.md'), '# my photos\n');
      return { deck: makeDeck(dir), themePath: kit };
    },
    'assets/kit is a file': (dir) => {
      const kit = makeKit(path.join(dir, 'kit-source'));
      fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'assets', 'kit'), 'occupied\n');
      return { deck: makeDeck(dir), themePath: kit };
    },
    // and the nominal case, so the invariant is not verified on an empty set
    'real kit': (dir) => ({
      deck: makeDeck(dir),
      themePath: makeKit(path.join(dir, 'kit-source')),
    }),
  };

  for (const [name, setup] of Object.entries(cases)) {
    const { dir, value } = await declaredKit(setup);
    if (value === null) continue; // no `kit:` declared: nothing to check
    const target = path.resolve(dir, value);
    // a bare FILE theme declared by the author is beside the point; everything
    // else (a directory, or a path that does not even exist) must carry a kit.json
    if (fs.existsSync(target) && fs.statSync(target).isFile()) continue;
    assert.ok(
      fs.existsSync(path.join(target, 'kit.json')),
      `${name}: the frontmatter points at ${value}, a directory with no kit.json`,
    );
  }
});

test.after(() => fs.rmSync(CACHE, { recursive: true, force: true }));
