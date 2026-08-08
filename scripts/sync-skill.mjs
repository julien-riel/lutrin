#!/usr/bin/env node
/**
 * Keeps the `deck` skill's `SKILL.md` in ONE place and copies it wherever a
 * host expects to find it.
 *
 * The skill is authored once, in `packages/core/skills/deck/SKILL.md` — beside
 * the compiler and the DSL it documents, so a change to the engine and a change
 * to the instructions land in the same review. Two hosts then need a BYTE copy
 * of that file, at a fixed path each cannot override:
 *
 *   - `.claude/skills/deck/SKILL.md` — the Claude Code skill (this repo's own
 *     `.claude/` tree);
 *   - `plugin/skills/deck/SKILL.md` — the portable Agent Plugin (agent-plugins.org
 *     §6.1 fixes `skills/<name>/SKILL.md` as the discovery location).
 *
 * A hand-maintained copy drifts the first time someone edits one and forgets
 * the other; the agent then reads stale instructions from whichever host it
 * loaded. So the copies are GENERATED here and asserted byte-identical by
 * `packages/mcp/test/skill-sync.test.mjs` — the same anti-drift discipline the
 * repo already applies to `tokens.mjs` ↔ `design/themes/default.json`.
 *
 * Usage:
 *   node scripts/sync-skill.mjs           # write the copies from the canonical file
 *   node scripts/sync-skill.mjs --check   # verify only; exit 1 on any drift (CI)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one authored copy. */
export const CANONICAL = path.join(ROOT, 'packages', 'core', 'skills', 'deck', 'SKILL.md');

/** Every generated copy, at the fixed path its host discovers it under. */
export const COPIES = [
  path.join(ROOT, '.claude', 'skills', 'deck', 'SKILL.md'),
  path.join(ROOT, 'plugin', 'skills', 'deck', 'SKILL.md'),
];

/** Read as a Buffer, compared as bytes: this guards against an editor that
 *  "helpfully" rewrites the line endings or the trailing newline of one copy —
 *  exactly the drift a string comparison after normalization would hide. */
function main() {
  const check = process.argv.includes('--check');
  const source = fs.readFileSync(CANONICAL);
  const drifted = [];

  for (const dest of COPIES) {
    const current = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (current?.equals(source)) continue;
    drifted.push(dest);
    if (!check) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, source);
    }
  }

  const rel = (p) => path.relative(ROOT, p);
  if (check) {
    if (drifted.length) {
      console.error(
        `✖ SKILL.md out of sync with ${rel(CANONICAL)}:\n${drifted
          .map((d) => `  - ${rel(d)}`)
          .join('\n')}\n  Run: node scripts/sync-skill.mjs`,
      );
      process.exit(1);
    }
    console.log(`✓ SKILL.md in sync across ${COPIES.length} copies`);
    return;
  }

  if (drifted.length) for (const d of drifted) console.log(`✓ wrote ${rel(d)}`);
  else console.log(`✓ SKILL.md already in sync (${COPIES.length} copies)`);
}

// Run only when invoked directly (`node scripts/sync-skill.mjs`), not when a
// test imports CANONICAL/COPIES — importing must not sync the tree as a side
// effect. Node 22 has no stable `import.meta.main`, hence the argv comparison.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
