/**
 * `node:path`, POSIX only — for the browser playground.
 *
 * The compiler reaches for `path` in a dozen places and every single call site
 * is pure string arithmetic: `join`, `resolve`, `dirname`, `extname`. None of
 * them touches a disk. That is why the playground can run the real compiler
 * rather than a copy of it — this file is the whole of what `node:path` means
 * to the code that matters.
 *
 * Windows separators are not handled and never will be: the only "filesystem"
 * here is the URL space of a static site, which is posix by construction.
 */

/** Collapses `.` and `..`. `absolute` decides whether a leading `..` may
 *  survive — above the root it cannot, and dropping it silently is what Node
 *  does too. */
function collapse(segments, absolute) {
  const out = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else out.push(seg);
  }
  return out;
}

export function join(...parts) {
  const joined = parts.filter((p) => p !== '' && p != null).join('/');
  if (!joined) return '.';
  const absolute = joined.charCodeAt(0) === 47;
  let out = collapse(joined.split('/'), absolute).join('/');
  // Node's join keeps a trailing separator the caller wrote. No call site in
  // the compiler depends on it; matching anyway is what makes this file
  // testable against node:path rather than merely plausible.
  if (out && joined.endsWith('/')) out += '/';
  if (absolute) return `/${out}`;
  return out || '.';
}

/** Trailing separators are not part of a name: node strips them before
 *  dirname/basename, and `/x/y/` therefore has basename `y`, not ``. */
const trimEnd = (s) => (s.length > 1 ? s.replace(/\/+$/, '') || '/' : s);

export function resolve(...parts) {
  let resolved = '';
  let absolute = false;
  for (let i = parts.length - 1; i >= 0 && !absolute; i--) {
    const p = parts[i];
    if (!p) continue;
    resolved = resolved ? `${p}/${resolved}` : p;
    absolute = p.charCodeAt(0) === 47;
  }
  // `process.cwd()` is stubbed by the page before the module graph loads; a
  // relative resolve that reached here without one would be a bug worth seeing
  if (!absolute) resolved = `${globalThis.process?.cwd?.() ?? '/'}/${resolved}`;
  return `/${collapse(resolved.split('/'), true).join('/')}`;
}

export function dirname(p) {
  const s = trimEnd(String(p));
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return s.slice(0, i);
}

export function basename(p, ext) {
  const s = trimEnd(String(p));
  let b = s.slice(s.lastIndexOf('/') + 1);
  if (ext && b !== ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
  return b;
}

export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

export function relative(from, to) {
  const f = resolve(from).split('/').filter(Boolean);
  const t = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/');
}

/** Node's normalize, posix: collapse `.`/`..` and duplicate separators, keep
 *  a trailing separator the caller wrote, `.` for an empty result. Reached by
 *  the kit resolution chain (`insideKit` and friends), which is what put it
 *  here: a kit loaded into the virtual filesystem goes through exactly the
 *  path checks a kit directory on disk does. */
export function normalize(p) {
  const s = String(p);
  if (!s) return '.';
  const absolute = s.charCodeAt(0) === 47;
  let out = collapse(s.split('/'), absolute).join('/');
  if (out && s.endsWith('/')) out += '/';
  if (absolute) return `/${out}`;
  return out || '.';
}

export const isAbsolute = (p) => String(p).charCodeAt(0) === 47;
export const sep = '/';
export const delimiter = ':';

const api = {
  join,
  resolve,
  normalize,
  dirname,
  basename,
  extname,
  relative,
  isAbsolute,
  sep,
  delimiter,
};
// `path.posix.join(…)` resolves to the same functions: there is one platform
api.posix = api;
export { api as posix };
export default api;
