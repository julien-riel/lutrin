/**
 * New bases (grid, steps, focus — review §3.3, step 3, phase B) and the
 * official catalog design/layouts/*.json (phase C): pure data, loaded at
 * startup, never reset by a deck, published by capabilities(), suggested by
 * the art direction. Each official layout serves as a living fixture of its
 * base.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDeck } from '../src/deck/parse.mjs';
import {
  buildScenes,
  registerLayout,
  resetUserLayouts,
  officialLayouts,
  OFFICIAL_LAYOUT_DIAGS,
  LAYOUTS,
} from '../src/deck/layout.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';
import { compileHtml } from '../src/html/render.mjs';
import { BLOCK_RENDERERS as PPTX_RENDERERS } from '../src/pptx/render.mjs';
import { COLORS } from '../src/deck/tokens.mjs';

const strip = (v) => JSON.parse(JSON.stringify(v));
const scenesFor = (layout, body) =>
  strip(buildScenes(parseDeck(`# Slide\n\n<!-- layout: ${layout} -->\n\n${body}`)));

const OFFICIALS = [
  'before-after',
  'risk-map',
  'funnel',
  'roadmap',
  'priority-matrix',
  'key-message',
  'journey',
  'portfolio',
  'pros-cons',
  'pyramid',
];

const FOUR_SECTIONS = '## One\n\n- a\n\n## Two\n\n- b\n\n## Three\n\n- c\n\n## Four\n\n- d\n';

// ---------------------------------------------------------------------------
// Catalog (phase C)
// ---------------------------------------------------------------------------

test('the official catalog loads with no diagnostic and survives the per-deck reset', () => {
  assert.deepEqual(OFFICIAL_LAYOUT_DIAGS, [], 'no catalog file may be rejected');
  resetUserLayouts();
  assert.deepEqual(
    officialLayouts()
      .map((d) => d.name)
      .sort(),
    [...OFFICIALS].sort(),
  );
  for (const name of OFFICIALS)
    assert.ok(LAYOUTS.includes(name), `${name} stays in LAYOUTS after the reset`);
  const caps = capabilities();
  assert.deepEqual(caps.officialLayouts.map((d) => d.name).sort(), [...OFFICIALS].sort());
  const pc = caps.officialLayouts.find((d) => d.name === 'pros-cons');
  assert.equal(pc.base, 'comparison');
  assert.deepEqual(pc.params, { panels: ['success', 'danger'] });
  assert.ok(pc.description, 'every official layout is documented');
});

test('every official layout compiles a demo deck (named scene, never a crash)', () => {
  resetUserLayouts();
  const TWO = '## Before\n\n- slow\n\n## After\n\n- fast\n';
  const BODIES = {
    'before-after': TWO,
    'pros-cons': TWO,
    roadmap: '## Q1 2026\n\n- a\n\n## Q2 2026\n\n- b\n',
    journey: '## Request\n\n- a\n\n## Review\n\n- b\n\n## Answer\n\n- c\n',
    'priority-matrix': FOUR_SECTIONS,
    'risk-map': FOUR_SECTIONS,
    funnel: '## Received\n\n## Eligible\n\n## Selected\n',
    pyramid: '## Vision\n\n## Programs\n\n## Operations\n',
    'key-message': '87% satisfaction\n\n2026 survey of 2,400 respondents.\n',
    portfolio: FOUR_SECTIONS,
  };
  for (const name of OFFICIALS) {
    const scenes = scenesFor(name, BODIES[name]);
    assert.equal(scenes[0].layout, name, `${name}: the scene carries the official name`);
    assert.ok(scenes[0].elements.length, `${name}: elements are placed`);
  }
});

test('a user layout cannot steal the name of an official one: collision reported, official definition intact', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-theft-'));
  fs.mkdirSync(path.join(dir, 'layouts'));
  // theft attempt: same name, different base
  fs.writeFileSync(
    path.join(dir, 'layouts', 'pros-cons.json'),
    JSON.stringify({ name: 'pros-cons', base: 'pillars' }),
  );
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetUserLayouts();
  });
  const src = '# X\n\n<!-- layout: pros-cons -->\n\n## Pros\n\n- a\n\n## Cons\n\n- b\n';
  const diags = validateDeck(src, { baseDir: dir });
  const collision = diags.find((d) => d.code === 'LAYOUT_DEF_INVALID');
  assert.match(
    collision?.message ?? '',
    /already exists \(official catalog layout\)/,
    'the collision is explained to the author',
  );
  assert.ok(!diags.some((d) => d.code === 'UNKNOWN_LAYOUT'));
  prepareDeckContext({}, { baseDir: dir });
  const [scene] = scenesFor('pros-cons', '## Pros\n\n- a\n\n## Cons\n\n- b\n');
  assert.deepEqual(
    scene.elements.filter((e) => e.block.type === 'panel').map((p) => p.block.kind),
    ['success', 'danger'],
    'the rendering stays the official one, not the impostor file one',
  );
});

test('a layouts/*.json cannot declare itself builtin/official: never a ghost layout surviving the reset', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-ghost-'));
  fs.mkdirSync(path.join(dir, 'layouts'));
  fs.writeFileSync(
    path.join(dir, 'layouts', 'ghost.json'),
    JSON.stringify({ name: 'ghost', builtin: true, official: true }),
  );
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetUserLayouts();
  });
  prepareDeckContext({}, { baseDir: dir });
  resetUserLayouts();
  assert.ok(
    !LAYOUTS.includes('ghost'),
    'the builtin flag of a data file is ignored (a base is required)',
  );
});

test('prepareDeckContext surfaces the official catalog diagnostics on every compilation', (t) => {
  const fake = {
    severity: 'warning',
    code: 'LAYOUT_DEF_INVALID',
    message: 'Official layout design/layouts/broken.json: test — ignored.',
  };
  OFFICIAL_LAYOUT_DIAGS.push(fake);
  t.after(() => {
    OFFICIAL_LAYOUT_DIAGS.pop();
    resetUserLayouts();
  });
  const prep = prepareDeckContext({}, { baseDir: os.tmpdir() });
  assert.ok(
    prep.diagnostics.some((d) => d === fake || d.message === fake.message),
    'a broken installation shows up on every deck',
  );
});

test('anti-drift: the settings of the official catalog are frozen', () => {
  resetUserLayouts();
  const defs = Object.fromEntries(officialLayouts().map((d) => [d.name, d]));
  assert.deepEqual(defs['before-after'], {
    name: 'before-after',
    base: 'comparison',
    official: true,
    sections: { min: 2, max: 2 },
    description: defs['before-after'].description,
  });
  assert.deepEqual(defs['pros-cons'].params, { panels: ['success', 'danger'] });
  assert.deepEqual(defs.roadmap.params, { orientation: 'vertical' });
  assert.equal(defs.journey.base, 'steps');
  assert.deepEqual(defs['priority-matrix'], {
    name: 'priority-matrix',
    base: 'grid',
    official: true,
    sections: { min: 4, max: 4 },
    params: { cols: 2 },
    description: defs['priority-matrix'].description,
  });
  assert.deepEqual(defs['risk-map'].params, {
    cols: 2,
    kinds: ['success', 'warning', 'warning', 'danger'],
  });
  assert.deepEqual(defs.funnel.params, { shape: 'funnel' });
  assert.deepEqual(defs.pyramid.params, { shape: 'pyramid' });
  assert.equal(defs['key-message'].base, 'focus');
  assert.deepEqual(defs.portfolio.params, { cols: 3, headed: true });
  assert.deepEqual(defs.portfolio.sections, { min: 2, max: 6 });
});

// ---------------------------------------------------------------------------
// grid (phase B)
// ---------------------------------------------------------------------------

test('grid: R × C mosaic — 4 sections in 2 × 2, cells evenly aligned, `kinds` tints in a cycle', () => {
  resetUserLayouts();
  const [scene] = scenesFor('risk-map', FOUR_SECTIONS);
  const panels = scene.elements.filter((e) => e.block.type === 'panel');
  assert.equal(panels.length, 4);
  assert.deepEqual(
    panels.map((p) => p.block.kind),
    ['success', 'warning', 'warning', 'danger'],
  );
  assert.equal(panels[0].region.x, panels[2].region.x, 'column 1 aligned');
  assert.equal(panels[1].region.x, panels[3].region.x, 'column 2 aligned');
  assert.equal(panels[0].region.y, panels[1].region.y, 'row 1 aligned');
  assert.ok(panels[2].region.y > panels[0].region.y, 'row 2 underneath');
  assert.equal(panels[0].region.w, panels[1].region.w);
});

test('grid `headed` (portfolio): title at the head of the cell, rule without an arrow, content underneath', () => {
  resetUserLayouts();
  const [scene] = scenesFor(
    'portfolio',
    '## Project A\n\n- a\n\n## Project B\n\n- b\n\n## Project C\n\n- c\n',
  );
  const rules = scene.elements.filter((e) => e.block.type === 'timeline-axis');
  assert.equal(rules.length, 3, 'one rule per cell');
  assert.ok(
    rules.every((r) => r.block.arrow === false),
    'the header rule has no arrowhead',
  );
  const cell = scene.elements.find((e) => e.block.type === 'panel');
  const heading = scene.elements.find((e) => e.block.type === 'heading');
  const rule = rules[0];
  const bullets = scene.elements.find((e) => e.block.type === 'bullets');
  assert.ok(
    heading.region.y < rule.region.y && rule.region.y < bullets.region.y,
    'title / rule / content, in that order',
  );
  assert.ok(heading.region.y >= cell.region.y);
  const cells = scene.elements.filter((e) => e.block.type === 'panel');
  assert.equal(cells.length, 3);
  assert.ok(
    cells.every((c) => c.region.y === cells[0].region.y),
    'cols: 3 → the three cells on one and the same row',
  );
});

// ---------------------------------------------------------------------------
// steps (phase B)
// ---------------------------------------------------------------------------

test('steps (journey): n panels, n − 1 arrowed connectors between them, animated with the step they introduce', () => {
  resetUserLayouts();
  const [scene] = scenesFor(
    'journey',
    '## Request\n\n- a\n\n## Review\n\n- b\n\n## Answer\n\n- c\n',
  );
  const panels = scene.elements.filter((e) => e.block.type === 'panel');
  const conns = scene.elements.filter((e) => e.block.type === 'timeline-axis');
  assert.equal(panels.length, 3);
  assert.equal(conns.length, 2);
  assert.ok(
    conns.every((c) => c.block.arrow === undefined),
    'default connector: an arrow (no arrow: false attribute)',
  );
  assert.ok(
    conns[0].region.x > panels[0].region.x + panels[0].region.w - 1 &&
      conns[0].region.x + conns[0].region.w < panels[1].region.x + 1,
    'the connector lives between the two panels',
  );
  assert.equal(conns[0].group, 1, 'the connector appears with the next step');
});

test('steps: `connector: line` removes the arrowheads, `none` removes the connectors', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'o-line', base: 'steps', connector: 'line' });
  registerLayout({ name: 'o-none', base: 'steps', connector: 'none' });
  const body = '## One\n\n- a\n\n## Two\n\n- b\n';
  const line = scenesFor('o-line', body)[0].elements.filter(
    (e) => e.block.type === 'timeline-axis',
  );
  assert.equal(line.length, 1);
  assert.equal(line[0].block.arrow, false);
  const none = scenesFor('o-none', body)[0].elements.filter(
    (e) => e.block.type === 'timeline-axis',
  );
  assert.equal(none.length, 0);
});

// ---------------------------------------------------------------------------
// focus (phase B)
// ---------------------------------------------------------------------------

test('focus (key-message): accent bar + message in a large centered body + context underneath', () => {
  resetUserLayouts();
  const [scene] = scenesFor('key-message', '87%\n\nOf respondents are satisfied.\n');
  const bar = scene.elements.find((e) => e.block.type === 'panel');
  assert.equal(bar.block.variant, 'accent');
  const msg = scene.elements.find((e) => e.block.type === 'heading');
  assert.equal(msg.block.size, 40, 'scale 1 → 40 pt');
  assert.equal(msg.block.align, 'center');
  assert.ok(bar.region.y < msg.region.y, 'bar above the message');
  const context = scene.elements.filter((e) => e.block.type === 'para');
  assert.equal(context.length, 1, 'the first paragraph becomes the message, the rest is context');
  assert.ok(context[0].region.y > msg.region.y + msg.region.h - 1, 'context under the message');
});

test('focus: `scale`, `align: left` and `accent: false` govern size, alignment and bar', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'o-punch', base: 'focus', scale: 1.5, align: 'left', accent: false });
  const [scene] = scenesFor('o-punch', 'One single network.\n');
  assert.ok(!scene.elements.some((e) => e.block.type === 'panel'), 'accent: false → no bar');
  const msg = scene.elements.find((e) => e.block.type === 'heading');
  assert.equal(msg.block.size, 60, '40 × 1.5');
  assert.equal(msg.block.align, undefined, 'align left = natural rendering, no attribute');
});

test('focus with no paragraph: plain flow, never a crash', () => {
  resetUserLayouts();
  const [scene] = scenesFor('key-message', '```chart\ntype: bar\ncategories: a, b\nS: 1, 2\n```\n');
  assert.ok(scene.elements.some((e) => e.block.type === 'chart'));
});

// ---------------------------------------------------------------------------
// Art direction: the official layouts suggest themselves
// ---------------------------------------------------------------------------

test('LAYOUT_SUGGESTION learns pros-cons and risk-map', () => {
  resetUserLayouts();
  const pc = validateDeck('# Decision\n\n## Pros\n\n- a\n\n## Cons\n\n- b\n').find(
    (d) => d.code === 'LAYOUT_SUGGESTION',
  );
  assert.equal(pc?.suggestion, 'pros-cons');
  const rm = validateDeck(
    '# Risks\n\n## Low probability\n\n- a\n\n## High probability\n\n- b\n\n## Minor severity\n\n- c\n\n## Major severity\n\n- d\n',
  ).find((d) => d.code === 'LAYOUT_SUGGESTION');
  assert.equal(rm?.suggestion, 'risk-map');
});

// ---------------------------------------------------------------------------
// PPTX rendering: the phase B branches emit the right shapes
// ---------------------------------------------------------------------------

/** Minimal PptxGenJS slide facade: records addShape/addText. */
function stubSlide() {
  const calls = { shapes: [], texts: [] };
  return {
    calls,
    addShape: (type, opts) => calls.shapes.push({ type, ...opts }),
    addText: (text, opts) => calls.texts.push({ text, ...opts }),
  };
}

test('PPTX: vertical axis (arrow pointing down), axis without an arrow, solid dot, accent bar, sized message', () => {
  const axisV = stubSlide();
  PPTX_RENDERERS['timeline-axis'](
    axisV,
    { type: 'timeline-axis', vertical: true },
    { x: 47, y: 120, w: 2, h: 400 },
  );
  assert.equal(axisV.calls.shapes.length, 2, 'rule + arrowhead');
  assert.equal(axisV.calls.shapes[1].rotate, 180, 'time flows downwards');
  const axisPlain = stubSlide();
  PPTX_RENDERERS['timeline-axis'](
    axisPlain,
    { type: 'timeline-axis', arrow: false },
    { x: 48, y: 200, w: 300, h: 2 },
  );
  assert.equal(axisPlain.calls.shapes.length, 1, 'the rule alone');
  assert.equal(
    axisPlain.calls.shapes[0].w,
    300 / 96,
    'full width, no room reserved for an arrowhead',
  );
  const dot = stubSlide();
  PPTX_RENDERERS['timeline-dot'](
    dot,
    { type: 'timeline-dot', index: 2, numbered: false },
    { x: 0, y: 0, w: 28, h: 28 },
  );
  assert.equal(dot.calls.texts.length, 0, 'solid dot: no number');
  const bar = stubSlide();
  PPTX_RENDERERS.panel(bar, { type: 'panel', variant: 'accent' }, { x: 0, y: 0, w: 96, h: 6 });
  assert.equal(bar.calls.shapes[0].fill.color, COLORS.primary, 'accent bar in the primary color');
  const pillar = stubSlide();
  PPTX_RENDERERS.panel(
    pillar,
    { type: 'panel', variant: 'pillar', accent: false },
    { x: 0, y: 0, w: 200, h: 300 },
  );
  assert.equal(pillar.calls.shapes.length, 1, 'pillar without an accent: no bar');
  const msg = stubSlide();
  PPTX_RENDERERS.heading(
    msg,
    { type: 'heading', runs: [{ text: '87%' }], size: 60, align: 'center' },
    { x: 0, y: 0, w: 500, h: 120 },
  );
  assert.equal(msg.calls.texts[0].fontSize, 60);
  assert.equal(msg.calls.texts[0].align, 'center');
  assert.equal(
    msg.calls.texts[0].lineSpacing,
    60 * 1.3,
    'the line height of the CSS .slot-heading (1.3), in exact points — a multiple would follow the font metrics of the kit instead',
  );
});

// ---------------------------------------------------------------------------
// Regressions of the review fixes (second wave, step 3)
// ---------------------------------------------------------------------------

test('dense grid (cols: 1, 8 sections, headed): no region with a negative height', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'o-stack', base: 'grid', cols: 1, headed: true });
  const body = Array.from({ length: 8 }, (_, k) => `## Cell ${k + 1}\n\n- point\n`).join('\n');
  const [scene] = scenesFor('o-stack', body);
  for (const el of scene.elements) {
    assert.ok(el.region.h >= 0, `${el.block.type} region at a negative height (${el.region.h})`);
    assert.ok(el.region.w >= 0);
  }
});

test('focus: a message taller than its zone pushes the context down instead of overlapping it', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'o-long', base: 'focus', scale: 1.5 });
  // ~4 lines at 60 pt: taller than the top half, but it still fits in the
  // slide once the context has been pushed down (the case that overruns the
  // whole slide is BLOCK_OVERFLOW's business, not placement's)
  const long =
    'An inordinately long key sentence that runs over several lines at a giant body size to test the message zone.';
  const [scene] = scenesFor('o-long', `${long}\n\nThe context that follows.\n`);
  const msg = scene.elements.find((e) => e.block.type === 'heading');
  const ctx = scene.elements.find((e) => e.block.type === 'para');
  assert.ok(msg.region.h > 300, 'precondition: the message does exceed its default zone (~269 px)');
  assert.ok(ctx.region.y >= msg.region.y + msg.region.h, 'the context starts under the message');
});

test('focus: ## section headings stay content (never dropped)', () => {
  resetUserLayouts();
  const [scene] = scenesFor('key-message', '## What this changes\n\n87%\n\n- less waiting\n');
  assert.ok(
    scene.elements.some((e) => e.block.type === 'heading' && !e.block.size),
    'the ## heading shows up as a context block',
  );
});

test('layers: surplus sections are dropped at the registry bounds (the LAYOUT_SECTIONS promise holds)', () => {
  resetUserLayouts();
  const body = Array.from({ length: 7 }, (_, k) => `## Layer ${k + 1}\n`).join('\n');
  const [scene] = scenesFor('layers', body);
  assert.equal(
    scene.elements.filter((e) => e.block.type === 'panel').length,
    5,
    'bounds 2–5: 5 bands at most',
  );
});

// ---------------------------------------------------------------------------
// HTML rendering: the phase B attributes reach the document
// ---------------------------------------------------------------------------

test('HTML: vertical axis, rules without arrows, sized key message and solid dots are rendered', async () => {
  const src = [
    '# Roadmap',
    '',
    '<!-- layout: roadmap -->',
    '',
    '## Q1 2026',
    '',
    '- a',
    '',
    '## Q2 2026',
    '',
    '- b',
    '',
    '# Portfolio',
    '',
    '<!-- layout: portfolio -->',
    '',
    '## Project A',
    '',
    '- a',
    '',
    '## Project B',
    '',
    '- b',
    '',
    '# Message',
    '',
    '<!-- layout: key-message -->',
    '',
    '87%',
    '',
  ].join('\n');
  const { html } = await compileHtml(src);
  assert.match(html, /tl-axis-v/, 'vertical axis present');
  assert.match(html, /tl-no-arrow/, 'header rule without an arrow present');
  assert.match(html, /font-size:40pt/, 'key message at 40 pt');
  assert.match(html, /text-align:center/, 'key message centered');
});
