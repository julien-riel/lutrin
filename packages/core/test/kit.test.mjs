/**
 * Kits — the `kit.json` manifest (see the "Kits" section of the README).
 *
 * The manifest is the boundary between a file received from the outside and
 * the user's disk: it is the thing that decides a directory name and which
 * paths to open. The hostile cases therefore come FIRST, and phase 3
 * (`kit install`) will be able to assume them settled rather than re-check
 * them.
 *
 * The disk tests create their kit in a tmpdir and clean it up through a
 * t.after registered BEFORE the first assertion — a failure midway must
 * leave no residue behind, nor blur the diagnosis of the tests that follow.
 */

import './setup.mjs'; // hermetic even when invoked directly (see setup.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseKitManifest,
  readKit,
  insideKit,
  escapesKit,
  KIT_MANIFEST,
  KIT_EXT,
  KIT_KEYS,
  KIT_NAME_RE,
} from '../src/deck/kit.mjs';

const errors = (diags) => diags.filter((d) => d.severity === 'error');
const codes = (diags) => diags.map((d) => d.code);

/** Writes a temporary kit; `files` = { 'relative/path': content }. */
function tmpKit(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kit-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const MINIMAL = { name: 'my-kit' };

// ---------------------------------------------------------------------------
// Hostile cases — what the format must refuse
// ---------------------------------------------------------------------------

test('kit: a name that traverses the filesystem is refused', () => {
  for (const name of [
    '../../bin',
    '..',
    '.',
    'a/b',
    'a\\b',
    '/etc/passwd',
    'kit.',
    '-kit',
    'A-Kit',
    'kit name',
    '',
  ]) {
    const { manifest, diagnostics } = parseKitManifest({ name });
    assert.equal(manifest, null, `"${name}" must be refused`);
    assert.equal(errors(diagnostics).length, 1);
    assert.equal(errors(diagnostics)[0].code, 'KIT_INVALID');
  }
});

test('kit: a theme/layouts path that escapes the kit is an error, not a warning', () => {
  for (const rel of [
    '../../../etc/passwd',
    '..',
    '../neighbour/theme.json',
    '/etc/passwd',
    'a/../../outside.json',
  ]) {
    for (const key of ['theme', 'layouts']) {
      const { manifest, diagnostics } = parseKitManifest({ ...MINIMAL, [key]: rel });
      assert.equal(manifest, null, `${key}: "${rel}" must be refused`);
      assert.equal(errors(diagnostics)[0].code, 'KIT_INVALID');
    }
  }
});

test('kit: a path with Windows separators does not escape under POSIX', () => {
  // under POSIX "..\..\x" is a valid FILENAME: without normalization of the
  // separators, an archive crafted under Windows would slip through
  assert.equal(escapesKit('..\\..\\outside.json'), true);
  assert.equal(escapesKit('C:\\Windows\\system32'), true);
  assert.equal(escapesKit('subdirectory/theme.json'), false);
  assert.equal(escapesKit('./theme.json'), false);
});

test('kit: insideKit refuses a symlink that points outside the kit', (t) => {
  const outside = tmpKit({ 'secret.json': '{}' });
  const { dir, cleanup } = tmpKit({ [KIT_MANIFEST]: MINIMAL });
  t.after(cleanup);
  t.after(outside.cleanup);

  // the DECLARED path is impeccable — only the disk reveals the escape
  fs.symlinkSync(path.join(outside.dir, 'secret.json'), path.join(dir, 'theme.json'));
  assert.equal(insideKit(dir, './theme.json'), null);

  // a link that stays inside the kit is legitimate
  fs.writeFileSync(path.join(dir, 'real.json'), '{}');
  fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'alias.json'));
  assert.equal(insideKit(dir, './alias.json'), path.join(dir, 'alias.json'));
});

test('kit: an escaped symlink makes readKit fail', (t) => {
  const outside = tmpKit({ 'theme.json': { name: 'stolen' } });
  const { dir, cleanup } = tmpKit({ [KIT_MANIFEST]: { ...MINIMAL, theme: './link.json' } });
  t.after(cleanup);
  t.after(outside.cleanup);

  fs.symlinkSync(path.join(outside.dir, 'theme.json'), path.join(dir, 'link.json'));
  const { manifest, diagnostics } = readKit(dir);
  assert.equal(manifest, null);
  assert.equal(errors(diagnostics)[0].code, 'KIT_INVALID');
  assert.match(errors(diagnostics)[0].message, /symbolic link/);
});

test('kit: the dangerous prototype keys are never carried over', () => {
  const { manifest, diagnostics } = parseKitManifest(
    JSON.parse('{"name":"my-kit","__proto__":{"polluted":true},"constructor":"x"}'),
  );
  assert.ok(manifest);
  assert.equal(manifest.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.ok(
    !codes(diagnostics).includes('KIT_UNKNOWN_KEY'),
    'a dangerous key is ignored in silence, not suggested',
  );
});

// ---------------------------------------------------------------------------
// Valid manifest
// ---------------------------------------------------------------------------

test('kit: the minimal manifest declares nothing but a name, the paths have defaults', () => {
  const { manifest, diagnostics } = parseKitManifest(MINIMAL);
  assert.deepEqual(manifest, { name: 'my-kit', theme: './theme.json', layouts: './layouts' });
  assert.deepEqual(diagnostics, []);
});

test('kit: a complete manifest is kept, cleaned up and normalized', () => {
  const { manifest, diagnostics } = parseKitManifest({
    name: '  brand-acme  ',
    version: ' 1.2.0-beta.1 ',
    description: 'Example brand',
    author: 'Example organization',
    homepage: 'https://example.org',
    theme: './tokens.json',
    layouts: './custom-layouts',
  });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(manifest, {
    name: 'brand-acme',
    theme: './tokens.json',
    layouts: './custom-layouts',
    version: '1.2.0-beta.1',
    description: 'Example brand',
    author: 'Example organization',
    homepage: 'https://example.org',
  });
});

test('kit: every name allowed by KIT_NAME_RE is accepted', () => {
  for (const name of ['a', 'kit', 'brand-acme', '9-lives', 'a'.repeat(64)]) {
    assert.ok(KIT_NAME_RE.test(name), name);
    assert.ok(parseKitManifest({ name }).manifest, name);
  }
  assert.ok(!KIT_NAME_RE.test('a'.repeat(65)), 'the 64-character bound is strict');
});

// ---------------------------------------------------------------------------
// Doubtful values — degraded, never fatal
// ---------------------------------------------------------------------------

test('kit: a doubtful value degrades without invalidating the kit', () => {
  const { manifest, diagnostics } = parseKitManifest({
    ...MINIMAL,
    version: 'v1', // not semver
    description: 42, // not a string
    theme: '', // empty → default kept
  });
  assert.ok(manifest, 'none of these faults makes the kit uninstallable');
  assert.equal(manifest.version, undefined);
  assert.equal(manifest.description, undefined);
  assert.equal(manifest.theme, './theme.json');
  assert.equal(diagnostics.length, 3);
  assert.ok(diagnostics.every((d) => d.severity === 'warning' && d.code === 'KIT_BAD_VALUE'));
});

test('kit: an unknown key is reported with a suggestion when it is close', () => {
  const { manifest, diagnostics } = parseKitManifest({ ...MINIMAL, layout: './x', zzzz: 1 });
  assert.ok(manifest);
  const unknown = diagnostics.filter((d) => d.code === 'KIT_UNKNOWN_KEY');
  assert.equal(unknown.length, 2);
  assert.equal(unknown[0].suggestion, 'layouts'); // "layout" → "layouts"
  assert.equal(unknown[1].suggestion, undefined); // too far from anything
  assert.ok(KIT_KEYS.includes('layouts'));
});

test('kit: a manifest that is not an object is refused', () => {
  for (const json of [null, 42, 'text', [], undefined]) {
    const { manifest, diagnostics } = parseKitManifest(json);
    assert.equal(manifest, null);
    assert.equal(errors(diagnostics)[0].code, 'KIT_INVALID');
  }
});

// ---------------------------------------------------------------------------
// readKit — what only the disk can tell
// ---------------------------------------------------------------------------

test('kit: a complete kit on disk exposes its resolved paths', (t) => {
  const { dir, cleanup } = tmpKit({
    [KIT_MANIFEST]: { name: 'my-kit', version: '1.0.0' },
    'theme.json': { name: 'My theme' },
    'layouts/duo.json': { base: 'split' },
  });
  t.after(cleanup);

  const { manifest, themeFile, layoutsDir, diagnostics } = readKit(dir);
  assert.deepEqual(diagnostics, []);
  assert.equal(manifest.name, 'my-kit');
  assert.equal(themeFile, path.join(dir, 'theme.json'));
  assert.equal(layoutsDir, path.join(dir, 'layouts'));
});

test('kit: the directory name does not have to equal the kit name', (t) => {
  // an archive unpacks wherever its caller wants; it is `kit install` that
  // imposes the directory, not readKit
  const { dir, cleanup } = tmpKit({
    [KIT_MANIFEST]: { name: 'brand-acme' },
    'theme.json': {},
  });
  t.after(cleanup);
  assert.equal(readKit(dir).manifest.name, 'brand-acme');
});

test('kit: design tokens alone or layouts alone are enough', (t) => {
  const tokens = tmpKit({ [KIT_MANIFEST]: MINIMAL, 'theme.json': {} });
  const layouts = tmpKit({ [KIT_MANIFEST]: MINIMAL, 'layouts/duo.json': {} });
  t.after(tokens.cleanup);
  t.after(layouts.cleanup);

  const a = readKit(tokens.dir);
  assert.deepEqual(a.diagnostics, []);
  assert.ok(a.themeFile && !a.layoutsDir);

  const b = readKit(layouts.dir);
  assert.deepEqual(b.diagnostics, []);
  assert.ok(!b.themeFile && b.layoutsDir);
});

test('kit: a kit that brings neither design tokens nor layouts is refused', (t) => {
  const { dir, cleanup } = tmpKit({ [KIT_MANIFEST]: MINIMAL, 'README.md': '# empty' });
  t.after(cleanup);

  const { manifest, diagnostics } = readKit(dir);
  assert.equal(manifest, null);
  assert.match(errors(diagnostics)[0].message, /neither .*theme\.json.* nor/);
});

test('kit: a theme DECLARED but absent is an error', (t) => {
  const { dir, cleanup } = tmpKit({
    [KIT_MANIFEST]: { ...MINIMAL, theme: './tokens.json' },
    'layouts/duo.json': {}, // the kit does bring layouts, though
  });
  t.after(cleanup);

  const { manifest, diagnostics } = readKit(dir);
  assert.equal(manifest, null, 'a path explicitly declared and not found is a fault of the kit');
  assert.match(errors(diagnostics)[0].message, /tokens\.json/);
});

test('kit: manifest absent, could not be read, or directory nonexistent', (t) => {
  const empty = tmpKit({ 'theme.json': {} });
  const broken = tmpKit({ [KIT_MANIFEST]: '{ this one does not close' });
  t.after(empty.cleanup);
  t.after(broken.cleanup);

  assert.equal(readKit(empty.dir).diagnostics[0].code, 'KIT_NOT_FOUND');
  assert.equal(readKit(broken.dir).diagnostics[0].code, 'KIT_INVALID');
  assert.equal(readKit(path.join(empty.dir, 'nowhere')).diagnostics[0].code, 'KIT_NOT_FOUND');
  // a .deckkit file is not an unpacked kit
  assert.equal(readKit(path.join(empty.dir, `x${KIT_EXT}`)).diagnostics[0].code, 'KIT_NOT_FOUND');
});
