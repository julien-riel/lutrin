/**
 * Front end (parseDeck): golden of the demonstration deck's IR + targeted
 * assertions on the DSL rules (frontmatter, sections, metrics, notes,
 * source lines corrected for the frontmatter offset).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck, runsToText } from '../src/deck/parse.mjs';
import { validateDeck } from '../src/deck/validate.mjs';
import { readDemo, assertGolden } from './helpers.mjs';

/** Blocks of a slide, sections flattened. */
const blocksOf = (deck, i = 0) => deck.slides[i].sections.flatMap((s) => s.blocks);

test('golden: IR of the demonstration deck', () => {
  assertGolden('demo.deck.json', parseDeck(readDemo()));
});

test('frontmatter: meta extracted, body intact', () => {
  const deck = parseDeck(readDemo());
  assert.equal(deck.meta.title, 'A presentation compiler');
  assert.equal(deck.meta.author, 'Lutrin');
  assert.equal(deck.meta.footer, 'Presentation compiler · demonstration');
});

test('# opens a slide, ## a section', () => {
  const deck = parseDeck('# One\n\n## Left\n\n- a\n\n## Right\n\n- b\n\n# Two\n\ntext\n');
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, 'One');
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.equal(headed.length, 2);
  assert.equal(deck.slides[1].sections.flatMap((s) => s.blocks)[0].type, 'para');
});

test('source lines corrected for the frontmatter offset', () => {
  const deck = parseDeck('---\ntitle: T\n---\n\n# First\n\n- bullet\n');
  // "# First" is on line 5 of the source file
  assert.equal(deck.slides[0].line, 5);
});

test(':::metric — value, label, signed trend', () => {
  const deck = parseDeck('# KPI\n\n:::metric\n42\nResponses\n↑ +5\n:::\n');
  const metric = deck.slides[0].sections.flatMap((s) => s.blocks).find((b) => b.type === 'metric');
  assert.ok(metric, 'metric block expected');
  assert.equal(metric.value, '42');
  assert.equal(metric.label, 'Responses');
  assert.equal(metric.trend?.dir, 'up');
});

test('animate: presets and their French aliases are normalized', () => {
  const deck = parseDeck(
    '# A\n\n<!-- animate: fondu -->\n\n- a\n\n# B\n\n<!-- animate: zoom -->\n\n- b\n\n# C\n\n<!-- animate: none -->\n\n- c\n',
  );
  assert.equal(deck.slides[0].animate, true);
  assert.equal(deck.slides[0].animatePreset, 'fade');
  assert.equal(deck.slides[1].animatePreset, 'zoom');
  assert.equal(deck.slides[2].animate, false);
  assert.equal(deck.slides[2].animatePreset, undefined);
});

test('comments: notes, layout and animate are captured', () => {
  const deck = parseDeck(
    '# Slide\n\n<!-- layout: comparison -->\n<!-- animate -->\n<!-- notes: speak slowly -->\n\n## A\n\n- a\n\n## B\n\n- b\n',
  );
  const slide = deck.slides[0];
  assert.equal(slide.layout, 'comparison');
  assert.equal(slide.animate, true);
  assert.deepEqual(slide.notes, ['speak slowly']);
});

test('table: header and rows as runs', () => {
  const deck = parseDeck('# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  const table = deck.slides[0].sections.flatMap((s) => s.blocks).find((b) => b.type === 'table');
  assert.equal(table.header.length, 2);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][1][0].text, '2');
});

// ------ review findings: regressions ---------------------------------------

test('a deck opening on "---" does not lose its first slide', () => {
  // the leading `---` is a horizontal rule, not a frontmatter: the frontmatter
  // regex stopped at the next `---` and swallowed the whole slide
  // the closing `---` is essential to the reproduction: without it the
  // frontmatter regex does not even start, and the test proves nothing
  const deck = parseDeck('---\n\n# First\n\ntext\n\n---\n\n# Second\n\ntext\n');
  assert.deepEqual(deck.meta, {});
  assert.deepEqual(
    deck.slides.map((s) => s.title),
    ['First', 'Second'],
  );
  assert.equal(deck.slides[0].line, 3, '"# First" is on line 3 of the source file');
});

test('frontmatter: one line that cannot be read does not lose the other keys', () => {
  // detection must not be "all or nothing": these five YAML forms fall outside
  // the subset the compiler reads, without ceasing to be a frontmatter —
  // otherwise the block went back to being content, hence a spurious slide
  const cases = {
    'accented key': 'café: dark',
    'empty value': 'footer:',
    'nested YAML': 'logo:\n  src: a.png',
    'YAML list': 'tags:\n  - a',
    'dotted key': 'theme.name: x',
  };
  for (const [name, line] of Object.entries(cases)) {
    const deck = parseDeck(`---\ntitle: T\n${line}\n---\n\n# Slide\n\ntext\n`);
    assert.deepEqual(deck.meta, { title: 'T' }, `${name}: the other keys must survive`);
    assert.deepEqual(
      deck.slides.map((s) => s.title),
      ['Slide'],
      `${name}: no spurious slide`,
    );
  }
});

test('a block opening on markdown stays content, never a frontmatter', () => {
  // the discriminant is the STRICT "key:" form of the first non-empty line:
  // markdown block openers (> * + - #) and indentation rule it out.
  // These three forms contain a colon and had been swallowed by a first
  // attempt at a fix — they must stay content.
  const cases = {
    quotation: ['> A quotation: with a colon', 'quote'],
    'indented list': ['  - one', 'bullets'],
    'indented code': ['    const x: number = 1;', 'code'],
  };
  for (const [name, [body, type]] of Object.entries(cases)) {
    const deck = parseDeck(`---\n\n${body}\n\n---\n\n# Next\n\ntext\n`);
    assert.deepEqual(deck.meta, {}, `${name}: nothing to extract, this is not a frontmatter`);
    assert.equal(deck.slides.length, 2, `${name}: the content keeps its slide`);
    assert.equal(blocksOf(deck)[0].type, type, `${name}: the block is kept as is`);
  }
});

test('an image sharing its paragraph is no longer dropped in silence', () => {
  // `soleImage` only rendered the image when it was ALONE in the paragraph;
  // otherwise `inlineRuns` skipped it, and the image vanished without a word
  const caption = blocksOf(parseDeck('# S\n\n![](a.png) a caption\n'));
  assert.deepEqual(
    caption.map((b) => b.type),
    ['image', 'para'],
    'image and text, in source order',
  );
  assert.equal(caption[0].src, 'a.png');
  assert.equal(caption[1].runs[0].text, 'a caption');

  const two = blocksOf(parseDeck('# S\n\n![](a.png) ![](b.png)\n'));
  assert.deepEqual(
    two.map((b) => b.src),
    ['a.png', 'b.png'],
    'both images are kept',
  );
});

test('emphasis continues on both sides of an image', () => {
  // the bold/italic/link state must carry from one fragment to the next: the
  // paragraph is cut by the image, the styling is not
  const bold = blocksOf(parseDeck('# S\n\n**bold ![](a.png) more**\n'));
  assert.deepEqual(
    bold.map((b) => b.type),
    ['para', 'image', 'para'],
  );
  assert.equal(bold[0].runs[0].text, 'bold');
  assert.equal(bold[0].runs[0].bold, true);
  assert.equal(bold[2].runs[0].text, 'more');
  assert.equal(bold[2].runs[0].bold, true, 'the bold survives the image');

  const link = blocksOf(parseDeck('# S\n\n[before ![](a.png) after](https://ex.com)\n'));
  assert.equal(link[0].runs[0].link, 'https://ex.com');
  assert.equal(link[2].runs[0].link, 'https://ex.com', 'the link survives the image');
});

test('$$…$$ stays an equation even alongside an image', () => {
  // detection was conditioned on "a single block in the paragraph"
  const withImage = blocksOf(parseDeck('# S\n\n![](a.png) $$x^2$$\n'));
  assert.deepEqual(
    withImage.map((b) => b.type),
    ['image', 'math'],
  );
  assert.equal(withImage[1].source, 'x^2');
  // nominal case unchanged
  const alone = blocksOf(parseDeck('# S\n\n$$x^2$$\n'));
  assert.deepEqual(
    alone.map((b) => b.type),
    ['math'],
  );
  assert.equal(alone[0].source, 'x^2');
  // false positive not to create: two prices do not make an equation
  const prices = blocksOf(parseDeck('# S\n\nCosts $$5 and $$7 in total\n'));
  assert.deepEqual(
    prices.map((b) => b.type),
    ['para'],
  );
});

test('chart: a series with no values is a diagnostic, never an invented zero', () => {
  // `Number('')` is 0: these four specifications produced series of silent
  // zeros instead of reporting that the source could not be parsed
  const chart = (line) =>
    blocksOf(parseDeck(`# S\n\n\`\`\`chart\ntype: bar\n${line}\n\`\`\`\n`))[0];
  for (const line of ['Sales:', 'Sales:   ', 'Sales: 12, , 18', 'Sales: 12, 18,']) {
    const block = chart(line);
    assert.equal(block.type, 'code', `${JSON.stringify(line)}: fallback to the source code`);
    assert.equal(block.invalidChart, true, `${JSON.stringify(line)}: specification reported`);
  }
  // …and the fallback does reach the author, as a warning
  const diag = validateDeck('# S\n\n```chart\ntype: bar\nSales:\n```\n').find(
    (d) => d.code === 'INVALID_CHART',
  );
  assert.ok(diag, 'INVALID_CHART diagnostic expected');
  assert.equal(diag.severity, 'warning');

  // scientific notation accepted, infinity rejected
  assert.deepEqual(chart('Sales: 1e3').series, [{ name: 'Sales', values: [1000] }]);
  assert.equal(chart('Sales: Infinity').invalidChart, true);
  // nominal case unchanged
  assert.deepEqual(chart('Sales: 12, 18').series, [{ name: 'Sales', values: [12, 18] }]);
});

test('list: a nested table survives, with no spurious bullets', () => {
  // the table cells were harvested one by one as level-2 bullets — the table
  // disappeared and its content went out in pieces
  const blocks = blocksOf(
    parseDeck('# S\n\n- first\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n\n- second\n'),
  );
  // source order: the list is split at the table's insertion point —
  // `second` follows the table in the source, it follows it in the IR
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['bullets', 'table', 'bullets'],
  );
  assert.deepEqual(
    blocks[0].items.map((it) => runsToText(it.runs)),
    ['first'],
  );
  assert.deepEqual(
    blocks[2].items.map((it) => runsToText(it.runs)),
    ['second'],
  );
  assert.ok(
    [...blocks[0].items, ...blocks[2].items].every((it) => it.level === 0),
    'no spurious level-2 bullet',
  );
  assert.deepEqual(blocks[1].header.map(runsToText), ['a', 'b']);
  assert.deepEqual(
    blocks[1].rows.map((r) => r.map(runsToText)),
    [['1', '2']],
  );
});

test('list: a heading indented under a bullet stays a bullet, it splits nothing', () => {
  // in this DSL, `##`/`###` is a slide/section SEPARATOR, not a content block:
  // delegating it to readBlock() split the slide on an indented heading (an
  // empty "Title" section) and teleported the heading after the following
  // bullets. Its text must stay in the list, in place.
  const one = parseDeck('# S\n\n- a\n\n  ## Title\n');
  assert.equal(one.slides[0].sections.length, 1, 'no extra section');
  const blocksOne = blocksOf(one);
  assert.deepEqual(
    blocksOne.map((b) => b.type),
    ['bullets'],
  );
  assert.deepEqual(
    blocksOne[0].items.map((it) => runsToText(it.runs)),
    ['a', 'Title'],
  );

  const two = parseDeck('# S\n\n- alpha\n\n  ### Subtitle\n\n- omega\n\nlast\n');
  assert.equal(two.slides[0].sections.length, 1);
  const blocksTwo = blocksOf(two);
  assert.deepEqual(
    blocksTwo.map((b) => b.type),
    ['bullets', 'para'],
  );
  assert.deepEqual(
    blocksTwo[0].items.map((it) => runsToText(it.runs)),
    ['alpha', 'Subtitle', 'omega'],
  );
});

test('list: a bullet AFTER a nested block stays after it', () => {
  // nested blocks were concatenated after ALL the bullets: a table
  // illustrating point 1 ended up after point 3
  const blocks = blocksOf(
    parseDeck('# S\n\n- one\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n\n- two\n- three\n'),
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['bullets', 'table', 'bullets'],
  );
  assert.deepEqual(
    blocks[0].items.map((it) => runsToText(it.runs)),
    ['one'],
  );
  assert.deepEqual(
    blocks[2].items.map((it) => runsToText(it.runs)),
    ['two', 'three'],
  );
  // each chunk carries its own source line, not that of the whole list
  assert.deepEqual(
    blocks.map((b) => b.line),
    [3, 5, 9],
  );
});

test('numbered list cut by a block: the numbering continues', () => {
  // without `startAt`, the audience reads "1." again after the table. Same
  // convention as the split by pagination (layout.mjs), hence same renderers.
  const blocks = blocksOf(
    parseDeck('# S\n\n1. one\n\n   | a | b |\n   | - | - |\n   | 1 | 2 |\n\n1. two\n1. three\n'),
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['bullets', 'table', 'bullets'],
  );
  assert.equal(blocks[0].ordered, true);
  assert.equal(blocks[0].startAt, undefined, 'the first chunk starts at 1');
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[2].startAt, 2, '"two" is the second point, not the first');
});

test('bullet list cut by a block: no invented numbering', () => {
  const blocks = blocksOf(parseDeck('# S\n\n- one\n\n  ```js\n  const x = 1;\n  ```\n\n- two\n'));
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['bullets', 'code', 'bullets'],
  );
  assert.ok(
    blocks.every((b) => b.startAt === undefined),
    'an unordered list does not number',
  );
});

test('list: a nested code block is no longer lost', () => {
  // a fence emits no `inline` token: it disappeared without a trace or a
  // diagnostic — validate.mjs only walks the IR, where it no longer existed
  const blocks = blocksOf(parseDeck('# S\n\n- install\n\n  ```js\n  const x = 1;\n  ```\n'));
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['bullets', 'code'],
  );
  assert.equal(blocks[1].lang, 'js');
  assert.equal(blocks[1].source, 'const x = 1;');
  // the block pulled back out carries its own source line, not the list's
  assert.equal(blocks[1].line, 5);
});

test('list: a nested quote and callout come back out in sequence', () => {
  const blocks = blocksOf(
    parseDeck('# S\n\n- point\n\n  > a quotation\n\n  :::info\n  caution\n  :::\n'),
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['bullets', 'quote', 'alert'],
  );
  assert.equal(runsToText(blocks[1].runs), 'a quotation');
  assert.equal(blocks[2].kind, 'info');
});

test('list: ordinary bullets and nesting stay intact', () => {
  const bullets = blocksOf(parseDeck('# S\n\n- one\n  - two\n    - three\n- four\n'))[0];
  assert.equal(bullets.type, 'bullets');
  assert.deepEqual(
    bullets.items.map((it) => [runsToText(it.runs), it.level]),
    [
      ['one', 0],
      ['two', 1],
      ['three', 2],
      ['four', 0],
    ],
  );
});

test('UTF-8 BOM: the frontmatter is read as if there were no BOM', () => {
  // a leading U+FEFF (Windows Notepad, PowerShell `>`): frontmatter
  // recognition did not bite, the meta were lost and the frontmatter went
  // into the body as a ghost slide
  const source = '---\ntitle: T\nauthor: A\n---\n\n# One\n\n- bullet\n\n# Two\n\ntext\n';
  const withoutBom = parseDeck(source);
  const withBom = parseDeck(`\uFEFF${source}`);
  assert.deepEqual(withBom.meta, withoutBom.meta);
  assert.deepEqual(withBom.meta, { title: 'T', author: 'A' });
  assert.equal(withBom.slides.length, withoutBom.slides.length);
  assert.equal(withBom.slides.length, 2);
  // the BOM occupies no line: the source positions stay correct
  assert.equal(withBom.slides[0].line, withoutBom.slides[0].line);
});

test('unclosed frontmatter: the content stays in the body (silently)', () => {
  // documented behaviour, not a desirable one: with no closing `---`, the
  // frontmatter lines become a paragraph and nothing reports it here
  const deck = parseDeck('---\ntitle: T\n\n# One\n\ntext\n');
  assert.deepEqual(deck.meta, {});
  assert.ok(
    deck.slides.some((s) => s.sections.some((x) => x.blocks.some((b) => b.type === 'para'))),
    'no source line may disappear',
  );
});
