/**
 * `node:url`, for the browser playground.
 *
 * The whole point of this file is one line. Two modules derive the package root
 * from `fileURLToPath(import.meta.url)` at MODULE SCOPE — `deck/layout.mjs` to
 * find `design/layouts/`, `deck/assets.mjs` to find `node_modules/`. In a
 * browser `import.meta.url` is an http(s) URL, so the origin is what stands in
 * for the filesystem root: strip it, and `/core/src/deck/layout.mjs` behaves
 * exactly like an absolute path. That is why the compiler has to be served at a
 * prefix mirroring `packages/core/` — see `site/README.md`.
 */
export function fileURLToPath(u) {
  const s = String(u);
  if (/^https?:/i.test(s)) return new globalThis.URL(s).pathname;
  if (s.startsWith('file://')) return decodeURIComponent(s.slice('file://'.length));
  return s;
}

export function pathToFileURL(p) {
  return new globalThis.URL(`file://${String(p)}`);
}

// Re-exported through local bindings, not `export { URL }`: a module can only
// export names it declares, and the bare form fails at link time with
// "Export 'URL' is not defined in module" — before any of this file runs.
const _URL = globalThis.URL;
const _URLSearchParams = globalThis.URLSearchParams;
export { _URL as URL, _URLSearchParams as URLSearchParams };

export default {
  fileURLToPath,
  pathToFileURL,
  URL: _URL,
  URLSearchParams: _URLSearchParams,
};
