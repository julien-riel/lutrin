/**
 * Remote assets: where the local copy lands, and what we agree to go and
 * fetch.
 *
 * Two invariants, of different natures.
 *
 *   1. CLEANLINESS — a compilation writes NOTHING into the deck's directory
 *      until the author has asked for it; otherwise every build dirties the
 *      source tree (and the user's git repository). The "vendor" mode is the
 *      explicit exception, for a self-contained directory.
 *
 *   2. NETWORK CONFINEMENT — everything downloaded ends up EMBEDDED in the
 *      produced .pptx or .html. An image URL is therefore a read primitive
 *      from the machine doing the compiling: without a guard,
 *      `![](http://169.254.169.254/latest/meta-data/iam/…)` in a deck sent by
 *      a third party exfiltrates cloud credentials in an innocuous-looking
 *      deliverable, and `http://127.0.0.1:8080/` the victim's intranet. Hence
 *      the refusal of private and local addresses — at EVERY redirect hop,
 *      otherwise a public URL answering 302 to 10.0.0.5 is enough to
 *      bypass everything.
 *
 * No test here touches the network. The path tests pre-fill the cache by
 * hand; those exercising the download divert `fetch` and use only LITERAL
 * ADDRESSES — `dns.lookup` on a literal does not leave the machine, so the
 * SSRF guard is exercised for real without any name to resolve. 203.0.113.0/24
 * is the documentation range (RFC 5737): public as far as the policy is
 * concerned, unreachable in practice. LUTRIN_CACHE is diverted to a temporary
 * directory — the suite must never read or write the developer's real cache.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-test-cache-'));
process.env.LUTRIN_CACHE = CACHE;

// import AFTER the environment variable (the module freezes certain roots)
const {
  fetchRemoteImage,
  remoteDir,
  vendorRemoteAssets,
  iconSvg,
  isPrivateAddress,
  remoteUrlRefusal,
  REMOTE_MAX_REDIRECTS,
  LUCIDE_MAX_BYTES,
} = await import('../src/deck/assets.mjs');

const PHOTO_URL = 'https://example.test/photos/Large%20Photo.jpg';

/** Name fetchRemoteImage will give this URL (sanitized basename + short sha1). */
function localName(url, ext = '.jpg') {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  const base = path
    .basename(new URL(url).pathname)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 48);
  return `${base}-${hash}${ext}`;
}

/** Pre-fills the user cache as a download would have done. */
function seedCache(url, bytes = 'JPEG') {
  const dir = remoteDir('/does-not-matter', false);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, localName(url));
  fs.writeFileSync(file, bytes);
  return file;
}

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-test-deck-'));

// ---------------------------------------------------------------------------
// 1. Where the local copy lands
// ---------------------------------------------------------------------------

test('by default, remote images go into the user cache, not into the project', () => {
  const baseDir = tmpProject();
  const dir = remoteDir(baseDir, false);
  assert.equal(dir, path.join(CACHE, 'remote'));
  assert.ok(!dir.startsWith(baseDir), 'the cache must not live under the deck directory');
});

test('vendor mode targets assets/remote/ next to the .md', () => {
  const baseDir = tmpProject();
  assert.equal(remoteDir(baseDir, true), path.join(baseDir, 'assets', 'remote'));
});

test('an already populated cache serves the copy without writing into the project', async () => {
  const baseDir = tmpProject();
  const cached = seedCache(PHOTO_URL);

  const got = await fetchRemoteImage(PHOTO_URL, baseDir);

  assert.equal(got, cached);
  // the invariant: compiling did not touch the source tree
  assert.deepEqual(fs.readdirSync(baseDir), []);
});

test('two distinct projects share the same cache entry', async () => {
  seedCache(PHOTO_URL);
  const a = await fetchRemoteImage(PHOTO_URL, tmpProject());
  const b = await fetchRemoteImage(PHOTO_URL, tmpProject());
  assert.equal(a, b);
});

test('vendor mode copies from the cache — without re-downloading', async () => {
  const baseDir = tmpProject();
  seedCache(PHOTO_URL, 'ORIGINAL-BYTES');

  const got = await fetchRemoteImage(PHOTO_URL, baseDir, { vendor: true });

  assert.equal(got, path.join(baseDir, 'assets', 'remote', localName(PHOTO_URL)));
  assert.equal(fs.readFileSync(got, 'utf8'), 'ORIGINAL-BYTES');
});

test('in vendor mode, the project copy is reused as is', async () => {
  const baseDir = tmpProject();
  const dir = path.join(baseDir, 'assets', 'remote');
  fs.mkdirSync(dir, { recursive: true });
  const vendored = path.join(dir, localName(PHOTO_URL));
  fs.writeFileSync(vendored, 'PROJECT-COPY');
  seedCache(PHOTO_URL, 'CACHE-COPY'); // must NOT win

  const got = await fetchRemoteImage(PHOTO_URL, baseDir, { vendor: true });

  assert.equal(got, vendored);
  assert.equal(fs.readFileSync(got, 'utf8'), 'PROJECT-COPY');
});

test('vendor: a read-only project falls back on the cache rather than failing', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores file permissions');
  // chmod on a directory is a no-op on Windows (the read-only attribute does
  // not deny writes into it): the premise of this test — an FS that refuses
  // the write — cannot be staged there
  if (process.platform === 'win32') return t.skip('chmod cannot make a directory read-only');
  const baseDir = tmpProject();
  const cached = seedCache(PHOTO_URL);
  fs.chmodSync(baseDir, 0o500); // read + traverse, no write
  t.after(() => fs.chmodSync(baseDir, 0o700));

  const got = await fetchRemoteImage(PHOTO_URL, baseDir, { vendor: true });

  assert.equal(got, cached, 'the image is still rendered, from the cache');
});

test('vendorRemoteAssets: frontmatter `assets:`, which the CLI flag can force', () => {
  assert.equal(vendorRemoteAssets({}, undefined), false, 'the default is the cache');
  assert.equal(vendorRemoteAssets({ assets: 'vendor' }, undefined), true);
  // `projet` is the deliberate FRENCH input alias documented in assets.mjs — this
  // is the only guard that stops a later pass from deleting it silently
  assert.equal(vendorRemoteAssets({ assets: 'projet' }, undefined), true);
  assert.equal(
    vendorRemoteAssets({ assets: ' VENDOR ' }, undefined),
    true,
    'insensitive to case and to spaces',
  );
  assert.equal(vendorRemoteAssets({ assets: 'cache' }, undefined), false);
  assert.equal(
    vendorRemoteAssets({ assets: 'anythingatall' }, undefined),
    false,
    'unknown value = default, not an error',
  );
  // --vendor-assets takes precedence over the frontmatter, as --kit does over kit:
  assert.equal(vendorRemoteAssets({}, true), true);
  assert.equal(vendorRemoteAssets({ assets: 'vendor' }, false), false);
});

// ---------------------------------------------------------------------------
// Network harness: stub responses and diverted fetch
// ---------------------------------------------------------------------------

/** Stub response: `chunks` is produced lazily, so as to observe what the
 *  caller really consumes before giving up.
 *
 *  The body imitates a real `Response.body`: an ITERABLE stream that also
 *  carries `cancel()`. That is the method the code calls to release the socket
 *  of a hop it will not read — a plain generator would not have it, and
 *  `.return()` on a generator that was never started does not even wake its
 *  `finally`: the test would have observed nothing at all. */
function fakeResponse(
  chunks,
  { declared = null, mime = 'image/png', status = 200, location = null } = {},
) {
  const state = { consumed: 0, interrupted: false, cancelled: false };
  const headers = new Map([['content-type', mime]]);
  if (declared !== null) headers.set('content-length', String(declared));
  if (location !== null) headers.set('location', location);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const gen = (async function* () {
    try {
      for (const c of chunks) {
        state.consumed += c.length;
        yield c;
      }
    } finally {
      // early exit from the for-await loop → the stream is cancelled here
      state.interrupted = state.consumed < total;
    }
  })();
  return {
    state,
    res: {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers.get(k) ?? null },
      body: {
        [Symbol.asyncIterator]: () => gen,
        async cancel() {
          state.cancelled = true;
          await gen.return();
        },
      },
    },
  };
}

/** Diverts fetch for the duration of a test. `handler` receives the requested
 *  URL and returns the response; a bare response is served as is on every call. */
function stubFetch(t, handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push(String(url));
    return typeof handler === 'function' ? handler(String(url), opts) : handler;
  };
  t.after(() => {
    globalThis.fetch = real;
  });
  return seen;
}

// one distinct URL per test: the cache is shared, and a test leaving an entry
// behind it would make the next one pass without ever calling fetch
const uniqueUrl = (name) => `https://203.0.113.10/photos/${name}.png`;
const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// 2. Size bound: an image URL can point at anything
// ---------------------------------------------------------------------------

test('an image of reasonable size is downloaded', async (t) => {
  const NAME = 'size-ok';
  const baseDir = tmpProject();
  const { res } = fakeResponse([Buffer.alloc(512 * 1024, 7)], { declared: 512 * 1024 });
  stubFetch(t, res);

  const got = await fetchRemoteImage(uniqueUrl(NAME), baseDir);

  assert.ok(got, 'half a MB passes without reservation');
  assert.equal(fs.statSync(got).size, 512 * 1024);
});

test('content-length beyond the bound: refused BEFORE reading the body', async (t) => {
  const NAME = 'huge-announcement';
  const baseDir = tmpProject();
  const { res, state } = fakeResponse([Buffer.alloc(MB)], { declared: 900 * MB });
  stubFetch(t, res);

  const got = await fetchRemoteImage(uniqueUrl(NAME), baseDir);

  assert.equal(got, null, 'the caller falls back on its placeholder');
  assert.equal(state.consumed, 0, 'no byte transferred: we give up on the announcement');
  const left = fs.readdirSync(remoteDir(baseDir, false)).filter((f) => f.startsWith(NAME));
  assert.deepEqual(left, [], 'nothing written: the cache keeps no truncated file');
});

test('server lying about content-length: the running total interrupts the transfer', async (t) => {
  const NAME = 'lying-server';
  const baseDir = tmpProject();
  // 40 × 1 MB announced as 1 KB — only the actual read protects
  const { res, state } = fakeResponse(
    Array.from({ length: 40 }, () => Buffer.alloc(MB)),
    { declared: 1024 },
  );
  stubFetch(t, res);

  const got = await fetchRemoteImage(uniqueUrl(NAME), baseDir);

  assert.equal(got, null);
  assert.ok(state.interrupted, 'the stream is abandoned, not drained to the end');
  assert.ok(state.consumed <= 26 * MB, `stops shortly after the bound (read: ${state.consumed})`);
});

test('content-length absent: the bound applies all the same', async (t) => {
  const NAME = 'no-length';
  const baseDir = tmpProject();
  const { res } = fakeResponse(Array.from({ length: 40 }, () => Buffer.alloc(MB)));
  stubFetch(t, res);

  assert.equal(await fetchRemoteImage(uniqueUrl(NAME), baseDir), null);
});

// ---------------------------------------------------------------------------
// 3. SSRF: which addresses we agree to reach
// ---------------------------------------------------------------------------

test('isPrivateAddress: private, local and service ranges are refused', () => {
  const privateAddrs = [
    '127.0.0.1',
    '127.1.2.3', // loopback
    '10.0.0.5',
    '10.255.255.255', // 10/8
    '172.16.0.1',
    '172.31.255.254', // 172.16/12
    '192.168.1.1', // 192.168/16
    '169.254.169.254', // link-local — cloud metadata
    '0.0.0.0', // "this host"
    '100.64.0.1', // CGNAT
    '224.0.0.1',
    '255.255.255.255', // multicast and reserved
    '::1',
    '::', // IPv6 loopback
    'fc00::1',
    'fd12:3456::1', // fc00::/7
    'fe80::1', // IPv6 link-local
    'ff02::1', // IPv6 multicast
    '::ffff:127.0.0.1', // loopback disguised as IPv4-mapped
    '::ffff:10.0.0.1',
  ];
  for (const ip of privateAddrs) assert.equal(isPrivateAddress(ip), true, `${ip} must be refused`);

  const publicAddrs = [
    '203.0.113.10',
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '172.15.0.1',
    '192.169.0.1',
    '2606:4700::1111',
  ];
  for (const ip of publicAddrs) assert.equal(isPrivateAddress(ip), false, `${ip} must be admitted`);

  // over-inclusive by choice: what does not parse is refused — a missing image
  // is visible, a successful read of an internal network is not
  for (const weird of ['', null, undefined, 'not-an-ip', '999.1.1.1', '10.0.0'])
    assert.equal(isPrivateAddress(weird), true, `${weird}: when in doubt, refuse`);
});

test('remoteUrlRefusal: only http/https to a public address pass', async () => {
  assert.equal(
    await remoteUrlRefusal('https://203.0.113.10/x.png'),
    null,
    'public address: admitted',
  );
  assert.equal(
    await remoteUrlRefusal('http://203.0.113.10/x.png'),
    null,
    'http stays admitted (intranets, mirrors)',
  );

  // a free-for-all scheme would be an arbitrary file read disguised as an image
  assert.match(await remoteUrlRefusal('file:///etc/passwd'), /protocol refused/);
  assert.match(await remoteUrlRefusal('ftp://203.0.113.10/x.png'), /protocol refused/);
  assert.match(await remoteUrlRefusal('data:image/png;base64,AAAA'), /protocol refused/);

  assert.match(await remoteUrlRefusal('http://127.0.0.1:8080/internal'), /private or local/);
  assert.match(
    await remoteUrlRefusal('http://169.254.169.254/latest/meta-data/'),
    /private or local/,
  );
  assert.match(await remoteUrlRefusal('http://[::1]/internal'), /private or local/);
  assert.match(await remoteUrlRefusal('http://10.0.0.5/internal'), /private or local/);

  assert.match(await remoteUrlRefusal('not a url'), /invalid URL/);
});

test('fetchRemoteImage refuses a local address without even opening a connection', async (t) => {
  const baseDir = tmpProject();
  const { res } = fakeResponse([Buffer.from('PNG')]);
  const seen = stubFetch(t, res);

  assert.equal(
    await fetchRemoteImage('http://169.254.169.254/latest/meta-data/iam', baseDir),
    null,
  );
  assert.equal(await fetchRemoteImage('http://127.0.0.1:8080/intranet.png', baseDir), null);
  assert.equal(await fetchRemoteImage('file:///etc/passwd', baseDir), null);

  assert.deepEqual(seen, [], 'the verdict falls BEFORE the transfer: fetch is never called');
});

test('redirect to a private address: refused at the hop where it appears', async (t) => {
  const baseDir = tmpProject();
  const url = uniqueUrl('internal-bounce');
  const hop1 = fakeResponse([], {
    status: 302,
    location: 'http://169.254.169.254/latest/meta-data/',
  });
  const internal = fakeResponse([Buffer.from('IAM-CREDENTIALS')]);
  const seen = stubFetch(t, (u) => (u === url ? hop1.res : internal.res));

  const got = await fetchRemoteImage(url, baseDir);

  assert.equal(got, null, 'the chain stops: nothing enters the deliverable');
  assert.deepEqual(seen, [url], 'the second hop is not even attempted');
  assert.equal(internal.state.consumed, 0, 'no byte of the metadata service is read');
});

test('legitimate redirect: followed, and the intermediate hop body is cancelled', async (t) => {
  const baseDir = tmpProject();
  const url = uniqueUrl('public-bounce');
  const target = 'https://203.0.113.20/final.png';
  // the 302 carries a body (a "moved" page) that nobody must read
  const hop1 = fakeResponse([Buffer.from('<html>moved</html>')], { status: 302, location: target });
  const final = fakeResponse([Buffer.alloc(2048, 3)], { declared: 2048 });
  const seen = stubFetch(t, (u) => (u === url ? hop1.res : final.res));

  const got = await fetchRemoteImage(url, baseDir);

  assert.ok(got, 'the public redirect succeeds');
  assert.equal(fs.statSync(got).size, 2048);
  assert.deepEqual(seen, [url, target]);
  assert.equal(hop1.state.consumed, 0, 'the body of the 302 is not transferred');
  assert.ok(hop1.state.cancelled, 'the socket of the intermediate hop is released');
});

test('redirect loop: bounded, without ever writing anything', async (t) => {
  const baseDir = tmpProject();
  const url = uniqueUrl('loop');
  // each hop points at a DIFFERENT public address: nothing stops it but the
  // counter
  const seen = stubFetch(t, (u) => {
    const n = Number(new URL(u).searchParams.get('n') ?? 0);
    return fakeResponse([], { status: 302, location: `https://203.0.113.30/r?n=${n + 1}` }).res;
  });

  assert.equal(await fetchRemoteImage(url, baseDir), null);
  assert.equal(
    seen.length,
    REMOTE_MAX_REDIRECTS + 1,
    'the number of hops is bounded, not infinite',
  );
});

test('redirect to another scheme: refused like a forbidden address', async (t) => {
  const baseDir = tmpProject();
  const url = uniqueUrl('file-bounce');
  const seen = stubFetch(
    t,
    () => fakeResponse([], { status: 302, location: 'file:///etc/passwd' }).res,
  );

  assert.equal(await fetchRemoteImage(url, baseDir), null);
  assert.deepEqual(seen, [url], 'the hop to file:// is not attempted');
});

// ---------------------------------------------------------------------------
// 4. Lucide icons: pinned version, bounded and verified body
// ---------------------------------------------------------------------------

/** The SVG served by the CDN — minimal form of a Lucide icon. */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" stroke="currentColor"><path d="M0 0"/></svg>';

/** Icon absent from node_modules AND from the cache: forces the CDN path.
 *  A fresh name per test — the cache never expires. */
const unseenIcon = (n) => `zzz-unknown-${n}`;

const lucideCacheDir = () => path.join(CACHE, 'icons', 'lucide');
const iconCache = (name) => path.join(lucideCacheDir(), `${name}.svg`);

/** The version this package DECLARES — that is the one that must be requested. */
const declaredVersion = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).dependencies['lucide-static'].match(/\d+\.\d+\.\d+/)[0];

test('the Lucide CDN is pinned to the declared version, never "latest"', async (t) => {
  const name = unseenIcon('pinned');
  const { res } = fakeResponse([Buffer.from(ICON_SVG)], { mime: 'image/svg+xml' });
  const seen = stubFetch(t, res);

  const svg = await iconSvg(name);

  assert.equal(seen.length, 1);
  assert.ok(
    seen[0].includes(`lucide-static@${declaredVersion}/`),
    `the URL must carry the declared version (${declaredVersion}) — seen: ${seen[0]}`,
  );
  assert.ok(
    !seen[0].includes('@latest'),
    '"@latest" makes the rendering depend on the day of compilation',
  );
  assert.ok(svg?.includes('<svg'), 'the icon is rendered');
});

test('a downloaded icon is cached, and the next time does not touch the network', async (t) => {
  const name = unseenIcon('cached');
  const { res } = fakeResponse([Buffer.from(ICON_SVG)], { mime: 'image/svg+xml' });
  const seen = stubFetch(t, res);

  await iconSvg(name);
  assert.ok(fs.existsSync(iconCache(name)), 'the SVG is written into the user cache');

  const again = await iconSvg(name);
  assert.equal(seen.length, 1, 'the second call is served by the cache');
  assert.ok(again.includes('<svg'));
});

test('a response that is not an SVG: never cached', async (t) => {
  // the real case: captive portal, proxy interstitial, 404 page served as HTTP 200.
  // Since the cache never expires, such a frozen response would stay there
  // forever under the name of an icon, with nothing ever coming to correct it.
  const name = unseenIcon('html-page');
  const { res } = fakeResponse([Buffer.from('<!doctype html><html><body>Sign in</body></html>')], {
    mime: 'text/html',
  });
  stubFetch(t, res);

  assert.equal(await iconSvg(name), null);
  assert.ok(!fs.existsSync(iconCache(name)), 'nothing is written into the cache');
});

test('a response beyond the bound: neither rendered nor cached', async (t) => {
  const name = unseenIcon('huge');
  const big = Buffer.alloc(LUCIDE_MAX_BYTES + 1, 0x20);
  big.write('<svg '); // even well formed, it exceeds: the bound wins
  const { res } = fakeResponse([big], { mime: 'image/svg+xml' });
  stubFetch(t, res);

  assert.equal(await iconSvg(name), null);
  assert.ok(!fs.existsSync(iconCache(name)));
});

test('content-length announcing more than the bound: given up before transfer', async (t) => {
  const name = unseenIcon('huge-announcement');
  const { res, state } = fakeResponse([Buffer.from(ICON_SVG)], {
    mime: 'image/svg+xml',
    declared: 10 * MB,
  });
  stubFetch(t, res);

  assert.equal(await iconSvg(name), null);
  assert.equal(state.consumed, 0);
  assert.ok(!fs.existsSync(iconCache(name)));
});

test.after(() => fs.rmSync(CACHE, { recursive: true, force: true }));
