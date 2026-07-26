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
import { progressLayout } from '../src/deck/tokens.mjs';

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

test(':::progress — the four spellings of a share, and the tint that follows the name', () => {
  const bar = (body) => blocksOf(parseDeck(`# P\n\n:::progress${body}\n:::\n`))[0];
  // the four an author actually writes — all of them the same three quarters
  for (const written of ['75 %', '75%', '0.75', '3/4']) {
    assert.deepEqual(
      bar(`\n${written}\nLabel`),
      { type: 'progress', value: 0.75, label: 'Label', line: 3 },
      `"${written}" must read as a three-quarter share`,
    );
  }
  // caption = whatever follows the label; tint = the word after the directive
  assert.deepEqual(bar(' success\n50 %\nLabel\nUnder analysis'), {
    type: 'progress',
    value: 0.5,
    label: 'Label',
    caption: 'Under analysis',
    kind: 'success',
    line: 3,
  });
  // a tint the theme does not know is kept for the diagnostic, never rendered
  assert.equal(bar(' turquoise\n50 %\nL').unknownKind, 'turquoise');
  assert.equal(bar(' turquoise\n50 %\nL').kind, undefined);
});

test(':::progress — an out-of-range value is clamped, an unreadable one degrades', () => {
  const bar = (value) => blocksOf(parseDeck(`# P\n\n:::progress\n${value}\nLabel\n:::\n`))[0];
  assert.equal(
    bar('150 %').value,
    1,
    'a figure past 100 % is a typo in the figure, not the syntax',
  );
  assert.equal(bar('-2').value, 0);
  assert.equal(bar('1/0').value, undefined, 'a division by zero is not a share');
  // unreadable → the paragraph the author wrote, flagged for INVALID_PROGRESS
  const degraded = bar('almost done');
  assert.equal(degraded.type, 'para');
  assert.equal(degraded.invalidProgress, true);
  assert.equal(runsToText(degraded.runs), 'almost done Label');
});

test(':::progress — a target, and the two spellings it must not swallow', () => {
  const bar = (value) => blocksOf(parseDeck(`# P\n\n:::progress\n${value}\nLabel\n:::\n`))[0];

  const t = bar('62 % / 80 %');
  assert.equal(t.value, 0.62);
  assert.equal(t.target, 0.8);

  // A FRACTION IS NOT A TARGET. The whole line is tried as a single share
  // first, and a split additionally requires a per cent sign — without that
  // second condition `1/0` (a division by zero, INVALID_PROGRESS since the
  // directive shipped) came back as "100 %, target 0 %", silently. It did
  // during this very change; the assertion below is what caught it.
  assert.equal(bar('3/4').value, 0.75);
  assert.equal(bar('3/4').target, undefined, 'a fraction is a share, not a share and a target');
  assert.equal(bar('1/0').value, undefined, 'a division by zero is still no share at all');
  assert.equal(bar('1/0').type, 'para');

  // the comma is the DECIMAL separator in the default locale (fr-CA), so it
  // could never be the value/target separator: `0,75` keeps getting the
  // diagnostic it has always had rather than reading as "value 0, target 75"
  assert.equal(bar('0,75').type, 'para');
  assert.equal(bar('0,75').invalidProgress, true);

  // a bar with no target carries no key at all — existing scenes must not move
  assert.equal(bar('62 %').target, undefined);

  const g = progressLayout({ type: 'progress', value: 0.62, target: 0.8, label: 'L' }, 400);
  const plain = progressLayout({ type: 'progress', value: 0.62, label: 'L' }, 400);
  assert.ok(g.marker, 'the target is marked on the track');
  assert.equal(g.h, plain.h, 'and it changes no height — that is why it is a property');
  assert.equal(g.marker.reached, false);
  assert.ok(
    g.marker.x > g.fill.x + g.fill.w,
    'a target above the value stands beyond the end of the fill',
  );
  // 0 and 1 land on the track's own end caps, where a rule reads as an artefact
  assert.equal(progressLayout({ type: 'progress', value: 0.5, target: 1 }, 400).marker, undefined);
  assert.equal(progressLayout({ type: 'progress', value: 0.5, target: 0 }, 400).marker, undefined);
});

test(':::status — one badge per comma, its severity carried by its own prefix', () => {
  const badge = blocksOf(
    parseDeck('# S\n\n:::status\nScope, Schedule\n!Budget, ?Note\n!!Risks\n!\n:::\n'),
  )[0];
  assert.deepEqual(badge.items, [
    { text: 'Scope', kind: 'success' },
    { text: 'Schedule', kind: 'success' },
    { text: 'Budget', kind: 'warning' },
    { text: 'Note', kind: 'info' },
    { text: 'Risks', kind: 'danger' },
    // a prefix with no label produces no badge at all
  ]);
});

// The inline rule is hand-rolled (no plugin), so the hostile inputs are the
// test: each one must leave the `==` as the literal text it is, without
// swallowing the rest of the paragraph.
test('==badge== inline: the tint travels on the run, and the hostile inputs stay literal', () => {
  const runs = (src) => blocksOf(parseDeck(`# B\n\n${src}\n`))[0].runs;

  const ok = runs('An ==Action== and an ==!Urgent== one.');
  assert.deepEqual(
    ok.filter((r) => r.badge),
    [
      { text: 'Action', badge: 'success', bold: undefined, italic: undefined, link: undefined },
      { text: 'Urgent', badge: 'warning', bold: undefined, italic: undefined, link: undefined },
    ],
  );
  // the markers and the prefix are syntax: they never reach the slide
  assert.equal(runsToText(ok), 'An Action and an Urgent one.');

  // A `==` inside a code span is never badged — the span is one token by the
  // time the cursor could reach it. Two pairs, so the case cannot pass merely
  // for want of a closing marker.
  const code = runs('Compare `a == b == c` here.');
  assert.ok(!code.some((r) => r.badge), 'no badge inside a code span');
  assert.ok(code.some((r) => r.code && r.text === 'a == b == c'));

  // The other direction, and this one IS a choice: a badge that opens before a
  // span takes the span with it, backticks and all, and its label keeps them
  // literally. Someone who wants code inside a badge has to know it will not
  // come out as code.
  const swallow = runs('==A `x` B== after.');
  assert.deepEqual(
    swallow.filter((r) => r.badge).map((r) => r.text),
    ['A `x` B'],
  );
  assert.ok(!swallow.some((r) => r.code), 'the span inside a badge is not a code run');

  // A run of `=` longer than the marker declines, and — the part that makes
  // the guard load-bearing — declines WITHOUT eating the badge that follows.
  // Ungarded, the rule reopens at the second `=` and pairs it with the next
  // `==` in the paragraph, badging "= signs and".
  const after = runs('Four ==== signs and ==Action== after.');
  const badged = after.filter((r) => r.badge);
  assert.equal(badged.length, 1, 'the real badge after the run of "=" survives');
  assert.equal(badged[0].text, 'Action');
  assert.equal(runsToText(after), 'Four ==== signs and Action after.');

  // The same guard seen from the other side: the later `==` pair is a badge,
  // and it is the one the author wrote — not the text between the run of `=`
  // and it. Unguarded this badges "= b" and the sentence loses its middle.
  const run3 = runs('a === b == c == d');
  assert.deepEqual(
    run3.filter((r) => r.badge).map((r) => r.text),
    ['c'],
  );
  assert.equal(runsToText(run3), 'a === b c d');

  for (const [src, why] of [
    ['An ==unclosed badge.', 'unclosed'],
    ['Four ==== signs.', 'a longer run of "=" is not a marker'],
    ['x ===Weird=== y', 'three "=" is not a marker either, on both sides'],
    ['Empty == == markers.', 'nothing but blanks between the markers'],
    ['A bare ==!== prefix.', 'a prefix with no label'],
    ['Across ==a\nline== break.', 'a badge never spans a line'],
  ]) {
    const out = runs(src);
    assert.ok(!out.some((r) => r.badge), `${why}: no badge expected in ${JSON.stringify(src)}`);
    // and the text is given back whole — a rule that swallowed the rest of the
    // paragraph would also produce "no badge"
    assert.equal(runsToText(out).replace(/\s+/g, ' '), src.replace(/\s+/g, ' '), why);
  }
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

test('table: the delimiter row is read as a per-column alignment', () => {
  const tableOf = (src) =>
    parseDeck(`# T\n\n${src}`)
      .slides[0].sections.flatMap((s) => s.blocks)
      .find((b) => b.type === 'table');

  // the four forms Markdown offers, in one table: no colon, left, both, right
  const aligned = tableOf('| a | b | c | d |\n|---|:--|:-:|--:|\n| 1 | 2 | 3 | 4 |\n');
  assert.deepEqual(aligned.align, ['left', 'left', 'center', 'right']);

  // a plain delimiter row asks for nothing, and must therefore CHANGE nothing:
  // an `align: ["left", "left"]` here would move every existing scene
  const plain = tableOf('| a | b |\n|---|---|\n| 1 | 2 |\n');
  assert.equal('align' in plain, false, 'an unstyled table must carry no align key');

  // the column is recorded ONCE, from the header: markdown-it repeats the same
  // style on every body cell, and one entry per cell would suggest a per-cell
  // syntax that Markdown does not have
  assert.equal(aligned.align.length, aligned.header.length);
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

test("an icon's alt slot carries intent words: an ink, a size, in any order", () => {
  const icon = (alt) => blocksOf(parseDeck(`# S\n\n![${alt}](lucide:leaf)\n`))[0];

  // the default has to stay EXACTLY the block that existed before sizes did:
  // one extra key and every golden moves
  assert.deepEqual(icon(''), { type: 'icon', name: 'leaf', color: 'primary', line: 3 });

  assert.equal(icon('large').size, 'large');
  assert.equal(icon('large').color, 'primary', 'a size alone leaves the ink at its default');
  assert.equal(icon('neutral').size, undefined, 'an ink alone adds no size key');

  assert.equal(icon('line').size, 'line', 'the fourth word, sized on a line of text');

  const both = icon('neutral small');
  assert.equal(both.color, 'neutral');
  assert.equal(both.size, 'small');
  const reversed = icon('small neutral');
  assert.equal(reversed.color, 'neutral', 'the order of the words is free');
  assert.equal(reversed.size, 'small');

  // a LONE word that names neither is not silently swallowed: it travels to
  // validation, and the icon still draws
  const wrong = icon('big');
  assert.deepEqual(wrong.unknownWords, ['big']);
  assert.equal(wrong.size, undefined);
  assert.equal(wrong.color, 'primary');

  // the words are matched lowercased, exactly like the icon name beside them —
  // sentence-casing an alt is the habit of a slot that used to hold prose
  assert.equal(icon('Large').size, 'large');
  assert.equal(icon('Neutral Small').color, 'neutral');
  assert.equal(icon('Neutral Small').size, 'small');

  // an image is NOT an icon: its alt slot is a role or alternative text, and
  // "large" there is what a screen reader will read out
  const image = blocksOf(parseDeck('# S\n\n![large](photo.png)\n'))[0];
  assert.equal(image.type, 'image');
  assert.equal(image.alt, 'large');
  assert.equal(image.size, undefined);
});

// The rule that keeps the slot usable: a sentence is prose, and prose is read
// as nothing at all. Picking one vocabulary word out of a description drew a
// white icon on a white slide, and said nothing — the alt was a description in
// every deck written before the words existed.
test("an icon's alt is intent ONLY when it is nothing but intent", () => {
  const icon = (alt) => blocksOf(parseDeck(`# S\n\n![${alt}](lucide:arrow-right)\n`))[0];

  const prose = icon('A white arrow');
  assert.equal(prose.color, 'primary', 'the ink inside a sentence is a word, not an intent');
  assert.equal(prose.size, undefined);
  assert.equal(prose.unknownWords, undefined, 'and prose is not a wall of warnings either');
  assert.equal(icon('the neutral zone').color, 'primary');

  // one word away from being vocabulary is still prose
  assert.equal(icon('white arrow').color, 'primary');
  assert.equal(icon('white arrow').unknownWords, undefined);

  // a second word of a category already named loses, and says so
  const two = icon('neutral white');
  assert.equal(two.color, 'neutral', 'the first word written wins');
  assert.deepEqual(two.duplicateWords, ['white']);
  assert.deepEqual(icon('small large').duplicateWords, ['large']);
  assert.equal(icon('neutral small').duplicateWords, undefined, 'one of each is not a conflict');
});

test('UNKNOWN_ICON_WORD names the word that was dropped, and suggests the nearest one', () => {
  const diags = validateDeck('# S\n\n![lrage](lucide:leaf)\n').filter(
    (d) => d.code === 'UNKNOWN_ICON_WORD',
  );
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'warning', 'the icon still draws');
  assert.equal(diags[0].line, 3);
  assert.match(diags[0].message, /"lrage"/);
  assert.equal(diags[0].suggestion, 'large');

  // nothing at all for the words that ARE the vocabulary
  assert.equal(
    validateDeck('# S\n\n![white large](lucide:leaf)\n').filter(
      (d) => d.code === 'UNKNOWN_ICON_WORD',
    ).length,
    0,
  );
  // nor for a description: it is read as nothing, so there is nothing to
  // report — ONE warning per alt at the very most, never one per word
  assert.equal(
    validateDeck('# S\n\n![A green leaf, growing](lucide:leaf)\n').filter(
      (d) => d.code === 'UNKNOWN_ICON_WORD',
    ).length,
    0,
  );
});

test('ICON_WORD_CONFLICT names the word that lost, and the one that won', () => {
  const diags = validateDeck('# S\n\n![neutral white](lucide:leaf)\n').filter(
    (d) => d.code === 'ICON_WORD_CONFLICT',
  );
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'warning', 'the icon still draws');
  assert.equal(diags[0].line, 3);
  assert.match(diags[0].message, /"white" is ignored/);
  assert.match(diags[0].message, /"neutral" was written first/);
  // a size conflict reads as a size conflict
  assert.match(
    validateDeck('# S\n\n![small large](lucide:leaf)\n').find(
      (d) => d.code === 'ICON_WORD_CONFLICT',
    ).message,
    /two sizes/,
  );
  assert.equal(
    validateDeck('# S\n\n![neutral small](lucide:leaf)\n').filter(
      (d) => d.code === 'ICON_WORD_CONFLICT',
    ).length,
    0,
  );
});

// A bullet, a heading and a cell all hold RUNS, and pushRun drops an image in
// each of them the same way. Reporting only the cell sent an author who moved
// the icon out of the table straight into the next silent loss.
test('a bullet and a heading record what they had to drop, exactly as a cell does', () => {
  const blocks = (src) => blocksOf(parseDeck(src));

  const list = blocks('# S\n\n- ![](lucide:check) Done\n- Plain\n')[0];
  assert.deepEqual(list.dropped, ['icon']);
  assert.equal(list.items[0].runs[0].text, 'Done', 'and the space the icon left goes with it');
  assert.equal(list.items[1].runs[0].text, 'Plain');
  assert.equal(blocks('# S\n\n- one\n- two\n')[0].dropped, undefined, 'no key without a loss');

  // a ### is a block; a ## and a # become a section title and a slide title,
  // and the loss travels with them to where validation can name it
  const deep = blocks('# S\n\n### ![A chart](chart.png) Deep\n')[0];
  assert.deepEqual(deep.dropped, ['image']);
  assert.equal(runsToText(deep.runs), 'Deep');
  const section = parseDeck('# S\n\n## ![](lucide:check) Head\n\ntext\n').slides[0].sections[0];
  assert.deepEqual(section.headingDropped, ['icon']);
  assert.equal(section.headingLine, 3);
  const titled = parseDeck('# ![](lucide:check) Title\n\ntext\n').slides[0];
  assert.deepEqual(titled.headingDropped, ['icon']);
  assert.equal(titled.title, 'Title');
});

test('LIST_CONTENT_DROPPED and HEADING_CONTENT_DROPPED name what does work instead', () => {
  const codes = (src) => validateDeck(src).filter((d) => /_CONTENT_DROPPED$/.test(d.code));

  const list = codes('# S\n\n- ![](lucide:check) Done\n')[0];
  assert.equal(list.code, 'LIST_CONTENT_DROPPED');
  assert.equal(list.severity, 'warning');
  assert.equal(list.line, 3);
  assert.match(list.message, /badge/, 'a diagnostic that only says "no" sends nobody anywhere');

  const head = codes('# S\n\n## ![](lucide:check) Head\n\ntext\n')[0];
  assert.equal(head.code, 'HEADING_CONTENT_DROPPED');
  assert.equal(head.line, 3);
  assert.match(head.message, /on its own line/);

  assert.deepEqual(
    codes('# S\n\n- one\n\n## Head\n\ntext\n'),
    [],
    'nothing to report, nothing said',
  );
});

// A cell holds runs, and pushRun has always dropped an image inside one — the
// natural place to put a status icon, and the one place the loss was mute.
test('an image in a table cell is recorded as dropped, never swallowed in silence', () => {
  const table = (cell) =>
    blocksOf(parseDeck(`# T\n\n| Item | State |\n|---|---|\n| Permits | ${cell} |\n`))[0];

  assert.deepEqual(table('![](lucide:check)').dropped, ['icon']);
  assert.deepEqual(table('![A chart](chart.png)').dropped, ['image']);
  // the cell still renders whatever text sat beside it
  const mixed = table('![](lucide:check) done');
  assert.deepEqual(mixed.dropped, ['icon']);
  assert.equal(mixed.rows[0][1][0].text.trim(), 'done');
  // one entry per TYPE, not per occurrence: three icons are one sentence to read
  assert.deepEqual(table('![](lucide:a) ![](lucide:b) ![](c.png)').dropped, ['icon', 'image']);

  // and a table with no image at all carries no key — every existing golden
  assert.equal(table('==Delivered==').dropped, undefined);

  // `html: true` accepts an <img> written as raw HTML: the same loss as the
  // Markdown spelling, and the tag PRINTED as cell text was the worst of the
  // three outcomes
  const raw = table('<img src="x.png">');
  assert.deepEqual(raw.dropped, ['image']);
  assert.equal(runsToText(raw.rows[0][1]), '', 'the tag itself never reaches the slide');
  // any other inline HTML stays the text it has always been
  assert.equal(runsToText(table('a <b>bold</b> word').rows[0][1]), 'a <b>bold</b> word');
});

test('TABLE_CONTENT_DROPPED names the alternative that does work', () => {
  const diags = validateDeck(
    '# T\n\n| Item | State |\n|---|---|\n| Permits | ![](lucide:check) |\n',
  );
  const d = diags.find((x) => x.code === 'TABLE_CONTENT_DROPPED');
  assert.equal(d?.severity, 'warning');
  assert.equal(d.line, 3);
  assert.match(d.message, /inline badge/, 'a diagnostic that only says "no" sends nobody anywhere');
  // the badge it points at is genuinely available in a cell, in both outputs
  const cell = blocksOf(
    parseDeck('# T\n\n| Item | State |\n|---|---|\n| Permits | ==!At risk== |\n'),
  )[0].rows[0][1];
  assert.equal(cell.length, 1);
  assert.equal(cell[0].text, 'At risk');
  assert.equal(cell[0].badge, 'warning');
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
