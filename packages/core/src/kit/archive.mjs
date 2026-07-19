/**
 * `.deckkit` archives — pack, download, extract (see the "Kits" section of the
 * README, and SECURITY.md for the threat model).
 *
 * Lives in `src/kit/` and not in `src/deck/`: this module depends on JSZip, and
 * the `deck/` core knows no third-party library of that kind
 * (boundary.test.mjs). The distinction is also right on the merits —
 * compiling a deck knows nothing of archives; only the CLI installs. The
 * MANIFEST, for its part, stays in `deck/kit.mjs`: theme resolution needs it,
 * and it is pure.
 *
 * This is the ONLY place in the project that writes bytes coming from the
 * outside onto the user's disk. Everything that follows is a safeguard, and
 * none of them is optional:
 *
 *   1. PATH TRAVERSAL — any entry whose normalized path leaves the target
 *      directory is refused, absolute paths and `..` included. It is the
 *      classic bug of every unzipper ("zip slip").
 *   2. EXTENSION ALLOWLIST — a kit is DATA. No `.mjs`, `.js` or `.node` gets
 *      in. It is this property, and it alone, that makes installing from a URL
 *      defensible: nothing that is installed will ever be executed.
 *   3. LIMITS — archive size, uncompressed total, entry count. Without them,
 *      1 MB of archive can write 10 GB ("zip bomb").
 *   4. HTTPS ONLY, and never a redirect to another protocol.
 *   5. DIGEST — the SHA-256 of the archive is displayed and kept, so that the
 *      author of a kit can state what they published. It is NOT a signature:
 *      it does not authenticate the source, it allows comparison.
 *   6. ATOMIC EXTRACTION — everything is written to a neighboring temporary
 *      directory, validated, then swapped in by a rename(). An interrupted
 *      installation never leaves a half-written kit.
 *
 * The uncompressed total is checked DURING decompression (nodeStream), not
 * after: the size an archive announces is a declaration by the archive, hence
 * by a third party, and a single 10 GB file would exhaust memory before an
 * after-the-fact check ever got a word in.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import JSZip from 'jszip';
import { parseKitManifest, escapesKit, KIT_MANIFEST, KIT_EXT } from '../deck/kit.mjs';
import { remoteUrlRefusal } from '../deck/assets.mjs';

/** Safety limits. Generous for a real kit (a complete kit with its fonts and
 *  logos weighs ~500 KB), tight for a hostile archive. */
export const LIMITS = {
  archiveBytes: 20 * 1024 * 1024,
  extractedBytes: 100 * 1024 * 1024,
  entries: 500,
  redirects: 5,
};

/** Tooling directories, never packed: they belong to the kit's repository, not
 *  to the kit. `test/` is still walked — its .mjs files are skipped by the
 *  allowlist, but a .json or .png fixture has its place there. */
export const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.vscode', '.idea', 'dist']);

/** What a kit is allowed to contain. Data only: nothing executable. */
export const ALLOWED_EXT = new Set([
  '.json',
  '.md',
  '.txt',
  '.woff2',
  '.woff',
  '.ttf',
  '.otf',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

class KitArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KitArchiveError';
  }
}

const fail = (msg) => {
  throw new KitArchiveError(msg);
};

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// Reading an archive
// ---------------------------------------------------------------------------

/**
 * Checks an archive entry and returns its safe relative path.
 *
 * IMPORTANT NOTE — do not remove this check believing it dead. JSZip
 * normalizes entry names in loadAsync: "../../etc/passwd" becomes
 * "etc/passwd" there BEFORE reaching this point, including for an archive
 * built outside JSZip. Protection against path traversal therefore rests
 * today on the dependency, and this check is the SECOND line: it covers a
 * change in JSZip's behaviour, a replacement of the library, and the
 * extensions that are not admitted (which JSZip, for its part, lets through).
 * It is tested directly in kit-archive.test.mjs, for want of being testable
 * end to end.
 *
 * @returns {string|null} POSIX relative path, or null if the entry is to be ignored
 */
export function safeEntryPath(name) {
  // archives built under Windows carry `\` separators: under POSIX those are
  // NAME characters, so `..\..\x` would pass for a harmless file — escapesKit
  // normalizes them before judging
  if (name.endsWith('/')) return null; // directory: created implicitly
  if (escapesKit(name))
    fail(
      `Entry refused: "${name}" escapes the kit (absolute path or ".." traversal). Archive rejected.`,
    );
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext))
    fail(
      `Entry refused: "${name}" — extension "${ext || '(none)'}" not allowed in a kit. ` +
        `A kit contains only data (${[...ALLOWED_EXT].join(' ')}), never code.`,
    );
  return name.replace(/\\/g, '/');
}

/** Decompresses an entry while watching its REAL size as it goes. */
function readEntry(entry, budget) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > budget.remaining) {
        stream.destroy();
        reject(
          new KitArchiveError(
            `Archive refused: the uncompressed content exceeds ${Math.round(LIMITS.extractedBytes / 1024 / 1024)} MB ` +
              `(entry "${entry.name}"). Archive rejected.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      budget.remaining -= size;
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Reads a `.deckkit` archive IN MEMORY and validates everything that can be
 * validated before a single byte touches the disk: entries, manifest, limits.
 *
 * @param {Buffer} buf
 * @returns {Promise<{ manifest: object, files: Map<string, Buffer>,
 *                     digest: string, diagnostics: Array }>}
 */
export async function readKitArchive(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) fail('Empty archive.');
  if (buf.length > LIMITS.archiveBytes)
    fail(
      `Archive refused: ${Math.round(buf.length / 1024 / 1024)} MB > ${Math.round(LIMITS.archiveBytes / 1024 / 1024)} MB.`,
    );

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    fail(`Archive could not be read: ${e?.message ?? e} — a ${KIT_EXT} file is a zip archive.`);
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > LIMITS.entries)
    fail(`Archive refused: ${entries.length} entries > ${LIMITS.entries}.`);
  if (!entries.length) fail('Empty archive: no file.');

  const budget = { remaining: LIMITS.extractedBytes };
  const files = new Map();
  for (const entry of entries) {
    const rel = safeEntryPath(entry.name);
    if (rel === null) continue;
    files.set(rel, await readEntry(entry, budget));
  }

  // the manifest must be at the ROOT: an archive that wraps its kit in a
  // directory (the reflex of many compression tools) is a frequent and honest
  // case — saying so precisely is worth more than an "invalid"
  const raw = files.get(KIT_MANIFEST);
  if (!raw) {
    const elsewhere = [...files.keys()].find((f) => f.endsWith(`/${KIT_MANIFEST}`));
    fail(
      elsewhere
        ? `Archive refused: ${KIT_MANIFEST} found in "${elsewhere}" and not at the root. Compress the CONTENTS of the kit, not the directory that holds it.`
        : `Archive refused: no ${KIT_MANIFEST} at the root.`,
    );
  }

  let json;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    fail(`Archive refused: ${KIT_MANIFEST} — invalid JSON (${e?.message ?? e}).`);
  }
  const { manifest, diagnostics } = parseKitManifest(json, { where: `${KIT_MANIFEST} (archive)` });
  if (!manifest) {
    const err = diagnostics.find((d) => d.severity === 'error');
    fail(`Archive refused: ${err?.message ?? 'invalid manifest'}`);
  }

  return { manifest, files, digest: sha256(buf), diagnostics };
}

// ---------------------------------------------------------------------------
// Writing an archive
// ---------------------------------------------------------------------------

/**
 * Packs the kit directory `dir` into a `.deckkit` archive.
 *
 * Applies the SAME rules as extraction: what we would refuse to install must
 * not be producible here — otherwise the author of a kit discovers the refusal
 * at their users' end rather than at their own.
 *
 * @returns {Promise<{ buffer: Buffer, manifest: object, entries: string[], skipped: string[] }>}
 */
export async function packKit(dir) {
  const root = path.resolve(dir);
  const manifestPath = path.join(root, KIT_MANIFEST);
  if (!fs.existsSync(manifestPath))
    fail(`${root} contains no ${KIT_MANIFEST} — this is not a kit.`);

  let json;
  try {
    json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail(`${KIT_MANIFEST} could not be read: ${e?.message ?? e}`);
  }
  const { manifest } = parseKitManifest(json, { where: manifestPath });
  if (!manifest) fail(`${KIT_MANIFEST} invalid — fix the manifest before packing.`);

  const zip = new JSZip();
  const entries = [];
  const skipped = [];
  let total = 0;

  const walk = (abs, rel) => {
    for (const e of fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      // a symbolic link would be followed outside the kit: never packed
      if (e.isSymbolicLink()) {
        skipped.push(`${childRel} (symbolic link)`);
        continue;
      }
      // kit DEVELOPMENT tooling: never in the archive. Without this, a kit
      // that has its own tests carries all of node_modules — including the
      // dependencies' package.json files, which the ".json" allowlist lets
      // through without blinking. Silent: this is not "skipped", it is beside
      // the point, and reporting it would drown the real warnings.
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      if (e.isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      if (!e.isFile()) {
        skipped.push(`${childRel} (special file)`);
        continue;
      }
      if (!ALLOWED_EXT.has(path.extname(e.name).toLowerCase())) {
        skipped.push(`${childRel} (extension not allowed)`);
        continue;
      }
      const buf = fs.readFileSync(childAbs);
      total += buf.length;
      if (total > LIMITS.extractedBytes)
        fail(`Kit too large: > ${Math.round(LIMITS.extractedBytes / 1024 / 1024)} MB.`);
      if (entries.length >= LIMITS.entries) fail(`Kit has too many files: > ${LIMITS.entries}.`);
      zip.file(childRel, buf);
      entries.push(childRel);
    }
  };
  walk(root, '');

  // fixed date: two packings of the same content give the same bytes, hence
  // the same digest — otherwise the published SHA-256 changes on every
  // `kit create` and no longer means anything
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    date: new Date(0),
  });
  if (buffer.length > LIMITS.archiveBytes)
    fail(`Produced archive too large: ${Math.round(buffer.length / 1024 / 1024)} MB.`);
  return { buffer, manifest, entries, skipped };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Downloads an archive over HTTPS. Refuses every other protocol, including
 * after a redirect: an https URL that sends you to file:// or http:// is an
 * attack, not a convenience.
 *
 * The SAME address guard as remote images (remoteUrlRefusal: DNS resolution +
 * refusal of private/local addresses) is replayed before every connection and
 * at every redirect hop — without it, an https URL pointing at 127.0.0.1 or an
 * internal address would serve as a probe of the victim's network. The https
 * check below applies in addition.
 *
 * @returns {Promise<Buffer>}
 */
export function fetchKitArchive(url, { redirectsLeft = LIMITS.redirects } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.reject(new KitArchiveError(`Invalid URL: ${url}`));
  }
  if (parsed.protocol !== 'https:')
    return Promise.reject(
      new KitArchiveError(
        `Protocol refused: ${parsed.protocol}// — only https is accepted for installing a kit.`,
      ),
    );

  return remoteUrlRefusal(url).then(
    (refusal) =>
      new Promise((resolve, reject) => {
        if (refusal) {
          reject(new KitArchiveError(`Address refused: ${refusal}`));
          return;
        }
        const req = https.get(parsed, (res) => {
          const { statusCode, headers } = res;

          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            res.resume(); // release the socket
            if (redirectsLeft <= 0) {
              reject(new KitArchiveError(`Too many redirects (> ${LIMITS.redirects}): ${url}`));
              return;
            }
            const next = new URL(headers.location, parsed).toString();
            resolve(fetchKitArchive(next, { redirectsLeft: redirectsLeft - 1 }));
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new KitArchiveError(`Download failed: HTTP ${statusCode} — ${url}`));
            return;
          }

          // Content-Length is only an announcement: refusing early avoids the
          // transfer, the running total below is what actually protects
          const declared = Number(headers['content-length']);
          if (Number.isFinite(declared) && declared > LIMITS.archiveBytes) {
            res.destroy();
            reject(
              new KitArchiveError(
                `Archive refused: ${Math.round(declared / 1024 / 1024)} MB announced > ${Math.round(LIMITS.archiveBytes / 1024 / 1024)} MB.`,
              ),
            );
            return;
          }

          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > LIMITS.archiveBytes) {
              res.destroy();
              reject(
                new KitArchiveError(
                  `Archive refused: download > ${Math.round(LIMITS.archiveBytes / 1024 / 1024)} MB, interrupted.`,
                ),
              );
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        });
        req.on('error', (e) => reject(new KitArchiveError(`Download failed: ${e?.message ?? e}`)));
        req.setTimeout(30_000, () => {
          req.destroy();
          reject(new KitArchiveError(`Download failed: timed out (30 s) — ${url}`));
        });
      }),
  );
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/**
 * Installs an already-read archive under `kitsDir/<manifest.name>`.
 *
 * The installation name comes from the MANIFEST, never from the file name: the
 * latter is chosen by whoever distributes the archive, and `parseKitManifest`
 * has already proved that `manifest.name` cannot traverse the file system.
 *
 * @returns {{ dir: string, replaced: boolean }}
 */
export function installKitArchive({ manifest, files, digest }, kitsDir, { force = false } = {}) {
  const dest = path.join(path.resolve(kitsDir), manifest.name);
  const replaced = fs.existsSync(dest);
  if (replaced && !force)
    fail(
      `The kit "${manifest.name}" is already installed (${dest}). Re-run with --force to replace it.`,
    );

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // NEIGHBORING temporary directory: a rename() is atomic only within the same
  // file system, which /tmp does not guarantee
  const staging = fs.mkdtempSync(`${dest}.tmp-`);
  try {
    for (const [rel, buf] of files) {
      const abs = path.join(staging, rel);
      // belt AND braces: safeEntryPath has already judged every path, we
      // re-check against the REAL directory before writing
      const r = path.relative(staging, abs);
      if (r.startsWith('..') || path.isAbsolute(r)) fail(`Entry refused at write time: "${rel}".`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
    }
    fs.writeFileSync(path.join(staging, '.integrity'), `${digest}\n`);

    if (replaced) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staging, dest);
    return { dir: dest, replaced };
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

export { KitArchiveError };
