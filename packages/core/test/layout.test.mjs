/**
 * Layout engine: golden of the scenes on the demo deck, purity of
 * buildScenes (the IR must never be mutated — pagination used to split
 * lists by emptying the array of the original block), and the four
 * placement guarantees the review wrested from the engine: no content lost
 * by an accident of authoring (column lead), no scene that crashes a
 * renderer (quote with no block), no shade index outside the palette
 * (layers), no region below the content area (metrics).
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes, blockHeight, registerLayout, resetUserLayouts } from '../src/deck/layout.mjs';
import { COLORS, LAYER_SHADES, contentArea, deriveTokens } from '../src/deck/tokens.mjs';
import { readDemo, strip, assertGolden } from './helpers.mjs';

/** Scenes of a single-slide deck written on the fly. */
const scenesFor = (source) => buildScenes(parseDeck(source));
const textOf = (block) =>
  block.runs
    ? block.runs.map((r) => r.text).join('')
    : (block.items ?? []).map((i) => i.runs.map((r) => r.text).join('')).join(' ');
const headings = (scene) =>
  scene.elements.filter((el) => el.block.type === 'heading').map((el) => textOf(el.block));

test('golden: scenes of the demo deck', () => {
  const scenes = buildScenes(parseDeck(readDemo()));
  assertGolden('demo.scenes.json', scenes);
});

test('buildScenes does not mutate the IR (paginated lists)', () => {
  const items = Array.from({ length: 40 }, (_, k) => `- item number ${k + 1}`).join('\n');
  const deck = parseDeck(`# Long list\n\n${items}\n`);
  const before = strip(deck);

  const scenes1 = buildScenes(deck);
  assert.deepEqual(strip(deck), before, 'the deck must stay intact after buildScenes');
  assert.ok(
    scenes1.some((s) => s.continued),
    'the 40-bullet list must paginate',
  );

  // a second rendering of the same deck must produce exactly the same scenes
  const scenes2 = buildScenes(deck);
  assert.deepEqual(strip(scenes2), strip(scenes1));
});

// --- continuous numbering of split ordered lists (weakness M4) --------------

/** The list chunks of a sequence of scenes, in order. */
const bulletChunks = (scenes) =>
  scenes.flatMap((s) =>
    s.elements.filter((el) => el.block.type === 'bullets').map((el) => el.block),
  );

test('numbered list split: every chunk resumes the numbering', async () => {
  const items = Array.from({ length: 40 }, (_, k) => `${k + 1}. item number ${k + 1}`).join('\n');
  const scenes = scenesFor(`# Long numbered list\n\n${items}\n`);
  const chunks = bulletChunks(scenes);

  assert.ok(chunks.length >= 3, 'the 40-item list must split into at least three chunks');
  // the first chunk starts at 1: no stray attribute
  assert.equal(chunks[0].startAt, undefined);
  // the next ones resume at the rank following the items already consumed
  let expected = 1;
  for (const m of chunks) {
    if (expected > 1) assert.equal(m.startAt, expected, `chunk expected to start at ${expected}`);
    expected += m.items.length;
  }
  // the third chunk — the one a half-done fix forgets
  assert.equal(chunks[2].startAt, chunks[0].items.length + chunks[1].items.length + 1);

  // observing the rendering: the HTML does carry `start` on chunks 2+ only
  const { renderDeckHtml } = await import('../src/html/render.mjs');
  const { html } = await renderDeckHtml(scenes, {}, process.cwd());
  const ols = html.match(/<ol[^>]*>/g);
  assert.equal(ols[0], '<ol>');
  assert.equal(ols[1], `<ol start="${chunks[1].startAt}">`);
  assert.equal(ols[2], `<ol start="${chunks[2].startAt}">`);
});

test('bullet list split: no start rank is set', () => {
  const items = Array.from({ length: 40 }, (_, k) => `- item number ${k + 1}`).join('\n');
  const chunks = bulletChunks(scenesFor(`# Long list\n\n${items}\n`));
  assert.ok(chunks.length >= 2, 'the list must split');
  for (const m of chunks) assert.equal(m.startAt, undefined, 'an unordered list does not number');
});

test('numbered list already split by `parse`: pagination resumes its rank', () => {
  // `parse` splits lists too, wherever a table or a code block comes in
  // between, and then sets `startAt` on the chunk that follows. When that
  // chunk is later paginated, starting again from 1 shifts the whole
  // remainder by the rank already consumed — the audience reads "13." where
  // it should read "14.".
  const rest = Array.from({ length: 40 }, (_, k) => `${k + 2}. item number ${k + 2}`).join('\n');
  const scenes = scenesFor(
    `# Split list\n\n1. item number 1\n\n   | a | b |\n   | - | - |\n   | 1 | 2 |\n\n${rest}\n`,
  );
  const chunks = bulletChunks(scenes);

  assert.ok(chunks.length >= 3, 'one chunk before the table, then the paginated remainder');
  // the opening chunk keeps rank 1; the one after the table starts at 2
  assert.equal(chunks[0].startAt, undefined);
  assert.equal(chunks[1].startAt, 2, 'the chunk after the table resumes at 2');
  // and the pagination of that chunk carries on from 2, not from 1
  let expected = 2;
  for (const m of chunks.slice(1)) {
    assert.equal(m.startAt, expected, `chunk expected to start at ${expected}`);
    expected += m.items.filter((it) => !it.level).length;
  }
  // the last item does carry the number the source announces
  assert.equal(expected - 1, 41, 'the 41 items are numbered from 1 to 41');
});

test('numbered list split: sub-lists do not count towards the rank', () => {
  // a nested item has its own numbering, which restarts at 1 under its parent:
  // it must therefore not shift the rank of the following chunk
  const items = Array.from(
    { length: 40 },
    (_, k) => `${k + 1}. item number ${k + 1}\n   1. sub-item of ${k + 1}`,
  ).join('\n');
  const chunks = bulletChunks(scenesFor(`# Nested list\n\n${items}\n`));
  assert.ok(chunks.length >= 2, 'the list must split');
  let expected = 1;
  for (const m of chunks) {
    if (expected > 1) assert.equal(m.startAt, expected);
    expected += m.items.filter((it) => !it.level).length;
  }
  // at least one chunk contains nested items — otherwise the test proves nothing
  assert.ok(chunks.some((m) => m.items.some((it) => it.level > 0)));
});

test('buildScenes does not mutate the IR (paginated tables)', () => {
  const rows = Array.from({ length: 60 }, (_, k) => `| cell ${k + 1} | value ${k + 1} |`).join(
    '\n',
  );
  const deck = parseDeck(`# Long table\n\n| a | b |\n|---|---|\n${rows}\n`);
  const before = strip(deck);

  const scenes1 = buildScenes(deck);
  assert.deepEqual(strip(deck), before, 'the deck must stay intact after buildScenes');
  assert.ok(
    scenes1.some((s) => s.continued),
    'the 60-row table must paginate',
  );
  assert.deepEqual(strip(buildScenes(deck)), strip(scenes1));
});

test('callout: the height ignores blocks the renderers do not render', () => {
  // a code block inside a :::info is dropped at render time — its height must
  // not be reserved (visual gap, weakness no. 8)
  const para = { type: 'para', runs: [{ text: 'callout text' }] };
  const withCode = {
    type: 'alert',
    kind: 'info',
    blocks: [para, { type: 'code', source: 'a\nb\nc\nd\ne' }],
  };
  const without = { type: 'alert', kind: 'info', blocks: [para] };
  assert.equal(blockHeight(withCode, 600), blockHeight(without, 600));
});

test('buildScenes is a pure string → JSON on the demo deck', () => {
  const source = readDemo();
  const a = strip(buildScenes(parseDeck(source)));
  const b = strip(buildScenes(parseDeck(source)));
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Columns: the content written before the first "##" is a LEAD
//
// It used to consume a column, and the last titled section fell past the
// registry bound — a silent disappearance. The engine only drops content at
// the announced bounds (LAYOUT_SECTIONS, which validation reports), never by
// an accident of authoring.
// ---------------------------------------------------------------------------

const INTRO = 'An opening sentence that sets the frame.';

test('columns: the intro before the first ## no longer eats a column', () => {
  const [scene] = scenesFor(
    `# Three tracks\n\n${INTRO}\n\n## Track A\n\n- one\n\n## Track B\n\n- two\n\n## Track C\n\n- three\n`,
  );
  const area = contentArea();

  assert.equal(scene.layout, 'three-columns', 'three titled sections → three-column layout');
  assert.deepEqual(headings(scene), ['Track A', 'Track B', 'Track C'], 'no section must disappear');

  // the lead: full width, at the very top of the content area
  const lead = scene.elements.find((el) => el.block.type === 'para');
  assert.ok(lead, 'the intro must be placed, not dropped');
  assert.equal(textOf(lead.block), INTRO);
  assert.equal(lead.region.x, area.x);
  assert.equal(lead.region.y, area.y);
  assert.equal(lead.region.w, area.w, 'the lead takes the full width');

  // the columns restart BELOW the lead, aligned with one another
  const cols = scene.elements.filter((el) => el.block.type === 'heading');
  const tops = new Set(cols.map((el) => el.region.y));
  assert.equal(tops.size, 1, 'the three column headings share the same starting line');
  const top = [...tops][0];
  assert.ok(top >= lead.region.y + lead.region.h, 'the columns do not overlap the lead');
  assert.equal(new Set(cols.map((el) => el.region.x)).size, 3, 'three distinct x coordinates');
  assert.ok(
    cols.every((el) => el.region.w < area.w / 2),
    'each column is narrower than the slide',
  );

  // each column's content follows its heading, in the same column
  for (const [k, text] of ['one', 'two', 'three'].entries()) {
    const item = scene.elements.find(
      (el) => el.block.type === 'bullets' && textOf(el.block) === text,
    );
    assert.ok(item, `the "${text}" bullet must be placed`);
    assert.equal(item.region.x, cols[k].region.x, `"${text}" stays under "${headings(scene)[k]}"`);
  }
});

test('columns: two sections + intro keep their two columns', () => {
  const [scene] = scenesFor(
    `# Two tracks\n\n${INTRO}\n\n## Before\n\n- slow\n\n## After\n\n- fast\n`,
  );
  assert.equal(scene.layout, 'two-columns');
  assert.deepEqual(headings(scene), ['Before', 'After']);
  const lead = scene.elements.find((el) => el.block.type === 'para');
  assert.equal(lead.region.w, contentArea().w);
});

test('columns: with no ## at all, the original placement is kept', () => {
  // a slide FORCED into columns with no titled section has no lead to
  // extract: its single anonymous section stays a column, flush with the top
  const [scene] = scenesFor(`# Forced\n\n<!-- layout: two-columns -->\n\n${INTRO}\n`);
  const area = contentArea();
  const para = scene.elements.find((el) => el.block.type === 'para');
  assert.equal(para.region.y, area.y);
  assert.ok(para.region.w < area.w / 2 + 1, 'the paragraph takes one column, not the full width');
});

test('columns: the lead is one animation step, then one per column', () => {
  const [scene] = scenesFor(
    `# Three tracks\n\n<!-- animate -->\n\n${INTRO}\n\n## Track A\n\n- one\n\n## Track B\n\n- two\n\n## Track C\n\n- three\n`,
  );
  assert.equal(scene.animSteps, 4, 'lead + three columns');
  const step = (t) => scene.elements.find((el) => textOf(el.block) === t).step;
  assert.equal(step(INTRO), 0, 'the lead appears first');
  assert.deepEqual([step('Track A'), step('Track B'), step('Track C')], [1, 2, 3]);
  assert.equal(step('one'), 1, "a column's content appears with its heading");
});

// ---------------------------------------------------------------------------
// Layouts forced onto a slide without the expected content
// ---------------------------------------------------------------------------

test('quote: a slide with no block at all produces no blockless element', () => {
  // both renderers read el.block.type without a guard: an element whose block
  // is undefined used to crash them ("Cannot read properties of undefined") —
  // the scene must be empty, not lopsided
  const [scene] = scenesFor('# Missing quotation\n\n<!-- layout: quote -->\n');
  assert.deepEqual(scene.elements, [], 'no element rather than an element without a block');
  assert.ok(
    scene.elements.every((el) => el.block),
    'invariant: every element carries a block',
  );
});

// ---------------------------------------------------------------------------
// layers: a kit may supply fewer shades than the layout asks for
// ---------------------------------------------------------------------------

test('layers: the shade index is clamped to the kit palette', (t) => {
  t.after(() => {
    deriveTokens();
    resetUserLayouts();
  });
  // a frugal kit: two shades only, whereas `shades` asks for five
  const restricted = LAYER_SHADES.slice(0, 2);
  LAYER_SHADES.splice(0, LAYER_SHADES.length, ...restricted);
  registerLayout({ name: 'l-frugal', base: 'layers', shades: [0, 1, 2, 3, 4] });

  const secs = ['Foundation', 'Services', 'API', 'Applications', 'Uses']
    .map((h) => `## ${h}\n`)
    .join('\n');
  const [scene] = scenesFor(`# Layers\n\n<!-- layout: l-frugal -->\n\n${secs}`);

  const panels = scene.elements.filter((el) => el.block.type === 'panel');
  assert.equal(panels.length, 5, 'the five layers are all placed');

  // 1. every index designates a shade that EXISTS
  for (const p of panels) {
    assert.ok(
      Number.isInteger(p.block.shade) && p.block.shade >= 0 && p.block.shade < LAYER_SHADES.length,
      `shade ${p.block.shade} outside the palette of ${LAYER_SHADES.length}`,
    );
  }
  // 2. the gradient stays MONOTONIC (dark base → light surface); it does not
  //    go back on itself because the index would have been folded modulo
  const shades = panels.map((p) => p.block.shade);
  assert.deepEqual(
    shades,
    [...shades].sort((a, b) => a - b),
    `non-monotonic gradient: ${shades}`,
  );
  assert.deepEqual(shades, [0, 1, 1, 1, 1], 'indices that are too large land on the last shade');
  // 3. the heading ink matches the shade actually SET on the panel — otherwise
  //    the text is computed for a background it does not have (false contrast)
  const inks = scene.elements
    .filter((el) => el.block.type === 'heading')
    .map((el) => el.block.color);
  assert.deepEqual(
    inks,
    shades.map((s) => LAYER_SHADES[s].ink),
  );
});

test('layers: an empty palette falls back to a neutral ink without crashing', (t) => {
  t.after(deriveTokens);
  LAYER_SHADES.splice(0, LAYER_SHADES.length);
  const [scene] = scenesFor('# Layers\n\n<!-- layout: layers -->\n\n## A\n\n## B\n\n## C\n');
  const inks = scene.elements
    .filter((el) => el.block.type === 'heading')
    .map((el) => el.block.color);
  assert.deepEqual(inks, [COLORS.neutralPrimary, COLORS.neutralPrimary, COLORS.neutralPrimary]);
});

// ---------------------------------------------------------------------------
// metrics: the region below the cards fits inside the content area
// ---------------------------------------------------------------------------

test('metrics: the content below the cards does not overflow the content area', () => {
  // the region height used to forget the SPACE.sm that offsets the top of the
  // cards: 16 px of content slipped under the footer
  const bullets = Array.from({ length: 30 }, (_, k) => `- item number ${k + 1}`).join('\n');
  const [scene] = scenesFor(
    `# Metrics\n\n:::metric 12 | twelve\n:::\n\n:::metric 34 | thirty-four\n:::\n\n${bullets}\n`,
  );
  const area = contentArea();
  assert.equal(scene.layout, 'metrics');

  const bottom = area.y + area.h;
  for (const el of scene.elements) {
    assert.ok(
      el.region.y + el.region.h <= bottom,
      `element ${el.block.type}: bottom at ${el.region.y + el.region.h}, content area down to ${bottom}`,
    );
  }
  // the region is not simply cropped: long content fills the whole of it
  const flow = scene.elements.filter((el) => el.block.type !== 'metric');
  assert.ok(flow.length, 'the content below the cards must be placed');
  assert.equal(
    flow[flow.length - 1].region.y + flow[flow.length - 1].region.h,
    bottom,
    'overflowing content stops exactly at the bottom of the content area',
  );
});
