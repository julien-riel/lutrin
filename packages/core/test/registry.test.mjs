/**
 * Layout registry (review §3.3, step 2): user layouts (layouts/*.json next to
 * the deck) are validated aliases of a built-in layout — same placement as
 * their base, section bounds registered, "did you mean" and capabilities()
 * for free, and a reset on every compilation (a warm worker never serves one
 * deck the layouts of another).
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeck } from '../src/deck/parse.mjs';
import {
  buildScenes,
  registerLayout,
  resetUserLayouts,
  loadUserLayouts,
  layoutDef,
  userLayouts,
  LAYOUTS,
  LAYOUT_SECTIONS,
} from '../src/deck/layout.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { validateDeck, capabilities } from '../src/deck/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.resolve(here, '..', '..', '..', 'examples');
const strip = (v) => JSON.parse(JSON.stringify(v));

/** Temporary deck with a layouts/ directory; returns { dir, cleanup }. */
function tmpDeckDir(layoutFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-registry-'));
  fs.mkdirSync(path.join(dir, 'layouts'));
  for (const [name, def] of Object.entries(layoutFiles)) {
    fs.writeFileSync(
      path.join(dir, 'layouts', name),
      typeof def === 'string' ? def : JSON.stringify(def),
    );
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const BUILTINS = [
  'cover',
  'section',
  'hero',
  'quote',
  'metrics',
  'split',
  'two-columns',
  'three-columns',
  'comparison',
  'pillars',
  'timeline',
  'layers',
  'swot',
  'grid',
  'steps',
  'focus',
  'table',
  'code',
  'diagram',
  'chart',
  'content',
];

/** Official catalog (design/layouts/*.json), loaded after the built-ins,
 *  in alphabetical order of the files. */
const OFFICIALS = [
  'before-after',
  'funnel',
  'journey',
  'key-message',
  'portfolio',
  'priority-matrix',
  'pros-cons',
  'pyramid',
  'risk-map',
  'roadmap',
];

test('the live views LAYOUTS / LAYOUT_SECTIONS reflect built-ins + officials by default', () => {
  resetUserLayouts();
  assert.deepEqual([...LAYOUTS], [...BUILTINS, ...OFFICIALS]);
  assert.deepEqual(LAYOUT_SECTIONS.swot, { min: 4, max: 4 });
  assert.deepEqual(LAYOUT_SECTIONS.pillars, { min: 2, max: 4 });
  assert.deepEqual(LAYOUT_SECTIONS.grid, { min: 2, max: 8 });
});

test('registerLayout + resetUserLayouts: the alias appears in the live views, then disappears', (t) => {
  t.after(resetUserLayouts);
  registerLayout({ name: 'milestones', base: 'timeline', sections: { min: 2, max: 4 } });
  assert.ok(LAYOUTS.includes('milestones'));
  assert.deepEqual(LAYOUT_SECTIONS.milestones, { min: 2, max: 4 });
  assert.equal(layoutDef('milestones').base, 'timeline');
  assert.equal(userLayouts().length, 1);
  resetUserLayouts();
  assert.ok(!LAYOUTS.includes('milestones'));
  assert.equal(LAYOUT_SECTIONS.milestones, undefined);
  assert.equal(userLayouts().length, 0);
});

test('registerLayout: without explicit sections, the alias inherits the bounds of its base', (t) => {
  t.after(resetUserLayouts);
  const def = registerLayout({ name: 'strengths-weaknesses', base: 'swot' });
  assert.deepEqual(def.sections, { min: 4, max: 4 });
});

test('registerLayout refuses: invalid name, collision, unknown base (with a suggestion), user base, bounds outside the base', (t) => {
  t.after(resetUserLayouts);
  assert.throws(() => registerLayout({ name: 'Uppercase', base: 'comparison' }), /invalid/);
  assert.throws(() => registerLayout({ name: 'comparison', base: 'comparison' }), /already exists/);
  assert.throws(
    () => registerLayout({ name: 'x-alias', base: 'comparaison' }),
    /did you mean "comparison"/,
  );
  assert.throws(
    () => registerLayout({ name: 'x-alias', base: 'pillars', sections: { min: 1, max: 9 } }),
    /outside the bounds/,
  );
  registerLayout({ name: 'x-alias', base: 'pillars' });
  assert.throws(() => registerLayout({ name: 'y-alias', base: 'x-alias' }), /user layout/);
});

test('a user layout renders EXACTLY like its base (identical scenes but for the name)', (t) => {
  const { dir, cleanup } = tmpDeckDir({
    'my-duel.json': { name: 'my-duel', base: 'comparison' },
  });
  t.after(() => {
    cleanup();
    resetUserLayouts();
  });
  const body = (layout) =>
    `# Slide\n\n<!-- layout: ${layout} -->\n\n## Before\n\n- slow\n\n## After\n\n- fast\n`;
  const prep = prepareDeckContext({}, { baseDir: dir });
  assert.deepEqual(prep.diagnostics, []);
  const alias = strip(buildScenes(parseDeck(body('my-duel'))));
  const base = strip(buildScenes(parseDeck(body('comparison'))));
  assert.equal(alias[0].layout, 'my-duel', 'the scene keeps the name of the user layout');
  alias[0].layout = 'comparison';
  assert.deepEqual(alias, base, 'placement identical to comparison');
});

test('validation: the loaded alias is no longer UNKNOWN_LAYOUT, a typo suggests it, its bounds apply', (t) => {
  const { dir, cleanup } = tmpDeckDir({
    'my-duel.json': { name: 'my-duel', base: 'comparison' },
  });
  t.after(() => {
    cleanup();
    resetUserLayouts();
  });
  const src = (layout, secs) =>
    `# Slide\n\n<!-- layout: ${layout} -->\n\n${secs.map((s) => `## ${s}\n\n- point\n`).join('\n')}`;
  assert.ok(
    !validateDeck(src('my-duel', ['Before', 'After']), { baseDir: dir }).some(
      (d) => d.code === 'UNKNOWN_LAYOUT',
    ),
    'user layout known to the validation',
  );
  const typo = validateDeck(src('my-due', ['Before', 'After']), { baseDir: dir }).find(
    (d) => d.code === 'UNKNOWN_LAYOUT',
  );
  assert.equal(typo?.suggestion, 'my-duel', '"did you mean" covers user layouts');
  const tooMany = validateDeck(src('my-duel', ['A', 'B', 'C']), { baseDir: dir }).find(
    (d) => d.code === 'LAYOUT_SECTIONS',
  );
  assert.ok(tooMany, 'the section bounds of the alias apply');
});

test('the checks keyed on a layout name follow the alias: METRICS_DROPPED (metrics base) and layers as a bullet list', (t) => {
  const { dir, cleanup } = tmpDeckDir({
    'indicators.json': { name: 'indicators', base: 'metrics' },
    'my-layers.json': { name: 'my-layers', base: 'layers' },
  });
  t.after(() => {
    cleanup();
    resetUserLayouts();
  });
  const metric = (n) => `:::metric\n${n}\nLabel\n:::\n`;
  const sixMetrics = `# KPI\n\n<!-- layout: indicators -->\n\n${[1, 2, 3, 4, 5, 6].map(metric).join('\n')}`;
  assert.ok(
    validateDeck(sixMetrics, { baseDir: dir }).some((d) => d.code === 'METRICS_DROPPED'),
    'the cards dropped by an alias of metrics are reported',
  );
  const bulletLayers =
    '# Architecture\n\n<!-- layout: my-layers -->\n\n- Foundation\n- Services\n- Interface\n';
  assert.ok(
    !validateDeck(bulletLayers, { baseDir: dir }).some((d) => d.code === 'LAYOUT_SECTIONS'),
    'the "layers as a single bullet list" exception holds for its alias too',
  );
});

test('loadUserLayouts: invalid defs → diagnostics, never an exception; unknown key → LAYOUT_DEF_ADJUSTED', (t) => {
  const { dir, cleanup } = tmpDeckDir({
    'broken.json': '{ not json at all',
    'no-base.json': { name: 'no-base' },
    'unknown-base.json': { name: 'wrong-base', base: 'comparaison' },
    'collision.json': { name: 'comparison', base: 'pillars' },
    'out-of-bounds.json': { name: 'too-wide', base: 'swot', sections: { min: 1, max: 9 } },
    'unknown-key.json': { name: 'ok-alias', base: 'comparison', panel: 'x' },
  });
  t.after(() => {
    cleanup();
    resetUserLayouts();
  });
  resetUserLayouts();
  const diags = loadUserLayouts(dir);
  const invalid = diags.filter((d) => d.code === 'LAYOUT_DEF_INVALID');
  assert.equal(invalid.length, 5, 'broken, no-base, unknown-base, collision, out-of-bounds');
  assert.ok(
    invalid.some((d) => /did you mean "comparison"/.test(d.message)),
    'suggestion for the misspelled base',
  );
  assert.ok(diags.some((d) => d.code === 'LAYOUT_DEF_ADJUSTED' && /panel/.test(d.message)));
  assert.ok(
    LAYOUTS.includes('ok-alias'),
    'the def with an unknown key is loaded once the key is dropped',
  );
  assert.ok(!LAYOUTS.includes('too-wide'));
  assert.deepEqual(
    LAYOUT_SECTIONS.comparison,
    { min: 2, max: 2 },
    'the collision does not overwrite the built-in layout',
  );
});

test('prepareDeckContext isolates decks: the layouts of deck A do not leak into deck B', (t) => {
  const a = tmpDeckDir({ 'alias-a.json': { name: 'alias-a', base: 'comparison' } });
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-registry-b-'));
  t.after(() => {
    a.cleanup();
    fs.rmSync(b, { recursive: true, force: true });
    resetUserLayouts();
  });
  prepareDeckContext({}, { baseDir: a.dir });
  assert.ok(LAYOUTS.includes('alias-a'));
  assert.deepEqual(
    capabilities().userLayouts.map((d) => d.name),
    ['alias-a'],
  );
  prepareDeckContext({}, { baseDir: b });
  assert.ok(!LAYOUTS.includes('alias-a'), 'deck B does not see the layouts of deck A');
  assert.deepEqual(capabilities().layouts, [...BUILTINS, ...OFFICIALS]);
  assert.deepEqual(capabilities().userLayouts, []);
});
