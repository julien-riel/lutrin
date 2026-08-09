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
 * `describeGaps()` exists for the same honesty reason as (2): Mermaid needs a
 * subprocess, math needs a CommonJS package no import map can load, icons and
 * images need a disk. All four vanish in silence here, so the page works out
 * what went missing and names the command that would have rendered it.
 *
 * THE TWO DOWNLOADS are the same compiler again, not an export of the preview.
 * `.html` is `compileHtml` without `fragment`, so it is the standalone page
 * `lutrin build --html` writes, presenter mode and all. `.pptx` is
 * `renderDeckBytes` — the real PowerPoint renderer, its eight post-processing
 * passes included, running against the `node:fs` shim. It is imported ON THE
 * FIRST CLICK and never before: `jszip` and `pptxgenjs` are half a megabyte
 * that a reader who only types must not pay for.
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
      '.pg-stack{display:flex;flex-direction:column;gap:14px;padding:14px}</style>' +
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
// what a browser cannot do, said out loud
// ---------------------------------------------------------------------------

function describeGaps(result) {
  const blocks = result.scenes.flatMap((s) => [
    ...s.elements.map((e) => e.block),
    ...(s.image ? [s.image] : []),
  ]);
  const n = (t) => blocks.filter((b) => b.type === t).length;
  const plural = (k, one, many) => `${k} ${k > 1 ? many : one}`;
  const gaps = [];

  if (n('mermaid'))
    gaps.push(
      `${plural(n('mermaid'), 'Mermaid diagram', 'Mermaid diagrams')} — rendering one needs a headless browser, which a page cannot start.`,
    );
  if (n('math'))
    gaps.push(
      `${plural(n('math'), 'equation', 'equations')} — MathJax ships as CommonJS, which no import map can load here.`,
    );
  if (n('icon'))
    gaps.push(
      `${plural(n('icon'), 'icon', 'icons')} — the icon set is read from disk, not fetched.`,
    );
  if (n('image'))
    gaps.push(
      `${plural(n('image'), 'image', 'images')} — a local file has no path here, and a remote one is fetched through a disk cache.`,
    );

  return gaps;
}

function paintNotes(result) {
  notes.innerHTML = '';
  for (const w of result.stats?.warnings ?? []) note('pg-note pg-note-warn', w);

  const gaps = describeGaps(result);
  if (!gaps.length) return;

  note('pg-note pg-note-gap', 'This deck asks for something a browser cannot draw:');
  const ul = document.createElement('ul');
  ul.className = 'pg-gaps';
  for (const g of gaps) {
    const li = document.createElement('li');
    li.textContent = g;
    ul.appendChild(li);
  }
  notes.appendChild(ul);
  note(
    'pg-note pg-note-cmd',
    `${gaps.length > 1 ? 'They all work' : 'It works'} on the command line: npx lutrin build deck.md -o deck.pptx`,
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
  let result;
  try {
    result = await compileHtml(source.value, { baseDir: '/deck', fragment: true });
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
  paintNotes(result);
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

/** `Ma présentation` → `ma-presentation`. The deck's own title, so the file
 *  arrives named after what is in it; `deck` when it has no title to take. */
function fileStem() {
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
  }, 250);
});

addEventListener('resize', fit);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(frame);

for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', () => {
    source.value = EXAMPLES[btn.dataset.example];
    for (const b of document.querySelectorAll('[data-example]'))
      b.setAttribute('aria-pressed', String(b === btn));
    compile();
  });
}

source.value = EXAMPLES.funnel;
source.disabled = false;
await compile();
