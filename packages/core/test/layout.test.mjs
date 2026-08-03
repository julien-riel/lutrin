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
import {
  buildScenes,
  blockHeight,
  packGrid,
  registerLayout,
  resetUserLayouts,
} from '../src/deck/layout.mjs';
import {
  COLORS,
  LAYER_SHADES,
  PAGE,
  SEMANTIC,
  SPACE,
  contentArea,
  deriveTokens,
} from '../src/deck/tokens.mjs';
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
// text scale (plan 1): a layout's `density` stamps a synthesized `size`
// ---------------------------------------------------------------------------

/** Every `size` present in a scene tree, path included — so an omission can be
 *  asserted over the WHOLE structure and not over the blocks one thought of. */
function sizesIn(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => sizesIn(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) =>
    k === 'size' ? [`${path}.size=${v}`] : sizesIn(v, `${path}.${k}`),
  );
}

const DENSITY_BODY = '## Cell\n\nA paragraph.\n\n- a bullet\n  - nested\n\n## Other\n\ntext\n';

/**
 * `size` is TWO keys under one name, and only one of them is density's:
 *
 *   - the points the layout stamps on a text block it flows — a NUMBER, what
 *     this test watches;
 *   - the size word an author writes in an icon's alt slot
 *     (`![medium](lucide:zap)`) — a STRING, and deliberately so: ICON_SIZES is
 *     "words, never points", because an author who could write "24 pt" would
 *     be positioning. It travels through the scene untouched.
 *
 * Filtering on `!= null` conflated the two, so adding an icon to the demo deck
 * failed a test about density.
 */
const stampsPoints = (el) => typeof el.block.size === 'number';

test('density: the layout stamps `size` on the text blocks it flows — and stamps NOTHING at the default', (t) => {
  t.after(resetUserLayouts);
  resetUserLayouts();
  registerLayout({ name: 'p-dense-grid', base: 'grid', density: 'dense' });

  const [dense] = scenesFor(`# Board\n\n<!-- layout: p-dense-grid -->\n\n${DENSITY_BODY}`);
  const sized = dense.elements.filter(stampsPoints).map((el) => el.block.type);
  assert.deepEqual(
    [...new Set(sized)].sort(),
    ['bullets', 'para'],
    'the text blocks of the cells carry a size',
  );
  // 14 pt × 0.64 = 8.96 → 9 pt (half-point rounding), and it is the SAME
  // number the renderers will read back through blockFontSize
  assert.equal(dense.elements.find((el) => el.block.type === 'para').block.size, 9);
  assert.equal(
    dense.elements.find((el) => el.block.type === 'heading').block.size,
    undefined,
    'a slot title is not scaled with the body: the hierarchy has to survive',
  );

  // THE guarantee that protects every existing deck: a deck that asks for
  // nothing must produce a scene without a single `size` key anywhere — an
  // optional key OMITTED, never set to a default. This is what keeps the two
  // goldens byte-identical.
  const plain = scenesFor(`# Board\n\n<!-- layout: grid -->\n\n${DENSITY_BODY}`);
  assert.deepEqual(sizesIn(plain), [], 'the default density must leave no trace in the scene');
  // and on the deck the goldens are frozen from — an EXACT set, so a layout
  // that started stamping sizes on its own would show here rather than in a
  // 3000-line golden: the key message of `focus`, and the paragraph of the
  // status board, whose `status-list` layout asks for the dense step
  const demoElements = buildScenes(parseDeck(readDemo())).flatMap((s) => s.elements);
  const demoSized = demoElements.filter(stampsPoints).map((el) => el.block.type);
  assert.deepEqual(
    [...new Set(demoSized)].sort(),
    ['heading', 'para'],
    'unexpected size in the demo',
  );
  // auto-fit stamps its own sizes: a demo region the engine had to shrink would
  // move the goldens, and would mean the deck the whole suite is frozen from no
  // longer fits at the size it claims
  assert.deepEqual(
    demoElements.filter((el) => el.densified).map((el) => el.block.type),
    [],
    'no region of the demo may be densified',
  );
});

test('blockHeight: the same paragraph measures strictly smaller at dense than at comfortable', () => {
  const para = {
    type: 'para',
    runs: [{ text: 'A sentence long enough to wrap over a few lines.' }],
  };
  const comfortable = blockHeight(para, 260);
  const compact = blockHeight({ ...para, size: 11 }, 260);
  const dense = blockHeight({ ...para, size: 9 }, 260);
  assert.ok(comfortable > 0 && dense > 0, 'both heights must be positive');
  assert.ok(
    comfortable > compact && compact > dense,
    `the estimate must follow the scale: ${comfortable} > ${compact} > ${dense}`,
  );
  // a block that renders smaller has to MEASURE smaller, otherwise pagination
  // reserves room nothing occupies — which is the whole point of the accessor
  const bullets = {
    type: 'bullets',
    items: [
      { runs: [{ text: 'top level item, long enough to wrap' }], level: 0 },
      { runs: [{ text: 'nested item, also long enough to wrap' }], level: 1 },
    ],
  };
  assert.ok(blockHeight({ ...bullets, size: 9 }, 260) < blockHeight(bullets, 260));
});

// Alignment (plan 4) changes where the ink sits inside a region, never how
// much room the region needs. The estimator and the cell rendering are read
// from the same block, though, and a width divided per column "because the
// alignment says so" would silently move pagination on every table in every
// deck — hence this guard rather than trust.
test('blockHeight: a table measures the same aligned and unaligned', () => {
  const cell = (t) => [{ text: t }];
  const table = {
    type: 'table',
    header: [cell('Item'), cell('Amount')],
    rows: [
      [cell('Licences, support and hosting'), cell('1 517')],
      [cell('Training'), cell('147')],
    ],
  };
  for (const align of [
    ['left', 'right'],
    ['center', 'center'],
    ['right', 'right'],
  ]) {
    assert.equal(
      blockHeight({ ...table, align }, 520),
      blockHeight(table, 520),
      `align ${align.join('/')} must not move the height estimate`,
    );
  }
});

// A progress bar and a badge row are the two blocks whose height is NOT
// derived from a font metric: the bar is a fixed-size object, the row wraps.
// `blockHeight` has a silent `default: return 0`, so a type it does not know
// is placed at zero height and overlaps its neighbour without a single test
// flinching — hence an assertion on the real numbers, not on finiteness.
test('blockHeight: a progress bar is a constant, a badge row grows by a line when it wraps', () => {
  const bar = { type: 'progress', value: 0.4, label: 'A label long enough to wrap on its own' };
  assert.equal(blockHeight(bar, 600), 28);
  assert.equal(blockHeight(bar, 200), 28, 'the width changes nothing: the bar is an object');
  assert.equal(
    blockHeight({ ...bar, caption: 'Under analysis' }, 600),
    46,
    'a caption adds its line, and only its line',
  );

  const row = {
    type: 'badge',
    items: ['Scope', 'Schedule', 'Quality', 'Budget'].map((text) => ({ text, kind: 'success' })),
  };
  const wide = blockHeight(row, 900);
  const narrow = blockHeight(row, 220);
  assert.ok(narrow > wide, `wrapping must cost a row: ${narrow} vs ${wide}`);
  assert.equal(
    blockHeight({ type: 'badge', items: [] }, 900) < wide,
    true,
    'an empty row reserves next to nothing',
  );
});

// ---------------------------------------------------------------------------
// auto-fit (plan 5): a bounded region that overflows is re-flowed a step down
// the scale rather than left to run over its neighbour. The policy, in three
// clauses — the whole region steps down, the step is discrete, and the floor
// is honest — plus the one branch that is a policy call: pagination wins.
// ---------------------------------------------------------------------------

/** Lowest pixel a set of placed elements reaches. */
const bottomOf = (els) => els.reduce((m, el) => Math.max(m, el.region.y + el.region.h), 0);

/** Room the blocks would ask for at the deck's DEFAULT size — what the region
 *  had to hold before the engine touched it: the estimates the flow works from,
 *  plus the gap it leaves between two blocks. */
const roomAtDefault = (els) =>
  els.reduce((h, el) => h + blockHeight({ ...el.block, size: undefined }, el.region.w), 0) +
  SPACE.sm * Math.max(0, els.length - 1);

const FILLER = 'The column carries a sentence long enough to run past its own panel. ';

/** The elements of a `comparison` slide whose first column holds `text`. */
const comparisonColumn = (text) => {
  const [scene] = scenesFor(
    `# Board\n\n<!-- layout: comparison -->\n\n## Now\n\n${text}\n\n## Next\n\n- short\n`,
  );
  const col = scene.elements.filter((el) => el.group === 0);
  return { scene, panel: col.find((el) => el.block.type === 'panel'), flowed: col.slice(1) };
};

test('auto-fit: a panel a fifth too full is re-flowed one step down, and then fits', () => {
  // 663 px of content asked into a 552 px panel — a fifth too much
  const { scene, panel, flowed } = comparisonColumn(FILLER.repeat(18));
  // the rescue was NEEDED: at the deck's default size the column asks for more
  // room than the panel has — without this the test would pass on a deck that
  // never overflowed
  assert.ok(
    roomAtDefault(flowed) > panel.region.h,
    `the column must not fit at the default size (${Math.round(roomAtDefault(flowed))} px in ${panel.region.h})`,
  );

  assert.ok(
    flowed.every((el) => el.densified === 'compact'),
    'the WHOLE region steps down, never the offending block on its own',
  );
  assert.equal(
    flowed.find((el) => el.block.type === 'para').block.size,
    11,
    '14 pt × 0.78 = 10.92 → 11 pt: a step of the scale, not a best-fit factor',
  );
  assert.equal(
    flowed.find((el) => el.block.type === 'heading').block.size,
    undefined,
    'a slot title keeps its size: the hierarchy has to survive the fit',
  );
  // and it fits: nothing crosses the bottom of the panel it was flowed into,
  // which is the neighbour it used to land on
  assert.ok(
    bottomOf(flowed) <= panel.region.y + panel.region.h,
    `content down to ${Math.round(bottomOf(flowed))}, panel down to ${panel.region.y + panel.region.h}`,
  );

  // the second column never overflowed: the step is per REGION, and a slide
  // where one panel is dense and the others are not is the point
  const other = scene.elements.filter((el) => el.group === 1);
  assert.ok(
    other.every((el) => el.densified === undefined && el.block.size === undefined),
    'a region that fits is left strictly alone',
  );
});

test('auto-fit: the floor is honest — past `dense` the engine stops and the overflow stays visible', () => {
  const { flowed } = comparisonColumn(FILLER.repeat(40));
  assert.ok(
    flowed.every((el) => el.densified === 'dense'),
    'two steps down and no further: 6 pt text is not a fit, it is a failure with the evidence hidden',
  );
  const para = flowed.find((el) => el.block.type === 'para');
  assert.equal(para.block.size, 9, '14 pt × 0.64 = 8.96 → 9 pt');
  assert.ok(
    blockHeight(para.block, para.region.w) > para.region.h,
    'the overflow survives the densest step — BLOCK_OVERFLOW is left to say so',
  );
});

test('auto-fit: pagination wins — a flowing slide splits rather than shrinks', () => {
  // a flow layout has somewhere to put the overflow; densifying instead would
  // trade a legible second slide for a cramped single one
  const items = Array.from({ length: 40 }, (_, k) => `- item number ${k + 1}`).join('\n');
  const scenes = scenesFor(`# Long list\n\n${items}\n`);
  assert.ok(
    scenes.some((s) => s.continued),
    'the 40-bullet list must paginate',
  );
  assert.deepEqual(sizesIn(scenes), [], 'a paginated flow carries no size at all');
  assert.ok(
    scenes.every((s) => s.elements.every((el) => !el.densified)),
    'nothing on a paginated slide may be marked densified',
  );
});

// The case that failed. The first render of the real project dashboard put
// these four follow-up items in one panel of a board of narrow columns: at
// 14 pt the descriptions ran out of the panel and over what sat below, and the
// fix was to shorten them by hand, one word at a time, until the line count
// came out right. They are reproduced here UNSHORTENED.
const FOLLOW_UP = [
  [
    'Inspection strand',
    'Due Q3',
    'Monitoring begins. Findings and recommendations due for the September board.',
  ],
  [
    'Municipal consent',
    'Due Q4',
    'Requirement under analysis. Scope to be confirmed: processing strand, finance strand, portal integration.',
  ],
  [
    'CT integration',
    'Due Q4',
    'Awaiting confirmation for the two boroughs running the terrace-permit pilot.',
  ],
  [
    'Request from project 911PG',
    'Due Q3',
    'Live connection of the fire-service dispatch system to the deck data. Date to be determined.',
  ],
];

test('auto-fit: the follow-up panel of the real dashboard fits, unshortened', (t) => {
  t.after(resetUserLayouts);
  resetUserLayouts();
  registerLayout({ name: 'board-4', base: 'grid', cols: 4 });

  const body = FOLLOW_UP.map(([what, due, detail]) => `**${what}** — ${due}\n${detail}`).join(
    '\n\n',
  );
  const [scene] = scenesFor(
    `# Project board\n\n<!-- layout: board-4 -->\n\n## Progress\n\nOn track.\n\n## Risks\n\nNone raised.\n\n## Budget\n\nWithin envelope.\n\n## Follow-up items\n\n${body}\n`,
  );
  const cell = scene.elements.filter((el) => el.group === 3);
  const panel = cell.find((el) => el.block.type === 'panel');
  const flowed = cell.slice(1);

  // all four items are still there: auto-fit shrinks, it never truncates —
  // losing an author's words silently is worse than overflowing visibly
  assert.equal(flowed.filter((el) => el.block.type === 'para').length, 4);
  assert.ok(
    roomAtDefault(flowed) > panel.region.h,
    'the panel must be the one that used to overflow, or this test proves nothing',
  );

  // no overlap: each element starts below the previous one and the last one
  // stops inside the panel — that is what "rendered without overlap" means
  for (const [k, el] of flowed.entries()) {
    if (k) {
      const prev = flowed[k - 1];
      assert.ok(
        el.region.y >= prev.region.y + prev.region.h,
        `"${el.block.type}" at ${Math.round(el.region.y)} overlaps the block above, which ends at ${Math.round(prev.region.y + prev.region.h)}`,
      );
    }
  }
  assert.ok(
    bottomOf(flowed) <= panel.region.y + panel.region.h,
    `the content runs down to ${Math.round(bottomOf(flowed))}, the panel to ${panel.region.y + panel.region.h}`,
  );
  assert.ok(
    flowed.every((el) => el.densified === 'compact'),
    'one step was enough: the engine spends the scale one rung at a time',
  );
});

// ---------------------------------------------------------------------------
// solid tones (plan 2): the tone decides the ink, and the engine reads it back
// from panelStyle() instead of guessing it at the call site
// ---------------------------------------------------------------------------

test('panels: a `-solid` variant stamps `tone` and the ink that goes WITH the tone', (t) => {
  t.after(resetUserLayouts);
  resetUserLayouts();
  registerLayout({ name: 'p-alert-grid', base: 'grid', panels: ['danger-solid'], radius: 'pill' });

  const body = '## Blocked\n\nthree services down\n';
  const [solid] = scenesFor(`# Status\n\n<!-- layout: p-alert-grid -->\n\n${body}`);
  const panel = solid.elements.find((el) => el.block.type === 'panel');
  assert.deepEqual(panel.block, {
    type: 'panel',
    variant: 'semantic',
    kind: 'danger',
    tone: 'solid',
    radius: 'pill',
  });
  const heading = solid.elements.find((el) => el.block.type === 'heading');
  assert.equal(
    heading.block.color,
    SEMANTIC.danger.solidText,
    'the title on a saturated panel takes solidText',
  );
  assert.notEqual(
    heading.block.color,
    SEMANTIC.danger.text,
    'the pale-tint ink on a saturated fill is the bug this closes',
  );
  // the body too: a white title over near-black body text on the same red is
  // a panel repainted halfway
  assert.equal(
    solid.elements.find((el) => el.block.type === 'para').block.color,
    SEMANTIC.danger.solidText,
    'a saturated panel imposes its ink on the blocks it holds, not on its title alone',
  );

  // the pale twin: same tint, other tone — and an IR that carries neither key
  registerLayout({ name: 'p-pale-grid', base: 'grid', panels: ['danger'] });
  const [pale] = scenesFor(`# Status\n\n<!-- layout: p-pale-grid -->\n\n${body}`);
  const paleBlock = pale.elements.find((el) => el.block.type === 'panel').block;
  assert.deepEqual(Object.keys(paleBlock).sort(), ['kind', 'type', 'variant']);
  assert.equal(
    pale.elements.find((el) => el.block.type === 'heading').block.color,
    SEMANTIC.danger.text,
  );
  assert.equal(
    pale.elements.find((el) => el.block.type === 'para').block.color,
    undefined,
    'a pale tint leaves the body the deck ink: colouring it would move every scene',
  );
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

// ---------------------------------------------------------------------------
// grid `spans`: cells that occupy several columns
// ---------------------------------------------------------------------------

test('packGrid: a flow, never a best fit — reading order is not rearranged', () => {
  // no spans = the historical placement, cell by cell
  assert.deepEqual(packGrid(4, 2), {
    rows: 2,
    cells: [
      { col: 0, row: 0, span: 1 },
      { col: 1, row: 0, span: 1 },
      { col: 0, row: 1, span: 1 },
      { col: 1, row: 1, span: 1 },
    ],
  });

  // a wide cell first, then two ordinary ones underneath
  assert.deepEqual(packGrid(3, 2, [2, 1, 1]).cells, [
    { col: 0, row: 0, span: 2 },
    { col: 0, row: 1, span: 1 },
    { col: 1, row: 1, span: 1 },
  ]);

  // THE GAP IS KEPT. A best-fit packer would pull the third cell up beside the
  // first to fill the hole; the author wrote these sections in an order, and a
  // mosaic that reorders them is telling a different story from the source.
  const gap = packGrid(3, 3, [2, 2, 1]);
  assert.deepEqual(gap.cells, [
    { col: 0, row: 0, span: 2 },
    { col: 0, row: 1, span: 2 },
    { col: 2, row: 1, span: 1 },
  ]);
  assert.equal(gap.rows, 2);

  // a span wider than the grid is a full-width cell, never an overflow
  assert.deepEqual(packGrid(1, 2, [3]).cells, [{ col: 0, row: 0, span: 2 }]);
});

test('grid spans: a wide cell is wider ON THE SLIDE, and swallows the gutter it covers', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'span-probe', base: 'grid', cols: 2, spans: [2, 1, 1] });
  const scene = buildScenes(
    parseDeck('# G\n\n<!-- layout: span-probe -->\n\n## A\n\n- a\n\n## B\n\n- b\n\n## C\n\n- c\n'),
  )[0];
  const panels = scene.elements.filter((e) => e.block.type === 'panel').map((e) => e.region);
  assert.equal(panels.length, 3);
  const [wide, left, right] = panels;

  // the full-width cell spans both columns AND the gutter between them, so it
  // is strictly wider than twice a plain cell would be on its own
  assert.ok(wide.w > left.w * 2, 'a 2-span cell takes the gutter it covers');
  assert.equal(Math.round(wide.w), Math.round(left.w + right.w + PAGE.gutter));
  // the two ordinary cells sit on the next row, side by side
  assert.equal(left.y, right.y);
  assert.ok(left.y > wide.y, 'the row below');
  assert.equal(left.x, wide.x, 'and it starts at the same left edge');
});

test('grid spans: six and eight sections lay out without leaving the content area', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'six', base: 'grid', cols: 3 });
  registerLayout({ name: 'eight', base: 'grid', cols: 4 });
  const body = (n) =>
    Array.from({ length: n }, (_, i) => `## S${i + 1}\n\n- item ${i + 1}\n`).join('\n');
  const area = contentArea();
  for (const [layout, n, rows] of [
    ['six', 6, 2],
    ['eight', 8, 2],
  ]) {
    const scene = buildScenes(parseDeck(`# G\n\n<!-- layout: ${layout} -->\n\n${body(n)}`))[0];
    const panels = scene.elements.filter((e) => e.block.type === 'panel').map((e) => e.region);
    assert.equal(panels.length, n, `${layout}: one panel per section`);
    assert.equal(new Set(panels.map((p) => Math.round(p.y))).size, rows, `${layout}: ${rows} rows`);
    for (const p of panels) {
      assert.ok(p.x >= area.x - 0.5 && p.x + p.w <= area.x + area.w + 0.5, `${layout}: inside`);
      assert.ok(p.y + p.h <= area.y + area.h + 0.5, `${layout}: above the footer`);
    }
  }
});

// ---------------------------------------------------------------------------
// Diagram layouts
//
// A diagram is ONE element carrying the whole family, so what is checked here
// is the reading — what the generator made of the sections — not the drawing.
// The drawing has its own golden, in smartart.test.mjs, and deliberately does
// not travel through demo.scenes.json.
// ---------------------------------------------------------------------------

const smartOf = (src) => {
  const els = buildScenes(parseDeck(src)).flatMap((s) => s.elements);
  const smart = els.filter((e) => e.block.type === 'smartart');
  assert.equal(smart.length, 1, 'a diagram layout emits exactly one element');
  return smart[0];
};

test('a diagram layout fills the content area, and only it', () => {
  const area = contentArea();
  for (const [layout, body] of [
    ['cycle', '## A\n\n## B\n\n## C\n'],
    ['venn', '## A\n\n## B\n'],
    ['radial', 'The hub\n\n## A\n\n## B\n'],
    ['hierarchy', '- Root\n  - Child\n'],
  ]) {
    const { region } = smartOf(`# D\n\n<!-- layout: ${layout} -->\n\n${body}`);
    assert.deepEqual(region, { ...area }, `${layout}: the region IS the content area`);
  }
});

test('cycle, venn and radial read one node per "##" section, clamped at the bounds', () => {
  const secs = (n) => Array.from({ length: n }, (_, i) => `## S${i + 1}\n`).join('\n');
  assert.equal(smartOf(`# D\n\n<!-- layout: cycle -->\n\n${secs(5)}`).block.nodes.length, 5);
  // the surplus is dropped AT THE BOUNDS the registry announces — validation
  // (LAYOUT_SECTIONS) is the only place that reports it
  assert.equal(smartOf(`# D\n\n<!-- layout: cycle -->\n\n${secs(12)}`).block.nodes.length, 8);
  assert.equal(smartOf(`# D\n\n<!-- layout: venn -->\n\n${secs(9)}`).block.nodes.length, 4);
});

test("cycle takes a section's first paragraph as the node's second line", () => {
  const b = smartOf(
    '# D\n\n<!-- layout: cycle -->\n\n## Plan\n\nWith the sponsors.\n\n## Build\n\n## Ship\n',
  ).block;
  assert.equal(b.nodes[0].text, 'Plan');
  assert.equal(b.nodes[0].sub, 'With the sponsors.');
  assert.equal(b.nodes[1].sub, undefined, 'a section with no paragraph carries no second line');
});

test('radial takes its hub from the lead paragraph, and falls back to the title', () => {
  const withLead = smartOf(
    '# Platform\n\n<!-- layout: radial -->\n\nCompiler core\n\n## A\n\n## B\n',
  ).block;
  assert.equal(withLead.hub, 'Compiler core');
  assert.equal(withLead.nodes.length, 2, 'the lead is the hub, NOT a spoke');
  // a hub with no name is a circle with no argument
  const noLead = smartOf('# Platform\n\n<!-- layout: radial -->\n\n## A\n\n## B\n').block;
  assert.equal(noLead.hub, 'Platform');
});

test('hierarchy reads a nested bullet list, and "##" sections just as well', () => {
  const fromBullets = smartOf(
    '# Org\n\n<!-- layout: hierarchy -->\n\n- CEO\n  - Eng\n    - Platform\n  - Sales\n',
  ).block;
  assert.equal(fromBullets.nodes.length, 1, 'one root');
  assert.deepEqual(
    fromBullets.nodes[0].children.map((c) => c.text),
    ['Eng', 'Sales'],
  );
  assert.deepEqual(
    fromBullets.nodes[0].children[0].children.map((c) => c.text),
    ['Platform'],
  );

  const fromSections = smartOf(
    '# Org\n\n<!-- layout: hierarchy -->\n\n## Eng\n\n- Platform\n- Product\n\n## Sales\n',
  ).block;
  assert.deepEqual(
    fromSections.nodes.map((n) => n.text),
    ['Eng', 'Sales'],
  );
  assert.deepEqual(
    fromSections.nodes[0].children.map((c) => c.text),
    ['Platform', 'Product'],
  );
});

test('a diagram sets no parameter key when the deck asked for none', () => {
  const b = smartOf('# D\n\n<!-- layout: cycle -->\n\n## A\n\n## B\n\n## C\n').block;
  assert.equal('numbered' in b, false, 'a default written out would move the golden for nothing');
  const v = smartOf('# D\n\n<!-- layout: venn -->\n\n## A\n\n## B\n').block;
  assert.equal('overlap' in v, false);
});
