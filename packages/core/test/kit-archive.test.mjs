/**
 * `.deckkit` archives — pack, extract, install (see SECURITY.md for the
 * threat model).
 *
 * This is the only code in the project that writes bytes coming from the
 * outside onto disk: the HOSTILE archives come first, and each one is built
 * here rather than described, so that the test fails if the guard disappears
 * — not merely if its message changes.
 *
 * ESTABLISHED FACT, which structures these tests: JSZip normalizes entry
 * names in loadAsync ("../../etc/passwd" becomes "etc/passwd"), and it does so
 * even on an archive built outside JSZip. Protection against path traversal
 * therefore comes TODAY from the dependency; `safeEntryPath` is a second line,
 * covering a change of behaviour or a replacement of the library — and it
 * remains the only one that filters extensions.
 *
 * Hence two complementary angles, neither sufficient on its own:
 *   - `safeEntryPath` tested DIRECTLY (the guard itself, which no end-to-end
 *     path can reach any more);
 *   - the installation of a hostile archive observed from the OUTSIDE: nothing
 *     is written outside the kit. That is the property that matters to the
 *     user, whatever the layer that guarantees it.
 */

import './setup.mjs'; // hermetic even under direct invocation (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {
  readKitArchive,
  packKit,
  installKitArchive,
  fetchKitArchive,
  safeEntryPath,
  sha256,
  LIMITS,
  KitArchiveError,
} from '../src/kit/archive.mjs';
import { readKit } from '../src/deck/kit.mjs';

const MANIFEST = { name: 'my-kit', version: '1.0.0' };

/** Hand-built archive: `files` = { 'path': content }. */
async function zipOf(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Minimal valid archive, plus the extra entries given. */
const goodZip = (extra = {}, manifest = MANIFEST) =>
  zipOf({
    'kit.json': JSON.stringify(manifest),
    'theme.json': JSON.stringify({ colors: { primary: 'AA5500' } }),
    ...extra,
  });

/**
 * Builds a zip archive BY HAND ("stored" entries, no compression).
 *
 * An attacker does not use JSZip: they write the bytes of the zip directly,
 * which is what this function does. That is how it was established that JSZip
 * normalizes names even on an archive it did not produce — in other words,
 * that `safeEntryPath` is no longer reachable from `readKitArchive`.
 *
 * It therefore serves here to observe the RESULT (nothing is written outside
 * the kit), not to prove which control did the work. If JSZip one day stopped
 * normalizing, these same tests would keep passing — through `safeEntryPath`
 * this time.
 */
function rawZip(files) {
  const CRC = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return (buf) => {
      let c = -1;
      for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ -1) >>> 0;
    };
  })();

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content);
    const crc = CRC(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function tmpDir(t, prefix = 'lutrin-arch-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Expected rejection: returns the message, so it can be checked precisely. */
async function rejects(promise) {
  try {
    await promise;
  } catch (e) {
    assert.ok(
      e instanceof KitArchiveError,
      `expected KitArchiveError, got ${e?.name}: ${e?.message}`,
    );
    return e.message;
  }
  assert.fail('the promise was expected to reject');
}

// ---------------------------------------------------------------------------
// Hostile archives
// ---------------------------------------------------------------------------

test('path: safeEntryPath refuses any entry that escapes the kit', () => {
  // Control tested DIRECTLY: JSZip normalizes names in loadAsync
  // ("../../etc/x" → "etc/x") before an archive ever reaches this code,
  // including when it is built outside JSZip (verified below). Testing it
  // end to end would give a test that is always green and proves nothing.
  for (const evil of [
    '../../etc/passwd.json',
    '../neighbor.json',
    'a/../../outside.json',
    '/etc/passwd.json',
    '..\\..\\outside.json',
  ]) {
    assert.throws(() => safeEntryPath(evil), /escapes the kit/, evil);
  }
  assert.equal(safeEntryPath('theme.json'), 'theme.json');
  assert.equal(safeEntryPath('layouts/duo.json'), 'layouts/duo.json');
  assert.equal(safeEntryPath('layouts/'), null, 'a directory is ignored, not refused');
});

test('archive: a hostile archive writes NOTHING outside the kit directory', async (t) => {
  // The property that matters to the user, whatever the layer that guarantees
  // it (JSZip normalizes, safeEntryPath doubles the guard): after installing
  // an archive that attempts traversal, the neighbourhood is intact.
  const base = tmpDir(t, 'lutrin-target-');
  const kits = path.join(base, 'kits');
  fs.mkdirSync(kits);
  const canary = path.join(base, 'DO-NOT-TOUCH.json');
  fs.writeFileSync(canary, '{"intact":true}');

  const buf = rawZip({
    'kit.json': JSON.stringify(MANIFEST),
    'theme.json': '{}',
    '../../DO-NOT-TOUCH.json': '{"pwned":true}',
    '../../../../../../tmp/lutrin-pwn.json': '{"pwned":true}',
  });
  const archive = await readKitArchive(buf);
  installKitArchive(archive, kits);

  assert.equal(
    fs.readFileSync(canary, 'utf8'),
    '{"intact":true}',
    'the neighbouring file was not overwritten',
  );
  assert.ok(!fs.existsSync('/tmp/lutrin-pwn.json'), 'nothing was written outside the target tree');
  assert.deepEqual(
    fs.readdirSync(base).sort(),
    ['DO-NOT-TOUCH.json', 'kits'],
    'no extra file next to the kits directory',
  );
});

test('archive: no executable file makes it into a kit', async () => {
  for (const bad of [
    'malicious.mjs',
    'a.js',
    'native.node',
    'script.sh',
    'bin.exe',
    'no-extension',
  ]) {
    const msg = await rejects(readKitArchive(await goodZip({ [bad]: 'x' })));
    assert.match(msg, /not allowed|never code/, bad);
  }
});

test('archive: the number of entries is bounded', async () => {
  const many = {};
  for (let i = 0; i <= LIMITS.entries; i++) many[`f${i}.json`] = '{}';
  const msg = await rejects(readKitArchive(await goodZip(many)));
  assert.match(msg, /entries/);
});

test('archive: a decompression bomb is stopped BEFORE it exhausts memory', async () => {
  // 120 MB of zeros compress down to a few KB: this is exactly the case that
  // a check made after the fact cannot catch up with
  const bomb = Buffer.alloc(LIMITS.extractedBytes + 20 * 1024 * 1024, 0);
  const zip = new JSZip();
  zip.file('kit.json', JSON.stringify(MANIFEST));
  zip.file('bomb.json', bomb);
  // DEFLATE: 120 MB of zeros fit in a few KB — the archive passes the entry
  // bound, and only monitoring during decompression can still stop it
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.ok(
    buf.length < LIMITS.archiveBytes,
    'the archive itself is small: that is the whole point',
  );
  const msg = await rejects(readKitArchive(buf));
  assert.match(msg, /uncompressed content exceeds/);
});

test('archive: an oversized archive is refused before any reading', async () => {
  const msg = await rejects(readKitArchive(Buffer.alloc(LIMITS.archiveBytes + 1)));
  assert.match(msg, /MB/);
});

test('archive: what is not a zip is refused cleanly, never through a raw exception', async () => {
  const msg = await rejects(readKitArchive(Buffer.from('this is not an archive')));
  assert.match(msg, /could not be read/);
  await rejects(readKitArchive(Buffer.alloc(0)));
});

test('archive: a missing, misplaced or invalid manifest is refused with an actionable message', async () => {
  const withoutManifest = await rejects(readKitArchive(await zipOf({ 'theme.json': '{}' })));
  assert.match(withoutManifest, /no kit\.json/);

  // the common reflex: compressing THE DIRECTORY instead of its content
  const wrapped = await rejects(
    readKitArchive(await zipOf({ 'my-kit/kit.json': JSON.stringify(MANIFEST) })),
  );
  assert.match(wrapped, /not at the root/);
  assert.match(wrapped, /Compress the CONTENTS/, 'the message says what to do');

  const brokenJson = await rejects(readKitArchive(await zipOf({ 'kit.json': '{ not json' })));
  assert.match(brokenJson, /invalid JSON/);

  // a kit name that would traverse the disk: refused by parseKitManifest
  const escapedName = await rejects(readKitArchive(await goodZip({}, { name: '../../bin' })));
  assert.match(escapedName, /allowed name/);
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

test('download: any protocol other than https is refused', async () => {
  for (const url of ['http://example.org/k.deckkit', 'file:///etc/passwd', 'ftp://example.org/k']) {
    const msg = await rejects(fetchKitArchive(url));
    assert.match(msg, /Protocol refused|https/, url);
  }
  assert.match(await rejects(fetchKitArchive('not a url')), /Invalid URL/);
});

// ---------------------------------------------------------------------------
// Valid archive
// ---------------------------------------------------------------------------

test('archive: a valid archive is read, with its digest', async () => {
  const buf = await goodZip({
    'layouts/duo.json': JSON.stringify({ name: 'duo', base: 'two-columns' }),
  });
  const { manifest, files, digest, diagnostics } = await readKitArchive(buf);
  assert.deepEqual(diagnostics, []);
  assert.equal(manifest.name, 'my-kit');
  assert.deepEqual([...files.keys()].sort(), ['kit.json', 'layouts/duo.json', 'theme.json']);
  assert.equal(digest, sha256(buf), 'the digest is that of the archive received');
});

// ---------------------------------------------------------------------------
// packKit — producing an archive
// ---------------------------------------------------------------------------

test('packKit: packs a kit and refuses to put in it what extraction would refuse', async (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary: 'AA5500' } }));
  fs.mkdirSync(path.join(dir, 'layouts'));
  fs.writeFileSync(path.join(dir, 'layouts', 'duo.json'), '{}');
  fs.writeFileSync(path.join(dir, 'build.mjs'), 'export default 1;'); // skipped

  const { buffer, manifest, entries, skipped } = await packKit(dir);
  assert.equal(manifest.name, 'my-kit');
  assert.deepEqual(entries.sort(), ['kit.json', 'layouts/duo.json', 'theme.json']);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /build\.mjs/, 'what is skipped is NAMED, never passed over in silence');

  // the produced archive reads back
  const back = await readKitArchive(buffer);
  assert.equal(back.manifest.name, 'my-kit');
});

test('packKit: never includes a symbolic link (it would point outside the kit)', async (t) => {
  const outside = tmpDir(t, 'lutrin-outside-');
  fs.writeFileSync(path.join(outside, 'secret.json'), '{"secret":true}');
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, 'theme.json'), '{}');
  fs.symlinkSync(path.join(outside, 'secret.json'), path.join(dir, 'stolen.json'));

  const { entries, skipped } = await packKit(dir);
  assert.ok(!entries.includes('stolen.json'), 'the link is not packed');
  assert.match(skipped.join(), /symbolic link/);
});

test('packKit: two packs of the same content give the same digest', async (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, 'theme.json'), '{}');
  const a = await packKit(dir);
  const b = await packKit(dir);
  assert.equal(
    sha256(a.buffer),
    sha256(b.buffer),
    'without a fixed date, the published sha256 would change on every pack',
  );
});

test('packKit: a directory with no manifest, or with an invalid one, is refused', async (t) => {
  const empty = tmpDir(t);
  assert.match(await rejects(packKit(empty)), /not a kit/);
  fs.writeFileSync(path.join(empty, 'kit.json'), JSON.stringify({ name: 'UPPERCASE' }));
  assert.match(await rejects(packKit(empty)), /invalid/);
});

// ---------------------------------------------------------------------------
// installKitArchive
// ---------------------------------------------------------------------------

test('install: the kit installs under the name from the MANIFEST, not the file name', async (t) => {
  const kits = tmpDir(t, 'lutrin-kits-');
  const archive = await readKitArchive(await goodZip());
  const { dir, replaced } = installKitArchive(archive, kits);
  assert.equal(
    dir,
    path.join(kits, 'my-kit'),
    'the name comes from the manifest — the file name is chosen by whoever distributes it',
  );
  assert.equal(replaced, false);
  assert.equal(fs.readFileSync(path.join(dir, '.integrity'), 'utf8').trim(), archive.digest);

  // the installed kit is immediately readable by the resolver
  const check = readKit(dir);
  assert.deepEqual(check.diagnostics, []);
  assert.equal(check.manifest.name, 'my-kit');
});

test('install: a kit already present is never overwritten without --force', async (t) => {
  const kits = tmpDir(t, 'lutrin-kits-');
  const archive = await readKitArchive(await goodZip());
  installKitArchive(archive, kits);

  assert.throws(() => installKitArchive(archive, kits), /already installed/);
  const { replaced } = installKitArchive(archive, kits, { force: true });
  assert.equal(replaced, true);
});

test('install: replacement leaves no file from the previous version', async (t) => {
  const kits = tmpDir(t, 'lutrin-kits-');
  const v1 = await readKitArchive(await goodZip({ 'layouts/old.json': '{}' }));
  const dir = installKitArchive(v1, kits).dir;
  assert.ok(fs.existsSync(path.join(dir, 'layouts', 'old.json')));

  const v2 = await readKitArchive(await goodZip({ 'layouts/new.json': '{}' }));
  installKitArchive(v2, kits, { force: true });
  assert.ok(
    !fs.existsSync(path.join(dir, 'layouts', 'old.json')),
    'a layout removed in v2 does not survive the update',
  );
  assert.ok(fs.existsSync(path.join(dir, 'layouts', 'new.json')));
});

test('install: a write that fails leaves no half-installed kit', async (t) => {
  const kits = tmpDir(t, 'lutrin-kits-');
  const archive = await readKitArchive(await goodZip());
  // a file where the installation wants to create a directory: ENOTDIR in the
  // middle of the write — the staging area must disappear with it
  archive.files.set('layouts/duo.json', Buffer.from('{}'));
  archive.files.set('layouts', Buffer.from('not a directory'));

  assert.throws(() => installKitArchive(archive, kits));
  assert.ok(!fs.existsSync(path.join(kits, 'my-kit')), 'no partial kit is left behind');
  assert.deepEqual(
    fs.readdirSync(kits).filter((f) => f.includes('.tmp-')),
    [],
    'no leftover staging directory',
  );
});

test('packKit: never packs node_modules or the repository tooling', async (t) => {
  // Real regression (phase 4): `kit create` on a kit repository that had its
  // own tests packed ALL of node_modules — the package.json files of the
  // dependencies pass the ".json" allowlist without a murmur. 59 files instead
  // of 20, and third-party code in an archive meant to be data only.
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'kit.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, 'theme.json'), '{}');
  for (const junk of ['node_modules/jszip', '.git', '.github/workflows', 'dist']) {
    fs.mkdirSync(path.join(dir, junk), { recursive: true });
    fs.writeFileSync(path.join(dir, junk, 'package.json'), '{"name":"third-party"}');
  }
  // a legitimate fixture in test/ does belong
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'fixture.json'), '{}');

  const { entries } = await packKit(dir);
  assert.deepEqual(entries.sort(), ['kit.json', 'test/fixture.json', 'theme.json']);
  assert.ok(
    !entries.some((e) => e.includes('node_modules')),
    'no third-party dependency in the archive',
  );
});
