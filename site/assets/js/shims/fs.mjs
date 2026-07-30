/**
 * `node:fs`, backed by a read-only map filled before the compiler is imported.
 *
 * WHY A MAP AND NOT `fetch`: `deck/layout.mjs` reads the twelve official layout
 * definitions with `readdirSync` + `readFileSync` at MODULE SCOPE. A browser
 * cannot await anything during module instantiation, so the files have to be
 * in memory BEFORE `import()` is called. `preload()` is how they get there, and
 * the ordering in `playground.js` is not a style choice — get it wrong and the
 * catalog silently comes up empty.
 *
 * That silence is the real hazard here. The `catch {}` around that block in
 * layout.mjs pushes no diagnostic, so a browser with no catalog renders a dozen
 * layouts with fallback geometry and reports no warning at all. The playground
 * therefore checks the catalog itself after loading, rather than trusting
 * `stats.warnings` to tell it.
 *
 * Writes are accepted and kept in the same map. Nothing needs them to persist —
 * they are the Lucide and Mermaid caches, which will never be read back in a
 * session — but a throwing `writeFileSync` would turn a cache miss into a
 * crash.
 */

const FILES = new Map();
const DIRS = new Set(['/']);

function noteDirs(file) {
  let dir = file.slice(0, file.lastIndexOf('/'));
  while (dir) {
    DIRS.add(dir);
    dir = dir.slice(0, dir.lastIndexOf('/'));
  }
}

/** Puts a file into the virtual filesystem. Called by playground.js before the
 *  compiler is imported — never by the compiler itself. */
export function preload(file, content) {
  const p = String(file);
  FILES.set(p, content);
  noteDirs(p);
}

/** What the virtual filesystem holds, for the playground's own sanity check. */
export const preloaded = () => [...FILES.keys()];

const enoent = (p, syscall) => {
  const e = new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`);
  e.code = 'ENOENT';
  e.path = String(p);
  return e;
};

/** Stands in for a Buffer well enough for the two things the compiler does with
 *  one: `.toString(enc)` and `.length`. Nothing here base64-encodes anything —
 *  the paths that would (font and image inlining) have no files to read. */
const bufferLike = (s) => ({
  toString: (enc) => (enc === 'base64' ? btoa(unescape(encodeURIComponent(s))) : s),
  get length() {
    return s.length;
  },
});

export const existsSync = (p) => FILES.has(String(p)) || DIRS.has(String(p));

export function readFileSync(p, options) {
  const key = String(p);
  const v = FILES.get(key);
  if (v === undefined) throw enoent(key, 'open');
  const enc = typeof options === 'string' ? options : options?.encoding;
  return enc ? v : bufferLike(v);
}

export function readdirSync(p) {
  const dir = String(p).replace(/\/$/, '');
  if (!DIRS.has(dir)) throw enoent(dir, 'scandir');
  const out = new Set();
  for (const f of FILES.keys()) {
    if (!f.startsWith(`${dir}/`)) continue;
    out.add(f.slice(dir.length + 1).split('/')[0]);
  }
  return [...out];
}

export function statSync(p) {
  const key = String(p);
  if (!existsSync(key)) throw enoent(key, 'stat');
  const isFile = FILES.has(key);
  return {
    isFile: () => isFile,
    isDirectory: () => !isFile,
    size: isFile ? FILES.get(key).length : 0,
    mtimeMs: 0,
  };
}

export const realpathSync = (p) => String(p);
export const writeFileSync = (p, data) => preload(p, String(data));
export const mkdirSync = (p) => {
  noteDirs(`${String(p)}/.`);
  return undefined;
};
export const mkdtempSync = (prefix) => `${String(prefix)}playground`;
export const rmSync = (p) => FILES.delete(String(p));
export const renameSync = (from, to) => {
  const v = FILES.get(String(from));
  if (v !== undefined) {
    preload(to, v);
    FILES.delete(String(from));
  }
};
export const copyFileSync = (from, to) => {
  const v = FILES.get(String(from));
  if (v === undefined) throw enoent(from, 'copyfile');
  preload(to, v);
};
export const chmodSync = () => undefined;
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

export default {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  copyFileSync,
  chmodSync,
  constants,
  preload,
  preloaded,
};
