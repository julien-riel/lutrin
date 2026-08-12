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

// CodeMirror — the editor pane. Statically imported, unlike every heavy
// optional above: the editor IS the page, there is no later moment to defer
// it to. Genuine browser ESM resolved by the import map, like markdown-it;
// ~1.4 MB before gzip, which is the cost of the pane being an editor rather
// than a textarea, and a third of what Monaco's minified core would weigh.
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
  drawSelection,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import {
  autocompletion,
  completionKeymap,
  snippetCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

import { CONTAINER_SNIPPETS, FENCE_SNIPPETS } from './deck-snippets.mjs';
import { DECK_EXAMPLES } from './deck-examples.mjs';

// Resolved from this file's own URL, so the page works at the site root or
// under a path — and taken as `.pathname`, because that is the form the
// compiler computes for itself through fileURLToPath(import.meta.url).
const CORE_URL = new URL('../../core/', import.meta.url);
const LAYOUT_DIR = new URL('design/layouts/', CORE_URL).pathname;

const SLIDE_W = 1280;
const SLIDE_H = 720;

const $ = (id) => document.getElementById(id);
const frame = $('pg-frame');
const notes = $('pg-notes');
const status = $('pg-status');
const dlHtml = $('pg-dl-html');
const dlPptx = $('pg-dl-pptx');
const nameInput = $('pg-name');
const kitSelect = $('pg-kit');
const kitFileInput = $('pg-kit-file');

/** The landing page's card (?embed=1) is a taster, not a workspace: nothing
 *  is restored into it and nothing typed there is kept. */
const IS_EMBED = document.documentElement.classList.contains('is-embed');

// ---------------------------------------------------------------------------
// the editor pane
// ---------------------------------------------------------------------------

/** The dark pane, spelled where the code that owns the editor is. Colors are
 *  the ones the textarea had (see .pg-editor in playground.css for the frame
 *  around it); the CSS variables come through as variables, so a palette
 *  change in main.css reaches in here too. */
const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#dce6fb', height: '100%' },
    '.cm-content': {
      fontFamily: 'var(--f-mono)',
      fontSize: '0.85rem',
      lineHeight: '1.65',
      padding: '1rem 0.6rem',
      caretColor: '#dce6fb',
    },
    '.cm-cursor': { borderLeftColor: '#dce6fb' },
    '&.cm-focused': { outline: 'none' }, // the host draws the focus ring (playground.css)
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(110, 168, 254, 0.25)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#51648a',
      border: 'none',
      fontSize: '0.72rem',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8fa4c8' },
    '.cm-lint-marker': { width: '0.8em', height: '0.8em' },
    // the tooltip a squiggle opens on hover — and the completion popup, which
    // is a tooltip too
    '.cm-tooltip': {
      backgroundColor: '#1c2536',
      color: '#dce6fb',
      border: '1px solid #33415e',
      fontSize: '0.8rem',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgba(110, 168, 254, 0.25)',
      color: '#ffffff',
    },
    '.cm-completionDetail': { color: '#8fa4c8', fontStyle: 'normal', marginLeft: '0.6em' },
  },
  { dark: true },
);

/** Markdown, lit for a dark pane. Only the tags the DSL actually surfaces —
 *  headings (slides and sections), fences (chart/math/mermaid), emphasis,
 *  links, list marks, the frontmatter's meta. */
const editorHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#ffffff', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: '#8ab4ff' },
  { tag: tags.monospace, color: '#ffd28a' },
  { tag: [tags.meta, tags.processingInstruction, tags.contentSeparator], color: '#7386a8' },
  { tag: tags.quote, color: '#a9b8d6', fontStyle: 'italic' },
  { tag: tags.labelName, color: '#9ecbff' },
]);

/** The compiler modules the completion sources read — set once the compiler
 *  has loaded, so completions simply do not exist until then. Each list is
 *  the LIVE view the validator checks the same syntax against (`LAYOUTS`,
 *  `ANIM_PRESETS`, `KIT_IMAGES`): completion can never suggest what
 *  validation would then flag, and nothing here is a second list. */
let layoutCatalog = null;
let animPresets = null;
let kitImages = null;
let containerNames = null;

/** The Lucide icon names, fetched once from our own origin the first time a
 *  `lucide:` completion is asked — ~2 000 names, ~30 kB, and only for the
 *  visitor who types the scheme. Memoized including failure: a page that
 *  cannot fetch the index must not re-fetch nothing per keystroke. The file
 *  is generated beside the icons by site-serve.mjs and pages.yml, the
 *  layouts.json pattern again. */
let _iconIndex = null;
async function iconIndex() {
  if (_iconIndex === null) {
    try {
      const url = new URL('../icons.json', import.meta.resolve('lucide-static/icons/'));
      const res = await fetch(url);
      _iconIndex = res.ok ? await res.json() : false;
    } catch {
      _iconIndex = false;
    }
  }
  return _iconIndex || null;
}

/** A key chained straight into its values: the key alone is never the
 *  answer. startCompletion is deferred a task — called synchronously from
 *  apply, it is cancelled by the popup's own accept-and-close that runs
 *  right after, and the chain silently never opens. */
const keyOption = (label, detail) => ({
  label,
  type: 'keyword',
  detail,
  apply: (v, _c, from, to) => {
    v.dispatch({
      changes: { from, to, insert: `${label} ` },
      selection: { anchor: from + label.length + 1 },
    });
    setTimeout(() => startCompletion(v), 0);
  },
});

/** Is `lineNo` inside the frontmatter? True only under a `---` opener on
 *  line 1 with no closing `---` met yet — the same reading parseDeck makes. */
function inFrontmatter(doc, lineNo) {
  if (doc.line(1).text.trim() !== '---') return false;
  for (let n = 2; n < lineNo; n++) if (doc.line(n).text.trim() === '---') return false;
  return lineNo > 1;
}

/**
 * Everything the DSL asks for out of a closed list, completed where it is
 * asked. Matched on the text before the caret, most specific first:
 *
 *   `<!-- layout: fu`      → layout names, catalogue description as detail
 *   `<!-- animate: f`      → the presets, plus true/none
 *   `animate: f` (frontmatter) → the same, for the deck-wide default
 *   `<!-- lay`             → the directive keys, chaining into their values
 *   `](lucide:ro` / `](icon:ro` → the icon set, fetched on first ask
 *   `](kit:he`             → the aliases the active kit declares
 *   `:::me` (line start)   → a whole WORKED block, as a snippet — fields the
 *                            Tab key walks, closing `:::` included. The names
 *                            come from `CONTAINERS`, the templates from
 *                            deck-snippets.mjs, and a test compiles every
 *                            template through the validator: the help can
 *                            never insert what validation would underline.
 *
 * The closing token (` -->`, `)`) is appended only when the line has not
 * written it yet.
 */
async function directiveCompletions(ctx) {
  if (!layoutCatalog) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const after = line.text.slice(ctx.pos - line.from);
  const closeComment = /^\s*-->/.test(after) ? '' : ' -->';
  const closeParen = /^\)/.test(after) ? '' : ')';

  const container = /^:::([a-z]*)$/i.exec(before);
  if (container)
    return {
      from: ctx.pos - container[1].length,
      options: (containerNames ?? [])
        .filter((n) => CONTAINER_SNIPPETS[n])
        .map((n) =>
          snippetCompletion(CONTAINER_SNIPPETS[n].template, {
            label: n,
            type: 'keyword',
            detail: CONTAINER_SNIPPETS[n].detail,
          }),
        ),
      validFor: /^[a-z]*$/i,
    };

  // the three fences the compiler treats as more than code. An ordinary code
  // fence (```js…) simply matches none of the three and the popup closes —
  // the help must never get between an author and a plain code block.
  const fence = /^```([a-z]*)$/i.exec(before);
  if (fence)
    return {
      from: ctx.pos - fence[1].length,
      options: Object.entries(FENCE_SNIPPETS).map(([n, s]) =>
        snippetCompletion(s.template, { label: n, type: 'keyword', detail: s.detail }),
      ),
      validFor: /^[a-z]*$/i,
    };

  const layoutName = /<!--\s*layout:\s*([a-z0-9-]*)$/i.exec(before);
  if (layoutName)
    return {
      from: ctx.pos - layoutName[1].length,
      options: layoutCatalog.LAYOUTS.map((n) => ({
        label: n,
        type: 'type',
        detail: layoutCatalog.layoutDef(n)?.description,
        apply: `${n}${closeComment}`,
      })),
      validFor: /^[a-z0-9-]*$/i,
    };

  const animOptions = (close) => [
    ...(animPresets ?? []).map((n) => ({
      label: n,
      type: 'type',
      detail: 'preset',
      apply: `${n}${close}`,
    })),
    {
      label: 'true',
      type: 'constant',
      detail: 'each block type picks its preset',
      apply: `true${close}`,
    },
    { label: 'none', type: 'constant', detail: 'no animation', apply: `none${close}` },
  ];
  const animName = /<!--\s*animate:\s*([a-z]*)$/i.exec(before);
  if (animName)
    return {
      from: ctx.pos - animName[1].length,
      options: animOptions(closeComment),
      validFor: /^[a-z]*$/i,
    };
  const animMeta = /^animate:\s*([a-z]*)$/i.exec(before);
  if (animMeta && inFrontmatter(ctx.state.doc, line.number))
    return {
      from: ctx.pos - animMeta[1].length,
      options: animOptions(''),
      validFor: /^[a-z]*$/i,
    };

  const key = /<!--\s*([a-z]*)$/i.exec(before);
  if (key)
    return {
      from: ctx.pos - key[1].length,
      options: [
        keyOption('layout:', 'impose a layout on this slide'),
        keyOption('animate:', 'animate this slide'),
      ],
      validFor: /^[a-z]*$/i,
    };

  // image destinations: `![…](lucide:…)`, `![…](icon:…)`, `![…](kit:…)` —
  // markdown-it also accepts the `<…>` wrapped form, hence the optional `<`
  const icon = /!\[[^\]]*\]\(\s*<?\s*(?:lucide|icon):([a-z0-9-]*)$/i.exec(before);
  if (icon) {
    const names = await iconIndex();
    if (!names) return null;
    return {
      from: ctx.pos - icon[1].length,
      options: names.map((n) => ({ label: n, type: 'constant', apply: `${n}${closeParen}` })),
      validFor: /^[a-z0-9-]*$/i,
    };
  }
  const kit = /!\[[^\]]*\]\(\s*<?\s*kit:([a-z0-9-]*)$/i.exec(before);
  if (kit) {
    const aliases = Object.keys(kitImages ?? {});
    if (!aliases.length) return null; // no kit active: nothing to offer is the truth
    return {
      from: ctx.pos - kit[1].length,
      options: aliases.map((a) => ({
        label: a,
        type: 'constant',
        detail: typeof kitImages[a] === 'string' ? kitImages[a] : undefined,
        apply: `${a}${closeParen}`,
      })),
      validFor: /^[a-z0-9-]*$/i,
    };
  }

  return null;
}

/** Locked while the compiler loads, and for good if it cannot load — the
 *  reconfigurable slot readonly lives in. */
const lockSlot = new Compartment();

/** Set during a programmatic dispatch (examples, Open, restore, drop): those
 *  call sites decide themselves when to compile and persist, and the
 *  updateListener must not schedule a second, identical pass behind them. */
let programmaticEdit = false;

const cmView = new EditorView({
  parent: $('pg-source'),
  state: EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown(),
      syntaxHighlighting(editorHighlight),
      lintGutter(),
      editorTheme,
      placeholder('# A title starts a slide'),
      autocompletion({ override: [directiveCompletions] }),
      // completionKeymap first: its bindings (Enter, arrows, Escape) answer
      // only while the popup is open, and must answer before the editing
      // keymaps take Enter for a list continuation. Tab indents (Escape then
      // Tab leaves, CodeMirror's documented escape hatch).
      keymap.of([
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...markdownKeymap,
        indentWithTab,
      ]),
      lockSlot.of(EditorState.readOnly.of(true)),
      EditorView.contentAttributes.of({ 'aria-label': 'The deck, in Markdown' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !programmaticEdit) scheduleCompile();
        if (u.selectionSet) queueCaretSync();
      }),
    ],
  }),
});

/** The editor, as the four verbs the rest of this file needs. Everything else
 *  CodeMirror can do stays CodeMirror's business, behind this seam. */
const ed = {
  get text() {
    return cmView.state.doc.toString();
  },
  set text(t) {
    programmaticEdit = true;
    try {
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: t },
        selection: { anchor: 0 },
      });
    } finally {
      programmaticEdit = false;
    }
  },
  get caret() {
    return cmView.state.selection.main.head;
  },
  get caretLine() {
    return cmView.state.doc.lineAt(this.caret).number;
  },
  setCaret(pos) {
    const at = Math.max(0, Math.min(pos, cmView.state.doc.length));
    cmView.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  },
  focus() {
    cmView.focus();
  },
  setLocked(locked) {
    cmView.dispatch({ effects: lockSlot.reconfigure(EditorState.readOnly.of(locked)) });
  },
};

/** For the harness scripts (scripts/playground-raster-check.mjs and the smoke
 *  checks): a page whose editor is a canvas of spans cannot be driven by
 *  setting `.value` on anything, so the drive surface is published on purpose.
 *  `setText` behaves like typing — it compiles and persists. */
window.lutrinEditorHooks = {
  getText: () => ed.text,
  setText: (t) => {
    ed.text = t;
    clearTimeout(timer);
    timer = null;
    const done = compile();
    persistSource();
    return done;
  },
  setCaret: (pos) => ed.setCaret(pos),
  caretLine: () => ed.caretLine,
  // the smoke checks upload a packKit() round-trip through this — a file
  // dialog cannot be driven headlessly
  uploadKit: (bytes) => uploadKitBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
};

// The examples themselves live in deck-examples.mjs — an import-free module a
// test can compile through the real validator, the deck-snippets.mjs pattern.

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
let gaveUp = false;
function giveUp(message, detail) {
  gaveUp = true;
  say('unavailable', 'bad');
  notes.innerHTML = '';
  note('pg-note pg-note-bad', message);
  if (detail) {
    const pre = document.createElement('pre');
    pre.className = 'pg-error';
    pre.textContent = detail;
    notes.appendChild(pre);
  }
  ed.setLocked(true);
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
  // the completion sources wake up here — all three lists are the live views
  // the validator itself checks against
  layoutCatalog = layout;
  const parse = await import('../../core/src/deck/parse.mjs');
  animPresets = parse.ANIM_PRESETS;
  containerNames = parse.CONTAINERS;
  kitImages = (await import('../../core/src/deck/tokens.mjs')).KIT_IMAGES;

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
  if (!gaveUp)
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
// kits: a brand, fetched into the virtual filesystem and resolved for real
// ---------------------------------------------------------------------------

/** The kit the deck compiles under — a PATH in the virtual filesystem, handed
 *  to the compiler as `themePath`. Everything downstream is the same code
 *  that resolves a kit directory on disk: the manifest is read, the theme
 *  validated, assets confined to the kit, the kit's own layouts registered
 *  (which is what makes them appear in the layout completion, live). Null is
 *  the default theme. */
let kitPath = null;

/** What /kits/index.json declared: kit name → its files. Fetched once at
 *  load; empty when the index is unreachable, and the picker then simply
 *  offers nothing beyond the default. */
let kitIndex = {};

/** Kits whose files already landed in the VFS — a kit is fetched once per
 *  visit, switching back to it is instant. */
const loadedKits = new Set();

/** Kit files that are text to the compiler; everything else stays bytes.
 *  (Fonts are the case that matters: a .woff2 read back must still be the
 *  bytes fontFaceCss base64-inlines.) */
const KIT_TEXT = /\.(json|svg|txt|md)$/i;

async function fetchKit(name) {
  if (loadedKits.has(name)) return;
  const files = kitIndex[name];
  if (!files) throw new Error(`unknown kit "${name}"`);
  await Promise.all(
    files.map(async (f) => {
      // One retry after a beat, because ONE dropped fetch out of the half
      // dozen a kit needs was the difference between a kit and an opaque
      // failure — the exact shape of a phone losing one connection of a
      // parallel burst. `no-cache` revalidates (a cheap 304 against Pages):
      // right after a deploy, a stale cached copy beside fresh ones is the
      // other way a kit arrives half of one version and half of another.
      const url = `kits/${name}/${f}`;
      let res = await fetch(url, { cache: 'no-cache' }).catch(() => null);
      if (!res?.ok) {
        await new Promise((r) => setTimeout(r, 400));
        res = await fetch(url, { cache: 'no-cache' });
      }
      if (!res.ok) throw new Error(`${name}/${f}: HTTP ${res.status}`);
      vfs.writeFileSync(
        `/kits/${name}/${f}`,
        KIT_TEXT.test(f) ? await res.text() : new Uint8Array(await res.arrayBuffer()),
      );
    }),
  );
  loadedKits.add(name);
}

/** The visitor's own kit — an uploaded `.deckkit`, one at a time, mounted
 *  under a reserved name no example kit can carry (kit names are lowercase
 *  by grammar, so `@user` cannot collide). */
const USER_KIT = '@user';
const USER_KIT_DIR = `/kits/${USER_KIT}`;

/**
 * Validates an archive and mounts it as the user kit: the SAME
 * `readKitArchive` the CLI installs through — zip-slip refusal, extension
 * allowlist, size limits, manifest validation — imported on the first upload
 * and never before (it drags JSZip in). What it accepts lands in the VFS
 * exactly like a fetched example kit; what it refuses throws with the CLI's
 * own wording.
 */
async function mountKitArchive(bytes) {
  const { readKitArchive } = await import('../../core/src/kit/archive.mjs');
  const { manifest, files } = await readKitArchive(bytes);
  vfs.rmSync(USER_KIT_DIR, { recursive: true, force: true });
  for (const [rel, content] of files) vfs.writeFileSync(`${USER_KIT_DIR}/${rel}`, content);
  // the picker names it after the manifest, marked as the visitor's own
  let opt = [...kitSelect.options].find((o) => o.value === USER_KIT);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = USER_KIT;
    kitSelect.appendChild(opt); // last, after the examples: the visitor's own
  }
  opt.textContent = `${manifest.name} (uploaded)`;
  return manifest;
}

/** An upload, end to end: validate, mount, remember. The archive's BYTES go
 *  to IndexedDB — not the extracted tree — so the next visit re-validates
 *  exactly what was uploaded, and a rule tightened since then re-refuses it. */
async function uploadKitBytes(bytes) {
  try {
    say('reading the kit…');
    await mountKitArchive(bytes);
    kitPath = USER_KIT_DIR;
    kitSelect.value = USER_KIT;
    try {
      await idbStore('kit', 'readwrite', (s) => s.put(bytes, 'archive'));
    } catch {
      /* storage denied: the kit applies for this visit and is forgotten */
    }
    await compile();
    persistSource();
    return true;
  } catch (e) {
    say('the kit was refused', 'bad');
    note('pg-note pg-note-bad', String(e?.message ?? e));
    return false;
  }
}

/** Applies a kit by name ('' = default), fetching it first if needed.
 *  Returns true when the switch happened — the caller recompiles. */
async function useKit(name) {
  if (!name) {
    kitPath = null;
    return true;
  }
  if (name === USER_KIT) {
    if (!vfs.existsSync(`${USER_KIT_DIR}/kit.json`)) return false; // nothing mounted
    kitPath = USER_KIT_DIR;
    return true;
  }
  try {
    say('loading the kit…');
    await fetchKit(name);
    kitPath = `/kits/${name}`;
    return true;
  } catch (e) {
    // the cause travels with the verdict — "HTTP 404 on theme.json" and "the
    // network dropped" call for different next moves, and a banner that
    // swallows the difference sends the author nowhere (the upload path
    // already says why; the fetch path owed the same)
    say(`the kit "${name}" could not be loaded`, 'bad');
    note('pg-note pg-note-bad', String(e?.message ?? e));
    return false;
  }
}

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

/** The recompile-as-you-type debounce, fed by the editor's updateListener. */
function scheduleCompile() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    compile();
    persistSource();
  }, 250);
}

async function compile() {
  say('compiling…');
  const text = ed.text;
  let result;
  try {
    result = await compileHtml(text, { baseDir: '/deck', fragment: true, themePath: kitPath });
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
  if ((await provision(result)) > 0 && ed.text === text) return compile();

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
    diags = validateDeck(text, { baseDir: '/deck', themePath: kitPath });
  } catch {
    // a validator crash must not cost the preview — the compile already stood
  }
  paintNotes(result, diags);
  markDiagnostics(diags, text);
  nameInput.placeholder = `${titleStem()}.md`;
  syncPreviewToCaret();
}

/** The same findings, drawn where an editor draws them: as squiggles under
 *  the line, with the message on hover and a mark in the gutter. Guarded on
 *  the text still being the one validated — a keystroke during the async
 *  compile would otherwise put ranges on a document they were not measured
 *  against. */
function markDiagnostics(diags, text) {
  if (ed.text !== text) return;
  const doc = cmView.state.doc;
  cmView.dispatch(
    setDiagnostics(
      cmView.state,
      diags.map((d) => {
        const line = doc.line(Math.max(1, Math.min(d.line, doc.lines)));
        return {
          from: line.from,
          to: line.to,
          severity: d.severity === 'error' ? 'error' : d.severity === 'info' ? 'info' : 'warning',
          message: d.suggestion ? `${d.message} Did you mean "${d.suggestion}"?` : d.message,
        };
      }),
    ),
  );
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
    const full = await compileHtml(ed.text, { baseDir: '/deck', themePath: kitPath });
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

/** Inserts `text` at the caret, on its own paragraph. Through the editor's
 *  own transaction, so the undo stack keeps it like any typed edit. */
function insertAtCaret(text) {
  const { from, to } = cmView.state.selection.main;
  const before = cmView.state.doc.sliceString(0, from);
  const glue =
    before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const insert = `${glue}${text}\n`;
  programmaticEdit = true; // acceptDrop compiles and persists itself, just after
  try {
    cmView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
    });
  } finally {
    programmaticEdit = false;
  }
  ed.focus();
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
    editor.addEventListener(
      type,
      (e) => {
        // only for files — a text selection dragged within the editor is
        // CodeMirror's business, not ours
        if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
        // capture phase + stopPropagation: CodeMirror has drop handling of its
        // own, and a file that reached it would be pasted as text or a path
        e.preventDefault();
        e.stopPropagation();
        editor.classList.toggle('is-dropping', type === 'dragover');
        if (type === 'drop') acceptDrop(e.dataTransfer.files);
      },
      true,
    );
  }
}

addEventListener('resize', fit);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(frame);

for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', async () => {
    const example = DECK_EXAMPLES[btn.dataset.example];
    // An example written against one of the example kits switches the picker
    // to it first: the deck asks for layouts and images only that kit
    // declares, and compiling it under another theme would open on a page of
    // diagnostics about a mistake the visitor did not make. A kit that cannot
    // be fetched is already reported by useKit — the text still loads, and
    // the diagnostics then say honestly what is missing.
    if (example.kit && kitName() !== example.kit && (await useKit(example.kit)))
      kitSelect.value = example.kit;
    ed.text = example.source;
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
const STORE_KIT = 'lutrin.playground.kit';

/** The active kit's name, '' for the default — what the picker shows and the
 *  storage keeps. */
const kitName = () => (kitPath ? kitPath.slice('/kits/'.length) : '');

function idb() {
  return new Promise((resolve, reject) => {
    // v2 added the 'kit' store (the uploaded .deckkit's bytes). The upgrade
    // handler creates whatever is missing, so a v1 visitor and a fresh one
    // arrive at the same schema.
    const req = indexedDB.open('lutrin-playground', 2);
    req.onupgradeneeded = () => {
      for (const store of ['files', 'kit'])
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** One settled transaction per call — an editor tab is not a database load. */
async function idbStore(store, mode, run) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const out = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(out?.result ?? out);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const idbFiles = (mode, run) => idbStore('files', mode, run);

function persistSource() {
  if (IS_EMBED) return;
  try {
    localStorage.setItem(STORE_SOURCE, ed.text);
    if (docName) localStorage.setItem(STORE_NAME, docName);
    else localStorage.removeItem(STORE_NAME);
    if (kitName()) localStorage.setItem(STORE_KIT, kitName());
    else localStorage.removeItem(STORE_KIT);
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

/** Everything the last visit left: the source into the editor, the images
 *  into the virtual /deck/ — BEFORE the first compile, so the restored deck
 *  compiles over its images rather than reporting them missing once. */
async function restoreWorkspace() {
  if (IS_EMBED) return false;
  let text = null;
  let kit = null;
  try {
    text = localStorage.getItem(STORE_SOURCE);
    docName = localStorage.getItem(STORE_NAME) || null;
    kit = localStorage.getItem(STORE_KIT) || null;
    if (docName) nameInput.value = docName;
  } catch {
    return false;
  }
  if (text === null) return false;
  // the kit BEFORE the first compile, like the images below — a restored deck
  // must open under its brand, not flash the default and repaint. An uploaded
  // kit comes back from IndexedDB and through the archive validation AGAIN:
  // the bytes were kept, not the trust.
  if (kit === USER_KIT) {
    try {
      const bytes = await idbStore('kit', 'readonly', (s) => s.get('archive'));
      if (bytes) {
        await mountKitArchive(bytes);
        kitPath = USER_KIT_DIR;
        kitSelect.value = USER_KIT;
      }
    } catch {
      /* archive gone or newly refused: the default theme is the honest state */
    }
  } else if (kit && kitIndex[kit] && (await useKit(kit))) kitSelect.value = kit;
  try {
    const [names, all] = await Promise.all([
      idbFiles('readonly', (files) => files.getAllKeys()),
      idbFiles('readonly', (files) => files.getAll()),
    ]);
    names.forEach((name, i) => vfs.writeFileSync(`/deck/${name}`, all[i]));
  } catch {
    /* no images to restore is a working editor with fewer pictures */
  }
  ed.text = text;
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
  ed.text = text;
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
  const text = ed.text;
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
    ed.text.trim() &&
    !window.confirm(
      'Start a new deck? The current one is discarded — saved images and your uploaded kit included.',
    )
  )
    return;
  ed.text = '# ';
  docName = null;
  fileHandle = null;
  nameInput.value = '';
  try {
    localStorage.removeItem(STORE_SOURCE);
    localStorage.removeItem(STORE_NAME);
    localStorage.removeItem(STORE_KIT);
  } catch {
    /* nothing stored, nothing to clear */
  }
  try {
    await idbFiles('readwrite', (files) => files.clear());
  } catch {
    /* same */
  }
  // the uploaded kit is workspace too: mount, archive and picker entry go
  try {
    await idbStore('kit', 'readwrite', (s) => s.clear());
  } catch {
    /* same */
  }
  vfs.rmSync(USER_KIT_DIR, { recursive: true, force: true });
  [...kitSelect.options].find((o) => o.value === USER_KIT)?.remove();
  kitPath = null;
  kitSelect.value = '';
  vfs.rmSync('/deck', { recursive: true, force: true });
  ed.setCaret(ed.text.length);
  ed.focus();
  await compile();
}

$('pg-new')?.addEventListener('click', newDeck);
$('pg-open')?.addEventListener('click', openDeck);
$('pg-save')?.addEventListener('click', saveDeck);

// --- keys an editor owes its keyboard --------------------------------------

// Tab, undo, list continuation: the editor's keymap owns them now
// (indentWithTab, historyKeymap, markdownKeymap — see the extensions block).
// What stays here is the one chord the PAGE owes, wherever focus is:

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
 *  it into view. */
function jumpToLine(line) {
  const doc = cmView.state.doc;
  ed.setCaret(doc.line(Math.max(1, Math.min(line, doc.lines))).from);
  ed.focus();
  syncPreviewToCaret();
}

/** The scene the caret is in: the last one whose `sourceLine` is at or above
 *  the caret's line. The compiler stamps every scene with where it came from,
 *  so this is a lookup, not a guess. */
function sceneIndexAtCaret() {
  const scenes = last?.scenes;
  if (!scenes?.length) return -1;
  const line = ed.caretLine;
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
 *  rAF-throttled: the editor reports every selection step, and one frame's
 *  worth of them moves the preview once. Fed by the updateListener in the
 *  editor's extensions. */
let syncQueued = false;
function queueCaretSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    syncPreviewToCaret();
  });
}

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
// the kit picker
// ---------------------------------------------------------------------------

// Populated before restore, which may need to re-select a remembered kit. An
// unreachable index costs the picker its options and nothing else — the page
// compiles under the default theme exactly as before kits existed here.
try {
  // revalidated for the same reason as the kit files: right after a deploy,
  // a cached index naming one version beside files serving another is a
  // mismatch no retry can fix
  const res = await fetch('kits/index.json', { cache: 'no-cache' });
  if (res.ok) kitIndex = await res.json();
  for (const name of Object.keys(kitIndex).sort()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    kitSelect.appendChild(opt);
  }
} catch {
  kitIndex = {};
}
kitSelect.addEventListener('change', async () => {
  const wanted = kitSelect.value;
  if (await useKit(wanted)) {
    await compile();
    persistSource();
  } else {
    kitSelect.value = kitName(); // the fetch failed: the picker must not lie
  }
});

/** The visitor's own brand, as a .deckkit — the same archive
 *  `lutrin kit install` takes. The label beside the picker activates this
 *  input and the browser opens the dialog itself, so no gesture of ours has
 *  to survive the seconds a phone's modal picker is up (see the note in
 *  playground.html). The value is cleared after each pick: re-uploading the
 *  SAME file — the natural move after fixing whatever it was refused for —
 *  is not a change to an input still holding that file, and fires nothing. */
kitFileInput.addEventListener('change', async () => {
  const file = kitFileInput.files?.[0];
  kitFileInput.value = '';
  if (file) await uploadKitBytes(new Uint8Array(await file.arrayBuffer()));
});

// ---------------------------------------------------------------------------
// boot: the last session if there was one, the first example if not
// ---------------------------------------------------------------------------

if (!(await restoreWorkspace())) ed.text = DECK_EXAMPLES.funnel.source;
ed.setLocked(false);
await compile();
