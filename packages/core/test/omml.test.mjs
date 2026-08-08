/**
 * MathML → OMML: the conversion behind a native PowerPoint equation.
 *
 * Two halves, and the second one is the reason this file exists at all. The
 * first asserts that the expressions a deck actually contains come out as the
 * OMML element PowerPoint's editor opens. The second asserts the REFUSALS —
 * that a construct the converter cannot map exactly yields null rather than
 * something plausible, because gap #4's whole premise is that an equation
 * converted almost right is worse than a picture.
 *
 * MathJax is optional (like `@resvg/resvg-js` and mmdc), so every test that
 * needs real MathML goes through `mml()` and skips where it is absent. The
 * refusal tests feed the converter MathML written out by hand and run
 * everywhere: that half must never be skippable.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ommlFromMathML } from '../src/pptx/omml.mjs';
import { mathSvg } from '../src/deck/assets.mjs';

const MML = (body, attrs = '') =>
  `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"${attrs}>${body}</math>`;

/** MathJax's own MathML for a LaTeX source, or null where MathJax is absent. */
async function mml(tex) {
  const out = await mathSvg(tex);
  return out?.mathml ?? null;
}

async function omml(t, tex) {
  const m = await mml(tex);
  if (!m) {
    t.skip('mathjax-full absent on this machine');
    return null;
  }
  return ommlFromMathML(m);
}

// ---------------------------------------------------------------------------
// What it produces
// ---------------------------------------------------------------------------

test('omml: an equation becomes the m:oMathPara PowerPoint writes', async (t) => {
  const out = await omml(t, 'E = mc^2');
  if (!out) return;
  assert.match(out, /^<m:oMathPara xmlns:m="[^"]*\/2006\/math">/);
  assert.match(out, /<m:oMath>/);
  // the run properties of the reference package, byte for byte — this is the
  // font PowerPoint sets its own equations in
  assert.match(out, /<a:latin typeface="Cambria Math" panose="[0-9a-f]{20}"/);
  assert.match(out, /<m:sSup><m:e>.*<m:t>c<\/m:t>.*<m:sup>.*<m:t>2<\/m:t>/s);
});

test('omml: identifiers are italic and everything else upright — MathML defaults', async (t) => {
  const out = await omml(t, '\\sin x = 1');
  if (!out) return;
  // `sin` is a multi-letter identifier: upright, or the reader sees s·i·n
  assert.match(out, /<m:rPr><m:sty m:val="p"\/><\/m:rPr>[\s\S]*?<m:t>sin<\/m:t>/);
  // a one-letter identifier takes OMML's own default, which is italic — and
  // Word writes no m:rPr at all there
  assert.match(out, /<m:r><a:rPr[^>]*>[\s\S]*?<m:t>x<\/m:t>/);
});

test('omml: a fraction, a radical and a delimiter each get their own element', async (t) => {
  for (const [tex, re] of [
    ['\\frac{a}{b}', /<m:f><m:fPr><m:type m:val="bar"\/><\/m:fPr><m:num>/],
    ['\\sqrt{x}', /<m:rad><m:radPr><m:degHide m:val="1"\/><\/m:radPr><m:deg\/>/],
    ['\\sqrt[3]{x}', /<m:rad><m:radPr><m:degHide m:val="0"\/><\/m:radPr><m:deg>/],
    ['\\left(x\\right)', /<m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/>/],
    ['\\binom{n}{k}', /<m:type m:val="noBar"\/>/],
  ]) {
    const out = await omml(t, tex);
    if (!out) return;
    assert.match(out, re, tex);
  }
});

// A big operator with scripts is `m:nary`, not `m:sSubSup`: the second draws a
// text-height sigma with a superscript beside it, which is a different formula.
test('omml: a scripted big operator is an n-ary, with its limits where TeX put them', async (t) => {
  const sum = await omml(t, '\\sum_{i=1}^{n} i');
  if (!sum) return;
  assert.match(sum, /<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/>/);
  const int = await omml(t, '\\int_0^1 x');
  assert.match(int, /<m:chr m:val="∫"\/><m:limLoc m:val="subSup"\/>/);
  // both slots are written even when hidden — CT_Nary requires the pair
  const bare = await omml(t, '\\sum^{n} i');
  assert.match(bare, /<m:subHide m:val="1"\/><m:supHide m:val="0"\/>/);
  assert.match(bare, /<m:sub\/>|<m:sub><\/m:sub>/);
});

// The one place the converter interprets rather than translates: in MathML the
// summand is a SIBLING of the operator, in OMML it belongs inside as `m:e`.
// Leaving that slot empty is not cosmetic — PowerPoint draws an empty operand
// as a dotted placeholder box, so the reader sees a hole in the formula.
test('omml: an n-ary takes its operand, and stops at the operator that ends it', async (t) => {
  const out = await omml(t, '\\sum_{i=1}^{n} i^2 + 3');
  if (!out) return;
  const e = /<m:e>([\s\S]*)<\/m:e><\/m:nary>/.exec(out);
  assert.ok(e, 'the n-ary has no operand slot');
  assert.match(e[1], /<m:t>i<\/m:t>/, 'the summand belongs inside the n-ary');
  assert.ok(!/<m:t>3<\/m:t>/.test(e[1]), 'what follows the + does not');
  assert.match(out, /<\/m:nary>[\s\S]*<m:t>3<\/m:t>/, 'and it is still in the equation');
});

test('omml: an accent is a combining mark, an overline is a bar, a limit is a limit', async (t) => {
  const hat = await omml(t, '\\hat{n}');
  if (!hat) return;
  assert.match(hat, /<m:acc><m:accPr><m:chr m:val="̂"\/>/, 'the COMBINING circumflex');
  assert.match(await omml(t, '\\overline{AB}'), /<m:bar><m:barPr><m:pos m:val="top"\/>/);
  assert.match(await omml(t, '\\lim_{x\\to 0} f'), /<m:limLow><m:limLowPr\/>/);
});

test('omml: a matrix keeps its shape, columns declared once', async (t) => {
  const out = await omml(t, '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}');
  if (!out) return;
  assert.match(out, /<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="2"\/>/);
  assert.equal((out.match(/<m:mr>/g) ?? []).length, 2);
});

test('omml: text runs keep the space that separates them from the maths', async (t) => {
  const out = await omml(t, '\\text{if } x > 0');
  if (!out) return;
  assert.match(out, /<m:nor\/>/, 'mtext is literal text, not a product of letters');
  // MathJax writes the trailing gap of `\text{if }` as a NO-BREAK space, and
  // `xml:space` is what stops a parser from collapsing it away
  assert.match(out, /<m:t xml:space="preserve">if\s<\/m:t>/);
});

test('omml: a glyph that is XML syntax is escaped, not written raw', async (t) => {
  const out = await omml(t, 'a < b & c');
  if (!out) return;
  assert.match(out, /<m:t>&lt;<\/m:t>/);
  assert.ok(!/<m:t><</.test(out));
});

// ---------------------------------------------------------------------------
// What it refuses — the half that makes the feature safe
// ---------------------------------------------------------------------------

test('omml: a construct it cannot map exactly returns null, never a partial one', () => {
  for (const [what, body] of [
    [
      'menclose — a \\cancel that vanished would change the maths',
      '<menclose notation="updiagonalstrike"><mi>x</mi></menclose>',
    ],
    ['mmultiscripts', '<mmultiscripts><mi>F</mi><mn>1</mn><none/></mmultiscripts>'],
    ['maction', '<maction actiontype="toggle"><mi>a</mi><mi>b</mi></maction>'],
    ['merror', '<merror><mtext>bad</mtext></merror>'],
    ['ms', '<ms>literal</ms>'],
    ['an element no MathJax version has emitted yet', '<mfuture><mi>x</mi></mfuture>'],
    ['an unknown mathvariant', '<mi mathvariant="tailored">L</mi>'],
    [
      'a ragged table, which m:m cannot declare',
      '<mtable><mtr><mtd><mi>a</mi></mtd></mtr><mtr><mtd><mi>b</mi></mtd><mtd><mi>c</mi></mtd></mtr></mtable>',
    ],
    ['a spanning cell', '<mtable><mtr><mtd columnspan="2"><mi>a</mi></mtd></mtr></mtable>'],
    ['msup with the wrong number of children', '<msup><mi>x</mi></msup>'],
    [
      'an unmappable node nested deep inside a mappable one',
      '<mfrac><mi>a</mi><menclose><mi>b</mi></menclose></mfrac>',
    ],
  ])
    assert.equal(ommlFromMathML(MML(body)), null, what);
});

test('omml: input that is not MathJax MathML returns null rather than half a tree', () => {
  for (const bad of [
    '',
    '   ',
    null,
    undefined,
    42,
    '<html><body>no</body></html>',
    '<math><mi>x</mi>', // unclosed
    '<math><mi>x</mo></math>', // mismatched
    '<math><!-- a comment --><mi>x</mi></math>',
    '<math></math>', // nothing to convert
    '<math><mspace width="1em"/></math>', // nothing that survives conversion
  ])
    assert.equal(ommlFromMathML(bad), null, JSON.stringify(bad));
});

test('omml: an equation MathJax cannot parse never reaches the converter', async (t) => {
  const out = await mathSvg('\\frac{');
  if (out === null && (await mathSvg('x')) === null) {
    t.skip('mathjax-full absent on this machine');
    return;
  }
  assert.equal(out, null, 'invalid LaTeX has no picture and therefore no OMML either');
});
