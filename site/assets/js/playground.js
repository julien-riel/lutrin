/**
 * The playground: the REAL compiler, running in the page.
 *
 * Not a re-implementation and not a server call — `packages/core/src` is served
 * verbatim under /core/ and imported unchanged, behind the import map and the
 * shims in ./shims/. What you see is what `lutrin build --html` produces from
 * the same commit.
 *
 * THREE THINGS ABOUT THE ORDER OF THIS FILE, all load-bearing:
 *
 *  1. The official layout definitions are read by deck/layout.mjs with
 *     readdirSync + readFileSync at MODULE SCOPE. A browser cannot await during
 *     module instantiation, so they must be in the virtual filesystem BEFORE
 *     the first `import()` of the compiler. Hence a dynamic import after a
 *     top-level await, rather than an import at the top of the file.
 *
 *  2. Having loaded the catalog, we COUNT it. The catch around that block in
 *     layout.mjs pushes no diagnostic, so an empty catalog is completely
 *     silent: a dozen layouts fall back to wrong geometry and `stats.warnings`
 *     still comes back empty. A playground that showed that would be lying
 *     about the product, which is the one thing this site does not do.
 *
 *  3. The slides live in an IFRAME. The compiled stylesheet restyles `body`
 *     and `a` — inlined into this page it would repaint the page around it, and
 *     the deck's own fonts would leak into the UI. The kit editor isolates its
 *     preview the same way, for the same reason.
 *
 * THE PROVISIONING LOOP is how diagrams, icons and dropped images reach a
 * compiler whose call sites are synchronous. `renderMermaidCached()` and
 * `lucideSvg()` cannot await anything mid-dispatch — but both begin by looking
 * at a DISK: the deck's vendored `assets/mermaid/`, the user's icon cache. In
 * this page the disk is the fs shim, and the page controls what is on it. So
 * after each compile, `provision()` renders the diagrams the scene graph asked
 * for (the vendored Mermaid bundle, loaded like MathJax), fetches the icons it
 * named (same-origin, out of /vendor/lucide-static/), writes both exactly
 * where the compiler will look — `mermaidContentKey()` is that contract — and
 * compiles once more. The second pass finds everything already "on disk" and
 * writes nothing, which is what makes the loop converge.
 *
 * `describeGaps()` exists for the same honesty reason as (2): what cannot be
 * drawn must be named, not dropped. The list has shrunk to what actually
 * fails HERE — a diagram Mermaid refused (it refuses it on the command line
 * too), an icon that is not in the Lucide set, an image whose file this page
 * was never given (dropping it onto the editor is the remedy now), and the
 * one true remaining CLI-only case: a remote image, which needs the disk
 * cache the CLI fetches through. Equations went through the same shrinking —
 * `describeMath()` reports what MathJax refused, separately, without the "it
 * works on the command line" line, because for invalid LaTeX it does not.
 *
 * THE TWO DOWNLOADS are the same compiler again, not an export of the preview.
 * `.html` is `compileHtml` without `fragment`, so it is the standalone page
 * `lutrin build --html` writes, presenter mode and all. `.pptx` is
 * `renderDeckBytes` — the real PowerPoint renderer, its eight post-processing
 * passes included, running against the `node:fs` shim. It is imported ON THE
 * FIRST CLICK and never before: `jszip` and `pptxgenjs` are half a megabyte
 * that a reader who only types must not pay for. MathJax is the same bargain
 * paid on the first equation rather than on the first click.
 *
 * THE WORKBENCH is what makes this an editor rather than a demo, and all of
 * it stays in the visitor's browser: the source autosaves to localStorage and
 * dropped images to IndexedDB, restored on the next visit; a deck opens from
 * and saves back to a real `.md` file (File System Access where the browser
 * has it, download where it does not); the caret and the preview track each
 * other through `scene.sourceLine`; and `validateDeck` — the same validator
 * the CLI and the VS Code extension run — reports line-anchored findings a
 * click can jump to. None of it runs in the embedded card (`?embed=1`): the
 * landing page's taster must not swallow a visitor's work in progress, nor
 * restore someone's deck into a marketing page.
 */

import * as vfs from './shims/fs.mjs';

// Resolved from this file's own URL, so the page works at the site root or
// under a path — and taken as `.pathname`, because that is the form the
// compiler computes for itself through fileURLToPath(import.meta.url).
const CORE_URL = new URL('../../core/', import.meta.url);
const LAYOUT_DIR = new URL('design/layouts/', CORE_URL).pathname;

const SLIDE_W = 1280;
const SLIDE_H = 720;

const $ = (id) => document.getElementById(id);
const source = $('pg-source');
const frame = $('pg-frame');
const notes = $('pg-notes');
const status = $('pg-status');
const dlHtml = $('pg-dl-html');
const dlPptx = $('pg-dl-pptx');
const nameInput = $('pg-name');

/** The landing page's card (?embed=1) is a taster, not a workspace: nothing
 *  is restored into it and nothing typed there is kept. */
const IS_EMBED = document.documentElement.classList.contains('is-embed');

/** The three examples from the landing page: a reader arrives at something
 *  already recognised, and edits rather than invents. */
const EXAMPLES = {
  funnel: `# Request triage

<!-- layout: funnel -->

## 2,400 received
All channels combined.

## 1,100 eligible
After checking the criteria.

## 320 selected
Funded this year.
`,
  metrics: `# Indicators

:::metric
33
Layouts available
↑ +2 this release
:::

:::metric
15
Chart types
↑ +7 this release
:::

:::metric
0
Coordinates in this file
→ by design
:::
`,
  chart: `# Budget by quarter

The chart is drawn by the engine, in the brand's colours, on a
palette checked for contrast and colour blindness.

\`\`\`chart
type: bar
categories: Q1, Q2, Q3, Q4
Planned: 120, 150, 180, 210
Actual: 110, 155, 175, 190
target: 165
\`\`\`
`,
  // The two heavy examples come last: clicking "An equation" is what fetches
  // MathJax's 2.3 MB, clicking "A diagram" Mermaid's 3.5 MB. Nobody pays for
  // either by merely arriving on the page.
  math: `# The model

The engine typesets LaTeX with MathJax, here and in the file you download.

\`\`\`math
\\frac{1}{2}\\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2
\`\`\`

\`\`\`math
e^{i\\pi} + 1 = 0
\`\`\`
`,
  diagram: `# How a deck gets made

The diagram is rendered right here, by the same Mermaid the
command line uses, in the brand's colours.

\`\`\`mermaid
flowchart LR
  md[Markdown] --> ast[AST] --> ir[IR]
  ir --> pptx[.pptx]
  ir --> html[HTML]
\`\`\`
`,
};

const say = (text, kind) => {
  status.textContent = text;
  status.dataset.kind = kind ?? '';
};

const note = (className, text) => {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  notes.appendChild(p);
  return p;
};

/** Fatal enough to stop. The page must never offer a compiler that would
 *  quietly produce the wrong thing. */
function giveUp(message, detail) {
  say('unavailable', 'bad');
  notes.innerHTML = '';
  note('pg-note pg-note-bad', message);
  if (detail) {
    const pre = document.createElement('pre');
    pre.className = 'pg-error';
    pre.textContent = detail;
    notes.appendChild(pre);
  }
  source.disabled = true;
  for (const b of [dlHtml, dlPptx]) b.disabled = true;
}

// ---------------------------------------------------------------------------
// the preview frame
// ---------------------------------------------------------------------------

/** A skeleton written once; every compile afterwards swaps two <style> bodies
 *  and one innerHTML, which is what keeps recompile-as-you-type cheap. */
function openFrame() {
  const doc = frame.contentDocument;
  doc.open();
  doc.write(
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<style id="pg-fonts"></style><style id="pg-deck"></style>' +
      '<style>html,body{margin:0;background:transparent}' +
      '.pg-stack{display:flex;flex-direction:column;gap:14px;padding:14px}' +
      // the slide the caret is in — quiet enough not to read as selection
      '.pg-stack>.is-current{outline:2px solid rgba(37,99,235,.45);outline-offset:2px}' +
      '.pg-stack>*{cursor:pointer}' +
      '</style>' +
      '</head><body><div class="pg-stack deck"></div></body></html>',
  );
  doc.close();
  return {
    doc,
    fonts: doc.getElementById('pg-fonts'),
    deck: doc.getElementById('pg-deck'),
    stack: doc.querySelector('.pg-stack'),
  };
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

say('loading the compiler…');

let compileHtml;
/** `deck/assets.mjs` — the cache-key contract and the config the provisioning
 *  loop must share with the compiler, imported from the SAME module instance
 *  the compiler uses so the two can never disagree. */
let assets;
/** `deck/raster-browser.mjs` — the canvas rasterizer, for the PNG half of a
 *  diagram (the .pptx wants a raster; the preview and the vector twin do not). */
let raster;
/** `deck/validate.mjs` — the validator the CLI and the VS Code extension run,
 *  for line-anchored findings the page can jump the caret to. */
let validateDeck;

try {
  // The catalog first, into the virtual filesystem. The manifest is written by
  // CI BESIDE the directory rather than inside it: a file that readdirSync
  // returned and that is not a layout definition would be registered as a
  // broken one, and reported as such.
  const manifest = await fetch(new URL('design/layouts.json', CORE_URL)).then((r) => {
    if (!r.ok) throw new Error(`layouts.json: HTTP ${r.status}`);
    return r.json();
  });
  await Promise.all(
    manifest.map(async (name) => {
      const res = await fetch(new URL(`design/layouts/${name}`, CORE_URL));
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      vfs.preload(`${LAYOUT_DIR}${name}`, await res.text());
    }),
  );

  // ONLY NOW. See note (1) at the top of this file.
  const render = await import('../../core/src/html/render.mjs');
  const layout = await import('../../core/src/deck/layout.mjs');
  compileHtml = render.compileHtml;
  assets = await import('../../core/src/deck/assets.mjs');
  raster = await import('../../core/src/deck/raster-browser.mjs');
  validateDeck = (await import('../../core/src/deck/validate.mjs')).validateDeck;

  const got = layout.officialLayouts().length;
  if (got !== manifest.length) {
    giveUp(
      [
        `The layout catalog did not load — ${got} of ${manifest.length} definitions registered.`,
        'Rather than show you slides laid out with the wrong geometry, the playground stops here.',
        'Compile locally instead: npx lutrin build deck.md --html -o deck.html',
      ].join(' '),
    );
    throw new Error('catalog incomplete');
  }
} catch (e) {
  if (!source.disabled)
    giveUp(
      'The compiler could not be loaded in this browser. It needs import maps and ' +
        'top-level await — Safari 16.4, Chrome 89 or Firefox 108 and newer. ' +
        'Everything here also works from the command line, with npx lutrin.',
      String(e?.message ?? e),
    );
  throw e;
}

const view = openFrame();

// ---------------------------------------------------------------------------
// provisioning: put on the virtual disk what the compiler will look for
// ---------------------------------------------------------------------------

/** Where the deck's pre-rendered diagrams live — the same `assets/mermaid/`
 *  that `lutrin vendor` fills next to a real deck, because that is the first
 *  place `renderMermaidCached()` looks. */
const DIAGRAM_DIR = '/deck/assets/mermaid';

/** Where `lucideSvg()` looks after node_modules (absent here): the user icon
 *  cache, under the home directory the os shim answers with. The layout
 *  (`<cache>/icons/lucide/<name>.svg`) is deck/assets.mjs's; a drift would
 *  show as icons silently gone from this page and nowhere else. */
const ICON_CACHE = '/home/playground/.cache/lutrin/icons/lucide';

/** Diagram sources that failed here, with why — consulted so a broken diagram
 *  is rendered once, reported honestly, and not retried on every keystroke.
 *  Maps source → 'invalid' (Mermaid refused it; the CLI refuses it too) or
 *  'bundle' (the 3.5 MB could not be fetched into this page). */
const failedDiagrams = new Map();

/** Icon names the pinned Lucide set does not have (a 404 from our own origin,
 *  not a network failure — those are retried). */
const missingIcons = new Set();

/** The Mermaid module, imported once on the first diagram and remembered
 *  including failure — the MathJax bargain, and the same reason: a page that
 *  cannot fetch the bundle must not re-fetch nothing on every keystroke. */
let _mermaid = null;
async function mermaidModule() {
  if (_mermaid === null) {
    try {
      _mermaid = (await import('./shims/mermaid.mjs')).default;
      _mermaid.initialize({ startOnLoad: false, ...assets.mermaidConfig() });
    } catch {
      _mermaid = false;
    }
  }
  return _mermaid || null;
}

/** Distinct render ids: Mermaid writes the id into the SVG it returns, and
 *  reusing one across renders has produced stale references. */
let diagramSeq = 0;

/**
 * Renders one diagram into the virtual filesystem, under the names the
 * compiler will ask for — the SVG the preview and the .html inline, and the
 * PNG the .pptx embeds (at the same scale the CLI rasterizes at, because the
 * scale is part of the PNG's name). A missing PNG costs the export, not the
 * preview, so it is best-effort behind the SVG.
 */
async function provisionDiagram(src) {
  const mermaid = await mermaidModule();
  if (!mermaid) {
    failedDiagrams.set(src, 'bundle');
    return false;
  }
  const id = `lutrin-playground-diagram-${diagramSeq++}`;
  let svg;
  try {
    ({ svg } = await mermaid.render(id, src));
    if (!svg || !/^\s*<svg/i.test(svg)) throw new Error('mermaid returned no SVG');
  } catch {
    // Mermaid leaves its error placard in the host document on a refused
    // source; this page renders into slides, never into itself.
    document.getElementById(`d${id}`)?.remove();
    failedDiagrams.set(src, 'invalid');
    return false;
  } finally {
    document.getElementById(id)?.remove();
  }

  vfs.mkdirSync(DIAGRAM_DIR, { recursive: true });
  vfs.writeFileSync(`${DIAGRAM_DIR}/${assets.mermaidContentKey(src, 'svg')}`, svg);
  const box = raster.svgAspect(svg);
  const png = box ? await raster.svgToPngCanvas(svg, box.w * assets.MERMAID_PNG_SCALE) : null;
  if (png) vfs.writeFileSync(`${DIAGRAM_DIR}/${assets.mermaidContentKey(src, 'png')}`, png.png);
  return true;
}

/** Mirrors the name sanitation in `lucideSvg()`: the fetch and the compiler's
 *  later lookup must agree on the file name or the icon vanishes between them. */
const iconSafeName = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');

/**
 * Fetches one icon from our own origin — /vendor/lucide-static/, the exact
 * files the CLI reads out of node_modules — into the virtual icon cache where
 * `lucideSvg()` looks. Same-origin on purpose: the page promises that nothing
 * about the deck leaves the machine, and an icon name is something about the
 * deck. The URL is asked of the import map, the single list of vendored
 * packages.
 */
async function provisionIcon(name) {
  const safe = iconSafeName(name);
  if (!safe) return false;
  try {
    const res = await fetch(import.meta.resolve(`lucide-static/icons/${safe}.svg`));
    if (res.status === 404) {
      missingIcons.add(safe);
      return false;
    }
    const svg = res.ok ? await res.text() : null;
    if (!svg || !assets.hasSvgRoot(svg)) return false; // transient: retried next compile
    vfs.mkdirSync(ICON_CACHE, { recursive: true });
    vfs.writeFileSync(`${ICON_CACHE}/${safe}.svg`, svg);
    return true;
  } catch {
    return false; // offline is transient too
  }
}

/** Every block of every scene — the shape describeGaps() has always read. */
const allBlocks = (result) =>
  result.scenes.flatMap((s) => [...s.elements.map((e) => e.block), ...(s.image ? [s.image] : [])]);

/**
 * Renders and fetches whatever this compile asked for and does not have yet.
 * Returns how many files landed on the virtual disk: zero means the next
 * compile would see the same disk, so the caller only recompiles on > 0 —
 * that, plus the negative caches above, is the loop's convergence argument.
 */
async function provision(result) {
  const blocks = allBlocks(result);
  let wrote = 0;

  const sources = [
    ...new Set(blocks.filter((b) => b.type === 'mermaid').map((b) => b.source)),
  ].filter(
    (s) =>
      !failedDiagrams.has(s) &&
      assets.mermaidContentKey(s, 'svg') &&
      !vfs.existsSync(`${DIAGRAM_DIR}/${assets.mermaidContentKey(s, 'svg')}`),
  );
  if (sources.length) {
    say(sources.length > 1 ? 'rendering the diagrams…' : 'rendering the diagram…');
    for (const src of sources) if (await provisionDiagram(src)) wrote++;
  }

  const icons = [...new Set(blocks.filter((b) => b.type === 'icon').map((b) => b.name))].filter(
    (n) =>
      iconSafeName(n) &&
      !missingIcons.has(iconSafeName(n)) &&
      !vfs.existsSync(`${ICON_CACHE}/${iconSafeName(n)}.svg`),
  );
  for (const name of icons) if (await provisionIcon(name)) wrote++;

  return wrote;
}

// ---------------------------------------------------------------------------
// what could not be drawn, said out loud
// ---------------------------------------------------------------------------

/**
 * What this page could not draw, AFTER it has tried — each entry carries
 * whether "npx lutrin" is a true remedy, because ending every line with the
 * CLI was only honest when the CLI genuinely had what the page lacked. A
 * diagram Mermaid refused and an icon Lucide does not ship fail identically
 * on the command line; only a remote image still lands there and not here.
 *
 * @returns {{text:string, cli:boolean}[]}
 */
function describeGaps(result) {
  const blocks = allBlocks(result);
  const gaps = [];

  for (const src of new Set(blocks.filter((b) => b.type === 'mermaid').map((b) => b.source))) {
    const why = failedDiagrams.get(src);
    if (why === 'bundle')
      gaps.push({
        text: 'a Mermaid diagram — the 3.5 MB renderer could not be fetched into this page.',
        cli: true,
      });
    else if (why)
      gaps.push({
        text: 'a Mermaid diagram is shown as its source: Mermaid refused it — an invalid diagram fails on the command line too.',
        cli: false,
      });
  }

  const iconNames = [...new Set(blocks.filter((b) => b.type === 'icon').map((b) => b.name))];
  const lost = iconNames.filter((n) => missingIcons.has(iconSafeName(n)));
  if (lost.length)
    gaps.push({
      text: `${lost.length > 1 ? 'icons' : 'the icon'} ${lost.map((n) => `"${n}"`).join(', ')} — not in the Lucide set this compiler pins, here or on the command line.`,
      cli: false,
    });

  for (const b of blocks) {
    if (b.type !== 'image' || /^kit:/i.test(b.src)) continue; // kit: has its own diagnostic
    if (/^[a-z][a-z0-9+.-]*:/i.test(b.src))
      gaps.push({
        text: `the remote image ${b.src} — fetched through a disk cache this page does not have.`,
        cli: true,
      });
    else if (!vfs.existsSync(assets.resolveImagePath('/deck', b.src)))
      gaps.push({
        text: `the image ${b.src} — no file by that name here. Drop the file onto the editor to embed it.`,
        cli: false,
      });
  }

  return gaps;
}

/**
 * The equations the compiler could not draw — read off its own stats
 * (`mathTotal - mathRendered`) rather than counted off the scene graph, because
 * the number that matters is what actually failed, not what was asked for.
 *
 * Two causes, and the visitor cannot tell them apart from here, so both are
 * named: LaTeX MathJax refuses (the usual one, and it refuses it on the command
 * line too), and a bundle that did not arrive — offline, blocked, a browser too
 * old for the shim. Neither is fixed by installing anything, which is why this
 * is a warning rather than a gap and why it does not end in the CLI command.
 *
 * @returns {string|null}
 */
function describeMath(result) {
  const lost = (result.stats?.mathTotal ?? 0) - (result.stats?.mathRendered ?? 0);
  if (!lost) return null;
  return lost > 1
    ? `${lost} equations are shown as their LaTeX source: MathJax refused them — invalid LaTeX fails on the command line too — or its 2.3 MB could not be fetched into this page.`
    : 'One equation is shown as its LaTeX source: MathJax refused it — invalid LaTeX fails on the command line too — or its 2.3 MB could not be fetched into this page.';
}

/**
 * The validator's findings, each a place to GO — a click puts the caret on the
 * line. This is the same `validateDeck` the CLI prints from and the VS Code
 * extension underlines with, so the page cannot invent findings of its own or
 * miss the ones the product would raise.
 */
function paintLint(diags) {
  if (!diags.length) return;
  const ul = document.createElement('ul');
  ul.className = 'pg-lint';
  for (const d of diags) {
    const li = document.createElement('li');
    li.dataset.severity = d.severity;
    const btn = document.createElement('button');
    btn.type = 'button';
    const where = document.createElement('span');
    where.className = 'pg-lint-line';
    where.textContent = `${d.severity} · line ${d.line}`;
    const msg = document.createElement('span');
    msg.className = 'pg-lint-msg';
    msg.textContent = d.suggestion ? `${d.message} Did you mean "${d.suggestion}"?` : d.message;
    btn.append(where, msg);
    btn.addEventListener('click', () => jumpToLine(d.line));
    li.appendChild(btn);
    ul.appendChild(li);
  }
  notes.appendChild(ul);
}

function paintNotes(result, diags) {
  notes.innerHTML = '';
  paintLint(diags);

  // A kit-image warning reaches this channel AND the validator, worded from
  // the same diagnostic — shown once, as the clickable finding, never twice.
  const said = new Set(
    diags.flatMap((d) => [
      d.message,
      ...(d.suggestion ? [`${d.message} Did you mean "${d.suggestion}"?`] : []),
    ]),
  );
  for (const w of result.stats?.warnings ?? []) if (!said.has(w)) note('pg-note pg-note-warn', w);

  const math = describeMath(result);
  if (math) note('pg-note pg-note-warn', math);

  const gaps = describeGaps(result);
  if (!gaps.length) return;

  note('pg-note pg-note-gap', 'This deck asks for something this page could not draw:');
  const ul = document.createElement('ul');
  ul.className = 'pg-gaps';
  for (const g of gaps) {
    const li = document.createElement('li');
    li.textContent = g.text;
    ul.appendChild(li);
  }
  notes.appendChild(ul);
  // The command is offered only when it is TRUE — a diagram Mermaid refused or
  // an icon Lucide does not ship fails identically under `npx lutrin`, and a
  // remedy that does not remedy is the half-honesty this page refuses.
  const cliFixes = gaps.filter((g) => g.cli).length;
  if (cliFixes)
    note(
      'pg-note pg-note-cmd',
      `${cliFixes > 1 ? 'Those land' : 'It lands'} from the command line: npx lutrin build deck.md -o deck.pptx`,
    );
}

// ---------------------------------------------------------------------------
// compile
// ---------------------------------------------------------------------------

/** Scales each slide to the width of the frame. Fragments are 1280 px wide by
 *  construction; a full build does this with an inlined script that fragments
 *  deliberately do not carry. */
function fit() {
  const width = frame.clientWidth - 28; // the stack's padding
  if (width <= 0) return;
  const s = width / SLIDE_W;
  for (const f of view.stack.children) {
    f.style.height = `${SLIDE_H * s}px`;
    if (f.firstElementChild) {
      f.firstElementChild.style.transform = `scale(${s})`;
      f.firstElementChild.style.transformOrigin = 'top left';
    }
  }
}

let lastCss = '';
let lastFonts = '';
/** The last compile that succeeded — the .pptx export renders THESE scenes
 *  rather than parsing the source a second time, so the file a visitor gets is
 *  the deck they are looking at and not a near-identical one. */
let last = null;
/** The pending recompile-as-you-type. Held here rather than beside its listener
 *  so an export can cash it in first — see `settle()`. */
let timer = null;

async function compile() {
  say('compiling…');
  const text = source.value;
  let result;
  try {
    result = await compileHtml(text, { baseDir: '/deck', fragment: true });
  } catch (e) {
    say('error', 'bad');
    notes.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'pg-error';
    pre.textContent = String(e?.message ?? e);
    notes.appendChild(pre);
    last = null;
    setDownloads();
    return;
  }

  // Anything this deck asked for that the virtual disk does not hold yet —
  // diagrams to render, icons to fetch — lands now, and the deck is compiled
  // once more over the filled disk. `provision()` only touches misses, so the
  // second pass writes nothing and the recursion stops there; a keystroke
  // during the async work wins instead, its own compile already scheduled.
  if ((await provision(result)) > 0 && source.value === text) return compile();

  last = result;
  setDownloads();

  // Equality guards: the font stylesheet can be hundreds of kilobytes, and
  // reassigning it on every keystroke is the one thing that makes a
  // recompile-as-you-type loop feel slow.
  if (result.fontsCss !== lastFonts) {
    lastFonts = result.fontsCss ?? '';
    view.fonts.textContent = lastFonts;
  }
  if (result.css !== lastCss) {
    lastCss = result.css;
    view.deck.textContent = result.css;
  }

  view.stack.innerHTML = result.slides.join('\n'); // compiler output: the one sanctioned innerHTML
  fit();

  const n = result.slides.length;
  say(n ? `${n} slide${n > 1 ? 's' : ''}` : 'no slides yet', n ? 'ok' : 'warn');

  let diags = [];
  try {
    diags = validateDeck(text, { baseDir: '/deck' });
  } catch {
    // a validator crash must not cost the preview — the compile already stood
  }
  paintNotes(result, diags);
  nameInput.placeholder = `${titleStem()}.md`;
  syncPreviewToCaret();
}

// ---------------------------------------------------------------------------
// the two downloads
// ---------------------------------------------------------------------------

/** Neither button offers a file for a deck that did not compile, and neither
 *  offers one while the other is building: a second export would run the same
 *  renderer over the same scenes for nothing. */
let busy = false;
function setDownloads() {
  const ready = !!last?.slides?.length && !busy;
  for (const b of [dlHtml, dlPptx]) b.disabled = !ready;
}

/** `Ma présentation` → `ma-presentation`. The deck's own title, so a file
 *  arrives named after what is in it; `deck` when it has no title to take. */
function titleStem() {
  const raw = last?.meta?.title ?? last?.scenes?.[0]?.title ?? '';
  const slug = String(raw)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'deck';
}

/** The name the visitor chose — typed into the bar, or carried by an opened
 *  file. Null until then: the title-derived stem stays live (the input's
 *  placeholder shows it), which is the old behavior and the right default. */
let docName = null;

/** One stem for every artifact — `.md`, `.html`, `.pptx` — so the three files
 *  of one deck sort together on disk instead of answering to two naming
 *  schemes. */
function fileStem() {
  if (!docName) return titleStem();
  return docName.replace(/\.[^.]*$/, '') || titleStem();
}

function offer(data, filename, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not revoked synchronously: Firefox has been known to cancel the download
  // when the object URL disappears in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Diagnostics whose REMEDY is a command, and therefore nonsense in a browser.
 *  The finding stands — it is the sentence after it that does not apply here,
 *  and a page telling a visitor to run `npm install` in a package they have not
 *  got would be exactly the kind of untrue line this playground refuses.
 *  Keyed by code and given the diagnostic itself, so nothing is parsed back out
 *  of prose that is free to change. */
const REPHRASED = {
  // RASTER_UNAVAILABLE is deliberately NOT rephrased any more, because it can
  // no longer be raised here: the compiler rasterizes through the browser's own
  // canvas when the native module is out of reach (deck/raster-browser.mjs), so
  // charts, equations, icons and native SmartArt arrive as pictures like
  // anywhere else. The entry that used to sit here explained that "a native
  // rasterizer no page can load" was the obstacle. That was never true — a
  // browser IS a rasterizer — and a page that keeps explaining a limitation it
  // no longer has teaches the visitor something false about the product.
  // Should the diagnostic ever reach this page again, it means the canvas
  // itself refused, and the plain finding is then the honest thing to show.
};

/** An export's notes belong to that export. `paintNotes` clears the whole area
 *  on the next compile; between two compiles, a second export replaces the
 *  first's report rather than stacking a duplicate under it. */
const fromExport = (el) => {
  el.dataset.export = '1';
  return el;
};
const clearExportNotes = () => {
  for (const el of notes.querySelectorAll('[data-export]')) el.remove();
};

/** What the EXPORT had to leave out — not the preview's list. The .pptx has
 *  gaps this page does not: a chart is live SVG in the frame and a raster in
 *  PowerPoint. So it is reported after the fact, from the export's own stats. */
function reportExport(stats) {
  const swap = new Map();
  for (const d of stats.diagnostics ?? [])
    if (REPHRASED[d.code]) swap.set(d.message, REPHRASED[d.code](d));

  const lines = (stats.warnings ?? []).map((w) => swap.get(w) ?? w);
  if (!lines.length) return;

  fromExport(note('pg-note pg-note-gap', 'What the .pptx could not carry out of this page:'));
  const ul = document.createElement('ul');
  ul.className = 'pg-gaps';
  ul.dataset.export = '1';
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
  notes.appendChild(ul);
  fromExport(note('pg-note pg-note-cmd', 'All of it lands: npx lutrin build deck.md -o deck.pptx'));
}

/** Cashes in a recompile the debounce has not fired yet, so an export always
 *  works from the source as it stands now. */
async function settle() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  await compile();
}

/** Wraps an export: the button says what it is doing, both are held shut while
 *  it runs, and a failure lands in the notes rather than in the console. The
 *  page has to be as honest about an export it could not produce as it is about
 *  a diagram it could not draw. */
async function exporting(button, label, run) {
  const original = button.textContent;
  busy = true;
  setDownloads();
  clearExportNotes();
  button.textContent = label;
  button.classList.add('is-busy');
  try {
    // A click 200 ms after the last keystroke would otherwise export the deck
    // as it was BEFORE that keystroke — the file and the preview would disagree
    // and nothing would say which one was right.
    await settle();
    if (!last) throw new Error('the deck no longer compiles — nothing to export');
    await run();
  } catch (e) {
    say('export failed', 'bad');
    fromExport(
      note('pg-note pg-note-bad', `The export did not finish: ${String(e?.message ?? e)}`),
    );
    fromExport(
      note(
        'pg-note pg-note-cmd',
        'On the command line it does: npx lutrin build deck.md -o deck.pptx',
      ),
    );
  } finally {
    button.textContent = original;
    button.classList.remove('is-busy');
    busy = false;
    setDownloads();
  }
}

dlHtml.addEventListener('click', () =>
  exporting(dlHtml, 'building…', async () => {
    // Recompiled WITHOUT `fragment`, which is the whole difference: this is the
    // complete document — the stylesheet, the fit script, the presenter mode —
    // rather than the slide fragments the preview frame stacks.
    const full = await compileHtml(source.value, { baseDir: '/deck' });
    offer(full.html, `${fileStem()}.html`, 'text/html;charset=utf-8');
    say('.html downloaded', 'ok');
  }),
);

/** Imported once, on the first .pptx asked for. */
let renderDeckBytes = null;

dlPptx.addEventListener('click', () =>
  exporting(dlPptx, 'building…', async () => {
    if (!renderDeckBytes) {
      say('loading the PowerPoint renderer…');
      renderDeckBytes = (await import('../../core/src/pptx/render.mjs')).renderDeckBytes;
    }
    say('building the .pptx…');
    const { bytes, stats } = await renderDeckBytes(last.scenes, last.meta, '/deck');
    offer(
      bytes,
      `${fileStem()}.pptx`,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    say(`.pptx downloaded — ${stats.slideCount} slide${stats.slideCount > 1 ? 's' : ''}`, 'ok');
    reportExport(stats);
  }),
);

source.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    compile();
    persistSource();
  }, 250);
});

// ---------------------------------------------------------------------------
// dropped images: hand the page the disk a local image needs
// ---------------------------------------------------------------------------

/** The formats the compiler itself accepts (EXT_BY_MIME, deck/assets.mjs) —
 *  anything else is refused HERE, by name, rather than accepted onto the disk
 *  and lost to a placeholder with less to say. */
const DROP_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/** Generous for a slide image, and a bound all the same: everything dropped
 *  lives in page memory, inlined base64 into every preview. */
const DROP_MAX_BYTES = 8 * 1024 * 1024;

/** `Photo d'équipe (1).JPG` → `photo-dequipe-1.jpg` — a name that survives a
 *  Markdown image destination unquoted and `resolveImagePath` untouched. The
 *  extension is kept from the name (the compiler picks its MIME by it). */
function droppedName(file, taken) {
  const dot = file.name.lastIndexOf('.');
  const ext = (dot > 0 ? file.name.slice(dot) : '.png').toLowerCase();
  const stem =
    file.name
      .slice(0, dot > 0 ? dot : undefined)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image';
  let name = `${stem}${ext}`;
  // a second drop of the same name REPLACES the file (that is what a person
  // re-dropping an edited photo means); only a same-batch collision suffixes
  for (let i = 2; taken.has(name); i++) name = `${stem}-${i}${ext}`;
  return name;
}

/** Inserts `text` at the caret, on its own paragraph, and recompiles. */
function insertAtCaret(text) {
  const at = source.selectionStart ?? source.value.length;
  const before = source.value.slice(0, at);
  const after = source.value.slice(source.selectionEnd ?? at);
  const glue =
    before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  source.value = `${before}${glue}${text}\n${after}`;
  const caret = before.length + glue.length + text.length + 1;
  source.setSelectionRange(caret, caret);
  source.focus();
}

/** Every dropped image goes into the virtual `/deck/`, which is the baseDir
 *  every compile runs against — from the compiler's point of view the file has
 *  simply always been next to the deck, exactly like on disk. Nothing is
 *  uploaded: the bytes go from the drop event into the page's own memory. */
async function acceptDrop(files) {
  const images = [...files].filter((f) => DROP_TYPES.has(f.type));
  if (!images.length) {
    say('not an image — png, jpeg, gif, webp or svg', 'warn');
    return;
  }
  const taken = new Set();
  const refs = [];
  for (const file of images) {
    if (file.size > DROP_MAX_BYTES) {
      say(`${file.name}: over 8 MB, not embedded`, 'warn');
      continue;
    }
    const name = droppedName(file, taken);
    taken.add(name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    vfs.writeFileSync(`/deck/${name}`, bytes);
    persistImage(name, bytes);
    refs.push(`![](${name})`);
  }
  if (!refs.length) return;
  insertAtCaret(refs.join('\n\n'));
  clearTimeout(timer);
  timer = null;
  await compile();
  persistSource();
}

const editor = document.querySelector('.pg-editor');
if (editor) {
  for (const type of ['dragover', 'dragleave', 'drop']) {
    editor.addEventListener(type, (e) => {
      // only for files — a text selection dragged within the textarea is the
      // browser's business, not ours
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      e.preventDefault();
      editor.classList.toggle('is-dropping', type === 'dragover');
      if (type === 'drop') acceptDrop(e.dataTransfer.files);
    });
  }
}

addEventListener('resize', fit);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(frame);

for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', () => {
    source.value = EXAMPLES[btn.dataset.example];
    for (const b of document.querySelectorAll('[data-example]'))
      b.setAttribute('aria-pressed', String(b === btn));
    compile();
    persistSource();
  });
}

// ---------------------------------------------------------------------------
// the workspace: what survives a reload, and how it leaves as a file
// ---------------------------------------------------------------------------

/** localStorage for the two small things (source, name), IndexedDB for image
 *  bytes. Every access is best-effort: storage can be denied outright
 *  (private windows, locked-down profiles), and an editor that cannot
 *  remember must still edit. */
const STORE_SOURCE = 'lutrin.playground.source';
const STORE_NAME = 'lutrin.playground.name';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lutrin-playground', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** One settled transaction per call — an editor tab is not a database load. */
async function idbFiles(mode, run) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const out = run(tx.objectStore('files'));
      tx.oncomplete = () => resolve(out?.result ?? out);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function persistSource() {
  if (IS_EMBED) return;
  try {
    localStorage.setItem(STORE_SOURCE, source.value);
    if (docName) localStorage.setItem(STORE_NAME, docName);
    else localStorage.removeItem(STORE_NAME);
  } catch {
    /* storage denied: the editor still edits */
  }
}

async function persistImage(name, bytes) {
  if (IS_EMBED) return;
  try {
    await idbFiles('readwrite', (files) => files.put(bytes, name));
  } catch {
    /* same policy */
  }
}

/** Everything the last visit left: the source into the textarea, the images
 *  into the virtual /deck/ — BEFORE the first compile, so the restored deck
 *  compiles over its images rather than reporting them missing once. */
async function restoreWorkspace() {
  if (IS_EMBED) return false;
  let text = null;
  try {
    text = localStorage.getItem(STORE_SOURCE);
    docName = localStorage.getItem(STORE_NAME) || null;
    if (docName) nameInput.value = docName;
  } catch {
    return false;
  }
  if (text === null) return false;
  try {
    const [names, all] = await Promise.all([
      idbFiles('readonly', (files) => files.getAllKeys()),
      idbFiles('readonly', (files) => files.getAll()),
    ]);
    names.forEach((name, i) => vfs.writeFileSync(`/deck/${name}`, all[i]));
  } catch {
    /* no images to restore is a working editor with fewer pictures */
  }
  source.value = text;
  for (const b of document.querySelectorAll('[data-example]'))
    b.setAttribute('aria-pressed', 'false');
  return true;
}

// --- the file verbs --------------------------------------------------------

/** The handle of the file Save writes back to — held from Open or from the
 *  first picker-backed Save, so the second Ctrl+S is a real save, not another
 *  dialog. Chromium-only today; everywhere else Save is a download. */
let fileHandle = null;

/** `deck` + `.md`, whatever was typed: the name drives three artifact names,
 *  and a stray path separator or an empty stem would surface at download
 *  time, as a browser-mangled filename nobody chose. */
function cleanDocName(raw) {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/^.*[/\\]/, '');
  if (!trimmed) return null;
  const stem = trimmed.replace(/\.(md|markdown|txt)$/i, '');
  return stem ? `${stem}.md` : null;
}

nameInput.addEventListener('change', () => {
  docName = cleanDocName(nameInput.value);
  nameInput.value = docName ?? '';
  fileHandle = null; // a renamed deck is no longer the opened file
  persistSource();
});

async function openDeck() {
  let text = null;
  let name = null;
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          { description: 'Markdown deck', accept: { 'text/markdown': ['.md', '.markdown'] } },
        ],
      });
      const file = await handle.getFile();
      text = await file.text();
      name = file.name;
      fileHandle = handle;
    } catch {
      return; // the picker was dismissed
    }
  } else {
    // the fallback picker: an <input type=file> that never joins the DOM
    const picked = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
    if (!picked) return;
    text = await picked.text();
    name = picked.name;
    fileHandle = null;
  }
  source.value = text;
  docName = cleanDocName(name);
  nameInput.value = docName ?? '';
  for (const b of document.querySelectorAll('[data-example]'))
    b.setAttribute('aria-pressed', 'false');
  await compile();
  persistSource();
}

async function saveDeck() {
  // the source as it stands, not as it last compiled: a save must never lose
  // the sentence typed since the debounce
  const text = source.value;
  if (fileHandle) {
    try {
      const w = await fileHandle.createWritable();
      await w.write(text);
      await w.close();
      say(`saved to ${docName}`, 'ok');
      persistSource();
      return;
    } catch {
      fileHandle = null; // permission lapsed: fall through to the picker/download
    }
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${fileStem()}.md`,
        types: [{ description: 'Markdown deck', accept: { 'text/markdown': ['.md'] } }],
      });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      fileHandle = handle;
      docName = cleanDocName(handle.name);
      nameInput.value = docName ?? '';
      say(`saved to ${docName}`, 'ok');
      persistSource();
      return;
    } catch {
      return; // dismissed — a cancelled save must not download instead
    }
  }
  offer(text, `${fileStem()}.md`, 'text/markdown;charset=utf-8');
  say('.md downloaded', 'ok');
  persistSource();
}

async function newDeck() {
  if (
    source.value.trim() &&
    !window.confirm('Start a new deck? The current one is discarded, saved images included.')
  )
    return;
  source.value = '# ';
  docName = null;
  fileHandle = null;
  nameInput.value = '';
  try {
    localStorage.removeItem(STORE_SOURCE);
    localStorage.removeItem(STORE_NAME);
  } catch {
    /* nothing stored, nothing to clear */
  }
  try {
    await idbFiles('readwrite', (files) => files.clear());
  } catch {
    /* same */
  }
  vfs.rmSync('/deck', { recursive: true, force: true });
  source.focus();
  source.setSelectionRange(source.value.length, source.value.length);
  await compile();
}

$('pg-new')?.addEventListener('click', newDeck);
$('pg-open')?.addEventListener('click', openDeck);
$('pg-save')?.addEventListener('click', saveDeck);

// --- keys an editor owes its keyboard --------------------------------------

source.addEventListener('keydown', (e) => {
  // Tab indents rather than leaves — Escape then Tab is the standard way out,
  // and stays available because only a bare Tab is claimed here.
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    // execCommand is deprecated and still the only insertion the undo stack
    // keeps; setRangeText would make the indent the last undoable thing ever
    if (!document.execCommand('insertText', false, '  '))
      source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end');
  }
});

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault(); // the browser would offer to save the page, not the deck
    if (!IS_EMBED) saveDeck();
  }
});

// ---------------------------------------------------------------------------
// the caret and the preview, tracking each other
// ---------------------------------------------------------------------------

/** Puts the caret on `line` (1-based, as every diagnostic counts) and brings
 *  it into view — the textarea scrolls by arithmetic, having no scrollIntoView
 *  of its own. */
function jumpToLine(line) {
  const lines = source.value.split('\n');
  const at = lines.slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0);
  source.focus();
  source.setSelectionRange(at, at);
  const lineHeight = Number.parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (line - 3) * lineHeight);
  syncPreviewToCaret();
}

/** The scene the caret is in: the last one whose `sourceLine` is at or above
 *  the caret's line. The compiler stamps every scene with where it came from,
 *  so this is a lookup, not a guess. */
function sceneIndexAtCaret() {
  const scenes = last?.scenes;
  if (!scenes?.length) return -1;
  const line = source.value.slice(0, source.selectionStart ?? 0).split('\n').length;
  let found = 0;
  scenes.forEach((s, i) => {
    if ((s.sourceLine ?? 1) <= line) found = i;
  });
  return found;
}

function syncPreviewToCaret() {
  const i = sceneIndexAtCaret();
  if (i < 0) return;
  const frames = view.stack.children;
  for (let k = 0; k < frames.length; k++) frames[k].classList.toggle('is-current', k === i);
  frames[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Caret moves that are not edits — clicks, arrows — still move the preview.
 *  rAF-throttled: selectionchange fires per caret step. */
let syncQueued = false;
document.addEventListener('selectionchange', () => {
  if (document.activeElement !== source || syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    syncPreviewToCaret();
  });
});

/** And the other direction: clicking a slide puts the caret on the line that
 *  produced it. Delegated on the stack, which outlives every innerHTML swap. */
view.stack.addEventListener('click', (e) => {
  if (e.target.closest('a')) return; // a real link keeps its meaning
  const frames = [...view.stack.children];
  const hit = frames.findIndex((f) => f.contains(e.target));
  if (hit < 0) return;
  const line = last?.scenes?.[hit]?.sourceLine;
  if (line) jumpToLine(line);
});

// ---------------------------------------------------------------------------
// boot: the last session if there was one, the first example if not
// ---------------------------------------------------------------------------

if (!(await restoreWorkspace())) source.value = EXAMPLES.funnel;
source.disabled = false;
await compile();
