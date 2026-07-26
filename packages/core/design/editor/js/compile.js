/**
 * compile.js — the preview loop. Owns the sandboxed iframe (built ONCE as
 * srcdoc), the debounced/single-flight/latest-wins compile cycle, and the
 * Compare hold.
 *
 * The iframe is an opaque origin (sandbox="allow-scripts", no
 * allow-same-origin) with a CSP that admits only inline style/script and
 * data: images/fonts — exactly what compiled slides carry. All traffic goes
 * through postMessage:
 *   parent → iframe {type:'render', slides, css, fontsCss}     edited state
 *   parent → iframe {type:'compare', held, snapshot?}          hold/release
 *   parent → iframe {type:'select', slide}                     0 = all slides
 * The iframe patches per slide by string comparison, pulses the changed ones
 * (600 ms brass, skipped under prefers-reduced-motion), scales each slide by
 * containerWidth/1280 and swaps fontsCss only when the string really changed
 * (~300 KB — the guard is the point).
 */

import { api, isSuperseded } from './api.js';

const DEBOUNCE_MS = 300;

let store = null;
let iframe = null;
let frameReady = false;
let pendingToFrame = []; // messages queued until the iframe reports load

let timer = null;
let timerActive = false; // a debounced compile is scheduled but not started
let inflight = false;
let queued = false;

let lastResult = null; // last successful CompileResult
/** markSavedNow() found a compile pending: capture the snapshot from the next
 *  result that lands with nothing newer behind it (and a clean tree) — never
 *  from a lastResult that predates the state being saved. */
let armSaved = false;
const resultListeners = new Set();

// ------ iframe ------------------------------------------------------------

const FRAME_SRCDOC = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: #EDECE8; }
  #scroller { height: 100%; overflow-y: auto; padding: 24px; box-sizing: border-box;
              display: flex; flex-direction: column; gap: 24px; }
  .wrap { position: relative; width: 100%; height: calc(var(--s, 0.5) * 720px); flex: none; }
  .wrap[hidden] { display: none; }
  .box { width: 1280px; height: 720px; transform: scale(var(--s, 0.5));
         transform-origin: 0 0; overflow: hidden; background: #fff;
         box-shadow: 0 2px 6px rgba(30,33,38,.12), 0 10px 28px rgba(30,33,38,.08); }
  .box.pulse { animation: pulse-brass 600ms ease-out 1; }
  @keyframes pulse-brass {
    0%   { box-shadow: 0 0 0 0 rgba(168,127,61,.55), 0 2px 6px rgba(30,33,38,.12); }
    70%  { box-shadow: 0 0 0 7px rgba(168,127,61,0), 0 2px 6px rgba(30,33,38,.12); }
    100% { box-shadow: 0 0 0 0 rgba(168,127,61,0), 0 2px 6px rgba(30,33,38,.12),
                       0 10px 28px rgba(30,33,38,.08); }
  }
  @media (prefers-reduced-motion: reduce) { .box.pulse { animation: none; } }
  #chip { position: fixed; top: 10px; left: 10px; z-index: 5; padding: 3px 10px;
          border-radius: 4px; background: #1E2126; color: #E8E6E1;
          font: 600 11px/1.6 'IBM Plex Sans', sans-serif; letter-spacing: .02em; }
  #chip[hidden] { display: none; }
</style>
</head>
<body>
<div id="chip" hidden>Saved kit</div>
<div id="scroller"></div>
<style id="fonts-css"></style>
<style id="deck-css"></style>
<script>
  var scroller = document.getElementById('scroller');
  var chip = document.getElementById('chip');
  var fontsTag = document.getElementById('fonts-css');
  var deckTag = document.getElementById('deck-css');
  var shown = [];       // html strings currently in the DOM
  var current = null;   // last 'render' payload (edited state)
  var held = false;
  var filter = 0;       // 0 = all slides, else 1-based slide number
  var lastFonts = '';
  var lastCss = '';

  function apply(payload, pulse) {
    if (!payload) return;
    var slides = payload.slides || [];
    if (payload.fontsCss !== lastFonts) {           // equality guard: ~300 KB
      lastFonts = payload.fontsCss || '';
      fontsTag.textContent = lastFonts;
    }
    if (payload.css !== lastCss) {
      lastCss = payload.css || '';
      deckTag.textContent = lastCss;
    }
    while (scroller.children.length > slides.length) {
      scroller.lastElementChild.remove();
      shown.pop();
    }
    for (var i = 0; i < slides.length; i++) {
      var wrap = scroller.children[i];
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'wrap';
        var box = document.createElement('div');
        box.className = 'box';
        wrap.appendChild(box);
        scroller.appendChild(wrap);
        shown.push(null);
      }
      if (shown[i] !== slides[i]) {
        var b = wrap.firstElementChild;
        b.innerHTML = slides[i]; // compiler output — the one sanctioned innerHTML
        shown[i] = slides[i];
        if (pulse) {
          b.classList.remove('pulse');
          void b.offsetWidth; // restart the animation when re-pulsing
          b.classList.add('pulse');
        }
      }
    }
    applyFilter();
  }

  function applyFilter() {
    for (var i = 0; i < scroller.children.length; i++) {
      var on = filter === 0 || filter === i + 1;
      if (on) scroller.children[i].removeAttribute('hidden');
      else scroller.children[i].setAttribute('hidden', '');
    }
  }

  scroller.addEventListener('animationend', function (e) {
    if (e.target.classList) e.target.classList.remove('pulse');
  });

  function rescale() {
    var w = scroller.clientWidth - 48; // padding
    if (w > 0) document.documentElement.style.setProperty('--s', String(w / 1280));
  }
  new ResizeObserver(rescale).observe(scroller);
  rescale();

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'render') {
      current = msg;
      if (!held) apply(current, true);
    } else if (msg.type === 'compare') {
      held = Boolean(msg.held && msg.snapshot);
      chip.hidden = !held;
      apply(held ? msg.snapshot : current, false);
    } else if (msg.type === 'select') {
      filter = typeof msg.slide === 'number' ? msg.slide : 0;
      applyFilter();
    }
  });
<\/script>
</body>
</html>`;

function post(msg) {
  if (!frameReady) {
    // keep only the newest message of each type — the frame catches up on load
    pendingToFrame = pendingToFrame.filter((m) => m.type !== msg.type);
    pendingToFrame.push(msg);
    return;
  }
  iframe.contentWindow.postMessage(msg, '*');
}

/**
 * Build the preview iframe (once) inside `container` and remember the store.
 * @param {{store: typeof import('./store.js').store, container: HTMLElement}} deps
 */
export function initPreview(deps) {
  store = deps.store;
  iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('title', 'Slide preview');
  iframe.addEventListener('load', () => {
    frameReady = true;
    for (const m of pendingToFrame) iframe.contentWindow.postMessage(m, '*');
    pendingToFrame = [];
  });
  iframe.srcdoc = FRAME_SRCDOC;
  deps.container.replaceChildren(iframe);
}

// ------ compile loop --------------------------------------------------------

function overlayBody() {
  const s = store.get();
  const body = { layouts: [...s.layouts.values()] };
  if (s.theme) body.theme = s.theme;
  return body;
}

async function flight() {
  inflight = true;
  let result = null;
  let error = null;
  try {
    result = await api.compile(overlayBody());
  } catch (err) {
    error = err;
  }
  // listeners run with inflight already false: a markSavedNow() they trigger
  // must see this result as current, not as "one more is in the air"
  inflight = false;
  if (result) {
    lastResult = result;
    post({ type: 'render', slides: result.slides, css: result.css, fontsCss: result.fontsCss });
    // a save waited for this compile — capture it as the saved snapshot,
    // unless something newer is already pending or the tree moved again
    if (armSaved && !timerActive && !queued && !store.isDirty()) {
      armSaved = false;
      captureSnapshot();
    }
    for (const fn of resultListeners) fn(result, null);
  } else if (!isSuperseded(error)) {
    for (const fn of resultListeners) fn(null, error);
  }
  if (queued) {
    queued = false;
    flight(); // re-run once with the NEWEST store state
  }
}

/**
 * Ask for a recompile of the current working copies. Debounced 300 ms,
 * single-flight, latest-wins: bursts collapse, a compile superseded by a
 * newer one (server 409) is dropped silently.
 * @param {string} [_reason] free label for debugging ('boot', 'theme.…')
 */
export function runCompile(_reason) {
  clearTimeout(timer);
  timerActive = true;
  timer = setTimeout(() => {
    timerActive = false;
    if (inflight) queued = true;
    else flight();
  }, DEBOUNCE_MS);
}

/**
 * Subscribe to compile outcomes: fn(result, error) — exactly one of the two
 * is non-null; superseded compiles never reach here. Returns unsubscribe.
 * @param {(result: import('./api.js').CompileResult|null, error: Error|null) => void} fn
 */
export function onResult(fn) {
  resultListeners.add(fn);
  return () => resultListeners.delete(fn);
}

/** Last successful CompileResult (diagnostics, slideMap…), or null. */
export function getLastResult() {
  return lastResult;
}

function captureSnapshot() {
  store.update('savedSnapshot', {
    slides: lastResult.slides,
    css: lastResult.css,
    fontsCss: lastResult.fontsCss,
  });
}

/**
 * Capture the compile of the state that was just saved as the SAVED snapshot
 * — call right after a save (or after a clean boot compile). Enables Compare.
 * When a compile is pending or in flight (a save landing inside the debounce
 * window), lastResult predates the saved state: the capture is DEFERRED to
 * the next settled result instead of freezing a stale baseline.
 */
export function markSavedNow() {
  if (timerActive || inflight || queued || !lastResult) {
    armSaved = true;
    return;
  }
  captureSnapshot();
}

/**
 * Press-and-hold Compare: true swaps the preview to the saved snapshot,
 * false restores the edited state. No-op while no snapshot exists.
 * @param {boolean} held
 */
export function setCompareHeld(held) {
  const snapshot = store.get().savedSnapshot;
  if (held && !snapshot) return;
  post(held ? { type: 'compare', held: true, snapshot } : { type: 'compare', held: false });
}

/**
 * Show one slide (1-based) or all of them (0) — wired to the preview bar's
 * slide selector.
 * @param {number} slide
 */
export function setSlideFilter(slide) {
  post({ type: 'select', slide });
}
