/**
 * `lutrin kit import` — deriving a kit from a PowerPoint template.
 *
 * The feature makes one promise and one refusal, and this file exists to pin
 * both:
 *
 *   - the import produces DATA (colour and type tokens) and NEVER geometry;
 *   - a palette that fails WCAG contrast is REPORTED, never adjusted.
 *
 * Three angles, none of which covers the others:
 *
 *   1. THE RECIPE, on `themeFromScheme` — pure, so the expected values are
 *      spelled out as hexes rather than compared against a golden. A golden
 *      would go red on any change and say only "the theme moved"; these say
 *      WHICH token moved, which is the whole difference between a review and
 *      a bisect. Twelve scheme slots become fourteen colour tokens by
 *      derivation, and each constant was measured against the engine's own
 *      theme: a change to one of them is a design decision, and it has to be
 *      made deliberately.
 *   2. THE PACKAGE, on `readTemplateTheme`/`kitFromTemplate` — real OOXML
 *      built in memory with JSZip (the pattern kit-archive.test.mjs
 *      established: no binary fixture is committed, so what is being read is
 *      visible in the test that reads it).
 *   3. THE CONTRACT, read off the module's own source. That last one is
 *      unusual and it is explained where it sits.
 *
 * Nothing here may throw: the module's stated contract is that every failure
 * and every degradation is a `{ severity, code, message }` diagnostic, so a
 * raw exception is a bug even when the input is garbage.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { readTemplateTheme, themeFromScheme, kitFromTemplate } from '../src/kit/from-template.mjs';
import { readKit } from '../src/deck/kit.mjs';
import { applyTheme, resolveTheme, themeContrastDiagnostics } from '../src/deck/theme.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeck } from '../src/pptx/render.mjs';

const codes = (diags) => diags.map((d) => d.code);
const errors = (diags) => diags.filter((d) => d.severity === 'error');

/**
 * Microsoft's own default Office scheme, as `readTemplateTheme` returns it —
 * the palette every .potx starts from, and therefore the one worth pinning:
 * anybody can check these twelve values against PowerPoint itself.
 */
const OFFICE = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};

/** The standard mapping: text 1 is the dark slot, background 1 the light one. */
const LIGHT_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
/** The inversion a dark master writes, which the guard exists for. */
const DARK_MAP = { bg1: 'dk1', tx1: 'lt1', bg2: 'dk2', tx2: 'lt2' };

// ---------------------------------------------------------------------------
// OOXML packages, built in memory
//
// Same reasoning as kit-archive.test.mjs: the bytes a test reads are written in
// the test, so a reader can see what is being claimed about them, and no .potx
// is committed to the repository. These are the parts of a real presentation
// the importer walks — and nothing else, because nothing else is opened.
// ---------------------------------------------------------------------------

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DRAWINGML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATIONML = 'http://schemas.openxmlformats.org/presentationml/2006/main';

/** The twelve slots as PowerPoint writes them: dk1/lt1 through `<a:sysClr>`
 *  with the value it last resolved, the rest as plain sRGB. */
const OFFICE_SLOTS = {
  dk1: '<a:sysClr val="windowText" lastClr="000000"/>',
  lt1: '<a:sysClr val="window" lastClr="FFFFFF"/>',
  dk2: '<a:srgbClr val="44546A"/>',
  lt2: '<a:srgbClr val="E7E6E6"/>',
  accent1: '<a:srgbClr val="4472C4"/>',
  accent2: '<a:srgbClr val="ED7D31"/>',
  accent3: '<a:srgbClr val="A5A5A5"/>',
  accent4: '<a:srgbClr val="FFC000"/>',
  accent5: '<a:srgbClr val="5B9BD5"/>',
  accent6: '<a:srgbClr val="70AD47"/>',
  hlink: '<a:srgbClr val="0563C1"/>',
  folHlink: '<a:srgbClr val="954F72"/>',
};

/** A theme part. `slots` overrides individual colour slots; `minor` is the
 *  body family (`<a:ea typeface=""/>` is there because pptxgenjs — our own
 *  writer — emits it, and an empty typeface must read as absent). */
function themePart({
  name = 'Office Theme',
  slots = {},
  major = 'Calibri Light',
  minor = 'Calibri',
} = {}) {
  const scheme = Object.entries({ ...OFFICE_SLOTS, ...slots })
    .map(([slot, xml]) => (xml == null ? '' : `<a:${slot}>${xml}</a:${slot}>`))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${DRAWINGML}" name="${name}"><a:themeElements><a:clrScheme name="Office">${scheme}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${major}"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/><a:ea typeface=""/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
}

/**
 * A .potx/.pptx package: content types, presentation, its slide master, and
 * the theme the master points at. `layouts` only declares content-type
 * overrides — no layout PART is ever written, because the importer must never
 * be given the chance to open one; it counts them through `[Content_Types].xml`,
 * which is the spec's own way to enumerate parts by kind.
 */
async function templatePackage({
  theme = themePart(),
  themeName = 'theme1.xml',
  clrMap = LIGHT_MAP,
  layouts = 2,
  sldSz = '<p:sldSz cx="12192000" cy="6858000"/>',
  masterRels = true,
  extra = {},
} = {}) {
  const zip = new JSZip();
  const overrides = Array.from(
    { length: layouts },
    (_, k) =>
      `<Override PartName="/ppt/slideLayouts/slideLayout${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
  ).join('');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>${overrides}</Types>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="${PRESENTATIONML}" xmlns:r="${REL}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${sldSz}</p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  const map = clrMap
    ? `<p:clrMap ${Object.entries(clrMap)
        .map(([k, v]) => `${k}="${v}"`)
        .join(
          ' ',
        )} accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
    : '';
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0"?><p:sldMaster xmlns:p="${PRESENTATIONML}" xmlns:a="${DRAWINGML}">${map}</p:sldMaster>`,
  );
  if (masterRels)
    zip.file(
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="../theme/${themeName}"/></Relationships>`,
    );
  if (theme) zip.file(`ppt/theme/${themeName}`, theme);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function tmpDir(t, prefix = 'lutrin-import-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes a kit the way `kit import` writes it — kit.json from the manifest,
 *  theme.json from the derived theme. `theme.name` is forced to the kit's name
 *  because the two files must agree (scaffoldKit does the same: the provenance
 *  line the module proposes lives in the generated README instead). */
function writeKit(dir, { manifest, theme }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(dir, 'theme.json'),
    JSON.stringify({ ...theme, name: manifest.name }, null, 2),
  );
  return dir;
}

// ---------------------------------------------------------------------------
// The recipe — pure, and pinned value by value
// ---------------------------------------------------------------------------

test("themeFromScheme: Office's twelve slots derive these exact fourteen colour tokens", () => {
  // Spelled out rather than compared against a golden ON PURPOSE: a golden
  // going red says "the theme changed", and the question that actually needs
  // answering is WHICH token moved and whether the person who moved it meant
  // to. Each of these is a measured relationship — primaryLighter sits on
  // PowerPoint's own "Lighter 40 %" ladder, primaryDarker deliberately does
  // NOT (it keeps the architecture-layers ink above 4.5:1), and the neutral
  // ramp is a straight sRGB mix that reproduces the engine's own steps.
  const { theme, diagnostics } = themeFromScheme(
    { ...OFFICE, clrMap: LIGHT_MAP },
    { major: 'Calibri Light', minor: 'Calibri' },
    { name: 'acme' },
  );
  assert.deepEqual(errors(diagnostics), [], 'a complete scheme derives without an error');
  assert.deepEqual(theme.colors, {
    // the template's text/background pair, taken through the colour map
    neutralPrimary: '000000',
    brandBlack: '000000',
    ground: 'FFFFFF',
    // "text 2", and the two steps the engine derives from it
    neutralSecondary: '44546A',
    neutralTertiary: '9CA4B0',
    neutralStroke: 'C5CAD1',
    // "background 2", and the surface just above the ground
    underground2: 'E7E6E6',
    underground1: 'FAFAFA',
    // accent 1, and the whole primary ramp derived from it
    primary: '4472C4',
    brand: '4472C4',
    primaryLighter: '8BA7DA',
    primaryDarker: '2B4D8A',
    highlightStrong: 'E5EBF7',
    highlightLight: 'F4F7FC',
  });
  assert.equal(Object.keys(theme.colors).length, 14);
  // tokens.mjs states the rule: a theme that changes primary must supply its
  // own chartColors. Six accents, six slots, and the template's ORDER — a
  // reordering here would recolour every existing chart in a deck.
  assert.deepEqual(theme.chartColors, ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']);
});

test('themeFromScheme: the theme carries a name, colours, a font and a chart palette — and nothing the engine derives for itself', () => {
  // The guard against a future "helpful" import. `semantic`, `trendInk` and
  // `layerShades` are DERIVED groups: theme.mjs merges an explicit group AFTER
  // deriveTokens(), so writing one here would PIN it against the imported
  // palette — and deriveTokens()/solidInk() are precisely what keep the callout
  // inks legible on a brand's own colours. The temptation this refuses has a
  // name: importing accent 4 as the warning tint because Office's happens to be
  // yellow. A .potx carries no semantics.
  const { theme } = themeFromScheme(
    { ...OFFICE, clrMap: LIGHT_MAP },
    { minor: 'Arial' },
    {
      name: 'acme',
    },
  );
  assert.deepEqual(Object.keys(theme), ['name', 'colors', 'fonts', 'chartColors']);
  assert.equal(theme.name, 'acme');
  assert.deepEqual(theme.fonts, { body: 'Arial' });
});

test('themeFromScheme: a dark master imports its accents and NOT ONE of its surfaces', () => {
  // The subtlest decision in the feature, and the one a future contributor is
  // most likely to undo as an oversight. Every surface token ramps toward the
  // template's background — underground1/2, the neutral ramp, the highlight
  // tints — while the engine's own `ground` stays light. Import half of that
  // and panelStyle('muted') paints a dark panel and asks for "the deck's
  // ordinary ink", which is now also dark: about 1.05:1, and
  // themeContrastDiagnostics() does not measure that pair. The failure would be
  // SILENT, which is why the whole surface family is refused rather than
  // adjusted or partially kept.
  const { theme, diagnostics } = themeFromScheme(
    { ...OFFICE, clrMap: DARK_MAP },
    { minor: 'Arial' },
    { name: 'acme-dark' },
  );
  for (const token of [
    'ground',
    'neutralPrimary',
    'brandBlack',
    'underground1',
    'underground2',
    'neutralSecondary',
    'neutralTertiary',
    'neutralStroke',
  ])
    assert.ok(
      !(token in theme.colors),
      `${token} was imported from a dark scheme — the engine's light surfaces must stand alone`,
    );
  // The accent ramp DOES come across: it derives from accent 1 and owes the
  // background nothing.
  assert.deepEqual(theme.colors, {
    primary: '4472C4',
    brand: '4472C4',
    primaryLighter: '8BA7DA',
    primaryDarker: '2B4D8A',
    highlightStrong: 'E5EBF7',
    highlightLight: 'F4F7FC',
  });
  assert.deepEqual(theme.chartColors, ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']);
  assert.ok(
    codes(diagnostics).includes('KIT_IMPORT_DARK_SCHEME'),
    'a refusal this large is announced, never silent',
  );
});

test('themeFromScheme: a font family the resolver would refuse is not written at all', () => {
  // Never write what resolveTheme will drop: the families are interpolated into
  // the generated HTML's CSS, so the name is constrained — and a kit that made
  // the engine warn on every single build would be the tool blaming the user
  // for its own output. A name like this reaches the importer from an XML
  // attribute, where the quote arrives as &quot;.
  const { theme, diagnostics } = themeFromScheme(
    { ...OFFICE, clrMap: LIGHT_MAP },
    { minor: 'Brand Sans"; color: red' },
    { name: 'acme' },
  );
  assert.ok(!('fonts' in theme), "no fonts group is written — the engine's own family stands");
  assert.ok(codes(diagnostics).includes('KIT_IMPORT_FONT_NAME'));
  assert.deepEqual(
    errors(diagnostics),
    [],
    'a bad family degrades the import, it does not fail it',
  );
});

// ---------------------------------------------------------------------------
// Reading the package
// ---------------------------------------------------------------------------

test('reading: a system colour resolves through lastClr first, then the table, and is skipped when neither answers', async () => {
  // lastClr is the value PowerPoint itself last computed on a real machine, so
  // it wins even when the val names something else entirely.
  const wins = await readTemplateTheme(
    await templatePackage({
      theme: themePart({ slots: { dk1: '<a:sysClr val="window" lastClr="123456"/>' } }),
    }),
  );
  assert.equal(wins.scheme.dk1, '123456');

  // Without it, the two names that actually appear in a scheme resolve through
  // the table — this is the ordinary case, and every Office theme takes it.
  const table = await readTemplateTheme(
    await templatePackage({
      theme: themePart({
        slots: { dk1: '<a:sysClr val="windowText"/>', lt1: '<a:sysClr val="window"/>' },
      }),
    }),
  );
  assert.equal(table.scheme.dk1, '000000');
  assert.equal(table.scheme.lt1, 'FFFFFF');
  assert.deepEqual(codes(table.diagnostics), [], 'the standard names are not worth a word');

  // A name nothing can resolve leaves the slot ABSENT — the engine's own token
  // then stands, which is the honest outcome. Tried on dk2 rather than dk1
  // because dk1 is essential: losing it is a refused import, not a gap.
  const unknown = await readTemplateTheme(
    await templatePackage({ theme: themePart({ slots: { dk2: '<a:sysClr val="notAColor"/>' } }) }),
  );
  assert.ok(!('dk2' in unknown.scheme), 'an unresolvable slot is skipped, never guessed at');
  assert.deepEqual(codes(unknown.diagnostics), ['KIT_IMPORT_SYSCLR']);
});

test('reading: a colour carrying a child transform is still that colour', async () => {
  // `<a:alpha>` and its siblings describe how a colour is USED, not what it is.
  // Skipping the slot because it carries one would refuse a perfectly ordinary
  // template.
  const { scheme, diagnostics } = await readTemplateTheme(
    await templatePackage({
      theme: themePart({
        slots: { accent1: '<a:srgbClr val="4472C4"><a:alpha val="50000"/></a:srgbClr>' },
      }),
    }),
  );
  assert.equal(scheme.accent1, '4472C4');
  assert.deepEqual(codes(diagnostics), []);
});

test('reading: the body family is the minor latin face, and an empty typeface reads as absent', async () => {
  const named = await readTemplateTheme(
    await templatePackage({ theme: themePart({ minor: 'Foo &amp; Bar' }) }),
  );
  assert.equal(named.fonts.minor, 'Foo & Bar', 'an attribute is unescaped: & is legal in a family');

  // pptxgenjs — our own writer — emits `typeface=""`, so this is not a
  // hypothetical: read literally it would make the kit name a family called "".
  const empty = await readTemplateTheme(await templatePackage({ theme: themePart({ minor: '' }) }));
  assert.equal(empty.fonts.minor, null);
  const { theme, diagnostics } = themeFromScheme(empty.scheme, empty.fonts, { name: 'acme' });
  assert.ok(!('fonts' in theme));
  assert.ok(codes(diagnostics).includes('KIT_IMPORT_NO_FONT'));
});

test('reading: the theme read is the one the MASTER points at, not theme1 by position', async () => {
  // theme2/theme3 are the notes and handout masters in a package Microsoft
  // wrote, so grabbing theme1 blind is right only by convention. A package that
  // numbers them otherwise must still yield the palette PowerPoint would show.
  const { scheme, themeName } = await readTemplateTheme(
    await templatePackage({
      themeName: 'theme3.xml',
      theme: themePart({ name: 'The brand', slots: { accent1: '<a:srgbClr val="AA5500"/>' } }),
      extra: { 'ppt/theme/theme1.xml': themePart({ name: 'Notes' }) },
    }),
  );
  assert.equal(themeName, 'The brand');
  assert.equal(scheme.accent1, 'AA5500', 'theme1.xml sits right there and is NOT what was read');
});

test('reading: a package whose relationships cannot be walked falls back on ppt/theme/theme1.xml', async () => {
  const { scheme, themeName, diagnostics } = await readTemplateTheme(
    await templatePackage({
      masterRels: false,
      theme: themePart({ name: 'Fallback', slots: { accent1: '<a:srgbClr val="AA5500"/>' } }),
    }),
  );
  assert.equal(themeName, 'Fallback');
  assert.equal(scheme.accent1, 'AA5500');
  assert.deepEqual(
    errors(diagnostics),
    [],
    'the convention holds: this is a degradation, not a failure',
  );
});

test('reading: a package with no theme part imports nothing, and says so as an error', async () => {
  const { scheme, diagnostics } = await readTemplateTheme(
    await templatePackage({ theme: null, masterRels: false }),
  );
  assert.equal(scheme, null);
  assert.deepEqual(codes(errors(diagnostics)), ['KIT_IMPORT_NO_THEME']);
});

test('reading: garbage in gives a diagnostic out — nothing throws, whatever the bytes', async () => {
  // The module's contract, and the reason the CLI can call it without a
  // try/catch: every failure is a diagnostic the caller decides on.
  for (const bytes of [
    Buffer.from('this is not a package at all'),
    Buffer.alloc(0),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), // a zip header and then nothing
    null,
  ]) {
    const { scheme, diagnostics } = await readTemplateTheme(bytes);
    assert.equal(scheme, null);
    assert.deepEqual(codes(errors(diagnostics)), ['KIT_IMPORT_UNREADABLE'], String(bytes?.length));
  }
  // and the same through the whole import, which is what the CLI actually calls
  const whole = await kitFromTemplate(Buffer.from('nonsense'), { name: 'acme' });
  assert.equal(whole.theme, null);
  assert.equal(whole.manifest, null);
  assert.equal(whole.readme, null);
  assert.ok(codes(whole.diagnostics).includes('KIT_IMPORT_UNREADABLE'));
});

// ---------------------------------------------------------------------------
// The import as a whole
// ---------------------------------------------------------------------------

test('import: what was left behind is announced on EVERY import, counted', async () => {
  // The sentence the feature owes the designer who handed over a .potx
  // believing their layouts came with it. Conditional on nothing — a template
  // with no layouts still gets the note, because the silence being broken is
  // the point, not the number.
  for (const layouts of [0, 1, 7]) {
    const { diagnostics } = await kitFromTemplate(await templatePackage({ layouts }), {
      name: 'acme',
      sourceName: 'brand.potx',
    });
    const note = diagnostics.find((d) => d.code === 'KIT_IMPORT_LAYOUTS_DISCARDED');
    assert.ok(note, `no note for a template with ${layouts} layout(s)`);
    assert.match(
      note.message,
      new RegExp(`\\b${layouts} slide layout`),
      'the note counts what it left behind: a number is checkable, "some layouts" is not',
    );
  }
});

test('import: the kit that comes out is a manifest, a theme and a README that states the provenance', async () => {
  const { manifest, theme, readme, diagnostics } = await kitFromTemplate(
    await templatePackage({ theme: themePart({ name: 'Acme 2026', minor: 'Arial' }) }),
    { name: 'acme', sourceName: 'brand.potx' },
  );
  assert.deepEqual(errors(diagnostics), []);
  assert.equal(manifest.name, 'acme');
  assert.match(manifest.description, /brand\.potx/);
  assert.equal(theme.colors.primary, '4472C4');
  // The README outlives the terminal output, which scrolls away; the digest is
  // what lets the template's author say which file a kit came from.
  assert.match(readme, /SHA-256 of the template/);
  assert.match(readme, /\b[0-9a-f]{64}\b/);
  assert.match(readme, /never coordinates/);
});

test('import: a name that would not survive as a directory is refused before the package is opened', async () => {
  // Same constraint and the same words as `kit install`: the name becomes a
  // directory. Refused through parseKitManifest rather than through a copy of
  // its rule.
  const { manifest, theme, diagnostics } = await kitFromTemplate(await templatePackage(), {
    name: '../../bin',
  });
  assert.equal(manifest, null);
  assert.equal(theme, null);
  assert.ok(errors(diagnostics).length, 'a bad name stops the import');
});

// ---------------------------------------------------------------------------
// Accessibility — the decision NOT to adjust
// ---------------------------------------------------------------------------

test('accessibility: an imported palette that fails contrast is REPORTED, exactly as the brand wrote it', async (t) => {
  // This test goes red the day someone makes the importer "fix" a brand colour,
  // which is exactly what it is for. Adjusting would hand back a brand that is
  // not the brand, under the brand's name, with nothing downstream saying which
  // token was moved; refusing would make the feature useless, since Microsoft's
  // OWN default theme fails five chart pairs.
  //
  // The verdict is taken on the kit AS WRITTEN — through resolveTheme, from
  // disk — because that is what the user's next `lutrin build` will read.
  t.after(() => applyTheme(null));
  const { manifest, theme } = await kitFromTemplate(
    await templatePackage({ theme: themePart({ minor: 'Arial' }) }),
    {
      name: 'acme',
      sourceName: 'brand.potx',
    },
  );
  const dir = writeKit(path.join(tmpDir(t), 'acme'), { manifest, theme });
  const resolved = resolveTheme({}, { baseDir: dir, themePath: dir });
  assert.deepEqual(resolved.diagnostics, [], 'the kit the importer writes is a clean kit');
  applyTheme(resolved.theme);

  const diags = themeContrastDiagnostics();
  // The hexes are Office's own accents, unmoved, and the ratios are the ones
  // they really measure at: an importer that "helped" would change a hex here,
  // and one that rounded a colour into compliance would change a ratio.
  assert.deepEqual(
    diags.map((d) => d.message.replace(/ \(the brand.*$/, '')),
    [
      'Theme: chart color #ED7D31 on the background — contrast 2.77:1 < 3:1',
      'Theme: chart color #A5A5A5 on the background — contrast 2.46:1 < 3:1',
      'Theme: chart color #FFC000 on the background — contrast 1.64:1 < 3:1',
      'Theme: chart color #5B9BD5 on the background — contrast 2.96:1 < 3:1',
      'Theme: chart color #70AD47 on the background — contrast 2.71:1 < 3:1',
    ],
    'exactly five warnings, and every one of them a chart colour the brand chose',
  );
  // And ZERO anywhere else: the module leaves `semantic`, `trendInk` and
  // `layerShades` out of the theme precisely so deriveTokens()/solidInk() go on
  // choosing legible inks from the imported palette. What warns is what the
  // brand actually says — never a pair the importer created.
  assert.equal(
    diags.filter((d) => !/chart color/.test(d.message)).length,
    0,
    'not one warning on the text pairs, the layer inks or the callout tints',
  );
});

// ---------------------------------------------------------------------------
// Self-hosting
// ---------------------------------------------------------------------------

test('self-hosting: a .pptx lutrin itself produced imports back into a kit the reader accepts', async (t) => {
  // The writer and the reader are held to each other here: if either moves —
  // pptxgenjs changing how it writes the theme part, or the importer changing
  // what it walks — this breaks, and it breaks on the one package we can
  // regenerate at will rather than on a fixture nobody can rebuild.
  const dir = tmpDir(t, 'lutrin-selfhost-');
  const source = `---
title: Self-hosting
---

# Roadmap

- one
- two
`;
  const deck = parseDeck(source);
  const out = path.join(dir, 'self.pptx');
  await renderDeck(buildScenes(deck), deck.meta, dir, out);

  const { manifest, theme, diagnostics } = await kitFromTemplate(fs.readFileSync(out), {
    name: 'selfhost',
    sourceName: 'self.pptx',
  });
  assert.deepEqual(errors(diagnostics), [], 'our own output is importable');
  assert.equal(theme.colors.ground, 'FFFFFF');

  const kitDir = writeKit(path.join(dir, 'selfhost'), { manifest, theme });
  const read = readKit(kitDir);
  assert.deepEqual(read.diagnostics, [], 'the manifest the importer proposes is a valid manifest');
  const resolved = resolveTheme({}, { baseDir: dir, themePath: kitDir });
  assert.deepEqual(
    errors(resolved.diagnostics),
    [],
    'the theme the importer writes is a theme the resolver reads without complaint',
  );
  assert.ok(resolved.theme, 'and it resolves to an actual theme');
});

// ---------------------------------------------------------------------------
// The contract, read off the source
// ---------------------------------------------------------------------------

test('contract: the importer contains no code path that could reach a coordinate', () => {
  // A test that pins the ABSENCE of a code path is unusual, and it exists for a
  // reason no ordinary test covers: the failure it guards against is not a bug
  // but a well-meant feature. "Completing the importer" by honouring the
  // template's placeholder boxes would import exactly the author-positioning
  // the project refuses (CONTRIBUTING, "The project contract") — and it would
  // arrive in a pull request that looks like an improvement. The next
  // contributor should hit a red test with this comment in it, rather than
  // depend on a reviewer remembering the rule.
  //
  // Substrings, not behaviour, because behaviour cannot prove an absence: the
  // module opens the theme part, the master (for its colour map) and
  // presentation.xml (for the slide size), and reading a layout would require
  // naming one of these.
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'kit', 'from-template.mjs'),
    'utf8',
  );
  for (const forbidden of [
    'slideLayouts', // the directory the layout parts live in
    'spTree', // the shape tree — where every position on a slide is
    'a:off', // an offset
    'a:ext', // an extent
  ])
    assert.ok(
      !src.includes(forbidden),
      `from-template.mjs now mentions "${forbidden}". Importing geometry is the one thing this module must not learn to do — see its header.`,
    );
  // The counts field is `layouts` and not `slideLayouts` for this very reason:
  // the module counts what it discards through the package's content types
  // (`slideLayout+xml`), which is the spec's own way to enumerate parts by kind
  // and never names, let alone resolves, a layout part's path.
  assert.ok(src.includes('counts.layouts'));
});
