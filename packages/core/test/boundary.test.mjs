/**
 * Architecture boundary: `src/deck/` is the compiler core and knows NO output
 * format; each backend (`src/pptx/`, `src/html/`) imports the core, never the
 * other way round.
 *
 * This test exists because the rule was already respected in the code but was
 * named nowhere: the generic core had drifted into `src/pptx/` and had piled up
 * there. Without a guard, the drift starts again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** npm dependencies specific to one output format: their presence in the
 *  core means a backend has leaked into it. */
const BACKEND_DEPS = ['pptxgenjs', 'jszip'];

/** Every `from '…'` of a module, in file order. */
function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/gm)].map(
    (m) => m[1],
  );
}

function modulesIn(dir) {
  return fs
    .readdirSync(path.join(SRC, dir))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => ({ name: `${dir}/${f}`, file: path.join(SRC, dir, f) }));
}

test('the deck/ core imports no library specific to an output format', () => {
  for (const { name, file } of modulesIn('deck')) {
    for (const spec of importsOf(file)) {
      assert.ok(
        !BACKEND_DEPS.includes(spec),
        `${name} imports "${spec}": a backend dependency inside the core — this code belongs in src/pptx/ or src/html/`,
      );
    }
  }
});

test('the deck/ core imports no backend (pptx/, html/) — the arrow points one way', () => {
  for (const { name, file } of modulesIn('deck')) {
    for (const spec of importsOf(file)) {
      assert.ok(
        !/^\.\.\/(pptx|html|worker)\//.test(spec),
        `${name} imports "${spec}": the core depends on a backend, the dependency must be inverted`,
      );
    }
  }
});

test('deck/ is closed over itself: its relative imports stay inside deck/', () => {
  for (const { name, file } of modulesIn('deck')) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) continue;
      assert.ok(
        spec.startsWith('./'),
        `${name} imports "${spec}" from outside deck/: the core must be standalone`,
      );
    }
  }
});

test('the backends do not mix with each other (pptx/ ⊥ html/)', () => {
  const crossed = { pptx: /^\.\.\/html\//, html: /^\.\.\/pptx\// };
  for (const dir of ['pptx', 'html']) {
    for (const { name, file } of modulesIn(dir)) {
      for (const spec of importsOf(file)) {
        assert.ok(
          !crossed[dir].test(spec),
          `${name} imports "${spec}": one backend calls another — shared code belongs in src/deck/`,
        );
      }
    }
  }
});
