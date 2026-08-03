/**
 * Marp dialect (`marp: true`): slide splitting, titles, presenter notes,
 * directives (mapped, silent, reported), `![bg]` images, fragmented lists —
 * and the lutrin extensions that keep working inside a Marp deck.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck, runsToText } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { validateDeck } from '../src/deck/validate.mjs';
import {
  classifyMarpDirective,
  marpImage,
  parseHeadingDivider,
  parseMarpComment,
} from '../src/deck/marp.mjs';

const FM = '---\nmarp: true\n---\n\n';
const blocksOf = (deck, i = 0) => deck.slides[i].sections.flatMap((s) => s.blocks);

// ------ detection ----------------------------------------------------------

test('without marp: true, the lutrin DSL applies (a # H1 splits)', () => {
  const deck = parseDeck('# One\n\ntext\n\n# Two\n\ntext\n');
  assert.equal(deck.slides.length, 2);
});

test('marp: true — slides split on --- only, never on a heading', () => {
  const deck = parseDeck(`${FM}# One\n\ntext\n\n# Two\n\nmore\n\n---\n\n# Three\n`);
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, 'One');
  // the second # of the same slide opens a section, where the author put it
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.equal(runsToText(headed[0].heading), 'Two');
  assert.equal(deck.slides[1].title, 'Three');
});

test('marp: false stays in the lutrin DSL', () => {
  const deck = parseDeck('---\nmarp: false\n---\n\n# A\n\nx\n\n# B\n\ny\n');
  assert.equal(deck.slides.length, 2);
});

test('*** and ___ split slides too (CommonMark hr)', () => {
  const deck = parseDeck(`${FM}# A\n\nx\n\n***\n\n# B\n\ny\n\n___\n\n# C\n`);
  assert.equal(deck.slides.length, 3);
});

// ------ titles -------------------------------------------------------------

test('the first heading titles the slide — # or ##', () => {
  const deck = parseDeck(`${FM}## Only an h2\n\ntext\n\n---\n\n# An h1\n\ntext\n`);
  assert.equal(deck.slides[0].title, 'Only an h2');
  assert.equal(deck.slides[1].title, 'An h1');
});

test('<!-- fit --> is stripped from the title', () => {
  const deck = parseDeck(`${FM}# <!-- fit --> Big title\n\ntext\n`);
  assert.equal(deck.slides[0].title, 'Big title');
});

test('a heading met after content opens a section, it does not retitle', () => {
  const deck = parseDeck(`${FM}Some intro text.\n\n## Later\n\n- a\n`);
  assert.equal(deck.slides[0].title, null);
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.equal(runsToText(headed[0].heading), 'Later');
});

test('## title + ### subheadings: the Marp convention maps to sections', () => {
  const deck = parseDeck(`${FM}## Title\n\n### Left\n\n- a\n\n### Right\n\n- b\n`);
  assert.equal(deck.slides[0].title, 'Title');
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.deepEqual(
    headed.map((s) => runsToText(s.heading)),
    ['Left', 'Right'],
  );
  // and no stray parse-time bookkeeping leaks into the IR
  assert.equal('marpTitleDepth' in deck.slides[0], false);
  assert.equal('marpSectionDepth' in deck.slides[0], false);
});

test('the FIRST subheading level used below the title opens the sections', () => {
  // #### directly under a ## title (the <div class="columns"> idiom)
  const deck = parseDeck(`${FM}## Title\n\n#### Part 1\n\n- a\n\n#### Part 2\n\n- b\n`);
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.deepEqual(
    headed.map((s) => runsToText(s.heading)),
    ['Part 1', 'Part 2'],
  );
});

test('below the section level, headings stay subheadings in the flow', () => {
  const deck = parseDeck(`${FM}## Title\n\n### Section\n\n#### Deep\n\ntext\n`);
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.deepEqual(
    headed.map((s) => runsToText(s.heading)),
    ['Section'],
  );
  const heading = blocksOf(deck).find((b) => b.type === 'heading');
  assert.equal(heading.depth, 4);
});

test('the <div class="columns"> idiom: divs ignored, the headings structure', () => {
  const source = `${FM}## Comparison\n\n<div class="columns">\n<div>\n\n#### Part 1\n\n- Lorem ipsum\n\n</div>\n<div>\n\n#### Part 2\n\n- Stet clita\n\n</div>\n</div>\n`;
  const deck = parseDeck(source);
  assert.equal(deck.slides[0].title, 'Comparison');
  const headed = deck.slides[0].sections.filter((s) => s.heading);
  assert.deepEqual(
    headed.map((s) => runsToText(s.heading)),
    ['Part 1', 'Part 2'],
  );
  // two titled sections → the engine infers columns
  assert.equal(buildScenes(deck)[0].layout, 'two-columns');
});

// ------ headingDivider -----------------------------------------------------

test('headingDivider: 2 splits before every #/## heading', () => {
  const deck = parseDeck(
    '---\nmarp: true\nheadingDivider: 2\n---\n\n# One\n\nx\n\n## Two\n\ny\n\n### Three\n\nz\n',
  );
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, 'One');
  assert.equal(deck.slides[1].title, 'Two');
});

test('headingDivider: [2] splits at level 2 only', () => {
  const deck = parseDeck(
    '---\nmarp: true\nheadingDivider: [2]\n---\n\n# One\n\nx\n\n# Bis\n\n## Two\n\ny\n',
  );
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[1].title, 'Two');
});

test('headingDivider can also be set by a comment directive', () => {
  const deck = parseDeck(`${FM}<!-- headingDivider: 1 -->\n\n# One\n\nx\n\n# Two\n\ny\n`);
  assert.equal(deck.slides.length, 2);
});

test('parseHeadingDivider: numbers, arrays, garbage', () => {
  assert.deepEqual([...parseHeadingDivider('3')], [1, 2, 3]);
  assert.deepEqual([...parseHeadingDivider('[1, 3]')], [1, 3]);
  assert.equal(parseHeadingDivider('7'), null);
  assert.equal(parseHeadingDivider('x'), null);
});

// ------ presenter notes ----------------------------------------------------

test('a plain HTML comment is a presenter note', () => {
  const deck = parseDeck(`${FM}# T\n\ntext\n\n<!-- remember the schedule -->\n`);
  assert.deepEqual(deck.slides[0].notes, ['remember the schedule']);
});

test('several comments accumulate, line breaks preserved', () => {
  const deck = parseDeck(`${FM}# T\n\nx\n\n<!-- first -->\n\n<!-- second\nline two -->\n`);
  assert.deepEqual(deck.slides[0].notes, ['first', 'second\nline two']);
});

test('a note before the first content attaches to the slide that opens', () => {
  const deck = parseDeck(`${FM}<!-- early note -->\n\n# T\n\ntext\n`);
  assert.deepEqual(deck.slides[0].notes, ['early note']);
});

test('a directive comment is NOT a note', () => {
  const deck = parseDeck(`${FM}# T\n\nx\n\n<!-- _class: lead -->\n`);
  assert.deepEqual(deck.slides[0].notes, []);
});

test('a comment mixing unknown keys with prose stays a note', () => {
  const deck = parseDeck(`${FM}# T\n\nx\n\n<!-- Remember:\nspeak slowly -->\n`);
  assert.deepEqual(deck.slides[0].notes, ['Remember:\nspeak slowly']);
});

test('an inline comment inside a paragraph is stripped from the text', () => {
  const deck = parseDeck(`${FM}# T\n\nbefore <!-- hidden --> after\n`);
  const para = blocksOf(deck).find((b) => b.type === 'para');
  assert.ok(!runsToText(para.runs).includes('hidden'));
});

// ------ directives ---------------------------------------------------------

test('footer: (frontmatter or directive) maps onto the deck footer', () => {
  const fm = parseDeck('---\nmarp: true\nfooter: From frontmatter\n---\n\n# T\n\nx\n');
  assert.equal(fm.meta.footer, 'From frontmatter');
  const dir = parseDeck(`${FM}# T\n\nx\n\n<!-- footer: From a comment -->\n`);
  assert.equal(dir.meta.footer, 'From a comment');
});

test('theme: is moved out of kit resolution and reported', () => {
  const deck = parseDeck('---\nmarp: true\ntheme: gaia\n---\n\n# T\n\nx\n');
  assert.equal(deck.meta.theme, undefined);
  assert.equal(deck.meta.marpTheme, 'gaia');
  assert.ok(deck.marpIgnored.some((d) => d.key === 'theme'));
});

test('cosmetic directives are accepted in silence', () => {
  const deck = parseDeck(
    '---\nmarp: true\npaginate: true\nclass: lead\nmath: katex\nsize: 16:9\n---\n\n# T\n\nx\n\n<!-- _paginate: false -->\n<!-- class: invert -->\n',
  );
  assert.equal(deck.marpIgnored, undefined);
  assert.deepEqual(deck.slides[0].notes, []);
});

test('directives with no equivalent are collected, with their line', () => {
  const deck = parseDeck(
    '---\nmarp: true\nstyle: |\nsize: 4:3\n---\n\n# T\n\nx\n\n<!-- backgroundColor: aqua -->\n<!-- header: Chapter one -->\n',
  );
  const keys = deck.marpIgnored.map((d) => d.key).sort();
  assert.deepEqual(keys, ['backgroundColor', 'header', 'size', 'style']);
  const bg = deck.marpIgnored.find((d) => d.key === 'backgroundColor');
  assert.equal(typeof bg.line, 'number');
});

test('a multi-directive comment applies each line', () => {
  const deck = parseDeck(`${FM}<!-- headingDivider: 1\nfooter: Both -->\n\n# A\n\nx\n\n# B\n\ny\n`);
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.meta.footer, 'Both');
});

test('classifyMarpDirective sorts the directive families', () => {
  assert.equal(classifyMarpDirective('layout'), 'lutrin');
  assert.equal(classifyMarpDirective('footer'), 'footer');
  assert.equal(classifyMarpDirective('headingDivider'), 'divider');
  assert.equal(classifyMarpDirective('_class'), 'silent');
  assert.equal(classifyMarpDirective('backgroundImage'), 'ignored');
  assert.equal(classifyMarpDirective('_footer'), 'ignored');
});

test('parseMarpComment: directives vs note vs raw HTML', () => {
  assert.deepEqual(parseMarpComment('<!-- paginate: true -->').directives, [
    { key: 'paginate', value: 'true' },
  ]);
  assert.deepEqual(parseMarpComment('<!-- just a note -->').notes, ['just a note']);
  assert.equal(parseMarpComment('<div>markup</div>'), null);
  // an unknown key alone is a note, like Marp reads it
  assert.deepEqual(parseMarpComment('<!-- foo: bar -->').notes, ['foo: bar']);
  // each comment of a block is classified on its own: directive AND note
  const mixed = parseMarpComment('<!-- footer: Conf --><!-- speak slowly -->');
  assert.deepEqual(mixed.directives, [{ key: 'footer', value: 'Conf' }]);
  assert.deepEqual(mixed.notes, ['speak slowly']);
});

test('bare <!-- animate --> and multiline <!-- notes: --> keep working (lutrin grammar)', () => {
  const deck = parseDeck(
    `${FM}# T\n\n- a\n\n<!-- animate -->\n\n<!-- notes: two\nlines here -->\n`,
  );
  assert.equal(deck.slides[0].animate, true);
  assert.deepEqual(deck.slides[0].notes, ['two\nlines here']);
});

test('headingDivider is global: a late comment applies to earlier slides too', () => {
  const deck = parseDeck(`${FM}# A\n\nx\n\n# B\n\ny\n\n<!-- headingDivider: 1 -->\n\n# C\n\nz\n`);
  assert.deepEqual(
    deck.slides.map((s) => s.title),
    ['A', 'B', 'C'],
  );
});

test('_headingDivider is not a Marp directive: alone it stays a note, it never splits', () => {
  const deck = parseDeck(`${FM}# A\n\nx\n\n<!-- _headingDivider: 1 -->\n\n# B\n\ny\n`);
  assert.equal(deck.slides.length, 1);
  assert.deepEqual(deck.slides[0].notes, ['_headingDivider: 1']);
});

test('bg is recognized at any position of the alt', () => {
  const b = marpImage({ type: 'image', src: 'x.png', role: 'auto', alt: 'fit bg' });
  assert.equal(b.role, 'background');
});

test('![bg left] before the title: the heading still titles the slide', () => {
  const deck = parseDeck(`${FM}![bg left](a.png)\n\n# Split title\n\nThe text side.\n`);
  assert.equal(deck.slides[0].title, 'Split title');
  assert.equal(blocksOf(deck).find((b) => b.type === 'image').role, 'left');
});

test('an empty Marp slide carrying only a note exists, without ORPHAN_DIRECTIVE', () => {
  const source = `${FM}# A\n\nx\n\n---\n\n<!-- note for empty slide -->\n\n---\n\n# B\n\ny\n`;
  const deck = parseDeck(source);
  assert.equal(deck.slides.length, 3);
  assert.deepEqual(deck.slides[1].notes, ['note for empty slide']);
  assert.ok(!validateDeck(source).some((d) => d.code === 'ORPHAN_DIRECTIVE'));
});

test('an inline directive comment is routed, not lost', () => {
  const deck = parseDeck(`${FM}# T\n\nsome text <!-- _backgroundColor: red --> more\n`);
  assert.ok(deck.marpIgnored.some((d) => d.key === '_backgroundColor'));
  // and an inline prose comment becomes a note
  const notes = parseDeck(`${FM}# T\n\nsome text <!-- aside --> more\n`);
  assert.deepEqual(notes.slides[0].notes, ['aside']);
});

test('marp: "true" (quoted) reads as Marp everywhere — parse AND validation', () => {
  const source = '---\nmarp: "true"\n---\n\n# T\n\n:::junk\nprose\n:::\n';
  assert.deepEqual(parseDeck(source).slides[0].notes, []);
  assert.ok(!validateDeck(source).some((d) => d.code === 'UNKNOWN_DIRECTIVE'));
});

test('a rejected pseudo-frontmatter with a marp line stays a lutrin deck, scan included', () => {
  // `# deck metadata` fails the strict frontmatter predicate: the block is
  // body, the deck is lutrin — the ::: scan must still fire
  const source = '---\n# deck metadata\nmarp: true\n---\n\n# T\n\n:::Info\noops\n:::\n';
  const diag = validateDeck(source).find((d) => d.code === 'UNKNOWN_DIRECTIVE');
  assert.ok(diag);
  assert.equal(diag.line, 8);
});

test('a Marp deck with only title: metadata is EMPTY_DECK, its directives reported', () => {
  const diags = validateDeck('---\nmarp: true\ntitle: Meta only\nstyle: x\n---\n');
  assert.ok(diags.some((d) => d.code === 'EMPTY_DECK'));
  assert.ok(diags.some((d) => d.code === 'MARP_DIRECTIVE_IGNORED'));
});

// ------ images -------------------------------------------------------------

test('![bg] becomes the slide background, before the title included', () => {
  const deck = parseDeck(`${FM}![bg](wall.png)\n\n# Title\n\ntext\n`);
  assert.equal(deck.slides[0].title, 'Title');
  const img = blocksOf(deck).find((b) => b.type === 'image');
  assert.equal(img.role, 'background');
});

test('bg left / right become the split sides, sizes consumed', () => {
  const deck = parseDeck(
    `${FM}# T\n\n![bg left](a.png)\n\ntext\n\n---\n\n# U\n\n![bg right:33%](b.png)\n\ntext\n`,
  );
  assert.equal(blocksOf(deck, 0).find((b) => b.type === 'image').role, 'left');
  assert.equal(blocksOf(deck, 1).find((b) => b.type === 'image').role, 'right');
});

test('sizing keywords and CSS filters are consumed, the alt text remains', () => {
  const b = marpImage({ type: 'image', src: 'x.png', role: 'auto', alt: 'w:300 blur:5px a cat' });
  assert.equal(b.alt, 'a cat');
  assert.equal(b.role, 'auto');
  const bg = marpImage({ type: 'image', src: 'x.png', role: 'auto', alt: 'bg fit vertical 150%' });
  assert.equal(bg.role, 'background');
  assert.equal(bg.alt, '');
});

test('several ![bg] on one slide: the first wins, the others rejoin the flow', () => {
  const deck = parseDeck(`${FM}# T\n\n![bg](a.png)\n\n![bg](b.png)\n`);
  const images = blocksOf(deck).filter((b) => b.type === 'image');
  assert.deepEqual(
    images.map((b) => b.role),
    ['background', 'auto'],
  );
});

// ------ fragmented lists ---------------------------------------------------

test('* bullets are fragmented: the slide animates', () => {
  const deck = parseDeck(`${FM}# T\n\n* one\n* two\n`);
  assert.equal(deck.slides[0].animate, true);
});

test('- bullets stay static', () => {
  const deck = parseDeck(`${FM}# T\n\n- one\n- two\n`);
  assert.equal(deck.slides[0].animate, null);
});

test('1) items are fragmented, 1. items are not', () => {
  const frag = parseDeck(`${FM}# T\n\n1) one\n2) two\n`);
  assert.equal(frag.slides[0].animate, true);
  const flat = parseDeck(`${FM}# T\n\n1. one\n2. two\n`);
  assert.equal(flat.slides[0].animate, null);
});

test('<!-- animate: none --> wins over a fragmented list', () => {
  const deck = parseDeck(`${FM}# T\n\n<!-- animate: none -->\n\n* one\n`);
  assert.equal(deck.slides[0].animate, false);
});

test('the fragmented flag never leaks into the IR', () => {
  const deck = parseDeck(`${FM}# T\n\n* one\n\n:::info\n* nested\n:::\n`);
  const all = JSON.stringify(deck);
  assert.ok(!all.includes('fragmented'));
});

// ------ lutrin extensions inside a Marp deck -------------------------------

test('<!-- layout --> , <!-- notes --> and :::metric keep working', () => {
  const deck = parseDeck(
    `${FM}# T\n\n<!-- layout: metrics -->\n<!-- notes: speak slowly -->\n\n:::metric\n42 %\nShare\n:::\n`,
  );
  assert.equal(deck.slides[0].layout, 'metrics');
  assert.deepEqual(deck.slides[0].notes, ['speak slowly']);
  assert.equal(blocksOf(deck).find((b) => b.type === 'metric').value, '42 %');
});

test('$$…$$ stays an equation', () => {
  const deck = parseDeck(`${FM}# T\n\n$$x^2$$\n`);
  assert.equal(blocksOf(deck)[0].type, 'math');
});

// ------ scenes and validation ---------------------------------------------

test('no implicit cover: meta title is metadata, not a slide', () => {
  const marp = parseDeck('---\nmarp: true\ntitle: Meta title\n---\n\n# Own cover\n\nsub\n');
  const scenes = buildScenes(marp);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].title, 'Own cover');
});

test('validate: MARP_DIRECTIVE_IGNORED is informative and positioned', () => {
  const source =
    '---\nmarp: true\ntheme: gaia\n---\n\n# T\n\nx\n\n<!-- backgroundColor: aqua -->\n';
  const diags = validateDeck(source);
  const marp = diags.filter((d) => d.code === 'MARP_DIRECTIVE_IGNORED');
  assert.equal(marp.length, 2);
  assert.ok(marp.every((d) => d.severity === 'info'));
  assert.equal(marp[0].line, 3); // theme: on line 3
  assert.equal(marp[1].line, 10); // the comment
  // and the Marp theme never reaches kit resolution
  assert.ok(!diags.some((d) => d.code.startsWith('KIT_') || d.code.startsWith('THEME_')));
});

test('validate: no UNKNOWN_DIRECTIVE on ::: prose in a Marp deck', () => {
  const diags = validateDeck(`${FM}# T\n\n:::whatever\nnot a directive here\n:::\n`);
  assert.ok(!diags.some((d) => d.code === 'UNKNOWN_DIRECTIVE'));
});

// `:::` is not part of the Marp syntax, so a line opening with it in a Marp
// deck is usually SOMEONE ELSE'S: a Docusaurus admonition, a Pandoc fenced div,
// or plain prose. The scan therefore narrows here rather than stopping — the
// one thing it still reports is the casing slip, because the callout plugin is
// registered in the Marp dialect too: `:::info` renders a real callout there,
// while `:::Info` opens nothing and prints its own colons onto the slide.
test('validate: :::Info in a Marp deck is still reported, positioned, with the lowercase fix', () => {
  const diags = validateDeck(`${FM}# T\n\n:::Info\nmiscased\n:::\n`).filter(
    (d) => d.code === 'UNKNOWN_DIRECTIVE',
  );
  assert.equal(diags.length, 1);
  assert.equal(diags[0].line, 7); // the ":::Info" line, frontmatter counted
  assert.equal(diags[0].suggestion, 'info');
  assert.match(diags[0].message, /lowercase/);
});

// A warning and NOT an error, deliberately: an error stops the compilation
// (cli.mjs writes nothing and exits 1 without --force). Turning a third-party
// deck that compiles today into one that refuses to is not a price a heuristic
// about someone else's syntax gets to charge.
test('validate: the Marp casing slip is a warning, never an error — an error would refuse a deck that compiles today', () => {
  const diags = validateDeck(`${FM}# T\n\n:::Info\nmiscased\n:::\n`);
  assert.equal(diags.find((d) => d.code === 'UNKNOWN_DIRECTIVE').severity, 'warning');
  assert.deepEqual(
    diags.filter((d) => d.severity === 'error'),
    [],
  );
});

test('validate: :::note in a Marp deck is left alone — an admonition is not a mistyped callout', () => {
  const diags = validateDeck(`${FM}# T\n\n:::note\nAn admonition from another generator.\n:::\n`);
  assert.deepEqual(
    diags.filter((d) => d.code === 'UNKNOWN_DIRECTIVE'),
    [],
  );
});

// The narrowing is a property of the DIALECT, not of the scan: the very same
// body outside Marp must still raise both errors, casing slip and foreign
// syntax alike. `marp: false` rather than a stripped frontmatter keeps the line
// numbers aligned, so the two readings compare line for line.
test('validate: outside the Marp dialect the same body is two errors, exactly as before', () => {
  const body = '# T\n\n:::Info\nmiscased\n:::\n\n:::note\nAn admonition.\n:::\n';
  const lutrin = validateDeck(`---\nmarp: false\n---\n\n${body}`).filter(
    (d) => d.code === 'UNKNOWN_DIRECTIVE',
  );
  assert.deepEqual(
    lutrin.map((d) => [d.severity, d.line]),
    [
      ['error', 7],
      ['error', 11],
    ],
  );
  // and the same body read as Marp keeps the casing slip alone, demoted
  const marp = validateDeck(`${FM}${body}`).filter((d) => d.code === 'UNKNOWN_DIRECTIVE');
  assert.deepEqual(
    marp.map((d) => [d.severity, d.line]),
    [['warning', 7]],
  );
});

test(':::info opens a real callout in a Marp deck, :::Info prints its colons', () => {
  const ok = blocksOf(parseDeck(`${FM}# T\n\n:::info\nCareful.\n:::\n`))[0];
  assert.equal(ok.type, 'alert');
  assert.equal(ok.kind, 'info');
  // what the diagnostic above exists for: the miscased form is not a callout
  // rendered plainly, it is the author's colons on the slide
  const slip = blocksOf(parseDeck(`${FM}# T\n\n:::Info\nCareful.\n:::\n`))[0];
  assert.equal(slip.type, 'para');
  assert.match(runsToText(slip.runs), /:::Info/);
});

// a fenced block is documentation ABOUT the DSL, not a use of it — the scan
// steps over it in the Marp dialect too, casing slip included
test('validate: the ::: scan stays off inside a fenced code block in a Marp deck', () => {
  const source = `${FM}# T\n\n\`\`\`md\n:::Info\nmiscased, but quoted\n:::\n\`\`\`\n`;
  assert.deepEqual(
    validateDeck(source).filter((d) => d.code === 'UNKNOWN_DIRECTIVE'),
    [],
  );
});

test('validate: a healthy Marp deck yields no error', () => {
  const source = `${FM}# Cover\n\nA subtitle line.\n\n---\n\n# Content\n\n* point one\n* point two\n\n![bg right](img.png)\n`;
  const errors = validateDeck(source).filter((d) => d.severity === 'error');
  assert.deepEqual(errors, []);
});
