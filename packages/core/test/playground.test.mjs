/**
 * The browser playground — site/playground.html runs THIS compiler, unmodified,
 * behind an import map and the shims in site/assets/js/shims/.
 *
 * That arrangement has one failure mode, and it is silent and total: add a
 * `import zlib from 'node:zlib'` anywhere in the module graph reachable from
 * `html/render.mjs`, and the browser refuses the whole graph at link time —
 * before a line of compiler code runs, and with nothing in the Node test suite
 * noticing. The page would go out broken and nobody would know until a visitor
 * opened it.
 *
 * So the first test here walks the REAL static import graph and demands that
 * the import map cover every specifier it finds. It is deliberately not a list
 * of known imports: a list would have to be maintained, and the thing that
 * needs maintaining is exactly the thing that gets forgotten.
 *
 * The rest pins the two shims that do arithmetic rather than stubbing —
 * `path` and `crypto` — against Node's own, because a subtly wrong `join` or a
 * wrong SHA-1 would not crash, it would produce different slides.
 *
 * No browser is needed for any of this, and none is started.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import nodeCrypto from 'node:crypto';

const CORE = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(CORE, '..', '..');
const SITE = path.join(REPO, 'site');
const PLAYGROUND = path.join(SITE, 'playground.html');
const ENTRY = path.join(CORE, 'src', 'html', 'render.mjs');

// ---------------------------------------------------------------------------
// the import graph, and the map that has to cover it
// ---------------------------------------------------------------------------

/** STATIC imports only — `import`, `import … from`, `export … from`. A dynamic
 *  `import()` is deliberately excluded: those are the ones already wrapped in a
 *  try/catch (mathjax, the pptx renderer), and they fail at call time in a
 *  browser rather than at link time, which is the whole difference. */
function staticSpecifiers(source) {
  const out = [];
  const withFrom = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*['"]([^'"]+)['"]/g;
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (const re of [withFrom, bare]) {
    let m;
    while ((m = re.exec(source))) out.push(m[1]);
  }
  return out;
}

/** Everything the browser would have to resolve to load `entry`. */
function walk(entry) {
  const seen = new Set();
  const external = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), spec));
        continue;
      }
      external.add(spec);
    }
  }
  return { files: seen, external };
}

/** The `<script type="importmap">` of playground.html, parsed as the JSON it is. */
function importMap() {
  const html = fs.readFileSync(PLAYGROUND, 'utf8');
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(m, 'playground.html carries no import map');
  return JSON.parse(m[1]).imports;
}

test('the import map covers every specifier the compiler statically imports', () => {
  const { external } = walk(ENTRY);
  const map = importMap();

  const missing = [...external].filter((s) => !(s in map));
  assert.deepEqual(
    missing,
    [],
    [
      `site/playground.html does not map: ${missing.join(', ')}`,
      'A browser refuses the whole module graph over one unmapped specifier, at link',
      'time, before any compiler code runs. Add a shim under site/assets/js/shims/',
      '(or vendor the package in .github/workflows/pages.yml) and map it — or the',
      'playground ships broken.',
    ].join('\n'),
  );
});

test('every file the import map points at exists', () => {
  for (const [spec, target] of Object.entries(importMap())) {
    if (!target.startsWith('./assets/')) continue; // vendored packages are copied by CI
    const file = path.join(SITE, target.slice(2));
    assert.ok(fs.existsSync(file), `${spec} → ${target}, which does not exist`);
  }
});

test('the vendored packages CI copies are exactly the ones the map names', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/pages.yml'), 'utf8');
  const m = workflow.match(/for p in ([^;]+); do/);
  assert.ok(m, 'pages.yml no longer carries the vendoring loop this test guards');
  const copied = new Set(m[1].trim().split(/\s+/));

  const mapped = new Set(
    Object.entries(importMap())
      .filter(([, target]) => target.startsWith('./vendor/'))
      .map(([, target]) => target.slice('./vendor/'.length).split('/')[0]),
  );

  assert.deepEqual(
    [...mapped].sort(),
    [...copied].sort(),
    'the import map and the CI vendoring loop disagree: one lists a package the ' +
      'other does not, so the playground 404s on it in production and nowhere else',
  );
});

test('process is stubbed by a classic script before the module runs', () => {
  const html = fs.readFileSync(PLAYGROUND, 'utf8');
  const stub = html.indexOf('window.process');
  const mod = html.indexOf('type="module"');
  assert.ok(stub > 0, 'playground.html does not stub window.process');
  assert.ok(mod > 0, 'playground.html loads no module');
  // deck/assets.mjs dereferences process.env at MODULE SCOPE, on the first
  // statement it evaluates. Out of order, the page dies with
  // "process is not defined" before anything else is even attempted.
  assert.ok(stub < mod, 'the process stub must come BEFORE the module script');
});

// ---------------------------------------------------------------------------
// the two shims that compute rather than stub
// ---------------------------------------------------------------------------

const shim = (name) => import(`file://${path.join(SITE, 'assets', 'js', 'shims', `${name}.mjs`)}`);

test('the path shim answers exactly as node:path.posix does', async () => {
  const p = (await shim('path')).default;
  const real = path.posix;

  const joins = [
    ['/core/src/deck', '..', '..', 'design', 'layouts'],
    ['/a/b', 'c'],
    ['a', 'b'],
    ['/a', '/b'],
    ['/a', '..', '..'],
    ['/a/b/', '/c/'],
    ['/', 'a'],
    ['.', 'x'],
  ];
  for (const args of joins) assert.equal(p.join(...args), real.join(...args), `join ${args}`);

  const resolves = [
    ['/core/src/deck/layout.mjs'],
    ['/a/b', '../c'],
    ['/a', 'b', 'c'],
    ['/x/y', '/z'],
  ];
  for (const args of resolves)
    assert.equal(p.resolve(...args), real.resolve(...args), `resolve ${args}`);

  const paths = [
    '/core/src/deck/layout.mjs',
    '/a/b/c.json',
    '/a',
    'a.deck.md',
    '/x/y/',
    'noext',
    '/',
  ];
  for (const s of paths)
    for (const fn of ['dirname', 'basename', 'extname'])
      assert.equal(p[fn](s), real[fn](s), `${fn}(${s})`);
});

test('the crypto shim digests exactly as node:crypto does', async () => {
  const c = await shim('crypto');
  // Multi-block, block-boundary and non-ASCII inputs: the padding arithmetic is
  // where a hand-written digest goes wrong, and it goes wrong silently.
  const inputs = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(200),
    'accentué — ✓',
  ];
  for (const algorithm of ['sha1', 'sha256'])
    for (const s of inputs)
      assert.equal(
        c.createHash(algorithm).update(s).digest('hex'),
        nodeCrypto.createHash(algorithm).update(s, 'utf8').digest('hex'),
        `${algorithm}(${JSON.stringify(s.slice(0, 16))})`,
      );
});

test('the fs shim serves what was preloaded, and refuses what was not', async () => {
  const vfs = await shim('fs');
  vfs.preload('/core/design/layouts/funnel.json', '{"name":"funnel"}');
  assert.equal(vfs.existsSync('/core/design/layouts/funnel.json'), true);
  assert.equal(vfs.readFileSync('/core/design/layouts/funnel.json', 'utf8'), '{"name":"funnel"}');
  // The directory has to exist for readdirSync — that is the call layout.mjs
  // makes at module scope, and an empty result there is the silent failure the
  // playground checks for after loading.
  assert.deepEqual(vfs.readdirSync('/core/design/layouts'), ['funnel.json']);
  assert.throws(
    () => vfs.readFileSync('/nope.json', 'utf8'),
    (e) => e.code === 'ENOENT',
  );
});

test('the layout catalog the playground preloads is the one the engine expects', () => {
  // The playground fetches a manifest CI writes from this directory, then
  // counts what registered. If the two ever disagree the page refuses to
  // compile rather than showing wrong geometry — but the directory has to be
  // non-empty for any of that to mean anything.
  const dir = path.join(CORE, 'design', 'layouts');
  const defs = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(defs.length > 0, 'design/layouts holds no definitions');
  for (const f of defs) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(parsed.name, `${f} declares no name — it would register as broken`);
  }
});
