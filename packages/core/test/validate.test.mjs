/**
 * Validation: positioned diagnostics, "did you mean" suggestions,
 * robustness (validateDeck never throws), capabilities() introspection.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';
import { parseDeck, ANIM_PRESETS } from '../src/deck/parse.mjs';
import { buildScenes, LAYOUTS } from '../src/deck/layout.mjs';
import { readDemo } from './helpers.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('unknown layout → UNKNOWN_LAYOUT with a suggestion', () => {
  const diags = validateDeck('# D\n\n<!-- layout: comparisn -->\n\n## A\n\n- a\n\n## B\n\n- b\n');
  const d = diags.find((x) => x.code === 'UNKNOWN_LAYOUT');
  assert.ok(d, 'UNKNOWN_LAYOUT expected');
  assert.equal(d.severity, 'error');
  assert.equal(d.suggestion, 'comparison');
});

test('unknown ::: directive → UNKNOWN_DIRECTIVE, positioned', () => {
  const source = '# D\n\n:::warnign\ncareful\n:::\n';
  const d = validateDeck(source).find((x) => x.code === 'UNKNOWN_DIRECTIVE');
  assert.ok(d, 'UNKNOWN_DIRECTIVE expected');
  assert.equal(d.line, 3);
  assert.equal(d.suggestion, 'warning');
});

// markdown-it-container opens its containers WITHOUT case insensitivity:
// ":::Info" does not open and renders as a literal paragraph in the
// presentation. The scan in validate.mjs must compare the same way, otherwise
// the one diagnostic that catches this case falls silent where it serves most.
test('miscapitalized directive → UNKNOWN_DIRECTIVE suggesting the lowercase form', () => {
  const d = validateDeck('# D\n\n:::Info\ntext\n:::\n').find((x) => x.code === 'UNKNOWN_DIRECTIVE');
  assert.ok(d, 'UNKNOWN_DIRECTIVE expected for ":::Info"');
  assert.equal(d.line, 3);
  assert.equal(d.suggestion, 'info');
  assert.match(d.message, /lowercase/);
});

// A bar drawn at a share nobody wrote is worse than no bar: the card degrades
// to the author's own text, and this diagnostic is the only place that says so.
test(':::progress with an unreadable value → INVALID_PROGRESS, positioned', () => {
  const d = validateDeck('# P\n\n:::progress\nalmost done\nForm\n:::\n').find(
    (x) => x.code === 'INVALID_PROGRESS',
  );
  assert.ok(d, 'INVALID_PROGRESS expected');
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 3);
  assert.match(d.message, /75 %/, 'the message must show the accepted spellings');
  // and a share that IS readable says nothing at all
  assert.equal(
    validateDeck('# P\n\n:::progress\n3/4\nForm\n:::\n').find((x) => x.code === 'INVALID_PROGRESS'),
    undefined,
  );
});

test(':::progress with an unknown tint → UNKNOWN_PROGRESS_KIND with a suggestion', () => {
  const d = validateDeck('# P\n\n:::progress warnign\n75 %\nForm\n:::\n').find(
    (x) => x.code === 'UNKNOWN_PROGRESS_KIND',
  );
  assert.ok(d, 'UNKNOWN_PROGRESS_KIND expected');
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 3);
  assert.equal(d.suggestion, 'warning');
  // the four tints of a callout are the four tints of a bar: no new vocabulary
  for (const kind of ['info', 'success', 'warning', 'danger']) {
    assert.equal(
      validateDeck(`# P\n\n:::progress ${kind}\n75 %\nForm\n:::\n`).find(
        (x) => x.code === 'UNKNOWN_PROGRESS_KIND',
      ),
      undefined,
      `":::progress ${kind}" must be accepted in silence`,
    );
  }
});

// capabilities() is the whole introspection surface for agents and hosts, and
// its diagnostics list is hand-maintained: a code that is pushed but never
// listed passes the entire suite while every agent is told it does not exist.
test('INVALID_PROGRESS and UNKNOWN_PROGRESS_KIND are published by capabilities()', () => {
  assert.ok(capabilities().diagnostics.includes('INVALID_PROGRESS'));
  assert.ok(capabilities().diagnostics.includes('UNKNOWN_PROGRESS_KIND'));
  assert.ok(capabilities().directives.includes('progress'));
  assert.ok(capabilities().directives.includes('status'));
});

test('correctly written directive → no directive diagnostic', () => {
  const diags = validateDeck('# D\n\n:::info\ntext\n:::\n');
  assert.deepEqual(
    diags.filter((x) => x.code === 'UNKNOWN_DIRECTIVE'),
    [],
  );
});

test('genuinely unknown directive → UNKNOWN_DIRECTIVE with no mention of casing', () => {
  const d = validateDeck('# D\n\n:::thing\ntext\n:::\n').find(
    (x) => x.code === 'UNKNOWN_DIRECTIVE',
  );
  assert.ok(d, 'UNKNOWN_DIRECTIVE expected for ":::thing"');
  assert.equal(d.line, 3);
  assert.doesNotMatch(d.message, /lowercase/);
});

// Leading UTF-8 BOM: `parseDeck` strips it before parsing, so the textual scan
// in validate.mjs must strip it too — otherwise the opening "---" is no longer
// recognized and the diagnostics land beside their target.
test('leading BOM → frontmatter recognized and diagnostics correctly positioned', () => {
  const diags = validateDeck('﻿---\ntitle: D\n---\n\n:::Info\ntext\n:::\n');
  const d = diags.find((x) => x.code === 'UNKNOWN_DIRECTIVE');
  assert.ok(d, 'UNKNOWN_DIRECTIVE expected despite the BOM');
  assert.equal(d.line, 5);
});

test('overflow → SLIDE_PAGINATED info on the line of the slide', () => {
  const items = Array.from({ length: 40 }, (_, k) => `- item ${k + 1}`).join('\n');
  const d = validateDeck(`# Dense\n\n${items}\n`).find((x) => x.code === 'SLIDE_PAGINATED');
  assert.ok(d, 'SLIDE_PAGINATED expected');
  assert.equal(d.severity, 'info');
  assert.equal(d.line, 1);
});

test('demo deck: no errors', () => {
  const errors = validateDeck(readDemo()).filter((d) => d.severity === 'error');
  assert.deepEqual(errors, []);
});

test('pre-computed deck and scenes: same diagnostics as the standalone path', () => {
  const source = readDemo();
  const deck = parseDeck(source);
  const scenes = buildScenes(deck);
  assert.deepEqual(validateDeck(source, { deck, scenes }), validateDeck(source));
});

test('validateDeck never throws (degenerate inputs)', () => {
  for (const source of ['', '---\n---\n', '# \n\n|\n', ':::metric\n:::\n', '```mermaid\n']) {
    assert.doesNotThrow(() => validateDeck(source), `threw for ${JSON.stringify(source)}`);
  }
});

test('a parser that throws becomes a PARSE_ERROR diagnostic, not a crash', () => {
  // no known input makes parseDeck throw: we inject a source whose .match
  // throws. The HARMLESS operations of the preprocessing (splitting, stripping
  // the leading BOM) are delegated to '' so that the crash really comes from
  // the parse and not from the plumbing — without which this test would stop
  // proving what it announces the moment anyone touches the preprocessing.
  const evil = {
    split: (re) => ''.split(re),
    replace: () => evil,
    match: () => {
      throw new Error('boom parse');
    },
  };
  const diags = validateDeck(evil);
  assert.deepEqual(diags, [
    {
      severity: 'error',
      code: 'PARSE_ERROR',
      message: 'Could not parse the document: boom parse',
      line: 1,
    },
  ]);
});

test('a layout pass that throws becomes a LAYOUT_ERROR diagnostic, not a crash', () => {
  // pre-computed scenes whose iteration throws: the catch of the pagination
  // pass must produce a positioned diagnostic
  const throwing = {
    [Symbol.iterator]() {
      throw new Error('boom layout');
    },
  };
  const diags = validateDeck('# Slide\n\n- a\n', { scenes: throwing });
  const d = diags.find((x) => x.code === 'LAYOUT_ERROR');
  assert.ok(d, 'LAYOUT_ERROR expected');
  assert.equal(d.severity, 'error');
  assert.equal(d.line, 1);
  assert.match(d.message, /boom layout/);
});

test('capabilities() reflects the engine sources of truth', () => {
  const caps = capabilities();
  assert.deepEqual(caps.layouts, LAYOUTS);
  assert.ok(caps.directives.includes('metric'));
  assert.deepEqual(caps.animatePresets, ANIM_PRESETS);
  assert.ok(caps.diagnostics.includes('BLOCK_OVERFLOW'));
  assert.ok(caps.diagnostics.includes('ALERT_CONTENT_DROPPED'));
  assert.ok(caps.diagnostics.includes('CHART_DATA_IGNORED'));
  // the icon's alt vocabulary: an agent that cannot read the size words back
  // invents point sizes instead
  assert.ok(caps.diagnostics.includes('UNKNOWN_ICON_WORD'));
  // both were pushed by the validator and listed nowhere until a table cell
  // ate an icon and nobody could find out why
  assert.ok(caps.diagnostics.includes('TABLE_CONTENT_DROPPED'));
  assert.ok(caps.diagnostics.includes('QUOTE_CONTENT_DROPPED'));
  assert.ok(caps.diagnostics.includes('LIST_CONTENT_DROPPED'));
  assert.ok(caps.diagnostics.includes('HEADING_CONTENT_DROPPED'));
  // the one image diagnostic that ABORTS the build: an agent enumerating this
  // list could not explain the only failure that writes no file
  assert.ok(caps.diagnostics.includes('IMAGE_PATH_ESCAPE'));
  assert.deepEqual(caps.iconSizes, ['line', 'small', 'medium', 'large']);
  assert.deepEqual(caps.iconColors, ['primary', 'neutral', 'secondary', 'white']);
  assert.deepEqual(caps.outputs, ['pptx', 'html']);
});

// ------ deck doctor --------------------------------------------------------

/** A three-column slide whose first column carries `n` long lines. */
const overloadedColumn = (n) => {
  const long = Array.from(
    { length: n },
    () => 'A REASONABLY LONG LINE OF TEXT THAT COMPLETELY FILLS THE COLUMN',
  ).join(' ');
  return `# Three columns\n\n## A\n\n${long}\n\n## B\n\n- b\n\n## C\n\n- c\n`;
};

// This column used to be the BLOCK_OVERFLOW fixture: it overflowed, the
// compiler said so, and the author had to shorten it by hand. The engine now
// re-flows it a step down instead — and reports what it did, because a size
// chosen by the compiler is a decision the author must be able to refuse.
test('doctor: an overloaded column is densified, and the engine says so', () => {
  const diags = validateDeck(overloadedColumn(14));
  const d = diags.find((x) => x.code === 'SLIDE_DENSIFIED');
  assert.ok(d, 'SLIDE_DENSIFIED expected');
  assert.equal(d.severity, 'info');
  assert.match(d.message, /The "A" region was rendered at the "compact" text scale/);
  assert.match(d.message, /three-columns layout/);
  assert.equal(
    diags.find((x) => x.code === 'BLOCK_OVERFLOW'),
    undefined,
    'a region the engine fitted is not an overflow',
  );
  // the diagnostic points at the paragraph, not at the top of the slide
  assert.equal(d.line, 5);
});

test('doctor: a column that overflows even at the densest step → BLOCK_OVERFLOW, with a figure', () => {
  const diags = validateDeck(overloadedColumn(60));
  const d = diags.find((x) => x.code === 'BLOCK_OVERFLOW');
  assert.ok(d, 'BLOCK_OVERFLOW expected');
  assert.equal(d.severity, 'warning');
  assert.match(d.message, /overflows its region by about \d+ px/);
  // the clause that keeps the advice honest: the engine has already spent the
  // scale, so "trim the content" would be telling the author to redo its work
  assert.match(d.message, /already at the densest step — cut the content or split the slide/);
  assert.match(
    diags.find((x) => x.code === 'SLIDE_DENSIFIED').message,
    /"dense" text scale, the densest the engine has/,
  );
});

test('doctor: the "densest step" clause appears ONLY once the scale is spent', () => {
  // a code block is out of the scale's reach on purpose (its surface is a fixed
  // frame): the column overflows at the deck's own size, nothing is densified,
  // and the advice stays the ordinary one — the clause must not turn into
  // boilerplate carried by every overflow
  const lines = Array.from({ length: 40 }, (_, k) => `const line${k} = ${k};`).join('\n');
  const source = `# Split\n\n<!-- layout: two-columns -->\n\n## A\n\n\`\`\`js\n${lines}\n\`\`\`\n\n## B\n\n- b\n`;
  const diags = validateDeck(source);
  const d = diags.find((x) => x.code === 'BLOCK_OVERFLOW');
  assert.ok(d, 'BLOCK_OVERFLOW expected');
  assert.equal(d.severity, 'warning');
  assert.doesNotMatch(d.message, /densest step/);
  assert.equal(
    diags.find((x) => x.code === 'SLIDE_DENSIFIED'),
    undefined,
    'a region the scale cannot shrink must not be reported as densified',
  );
});

test('SLIDE_DENSIFIED is published by capabilities()', () => {
  assert.ok(capabilities().diagnostics.includes('SLIDE_DENSIFIED'));
});

test('doctor: overloaded SWOT quadrant → BLOCK_OVERFLOW (bound = bottom of the panel)', () => {
  const bullets = Array.from(
    { length: 8 },
    (_, k) => `- a bullet long enough to properly fill quadrant number ${k + 1}`,
  ).join('\n');
  const source = `# Review\n\n<!-- layout: swot -->\n\n## Strengths\n\n- a\n\n## Weaknesses\n\n- b\n\n## Opportunities\n\n- c\n\n## Threats\n\nAn introductory paragraph for the quadrant that takes up room.\n\n${bullets}\n`;
  const d = validateDeck(source).find((x) => x.code === 'BLOCK_OVERFLOW');
  assert.ok(d, 'BLOCK_OVERFLOW expected on the overloaded quadrant');
});

test('doctor: SWOT headings without a layout → swot suggestion', () => {
  const source =
    '# Review\n\n## Strengths\n\n- a\n\n## Weaknesses\n\n- b\n\n## Opportunities\n\n- c\n\n## Threats\n\n- d\n';
  const d = validateDeck(source).find((x) => x.code === 'LAYOUT_SUGGESTION');
  assert.ok(d, 'LAYOUT_SUGGESTION expected');
  assert.equal(d.suggestion, 'swot');
  assert.equal(d.severity, 'info');
});

test('doctor: Before/After → comparison suggestion; dated headings → timeline', () => {
  const before = validateDeck('# Migration\n\n## Before\n\n- a\n\n## After\n\n- b\n');
  assert.equal(before.find((x) => x.code === 'LAYOUT_SUGGESTION')?.suggestion, 'comparison');
  const dates = validateDeck('# Plan\n\n## 2024\n\n- a\n\n## 2025\n\n- b\n\n## 2026\n\n- c\n');
  assert.equal(dates.find((x) => x.code === 'LAYOUT_SUGGESTION')?.suggestion, 'timeline');
});

test('doctor: Pros/Cons → pros-cons suggestion', () => {
  const source = '# Decision\n\n## Pros\n\n- a\n\n## Cons\n\n- b\n';
  const d = validateDeck(source).find((x) => x.code === 'LAYOUT_SUGGESTION');
  assert.ok(d, 'LAYOUT_SUGGESTION expected');
  assert.equal(d.suggestion, 'pros-cons');
  assert.equal(d.severity, 'info');
});

test('doctor: unordered SWOT sections → no suggestion (tints depend on position)', () => {
  const source =
    '# Review\n\n## Threats\n\n- a\n\n## Strengths\n\n- b\n\n## Weaknesses\n\n- c\n\n## Opportunities\n\n- d\n';
  assert.equal(
    validateDeck(source).find((x) => x.code === 'LAYOUT_SUGGESTION'),
    undefined,
  );
});

test('doctor: "Review 2025 / Outlook 2026" is not a timeline (dates not anchored)', () => {
  const source = '# Retrospective\n\n## Review 2025\n\n- a\n\n## Outlook 2026\n\n- b\n';
  assert.equal(
    validateDeck(source).find((x) => x.code === 'LAYOUT_SUGGESTION'),
    undefined,
  );
});

test('doctor: an explicit layout silences the suggestion', () => {
  const source =
    '# Review\n\n<!-- layout: swot -->\n\n## Strengths\n\n- a\n\n## Weaknesses\n\n- b\n\n## Opportunities\n\n- c\n\n## Threats\n\n- d\n';
  assert.equal(
    validateDeck(source).find((x) => x.code === 'LAYOUT_SUGGESTION'),
    undefined,
  );
});

test('doctor: image too small for its region → IMAGE_UPSCALED', () => {
  const source = '# Visual\n\n- some text alongside\n\n![figure](pixel.png)\n';
  const d = validateDeck(source, { baseDir: FIXTURES }).find((x) => x.code === 'IMAGE_UPSCALED');
  assert.ok(d, 'IMAGE_UPSCALED expected');
  assert.match(d.message, /1 px wide/);
});

test('doctor: portrait image framed with "contain" → no false IMAGE_UPSCALED', () => {
  // 300 × 900 in a wide slot: the DISPLAYED width (ratio preserved) is much
  // narrower than the slot — that is a downscale, not a stretch
  const source = '# Visual\n\n- some text alongside\n\n![right](portrait.png)\n';
  assert.equal(
    validateDeck(source, { baseDir: FIXTURES }).find((x) => x.code === 'IMAGE_UPSCALED'),
    undefined,
  );
});

test('animate: unknown value → UNKNOWN_ANIMATE with a suggestion', () => {
  const d = validateDeck('# Slide\n\n<!-- animate: fad -->\n\n- a\n').find(
    (x) => x.code === 'UNKNOWN_ANIMATE',
  );
  assert.ok(d, 'UNKNOWN_ANIMATE expected');
  assert.equal(d.suggestion, 'fade');
});

// The legacy aliases (`fondu`, `balayage`, `apparaître`) are no longer
// documented, but decks written before the English rename still carry them, so
// parse.mjs keeps the table alive. This is the only guard on the SUGGESTION
// half of that promise: drop `...ANIM_PRESET_ALIASES` from ANIM_CANDIDATES and
// an author who mistyped an alias silently loses the "did you mean" that would
// have told them the value is still supported.
test('animate: a near-miss on a legacy alias → the alias itself is suggested', () => {
  const d = validateDeck('# Slide\n\n<!-- animate: balayge -->\n\n- a\n').find(
    (x) => x.code === 'UNKNOWN_ANIMATE',
  );
  assert.equal(d?.suggestion, 'balayage');
});

test('animate: unknown value in the FRONTMATTER → UNKNOWN_ANIMATE, positioned', () => {
  const d = validateDeck('---\ntitle: T\nanimate: zom\n---\n\n# A\n\n- a\n').find(
    (x) => x.code === 'UNKNOWN_ANIMATE',
  );
  assert.ok(d, 'UNKNOWN_ANIMATE expected for the frontmatter');
  assert.equal(d.line, 3);
  assert.equal(d.suggestion, 'zoom');
});

// The cover generated from `title:` is the ONE slide no `<!-- notes: -->` can
// reach — there is no heading in the source to hang the comment on. A
// frontmatter `notes:` is that missing line, and the only proof it is not
// decoration is that it comes back out of buildScenes on the cover scene.
test('frontmatter `notes:` lands on the generated cover', () => {
  const source =
    '---\ntitle: Quarterly review\nsubtitle: Q3\nnotes: Thank them for coming, then hand over to Ana.\n---\n\n# Results\n\n- a\n';
  const [cover] = buildScenes(parseDeck(source));
  assert.equal(cover.layout, 'cover');
  assert.deepEqual(cover.notes, ['Thank them for coming, then hand over to Ana.']);
  // a note that HAS a cover to land on is not an orphan
  assert.equal(
    validateDeck(source).find((x) => x.code === 'COVER_NOTES_ORPHAN'),
    undefined,
    'the normal case must stay silent',
  );
});

test('a cover without `notes:` carries no notes (the default is unchanged)', () => {
  const [cover] = buildScenes(
    parseDeck('---\ntitle: Quarterly review\nsubtitle: Q3\n---\n\n# Results\n\n- a\n'),
  );
  assert.deepEqual(cover.notes, []);
});

// Without a `title:` there is no cover, so the note is read by nothing at all.
// Silence here would leave the author believing their note is in the deck —
// this diagnostic is the only trace they will ever get.
test('`notes:` without a `title:` → COVER_NOTES_ORPHAN, on the `notes:` line', () => {
  const source =
    '---\nauthor: Ana\ndate: 2026-03-01\nnotes: A note nobody will ever hear.\n---\n\n# Results\n\n- a\n';
  const d = validateDeck(source).find((x) => x.code === 'COVER_NOTES_ORPHAN');
  assert.ok(d, 'COVER_NOTES_ORPHAN expected');
  assert.equal(d.severity, 'warning');
  // positioned on what the author wrote, not at the top of the file
  assert.equal(d.line, 4);
  assert.match(d.message, /no `title:`/);
  // and the scenes confirm the diagnostic: the note reached no slide
  assert.ok(
    buildScenes(parseDeck(source)).every((s) => s.notes.length === 0),
    'with no cover, the frontmatter note is carried nowhere',
  );
});

// A Marp deck DOES have a `title:` — it is HTML metadata there (Marp CLI) and
// generates no slide, so the note is just as orphaned, and the message has to
// say so differently: "add a title:" would be wrong advice.
test('`notes:` in a Marp deck → COVER_NOTES_ORPHAN (`title:` generates no cover there)', () => {
  const source =
    '---\nmarp: true\ntitle: Quarterly review\nnotes: A note nobody will ever hear.\n---\n\n# Results\n\n- a\n';
  const d = validateDeck(source).find((x) => x.code === 'COVER_NOTES_ORPHAN');
  assert.ok(d, 'COVER_NOTES_ORPHAN expected for a Marp deck');
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 4);
  assert.match(d.message, /Marp/);
  assert.ok(
    buildScenes(parseDeck(source)).every((s) => s.notes.length === 0),
    'a Marp deck generates no cover to carry the note',
  );
});

test('COVER_NOTES_ORPHAN and the `notes:` key are published by capabilities()', () => {
  assert.ok(capabilities().diagnostics.includes('COVER_NOTES_ORPHAN'));
  // an agent that cannot read `notes` back from the frontmatter list will never
  // write the one line that gives a cover its presenter notes
  assert.ok(capabilities().frontmatter.includes('notes'));
});

test('metrics: more than 4 cards → METRICS_DROPPED warning', () => {
  const cards = Array.from({ length: 5 }, (_, k) => `:::metric\n${k + 1}\nCard ${k + 1}\n:::`).join(
    '\n\n',
  );
  const d = validateDeck(`# KPI\n\n${cards}\n`).find((x) => x.code === 'METRICS_DROPPED');
  assert.ok(d, 'METRICS_DROPPED expected');
  assert.match(d.message, /will be dropped/);
});

test('callout: an unrendered block (code) → ALERT_CONTENT_DROPPED warning', () => {
  const source = '# D\n\n:::info\na paragraph\n\n```js\nconst x = 1;\n```\n:::\n';
  const d = validateDeck(source).find((x) => x.code === 'ALERT_CONTENT_DROPPED');
  assert.ok(d, 'ALERT_CONTENT_DROPPED expected');
  assert.equal(d.severity, 'warning');
  assert.match(d.message, /"code"/);
});

test('callout: paragraphs and bullets only → no ALERT_CONTENT_DROPPED', () => {
  const source = '# D\n\n:::warning\na paragraph\n\n- a bullet\n- another one\n:::\n';
  assert.equal(
    validateDeck(source).find((x) => x.code === 'ALERT_CONTENT_DROPPED'),
    undefined,
  );
});

test('pie: surplus series and negative values → CHART_DATA_IGNORED; bar: nothing', () => {
  const multi = '# C\n\n```chart\ntype: pie\ncategories: A, B\nS1: 1, 2\nS2: 3, 4\n```\n';
  const d = validateDeck(multi).find((x) => x.code === 'CHART_DATA_IGNORED');
  assert.ok(d, 'CHART_DATA_IGNORED expected (multi-series)');
  assert.match(d.message, /only the first/);

  const neg = '# C\n\n```chart\ntype: doughnut\ncategories: A, B\nS1: 5, -2\n```\n';
  const d2 = validateDeck(neg).find((x) => x.code === 'CHART_DATA_IGNORED');
  assert.ok(d2, 'CHART_DATA_IGNORED expected (negative value)');
  assert.match(d2.message, /negative/);

  const bar = '# C\n\n```chart\ntype: bar\ncategories: A, B\nS1: 1, -2\nS2: 3, 4\n```\n';
  assert.equal(
    validateDeck(bar).find((x) => x.code === 'CHART_DATA_IGNORED'),
    undefined,
  );
});

test('nested callout: a single ALERT_CONTENT_DROPPED, no cascade over the discarded subtree', () => {
  const source = '# D\n\n::::info\ntext\n\n:::info\ninner\n\n```js\nconst x = 1;\n```\n:::\n::::\n';
  const diags = validateDeck(source).filter((x) => x.code === 'ALERT_CONTENT_DROPPED');
  assert.equal(
    diags.length,
    1,
    'the content of the inner callout (already discarded) must not be reported twice',
  );
  assert.match(diags[0].message, /"alert"/);
});

test('pie: a negative beyond the categories → surplus reported, no false "negative"', () => {
  // chart.mjs truncates to categories.length first: -7 is never displayed
  const source = '# C\n\n```chart\ntype: pie\ncategories: A, B\nS1: 5, 3, -7\n```\n';
  const diags = validateDeck(source).filter((x) => x.code === 'CHART_DATA_IGNORED');
  assert.equal(diags.length, 1);
  assert.match(diags[0].message, /will be dropped/);
  assert.doesNotMatch(diags[0].message, /negative/);
});

test('explicit two-columns with 4 sections → LAYOUT_SECTIONS (surplus dropped)', () => {
  const source =
    '# D\n\n<!-- layout: two-columns -->\n\n## A\n\n- a\n\n## B\n\n- b\n\n## C\n\n- c\n\n## D\n\n- d\n';
  const d = validateDeck(source).find((x) => x.code === 'LAYOUT_SECTIONS');
  assert.ok(d, 'LAYOUT_SECTIONS expected');
});

test('columns: the lead does not count as a section (no lying LAYOUT_SECTIONS)', () => {
  // layout.mjs flows whatever precedes the first "##" full width above the
  // columns: counting it made us announce "3 sections found: the surplus will
  // be ignored" when NOTHING is ignored
  const source =
    '# D\n\n<!-- layout: two-columns -->\n\nA full-width opener.\n\n## A\n\n- a\n\n## B\n\n- b\n';
  assert.equal(
    validateDeck(source).find((x) => x.code === 'LAYOUT_SECTIONS'),
    undefined,
  );
  // …and the lead really is rendered — otherwise staying silent would be an admission
  const [scene] = buildScenes(parseDeck(source));
  const texts = scene.elements.map((el) => JSON.stringify(el.block));
  assert.ok(
    texts.some((t) => t.includes('opener')),
    'the lead must be placed',
  );
  assert.ok(
    texts.some((t) => t.includes('"a"')) && texts.some((t) => t.includes('"b"')),
    'both columns remain',
  );
});

test('columns: an untitled leading section still counts when there is no "##" at all', () => {
  // same condition as the `lead` of layout.mjs: with no titled section, the
  // anonymous section is a column, not a lead — three columns for a single
  // section, and the shortfall must keep saying so
  const source = '# D\n\n<!-- layout: three-columns -->\n\nA single paragraph.\n';
  const d = validateDeck(source).find((x) => x.code === 'LAYOUT_SECTIONS');
  assert.ok(d, 'LAYOUT_SECTIONS expected (1 section for 3 columns)');
  assert.match(d.message, /1 found/);
});

test('bar: values with no category → CHART_DATA_IGNORED (chartDataDiagnostics wired in)', () => {
  const source =
    '# C\n\n```chart\ntype: bar\ncategories: A, B\nSales: 1, 2, 3, 4\nCosts: 5, 6\n```\n';
  const diags = validateDeck(source).filter((x) => x.code === 'CHART_DATA_IGNORED');
  assert.equal(diags.length, 1, 'only the over-long series is reported');
  assert.equal(diags[0].severity, 'warning');
  assert.match(diags[0].message, /Sales/);
  assert.match(diags[0].message, /the last 2 will be dropped/);
  assert.equal(diags[0].line, 3, 'positioned on the chart block');
});

test('radar: values with no category → CHART_DATA_IGNORED (the scale rules them out)', () => {
  const source =
    '# C\n\n```chart\ntype: radar\ncategories: A, B, C\nScore: 10, 20, 30, 9999\n```\n';
  const d = validateDeck(source).find((x) => x.code === 'CHART_DATA_IGNORED');
  assert.ok(d, 'CHART_DATA_IGNORED expected');
  assert.match(d.message, /the last one will be dropped/);
});

test('quote with no content → QUOTE_EMPTY (the layout would render a bare slide)', () => {
  const d = validateDeck('# No quotation\n\n<!-- layout: quote -->\n').find(
    (x) => x.code === 'QUOTE_EMPTY',
  );
  assert.ok(d, 'QUOTE_EMPTY expected');
  assert.equal(d.severity, 'warning');
  assert.match(d.message, /nothing to quote/);
  // the scene really is empty: the diagnostic is the author's only channel
  assert.deepEqual(
    buildScenes(parseDeck('# No quotation\n\n<!-- layout: quote -->\n'))[0].elements,
    [],
  );
  // with a quotation, nothing left to say
  assert.equal(
    validateDeck(
      '# With a quotation\n\n<!-- layout: quote -->\n\n> The perfect is the enemy of the good.\n',
    ).find((x) => x.code === 'QUOTE_EMPTY'),
    undefined,
  );
});

test('layers: shades beyond the kit palette → LAYERS_SHADE_MISSING', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-validate-'));
  try {
    // a kit with only TWO shades (indices 0 and 1)
    fs.writeFileSync(
      path.join(dir, 'kit.json'),
      JSON.stringify({
        layerShades: [
          { fill: '1E3A8A', ink: 'FFFFFF' },
          { fill: 'EFF6FF', ink: '1E3A8A' },
        ],
      }),
    );
    fs.mkdirSync(path.join(dir, 'layouts'));
    fs.writeFileSync(
      path.join(dir, 'layouts', 'layers-custom.json'),
      JSON.stringify({ name: 'layers-custom', base: 'layers', shades: [0, 3] }),
    );
    const source =
      '# Stack\n\n<!-- layout: layers-custom -->\n\n## Base\n\n- a\n\n## Surface\n\n- b\n';
    const d = validateDeck(source, { baseDir: dir, themePath: path.join(dir, 'kit.json') }).find(
      (x) => x.code === 'LAYERS_SHADE_MISSING',
    );
    assert.ok(d, 'LAYERS_SHADE_MISSING expected');
    assert.equal(d.severity, 'warning');
    assert.match(d.message, /only provides 2 layer shades/);
    // the complete kit (5 shades) covers index 3: nothing left to say
    assert.equal(
      validateDeck(source, { baseDir: dir }).find((x) => x.code === 'LAYERS_SHADE_MISSING'),
      undefined,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Announcing the layout BEFORE the title is the natural writing order — and
// the only possible one if you want it read first. For a long time the
// directive fell into the void: neither applied (the slide was not open yet)
// nor reported, and the validator went as far as SUGGESTING the layout the
// author had just written. The parser now holds it pending.
test('directive written between the "---" and the "# heading" → applied to the next slide', () => {
  const source =
    '# Intro\n\n---\n\n<!-- layout: pros-cons -->\n\n# Decision\n\n## Pros\n\n- a\n\n## Cons\n\n- b\n';
  const deck = parseDeck(source);
  const slide = deck.slides.find((s) => s.title === 'Decision');
  assert.equal(slide.layout, 'pros-cons', 'the layout announced before the title must be applied');
  // line of the directive, not that of the title: any diagnostic points at
  // what the author actually wrote
  assert.equal(slide.layoutLine, 5);
  // nothing orphaned: the key stays absent from the IR of a healthy deck
  assert.equal(deck.orphanDirectives, undefined);
  // and no trace left of the old silence: neither an inferred layout suggested,
  // nor an orphan directive
  const diags = validateDeck(source);
  assert.deepEqual(
    diags.filter((x) => x.code === 'LAYOUT_SUGGESTION' || x.code === 'ORPHAN_DIRECTIVE'),
    [],
  );
});

test('notes and animate placed before the "# heading" join the same slide', () => {
  const deck = parseDeck(
    '<!-- notes: say hello -->\n<!-- animate: fade -->\n\n# Opening\n\nText.\n',
  );
  assert.deepEqual(deck.slides[0].notes, ['say hello']);
  assert.equal(deck.slides[0].animate, true);
  assert.equal(deck.slides[0].animatePreset, 'fade');
});

test('directive correctly placed after the "# heading" → no false positive', () => {
  const diags = validateDeck(
    '# Decision\n\n<!-- layout: pros-cons -->\n\n## Pros\n\n- a\n\n## Cons\n\n- b\n',
  );
  assert.deepEqual(
    diags.filter((x) => x.code === 'ORPHAN_DIRECTIVE'),
    [],
  );
  assert.equal(
    parseDeck('# D\n\n<!-- layout: quote -->\n\n> Quotation.\n').slides[0].layout,
    'quote',
  );
});

test('directive followed by no slide → ORPHAN_DIRECTIVE (never silence)', () => {
  const d = validateDeck('# End\n\nText.\n\n---\n\n<!-- layout: pros-cons -->\n').find(
    (x) => x.code === 'ORPHAN_DIRECTIVE',
  );
  assert.ok(d, 'ORPHAN_DIRECTIVE expected');
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 7);
  assert.match(d.message, /governs no slide/);
});

test('deck reduced to a single directive → ORPHAN_DIRECTIVE despite the early EMPTY_DECK return', () => {
  const diags = validateDeck('<!-- layout: quote -->\n');
  assert.ok(
    diags.find((x) => x.code === 'ORPHAN_DIRECTIVE'),
    'ORPHAN_DIRECTIVE expected',
  );
  assert.ok(
    diags.find((x) => x.code === 'EMPTY_DECK'),
    'EMPTY_DECK expected',
  );
});

test('ORPHAN_DIRECTIVE is published by capabilities()', () => {
  assert.ok(capabilities().diagnostics.includes('ORPHAN_DIRECTIVE'));
});

// A directive wedged between two separators surrounds no slide: it must not
// "spill over" onto the next one, which has its own block.
test('directive between two "---" → orphaned, never carried over to the next slide', () => {
  const source = '# A\n\n---\n\n<!-- layout: quote -->\n\n---\n\n# B\n\nText.\n';
  assert.equal(parseDeck(source).slides.find((s) => s.title === 'B').layout, null);
  const d = validateDeck(source).find((x) => x.code === 'ORPHAN_DIRECTIVE');
  assert.ok(d, 'ORPHAN_DIRECTIVE expected');
  assert.equal(d.line, 5);
});
