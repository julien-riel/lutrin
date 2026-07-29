/**
 * `lutrin kit edit` — the local HTTP server behind the kit editor UI.
 *
 * One server = one kit directory. The API reads the kit, compiles a specimen
 * (or caller-provided) deck under the kit — optionally with an IN-MEMORY
 * overlay (`kitData`, see prepareDeckContext) so the editor previews unsaved
 * state — and writes theme/layouts/fonts/images (and the manifest's display
 * metadata) back to disk. The UI itself is the editor SPA served statically
 * from design/editor/.
 *
 * Exposed as a function (rather than wired into the CLI) so tests can start
 * it on an ephemeral port: `startKitEditServer(kitDir, { port })` →
 * `{ server, port, close }`.
 *
 * SECURITY MODEL — the kit holds user data and the server writes to disk:
 *   - binds 127.0.0.1 only, refuses non-local `Host` headers (DNS-rebinding
 *     guard shared with `lutrin preview` — serve.mjs);
 *   - every non-GET request with an `Origin` header must come from the
 *     editor's own origin, otherwise 403 — a malicious page cannot silently
 *     rewrite the kit through the victim's browser (requests WITHOUT Origin,
 *     i.e. curl and same-machine tools, pass);
 *   - body sizes are capped per route (JSON 2 MB, binaries 15 MB) and the
 *     read is bounded — past the cap the connection is cut;
 *   - every write is `join(kitDir, <fixed subdir>, <sanitized basename>)` —
 *     no client-supplied path ever reaches a free join;
 *   - reads (`/api/files/…`) are confined to the kit by the SAME
 *     lexical+realpath guard as the manifest paths (escapesKit/insideKit,
 *     kit.mjs) — an escaping symlink is a 404, not a disclosure — and they
 *     are served INERT: a restricted type map (images and fonts only,
 *     everything else as text) plus `Content-Security-Policy: default-src
 *     'none'; sandbox`, so third-party kit content never becomes active
 *     content on the origin that owns the write API;
 *   - the static side serves ONLY design/editor/, no directory listing,
 *     `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`
 *     everywhere.
 *
 * COMPILATION MODEL — compileHtml/prepareDeckContext mutate module state
 * (theme tokens, layout registry), so every call that touches them is
 * SERIALIZED through one promise chain. /api/compile is additionally
 * LATEST-WINS: each request takes a ticket, and a request whose ticket is no
 * longer the newest when its turn comes answers 409 {error:'superseded'}
 * WITHOUT compiling — chosen over coalescing because it is a dozen lines,
 * has no shared-response plumbing, and the editor (which fires a compile per
 * keystroke burst) only ever cares about the newest state anyway.
 *
 * BASE DIRECTORY of compilations: the editor's asset directory
 * (design/editor/), NOT the kit directory. Deliberate deviation: with
 * `baseDir = kitDir`, prepareDeckContext would load `<kit>/layouts/*.json`
 * twice — once as the kit's layouts (via the manifest) and once as
 * deck-local layouts (`loadUserLayouts(baseDir)` reads `<baseDir>/layouts`)
 * — and every kit layout would collide with itself on every compile. The
 * specimen references no relative image, and kit images travel by
 * `kit:<alias>` which ignores baseDir, so nothing is lost.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSseHub, listenFromPort, refuseNonLocalHost } from '../serve.mjs';
import { KIT_MANIFEST, escapesKit, insideKit, parseKitManifest, readKit } from '../deck/kit.mjs';
import { IMAGE_ALIAS_RE, KIT_IMAGE_EXTS, resolveTheme } from '../deck/theme.mjs';
import { validateDeck } from '../deck/validate.mjs';
import {
  LAYOUTS,
  layoutDef,
  layoutParamSchema,
  loadThemeLayoutDefs,
  resetUserLayouts,
} from '../deck/layout.mjs';
import { compileHtml } from '../html/render.mjs';
import { packKit, sha256 } from './archive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The editor UI (and the specimen deck) — the ONLY directory the static
 *  side serves, and the baseDir of compilations (module header). */
const EDITOR_DIR = path.resolve(HERE, '..', '..', 'design', 'editor');
const DEFAULT_THEME_FILE = path.resolve(HERE, '..', '..', 'design', 'themes', 'default.json');
const PKG_FILE = path.resolve(HERE, '..', '..', 'package.json');
const SPECIMEN_FILE = path.join(EDITOR_DIR, 'specimen.deck.md');

export const KIT_EDIT_DEFAULT_PORT = 4322; // preview owns 4321 — both must run side by side

const JSON_BODY_MAX = 2 * 1024 * 1024;
const BINARY_BODY_MAX = 15 * 1024 * 1024;
/** Auto-write suppression window: a path the server itself wrote within the
 *  last 2 s does not emit `kit-changed` (the editor already knows). */
const AUTO_WRITE_WINDOW_MS = 2000;
const WATCH_DEBOUNCE_MS = 150;

const FONT_EXTS = new Set(['.ttf', '.woff2']);
/** Uploaded font file names: a plain basename, nothing an OS or a shell
 *  reinterprets. The PAIR rule (each .ttf needs its .woff2 twin) is the
 *  core's — the API only stores; /api/state reports the pair status. */
const FONT_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Path gate for /api/layouts/<name>, applied on EVERY method before the name
 *  reaches a join: the layout rules are registerLayout's (validateLayoutDef
 *  below), but the safety of the write path may not depend on them — it is
 *  this regex, and nothing else, that makes the URL segment joinable as a file
 *  name. It mirrors LAYOUT_NAME_RE (layout.mjs), which accepts a strict
 *  subset of it. */
const LAYOUT_FILE_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** Content types the STATIC side (design/editor/, our own files) declares. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

/**
 * Content types /api/files may declare — a DELIBERATELY smaller map than the
 * static side's.
 *
 * A kit is third-party content (cloned from a repository, installed from a
 * .deckkit) and this route hands its bytes to the browser ON THE ORIGIN THAT
 * OWNS THE WRITE API. So no kit file may ever be served as something the
 * browser executes: the image and font types the editor displays keep their
 * real type, everything else — a docs/*.html, a *.js, the JSON files — is
 * served as inert text. `nosniff` is not the point here: the danger is the
 * type we DECLARE, not one the browser guesses.
 */
const KIT_FILE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};
const KIT_FILE_TEXT = 'text/plain; charset=utf-8';
/** An SVG must stay image/svg+xml to be usable in <img> — and an SVG can
 *  carry <script>, which does run when the URL is opened as a document. This
 *  header is what disarms it: `default-src 'none'` grants no script, no
 *  fetch, no subresource, and `sandbox` (with no allow-* token) puts the
 *  document in an opaque origin, so nothing served here can reach the API.
 *  It is the invariant archive.mjs promises about an installed kit ("nothing
 *  that is installed will ever be executed"), applied to the one route that
 *  serves kit bytes to a browser. */
const KIT_FILE_CSP = "default-src 'none'; sandbox";

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** An Error the router knows how to answer: status + optional JSON payload. */
function httpError(status, message, payload = null) {
  return Object.assign(new Error(message), { status, payload });
}

const baseHeaders = (extra = {}) => ({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  ...extra,
});

function sendJson(res, status, obj) {
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(obj));
}

const sendError = (res, status, message) => sendJson(res, status, { error: message });

/**
 * Reads a request body, BOUNDED: past `cap` bytes the promise rejects with a
 * 413 and the caller cuts the connection — a client cannot fill the disk or
 * the heap through a route whose declared cap is smaller.
 */
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > cap) {
        req.off('data', onData); // stop buffering NOW — the router cuts the socket
        reject(httpError(413, `body exceeds the ${Math.round(cap / 1024 / 1024)} MB cap.`));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** JSON body of a mutating route: empty body = {} (a bare `curl -X POST`),
 *  anything unparsable or non-object is a named 400. */
async function jsonBody(req) {
  const buf = await readBody(req, JSON_BODY_MAX);
  if (!buf.length) return {};
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw httpError(400, `invalid JSON body (${e?.message ?? e}).`);
  }
  if (!isPlainObject(json)) throw httpError(400, 'a JSON object body is expected.');
  return json;
}

/**
 * Magic-byte check of an uploaded image: the extension promises a format, the
 * first bytes must keep that promise (a .png that opens with an HTML tag is
 * not an image, whatever it claims). SVG has no magic number — a coarse
 * `<svg` scan of the head is the honest equivalent.
 */
function sniffImage(ext, buf) {
  switch (ext) {
    case '.png':
      return (
        buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a
      );
    case '.jpg':
    case '.jpeg':
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case '.gif': {
      const head = buf.subarray(0, 6).toString('latin1');
      return head === 'GIF87a' || head === 'GIF89a';
    }
    case '.webp':
      return (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buf.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case '.svg':
      return /<svg[\s>]/i.test(buf.subarray(0, 1024).toString('utf8'));
    default:
      return false;
  }
}

/**
 * Magic-byte check of an uploaded font — the same promise-keeping rule as
 * sniffImage: a .woff2 must open with 'wOF2', a .ttf with the sfnt version
 * (0x00010000), 'true' (legacy Apple TrueType) or 'OTTO' (CFF outlines in an
 * OpenType container — common under a .ttf name). A misnamed or corrupted
 * file would otherwise ride silently into exports: the editor's FontFace
 * preview just falls back, and nobody notices until the brand font never
 * shows.
 */
function sniffFont(ext, buf) {
  if (buf.length < 4) return false;
  const tag = buf.readUInt32BE(0);
  if (ext === '.woff2') return tag === 0x774f4632; // 'wOF2'
  return tag === 0x00010000 || tag === 0x74727565 || tag === 0x4f54544f; // sfnt | 'true' | 'OTTO'
}

/**
 * Starts the kit editor server for `kitDir`.
 *
 * @param {string} kitDir directory carrying kit.json
 * @param {{ port?: number }} [opts] first port tried (4322 by default;
 *        busy ports fall through like the preview's; 0 = OS-assigned)
 * @returns {Promise<{ server: import('node:http').Server, port: number,
 *                     close: () => Promise<void> }>}
 */
export async function startKitEditServer(kitDir, { port = KIT_EDIT_DEFAULT_PORT } = {}) {
  const root = path.resolve(kitDir);

  // ------ shared mutable state ---------------------------------------------
  const sse = createSseHub();
  /** rel path (posix) → timestamp of the server's own write (suppression). */
  const recentWrites = new Map();
  /** One chain for everything that mutates compiler module state. */
  let chain = Promise.resolve();
  const serialized = (job) => {
    const run = chain.then(job);
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  let compileSeq = 0;

  const relOf = (abs) => path.relative(root, abs).split(path.sep).join('/');

  /**
   * Confines a path to the kit BY REALPATH — the write-and-enumerate twin of
   * serveKitFile's read guard, and the fix for their asymmetry. serveKitFile
   * re-resolves every read through realpath, so an escaping symlink is a 404;
   * the write routes (theme/image/font/layout) and buildState's directory
   * listings did NOT, so a kit distributed as a DIRECTORY carrying
   * `theme.json → /outside` or `images/ → /outside` had its writes follow the
   * link out of the kit and its listings disclose the target's file names.
   *
   * The target may not exist yet (a fresh upload): the deepest path component
   * that DOES exist — the leaf when present (an overwrite, possibly through a
   * symlink), else its nearest existing ancestor (a symlinked subdir the leaf
   * mkdir would create inside) — is realpath-resolved and must land inside the
   * kit. `lstat` (never `stat`) drives the climb, so even a dangling symlink is
   * seen rather than skipped.
   *
   * @returns {string|null} the same absolute path when confined, else null
   */
  function confinedTarget(abs) {
    const target = path.resolve(abs);
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      return null;
    }
    const within = (p) => {
      const r = path.relative(realRoot, p);
      return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
    };
    let probe = target;
    for (;;) {
      let exists = true;
      try {
        fs.lstatSync(probe); // lstat: a symlink (dangling or not) counts as existing
      } catch {
        exists = false;
      }
      if (exists) {
        try {
          return within(fs.realpathSync(probe)) ? target : null;
        } catch {
          return null; // a dangling symlink on the path — refuse
        }
      }
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }

  /** The write anchor confined to the kit, or a 403 — every mutating route runs
   *  its target through here before mkdir/writeFileSync. */
  function confineWrite(abs) {
    const safe = confinedTarget(abs);
    if (!safe) throw httpError(403, `refused: ${relOf(abs)} resolves outside the kit.`);
    return safe;
  }

  /** Records a server-side write (or delete) for auto-write suppression —
   *  the file itself and its directory (creates/renames touch the parent). */
  function recordWrite(abs) {
    const rel = relOf(abs);
    const now = Date.now();
    recentWrites.set(rel, now);
    const dir = path.posix.dirname(rel);
    if (dir && dir !== '.') recentWrites.set(dir, now);
  }

  // ------ manifest-anchored paths (re-read per request: the kit is live) ----
  const manifestOf = () => readKit(root).manifest;
  const themeAnchorOf = (manifest) =>
    (manifest ? insideKit(root, manifest.theme) : null) ?? path.join(root, 'theme.json');
  const layoutsDirOf = (manifest) =>
    (manifest ? insideKit(root, manifest.layouts) : null) ?? path.join(root, 'layouts');

  // ------ routes -------------------------------------------------------------

  function buildState() {
    const { manifest, themeFile, layoutsDir, diagnostics } = readKit(root);
    const anchor = themeAnchorOf(manifest);
    const themeDir = path.dirname(anchor);

    // theme AS WRITTEN (the editor round-trips it), not the cleaned object
    let theme = null;
    if (themeFile) {
      try {
        const parsed = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
        if (isPlainObject(parsed)) theme = parsed;
      } catch {
        /* unreadable: theme stays null, kitDiagnostics carry the story */
      }
    }

    // layouts/*.json — name, file, raw definition
    const layouts = [];
    const layoutsRoot = layoutsDir ?? layoutsDirOf(manifest);
    let layoutFiles = [];
    try {
      // confined like serveKitFile: a symlinked layouts/ that escapes the kit
      // must not have its target directory enumerated
      if (confinedTarget(layoutsRoot))
        layoutFiles = fs
          .readdirSync(layoutsRoot)
          .filter((f) => f.toLowerCase().endsWith('.json'))
          .sort();
    } catch {
      /* no layouts directory */
    }
    for (const f of layoutFiles) {
      const file = path.join(layoutsRoot, f);
      let def = null;
      try {
        def = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* def stays null: the editor shows the file as broken */
      }
      layouts.push({
        name: typeof def?.name === 'string' ? def.name : f.replace(/\.json$/i, ''),
        file: relOf(file),
        def,
      });
    }

    // fonts/: what is on disk, and the pair status of what the theme declares
    const fontsDir = path.join(root, 'fonts');
    const fontFiles = [];
    try {
      if (!confinedTarget(fontsDir)) throw new Error('fonts/ escapes the kit');
      for (const e of fs.readdirSync(fontsDir, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        fontFiles.push({
          file: relOf(path.join(fontsDir, e.name)),
          bytes: fs.statSync(path.join(fontsDir, e.name)).size,
        });
      }
      fontFiles.sort((a, b) => a.file.localeCompare(b.file));
    } catch {
      /* no fonts directory */
    }
    const pairs = [];
    const declared = isPlainObject(theme?.fonts) ? theme.fonts.files : null;
    if (isPlainObject(declared)) {
      for (const variant of ['regular', 'bold', 'italic']) {
        if (typeof declared[variant] !== 'string') continue;
        const p = declared[variant];
        const abs = path.resolve(themeDir, p);
        const inKit = insideKit(root, path.relative(root, abs)) !== null;
        const ttf = inKit && path.extname(abs).toLowerCase() === '.ttf' && isFile(abs);
        const woff2 = ttf && isFile(abs.replace(/\.ttf$/i, '.woff2'));
        pairs.push({ variant, path: p, ttf, woff2 });
      }
    }

    // images declared by the theme + the orphans sitting in images/
    const images = [];
    const referenced = new Set();
    if (isPlainObject(theme?.images)) {
      for (const [alias, p] of Object.entries(theme.images)) {
        if (typeof p !== 'string') continue;
        const abs = path.resolve(themeDir, p);
        const inKit = insideKit(root, path.relative(root, abs)) !== null;
        const exists = inKit && isFile(abs);
        if (exists) referenced.add(abs);
        images.push({
          alias,
          path: p,
          ext: path.extname(p).toLowerCase(),
          bytes: exists ? fs.statSync(abs).size : null,
          exists,
        });
      }
    }
    // logos reference files in images/ too — a referenced logo is no orphan
    if (isPlainObject(theme?.logos)) {
      for (const p of Object.values(theme.logos)) {
        if (typeof p !== 'string') continue;
        const abs = path.resolve(themeDir, p);
        if (insideKit(root, path.relative(root, abs)) !== null && isFile(abs)) referenced.add(abs);
      }
    }
    const orphans = [];
    const imagesDir = path.join(root, 'images');
    try {
      if (!confinedTarget(imagesDir)) throw new Error('images/ escapes the kit');
      for (const e of fs.readdirSync(imagesDir, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        const abs = path.join(imagesDir, e.name);
        if (!referenced.has(abs)) orphans.push(relOf(abs));
      }
      orphans.sort();
    } catch {
      /* no images directory */
    }

    // generator catalog: the bases a kit layout can build on, with their
    // published parameter schemas — and every name a kit layout cannot take
    const bases = [];
    const reservedNames = [];
    for (const name of LAYOUTS) {
      const def = layoutDef(name);
      if (!def || (!def.builtin && !def.official)) continue; // user leftovers of a prior compile
      reservedNames.push(name);
      bases.push({
        name,
        ...(def.builtin ? { builtin: true } : {}),
        ...(def.official ? { official: true, base: def.base } : {}),
        ...(def.sections ? { sections: def.sections } : {}),
        ...(def.description ? { description: def.description } : {}),
        ...(def.params ? { params: def.params } : {}),
        paramSchema: layoutParamSchema(name) ?? {},
      });
    }

    return structuredClone({
      name: manifest?.name ?? path.basename(root),
      manifest,
      kitDiagnostics: diagnostics,
      theme,
      themeExists: Boolean(themeFile),
      themeAnchor: relOf(anchor),
      layouts,
      fonts: { files: fontFiles, pairs },
      images,
      orphans,
      capabilities: { bases, reservedNames },
      defaults: JSON.parse(fs.readFileSync(DEFAULT_THEME_FILE, 'utf8')),
      version: JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')).version,
    });
  }

  async function apiCompile(body) {
    if ('source' in body && typeof body.source !== 'string')
      throw httpError(400, 'source must be a string (omit it to compile the specimen deck).');
    const source = typeof body.source === 'string' ? body.source : readSpecimen();
    const kitData = {};
    if ('theme' in body) kitData.theme = body.theme;
    if ('layouts' in body) kitData.layouts = body.layouts;
    const overlay = Object.keys(kitData).length ? kitData : null;

    // latest-wins ticket (module header): superseded requests answer 409
    const ticket = ++compileSeq;
    return serialized(async () => {
      if (ticket !== compileSeq) throw httpError(409, 'superseded');
      const opts = { baseDir: EDITOR_DIR, themePath: root, kitData: overlay };
      const { slides, css, fontsCss, stats, scenes, deck } = await compileHtml(source, {
        ...opts,
        fragment: true,
      });
      // deck and scenes reused: one parse/layout pass per request (worker.mjs
      // does the same) — the diagnostics see exactly the compiled state
      const diagnostics = validateDeck(source, { ...opts, deck, scenes });
      return {
        slides,
        css,
        fontsCss,
        slideMap: scenes.map((s, k) => ({ slide: k + 1, startLine: s.sourceLine ?? 1 })),
        animSteps: scenes.map((s) => s.animSteps ?? null),
        stats,
        diagnostics,
      };
    });
  }

  function readSpecimen() {
    try {
      return fs.readFileSync(SPECIMEN_FILE, 'utf8');
    } catch {
      throw httpError(500, `specimen deck not found (${SPECIMEN_FILE}) — broken installation.`);
    }
  }

  function apiPutTheme(body) {
    if (!isPlainObject(body.theme))
      throw httpError(422, 'theme must be a JSON object (the content of theme.json).');
    // overlay validation BEFORE the write — resolveTheme validates without
    // touching the live tokens, so it needs no place in the compile chain.
    // Values the resolver will IGNORE are answered 200 + warning diagnostics,
    // not 422 (unlike /api/manifest, which edits field by field): the editor
    // round-trips theme.json WHOLE, and refusing warnings would block saving
    // unrelated edits to a kit whose pre-existing theme carries junk — the
    // very state one opens the editor to fix. Callers own the diagnostics.
    const { diagnostics } = resolveTheme(
      {},
      { baseDir: root, themePath: root, themeData: body.theme },
    );
    const abs = confineWrite(themeAnchorOf(manifestOf()));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    recordWrite(abs);
    fs.writeFileSync(abs, `${JSON.stringify(body.theme, null, 2)}\n`);
    return { file: relOf(abs), diagnostics };
  }

  /** The manifest keys this route may change. `name` is deliberately absent:
   *  it is the kit's install identity (the directory it installs under, the
   *  name decks reference) — renaming is a new kit, not an edit. */
  const MANIFEST_EDITABLE = ['version', 'description', 'author', 'homepage'];

  /**
   * Updates kit.json's display metadata IN PLACE: the editable keys are
   * merged over the file as it is on disk, every other key (name, theme,
   * layouts, even unknown ones) travels through untouched. Validation is
   * parseKitManifest's — the code that owns the manifest rules — so a value
   * it would warn about and ignore is refused here instead of being written.
   */
  function apiPutManifest(body) {
    if (!isPlainObject(body.manifest))
      throw httpError(422, 'manifest must be a JSON object carrying the fields to update.');
    for (const key of Object.keys(body.manifest)) {
      if (key === 'name' || MANIFEST_EDITABLE.includes(key)) continue;
      throw httpError(
        400,
        `"${key}" cannot be edited here — only version, description, author and homepage.`,
      );
    }
    const abs = path.join(root, KIT_MANIFEST);
    let current;
    try {
      current = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      throw httpError(409, `${KIT_MANIFEST} is missing or unreadable — fix it on disk first.`);
    }
    if (!isPlainObject(current))
      throw httpError(
        409,
        `${KIT_MANIFEST} does not contain a JSON object — fix it on disk first.`,
      );
    if ('name' in body.manifest && body.manifest.name !== current.name)
      throw httpError(
        400,
        'the kit name is its install identity and cannot be changed here — create a new kit instead.',
      );
    const next = { ...current };
    for (const key of MANIFEST_EDITABLE) {
      if (!(key in body.manifest)) continue;
      const v = body.manifest[key];
      if (v === null || v === '') delete next[key];
      else next[key] = v;
    }
    const { manifest, diagnostics } = parseKitManifest(next);
    if (!manifest)
      throw httpError(422, diagnostics[0]?.message ?? 'the resulting manifest is invalid.');
    const bad = diagnostics.find(
      (d) =>
        d.code === 'KIT_BAD_VALUE' &&
        MANIFEST_EDITABLE.some((k) => body.manifest[k] != null && d.message.includes(` ${k} `)),
    );
    if (bad) throw httpError(422, bad.message);
    const safe = confineWrite(abs);
    recordWrite(safe);
    fs.writeFileSync(safe, `${JSON.stringify(next, null, 2)}\n`);
    return { file: relOf(safe), manifest, diagnostics };
  }

  /** The name gate of the layout routes (LAYOUT_FILE_RE), with the rule spelled
   *  out — the UI shows this message, and "invalid" alone teaches nothing. */
  function checkLayoutName(name) {
    if (!LAYOUT_FILE_RE.test(name))
      throw httpError(
        400,
        `"${name}" is not a valid layout name — lowercase letters, digits and hyphens, starting with a letter, 2 to 32 characters ("before-after").`,
      );
    return name;
  }

  /**
   * The file the layout `name` lives in, BY THE SAME RULE /api/state reports
   * it: the loader keys a layout by its `def.name`, and a kit is free to store
   * it under any basename (`layouts/brand-note.json` holding
   * `{"name":"my-note"}`). Reconstructing `<name>.json` instead would delete
   * nothing and would save a SECOND definition of the same layout — a kit the
   * next compile refuses.
   *
   * Falls back to the conventional `<name>.json` when no file declares the
   * name: that is the file a new layout is created in.
   */
  function layoutFileOf(name) {
    const dir = layoutsDirOf(manifestOf());
    let files = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.json'))
        .sort();
    } catch {
      /* no layouts directory yet */
    }
    for (const f of files) {
      let def = null;
      try {
        def = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        /* unreadable: named by its basename, exactly as buildState names it */
      }
      const declared = typeof def?.name === 'string' ? def.name : f.replace(/\.json$/i, '');
      if (declared === name) return path.join(dir, f);
    }
    return path.join(dir, `${name}.json`);
  }

  /**
   * Validates ONE layout definition through the code that owns the rules —
   * registerLayout, reached by the very loader a kit overlay goes through
   * (loadThemeLayoutDefs) — and returns its LAYOUT_DEF_* verdicts.
   *
   * NOT through prepareDeckContext, deliberately: that path applies the
   * overlay only when the kit RESOLVES (context.mjs refuses an overlay that
   * would repair a resolution failure), so for a kit whose theme.json does not
   * parse — the very state one opens the editor to fix — the verdict came back
   * EMPTY and the definition was written unchecked. Layout rules do not depend
   * on the theme, so neither does this check.
   *
   * The kit's own layouts are NOT loaded: a name already on disk is an UPDATE
   * of that file (layoutFileOf), not a collision. Registration happens at user
   * level, which every compilation resets — hence the call inside the
   * serialized chain, and the reset that leaves nothing behind.
   */
  function validateLayoutDef(def, kitName) {
    resetUserLayouts();
    const diags = loadThemeLayoutDefs([def], kitName);
    resetUserLayouts();
    return diags.filter((d) => d.code?.startsWith('LAYOUT_DEF_'));
  }

  async function apiPutLayout(name, body) {
    checkLayoutName(name); // the write path is safe by THIS check, not by the rules below
    if (!isPlainObject(body.def))
      throw httpError(422, 'def must be a JSON object (the content of one layouts/*.json file).');
    const def = body.def;
    if (def.name !== name)
      throw httpError(400, `def.name ("${def.name ?? ''}") must equal the route name ("${name}").`);
    const kitName = manifestOf()?.name ?? null;
    const diagnostics = await serialized(() => validateLayoutDef(def, kitName));
    if (diagnostics.some((d) => d.code === 'LAYOUT_DEF_INVALID'))
      throw httpError(422, 'layout definition refused.', {
        error: 'layout definition refused.',
        diagnostics,
      });
    const abs = confineWrite(layoutFileOf(name)); // the file the layout ALREADY lives in
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    recordWrite(abs);
    fs.writeFileSync(abs, `${JSON.stringify(def, null, 2)}\n`);
    return { file: relOf(abs), diagnostics };
  }

  function apiDeleteLayout(name) {
    checkLayoutName(name);
    const abs = confineWrite(layoutFileOf(name));
    if (!isFile(abs)) throw httpError(404, `layout "${name}" not found.`);
    recordWrite(abs);
    fs.rmSync(abs);
    return { deleted: relOf(abs) };
  }

  function checkFontName(raw) {
    const name = safeDecode(raw);
    const ext = path.extname(name).toLowerCase();
    if (name !== path.basename(name) || !FONT_FILENAME_RE.test(name) || name.includes('..'))
      throw httpError(400, `invalid font file name "${name}".`);
    if (!FONT_EXTS.has(ext))
      throw httpError(
        415,
        `"${name}": a kit font is a .ttf with a .woff2 twin of the same name — upload both, one file at a time.`,
      );
    return name;
  }

  async function apiPutFont(rawName, req) {
    const name = checkFontName(rawName);
    const buf = await readBody(req, BINARY_BODY_MAX);
    if (!buf.length) throw httpError(400, 'empty body — send the font bytes raw.');
    const ext = path.extname(name).toLowerCase();
    if (!sniffFont(ext, buf))
      throw httpError(
        415,
        `"${name}": the bytes do not look like a ${ext.slice(1)} font — the extension must match the content.`,
      );
    const abs = confineWrite(path.join(root, 'fonts', name));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    recordWrite(abs);
    fs.writeFileSync(abs, buf);
    return { file: relOf(abs), bytes: buf.length };
  }

  function apiDeleteFont(rawName) {
    const name = checkFontName(rawName);
    const abs = confineWrite(path.join(root, 'fonts', name));
    if (!isFile(abs)) throw httpError(404, `font "${name}" not found.`);
    recordWrite(abs);
    fs.rmSync(abs);
    return { deleted: relOf(abs) };
  }

  function checkImageName(raw) {
    const name = safeDecode(raw);
    const ext = path.extname(name).toLowerCase();
    const alias = name.slice(0, name.length - ext.length);
    if (name !== path.basename(name)) throw httpError(400, `invalid image name "${name}".`);
    if (!KIT_IMAGE_EXTS.has(ext))
      throw httpError(
        415,
        `"${name}": a kit image is a PNG, JPEG, GIF, WebP or SVG (the formats a deck image supports).`,
      );
    if (!IMAGE_ALIAS_RE.test(alias))
      throw httpError(
        400,
        `"${alias}" is not a valid image alias — lowercase letters, digits and hyphens, starting with a letter, 2 to 32 characters ("hero-photo").`,
      );
    return { name, alias, ext };
  }

  async function apiPutImage(rawName, req) {
    const { name, alias, ext } = checkImageName(rawName);
    const buf = await readBody(req, BINARY_BODY_MAX);
    if (!sniffImage(ext, buf))
      throw httpError(
        415,
        `"${name}": the bytes do not look like ${ext.slice(1).toUpperCase()} — the extension must match the content.`,
      );
    const abs = confineWrite(path.join(root, 'images', name));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    recordWrite(abs);
    fs.writeFileSync(abs, buf);
    return { alias, file: relOf(abs), bytes: buf.length };
  }

  /**
   * The DELETE gate is looser than the PUT one ON PURPOSE: a file dropped
   * into images/ by hand ("My Photo.PNG") never passed the alias rule, yet
   * the editor must be able to remove it. What stays non-negotiable is what
   * makes the join safe (a plain basename, no separators, no NUL) and the
   * route's scope (image extensions only — this is /api/images).
   */
  function checkImageDeleteName(raw) {
    const name = safeDecode(raw);
    if (
      name !== path.basename(name) ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('\0')
    )
      throw httpError(400, `invalid image name "${name}".`);
    if (!KIT_IMAGE_EXTS.has(path.extname(name).toLowerCase()))
      throw httpError(415, `"${name}" is not an image file this route manages.`);
    return name;
  }

  function apiDeleteImage(rawName) {
    const name = checkImageDeleteName(rawName);
    const abs = confineWrite(path.join(root, 'images', name));
    if (!isFile(abs)) throw httpError(404, `image "${name}" not found.`);
    recordWrite(abs);
    fs.rmSync(abs);
    return { deleted: relOf(abs) };
  }

  function serveKitFile(relRaw, res) {
    const rel = safeDecode(relRaw);
    // lexical verdict first, then realpath — the exact guard the manifest
    // paths go through; an escaping symlink resolves to null
    if (escapesKit(rel)) throw httpError(404, 'not found.');
    const abs = insideKit(root, rel);
    if (!abs || !isFile(abs)) throw httpError(404, 'not found.');
    // kit bytes are third-party content served on the origin that owns the
    // write API: a restricted type map + a CSP that leaves nothing executable
    const mime = KIT_FILE_MIME[path.extname(abs).toLowerCase()] ?? KIT_FILE_TEXT;
    const buf = fs.readFileSync(abs);
    res.writeHead(
      200,
      baseHeaders({
        'Content-Type': mime,
        'Content-Security-Policy': KIT_FILE_CSP,
        'Content-Length': buf.length,
      }),
    );
    res.end(buf);
  }

  async function apiExport(res) {
    let packed;
    try {
      packed = await packKit(root);
    } catch (e) {
      throw httpError(e?.name === 'KitArchiveError' ? 422 : 500, e?.message ?? String(e));
    }
    const { buffer, manifest } = packed;
    res.writeHead(
      200,
      baseHeaders({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${manifest.name}.deckkit"`,
        'X-Kit-Sha256': sha256(buffer),
        'Content-Length': buffer.length,
      }),
    );
    res.end(buffer);
  }

  function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : safeDecode(pathname.slice(1));
    // same confinement recipe as the kit files, rooted at the UI directory —
    // the static side serves NOTHING else
    if (escapesKit(rel)) throw httpError(404, 'not found.');
    const abs = insideKit(EDITOR_DIR, rel);
    if (!abs || !isFile(abs)) throw httpError(404, 'not found.');
    const mime = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    const buf = fs.readFileSync(abs);
    res.writeHead(200, baseHeaders({ 'Content-Type': mime, 'Content-Length': buf.length }));
    res.end(buf);
  }

  function safeDecode(raw) {
    try {
      return decodeURIComponent(raw);
    } catch {
      throw httpError(400, 'invalid percent-encoding.');
    }
  }

  // ------ router -------------------------------------------------------------

  let actualPort = null; // known after listen — the Origin allowlist needs it

  async function route(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    const p = url.pathname;
    const method = req.method;

    // Origin gate on every mutating request (module header): present and
    // foreign → refused. Absent (curl, tests) → passes: the gate exists for
    // browsers, and browsers always send it cross-origin.
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      const own = new Set([`http://localhost:${actualPort}`, `http://127.0.0.1:${actualPort}`]);
      if (origin !== undefined && !own.has(origin))
        throw httpError(403, `Origin "${origin}" refused: this editor only accepts its own pages.`);
    }

    if (p === '/__events') {
      if (method !== 'GET') throw httpError(405, 'GET only.');
      sse.handle(req, res);
      return;
    }

    if (p === '/api/state') {
      if (method !== 'GET') throw httpError(405, 'GET only.');
      sendJson(res, 200, buildState());
      return;
    }
    if (p === '/api/compile') {
      if (method !== 'POST') throw httpError(405, 'POST only.');
      sendJson(res, 200, await apiCompile(await jsonBody(req)));
      return;
    }
    if (p === '/api/theme') {
      if (method !== 'PUT') throw httpError(405, 'PUT only.');
      sendJson(res, 200, apiPutTheme(await jsonBody(req)));
      return;
    }
    if (p === '/api/manifest') {
      if (method !== 'PUT') throw httpError(405, 'PUT only.');
      sendJson(res, 200, apiPutManifest(await jsonBody(req)));
      return;
    }
    if (p.startsWith('/api/layouts/')) {
      const name = safeDecode(p.slice('/api/layouts/'.length));
      if (method === 'PUT') sendJson(res, 200, await apiPutLayout(name, await jsonBody(req)));
      else if (method === 'DELETE') sendJson(res, 200, apiDeleteLayout(name));
      else throw httpError(405, 'PUT or DELETE only.');
      return;
    }
    if (p.startsWith('/api/fonts/')) {
      const raw = p.slice('/api/fonts/'.length);
      if (method === 'PUT') sendJson(res, 200, await apiPutFont(raw, req));
      else if (method === 'DELETE') sendJson(res, 200, apiDeleteFont(raw));
      else throw httpError(405, 'PUT or DELETE only.');
      return;
    }
    if (p.startsWith('/api/images/')) {
      const raw = p.slice('/api/images/'.length);
      if (method === 'PUT') sendJson(res, 200, await apiPutImage(raw, req));
      else if (method === 'DELETE') sendJson(res, 200, apiDeleteImage(raw));
      else throw httpError(405, 'PUT or DELETE only.');
      return;
    }
    if (p.startsWith('/api/files/')) {
      if (method !== 'GET') throw httpError(405, 'GET only.');
      serveKitFile(p.slice('/api/files/'.length), res);
      return;
    }
    if (p === '/api/export') {
      if (method !== 'GET') throw httpError(405, 'GET only.');
      await apiExport(res);
      return;
    }
    if (p.startsWith('/api/')) throw httpError(404, `no such endpoint: ${p}`);

    if (method !== 'GET' && method !== 'HEAD') throw httpError(405, 'GET only.');
    serveStatic(p, res);
  }

  const server = http.createServer((req, res) => {
    if (refuseNonLocalHost(req, res, 'editor')) return;
    route(req, res).catch((e) => {
      const status = e?.status ?? 500;
      if (!res.headersSent) {
        if (e?.payload) sendJson(res, status, e.payload);
        else sendError(res, status, e?.message ?? String(e));
      }
      // bounded body read (module header): past the cap the connection is cut
      if (status === 413) req.destroy();
    });
  });

  // ------ watcher: kit-changed over SSE --------------------------------------

  let watchTimer = null;
  function onFsEvent(_event, name) {
    const rel = typeof name === 'string' ? name.split(path.sep).join('/') : null;
    if (rel) {
      // auto-write suppression, on an EXACT path: the file the server just
      // wrote, or the directory itself when the platform reports the create
      // or the rename on the parent (recordWrite stores both). Never by
      // dirname — that swallowed every external change to a SIBLING file for
      // the length of the window, and the editor kept a stale copy of a file
      // it had not written. The window is short enough that a genuinely
      // external edit right after a save still gets its event on the next
      // change.
      const ts = recentWrites.get(rel);
      if (ts !== undefined && Date.now() - ts < AUTO_WRITE_WINDOW_MS) return;
    }
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => sse.broadcast('change', 'kit-changed'), WATCH_DEBOUNCE_MS);
  }
  /**
   * The watcher is pointed at the CANONICAL path, never at the one the caller
   * handed us — and on Windows that is not a nicety.
   *
   * libuv derives each event's relative name by asserting that the path the OS
   * reports starts with the directory it was told to watch
   * (`uv__relative_path`, src\win\fs-event.c). Windows reports events in long
   * form; hand it a path carrying a short 8.3 component — `C:\Users\RUNNER~1\…`,
   * which is exactly what `os.tmpdir()` returns on a CI runner, and what a
   * user's own `C:\PROGRA~1\…` shortcut produces — and the two do not match.
   * The failure is `Assertion failed: !_wcsnicmp(filename, dir, dirlen)`: an
   * ABORT of the process, not a throwable error. Nothing catches it, nothing is
   * logged, the editor simply dies at the first file change.
   *
   * `realpathSync.native` is the one that resolves 8.3 names, junctions and
   * substituted drives to the form the events carry. It is deliberately not
   * applied to `root` itself: `root` is the trust boundary every read and write
   * is confined to (see `insideKit`), and widening that is a security change,
   * not a watcher fix. Relative event names are identical either way — both
   * paths name the same directory.
   */
  let watchRoot = root;
  try {
    watchRoot = fs.realpathSync.native(root);
  } catch {
    /* unresolvable (a race with a removal): watch what we were given */
  }
  const watcher = fs.watch(watchRoot, { recursive: true }, onFsEvent);

  // ------ lifecycle -----------------------------------------------------------

  try {
    await listenFromPort(server, port);
  } catch (e) {
    // the caller receives a rejection, so it receives no close() either: the
    // watcher and the server handle created above would hold the event loop
    // open for good (one leaked watcher per attempt, for an embedder that
    // retries on another port)
    watcher.close();
    clearTimeout(watchTimer);
    server.close();
    throw e;
  }
  actualPort = server.address().port;

  async function close() {
    watcher.close();
    clearTimeout(watchTimer);
    sse.close(); // open event streams would hold server.close() forever
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }

  return { server, port: actualPort, close };
}
