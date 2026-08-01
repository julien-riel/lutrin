/**
 * Slicing module (slice.mjs): every source below runs the same four
 * invariants — alignment with parseDeck, slices that are exactly the lines
 * they announce, stability under self-replacement, parts that reparse to the
 * original IR — plus targeted assertions on the boundary rules (pending
 * directives, orphans, setext, fences, containers, Marp), on line endings
 * (CRLF sliceable, lone \r refused), and on spliceSlice — the guarded write
 * path, replayed against the corruption scenarios of the review.
 */

import './setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDeck } from '../src/deck/parse.mjs';
import { serializeParts, sliceDeck, spliceSlice, stripPositions } from '../src/deck/slice.mjs';
import { readAllBlocks } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPECIMEN = fs.readFileSync(
  path.join(here, '..', 'design', 'editor', 'specimen.deck.md'),
  'utf8',
);

/** The NAIVE line splice — no boundary guards. Kept as a foil: the
 *  spliceSlice tests below replay it to show the corruption each guard
 *  prevents, and checkInvariants uses it where identity must be exact. */
function splice(source, slide, text) {
  const lines = source.split('\n');
  lines.splice(slide.startLine - 1, slide.endLine - slide.startLine + 1, ...text.split('\n'));
  return lines.join('\n');
}

/** Runs spliceSlice on slide `index` and asserts THE invariant the guards
 *  exist for: every other slide of the result reparses deep-equal (positions
 *  aside) to what it was before the edit. Returns the new source. */
function spliceAndCheck(name, source, index, newText) {
  const sliced = sliceDeck(source);
  const before = parseDeck(source).slides.map(stripPositions);
  const { source: out } = spliceSlice(source, sliced.slides[index], newText);
  const after = parseDeck(out);
  assert.equal(after.slides.length, before.length, `${name}: slide count preserved`);
  after.slides.forEach((s, i) => {
    if (i === index) return;
    assert.deepEqual(stripPositions(s), before[i], `${name}: slide ${i} untouched`);
  });
  return out;
}

/** Same neutral idea as the module's own guard: a non-directive comment in
 *  front, so the serialized slice parses the way it would mid-file. */
const NEUTRAL = '<!-- neutral -->\n\n';

/** The four invariants every source must satisfy. Returns the slicing so the
 *  callers can add source-specific assertions. */
function checkInvariants(name, source) {
  const deck = parseDeck(source);
  const sliced = sliceDeck(source);
  assert.equal(sliced.sliceable, true, `${name}: sliceable`);
  assert.equal(sliced.lineCount, source.split('\n').length, `${name}: lineCount`);

  // 1. alignment with parseDeck — count, order, titles, explicit layouts
  assert.equal(sliced.slides.length, deck.slides.length, `${name}: slide count`);
  sliced.slides.forEach((s, i) => {
    assert.equal(s.index, i, `${name}: index of slide ${i}`);
    assert.equal(s.title, deck.slides[i].title ?? null, `${name}: title of slide ${i}`);
    assert.equal(s.layout, deck.slides[i].layout ?? null, `${name}: layout of slide ${i}`);
  });

  // 2. slices are exactly the lines they announce, disjoint and ordered;
  //    replacing a slice by itself is the identity
  const lines = source.split('\n');
  let prevEnd = 0;
  for (const s of sliced.slides) {
    assert.ok(s.startLine > prevEnd, `${name}: slices ordered and disjoint`);
    assert.ok(s.endLine >= s.startLine && s.endLine <= sliced.lineCount, `${name}: bounds`);
    assert.equal(
      s.source,
      lines.slice(s.startLine - 1, s.endLine).join('\n'),
      `${name}: slide ${s.index} is the lines it announces`,
    );
    assert.equal(splice(source, s, s.source), source, `${name}: identity splice ${s.index}`);
    prevEnd = s.endLine;
  }

  // 3. stability: a self-replacement changes neither bounds nor titles
  for (const s of sliced.slides) {
    const again = sliceDeck(splice(source, s, s.source));
    assert.equal(again.slides.length, sliced.slides.length, `${name}: stable count`);
    again.slides.forEach((t, i) => {
      assert.equal(t.title, sliced.slides[i].title, `${name}: stable title ${i}`);
      assert.equal(t.startLine, sliced.slides[i].startLine, `${name}: stable start ${i}`);
      assert.equal(t.endLine, sliced.slides[i].endLine, `${name}: stable end ${i}`);
    });
  }

  // 4. parts fidelity: the canonical serialization reparses to the same IR
  sliced.slides.forEach((s, i) => {
    if (s.parts === null) return;
    const re = parseDeck(`${NEUTRAL}${serializeParts(s.parts)}\n`);
    assert.equal(re.slides.length, 1, `${name}: parts of slide ${i} reparse to one slide`);
    assert.deepEqual(
      stripPositions(re.slides[0]),
      stripPositions(deck.slides[i]),
      `${name}: parts of slide ${i} are faithful`,
    );
  });

  return sliced;
}

// ---------------------------------------------------------------------------
// Real files

test('all-blocks fixture: invariants, and every slide is form-representable', () => {
  const sliced = checkInvariants('all-blocks', readAllBlocks());
  assert.ok(sliced.slides.length >= 10);
  // frontmatter (5 lines) + blank: the first slice starts at line 7 and the
  // frontmatter itself is glue
  assert.equal(sliced.slides[0].startLine, 7);
  for (const s of sliced.slides) {
    assert.notEqual(s.parts, null, `slide ${s.index} (${s.title}) should offer a form`);
  }
});

test('kit specimen: invariants over layouts, containers, charts and quotes', () => {
  const sliced = checkInvariants('specimen', SPECIMEN);
  const layouts = sliced.slides.map((s) => s.layout);
  assert.ok(layouts.includes('split'), 'explicit layouts surface on the slices');
});

// ---------------------------------------------------------------------------
// Frontmatter, BOM

test('frontmatter present: slices start after it, meta comes through', () => {
  const src = '---\ntitle: T\nauthor: A\n---\n\n# One\n\nbody\n\n---\n\n# Two\n\nmore\n';
  const sliced = checkInvariants('frontmatter', src);
  assert.equal(sliced.meta.title, 'T');
  assert.equal(sliced.slides[0].startLine, 6);
  assert.equal(sliced.slides[0].source, '# One\n\nbody');
});

test('frontmatter absent: the first slice may start at line 1', () => {
  const src = '# One\n\nbody\n\n---\n\n# Two\n\nmore\n';
  const sliced = checkInvariants('no frontmatter', src);
  assert.equal(sliced.slides[0].startLine, 1);
  assert.deepEqual(sliced.meta, {});
});

test('BOM: line numbers are unshifted and the frontmatter still reads', () => {
  const src = '\uFEFF---\ntitle: T\n---\n\n# A\n\nbody\n';
  const sliced = checkInvariants('BOM', src);
  assert.equal(sliced.meta.title, 'T');
  assert.equal(sliced.slides[0].startLine, 5);
});

// ---------------------------------------------------------------------------
// Directive ownership

test('pending directive between --- and # H1 belongs to the NEXT slide', () => {
  const src = '# A\n\na body\n\n---\n\n<!-- layout: quote -->\n\n# B\n\nb body\n';
  const sliced = checkInvariants('pending', src);
  const b = sliced.slides[1];
  assert.equal(b.layout, 'quote');
  // the comment line (7) opens the slice: it is inside, not glue
  assert.equal(b.startLine, 7);
  assert.ok(b.source.startsWith('<!-- layout: quote -->'));
  assert.equal(b.parts.layout, 'quote');
});

test('a comment with the previous slide still open belongs to the PREVIOUS one', () => {
  const src = '# A\n\na body\n\n<!-- notes: for A -->\n# B\n\nb body\n';
  const sliced = checkInvariants('open-slide comment', src);
  const deck = parseDeck(src);
  assert.deepEqual(deck.slides[0].notes, ['for A']);
  assert.equal(sliced.slides[0].endLine, 5, 'the note line closes slice A');
  assert.equal(sliced.slides[1].startLine, 6);
  assert.deepEqual(sliced.slides[0].parts.notes, ['for A']);
});

test('orphan directives are glue, reported by parseDeck, owned by nobody', () => {
  const src = '<!-- layout: ghost -->\n\n---\n\n# A\n\nbody\n';
  const sliced = checkInvariants('orphans', src);
  assert.equal(parseDeck(src).orphanDirectives?.[0]?.key, 'layout');
  assert.equal(sliced.slides.length, 1);
  assert.equal(sliced.slides[0].startLine, 5, 'the orphan comment stays out of every slice');
  assert.equal(sliced.slides[0].layout, null);
});

test('bare <!-- animate --> round-trips as the empty value', () => {
  const src = '# A\n\n<!-- animate -->\n\nbody\n';
  const sliced = checkInvariants('bare animate', src);
  assert.equal(sliced.slides[0].parts.animate, '');
  assert.match(serializeParts(sliced.slides[0].parts), /<!-- animate -->/);
});

// ---------------------------------------------------------------------------
// Boundary look-alikes the tokenizer must disarm

test('consecutive --- separators produce no phantom slide', () => {
  const src = '# A\n\nbody\n\n---\n---\n\n# B\n\nmore\n';
  const sliced = checkInvariants('double hr', src);
  assert.equal(sliced.slides.length, 2);
  assert.equal(sliced.slides[1].startLine, 8);
});

test('*** is a separator too', () => {
  const src = '# A\n\na\n\n***\n\n# B\n\nb\n';
  const sliced = checkInvariants('*** hr', src);
  assert.equal(sliced.slides.length, 2);
});

test('setext Texte/--- is a section heading, not a separator', () => {
  const src = '# A\n\nTexte\n---\n\nbody\n';
  const sliced = checkInvariants('setext', src);
  assert.equal(sliced.slides.length, 1);
  assert.equal(sliced.slides[0].endLine, 6, 'the underline is inside the slice');
  assert.equal(sliced.slides[0].parts.sections[0].heading, 'Texte');
  assert.equal(sliced.slides[0].parts.sections[0].body, 'body');
});

test('# and --- inside a fence cut nothing', () => {
  const src = '# A\n\n```md\n# not a slide\n---\n```\n\ntail\n';
  const sliced = checkInvariants('fence', src);
  assert.equal(sliced.slides.length, 1);
  assert.equal(sliced.slides[0].endLine, 8);
});

test('# and --- inside a ::: container cut nothing, and the closing ::: stays inside', () => {
  const src = '# A\n\n:::info\n# not a slide\n---\n:::\n\n# B\n\nb\n';
  const sliced = checkInvariants('container', src);
  assert.equal(sliced.slides.length, 2);
  assert.ok(
    sliced.slides[0].source.endsWith(':::'),
    'the closing fence belongs to the slice, not to the glue',
  );
  assert.equal(sliced.slides[1].startLine, 8);
});

// ---------------------------------------------------------------------------
// Slides without a # H1

test('a slide opened by a plain block has title null and a working form', () => {
  const src = 'intro paragraph without title\n\n---\n\n# B\n\nb\n';
  const sliced = checkInvariants('untitled', src);
  assert.equal(sliced.slides[0].title, null);
  assert.equal(sliced.slides[0].startLine, 1);
  assert.equal(sliced.slides[0].parts.title, null);
  assert.equal(sliced.slides[0].parts.intro, 'intro paragraph without title');
});

test('an empty # is filtered by parseDeck, so it is glue here too', () => {
  const src = '#\n\n---\n\n# B\n\nb\n';
  const sliced = checkInvariants('empty title', src);
  assert.equal(sliced.slides.length, 1);
  assert.equal(sliced.slides[0].title, 'B');
});

// ---------------------------------------------------------------------------
// Marp

test('marp: true → sliceable false, no slices offered', () => {
  const src = '---\nmarp: true\n---\n\n# One\n\n- a\n\n---\n\n# Two\n';
  const sliced = sliceDeck(src);
  assert.equal(sliced.sliceable, false);
  assert.deepEqual(sliced.slides, []);
  assert.equal(sliced.lineCount, src.split('\n').length);
});

// ---------------------------------------------------------------------------
// Line endings: pure CRLF is sliceable, a lone \r is not

const CRLF_SRC = '# One\r\n\r\nbody\r\n\r\n---\r\n\r\n# Two\r\n\r\n- a\r\n- b\r\n';

test('pure CRLF: invariants hold, the \\r travel inside the slice text', () => {
  const sliced = checkInvariants('CRLF', CRLF_SRC);
  assert.equal(sliced.slides.length, 2);
  assert.equal(sliced.slides[0].source, '# One\r\n\r\nbody\r');
  assert.equal(sliced.slides[1].source, '# Two\r\n\r\n- a\r\n- b\r');
});

test('pure CRLF: a splice edits one slide and leaves the CRLF glue verbatim', () => {
  const out = spliceAndCheck('CRLF splice', CRLF_SRC, 0, '# One bis\n\nnew body');
  assert.ok(out.startsWith('# One bis\n\nnew body\n'), 'the new slice writes bare newlines');
  assert.ok(out.endsWith('---\r\n\r\n# Two\r\n\r\n- a\r\n- b\r\n'), 'untouched lines keep \\r\\n');
  assert.equal(parseDeck(out).slides[0].title, 'One bis');
});

test('a lone \\r is a newline to markdown-it but not to the slicer: refused', () => {
  // classic-Mac endings — split('\n') sees ONE line where the parser sees
  // three; a splice through such shifted numbers would corrupt the file
  const mac = '# A\rmac body\r';
  const sliced = sliceDeck(mac);
  assert.equal(sliced.sliceable, false);
  assert.deepEqual(sliced.slides, []);
  assert.equal(sliced.lineCount, 1);
  // one mangled line in an otherwise CRLF file is refused all the same
  const mixed = sliceDeck('# A\r\n\rbody\r\n');
  assert.equal(mixed.sliceable, false);
});

// ---------------------------------------------------------------------------
// parts extraction and canonical serialization

test('parts: title, directives, intro, sections and notes, in canonical order', () => {
  const src =
    '<!-- layout: pillars -->\n# Title\n\nlead para\n\n<!-- animate: fade -->\n\n' +
    '## S1\n\n- a\n\n<!-- notes: n1 -->\n\n## S2\n\nbody 2\n\n<!-- notes: n2 -->\n';
  const sliced = checkInvariants('canonical', src);
  const parts = sliced.slides[0].parts;
  assert.deepEqual(parts, {
    title: 'Title',
    layout: 'pillars',
    notes: ['n1', 'n2'],
    animate: 'fade',
    intro: 'lead para',
    sections: [
      { heading: 'S1', body: '- a' },
      { heading: 'S2', body: 'body 2' },
    ],
  });
  assert.equal(
    serializeParts(parts),
    '# Title\n\n<!-- layout: pillars -->\n<!-- animate: fade -->\n\nlead para\n\n' +
      '## S1\n\n- a\n\n## S2\n\nbody 2\n\n<!-- notes: n1 -->\n<!-- notes: n2 -->',
  );
});

test('parts keep raw inline markdown, not runs', () => {
  const src = '# A **bold** title\n\nbody with ==badge== and `code`\n';
  const sliced = checkInvariants('raw markdown', src);
  assert.equal(sliced.slides[0].parts.title, 'A **bold** title');
  assert.equal(sliced.slides[0].parts.intro, 'body with ==badge== and `code`');
});

test('a slide the form cannot represent comes back with parts null', () => {
  // a multi-line setext title cannot be rewritten `# …` on one line: the
  // fidelity guard refuses, and the slide is edited as text
  const src = 'First\nSecond\n======\n\nbody\n';
  const sliced = checkInvariants('setext title', src);
  assert.equal(sliced.slides.length, 1);
  assert.equal(sliced.slides[0].parts, null);
  assert.equal(sliced.slides[0].source, 'First\nSecond\n======\n\nbody');
});

test('a directive comment interrupting a list is not form-representable', () => {
  // blanking the comment line welds nothing, but it changes the list split:
  // the guard sees two bullet blocks become one and refuses the form
  const src = '# A\n\n- a\n<!-- notes: x -->\n- b\n';
  const sliced = checkInvariants('list interrupted', src);
  assert.equal(sliced.slides[0].parts, null);
});

// ---------------------------------------------------------------------------
// Impure directive blocks: the directive applies, the form is refused

test('author markup sharing an html_block with a directive refuses the form', () => {
  // one html_block: the <div> runs to the blank line and swallows the
  // comment. parseDeck still reads the layout — and drops the div from the
  // IR, so only the purity check stands between the author's markup and a
  // form write-back that would erase it.
  const src = '# A\n\n<div>keep</div>\n<!-- layout: hero -->\n\nbody\n';
  const sliced = checkInvariants('mixed html block', src);
  assert.equal(parseDeck(src).slides[0].layout, 'hero', 'the directive still governs');
  assert.equal(sliced.slides[0].layout, 'hero');
  assert.equal(sliced.slides[0].parts, null, 'no form may blank the author markup');
  assert.ok(sliced.slides[0].source.includes('<div>keep</div>'));
  // raw-text editing is what parts:null forces — and it keeps the markup: a
  // source-mode edit cycle (splice of the slice's own text) changes nothing
  const cycled = spliceSlice(src, sliced.slides[0], sliced.slides[0].source).source;
  assert.equal(cycled, src, 'the author text survives an edit-source cycle');
});

test('a stray comment welded to a directive on one line refuses the form', () => {
  const src = '# A\n\n<!-- TODO --><!-- layout: hero -->\n\nbody\n';
  const sliced = checkInvariants('TODO + directive', src);
  assert.equal(sliced.slides[0].layout, 'hero');
  assert.equal(sliced.slides[0].parts, null);
  const cycled = spliceSlice(src, sliced.slides[0], sliced.slides[0].source).source;
  assert.ok(cycled.includes('<!-- TODO -->'), 'the reminder survives an edit-source cycle');
});

test('prose after the --> of a directive refuses the form', () => {
  const src = '# A\n\n<!-- layout: hero --> remember this\n\nbody\n';
  const sliced = checkInvariants('trailing prose', src);
  assert.equal(sliced.slides[0].layout, 'hero');
  assert.equal(sliced.slides[0].parts, null);
  const cycled = spliceSlice(src, sliced.slides[0], sliced.slides[0].source).source;
  assert.ok(cycled.includes('remember this'), 'the prose survives an edit-source cycle');
});

test('a pure directive block, by contrast, keeps its form', () => {
  const src = '# A\n\n<!-- layout: hero -->\n\nbody\n';
  const sliced = checkInvariants('pure directive', src);
  assert.equal(sliced.slides[0].parts?.layout, 'hero');
});

// ---------------------------------------------------------------------------
// Real edits

test('replacing one slice edits that slide and leaves the neighbours untouched', () => {
  const src = '# One\n\nfirst\n\n---\n\n# Two\n\n## Sec\n\n- a\n\n---\n\n# Three\n\nthird\n';
  const sliced = checkInvariants('three slides', src);
  const before = parseDeck(src).slides.map(stripPositions);

  const replacement = '# Two bis\n\n<!-- layout: quote -->\n\nnew body';
  const after = parseDeck(splice(src, sliced.slides[1], replacement));
  assert.equal(after.slides.length, 3);
  assert.deepEqual(stripPositions(after.slides[0]), before[0], 'slide 0 untouched');
  assert.deepEqual(stripPositions(after.slides[2]), before[2], 'slide 2 untouched');
  assert.deepEqual(
    stripPositions(after.slides[1]),
    stripPositions(parseDeck(replacement).slides[0]),
    'slide 1 reads exactly as the replacement parsed alone',
  );
  assert.equal(after.slides[1].layout, 'quote');
});

test('a form edit written back through serializeParts stays a clean splice', () => {
  const src = '# One\n\nfirst\n\n---\n\n# Two\n\nsecond\n\n---\n\n# Three\n\nthird\n';
  const sliced = checkInvariants('form edit', src);
  const before = parseDeck(src).slides.map(stripPositions);

  const parts = { ...sliced.slides[1].parts, title: 'Two edited', notes: ['spoken aside'] };
  const after = parseDeck(splice(src, sliced.slides[1], serializeParts(parts)));
  assert.equal(after.slides.length, 3);
  assert.deepEqual(stripPositions(after.slides[0]), before[0]);
  assert.deepEqual(stripPositions(after.slides[2]), before[2]);
  assert.equal(after.slides[1].title, 'Two edited');
  assert.deepEqual(after.slides[1].notes, ['spoken aside']);
});

// ---------------------------------------------------------------------------
// spliceSlice — the guarded write path (the corruption scenarios of the
// review, replayed: each test first shows the naive splice corrupting, then
// the guard holding)

test('spliceSlice: glue --- with no blank line survives a paragraph ending', () => {
  // the review's scenario #0: the separator touches the slide above it
  const src = '# One\n- a\n- b\n---\n## Next steps\n\ncontent\n';
  const sliced = sliceDeck(src);
  const newText = '# One\n\n- a\n- b\n\nClosing thought';

  // naive: the last paragraph line and the bare --- weld into a setext H2,
  // the separator disappears and the two slides melt into one
  assert.equal(parseDeck(splice(src, sliced.slides[0], newText)).slides.length, 1);

  const out = spliceAndCheck('review #0', src, 0, newText);
  assert.match(out, /Closing thought\n\n---\n/, 'a blank line keeps the rule bare');
  assert.equal(parseDeck(out).slides.length, 2);
});

test('spliceSlice: a pending directive is not stolen across a welded ---', () => {
  const src = '# One\n\n- a\n- b\n---\n<!-- layout: quote -->\n\n# Two\n\nb\n';
  const sliced = sliceDeck(src);
  const newText = '# One\n\nRevised ending';

  // naive: the setext weld erases the hr, slide One stays open, and the
  // layout pending for slide Two is captured by the wrong slide
  const stolen = parseDeck(splice(src, sliced.slides[0], newText));
  assert.equal(stolen.slides[0].layout, 'quote', 'naive splice: slide One steals the quote');
  assert.equal(stolen.slides[1].layout, null);

  const out = spliceAndCheck('pending stolen', src, 0, newText);
  const deck = parseDeck(out);
  assert.equal(deck.slides[0].layout, null);
  assert.equal(deck.slides[1].layout, 'quote', 'the pending directive still reaches slide Two');
});

test('spliceSlice: slice 0 right after a line-1 --- gets its blank line back', () => {
  // the file OPENS on a bare rule: gluing non-blank text to it is how a
  // false frontmatter (or a symmetric setext) is born
  const src = '---\n# A\n\nbody\n\n---\n\n# B\n\nb\n';
  const out = spliceAndCheck('line-1 hr', src, 0, '# A revised\n\nnew body');
  assert.ok(out.startsWith('---\n\n# A revised\n'), 'a blank line keeps the rule bare');
  const deck = parseDeck(out);
  assert.deepEqual(deck.meta, {}, 'no frontmatter woke up');
  assert.equal(deck.slides.length, 2);
});

test('spliceSlice: end-of-file slice, with and without a trailing newline', () => {
  const src = '# A\n\nbody\n\n---\n\n# B\n\nend';
  const sliced = sliceDeck(src);
  const bare = spliceSlice(src, sliced.slides[1], '# B bis\n\nfinal');
  const newline = spliceSlice(src, sliced.slides[1], '# B bis\n\nfinal\n');
  assert.equal(bare.source, '# A\n\nbody\n\n---\n\n# B bis\n\nfinal');
  assert.equal(newline.source, bare.source, 'one trailing \\n is tolerance, not content');
  spliceAndCheck('EOF slice', src, 1, '# B bis\n\nfinal');
});

test('spliceSlice: a slice butting on the next # H1 keeps a blank line between', () => {
  // adjacent slices, no glue: the note line ends slice A, `# B` opens B
  const src = '# A\n\na body\n\n<!-- notes: for A -->\n# B\n\nb\n';
  const out = spliceAndCheck('adjacent H1', src, 0, '# A\n\nrewritten body');
  assert.match(out, /rewritten body\n\n# B\n/);
});

test('spliceSlice: no guard fires when the glue already starts blank', () => {
  const src = '# One\n\nbody\n\n---\n\n# Two\n\nb\n';
  const sliced = sliceDeck(src);
  const out = spliceSlice(src, sliced.slides[0], '# One\n\nnew body').source;
  assert.equal(out, '# One\n\nnew body\n\n---\n\n# Two\n\nb\n');
});

test('spliceSlice: a new text already ending blank satisfies the guard by itself', () => {
  const src = '# One\n- a\n- b\n---\n## Next steps\n';
  const sliced = sliceDeck(src);
  // `…para\n\n` = one content line, one blank line, plus the tolerated \n
  const out = spliceSlice(src, sliced.slides[0], '# One\n\npara\n\n').source;
  assert.equal(out, '# One\n\npara\n\n---\n## Next steps\n', 'no doubled blank line');
});

test('spliceSlice: a self-splice may add protective glue but changes no slide', () => {
  const src = '# One\n- a\n- b\n---\n## Next steps\n\ncontent\n';
  const sliced = sliceDeck(src);
  const before = parseDeck(src).slides.map(stripPositions);
  const out = spliceSlice(src, sliced.slides[0], sliced.slides[0].source).source;
  assert.match(out, /- b\n\n---\n/, 'the risky boundary gains its blank line');
  const after = parseDeck(out);
  assert.equal(after.slides.length, before.length);
  after.slides.forEach((s, i) => assert.deepEqual(stripPositions(s), before[i]));
});
