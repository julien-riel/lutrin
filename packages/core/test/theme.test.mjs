/**
 * JSON themes (review §3.3, step 1): applied by in-place mutation — the
 * OPPOSITE choice to the purity of buildScenes (layout.test.mjs), assumed and
 * fenced in here: applyTheme ALWAYS restarts from the snapshot of the default
 * theme (never a leak between compilations, a survival condition for warm
 * hosts), derived groups follow the palette, validation never throws,
 * resolution accepts files AND npm packages, and the theme really does travel
 * all the way to the HTML and the .pptx (zip reopened).
 *
 * Every test that mutates the tokens registers its cleanup through t.after
 * BEFORE the first assertion: a failure midway must not cascade into failures
 * of the following tests (blurred diagnosis).
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  COLORS,
  FONTS,
  FONT_FILES,
  TYPE,
  SPACE,
  PAGE,
  ROUNDED,
  CHROME,
  CHART_COLORS,
  LAYER_SHADES,
  TREND_INK,
  SEMANTIC,
} from '../src/deck/tokens.mjs';
import {
  applyTheme,
  resolveTheme,
  themeContrastDiagnostics,
  isKitName,
  THEME_KEYS,
  userConfigRoot,
  userKitsDir,
  listInstalledKits,
  readUserKit,
  setUserKit,
  migrateUserConfig,
} from '../src/deck/theme.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';
import { compileHtml } from '../src/html/render.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeck } from '../src/pptx/render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JSON = path.resolve(here, '..', 'design', 'themes', 'default.json');
const EXAMPLE_JSON = path.resolve(here, '..', '..', '..', 'examples', 'theme-example.json');

// 1×1 transparent PNG — minimal theme logo for the output tests
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const strip = (v) => JSON.parse(JSON.stringify(v));
const liveTokens = () =>
  strip({
    COLORS,
    FONTS,
    TYPE,
    SPACE,
    PAGE,
    CHROME,
    CHART_COLORS,
    LAYER_SHADES,
    TREND_INK,
    SEMANTIC,
  });

/** Key paths of an object (recursive) — to compare STRUCTURES. */
function keyPaths(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  return Object.keys(obj).flatMap((k) => keyPaths(obj[k], prefix ? `${prefix}.${k}` : k));
}

/** Writes a temporary theme; cleanup to be passed to t.after. */
function tmpTheme(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-'));
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    typeof json === 'string' ? json : JSON.stringify(json),
  );
  return {
    dir,
    file: path.join(dir, 'theme.json'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('anti-drift: design/themes/default.json is the exact mirror of the tokens (no-op, zero diagnostics)', (t) => {
  t.after(() => applyTheme(null));
  const before = liveTokens();
  const { theme, diagnostics } = resolveTheme({ kit: DEFAULT_JSON }, { baseDir: '/' });
  assert.deepEqual(diagnostics, [], 'the canonical theme must produce no diagnostic');
  applyTheme(theme);
  assert.deepEqual(
    liveTokens(),
    before,
    'applying default.json must be a no-op — regenerate the file if tokens.mjs has changed',
  );
  assert.deepEqual(themeContrastDiagnostics(), []);
});

test('structural anti-drift: default.json covers ALL the token keys (a token added without regenerating the file breaks here)', () => {
  // the no-op test does not see a key added to the tokens and ABSENT from the
  // JSON (nothing to merge = a no-op all the same): compare the STRUCTURES
  const json = JSON.parse(fs.readFileSync(DEFAULT_JSON, 'utf8'));
  const MIRRORED = {
    colors: COLORS,
    fonts: { body: FONTS.body, mono: FONTS.mono },
    type: TYPE,
    space: SPACE,
    page: {
      margin: PAGE.margin,
      gutter: PAGE.gutter,
      titleHeight: PAGE.titleHeight,
      footerHeight: PAGE.footerHeight,
    },
    rounded: ROUNDED,
    chrome: CHROME,
    trendInk: TREND_INK,
    semantic: SEMANTIC,
  };
  for (const [key, live] of Object.entries(MIRRORED)) {
    assert.deepEqual(
      keyPaths(json[key]).sort(),
      keyPaths(strip(live)).sort(),
      `default.json/${key} does not have the same keys as the tokens — regenerate design/themes/default.json`,
    );
  }
  assert.equal(json.chartColors.length, CHART_COLORS.length, 'chartColors: same length');
  assert.equal(json.layerShades.length, LAYER_SHADES.length, 'layerShades: same length');
});

test('applyTheme(null) fully restores the default theme after a theme (no leak between compilations)', (t) => {
  t.after(() => applyTheme(null));
  const before = liveTokens();
  applyTheme({
    colors: { primary: '123ABC' },
    type: { body: 99 },
    chartColors: ['111111'],
    space: { xxl: 64 },
  });
  assert.equal(COLORS.primary, '123ABC');
  assert.equal(PAGE.margin, 64, 'PAGE.margin derives from SPACE.xxl');
  assert.equal(CHART_COLORS.length, 1);
  applyTheme(null);
  assert.deepEqual(liveTokens(), before);
});

test('the derived groups follow the theme palette (LAYER_SHADES, SEMANTIC, TREND_INK)', (t) => {
  t.after(() => applyTheme(null));
  applyTheme({
    colors: { primaryDarker: '112233', positiveDark: '00420A', positiveLight: 'EEFFEE' },
  });
  assert.equal(LAYER_SHADES[0].fill, '112233', 'the base layer follows primaryDarker');
  assert.equal(
    SEMANTIC.success.text,
    '00420A',
    'the text of success callouts follows positiveDark',
  );
  assert.equal(SEMANTIC.success.fill, 'EEFFEE');
  assert.equal(TREND_INK.positive, '00420A', 'the trend ink follows positiveDark');
});

test('an explicit override of a derived group wins over the recomputation — page.margin/gutter/footerHeight included', (t) => {
  t.after(() => applyTheme(null));
  applyTheme({
    colors: { primaryDarker: '112233' },
    semantic: { success: { label: 'Good call' } },
    layerShades: [{ fill: '000000', ink: 'FFFFFF' }],
    page: { margin: 24, gutter: 8, footerHeight: 16, titleHeight: 80 },
  });
  assert.equal(SEMANTIC.success.label, 'Good call');
  assert.equal(LAYER_SHADES.length, 1, 'the theme layerShades replaces the whole array');
  assert.deepEqual(LAYER_SHADES[0], { fill: '000000', ink: 'FFFFFF' });
  // deriveTokens() recomputes margin/gutter/footerHeight from SPACE: an
  // explicit override from the theme must SURVIVE (bug confirmed by the review)
  assert.equal(
    PAGE.margin,
    24,
    'the theme page.margin survives the recomputation of the derived values',
  );
  assert.equal(PAGE.gutter, 8);
  assert.equal(PAGE.footerHeight, 16);
  assert.equal(PAGE.titleHeight, 80);
});

test('resolveTheme: colors normalized (# and case), unknown key → suggestion, invalid values dropped', (t) => {
  const { file, cleanup } = tmpTheme({
    colors: { primary: '#0b5394', primaryLighter: 'not-a-color' },
    chrome: { cover: { barY: 'top' } },
    colours: { primary: '000000' },
    page: { width: 1000 },
  });
  t.after(cleanup);
  const { theme, diagnostics } = resolveTheme({ kit: file }, { baseDir: '/' });
  assert.equal(theme.colors.primary, '0B5394', 'the # is stripped, the case normalized');
  assert.equal(theme.colors.primaryLighter, undefined, 'malformed color dropped');
  const codes = diagnostics.map((d) => d.code);
  assert.ok(codes.includes('THEME_UNKNOWN_KEY'), 'unknown key "colours" reported');
  assert.equal(
    diagnostics.find((d) => d.code === 'THEME_UNKNOWN_KEY' && d.suggestion === 'colors')
      ?.suggestion,
    'colors',
  );
  assert.ok(
    diagnostics.some((d) => d.code === 'THEME_BAD_VALUE' && /page\.width/.test(d.message)),
    'page.width is the physical frame — refused',
  );
  assert.ok(
    diagnostics.some((d) => d.code === 'THEME_BAD_VALUE' && /barY/.test(d.message)),
    'non-numeric chrome.cover.barY refused',
  );
  assert.equal(theme.page, undefined, 'page keeps nothing once width is removed');
});

test('resolveTheme: a group that is not an object is reported, never a silent no-op', (t) => {
  const { file, cleanup } = tmpTheme({
    colors: '097D6C',
    type: [14, 16],
    trendInk: '025D29',
    page: 'wide',
  });
  t.after(cleanup);
  const { theme, diagnostics } = resolveTheme({ kit: file }, { baseDir: '/' });
  assert.deepEqual(theme, {}, 'nothing is applied');
  const badGroups = diagnostics.filter((d) => d.code === 'THEME_BAD_VALUE').map((d) => d.message);
  for (const g of ['colors', 'type', 'trendInk', 'page'])
    assert.ok(
      badGroups.some((m) => m.includes(`${g} must be an object`)),
      `group ${g} reported`,
    );
});

test('resolveTheme: file not found → THEME_NOT_FOUND, invalid JSON → THEME_INVALID (never an exception)', (t) => {
  const miss = resolveTheme({ kit: './does-not-exist.json' }, { baseDir: os.tmpdir() });
  assert.equal(miss.theme, null);
  assert.equal(miss.diagnostics[0].code, 'THEME_NOT_FOUND');
  assert.equal(miss.diagnostics[0].severity, 'error');

  const { file, cleanup } = tmpTheme('{ not json');
  t.after(cleanup);
  const bad = resolveTheme({ kit: file }, { baseDir: '/' });
  assert.equal(bad.theme, null);
  assert.equal(bad.diagnostics[0].code, 'THEME_INVALID');
});

test('resolveTheme: a DIRECTORY used as a logo or a font is refused (EISDIR at render time otherwise)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-dir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'sig.png'));
  fs.mkdirSync(path.join(dir, 'font.ttf'));
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({ logos: { cover: './sig.png' }, fonts: { files: { regular: './font.ttf' } } }),
  );
  const { theme, diagnostics } = resolveTheme({ kit: './theme.json' }, { baseDir: dir });
  assert.equal(theme.logos, undefined, 'directory-as-logo dropped');
  assert.equal(theme.fonts?.files, undefined, 'directory-as-font dropped');
  assert.equal(diagnostics.filter((d) => d.code === 'THEME_BAD_VALUE').length, 2);
});

test('resolveTheme: fonts.files requires a .ttf WITH its .woff2 twin (HTML/PPTX parity)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-fonts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Alone.ttf'), 'ttf'); // without a .woff2 twin
  fs.writeFileSync(path.join(dir, 'Pair.ttf'), 'ttf');
  fs.writeFileSync(path.join(dir, 'Pair.woff2'), 'woff2');
  fs.writeFileSync(path.join(dir, 'Bad.otf'), 'otf');
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    // body supplied: what is tested HERE is the .ttf/.woff2 pairing in
    // isolation (the refusal of files-without-body has its own test)
    JSON.stringify({
      fonts: {
        body: 'My Font',
        files: { regular: './Pair.ttf', bold: './Alone.ttf', italic: './Bad.otf' },
      },
    }),
  );
  const { theme, diagnostics } = resolveTheme({ kit: './theme.json' }, { baseDir: dir });
  assert.deepEqual(Object.keys(theme.fonts.files), ['regular'], 'only the ttf+woff2 pair is kept');
  assert.ok(
    diagnostics.some((d) => /woff2/.test(d.message)),
    'the missing .woff2 is explained',
  );
  assert.ok(
    diagnostics.some((d) => /\.ttf/.test(d.message) && /italic/.test(d.message)),
    'the .otf extension is refused',
  );
});

test('applyTheme: the theme fonts.files are embedded; family changed without files → NO embedding (no disguised glyphs)', (t) => {
  t.after(() => applyTheme(null));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Body.ttf'), 'ttf');
  fs.writeFileSync(path.join(dir, 'Body.woff2'), 'woff2');
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({ fonts: { body: 'My Font', files: { regular: './Body.ttf' } } }),
  );
  const { theme } = resolveTheme({ kit: './theme.json' }, { baseDir: dir });
  applyTheme(theme);
  assert.equal(FONTS.body, 'My Font');
  assert.equal(
    FONT_FILES.regular,
    path.join(dir, 'Body.ttf'),
    'the theme .ttf is kept for embedding',
  );
  assert.equal(FONT_FILES.bold, null, 'variant not supplied: no fallback on other files');

  applyTheme({ fonts: { body: 'Georgia' } });
  assert.equal(FONTS.body, 'Georgia');
  assert.equal(
    FONT_FILES.regular,
    null,
    'family changed without fonts.files: no embedding under "Georgia"',
  );
  assert.equal(FONT_FILES.bold, null);
  assert.equal(FONT_FILES.italic, null);
  // changing only the MONO font leaves the body embedding at its default
  applyTheme({ fonts: { mono: 'Consolas' } });
  assert.equal(FONTS.mono, 'Consolas');
  assert.equal(FONT_FILES.regular, null, 'the generic default embeds nothing');
});

test('resolveTheme: __proto__ and dangerous keys ignored — no prototype pollution', (t) => {
  t.after(() => applyTheme(null));
  const { file, cleanup } = tmpTheme(
    '{"__proto__": {"polluted": true}, "colors": {"__proto__": {"polluted": true}, "primary": "0B5394"}}',
  );
  t.after(cleanup);
  const { theme } = resolveTheme({ kit: file }, { baseDir: '/' });
  applyTheme(theme);
  assert.equal({}.polluted, undefined, 'Object.prototype intact');
  assert.equal(COLORS.polluted, undefined);
  assert.equal(COLORS.primary, '0B5394');
});

test('themeContrastDiagnostics: callouts AND the omnipresent pairs (main text, secondary text, section title)', (t) => {
  t.after(() => applyTheme(null));
  applyTheme({ semantic: { info: { fill: 'FFFFFF', text: 'EEEEEE' } } });
  assert.ok(
    themeContrastDiagnostics().some(
      (d) => d.code === 'THEME_CONTRAST' && /:::info/.test(d.message),
    ),
  );

  applyTheme({ colors: { neutralPrimary: 'DDDDDD' } });
  assert.ok(
    themeContrastDiagnostics().some((d) => /main text/.test(d.message)),
    'unreadable main text is reported',
  );

  applyTheme({
    colors: { primary: 'EEEEEE' },
    chartColors: ['111111'],
    layerShades: [{ fill: '111111', ink: 'FFFFFF' }],
  });
  assert.ok(
    themeContrastDiagnostics().some((d) => /section/.test(d.message)),
    'an unreadable section title (white on a light primary) is reported',
  );

  applyTheme(null);
  assert.deepEqual(themeContrastDiagnostics(), []);
});

test('validateDeck: the frontmatter theme is validated, the diagnostic sits on the theme: line', (t) => {
  const { dir, cleanup } = tmpTheme({}); // deck directory
  t.after(cleanup);
  const source = '---\ntitle: Demo\nkit: ./missing.json\n---\n\n# A slide\n\nSome text.\n';
  const diags = validateDeck(source, { baseDir: dir });
  const themeDiag = diags.find((d) => d.code === 'THEME_NOT_FOUND');
  assert.ok(themeDiag, 'THEME_NOT_FOUND expected');
  assert.equal(themeDiag.line, 3, 'positioned on the frontmatter "kit:" line');
});

test('the example theme (examples/theme-example.json) is valid and passes the WCAG thresholds', (t) => {
  t.after(() => applyTheme(null));
  const { theme, diagnostics } = resolveTheme({ kit: EXAMPLE_JSON }, { baseDir: '/' });
  assert.deepEqual(diagnostics, []);
  applyTheme(theme);
  assert.deepEqual(themeContrastDiagnostics(), []);
  assert.equal(COLORS.primary, '0B5394');
});

test('capabilities() exposes the kit (frontmatter, keys, THEME_* and KIT_* diagnostics)', () => {
  const caps = capabilities();
  assert.ok(caps.frontmatter.includes('kit'));
  assert.deepEqual(caps.theme.keys, THEME_KEYS);
  for (const code of [
    'THEME_NOT_FOUND',
    'THEME_INVALID',
    'THEME_UNKNOWN_KEY',
    'THEME_BAD_VALUE',
    'THEME_CONTRAST',
    'KIT_NOT_FOUND',
    'KIT_INVALID',
    'KIT_DEPRECATED_KEY',
  ])
    assert.ok(caps.diagnostics.includes(code), code);
});

test('HTML e2e: the theme colors, chrome and logo travel to the document, without leaking into the next compilation', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-e2e-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'logo.png'), PNG_1PX);
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({
      colors: { primary: '123ABC', neutralPrimary: '102030' },
      chrome: { cover: { barY: 111 } },
      logos: { cover: './logo.png' },
    }),
  );
  const source = '---\ntitle: Theme demo\nkit: ./theme.json\n---\n\n# Slide\n\nSome text.\n';
  const themed = await compileHtml(source, { baseDir: dir });
  assert.match(themed.html, /#123ABC/, 'the theme primary color is in the CSS');
  assert.match(themed.html, /#102030/, 'the theme ink also reaches presentScript (presenter view)');
  assert.match(
    themed.html,
    /\.cover-bar\{[^}]*top:111px/,
    'the theme chrome geometry is in the CSS',
  );
  assert.match(themed.html, /<img src="data:image\/png;base64,/, 'the theme PNG logo is inlined');
  assert.deepEqual(themed.stats.warnings, []);
  assert.equal(themed.themeFile, path.join(dir, 'theme.json'));

  // next compilation WITHOUT a theme: the default theme is back
  const plain = await compileHtml('---\ntitle: Demo\n---\n\n# Slide\n\nSome text.\n', {
    baseDir: dir,
  });
  assert.doesNotMatch(plain.html, /#123ABC/, 'no leak from the previous theme');
  assert.doesNotMatch(
    plain.html,
    /<img src="data:image\/png;base64,/,
    'the theme logo does not leak',
  );
  assert.match(plain.html, /#1D4ED8/, 'default theme primary back');
  assert.match(plain.html, /\.cover-bar\{[^}]*top:280px/, 'default chrome back');
});

test('PPTX e2e: the theme color is in the XML of the zip (cover band)', async (t) => {
  t.after(() => applyTheme(null));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theme-pptx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary: '123ABC' } }));
  const source = '---\ntitle: Theme demo\nkit: ./theme.json\n---\n';
  const deck = parseDeck(source);
  const prep = prepareDeckContext(deck.meta, { baseDir: dir });
  assert.deepEqual(prep.diagnostics, []);
  const scenes = buildScenes(deck);
  const out = path.join(dir, 'demo.pptx');
  await renderDeck(scenes, deck.meta, dir, out);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /123ABC/, 'the cover band carries the theme color');
});

// ---------------------------------------------------------------------------
// Resolution by KIT: installed name, directory, bare file
// ---------------------------------------------------------------------------

/** Temporary project carrying an uninstalled KIT (<proj>/my-kit/) and a
 *  docs/ subdirectory for the deck; cleanup to be passed to t.after. */
function tmpKitProject({ kitJson = null, projectJson = null } = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-proj-'));
  const kit = path.join(proj, 'my-kit');
  fs.mkdirSync(path.join(kit, 'layouts'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'docs'));
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify(kitJson ?? { name: 'my-kit' }));
  fs.writeFileSync(path.join(kit, 'theme.json'), JSON.stringify({ colors: { primary: '0B5394' } }));
  fs.writeFileSync(
    path.join(kit, 'layouts', 'double.json'),
    JSON.stringify({ name: 'double', base: 'two-columns', description: 'kit alias' }),
  );
  if (projectJson) fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify(projectJson));
  return {
    proj,
    kit,
    docs: path.join(proj, 'docs'),
    cleanup: () => fs.rmSync(proj, { recursive: true, force: true }),
  };
}

test('resolveTheme: a kit directory designated by path supplies theme.json AND layouts/', (t) => {
  t.after(() => applyTheme(null));
  const { kit, docs, cleanup } = tmpKitProject();
  t.after(cleanup);
  const {
    theme,
    path: file,
    layoutsDir,
    kitName,
    diagnostics,
  } = resolveTheme({ kit: '../my-kit' }, { baseDir: docs });
  assert.deepEqual(diagnostics, []);
  assert.equal(theme.colors.primary, '0B5394');
  assert.equal(file, path.join(kit, 'theme.json'));
  assert.equal(kitName, 'my-kit', 'the name comes from the manifest, not from the directory');
  assert.equal(
    layoutsDir,
    path.join(kit, 'layouts'),
    'the layouts/ directory of the kit is detected by convention',
  );
});

test('resolveTheme: the KIT name comes from the manifest, even when the directory is called something else', (t) => {
  t.after(() => applyTheme(null));
  const { proj, docs, cleanup } = tmpKitProject({ kitJson: { name: 'brand-acme' } });
  t.after(cleanup);
  fs.renameSync(path.join(proj, 'my-kit'), path.join(proj, 'downloaded-2026'));
  const r = resolveTheme({ kit: '../downloaded-2026' }, { baseDir: docs });
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.kitName, 'brand-acme');
});

test('resolveTheme: a directory WITHOUT kit.json is refused explicitly', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-no-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'not-a-kit'));
  const { theme, diagnostics } = resolveTheme({ kit: './not-a-kit' }, { baseDir: dir });
  assert.equal(theme, null);
  assert.equal(diagnostics[0].code, 'KIT_INVALID');
  assert.match(diagnostics[0].message, /kit\.json/);
});

test('resolveTheme: installed kit not found → KIT_NOT_FOUND with the install advice', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-no-kit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { theme, diagnostics } = resolveTheme({ kit: 'absent-xyz' }, { baseDir: dir });
  assert.equal(theme, null);
  assert.equal(diagnostics[0].code, 'KIT_NOT_FOUND');
  assert.equal(diagnostics[0].severity, 'error');
  assert.match(diagnostics[0].message, /kit install/);
});

test('resolveTheme: a LAYOUTS-ONLY kit reports layoutsDir without touching the tokens', (t) => {
  t.after(() => applyTheme(null));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-layouts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const kit = path.join(dir, 'layouts-only');
  fs.mkdirSync(path.join(kit, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name: 'layouts-only' }));
  fs.writeFileSync(
    path.join(kit, 'layouts', 'duo.json'),
    JSON.stringify({ name: 'duo', base: 'two-columns' }),
  );

  const r = resolveTheme({ kit: './layouts-only' }, { baseDir: dir });
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.theme, null, 'no token: the default theme stays in place');
  assert.equal(r.layoutsDir, path.join(kit, 'layouts'), 'the layouts come up all the same');
  assert.equal(r.kitName, 'layouts-only');
});

test('frontmatter: "theme:" stays accepted as a deprecated alias, with a diagnostic', (t) => {
  t.after(() => applyTheme(null));
  const { file, cleanup } = tmpTheme({ colors: { primary: '123ABC' } });
  t.after(cleanup);
  const dir = path.dirname(file);

  const viaAlias = resolveTheme({ theme: './theme.json' }, { baseDir: dir });
  assert.equal(
    viaAlias.theme?.colors?.primary,
    '123ABC',
    'decks written before kits still compile',
  );
  const d = viaAlias.diagnostics.find((x) => x.code === 'KIT_DEPRECATED_KEY');
  assert.ok(d && d.severity === 'warning', 'the deprecation is reported without blocking');

  // kit: wins over theme: when both are there, and deprecates nothing
  const { file: other, cleanup: c2 } = tmpTheme({ colors: { primary: '445566' } });
  t.after(c2);
  const viaKit = resolveTheme({ kit: other, theme: './theme.json' }, { baseDir: dir });
  assert.equal(viaKit.theme?.colors?.primary, '445566', '"kit:" wins over "theme:"');
  assert.equal(
    viaKit.diagnostics.find((x) => x.code === 'KIT_DEPRECATED_KEY'),
    undefined,
  );
});

test('project default: "lutrin": { "kit": … } from the nearest package.json; kit: none opts out of it', (t) => {
  t.after(() => applyTheme(null));
  const { docs, cleanup } = tmpKitProject({
    projectJson: { name: 'project', lutrin: { kit: './my-kit' } },
  });
  t.after(cleanup);
  const viaProject = resolveTheme({}, { baseDir: docs });
  assert.deepEqual(viaProject.diagnostics, []);
  assert.equal(
    viaProject.theme?.colors?.primary,
    '0B5394',
    'the project default applies without frontmatter',
  );
  assert.equal(viaProject.kitName, 'my-kit');

  const optOut = resolveTheme({ kit: 'none' }, { baseDir: docs });
  assert.equal(optOut.theme, null, 'kit: none forces the default theme');
  assert.deepEqual(optOut.diagnostics, []);
});

test('project default: the old "theme" key of package.json is still read as a fallback', (t) => {
  t.after(() => applyTheme(null));
  const { docs, cleanup } = tmpKitProject({
    projectJson: { name: 'p', lutrin: { theme: './my-kit' } },
  });
  t.after(cleanup);
  const r = resolveTheme({}, { baseDir: docs });
  assert.deepEqual(r.diagnostics, [], 'a project written before kits does not break');
  assert.equal(r.theme?.colors?.primary, '0B5394');
});

test('prepareDeckContext: the kit layouts are loaded, a collision from the deck is attributed to the kit', (t) => {
  t.after(() => {
    applyTheme(null);
    prepareDeckContext({}, { baseDir: os.tmpdir() });
  });
  const { docs, cleanup } = tmpKitProject();
  t.after(cleanup);
  const prep = prepareDeckContext({ kit: '../my-kit' }, { baseDir: docs });
  assert.deepEqual(prep.diagnostics, []);
  // the kit layout is usable through <!-- layout: double -->
  const source = `---\ntitle: Demo\nkit: "../my-kit"\n---\n\n# Two panels\n<!-- layout: double -->\n\n## Left\n\n- a\n\n## Right\n\n- b\n`;
  const diags = validateDeck(source, { baseDir: docs });
  assert.ok(
    !diags.some((d) => d.code === 'UNKNOWN_LAYOUT'),
    'the "double" layout from the kit is known to validation',
  );

  // collision: the deck ALSO defines layouts/double.json → attributed to the kit
  fs.mkdirSync(path.join(docs, 'layouts'), { recursive: true });
  fs.writeFileSync(
    path.join(docs, 'layouts', 'double.json'),
    JSON.stringify({ name: 'double', base: 'comparison' }),
  );
  const prep2 = prepareDeckContext({ kit: '../my-kit' }, { baseDir: docs });
  const collision = prep2.diagnostics.find((d) => d.code === 'LAYOUT_DEF_INVALID');
  assert.ok(collision, 'the collision is reported');
  assert.match(collision.message, /my-kit/);
});

test('HTML e2e: a kit theme applied through the frontmatter (kit color in the CSS)', async (t) => {
  // compileHtml mutates the tokens AND the registry (the kit's 'double'
  // layout): reset to a fresh state so the following tests of the file are
  // not contaminated
  t.after(() => {
    applyTheme(null);
    prepareDeckContext({}, { baseDir: os.tmpdir() });
  });
  const { docs, cleanup } = tmpKitProject();
  t.after(cleanup);
  const source = `---\ntitle: Kit demo\nkit: "../my-kit"\n---\n\n# Slide\n\nSome text.\n`;
  const out = await compileHtml(source, { baseDir: docs });
  assert.deepEqual(out.stats.warnings, []);
  assert.match(out.html, /#0B5394/, 'the kit primary is in the CSS');
  assert.doesNotMatch(out.html, /#1D4ED8/, 'the default primary is entirely replaced');
});

test('defaultTheme (host default): applied as a last resort, beaten by the frontmatter, neutralized by kit: none', (t) => {
  t.after(() => applyTheme(null));
  const { kit, docs, cleanup } = tmpKitProject();
  t.after(cleanup);

  const viaHost = resolveTheme({}, { baseDir: docs, defaultTheme: kit });
  assert.deepEqual(viaHost.diagnostics, []);
  assert.equal(
    viaHost.theme?.colors?.primary,
    '0B5394',
    'the host default applies when nothing else designates a kit',
  );

  const { file: other, cleanup: cleanup2 } = tmpTheme({ colors: { primary: '111827' } });
  t.after(cleanup2);
  const viaFrontmatter = resolveTheme({ kit: other }, { baseDir: docs, defaultTheme: kit });
  assert.equal(
    viaFrontmatter.theme?.colors?.primary,
    '111827',
    'the deck frontmatter wins over the host default',
  );

  const optOut = resolveTheme({ kit: 'none' }, { baseDir: docs, defaultTheme: kit });
  assert.equal(optOut.theme, null, 'kit: none neutralizes the host default too');
  assert.deepEqual(optOut.diagnostics, []);
});

// ---------------------------------------------------------------------------
// The theme font contract: fonts.files requires fonts.body
// ---------------------------------------------------------------------------

test('resolveTheme: fonts.files WITHOUT fonts.body is refused (glyphs disguised as the default font otherwise)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-files-nobody-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Body.ttf'), 'ttf');
  fs.writeFileSync(path.join(dir, 'Body.woff2'), 'woff2');
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({ fonts: { files: { regular: './Body.ttf' } } }),
  );
  const { theme, diagnostics } = resolveTheme({ kit: './theme.json' }, { baseDir: dir });
  assert.equal(theme.fonts?.files, undefined, 'fonts.files without fonts.body is dropped');
  assert.ok(
    diagnostics.some((d) => d.code === 'THEME_BAD_VALUE' && /fonts\.body/.test(d.message)),
    'a diagnostic explains that fonts.body is required',
  );
});

test('resolveTheme: fonts.files WITH fonts.body is accepted (the legitimate case stays possible)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-files-body-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Body.ttf'), 'ttf');
  fs.writeFileSync(path.join(dir, 'Body.woff2'), 'woff2');
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({ fonts: { body: 'My Font', files: { regular: './Body.ttf' } } }),
  );
  const { theme, diagnostics } = resolveTheme({ kit: './theme.json' }, { baseDir: dir });
  assert.deepEqual(diagnostics, []);
  assert.equal(theme.fonts.body, 'My Font');
  assert.equal(theme.fonts.files.regular, path.join(dir, 'Body.ttf'));
});

// ---------------------------------------------------------------------------
// isKitName: name of an installed kit (independent of the cwd) vs path
// ---------------------------------------------------------------------------

test('isKitName: tells the name of an installed kit from a path', () => {
  // names → passed as is to resolveTheme, resolved from <config>/kits/
  for (const ref of ['my-kit', 'brand-acme', 'a', '9-lives'])
    assert.equal(isKitName(ref), true, `${ref} is a kit name`);
  // paths → resolved against the cwd on the CLI side
  for (const ref of [
    'theme.json',
    './theme.json',
    '../t.json',
    '/abs/theme.json',
    '~/t.json',
    'sub/theme.json',
    '@org/theme',
  ])
    assert.equal(isKitName(ref), false, `${ref} is a path`);
  // rejected by KIT_NAME_RE: never confused with an installed name
  for (const ref of ['MyKit', 'my kit', '-kit', ''])
    assert.equal(isKitName(ref), false, `${ref} is not an admissible name`);
});

// ---------------------------------------------------------------------------
// User configuration: shared default kit + installed kits
// (~/.config/lutrin, overridden by LUTRIN_CONFIG — test/setup.mjs isolates the
// suite from the developer's real config)
// ---------------------------------------------------------------------------

/** Temporary user config root; overrides LUTRIN_CONFIG and restores it at
 *  cleanup. */
function tmpUserConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-userconf-'));
  const prev = process.env.LUTRIN_CONFIG;
  process.env.LUTRIN_CONFIG = root;
  return {
    root,
    kitsDir: path.join(root, 'kits'),
    cleanup: () => {
      if (prev === undefined) delete process.env.LUTRIN_CONFIG;
      else process.env.LUTRIN_CONFIG = prev;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Installs a kit into <config>/kits/<name>/; returns its directory. */
function installKit(uc, name, { theme = null, layouts = null, manifest = null } = {}) {
  const dir = path.join(uc.kitsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify(manifest ?? { name }));
  if (theme) fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(theme));
  if (layouts) {
    fs.mkdirSync(path.join(dir, 'layouts'), { recursive: true });
    for (const [f, def] of Object.entries(layouts))
      fs.writeFileSync(path.join(dir, 'layouts', f), JSON.stringify(def));
  }
  return dir;
}

/** Throwaway deck directory, outside of any user config. */
function tmpDeckDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('user default: config.json { kit } applies without a deck kit, above the host default, neutralized by "none"', (t) => {
  t.after(() => applyTheme(null));
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  installKit(uc, 'custom', { theme: { colors: { primary: '0B5394' } } });
  const host = installKit(uc, 'host', { theme: { colors: { primary: '097D6C' } } });
  fs.writeFileSync(path.join(uc.root, 'config.json'), JSON.stringify({ kit: 'custom' }));
  const deckDir = tmpDeckDir(t);

  const viaUser = resolveTheme({}, { baseDir: deckDir });
  assert.deepEqual(viaUser.diagnostics, []);
  assert.equal(
    viaUser.theme?.colors?.primary,
    '0B5394',
    'the user default applies when nothing else designates a kit',
  );

  const overHost = resolveTheme({}, { baseDir: deckDir, defaultTheme: host });
  assert.equal(
    overHost.theme?.colors?.primary,
    '0B5394',
    'the user default beats the host default',
  );

  const optOut = resolveTheme({ kit: 'none' }, { baseDir: deckDir });
  assert.equal(optOut.theme, null, 'kit: none neutralizes the user default too');
  assert.deepEqual(optOut.diagnostics, []);
});

test('user default: the old "theme" key of config.json is still read as a fallback', (t) => {
  t.after(() => applyTheme(null));
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  installKit(uc, 'custom', { theme: { colors: { primary: 'AA5500' } } });
  fs.writeFileSync(path.join(uc.root, 'config.json'), JSON.stringify({ theme: 'custom' }));

  assert.equal(readUserKit().ref, 'custom', 'a config written before kits is still understood');
  assert.equal(resolveTheme({}, { baseDir: tmpDeckDir(t) }).theme?.colors?.primary, 'AA5500');
});

test('precedence: the project default beats the user default; the frontmatter beats them both', (t) => {
  t.after(() => applyTheme(null));
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  installKit(uc, 'custom', { theme: { colors: { primary: 'AA5500' } } });
  fs.writeFileSync(path.join(uc.root, 'config.json'), JSON.stringify({ kit: 'custom' }));

  // the project declares ./my-kit (primary 0B5394); the deck lives in docs/
  const { docs, cleanup } = tmpKitProject({
    projectJson: { name: 'p', lutrin: { kit: './my-kit' } },
  });
  t.after(cleanup);

  const viaProject = resolveTheme({}, { baseDir: docs });
  assert.deepEqual(viaProject.diagnostics, []);
  assert.equal(
    viaProject.theme?.colors?.primary,
    '0B5394',
    'the project default wins over the user default',
  );
  assert.equal(viaProject.kitName, 'my-kit');

  const { file: fm, cleanup: c2 } = tmpTheme({ colors: { primary: '111827' } });
  t.after(c2);
  const viaFm = resolveTheme({ kit: fm }, { baseDir: docs });
  assert.equal(
    viaFm.theme?.colors?.primary,
    '111827',
    'the frontmatter wins over project AND user',
  );
});

test('installed kit: resolved by NAME from any project, layouts/ included', (t) => {
  t.after(() => applyTheme(null));
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  const kit = installKit(uc, 'slate-custom', {
    theme: { colors: { primary: 'AA5500' } },
    layouts: { 'custom.json': { name: 'custom', base: 'two-columns' } },
  });
  const deckDir = tmpDeckDir(t);

  const r = resolveTheme({ kit: 'slate-custom' }, { baseDir: deckDir });
  assert.deepEqual(r.diagnostics, []);
  assert.equal(
    r.theme?.colors?.primary,
    'AA5500',
    'installed kit resolved by name from an arbitrary project',
  );
  assert.equal(r.path, path.join(kit, 'theme.json'), 'theme.json by convention');
  assert.equal(r.kitName, 'slate-custom');
  assert.equal(
    r.layoutsDir,
    path.join(kit, 'layouts'),
    'the layouts/ of the installed kit is detected',
  );
});

test('installed kit: a neighbouring FILE of the same name keeps priority (no silent hijacking)', (t) => {
  t.after(() => applyTheme(null));
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  installKit(uc, 'custom', { theme: { colors: { primary: 'AA5500' } } });
  const deckDir = tmpDeckDir(t);
  // a file "custom" exists next to the deck: it wins over the installed kit
  fs.writeFileSync(path.join(deckDir, 'custom'), JSON.stringify({ colors: { primary: '112233' } }));

  const r = resolveTheme({ kit: 'custom' }, { baseDir: deckDir });
  assert.equal(
    r.theme?.colors?.primary,
    '112233',
    'the neighbouring file wins over the installed kit of the same name',
  );
  assert.equal(r.kitName, null);
});

test('user config that could not be read: USER_CONFIG_INVALID as a warning, the deck falls back cleanly (validate never fails)', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  fs.writeFileSync(path.join(uc.root, 'config.json'), '{ not json');
  const deckDir = tmpDeckDir(t);

  const r = resolveTheme({}, { baseDir: deckDir });
  assert.equal(r.theme, null, 'no theme applied');
  const d = r.diagnostics.find((x) => x.code === 'USER_CONFIG_INVALID');
  assert.ok(d, 'USER_CONFIG_INVALID emitted');
  assert.equal(
    d.severity,
    'warning',
    'warning: a broken global config does not make `validate` fail',
  );

  // a deck that designates ITS kit ignores the user config (never consulted)
  const { file, cleanup } = tmpTheme({ colors: { primary: '123ABC' } });
  t.after(cleanup);
  const withOwn = resolveTheme({ kit: file }, { baseDir: deckDir });
  assert.equal(withOwn.theme?.colors?.primary, '123ABC');
  assert.equal(
    withOwn.diagnostics.find((x) => x.code === 'USER_CONFIG_INVALID'),
    undefined,
    'config not consulted when the deck has its kit',
  );
});

test('user default not found: KIT_NOT_FOUND as a WARNING (a broken global default does not make a project validate fail)', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  fs.writeFileSync(path.join(uc.root, 'config.json'), JSON.stringify({ kit: 'absent-xyz' }));
  const deckDir = tmpDeckDir(t);

  const r = resolveTheme({}, { baseDir: deckDir });
  assert.equal(r.theme, null);
  const d = r.diagnostics.find((x) => x.code === 'KIT_NOT_FOUND');
  assert.ok(d, 'KIT_NOT_FOUND emitted');
  assert.equal(
    d.severity,
    'warning',
    'USER default: downgraded to a warning (in contrast with frontmatter/project, which stay errors)',
  );
  assert.match(d.message, /kits/, 'the message mentions the user kits directory');

  // same reference not found, but chosen by the DECK: stays an error
  const viaFrontmatter = resolveTheme({ kit: 'absent-xyz' }, { baseDir: deckDir });
  assert.equal(
    viaFrontmatter.diagnostics.find((x) => x.code === 'KIT_NOT_FOUND')?.severity,
    'error',
    'a kit asked for by the deck stays an error',
  );
});

test('non-object user config (bare "custom", array): USER_CONFIG_INVALID as a warning', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  const deckDir = tmpDeckDir(t);
  for (const bad of ['"custom"', '[1,2,3]', '42']) {
    fs.writeFileSync(path.join(uc.root, 'config.json'), bad);
    const r = resolveTheme({}, { baseDir: deckDir });
    const d = r.diagnostics.find((x) => x.code === 'USER_CONFIG_INVALID');
    assert.ok(d && d.severity === 'warning', `config.json = ${bad} → USER_CONFIG_INVALID warning`);
  }
});

test('config API: setUserKit writes and preserves the keys, readUserKit reads back, listInstalledKits enumerates', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  assert.equal(userConfigRoot(), uc.root, 'LUTRIN_CONFIG drives the config root');
  assert.equal(userKitsDir(), uc.kitsDir);
  installKit(uc, 'light', { theme: {}, manifest: { name: 'light', version: '2.1.0' } });
  installKit(uc, 'dark', { theme: {} });

  assert.equal(readUserKit().ref, null, 'no default kit to start with');
  const file = setUserKit('light');
  assert.equal(file, path.join(uc.root, 'config.json'));
  assert.equal(readUserKit().ref, 'light', 'the kit that was written is read back');

  fs.writeFileSync(file, JSON.stringify({ kit: 'light', other: 42 }));
  setUserKit('dark');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).other, 42, 'the other keys are preserved');
  assert.equal(readUserKit().ref, 'dark');

  setUserKit(null);
  assert.equal(readUserKit().ref, null, 'unsetting removes the kit key');
  assert.equal(
    JSON.parse(fs.readFileSync(file, 'utf8')).other,
    42,
    'the "other" key survives the unset',
  );

  const listed = listInstalledKits();
  assert.deepEqual(
    listed.map((k) => k.name),
    ['dark', 'light'],
    'sorted enumeration',
  );
  assert.equal(listed[1].manifest.version, '2.1.0', 'the manifest is exposed');
  assert.equal(listed[1].error, null);
});

test('setUserKit removes the old "theme" key (never two truths in the config)', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  const file = path.join(uc.root, 'config.json');
  fs.mkdirSync(uc.root, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ theme: 'old', other: 1 }));

  setUserKit('new');
  const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(conf.kit, 'new');
  assert.equal(conf.theme, undefined, 'the deprecated key is removed, not left beside it');
  assert.equal(conf.other, 1);
  assert.equal(readUserKit().ref, 'new');
});

test('listInstalledKits: a BROKEN kit is listed with its error, a directory without a manifest is ignored', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  installKit(uc, 'good', { theme: {} });
  // manifest present but invalid → listed, with the error
  fs.mkdirSync(path.join(uc.kitsDir, 'broken'), { recursive: true });
  fs.writeFileSync(path.join(uc.kitsDir, 'broken', 'kit.json'), '{ not json');
  // no manifest at all → leftover, ignored
  fs.mkdirSync(path.join(uc.kitsDir, 'leftover'), { recursive: true });

  const listed = listInstalledKits();
  assert.deepEqual(
    listed.map((k) => k.name),
    ['broken', 'good'],
    'the leftover without kit.json is ignored',
  );
  assert.equal(listed[0].manifest, null);
  assert.ok(listed[0].error, 'a broken kit is SHOWN with its error, never hidden');
});

test('migration: <config>/themes/ becomes <config>/kits/, once only and without overwriting', (t) => {
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  const themes = path.join(uc.root, 'themes');
  fs.mkdirSync(path.join(themes, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(themes, 'custom', 'kit.json'), JSON.stringify({ name: 'custom' }));
  fs.writeFileSync(
    path.join(themes, 'custom', 'theme.json'),
    JSON.stringify({ colors: { primary: 'AA5500' } }),
  );

  const first = migrateUserConfig();
  assert.equal(first.migrated, true);
  assert.ok(!fs.existsSync(themes), 'the old directory is moved, not copied');
  assert.equal(
    resolveTheme({ kit: 'custom' }, { baseDir: tmpDeckDir(t) }).theme?.colors?.primary,
    'AA5500',
  );
  t.after(() => applyTheme(null));

  // second run: nothing to do
  assert.equal(migrateUserConfig().migrated, false, 'the migration does not replay');

  // themes/ recreated NEXT TO kits/: leftover, never overwritten onto kits/
  fs.mkdirSync(path.join(themes, 'zombie'), { recursive: true });
  assert.equal(
    migrateUserConfig().migrated,
    false,
    'kits/ exists: themes/ is a leftover, the migration does not overwrite it',
  );
  assert.ok(fs.existsSync(path.join(uc.kitsDir, 'custom')), 'the migrated kits are intact');
});

test('e2e: the user default travels through compileHtml to the document, without leaking into the next deck', async (t) => {
  t.after(() => applyTheme(null));
  const uc = tmpUserConfig();
  t.after(uc.cleanup);
  installKit(uc, 'custom', { theme: { colors: { primary: '123ABC' } } });
  fs.writeFileSync(path.join(uc.root, 'config.json'), JSON.stringify({ kit: 'custom' }));
  const deckDir = tmpDeckDir(t);

  const themed = await compileHtml('---\ntitle: Demo\n---\n\n# Slide\n\nSome text.\n', {
    baseDir: deckDir,
  });
  assert.deepEqual(themed.stats.warnings, []);
  assert.match(themed.html, /#123ABC/, 'the primary of the user default reaches the CSS');

  // config removed: the generic one is back (no leak from a warm host)
  uc.cleanup();
  const plain = await compileHtml('---\ntitle: Demo\n---\n\n# Slide\n\nSome text.\n', {
    baseDir: deckDir,
  });
  assert.doesNotMatch(plain.html, /#123ABC/, 'no more user theme once the config is removed');
  assert.match(plain.html, /#1D4ED8/, 'generic primary back');
});

// ---------------------------------------------------------------------------
// Fonts of a kit: .pptx embedding and HTML inlining, WITHOUT the brand
// ---------------------------------------------------------------------------

/**
 * This coverage is deliberately independent of any brand kit.
 *
 * Font embedding was only ever verified end to end by the brand suite, in its
 * own repository: once that left this repo (the brand extracted into a
 * distributable kit), nothing would any longer have guaranteed that a
 * third-party kit's fonts reach the .pptx and the HTML. pptx-e2e.test.mjs
 * only tests embedding under `if (stats.fontsEmbedded)` — so silently, when no
 * font is supplied.
 *
 * The files are stub bytes: neither embedFonts (which copies the .ttf as is
 * into ppt/fonts/fontN.fntdata) nor the HTML inlining (base64) parses the
 * font. What is verified here is the ROUTE — that the bytes OF THE KIT arrive
 * in the output — not the validity of a font.
 */
function tmpKitWithFonts(t, { name = 'kit-fonts', family = 'Font Kit' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-fonts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const kit = path.join(dir, name);
  fs.mkdirSync(path.join(kit, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name }));

  // recognizable bytes: it is their presence in the output that proves it is
  // indeed the files OF THE KIT that travelled
  const markers = {};
  for (const [variant, base] of [
    ['regular', 'Body'],
    ['bold', 'Bold'],
    ['italic', 'Italic'],
  ]) {
    markers[variant] = `TTF-FROM-KIT-${base.toUpperCase()}`;
    fs.writeFileSync(path.join(kit, 'fonts', `${base}.ttf`), markers[variant]);
    fs.writeFileSync(
      path.join(kit, 'fonts', `${base}.woff2`),
      `WOFF2-FROM-KIT-${base.toUpperCase()}`,
    );
  }
  fs.writeFileSync(
    path.join(kit, 'theme.json'),
    JSON.stringify({
      fonts: {
        body: family,
        files: {
          regular: './fonts/Body.ttf',
          bold: './fonts/Bold.ttf',
          italic: './fonts/Italic.ttf',
        },
      },
    }),
  );
  return { kit, family, markers };
}

test('third-party kit: its three font variants are embedded in the .pptx (without the brand)', async (t) => {
  t.after(() => applyTheme(null));
  const { kit, family } = tmpKitWithFonts(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pptx-fonts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const source = `---\ntitle: Font demo\nkit: "${kit}"\n---\n\n# Slide\n\nSome text.\n`;
  const deck = parseDeck(source);
  const prep = prepareDeckContext(deck.meta, { baseDir: dir });
  assert.deepEqual(prep.diagnostics, [], 'the kit resolves without a diagnostic');
  const scenes = buildScenes(deck);
  const out = path.join(dir, 'demo.pptx');
  const stats = await renderDeck(scenes, deck.meta, dir, out);

  assert.equal(stats.fontsEmbedded, 3, 'the three variants of the kit are embedded');
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  // `!dir`: JSZip also enumerates the directory entry "ppt/fonts/"
  const parts = Object.keys(zip.files).filter(
    (f) => f.startsWith('ppt/fonts/') && !zip.files[f].dir,
  );
  assert.equal(parts.length, 3, 'one fntdata part per variant');

  // these really are the bytes OF THE KIT, not those of a default font
  const embedded = await Promise.all(parts.sort().map((f) => zip.file(f).async('string')));
  assert.deepEqual(embedded.sort(), [
    'TTF-FROM-KIT-BODY',
    'TTF-FROM-KIT-BOLD',
    'TTF-FROM-KIT-ITALIC',
  ]);

  const pres = await zip.file('ppt/presentation.xml').async('string');
  assert.match(pres, /<p:embeddedFontLst>/);
  assert.ok(pres.includes(family), 'the family declared by the kit names the embedded fonts');
});

test('third-party kit: its woff2 are inlined in the HTML, and disappear with it', async (t) => {
  t.after(() => {
    applyTheme(null);
    prepareDeckContext({}, { baseDir: os.tmpdir() });
  });
  const { kit, family } = tmpKitWithFonts(t);
  const deckDir = tmpDeckDir(t);
  const source = `---\ntitle: Font demo\nkit: "${kit}"\n---\n\n# Slide\n\nSome text.\n`;

  const out = await compileHtml(source, { baseDir: deckDir });
  assert.deepEqual(out.stats.warnings, []);
  assert.ok(out.html.includes(`font-family:"${family}"`), 'the kit family is declared in the CSS');
  // the woff2 OF THE KIT, base64-encoded in the document
  for (const base of ['BODY', 'BOLD', 'ITALIC']) {
    const b64 = Buffer.from(`WOFF2-FROM-KIT-${base}`).toString('base64');
    assert.ok(out.html.includes(b64), `the "${base}" woff2 of the kit is inlined`);
  }

  // next deck without a kit: no trace (warm host — no font leak)
  const plain = await compileHtml('---\ntitle: Other\n---\n\n# Slide\n\nSome text.\n', {
    baseDir: deckDir,
  });
  assert.ok(!plain.html.includes(family), 'the kit family does not leak into the next deck');
  assert.ok(
    !plain.html.includes(Buffer.from('WOFF2-FROM-KIT-BODY').toString('base64')),
    'nor do its fonts',
  );
});

// ---------------------------------------------------------------------------
// Compatibility of the mtl-deck → lutrin rename (phase 5 plan)
// ---------------------------------------------------------------------------

/**
 * These four tests cover code that exists only so that nothing breaks for
 * whoever was already using the tool. Without them, a fallback could disappear
 * in the course of a cleanup without any test flinching — and the breakage
 * would be invisible here, visible only to the user who updates.
 */

test('rename: MTL_DECK_CONFIG stays honoured as a fallback for LUTRIN_CONFIG', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-env-fallback-'));
  const prevL = process.env.LUTRIN_CONFIG;
  const prevM = process.env.MTL_DECK_CONFIG;
  t.after(() => {
    if (prevL === undefined) delete process.env.LUTRIN_CONFIG;
    else process.env.LUTRIN_CONFIG = prevL;
    if (prevM === undefined) delete process.env.MTL_DECK_CONFIG;
    else process.env.MTL_DECK_CONFIG = prevM;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  delete process.env.LUTRIN_CONFIG;
  process.env.MTL_DECK_CONFIG = dir;
  assert.equal(userConfigRoot(), dir, 'the old variable still drives the root');

  // and the new one WINS when both are set
  process.env.LUTRIN_CONFIG = path.join(dir, 'fresh');
  assert.equal(
    userConfigRoot(),
    path.join(dir, 'fresh'),
    'LUTRIN_CONFIG wins over MTL_DECK_CONFIG',
  );
});

test('rename: the "mtl-deck" field of package.json is still read as a fallback for "lutrin"', (t) => {
  t.after(() => applyTheme(null));
  const { docs, cleanup } = tmpKitProject({
    projectJson: { name: 'p', 'mtl-deck': { kit: './my-kit' } },
  });
  t.after(cleanup);
  const r = resolveTheme({}, { baseDir: docs });
  assert.deepEqual(r.diagnostics, [], 'a project written before the rename does not break');
  assert.equal(r.theme?.colors?.primary, '0B5394');
});

test('rename: "lutrin" wins over "mtl-deck" when the package.json carries both', (t) => {
  t.after(() => applyTheme(null));
  const { proj, docs, cleanup } = tmpKitProject();
  t.after(cleanup);
  // a second kit, designated by the NEW field
  const other = path.join(proj, 'new-kit');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'kit.json'), JSON.stringify({ name: 'new-kit' }));
  fs.writeFileSync(
    path.join(other, 'theme.json'),
    JSON.stringify({ colors: { primary: '111827' } }),
  );
  fs.writeFileSync(
    path.join(proj, 'package.json'),
    JSON.stringify({
      name: 'p',
      lutrin: { kit: './new-kit' },
      'mtl-deck': { kit: './my-kit' },
    }),
  );

  const r = resolveTheme({}, { baseDir: docs });
  assert.equal(
    r.theme?.colors?.primary,
    '111827',
    'the current field wins over the historical one',
  );
  assert.equal(r.kitName, 'new-kit');
});

test('rename: ~/.config/mtl-deck is migrated to ~/.config/lutrin, once only', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-home-'));
  const prevHome = process.env.HOME;
  const prevL = process.env.LUTRIN_CONFIG;
  const prevM = process.env.MTL_DECK_CONFIG;
  t.after(() => {
    process.env.HOME = prevHome;
    if (prevL === undefined) delete process.env.LUTRIN_CONFIG;
    else process.env.LUTRIN_CONFIG = prevL;
    if (prevM === undefined) delete process.env.MTL_DECK_CONFIG;
    else process.env.MTL_DECK_CONFIG = prevM;
    fs.rmSync(home, { recursive: true, force: true });
  });
  // the root migration applies ONLY if nothing drives the root
  delete process.env.LUTRIN_CONFIG;
  delete process.env.MTL_DECK_CONFIG;
  process.env.HOME = home;

  const legacy = path.join(home, '.config', 'mtl-deck');
  fs.mkdirSync(path.join(legacy, 'themes', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ theme: 'custom' }));
  fs.writeFileSync(
    path.join(legacy, 'themes', 'custom', 'kit.json'),
    JSON.stringify({ name: 'custom' }),
  );
  fs.writeFileSync(
    path.join(legacy, 'themes', 'custom', 'theme.json'),
    JSON.stringify({ colors: { primary: 'AA5500' } }),
  );

  const r = migrateUserConfig();
  assert.equal(r.migrated, true);
  assert.equal(r.moves.length, 2, 'root moved AND themes/ renamed to kits/, in the same run');
  assert.ok(!fs.existsSync(legacy), 'the old root is moved, not copied');
  const fresh = path.join(home, '.config', 'lutrin');
  assert.ok(fs.existsSync(path.join(fresh, 'kits', 'custom', 'kit.json')));

  // the kit and the user default survive the double rename
  t.after(() => applyTheme(null));
  assert.equal(readUserKit().ref, 'custom');
  assert.equal(resolveTheme({}, { baseDir: home }).theme?.colors?.primary, 'AA5500');

  assert.equal(migrateUserConfig().migrated, false, 'the migration does not replay');
});

// ---------------------------------------------------------------------------
// Confinement of the asset paths (logos, fonts)
// ---------------------------------------------------------------------------

/**
 * `logos` and `fonts.files` designate files that will be READ and then
 * EMBEDDED in the produced .pptx or .html. A theme that chooses them therefore
 * chooses what leaves the machine: without containment,
 * `"cover": "../../../.ssh/id_rsa"` in the theme.json of a kit installed from
 * an archive is enough to send a private key travelling inside a deliverable
 * that is then passed on without a second thought.
 *
 * The allowed root depends on PROVENANCE, because the trust is not the same —
 * that is the whole point of these tests, and the trap a first version fell
 * into:
 *
 *   - a KIT is THIRD-PARTY content → locked inside its directory, strictly;
 *   - a FILE theme is written by the deck's author, who is already master of
 *     their project → the root is the deck's directory (or the theme's).
 *     Confining it to the directory of its theme.json would break the
 *     perfectly legitimate layout "kit: ./design/theme.json" pointing at
 *     "../fonts/Body.ttf", for no security gain at all.
 *
 * The two branches have their own message: saying "leaves the kit" to an
 * author who has no kit would send them looking for a problem that does not
 * exist.
 */

/** A "sensitive" file outside any project, the target of the escapes tested. */
function tmpSecretDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-secret-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'id_rsa.png'), 'PRIVATE-KEY');
  fs.writeFileSync(path.join(dir, 'stolen.ttf'), 'TTF-STOLEN');
  fs.writeFileSync(path.join(dir, 'stolen.woff2'), 'WOFF2-STOLEN');
  return dir;
}

/** Kit whose theme.json is supplied as is; rendered outside any project. */
function tmpKitWithTheme(t, theme, { name = 'third-party-kit' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-third-party-kit-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const kit = path.join(base, name);
  fs.mkdirSync(kit, { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name }));
  fs.writeFileSync(path.join(kit, 'theme.json'), JSON.stringify(theme));
  return kit;
}

test('hostile kit: a logo outside the kit is refused, and none of its content reaches the theme', (t) => {
  t.after(() => applyTheme(null));
  const secret = tmpSecretDir(t);
  const kit = tmpKitWithTheme(t, { logos: { cover: path.join(secret, 'id_rsa.png') } });
  const deck = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(deck, { recursive: true, force: true }));

  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: deck });

  const escapeDiag = diagnostics.find((d) => d.code === 'THEME_PATH_ESCAPE');
  assert.ok(escapeDiag, `an escape must be reported — seen: ${JSON.stringify(diagnostics)}`);
  assert.match(
    escapeDiag.message,
    /leaves the .+ kit/,
    'the message names the kit — it is the culprit',
  );
  assert.match(escapeDiag.message, /third-party-kit/);
  assert.equal(escapeDiag.severity, 'warning', 'the deck compiles all the same, without the logo');
  assert.equal(theme.logos, undefined, 'no path outside the kit survives in the theme');
});

test('hostile kit: a font outside the kit is refused (the .ttf otherwise leaves whole inside the .pptx)', (t) => {
  t.after(() => applyTheme(null));
  const secret = tmpSecretDir(t);
  const kit = tmpKitWithTheme(t, {
    fonts: { body: 'Stolen Font', files: { regular: path.join(secret, 'stolen.ttf') } },
  });
  const deck = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(deck, { recursive: true, force: true }));

  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: deck });

  assert.match(
    diagnostics.find((d) => d.code === 'THEME_PATH_ESCAPE')?.message ?? '',
    /fonts\.files\.regular.*leaves the .+ kit/s,
  );
  assert.equal(theme.fonts?.files, undefined);
});

test('hostile kit: a SYMBOLIC LINK that leaves the kit is refused (the declared path is nonetheless beyond reproach)', (t) => {
  t.after(() => applyTheme(null));
  const secret = tmpSecretDir(t);
  const kit = tmpKitWithTheme(t, { logos: { cover: './logo.png' } });
  // the theme.json says "./logo.png": nothing to object to lexically. It is
  // the link that leaves — hence the check AFTER link resolution
  fs.symlinkSync(path.join(secret, 'id_rsa.png'), path.join(kit, 'logo.png'));
  const deck = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(deck, { recursive: true, force: true }));

  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: deck });

  assert.ok(
    diagnostics.some((d) => d.code === 'THEME_PATH_ESCAPE'),
    'a link to the outside is an escape, whatever the declared path',
  );
  assert.equal(theme.logos, undefined);
});

test('legitimate kit: its own files pass, including through an INTERNAL link', (t) => {
  t.after(() => applyTheme(null));
  const kit = tmpKitWithTheme(t, {
    logos: { cover: './images/logo.png', section: './link-logo.png' },
  });
  fs.mkdirSync(path.join(kit, 'images'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'images', 'logo.png'), PNG_1PX);
  // a link that STAYS inside the kit is perfectly admissible
  fs.symlinkSync(path.join(kit, 'images', 'logo.png'), path.join(kit, 'link-logo.png'));
  const deck = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(deck, { recursive: true, force: true }));

  const { theme, diagnostics } = resolveTheme({ kit }, { baseDir: deck });

  assert.deepEqual(diagnostics, [], 'no diagnostic: the kit only designates its own files');
  assert.equal(theme.logos.cover, path.join(kit, 'images', 'logo.png'));
  assert.equal(theme.logos.section, path.join(kit, 'link-logo.png'));
});

test('FILE theme: "../fonts" next to the deck stays valid (the trap of confining to the theme directory)', (t) => {
  t.after(() => applyTheme(null));
  // the layout that confining to the theme.json directory would break:
  //   <project>/deck.md     kit: ./design/theme.json
  //   <project>/design/theme.json   →  ../fonts/Body.ttf
  //   <project>/fonts/Body.ttf
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-proj-file-'));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));
  fs.mkdirSync(path.join(proj, 'design'));
  fs.mkdirSync(path.join(proj, 'fonts'));
  fs.mkdirSync(path.join(proj, 'images'));
  fs.writeFileSync(path.join(proj, 'fonts', 'Body.ttf'), 'TTF');
  fs.writeFileSync(path.join(proj, 'fonts', 'Body.woff2'), 'WOFF2');
  fs.writeFileSync(path.join(proj, 'images', 'logo.png'), PNG_1PX);
  fs.writeFileSync(
    path.join(proj, 'design', 'theme.json'),
    JSON.stringify({
      fonts: { body: 'House Body', files: { regular: '../fonts/Body.ttf' } },
      logos: { cover: '../images/logo.png' },
    }),
  );

  const { theme, diagnostics } = resolveTheme({ kit: './design/theme.json' }, { baseDir: proj });

  assert.deepEqual(
    diagnostics,
    [],
    'the author keeps their fonts next to their theme inside THEIR project: nothing to report',
  );
  assert.equal(theme.fonts.files.regular, path.join(proj, 'fonts', 'Body.ttf'));
  assert.equal(theme.logos.cover, path.join(proj, 'images', 'logo.png'));
});

test('FILE theme: a path outside the project is refused, with a message that does NOT talk about a kit', (t) => {
  t.after(() => applyTheme(null));
  const secret = tmpSecretDir(t);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-proj-file-'));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(proj, 'theme.json'),
    JSON.stringify({
      logos: { cover: path.join(secret, 'id_rsa.png') },
    }),
  );

  const { theme, diagnostics } = resolveTheme({ kit: './theme.json' }, { baseDir: proj });

  const escapeDiag = diagnostics.find((d) => d.code === 'THEME_PATH_ESCAPE');
  assert.ok(escapeDiag, `an escape must be reported — seen: ${JSON.stringify(diagnostics)}`);
  // the trap: "leaves the kit" when no kit is in play sends the author
  // looking for a problem that does not exist
  assert.doesNotMatch(escapeDiag.message, /kit/i, 'no kit here — the message must not invent one');
  assert.match(escapeDiag.message, /leaves the project/);
  assert.equal(theme.logos, undefined);
});

test('FILE theme outside the project (absolute --kit): its neighbouring assets stay admitted', (t) => {
  t.after(() => applyTheme(null));
  // a brand kept elsewhere on the machine, designated by an absolute path:
  // its files sit BESIDE it, not in the project — refusing them would break a
  // perfectly normal usage
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-brand-'));
  t.after(() => fs.rmSync(brand, { recursive: true, force: true }));
  fs.writeFileSync(path.join(brand, 'logo.png'), PNG_1PX);
  fs.writeFileSync(
    path.join(brand, 'theme.json'),
    JSON.stringify({ logos: { cover: './logo.png' } }),
  );
  const deck = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(deck, { recursive: true, force: true }));

  const { theme, diagnostics } = resolveTheme(
    {},
    {
      baseDir: deck,
      themePath: path.join(brand, 'theme.json'),
    },
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(theme.logos.cover, path.join(brand, 'logo.png'));
});

test('e2e: the escaped logo of a hostile kit does NOT reach the produced HTML', async (t) => {
  // compileHtml mutates the tokens AND the registry: reset to a fresh state
  t.after(() => {
    applyTheme(null);
    prepareDeckContext({}, { baseDir: os.tmpdir() });
  });
  const secret = tmpSecretDir(t);
  fs.writeFileSync(path.join(secret, 'secret.svg'), '<svg>SECRET-BYTES</svg>');
  const kit = tmpKitWithTheme(t, {
    colors: { primary: '884400' },
    logos: { coverSvg: path.join(secret, 'secret.svg') },
  });
  const deck = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-'));
  t.after(() => fs.rmSync(deck, { recursive: true, force: true }));

  const md = `---\nkit: ${kit}\ntitle: Test\n---\n\n# Cover\n\n## Content\n\n- a point\n`;
  const { html } = await compileHtml(md, { baseDir: deck });

  assert.doesNotMatch(
    html,
    /SECRET-BYTES/,
    'the file outside the kit must not be inlined in the document',
  );
  // the rest of the kit applies all the same: the refusal is surgical
  assert.match(
    html,
    /884400/,
    'the kit color, for its part, does travel — only the escaped path is dropped',
  );
});
