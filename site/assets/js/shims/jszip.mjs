/**
 * `jszip`, for the import map — the one dependency of the .pptx renderer that
 * is not loadable as a module.
 *
 * JSZip 3.x ships no ESM build at all: `main` is CommonJS and the browser field
 * points at `dist/jszip.min.js`, a browserify UMD bundle. An import map can
 * only resolve to a module, so the bundle is loaded the way it expects to be —
 * a CLASSIC `<script>`, in sloppy mode, publishing `window.JSZip` — and this
 * module hands that global back as the default export.
 *
 * The `await` is at module scope on purpose. It makes this an asynchronous
 * module, so everything that imports `jszip` (pptxgenjs included) links only
 * once the bundle has run — and because nothing imports it until the page
 * `import()`s the .pptx renderer, the 100 kB is fetched on the first export and
 * never for a visitor who only types.
 *
 * Injected rather than written into playground.html for that same reason: a
 * `<script>` in the page is a download every visitor pays for, and most of them
 * never ask for a .pptx.
 *
 * The bundle's URL is asked of the IMPORT MAP (`jszip/umd`) rather than written
 * here as a relative path. That keeps the list of vendored packages in exactly
 * one place — the map — which is what `site-serve.mjs` reads to know what to
 * serve and what `packages/core/test/playground.test.mjs` holds the CI
 * vendoring loop to. A path spelled out here would be a second list, and the
 * second list is always the one that drifts.
 */

const SRC = import.meta.resolve('jszip/umd');

if (!globalThis.JSZip) {
  await new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SRC;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${SRC}`));
    document.head.appendChild(el);
  });
}

if (!globalThis.JSZip)
  throw new Error('jszip loaded but published no global — the bundle is not the UMD one');

export default globalThis.JSZip;
