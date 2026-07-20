/**
 * Renders one Mermaid diagram to SVG, in a browser, as a CHILD PROCESS.
 *
 * Not a library function on purpose. `renderMermaidCached()` is synchronous,
 * and both its callers are too — `htmlMermaid()` (html/render.mjs) and
 * `addMermaid()` (pptx/render.mjs) sit deep inside synchronous block-dispatch
 * loops. Puppeteer is asynchronous. Turning the whole rendering chain async to
 * accommodate it would touch every layer down to the CLI, for a rendering that
 * is cached to disk and therefore runs approximately never.
 *
 * So this file is spawned with `execFileSync(process.execPath, …)`, exactly as
 * `mmdc` was — the caller keeps a blocking call, the timeout, the process
 * isolation the preview worker already relies on (worker.mjs, which exists so
 * that a browser launch never blocks the editor's renderer), and a crash here
 * cannot take the compiler with it.
 *
 * Contract — argv[2] is a JSON file holding the request (see below); writes the
 * rendered file to `out` and exits 0, or writes a diagnosis to stderr and exits
 * non-zero. Nothing goes to stdout: the parent reads only the exit code.
 *
 * The PNG rasterization happens HERE rather than in the parent, though
 * `svgToPng()` already exists there: it is async, and the whole point of this
 * child is to hand the parent one blocking call that yields a finished file.
 * Fonts therefore travel in the request — the child must not import the theme.
 */

import fs from 'node:fs';

const [, , requestFile] = process.argv;

if (!requestFile) {
  console.error('usage: node mermaid-render.mjs <request.json>');
  process.exit(2);
}

const {
  source,
  config,
  out,
  browser: executablePath,
  mermaidBundle,
  format = 'svg',
  scale = 3,
  fontFiles = [],
  defaultFontFamily,
} = JSON.parse(fs.readFileSync(requestFile, 'utf8'));

/** Intrinsic width of the produced SVG, in px — the base the PNG scale
 *  multiplies. Mermaid states it on the root element; the viewBox is the
 *  fallback, and 800 the last resort (a diagram is never rendered at a
 *  width of zero because an attribute moved). */
function svgWidth(svg) {
  const attr = /<svg[^>]*\swidth="([\d.]+)/i.exec(svg);
  if (attr) return Number(attr[1]);
  const box = /<svg[^>]*\sviewBox="[\d.-]+ [\d.-]+ ([\d.]+)/i.exec(svg);
  return box ? Number(box[1]) : 800;
}

/**
 * Shuts the browser down without ever hanging on it.
 *
 * `browser.close()` alone is NOT enough, and this cost an afternoon: driving a
 * full Chrome (as opposed to the headless shell), `launch()` returns in about a
 * second and `close()` then never resolves — the diagram was already written to
 * disk, the process simply refused to die, and the parent's 60 s timeout turned
 * a successful render into a failure. Chrome is asked politely, given five
 * seconds, and killed.
 *
 * The render is finished by the time this runs, so nothing is lost by being
 * brutal here.
 */
async function shutdown(browser) {
  if (!browser) return;
  const proc = browser.process();
  try {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  } catch {
    /* closing is best-effort: the kill below is what actually guarantees it */
  }
  try {
    proc?.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

let browser;
try {
  const { default: puppeteer } = await import('puppeteer-core');

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // --no-sandbox: the child renders a diagram from the deck being compiled,
    // on the author's own machine, in a browser that loads no remote origin —
    // and without it every containerised or root run (CI images, devcontainers)
    // fails to start at all. The sandbox would be guarding against content we
    // already trust enough to compile.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  // about:blank with no network: the bundle is injected from disk, and the
  // diagram source never leaves the machine.
  await page.setContent('<!doctype html><html><body><div id="container"></div></body></html>');
  await page.addScriptTag({ path: mermaidBundle });

  const svg = await page.evaluate(
    async (src, cfg) =>
      // eslint-disable-next-line no-undef
      {
        // eslint-disable-next-line no-undef
        mermaid.initialize({ startOnLoad: false, ...cfg });
        // eslint-disable-next-line no-undef
        const { svg } = await mermaid.render('lutrin-diagram', src);
        return svg;
      },
    source,
    config,
  );

  if (!svg || !/^\s*<svg/i.test(svg)) throw new Error('mermaid returned no SVG');

  if (format === 'png') {
    const { Resvg } = await import('@resvg/resvg-js');
    const img = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.max(1, Math.round(svgWidth(svg) * scale)) },
      font: { fontFiles, loadSystemFonts: true, defaultFontFamily },
    }).render();
    fs.writeFileSync(out, img.asPng());
  } else {
    fs.writeFileSync(out, svg);
  }

  await shutdown(browser);
  process.exit(0);
} catch (err) {
  // The message matters: a broken diagram source and a browser that will not
  // start are the same "null" to the caller, and only this line tells them
  // apart when someone finally goes looking.
  console.error(err?.message ?? String(err));
  await shutdown(browser);
  process.exit(1);
}
