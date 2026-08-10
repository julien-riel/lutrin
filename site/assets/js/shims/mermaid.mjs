/**
 * `mermaid`, for the playground — the diagram renderer, loaded as the classic
 * script its UMD bundle expects to be.
 *
 * UNLIKE jszip and mathjax, the compiler never imports this specifier: its own
 * Mermaid path is a child process driving a headless browser
 * (deck/mermaid-render.mjs), which no page can start. What CAN run here is the
 * bundle that child injects — @lutrin/core ships it, vendored, precisely so
 * that rendering depends on no install. playground.js imports this shim on the
 * first diagram it sees, renders with the SAME bundle and the SAME
 * `mermaidConfig()` as the CLI, and writes the result where
 * `renderMermaidCached` looks first: the deck's vendored `assets/mermaid/`,
 * which in the page is the virtual filesystem. The compiler stays untouched
 * and finds diagrams exactly where `lutrin vendor` would have put them.
 *
 * The bundle's URL is asked of the IMPORT MAP (`mermaid/umd`) rather than
 * written here, for the reason spelled out in shims/jszip.mjs: the map is the
 * single list of vendored packages, and a path spelled out here would be the
 * second list — the one that drifts. Its entry points into /core/vendor/, not
 * /vendor/: the bundle ships INSIDE @lutrin/core (vendor/mermaid/README.md),
 * not out of node_modules, and site-serve.mjs and pages.yml both mirror the
 * package under /core/.
 *
 * 3.5 MB, so: `import()`ed by playground.js on the first diagram and never
 * before — the MathJax bargain again. A visitor who never types ```mermaid
 * pays nothing.
 */

const SRC = import.meta.resolve('mermaid/umd');

if (!globalThis.mermaid) {
  await new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SRC;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${SRC}`));
    document.head.appendChild(el);
  });
}

if (typeof globalThis.mermaid?.render !== 'function')
  throw new Error('mermaid loaded but published no render — the bundle is not the standalone one');

export default globalThis.mermaid;
