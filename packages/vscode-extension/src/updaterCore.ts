/**
 * Pure core of the updater — the part that decides, separated from the part
 * that talks to the network, to the disk and to VS Code (`updater.ts`).
 *
 * This module imports NEITHER `vscode` NOR anything asynchronous: it is
 * loadable as is by `node --test`, and that is its whole point. The three
 * gestures the integrity of the update channel depends on live here:
 *   - `parseManifest`: what we are willing to believe from a latest.json;
 *   - `verifyDigest`: the sha256 comparison that authorizes writing the
 *     VSIX to disk;
 *   - `isNewer`: what triggers an install proposal.
 * Breaking them without a test going red was possible before the extraction;
 * it is not any more (see test/updaterCore.test.mts).
 *
 * The complete threat model is documented at the top of `updater.ts`.
 */

export interface Manifest {
  version: string;
  vsix: string;
  /** sha256 hex digest of the VSIX — verified before installation. */
  sha256: string;
}

/** Is `a` strictly newer than `b`? (numeric x.y.z) */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

/**
 * Validates the JSON of a manifest and returns it typed, or throws.
 * `url` only enters the error messages (traceability of the source).
 */
export function parseManifest(raw: unknown, url: string): Manifest {
  const m = (raw ?? {}) as Partial<Manifest>;
  // typeof: RegExp.test and split coerce — a JSON array ["…"] would pass
  if (typeof m.version !== 'string' || typeof m.vsix !== 'string')
    throw new Error(`invalid manifest (version/vsix missing) — ${url}`);
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.sha256))
    throw new Error(
      `manifest without a valid sha256 digest — update refused (regenerate latest.json with "npm run vsix") — ${url}`,
    );
  return m as Manifest;
}

/**
 * Compares the digest computed over the downloaded buffer with the one
 * announced by the manifest, and THROWS if they differ. The caller writes to
 * disk only after this function returns normally.
 *
 * `digest` is supplied by the caller rather than computed here, to keep the
 * module free of any I/O — the comparison is the only gesture that matters,
 * and it is the one we want isolated so it can be tested.
 */
export function verifyDigest(digest: string, manifest: Manifest): void {
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase())
    throw new Error(
      `unexpected sha256 digest for ${manifest.vsix} (file corrupted or tampered with) — installation refused`,
    );
}
