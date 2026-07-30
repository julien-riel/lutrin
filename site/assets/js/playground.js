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
    return;
  }

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

let timer = null;
source.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(compile, 250);
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
