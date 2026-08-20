/**
 * PPTX end to end: compile a deck with known content, reopen the zip and
 * check what the post-processing steps promise — animations differentiated
 * by block type, Morph between consecutive slides sharing a title, embedded
 * fonts, and the SVG twin that now rides alongside every rasterized picture.
 * This is the only safety net over the regex OOXML injections (anim, morph,
 * fonts, svg).
 *
 * Added to it is what an export must NEVER do, and what no diff review
 * catches because you have to reopen the zip to see it:
 *   - falling over while running (a bullet whose only content is an image, an
 *     icon name that contains a slash);
 *   - carrying the author's LOCAL PATH inside a file that gets passed around;
 *   - embedding a font whose vendor forbids embedding;
 *   - shipping a part no XML parser accepts, which is the one thing that makes
 *     PowerPoint declare the whole file corrupt.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { renderDeck, renderDeckBytes } from '../src/pptx/render.mjs';
import { embedFonts, readFsType } from '../src/pptx/fonts.mjs';
import { embedVectorImages } from '../src/pptx/svg.mjs';
import { svgPartSafe } from '../src/deck/svg.mjs';
import { FONT_FILES, PAGE, SPACE, px } from '../src/deck/tokens.mjs';
import { readAllBlocks } from './helpers.mjs';

/** A valid 2×2 PNG: enough for imageDims() to read a ratio and for
 *  PptxGenJS to embed a real media part. */
const PNG_2PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
  'base64',
);

/** Compile a source in a disposable directory and return the reopened zip. */
async function compilePptx(t, source, { files = {}, opts = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pptx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), content);
  const out = path.join(dir, 'e2e.pptx');
  const deck = parseDeck(source);
  const scenes = buildScenes(deck);
  const stats = await renderDeck(scenes, deck.meta, dir, out, opts);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  return { dir, out, deck, scenes, stats, zip };
}

/** slideN.xml as text, N being 1-based like everywhere in the format. */
const slideXml = (zip, n) => zip.file(`ppt/slides/slide${n}.xml`).async('string');

/** Every part of the zip as text, name included — THIS is the corpus we search
 *  for a leak: the path can just as well escape through docProps or through a
 *  relationship as through the `descr` of an image. */
async function allParts(zip) {
  const parts = [];
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    parts.push([name, (await zip.file(name).async('nodebuffer')).toString('latin1')]);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// OOXML post-processing: animations, Morph, fonts
// ---------------------------------------------------------------------------

const SOURCE = `---
title: Test deck
animate: true
---

# Long list

${Array.from({ length: 20 }, (_, k) => `- item number ${k + 1} with enough text to count`).join('\n')}

# Pillars

<!-- layout: pillars -->

## One

- a

## Two

- b

# Milestones

<!-- layout: timeline -->
<!-- animate: zoom -->

## 2025

- a

## 2026

- b
`;

test('pptx: differentiated animations, Morph and fonts in the zip', async (t) => {
  const { scenes, stats, zip } = await compilePptx(t, SOURCE);

  assert.equal(stats.warnings.length, 0, `unexpected give-ups: ${stats.warnings.join(' ; ')}`);
  assert.ok(stats.morphSlides >= 1, 'at least one "(cont.)" slide in Morph');
  assert.ok(stats.animatedSlides >= 3, 'animated slides expected');

  const slideXml = async (n) => zip.file(`ppt/slides/slide${n}.xml`).async('string');

  // the scenes give the number of each slide (implicit cover at 1)
  const continuedIdx = scenes.findIndex((s) => s.continued);
  const contXml = await slideXml(continuedIdx + 1);
  assert.match(contXml, /p159:morph/, 'Morph transition on the (cont.) slide');
  assert.match(contXml, /name="!!title-/, 'title renamed for the Morph pairing');
  assert.match(await slideXml(continuedIdx), /name="!!title-/, 'original title renamed too');
  // position within the schema: transition before the timing tree
  const pos = contXml.indexOf('<mc:AlternateContent');
  const timing = contXml.indexOf('<p:timing');
  assert.ok(pos !== -1 && (timing === -1 || pos < timing), 'transition before <p:timing>');

  const pillarsIdx = scenes.findIndex((s) => s.layout === 'pillars');
  const pillarsXml = await slideXml(pillarsIdx + 1);
  assert.match(pillarsXml, /presetID="22"/, 'wipe on the panels');
  assert.match(pillarsXml, /presetID="10"/, 'fade on the text');

  const timelineIdx = scenes.findIndex((s) => s.layout === 'timeline');
  const timelineXml = await slideXml(timelineIdx + 1);
  assert.match(timelineXml, /presetID="23"/, 'zoom imposed by <!-- animate: zoom -->');
  assert.doesNotMatch(
    timelineXml,
    /presetID="10"/,
    'the imposed effect replaces the per-type choice',
  );

  if (stats.fontsEmbedded) {
    assert.match(await zip.file('ppt/presentation.xml').async('string'), /<p:embeddedFontLst>/);
  }
});

// ---------------------------------------------------------------------------
// Titles: a real OOXML placeholder, not a floating text box
// ---------------------------------------------------------------------------

// A title laid down with an ordinary `addText` is, to PowerPoint, nothing but a
// text box named "Text 0": the accessibility checker reported "missing slide
// title" on EVERY slide, Outline view stayed empty (so no navigation and no
// reordering by title) and screen readers lost the primary mechanism for
// announcing a slide. None of that shows up in a diff: you have to reopen the
// zip.

/** Every top-level shape of a slideN.xml, in order. */
const shapes = (xml) =>
  [...xml.matchAll(/<p:(sp|pic|graphicFrame)>([\s\S]*?)<\/p:\1>/g)].map((m) => m[2]);

/** The EXACT `<p:nvSpPr>` PowerPoint writes for a title placeholder, and that
 *  canonicalizeTitlePlaceholders() must reproduce character for character.
 *  Only the `<p:cNvPr>` (id and name, specific to each shape) is left free.
 *  Three things are at stake here that a loose pattern let through:
 *   - NO `idx`: ECMA-376 makes it the pairing mechanism for BODY placeholders
 *     ("used when applying templates or changing layouts to match a
 *     placeholder … to another"); the title is a singleton, it pairs by its
 *     `type`;
 *   - `<a:spLocks noGrp="1"/>` inside the `<p:cNvSpPr>`, which PowerPoint puts
 *     on every placeholder (see the notesMaster PptxGenJS embeds as is, copied
 *     from a PowerPoint file: its six placeholders carry it);
 *   - NO `hasCustomPrompt`: our masters declare no prompt. */
const NV_SP_PR_TITLE =
  /<p:nvSpPr><p:cNvPr id="\d+" name="[^"]*"><\/p:cNvPr><p:cNvSpPr><a:spLocks noGrp="1"\/><\/p:cNvSpPr><p:nvPr><p:ph type="title"\/><\/p:nvPr><\/p:nvSpPr>/;

/** The shape that carries a title placeholder, whatever its form —
 *  deliberately PERMISSIVE: it is the safety net that must then observe the
 *  discrepancy, not the lookup that hides it by finding nothing. */
const titleShape = (xml) => shapes(xml).find((f) => /<p:ph\b[^>]*\stype="title"/.test(f));

/** Offset and extent of a shape, in EMU. */
function box(shape) {
  const m = shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/);
  return m && { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

const EMU = 914400;
const toEmu = (inches) => Math.round(inches * EMU);

const SOURCE_TITLES = `---
title: Titled deck
---

# First slide

Some text.

# A section

# Second slide

- a
- b
`;

test('pptx: every slide carries a title in the OOXML sense, with unchanged geometry', async (t) => {
  const { scenes, stats, zip } = await compilePptx(t, SOURCE_TITLES);

  assert.deepEqual(stats.warnings, []);
  // cover (frontmatter title), content, section, content
  assert.deepEqual(
    scenes.map((s) => s.master),
    ['cover', 'content', 'section', 'content'],
  );

  for (const [k, scene] of scenes.entries()) {
    const xml = await zip.file(`ppt/slides/slide${k + 1}.xml`).async('string');
    const title = titleShape(xml);
    assert.ok(title, `slide ${k + 1}: no <p:ph type="title"> — PowerPoint will call it untitled`);
    // and it is indeed THE TITLE that lives in it: an empty placeholder (the
    // one PptxGenJS adds automatically when the master declares one and nobody
    // fills it) would leave Outline view as empty as before, with the text
    // floating beside it in an anonymous box
    assert.match(
      title,
      new RegExp(`<a:t>${scene.title}</a:t>`),
      `slide ${k + 1}: the title "${scene.title}" is not INSIDE the placeholder`,
    );
    // …and it has the SHAPE of a PowerPoint title, not merely the label.
    // PptxGenJS spontaneously produces `<p:ph idx="100" type="title"
    // hasCustomPrompt="1"/>` inside a `<p:sp>` with no spLocks: schema-valid,
    // but that is not what PowerPoint writes, and a loose pattern cannot tell
    // the difference.
    assert.match(
      title,
      NV_SP_PR_TITLE,
      `slide ${k + 1}: the title placeholder does not have the canonical form`,
    );
    // the title is also the FIRST shape — on EVERY slide, cover included: that
    // is what the `!!title-N` renaming in morph.mjs (renameFirstShape) assumes,
    // and it is the reading order of screen readers
    assert.equal(
      shapes(xml).indexOf(title),
      0,
      `slide ${k + 1}: the title is not at the head of the spTree`,
    );
  }

  // No title, nowhere — slides AND layouts — keeps an `idx` or a
  // `hasCustomPrompt`: letting either side diverge would reopen the pairing
  // question.
  for (const part of Object.keys(zip.files).filter((n) =>
    /^ppt\/(slides\/slide|slideLayouts\/slideLayout)\d+\.xml$/.test(n),
  )) {
    const xml = await zip.file(part).async('string');
    for (const ph of xml.match(/<p:ph\b[^>]*\stype="title"[^>]*\/>/g) ?? [])
      assert.equal(ph, '<p:ph type="title"/>', `${part}: non-canonical title placeholder`);
  }

  // the placeholder must not have MOVED the title: the geometry stays the one
  // the design tokens give, to the pixel (PptxGenJS makes the position inherit
  // from the placeholder declared in the master — hence the risk of drift)
  const content = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.deepEqual(box(titleShape(content)), {
    x: toEmu(px(PAGE.margin)),
    y: toEmu(px(SPACE.lg)),
    w: toEmu(px(PAGE.width - 2 * PAGE.margin)),
    h: toEmu(px(PAGE.titleHeight - SPACE.lg - 8)),
  });
  // and the theme still applies to it (bold, title size, ink). The run
  // properties are matched around `lang`, not through it: the deck's language
  // is stamped there (proofing.mjs) and PptxGenJS adds its own `altLang`
  // beside it — neither has anything to do with what this asserts.
  assert.match(content, /<a:rPr lang="[^"]+"[^>]* sz="2600" b="1"[\s\S]*?First slide/);
});

test('pptx: docProps/app.xml lists the real titles — that is where PowerPoint reads the outline', async (t) => {
  // an untitled slide in the middle: we do not invent one for it
  const source =
    '---\ntitle: Plan & "hidden" costs\n---\n\nSome untitled text.\n\n# Second\n\n- a\n';
  const { stats, zip } = await compilePptx(t, source);

  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.titledSlides, 2, 'two slides out of three carry a title');

  const app = await zip.file('docProps/app.xml').async('string');
  const block = app.match(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/)[0];
  const entries = [...block.matchAll(/<vt:lpstr>([\s\S]*?)<\/vt:lpstr>/g)].map((m) => m[1]);

  // the head (fonts, theme) belongs to PptxGenJS and goes back out unchanged
  assert.deepEqual(entries.slice(-3), [
    'Plan &amp; "hidden" costs', // escaped: a bare & would break the XML of the file
    'Slide 2', // untitled: the default entry, not an invented title
    'Second',
  ]);
  assert.equal(
    entries.length,
    Number(block.match(/size="(\d+)"/)[1]),
    'the announced size of the vector must stay exact',
  );
});

test('pptx: shapes carry a meaningful name — that is what "Reading Order" reads', async (t) => {
  const source =
    '---\ntitle: Names\n---\n\n# One slide\n\nSome text.\n\n- a\n- b\n\n:::success\nHeads up.\n:::\n';
  const { zip } = await compilePptx(t, source);
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  // the root group (empty name) and the page number (coming from the master)
  // are not shapes we write
  const names = [...xml.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((n) => n && !/Placeholder/.test(n));

  assert.deepEqual(names, ['Title', 'Paragraph 1', 'List 1', 'Callout 1', 'Callout 2']);
  // the PptxGenJS default teaches nobody anything
  assert.ok(
    !names.some((n) => /^(Text|Shape|Image|Table) \d+$/.test(n)),
    `default names: ${names}`,
  );
});

// ---------------------------------------------------------------------------
// Not falling over while running
// ---------------------------------------------------------------------------

// The parser keeps only the TEXT of a list item: a bullet whose only content is
// an image therefore arrives without a single run. The bullet formatting was
// applied to the first run — there was none, and it was the whole export that
// fell over, not just the bullet.
test('pptx: a bullet whose only content is an image does not take the export down', async (t) => {
  const source =
    '---\ntitle: Bullets\n---\n\n# List\n\n- ![A diagram](photo.png)\n- some text after\n- ![](photo.png)\n';
  const { stats, zip } = await compilePptx(t, source, { files: { 'photo.png': PNG_2PX } });

  assert.equal(stats.slideCount, 2);
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  // the empty bullet keeps its line — like the empty <li> of the HTML renderer
  // — so the following bullets are not shifted
  assert.match(xml, /some text after/, 'the rest of the list is rendered');
  assert.equal(
    (xml.match(/<a:buChar/g) ?? []).length,
    3,
    'all three bullets are there, the empty one included',
  );
});

// The name comes from the DSL, hence from the author. `lucide:coffee/` does
// resolve to the "coffee" icon (the lookup sanitizes the name on its side), but
// the temporary PNG was written under that very name: a `/` in it designates a
// directory that does not exist, and the export fell over with an ENOENT — on
// an icon that existed.
test('pptx: an icon name containing a slash does not take the export down', async (t) => {
  const source = '---\ntitle: Icons\n---\n\n# Icon\n\n![](lucide:coffee/)\n';
  const { stats, zip } = await compilePptx(t, source);

  assert.equal(stats.iconsRendered, 1, 'the icon really is rendered');
  assert.deepEqual(stats.warnings, [], 'an icon that resolves deserves no diagnostic');
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /descr="Icon coffee\/"/);
});

// The .pptx rasterizes an icon; the HTML inlines the SVG and is sharp at any
// size. A fixed raster density behind a size word therefore made the LARGE
// icon — the one the word exists to make prominent — the softest mark on the
// slide, and the two formats diverged on the same deck.
test('pptx: the icon raster follows the size word, so `large` is not the blurriest', async (t) => {
  const source =
    '---\ntitle: Icons\n---\n\n# Large\n\n![large](lucide:coffee)\n\n# Plain\n\n![](lucide:coffee)\n';
  const { zip } = await compilePptx(t, source);
  // PNG header: width is the big-endian uint32 at offset 16
  const widths = [];
  for (const name of Object.keys(zip.files).filter((f) => /^ppt\/media\/.*\.png$/.test(f)))
    widths.push((await zip.file(name).async('nodebuffer')).readUInt32BE(16));
  widths.sort((a, b) => a - b);
  assert.equal(widths.length, 2, 'one raster per icon');
  assert.ok(
    widths[1] > widths[0],
    `the large icon must be rasterized larger (${widths.join(' vs ')})`,
  );
});

// markdown-it percent-encodes the source of an image: `lucide:café-emoji`
// arrives as "caf%c3%a9-emoji". A diagnostic that copied that as is would be
// telling the author about a string they never wrote.
test('pptx: an unknown icon is reported, under the name the author wrote', async (t) => {
  const source =
    '---\ntitle: Icons\n---\n\n# One\n\n![](lucide:café-emoji)\n\n' +
    '# Two\n\n![](lucide:coffee)\n\n# Three\n\n![](lucide:zzz-does-not-exist)\n';
  const { stats } = await compilePptx(t, source);

  assert.equal(stats.iconsRendered, 1, 'only the icon that exists is rendered');
  assert.equal(stats.iconsTotal, 3);
  assert.equal(stats.warnings.length, 2, 'both missing icons are reported');
  assert.match(stats.warnings[0], /café-emoji/, 'the name is decoded so it stays readable');
  assert.doesNotMatch(stats.warnings[0], /%c3%a9/i, 'never the raw percent-encoding');
  // deck order, whatever the completion order of the concurrent renders
  assert.match(stats.warnings[1], /zzz-does-not-exist/, 'diagnostics follow the deck order');
});

// ---------------------------------------------------------------------------
// What the deliverable must not carry away: the author's directory tree
// ---------------------------------------------------------------------------

// PptxGenJS, for want of an `altText`, copies the PATH of the file into the
// `descr` attribute of the image. The .pptx leaves by email with the username
// and the whole directory tree — and the alternative text written by the
// author was lost on the way.
test('pptx: the alternative text lands in `descr`, escaped, and no local path escapes', async (t) => {
  const source =
    `---\ntitle: Images\n---\n\n# Figures\n\n![A "diagram" & <useful>](photo.png)\n\n` +
    '# Icon\n\n![](lucide:coffee)\n';
  const { dir, stats, zip } = await compilePptx(t, source, { files: { 'photo.png': PNG_2PX } });

  assert.deepEqual(stats.warnings, []);
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  // escaping: a quote would close the attribute, a `<` would open a tag — a
  // hostile alt must not be able to rewrite the XML of the slide
  assert.match(xml, /descr="A &quot;diagram&quot; &amp; &lt;useful&gt;"/);

  // the leak is looked for across the WHOLE zip, not on the single slide: the
  // path could just as well escape through docProps, through a relationship or
  // through a part name — and the PNG of the icon comes from a temporary
  // directory
  for (const [name, content] of await allParts(zip)) {
    assert.ok(!content.includes(dir), `absolute project path in ${name}`);
    assert.ok(!content.includes(os.tmpdir()), `absolute temporary path in ${name}`);
    assert.ok(!content.includes(os.homedir()), `home directory in ${name}`);
  }
});

// `altOf(alt, src)` falls back on the source AS THE AUTHOR WROTE IT. Inserting
// an image by its absolute path is an entirely ordinary thing to do — drag and
// drop from the Desktop — and the path then went back out into the .pptx
// through the back door, with the username.
test('pptx: an absolute path written by the author does not escape either (neither in `descr` nor in the clear)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-abs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // accents on purpose: markdown-it percent-encodes the destination of an
  // image, it has to be decoded back for the name to stay readable
  const photo = path.join(dir, 'holiday-café.png');
  fs.writeFileSync(photo, PNG_2PX);
  const missing = path.join(dir, 'never-delivered.png');

  // without an alt, it is `src` that serves as the fallback — and `src` is
  // absolute here
  const source = `---\ntitle: Images\n---\n\n# Present\n\n![](${photo})\n\n# Absent\n\n![](${missing})\n`;
  const out = path.join(dir, 'abs.pptx');
  const deck = parseDeck(source);
  await renderDeck(buildScenes(deck), deck.meta, dir, out);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));

  assert.match(
    await zip.file('ppt/slides/slide2.xml').async('string'),
    /descr="holiday-café\.png"/,
    'the file name stays — it identifies the image — but the directory goes',
  );

  // the placeholder for an image that cannot be found is text VISIBLE on the
  // slide: an absolute path there would be a leak across the whole page
  assert.match(
    await zip.file('ppt/slides/slide3.xml').async('string'),
    /\[image: never-delivered\.png\]/,
  );

  for (const [name, content] of await allParts(zip)) {
    assert.ok(!content.includes(dir), `absolute path in ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Font licensing: the fsType field of the OS/2 table
// ---------------------------------------------------------------------------

/** Build a minimal sfnt carrying nothing but an OS/2 table — just what
 *  readFsType reads: numTables, the table record, then the field at offset 8.
 *  Hermetic, unlike the system fonts. */
function sfntWithFsType(fsType, { tag = 'OS/2', base = 0 } = {}) {
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(fsType, 8);
  const header = Buffer.alloc(12 + 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(1, 4); // numTables
  header.write(tag, 12, 'latin1');
  // a table offset is counted from the START OF THE FILE, never from the header
  // of the font: that is what lets two fonts of the same collection share a
  // table (`base` places the font inside the .ttc)
  header.writeUInt32BE(base + header.length, 12 + 8);
  header.writeUInt32BE(os2.length, 12 + 12);
  return Buffer.concat([header, os2]);
}

/** Minimal sfnt whose WINDOWS IDENTITY is controllable: an OS/2 table
 *  (fsType and the fsSelection style bits) plus a name table carrying a
 *  single Windows-platform family record (nameID 1, UTF-16BE) — exactly what
 *  readFontIdentity reads and what GDI matches an embedded font by. */
function sfntWithIdentity({ family, fsType = 8, bold = false, italic = false }) {
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(fsType, 8);
  os2.writeUInt16BE((bold ? 0x20 : 0) | (italic ? 0x01 : 0), 62); // fsSelection
  const str = Buffer.from(family, 'utf16le').swap16(); // UTF-16BE in the file
  const name = Buffer.alloc(6 + 12 + str.length);
  name.writeUInt16BE(1, 2); // count (format 0, one record)
  name.writeUInt16BE(6 + 12, 4); // storage right after the record
  name.writeUInt16BE(3, 6); // platform: Windows
  name.writeUInt16BE(1, 8); // encoding: Unicode BMP
  name.writeUInt16BE(0x409, 10); // language: en-US
  name.writeUInt16BE(1, 12); // nameID 1: family
  name.writeUInt16BE(str.length, 14);
  str.copy(name, 18);
  const header = Buffer.alloc(12 + 2 * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(2, 4); // numTables
  header.write('OS/2', 12, 'latin1');
  header.writeUInt32BE(header.length, 12 + 8);
  header.writeUInt32BE(os2.length, 12 + 12);
  header.write('name', 28, 'latin1');
  header.writeUInt32BE(header.length + os2.length, 28 + 8);
  header.writeUInt32BE(name.length, 28 + 12);
  return Buffer.concat([header, os2, name]);
}

/** A .ttc collection carrying the given fsTypes, in order. */
function ttcWithFsType(values) {
  const headerLen = 12 + 4 * values.length;
  const size = sfntWithFsType(0).length; // same template for all of them
  const fonts = values.map((v, k) => sfntWithFsType(v, { base: headerLen + k * size }));
  const header = Buffer.alloc(headerLen);
  header.write('ttcf', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(fonts.length, 8);
  fonts.forEach((f, k) => header.writeUInt32BE(headerLen + k * size, 12 + k * 4));
  return Buffer.concat([header, ...fonts]);
}

test('readFsType: reads the field of the OS/2 table, including inside a collection', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-fstype-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, buf) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, buf);
    return f;
  };

  // the four licence levels carried by bits 0-3
  assert.equal(readFsType(write('installable.ttf', sfntWithFsType(0))), 0);
  assert.equal(readFsType(write('restricted.ttf', sfntWithFsType(2))), 2);
  assert.equal(readFsType(write('preview.ttf', sfntWithFsType(4))), 4);
  assert.equal(readFsType(write('editable.ttf', sfntWithFsType(8))), 8);
  // high bits (subsetting forbidden, bitmap only): returned as they are, they
  // decide nothing — it is the licence level that settles the matter
  assert.equal(readFsType(write('editable-nosub.ttf', sfntWithFsType(0x0108))), 0x0108);

  // collection: the first font is authoritative…
  assert.equal(readFsType(write('collection.ttc', ttcWithFsType([0, 4, 4]))), 0);
  // …unless any one of the fonts is Restricted, because the WHOLE file ships
  // inside the .pptx — that refusal wins
  assert.equal(readFsType(write('collection-restricted.ttc', ttcWithFsType([8, 2]))), 2);

  // could not be read: null, never an exception — an export does not fall over
  // for that
  assert.equal(readFsType(path.join(dir, 'nonexistent.ttf')), null);
  assert.equal(readFsType(write('empty.ttf', Buffer.alloc(0))), null);
  assert.equal(readFsType(write('no-os2.ttf', sfntWithFsType(8, { tag: 'cmap' }))), null);
  assert.equal(readFsType(write('truncated.ttf', sfntWithFsType(8).subarray(0, 20))), null);
});

// The expected values are those of real system fonts: it is the only way to
// check that we read the format as it exists, and not as our own fixtures
// write it.
test('readFsType: values of the system fonts (macOS)', (t) => {
  const arial = '/System/Library/Fonts/Supplemental/Arial.ttf';
  const helvetica = '/System/Library/Fonts/Helvetica.ttc';
  if (!fs.existsSync(arial) || !fs.existsSync(helvetica)) {
    t.skip('system fonts absent (outside macOS)');
    return;
  }
  assert.equal(readFsType(arial), 8, 'Arial: editable embedding');
  assert.equal(readFsType(helvetica), 0, 'Helvetica.ttc: installable');
});

test('embedFonts: a "Restricted" font is not embedded, and the refusal is said out loud', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-licence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // FONT_FILES is a live object, shared by the whole suite: put it back in
  // order, otherwise the following tests would embed our fake fonts
  const before = { ...FONT_FILES };
  t.after(() => Object.assign(FONT_FILES, before));

  const write = (name, buf) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, buf);
    return f;
  };
  const editable = write('Brand-Regular.ttf', sfntWithFsType(8));
  const restricted = write('Brand-Bold.ttf', sfntWithFsType(2));
  const unreadable = write('Brand-Italic.ttf', Buffer.from('not a font'));

  // a .pptx to post-process (its content does not matter here, its structure
  // does)
  const deck = parseDeck('---\ntitle: License\n---\n\n# Slide\n\nSome text.\n');
  const out = path.join(dir, 'licence.pptx');
  await renderDeck(buildScenes(deck), deck.meta, dir, out);

  Object.assign(FONT_FILES, { regular: editable, bold: restricted, italic: unreadable });
  const r = await embedFonts(out);

  assert.equal(r.count, 2, 'the restricted variant is dropped, the two others go through');

  const refusal = r.warnings.find((w) => /Restricted/.test(w));
  assert.ok(refusal, `refusal expected, got: ${r.warnings.join(' ; ')}`);
  assert.match(refusal, /Brand-Bold\.ttf/, 'the diagnostic names the font at fault');
  assert.match(refusal, /fsType 2/, 'and the value that had it refused');

  // a value that cannot be read warns but does not block: refusing to export a
  // deck over a font nobody disputes would be taking the wrong side
  const doubt = r.warnings.find((w) => /could not be read/.test(w));
  assert.ok(doubt, `warning expected, got: ${r.warnings.join(' ; ')}`);
  assert.match(doubt, /Brand-Italic\.ttf/);

  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const fntdata = Object.keys(zip.files).filter((f) => f.endsWith('.fntdata'));
  assert.equal(fntdata.length, 2, `font parts expected, got: ${fntdata.join(', ')}`);
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /<p:embeddedFontLst>/);

  // and the refused font is nowhere in the deliverable
  const restrictedBytes = fs.readFileSync(restricted).toString('latin1');
  for (const [name, content] of await allParts(zip)) {
    assert.ok(!content.includes(restrictedBytes), `refused font present in ${name}`);
  }
});

test('embedFonts: a variant Windows cannot match is not embedded, and the remedy is said', async (t) => {
  // Webfont families in the wild: each weight declares ITSELF as a
  // single-style family (distinct nameID 1, style bits at zero). macOS
  // regroups them, GDI does not — PowerPoint on Windows then fails to install
  // the embedded fonts at EVERY recipient ("general failure" dialog). Seen
  // live with the Montréal Web cut of a city kit.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-identity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = { ...FONT_FILES };
  t.after(() => Object.assign(FONT_FILES, before));

  const write = (name, buf) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, buf);
    return f;
  };
  // FONTS.body is the default theme's family here (Arial): the regular is a
  // faithful desktop cut, the bold a webfont-style family of its own, the
  // italic bears the right family name but no italic bit
  const okRegular = write('Body-Regular.ttf', sfntWithIdentity({ family: 'Arial' }));
  const wrongFamily = write(
    'Body-Bold.ttf',
    sfntWithIdentity({ family: 'Arial Gras', bold: true }),
  );
  const wrongStyle = write('Body-Italic.ttf', sfntWithIdentity({ family: 'Arial', italic: false }));

  const deck = parseDeck('---\ntitle: Identity\n---\n\n# Slide\n\nSome text.\n');
  const out = path.join(dir, 'identity.pptx');
  await renderDeck(buildScenes(deck), deck.meta, dir, out);

  Object.assign(FONT_FILES, { regular: okRegular, bold: wrongFamily, italic: wrongStyle });
  const r = await embedFonts(out);

  assert.equal(r.count, 1, `only the coherent variant goes through: ${r.warnings.join(' ; ')}`);

  const family = r.warnings.find((w) => /family name/.test(w));
  assert.ok(family, `family warning expected, got: ${r.warnings.join(' ; ')}`);
  assert.match(family, /Body-Bold\.ttf/, 'the diagnostic names the font at fault');
  assert.match(family, /"Arial Gras"/, 'the name Windows would see');
  assert.match(family, /nameID 1/, 'and what to rebuild');

  const style = r.warnings.find((w) => /style bits/.test(w));
  assert.ok(style, `style warning expected, got: ${r.warnings.join(' ; ')}`);
  assert.match(style, /Body-Italic\.ttf/);

  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const fntdata = Object.keys(zip.files).filter((f) => f.endsWith('.fntdata'));
  assert.equal(fntdata.length, 1, `one font part expected, got: ${fntdata.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Rasterizer absent: the deliverable is truncated, that must be SAID
// ---------------------------------------------------------------------------

// @resvg/resvg-js ships its binaries as twelve optionalDependencies, of which
// npm installs only the one for the current platform: a VSIX built on macOS and
// installed under Windows embeds a truncated `dist/core`. The export then went
// on succeeding — exit code 0, "✓ N slides" — with the charts replaced by their
// specification as a code block, which the author discovered in the meeting.
// LUTRIN_NO_RASTER reproduces exactly that machinery.
const CHART_SOURCE =
  '---\ntitle: Quarter\n---\n\n# Sales\n\n```chart\ntype: bar\ncategories: Q1, Q2\nSales: 3, 5\n```\n';

/** Compile with the rasterizer made unavailable, then restore. */
async function withoutRasterizer(t, source) {
  const before = process.env.LUTRIN_NO_RASTER;
  process.env.LUTRIN_NO_RASTER = '1';
  t.after(() => {
    if (before === undefined) delete process.env.LUTRIN_NO_RASTER;
    else process.env.LUTRIN_NO_RASTER = before;
  });
  return compilePptx(t, source);
}

test('pptx: rasterizer absent + chart → RASTER_UNAVAILABLE diagnostic', async (t) => {
  const { stats } = await withoutRasterizer(t, CHART_SOURCE);

  const d = stats.diagnostics.find((x) => x.code === 'RASTER_UNAVAILABLE');
  assert.ok(d, `diagnostic expected, got: ${JSON.stringify(stats.diagnostics)}`);
  assert.equal(d.severity, 'error', 'the deliverable is truncated, not merely imperfect');
  assert.match(d.message, /npm install/, 'the message must say WHAT TO DO');
  // and it must REACH the user: the CLI prints only `warnings`
  assert.ok(stats.warnings.includes(d.message), 'diagnostic absent from the printed warnings');
});

test('pptx: rasterizer absent with no block to rasterize → no diagnostic', async (t) => {
  const { stats } = await withoutRasterizer(t, '---\ntitle: Text\n---\n\n# Slide\n\nSome text.\n');
  assert.deepEqual(stats.diagnostics, [], 'nothing to rasterize: nothing to report');
});

test('pptx: rasterizer absent + VALID icon → RASTER_UNAVAILABLE alone, never "icon not found"', async (t) => {
  // the icon's SVG resolves fine from lucide-static: the only failure is the
  // rasterization. Conflating the two sent Windows users hunting for a
  // network problem when their VSIX simply shipped another platform's binary.
  const { hasLucideIcon } = await import('../src/deck/assets.mjs');
  if (hasLucideIcon('antenna') !== true) return t.skip('lucide-static absent on this machine');
  const { stats } = await withoutRasterizer(
    t,
    '---\ntitle: Icons\n---\n\n# Slide\n\n![](lucide:antenna)\n',
  );
  assert.ok(
    stats.diagnostics.some((x) => x.code === 'RASTER_UNAVAILABLE'),
    `the icon counts among the truncated blocks: ${JSON.stringify(stats.diagnostics)}`,
  );
  assert.ok(
    !stats.warnings.some((w) => /not found/.test(w)),
    `a found icon must not be reported as not found: ${JSON.stringify(stats.warnings)}`,
  );
});

test('pptx: rasterizer present → the chart is an image, with no diagnostic', async (t) => {
  const { rasterAvailable } = await import('../src/deck/assets.mjs');
  if (!(await rasterAvailable())) return t.skip('@resvg/resvg-js absent on this platform');
  const { stats, zip } = await compilePptx(t, CHART_SOURCE);
  assert.deepEqual(
    stats.diagnostics.filter((d) => d.code === 'RASTER_UNAVAILABLE'),
    [],
  );
  const media = Object.keys(zip.files).filter((f) => /^ppt\/media\/.*\.png$/.test(f));
  assert.ok(media.length >= 1, 'the chart must be embedded as a PNG');
});

// ---------------------------------------------------------------------------
// Morph: any run of CONSECUTIVE slides sharing a title
// ---------------------------------------------------------------------------

// Morph used to reach only the "(cont.)" pages pagination creates. It now
// covers any maximal run of consecutive slides showing the same title — the
// paginated pages and the slides an author deliberately titled the same way
// are ONE rule, not two. Three things then have to hold at once and none of
// them shows up in a diff: the whole run shares a single `!!title-N` (that is
// what Morph pairs the titles ON), the transition sits on every slide but the
// first (PowerPoint compares a slide with the one BEFORE it), and a title that
// merely comes back later is not a run at all.

/** The `!!title-N` a chain gave a slide, or null. */
const chainKey = (xml) => /name="(!!title-\d+)"/.exec(xml)?.[1] ?? null;

const MORPH_CONSECUTIVE = `---
title: Morph
---

# Roadmap

- ship the importer
- ship the editor

# Roadmap

- and then everything else

# Elsewhere

- unrelated
`;

test('pptx: two consecutive slides sharing a title morph, and the slide after them is left alone', async (t) => {
  const { scenes, stats, zip } = await compilePptx(t, MORPH_CONSECUTIVE);

  assert.deepEqual(
    scenes.map((s) => s.title),
    ['Morph', 'Roadmap', 'Roadmap', 'Elsewhere'],
    'cover from the frontmatter, then the pair, then the slide that breaks the run',
  );
  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.morphSlides, 1, 'a pair carries ONE transition, not two');

  const second = await slideXml(zip, 2);
  const third = await slideXml(zip, 3);
  const fourth = await slideXml(zip, 4);

  // both slides of the pair, the first included: the renaming is the pairing
  // mechanism, so a chain where only the arriving slide were renamed would
  // morph the title into nothing
  const key = chainKey(second);
  assert.ok(key, 'the slide the chain STARTS at is renamed too');
  assert.equal(chainKey(third), key, 'the pair must share ONE title name');

  // the transition goes on the slide you arrive AT. On the first it would
  // morph the chain out of whatever happens to precede it — here the cover.
  assert.doesNotMatch(second, /p159:morph/, 'no transition on the first slide of a chain');
  assert.match(third, /p159:morph/);

  assert.equal(chainKey(fourth), null, 'a different title is a different chain');
  assert.doesNotMatch(fourth, /p159:morph/, 'and nothing morphs into it');
});

// THE REGRESSION NET FOR CONSECUTIVENESS. `# A`, `# B`, `# A` is not a
// continuity, it is a coincidence: grouping by title rather than by run would
// pair slides 2 and 4 and dissolve slide 3 into slide 4 for 700 ms, in front
// of an audience, for no reason. If anyone ever turns the run-grouping into a
// group-by-title, this is the test that has to fail.
test('pptx: a title that comes BACK — A, B, A — is a coincidence, and morphs nothing', async (t) => {
  const source = '---\ntitle: Morph\n---\n\n# A\n\n- one\n\n# B\n\n- two\n\n# A\n\n- three\n';
  const { scenes, stats, zip } = await compilePptx(t, source);

  assert.deepEqual(
    scenes.map((s) => s.title),
    ['Morph', 'A', 'B', 'A'],
  );
  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.morphSlides, 0, 'no run of two: nothing to morph');
  for (let n = 1; n <= scenes.length; n++) {
    const xml = await slideXml(zip, n);
    assert.equal(chainKey(xml), null, `slide ${n}: renamed although it belongs to no chain`);
    assert.doesNotMatch(xml, /p159:morph/, `slide ${n}`);
  }
});

const MORPH_PAGINATED = `---
title: Morph
---

# Roadmap

${Array.from({ length: 26 }, (_, k) => `- item number ${k + 1} with enough text to make this paginate`).join('\n')}

# Roadmap

- and the author's own slide, repeating the title
`;

// Before `titleKey`, a paginated run and the author slide repeating its title
// were two chains: the pages morphed among themselves, then the transition
// stuttered on the join because the author's "Roadmap" did not match the
// displayed "Roadmap (cont.)". One title, one chain.
test('pptx: a paginated run and the author slide repeating its title are ONE chain', async (t) => {
  const { scenes, stats, zip } = await compilePptx(t, MORPH_PAGINATED);

  assert.deepEqual(
    scenes.map((s) => s.title),
    ['Morph', 'Roadmap', 'Roadmap (cont.)', 'Roadmap'],
    'the fixture must still paginate into exactly one continuation page',
  );
  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.morphSlides, 2, 'a chain of three slides carries two transitions');

  const key = chainKey(await slideXml(zip, 2));
  assert.ok(key);
  for (const n of [3, 4]) {
    const xml = await slideXml(zip, n);
    assert.equal(chainKey(xml), key, `slide ${n}: a SECOND chain where there should be one`);
    assert.match(xml, /p159:morph/, `slide ${n}: no transition`);
  }
});

const MORPH_HERO = `---
title: Morph
---

# Skyline

![cover](photo.png)

# Skyline

![cover](photo.png)
`;

// THE LATENT BUG THIS CHANGE UNCOVERED. The renaming used to take the FIRST
// `<p:sp>` of the slide. On a content slide that is indeed the title — but the
// `hero` layout writes the Lutrin attribution first, over the full-frame
// image, and the title only after it. Morph would then have paired two
// watermarks (which sit at the same place on both slides, so nothing visible
// would move) while the titles blinked. `hero` was unreachable as long as only
// pagination built chains, and became reachable the moment two consecutive
// author slides could morph.
test('pptx: on a hero slide the renamed shape is the title placeholder, not the attribution', async (t) => {
  const { scenes, stats, zip } = await compilePptx(t, MORPH_HERO, {
    files: { 'photo.png': PNG_2PX },
  });

  assert.deepEqual(
    scenes.map((s) => s.master),
    ['cover', 'hero', 'hero'],
    'the fixture must really produce hero slides — that is the whole point',
  );
  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.morphSlides, 1);

  for (const n of [2, 3]) {
    const xml = await slideXml(zip, n);
    const renamed = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []).filter((sp) =>
      /name="!!title-\d+"/.test(sp),
    );
    assert.equal(renamed.length, 1, `slide ${n}: exactly one shape carries the chain name`);
    assert.match(
      renamed[0],
      /<p:ph\b[^>]*\stype="title"/,
      `slide ${n}: the chain name landed on a shape that is NOT the title`,
    );
    // …and the shape it would have landed on before is still called what it
    // is. Without this line the assertion above would stay green on a deck
    // that simply stopped writing an attribution, and the regression would go
    // unnoticed.
    assert.match(xml, /name="Lutrin attribution"/, `slide ${n}: the attribution was renamed`);
  }
});

// Trimmed, and only trimmed. Space around a title is INVISIBLE on the slide,
// so refusing to pair over it would be a failure the author cannot see and
// cannot debug. The escape below is a NON-BREAKING space, written as an escape
// on purpose: that is exactly the character a word processor or a French
// keyboard slips in without anyone typing it, and Markdown does not strip it
// the way it strips an ordinary trailing space. Case and inner spacing ARE
// visible — they are left to mean what they say, and giving two slides
// different titles stays the way to opt out of the morph.
const MORPH_SPACE = `---
title: Morph
---

# Reprise

- a

# Reprise\u00a0

- b

# reprise

- c
`;

test('pptx: titles differing only by invisible space still pair; differing by case, they do not', async (t) => {
  const { scenes, stats, zip } = await compilePptx(t, MORPH_SPACE);

  assert.deepEqual(
    scenes.map((s) => s.title),
    ['Morph', 'Reprise', 'Reprise\u00a0', 'reprise'],
    'the fixture depends on the parser keeping BOTH the trailing space and the case',
  );
  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.morphSlides, 1, 'the pair across the invisible space, and nothing else');

  const key = chainKey(await slideXml(zip, 2));
  assert.ok(key);
  const third = await slideXml(zip, 3);
  assert.equal(chainKey(third), key, 'a trailing space nobody can see must not break the pairing');
  assert.match(third, /p159:morph/);
  assert.equal(chainKey(await slideXml(zip, 4)), null, 'case is visible: it means what it says');
});

// ---------------------------------------------------------------------------
// The vector twin of a picture: the SVG rides ALONGSIDE the PNG
// ---------------------------------------------------------------------------

// A chart, a Mermaid diagram, a Lucide icon and a LaTeX equation are all born
// as SVG and used to be thrown away the instant resvg had rasterized them. The
// .pptx now carries both: the PNG stays the picture's fill and the SVG rides
// in an `<a:extLst>` extension that Office 2019+ prefers. Everything below is
// about the honesty of that pair — and about the one failure mode that costs
// the deliverable rather than merely its sharpness, a part no parser accepts.

const VECTOR_SOURCE = `---
title: Vectors
---

# Sales

\`\`\`chart
type: bar
categories: Q1, Q2
Sales: 3, 5
\`\`\`

# Icon

![](lucide:coffee)

# Equation

$$E = mc^2$$
`;

/** The three slides of VECTOR_SOURCE that carry a picture (the cover is 1). */
const VECTOR_SLIDES = [2, 3, 4];

/**
 * The shape carrying the vector twin on a slide — a `<p:pic>`, EXCEPT for an
 * equation, whose picture has since been wrapped in `mc:AlternateContent` and
 * now lives as the `<p:sp>` of the `mc:Fallback`. The blip fill is lifted
 * verbatim into it, twin and all, so everything asserted about it still holds;
 * only the element it is nested in changed.
 */
const vectorShapeOf = (xml) =>
  [
    ...(xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []),
    ...(xml.match(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g) ?? []),
  ].find((s) => s.includes('asvg:svgBlip'));

/** rId → the part it designates, as a zip path. A relationship Target is
 *  relative to the DIRECTORY of the part that cites it — `ppt/slides/` here —
 *  so `../media/vector-2-1.svg` has to be resolved, not string-matched. */
async function slideRels(zip, n) {
  const xml = await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`).async('string');
  return new Map(
    [...xml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [
      m[1],
      path.posix.normalize(`ppt/slides/${m[2]}`),
    ]),
  );
}

/** The vector path needs a rasterizer (no PNG, no picture at all) and
 *  lucide-static (no icon SVG). Both are optional on some platforms, and a
 *  skip that says WHY beats a red suite nobody can reproduce. */
async function vectorDepsPresent(t) {
  const { rasterAvailable, hasLucideIcon } = await import('../src/deck/assets.mjs');
  if (!(await rasterAvailable())) {
    t.skip('@resvg/resvg-js absent on this platform');
    return false;
  }
  if (hasLucideIcon('coffee') !== true) {
    t.skip('lucide-static absent on this machine');
    return false;
  }
  return true;
}

test('pptx: chart, icon and equation each carry an SVG twin reachable through a real relationship', async (t) => {
  if (!(await vectorDepsPresent(t))) return;
  const { stats, zip } = await compilePptx(t, VECTOR_SOURCE);

  assert.deepEqual(stats.warnings, []);
  assert.equal(stats.vectorImages, 3, 'all three blocks are born as SVG');

  const svgParts = Object.keys(zip.files).filter((f) =>
    /^ppt\/media\/vector-\d+-\d+\.svg$/.test(f),
  );
  assert.equal(svgParts.length, 3, `one part per vector, got: ${svgParts.join(', ') || 'none'}`);

  for (const n of VECTOR_SLIDES) {
    const xml = await slideXml(zip, n);
    const rels = await slideRels(zip, n);
    const ids = [...xml.matchAll(/<asvg:svgBlip\b[^>]*\sr:embed="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 1, `slide ${n}: exactly one vector twin expected`);

    // A DANGLING r:embed is the classic way an injected extension makes
    // PowerPoint refuse a file, and nothing else in the package would notice:
    // the extension is the only thing that points at the part.
    const target = rels.get(ids[0]);
    assert.ok(target, `slide ${n}: ${ids[0]} matches no relationship`);
    assert.ok(
      svgParts.includes(target),
      `slide ${n}: ${ids[0]} → ${target}, which is not one of the SVG parts`,
    );

    const svg = await zip.file(target).async('string');
    assert.match(svg, /^\s*<svg\b/, `${target}: not an SVG document`);
    // a standalone part has no host document to inherit the namespace from,
    // unlike an SVG inlined into the HTML export
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${target}: no SVG namespace`);
  }
});

// THE GUARANTEE THE WHOLE DESIGN RESTS ON. `r:embed` on the `<a:blip>` itself
// is the picture's fill; the extension only names a second representation.
// Keynote, QuickLook, LibreOffice and every Office before 2019 ignore an
// extension they do not know and draw the PNG — so swapping the fill for the
// SVG would show a broken picture to precisely the readers the fallback exists
// for. That is what handing PptxGenJS an `.svg` path does on the Node path,
// and it is why this module reopens the zip by hand.
test('pptx: the PNG stays the picture fill — the vector is an ADDITION, never a substitution', async (t) => {
  if (!(await vectorDepsPresent(t))) return;
  const { zip } = await compilePptx(t, VECTOR_SOURCE);
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  for (const n of VECTOR_SLIDES) {
    const xml = await slideXml(zip, n);
    const rels = await slideRels(zip, n);
    const pic = vectorShapeOf(xml);
    assert.ok(pic, `slide ${n}: no picture carrying a vector twin`);

    // `[^>]*` cannot cross a `>`, so this reads the r:embed of the BLIP and
    // never the one of the svgBlip nested inside it
    const fill = /<a:blip\b[^>]*\sr:embed="([^"]+)"/.exec(pic);
    assert.ok(fill, `slide ${n}: the blip carries no r:embed at all`);
    const target = rels.get(fill[1]);
    assert.match(
      target ?? '',
      /^ppt\/media\/.*\.png$/,
      `slide ${n}: the fill is no longer a PNG (${target})`,
    );

    // and the raster is really there: a relationship pointing at an absent or
    // empty part draws exactly the broken-image icon this test exists to rule out
    const png = await zip.file(target).async('nodebuffer');
    assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), `${target}: not a PNG`);
    assert.ok(png.length > 100, `${target}: suspiciously small (${png.length} bytes)`);

    // two representations, two parts — never one relationship doing both jobs
    const vector = /<asvg:svgBlip\b[^>]*\sr:embed="([^"]+)"/.exec(pic)[1];
    assert.notEqual(vector, fill[1], `slide ${n}: raster and vector share one relationship`);
  }
});

// A malformed part is what makes PowerPoint declare the whole file corrupt and
// offer to repair it — the worst failure mode this feature can have, and one
// that no other test in the suite would catch, since a broken SVG used to cost
// nothing more than a fallback code block. The reader below is deliberately
// STRICTER than the one in deck/svg.mjs: XML, unlike HTML, has no boolean
// attributes, no unquoted values, no bare `&` and no second root — everything
// a well-formedness parser refuses is refused here too, so that "it parses" in
// this file means what it means in Office.

/** A `&` that starts no entity or character reference. */
const BARE_AMP = /&(?!(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9.\-_]*);)/;

/** Reads one tag; null as soon as it is not a WELL-FORMED XML tag. */
function readStrictXmlTag(s, start) {
  let i = start + 1;
  const closing = s[i] === '/';
  if (closing) i++;
  const nm = /^[A-Za-z_:][\w:.-]*/.exec(s.slice(i));
  if (!nm) return null;
  const name = nm[0];
  i += name.length;
  let selfClose = false;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return null; // tag never closed
    if (s[i] === '>') {
      i++;
      break;
    }
    if (s[i] === '/' && s[i + 1] === '>') {
      selfClose = true;
      i += 2;
      break;
    }
    if (closing) return null; // `</a foo="1">` is not a closing tag
    const am = /^[A-Za-z_:][\w:.-]*/.exec(s.slice(i));
    if (!am) return null;
    i += am[0].length;
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '=') return null; // no boolean attributes in XML
    i++;
    while (i < s.length && /\s/.test(s[i])) i++;
    const quote = s[i];
    if (quote !== '"' && quote !== "'") return null; // and no unquoted values
    const close = s.indexOf(quote, i + 1);
    if (close < 0) return null;
    const value = s.slice(i + 1, close);
    if (value.includes('<') || BARE_AMP.test(value)) return null;
    i = close + 1;
  }
  return { name, closing, selfClose, end: i };
}

/** null when the document is well formed, otherwise WHY — a bare "corrupt"
 *  would send whoever sees this fail into the whole zip by hand. */
function xmlProblem(xml) {
  const stack = [];
  let roots = 0;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = xml.slice(i, lt < 0 ? xml.length : lt);
    if (BARE_AMP.test(text))
      return `bare "&" in character data: ${JSON.stringify(text.slice(0, 40))}`;
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      if (e < 0) return 'comment never terminated';
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (e < 0) return 'CDATA never terminated';
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2);
      if (e < 0) return 'processing instruction never terminated';
      i = e + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const e = xml.indexOf('>', lt);
      if (e < 0) return 'declaration never terminated';
      i = e + 1;
      continue;
    }
    const tag = readStrictXmlTag(xml, lt);
    if (!tag) return `not a well-formed tag: ${JSON.stringify(xml.slice(lt, lt + 60))}`;
    i = tag.end;
    if (tag.closing) {
      const open = stack.pop();
      if (open !== tag.name) return `</${tag.name}> closes ${open ? `<${open}>` : 'nothing'}`;
      if (!stack.length) roots++;
    } else if (tag.selfClose) {
      if (!stack.length) {
        if (roots) return `second root element <${tag.name}>`;
        roots++;
      }
    } else {
      if (!stack.length && roots) return `second root element <${tag.name}>`;
      stack.push(tag.name);
    }
  }
  if (stack.length) return `<${stack[stack.length - 1]}> never closed`;
  if (!roots) return 'no root element';
  return null;
}

test('pptx: every XML and SVG part of the package is well formed — that is what "not corrupt" means', async (t) => {
  if (!(await vectorDepsPresent(t))) return;
  const { zip } = await compilePptx(t, VECTOR_SOURCE);

  const parts = Object.keys(zip.files).filter(
    (n) => !zip.files[n].dir && /\.(xml|rels|svg)$/i.test(n),
  );
  // the count is asserted so that a filter quietly matching nothing — a
  // renamed extension, a zip walked the wrong way — cannot make this test pass
  // by examining zero parts
  assert.ok(parts.length > 30, `too few parts to be the whole package: ${parts.length}`);
  assert.equal(parts.filter((n) => n.endsWith('.svg')).length, 3, 'the SVG parts must be in there');

  const bad = [];
  for (const name of parts) {
    const problem = xmlProblem(await zip.file(name).async('string'));
    if (problem) bad.push(`${name}: ${problem}`);
  }
  assert.deepEqual(bad, [], `malformed parts:\n${bad.join('\n')}`);
});

// We do not write it ourselves: PptxGenJS declares it unconditionally, which
// is verified on a real output and relied on by pptx/svg.mjs. If a library
// upgrade dropped the line, the parts would become unreachable — Office
// refuses a package part whose extension no content type covers — and NOTHING
// else in the suite would notice, since the slide XML and the relationships
// would all still be perfectly correct.
test('pptx: [Content_Types].xml declares the svg extension, or the parts are unreachable', async (t) => {
  const { rasterAvailable } = await import('../src/deck/assets.mjs');
  if (!(await rasterAvailable())) return t.skip('@resvg/resvg-js absent on this platform');
  const { stats, zip } = await compilePptx(t, CHART_SOURCE);

  assert.ok(stats.vectorImages >= 1, 'the fixture must really produce an SVG part');
  const ct = await zip.file('[Content_Types].xml').async('string');
  assert.match(ct, /<Default Extension="svg" ContentType="image\/svg\+xml"\/>/);
});

test('embedVectorImages: run twice over the same file, the second pass adds nothing', async (t) => {
  if (!(await vectorDepsPresent(t))) return;
  const { out, zip } = await compilePptx(t, VECTOR_SOURCE);
  const before = fs.readFileSync(out);

  // the names the renderer really gave those pictures, read back OUT of the
  // document rather than assumed: this stays a test of the guard, not of the
  // label table
  const again = new Map();
  for (const n of VECTOR_SLIDES) {
    const pic = vectorShapeOf(await slideXml(zip, n));
    again.set(n, [
      {
        name: /<p:cNvPr\b[^>]*\sname="([^"]*)"/.exec(pic)[1],
        // deliberately a DIFFERENT vector: the guard has to fire on the
        // extension already present, not on the bytes happening to match
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
      },
    ]);
  }

  const r = await embedVectorImages(out, again);
  assert.equal(r.count, 0, 'a second pass must add no part');
  assert.deepEqual(r.warnings, [], 'and it is not a failure either — there is nothing to report');
  assert.ok(before.equals(fs.readFileSync(out)), 'a no-op pass rewrote the file');
});

// A name that is missing means the document is not the one we wrote — another
// tool passed over it, or a picture moved. Matching by `<p:pic>` ordinal would
// then quietly graft the vector onto the wrong picture; matching by name gives
// up on that one picture instead, and says so. The user still gets their
// raster, which is what they had yesterday.
test('embedVectorImages: a picture it cannot find stays a raster, and the give-up is said out loud', async (t) => {
  const source = '---\ntitle: Photo\n---\n\n# Figure\n\n![A photo](photo.png)\n';
  const { out, stats } = await compilePptx(t, source, { files: { 'photo.png': PNG_2PX } });

  assert.equal(stats.vectorImages, 0, 'a bitmap has no vector source: nothing to embed');
  const before = fs.readFileSync(out);

  const r = await embedVectorImages(
    out,
    new Map([
      [
        2,
        [
          {
            name: 'Nope 42',
            svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
          },
        ],
      ],
    ]),
  );

  assert.equal(r.count, 0);
  assert.equal(r.warnings.length, 1, `one give-up expected, got: ${r.warnings.join(' ; ')}`);
  assert.match(r.warnings[0], /"Nope 42"/, 'the diagnostic names the picture at fault');
  assert.match(r.warnings[0], /raster/, 'and says what happens instead: nothing changes');
  // byte-identical, not merely "still opens": rewriting a document the module
  // has just declared it does not recognize is the one thing it must not do
  assert.ok(before.equals(fs.readFileSync(out)), 'the file was rewritten on a give-up path');
});

// ---------------------------------------------------------------------------
// svgPartSafe: the gate the whole vector path opens on
// ---------------------------------------------------------------------------

// It lives here rather than in sanitize.test.mjs on purpose. sanitizeSvg
// answers "is this safe to INLINE in a page" — a hostile-input question, and
// that file is full of hostile inputs. svgPartSafe answers "may these bytes
// become an XML PART of a .pptx", a well-formedness question that exists only
// because of the module above and whose consequence is far harder: an ugly SVG
// renders badly and nothing else, an SVG that is not well-formed XML makes
// PowerPoint declare the whole deck corrupt. Hence opt IN on evidence — a
// false negative costs sharpness, a false positive costs the deliverable.

/** A real lucide-static icon, verbatim: the multi-line root tag and the
 *  licence comment are how the package actually ships them. */
const LUCIDE_COFFEE = `<!-- @license lucide-static v1.24.0 - ISC -->
<svg
  class="lucide lucide-coffee"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 2v2" />
  <path d="M14 2v2" />
  <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
  <path d="M6 2v2" />
</svg>
`;

test('svgPartSafe: a comment is not a malformation — every Lucide icon opens with one', () => {
  // the everyday case, and the one an early cut of this function got wrong:
  // readSvgTag returns null on `<!--`, which read as "unbalanced" would have
  // refused every lucide-static icon over its licence header
  assert.equal(svgPartSafe(LUCIDE_COFFEE), true, 'a real Lucide icon, licence comment included');
  assert.equal(
    svgPartSafe(LUCIDE_COFFEE.replace('<path d="M6 2v2" />', '<!-- and one inside -->')),
    true,
    'a comment inside the document is no different',
  );
});

test('svgPartSafe: refuses what no XML parser would accept', () => {
  // truncated — a rasterizer killed mid-write, a cache entry cut short
  assert.equal(
    svgPartSafe(LUCIDE_COFFEE.slice(0, LUCIDE_COFFEE.lastIndexOf('</svg>'))),
    false,
    'an SVG truncated before its closing tag',
  );
  assert.equal(svgPartSafe(LUCIDE_COFFEE.slice(0, 60)), false, 'truncated inside the root tag');
  assert.equal(
    svgPartSafe('<svg xmlns="http://www.w3.org/2000/svg"><!-- cut here'),
    false,
    'truncated inside a comment',
  );

  // a bare `&`: the classic way a generator produces XML no parser accepts
  assert.equal(
    svgPartSafe(LUCIDE_COFFEE.replace('lucide-coffee', 'Ben & Jerry')),
    false,
    'a bare "&"',
  );
  assert.equal(
    svgPartSafe(LUCIDE_COFFEE.replace('lucide-coffee', 'Ben &amp; Jerry')),
    true,
    'the escaped form is exactly what the entity is FOR',
  );

  // no namespace: an inlined SVG inherits it from the host document, a
  // standalone part has no host to inherit it from
  assert.equal(
    svgPartSafe(LUCIDE_COFFEE.replace(/\s*xmlns="[^"]*"/, '')),
    false,
    'no xmlns on the root',
  );
  assert.equal(svgPartSafe('<path d="M0 0h1"/>'), false, 'no <svg> root at all');

  // the callers hand over whatever the renderer returned, which is null on
  // every failure path: nothing that is not a string may get a free pass
  assert.equal(svgPartSafe(null), false);
  assert.equal(svgPartSafe(undefined), false);
  assert.equal(svgPartSafe(''), false);
});

// ---------------------------------------------------------------------------
// Real OOXML SmartArt
//
// The most invasive post-processing pass in this directory: it does not patch
// a shape, it REPLACES one, and it adds five parts per diagram. Everything
// below reopens the zip, because none of it is visible from the outside.
// ---------------------------------------------------------------------------

const SMART_SOURCE = `---
title: Diagrams
---

# Loop

<!-- layout: cycle -->

## Plan

## Build

## Ship

# Tree

<!-- layout: hierarchy -->

- Delivery
  - Engineering
  - Design
`;

/** Every `--smartart` assertion is gated: without @resvg/resvg-js there is no
 *  placeholder picture, `addSmartArt` falls back to native shapes, and the
 *  feature legitimately does not happen. Asserting it anyway would paint a
 *  platform gap as a regression. */
async function smartArtDeps(t) {
  const { rasterAvailable } = await import('../src/deck/assets.mjs');
  if (!(await rasterAvailable())) {
    t.skip('@resvg/resvg-js absent on this platform');
    return false;
  }
  return true;
}

test('smartart: the five diagram parts are written, typed and reachable', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { zip, stats } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });

  assert.equal(stats.smartArtDiagrams, 2, 'both diagrams converted');
  assert.deepEqual(stats.warnings, [], 'a clean conversion says nothing');

  const ct = await zip.file('[Content_Types].xml').async('string');
  for (const n of [1, 2]) {
    for (const part of ['data', 'layout', 'quickStyle', 'colors', 'drawing']) {
      const file = `ppt/diagrams/${part}${n}.xml`;
      assert.ok(zip.file(file), `${file} missing`);
      // an Override is not optional: the package's Default for the `xml`
      // extension would type these as generic XML and PowerPoint would drop
      // the diagram without a word
      assert.match(
        ct,
        new RegExp(`<Override PartName="/${file}" ContentType="[^"]+"/>`),
        `${file}: no content-type override`,
      );
    }
  }
});

test('smartart: the picture becomes a graphicFrame, in place and with its own id', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { zip } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });
  const xml = await slideXml(zip, 2);

  const frame = xml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/);
  assert.ok(frame, 'no graphic frame on the diagram slide');
  assert.match(
    frame[0],
    /<a:graphicData uri="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/diagram">/,
  );
  assert.match(
    frame[0],
    /<dgm:relIds[^>]*r:dm="rId\d+"[^>]*r:lo="rId\d+"[^>]*r:qs="rId\d+"[^>]*r:cs="rId\d+"/,
  );
  assert.match(frame[0], /<p:xfrm><a:off x="\d+" y="\d+"\/><a:ext cx="\d+" cy="\d+"\/><\/p:xfrm>/);
  assert.ok(
    !/<p:pic>[\s\S]*?Diagram 1[\s\S]*?<\/p:pic>/.test(xml),
    'the placeholder picture is still there beside the frame',
  );
});

test('smartart: the drawing cache is reachable exactly the way POI reads it', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { zip } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });

  for (const n of [1, 2]) {
    const data = await zip.file(`ppt/diagrams/data${n}.xml`).async('string');
    const relId = /<dsp:dataModelExt[^>]*relId="([^"]+)"/.exec(data);
    assert.ok(relId, `data${n}.xml: no dataModelExt`);
    // Apache POI substitutes `data` → `drawing` and then looks the id up in
    // the SLIDE's relations. LibreOffice does the same. Renumber the parts
    // without keeping this in step and every non-PowerPoint renderer shows a
    // blank frame while the suite stays green.
    const slideNo = n + 1;
    const rels = await zip.file(`ppt/slides/_rels/slide${slideNo}.xml.rels`).async('string');
    const target = new RegExp(
      `Id="${relId[1]}"[^>]*Target="\\.\\./diagrams/(drawing\\d+\\.xml)"`,
    ).exec(rels);
    assert.ok(target, `slide ${slideNo}: ${relId[1]} does not resolve to a drawing part`);
    assert.equal(target[1], `drawing${n}.xml`, 'the cache paired with the wrong data part');
    const drawing = await zip.file(`ppt/diagrams/drawing${n}.xml`).async('string');
    assert.match(
      drawing,
      /<dsp:sp modelId="\{[0-9A-F-]+\}">/,
      'an empty cache is a blank slide elsewhere',
    );
  }
});

test('smartart: all four diagram relationships resolve, on ids above the ones already used', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { zip } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });
  const xml = await slideXml(zip, 2);
  const rels = await zip.file('ppt/slides/_rels/slide2.xml.rels').async('string');
  const targets = new Map(
    [...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  const frame = /<dgm:relIds[^>]*\/>/.exec(xml)[0];
  for (const attr of ['r:dm', 'r:lo', 'r:qs', 'r:cs']) {
    const id = new RegExp(`${attr}="([^"]+)"`).exec(frame)[1];
    assert.ok(targets.has(id), `${attr} → ${id} resolves to nothing`);
    assert.match(targets.get(id), /^\.\.\/diagrams\//, `${attr} points outside ppt/diagrams`);
  }
});

test('smartart: converting twice changes nothing, and says nothing', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { out, zip } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });
  const before = fs.readFileSync(out);

  // the names read back OUT of the document, so this stays a test of the
  // per-diagram guard rather than of the shape-label table
  const again = new Map();
  for (const n of [2, 3]) {
    const frame = (await slideXml(zip, n)).match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/);
    const name = /<p:cNvPr\b[^>]*\sname="([^"]*)"/.exec(frame[0])[1];
    again.set(n, [
      { name, payload: { family: 'cycle', block: { family: 'cycle', nodes: [] }, geometry: null } },
    ]);
  }
  const { embedSmartArt } = await import('../src/pptx/smartart.mjs');
  const r = await embedSmartArt(out, again);
  assert.equal(r.count, 0, 'a second pass must convert nothing');
  assert.deepEqual(r.warnings, [], 'an already-converted diagram is done, not broken');
  assert.ok(before.equals(fs.readFileSync(out)), 'a no-op pass rewrote the file');
});

test('smartart: a shape it cannot find keeps its picture, and the give-up is said out loud', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { out } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });
  const { embedSmartArt } = await import('../src/pptx/smartart.mjs');
  const r = await embedSmartArt(
    out,
    new Map([
      [2, [{ name: 'No such shape', payload: { family: 'cycle', block: {}, geometry: null } }]],
    ]),
  );
  assert.equal(r.count, 0);
  assert.match(r.warnings.join('\n'), /not found — it stays a picture/);
  // and the file is still a file
  await JSZip.loadAsync(fs.readFileSync(out));
});

test('smartart: a builder that throws costs a diagram, never the export', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { out, zip } = await compilePptx(t, SMART_SOURCE);
  const pic = (await slideXml(zip, 2)).match(/<p:pic>[\s\S]*?<\/p:pic>/);
  const name = pic ? /<p:cNvPr\b[^>]*\sname="([^"]*)"/.exec(pic[0])[1] : 'Diagram 1';
  const { embedSmartArt } = await import('../src/pptx/smartart.mjs');
  // no geometry: buildDiagramParts refuses, which must be a warning and a
  // surviving picture rather than a rejected promise
  const r = await embedSmartArt(
    out,
    new Map([[2, [{ name, payload: { family: 'cycle', block: { nodes: [] }, geometry: null } }]]]),
  );
  assert.equal(r.count, 0);
  await JSZip.loadAsync(fs.readFileSync(out));
});

test('smartart: no [Content_Types].xml is a warning, not a crash', async (t) => {
  if (!(await smartArtDeps(t))) return;
  const { out } = await compilePptx(t, SMART_SOURCE);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  zip.remove('[Content_Types].xml');
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
  const { embedSmartArt } = await import('../src/pptx/smartart.mjs');
  const r = await embedSmartArt(
    out,
    new Map([
      [2, [{ name: 'Diagram 1', payload: { family: 'cycle', block: {}, geometry: null } }]],
    ]),
  );
  assert.equal(r.count, 0);
  assert.match(r.warnings.join('\n'), /\[Content_Types\]\.xml missing/);
});

test('smartart: without the flag, a diagram is native shapes and no diagram part is written', async (t) => {
  const { zip, stats } = await compilePptx(t, SMART_SOURCE);
  assert.equal(stats.smartArtDiagrams, 0);
  assert.deepEqual(
    Object.keys(zip.files).filter((n) => n.startsWith('ppt/diagrams/')),
    [],
    'the default export must carry no diagram part at all',
  );
  const xml = await slideXml(zip, 2);
  assert.doesNotMatch(xml, /<p:graphicFrame>/);
  // discs and arrows, as real editable PowerPoint shapes
  assert.match(xml, /<a:prstGeom prst="ellipse">/);
  assert.match(xml, /<a:prstGeom prst="rightArrow">/);
  // the arrows are placed by ROTATION, which is the half of the geometry the
  // boxes alone cannot express
  assert.match(xml, /<a:xfrm rot="-?\d+">/);
});

// ---------------------------------------------------------------------------
// Native OMML equations
// ---------------------------------------------------------------------------

/** The hermetic fixture already carries an equation, and the whole point of
 *  reusing it is that this feature is asserted on the SAME deck every other
 *  end-to-end guarantee is asserted on. */
const EQUATION_SOURCE = readAllBlocks();

/** An equation needs MathJax to exist at all and a rasterizer to become a
 *  picture — and there is no shape to convert until it is one. */
async function equationDeps(t) {
  const { rasterAvailable, mathSvg } = await import('../src/deck/assets.mjs');
  if (!(await rasterAvailable())) {
    t.skip('@resvg/resvg-js absent on this platform');
    return false;
  }
  if (!(await mathSvg('x'))) {
    t.skip('mathjax-full absent on this machine');
    return false;
  }
  return true;
}

/** The slide of the fixture that holds the equation, found rather than
 *  hard-coded: the fixture grows, and an ordinal would rot silently. */
async function equationSlide(zip) {
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (!m) continue;
    const xml = await zip.file(name).async('string');
    if (xml.includes('<a14:m>')) return { n: Number(m[1]), xml };
  }
  return null;
}

// THE FORMAT, and the reason it is this one. PowerPoint writes BOTH halves of
// an equation every time (`.reference-pptx/tdf129372.pptx`): the OMML for
// anything that implements it, and a locked picture for everything that does
// not. The other shape a generator can take — `a14:m` bare inside `<a:p>`, as
// in `.reference-pptx/linear_perm_slides.pptx` — is editable in PowerPoint and
// INVISIBLE in LibreOffice. Asserting the pair is asserting we did not take it.
test('pptx: an equation ships as mc:AlternateContent — OMML for PowerPoint, the picture for everyone else', async (t) => {
  if (!(await equationDeps(t))) return;
  const { zip, stats } = await compilePptx(t, EQUATION_SOURCE);

  assert.equal(stats.nativeEquations, 1, 'the fixture holds exactly one equation');
  assert.equal(stats.equationsConverted, stats.equationsDrawn, 'none of them degraded');

  const found = await equationSlide(zip);
  assert.ok(found, 'no slide carries a native equation');
  const { xml } = found;

  const alt = /<mc:AlternateContent\b[^>]*>[\s\S]*?<\/mc:AlternateContent>/.exec(xml)?.[0];
  assert.ok(alt, 'the a14:m is not wrapped in mc:AlternateContent — that is the negative example');
  assert.match(alt, /<mc:Choice\b[^>]*\sRequires="a14"/, 'no Choice, or one nobody keys off');
  assert.match(alt, /xmlns:a14="http:\/\/schemas\.microsoft\.com\/office\/drawing\/2010\/main"/);
  assert.match(alt, /<mc:Fallback>/, 'a Choice with no Fallback is invisible without OMML');

  // the editable half
  const choice = /<mc:Choice\b[^>]*>([\s\S]*)<\/mc:Choice>/.exec(alt)[1];
  assert.match(choice, /<a14:m><m:oMathPara xmlns:m="[^"]*\/2006\/math">/);
  assert.match(choice, /<m:oMath>/);
  assert.match(choice, /<a:latin typeface="Cambria Math"/, 'the font PowerPoint sets equations in');

  // the half everything else draws, and the locks that stop a reader typing
  // into what is really a picture
  const fallback = /<mc:Fallback>([\s\S]*)<\/mc:Fallback>/.exec(alt)[1];
  assert.match(fallback, /<a:spLocks\b[^>]*\snoTextEdit="1"/);
  assert.match(fallback, /<a:spLocks\b[^>]*\snoRot="1"/);
  assert.match(fallback, /<a:spLocks\b[^>]*\snoChangeAspect="1"/);
  assert.match(fallback, /<a:blipFill\b/, 'a p:blipFill inside p:spPr is a repair dialog');
  assert.ok(
    !/<p:blipFill\b/.test(fallback),
    'the picture fill was not moved to its DrawingML form',
  );

  // the r:embed has to resolve to a real image — a dangling one draws the
  // broken-picture icon for exactly the readers this fallback exists for
  const rels = await slideRels(zip, found.n);
  const embed = /<a:blip\b[^>]*\sr:embed="([^"]+)"/.exec(fallback)[1];
  const target = rels.get(embed);
  assert.match(target ?? '', /^ppt\/media\/.*\.png$/, `r:embed ${embed} → ${target}`);
  assert.ok((await zip.file(target).async('nodebuffer')).length > 100, `${target}: empty`);

  // both branches keep the picture's identity, exactly as the reference does:
  // an animation or a comment addressing it by id still resolves
  const ids = [...alt.matchAll(/<p:cNvPr\s+id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1], 'the two branches are one shape, not two');

  // and the picture is gone from the tree — one equation, not one plus a
  // duplicate sitting behind it
  assert.equal((xml.match(/<a14:m>/g) ?? []).length, 1);
});

test('embedEquations: a second pass over the same file changes nothing', async (t) => {
  if (!(await equationDeps(t))) return;
  const { out, zip } = await compilePptx(t, EQUATION_SOURCE);
  const before = fs.readFileSync(out);
  const found = await equationSlide(zip);
  // the name the renderer really gave that shape, read back OUT of the
  // AlternateContent rather than assumed — this stays a test of the guard
  const alt = /<mc:AlternateContent\b[^>]*>[\s\S]*?<\/mc:AlternateContent>/.exec(found.xml)[0];
  const name = /<p:cNvPr\s+id="\d+"\s+name="([^"]*)"/.exec(alt)[1];

  const { embedEquations } = await import('../src/pptx/equations.mjs');
  const r = await embedEquations(
    out,
    new Map([[found.n, [{ name, omml: '<m:oMathPara xmlns:m="urn:x"/>' }]]]),
  );
  assert.equal(r.count, 0, 'a converted equation must not be converted twice');
  assert.deepEqual(r.warnings, [], 'and that is not a failure either');
  assert.ok(before.equals(fs.readFileSync(out)), 'a no-op pass rewrote the file');
});

test('embedEquations: a shape it cannot find stays a picture, and says so', async (t) => {
  if (!(await equationDeps(t))) return;
  const { out } = await compilePptx(t, EQUATION_SOURCE);
  const { embedEquations } = await import('../src/pptx/equations.mjs');
  const r = await embedEquations(
    out,
    new Map([[2, [{ name: 'Nothing 99', omml: '<m:oMathPara xmlns:m="urn:x"/>' }]]]),
  );
  assert.equal(r.count, 0);
  assert.match(r.warnings.join('\n'), /Nothing 99.*not found.*stays a picture/);
  // and the package is still openable, which is the contract every one of
  // these passes keeps
  await JSZip.loadAsync(fs.readFileSync(out));
});

// The refusal is not a hypothetical: it is the behaviour that keeps the
// promise "exact or it does not happen", and it has to survive the whole
// pipeline, not just the converter's unit test.
test('pptx: an equation the converter refuses stays a picture, and the deck says how many', async (t) => {
  if (!(await equationDeps(t))) return;
  const source = '---\ntitle: Maths\n---\n\n# Cancel\n\n$$\\cancel{x} + 1$$\n';
  const { zip, stats } = await compilePptx(t, source);
  assert.equal(stats.equationsDrawn, 1);
  assert.equal(stats.equationsConverted, 0, '\\cancel is menclose, which has no OMML');
  assert.equal(stats.nativeEquations, 0);
  const xml = await slideXml(zip, 2);
  assert.doesNotMatch(xml, /<a14:m>/);
  assert.match(xml, /<p:pic>/, 'the picture that was already correct is still there');
});

/**
 * The zip our writer leaves behind should look like one PowerPoint wrote, and
 * `docs/reference-pptx.md` measured the last place it did not: Office packages
 * carry no directory entries, ours carried one per folder JSZip materialised.
 *
 * Asserting the PART COUNT beside it is the point of the test. Dropping those
 * entries means deleting keys out of JSZip's `files` map, and the neighbouring
 * mistake — `zip.remove()` on a folder — takes the folder's whole subtree with
 * it. A package with no directory entries and no slides would satisfy the
 * first assertion alone.
 */
test('pptx: the package carries no zip directory entries, and loses no part to the tidy', async (t) => {
  const { zip } = await compilePptx(t, SOURCE);
  const names = Object.keys(zip.files);
  const dirs = names.filter((n) => zip.files[n].dir);
  assert.deepEqual(dirs, [], 'Office packages carry none, and neither should ours');
  assert.ok(zip.file('[Content_Types].xml'), 'the package still opens as OPC');
  assert.ok(
    names.filter((n) => n.startsWith('ppt/slides/slide')).length >= 2,
    'the slides survived the pass that removed the folders',
  );
  assert.ok(await zip.file('ppt/presentation.xml').async('string'));
});

/**
 * With no rasterizer there is no stand-in picture, so `--smartart` asks for
 * something that cannot happen. Two things have to be true at once, and the
 * second is why the first is safe:
 *
 *   - RASTER_UNAVAILABLE must not count the diagram. That message says the
 *     blocks were replaced by their specification in TEXT, which never happens
 *     to a diagram — it falls through to `drawSmartArtShapes` and is drawn.
 *   - the diagram's own case must still be said, or removing it from the count
 *     would trade a wrong number for silence.
 */
test('smartart without a rasterizer: drawn, said, and not counted as a raster block', async (t) => {
  const previous = process.env.LUTRIN_NO_RASTER;
  process.env.LUTRIN_NO_RASTER = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.LUTRIN_NO_RASTER;
    else process.env.LUTRIN_NO_RASTER = previous;
  });

  const { zip, stats } = await compilePptx(t, SMART_SOURCE, { opts: { smartart: true } });
  assert.equal(stats.smartArtDiagrams, 0, 'no picture to swap, so no diagram part');

  const raster = stats.diagnostics.find((d) => d.code === 'RASTER_UNAVAILABLE');
  assert.equal(
    raster,
    undefined,
    'a deck of diagrams alone must not raise the text-fallback error',
  );

  const said = stats.diagnostics.find((d) => d.code === 'SMARTART_UNAVAILABLE');
  assert.ok(
    said,
    `expected the diagram's own diagnostic, got: ${JSON.stringify(stats.diagnostics)}`,
  );
  assert.match(said.message, /2 diagram\(s\)/);
  assert.ok(stats.warnings.includes(said.message), 'the diagnostic must reach the user');

  // and the slide is complete: the diagram is DRAWN, which is what makes the
  // warning a warning rather than an error
  const xml = await slideXml(zip, 2);
  assert.doesNotMatch(xml, /<p:graphicFrame>/);
  assert.match(xml, /<a:prstGeom prst="ellipse">/, 'the discs are there all the same');
});

/**
 * The fourth check, and the only one that is not about well-formedness: an SVG
 * whose appearance depends on an internal stylesheet is refused, because the
 * reader that skips those rules does not degrade — it draws something else.
 *
 * Mermaid is the whole reason. It puts no `fill` on the rect and sets it from
 * `#lutrin-diagram .node rect{…}`, so a reader that ignores the rules paints
 * every node with the SVG default, BLACK. Measured in LibreOffice Impress on
 * our own demo, where the PNG beside it is correct — and NOT reproducible in
 * resvg or a browser, both of which apply the rules. That is exactly why this
 * cannot be judged from our own preview, and why it is a test.
 */
test('svgPartSafe: an internal stylesheet is refused — the twin must agree with its raster', () => {
  const styled = `<svg xmlns="http://www.w3.org/2000/svg" id="d" width="100%" viewBox="0 0 100 50">
<style>#d .node rect{fill:#eaf2fd;stroke:#2563eb;}</style>
<g class="node"><rect class="background" width="80" height="30"/></g>
</svg>`;
  assert.equal(svgPartSafe(styled), false, 'CSS-driven fills never become a vector twin');

  // the same picture with the fill ON the element is fine: it is the dependency
  // on a CSS engine that is refused, not the shape
  const inlined = `<svg xmlns="http://www.w3.org/2000/svg" width="100" viewBox="0 0 100 50">
<g class="node"><rect width="80" height="30" fill="#eaf2fd" stroke="#2563eb"/></g>
</svg>`;
  assert.equal(svgPartSafe(inlined), true, 'presentation attributes are what ours already use');

  // and the SVGs we author must not be caught by it
  assert.equal(svgPartSafe(LUCIDE_COFFEE), true, 'a Lucide icon carries no stylesheet');
});

// ---------------------------------------------------------------------------
// renderDeckBytes — the same export, for a host with no disk
// ---------------------------------------------------------------------------

/**
 * The playground exports a .pptx from the browser, and it does it with THIS
 * renderer: `renderDeckBytes` is the entry point that hands the finished
 * package back instead of leaving it on disk (site/assets/js/playground.js).
 *
 * What the test pins is that it is the same package. A second code path that
 * merely looked similar is the one that would quietly stop getting the
 * post-processing passes this one gets — so the bytes are compared part by
 * part against `renderDeck`'s file, everything but the timestamp PptxGenJS
 * stamps into docProps/core.xml.
 */
test('renderDeckBytes returns exactly the package renderDeck writes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-bytes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const deck = parseDeck(SOURCE);
  const scenes = buildScenes(deck);

  const out = path.join(dir, 'file.pptx');
  const fileStats = await renderDeck(scenes, deck.meta, dir, out);
  const { bytes, stats } = await renderDeckBytes(scenes, deck.meta, dir);

  assert.ok(bytes?.length > 0, 'bytes came back empty');
  assert.equal(stats.slideCount, fileStats.slideCount);

  const [a, b] = await Promise.all([JSZip.loadAsync(fs.readFileSync(out)), JSZip.loadAsync(bytes)]);
  assert.deepEqual(
    Object.keys(b.files).sort(),
    Object.keys(a.files).sort(),
    'the two packages do not hold the same parts',
  );
  for (const name of Object.keys(a.files)) {
    if (a.files[name].dir) continue;
    // the only part that legitimately differs: dcterms:created/modified, which
    // PptxGenJS stamps with the clock
    if (name === 'docProps/core.xml') continue;
    const [x, y] = await Promise.all([
      a.file(name).async('nodebuffer'),
      b.file(name).async('nodebuffer'),
    ]);
    assert.ok(x.equals(y), `${name} differs between the file and the bytes`);
  }
});

/** And it leaves nothing behind: a host that exports twice must not accumulate
 *  a temporary directory per export. */
test('renderDeckBytes leaves no temporary directory behind', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('lutrin-out-')).length;
  const deck = parseDeck('# One slide\n\nSome text.\n');
  await renderDeckBytes(buildScenes(deck), deck.meta, os.tmpdir());
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('lutrin-out-')).length;
  assert.equal(after, before);
});
