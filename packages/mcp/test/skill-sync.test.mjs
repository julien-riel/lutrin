/**
 * Each skill lives once (`packages/core/skills/<name>/SKILL.md`) and is copied
 * to every host that discovers it at a fixed path. This test asserts the copies
 * are BYTE-identical to the canonical file, so a hand edit to one — or an
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
import { fileURLToPath } from 'node:url';
import { SKILLS } from '../../../scripts/sync-skill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rel = (p) => path.relative(ROOT, p);

test('the skill list is non-empty and every canonical SKILL.md exists', () => {
  assert.ok(SKILLS.length > 0, 'scripts/sync-skill.mjs registers no skill at all');
  for (const { canonical } of SKILLS) {
    assert.ok(
      fs.existsSync(canonical),
      `${rel(canonical)} is the single source of truth — missing`,
    );
    assert.ok(fs.statSync(canonical).size > 0, `${rel(canonical)} is empty`);
  }
});

test('every host copy is byte-identical to its canonical SKILL.md', () => {
  for (const { canonical, copies } of SKILLS) {
    const source = fs.readFileSync(canonical);
    for (const dest of copies) {
      assert.ok(fs.existsSync(dest), `${rel(dest)} missing — run: node scripts/sync-skill.mjs`);
      const current = fs.readFileSync(dest);
      assert.ok(
        current.equals(source),
        `${rel(dest)} drifted from ${rel(canonical)} — run: node scripts/sync-skill.mjs`,
      );
    }
  }
});

test('every skill has its plugin copy at the spec discovery path (skills/<name>/SKILL.md)', () => {
  // agent-plugins.org §6.1 fixes this location; a client will not find the
  // skill anywhere else.
  for (const { name, copies } of SKILLS) {
    const pluginCopy = copies.find((p) => p.includes(`${path.sep}plugin${path.sep}`));
    assert.ok(
      pluginCopy,
      `skill "${name}": no plugin/ copy is registered in scripts/sync-skill.mjs`,
    );
    assert.ok(
      pluginCopy.endsWith(path.join('plugin', 'skills', name, 'SKILL.md')),
      `skill "${name}" must live at plugin/skills/${name}/SKILL.md, got ${rel(pluginCopy)}`,
    );
  }
});
