/**
 * `lutrin edit` — the local HTTP server behind the deck editor UI.
 *
 * One server = one directory tree. The API lists the `.deck.md` files under
 * `rootDir`, cuts one deck into per-slide line slices (slice.mjs), compiles a
 * working state to HTML fragments, and writes ONE slide back by splicing its
 * slice — the rest of the file is never rewritten. The UI itself is the deck
 * editor SPA served statically from design/deck-editor/.
 *
 * Exposed as a function (rather than wired into the CLI) so tests can start
 * it on an ephemeral port: `startDeckEditServer(rootDir, { port })` →
 * `{ server, port, close }`.
 *
 * Lives BESIDE serve.mjs, not inside src/deck/: the deck/ directory is the
 * compiler core, closed over itself (boundary.test.mjs), and this module is a
 * host of that core — an HTTP server wearing it, like the kit editor
 * (kit/edit-server.mjs) and the CLI.
 *
 * SECURITY MODEL — the served tree is user data and the server writes to it
 * (the same model as the kit editor, kit/edit-server.mjs):
 *   - binds 127.0.0.1 only, refuses non-local `Host` headers (DNS-rebinding
 *     guard shared with `lutrin preview` — serve.mjs);
 *   - every non-GET request with an `Origin` header must come from the
 *     editor's own origin, otherwise 403 (requests WITHOUT Origin — curl,
 *     same-machine tools — pass: the gate exists for browsers, and browsers
 *     always send it cross-origin);
 *   - a client-supplied `path` is refused lexically (`..`, absolute, `\`),
 *     then confined BY REALPATH under realpath(rootDir) — reads AND writes;
 *     only files ending in `.deck.md` are readable or editable, and a write
 *     never creates a file (the deck must already exist);
 *   - JSON bodies are capped at 2 MB — past the cap the connection is cut;
 *   - the tree walk is bounded (depth, entry count), skips dotfiles and
 *     node_modules, and never follows a symlink out of the root;
 *   - the static side serves ONLY design/deck-editor/ (plus the /fonts alias
 *     below), no directory listing, `X-Content-Type-Options: nosniff` and
 *     `Cache-Control: no-store` everywhere; the fonts — the one non-SPA
 *     content served — carry an inert CSP on top.
 *
 * WRITE MODEL — one splice, server-side. PUT /api/slide and the edit form of
 * POST /api/compile both graft the slide through spliceSlice() (slice.mjs),
 * then PROVE the graft took before acting on the result: the respliced file
 * must keep the same frontmatter and every out-of-slice slide's source text,
 * byte for byte. A weld the splice guards did not foresee is therefore a 422
 * {error:'boundary'} — a visible error, never a corruption written to disk
 * or shown in the preview.
 *
 * COMPILATION MODEL — compileHtml/prepareDeckContext mutate module state
 * (theme tokens, layout registry), so every call that touches them is
 * SERIALIZED through one promise chain. /api/compile is additionally
 * LATEST-WINS PER FILE: each request takes a ticket on its deck's path, and a
 * request whose ticket is no longer the newest FOR THAT FILE when its turn
 * comes answers 409 {error:'superseded'} WITHOUT compiling — the editor fires
 * a compile per keystroke burst and only ever cares about the newest state of
 * the deck it shows, while two editors on two different decks must never
 * supersede each other.
 *
 * FONTS of the chrome: the SPA reuses the kit editor's UI faces, so `/fonts/…`
 * is an alias onto design/editor/fonts/ — one set of woff2 files on disk, two
 * editors wearing them.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSseHub, listenFromPort, refuseNonLocalHost } from './serve.mjs';
import { escapesKit, insideKit } from './deck/kit.mjs';
import { inferLayout } from './deck/layout.mjs';
import { isMarpDeck } from './deck/marp.mjs';
import { parseDeck } from './deck/parse.mjs';
import { sliceDeck, spliceSlice } from './deck/slice.mjs';
import { prepareDeckContext } from './deck/context.mjs';
import { PAGE } from './deck/tokens.mjs';
import { capabilities, validateDeck } from './deck/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The deck editor UI — the ONLY directory the static side serves. */
const EDITOR_DIR = path.resolve(HERE, '..', 'design', 'deck-editor');
/** The chrome fonts, shared with the kit editor (module header). */
const FONTS_DIR = path.resolve(HERE, '..', 'design', 'editor', 'fonts');

export const DECK_EDIT_DEFAULT_PORT = 4323; // 4321 = preview, 4322 = kit edit

const JSON_BODY_MAX = 2 * 1024 * 1024;
/** Auto-write suppression window: a path the server itself wrote within the
 *  last 2 s does not emit `deck-changed` (the editor already knows). */
const AUTO_WRITE_WINDOW_MS = 2000;
const WATCH_DEBOUNCE_MS = 150;
/** Pause before a compile judges its latest-wins ticket (apiCompile): long
 *  enough for a burst already on the wire to claim its tickets, invisible
 *  next to a compile (5–500 ms) and to the editor's own 300 ms debounce. */
const COMPILE_YIELD_MS = 10;
/** Tree bounds: past these the walk stops and the answer says `truncated` —
 *  `lutrin edit ~` must degrade, not hang. */
const TREE_MAX_DEPTH = 12;
const TREE_MAX_ENTRIES = 5000;

/** Content types the STATIC side (design/deck-editor/, our own files) declares. */
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

/** The /fonts alias serves font files and nothing else — a whitelist, so the
 *  LICENSE.txt sitting beside them never rides along. */
const FONT_MIME = {
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
/** Non-SPA bytes stay inert even on our own origin (kit editor's invariant):
 *  no script, no fetch, no subresource, an opaque origin. */
const INERT_CSP = "default-src 'none'; sandbox";

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
 * 413 and the caller cuts the connection.
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

function safeDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw httpError(400, 'invalid percent-encoding.');
  }
}

/** sha256 of a file's content, first 16 hex chars — the `version` every
 *  read answers and every write demands back (optimistic concurrency). */
const versionOf = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

/** The implicit cover scene buildScenes() prepends when the frontmatter has a
 *  title (not for Marp, where `title:` is HTML metadata and the cover is the
 *  deck's own first slide): fragment k of a compile shows slice k − offset,
 *  and the SPA needs the offset to map its slide list onto the fragments.
 *  Mirrors the one condition in layout.mjs. */
const sceneOffsetOf = (meta) => (meta?.title && !isMarpDeck(meta) ? 1 : 0);

/** The capabilities() subset the form editor needs — the full catalog carries
 *  pages of prose (directives, marp, remoteImages) the SPA never reads. */
function editorCapabilities() {
  const caps = capabilities();
  return {
    layouts: caps.layouts,
    officialLayouts: caps.officialLayouts,
    userLayouts: caps.userLayouts,
    layoutSections: caps.layoutSections,
    layoutParams: caps.layoutParams,
  };
}

/**
 * Starts the deck editor server for `rootDir`.
 *
 * @param {string} rootDir directory whose `.deck.md` files are served
 * @param {{ port?: number }} [opts] first port tried (4323 by default;
 *        busy ports fall through like the preview's; 0 = OS-assigned)
 * @returns {Promise<{ server: import('node:http').Server, port: number,
 *                     close: () => Promise<void> }>}
 */
export async function startDeckEditServer(rootDir, { port = DECK_EDIT_DEFAULT_PORT } = {}) {
  const root = path.resolve(rootDir);

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
  /** Latest-wins ticket per deck path (module header): rel path → newest. */
  const compileTickets = new Map();

  const relOf = (abs) => path.relative(root, abs).split(path.sep).join('/');

  /**
   * Resolves a client-supplied deck path, or refuses it. Lexical verdict
   * first — the join below may only ever see a plain relative POSIX path —
   * then realpath confinement: the file must exist (this API never creates
   * one), and its real location must sit under the root's, so a symlinked
   * `.deck.md` pointing out of the tree is a 404, not a disclosure and not a
   * write anchor. Reads and writes go through this same gate.
   */
  function deckPathOf(rel) {
    if (typeof rel !== 'string' || !rel)
      throw httpError(400, 'path is required — the root-relative path of a .deck.md file.');
    // `rel` arrives DECODED already: URL.searchParams decoded the query
    // string, and a JSON body was never percent-encoded. Decoding it AGAIN
    // would send a file legitimately named `a%20b.deck.md` to `a b.deck.md`
    // — a read of the wrong file and, worse, a write to it.
    if (rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel))
      throw httpError(400, `invalid path "${rel}" — a relative POSIX path is expected.`);
    if (rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..'))
      throw httpError(400, `invalid path "${rel}" — no "..", "." or empty segment.`);
    if (!rel.endsWith('.deck.md')) throw httpError(404, `not a .deck.md file: ${rel}`);
    const abs = path.join(root, rel);
    let real;
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
      real = fs.realpathSync(abs);
    } catch {
      throw httpError(404, `no such deck: ${rel}`);
    }
    const off = path.relative(realRoot, real);
    if (off.startsWith('..') || path.isAbsolute(off)) throw httpError(404, `no such deck: ${rel}`);
    if (!isFile(abs)) throw httpError(404, `no such deck: ${rel}`);
    return { rel, abs };
  }

  /** Records a server-side write for auto-write suppression. */
  function recordWrite(rel) {
    recentWrites.set(rel, Date.now());
  }

  // ------ routes -------------------------------------------------------------

  /**
   * The file tree, `.deck.md` only: hidden entries and node_modules are
   * invisible, directories holding no deck are pruned, a symlink resolving
   * outside the root is skipped, and the walk is bounded (TREE_MAX_*) so a
   * server started on a home directory answers instead of hanging. Two
   * termination guards, both judged BEFORE recursing: a directory whose real
   * identity was already walked is never entered again (a symlink cycle
   * brings the same directory back under new names, forever), and the entry
   * budget counts entries VISITED, not entries retained — a walk that
   * examines thousands of files while keeping none must stop all the same.
   */
  function buildTree() {
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      throw httpError(500, `the served directory disappeared (${root}).`);
    }
    const within = (p) => {
      const off = path.relative(realRoot, p);
      return off === '' || (!off.startsWith('..') && !path.isAbsolute(off));
    };
    /** real identities of the directories already walked (cycle guard). */
    const visited = new Set([realRoot]);
    let budget = TREE_MAX_ENTRIES;
    let truncated = false;

    const walk = (dir, relDir, depth) => {
      if (depth > TREE_MAX_DEPTH) return [];
      let dirents;
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return []; // unreadable directory: invisible, like a deckless one
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      const dirs = [];
      const decks = [];
      for (const e of dirents) {
        if (truncated) break;
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        if (budget-- <= 0) {
          truncated = true;
          break;
        }
        const abs = path.join(dir, e.name);
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        let isDir = e.isDirectory();
        let isDeckFile = e.isFile();
        if (e.isSymbolicLink()) {
          // follow only symlinks that STAY inside the root — an escaping one
          // must appear nowhere, or the read gate would 404 what the tree shows
          try {
            if (!within(fs.realpathSync(abs))) continue;
            const st = fs.statSync(abs);
            isDir = st.isDirectory();
            isDeckFile = st.isFile();
          } catch {
            continue; // dangling symlink
          }
        }
        if (isDir) {
          // the cycle guard, before the recursion it exists to cut; the cost
          // is that a directory reachable through two in-root symlinks is
          // listed once, under whichever name sorts first
          let realDir;
          try {
            realDir = fs.realpathSync(abs);
          } catch {
            continue;
          }
          if (visited.has(realDir)) continue;
          visited.add(realDir);
          const children = walk(abs, rel, depth + 1);
          if (!children.length) continue; // prune: no deck anywhere below
          dirs.push({ name: e.name, path: rel, type: 'dir', children });
        } else if (isDeckFile && e.name.endsWith('.deck.md')) {
          decks.push({ name: e.name, path: rel, type: 'deck' });
        }
      }
      return [...dirs, ...decks];
    };

    const entries = walk(root, '', 0);
    return { root: path.basename(root), entries, ...(truncated ? { truncated: true } : {}) };
  }

  /** Slices of one deck, with the inferred layout of each slide riding along
   *  — the badge the SPA shows when no `<!-- layout -->` directive decides. */
  function slicesWithInference(content) {
    const sliced = sliceDeck(content);
    const parsed = parseDeck(content);
    const slides = sliced.slides.map((s) => ({
      ...s,
      // aligned index for index with parseDeck (slice.mjs invariant); the
      // fallback covers only the impossible mismatch
      inferredLayout: parsed.slides[s.index] ? inferLayout(parsed.slides[s.index], s.index) : null,
    }));
    return { meta: sliced.meta, sliceable: sliced.sliceable, slides };
  }

  /**
   * The ONE write-shaped operation of this server: slide `index` of `content`
   * replaced by `newText` through spliceSlice(), then PROVEN harmless before
   * anyone acts on the result. spliceSlice guards the boundary welds it
   * foresees; this net catches whatever it may still miss — the respliced
   * file must keep the same frontmatter (a slice never contains frontmatter
   * lines, so a changed meta means the edit woke one up) and every
   * out-of-slice slide's source text, byte for byte (a slide may legally
   * MOVE, never change). A miss is a 422 `boundary`: a visible error, and
   * the disk — or the preview — never sees the corrupted state.
   */
  function spliceVerified(content, sliced, index, newText) {
    const slice = sliced.slides[index];
    if (!slice)
      throw httpError(
        400,
        `index ${index} is out of bounds — the deck has ${sliced.slides.length} slide${sliced.slides.length === 1 ? '' : 's'}.`,
      );
    const { source: next } = spliceSlice(content, slice, newText);
    const after = sliceDeck(next);
    // the edited region in the NEW line numbering: the splice may have grown
    // or shrunk the file, and everything past it shifted by the difference
    const delta = next.split('\n').length - content.split('\n').length;
    const editStart = slice.startLine;
    const editEnd = slice.endLine + delta;
    const others = sliced.slides.filter((s) => s.index !== index);
    // slides fully outside the edited region — a neighbour welded into the
    // new text overlaps it, drops out of this list, and fails the count
    const untouched = after.sliceable
      ? after.slides.filter((s) => s.endLine < editStart || s.startLine > editEnd)
      : null;
    const holds =
      untouched !== null &&
      JSON.stringify(after.meta) === JSON.stringify(sliced.meta) &&
      untouched.length === others.length &&
      untouched.every((s, k) => s.source === others[k].source);
    if (!holds) throw httpError(422, 'boundary');
    return next;
  }

  /**
   * GET /api/deck — the whole editing state of one file: version, slices,
   * capabilities, diagnostics. Everything that touches the theme/layout
   * registries runs INSIDE the serialized chain (module header): the catalog
   * must describe the very context the deck compiles under, and another
   * request must not swap that context mid-read.
   */
  function apiDeck(relRaw) {
    const { rel, abs } = deckPathOf(relRaw);
    const content = fs.readFileSync(abs, 'utf8');
    const version = versionOf(content);
    const baseDir = path.dirname(abs);
    return serialized(() => {
      const { meta, sliceable, slides } = slicesWithInference(content);
      prepareDeckContext(meta, { baseDir });
      const caps = editorCapabilities();
      const diagnostics = validateDeck(content, { baseDir });
      return {
        path: rel,
        version,
        meta,
        sliceable,
        sceneOffset: sceneOffsetOf(meta),
        slides,
        capabilities: caps,
        diagnostics,
      };
    });
  }

  /**
   * POST /api/compile — HTML fragments of a working state. Two body shapes,
   * strictly: `{ path }` compiles the file on disk; `{ path, index, source,
   * baseVersion }` re-reads the disk, verifies the version (409 conflict when
   * the file moved under the editor), splices `source` over slide `index`
   * EXACTLY as a save would — boundary net included — and compiles the
   * result. The client never reconstructs the file: the one splice lives
   * here, so the preview can never show a state a save could not produce.
   * Serialized + latest-wins per file (module header).
   */
  async function apiCompile(body) {
    const { rel, abs } = deckPathOf(body.path);
    const content = fs.readFileSync(abs, 'utf8');
    let source = content;
    if ('index' in body || 'source' in body || 'baseVersion' in body) {
      // the edit form travels whole or not at all: a partial body is a
      // client bug, and guessing at the missing piece could preview a state
      // the editor never held
      if (!Number.isInteger(body.index) || body.index < 0)
        throw httpError(400, 'index must be a non-negative integer.');
      if (typeof body.source !== 'string')
        throw httpError(400, 'source must be a string — the working text of the slide.');
      if (typeof body.baseVersion !== 'string' || !body.baseVersion)
        throw httpError(400, 'baseVersion is required — the version the edit was based on.');
      if (versionOf(content) !== body.baseVersion) throw httpError(409, 'conflict');
      const sliced = sliceDeck(content);
      if (!sliced.sliceable)
        throw httpError(400, 'this deck is not sliceable (Marp dialect) — edit the file directly.');
      source = spliceVerified(content, sliced, body.index, body.source);
    }
    const baseDir = path.dirname(abs);

    const ticket = (compileTickets.get(rel) ?? 0) + 1;
    compileTickets.set(rel, ticket);
    return serialized(async () => {
      // a real pause BEFORE judging the ticket: the compile pipeline is
      // synchronous CPU work, so without yielding the event loop a burst of
      // requests is served strictly one at a time — every stale state fully
      // compiled before the next request could even claim its ticket, the
      // exact waste latest-wins exists to refuse. These few milliseconds let
      // every request already on the wire (connects included) take its
      // ticket first; stale ones then answer 409 without compiling.
      await new Promise((resolve) => setTimeout(resolve, COMPILE_YIELD_MS));
      if (ticket !== compileTickets.get(rel)) throw httpError(409, 'superseded');
      const { compileHtml } = await import('./html/render.mjs');
      const { slides, css, fontsCss, stats, scenes, deck } = await compileHtml(source, {
        baseDir,
        fragment: true,
      });
      // deck and scenes reused: one parse/layout pass per request — the
      // diagnostics see exactly the compiled state (kit editor's recipe)
      const diagnostics = validateDeck(source, { baseDir, deck, scenes });
      return {
        slides,
        css,
        fontsCss,
        stats,
        diagnostics,
        sceneOffset: sceneOffsetOf(deck.meta),
        // read AFTER the compile: the theme just applied owns the page tokens
        page: { width: PAGE.width, height: PAGE.height },
      };
    });
  }

  /**
   * PUT /api/slide — replaces ONE slide's slice on disk. The write is guarded
   * by `baseVersion` (409 conflict when the file moved under the editor) and
   * splices lines through spliceSlice() + the boundary net (spliceVerified):
   * everything outside the slice travels through byte for byte, and a weld
   * is a 422, not a write. Answers the NEW version and the NEW slicing — the
   * client's next edit splices against fresh boundaries.
   */
  function apiPutSlide(body) {
    const { rel, abs } = deckPathOf(body.path);
    if (typeof body.source !== 'string')
      throw httpError(400, 'source must be a string — the new text of the slide.');
    if (!Number.isInteger(body.index) || body.index < 0)
      throw httpError(400, 'index must be a non-negative integer.');
    if (typeof body.baseVersion !== 'string' || !body.baseVersion)
      throw httpError(400, 'baseVersion is required — the version the edit was based on.');

    const content = fs.readFileSync(abs, 'utf8');
    if (versionOf(content) !== body.baseVersion) throw httpError(409, 'conflict');

    const sliced = sliceDeck(content);
    if (!sliced.sliceable)
      throw httpError(400, 'this deck is not sliceable (Marp dialect) — edit the file directly.');
    const next = spliceVerified(content, sliced, body.index, body.source);
    recordWrite(rel);
    fs.writeFileSync(abs, next); // single write: no half-written deck, ever

    const { sliceable, slides } = slicesWithInference(next);
    return { version: versionOf(next), sliceable, slides };
  }

  /** GET /fonts/<file> — the chrome's woff2, from the kit editor's directory
   *  (module header). Basename strict + extension whitelist: nothing else in
   *  that directory is reachable. */
  function serveFont(rawName, res) {
    const name = safeDecode(rawName);
    if (name !== path.basename(name) || name.includes('..') || name.includes('\0'))
      throw httpError(404, 'not found.');
    const mime = FONT_MIME[path.extname(name).toLowerCase()];
    if (!mime) throw httpError(404, 'not found.');
    const abs = path.join(FONTS_DIR, name);
    if (!isFile(abs)) throw httpError(404, 'not found.');
    const buf = fs.readFileSync(abs);
    res.writeHead(
      200,
      baseHeaders({
        'Content-Type': mime,
        'Content-Security-Policy': INERT_CSP,
        'Content-Length': buf.length,
      }),
    );
    res.end(buf);
  }

  function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : safeDecode(pathname.slice(1));
    // same confinement recipe as the kit editor's static side, rooted at the
    // UI directory — the static side serves NOTHING else
    if (escapesKit(rel)) throw httpError(404, 'not found.');
    const abs = insideKit(EDITOR_DIR, rel);
    if (!abs || !isFile(abs)) throw httpError(404, 'not found.');
    const mime = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    const buf = fs.readFileSync(abs);
    res.writeHead(200, baseHeaders({ 'Content-Type': mime, 'Content-Length': buf.length }));
    res.end(buf);
  }

  // ------ router -------------------------------------------------------------

  let actualPort = null; // known after listen — the Origin allowlist needs it

  async function route(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    const p = url.pathname;
    const method = req.method;

    // Origin gate on every mutating request (module header): present and
    // foreign → refused. Absent (curl, tests) → passes.
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

    if (p === '/api/tree') {
      if (method !== 'GET') throw httpError(405, 'GET only.');
      sendJson(res, 200, buildTree());
      return;
    }
    if (p === '/api/deck') {
      if (method !== 'GET') throw httpError(405, 'GET only.');
      sendJson(res, 200, await apiDeck(url.searchParams.get('path')));
      return;
    }
    if (p === '/api/compile') {
      if (method !== 'POST') throw httpError(405, 'POST only.');
      sendJson(res, 200, await apiCompile(await jsonBody(req)));
      return;
    }
    if (p === '/api/slide') {
      if (method !== 'PUT') throw httpError(405, 'PUT only.');
      sendJson(res, 200, apiPutSlide(await jsonBody(req)));
      return;
    }
    if (p.startsWith('/api/')) throw httpError(404, `no such endpoint: ${p}`);

    if (method !== 'GET' && method !== 'HEAD') throw httpError(405, 'GET only.');
    if (p.startsWith('/fonts/')) {
      serveFont(p.slice('/fonts/'.length), res);
      return;
    }
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

  // ------ watcher: deck-changed over SSE --------------------------------------

  let watchTimer = null;
  /** rel paths changed since the last broadcast — one debounced burst can
   *  touch several decks (a git checkout), and each deserves its event. */
  const pendingChanges = new Set();
  function onFsEvent(_event, name) {
    const rel = typeof name === 'string' ? name.split(path.sep).join('/') : null;
    if (!rel || !rel.endsWith('.deck.md')) return; // only decks interest the editor
    // auto-write suppression, on the EXACT path the server just wrote — an
    // external change to a sibling file keeps its event (kit editor's rule)
    const ts = recentWrites.get(rel);
    if (ts !== undefined && Date.now() - ts < AUTO_WRITE_WINDOW_MS) return;
    pendingChanges.add(rel);
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      for (const changed of pendingChanges)
        sse.broadcast(JSON.stringify({ path: changed }), 'deck-changed');
      pendingChanges.clear();
    }, WATCH_DEBOUNCE_MS);
  }
  // recursive watch is not supported on every platform — a server without
  // live reload is degraded, a server that cannot start is useless
  //
  // WATCHED THROUGH realpath, like every other path in this file. libuv's
  // Windows backend compares each event's filename against the directory it
  // was handed — `_wcsnicmp(filename, dir, dirlen)`, src/win/fs-event.c — and
  // when the two do not share that prefix it does not raise, it ABORTS THE
  // PROCESS. The catch below cannot see it: the abort happens later, from
  // inside libuv, on an event. A root reached through a junction or a short
  // name is one way to arrange precisely that mismatch, and it took down
  // `lutrin edit` on windows-latest / Node 24 while the same code passed on
  // Node 22 and on every other platform.
  let watcher = null;
  try {
    watcher = fs.watch(fs.realpathSync(root), { recursive: true }, onFsEvent);
  } catch {
    /* no watch: the SPA simply receives no deck-changed events */
  }

  // ------ lifecycle -----------------------------------------------------------

  try {
    await listenFromPort(server, port);
  } catch (e) {
    // the caller receives a rejection, so it receives no close() either: the
    // watcher and the server handle created above would hold the event loop
    // open for good
    watcher?.close();
    clearTimeout(watchTimer);
    server.close();
    throw e;
  }
  actualPort = server.address().port;

  async function close() {
    watcher?.close();
    clearTimeout(watchTimer);
    sse.close(); // open event streams would hold server.close() forever
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }

  return { server, port: actualPort, close };
}
