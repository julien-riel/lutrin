/** Shared harness tools: fixtures and golden comparison. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Example fixture (the demonstration deck lives in examples/). */
export const DEMO_PATH = path.resolve(here, '..', '..', '..', 'examples', 'demo.deck.md');
export const readDemo = () => fs.readFileSync(DEMO_PATH, 'utf8');

/**
 * Renderer coverage fixture: one instance of each of the sixteen block types,
 * each carrying a `ZQ…` marker found nowhere else.
 *
 * It exists because the demonstration deck could not play that role: it pulls
 * in two REMOTE images (examples/demo.deck.md), and `examples/assets/remote/`
 * is gitignored — rendering it in a test would depend on the network. This one
 * is hermetic: its only external resource is test/fixtures/pixel.png, which is
 * versioned.
 */
export const ALL_BLOCKS_DIR = path.join(here, 'fixtures');
export const ALL_BLOCKS_PATH = path.join(ALL_BLOCKS_DIR, 'all-blocks.deck.md');
export const readAllBlocks = () => fs.readFileSync(ALL_BLOCKS_PATH, 'utf8');

/** "Pure data" deep copy: strips undefined and identity. */
export const strip = (v) => JSON.parse(JSON.stringify(v));

/**
 * Compares `value` against the golden file `name` (test/golden/…).
 * `UPDATE_GOLDEN=1 npm test` regenerates the goldens instead of comparing.
 */
export function assertGolden(name, value) {
  const file = path.join(here, 'golden', name);
  const actual = strip(value);
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  assert.ok(
    fs.existsSync(file),
    `golden missing: ${name} — run UPDATE_GOLDEN=1 npm test to generate it`,
  );
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(file, 'utf8')));
}
