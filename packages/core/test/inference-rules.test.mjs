/**
 * The layouts proposal, checked where it can actually go wrong.
 *
 * Three families of net, and they are not interchangeable:
 *
 *   1. INFERENCE — the six new rules fire on the signal they claim to read,
 *      and, just as importantly, do NOT fire past their stated bounds. A rule
 *      that fires too often is worse than one that never fires: it relays
 *      decks nobody asked to relay.
 *   2. COMPATIBILITY — a deck written before the rules can freeze them, and
 *      is TOLD what moved. That diagnostic is the real safety net; the pin is
 *      only the undo button.
 *   3. PLACEMENT — the new bases put something on the slide, inside the
 *      content area, in the reading order the author wrote.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck/parse.mjs';
import {
  buildScenes,
  inferLayout,
  inferLayoutFull,
  inferenceRuleSet,
  previousInferenceRules,
  maintainedInferenceRules,
  INFERENCE_RULES,
  LATEST_INFERENCE,
} from '../src/deck/layout.mjs';
import { validateDeck } from '../src/deck/validate.mjs';
import { contentArea } from '../src/deck/tokens.mjs';

/** Layout inferred for a one-slide deck written on the fly. */
const layoutOf = (body, rules) => inferLayout(parseDeck(`# T\n\n${body}`).slides[0], 1, rules);
const fullOf = (body) => inferLayoutFull(parseDeck(`# T\n\n${body}`).slides[0], 1);
const scenesFor = (source) => buildScenes(parseDeck(source));

const SECTION = (n) =>
  Array.from({ length: n }, (_, i) => `## Head ${i + 1}\n\nBody ${i + 1}.\n`).join('\n');

// ---------------------------------------------------------------------------
// 1. Inference
// ---------------------------------------------------------------------------

test('§2.1 the hole in the table: 4 / 5–6 / 7–9 titled sections become a mosaic', () => {
  assert.deepEqual(fullOf(SECTION(4)), { layout: 'grid', params: { cols: 2 } });
  assert.deepEqual(fullOf(SECTION(5)), { layout: 'grid', params: { cols: 3 } });
  assert.deepEqual(fullOf(SECTION(6)), { layout: 'grid', params: { cols: 3 } });
  assert.deepEqual(fullOf(SECTION(8)), {
    layout: 'grid',
    params: { cols: 3, density: 'compact' },
  });
  // the counts that already had an answer keep it
  assert.equal(layoutOf(SECTION(2)), 'two-columns');
  assert.equal(layoutOf(SECTION(3)), 'three-columns');
  // past the base's own bounds it is a flow again — the engine never drops
  // content to honour a rule
  assert.equal(layoutOf(SECTION(10)), 'content');
});

test('§2.2 a task list is a checklist — the most explicit signal Markdown owns', () => {
  assert.equal(layoutOf('- [x] Done\n- [ ] Not done\n'), 'checklist');
  // and it WINS over the numbered-list rule when both forms are present: a
  // ticked box is never "step 3 of 5"
  assert.equal(layoutOf('1. [x] Done\n2. [ ] Not done\n3. [ ] Nor this\n'), 'checklist');
  // the marker is lifted OUT of the text: it is a state, not three characters
  const items = parseDeck('# T\n\n- [x] Done\n- [ ] Open\n').slides[0].sections[0].blocks[0].items;
  assert.deepEqual(
    items.map((i) => ({ checked: i.checked, text: i.runs.map((r) => r.text).join('') })),
    [
      { checked: true, text: 'Done' },
      { checked: false, text: 'Open' },
    ],
  );
  // a deck that wrote no marker must not gain a key
  const plain = parseDeck('# T\n\n- One\n').slides[0].sections[0].blocks[0].items[0];
  assert.equal('checked' in plain, false);
  // only the HEAD of an item is read this way: "**[x]** done" is a sentence
  const bold = parseDeck('# T\n\n- **[x]** shipped\n').slides[0].sections[0].blocks[0].items[0];
  assert.equal(bold.checked, undefined);
});

test('§2.2 a numbered list is a sequence — inside its bounds, and not past them', () => {
  assert.equal(layoutOf('1. Receive\n2. Triage\n3. Assign\n'), 'steps');
  assert.equal(
    layoutOf('1. Receive\n2. Triage\n3. Assign\n4. Answer\n5. Close\n6. Report\n'),
    'steps',
  );
  // two items are not a sequence worth six panels, seven are no longer one
  assert.equal(layoutOf('1. Receive\n2. Triage\n'), 'content');
  assert.equal(
    layoutOf('1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n'),
    'content',
    'past 6 items the list is content, not the spine of a slide',
  );
  // …nor is a list whose items are paragraphs
  const long = `1. ${'word '.repeat(14)}\n2. Triage\n3. Assign\n`;
  assert.equal(layoutOf(long), 'content', 'an item longer than a caption is content');
});

test('§2.2 a nested list is a tree — but only when it HAS one root', () => {
  assert.equal(layoutOf('- Platform\n  - Compiler\n  - Renderer\n'), 'hierarchy');
  assert.equal(
    layoutOf('- Current\n  - A\n- Target\n  - B\n'),
    'content',
    'two roots are two trees side by side — another intent, so it stays a flow',
  );
  assert.equal(layoutOf('- Flat\n- List\n'), 'content', 'a flat list is a flat list');
});

test('§2.6 three dated headings are promoted from suggestion to inference', () => {
  assert.equal(layoutOf('## 2024\n\na\n\n## 2025\n\nb\n\n## 2026\n\nc\n'), 'timeline');
  assert.equal(layoutOf('## Q1\n\na\n\n## Q2\n\nb\n\n## Q3\n\nc\n'), 'timeline');
  assert.equal(layoutOf('## Phase 1\n\na\n\n## Phase 2\n\nb\n\n## Phase 3\n\nc\n'), 'timeline');
  // ALL of them, or none: a mixed slide is not a clear-cut case
  assert.equal(layoutOf('## 2024\n\na\n\n## 2025\n\nb\n\n## Later\n\nc\n'), 'three-columns');
  // two dated sections stay two columns — and stay a SUGGESTION
  assert.equal(layoutOf('## 2024\n\na\n\n## 2025\n\nb\n'), 'two-columns');
});

test('§2.3 sections that repeat one shape are a mosaic of cards, not a flow', () => {
  const card = (n) => `## Head ${n}\n\n![alt](p${n}.png)\n\nBody ${n}.\n`;
  assert.deepEqual(fullOf([1, 2, 3].map(card).join('\n')), {
    layout: 'grid',
    params: { cols: 3, headed: true },
  });
  // …and it beats `split`, which would place the first picture and flow the
  // rest as text beside it
  assert.notEqual(layoutOf([1, 2, 3].map(card).join('\n')), 'split');
  // one paragraph each is just three columns: calling that a mosaic would
  // re-lay out half the decks in the world to say nothing new
  assert.equal(layoutOf(SECTION(3)), 'three-columns');
  // a shape that is not actually repeated is not a shape
  const ragged = '## A\n\n![x](a.png)\n\nBody.\n\n## B\n\nBody.\n\n## C\n\n![x](c.png)\n\nBody.\n';
  assert.notEqual(inferLayout(parseDeck(`# T\n\n${ragged}`).slides[0], 1), 'grid');
});

// ---------------------------------------------------------------------------
// 2. Compatibility (§5)
// ---------------------------------------------------------------------------

test('rule set 1.0 reproduces the previous engine exactly', () => {
  for (const body of [
    SECTION(4),
    '- [x] Done\n- [ ] Open\n',
    '1. a\n2. b\n3. c\n',
    '- Platform\n  - Compiler\n',
    '## 2024\n\na\n\n## 2025\n\nb\n\n## 2026\n\nc\n',
  ]) {
    assert.notEqual(
      layoutOf(body, '1.0'),
      layoutOf(body, '1.1'),
      `1.0 vs 1.1 on: ${body.slice(0, 20)}`,
    );
  }
  assert.equal(layoutOf(SECTION(4), '1.0'), 'content');
  assert.equal(layoutOf('## 2024\n\na\n\n## 2025\n\nb\n\n## 2026\n\nc\n', '1.0'), 'three-columns');
});

test('the `inference:` pin: honoured, defaulted, and never silently ignored', () => {
  assert.equal(inferenceRuleSet({}).rules, LATEST_INFERENCE, 'no pin = the latest set');
  assert.equal(inferenceRuleSet({ inference: '1.0' }).rules, '1.0');
  assert.equal(inferenceRuleSet({ inference: '1.0' }).diag, null);
  const unknown = inferenceRuleSet({ inference: '9.9' });
  assert.equal(unknown.rules, LATEST_INFERENCE);
  assert.equal(unknown.diag.code, 'INFERENCE_RULES_UNKNOWN');
  assert.equal(previousInferenceRules(LATEST_INFERENCE), INFERENCE_RULES.at(-2) ?? null);
  assert.deepEqual(maintainedInferenceRules(), INFERENCE_RULES.slice(-3));
});

test('the pin actually changes the SCENES, not only the reported layout', () => {
  const body = `---\ntitle: T\ninference: "1.0"\n---\n\n# Four\n\n${SECTION(4)}`;
  const pinned = scenesFor(body);
  const free = scenesFor(body.replace('inference: "1.0"\n', ''));
  assert.equal(pinned.find((s) => s.title === 'Four').layout, 'content');
  assert.equal(free.find((s) => s.title === 'Four').layout, 'grid');
});

test('LAYOUT_RULES_CHANGED names the slides that moved — and only those', () => {
  const diags = validateDeck(`# Four\n\n${SECTION(4)}\n# Two\n\n${SECTION(2)}`).filter(
    (d) => d.code === 'LAYOUT_RULES_CHANGED',
  );
  assert.equal(diags.length, 1, 'only the slide whose layout actually differs');
  assert.equal(diags[0].severity, 'info');
  assert.match(diags[0].message, /content → grid/);
  // the suggestion is the OLD layout: a quick-fix inserting the layout the
  // engine already picked would write a directive that changes nothing
  assert.equal(diags[0].suggestion, 'content');
  // a slide that asked explicitly never "moved"
  assert.equal(
    validateDeck(`# Four\n\n<!-- layout: grid -->\n\n${SECTION(4)}`).filter(
      (d) => d.code === 'LAYOUT_RULES_CHANGED',
    ).length,
    0,
  );
});

test('a deck that DECLARES its rule set is not told what moved', () => {
  const body = `# Four\n\n${SECTION(4)}`;
  const named = (fm) =>
    validateDeck(fm + body).filter((d) => d.code === 'LAYOUT_RULES_CHANGED').length;
  assert.equal(named(''), 1, 'an undeclared deck is told');
  // …including a pin on the LATEST set: the deck says which rules it was
  // written against, so nothing moved under it. This is what makes the notice
  // finite — `lutrin migrate` writes the pin, and the slides it just listed
  // stop being listed on every build from then on.
  assert.equal(named(`---\ntitle: T\ninference: "${LATEST_INFERENCE}"\n---\n\n`), 0);
  assert.equal(named('---\ntitle: T\ninference: "1.0"\n---\n\n'), 0);
});

// ---------------------------------------------------------------------------
// 3. Placement (§3 and §4)
// ---------------------------------------------------------------------------

/** Every element sits inside the slide's content area. */
function assertInside(scene, what) {
  const a = contentArea();
  for (const el of scene.elements) {
    assert.ok(el.region.x >= a.x - 1, `${what}: element left of the content area`);
    assert.ok(el.region.x + el.region.w <= a.x + a.w + 1, `${what}: element past the right margin`);
    assert.ok(el.region.y >= a.y - 1, `${what}: element above the content area`);
  }
}

test('§3 a lead paragraph and a closing :::key become BANDS, not columns', () => {
  const [scene] = scenesFor(
    '# T\n\nThe hat.\n\n## A\n\nAlpha.\n\n## B\n\nBravo.\n\n:::key\nThe takeaway.\n:::\n',
  );
  assert.equal(scene.layout, 'two-columns');
  const texts = scene.elements.map((el) =>
    (el.block.runs ?? el.block.blocks?.[0]?.runs ?? []).map((r) => r.text).join(''),
  );
  assert.ok(texts.includes('The hat.'), 'the lead is placed');
  assert.ok(
    scene.elements.some((el) => el.block.type === 'alert' && el.block.kind === 'key'),
    'the takeaway is placed',
  );
  const hat = scene.elements.find((el) => (el.block.runs ?? []).some((r) => r.text === 'The hat.'));
  const key = scene.elements.find((el) => el.block.type === 'alert');
  const alpha = scene.elements.find((el) => (el.block.runs ?? []).some((r) => r.text === 'Alpha.'));
  assert.ok(hat.region.y < alpha.region.y, 'the hat sits above the columns');
  assert.ok(key.region.y > alpha.region.y, 'the takeaway sits below them');
  assert.ok(hat.region.w > alpha.region.w, 'a band is full width, a column is not');
  assert.equal(
    hat.region.h <= contentArea().h * 0.32,
    true,
    'the band is capped: past leadRatio the columns densify, the band never grows',
  );
  assertInside(scene, 'bands');
});

test('§3 three paragraphs are no longer a hat: the historical flow is kept', () => {
  const [scene] = scenesFor('# T\n\nOne.\n\nTwo.\n\nThree.\n\n## A\n\nAlpha.\n\n## B\n\nBravo.\n');
  const alpha = scene.elements.find((el) => (el.block.runs ?? []).some((r) => r.text === 'Alpha.'));
  const three = scene.elements.find((el) => (el.block.runs ?? []).some((r) => r.text === 'Three.'));
  assert.ok(three.region.y < alpha.region.y, 'the lead still flows above the columns');
});

test('§3 the takeaway is COPIED out of the IR, which stays reusable', () => {
  const deck = parseDeck('# T\n\n## A\n\nAlpha.\n\n## B\n\nBravo.\n\n:::key\nOut.\n:::\n');
  const first = buildScenes(deck).length;
  const blocksBefore = deck.slides[0].sections.at(-1).blocks.length;
  const second = buildScenes(deck).length;
  assert.equal(first, second);
  assert.equal(deck.slides[0].sections.at(-1).blocks.length, blocksBefore);
  assert.ok(
    buildScenes(deck).some((s) => s.elements.some((el) => el.block.type === 'alert')),
    'a second render still finds the takeaway',
  );
});

test('§4 matrix draws named axes and deals the cells in what is left', () => {
  const [scene] = scenesFor(`# T\n\n<!-- layout: eisenhower -->\n\n${SECTION(4)}`);
  assert.equal(scene.layout, 'eisenhower');
  const labels = scene.elements
    .filter((el) => el.block.type === 'para')
    .map((el) => el.block.runs.map((r) => r.text).join(''));
  for (const w of ['Urgency', 'Importance', 'Now', 'High']) assert.ok(labels.includes(w), w);
  assert.equal(
    scene.elements.filter((el) => el.block.type === 'timeline-axis').length,
    2,
    'two axes, one of them pointing up',
  );
  assert.ok(
    scene.elements.some((el) => el.block.up),
    'on a matrix, "more" is at the top',
  );
  assert.equal(scene.elements.filter((el) => el.block.type === 'panel').length, 4);
  assertInside(scene, 'matrix');
});

test('§4 columns balances the flow, and still paginates what will not fit', () => {
  const list = Array.from({ length: 12 }, (_, i) => `- Item ${i + 1}`).join('\n');
  const scenes = scenesFor(`# T\n\n<!-- layout: columns -->\n\n${list}\n`);
  const xs = new Set(scenes[0].elements.map((el) => Math.round(el.region.x)));
  assert.equal(xs.size, 2, 'the material really is dealt into two columns');
  const placed = scenes[0].elements.reduce((n, el) => n + (el.block.items?.length ?? 0), 0);
  assert.equal(placed, 12, 'and nothing is lost between them');

  // …and a flow that overruns even the columns goes on to a "(cont.)" slide:
  // the third overflow behaviour is a THIRD one, not a replacement
  const huge = Array.from({ length: 90 }, (_, i) => `- Item ${i + 1}`).join('\n');
  const many = scenesFor(`# T\n\n<!-- layout: columns -->\n\n${huge}\n`);
  assert.ok(many.length > 1, 'pagination still has the last word');
  assert.ok(many.at(-1).continued);
});

test('§4 pictogram reads the share already written, and captions it', () => {
  const [scene] = scenesFor('# T\n\n<!-- layout: pictogram -->\n\n:::progress\n38 %\nTeams\n:::\n');
  const chart = scene.elements.find((el) => el.block.type === 'pictogram');
  assert.ok(chart, 'a pictogram block is emitted');
  assert.equal(chart.block.total, 100);
  assert.equal(chart.block.filled, 38, 'the share comes from the :::progress, not from a guess');
  const caption = scene.elements
    .filter((el) => el.block.type === 'para')
    .map((el) => el.block.runs.map((r) => r.text).join(''));
  assert.ok(
    caption.some((t) => t.includes('38 %') && t.includes('Teams')),
    'a hundred dots without the figure and what it counts is a mood, not a number',
  );
  // a percentage written in prose does just as well
  const [fromText] = scenesFor('# T\n\n<!-- layout: pictogram -->\n\nAbout 62 % of them.\n');
  assert.equal(fromText.elements.find((el) => el.block.type === 'pictogram').block.filled, 62);
});

test('§4 annotated places one marker per item, and its leaders never cross', () => {
  const [scene] = scenesFor(
    '# T\n\n<!-- layout: annotated -->\n\n![shot](s.png)\n\n1. First\n2. Second\n3. Third\n4. Fourth\n',
  );
  const dots = scene.elements.filter((el) => el.block.type === 'timeline-dot');
  assert.deepEqual(
    dots.map((d) => d.block.index),
    [1, 2, 3, 4],
    'item n annotates marker n, in the order they were written',
  );
  assert.ok(
    scene.elements.some((el) => el.block.type === 'image'),
    'the visual is placed',
  );
  // the no-crossing property is a property of the ORDER: down each side, the
  // markers only ever go downwards
  const left = dots.filter(
    (d) => d.region.x < scene.elements.find((e) => e.block.type === 'image').region.x,
  );
  for (let i = 1; i < left.length; i++)
    assert.ok(left[i].region.y > left[i - 1].region.y, 'the left column only goes down');
  assertInside(scene, 'annotated');
});

test('§4 table publishes its family as parameters, and defaults to what it always was', () => {
  const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  const [plain] = scenesFor(`# T\n\n${TABLE}`);
  const bare = plain.elements.find((el) => el.block.type === 'table').block;
  assert.equal('zebra' in bare, false, 'a deck that asked for nothing gains no key');
  assert.equal('emphasis' in bare, false);
  const [styled] = scenesFor(`# T\n\n<!-- layout: pricing -->\n\n${TABLE}`);
  const rich = styled.elements.find((el) => el.block.type === 'table').block;
  assert.equal(rich.zebra, true);
  assert.equal(rich.emphasis, 'both');
});

test('§2.2 checklist rules BETWEEN the lines, never under the last one', () => {
  const [scene] = scenesFor('# T\n\n- [ ] One\n- [ ] Two\n- [ ] Three\n');
  assert.equal(scene.layout, 'checklist');
  const lines = scene.elements.filter((el) => el.block.type === 'bullets');
  const rules = scene.elements.filter((el) => el.block.hairline);
  assert.equal(lines.length, 3);
  assert.equal(rules.length, 2, 'a rule with nothing after it is an underline');
  assertInside(scene, 'checklist');
});
