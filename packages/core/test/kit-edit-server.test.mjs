/**
 * `lutrin kit edit` server — startKitEditServer(kitDir, { port }) exercised
 * over real HTTP on an ephemeral port, against a fixture kit on disk.
 *
 * Under test: the JSON API (state, compile with and without overlay, theme
 * and layout writes), the upload gates (magic bytes, extensions, aliases),
 * the read confinement (/api/files), the Origin gate, the export round-trip
 * and the SSE watcher with auto-write suppression. The tests run in source
 * order against ONE server: each states what it relies on.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startKitEditServer } from '../src/kit/edit-server.mjs';
import { readKitArchive, sha256 } from '../src/kit/archive.mjs';

const SERVER_MODULE = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'kit', 'edit-server.mjs'),
).href;

// 1×1 transparent PNG — a real image, tiny enough to inline in the test
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_URI = `data:image/png;base64,${PNG_1PX.toString('base64')}`;

let tmp; // holds the kit AND the outside-the-kit secret
let kit;
let server;
let port;
let base;
let close;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-edit-'));
  kit = path.join(tmp, 'fixture-kit');
  fs.mkdirSync(path.join(kit, 'images'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.json'), JSON.stringify({ name: 'fixture-kit' }));
  fs.writeFileSync(
    path.join(kit, 'theme.json'),
    JSON.stringify({ name: 'Fixture', images: { 'hero-photo': './images/hero.png' } }),
  );
  fs.writeFileSync(path.join(kit, 'images', 'hero.png'), PNG_1PX);
  fs.writeFileSync(path.join(kit, 'images', 'spare.png'), PNG_1PX); // referenced by nothing
  fs.writeFileSync(
    path.join(kit, 'layouts', 'fix-note.json'),
    JSON.stringify({ name: 'fix-note', base: 'content' }),
  );
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside the kit');

  ({ server, port, close } = await startKitEditServer(kit, { port: 0 }));
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
const sendRaw = async (p, method, buf) => {
  const r = await fetch(`${base}${p}`, { method, body: buf });
  return { status: r.status, body: await r.json() };
};

/** The Node http client sends the path VERBATIM — needed to probe traversal
 *  forms that `new URL()` in fetch would normalize away before they leave. */
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
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
// state
// ---------------------------------------------------------------------------

test('GET /api/state describes the whole kit', async () => {
  const { status, body } = await getJson('/api/state');
  assert.equal(status, 200);
  assert.equal(body.name, 'fixture-kit');
  assert.equal(body.manifest.name, 'fixture-kit');
  assert.equal(body.themeExists, true);
  assert.equal(body.theme.name, 'Fixture', 'the theme comes back AS WRITTEN');
  assert.equal(body.themeAnchor, 'theme.json');
  assert.deepEqual(
    body.layouts.map((l) => l.name),
    ['fix-note'],
  );
  assert.equal(body.layouts[0].file, 'layouts/fix-note.json');
  assert.equal(body.layouts[0].def.base, 'content');
  assert.deepEqual(body.fonts, { files: [], pairs: [] });
  const hero = body.images.find((i) => i.alias === 'hero-photo');
  assert.ok(hero?.exists && hero.bytes > 0 && hero.ext === '.png');
  assert.deepEqual(body.orphans, ['images/spare.png'], 'unreferenced images/ files are listed');
  assert.ok(body.capabilities.reservedNames.includes('content'), 'built-ins are reserved');
  assert.ok(body.capabilities.reservedNames.includes('pros-cons'), 'officials are reserved');
  const grid = body.capabilities.bases.find((b) => b.name === 'grid');
  assert.ok(grid?.builtin && grid.paramSchema.headed, 'bases publish their paramSchema');
  assert.equal(body.defaults.colors.primary, '1D4ED8', 'defaults mirror design/themes');
  assert.match(body.version, /^\d+\.\d+\.\d+/);
});

// ---------------------------------------------------------------------------
// compile
// ---------------------------------------------------------------------------

test('POST /api/compile with an empty body compiles the specimen deck', async () => {
  const { status, body } = await sendJson('/api/compile', 'POST', {});
  assert.equal(status, 200);
  assert.ok(body.slides.length > 0, 'the specimen produces slides');
  assert.ok(body.css.length > 0, 'the stylesheet travels with the fragments');
  assert.equal(body.slideMap.length, body.slides.length);
  assert.equal(body.animSteps.length, body.slides.length);
  assert.ok(
    !body.diagnostics.some((d) => d.severity === 'error'),
    `specimen must compile without errors — got ${JSON.stringify(body.diagnostics)}`,
  );
});

test('POST /api/compile with a theme overlay: the color shows, the disk is untouched', async () => {
  const { status, body } = await sendJson('/api/compile', 'POST', {
    theme: { colors: { primary: '445566' } },
  });
  assert.equal(status, 200);
  assert.ok(body.css.includes('#445566'), 'the overlay color reaches the stylesheet');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(kit, 'theme.json'), 'utf8')).name,
    'Fixture',
    'the overlay writes nothing to disk',
  );
});

// ---------------------------------------------------------------------------
// theme writes
// ---------------------------------------------------------------------------

test('PUT /api/theme writes pretty JSON and returns the overlay diagnostics', async () => {
  const theme = { name: 'Edited', colors: { primary: 'nope' } };
  const { status, body } = await sendJson('/api/theme', 'PUT', { theme });
  assert.equal(status, 200);
  assert.equal(body.file, 'theme.json');
  assert.ok(
    body.diagnostics.some((d) => d.code === 'THEME_BAD_VALUE'),
    'the broken hex is reported by the same validation a compile runs',
  );
  assert.equal(
    fs.readFileSync(path.join(kit, 'theme.json'), 'utf8'),
    `${JSON.stringify(theme, null, 2)}\n`,
    '2-space indentation, trailing newline',
  );
  // restore the fixture theme for the tests below
  await sendJson('/api/theme', 'PUT', {
    theme: { name: 'Fixture', images: { 'hero-photo': './images/hero.png' } },
  });
});

test('PUT /api/theme refuses a non-object', async () => {
  const { status, body } = await sendJson('/api/theme', 'PUT', { theme: [1, 2] });
  assert.equal(status, 422);
  assert.match(body.error, /JSON object/);
});

// ---------------------------------------------------------------------------
// manifest writes
// ---------------------------------------------------------------------------

test('PUT /api/manifest updates the display metadata and preserves every other key', async () => {
  // a foreign key on disk must survive the round-trip untouched
  fs.writeFileSync(
    path.join(kit, 'kit.json'),
    JSON.stringify({ name: 'fixture-kit', theme: './theme.json', 'x-custom': true }),
  );
  const { status, body } = await sendJson('/api/manifest', 'PUT', {
    manifest: {
      version: '2.1.0',
      description: 'A fixture',
      author: 'Test',
      homepage: 'https://example.test',
    },
  });
  assert.equal(status, 200);
  assert.equal(body.file, 'kit.json');
  assert.equal(body.manifest.version, '2.1.0');
  const onDisk = JSON.parse(fs.readFileSync(path.join(kit, 'kit.json'), 'utf8'));
  assert.equal(onDisk.name, 'fixture-kit', 'the name is untouched');
  assert.equal(onDisk.theme, './theme.json', 'non-editable keys travel through');
  assert.equal(onDisk['x-custom'], true, 'unknown keys travel through');
  assert.equal(onDisk.description, 'A fixture');

  // an empty value removes the key
  const cleared = await sendJson('/api/manifest', 'PUT', { manifest: { homepage: '' } });
  assert.equal(cleared.status, 200);
  assert.ok(!('homepage' in JSON.parse(fs.readFileSync(path.join(kit, 'kit.json'), 'utf8'))));
});

test('PUT /api/manifest — the name is locked, bad values and foreign keys are refused', async () => {
  const before = fs.readFileSync(path.join(kit, 'kit.json'), 'utf8');

  const renamed = await sendJson('/api/manifest', 'PUT', { manifest: { name: 'other-kit' } });
  assert.equal(renamed.status, 400);
  assert.match(renamed.body.error, /install identity/);

  const badVersion = await sendJson('/api/manifest', 'PUT', { manifest: { version: 'two' } });
  assert.equal(badVersion.status, 422);
  assert.match(badVersion.body.error, /version/);

  const foreign = await sendJson('/api/manifest', 'PUT', { manifest: { theme: './evil.json' } });
  assert.equal(foreign.status, 400);
  assert.match(foreign.body.error, /cannot be edited here/);

  assert.equal(
    fs.readFileSync(path.join(kit, 'kit.json'), 'utf8'),
    before,
    'a refused update writes nothing',
  );

  // sending the CURRENT name alongside editable fields is fine (echo of state)
  const echo = await sendJson('/api/manifest', 'PUT', {
    manifest: { name: 'fixture-kit', version: '2.2.0' },
  });
  assert.equal(echo.status, 200);
});

test('PUT /api/manifest — an unreadable kit.json is a 409, not a blind write', async () => {
  const before = fs.readFileSync(path.join(kit, 'kit.json'), 'utf8');
  fs.writeFileSync(path.join(kit, 'kit.json'), 'not json at all');
  const { status, body } = await sendJson('/api/manifest', 'PUT', {
    manifest: { version: '3.0.0' },
  });
  assert.equal(status, 409);
  assert.match(body.error, /fix it on disk/);
  fs.writeFileSync(path.join(kit, 'kit.json'), before); // restore the fixture
});

// ---------------------------------------------------------------------------
// layout writes
// ---------------------------------------------------------------------------

test('PUT /api/layouts/<name> writes the definition after overlay validation', async () => {
  const def = { name: 'spec-note', base: 'content', density: 'compact' };
  const { status, body } = await sendJson('/api/layouts/spec-note', 'PUT', { def });
  assert.equal(status, 200);
  assert.equal(body.file, 'layouts/spec-note.json');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(kit, 'layouts', 'spec-note.json'), 'utf8')),
    def,
  );
  // updating the SAME layout must not collide with its own file on disk
  const again = await sendJson('/api/layouts/spec-note', 'PUT', {
    def: { ...def, density: 'dense' },
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));
});

test('PUT /api/layouts/content — collision with a built-in is refused with the registry diagnostic', async () => {
  const { status, body } = await sendJson('/api/layouts/content', 'PUT', {
    def: { name: 'content', base: 'content' },
  });
  assert.equal(status, 422);
  const d = body.diagnostics.find((x) => x.code === 'LAYOUT_DEF_INVALID');
  assert.match(d.message, /already exists \(built-in layout\)/);
  assert.ok(!fs.existsSync(path.join(kit, 'layouts', 'content.json')), 'nothing was written');
});

test('PUT /api/layouts/<name> — an invalid name is refused BEFORE any write, even when the theme is broken', async (t) => {
  // the state one opens the editor to fix: kit.json is fine, theme.json does
  // not parse. The validation used to be delegated to the overlay path, which
  // context.mjs skips when the kit fails to resolve — the verdict came back
  // empty, and the name went straight into a join()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-broken-'));
  // One hook, closing then removing: the server watches `dir` recursively, and
  // a removal registered ahead of the close would run first (hooks are FIFO)
  // and could fail on the handle the watcher holds — after which the close
  // behind it never runs. See the same trap, met for real, in cli.test.mjs.
  const open = [];
  t.after(async () => {
    for (const s of open) await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const broken = path.join(dir, 'nest', 'broken-kit');
  fs.mkdirSync(path.join(broken, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(broken, 'kit.json'), JSON.stringify({ name: 'broken-kit' }));
  fs.writeFileSync(path.join(broken, 'theme.json'), '{\n  "name": "Broken",\n}\n'); // trailing comma
  const srv = await startKitEditServer(broken, { port: 0 });
  open.push(srv);

  // sent verbatim: fetch would normalize the traversal away before it leaves
  const traversal = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      def: { name: '../../../owned', base: 'grid', headed: true },
    });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: srv.port,
        method: 'PUT',
        path: '/api/layouts/..%2F..%2F..%2Fowned',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
  assert.equal(traversal.status, 400, traversal.body);
  assert.match(traversal.body, /is not a valid layout name/);
  for (const up of ['..', '../..', '../../..'])
    assert.ok(
      !fs.existsSync(path.resolve(broken, up, 'owned.json')),
      `nothing may be written outside the kit (${up})`,
    );

  // and the definition itself is still judged: an unusable base is refused
  const junk = await fetch(`http://127.0.0.1:${srv.port}/api/layouts/junk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ def: { name: 'junk', base: 'nope' } }),
  });
  assert.equal(junk.status, 422);
  const diags = (await junk.json()).diagnostics;
  assert.match(
    diags.find((d) => d.code === 'LAYOUT_DEF_INVALID').message,
    /unknown base "nope"/,
    'a broken theme must not silence the layout rules',
  );
  assert.ok(!fs.existsSync(path.join(broken, 'layouts', 'junk.json')), 'nothing was written');
});

test('PUT/DELETE /api/layouts/<name> act on the file the layout REALLY lives in', async () => {
  // a kit is free to name its files: the loader keys layouts by def.name, and
  // /api/state reports the file. Rebuilding `<name>.json` deleted nothing and
  // saved a SECOND definition of the same layout.
  const aliased = path.join(kit, 'layouts', 'brand-note.json');
  fs.writeFileSync(aliased, JSON.stringify({ name: 'aliased-note', base: 'content' }));
  const state = await getJson('/api/state');
  assert.equal(
    state.body.layouts.find((l) => l.name === 'aliased-note').file,
    'layouts/brand-note.json',
  );

  const put = await sendJson('/api/layouts/aliased-note', 'PUT', {
    def: { name: 'aliased-note', base: 'content', density: 'compact' },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.file, 'layouts/brand-note.json', 'the existing file is updated in place');
  assert.equal(
    JSON.parse(fs.readFileSync(aliased, 'utf8')).density,
    'compact',
    'the edit landed in the real file',
  );
  assert.ok(
    !fs.existsSync(path.join(kit, 'layouts', 'aliased-note.json')),
    'no second definition of the same layout',
  );
  // one definition, so the kit still compiles without a duplicate complaint
  const compiled = await sendJson('/api/compile', 'POST', {});
  assert.ok(
    !compiled.body.diagnostics.some((d) => d.code === 'LAYOUT_DEF_INVALID'),
    JSON.stringify(compiled.body.diagnostics),
  );

  const del = await fetch(`${base}/api/layouts/aliased-note`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).deleted, 'layouts/brand-note.json');
  assert.ok(!fs.existsSync(aliased), 'the layout the UI shows is deletable');
});

test('DELETE /api/layouts/<name> removes the file, 404 when absent', async () => {
  const del = await fetch(`${base}/api/layouts/spec-note`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(kit, 'layouts', 'spec-note.json')));
  const gone = await fetch(`${base}/api/layouts/spec-note`, { method: 'DELETE' });
  assert.equal(gone.status, 404);
});

// ---------------------------------------------------------------------------
// uploads
// ---------------------------------------------------------------------------

test('PUT /api/images/<alias>.<ext> accepts a real PNG, and the alias compiles to a data URI', async () => {
  const up = await sendRaw('/api/images/uploaded-shot.png', 'PUT', PNG_1PX);
  assert.equal(up.status, 200);
  assert.equal(up.body.alias, 'uploaded-shot');
  assert.ok(fs.existsSync(path.join(kit, 'images', 'uploaded-shot.png')));

  const { status, body } = await sendJson('/api/compile', 'POST', {
    source: '# Uploaded\n\n![right](kit:uploaded-shot)\n\nText beside the visual.\n',
    theme: { images: { 'uploaded-shot': './images/uploaded-shot.png' } },
  });
  assert.equal(status, 200);
  assert.ok(
    body.slides.join('').includes(PNG_URI),
    'the uploaded image resolves through the overlay and is inlined',
  );
});

test('PUT /api/images — lying magic bytes are refused', async () => {
  const { status, body } = await sendRaw(
    '/api/images/fake-shot.png',
    'PUT',
    Buffer.from('<html>not a png</html>'),
  );
  assert.equal(status, 415);
  assert.match(body.error, /do not look like PNG/);
  assert.ok(!fs.existsSync(path.join(kit, 'images', 'fake-shot.png')));
});

test('PUT /api/images — invalid alias and foreign extension are refused', async () => {
  assert.equal((await sendRaw('/api/images/Bad_Alias.png', 'PUT', PNG_1PX)).status, 400);
  assert.equal((await sendRaw('/api/images/shot.bmp', 'PUT', PNG_1PX)).status, 415);
});

test('PUT /api/fonts — wrong extension and mismatched bytes are refused', async () => {
  const bad = await sendRaw('/api/fonts/Foo.otf', 'PUT', Buffer.from('anything'));
  assert.equal(bad.status, 415);
  assert.match(bad.body.error, /\.ttf with a \.woff2 twin/);

  // the extension promises a format, the first bytes must keep that promise
  const junk = await sendRaw('/api/fonts/Fake.woff2', 'PUT', Buffer.from('GET / HTTP'));
  assert.equal(junk.status, 415);
  assert.match(junk.body.error, /do not look like a woff2 font/);
  assert.ok(!fs.existsSync(path.join(kit, 'fonts', 'Fake.woff2')));

  const misnamed = await sendRaw(
    '/api/fonts/Foo-Regular.woff2',
    'PUT',
    Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('ttf-in-woff2-clothes')]),
  );
  assert.equal(misnamed.status, 415, 'a .ttf renamed .woff2 is refused');

  const ttf = await sendRaw(
    '/api/fonts/Foo-Regular.ttf',
    'PUT',
    Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('rest of the sfnt')]),
  );
  assert.equal(ttf.status, 200, 'the API stores; the PAIR status is /api/state business');
  assert.equal(ttf.body.file, 'fonts/Foo-Regular.ttf');

  const woff2 = await sendRaw(
    '/api/fonts/Foo-Regular.woff2',
    'PUT',
    Buffer.concat([Buffer.from('wOF2'), Buffer.from('rest of the container')]),
  );
  assert.equal(woff2.status, 200);
  assert.equal(woff2.body.file, 'fonts/Foo-Regular.woff2');
});

test('a file referenced by theme.logos is not an orphan', async () => {
  await sendRaw('/api/images/logo-cover.png', 'PUT', PNG_1PX);
  await sendJson('/api/theme', 'PUT', {
    theme: {
      name: 'Fixture',
      images: { 'hero-photo': './images/hero.png' },
      logos: { cover: './images/logo-cover.png' },
    },
  });
  const { body } = await getJson('/api/state');
  assert.ok(body.orphans.includes('images/spare.png'), 'truly unreferenced files stay listed');
  assert.ok(
    !body.orphans.includes('images/logo-cover.png'),
    'a logo the theme points at is referenced, not orphaned',
  );
  // restore the fixture theme and clean the logo up
  await sendJson('/api/theme', 'PUT', {
    theme: { name: 'Fixture', images: { 'hero-photo': './images/hero.png' } },
  });
  assert.equal((await sendRaw('/api/images/logo-cover.png', 'DELETE')).status, 200);
});

test('DELETE /api/images accepts a hand-dropped name the PUT gate would refuse', async () => {
  // "My Photo.PNG" never passed the alias rule, yet the editor must be able
  // to remove it — the DELETE gate only requires a safe basename + image ext
  fs.writeFileSync(path.join(kit, 'images', 'My Photo.PNG'), PNG_1PX);
  const del = await sendRaw(`/api/images/${encodeURIComponent('My Photo.PNG')}`, 'DELETE');
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, 'images/My Photo.PNG');
  assert.ok(!fs.existsSync(path.join(kit, 'images', 'My Photo.PNG')));

  // what makes the join safe still holds
  const traversal = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/images/..%2Fsecret.txt', method: 'DELETE' },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.ok(traversal >= 400 && traversal < 500, `got ${traversal}`);
  assert.ok(fs.existsSync(path.join(tmp, 'secret.txt')), 'nothing outside the kit was touched');

  const foreign = await sendRaw('/api/images/notes.txt', 'DELETE');
  assert.equal(foreign.status, 415, 'only image files go through this route');
});

// ---------------------------------------------------------------------------
// read confinement
// ---------------------------------------------------------------------------

test('GET /api/files serves kit files with the right MIME, and nothing outside', async () => {
  const okRes = await fetch(`${base}/api/files/images/hero.png`);
  assert.equal(okRes.status, 200);
  assert.equal(okRes.headers.get('content-type'), 'image/png');
  assert.equal(okRes.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await okRes.arrayBuffer()), PNG_1PX);

  // .. traversal, sent verbatim (fetch would normalize it away)
  const dotdot = await rawGet('/api/files/..%2Fsecret.txt');
  assert.ok(dotdot.status >= 400 && dotdot.status < 500, `got ${dotdot.status}`);
  assert.ok(!dotdot.body.includes('outside the kit'));

  // absolute path
  const absolute = await rawGet(`/api/files/${encodeURIComponent(path.join(tmp, 'secret.txt'))}`);
  assert.ok(absolute.status >= 400 && absolute.status < 500, `got ${absolute.status}`);
  assert.ok(!absolute.body.includes('outside the kit'));

  // symlink pointing out of the kit: lexically clean, refused by realpath
  fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(kit, 'images', 'leak.png'));
  const leak = await rawGet('/api/files/images/leak.png');
  assert.ok(leak.status >= 400 && leak.status < 500, `got ${leak.status}`);
  assert.ok(!leak.body.includes('outside the kit'));
  fs.rmSync(path.join(kit, 'images', 'leak.png'));
});

test('GET /api/files serves kit content INERT — no executable type, and a CSP', async () => {
  // a kit comes from a third party (a clone, a .deckkit) and this route serves
  // it on the origin that owns the write API: an SVG with a <script>, or a
  // docs page, must not become active content there
  fs.writeFileSync(
    path.join(kit, 'images', 'evil.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/theme")</script></svg>',
  );
  fs.writeFileSync(path.join(kit, 'gallery.html'), '<h1>doc</h1><script>alert(1)</script>');

  const svg = await fetch(`${base}/api/files/images/evil.svg`);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml', 'still usable in <img>');
  assert.equal(
    svg.headers.get('content-security-policy'),
    "default-src 'none'; sandbox",
    'the CSP is what disarms a scripted SVG opened as a document',
  );

  const html = await fetch(`${base}/api/files/gallery.html`);
  assert.equal(html.status, 200);
  assert.equal(
    html.headers.get('content-type'),
    'text/plain; charset=utf-8',
    'a kit page is text, never a document the browser executes',
  );
  assert.equal(html.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.match(await html.text(), /alert\(1\)/, 'the bytes are still served, just inert');

  fs.rmSync(path.join(kit, 'images', 'evil.svg'));
  fs.rmSync(path.join(kit, 'gallery.html'));
});

// ---------------------------------------------------------------------------
// write / enumerate confinement (kit distributed as a directory with symlinks)
// ---------------------------------------------------------------------------

test('write routes and /api/state honour the same realpath confinement as reads', async () => {
  // A kit shipped as a DIRECTORY (git clone / unpacked folder) can carry an
  // escaping symlink: theme.json → an external file, images/ → an external
  // dir. serveKitFile already 404s these; the write routes and the state
  // enumeration must not follow them either — no external overwrite, no
  // file-plant outside the kit, no disclosure of the escaped dir's names.
  const evilTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-evil-'));
  const evilKit = path.join(evilTmp, 'evil-kit');
  const outside = path.join(evilTmp, 'victim');
  fs.mkdirSync(path.join(outside, 'privatedir'), { recursive: true });
  fs.mkdirSync(path.join(evilKit, 'layouts'), { recursive: true }); // keeps the kit valid
  fs.writeFileSync(path.join(evilKit, 'kit.json'), JSON.stringify({ name: 'evil-kit' }));
  fs.writeFileSync(path.join(outside, 'important.json'), '{"balance":1000}');
  fs.writeFileSync(path.join(outside, 'privatedir', 'id_rsa.png'), 'PRIVATE');
  // theme.json is a symlink to a victim-writable file OUTSIDE the kit
  fs.symlinkSync(path.join(outside, 'important.json'), path.join(evilKit, 'theme.json'));
  // images/ is a symlink to an external directory
  fs.symlinkSync(path.join(outside, 'privatedir'), path.join(evilKit, 'images'));

  const srv = await startKitEditServer(evilKit, { port: 0 });
  const evilBase = `http://127.0.0.1:${srv.port}`;
  try {
    // PUT /api/theme must NOT overwrite the external file through the symlink
    const putTheme = await fetch(`${evilBase}/api/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: { name: 'pwned' } }),
    });
    assert.equal(putTheme.status, 403);
    assert.equal(
      fs.readFileSync(path.join(outside, 'important.json'), 'utf8'),
      '{"balance":1000}',
      'the external file was left untouched',
    );

    // PUT /api/images must NOT plant a file in the escaped directory
    const putImg = await fetch(`${evilBase}/api/images/pwned.png`, {
      method: 'PUT',
      body: PNG_1PX,
    });
    assert.equal(putImg.status, 403);
    assert.ok(
      !fs.existsSync(path.join(outside, 'privatedir', 'pwned.png')),
      'nothing was planted outside the kit',
    );

    // DELETE must NOT reach into the escaped directory either
    const delImg = await fetch(`${evilBase}/api/images/id_rsa.png`, { method: 'DELETE' });
    assert.equal(delImg.status, 403);
    assert.ok(
      fs.existsSync(path.join(outside, 'privatedir', 'id_rsa.png')),
      'the external file was not deleted',
    );

    // GET /api/state must NOT enumerate the escaped directory's file names
    const state = await (await fetch(`${evilBase}/api/state`)).json();
    assert.deepEqual(state.orphans, [], 'no file names disclosed from the symlinked images/');
  } finally {
    await srv.close();
    fs.rmSync(evilTmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// origin gate
// ---------------------------------------------------------------------------

test('a foreign Origin on a mutating request is refused; the editor origin and curl pass', async () => {
  const evil = await sendJson(
    '/api/theme',
    'PUT',
    { theme: {} },
    { Origin: 'http://evil.example' },
  );
  assert.equal(evil.status, 403);

  const own = await sendJson('/api/compile', 'POST', {}, { Origin: `http://127.0.0.1:${port}` });
  assert.equal(own.status, 200, 'the editor page itself is allowed');
  // requests WITHOUT Origin pass throughout this file — every other test is
  // the curl case
});

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

test('GET /api/export packs an archive readKitArchive accepts', async () => {
  const r = await fetch(`${base}/api/export`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('content-disposition'), /filename="fixture-kit\.deckkit"/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(r.headers.get('x-kit-sha256'), sha256(buf), "the announced digest is the body's");
  const archive = await readKitArchive(buf);
  assert.equal(archive.manifest.name, 'fixture-kit');
  assert.ok(archive.files.has('kit.json') && archive.files.has('theme.json'));
  assert.ok(archive.files.has('images/hero.png'));
});

// ---------------------------------------------------------------------------
// SSE watcher
// ---------------------------------------------------------------------------

/** Subscribes to /__events and counts the kit-changed frames received. */
function subscribe() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__events' }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        text += c;
      });
      resolve({
        count: () => (text.match(/event: kit-changed/g) ?? []).length,
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

/** Waits until the stream has been QUIET for a while: the tests touch the kit
 *  from outside the API too, and FSEvents can deliver those with hundreds of ms
 *  of latency — nothing stale must be pinned on the write under test
 *  (timing-tolerant by design). */
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

test('SSE: an external change emits kit-changed; a server write does not', async () => {
  const seen = await subscribe(); // subscribe first, so nothing is missed

  try {
    await settle(seen);

    // server write → suppressed (observe for a while, the count must not move)
    const before = seen.count();
    await sendJson('/api/theme', 'PUT', {
      theme: { name: 'Fixture', images: { 'hero-photo': './images/hero.png' } },
    });
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(seen.count(), before, 'the server’s own write must not echo back');

    // external edit → one event (timing tolerant: poll up to 3 s)
    fs.writeFileSync(path.join(kit, 'external-note.txt'), 'edited outside the server');
    assert.ok(
      await waitFor(() => seen.count() > before),
      'an external change must emit kit-changed',
    );
  } finally {
    seen.close();
  }
});

test('SSE: a server write does not mask an external change to a SIBLING file', async () => {
  // suppression used to be keyed on the parent DIRECTORY as well: for 2 s
  // after any save, every external change to another file of that directory
  // (a git checkout, a format-on-save hook, a second editor) was swallowed,
  // and the editor kept a stale copy of a file it had not written
  const seen = await subscribe();
  const foreign = path.join(kit, 'layouts', 'foreign-note.json');
  try {
    await settle(seen);
    const before = seen.count();
    await sendJson('/api/layouts/sse-note', 'PUT', {
      def: { name: 'sse-note', base: 'content' },
    });
    // WITHIN the suppression window, on a sibling of the file just written
    fs.writeFileSync(foreign, JSON.stringify({ name: 'foreign-note', base: 'content' }));
    assert.ok(await waitFor(() => seen.count() > before), 'the sibling edit must emit kit-changed');
  } finally {
    seen.close();
    fs.rmSync(foreign, { force: true });
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
    `import { startKitEditServer } from ${JSON.stringify(SERVER_MODULE)};`,
    `await assert.rejects(() => startKitEditServer(${JSON.stringify(kit)}, { port: -1 }));`,
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
