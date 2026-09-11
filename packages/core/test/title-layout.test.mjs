/**
 * `titleLayout:` and `titleImage:` — the frontmatter that gives the cover a
 * composition other than the one it has always had.
 *
 * The cover generated from `title:` is the ONE slide no `<!-- layout: -->` can
 * reach: there is no line in the source to hang the comment on. That is why
 * these two live in the frontmatter, beside `notes:`, which exists for exactly
 * the same reason.
 *
 * What this file pins, in order of what would hurt most if it broke:
 *
 *   1. THE DEFAULT DOES NOT MOVE. A deck naming no title layout must produce
 *      the scene it produced before this existed, field for field, and markup
 *      carrying no inline geometry at all. `golden.test.mjs` guards the scene;
 *      the assertions here guard the two renderings, which it does not see.
 *   2. THE TWO RENDERERS AGREE. The geometry is one function in tokens.mjs
 *      precisely so a cover cannot be split in the HTML and whole in the
 *      .pptx, and the two outputs are compared against the same numbers rather
 *      than against each other's habits.
 *   3. THE TITLE BOX IS HONOURED IN POWERPOINT. It is the one placement that
 *      cannot be done from the slide: PptxGenJS lets a MASTER's placeholder
 *      options override the caller's, so a narrowed title needs a master of
 *      its own or it silently comes out full width. That failure is invisible
 *      in every intermediate structure and shows up only in the package.
 *   4. THE LENIENT READINGS ARE THE ONES WE CHOSE. An unusable pair falls back
 *      to the plain cover and says so, rather than refusing to compile.
 */
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {
  CHROME,
  CHROME_FRACTIONS,
  PAGE,
  coverBoxes,
  coverImageOpacity,
  roundRectAdj,
  TITLE_LAYOUTS,
} from '../src/deck/tokens.mjs';
import { applyTheme as setTheme, resolveTheme } from '../src/deck/theme.mjs';
import { applyTheme } from '../src/deck/theme.mjs';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';
import { compileHtml } from '../src/html/render.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { renderDeck } from '../src/pptx/render.mjs';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function tmpDeckDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-title-'));
  fs.writeFileSync(path.join(dir, 'photo.png'), PNG_1PX);
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

const deckSource = (front) =>
  `---\ntitle: Plan\nsubtitle: Comité\nauthor: J\n${front}---\n\n# Une diapo\n\nDu texte.\n`;

const scenesOf = (front, dir) => {
  const deck = parseDeck(deckSource(front));
  prepareDeckContext(deck.meta, { baseDir: dir });
  return buildScenes(deck);
};

const EMU = 914400;
const toPx = (emu) => Math.round((Number(emu) / EMU) * 96);

/** Geometry of the title PLACEHOLDER on slide 1 of a written package. */
async function titleBoxOf(zip) {
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const m = /<p:ph type="title"\/>[\s\S]{0,400}?<a:off x="(\d+)"[^/]*\/><a:ext cx="(\d+)"/.exec(
    xml,
  );
  assert.ok(m, 'slide 1 carries no title placeholder');
  return { x: toPx(m[1]), w: toPx(m[2]) };
}

async function pptxOf(t, front, dir) {
  const deck = parseDeck(deckSource(front));
  prepareDeckContext(deck.meta, { baseDir: dir });
  const out = path.join(dir, `${Math.random().toString(36).slice(2)}.pptx`);
  await renderDeck(buildScenes(deck), deck.meta, dir, out);
  return JSZip.loadAsync(fs.readFileSync(out));
}

// ---------------------------------------------------------------------------
// 1. the default does not move
// ---------------------------------------------------------------------------

test('a deck naming no title layout stamps no key and no geometry', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const cover = scenesOf('', dir)[0];
  assert.equal(cover.master, 'cover');
  // the ABSENCE is the assertion: an extra field here is a change to the IR
  // every host and every golden file reads
  assert.ok(!('titleLayout' in cover), 'the plain cover must set no titleLayout');
  assert.ok(!('image' in cover), 'the plain cover must set no image');

  const { html } = await compileHtml(deckSource(''), { baseDir: dir });
  const head = html.slice(html.indexOf('master-cover'));
  // the boxes keep the geometry their CSS class carries — no inline override
  assert.match(head, /class="cover-title">/, 'the title gained an inline style');
  assert.match(head, /class="cover-bar"><\/div>/, 'the accent bar gained an inline style');
  assert.ok(!head.includes('cover-scrim"></div>'), 'a plain cover draws no scrim');
});

test('coverBoxes: the default is the full width and no image', () => {
  const box = coverBoxes();
  assert.deepEqual(box, {
    x: PAGE.margin,
    w: PAGE.width - 2 * PAGE.margin,
    image: null,
    scrim: false,
  });
  // an unknown value is not an error here — the validator is what names it,
  // and the renderers must still draw something
  assert.deepEqual(coverBoxes('image-rigth'), box);
});

// ---------------------------------------------------------------------------
// 2. the two renderers agree
// ---------------------------------------------------------------------------

for (const variant of ['image-right', 'image-left']) {
  test(`${variant}: the HTML and the .pptx place the same column`, async (t) => {
    freshStateAfter(t);
    const dir = tmpDeckDir(t);
    const box = coverBoxes(variant);
    // the two halves really are halves, and the text is not on the photo
    assert.equal(box.image.w + box.w + 2 * PAGE.margin, PAGE.width);
    assert.equal(box.scrim, false);

    const front = `titleLayout: ${variant}\ntitleImage: photo.png\n`;
    const { html } = await compileHtml(deckSource(front), { baseDir: dir });
    const head = html.slice(html.indexOf('master-cover'));
    for (const cls of ['cover-title', 'cover-subtitle', 'cover-byline'])
      assert.ok(
        head.includes(`class="${cls}" style="left:${box.x}px;width:${box.w}px"`),
        `${cls} is not on the column coverBoxes named`,
      );

    const zip = await pptxOf(t, front, dir);
    assert.deepEqual(await titleBoxOf(zip), { x: box.x, w: box.w });
  });
}

test('image-full: the photo is full-bleed, under a scrim, and the text keeps the full width', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const box = coverBoxes('image-full');
  // `radius` rides along with every image rect now; at the default inset of 0
  // the photograph is still the whole page
  assert.deepEqual(box.image, { x: 0, y: 0, w: PAGE.width, h: PAGE.height, radius: 0 });
  assert.equal(box.scrim, true);
  assert.equal(box.w, PAGE.width - 2 * PAGE.margin);

  const front = 'titleLayout: image-full\ntitleImage: photo.png\n';
  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  const head = html.slice(html.indexOf('master-cover'));
  // the scrim carries the photograph's own rectangle, so it veils the picture
  // rather than the page — they part company as soon as a kit insets the image
  assert.match(head, /<div class="cover-scrim" style="[^"]*"><\/div>/, 'the HTML draws no scrim');

  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /name="Cover scrim"/, 'the .pptx draws no scrim');
  // …and it is a scrim, not an opaque wash: a fully opaque rectangle would
  // hide the photo it was added to make readable
  assert.match(xml, /name="Cover scrim"[\s\S]{0,600}?<a:alpha val="(\d+)"\/>/);
  const alpha = Number(/name="Cover scrim"[\s\S]{0,600}?<a:alpha val="(\d+)"\/>/.exec(xml)[1]);
  assert.ok(alpha > 0 && alpha < 100000, `the scrim is opaque (alpha ${alpha})`);
});

test('the photo is written BEFORE the words, in both outputs', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = 'titleLayout: image-right\ntitleImage: photo.png\n';

  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  const head = html.slice(html.indexOf('master-cover'));
  assert.ok(
    head.indexOf('<img') < head.indexOf('class="cover-title"'),
    'the HTML paints the photo over the title',
  );

  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(
    xml.indexOf('<p:pic>') < xml.indexOf('<p:ph type="title"/>'),
    'the .pptx paints the photo over the title',
  );
});

// ---------------------------------------------------------------------------
// 3. the master, which is the placement that cannot be done from the slide
// ---------------------------------------------------------------------------

test('a deck using no split cover carries no extra master', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const plain = await pptxOf(t, '', dir);
  const full = await pptxOf(t, 'titleLayout: image-full\ntitleImage: photo.png\n', dir);
  const layouts = (zip) => zip.file(/ppt\/slideLayouts\/slideLayout\d+\.xml$/).length;
  // `image-full` keeps the full-width title, so it keeps the ordinary master:
  // an unused master still ships as a part, and this is what stops one being
  // added to every deck for a layout only some of them use
  assert.equal(layouts(full), layouts(plain), 'image-full grew a master it does not need');

  const split = await pptxOf(t, 'titleLayout: image-left\ntitleImage: photo.png\n', dir);
  assert.equal(layouts(split), layouts(plain) + 1, 'the split cover master was not declared');
});

// ---------------------------------------------------------------------------
// 4. the lenient readings, and the diagnostics that name them
// ---------------------------------------------------------------------------

test('an image with no layout reads as image-right', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const cover = scenesOf('titleImage: photo.png\n', dir)[0];
  assert.equal(cover.titleLayout, 'image-right');
  assert.equal(cover.image.src, 'photo.png');
});

test('a layout with no image falls back to the plain cover, and says so', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const cover = scenesOf('titleLayout: image-left\n', dir)[0];
  assert.ok(!('titleLayout' in cover), 'an unusable pair must leave the plain cover alone');

  const diags = validateDeck(deckSource('titleLayout: image-left\n'), { baseDir: dir });
  const d = diags.find((x) => x.code === 'TITLE_IMAGE_MISSING');
  assert.ok(d, `TITLE_IMAGE_MISSING expected — seen: ${diags.map((x) => x.code).join(', ')}`);
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 5, 'the diagnostic must land on the `titleLayout:` line');
});

test('an unknown layout name is named, with the near miss suggested', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const diags = validateDeck(deckSource('titleLayout: image-rigth\ntitleImage: photo.png\n'), {
    baseDir: dir,
  });
  const d = diags.find((x) => x.code === 'TITLE_LAYOUT_UNKNOWN');
  assert.ok(d, 'TITLE_LAYOUT_UNKNOWN expected');
  assert.equal(d.suggestion, 'image-right');
  // the message must not repeat the suggestion the CLI already appends
  assert.ok(!d.message.includes('did you mean'), 'the suggestion is said twice');
});

test('an image the plain cover will not place is reported, not dropped in silence', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const diags = validateDeck(deckSource('titleLayout: default\ntitleImage: photo.png\n'), {
    baseDir: dir,
  });
  const d = diags.find((x) => x.code === 'TITLE_IMAGE_UNUSED');
  assert.ok(d, 'TITLE_IMAGE_UNUSED expected');
  assert.equal(d.line, 6, 'the diagnostic must land on the `titleImage:` line');
});

test('the cover image is held to the same rules as an image written in the body', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const missing = validateDeck(deckSource('titleImage: absent.png\n'), { baseDir: dir });
  assert.ok(
    missing.some((d) => d.code === 'MISSING_IMAGE' && d.line === 5),
    'a cover image that is not there must warn like any other',
  );
  const escaping = validateDeck(deckSource('titleImage: ../../outside.png\n'), { baseDir: dir });
  const esc = escaping.find((d) => d.code === 'IMAGE_PATH_ESCAPE');
  assert.ok(esc, 'a cover image climbing out of the deck directory must be refused');
  assert.equal(esc.severity, 'error');
});

// ---------------------------------------------------------------------------
// 5. what a KIT can settle, and what it is told when it settles it badly
// ---------------------------------------------------------------------------

/** A kit whose theme.json carries `chrome.cover` overrides and nothing else. */
function tmpCoverKit(t, cover) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-cover-kit-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const kit = path.join(base, 'cover-kit');
  fs.mkdirSync(kit, { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name: 'cover-kit' }));
  fs.writeFileSync(path.join(kit, 'theme.json'), JSON.stringify({ chrome: { cover } }));
  return kit;
}

/**
 * A `kit:` line naming a kit that carries these `chrome.cover` overrides.
 *
 * It goes in the DECK rather than through `applyTheme`: `compileHtml` resolves
 * the theme from the frontmatter it is handed, so a theme applied beside it is
 * replaced before the first slide is laid out — which is a test that passes on
 * the default and proves nothing.
 */
const coverKitLine = (t, cover) => `kit: ${tmpCoverKit(t, cover)}\n`;

/** The same kit, applied directly — for the diagnostics it raises on the way. */
function coverKitDiagnostics(t, dir, cover) {
  const { theme, diagnostics } = resolveTheme({ kit: tmpCoverKit(t, cover) }, { baseDir: dir });
  setTheme(theme);
  t.after(() => setTheme(null));
  return diagnostics;
}

test('a kit settles the split ratio, and the two renderers both move', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = `titleLayout: image-right\ntitleImage: photo.png\n${coverKitLine(t, { splitRatio: 0.35 })}`;

  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  // read AFTER compiling: the kit's theme is live only once the deck applied it
  const box = coverBoxes('image-right');
  assert.equal(box.image.w, Math.round(PAGE.width * 0.35), 'the kit ratio was not applied');
  // the text column takes what the photograph left, and the two still add up
  assert.equal(box.image.w + box.w + 2 * PAGE.margin, PAGE.width);
  assert.ok(
    html.includes(`class="cover-title" style="left:${box.x}px;width:${box.w}px"`),
    'the HTML did not follow the kit',
  );
  assert.deepEqual(await titleBoxOf(await pptxOf(t, front, dir)), { x: box.x, w: box.w });
});

test('a kit fades the photograph, in the .pptx as in the HTML', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = `titleLayout: image-right\ntitleImage: photo.png\n${coverKitLine(t, { imageOpacity: 0.35 })}`;

  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  assert.equal(coverImageOpacity(), 0.35, 'the kit opacity was not applied');
  assert.match(html, /class="el img-cover" style="[^"]*opacity:0\.35;"/);

  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  // PowerPoint honours a picture's opacity as alphaModFix, in thousandths
  assert.match(xml, /<a:alphaModFix amt="35000"\/>/);
});

test('an opaque photograph writes no opacity at all, in either output', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = 'titleLayout: image-right\ntitleImage: photo.png\n';
  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  // the ABSENCE is the assertion: `transparency: 0` and no key produce the same
  // slide, and the absent key is what keeps a package the bytes it already was.
  // Scoped to the <img> — the stylesheet carries an `opacity:` of its own for
  // the scrims, and a bare substring search would pass on nothing.
  const img = /<img class="el img-cover" style="([^"]*)"/.exec(html);
  assert.ok(img, 'the cover carries no image at all');
  assert.ok(!img[1].includes('opacity'), `the HTML emitted a needless opacity: ${img[1]}`);
  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(!xml.includes('alphaModFix'), 'the .pptx emitted a needless alphaModFix');
});

test('a fraction written as a percentage is named, not silently clamped', (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const diags = coverKitDiagnostics(t, dir, { imageOpacity: 40, scrimAlpha: 5 });
  const bad = diags.filter((d) => d.code === 'THEME_BAD_VALUE');
  assert.equal(bad.length, 2, `expected two — seen: ${diags.map((d) => d.code).join(', ')}`);
  for (const d of bad) assert.match(d.message, /fraction of 1, never a percentage/);
  // …and the token kept its default rather than the nonsense
  assert.equal(coverImageOpacity(), 1);
});

test('every fraction band contains the default it governs', () => {
  // a band that excluded its own default would make the shipped theme invalid
  const defaults = {
    'chrome.cover.scrimAlpha': CHROME.cover.scrimAlpha,
    'chrome.cover.imageOpacity': CHROME.cover.imageOpacity,
    'chrome.cover.splitRatio': CHROME.cover.splitRatio,
    'chrome.section.scrimAlpha': CHROME.section.scrimAlpha,
  };
  for (const [path, [min, max]] of CHROME_FRACTIONS) {
    const value = defaults[path];
    assert.equal(typeof value, 'number', `${path} is in the band table but is no token`);
    assert.ok(value >= min && value <= max, `${path} default ${value} is outside [${min}, ${max}]`);
  }
});

test('a kit insets the photograph, and both outputs pull it off the edges', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = `titleLayout: image-right\ntitleImage: photo.png\n${coverKitLine(t, { imageInset: 40 })}`;

  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  const box = coverBoxes('image-right');
  // the band is unchanged; what moved is the rectangle drawn inside it
  assert.equal(box.image.y, 40, 'the photograph is still flush with the top');
  assert.equal(box.image.h, PAGE.height - 80);
  assert.equal(box.image.x + box.image.w, PAGE.width - 40, 'still flush with the right edge');

  const img = /<img class="el img-cover" style="([^"]*)"/.exec(html);
  assert.ok(img[1].includes(`left:${box.image.x}px`), `the HTML did not inset: ${img[1]}`);

  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const pic = (xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []).find((p) =>
    p.includes('name="Cover image"'),
  );
  assert.ok(pic, 'the cover photograph is not named — the rounding pass cannot find it either');
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(pic);
  const inches = (v) => Math.round((Number(v) / 914400) * 96);
  assert.deepEqual(
    [1, 2, 3, 4].map((k) => inches(off[k])),
    [box.image.x, box.image.y, box.image.w, box.image.h],
    'the .pptx and the HTML inset differently',
  );
});

test('a kit rounds the corners, in the .pptx as in the HTML', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = `titleLayout: image-right\ntitleImage: photo.png\n${coverKitLine(t, { imageInset: 40, imageRadius: 24 })}`;

  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  const box = coverBoxes('image-right');
  assert.equal(box.image.radius, 24);
  assert.match(html, /<img class="el img-cover" style="[^"]*border-radius:24px;"/);

  // PptxGenJS gives a picture no geometry but a rectangle or an ellipse, so
  // this is the post-pass of rounded.mjs and nothing else could have written it
  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const adj = roundRectAdj(24, box.image.w, box.image.h);
  assert.ok(adj > 0 && adj <= 50000, `the adjust value is out of range: ${adj}`);
  assert.match(
    xml,
    new RegExp(
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`,
    ),
  );
  // …and the package still opens: a malformed prstGeom is the failure mode
  // this pass has to avoid, and it is invisible short of reading every part
  assert.equal(zip.file(/.*/).length > 20, true);
});

test('roundRectAdj speaks OOXML units, and refuses to overflow them', () => {
  // adj is 1/100000 of HALF the shorter side, capped where the short ends
  // become semicircles. A radius of a quarter of the shorter side is therefore
  // half of the cap.
  assert.equal(roundRectAdj(100, 400, 800), 25000);
  assert.equal(roundRectAdj(200, 400, 800), 50000);
  assert.equal(roundRectAdj(9999, 400, 800), 50000, 'an absurd radius must clamp, not overflow');
  assert.equal(roundRectAdj(0, 400, 800), 0);
  assert.equal(roundRectAdj(24, 0, 0), 0, 'a degenerate rectangle has no corner to round');
});

test('an unrounded, uninset photograph writes neither, in either output', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = 'titleLayout: image-right\ntitleImage: photo.png\n';
  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  const img = /<img class="el img-cover" style="([^"]*)"/.exec(html);
  assert.ok(!img[1].includes('border-radius'), `a needless border-radius: ${img[1]}`);

  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(!xml.includes('roundRect'), 'the rounding pass ran on a square-cornered cover');
});

test('the scrim veils the photograph, not the page', async (t) => {
  freshStateAfter(t);
  const dir = tmpDeckDir(t);
  const front = `titleLayout: image-full\ntitleImage: photo.png\n${coverKitLine(t, { imageInset: 60 })}`;

  const { html } = await compileHtml(deckSource(front), { baseDir: dir });
  const box = coverBoxes('image-full');
  assert.equal(box.image.x, 60, 'the photograph was not inset');
  // a full-page veil would wash the margin around the panel as well, which is
  // the whole slide going pale for a picture that no longer fills it
  assert.match(
    html,
    new RegExp(`<div class="cover-scrim" style="left:${box.image.x}px;top:${box.image.y}px;`),
  );

  const zip = await pptxOf(t, front, dir);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const scrim = /name="Cover scrim"[\s\S]{0,600}?<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(xml);
  assert.ok(scrim, 'the .pptx draws no scrim');
  assert.equal(Math.round((Number(scrim[1]) / 914400) * 96), box.image.x);
});

// ---------------------------------------------------------------------------
// 6. what an agent reading capabilities() is told
// ---------------------------------------------------------------------------

test('capabilities publishes the keys, the values and the diagnostics', () => {
  const caps = capabilities();
  assert.deepEqual(caps.titleLayouts, [...TITLE_LAYOUTS]);
  for (const key of ['titleLayout', 'titleImage'])
    assert.ok(caps.frontmatter.includes(key), `${key} is not published as a frontmatter key`);
  for (const code of ['TITLE_LAYOUT_UNKNOWN', 'TITLE_IMAGE_MISSING', 'TITLE_IMAGE_UNUSED'])
    assert.ok(caps.diagnostics.includes(code), `${code} is not published`);
});
