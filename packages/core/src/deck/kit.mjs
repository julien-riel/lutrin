/**
 * Kits — a theme, its layouts and its assets as one distributable unit
 * (see the "Kits" section of the README).
 *
 * A KIT is a directory carrying a `kit.json` manifest:
 *
 *   my-kit/
 *   ├── kit.json          manifest — the only mandatory file
 *   ├── theme.json        design tokens (theme schema, see theme.mjs)
 *   ├── layouts/*.json    layouts
 *   ├── fonts/*.woff2     optional
 *   └── logo/*.svg        optional
 *
 * It is distributed either as is, or compressed into a `.deckkit` file (a zip
 * archive). The extension describes the CONTENT — a deck kit — and not the
 * tool that reads it: a format named after its tool ages badly the day some
 * other tool reads it.
 *
 * This module knows only the manifest: reading it, validating it, and
 * resolving its paths INSIDE the kit. It deliberately ignores installation, the
 * zip archive and applying the theme — that is what makes it testable on its
 * own, and what lets `kit install` validate a kit before writing it anywhere.
 *
 * Two rules carry the whole safety of the format:
 *
 *   1. `name` is constrained (`KIT_NAME_RE`) because it becomes a directory
 *      name at install time. Validating it here closes path traversal BY THE
 *      MANIFEST — a kit cannot name itself `../../bin`.
 *   2. `theme` and `layouts` are resolved by `insideKit()`, which refuses any
 *      path leaving the kit. A manifest never designates a file on the host
 *      system.
 *
 * As in resolveTheme, nothing ever throws: a manifest that could not be read
 * becomes an `error` diagnostic and `manifest: null`. The caller decides
 * (refuse the installation, ignore the kit) — this module does not decide on
 * its behalf.
 */

import fs from 'node:fs';
import path from 'node:path';
import { closest } from './suggest.mjs';

/** Name of the manifest, at the root of the kit. */
export const KIT_MANIFEST = 'kit.json';

/** Extension of an archived kit. */
export const KIT_EXT = '.deckkit';

/**
 * Accepted kit names: lowercase letters, digits and hyphens, 64 characters at
 * most, starting with an alphanumeric character.
 *
 * This is the name of the installation directory, so the constraint is a
 * safety one before it is an aesthetic one: neither `.`, nor `/`, nor `..`
 * gets through, which makes `<config>/kits/<name>` untraversable whatever the
 * manifest says.
 */
export const KIT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Top-level keys recognized in a kit.json. */
export const KIT_KEYS = [
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'theme',
  'layouts',
];

/** Default values of the two paths — a kit that follows the convention only
 *  has to declare its name. */
const DEFAULT_THEME = './theme.json';
const DEFAULT_LAYOUTS = './layouts';

/** `1.0.0`, `1.0.0-beta.2` — enough to order and to display, without carrying
 *  a full semver parser the format has no need for. */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Does a relative path leave the kit? A purely LEXICAL verdict, with no disk:
 * this is the check a manifest can undergo before the kit exists anywhere
 * (an archive validated in memory). `insideKit` adds the disk to it.
 *
 * Windows separators are normalized first: under POSIX, `..\\..\\x` is a valid
 * file name, and letting it through would turn an archive crafted under
 * Windows into an escape on the other platforms.
 */
export function escapesKit(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return true;
  const norm = path.normalize(rel.replace(/\\/g, '/'));
  if (path.isAbsolute(norm) || /^[A-Za-z]:/.test(norm)) return true;
  return norm === '..' || norm.startsWith(`..${path.sep}`) || norm.startsWith('../');
}

/**
 * Resolves `rel` under `kitDir` and refuses anything that leaves it.
 *
 * The symbolic link is checked AFTER resolution (realpath): without that, a
 * kit could carry a link `theme.json → /etc/passwd`, whose declared path is
 * nonetheless irreproachable. A link that stays inside the kit is accepted.
 *
 * @returns {string|null} absolute path, or null if it leaves the kit
 */
export function insideKit(kitDir, rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const root = path.resolve(kitDir);
  const abs = path.resolve(root, rel);
  const within = (p, base) => {
    const r = path.relative(base, p);
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
  };
  if (!within(abs, root)) return null;
  // Comparing a realpath against a root that is not one would make every
  // legitimate file look escaped as soon as the root crosses a symbolic
  // link — the case of /var → /private/var under macOS, and of many a HOME.
  // So both sides are dereferenced, or neither.
  try {
    const realRoot = fs.realpathSync(root);
    // the path may not exist yet (manifest validated off disk): with no link
    // to dereference, the lexical check above is enough
    if (!within(fs.realpathSync(abs), realRoot)) return null;
  } catch {
    /* nonexistent — the caller will report the absence, not an escape */
  }
  return abs;
}

/**
 * Validates an ALREADY parsed manifest (no disk access).
 *
 * Separated from `readKit` so that validating a `kit.json` extracted from an
 * archive in memory — which is what `kit install` will do before writing
 * anything at all — goes through exactly the same code as validating a kit on
 * disk.
 *
 * @param {unknown} json  content of the kit.json
 * @param {{ where?: string }} [opts]  label of the source, for the messages
 * @returns {{ manifest: object|null, diagnostics: Array<{severity, code, message, suggestion?}> }}
 *          `manifest` is CLEANED UP: unknown keys dropped, `theme` and
 *          `layouts` normalized to their effective value.
 */
export function parseKitManifest(json, { where = KIT_MANIFEST } = {}) {
  const diags = [];
  const push = (severity, code, message, suggestion) =>
    diags.push({ severity, code, message, ...(suggestion ? { suggestion } : {}) });
  const fail = (message) => {
    push('error', 'KIT_INVALID', message);
    return { manifest: null, diagnostics: diags };
  };

  if (!isPlainObject(json)) return fail(`Kit: ${where} must contain a JSON object.`);

  // --- name: the only mandatory key, and the only one that can invalidate ----
  if (typeof json.name !== 'string' || !json.name.trim())
    return fail(
      `Kit: ${where} must declare a "name" (non-empty string) — it is the name the kit installs under and is referenced by.`,
    );
  const name = json.name.trim();
  if (!KIT_NAME_RE.test(name))
    return fail(
      `Kit: "${name}" is not an allowed name — lowercase letters, digits and hyphens, 64 characters at most, starting with a letter or a digit (e.g. "brand-acme"). The name becomes a directory at install time.`,
    );

  const manifest = { name, theme: DEFAULT_THEME, layouts: DEFAULT_LAYOUTS };

  for (const key of Object.keys(json)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (!KIT_KEYS.includes(key))
      push(
        'warning',
        'KIT_UNKNOWN_KEY',
        `Kit: unknown key "${key}" in ${where} — ignored.`,
        closest(key, KIT_KEYS) ?? undefined,
      );
  }

  // --- version: optional, but if it is there it must be usable --------------
  if (json.version != null) {
    if (typeof json.version === 'string' && VERSION_RE.test(json.version.trim()))
      manifest.version = json.version.trim();
    else push('warning', 'KIT_BAD_VALUE', 'Kit: version must be of the form "1.0.0" — ignored.');
  }

  // --- display metadata -----------------------------------------------------
  for (const key of ['description', 'author', 'homepage']) {
    if (json[key] == null) continue;
    if (typeof json[key] === 'string' && json[key].trim()) manifest[key] = json[key].trim();
    else push('warning', 'KIT_BAD_VALUE', `Kit: ${key} must be a non-empty string — ignored.`);
  }

  // --- paths: validated for their FORM here, for existence in readKit -------
  // "leaves the kit" is an error, not a warning: unlike an unknown key, it
  // reveals a manifest attempting to reach the host.
  for (const key of ['theme', 'layouts']) {
    if (json[key] == null) continue;
    if (typeof json[key] !== 'string' || !json[key].trim()) {
      push(
        'warning',
        'KIT_BAD_VALUE',
        `Kit: ${key} must be a relative path inside the kit (e.g. "${key === 'theme' ? DEFAULT_THEME : DEFAULT_LAYOUTS}") — default value kept.`,
      );
      continue;
    }
    const rel = json[key].trim();
    if (escapesKit(rel))
      return fail(
        `Kit: ${where} — the path "${rel}" of ${key} leaves the kit; a manifest only designates its own files.`,
      );
    manifest[key] = rel;
  }

  return { manifest, diagnostics: diags };
}

/**
 * Reads and validates the kit installed (or unpacked) in `kitDir`.
 *
 * To the manifest is added what only the disk can tell: the effective paths of
 * `theme.json` and of `layouts/`, and the absence of both — a kit that brings
 * neither design tokens nor layouts brings nothing, and reporting that at
 * install time is better than discovering it at compile time.
 *
 * The directory name does NOT have to equal `manifest.name` here: an archive
 * unpacks wherever the caller wants. It is `kit install` that installs under
 * `manifest.name`, and it alone.
 *
 * @returns {{ manifest: object|null, dir: string, themeFile: string|null,
 *             layoutsDir: string|null,
 *             diagnostics: Array<{severity, code, message, suggestion?}> }}
 */
export function readKit(kitDir) {
  const dir = path.resolve(kitDir);
  const bare = { manifest: null, dir, themeFile: null, layoutsDir: null };
  const file = path.join(dir, KIT_MANIFEST);

  if (!isDir(dir))
    return {
      ...bare,
      diagnostics: [
        {
          severity: 'error',
          code: 'KIT_NOT_FOUND',
          message: `Kit: ${dir} is not a directory.`,
        },
      ],
    };

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {
      ...bare,
      diagnostics: [
        {
          severity: 'error',
          code: 'KIT_NOT_FOUND',
          message: `Kit: ${KIT_MANIFEST} not found in ${dir} — a kit must carry its manifest at its root.`,
        },
      ],
    };
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return {
      ...bare,
      diagnostics: [
        {
          severity: 'error',
          code: 'KIT_INVALID',
          message: `Kit: ${file} — invalid JSON (${e?.message ?? e}).`,
        },
      ],
    };
  }

  const { manifest, diagnostics } = parseKitManifest(json, { where: file });
  if (!manifest) return { ...bare, diagnostics };

  // insideKit can no longer return null (parseKitManifest has already refused
  // escaping paths), EXCEPT through a symbolic link — which only the disk
  // reveals.
  const themeAbs = insideKit(dir, manifest.theme);
  const layoutsAbs = insideKit(dir, manifest.layouts);
  if (manifest.theme !== DEFAULT_THEME && !themeAbs)
    diagnostics.push({
      severity: 'error',
      code: 'KIT_INVALID',
      message: `Kit: theme "${manifest.theme}" leaves the kit (symbolic link) — kit skipped.`,
    });
  if (manifest.layouts !== DEFAULT_LAYOUTS && !layoutsAbs)
    diagnostics.push({
      severity: 'error',
      code: 'KIT_INVALID',
      message: `Kit: layouts "${manifest.layouts}" leaves the kit (symbolic link) — kit skipped.`,
    });
  if (diagnostics.some((d) => d.severity === 'error')) return { ...bare, diagnostics };

  const themeFile = themeAbs && isFile(themeAbs) ? themeAbs : null;
  const layoutsDir = layoutsAbs && isDir(layoutsAbs) ? layoutsAbs : null;

  // a theme that is DECLARED but absent is an error in the kit; the default
  // being absent is only the absence of design tokens, legitimate for a kit of
  // layouts alone
  if (!themeFile && manifest.theme !== DEFAULT_THEME)
    diagnostics.push({
      severity: 'error',
      code: 'KIT_INVALID',
      message: `Kit "${manifest.name}": theme "${manifest.theme}" declared but not found.`,
    });
  else if (!themeFile && !layoutsDir)
    diagnostics.push({
      severity: 'error',
      code: 'KIT_INVALID',
      message: `Kit "${manifest.name}": neither ${DEFAULT_THEME} nor ${DEFAULT_LAYOUTS}/ — a kit must bring design tokens, layouts, or both.`,
    });

  if (diagnostics.some((d) => d.severity === 'error')) return { ...bare, diagnostics };
  return { manifest, dir, themeFile, layoutsDir, diagnostics };
}
