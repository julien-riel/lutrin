/**
 * PPTX end to end: compile a deck with known content, reopen the zip and
 * check what the post-processing steps promise — animations differentiated
 * by block type, Morph transition on the "(cont.)" slides, embedded fonts.
 * This is the only safety net over the regex OOXML injections (anim, morph, fonts).
 *
 * Added to it is what an export must NEVER do, and what no diff review
 * catches because you have to reopen the zip to see it:
 *   - falling over while running (a bullet whose only content is an image, an
 *     icon name that contains a slash);
 *   - carrying the author's LOCAL PATH inside a file that gets passed around;
 *   - embedding a font whose vendor forbids embedding.
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
import { renderDeck } from '../src/pptx/render.mjs';
import { embedFonts, readFsType } from '../src/pptx/fonts.mjs';
import { FONT_FILES, PAGE, SPACE, px } from '../src/deck/tokens.mjs';

/** A valid 2×2 PNG: enough for imageDims() to read a ratio and for
 *  PptxGenJS to embed a real media part. */
const PNG_2PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
  'base64',
);

/** Compile a source in a disposable directory and return the reopened zip. */
async function compilePptx(t, source, { files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pptx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), content);
  const out = path.join(dir, 'e2e.pptx');
  const deck = parseDeck(source);
  const scenes = buildScenes(deck);
  const stats = await renderDeck(scenes, deck.meta, dir, out);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  return { dir, out, deck, scenes, stats, zip };
}

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
  // and the theme still applies to it (bold, title size, ink)
  assert.match(content, /<a:rPr lang="en-US" sz="2600" b="1"[\s\S]*?First slide/);
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
