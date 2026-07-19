/**
 * Invariants of the repository's package.json files — "publishing" and
 * "installing" are surfaces like any other, and they had no guard at all.
 *
 * Three concrete regressions motivated this file:
 *
 *   1. `@lutrin/core` was neither `private` nor bounded by `files`: an
 *      accidental `npm publish` carried `test/` — goldens, fixtures and a few
 *      megabytes — into the public tarball.
 *   2. `@mermaid-js/mermaid-cli` was a devDependency of core while NOTHING in
 *      `test/` uses it: every `npm ci` downloaded ~1 GB of Chromium, in CI as
 *      well as for a contributor who only wanted to run the tests. Mermaid
 *      rendering is optional by design (`findMmdc()` returns null, the caller
 *      keeps its text fallback): the dependency must therefore stay optional,
 *      never installed by default.
 *   3. `engines.node` was absent everywhere, while the suite actually required
 *      Node ≥ 22 (the glob of `--test "<pattern>"` only exists from Node 21 on,
 *      and pptxgenjs ships ESM inside a `.js` that only Node ≥ 20.19's syntax
 *      detection knows how to load).
 *
 * These checks cost nothing and fail the moment someone undoes one of the
 * three gestures without meaning to.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (...seg) => JSON.parse(fs.readFileSync(path.join(ROOT, ...seg), 'utf8'));

const ROOT_PKG = read('package.json');
const CORE = read('packages', 'core', 'package.json');

/** The editor host packages, which are not published on npm but whose metadata
 *  feeds the VS Code marketplace and the Obsidian catalog. */
const HOSTS = [
  ['packages', 'vscode-extension', 'package.json'],
  ['packages', 'obsidian-plugin', 'package.json'],
];

const ALL = [
  ['root', ROOT_PKG],
  ['@lutrin/core', CORE],
  ...HOSTS.map((seg) => [seg[1], read(...seg)]),
];

test('@lutrin/core bounds its tarball: neither test/ nor goldens published', () => {
  assert.ok(
    Array.isArray(CORE.files) && CORE.files.length > 0,
    '`files` absent: npm would publish the whole package directory',
  );
  assert.ok(
    !CORE.files.some((f) => f.replace(/^\.\//, '').startsWith('test')),
    '`files` must not carry test/',
  );

  // `design/` IS needed at runtime — layout.mjs reads the official layout
  // catalog from it. Forgetting it breaks the published package without
  // breaking the repository.
  assert.ok(CORE.files.includes('src'), 'src/ must be published');
  assert.ok(
    CORE.files.includes('design'),
    'design/ must be published: layout.mjs reads the official layouts from it',
  );
});

test('mermaid-cli stays optional: never installed by a plain npm ci', () => {
  const MERMAID = '@mermaid-js/mermaid-cli';
  for (const [name, pkg] of ALL) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      assert.ok(
        !pkg[field]?.[MERMAID],
        `${name}: ${MERMAID} in ${field} — ~1 GB of Chromium on every install, for a rendering the compiler knows how to degrade to a text fallback`,
      );
    }
  }
  // Declared all the same, so that the compatible version range is written
  // down somewhere — but as an optional peer, which npm does not install by
  // default.
  assert.ok(CORE.peerDependencies?.[MERMAID], 'the compatible range must stay declared');
  assert.equal(
    CORE.peerDependenciesMeta?.[MERMAID]?.optional,
    true,
    'the peer dependency must be marked optional, otherwise npm installs it',
  );
});

test('every package announces the same Node baseline as CI', () => {
  for (const [name, pkg] of ALL) {
    assert.equal(
      pkg.engines?.node,
      '>=22',
      `${name}: engines.node must be ">=22" — the suite uses the glob of \`node --test "<pattern>"\`, absent before Node 21`,
    );
  }
});

test('every package carries what it takes to find the repository', () => {
  for (const [name, pkg] of ALL) {
    assert.ok(pkg.repository?.url, `${name}: "repository" missing`);
    assert.ok(pkg.bugs?.url, `${name}: "bugs" missing`);
    assert.ok(pkg.homepage, `${name}: "homepage" missing`);
    assert.ok(
      Array.isArray(pkg.keywords) && pkg.keywords.length > 0,
      `${name}: "keywords" missing`,
    );
  }
});

test('both editor hosts are typecheckable from the root', () => {
  // Typechecking the VS Code extension was not scriptable: `npm run typecheck`
  // at the root only covered the Obsidian plugin, and nothing flagged it.
  for (const seg of HOSTS) {
    const pkg = read(...seg);
    assert.equal(
      pkg.scripts?.typecheck,
      'tsc --noEmit',
      `${seg[1]}: "typecheck" script missing — CI cannot check it`,
    );
  }
  assert.match(
    ROOT_PKG.scripts?.typecheck ?? '',
    /lutrin-vscode/,
    'the root typecheck must include the VS Code extension',
  );
  assert.match(
    ROOT_PKG.scripts?.typecheck ?? '',
    /lutrin-obsidian/,
    'the root typecheck must include the Obsidian plugin',
  );
});
