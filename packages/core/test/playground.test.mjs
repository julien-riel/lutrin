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
/** Every graph the page links: the compiler it loads up front, the validator
 *  it lints with (line-anchored findings in the notes), and the .pptx renderer
 *  it `import()`s the first time a visitor asks for that export. The last is
 *  dynamic, so it fails at CLICK time rather than at load time — a visitor who
 *  typed a deck and then found the download broken, which is worse than a page
 *  that never offered it. */
const ENTRIES = [
  path.join(CORE, 'src', 'html', 'render.mjs'),
  path.join(CORE, 'src', 'deck', 'validate.mjs'),
  path.join(CORE, 'src', 'pptx', 'render.mjs'),
  // dynamic like the .pptx renderer, imported on the first kit upload — and
  // like it, a broken graph must fail HERE rather than at that click
  path.join(CORE, 'src', 'kit', 'archive.mjs'),
];

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

/** Everything the browser would have to resolve to load `entries`. */
function walk(...entries) {
  const seen = new Set();
  const external = new Set();
  const queue = [...entries];
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
  const { external } = walk(...ENTRIES);
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
    // ./vendor/ entries are copied out of node_modules by CI and checked by
    // the loop-parity test below; the other two prefixes exist in this repo.
    const root = target.startsWith('./assets/')
      ? path.join(SITE, 'assets')
      : target.startsWith('./core/')
        ? CORE
        : null;
    if (!root) continue;
    const file = path.join(root, ...target.split('/').slice(2));
    assert.ok(fs.existsSync(file), `${spec} → ${target}, which does not exist`);
  }
});

/**
 * The compiler's graph is walked above; the EDITOR's graph is this one.
 * CodeMirror is ~20 vendored ESM packages importing each other by bare
 * specifier, and one transitive dependency missing from the map (@lezer/lr,
 * say — imported by nothing we wrote) kills the page at link time with
 * nothing in the Node suite noticing. So: start from every ./vendor/ file
 * the map names, follow relative imports through the package, and demand
 * that every bare specifier met on the way is itself in the map.
 */
test('the vendored ESM graph resolves entirely inside the map', () => {
  const map = importMap();
  const toFile = (target) => path.join(REPO, 'node_modules', target.slice('./vendor/'.length));
  const queue = Object.values(map)
    .filter((t) => t.startsWith('./vendor/') && /\.(mjs|js)$/.test(t))
    .map(toFile);
  const seen = new Set();
  const missing = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const spec of staticSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), spec));
        continue;
      }
      if (!(spec in map)) missing.add(spec);
      else if (map[spec].startsWith('./vendor/')) queue.push(toFile(map[spec]));
    }
  }
  assert.deepEqual(
    [...missing].sort(),
    [],
    'a vendored package imports these and the map does not resolve them — the playground dies at link time',
  );
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

/**
 * The .pptx renderer is a chain of zip round-trips, and `nodebuffer` is the one
 * JSZip output type that does not exist off Node — it throws, in a browser, on
 * whichever pass reaches for it first, leaving a half-written package. Every
 * one of them therefore asks `bytes.mjs`, which picks per runtime.
 *
 * A pass added later would spell the literal out again by copying its
 * neighbour, and the playground would break for that deck alone. Hence a grep
 * rather than a behaviour test: the mistake is invisible on Node, where it
 * works perfectly.
 */
test('no .pptx pass asks JSZip for a nodebuffer by name', () => {
  const dir = path.join(CORE, 'src', 'pptx');
  const offenders = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) =>
      /generateAsync\([^)]*'nodebuffer'/.test(fs.readFileSync(path.join(dir, f), 'utf8')),
    );
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(', ')}: use ZIP_BYTES from ./bytes.mjs — a hard-coded 'nodebuffer' throws in the browser the playground exports from, and nowhere else`,
  );
});

test('ZIP_BYTES is the Node type when running on Node', async () => {
  const { ZIP_BYTES } = await import('../src/pptx/bytes.mjs');
  assert.equal(ZIP_BYTES, 'nodebuffer');
});

/**
 * JSZip ships no ESM at all, so `jszip` resolves to a shim that loads the UMD
 * bundle as a classic script. The bundle's URL is asked of the import map
 * (`jszip/umd`) rather than written into the shim, which is what keeps the list
 * of vendored packages in ONE place — the map, which site-serve.mjs reads and
 * which the test above holds the CI vendoring loop to. A relative path in the
 * shim would be a second list, invisible to both.
 */
test('the jszip shim reaches its bundle through the import map', () => {
  const shimFile = path.join(SITE, 'assets', 'js', 'shims', 'jszip.mjs');
  const shim = fs.readFileSync(shimFile, 'utf8');
  const map = importMap();

  assert.equal(map.jszip, './assets/js/shims/jszip.mjs', 'jszip must resolve to the shim');
  const spec = shim.match(/import\.meta\.resolve\(['"]([^'"]+)['"]\)/)?.[1];
  assert.ok(spec, 'the shim no longer resolves its bundle through the import map');
  assert.ok(map[spec], `the import map has no ${spec} entry for the shim to resolve`);
  assert.match(map[spec], /^\.\/vendor\//, `${spec} must point into the vendored packages`);
  assert.doesNotMatch(shim, /\.\.\/\.\.\/\.\.\/vendor\//, 'the shim spells out a second path');
});

/**
 * MathJax is the same story as JSZip and is loaded the same way, so it gets the
 * same guard. What is specific to it: the map must name the `-full` bundle.
 * `tex-svg.js` carries only the default TeX packages and `autoload` then
 * fetches the rest FROM A CDN at conversion time — a network call on a page
 * that promises your text never leaves your machine, and a silent divergence
 * from the CLI, which builds its TeX input jax with `AllPackages`.
 */
test('the mathjax shim reaches its bundle through the import map', () => {
  const shimFile = path.join(SITE, 'assets', 'js', 'shims', 'mathjax.mjs');
  const shim = fs.readFileSync(shimFile, 'utf8');
  const map = importMap();

  assert.equal(map.mathjax, './assets/js/shims/mathjax.mjs', 'mathjax must resolve to the shim');
  const spec = shim.match(/import\.meta\.resolve\(['"]([^'"]+)['"]\)/)?.[1];
  assert.ok(spec, 'the shim no longer resolves its bundle through the import map');
  assert.ok(map[spec], `the import map has no ${spec} entry for the shim to resolve`);
  assert.match(map[spec], /^\.\/vendor\//, `${spec} must point into the vendored packages`);
  assert.match(
    map[spec],
    /tex-svg-full\.js$/,
    'the map must name the -full bundle: the smaller one autoloads TeX packages from a CDN',
  );
  assert.doesNotMatch(shim, /\.\.\/\.\.\/\.\.\/vendor\//, 'the shim spells out a second path');
});

/**
 * The bundle the map points at has to be the one that exists on disk AND the
 * one whose two entry points `deck/assets.mjs` calls. A rename upstream would
 * otherwise show up as a 404 in production and as nothing at all here — and
 * `tex2mml` is the half whose absence is invisible: every equation would still
 * render, as a picture, and the .pptx would quietly stop being editable.
 */
test('the vendored MathJax bundle publishes both halves the compiler needs', () => {
  const target = importMap()['mathjax/umd'];
  const pkg = target.slice('./vendor/'.length).split('/')[0];
  const file = path.join(REPO, 'node_modules', target.slice('./vendor/'.length));
  assert.equal(pkg, 'mathjax-full', 'the bundle must come from the package already depended on');
  assert.ok(fs.existsSync(file), `${target} does not exist under node_modules`);

  // The two methods are BUILT, not written: components/startup.js composes them
  // as `<input>2<output>` and `<input>2mml`, so neither name appears in the
  // minified bundle and a grep for `tex2svg` would pass on any file at all.
  // What is checked is the composition itself — the shape that disappears if
  // the bundle ever ships without its startup component.
  const bundle = fs.readFileSync(file, 'utf8');
  assert.match(bundle, /\+"2mml"/, 'the bundle carries no tex2mml — the native OMML half is gone');
  assert.match(bundle, /\+"2"\+/, 'the bundle carries no tex2svg — it has no startup component');
  assert.match(bundle, /startup:/, 'the bundle exposes no startup object to await');
});

/**
 * Mermaid follows the jszip/mathjax pattern with one difference worth pinning:
 * the compiler never imports the specifier. Only playground.js does, to
 * pre-render diagrams into the virtual filesystem the compiler then reads.
 * And the bundle must be THE one @lutrin/core ships (/core/vendor/, mirrored
 * from packages/core/vendor/) — pointing the map at a node_modules copy would
 * let the page render with a different Mermaid than the CLI, and the two
 * outputs would disagree about the same deck.
 */
test('the mermaid shim reaches the bundle the core package ships', () => {
  const shimFile = path.join(SITE, 'assets', 'js', 'shims', 'mermaid.mjs');
  const shim = fs.readFileSync(shimFile, 'utf8');
  const map = importMap();

  const spec = shim.match(/import\.meta\.resolve\(['"]([^'"]+)['"]\)/)?.[1];
  assert.ok(spec, 'the shim no longer resolves its bundle through the import map');
  assert.ok(map[spec], `the import map has no ${spec} entry for the shim to resolve`);
  assert.match(
    map[spec],
    /^\.\/core\/vendor\//,
    `${spec} must point at the copy @lutrin/core ships, not at node_modules`,
  );
  assert.doesNotMatch(shim, /\.\.\/\.\.\/\.\.\/vendor\//, 'the shim spells out a second path');
});

/**
 * The icons prefix entry is what playground.js resolves icon URLs against, and
 * both halves have to hold: a prefix mapping only matches when key AND value
 * end in '/', and the package must be in the CI vendoring loop (the parity
 * test above checks that) with its icons/ directory actually installed.
 */
/**
 * The `lucide:` completion reads an icon-name index that TWO generators
 * write: site-serve.mjs per request, pages.yml at deploy. Neither is
 * exercised by the other's path — a dev box never runs the workflow, CI
 * never runs the dev server — so the pin is that both name the same file.
 * Lose one and the completion works exactly where it was tested and 404s
 * exactly where visitors are.
 */
test('both site generators publish the lucide icon index at the same path', () => {
  const serve = fs.readFileSync(path.join(REPO, 'scripts', 'site-serve.mjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/pages.yml'), 'utf8');
  assert.match(
    serve,
    /'\/vendor\/lucide-static\/icons\.json'/,
    'site-serve.mjs no longer serves the icon index the completion fetches',
  );
  assert.match(
    workflow,
    /_site\/vendor\/lucide-static\/icons\.json/,
    'pages.yml no longer writes the icon index — completion would 404 in production only',
  );
});

/**
 * Same shape for the kit picker: /kits/index.json is written by two
 * generators that never run each other's path. And the kits themselves must
 * be present with their manifests — a kit directory without kit.json is
 * invisible to both generators, silently.
 */
test('both site generators publish the kit index, and the kits carry manifests', () => {
  const serve = fs.readFileSync(path.join(REPO, 'scripts', 'site-serve.mjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/pages.yml'), 'utf8');
  assert.match(serve, /'\/kits\/index\.json'/, 'site-serve.mjs no longer serves the kit index');
  assert.match(
    workflow,
    /_site\/kits\/index\.json/,
    'pages.yml no longer writes the kit index — the picker would be empty in production only',
  );
  const kitsDir = path.join(REPO, 'examples', 'kits');
  const kits = fs
    .readdirSync(kitsDir)
    .filter((n) => fs.existsSync(path.join(kitsDir, n, 'kit.json')));
  assert.ok(kits.length >= 8, `only ${kits.length} kits carry a kit.json — the picker starves`);
});

test('the lucide icons prefix entry is a valid prefix and the icons exist', () => {
  const target = importMap()['lucide-static/icons/'];
  assert.ok(target, 'the import map lost its lucide-static/icons/ entry');
  assert.match(target, /\/$/, 'a prefix mapping whose value lacks the trailing / matches nothing');
  assert.ok(
    fs.existsSync(path.join(REPO, 'node_modules', 'lucide-static', 'icons', 'zap.svg')),
    'lucide-static/icons is not installed — the playground would 404 on every icon',
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

  // normalize is what the kit resolution chain calls (insideKit): trailing
  // separators, doubled separators, dot-segments, and the empty string
  const normals = ['/kits/press-noir/', '/a//b/../c', 'a/./b/..', '../x', '/..', '', '.', 'a/'];
  for (const s of normals) assert.equal(p.normalize(s), real.normalize(s), `normalize(${s})`);
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

  // BYTES hash as the bytes they are — `String(chunk)` on a Uint8Array yields
  // "137,80,78,…" and a digest of the wrong thing, silently. The caller that
  // hashes bytes is the kit-archive reader naming an uploaded .deckkit.
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 128) % 256);
  for (const algorithm of ['sha1', 'sha256'])
    assert.equal(
      c.createHash(algorithm).update(bytes).digest('hex'),
      nodeCrypto.createHash(algorithm).update(bytes).digest('hex'),
      `${algorithm}(bytes)`,
    );
  // and a multi-chunk update concatenates rather than restarts
  assert.equal(
    c.createHash('sha256').update('ab').update(bytes).digest('hex'),
    nodeCrypto.createHash('sha256').update('ab').update(bytes).digest('hex'),
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

/**
 * The .pptx export is the reason this matters. Exporting writes the package
 * into the shim and reopens it once per post-processing pass, so a write that
 * stringified its input would hand `JSZip.loadAsync` a mangled zip — and the
 * failure would read as a corrupt archive rather than as a lost write, which is
 * a long way from the cause.
 */
test('the fs shim round-trips bytes as bytes', async () => {
  const vfs = await shim('fs');
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x7f, 0x80]);
  vfs.writeFileSync('/tmp/deck.pptx', bytes);

  const back = vfs.readFileSync('/tmp/deck.pptx');
  assert.ok(back instanceof Uint8Array, 'a binary file came back as something else');
  assert.deepEqual([...back], [...bytes]);
  assert.equal(vfs.statSync('/tmp/deck.pptx').size, bytes.length);

  // and an export leaves nothing for the next one to read back
  vfs.rmSync('/tmp', { recursive: true, force: true });
  assert.equal(vfs.existsSync('/tmp/deck.pptx'), false);
});

/**
 * html/render.mjs memoizes each inlined image by `file|mtimeMs|size`. A shim
 * that answered a constant mtime would satisfy every other test and still
 * serve a stale picture the day someone drops a same-named, same-sized
 * replacement — the memo key would not budge. mtime here is a write counter,
 * which is the property that memo actually relies on.
 */
test('overwriting a file moves its mtime, even at the same size', async () => {
  const vfs = await shim('fs');
  vfs.writeFileSync('/deck/pic.png', new Uint8Array([1, 2, 3]));
  const before = vfs.statSync('/deck/pic.png').mtimeMs;
  vfs.writeFileSync('/deck/pic.png', new Uint8Array([9, 9, 9]));
  assert.notEqual(vfs.statSync('/deck/pic.png').mtimeMs, before);
  vfs.rmSync('/deck', { recursive: true, force: true });
});

/**
 * A dropped image travels VFS → `readFileSync(img).toString('base64')` → data:
 * URI (html/render.mjs). A bare Uint8Array would satisfy the byte round-trip
 * test above and still break this: its `toString` ignores the argument and
 * yields comma-joined decimals — a data: URI of "137,80,78,…", a broken
 * picture, no error anywhere. So the read is pinned against Buffer itself.
 */
test('a binary read answers toString like a Buffer, base64 included', async () => {
  const vfs = await shim('fs');
  // non-ASCII bytes on both sides of 0x80, and a length that is not a multiple
  // of 3: the base64 padding path
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x81]);
  vfs.writeFileSync('/deck/photo.png', bytes);
  const back = vfs.readFileSync('/deck/photo.png');
  assert.ok(back instanceof Uint8Array, 'the rasterizer and JSZip type-check the read');
  assert.equal(back.toString('base64'), Buffer.from(bytes).toString('base64'));
  // imageDims() sizes a PNG read back off this filesystem with these two —
  // called on the diagram PNGs the playground provisions and on dropped photos
  assert.equal(back.readUInt32BE(0), Buffer.from(bytes).readUInt32BE(0));
  assert.equal(back.readUInt16BE(4), Buffer.from(bytes).readUInt16BE(4));
  // and a text file written as bytes decodes as text, the way Node's does
  const text = new TextEncoder().encode('accentué — ✓');
  vfs.writeFileSync('/deck/note.txt', text);
  assert.equal(vfs.readFileSync('/deck/note.txt', 'utf8'), 'accentué — ✓');
  assert.equal(vfs.readFileSync('/deck/note.txt').toString(), 'accentué — ✓');
  vfs.rmSync('/deck', { recursive: true, force: true });
});

/** Two exports in one session must not share a directory: the second would
 *  otherwise open what the first left there. */
test('the fs shim hands out a fresh mkdtemp every call', async () => {
  const vfs = await shim('fs');
  assert.notEqual(vfs.mkdtempSync('/tmp/lutrin-'), vfs.mkdtempSync('/tmp/lutrin-'));
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
