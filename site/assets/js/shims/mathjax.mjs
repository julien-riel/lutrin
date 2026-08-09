/**
 * `mathjax`, for the import map — the compiler's LaTeX engine, which off Node
 * is reachable only as a bundle.
 *
 * `deck/assets.mjs` builds its Node engine out of seven bare specifiers
 * (`mathjax-full/js/mathjax.js` and friends). mathjax-full@3 is CommonJS —
 * no `"type": "module"`, no `"exports"` map, no ESM entry anywhere — so an
 * import map has nothing to point those at, and every one of them throws in a
 * page. That is what used to make equations the last block type this playground
 * could not carry.
 *
 * What the package DOES publish is `es5/tex-svg-full.js`: a webpack UMD bundle
 * that publishes `window.MathJax`. A browser loads it the way it expects to be
 * loaded — a CLASSIC `<script>`, in sloppy mode — and this module hands that
 * global back as the default export, exactly as shims/jszip.mjs does for JSZip.
 *
 * `-full` rather than plain `tex-svg` for one reason: it is the bundle built
 * from `AllPackages`, which is what `nodeMathEngine()` passes to `new TeX()`.
 * The smaller bundle carries only the default TeX packages and reaches for a
 * CDN through `autoload` when a deck uses one of the others — a network call on
 * a page whose whole promise is that your text never leaves your machine, and a
 * page/CLI divergence in what LaTeX compiles. 170 kB out of 2.3 MB is not a
 * trade worth making.
 *
 * THE CONFIGURATION IS NOT DECORATION:
 *   - `svg.fontCache: 'local'` — glyph paths go in a `<defs>` INSIDE each
 *     `<svg>`. The `'global'` default puts them in one shared element in the
 *     host document, and every equation we extracted would reference paths that
 *     do not travel with it — blank in the .pptx, blank in the .html.
 *   - `startup.typeset: false` — the bundle's default behaviour is to scan the
 *     HOST page for math and typeset it in place. Here that is the playground's
 *     own UI, which contains none but would be walked on every load.
 *   - `options.enableMenu: false` — the bundle carries the context menu, which
 *     otherwise binds handlers to everything it renders. We render nothing into
 *     this page: the markup goes into a slide.
 *
 * `enableAssistiveMml: false` is deliberately NOT here, because it does not
 * work: the menu component reinstates the screen-reader copy from its own
 * settings, and `tex2svg` keeps returning a container with an
 * `<mjx-assistive-mml>` beside the `<svg>`. What actually keeps that out of the
 * slides is `browserMathEngine()` in deck/assets.mjs serializing the `<svg>`
 * ELEMENT rather than the container's `innerHTML` — a config key that reads as
 * if it were the guard, and is not, is worse than none.
 *
 * The `await` is at module scope on purpose, and there are two things to wait
 * for: the script tag, then `MathJax.startup.promise`. The bundle's components
 * register themselves through a promise chain, so `tex2svg` and `tex2mml` do
 * not exist yet when `onload` fires — awaiting only the script would hand the
 * compiler a MathJax that cannot convert anything.
 *
 * 2.3 MB, so: injected here rather than written into playground.html, and
 * imported by `deck/assets.mjs` only from `mathDocument()`, which nothing calls
 * until a deck actually holds an equation. A visitor who only types pays
 * nothing.
 *
 * The bundle's URL is asked of the IMPORT MAP (`mathjax/umd`) rather than
 * written here as a relative path, for the reason spelled out in
 * shims/jszip.mjs: the map is the single list of vendored packages that
 * `site-serve.mjs` reads and that `packages/core/test/playground.test.mjs`
 * holds the CI vendoring loop to. A path spelled out here would be a second
 * list, and the second list is always the one that drifts.
 */

const SRC = import.meta.resolve('mathjax/umd');

if (!globalThis.MathJax) {
  // Before the script, never after: this is the object the bundle reads its
  // configuration out of as it starts, and it replaces it with the real one.
  globalThis.MathJax = {
    startup: { typeset: false },
    options: { enableMenu: false },
    svg: { fontCache: 'local' },
  };
  await new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SRC;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${SRC}`));
    document.head.appendChild(el);
  });
}

await globalThis.MathJax?.startup?.promise;

if (typeof globalThis.MathJax?.tex2svg !== 'function')
  throw new Error('mathjax loaded but published no tex2svg — the bundle is not the tex-svg one');

export default globalThis.MathJax;
