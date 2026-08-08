/**
 * MathML → OMML, the conversion that makes an equation editable in PowerPoint.
 *
 * MathJax already produces MathML on its way to the SVG this renderer
 * rasterises (`deck/assets.mjs`), so nothing here re-parses LaTeX: the input is
 * the tree MathJax itself built, and the output is the `<m:oMathPara>` that
 * `pptx/equations.mjs` drops into a slide's text body.
 *
 * THE GOLDEN RULE, and the reason this file is written the way it is: an
 * equation converted ALMOST right is worse than a picture. A reader who is
 * handed something they can click into and edit will trust it, and a silently
 * dropped `\cancel` or a mis-scoped `\sum` is a lie they will carry into their
 * next slide. So every function below returns `null` the moment it meets a
 * construct it cannot map exactly, `null` propagates all the way out, and the
 * caller keeps today's picture. The converter has to know what it does not
 * know — that is the whole of gap #4's "the fallback has to stay".
 *
 * WHY A HAND-ROLLED PARSER. The documented path is an XSLT (`MML2OMML.XSL`,
 * shipped with Office since 2007), and there is no XSLT engine in this
 * dependency set. Pulling one in — plus a DOM — to transform a string MathJax
 * produced in-process is a heavy dependency for a narrow job; the input is not
 * arbitrary XML but the output of ONE serializer (`SerializedMmlVisitor`),
 * which emits no comments, no CDATA, no processing instructions and no
 * namespace prefixes. A 60-line reader covers it, and anything it does not
 * recognise takes the same exit as an unmappable element.
 *
 * WHAT IS DELIBERATELY NOT COVERED, because each would be a guess:
 * `menclose` (a `\cancel` that vanishes changes the maths), `mmultiscripts`,
 * `maction`, `merror`, `mglyph`, `ms`, and any `mathvariant` outside the table
 * below. Each returns null and ships the picture.
 */

const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** The font PowerPoint's own equations are set in — the reference package
 *  (`.reference-pptx/tdf129372.pptx`) carries these exact attributes on every
 *  run, and matching them is what makes our runs indistinguishable from the
 *  ones its editor writes. */
const CAMBRIA =
  '<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/>';

// ---------------------------------------------------------------------------
// A reader for what SerializedMmlVisitor emits
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#')
      return String.fromCodePoint(
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number(body.slice(1)),
      );
    return ENTITIES[body] ?? all;
  });

/** Element text, for the OOXML we write back out. */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

/**
 * MathML string → `{name, attrs, children}` tree, or null if anything about
 * the document is not the narrow shape described in the header.
 *
 * Text nodes are `{text}`. Whitespace-only text between elements is dropped:
 * the serializer pretty-prints, and that indentation is not content.
 */
function parseMathML(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      if (decode(src.slice(i)).trim()) return null; // text after the root element
      break;
    }
    if (lt > i) {
      const raw = src.slice(i, lt);
      if (raw.trim()) stack[stack.length - 1].children.push({ text: decode(raw) });
    }
    const gt = src.indexOf('>', lt);
    if (gt === -1) return null;
    const tag = src.slice(lt + 1, gt);
    // no comments, CDATA, doctypes or PIs come out of the serializer; meeting
    // one means the input is not what this reader was written for
    if (/^[!?]/.test(tag)) return null;
    i = gt + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      if (stack.length < 2 || stack[stack.length - 1].name !== name) return null;
      stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const m = body.match(/^([A-Za-z_][\w.-]*)/);
    if (!m) return null;
    const el = { name: m[1], attrs: {}, children: [] };
    for (const a of body.slice(m[1].length).matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g))
      el.attrs[a[1]] = decode(a[2]);
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length !== 1) return null; // unclosed element
  const els = root.children.filter((c) => !c.text);
  return els.length === 1 ? els[0] : null;
}

/** The concatenated text of an element, or null if it holds anything else. */
function textOf(el) {
  let out = '';
  for (const c of el.children) {
    if (c.text == null) return null;
    out += c.text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The vocabulary tables
// ---------------------------------------------------------------------------

/** Operators OMML draws as an n-ary: a big glyph with its own limit slots.
 *  A `∑` with scripts is `m:nary`, not `m:sSubSup` — the second renders a
 *  normal-height sigma with a superscript, which is a different equation. */
const NARY = new Set([
  '∑', // ∑
  '∏', // ∏
  '∐', // ∐
  '∫', // ∫
  '∬',
  '∭',
  '∮',
  '∯',
  '∰',
  '⋀', // ⋀
  '⋁',
  '⋂',
  '⋃',
  '⨀', // ⨀
  '⨁',
  '⨂',
  '⨄',
  '⨅',
  '⨆',
]);

/** An overscript that is an ACCENT rather than a limit: MathJax writes the
 *  spacing form of the mark (`^`, `~`, `→`), OMML wants the COMBINING one. */
const ACCENT = new Map([
  ['^', '̂'],
  ['ˆ', '̂'],
  ['~', '̃'],
  ['˜', '̃'],
  ['´', '́'],
  ['ˊ', '́'],
  ['`', '̀'],
  ['ˋ', '̀'],
  ['¨', '̈'],
  ['.', '̇'],
  ['˙', '̇'],
  ['ˇ', '̌'],
  ['˘', '̆'],
  ['→', '⃗'], // \vec
  ['⇀', '⃑'],
  ['↼', '⃐'],
]);

/** A bar rather than a limit — `\overline` and `\underline`. */
const BAR = new Set(['―', '¯', '‾', '_', '_']);

/**
 * `mathvariant` → OMML run properties.
 *
 * `sty` carries plain/bold/italic/bold-italic and `scr` the alphabet. Anything
 * NOT in this table (a variant a future MathJax adds, or one of the `-tex-*`
 * forms not listed) fails the conversion rather than silently rendering as
 * upright roman: `\mathcal{L}` drawn as a plain L is a different symbol.
 */
const VARIANT = {
  normal: { sty: 'p' },
  bold: { sty: 'b' },
  italic: { sty: 'i' },
  'bold-italic': { sty: 'bi' },
  'double-struck': { sty: 'p', scr: 'double-struck' },
  script: { sty: 'p', scr: 'script' },
  'bold-script': { sty: 'b', scr: 'script' },
  fraktur: { sty: 'p', scr: 'fraktur' },
  'bold-fraktur': { sty: 'b', scr: 'fraktur' },
  'sans-serif': { sty: 'p', scr: 'sans-serif' },
  'bold-sans-serif': { sty: 'b', scr: 'sans-serif' },
  'sans-serif-italic': { sty: 'i', scr: 'sans-serif' },
  'sans-serif-bold-italic': { sty: 'bi', scr: 'sans-serif' },
  monospace: { sty: 'p', scr: 'monospace' },
  '-tex-calligraphic': { sty: 'i', scr: 'script' },
  '-tex-bold-calligraphic': { sty: 'bi', scr: 'script' },
  '-tex-mathit': { sty: 'i' },
  '-tex-oldstyle': { sty: 'p' },
  '-tex-bold-oldstyle': { sty: 'b' },
};

/** Operators that CLOSE an n-ary's operand. `∑_{i} a_i + b` means `(∑ a_i) + b`
 *  — the sum binds tighter than the addition, and tighter still than a
 *  relation. This is the same scoping every MathML→OMML transform applies, and
 *  it is the one place the converter interprets rather than translates. */
const NARY_STOP = new Set([
  '=',
  '≠',
  '<',
  '>',
  '≤',
  '≥',
  '≈',
  '≡',
  '∼',
  '≅',
  '∝',
  '∈',
  '∉',
  '⊂',
  '⊃',
  '⊆',
  '⊇',
  '≪',
  '≫',
  '→',
  '←',
  '↔',
  '⇒',
  '⇐',
  '⇔',
  '+',
  '-',
  '−',
  '±',
  '∓',
  ',',
  ';',
]);

/** Invisible operators MathJax inserts for structure (function application,
 *  invisible times). They carry no glyph, and OMML has no element for them. */
const INVISIBLE = new Set(['⁡', '⁢', '⁣', '⁤']);

/** Fences that open / close a delimited group. `data-mjx-texclass` covers what
 *  MathJax marks up itself; the literal set covers a bare `(x)`. */
const OPEN_CHARS = new Set(['(', '[', '{', '⟨', '⌈', '⌊', '|', '‖']);
const CLOSE_CHARS = new Set([')', ']', '}', '⟩', '⌉', '⌋', '|', '‖']);

/** Elements whose only job is grouping: their children take their place. */
const TRANSPARENT = new Set(['mrow', 'mstyle', 'mpadded', 'semantics', 'math']);

/** Elements that contribute nothing to OMML and are dropped whole. OMML spaces
 *  its own operators, so a MathJax `\,` is not information it can use. */
const IGNORED = new Set(['mspace', 'mphantom', 'none', 'annotation', 'annotation-xml']);

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * One `m:r`. `style` is the OMML default (italic) when omitted, which is why a
 * single-letter `mi` emits no `m:rPr` at all — exactly what Word writes.
 */
function run(text, style, rPr) {
  const { sty, scr, nor } = style ?? {};
  if (!text) return '';
  const props = [
    nor ? '<m:nor/>' : '',
    scr ? `<m:scr m:val="${scr}"/>` : '',
    sty ? `<m:sty m:val="${sty}"/>` : '',
  ].join('');
  // xml:space matters: a run of `\text{if }` ends in a space that carries the
  // gap before the next symbol, and a collapsing parser would eat it
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<m:r>${props ? `<m:rPr>${props}</m:rPr>` : ''}${rPr}<m:t${space}>${esc(text)}</m:t></m:r>`;
}

/**
 * A token element (`mi`, `mn`, `mo`, `mtext`) → a run, or null.
 *
 * The default styles are MathML's own: an identifier of one character is
 * italic, everything else — multi-letter function names, numbers, operators —
 * is upright. Getting this backwards turns `sin x` into a product of three
 * variables.
 */
function tokenRun(el, rPr) {
  const text = textOf(el);
  if (text == null) return null;
  const variant = el.attrs.mathvariant;
  if (variant != null && !VARIANT[variant]) return null;
  const style = variant ? { ...VARIANT[variant] } : {};
  if (!variant) {
    if (el.name === 'mtext') style.nor = true;
    else if (el.name !== 'mi' || [...text].length > 1) style.sty = 'p';
  }
  return run(text, style, rPr);
}

// ---------------------------------------------------------------------------
// The tree walk
// ---------------------------------------------------------------------------

/** Wraps a converted fragment in an OMML slot (`m:e`, `m:num`, `m:sup`, …). */
const slot = (tag, inner) => `<m:${tag}>${inner}</m:${tag}>`;

/** Children that are elements — the serializer's indentation is not content. */
const kids = (el) => el.children.filter((c) => c.text == null);

/** Is this element an `mo` carrying exactly `ch`? */
const isOp = (el, test) => {
  if (!el || el.name !== 'mo') return false;
  const t = textOf(el);
  return t != null && test(t.trim());
};

/**
 * A sequence of siblings → OMML, or null.
 *
 * This is where n-ary scoping happens, and it is the only lookahead in the
 * file: `<munderover><mo>∑</mo>…</munderover>` is followed in MathML by the
 * expression it sums, which in OMML belongs INSIDE the n-ary as `m:e`. Leaving
 * that slot empty is not a cosmetic difference — PowerPoint draws an empty
 * operand as a dotted placeholder box, so the reader sees a hole.
 */
function convertSeq(nodes, rPr) {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const nary = naryOf(el, rPr);
    if (nary === null) return null;
    if (nary) {
      let j = i + 1;
      while (j < nodes.length && !isOp(nodes[j], (t) => NARY_STOP.has(t))) j += 1;
      const operand = convertSeq(nodes.slice(i + 1, j), rPr);
      if (operand === null) return null;
      out += nary.open + slot('e', operand) + nary.close;
      i = j - 1;
      continue;
    }
    const piece = convertNode(el, rPr);
    if (piece === null) return null;
    out += piece;
  }
  return out;
}

/**
 * `{open, close}` when `el` is a scripted n-ary operator, `false` when it is
 * not one, `null` when it is one this cannot serialise.
 *
 * `limLoc` says where the limits sit: over and under for `\sum_{i=1}^{n}`
 * (MathML `munderover`), beside for `\int_0^1` (`msubsup`). PowerPoint honours
 * both, and using the wrong one is visibly not the equation that was written.
 */
function naryOf(el, rPr) {
  const scripted = {
    munderover: { limLoc: 'undOvr', slots: ['sub', 'sup'] },
    munder: { limLoc: 'undOvr', slots: ['sub'] },
    mover: { limLoc: 'undOvr', slots: ['sup'] },
    msubsup: { limLoc: 'subSup', slots: ['sub', 'sup'] },
    msub: { limLoc: 'subSup', slots: ['sub'] },
    msup: { limLoc: 'subSup', slots: ['sup'] },
  }[el?.name];
  if (!scripted) return false;
  const ch = kids(el);
  if (ch.length !== scripted.slots.length + 1) return null;
  const base = ch[0];
  const glyph = base.name === 'mo' ? textOf(base)?.trim() : null;
  if (!glyph || !NARY.has(glyph)) return false;

  // `m:sub` and `m:sup` are BOTH required by CT_Nary; the ones the expression
  // does not use are written empty and hidden, which is what Word does too.
  const filled = { sub: '', sup: '' };
  for (let k = 0; k < scripted.slots.length; k++) {
    const inner = convertSeq([ch[k + 1]], rPr);
    if (inner === null) return null;
    filled[scripted.slots[k]] = inner;
  }
  const has = (name) => scripted.slots.includes(name);
  const pr = [
    `<m:chr m:val="${escAttr(glyph)}"/>`,
    `<m:limLoc m:val="${scripted.limLoc}"/>`,
    `<m:subHide m:val="${has('sub') ? '0' : '1'}"/>`,
    `<m:supHide m:val="${has('sup') ? '0' : '1'}"/>`,
  ].join('');
  return {
    open: `<m:nary><m:naryPr>${pr}</m:naryPr>${slot('sub', filled.sub)}${slot('sup', filled.sup)}`,
    close: '</m:nary>',
  };
}

/** One element → OMML, or null. */
function convertNode(el, rPr) {
  const name = el.name;
  if (IGNORED.has(name)) return '';
  if (TRANSPARENT.has(name)) {
    const ch = kids(el);
    if (name === 'mrow' || name === 'math') {
      const d = delimited(ch, rPr);
      if (d !== false) return d; // null propagates, a string is the m:d
    }
    return convertSeq(ch, rPr);
  }

  switch (name) {
    case 'mi':
    case 'mn':
    case 'mtext':
      return tokenRun(el, rPr);
    case 'mo': {
      const t = textOf(el);
      if (t == null) return null;
      if ([...t.trim()].every((c) => INVISIBLE.has(c))) return '';
      return tokenRun(el, rPr);
    }
    case 'mfrac':
      return frac(el, rPr);
    case 'msqrt':
    case 'mroot':
      return radical(el, rPr);
    case 'msup':
    case 'msub':
    case 'msubsup':
      return scripts(el, rPr);
    case 'mover':
    case 'munder':
    case 'munderover':
      return limits(el, rPr);
    case 'mtable':
      return matrix(el, rPr);
    default:
      // menclose, mmultiscripts, maction, merror, mglyph, ms, and anything a
      // future MathJax invents: the picture is the honest answer
      return null;
  }
}

/** `<mrow>(…)</mrow>` → `m:d`, `false` when the row is not delimited. */
function delimited(ch, rPr) {
  if (ch.length < 2) return false;
  const first = ch[0];
  const last = ch[ch.length - 1];
  if (first.name !== 'mo' || last.name !== 'mo') return false;
  const beg = textOf(first)?.trim();
  const end = textOf(last)?.trim();
  if (beg == null || end == null) return false;
  const cls = (el) => el.attrs['data-mjx-texclass'];
  const opens = cls(first) === 'OPEN' || (cls(first) == null && OPEN_CHARS.has(beg));
  const closes = cls(last) === 'CLOSE' || (cls(last) == null && CLOSE_CHARS.has(end));
  if (!opens || !closes) return false;
  const inner = convertSeq(ch.slice(1, -1), rPr);
  if (inner === null) return null;
  const pr = `<m:dPr><m:begChr m:val="${escAttr(beg)}"/><m:endChr m:val="${escAttr(end)}"/></m:dPr>`;
  return `<m:d>${pr}${slot('e', inner)}</m:d>`;
}

function frac(el, rPr) {
  const ch = kids(el);
  if (ch.length !== 2) return null;
  const num = convertSeq([ch[0]], rPr);
  const den = convertSeq([ch[1]], rPr);
  if (num === null || den === null) return null;
  // `linethickness="0"` is how MathJax writes \binom — a stacked pair with no
  // rule, which OMML calls "noBar" and draws the same way
  const thin = el.attrs.linethickness;
  const type =
    thin != null && /^0(\D|$)/.test(thin) ? 'noBar' : el.attrs.bevelled === 'true' ? 'skw' : 'bar';
  return `<m:f><m:fPr><m:type m:val="${type}"/></m:fPr>${slot('num', num)}${slot('den', den)}</m:f>`;
}

function radical(el, rPr) {
  const ch = kids(el);
  if (el.name === 'msqrt') {
    const inner = convertSeq(ch, rPr);
    if (inner === null) return null;
    return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${slot('e', inner)}</m:rad>`;
  }
  if (ch.length !== 2) return null;
  const base = convertSeq([ch[0]], rPr);
  const deg = convertSeq([ch[1]], rPr);
  if (base === null || deg === null) return null;
  return `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr>${slot('deg', deg)}${slot('e', base)}</m:rad>`;
}

function scripts(el, rPr) {
  const shape = {
    msup: { tag: 'sSup', slots: ['sup'] },
    msub: { tag: 'sSub', slots: ['sub'] },
    msubsup: { tag: 'sSubSup', slots: ['sub', 'sup'] },
  }[el.name];
  const ch = kids(el);
  if (ch.length !== shape.slots.length + 1) return null;
  const base = convertSeq([ch[0]], rPr);
  if (base === null) return null;
  let out = `<m:${shape.tag}>${slot('e', base)}`;
  for (let k = 0; k < shape.slots.length; k++) {
    const part = convertSeq([ch[k + 1]], rPr);
    if (part === null) return null;
    out += slot(shape.slots[k], part);
  }
  return `${out}</m:${shape.tag}>`;
}

/**
 * `mover` / `munder` / `munderover` that are NOT n-ary operators.
 *
 * Three different OMML elements hide behind one MathML one, and the script
 * tells them apart: a combining mark is `m:acc` (`\hat{n}`), a rule is `m:bar`
 * (`\overline{AB}`), anything else is a limit (`\lim_{x\to 0}`). Drawing a hat
 * as a limit puts the caret on its own line above the letter, which is not the
 * same notation.
 */
function limits(el, rPr) {
  const ch = kids(el);
  const over = el.name === 'munderover' ? ch[2] : el.name === 'mover' ? ch[1] : null;
  const under = el.name === 'munder' || el.name === 'munderover' ? ch[1] : null;
  if (ch.length !== (el.name === 'munderover' ? 3 : 2)) return null;

  const script = over ?? under;
  const mark = script.name === 'mo' ? textOf(script)?.trim() : null;
  if (el.name !== 'munderover' && mark != null) {
    const base = convertSeq([ch[0]], rPr);
    if (base === null) return null;
    if (ACCENT.has(mark) && over)
      return `<m:acc><m:accPr><m:chr m:val="${escAttr(ACCENT.get(mark))}"/></m:accPr>${slot('e', base)}</m:acc>`;
    if (BAR.has(mark))
      return `<m:bar><m:barPr><m:pos m:val="${over ? 'top' : 'bot'}"/></m:barPr>${slot('e', base)}</m:bar>`;
  }

  // a plain limit: `lim`, `max`, `sup` and friends. `munderover` nests, because
  // OMML has no element carrying both at once outside an n-ary.
  let inner = convertSeq([ch[0]], rPr);
  if (inner === null) return null;
  if (under) {
    const lim = convertSeq([under], rPr);
    if (lim === null) return null;
    inner = `<m:limLow><m:limLowPr/>${slot('e', inner)}${slot('lim', lim)}</m:limLow>`;
  }
  if (over) {
    const lim = convertSeq([over], rPr);
    if (lim === null) return null;
    inner = `<m:limUpp><m:limUppPr/>${slot('e', inner)}${slot('lim', lim)}</m:limUpp>`;
  }
  return inner;
}

/**
 * `mtable` → `m:m`. A ragged table fails the conversion: OMML's matrix
 * declares its column count once, in `m:mcs`, so rows of different widths have
 * no faithful encoding — and a matrix silently squared off is exactly the
 * "almost right" this file exists to refuse.
 */
function matrix(el, rPr) {
  const rows = kids(el);
  if (!rows.length || rows.some((r) => r.name !== 'mtr')) return null;
  const cols = kids(rows[0]).length;
  const body = [];
  for (const r of rows) {
    const cells = kids(r);
    if (cells.length !== cols || cells.some((c) => c.name !== 'mtd')) return null;
    // a spanning cell has no place in m:m either
    if (cells.some((c) => c.attrs.columnspan || c.attrs.rowspan)) return null;
    const out = [];
    for (const c of cells) {
      const inner = convertSeq(kids(c), rPr);
      if (inner === null) return null;
      out.push(slot('e', inner));
    }
    body.push(`<m:mr>${out.join('')}</m:mr>`);
  }
  const mcs = `<m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>`;
  return `<m:m><m:mPr>${mcs}</m:mPr>${body.join('')}</m:m>`;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * MathML → the `<m:oMathPara>` PowerPoint's equation editor opens.
 *
 * @param {string} mathml as `deck/assets.mjs` hands it over (MathJax's own
 *        serialization; anything else is likely to take the null exit).
 * @param {object} [opt]
 * @param {number} [opt.sizePt] point size for the runs, so the native equation
 *        comes out at the size of the picture it replaces.
 * @param {string} [opt.lang] `lang` on every run, as PowerPoint writes it.
 * @returns {string|null} the OMML, or null when ANY part of the expression
 *          could not be mapped exactly — in which case the caller must keep
 *          the picture. Never a partial conversion.
 */
export function ommlFromMathML(mathml, { sizePt = 14, lang = 'en-US' } = {}) {
  if (typeof mathml !== 'string' || !mathml.trim()) return null;
  const root = parseMathML(mathml);
  if (!root || root.name !== 'math') return null;
  // NO `i=` here. Italic is OMML's business (`m:sty`), and a DrawingML run
  // property saying otherwise would override the maths style on every glyph.
  const rPr = `<a:rPr lang="${escAttr(lang)}" sz="${Math.round(sizePt * 100)}">${CAMBRIA}</a:rPr>`;
  let body;
  try {
    body = convertNode(root, rPr);
  } catch {
    // the walk is recursive and the input is machine-written, but a surprise
    // here has exactly one correct outcome, the same as an unknown element
    return null;
  }
  if (body === null || !body.trim()) return null;
  return [
    `<m:oMathPara xmlns:m="${NS_M}">`,
    '<m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>',
    `<m:oMath>${body}</m:oMath>`,
    '</m:oMathPara>',
  ].join('');
}
