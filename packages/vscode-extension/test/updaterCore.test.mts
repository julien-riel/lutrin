/**
 * The updater is a code-execution channel: the VSIX it installs runs inside
 * the extension host. The tests below protect the three decisions its
 * integrity rests on — believing a manifest, believing a digest, deciding
 * that a version is newer.
 *
 * The test that matters most is "a digest that differs makes the
 * installation FAIL": it is the one that turns red if someone inverts the
 * comparison in `verifyDigest`.
 */

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Manifest, parseManifest, isNewer, verifyDigest } from '../src/updaterCore.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const manifest = (sha: string): Manifest => ({
  version: '1.0.0',
  vsix: 'lutrin.vsix',
  sha256: sha,
});

describe('updater — version comparison', () => {
  it('recognizes a newer major, minor or patch version', () => {
    assert.equal(isNewer('2.0.0', '1.9.9'), true);
    assert.equal(isNewer('1.10.0', '1.9.0'), true);
    assert.equal(isNewer('1.0.1', '1.0.0'), true);
  });

  it('refuses an identical or older version — no downgrade is ever offered', () => {
    assert.equal(isNewer('1.0.0', '1.0.0'), false);
    assert.equal(isNewer('1.0.0', '1.0.1'), false);
    assert.equal(isNewer('1.9.0', '1.10.0'), false);
  });

  it('compares numerically and not lexicographically (0.10.0 > 0.9.0)', () => {
    assert.equal(isNewer('0.10.0', '0.9.0'), true);
    assert.equal(isNewer('0.9.0', '0.10.0'), false);
  });

  it('treats missing components as zeros ("1.1" > "1")', () => {
    assert.equal(isNewer('1.1', '1'), true);
    assert.equal(isNewer('1', '1.0.0'), false);
  });
});

describe('updater — manifest validation', () => {
  it('accepts a complete manifest and returns it as is', () => {
    const m = parseManifest(
      { version: '0.2.0', vsix: 'lutrin-0.2.0.vsix', sha256: SHA_A },
      'https://example/latest.json',
    );
    assert.deepEqual(m, { version: '0.2.0', vsix: 'lutrin-0.2.0.vsix', sha256: SHA_A });
  });

  it('refuses a manifest with no digest — an unverifiable update is refused', () => {
    assert.throws(
      () => parseManifest({ version: '0.2.0', vsix: 'x.vsix' }, 'https://example/latest.json'),
      /valid sha256 digest/,
    );
  });

  it('refuses a digest of invalid length or alphabet', () => {
    for (const sha of ['abc', `${SHA_A}ff`, 'z'.repeat(64)]) {
      assert.throws(
        () => parseManifest({ version: '1.0.0', vsix: 'x.vsix', sha256: sha }, 'u'),
        /valid sha256 digest/,
        `digest wrongly accepted: ${sha}`,
      );
    }
  });

  it('refuses a manifest stripped of its version or of its vsix pointer', () => {
    assert.throws(() => parseManifest({ vsix: 'x.vsix', sha256: SHA_A }, 'u'), /version\/vsix/);
    assert.throws(() => parseManifest({ version: '1.0.0', sha256: SHA_A }, 'u'), /version\/vsix/);
  });

  it('refuses non-string values that coercion would let through', () => {
    // RegExp.test and split coerce: ["…"] or 1 would get through without the typeof
    assert.throws(() => parseManifest({ version: 1, vsix: 'x', sha256: SHA_A }, 'u'), /version/);
    assert.throws(() => parseManifest({ version: '1', vsix: 'x', sha256: [SHA_A] }, 'u'), /sha/);
    assert.throws(() => parseManifest(null, 'u'), /version\/vsix/);
  });
});

describe('updater — VSIX digest verification', () => {
  it('lets through a download whose digest matches', () => {
    const buffer = Buffer.from('vsix content');
    const digest = createHash('sha256').update(buffer).digest('hex');
    assert.doesNotThrow(() => verifyDigest(digest, manifest(digest)));
  });

  it('REFUSES a download whose digest differs — the heart of the channel', () => {
    // If this assertion ever stops running, the extension installs whatever
    // VSIX is served in place of the right one. This is the test that catches
    // an inverted comparison (=== instead of !==).
    assert.throws(() => verifyDigest(SHA_A, manifest(SHA_B)), /installation refused/);
  });

  it('refuses a digest that differs by a single character too', () => {
    const almost = `${SHA_A.slice(0, 63)}b`;
    assert.throws(() => verifyDigest(almost, manifest(SHA_A)), /installation refused/);
  });

  it('compares case-insensitively (the manifest may be uppercase)', () => {
    assert.doesNotThrow(() => verifyDigest(SHA_A, manifest(SHA_A.toUpperCase())));
    assert.doesNotThrow(() => verifyDigest(SHA_A.toUpperCase(), manifest(SHA_A)));
  });

  it('names the offending file in the message — an actionable diagnostic', () => {
    assert.throws(() => verifyDigest(SHA_A, manifest(SHA_B)), /lutrin\.vsix/);
  });
});
