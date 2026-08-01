/**
 * `lutrin edit` server — startDeckEditServer(rootDir, { port }) exercised
 * over real HTTP on an ephemeral port, against a fixture tree on disk.
 *
 * Under test: the pruned .deck.md tree (symlink cycles cut, budget on visited
 * entries), the deck read (slices, capabilities, version, sceneOffset), the
 * fragment compile (strict edit body, per-file latest-wins), the one-slide
 * write (guarded splice, boundary net, version conflict, bounds), the path
 * confinement on reads AND writes (lexical + realpath, probed with a raw
 * HTTP client, no double decode), the SSE watcher with auto-write
 * suppression, the Origin and Host gates, the static side and the /fonts
 * alias, and the failed-listen lifecycle. The tests run in source order
 * against ONE server: each states what it relies on.
 *
 * ONE RULE FOR THE TESTS THAT BRING THEIR OWN ROOT: close the server BEFORE
 * deleting the tree, in a single `t.after`. `node:test` runs after hooks in
 * REGISTRATION order — not in reverse — so the natural-looking pair
 *
 *     t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 *     …
 *     t.after(() => srv.close());
 *
 * deletes the directory while the server's recursive `fs.watch` is still
 * watching it. On macOS and Linux that is harmless. On Windows it reaches
 * `Assertion failed: !_wcsnicmp(filename, dir, dirlen)` in libuv's
 * src/win/fs-event.c, which does not throw — it ABORTS the process, taking
 * the whole file down with it and reporting one opaque failure. It cost a red
 * windows-latest / Node 24 in CI, on a suite green everywhere else.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDeckEditServer } from '../src/edit-server.mjs';

const SERVER_MODULE = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'edit-server.mjs'),
).href;

const DECK_A = `---
title: Fixture A
---

# One

Intro text for the first slide.

---

<!-- layout: two-columns -->

# Two

## Left

alpha

## Right

beta

---

# Three

- first point
- second point
`;

const DECK_B = '# B\n\nA single slide.\n';
const DECK_MARP = '---\nmarp: true\n---\n\n# M\n\nMarp text.\n';
/** The review's corruption #0: the bare `---` touches the slide above it. */
const DECK_WELD = '# One\n- a\n- b\n---\n## Next steps\n\ncontent\n';
/** A file OPENING on a bare `---`: yaml-looking text spliced into slice 0
 *  wakes a frontmatter up — the weld the splice guards cannot see. */
const DECK_NET = '---\n\n# First\n\ntext\n\n---\n\n# Second\n\nmore\n';
const DECK_PERCENT = '# Percent\n\nThe literally-percent-named deck.\n';
const DECK_SPACE = '# Space\n\nThe space-named deck.\n';

const sha16 = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

let tmp; // holds the served root AND the outside-the-root secret
let root;
let server;
let port;
let base;
let close;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-edit-'));
  root = path.join(tmp, 'workspace');
  fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sub', 'layouts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'empty-dir'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.deck.md'), DECK_A);
  fs.writeFileSync(path.join(root, 'marp.deck.md'), DECK_MARP);
  fs.writeFileSync(path.join(root, 'weld.deck.md'), DECK_WELD);
  fs.writeFileSync(path.join(root, 'net.deck.md'), DECK_NET);
  // a file whose NAME contains a percent escape, and its decoded twin: the
  // pair catches any double decode of client paths
  fs.writeFileSync(path.join(root, 'a%20b.deck.md'), DECK_PERCENT);
  fs.writeFileSync(path.join(root, 'a b.deck.md'), DECK_SPACE);
  fs.writeFileSync(path.join(root, 'notes.md'), '# not a deck\n');
  fs.writeFileSync(path.join(root, 'sub', 'b.deck.md'), DECK_B);
  fs.writeFileSync(path.join(root, 'sub', 'deep', 'c.deck.md'), '# C\n\nDeep slide.\n');
  // a deck-local layouts/ directory: the capabilities of sub/b.deck.md must
  // list it, and the capabilities of a.deck.md must not
  fs.writeFileSync(
    path.join(root, 'sub', 'layouts', 'local-note.json'),
    JSON.stringify({ name: 'local-note', base: 'content' }),
  );
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'x.deck.md'), '# hidden\n');
  fs.writeFileSync(path.join(root, '.hidden', 'h.deck.md'), '# hidden\n');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'TOP-SECRET outside the root');
  fs.writeFileSync(path.join(tmp, 'outside.deck.md'), '# TOP-SECRET deck outside the root\n');

  ({ server, port, close } = await startDeckEditServer(root, { port: 0 }));
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await close?.();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const getJson = async (p) => {
  const r = await fetch(`${base}${p}`);
  return { status: r.status, body: await r.json() };
};
const sendJson = async (p, method, payload, headers = {}) => {
  const r = await fetch(`${base}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json() };
};

/** The Node http client sends the path VERBATIM — needed to probe traversal
 *  forms that `new URL()` in fetch would normalize away before they leave. */
function rawRequest(rawPath, { method = 'GET', body = null, headers = {}, onPort = port } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      // agent: false — one fresh socket per request, so parallel probes are
      // really parallel (a shared keep-alive socket would serialize them)
      { host: '127.0.0.1', port: onPort, path: rawPath, method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

const waitFor = async (predicate, ms = 3000, step = 50) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return predicate();
};

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

test('GET /api/tree lists only .deck.md files, pruned and filtered', async () => {
  const { status, body } = await getJson('/api/tree');
  assert.equal(status, 200);
  assert.equal(body.root, 'workspace');
  assert.ok(!body.truncated, 'the small fixture is never truncated');

  const names = body.entries.map((e) => e.name);
  assert.ok(names.includes('a.deck.md'), 'root decks are listed');
  assert.ok(names.includes('sub'), 'directories holding decks are listed');
  assert.ok(!names.includes('notes.md'), 'non-deck files are invisible');
  assert.ok(!names.includes('empty-dir'), 'deckless directories are pruned');
  assert.ok(!names.includes('node_modules'), 'node_modules is invisible');
  assert.ok(!names.includes('.hidden'), 'hidden entries are invisible');

  const sub = body.entries.find((e) => e.name === 'sub');
  assert.equal(sub.type, 'dir');
  assert.ok(!sub.children.some((e) => e.name === 'layouts'), 'sub/layouts holds no deck: pruned');
  const b = sub.children.find((e) => e.name === 'b.deck.md');
  assert.deepEqual(b, { name: 'b.deck.md', path: 'sub/b.deck.md', type: 'deck' });
  const deep = sub.children.find((e) => e.name === 'deep');
  assert.equal(deep.children[0].path, 'sub/deep/c.deck.md', 'paths are root-relative POSIX');
});

test('GET /api/tree — a cycle of symlinked directories cannot hang the walk', async (t) => {
  // its own root: the cycle must face the walk from the very first request.
  // Seven links per level pointing back up — without a visited set the walk
  // multiplies by seven at every one of its 12 depths (~10^10 readdirs, a
  // frozen server); with it, each real directory is entered exactly once.
  // ONE hook, closing before deleting — see the note on hook order above.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-cycle-'));
  let srv;
  t.after(async () => {
    await srv?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const cycRoot = path.join(dir, 'root');
  fs.mkdirSync(path.join(cycRoot, 'a'), { recursive: true });
  for (let i = 0; i < 6; i++) fs.symlinkSync(cycRoot, path.join(cycRoot, 'a', `up${i}`));
  fs.symlinkSync(path.join(cycRoot, 'a'), path.join(cycRoot, 'a', 'self'));

  srv = await startDeckEditServer(cycRoot, { port: 0 });
  const started = Date.now();
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/tree`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(Date.now() - started < 2000, 'the cyclic walk answers, fast');
  assert.deepEqual(body.entries, [], 'no deck anywhere: everything pruned');
});

test('GET /api/tree — the budget counts entries VISITED, not entries retained', async (t) => {
  // 5050 files the tree keeps NONE of: a budget charged only on retained
  // entries would sail past its cap without ever noticing, and a giant
  // deckless directory would be walked to the end without saying so
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-budget-'));
  let srv;
  t.after(async () => {
    await srv?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const bigRoot = path.join(dir, 'root');
  fs.mkdirSync(bigRoot);
  fs.writeFileSync(path.join(bigRoot, '0first.deck.md'), '# First\n\nkept.\n');
  for (let i = 0; i < 5050; i++)
    fs.writeFileSync(path.join(bigRoot, `f${String(i).padStart(4, '0')}.txt`), '');

  srv = await startDeckEditServer(bigRoot, { port: 0 });
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/tree`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.truncated, true, 'a walk visiting 5051 entries is over budget');
  assert.deepEqual(
    body.entries.map((e) => e.name),
    ['0first.deck.md'],
    'what was seen before the cap survives',
  );
});

// ---------------------------------------------------------------------------
// deck read
// ---------------------------------------------------------------------------

test('GET /api/deck answers slices, version, capabilities and diagnostics', async () => {
  const { status, body } = await getJson('/api/deck?path=a.deck.md');
  assert.equal(status, 200);
  assert.equal(body.path, 'a.deck.md');
  assert.match(body.version, /^[0-9a-f]{16}$/);
  assert.equal(body.version, sha16(DECK_A), 'the version is the sha256-16 of the disk content');
  assert.equal(body.meta.title, 'Fixture A');
  assert.equal(body.sliceable, true);
  assert.equal(body.sceneOffset, 1, 'the frontmatter title inserts an implicit cover scene');
  assert.equal(body.slides.length, 3);

  const [one, two, three] = body.slides;
  assert.equal(one.title, 'One');
  assert.equal(one.layout, null);
  assert.equal(one.inferredLayout, 'cover', 'a first slide of plain text infers cover');
  assert.equal(one.startLine, 5);
  assert.equal(one.source, '# One\n\nIntro text for the first slide.');
  assert.equal(
    DECK_A.split('\n')
      .slice(one.startLine - 1, one.endLine)
      .join('\n'),
    one.source,
    'the announced lines really are the slice',
  );

  assert.equal(two.title, 'Two');
  assert.equal(two.layout, 'two-columns', 'the explicit directive is reported');
  assert.ok(two.source.startsWith('<!-- layout: two-columns -->'), 'the directive is in the slice');
  assert.equal(two.parts.layout, 'two-columns');
  assert.deepEqual(
    two.parts.sections.map((s) => s.heading),
    ['Left', 'Right'],
  );

  assert.equal(three.title, 'Three');
  assert.equal(three.inferredLayout, 'content');
  assert.ok(three.parts, 'a plain bullets slide is form-editable');

  const caps = body.capabilities;
  assert.ok(caps.layouts.includes('content') && caps.layouts.includes('two-columns'));
  assert.ok(Array.isArray(caps.officialLayouts) && caps.officialLayouts.length > 0);
  assert.deepEqual(caps.userLayouts, [], 'no layouts/ directory next to a.deck.md');
  assert.ok(caps.layoutParams.grid?.headed, 'built-in generator params are published');
  assert.deepEqual(caps.layoutSections['two-columns'], { min: 2, max: 2 });
  assert.ok(Array.isArray(body.diagnostics));
});

test('GET /api/deck resolves capabilities against the DECK’s directory', async () => {
  const { status, body } = await getJson(`/api/deck?path=${encodeURIComponent('sub/b.deck.md')}`);
  assert.equal(status, 200);
  assert.ok(
    body.capabilities.userLayouts.some((l) => l.name === 'local-note'),
    'sub/layouts/local-note.json belongs to sub/b.deck.md’s catalog',
  );
  assert.equal(body.sceneOffset, 0, 'no frontmatter title: no implicit cover');
});

test('GET /api/deck — a Marp deck is view-only: sliceable false, no slides', async () => {
  const { status, body } = await getJson('/api/deck?path=marp.deck.md');
  assert.equal(status, 200);
  assert.equal(body.sliceable, false);
  assert.deepEqual(body.slides, []);
  assert.equal(body.sceneOffset, 0, 'for Marp, title: is HTML metadata — no implicit cover');
});

test('GET /api/deck refuses a missing path, a non-deck file, an absent file', async () => {
  assert.equal((await getJson('/api/deck')).status, 400);
  assert.equal((await getJson('/api/deck?path=notes.md')).status, 404);
  assert.equal((await getJson('/api/deck?path=ghost.deck.md')).status, 404);
});

// ---------------------------------------------------------------------------
// compile
// ---------------------------------------------------------------------------

test('POST /api/compile compiles the disk file to fragments + css + page', async () => {
  const { status, body } = await sendJson('/api/compile', 'POST', { path: 'a.deck.md' });
  assert.equal(status, 200);
  assert.equal(body.sceneOffset, 1, 'the frontmatter title inserts an implicit cover scene');
  assert.equal(
    body.slides.length,
    3 + body.sceneOffset,
    'fragment k of the compile is slice k − sceneOffset',
  );
  assert.ok(body.slides.every((s) => s.length > 0));
  assert.ok(body.css.length > 0, 'the stylesheet travels with the fragments');
  assert.equal(typeof body.fontsCss, 'string');
  assert.deepEqual(body.page, { width: 1280, height: 720 });
  assert.ok(Array.isArray(body.diagnostics));
  assert.ok(body.stats, 'stats travel like the kit editor’s');
});

test('POST /api/compile with an edit body previews the spliced slide, disk untouched', async () => {
  // D2: the client sends the slide, never the reconstructed file — the
  // server re-reads the disk, splices, compiles the result
  const { status, body } = await sendJson('/api/compile', 'POST', {
    path: 'sub/b.deck.md',
    index: 0,
    source: '# Edited\n\nThe zanzibar word proves the splice.\n',
    baseVersion: sha16(DECK_B),
  });
  assert.equal(status, 200);
  assert.ok(body.slides.join('').includes('zanzibar'), 'the fragments show the working state');
  assert.equal(body.sceneOffset, 0, 'no frontmatter title: no implicit cover');
  assert.equal(fs.readFileSync(path.join(root, 'sub', 'b.deck.md'), 'utf8'), DECK_B);
});

test('POST /api/compile with a stale baseVersion is a 409 conflict, nothing compiled', async () => {
  const { status, body } = await sendJson('/api/compile', 'POST', {
    path: 'sub/b.deck.md',
    index: 0,
    source: '# Edited\n\nnever compiled',
    baseVersion: 'deadbeefdeadbeef',
  });
  assert.equal(status, 409);
  assert.equal(body.error, 'conflict');
});

test('POST /api/compile — a splice the guards cannot prove safe is a 422 boundary', async () => {
  // `title: X` at slice 0 of a file opening on `---`: the respliced source
  // wakes up with a frontmatter — the preview must show the ERROR a save
  // would raise, never the corrupted state
  const { status, body } = await sendJson('/api/compile', 'POST', {
    path: 'net.deck.md',
    index: 0,
    source: 'title: X',
    baseVersion: sha16(DECK_NET),
  });
  assert.equal(status, 422);
  assert.equal(body.error, 'boundary');
});

test('POST /api/compile is latest-wins: overtaken requests answer 409 superseded', async () => {
  // six compiles fired in one burst, each on its OWN socket (fetch reuses a
  // keep-alive connection and would serialize them on the wire before the
  // server ever saw a race). The first job's pre-ticket pause (the server's
  // COMPILE_YIELD_MS) lets the whole burst claim its tickets; when each turn
  // comes, only the NEWEST ticket compiles — the rest are refused WITHOUT
  // compiling.
  const payload = JSON.stringify({ path: 'a.deck.md' });
  const burst = await Promise.all(
    Array.from({ length: 6 }, () =>
      rawRequest('/api/compile', {
        method: 'POST',
        body: payload,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }),
    ),
  );
  const winners = burst.filter((r) => r.status === 200);
  const losers = burst.filter((r) => r.status === 409);
  assert.equal(winners.length, 1, 'exactly one compile of the burst is the newest');
  assert.equal(losers.length, 5, 'every overtaken compile is refused');
  assert.ok(
    losers.every((r) => JSON.parse(r.body).error === 'superseded'),
    'the refusal names its cause',
  );
});

test('POST /api/compile — latest-wins is PER FILE: two decks never supersede each other', async () => {
  // three rounds of a simultaneous pair, each request on its own socket:
  // under a single global ticket the later deck of a pair overtook the
  // earlier one ACROSS FILES, and one of the two answered 409 for no reason
  for (let round = 0; round < 3; round++) {
    const pair = await Promise.all(
      ['a.deck.md', 'sub/b.deck.md'].map((p) => {
        const payload = JSON.stringify({ path: p });
        return rawRequest('/api/compile', {
          method: 'POST',
          body: payload,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        });
      }),
    );
    assert.deepEqual(
      pair.map((r) => r.status),
      [200, 200],
      `round ${round}: a compile of one deck must never supersede the other's`,
    );
  }
});

test('POST /api/compile — the edit form travels whole or not at all, on a real deck', async () => {
  const version = sha16(DECK_B);
  // a partial edit body is a client bug: refused, never guessed at
  const partials = [
    { path: 'sub/b.deck.md', source: '# S' }, // source without index
    { path: 'sub/b.deck.md', index: 0 }, // index without source
    { path: 'sub/b.deck.md', index: 0, source: '# S' }, // no baseVersion
    { path: 'sub/b.deck.md', index: 0, source: 42, baseVersion: version },
    { path: 'sub/b.deck.md', index: -1, source: '# S', baseVersion: version },
    { path: 'sub/b.deck.md', index: 99, source: '# S', baseVersion: version },
  ];
  for (const payload of partials) {
    const { status } = await sendJson('/api/compile', 'POST', payload);
    assert.equal(status, 400, JSON.stringify(payload));
  }

  const marp = await sendJson('/api/compile', 'POST', {
    path: 'marp.deck.md',
    index: 0,
    source: '# X',
    baseVersion: sha16(DECK_MARP),
  });
  assert.equal(marp.status, 400, 'a non-sliceable deck cannot be spliced, even for a preview');
  assert.match(marp.body.error, /not sliceable/);

  assert.equal((await sendJson('/api/compile', 'POST', { path: 'notes.md' })).status, 404);
  assert.equal((await sendJson('/api/compile', 'POST', {})).status, 400);
});

// ---------------------------------------------------------------------------
// slide write
// ---------------------------------------------------------------------------

test('PUT /api/slide splices ONE slide and leaves the rest byte for byte', async () => {
  const baseVersion = sha16(DECK_A);
  const { status, body } = await sendJson('/api/slide', 'PUT', {
    path: 'a.deck.md',
    index: 1,
    source: '# Two\n\nJust a paragraph now.',
    baseVersion,
  });
  assert.equal(status, 200);

  const onDisk = fs.readFileSync(path.join(root, 'a.deck.md'), 'utf8');
  assert.equal(body.version, sha16(onDisk), 'the answered version is the new disk version');
  assert.notEqual(body.version, baseVersion);
  assert.equal(body.sliceable, true);
  assert.equal(body.slides.length, 3, 'the answer carries the NEW slicing, whole');
  assert.equal(body.slides[1].title, 'Two');
  assert.equal(body.slides[1].source, '# Two\n\nJust a paragraph now.');

  // the edited slide changed; everything around it did not move a byte
  // slide 1 owns lines 11..21 (directive included, `beta` last): 11 lines out
  const expected = (() => {
    const lines = DECK_A.split('\n');
    lines.splice(10, 11, ...'# Two\n\nJust a paragraph now.'.split('\n'));
    return lines.join('\n');
  })();
  assert.equal(onDisk, expected, 'the write is a pure line splice');
  assert.ok(!onDisk.includes('alpha'), 'the old slide body is gone');
  assert.ok(onDisk.includes('# One') && onDisk.includes('# Three'));

  // and the next read agrees with the write's answer
  const reread = await getJson('/api/deck?path=a.deck.md');
  assert.equal(reread.body.version, body.version);
});

test('PUT /api/slide — a stale baseVersion is a 409 conflict, nothing written', async () => {
  const before = fs.readFileSync(path.join(root, 'a.deck.md'), 'utf8');
  const { status, body } = await sendJson('/api/slide', 'PUT', {
    path: 'a.deck.md',
    index: 0,
    source: '# Clobbered',
    baseVersion: sha16(DECK_A), // the version BEFORE the previous test's write
  });
  assert.equal(status, 409);
  assert.equal(body.error, 'conflict');
  assert.equal(fs.readFileSync(path.join(root, 'a.deck.md'), 'utf8'), before);
});

test('PUT /api/slide — out-of-bounds index, bad body, non-deck target', async () => {
  const version = sha16(fs.readFileSync(path.join(root, 'a.deck.md'), 'utf8'));
  const outOfBounds = await sendJson('/api/slide', 'PUT', {
    path: 'a.deck.md',
    index: 99,
    source: '# X',
    baseVersion: version,
  });
  assert.equal(outOfBounds.status, 400);
  assert.match(outOfBounds.body.error, /out of bounds/);

  const negative = await sendJson('/api/slide', 'PUT', {
    path: 'a.deck.md',
    index: -1,
    source: '# X',
    baseVersion: version,
  });
  assert.equal(negative.status, 400);

  const noSource = await sendJson('/api/slide', 'PUT', {
    path: 'a.deck.md',
    index: 0,
    baseVersion: version,
  });
  assert.equal(noSource.status, 400);

  const noVersion = await sendJson('/api/slide', 'PUT', {
    path: 'a.deck.md',
    index: 0,
    source: '# X',
  });
  assert.equal(noVersion.status, 400);

  const notADeck = await sendJson('/api/slide', 'PUT', {
    path: 'notes.md',
    index: 0,
    source: '# X',
    baseVersion: 'whatever',
  });
  assert.equal(notADeck.status, 404);

  const marp = await sendJson('/api/slide', 'PUT', {
    path: 'marp.deck.md',
    index: 0,
    source: '# X',
    baseVersion: sha16(DECK_MARP),
  });
  assert.equal(marp.status, 400, 'a non-sliceable deck cannot be spliced');
  assert.match(marp.body.error, /not sliceable/);
});

test('PUT /api/slide guards the weld: the bare --- below the slice survives', async () => {
  // the review's corruption #0 replayed over HTTP: the edited slide ends on
  // ink and the glue below is a bare rule with no blank line between — a
  // naive splice would weld them into a setext H2 and melt the two slides
  const { status, body } = await sendJson('/api/slide', 'PUT', {
    path: 'weld.deck.md',
    index: 0,
    source: '# One\n\n- a\n- b\n\nClosing thought',
    baseVersion: sha16(DECK_WELD),
  });
  assert.equal(status, 200);
  const onDisk = fs.readFileSync(path.join(root, 'weld.deck.md'), 'utf8');
  assert.match(onDisk, /Closing thought\n\n---\n/, 'a blank line keeps the rule bare');
  assert.equal(body.slides.length, 2, 'the two slides never melted into one');
  assert.equal(body.slides[1].source, '## Next steps\n\ncontent', 'the neighbour is untouched');
});

test('PUT /api/slide — a weld past the guards is a 422 boundary, nothing written', async () => {
  // yaml-looking text at slice 0 of a file OPENING on `---`: the respliced
  // file wakes up with a frontmatter. spliceSlice cannot see it (the line
  // above the slice is blank, no guard fires) — the post-splice net, which
  // reslices and compares frontmatter and out-of-slice sources, must.
  const { status, body } = await sendJson('/api/slide', 'PUT', {
    path: 'net.deck.md',
    index: 0,
    source: 'title: X',
    baseVersion: sha16(DECK_NET),
  });
  assert.equal(status, 422);
  assert.equal(body.error, 'boundary');
  assert.equal(
    fs.readFileSync(path.join(root, 'net.deck.md'), 'utf8'),
    DECK_NET,
    'a boundary refusal writes NOTHING',
  );
});

// ---------------------------------------------------------------------------
// path confinement (probed with a raw client: fetch normalizes traversals away)
// ---------------------------------------------------------------------------

test('reads refuse traversal, absolute and backslash paths — the secret stays put', async () => {
  const probes = [
    '/api/deck?path=..%2Foutside.deck.md',
    '/api/deck?path=..%2F..%2Foutside.deck.md',
    `/api/deck?path=${encodeURIComponent(path.join(tmp, 'outside.deck.md'))}`,
    '/api/deck?path=..%5Coutside.deck.md',
    '/api/deck?path=sub%2F..%2F..%2Foutside.deck.md',
  ];
  for (const probe of probes) {
    const r = await rawRequest(probe);
    assert.ok(r.status >= 400 && r.status < 500, `${probe} → ${r.status}`);
    assert.ok(!r.body.includes('TOP-SECRET'), `${probe} must not leak the outside deck`);
  }
});

test('writes refuse traversal — nothing outside the root is touched', async () => {
  const outsideBefore = fs.readFileSync(path.join(tmp, 'outside.deck.md'), 'utf8');
  const payload = JSON.stringify({
    path: '../outside.deck.md',
    index: 0,
    source: '# pwned',
    baseVersion: sha16(outsideBefore),
  });
  const r = await rawRequest('/api/slide', {
    method: 'PUT',
    body: payload,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
  assert.equal(
    fs.readFileSync(path.join(tmp, 'outside.deck.md'), 'utf8'),
    outsideBefore,
    'the outside file was left untouched',
  );
});

test('a deck literally named a%20b.deck.md is addressed verbatim — no double decode', async () => {
  // the query string is decoded ONCE by the URL parser: `a%2520b` on the
  // wire names the percent file, `a%20b` names the space file — a second
  // server-side decode would collapse the two
  const literal = await getJson(`/api/deck?path=${encodeURIComponent('a%20b.deck.md')}`);
  assert.equal(literal.status, 200);
  assert.equal(literal.body.slides[0].title, 'Percent');

  const spaced = await getJson(`/api/deck?path=${encodeURIComponent('a b.deck.md')}`);
  assert.equal(spaced.status, 200);
  assert.equal(spaced.body.slides[0].title, 'Space');

  // a PUT names the percent file in its JSON body (never percent-encoded):
  // with a double decode the write would land on the space-named neighbour
  const put = await sendJson('/api/slide', 'PUT', {
    path: 'a%20b.deck.md',
    index: 0,
    source: '# Percent\n\nrewritten body',
    baseVersion: literal.body.version,
  });
  assert.equal(put.status, 200);
  assert.match(fs.readFileSync(path.join(root, 'a%20b.deck.md'), 'utf8'), /rewritten body/);
  assert.equal(
    fs.readFileSync(path.join(root, 'a b.deck.md'), 'utf8'),
    DECK_SPACE,
    'the space-named neighbour was not touched',
  );
});

test('an escaping symlink is invisible to the tree and refused by both gates', async (t) => {
  // a second server on its own root: the symlink lives there from the start,
  // so the tree walk, the read gate and the write gate all face it
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-deck-leak-'));
  let srv;
  t.after(async () => {
    await srv?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const leakRoot = path.join(dir, 'root');
  fs.mkdirSync(leakRoot);
  fs.writeFileSync(path.join(leakRoot, 'real.deck.md'), '# Real\n\nInside.\n');
  fs.writeFileSync(path.join(dir, 'target.deck.md'), '# TOP-SECRET target\n');
  fs.symlinkSync(path.join(dir, 'target.deck.md'), path.join(leakRoot, 'leak.deck.md'));

  srv = await startDeckEditServer(leakRoot, { port: 0 });
  const leakBase = `http://127.0.0.1:${srv.port}`;

  const tree = await (await fetch(`${leakBase}/api/tree`)).json();
  assert.deepEqual(
    tree.entries.map((e) => e.name),
    ['real.deck.md'],
    'the escaping symlink appears nowhere',
  );

  const read = await fetch(`${leakBase}/api/deck?path=leak.deck.md`);
  assert.equal(read.status, 404, 'lexically clean, refused by realpath');
  assert.ok(!(await read.text()).includes('TOP-SECRET'));

  const write = await fetch(`${leakBase}/api/slide`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'leak.deck.md',
      index: 0,
      source: '# pwned',
      baseVersion: sha16('# TOP-SECRET target\n'),
    }),
  });
  assert.equal(write.status, 404);
  assert.equal(
    fs.readFileSync(path.join(dir, 'target.deck.md'), 'utf8'),
    '# TOP-SECRET target\n',
    'the symlink target was not written through',
  );
});

// ---------------------------------------------------------------------------
// origin and host gates
// ---------------------------------------------------------------------------

test('a foreign Origin on a mutating request is refused; the editor origin and curl pass', async () => {
  const evil = await sendJson(
    '/api/compile',
    'POST',
    { path: 'a.deck.md' },
    { Origin: 'http://evil.example' },
  );
  assert.equal(evil.status, 403);

  const own = await sendJson(
    '/api/compile',
    'POST',
    { path: 'a.deck.md' },
    { Origin: `http://127.0.0.1:${port}` },
  );
  assert.equal(own.status, 200, 'the editor page itself is allowed');
  // requests WITHOUT Origin pass throughout this file — every other test is
  // the curl case
});

test('a non-local Host header is refused (DNS rebinding guard)', async () => {
  const r = await rawRequest('/api/tree', { headers: { Host: 'evil.example' } });
  assert.equal(r.status, 403);
  assert.match(r.body, /only answers to localhost/);
});

// ---------------------------------------------------------------------------
// static side and /fonts alias
// ---------------------------------------------------------------------------

test('the static side serves the SPA, and only the SPA', async () => {
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  assert.ok((await index.text()).length > 0);

  const js = await fetch(`${base}/js/api.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /text\/javascript/);

  // traversal out of the UI directory, sent verbatim
  const breakout = await rawRequest('/..%2F..%2Fpackage.json');
  assert.ok(breakout.status >= 400 && breakout.status < 500, `got ${breakout.status}`);
});

test('GET /fonts serves the chrome woff2, whitelisted and inert', async () => {
  const font = await fetch(`${base}/fonts/Fraunces-400_700.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.ok((await font.arrayBuffer()).byteLength > 0);

  const license = await fetch(`${base}/fonts/LICENSE.txt`);
  assert.equal(license.status, 404, 'only font extensions pass the whitelist');

  const traversal = await rawRequest('/fonts/..%2F..%2Fthemes%2Fdefault.json');
  assert.ok(traversal.status >= 400 && traversal.status < 500, `got ${traversal.status}`);
});

// ---------------------------------------------------------------------------
// SSE watcher
// ---------------------------------------------------------------------------

/** Subscribes to /__events and keeps the raw frames — path payloads matter. */
function subscribe() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__events' }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        text += c;
      });
      resolve({
        count: () => (text.match(/event: deck-changed/g) ?? []).length,
        frames: () => text,
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

/** Waits until the stream has been QUIET for a while: earlier tests touched
 *  the tree from outside the API, and FSEvents can deliver those with
 *  hundreds of ms of latency — nothing stale must be pinned on the write
 *  under test (timing-tolerant by design). */
function settle(seen) {
  let quietSince = Date.now();
  let last = seen.count();
  return waitFor(
    () => {
      if (seen.count() !== last) {
        last = seen.count();
        quietSince = Date.now();
      }
      return Date.now() - quietSince >= 800;
    },
    6000,
    100,
  );
}

test('SSE: an external deck change emits deck-changed with its path; a server write does not', async () => {
  const seen = await subscribe(); // subscribe first, so nothing is missed

  try {
    await settle(seen);

    // server write → suppressed (observe for a while, the count must not move)
    const before = seen.count();
    const deck = await getJson('/api/deck?path=a.deck.md');
    const slide0 = deck.body.slides[0];
    const saved = await sendJson('/api/slide', 'PUT', {
      path: 'a.deck.md',
      index: 0,
      source: slide0.source, // identity splice: content preserved for later tests
      baseVersion: deck.body.version,
    });
    assert.equal(saved.status, 200);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(seen.count(), before, 'the server’s own write must not echo back');

    // external edit → one event carrying the file's rel path. A DIFFERENT
    // deck than the one just saved: the suppression window is per path, and
    // a sibling's external change must keep its event (kit editor's rule)
    const cPath = path.join(root, 'sub', 'deep', 'c.deck.md');
    fs.writeFileSync(cPath, fs.readFileSync(cPath, 'utf8'));
    assert.ok(
      await waitFor(() => seen.count() > before),
      'an external change must emit deck-changed',
    );
    assert.match(
      seen.frames(),
      /data: \{"path":"sub\/deep\/c\.deck\.md"\}/,
      'the event names the file',
    );

    // a non-deck file moves → nothing (the watcher filters on .deck.md)
    const after = seen.count();
    fs.writeFileSync(path.join(root, 'notes.md'), '# still not a deck\n');
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(seen.count(), after, 'non-deck changes are not broadcast');
  } finally {
    seen.close();
  }
});

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

test('a start whose listen fails leaves nothing holding the event loop', async () => {
  // the observable damage is "the process never exits" (an embedder retrying
  // on another port leaks one recursive watcher per attempt, and the caller
  // gets no close() to release it) — so the test runs it in a subprocess and
  // requires that subprocess to exit on its own
  const script = [
    "import assert from 'node:assert/strict';",
    `import { startDeckEditServer } from ${JSON.stringify(SERVER_MODULE)};`,
    `await assert.rejects(() => startDeckEditServer(${JSON.stringify(root)}, { port: -1 }));`,
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => {
    stderr += c;
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('hung');
    }, 10000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    child.on('error', reject);
  });
  assert.equal(code, 0, `the process must exit once the start has failed — ${stderr}`);
});
