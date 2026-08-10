/**
 * `node:child_process`, `node:dns` and `node:module` — the three the browser
 * cannot pretend to have.
 *
 * All three are imported at module scope by `deck/assets.mjs` and
 * `deck/browser.mjs`, and every one of their CALL sites is already inside a
 * try/catch, because on a real machine they fail too — no `mmdc` on the PATH,
 * no Chrome installed, a hostname that will not resolve. So a stub that throws
 * lands exactly where the compiler already knows how to lose: Mermaid falls
 * back to a code block, the SSRF DNS guard refuses the image, the Lucide
 * lookup gives up and tries the CDN.
 *
 * The one exception is `createRequire`, which is called at module scope rather
 * than at use: it must RETURN something. Only the `resolve` it hands back is
 * allowed to throw.
 */

const refuse = (what) => {
  throw new Error(`${what} is not available in the browser playground`);
};

// ---------------------------------------------------------------- child_process
export const execFileSync = () => refuse('child_process.execFileSync');
export const execSync = () => refuse('child_process.execSync');
export const spawnSync = () => refuse('child_process.spawnSync');
export const spawn = () => refuse('child_process.spawn');

// ------------------------------------------------------------------------- dns
export const promises = {
  lookup: () => Promise.reject(new Error('DNS is not available in the browser')),
  resolve: () => Promise.reject(new Error('DNS is not available in the browser')),
};
export const lookup = (_host, cb) =>
  typeof cb === 'function' ? cb(new Error('DNS is not available in the browser')) : undefined;

// ---------------------------------------------------------------------- module
export function createRequire() {
  const require = () => refuse('require()');
  require.resolve = () => refuse('require.resolve()');
  return require;
}

// ----------------------------------------------------------------------- https
// kit/archive.mjs imports it at module scope for `fetchKitArchive` (installing
// a kit from a URL — a CLI verb). The page only ever READS an archive the
// visitor handed it, so the fetch path is never called here.
export const request = () => refuse('https.request');
export const get = () => refuse('https.get');

export default {
  execFileSync,
  execSync,
  spawnSync,
  spawn,
  promises,
  lookup,
  createRequire,
  request,
  get,
};
