/**
 * Diagrams: the geometry module and the OOXML parts built from it.
 *
 * Two halves, and the split matters.
 *
 * `deck/smartart.mjs` is the ONE source of coordinates for three consumers —
 * the HTML twin, the native .pptx shapes and the injected `drawingN.xml`.
 * Because a diagram travels through the scene as a SINGLE element, its inner
 * geometry is deliberately absent from `demo.scenes.json`: the golden would
 * show one rectangle and say nothing about the ring inside it. This file is
 * therefore the golden for diagram geometry, and the snapshots below are it.
 *
 * `pptx/diagram-parts.mjs` is checked on its INVARIANTS rather than its bytes.
 * A SmartArt object fails silently — a label the colour part never heard of
 * renders as an invisible shape, a `presName` with no layout node renders as
 * nothing at all — so what is asserted here is that the five parts agree with
 * each other, which is the class of defect no reader would report as a bug.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartArtGeometry, smartArtSvg } from '../src/deck/smartart.mjs';
import { FAMILIES, buildDiagramParts } from '../src/pptx/diagram-parts.mjs';
import { COLORS, composite, contrastRatio, solidInk } from '../src/deck/tokens.mjs';
import { assertGolden } from './helpers.mjs';

const W = 1184;
const H = 560;

const nodes = (...names) => names.map((text) => ({ text }));

const BLOCKS = {
  cycle: { type: 'smartart', family: 'cycle', nodes: nodes('Plan', 'Build', 'Review', 'Ship') },
  venn: { type: 'smartart', family: 'venn', nodes: nodes('Desirable', 'Feasible', 'Viable') },
  radial: {
    type: 'smartart',
    family: 'radial',
    hub: 'Compiler core',
    nodes: nodes('CLI', 'VS Code', 'Playground', 'CI'),
  },
  'pyramid-diagram': {
    type: 'smartart',
    family: 'pyramid-diagram',
    nodes: nodes('Vision', 'Strategy', 'Execution'),
  },
  hierarchy: {
    type: 'smartart',
    family: 'hierarchy',
    nodes: [
      {
        text: 'Delivery',
        children: [
          { text: 'Engineering', children: [{ text: 'Platform' }, { text: 'Product' }] },
          { text: 'Design' },
        ],
      },
    ],
  },
};

const boxes = (g) => [...g.shapes, ...g.links, ...g.labels];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test('every family lays out INSIDE its region, at every node count it accepts', () => {
  const out = [];
  for (const family of ['cycle', 'venn', 'radial', 'pyramid-diagram']) {
    for (let n = 2; n <= 8; n++) {
      const block = {
        ...BLOCKS[family],
        nodes: nodes(...Array.from({ length: n }, (_, i) => `N${i}`)),
      };
      const g = smartArtGeometry(block, W, H);
      for (const b of boxes(g)) {
        // half a pixel of slack: the coordinates are rounded to 1/100 px, and
        // an exact-equality bound would fail on the rounding rather than on
        // the geometry
        if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5)
          out.push(`${family}/${n}: ${JSON.stringify(b)}`);
      }
    }
  }
  assert.deepEqual(
    out,
    [],
    'shapes outside the region — they would be clipped in the HTML and lost in the .pptx',
  );
});

test('a diagram draws exactly the nodes it was given, and one label each', () => {
  for (let n = 3; n <= 8; n++) {
    const g = smartArtGeometry(
      { ...BLOCKS.cycle, nodes: nodes(...Array.from({ length: n }, (_, i) => `N${i}`)) },
      W,
      H,
    );
    assert.equal(g.shapes.length, n, `cycle of ${n}: node count`);
    assert.equal(
      g.links.length,
      n,
      `cycle of ${n}: a ring CLOSES — one arrow per node, including the last`,
    );
    assert.equal(g.labels.length, n, `cycle of ${n}: label count`);
  }
  // the hierarchy counts every node of the tree, at every depth
  const h = smartArtGeometry(BLOCKS.hierarchy, W, H);
  assert.equal(h.shapes.length, 5);
  assert.equal(h.labels.length, 5);
  // a hub is a node too, and it is the first
  const r = smartArtGeometry(BLOCKS.radial, W, H);
  assert.equal(r.shapes.length, 5);
  assert.equal(r.labels[0].text, 'Compiler core');
  assert.equal(r.links.length, 4, 'one spoke per satellite, none for the hub');
});

test('the geometry is deterministic — two calls, identical numbers', () => {
  for (const block of Object.values(BLOCKS)) {
    assert.deepEqual(smartArtGeometry(block, W, H), smartArtGeometry(block, W, H));
  }
});

test('geometry snapshot per family (this file is the golden the scenes cannot be)', () => {
  assertGolden(
    'smartart.geometry.json',
    Object.fromEntries(
      Object.entries(BLOCKS).map(([name, block]) => [name, smartArtGeometry(block, W, H)]),
    ),
  );
});

test('the SVG is exactly the region, and carries nothing global to the document', () => {
  for (const [name, block] of Object.entries(BLOCKS)) {
    const svg = smartArtSvg(block, W, H);
    assert.match(svg, new RegExp(`viewBox="0 0 ${W} ${H}"`), `${name}: the viewBox IS the region`);
    assert.match(svg, new RegExp(`width="${W}" height="${H}"`), `${name}: no clamping`);
    // ids inlined into one HTML document are global to the deck — which is
    // why uniquifySvgIds exists for the SVG we do NOT author. Ours carries
    // none, so it needs no rewriting and cannot collide.
    assert.doesNotMatch(
      svg,
      /\sid=|<defs|url\(#|<marker/,
      `${name}: no id, defs, marker or url(#)`,
    );
  }
});

test('a rotated link states the SAME rotation on both sides — the convention holds', () => {
  for (const family of ['cycle', 'radial']) {
    const g = smartArtGeometry(BLOCKS[family], W, H);
    const svg = smartArtSvg(BLOCKS[family], W, H);
    const rotations = [...svg.matchAll(/transform="rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)"/g)];
    const turned = g.links.filter((l) => l.rotate);
    assert.equal(rotations.length, turned.length, `${family}: one transform per rotated link`);
    turned.forEach((l, i) => {
      const [, deg, cx, cy] = rotations[i];
      // degrees CLOCKWISE about the box centre — the same number PptxGenJS
      // takes in `rotate:`, about the same point. An inverted sign here would
      // send every arrow the wrong way round the ring and no other test
      // would notice, because the boxes themselves would be identical.
      assert.equal(Number(deg), l.rotate, `${family}: link ${i} angle`);
      assert.equal(
        Number(cx),
        Math.round((l.x + l.w / 2) * 100) / 100,
        `${family}: link ${i} centre x`,
      );
      assert.equal(
        Number(cy),
        Math.round((l.y + l.h / 2) * 100) / 100,
        `${family}: link ${i} centre y`,
      );
    });
  }
});

test('a Venn disc is translucent in the SVG and its ink is measured against what shows', () => {
  const g = smartArtGeometry(BLOCKS.venn, W, H);
  const svg = smartArtSvg(BLOCKS.venn, W, H);
  for (const s of g.shapes) {
    assert.equal(s.alpha, 0.22, 'the discs overlap: the overlap has to show through');
    assert.equal(s.line, null, 'no outline — PptxGenJS has no LINE transparency, only fill');
  }
  assert.match(svg, /fill-opacity="0.22"/);
  // the ink is chosen against the COMPOSITED surface, not against the opaque
  // shade: at 22 % a dark blue disc is a pale tint, and ink picked from the
  // full-strength colour would pass a contrast check measuring a pair no
  // reader ever sees
  for (const s of g.shapes) {
    const seen = composite(s.fill, COLORS.ground, 0.22);
    assert.equal(s.ink, solidInk(seen, COLORS.neutralPrimary));
    assert.ok(
      contrastRatio(s.ink, seen) >= 4.5,
      `venn label ${s.ink} on ${seen} measures ${contrastRatio(s.ink, seen).toFixed(2)}:1`,
    );
  }
});

test('a diagram label clears AA against the shape it sits on', () => {
  for (const [name, block] of Object.entries(BLOCKS)) {
    if (name === 'venn') continue; // measured above, against the composite
    const g = smartArtGeometry(block, W, H);
    for (const l of g.labels) {
      const shape = g.shapes[l.of];
      const ratio = contrastRatio(l.ink, shape.fill);
      assert.ok(
        ratio >= 4.5,
        `${name}: "${l.text}" ${l.ink} on ${shape.fill} measures ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('a node label carrying XML metacharacters is escaped in the SVG', () => {
  const svg = smartArtSvg(
    { type: 'smartart', family: 'cycle', nodes: nodes('A & B', '<c>', 'd') },
    W,
    H,
  );
  assert.match(svg, /A &amp; B/);
  assert.match(svg, /&lt;c&gt;/);
  assert.doesNotMatch(svg, /<c>/);
});

// ---------------------------------------------------------------------------
// The OOXML parts
// ---------------------------------------------------------------------------

const build = (family, index = 1) =>
  buildDiagramParts({
    family,
    block: BLOCKS[family],
    geometry: smartArtGeometry(BLOCKS[family], W, H),
    index,
    drawingRelId: 'rId9',
  });

const FAMILY_NAMES = Object.keys(FAMILIES);

/** Minimal well-formedness: tags balance and nest. Not a schema check — that
 *  needs PowerPoint, and the gate in docs/plans/smartart.md is where it is
 *  recorded. This catches the class we CAN catch: a stray `<`, an unclosed
 *  element, an attribute that swallowed a quote. */
function xmlProblem(source) {
  // the declaration is a processing instruction, not an element: it is
  // stripped rather than parsed, so that a genuine stray "<" further down
  // still reports as one
  const xml = source.replace(/^<\?xml[^>]*\?>/, '');
  const stack = [];
  const re = /<\/?([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0;
  for (const m of xml.matchAll(re)) {
    if (xml.slice(last, m.index).includes('<')) return `stray "<" before ${m[0].slice(0, 40)}`;
    last = m.index + m[0].length;
    if (m[0].startsWith('</')) {
      if (stack.pop() !== m[1]) return `closing </${m[1]}> does not match`;
    } else if (!m[3]) stack.push(m[1]);
  }
  if (xml.slice(last).includes('<')) return 'stray "<" after the last tag';
  return stack.length ? `unclosed: ${stack.join(', ')}` : null;
}

test('every generated part is well-formed XML', () => {
  for (const family of FAMILY_NAMES) {
    const parts = build(family);
    for (const [key, xml] of Object.entries(parts)) {
      assert.equal(xmlProblem(xml), null, `${family}/${key}`);
    }
  }
});

test('the parts are byte-identical across two builds — a .pptx must be diffable', () => {
  for (const family of FAMILY_NAMES) {
    assert.deepEqual(build(family), build(family));
  }
});

test('every modelId is a braced upper-case GUID', () => {
  const GUID = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/;
  for (const family of FAMILY_NAMES) {
    for (const m of build(family).data.matchAll(/modelId="([^"]*)"/g)) {
      assert.match(m[1], GUID, `${family}: ${m[1]}`);
    }
  }
});

test('every connection names a point that exists', () => {
  for (const family of FAMILY_NAMES) {
    const data = build(family).data;
    const ids = new Set([...data.matchAll(/modelId="([^"]*)"/g)].map((m) => m[1]));
    const dangling = [...data.matchAll(/<dgm:cxn [^>]*srcId="([^"]*)" destId="([^"]*)"/g)]
      .flatMap((m) => [m[1], m[2]])
      .filter((id) => !ids.has(id));
    assert.deepEqual(dangling, [], `${family}: connections pointing at nothing`);
  }
});

test('data and layout agree on every presName and every style label', () => {
  for (const family of FAMILY_NAMES) {
    const { data, layout, colors, quickStyle } = build(family);
    const styleOf = new Map(
      [...layout.matchAll(/<dgm:layoutNode name="([^"]*)"(?: styleLbl="([^"]*)")?/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const pres = [...data.matchAll(/presName="([^"]*)" presStyleLbl="([^"]*)"/g)];
    assert.ok(
      pres.length,
      `${family}: the pres tree is not optional — without it PowerPoint draws floating text and no shapes`,
    );
    for (const [, name, lbl] of pres) {
      // PowerPoint REGENERATES the pres tree from the layout on load, so a
      // presStyleLbl the layout node does not carry is simply overwritten —
      // by a label we never shipped, whose lookup then misses.
      assert.ok(styleOf.has(name), `${family}: presName "${name}" has no layout node`);
      assert.equal(
        styleOf.get(name),
        lbl,
        `${family}: "${name}" labelled differently in data and layout`,
      );
    }
    const colorLbls = new Set(
      [...colors.matchAll(/<dgm:styleLbl name="([^"]*)"/g)].map((m) => m[1]),
    );
    const qsLbls = new Set(
      [...quickStyle.matchAll(/<dgm:styleLbl name="([^"]*)"/g)].map((m) => m[1]),
    );
    for (const [, , lbl] of pres) {
      assert.ok(
        colorLbls.has(lbl),
        `${family}: "${lbl}" absent from colors — the shape would have no fill`,
      );
      assert.ok(qsLbls.has(lbl), `${family}: "${lbl}" absent from quickStyle`);
    }
  }
});

test('the shape style is complete, and never discards the colour part', () => {
  for (const family of FAMILY_NAMES) {
    const qs = build(family).quickStyle;
    const styles = [...qs.matchAll(/<dgm:style>([\s\S]*?)<\/dgm:style>/g)].map((m) => m[1]);
    assert.ok(styles.length, `${family}: no dgm:style`);
    for (const s of styles) {
      // a:CT_ShapeStyle requires all four, in this order; a partial one is
      // schema-invalid, which is a repair prompt
      assert.match(
        s,
        /^<a:lnRef[\s\S]*<a:fillRef[\s\S]*<a:effectRef[\s\S]*<a:fontRef[\s\S]*$/,
        `${family}: lnRef, fillRef, effectRef, fontRef — all four, in order`,
      );
    }
    // idx 0 means "no theme fill", and with no theme fill colorsN.xml never
    // reaches the shape at all
    assert.doesNotMatch(
      qs,
      /<a:fillRef idx="0"/,
      `${family}: fillRef idx=0 would discard the palette`,
    );
  }
});

test('the palette is literal, and the same one the geometry drew', () => {
  for (const family of FAMILY_NAMES) {
    const { colors, drawing } = build(family);
    const g = smartArtGeometry(BLOCKS[family], W, H);
    // PptxGenJS writes a FIXED Office theme and lutrin never rewrites it, so
    // a schemeClr here would render Office blue inside a branded deck
    assert.doesNotMatch(colors, /schemeClr/, `${family}: no theme accent in the colour part`);
    for (const s of g.shapes) {
      assert.ok(colors.includes(s.fill), `${family}: ${s.fill} missing from colorsN.xml`);
      assert.ok(drawing.includes(s.fill), `${family}: ${s.fill} missing from the drawing cache`);
    }
    for (const l of g.labels) {
      assert.ok(
        drawing.includes(`sz="${Math.round(l.pt * 100)}"`),
        `${family}: label size ${l.pt}pt absent from the cache`,
      );
      assert.ok(drawing.includes(l.ink), `${family}: label ink ${l.ink} absent from the cache`);
    }
  }
});

test('the drawing cache places its shapes in EMU at the geometry it was given', () => {
  const g = smartArtGeometry(BLOCKS.cycle, W, H);
  const drawing = build('cycle').drawing;
  const emu = (px) => Math.round((px / 96) * 914400);
  for (const s of g.shapes) {
    assert.ok(
      drawing.includes(
        `<a:off x="${emu(s.x)}" y="${emu(s.y)}"/><a:ext cx="${emu(s.w)}" cy="${emu(s.h)}"/>`,
      ),
      `cycle: no cached shape at ${s.x},${s.y}`,
    );
  }
});

test('a label carrying XML metacharacters round-trips through the parts', () => {
  const block = { type: 'smartart', family: 'cycle', nodes: nodes('A & B <c> "d"', 'x', 'y') };
  const parts = buildDiagramParts({
    family: 'cycle',
    block,
    geometry: smartArtGeometry(block, W, H),
    index: 1,
    drawingRelId: 'rId9',
  });
  for (const key of ['data', 'drawing']) {
    assert.equal(xmlProblem(parts[key]), null, key);
    assert.match(parts[key], /A &amp; B &lt;c&gt; "d"/, `${key}: escaped, not dropped`);
  }
});

test('the builder refuses rather than emitting a part that cannot work', () => {
  const geometry = smartArtGeometry(BLOCKS.cycle, W, H);
  assert.throws(
    () =>
      buildDiagramParts({
        family: 'nope',
        block: BLOCKS.cycle,
        geometry,
        index: 1,
        drawingRelId: 'r',
      }),
    /unknown SmartArt family/,
  );
  assert.throws(
    () =>
      buildDiagramParts({
        family: 'cycle',
        block: BLOCKS.cycle,
        geometry,
        index: 1,
        drawingRelId: '',
      }),
    /no relationship id/,
  );
  assert.throws(
    () =>
      buildDiagramParts({
        family: 'cycle',
        block: BLOCKS.cycle,
        geometry: { shapes: [], links: [], labels: [] },
        index: 1,
        drawingRelId: 'r',
      }),
    /no geometry/,
  );
});
