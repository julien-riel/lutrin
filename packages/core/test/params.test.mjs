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
  assert.deepEqual(layoutParams('comparison'), { panels: ['muted', 'highlight'], pad: 16 });
  registerLayout({ name: 'p-duel', base: 'comparison', pad: 32 });
  assert.deepEqual(layoutParams('p-duel'), { panels: ['muted', 'highlight'], pad: 32 });
  assert.deepEqual(layoutParams('unknown'), {});
  assert.equal(layoutParamSchema('unknown'), null);
  assert.deepEqual(layoutParamSchema('cover'), {}, 'layout with no parameters → empty schema');
});

test('registerLayout refuses out-of-domain values, with precise messages', (t) => {
  t.after(resetUserLayouts);
  assert.throws(
    () => registerLayout({ name: 'p-a', base: 'comparison', sidepanels: ['muted'] }),
    /unknown parameter "sidepanels" for base "comparison" \(parameters: panels, pad\)/,
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
  assert.deepEqual(Object.keys(caps.layoutParams).sort(), [
    'comparison',
    'focus',
    'grid',
    'layers',
    'metrics',
    'pillars',
    'split',
    'steps',
    'swot',
    'timeline',
  ]);
  assert.equal(caps.layoutParams.comparison.pad.default, 16);
  assert.deepEqual(caps.layoutParams.swot.kinds.values, ['info', 'success', 'warning', 'danger']);
  assert.equal(caps.layoutParams.timeline.orientation.type, 'enum');
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
