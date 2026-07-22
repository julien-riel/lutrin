/**
 * External assets: remote images, Lucide icons, LaTeX equations, Mermaid
 * diagrams.
 *
 * Common principle: everything that comes from elsewhere is first materialized
 * as a local file (a copy is kept, and embedded in the deliverable); never a
 * network dependency at the moment the presentation is opened.
 *
 *   - remote images    → downloaded into the user cache
 *     `~/.cache/lutrin/remote/` (shared across projects; compiling writes
 *     nothing into the source tree), or copied into `assets/remote/`
 *     next to the .md on explicit request — `assets: vendor` — when the
 *     deck directory must stay self-contained;
 *   - `lucide:` icons  → SVG resolved from node_modules/lucide-static,
 *     otherwise from the user cache `~/.cache/lutrin/icons/lucide/`,
 *     otherwise downloaded from unpkg at the PINNED version (lucideVersion)
 *     and then cached — recolored (`iconSvg`) then rasterized
 *     to PNG when needed (`renderIcon`);
 *   - LaTeX equations  → MathJax (tex → SVG, glyphs as paths:
 *     `mathSvg`) then PNG when needed (`renderMath`);
 *   - Mermaid diagrams → a browser already on the machine driven by
 *     puppeteer-core (`browser.mjs`) over the Mermaid bundle vendored in
 *     `vendor/mermaid/`, or `mmdc` when it happens to be installed — as PNG
 *     (PPTX) or SVG (HTML).
 *
 * Every asset therefore exists in two flavors: SVG (inlined as is by the HTML
 * renderer) and a high-density PNG via @resvg/resvg-js (PowerPoint handles
 * embedded SVG poorly, and not at all before 2019 — PNG is the safe format).
 *
 * Everything DOWNLOADED ends up embedded in the deliverable: that is what
 * makes every URL in the deck a read primitive on the machine that compiles,
 * and what justifies this module's guards — admitted scheme, public addresses
 * only at every redirect hop (`fetchPublic`), bounded bodies, pinned CDN
 * version. None of this is decorative caution: without these guards, a
 * `![](http://169.254.169.254/…)` exfiltrates cloud credentials into a .pptx.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { COLORS, FONTS, FONT_FILES } from './tokens.mjs';
import { findBrowser } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

/** Root of an installed package, wherever the package manager hoisted it. */
function packageRoot(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

const LUCIDE_LOCAL = packageRoot('lucide-static')
  ? path.join(packageRoot('lucide-static'), 'icons')
  : path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
// user cache (never inside the installed package: node_modules must stay
// read-only) — same root as the Mermaid cache
const LUCIDE_CACHE = path.join(userCacheRoot(), 'icons', 'lucide');

/**
 * Version of `lucide-static` to ask the CDN for — the one THIS package
 * declares in its dependencies, never `@latest`.
 *
 * `@latest` made a deck's rendering depend on the day the first compilation
 * happened: the SVG served that day entered the user cache, which never
 * expires, and two machines on the same team could inline two different
 * drawings for the same icon. Pinning also means the downloaded version is
 * the one `lucide-static` was installed against locally — the two sources of
 * an icon (node_modules and CDN) no longer diverge.
 *
 * @returns {string|null} the exact version, or null if it cannot be determined
 */
let _lucideVersion; // memoized: two reads of package.json per process are enough
function lucideVersion() {
  if (_lucideVersion !== undefined) return _lucideVersion;
  const semver = (v) =>
    typeof v === 'string' ? (v.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0] ?? null) : null;
  let found = null;
  try {
    // the declared range ("^1.24.0") reduced to its exact bound
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    found = semver(pkg?.dependencies?.['lucide-static'] ?? pkg?.devDependencies?.['lucide-static']);
  } catch {
    /* package.json could not be read: fall back on the installed package */
  }
  if (!found) {
    try {
      found = semver(
        JSON.parse(
          fs.readFileSync(path.join(packageRoot('lucide-static') ?? '', 'package.json'), 'utf8'),
        )?.version,
      );
    } catch {
      /* not installed either */
    }
  }
  return (_lucideVersion = found);
}

/** Pinned CDN base, or null — in which case NOTHING is downloaded: better a
 *  missing icon (diagnostic, renderer fallback) than an SVG of undetermined
 *  origin inlined into the deliverable. */
function lucideCdn() {
  const v = lucideVersion();
  return v ? `https://unpkg.com/lucide-static@${v}/icons` : null;
}

/** Bound on the CDN response. A Lucide icon weighs a few hundred bytes;
 *  64 KB leaves all the room in the world and shuts the door on a bulky
 *  error page — or on an endless response. */
export const LUCIDE_MAX_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// SVG → PNG (resvg)
// ---------------------------------------------------------------------------

let _resvg = null;
async function resvg() {
  // Test injection point: `@resvg/resvg-js` is a SINGLE-PLATFORM native
  // binary once packaged (its prebuilds are twelve optionalDependencies, of
  // which npm installs only the one for the building machine) — its absence
  // on the end user's machine is the REAL case we must be able to reproduce,
  // and that no ESM import mock reproduces cleanly. Documented nowhere but
  // here: this is not a setting.
  if (process.env.LUTRIN_NO_RASTER === '1') return null;
  if (_resvg === null) {
    try {
      _resvg = (await import('@resvg/resvg-js')).Resvg;
    } catch {
      _resvg = false;
    }
  }
  return _resvg || null;
}

/**
 * Is the rasterizer usable on this machine?
 *
 * Exposed so the renderers can SAY so instead of silently falling back on a
 * code block: a .pptx whose charts have been replaced by their specification
 * in text compiles, exits with code 0, and is only discovered in the meeting
 * room (RASTER_UNAVAILABLE diagnostic, pptx/render.mjs).
 */
export async function rasterAvailable() {
  return (await resvg()) !== null;
}

/**
 * Resolves the path of a local image relative to the deck. markdown-it
 * percent-encodes URLs (`My photo é.png` → `My%20photo%20%C3%A9.png`): if the
 * path as given does not exist, its decoded form is tried — file names with
 * accents or spaces, and `![[…]]` embeds translated by the hosts (Obsidian
 * plugin).
 */
export function resolveImagePath(baseDir, src) {
  const direct = path.resolve(baseDir, src);
  if (fs.existsSync(direct)) return direct;
  try {
    const decoded = path.resolve(baseDir, decodeURIComponent(src));
    if (fs.existsSync(decoded)) return decoded;
  } catch {
    // invalid % sequence: the raw path is authoritative
  }
  return direct;
}

/**
 * Does a resolved file fall under one of the trusted roots?
 *
 * The LOCAL counterpart of the SSRF guard. A local image is READ and then
 * embedded (base64) in the deliverable: `![bg](/Users/victim/.ssh/id_rsa)` or
 * `![bg](../../../.ssh/id_rsa)` in a deck received from a third party would
 * exfiltrate an arbitrary file from the machine that compiles. Image sources
 * are therefore confined to the deck directory, plus the project/vault roots
 * the host declares (VS Code: the workspace directory; Obsidian: the vault
 * root, so that attachments filed elsewhere stay readable).
 *
 * Same shape as `insideKit`/`within`: lexical check first (a path that escapes
 * is refused whether it exists or not), then the real one (realpath) to close
 * the symbolic links that would lead outside. Roots are dereferenced on both
 * sides (macOS /var → /private/var, symlinked HOME).
 */
export function imageWithinRoots(file, roots) {
  const abs = path.resolve(file);
  const bases = (Array.isArray(roots) ? roots : [roots])
    .filter(Boolean)
    .map((r) => path.resolve(r));
  if (!bases.length) return false;
  const within = (p, base) => {
    const rel = path.relative(base, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (!bases.some((base) => within(abs, base))) return false; // lexical escape
  try {
    const real = fs.realpathSync(abs);
    return bases.some((base) => {
      let realBase;
      try {
        realBase = fs.realpathSync(base);
      } catch {
        realBase = base;
      }
      return within(real, realBase);
    });
  } catch {
    return true; // file does not exist: the lexical escape is already ruled out (MISSING_IMAGE elsewhere)
  }
}

/**
 * Resolves a local image and CONFINES it to the trusted roots.
 *
 * `roots[0]` is the primary root (the deck directory) against which relative
 * paths are resolved; the following roots only widen the confinement (an
 * absolute path already under a project/vault root passes).
 *
 * @returns {string|null} confined absolute path, or null if the image escapes
 */
export function resolveLocalImage(roots, src) {
  const bases = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  if (!bases.length) return null;
  const file = resolveImagePath(bases[0], src);
  return imageWithinRoots(file, bases) ? file : null;
}

/** Intrinsic dimensions of a PNG or JPEG (null if the format is unknown) —
 *  the PPTX renderer's "contain" fit and validate's resolution audit. */
export function imageDims(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Rasterizes an SVG to PNG. @returns {{png:Buffer,w:number,h:number}|null}
 *  The active theme's .ttf files (FONT_FILES) are registered with resvg:
 *  without them, a chart whose SVG carries `font-family: <theme font>`
 *  (chart.mjs) would be rasterized with a fallback font while the same SVG,
 *  inlined in the HTML, displays in the theme font — HTML/.pptx parity
 *  broken. loadSystemFonts stays active for the families the theme does not
 *  supply. */
export async function svgToPng(svg, widthPx) {
  const Resvg = await resvg();
  if (!Resvg) return null;
  try {
    const fontFiles = [FONT_FILES.regular, FONT_FILES.bold, FONT_FILES.italic].filter(Boolean);
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.round(widthPx) },
      font: { fontFiles, loadSystemFonts: true, defaultFontFamily: FONTS.body },
    });
    const img = r.render();
    return { png: img.asPng(), w: img.width, h: img.height };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Remote images: local copy (user cache, or the project when "vendor")
// ---------------------------------------------------------------------------

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/** A stable, readable local file name for a URL. */
function localNameFor(url, ext) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  const base =
    path
      .basename(new URL(url).pathname)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 48) || 'image';
  return `${base}-${hash}${ext}`;
}

/**
 * Is a remote image copied INTO the project ("vendored") rather than into the
 * user cache? Frontmatter `assets: vendor`, which the CLI flag
 * `--vendor-assets` can force — same precedence as `--kit` over `kit:`.
 *
 * The default is the cache: compiling must write nothing into the source
 * tree. Vendoring is the exception chosen when the deck directory must stay
 * self-contained (archiving, handover, offline compilation elsewhere).
 *
 * `projet` is a deliberately FRENCH input alias of `project` — DSL input that
 * an author types, not prose. Deleting it would silently stop recognizing
 * `assets: projet`, with no diagnostic: `vendorRemoteAssets` would simply
 * return false and the images would go to the cache instead of the project.
 * Do not "translate" it away.
 */
export const vendorRemoteAssets = (meta, override) =>
  override ?? /^(vendor|projet|project)$/i.test(String(meta?.assets ?? '').trim());

/** Maximum size of a remote image. Generous for a real photograph (a 1920 px
 *  JPEG weighs ~600 KB, a PNG panorama a few MB), narrow against a URL that
 *  would point — by mistake or not — at an archive of several GB. */
export const REMOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Reads the response body, refusing to go past the bound.
 *
 * `content-length` is only the server's announcement: it allows giving up
 * before the transfer, but it is the running total during the read that
 * actually protects — same reasoning as fetchKitArchive. Leaving the loop
 * cancels the stream, so the socket is released without downloading the rest.
 *
 * @returns {Promise<Buffer|null>} null if the bound is crossed
 */
async function readBounded(res, max = REMOTE_IMAGE_MAX_BYTES) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// SSRF guard: what we agree to go and fetch
// ---------------------------------------------------------------------------

/**
 * The response body is written to disk and then EMBEDDED in the deliverable.
 * An image URL is therefore — for whoever writes the deck, or for whoever
 * managed to have one written — a read primitive on the machine that
 * compiles: `http://169.254.169.254/…` on a cloud runner yields the IAM
 * credentials, and `http://127.0.0.1:8080/` the victim's intranet, all of it
 * exfiltrated in an innocuous-looking .pptx. Hence the refusal of private and
 * local addresses.
 *
 * The judgement bears on the ADDRESSES, not on the name: `internal.example.com`
 * pointing at 10.0.0.5 must be refused just like 10.0.0.5 itself. It is redone
 * at EVERY redirect hop — a public URL that answers 302 towards an internal
 * address is the obvious bypass, and the only way to close it is to follow the
 * redirects by hand.
 */
export const REMOTE_SCHEMES = new Set(['https:', 'http:']);
export const REMOTE_IMAGE_TIMEOUT_MS = 30_000;
export const REMOTE_MAX_REDIRECTS = 5;

/**
 * A literal IP address that is private, local, or otherwise outside the public
 * network?
 *
 * Over-inclusive by choice: anything that is not a recognizable public address
 * is refused (`return true`), including what cannot be parsed. A missing image
 * is a visible annoyance; a successful read of an internal network is not seen
 * at all.
 */
export function isPrivateAddress(ip) {
  const addr = String(ip ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .toLowerCase();

  // IPv4 "mapped" into IPv6: judge the v4 it carries, otherwise loopback
  // walks back in disguised. TWO spellings to cover: the dotted form
  // (::ffff:127.0.0.1) and the HEXADECIMAL form (::ffff:7f00:1) — the latter
  // is what `new URL()` normalizes the host to, so it is THE one that arrives
  // here in practice; recognizing only the former let
  // http://[::ffff:127.0.0.1]/ through entirely.
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mappedDotted) return isPrivateAddress(mappedDotted[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mappedHex) {
    const [hi, lo] = [Number.parseInt(mappedHex[1], 16), Number.parseInt(mappedHex[2], 16)];
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
    const o = addr.split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n) || n > 255)) return true; // could not be parsed
    const [a, b] = o;
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (!addr.includes(':')) return true; // neither IPv4 nor IPv6: unknown
  if (addr === '::1' || addr === '::') return true;
  if (/^f[cd]/.test(addr)) return true; // fc00::/7  unique local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^ff/.test(addr)) return true; // multicast
  return false;
}

/**
 * Judges a URL BEFORE any transfer.
 *
 * DNS is resolved here so that the verdict bears on addresses. A name that
 * CANNOT be resolved is refused: `fetch` goes through the same getaddrinfo
 * (hosts file included), so it could not have reached anything either —
 * refusing early only avoids having to trust a second resolution. What remains
 * is a theoretical "DNS rebinding" window between this verdict and fetch's
 * connection, which only a controlled socket would close.
 *
 * @returns {Promise<string|null>} the reason for the refusal, or null if the URL is admitted
 */
export async function remoteUrlRefusal(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return `invalid URL: ${raw}`;
  }
  if (!REMOTE_SCHEMES.has(u.protocol))
    return `protocol refused: ${u.protocol}// — only http and https are downloaded (${raw})`;

  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    return `unresolvable host: ${host}`;
  }
  if (!addrs.length) return `host with no address: ${host}`;
  const privateAddr = addrs.find((a) => isPrivateAddress(a.address));
  if (privateAddr) return `private or local address refused: ${host} → ${privateAddr.address}`;
  return null;
}

/** Releases the socket of a hop we will not read (redirect, HTTP error). */
async function discardBody(res) {
  try {
    if (typeof res.body?.cancel === 'function') await res.body.cancel();
    else if (typeof res.body?.return === 'function') await res.body.return();
  } catch {
    /* body already closed */
  }
}

/**
 * `fetch` with redirects followed BY HAND, every hop judged again by
 * remoteUrlRefusal. `redirect: 'follow'` would delegate the chain to undici,
 * which does not know our policy: the first hop would be checked and every
 * following one left free.
 *
 * @returns {Promise<Response|null>} the final response, body unread
 */
async function fetchPublic(url) {
  let current = url;
  for (let hop = 0; hop <= REMOTE_MAX_REDIRECTS; hop++) {
    if (await remoteUrlRefusal(current)) return null;
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await discardBody(res); // nothing from this hop enters the deliverable
      let next;
      try {
        next = new URL(location, current).toString();
      } catch {
        return null;
      }
      current = next;
      continue;
    }
    if (!res.ok) {
      await discardBody(res);
      return null;
    }
    return res;
  }
  return null; // too many redirects
}

/** Destination directory for remote images, according to the chosen mode. */
export function remoteDir(baseDir, vendor) {
  return vendor ? path.join(baseDir, 'assets', 'remote') : path.join(userCacheRoot(), 'remote');
}

/**
 * Downloads a remote image and returns its local path — or null (offline,
 * 404…): the caller keeps its "placeholder" fallback.
 *
 * `vendor: true` writes into `<baseDir>/assets/remote/` (a versionable copy,
 * next to the .md); otherwise into `~/.cache/lutrin/remote/`, shared across
 * projects and without side effects on the sources — the normal case.
 */
export async function fetchRemoteImage(url, baseDir, { vendor = false } = {}) {
  const dir = remoteDir(baseDir, vendor);
  // cache: a file already downloaded for this URL, whatever its extension
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  if (fs.existsSync(dir)) {
    const hit = fs.readdirSync(dir).find((f) => f.includes(`-${hash}.`));
    if (hit) return path.join(dir, hit);
  }
  // vendor mode exists to make the deck directory self-contained: if the image
  // is already in the user cache, copy it instead of downloading it again
  if (vendor) {
    const cached = await fetchRemoteImage(url, baseDir, { vendor: false });
    if (cached) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, path.basename(cached));
        fs.copyFileSync(cached, file);
        return file;
      } catch {
        return cached; // read-only directory: the cache will do
      }
    }
    return null;
  }
  try {
    const res = await fetchPublic(url);
    if (!res) return null; // scheme, private address, redirects, HTTP error
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const ext = EXT_BY_MIME[mime] ?? path.extname(new URL(url).pathname) ?? '.png';
    if (!EXT_BY_MIME[mime] && !/^image\//.test(mime) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(url))
      return null;
    const buf = await readBounded(res);
    if (!buf) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, localNameFor(url, ext || '.png'));
    fs.writeFileSync(file, buf);
    return file;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lucide icons
// ---------------------------------------------------------------------------

/**
 * Source SVG of an icon: node_modules → local cache → CDN (then cached).
 *
 * What the CDN returns is inlined in the produced HTML and rasterized into the
 * .pptx, then kept FOREVER in the user cache. Three guards, therefore, before
 * writing anything at all: pinned version (lucideCdn), bounded body
 * (LUCIDE_MAX_BYTES), and checked shape — an HTML error page or a proxy
 * interstitial must not freeze into the cache under the name of an icon, where
 * nothing would ever come to correct it.
 */
async function lucideSvg(name) {
  const safe = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!safe) return null;
  for (const dir of [LUCIDE_LOCAL, LUCIDE_CACHE]) {
    const f = path.join(dir, `${safe}.svg`);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  const base = lucideCdn();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/${safe}.svg`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = await readBounded(res, LUCIDE_MAX_BYTES);
    if (!buf) return null;
    const svg = buf.toString('utf8');
    if (!/^\s*<svg[\s>]/i.test(svg)) return null;
    fs.mkdirSync(LUCIDE_CACHE, { recursive: true });
    fs.writeFileSync(path.join(LUCIDE_CACHE, `${safe}.svg`), svg);
    return svg;
  } catch {
    return null;
  }
}

/**
 * Offline check of an icon name (for `validate`): true / false according to
 * local presence, null if it cannot be checked without the network
 * (lucide-static absent and the icon never cached).
 */
export function hasLucideIcon(name) {
  const safe = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!safe) return false;
  for (const dir of [LUCIDE_LOCAL, LUCIDE_CACHE]) {
    if (fs.existsSync(path.join(dir, `${safe}.svg`))) return true;
  }
  return fs.existsSync(LUCIDE_LOCAL) ? false : null;
}

/** Allowed icon colors (brand) — default: primary green.
 *  Read at call time so as to follow a theme applied by applyTheme(). */
const iconColors = () => ({
  primary: COLORS.primary,
  neutral: COLORS.neutralPrimary,
  secondary: COLORS.neutralSecondary,
  white: COLORS.ground,
});

/** SVG of a recolored Lucide icon (brand ink). @returns {string|null} */
export async function iconSvg(name, { color = 'primary' } = {}) {
  const svg = await lucideSvg(name);
  if (!svg) return null;
  const palette = iconColors();
  const hex = palette[color] ?? palette.primary;
  return svg.replace(/currentColor/g, `#${hex}`);
}

/** Icon raster density (px) — shared with the callers that separate the SVG
 *  lookup from the rasterization to tell the two failures apart. */
export const ICON_RASTER_PX = 384;

/**
 * Renders a Lucide icon as a recolored PNG.
 * @returns {{png:Buffer,w:number,h:number}|null}
 */
export async function renderIcon(name, { color = 'primary', rasterPx = ICON_RASTER_PX } = {}) {
  const svg = await iconSvg(name, { color });
  return svg ? svgToPng(svg, rasterPx) : null;
}

// ---------------------------------------------------------------------------
// LaTeX → SVG → PNG (MathJax, optional like Mermaid)
// ---------------------------------------------------------------------------

let _mathjax = null;
async function mathDocument() {
  if (_mathjax === null) {
    try {
      const { mathjax } = await import('mathjax-full/js/mathjax.js');
      const { TeX } = await import('mathjax-full/js/input/tex.js');
      const { SVG } = await import('mathjax-full/js/output/svg.js');
      const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js');
      const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');
      const { AllPackages } = await import('mathjax-full/js/input/tex/AllPackages.js');
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const doc = mathjax.document('', {
        InputJax: new TeX({ packages: AllPackages }),
        OutputJax: new SVG({ fontCache: 'local' }),
      });
      _mathjax = { doc, adaptor };
    } catch {
      _mathjax = false;
    }
  }
  return _mathjax || null;
}

const EX_TO_PX = 9; // 1ex ≈ 9 px for a presentation body text size

/**
 * Renders a LaTeX equation as SVG (the brand's neutral-primary ink).
 * @returns {{svg:string,displayW:number,displayH:number}|null}
 */
export async function mathSvg(tex) {
  const mj = await mathDocument();
  if (!mj) return null;
  try {
    const node = mj.doc.convert(tex, { display: true });
    let svg = mj.adaptor.innerHTML(node);
    const wEx = Number.parseFloat(svg.match(/width="([\d.]+)ex"/)?.[1] ?? '0');
    const hEx = Number.parseFloat(svg.match(/height="([\d.]+)ex"/)?.[1] ?? '0');
    if (!wEx || !hEx || /data-mjx-error/.test(svg)) return null;
    svg = svg.replace(/currentColor/g, `#${COLORS.neutralPrimary}`);
    return { svg, displayW: wEx * EX_TO_PX, displayH: hEx * EX_TO_PX };
  } catch {
    return null;
  }
}

/**
 * Renders a LaTeX equation as PNG (the brand's neutral-primary ink).
 * @returns {{png:Buffer,w:number,h:number,displayW:number,displayH:number}|null}
 */
export async function renderMath(tex, { scale = 3 } = {}) {
  const m = await mathSvg(tex);
  if (!m) return null;
  const out = await svgToPng(m.svg, m.displayW * scale);
  return out ? { ...out, displayW: m.displayW, displayH: m.displayH } : null;
}

// ---------------------------------------------------------------------------
// Mermaid: PNG or SVG rendering, in a browser found on the machine (or mmdc)
// ---------------------------------------------------------------------------

/** Mermaid theme aligned on the active theme: light surfaces, neutral rules,
 *  primary as the only accent. Built at call time so as to follow a theme
 *  applied by applyTheme() — and since the config enters the disk cache key,
 *  two themes never share their PNGs (and a config change invalidates the old
 *  cache by itself: that is what made it possible to switch htmlLabels off
 *  without a purge).
 *
 *  `htmlLabels: false` is NOT an aesthetic choice. By default, mmdc puts every
 *  node and edge label inside
 *  `<foreignObject><div>…</div></foreignObject>` — HTML inside SVG. The HTML
 *  renderer's sanitizer strips `foreignObject` ALONG WITH its content (a sound
 *  security rule: it is the entry point for arbitrary HTML into an inlined
 *  SVG), and every diagram therefore displayed as a series of empty rectangles
 *  in the standalone HTML, the VS Code webview and the Obsidian shadow DOM —
 *  while the .pptx, rasterized by mmdc itself, carried its labels. A silent
 *  HTML/PPTX divergence. Switched off here, mermaid emits native SVG `<text>`,
 *  which the sanitizer lets through. */
export const mermaidConfig = () => ({
  theme: 'base',
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false },
  themeVariables: {
    primaryColor: `#${COLORS.highlightLight}`,
    primaryBorderColor: `#${COLORS.primary}`,
    primaryTextColor: `#${COLORS.neutralPrimary}`,
    lineColor: `#${COLORS.neutralSecondary}`,
    secondaryColor: `#${COLORS.underground1}`,
    tertiaryColor: `#${COLORS.ground}`,
    fontFamily: `${FONTS.body}, Helvetica, Arial, sans-serif`,
    fontSize: '16px',
  },
});

let _mmdc; // memoized: the binary is looked up once per process
export function findMmdc() {
  if (_mmdc !== undefined) return _mmdc;
  // node_modules/.bin, walking up from the package (workspace hoisting)
  for (let dir = ROOT; ; dir = path.dirname(dir)) {
    const local = path.join(dir, 'node_modules', '.bin', 'mmdc');
    if (fs.existsSync(local)) return (_mmdc = local);
    if (path.dirname(dir) === dir) break;
  }
  try {
    return (_mmdc = execFileSync('which', ['mmdc'], { encoding: 'utf8' }).trim() || null);
  } catch {
    return (_mmdc = null);
  }
}

/**
 * Renders a Mermaid diagram into `tmpDir` (PNG for the PPTX, SVG for the HTML)
 * and returns the path of the produced file — or null (mmdc absent, invalid
 * source…): the caller keeps its "source as a code block" fallback.
 */
export function renderMermaid(sourceText, tmpDir, idx, mmdc, { format = 'png' } = {}) {
  if (!mmdc) return null;
  try {
    const src = path.join(tmpDir, `diagram-${idx}.mmd`);
    const out = path.join(tmpDir, `diagram-${idx}.${format}`);
    const cfg = path.join(tmpDir, 'mermaid-config.json');
    // always rewritten: a reused tmpDir must not serve up the config of
    // another theme a second time
    fs.writeFileSync(cfg, JSON.stringify(mermaidConfig()));
    fs.writeFileSync(src, sourceText);
    const args = ['-i', src, '-o', out, '-b', 'transparent', '-c', cfg];
    if (format === 'png') args.push('-s', String(MERMAID_PNG_SCALE));
    execFileSync(mmdc, args, { stdio: 'pipe', timeout: 60_000 });
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/** Raster scale of the PNG output (both the browser child and mmdc's `-s`).
 *  Part of the PNG cache key: a diagram fills a slot of up to ~1180 px, so a
 *  1× raster — as produced when `svgWidth` misread `width="100%"` — arrives
 *  blurry, and bumping the scale must orphan those files. */
export const MERMAID_PNG_SCALE = 3;

/** The Mermaid bundle shipped inside the package (see vendor/mermaid/README).
 *  Absent only from a broken install — in which case the browser path simply
 *  does not apply and the caller keeps its fallback. */
const MERMAID_BUNDLE = path.join(ROOT, 'vendor', 'mermaid', 'mermaid.min.js');

/** This file, spawned as a child process. */
const MERMAID_CHILD = path.join(ROOT, 'src', 'deck', 'mermaid-render.mjs');

/** Last diagnosis from the browser renderer, for the CLI to surface. A silent
 *  null told nobody whether the browser was missing, the source invalid, or
 *  Chrome unable to start — three fixes behind one symptom. */
let _mermaidError = null;
export const lastMermaidError = () => _mermaidError;

/**
 * Renders a Mermaid diagram in a browser found on the machine, and returns the
 * path of the produced file — or null, the caller keeping its fallback.
 *
 * Synchronous, like `renderMermaid()` above and for the same reason: both
 * callers of `renderMermaidCached()` dispatch blocks in synchronous loops. The
 * asynchrony lives in the child process (`mermaid-render.mjs`), which the
 * timeout below bounds.
 */
export function renderMermaidBrowser(sourceText, tmpDir, idx, { format = 'png' } = {}) {
  const browser = findBrowser();
  if (!browser) {
    _mermaidError = 'no browser found — run `lutrin setup-mermaid`';
    return null;
  }
  if (!fs.existsSync(MERMAID_BUNDLE)) {
    _mermaidError = `the vendored Mermaid bundle is missing (${MERMAID_BUNDLE})`;
    return null;
  }
  try {
    const out = path.join(tmpDir, `diagram-${idx}.${format}`);
    const request = path.join(tmpDir, `request-${idx}.json`);
    fs.writeFileSync(
      request,
      JSON.stringify({
        source: sourceText,
        config: mermaidConfig(),
        out,
        browser: browser.path,
        mermaidBundle: MERMAID_BUNDLE,
        format,
        scale: MERMAID_PNG_SCALE,
        fontFiles: [FONT_FILES.regular, FONT_FILES.bold, FONT_FILES.italic].filter(Boolean),
        defaultFontFamily: FONTS.body,
      }),
    );
    // 60 s, as for mmdc: a cold browser launch costs a few seconds, and a
    // diagram that has not rendered by then never will.
    execFileSync(process.execPath, [MERMAID_CHILD, request], { stdio: 'pipe', timeout: 60_000 });
    if (fs.existsSync(out)) {
      _mermaidError = null;
      return out;
    }
    _mermaidError = 'the renderer produced no file';
    return null;
  } catch (err) {
    _mermaidError = (err?.stderr?.toString() || err?.message || String(err)).trim().split('\n')[0];
    return null;
  }
}

/**
 * Renders a Mermaid diagram through a persistent cache and returns the path of
 * the rendered file — indispensable to the live preview: rendering costs
 * several seconds per diagram, and it is never run again for a source already
 * seen.
 *
 *   - disk cache `~/.cache/lutrin/mermaid/` (key: sha1 source+format+config),
 *     shared between the CLI, watch and the VS Code extension, persistent
 *     across sessions;
 *   - memory cache in front of the disk, including **negative** entries
 *     (invalid source → null memorized, otherwise every keystroke on a broken
 *     diagram would pay for mmdc again);
 *   - mmdc absent → null without caching (it may be installed afterwards).
 */
const MERMAID_MEM = new Map();

/** Root of the user cache: LUTRIN_CACHE, otherwise XDG_CACHE_HOME, otherwise
 *  ~/.cache/lutrin. Declared as a function (hoisted): LUCIDE_CACHE evaluates it
 *  at module load time.
 *
 *  `MTL_DECK_CACHE` is still honored as a fallback (the tool used to be called
 *  mtl-deck), like MTL_DECK_CONFIG in theme.mjs. The old `~/.cache/mtl-deck`,
 *  however, is NOT migrated: a cache regenerates itself, and moving it would
 *  cost more than letting it grow old. */
function userCacheRoot() {
  return (
    process.env.LUTRIN_CACHE ||
    process.env.MTL_DECK_CACHE ||
    (process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, 'lutrin')
      : path.join(os.homedir(), '.cache', 'lutrin'))
  );
}

function mermaidCacheDir() {
  return path.join(userCacheRoot(), 'mermaid');
}

/** Rendered diagrams kept next to the deck (see `lutrin vendor`).
 *
 *  Consulted BEFORE the user cache: that is what allows a self-contained
 *  directory to display on a machine where mmdc is not installed. Since the key
 *  is a hash of (source + format + theme config, plus the raster scale for
 *  PNGs), a file found there is by construction the exact rendering asked
 *  for — consulting this directory therefore adds no semantics, only one more
 *  source for content that is already determined. */
export const mermaidVendorDir = (baseDir) => path.join(baseDir, 'assets', 'mermaid');

/**
 * Is an SVG whose labels are locked inside `<foreignObject>` unusable in HTML?
 * Yes: the sanitizer strips them along with their content, and nothing would be
 * left but mute rectangles.
 *
 * Defense in depth behind `htmlLabels: false` — an mmdc of a version that
 * ignored the option, or an SVG vendored by a Lutrin predating the fix, would
 * still produce a diagram without a single word. Better then to return null:
 * the caller falls back on its source as a code block, which can be read.
 */
function svgUsableInHtml(file) {
  try {
    return !/<foreignobject[\s>]/i.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

export function renderMermaidCached(sourceText, { format = 'png', baseDir = null } = {}) {
  // the raster scale keys the PNGs only: SVGs are scale-free, and including it
  // there would orphan every diagram already vendored next to existing decks
  const key = `${crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        s: sourceText,
        f: format,
        c: mermaidConfig(),
        ...(format === 'png' ? { px: MERMAID_PNG_SCALE } : {}),
      }),
    )
    .digest('hex')}.${format}`;
  // The FILE NAME depends only on the content (source + format + config) —
  // that is what makes a vendored directory readable by any Lutrin. The
  // MEMOIZATION key, on the other hand, must also carry baseDir: the verdict
  // depends on the file found in the deck's `assets/mermaid/`, hence on the
  // deck. Without that, a vendored SVG refused (foreignObject) in a first deck
  // condemned the perfectly sound SVG of a second deck compiled in the same
  // process — exactly what the preview worker does, deck after deck.
  const memKey = crypto
    .createHash('sha1')
    .update(JSON.stringify({ k: key, b: baseDir }))
    .digest('hex');
  if (MERMAID_MEM.has(memKey)) return MERMAID_MEM.get(memKey);

  for (const dir of [baseDir ? mermaidVendorDir(baseDir) : null, mermaidCacheDir()]) {
    if (!dir) continue;
    const found = path.join(dir, key);
    if (fs.existsSync(found)) {
      const ok = format !== 'svg' || svgUsableInHtml(found);
      MERMAID_MEM.set(memKey, ok ? found : null);
      return ok ? found : null;
    }
  }

  // Two renderers, tried in order. mmdc first when it is there: someone who
  // installed it asked for it, and it is the reference implementation. The
  // browser is what makes a fresh machine work without installing anything —
  // it needs no download, only a Chrome/Edge/Brave/Chromium already present.
  const mmdc = findMmdc();
  const browser = findBrowser();
  // No renderer at all → null WITHOUT memoizing it: installing a browser (or
  // mmdc) must take effect without restarting the preview worker. A negative
  // entry is only ever recorded for a source a working renderer refused.
  if (!mmdc && !browser) {
    _mermaidError = 'no browser found — run `lutrin setup-mermaid`';
    return null;
  }
  const renderers = [
    mmdc ? (dir) => renderMermaid(sourceText, dir, 0, mmdc, { format }) : null,
    browser ? (dir) => renderMermaidBrowser(sourceText, dir, 0, { format }) : null,
  ].filter(Boolean);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-mmd-'));
  let result = null;
  try {
    let out = null;
    for (const render of renderers) {
      out = render(tmpDir);
      if (out) break;
    }
    if (out && (format !== 'svg' || svgUsableInHtml(out))) {
      // always written into the user cache, never into a vendored directory:
      // `lutrin vendor` alone decides what enters the project
      const cached = path.join(mermaidCacheDir(), key);
      fs.mkdirSync(mermaidCacheDir(), { recursive: true });
      fs.copyFileSync(out, cached);
      result = cached;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  MERMAID_MEM.set(memKey, result);
  return result;
}

/** Writes a PNG buffer to a temporary file and returns its path. */
export function writeTmpPng(dir, name, buf) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${name}.png`);
  fs.writeFileSync(f, buf);
  return f;
}
