/**
 * Generator parameters (review §3.3, step 3, phase A): every built-in layout
 * declares a paramSchema (the single source of truth); a JSON layout sets
 * parameters at the top level — validated (types, domains, "did you mean"),
 * published by capabilities(), defaults = historical behaviour (an alias with
 * no parameters stays a pure alias, goldens intact).
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck/parse.mjs';
import {
  buildScenes,
  registerLayout,
  resetUserLayouts,
  loadUserLayouts,
  layoutDef,
  layoutParams,
  layoutParamSchema,
} from '../src/deck/layout.mjs';
import { SEMANTIC } from '../src/deck/tokens.mjs';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const strip = (v) => JSON.parse(JSON.stringify(v));

function tmpDeckDir(layoutFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-params-'));
  fs.mkdirSync(path.join(dir, 'layouts'));
  for (const [name, def] of Object.entries(layoutFiles)) {
    fs.writeFileSync(
      path.join(dir, 'layouts', name),
      typeof def === 'string' ? def : JSON.stringify(def),
    );
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const scenesFor = (layout, body) =>
  strip(buildScenes(parseDeck(`# Slide\n\n<!-- layout: ${layout} -->\n\n${body}`)));

const TWO_SECTIONS = '## Before\n\n- slow\n\n## After\n\n- fast\n';

// ---------------------------------------------------------------------------
// Machinery: defaults, value validation, unknown keys
// ---------------------------------------------------------------------------

test('layoutParams: generator defaults, overridden by the alias definition', (t) => {
  t.after(resetUserLayouts);
  // the optional-region parameters (leadPanel/leadRatio/leadAlign) ride on
  // every generator that deals sections side by side: the band is defined once
  // and composes, rather than being duplicated as one layout per combination
  const LEAD = { leadPanel: 'none', leadRatio: 0.2, leadAlign: 'left' };
  assert.deepEqual(layoutParams('comparison'), {
    panels: ['muted', 'highlight'],
    pad: 16,
    density: 'comfortable',
    radius: null,
    ...LEAD,
  });
  registerLayout({ name: 'p-duel', base: 'comparison', pad: 32 });
  assert.deepEqual(layoutParams('p-duel'), {
    panels: ['muted', 'highlight'],
    pad: 32,
    density: 'comfortable',
    radius: null,
    ...LEAD,
  });
  assert.deepEqual(layoutParams('unknown'), {});
  assert.equal(layoutParamSchema('unknown'), null);
  assert.deepEqual(layoutParamSchema('cover'), {}, 'layout with no parameters → empty schema');
});

test('registerLayout refuses out-of-domain values, with precise messages', (t) => {
  t.after(resetUserLayouts);
  assert.throws(
    () => registerLayout({ name: 'p-a', base: 'comparison', sidepanels: ['muted'] }),
    /unknown parameter "sidepanels" for base "comparison" \(parameters: panels, pad, density, radius, leadPanel, leadRatio, leadAlign\)/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-a2', base: 'comparison', panel: ['muted'] }),
    /unknown parameter "panel".*did you mean "panels"/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-b', base: 'comparison', panels: ['green'] }),
    /"green" invalid.*values: muted, highlight, pillar, info, success, warning, danger/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-c', base: 'comparison', panels: 'muted' }),
    /non-empty list expected/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-d', base: 'comparison', pad: 99 }),
    /outside the domain 0–48/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-e', base: 'comparison', pad: 1.5 }),
    /integer expected/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-f', base: 'pillars', accent: 'yes' }),
    /true or false expected/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-g', base: 'timeline', orientation: 'verticl' }),
    /did you mean "vertical"/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-h', base: 'layers', ratios: [0.3] }),
    /exactly 2 values expected/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-i', base: 'layers', ratios: [0.5, 0.6] }),
    /the sum exceeds 1/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-j', base: 'layers', shades: [5] }),
    /outside the domain 0–4/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-k', base: 'swot', kinds: ['success', 'red'] }),
    /"red" invalid/,
  );
});

test('loadUserLayouts: misspelled parameter → LAYOUT_DEF_ADJUSTED (suggestion), invalid value → LAYOUT_DEF_INVALID', (t) => {
  const { dir, cleanup } = tmpDeckDir({
    'typo-key.json': { name: 'typo-key', base: 'comparison', panel: ['muted', 'muted'] },
    'value.json': { name: 'value', base: 'metrics', max: 40 },
  });
  t.after(() => {
    cleanup();
    resetUserLayouts();
  });
  resetUserLayouts();
  const diags = loadUserLayouts(dir);
  const adjusted = diags.find((d) => d.code === 'LAYOUT_DEF_ADJUSTED' && /"panel"/.test(d.message));
  assert.equal(
    adjusted?.suggestion,
    'panels',
    'the key close to a parameter of the base is suggested',
  );
  assert.ok(layoutDef('typo-key'), 'the alias survives, the unknown key is dropped');
  const invalid = diags.find((d) => d.code === 'LAYOUT_DEF_INVALID');
  assert.match(invalid?.message ?? '', /"max".*outside the domain 1–6/);
  assert.equal(layoutDef('value'), null, 'value out of domain: the whole definition is ignored');
});

test('capabilities().layoutParams publishes the schemas of the parameterized generators', () => {
  resetUserLayouts();
  const caps = capabilities();
  // `apex` and `hierarchy` publish a schema holding nothing but the three band
  // parameters: they deal `##` sections into slots, so they wear the lead and
  // takeaway bands (BAND_BASES), and a band a kit cannot style is the
  // half-wiring `matrix` shipped with — the band drawn, `leadPanel` refused.
  assert.deepEqual(Object.keys(caps.layoutParams).sort(), [
    'annotated',
    'apex',
    'checklist',
    'columns',
    'comparison',
    'content',
    'cycle',
    'focus',
    'grid',
    'hero',
    'hierarchy',
    'layers',
    'matrix',
    'metrics',
    'pictogram',
    'pillars',
    'section',
    'split',
    'steps',
    'swot',
    'table',
    'three-columns',
    'timeline',
    'two-columns',
    'venn',
  ]);
  assert.equal(caps.layoutParams.comparison.pad.default, 16);
  assert.deepEqual(caps.layoutParams.swot.kinds.values, ['info', 'success', 'warning', 'danger']);
  assert.equal(caps.layoutParams.timeline.orientation.type, 'enum');
});

test('density: rejected with a suggestion on a typo, published on every panel-bearing generator', (t) => {
  t.after(resetUserLayouts);
  resetUserLayouts();
  // the text scale is author-facing intent, so a near-miss has to be repaired
  // by the "did you mean" the enum machinery already provides — no new
  // validation code was written for it, and this is what proves it
  assert.throws(
    () => registerLayout({ name: 'p-densse', base: 'grid', density: 'densse' }),
    /"densse" invalid — did you mean "dense"\? \(values: comfortable, compact, dense\)/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-num', base: 'grid', density: 9 }),
    /"9" invalid \(values: comfortable, compact, dense\)/,
    'a point size is not an intent word: the enum refuses it without a suggestion',
  );
  const caps = capabilities();
  // the seven generators that flow text into a BOUNDED region — the places a
  // 14 pt body runs out of room
  for (const base of ['grid', 'comparison', 'pillars', 'steps', 'swot', 'layers', 'content']) {
    const spec = caps.layoutParams[base]?.density;
    assert.ok(spec, `"${base}" does not publish a density parameter`);
    assert.equal(spec.type, 'enum', `${base}.density: enum expected`);
    assert.deepEqual(spec.values, ['comfortable', 'compact', 'dense'], `${base}.density values`);
    assert.equal(
      spec.default,
      'comfortable',
      `${base}.density must default to the historical size`,
    );
  }
});

test('align: refused outside its enum, and stamped on the blocks the generator places', (t) => {
  t.after(resetUserLayouts);
  resetUserLayouts();
  // `align` has exactly two producers — the table delimiter row and a layout
  // definition. On the layout side it is the enum machinery that guards it,
  // which is why nothing new was written to validate it
  assert.throws(
    () => registerLayout({ name: 'p-centre', base: 'content', align: 'centre' }),
    /"centre" invalid — did you mean "center"\? \(values: left, center, right\)/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-just', base: 'grid', align: 'justify' }),
    /"justify" invalid \(values: left, center, right\)/,
    'justified text is out of scope: it reads badly at projection sizes',
  );
  assert.throws(
    () => registerLayout({ name: 'p-mid', base: 'metrics', align: 'middle' }),
    /"middle" invalid/,
    'vertical wording must not slip in: valign is deliberately not a block property',
  );
  assert.throws(
    () => registerLayout({ name: 'p-nope', base: 'swot', align: 'center' }),
    /unknown parameter "align" for base "swot"/,
    'align is offered only where it means something',
  );

  const caps = capabilities();
  for (const base of ['content', 'grid', 'metrics']) {
    const spec = caps.layoutParams[base]?.align;
    assert.ok(spec, `"${base}" does not publish an align parameter`);
    assert.deepEqual(spec.values, ['left', 'center', 'right'], `${base}.align values`);
    assert.equal(spec.default, 'left', `${base}.align must default to the natural rendering`);
  }
  // focus is the exception, and stays one: its key message is centered
  assert.equal(caps.layoutParams.focus.align.default, 'center');
  assert.deepEqual(caps.layoutParams.focus.align.values, ['left', 'center', 'right']);

  registerLayout({ name: 'p-centered', base: 'content', align: 'center' });
  const [scene] = scenesFor('p-centered', '## Result\n\ntext\n\n- one\n');
  for (const type of ['heading', 'para', 'bullets']) {
    const el = scene.elements.find((e) => e.block.type === type);
    assert.equal(el?.block.align, 'center', `${type} must carry the layout's alignment`);
  }
  // and the default asks for nothing, so it must WRITE nothing: an
  // `align: "left"` on every block of every deck would move every golden
  registerLayout({ name: 'p-plain', base: 'content' });
  const [plain] = scenesFor('p-plain', '## Result\n\ntext\n');
  for (const el of plain.elements) assert.equal('align' in el.block, false);
});

test('solid tones and radius: enum names, so validation and capabilities follow without new code', (t) => {
  t.after(resetUserLayouts);
  resetUserLayouts();
  // the solid tone is a VARIANT NAME rather than a `tone` parameter precisely
  // so that the enum-list machinery — domain, "did you mean", publication —
  // covers it; a near-miss must therefore be repaired, not just refused
  assert.throws(
    () => registerLayout({ name: 'p-succes', base: 'grid', panels: ['succes-solid'] }),
    /"succes-solid" invalid — did you mean "success-solid"\?/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-solid', base: 'grid', panels: ['muted-solid'] }),
    /"muted-solid" invalid/,
    'only the semantic tints have a saturated tone',
  );
  assert.throws(
    () => registerLayout({ name: 'p-rad', base: 'steps', radius: 'pil' }),
    /"pil" invalid — did you mean "pill"\? \(values: sm, md, lg, pill\)/,
  );
  const caps = capabilities();
  for (const base of ['grid', 'comparison', 'pillars', 'steps']) {
    assert.deepEqual(
      caps.layoutParams[base].panels.values,
      [
        'muted',
        'highlight',
        'pillar',
        'info',
        'success',
        'warning',
        'danger',
        'info-solid',
        'success-solid',
        'warning-solid',
        'danger-solid',
      ],
      `${base}.panels does not publish the solid tones`,
    );
    assert.equal(caps.layoutParams[base].radius.default, null, `${base}.radius: per variant`);
  }
});

// ---------------------------------------------------------------------------
// Phase A, generator by generator: the parameter changes the placement
// ---------------------------------------------------------------------------

test('comparison: semantic `panels` (cycling) and `pad` — tinted panels, matching title ink, widened margins', (t) => {
  t.after(resetUserLayouts);
  registerLayout({
    name: 'p-pros-cons',
    base: 'comparison',
    panels: ['success', 'danger'],
    pad: 24,
  });
  const [scene] = scenesFor('p-pros-cons', TWO_SECTIONS);
  const panels = scene.elements.filter((e) => e.block.type === 'panel');
  assert.deepEqual(
    panels.map((p) => [p.block.variant, p.block.kind]),
    [
      ['semantic', 'success'],
      ['semantic', 'danger'],
    ],
  );
  const headings = scene.elements.filter((e) => e.block.type === 'heading');
  assert.equal(
    headings[0].block.color,
    SEMANTIC.success.text,
    'the title ink follows the panel tint',
  );
  assert.equal(headings[0].region.x, panels[0].region.x + 24, 'pad applied');
  const [base] = scenesFor('comparison', TWO_SECTIONS);
  const baseHead = base.elements.find((e) => e.block.type === 'heading');
  assert.equal(baseHead.region.x, base.elements[0].region.x + 16, 'historical default: 16 px');
});

test('pillars: `accent: false` removes the band and the height it reserves', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-plain', base: 'pillars', accent: false });
  const [scene] = scenesFor('p-plain', TWO_SECTIONS);
  const panel = scene.elements.find((e) => e.block.type === 'panel');
  assert.equal(panel.block.accent, false);
  const heading = scene.elements.find((e) => e.block.type === 'heading');
  assert.equal(
    heading.region.y,
    panel.region.y + 16,
    'without the accent, the content moves up (padTop = pad)',
  );
  const [base] = scenesFor('pillars', TWO_SECTIONS);
  assert.equal(
    base.elements.find((e) => e.block.type === 'panel').block.accent,
    undefined,
    'default: no attribute (goldens intact)',
  );
  assert.equal(
    base.elements.find((e) => e.block.type === 'heading').region.y,
    base.elements[0].region.y + 24,
  );
});

test('timeline: `dot`, `arrow: false`, `numbered: false` show up in the scene (defaults emit no attributes)', (t) => {
  t.after(resetUserLayouts);
  registerLayout({
    name: 'p-milestones',
    base: 'timeline',
    dot: 36,
    arrow: false,
    numbered: false,
  });
  const [scene] = scenesFor('p-milestones', TWO_SECTIONS);
  const axis = scene.elements.find((e) => e.block.type === 'timeline-axis');
  assert.equal(axis.block.arrow, false);
  const dots = scene.elements.filter((e) => e.block.type === 'timeline-dot');
  assert.equal(dots[0].block.numbered, false);
  assert.equal(dots[0].region.w, 36);
  const [base] = scenesFor('timeline', TWO_SECTIONS);
  assert.deepEqual(base.elements.find((e) => e.block.type === 'timeline-axis').block, {
    type: 'timeline-axis',
  });
  assert.deepEqual(base.elements.find((e) => e.block.type === 'timeline-dot').block, {
    type: 'timeline-dot',
    index: 1,
  });
});

test('timeline vertical: axis in a column on the left, dots aligned, one row per milestone', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-roadmap', base: 'timeline', orientation: 'vertical' });
  const [scene] = scenesFor(
    'p-roadmap',
    '## Q1 2026\n\n- a\n\n## Q2 2026\n\n- b\n\n## Q3 2026\n\n- c\n',
  );
  const axis = scene.elements.find((e) => e.block.type === 'timeline-axis');
  assert.equal(axis.block.vertical, true);
  assert.equal(axis.region.w, 2, 'vertical axis: a 2 px rule');
  const dots = scene.elements.filter((e) => e.block.type === 'timeline-dot');
  assert.equal(dots.length, 3);
  assert.ok(
    dots.every((d) => d.region.x === dots[0].region.x),
    'dots aligned on the axis',
  );
  assert.ok(dots[0].region.y < dots[1].region.y && dots[1].region.y < dots[2].region.y);
  const bullets = scene.elements.filter((e) => e.block.type === 'bullets');
  assert.ok(
    bullets.every((b) => b.region.x > axis.region.x),
    'the content lives to the right of the axis',
  );
});

test('layers: `shades` cycling and `ratios` move shades and columns', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-layers', base: 'layers', shades: [4, 0], ratios: [0.2, 0.7] });
  const body = '## Base\n\nfoundation\n\n## Services\n\nmiddle\n\n## Interface\n\nsurface\n';
  const [scene] = scenesFor('p-layers', body);
  const bands = scene.elements.filter((e) => e.block.type === 'panel');
  assert.deepEqual(
    bands.map((b) => b.block.shade),
    [4, 0, 4],
    'cycle of the imposed shades',
  );
  const heads = scene.elements.filter((e) => e.block.type === 'heading');
  assert.equal(heads[0].region.w, bands[0].region.w * 0.2 - 24, 'title ratio applied');
  const [base] = scenesFor('layers', body);
  assert.deepEqual(
    base.elements.filter((e) => e.block.type === 'panel').map((b) => b.block.shade),
    [0, 2, 4],
    'default: shades spread over the ramp',
  );
});

test('layers: `shape` funnel narrows the bands (centered), pyramid widens them, stack stays full width', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-funnel', base: 'layers', shape: 'funnel' });
  registerLayout({ name: 'p-pyramid', base: 'layers', shape: 'pyramid' });
  const body = '## One\n\n## Two\n\n## Three\n';
  const widths = (name) =>
    scenesFor(name, body)[0]
      .elements.filter((e) => e.block.type === 'panel')
      .map((b) => b.region);
  const funnelWidths = widths('p-funnel');
  assert.ok(
    funnelWidths[0].w > funnelWidths[1].w && funnelWidths[1].w > funnelWidths[2].w,
    'funnel: it narrows',
  );
  assert.ok(
    Math.abs(
      funnelWidths[2].x + funnelWidths[2].w / 2 - (funnelWidths[0].x + funnelWidths[0].w / 2),
    ) < 0.001,
    'bands centered',
  );
  const pyramidWidths = widths('p-pyramid');
  assert.ok(
    pyramidWidths[0].w < pyramidWidths[1].w && pyramidWidths[1].w < pyramidWidths[2].w,
    'pyramid: it widens',
  );
  const stackWidths = widths('layers');
  assert.ok(
    stackWidths.every((r) => r.w === stackWidths[0].w),
    'stack: constant full width',
  );
});

test('swot: `kinds` reorders the quadrant tints (and the title ink)', (t) => {
  t.after(resetUserLayouts);
  registerLayout({
    name: 'p-matrix',
    base: 'swot',
    kinds: ['info', 'warning', 'success', 'danger'],
  });
  const body = '## A\n\n- 1\n\n## B\n\n- 2\n\n## C\n\n- 3\n\n## D\n\n- 4\n';
  const [scene] = scenesFor('p-matrix', body);
  const kinds = scene.elements.filter((e) => e.block.type === 'panel').map((p) => p.block.kind);
  assert.deepEqual(kinds, ['info', 'warning', 'success', 'danger']);
  const heads = scene.elements.filter((e) => e.block.type === 'heading');
  assert.equal(heads[2].block.color, SEMANTIC.success.text);
});

test('split: `ratio` and `side: left` move the text and the visual', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-visual', base: 'split', ratio: 0.5, side: 'left' });
  const body = '- point\n\n```mermaid\ngraph TD; A-->B\n```\n';
  const [scene] = scenesFor('p-visual', body);
  const text = scene.elements.find((e) => e.block.type === 'bullets');
  const visual = scene.elements.find((e) => e.block.type === 'mermaid');
  assert.ok(visual.region.x < text.region.x, 'side: left → the visual moves to the left');
  const [base] = scenesFor('split', body);
  const baseText = base.elements.find((e) => e.block.type === 'bullets');
  assert.ok(text.region.w > baseText.region.w, 'ratio 0.5 widens the text column (default 0.42)');
});

test('metrics: `max` and `cardHeight` govern the cards displayed and their height; METRICS_DROPPED follows the alias cap', (t) => {
  const { dir, cleanup } = tmpDeckDir({
    'p-kpi.json': { name: 'p-kpi', base: 'metrics', max: 2, cardHeight: 200 },
  });
  t.after(() => {
    cleanup();
    resetUserLayouts();
  });
  resetUserLayouts();
  loadUserLayouts(dir);
  const metric = (n) => `:::metric\n${n}\nLabel\n:::\n`;
  const [scene] = scenesFor('p-kpi', [1, 2, 3].map(metric).join('\n'));
  const cards = scene.elements.filter((e) => e.block.type === 'metric');
  assert.equal(cards.length, 2, 'cap of 2 applied');
  assert.equal(cards[0].region.h, 200, 'cardHeight applied');
  const src = `# KPI\n\n<!-- layout: p-kpi -->\n\n${[1, 2, 3].map(metric).join('\n')}`;
  const diag = validateDeck(src, { baseDir: dir }).find((d) => d.code === 'METRICS_DROPPED');
  assert.match(
    diag?.message ?? '',
    /the "p-kpi" layout only displays 2/,
    'the diagnostic cites the effective cap of the alias',
  );
});

test('an alias of an official layout is flattened: built-in base, parameters inherited then overridden', (t) => {
  t.after(resetUserLayouts);
  const def = registerLayout({ name: 'p-decision', base: 'pros-cons', pad: 24 });
  assert.equal(def.base, 'comparison', 'base flattened to the built-in generator');
  assert.deepEqual(
    def.params,
    { panels: ['success', 'danger'], pad: 24 },
    'the official layout settings inherited, pad on top',
  );
  assert.deepEqual(
    def.sections,
    { min: 2, max: 2 },
    'bounds inherited from comparison via the official layout',
  );
});

// ---------------------------------------------------------------------------
// `image` — a kit image placed by the LAYOUT (split and hero bases)
// ---------------------------------------------------------------------------

test('image: only a "kit:<alias>" reference registers — a path or a URL is refused with the reason', (t) => {
  t.after(resetUserLayouts);
  assert.throws(
    () => registerLayout({ name: 'p-img-path', base: 'split', image: './photo.png' }),
    /kit image reference expected.*kit owns its images/s,
    'a file path never enters a layout definition',
  );
  assert.throws(
    () => registerLayout({ name: 'p-img-url', base: 'hero', image: 'https://x/y.png' }),
    /kit image reference expected/,
    'a URL neither',
  );
  assert.throws(
    () => registerLayout({ name: 'p-img-base', base: 'comparison', image: 'kit:hero-photo' }),
    /unknown parameter "image"/,
    'only the split and hero bases carry the parameter',
  );
  const def = registerLayout({ name: 'p-img-ok', base: 'split', image: 'kit:hero-photo' });
  assert.equal(def.params.image, 'kit:hero-photo');
});

test('split image: the layout supplies the visual when the slide brings none — deck content wins otherwise', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-brand', base: 'split', image: 'kit:hero-photo', side: 'left' });
  const [scene] = scenesFor('p-brand', 'Some text beside the kit visual.\n');
  const img = scene.elements.find((e) => e.block.type === 'image');
  assert.ok(img, 'the layout-declared image is placed as the visual');
  assert.equal(img.block.src, 'kit:hero-photo');
  const text = scene.elements.find((e) => e.block.type === 'para');
  assert.ok(
    img.region.x < text.region.x,
    'side: left puts the layout image left of the text column',
  );

  // a slide that brings its own visual keeps it, and the layout image stays away
  const [withChart] = scenesFor('p-brand', 'Text.\n\n```chart\ntype: bar\nA: 1, 2\n```\n');
  assert.ok(
    !withChart.elements.some((e) => e.block.type === 'image'),
    'no synthesized image beside a deck visual',
  );
  assert.ok(withChart.elements.some((e) => e.block.type === 'chart'));
});

test('hero image: the layout supplies the background — the slide’s own image wins over it', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-hero-brand', base: 'hero', image: 'kit:hero-photo' });
  const [scene] = scenesFor('p-hero-brand', 'A line under the title.\n');
  assert.equal(scene.master, 'hero');
  assert.equal(scene.image.src, 'kit:hero-photo');
  assert.equal(scene.image.role, 'background');
  assert.ok(
    scene.elements.some((e) => e.block.type === 'para'),
    'the slide content still flows over the background',
  );

  const [own] = scenesFor('p-hero-brand', '![cover](own.png)\n');
  assert.equal(own.image.src, 'own.png', "the deck's own image wins over the layout's");
});

test('section image: the divider carries the kit background — always, a section places no content', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'p-divider', base: 'section', image: 'kit:hero-photo' });
  const [scene] = scenesFor('p-divider', '');
  assert.equal(scene.master, 'section');
  assert.equal(scene.image.src, 'kit:hero-photo');
  assert.equal(scene.image.role, 'background');
  assert.deepEqual(scene.elements, [], 'a section slide still places no content');
});

test('grid images: a band at the head of each cell, cycling by cell position — a cell with its own visual skips it', (t) => {
  t.after(resetUserLayouts);
  registerLayout({
    name: 'p-team',
    base: 'grid',
    cols: 3,
    images: ['kit:face-a', 'kit:face-b'],
  });
  const body = [
    '## Marie\n\nDelivery.\n',
    '## Karim\n\n![](own.png)\n',
    '## Ana\n\nPlatform.\n',
  ].join('\n');
  const [scene] = scenesFor('p-team', body);
  const imgs = scene.elements.filter((e) => e.block.type === 'image');
  assert.deepEqual(
    imgs.map((e) => e.block.src).sort(),
    ['kit:face-a', 'kit:face-a', 'own.png'],
    'cell 1 gets face-a (k=0), cell 2 keeps its own image, cell 3 cycles back to face-a (k=2)',
  );
  assert.equal(
    imgs.filter((e) => e.block.src === 'kit:face-a').length,
    2,
    'the list cycles by CELL position: k % length, skipped cells consume their slot',
  );
  const band = imgs.find((e) => e.block.src === 'kit:face-a');
  const heading = scene.elements.find((e) => e.block.type === 'heading' && e.group === band.group);
  assert.ok(band.region.y < heading.region.y, 'the image leads the cell, the heading flows below');
  assert.throws(
    () => registerLayout({ name: 'p-team-bad', base: 'grid', images: ['./face.png'] }),
    /is not a kit image reference/,
  );
  assert.throws(
    () => registerLayout({ name: 'p-team-empty', base: 'grid', images: [] }),
    /non-empty list of kit image references/,
  );
});
