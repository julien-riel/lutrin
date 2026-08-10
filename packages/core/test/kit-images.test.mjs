/**
 * Kit images by alias — the "images" map of a kit's theme.json, referenced
 * from a deck as `![role](kit:<alias>)`.
 *
 * The contract under test: once the alias is resolved, the image IS a local
 * image — same roles, same placement, same embedding in both outputs — and
 * everything specific to the feature happens at the edges: validation and
 * confinement in theme.mjs (the kit is the trust root, like its logos), alias
 * substitution in resolveLocalImage (assets.mjs), and one dedicated
 * diagnostic, KIT_IMAGE_UNKNOWN, wherever the alias names nothing.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { KIT_IMAGES } from '../src/deck/tokens.mjs';
import { applyTheme, resolveTheme } from '../src/deck/theme.mjs';
import { kitImageAlias, kitImageDiagnostic, resolveLocalImage } from '../src/deck/assets.mjs';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';
import { compileHtml } from '../src/html/render.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { renderDeck } from '../src/pptx/render.mjs';

// 1×1 transparent PNG — a real image, tiny enough to inline in the test
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A kit carrying one real image under images/, plus the theme given. */
function tmpKit(t, theme, { name = 'image-kit' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-images-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const kit = path.join(base, name);
  fs.mkdirSync(path.join(kit, 'images'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name }));
  fs.writeFileSync(path.join(kit, 'theme.json'), JSON.stringify(theme));
  fs.writeFileSync(path.join(kit, 'images', 'hero.png'), PNG_1PX);
  return kit;
}

function tmpDeckDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** compileHtml/renderDeck mutate module state: restore it after each test. */
function freshStateAfter(t) {
  t.after(() => {
    applyTheme(null);
    prepareDeckContext({}, { baseDir: os.tmpdir() });
  });
}

const HERO_THEME = { images: { 'hero-photo': './images/hero.png' } };

// ---------------------------------------------------------------------------
// theme.json validation → KIT_IMAGES
// ---------------------------------------------------------------------------

test('theme: a valid images map resolves to absolute paths and populates KIT_IMAGES', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });

  assert.deepEqual(diagnostics, [], 'a well-formed map produces no diagnostic');
  assert.equal(theme.images['hero-photo'], path.join(kit, 'images', 'hero.png'));

  applyTheme(theme);
  assert.equal(KIT_IMAGES['hero-photo'], path.join(kit, 'images', 'hero.png'));
  applyTheme(null);
  assert.deepEqual(KIT_IMAGES, {}, 'the snapshot restore empties the map — no leak between decks');
});

test('theme: an invalid alias is refused with the example, and does not survive', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, { images: { Hero_Photo: './images/hero.png', x: './images/hero.png' } });
  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });

  const bad = diagnostics.filter((d) => d.code === 'THEME_BAD_VALUE');
  assert.equal(bad.length, 2, 'one refusal per invalid alias (bad characters, too short)');
  assert.match(bad[0].message, /"hero-photo"/, 'the message shows a valid example');
  assert.equal(theme.images, undefined);
});

test('theme: a reserved alias ("prototype") is refused out loud, never silently dropped', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, {
    images: { prototype: './images/hero.png', 'hero-photo': './images/hero.png' },
  });
  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });

  const bad = diagnostics.filter((d) => d.code === 'THEME_BAD_VALUE');
  assert.equal(bad.length, 1, 'exactly one refusal, for the reserved alias');
  assert.match(bad[0].message, /images alias "prototype" is reserved/);
  assert.deepEqual(Object.keys(theme.images), ['hero-photo'], 'the valid alias survives alone');

  applyTheme(theme);
  assert.equal(Object.hasOwn(KIT_IMAGES, 'prototype'), false, 'never an own key on the live map');
});

test('hostile kit: an image path that leaves the kit is refused (THEME_PATH_ESCAPE)', (t) => {
  freshStateAfter(t);
  const secret = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-secret-'));
  t.after(() => fs.rmSync(secret, { recursive: true, force: true }));
  fs.writeFileSync(path.join(secret, 'id_rsa.png'), 'PRIVATE-KEY');
  const kit = tmpKit(t, { images: { stolen: path.join(secret, 'id_rsa.png') } });

  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });

  const escapeDiag = diagnostics.find((d) => d.code === 'THEME_PATH_ESCAPE');
  assert.ok(escapeDiag, `an escape must be reported — seen: ${JSON.stringify(diagnostics)}`);
  assert.match(escapeDiag.message, /images\.stolen/);
  assert.equal(theme.images, undefined, 'no path outside the kit survives in the theme');
});

test('theme: a missing image file and a refused extension are each named', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, {
    images: { ghost: './images/nope.png', bitmap: './images/hero.bmp' },
  });
  fs.writeFileSync(path.join(kit, 'images', 'hero.bmp'), PNG_1PX);
  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });

  assert.match(
    diagnostics.find((d) => /images\.ghost/.test(d.message))?.message ?? '',
    /not found/,
  );
  assert.match(
    diagnostics.find((d) => /images\.bitmap/.test(d.message))?.message ?? '',
    /PNG, JPEG, GIF, WebP or SVG/,
    'the allow-list is exactly what a local deck image supports',
  );
  assert.equal(theme.images, undefined);
});

test('theme: images must be an object — anything else is reported, never a silent no-op', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, { images: ['./images/hero.png'] });
  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });
  assert.match(
    diagnostics.find((d) => d.code === 'THEME_BAD_VALUE')?.message ?? '',
    /images must be an object/,
  );
  assert.equal(theme.images, undefined);
});

// ---------------------------------------------------------------------------
// Resolution seam (assets.mjs)
// ---------------------------------------------------------------------------

test('resolveLocalImage: a known alias bypasses the deck roots (the kit is the trust root)', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const { theme } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });
  applyTheme(theme);

  // roots that contain NOTHING: a kit image must not be judged against them
  assert.equal(
    resolveLocalImage(['/nonexistent-root'], 'kit:hero-photo'),
    path.join(kit, 'images', 'hero.png'),
  );
  assert.equal(resolveLocalImage(['/nonexistent-root'], 'kit:absent'), null);
  // the scheme is case-insensitive like lucide:, the alias is not
  assert.equal(kitImageAlias('KIT:hero-photo'), 'hero-photo');
  assert.equal(kitImageAlias('lucide:leaf'), null, 'the lucide: scheme is untouched');
  assert.equal(kitImageAlias('./kit:pun.png'), null);
});

test('kitImageAlias: the angle-bracket destination form resolves like a local image', async (t) => {
  freshStateAfter(t);
  // markdown-it encodes any space of an <...> destination: <kit: hero-photo>
  // becomes kit:%20hero-photo — decoded like resolveImagePath does for
  // ![right](<./my pic.png>), so the two forms behave the same
  assert.equal(kitImageAlias('kit:%20hero-photo'), 'hero-photo');
  assert.equal(kitImageAlias('kit:hero%2Dphoto'), 'hero-photo');
  assert.equal(kitImageAlias('kit:100%'), '100%', 'an invalid % sequence keeps the raw form');

  const kit = tmpKit(t, HERO_THEME);
  const { html, stats } = await compileHtml(
    `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\n![right](<kit: hero-photo>)\n\nSome text beside the visual.\n`,
    { baseDir: tmpDeckDir(t) },
  );
  assert.ok(
    html.includes(`data:image/png;base64,${PNG_1PX.toString('base64')}`),
    'the encoded form travels inside the document like the bare one',
  );
  assert.ok(!stats.warnings.some((w) => w.includes('Kit image')));
});

test('kitImageDiagnostic: unknown alias → KIT_IMAGE_UNKNOWN with a did-you-mean', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const { theme } = resolveTheme({ kit }, { baseDir: tmpDeckDir(t) });
  applyTheme(theme);

  const d = kitImageDiagnostic('kit:hero-phot');
  assert.equal(d.code, 'KIT_IMAGE_UNKNOWN');
  assert.equal(d.severity, 'warning', 'aligned with MISSING_IMAGE: the slide still renders');
  assert.equal(d.suggestion, 'hero-photo');
  assert.equal(kitImageDiagnostic('kit:hero-photo'), null);
  assert.equal(kitImageDiagnostic('./local.png'), null);
  // inherited properties are not images: no path comes back, only the diagnostic
  assert.equal(resolveLocalImage(['/tmp'], 'kit:constructor'), null);
});

// ---------------------------------------------------------------------------
// HTML output
// ---------------------------------------------------------------------------

const deckSource = (kit, alias) =>
  `---\n${kit ? `kit: ${kit}\n` : ''}title: T\n---\n\n# Slide\n\n![right](kit:${alias})\n\nSome text beside the visual.\n`;

test('HTML: a known alias is inlined as a data-URI, like any local image', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const { html, stats } = await compileHtml(deckSource(kit, 'hero-photo'), {
    baseDir: tmpDeckDir(t),
  });

  assert.ok(
    html.includes(`data:image/png;base64,${PNG_1PX.toString('base64')}`),
    'the kit image travels inside the document',
  );
  assert.ok(
    !stats.warnings.some((w) => w.includes('Kit image')),
    'a declared alias has nothing to warn about',
  );
});

test('HTML: an unknown alias keeps the placeholder and says so in the warnings', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const { html, stats } = await compileHtml(deckSource(kit, 'hero-phot'), {
    baseDir: tmpDeckDir(t),
  });

  assert.match(html, /\[image: kit:hero-phot\]/, 'the usual placeholder, never a broken slide');
  const warning = stats.warnings.find((w) => w.includes('Kit image "hero-phot"'));
  assert.ok(warning, `expected a kit-image warning — seen: ${JSON.stringify(stats.warnings)}`);
  assert.match(warning, /Did you mean "hero-photo"\?/);
});

test('HTML: kit: in a deck compiled WITHOUT a kit warns instead of crashing', async (t) => {
  freshStateAfter(t);
  const { html, stats } = await compileHtml(deckSource(null, 'hero-photo'), {
    baseDir: tmpDeckDir(t),
  });

  assert.match(html, /\[image: kit:hero-photo\]/);
  assert.match(
    stats.warnings.find((w) => w.includes('Kit image')) ?? '',
    /declares no images/,
    'the generic theme declares none — the message says so rather than listing nothing',
  );
});

// ---------------------------------------------------------------------------
// validate (no build)
// ---------------------------------------------------------------------------

test('validate: an unknown alias lands on the image line, like MISSING_IMAGE', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const source = deckSource(kit, 'hero-phot');
  const diags = validateDeck(source, { baseDir: tmpDeckDir(t) });

  const d = diags.find((x) => x.code === 'KIT_IMAGE_UNKNOWN');
  assert.ok(d, `KIT_IMAGE_UNKNOWN expected — seen: ${JSON.stringify(diags)}`);
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 8, 'positioned on the ![right](kit:…) line');
  assert.equal(d.suggestion, 'hero-photo');
});

test('validate: a declared alias raises neither KIT_IMAGE_UNKNOWN nor MISSING_IMAGE', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const diags = validateDeck(deckSource(kit, 'hero-photo'), { baseDir: tmpDeckDir(t) });
  assert.ok(
    !diags.some((d) => d.code === 'KIT_IMAGE_UNKNOWN' || d.code === 'MISSING_IMAGE'),
    `no image diagnostic expected — seen: ${JSON.stringify(diags)}`,
  );
});

// ---------------------------------------------------------------------------
// PPTX output
// ---------------------------------------------------------------------------

test('PPTX: a deck with a kit image compiles, embeds the media, and warns on the unknown alias only', async (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  const dir = tmpDeckDir(t);
  const source = `---\nkit: ${kit}\ntitle: T\n---\n\n# One\n\n![right](kit:hero-photo)\n\nText.\n\n# Two\n\n![right](kit:hero-phot)\n\nText.\n`;

  const deck = parseDeck(source);
  prepareDeckContext(deck.meta, { baseDir: dir });
  const scenes = buildScenes(deck);
  const out = path.join(dir, 'kit-images.pptx');
  const stats = await renderDeck(scenes, deck.meta, dir, out);

  assert.equal(stats.slideCount, 3, 'cover (frontmatter title) + the two content slides');
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  assert.ok(
    Object.keys(zip.files).some((n) => /^ppt\/media\/.*\.png$/.test(n)),
    'the kit image is embedded as a media part',
  );
  const kitWarnings = stats.warnings.filter((w) => w.includes('Kit image'));
  assert.equal(kitWarnings.length, 1, 'one warning, for the unknown alias only');
  assert.match(kitWarnings[0], /"hero-phot"/);
});

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

test('capabilities: the resolved kit publishes its image aliases, and the diagnostic exists', (t) => {
  freshStateAfter(t);
  const kit = tmpKit(t, HERO_THEME);
  prepareDeckContext({ kit }, { baseDir: tmpDeckDir(t) });

  const caps = capabilities();
  assert.deepEqual(caps.kitImages, ['hero-photo']);
  assert.ok(caps.diagnostics.includes('KIT_IMAGE_UNKNOWN'));
  assert.ok(caps.theme.keys.includes('images'));

  prepareDeckContext({}, { baseDir: os.tmpdir() });
  assert.deepEqual(capabilities().kitImages, [], 'no kit, no aliases — never a leak');
});

// ---------------------------------------------------------------------------
// Layout-declared kit image — the `image` parameter of the split/hero bases:
// the kit ships a layout that places one of its own images, and the deck
// shows it without one line of Markdown naming it.
// ---------------------------------------------------------------------------

/** The kit of tmpKit, plus a layouts/ directory carrying `defs`. */
function tmpKitWithLayouts(t, theme, defs) {
  const kit = tmpKit(t, theme);
  fs.mkdirSync(path.join(kit, 'layouts'));
  for (const def of defs)
    fs.writeFileSync(path.join(kit, 'layouts', `${def.name}.json`), JSON.stringify(def));
  return kit;
}

const BRAND_SPLIT = {
  name: 'brand-split',
  base: 'split',
  image: 'kit:hero-photo',
  description: 'Text beside the kit hero photo — the deck never names the image.',
};

test('HTML: a layout-declared kit image is embedded like one the deck wrote', async (t) => {
  freshStateAfter(t);
  const kit = tmpKitWithLayouts(t, HERO_THEME, [BRAND_SPLIT]);
  const source = `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\n<!-- layout: brand-split -->\n\nSome text beside the kit visual.\n`;
  const { html, stats } = await compileHtml(source, { baseDir: tmpDeckDir(t) });

  assert.ok(
    html.includes(`data:image/png;base64,${PNG_1PX.toString('base64')}`),
    'the asset prepass fetches and inlines the synthesized image block',
  );
  assert.ok(!stats.warnings.some((w) => w.includes('Kit image')));
});

test('validate: a layout image with an unknown alias lands on the layout line, with the did-you-mean', (t) => {
  freshStateAfter(t);
  const kit = tmpKitWithLayouts(t, HERO_THEME, [
    { name: 'brand-typo', base: 'split', image: 'kit:hero-phot' },
  ]);
  const source = `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\n<!-- layout: brand-typo -->\n\nText only.\n`;
  const diags = validateDeck(source, { baseDir: tmpDeckDir(t) });

  const d = diags.find((x) => x.code === 'KIT_IMAGE_UNKNOWN');
  assert.ok(d, `KIT_IMAGE_UNKNOWN expected — seen: ${JSON.stringify(diags)}`);
  assert.match(
    d.message,
    /Layout "brand-typo"/,
    'the message names the layout, not a phantom image',
  );
  assert.equal(d.line, 8, 'anchored on the <!-- layout: … --> line');
  assert.equal(d.suggestion, 'hero-photo');
});

test('validate: a slide bringing its own visual is told the layout image stays away (info)', (t) => {
  freshStateAfter(t);
  const kit = tmpKitWithLayouts(t, HERO_THEME, [BRAND_SPLIT]);
  const source = `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\n<!-- layout: brand-split -->\n\nText.\n\n![right](kit:hero-photo)\n`;
  const diags = validateDeck(source, { baseDir: tmpDeckDir(t) });

  const d = diags.find((x) => x.code === 'LAYOUT_IMAGE_UNUSED');
  assert.ok(d, `LAYOUT_IMAGE_UNUSED expected — seen: ${JSON.stringify(diags)}`);
  assert.equal(d.severity, 'info', 'an automatic decision, reported, never a fault');
  assert.match(d.message, /brand-split/);

  // text-only slide: the layout image applies, nothing to report
  const clean = validateDeck(
    `---\nkit: ${kit}\ntitle: T\n---\n\n# Slide\n\n<!-- layout: brand-split -->\n\nText only.\n`,
    { baseDir: tmpDeckDir(t) },
  );
  assert.ok(!clean.some((x) => x.code === 'LAYOUT_IMAGE_UNUSED' || x.code === 'KIT_IMAGE_UNKNOWN'));
});

test('PPTX: a hero layout background from the kit is embedded as a media part', async (t) => {
  freshStateAfter(t);
  const kit = tmpKitWithLayouts(t, HERO_THEME, [
    { name: 'brand-hero', base: 'hero', image: 'kit:hero-photo' },
  ]);
  const dir = tmpDeckDir(t);
  const source = `---\nkit: ${kit}\ntitle: T\n---\n\n# Opener\n\n<!-- layout: brand-hero -->\n\nA line over the brand photo.\n`;

  const deck = parseDeck(source);
  prepareDeckContext(deck.meta, { baseDir: dir });
  const scenes = buildScenes(deck);
  assert.equal(scenes[1].master, 'hero');
  assert.equal(scenes[1].image.src, 'kit:hero-photo');
  const out = path.join(dir, 'layout-image.pptx');
  const stats = await renderDeck(scenes, deck.meta, dir, out);

  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  assert.ok(
    Object.keys(zip.files).some((n) => /^ppt\/media\/.*\.png$/.test(n)),
    'the background the layout declared is embedded',
  );
  assert.ok(!stats.warnings.some((w) => w.includes('Kit image')));
});
