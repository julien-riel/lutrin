/**
 * The `deck` skill lives once (`packages/core/skills/deck/SKILL.md`) and is
 * copied to every host that discovers it at a fixed path. This test asserts the
 * copies are BYTE-identical to the canonical file, so a hand edit to one — or an
 * editor that rewrites line endings on save — fails here instead of silently
 * feeding an agent stale instructions from whichever host it loaded.
 *
 * Same anti-drift discipline the repo already applies to
 * `tokens.mjs` ↔ `design/themes/default.json`. The fix on a red run is one
 * command: `node scripts/sync-skill.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CANONICAL, COPIES } from '../../../scripts/sync-skill.mjs';

const ROOT = path.resolve(path.dirname(CANONICAL), '..', '..', '..', '..');
const rel = (p) => path.relative(ROOT, p);

test('the canonical SKILL.md exists and is non-empty', () => {
  assert.ok(fs.existsSync(CANONICAL), `${rel(CANONICAL)} is the single source of truth — missing`);
  assert.ok(fs.statSync(CANONICAL).size > 0, `${rel(CANONICAL)} is empty`);
});

test('every host copy is byte-identical to the canonical SKILL.md', () => {
  const source = fs.readFileSync(CANONICAL);
  for (const dest of COPIES) {
    assert.ok(fs.existsSync(dest), `${rel(dest)} missing — run: node scripts/sync-skill.mjs`);
    const current = fs.readFileSync(dest);
    assert.ok(
      current.equals(source),
      `${rel(dest)} drifted from ${rel(CANONICAL)} — run: node scripts/sync-skill.mjs`,
    );
  }
});

test('the plugin copy is at the spec discovery path (skills/deck/SKILL.md)', () => {
  // agent-plugins.org §6.1 fixes this location; a client will not find the
  // skill anywhere else.
  const pluginCopy = COPIES.find((p) => p.includes(`${path.sep}plugin${path.sep}`));
  assert.ok(pluginCopy, 'no plugin/ copy is registered in scripts/sync-skill.mjs COPIES');
  assert.ok(
    pluginCopy.endsWith(path.join('plugin', 'skills', 'deck', 'SKILL.md')),
    `plugin skill must live at plugin/skills/deck/SKILL.md, got ${rel(pluginCopy)}`,
  );
});
