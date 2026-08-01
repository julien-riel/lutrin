/**
 * viewer.js — the single-slide preview. Owns the sandboxed iframe (built
 * ONCE as srcdoc) and the ‹ › navigation bar above it.
 *
 * The iframe is an opaque origin (sandbox="allow-scripts", no
 * allow-same-origin) with a CSP admitting only inline style/script and
 * data: images/fonts — exactly what compiled slides carry. All traffic goes
 * through postMessage:
 *   parent → iframe {type:'render', slides, css, fontsCss, page}
 *   parent → iframe {type:'select', index}
 * The iframe shows ONE slide, scaled to fit the pane (width-led, capped by
 * the height so a slide is never clipped), and strips data-anim-steps from
 * the injected fragments — without the animation runtime those steps would
 * simply be invisible content.
 */

import { el } from './ui.js';

let iframe = null;
let frameReady = false;
let pendingToFrame = []; // messages queued until the iframe reports load

let count = 0; // slides in the last render
let index = 0; // slide currently shown (0-based)
// Last index the shell ASKED for. `show()` can run before the first compile
// lands (count still 0): clamping the request away would strand the viewer on
// the cover while the form sits on slide 1 — the request is kept verbatim and
// re-applied by setResult() once the fragment count is known.
let desired = 0;
let counterNode = null;
let btnPrev = null;
let btnNext = null;
let requestSelect = null; // (index) => void — main.js decides how to route it

const FRAME_SRCDOC = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: #EDECE8; }
  #stage { height: 100%; display: flex; align-items: center; justify-content: center;
           padding: 24px; box-sizing: border-box; overflow: hidden; }
  #wrap { position: relative; flex: none; }
  #box { transform-origin: 0 0; overflow: hidden; background: #fff;
         box-shadow: 0 2px 6px rgba(30,33,38,.12), 0 10px 28px rgba(30,33,38,.08); }
  #box.pulse { animation: pulse-brass 600ms ease-out 1; }
  @keyframes pulse-brass {
    0%   { box-shadow: 0 0 0 0 rgba(168,127,61,.55), 0 2px 6px rgba(30,33,38,.12); }
    70%  { box-shadow: 0 0 0 7px rgba(168,127,61,0), 0 2px 6px rgba(30,33,38,.12); }
    100% { box-shadow: 0 0 0 0 rgba(168,127,61,0), 0 2px 6px rgba(30,33,38,.12),
                       0 10px 28px rgba(30,33,38,.08); }
  }
  @media (prefers-reduced-motion: reduce) { #box.pulse { animation: none; } }
</style>
</head>
<body>
<div id="stage"><div id="wrap"><div id="box"></div></div></div>
<style id="fonts-css"></style>
<style id="deck-css"></style>
<script>
  var stage = document.getElementById('stage');
  var wrap = document.getElementById('wrap');
  var box = document.getElementById('box');
  var fontsTag = document.getElementById('fonts-css');
  var deckTag = document.getElementById('deck-css');
  var page = { width: 1280, height: 720 };
  var slides = [];
  var idx = 0;
  var shown = null;    // html string currently in the DOM
  var lastFonts = '';
  var lastCss = '';

  function paint(pulse) {
    var html = slides[Math.min(idx, slides.length - 1)] || '';
    if (shown === html) return;
    box.innerHTML = html; // compiler output — the one sanctioned innerHTML
    // animation steps need the runtime the preview does not ship: without
    // this strip the stepped content would be invisible, not animated
    var stepped = box.querySelectorAll('[data-anim-steps]');
    for (var i = 0; i < stepped.length; i++) stepped[i].removeAttribute('data-anim-steps');
    shown = html;
    if (pulse) {
      box.classList.remove('pulse');
      void box.offsetWidth; // restart the animation when re-pulsing
      box.classList.add('pulse');
    }
  }

  function rescale() {
    var w = stage.clientWidth - 48;  // padding
    var h = stage.clientHeight - 48;
    if (w <= 0 || h <= 0) return;
    var s = Math.min(w / page.width, h / page.height);
    box.style.width = page.width + 'px';
    box.style.height = page.height + 'px';
    box.style.transform = 'scale(' + s + ')';
    wrap.style.width = (page.width * s) + 'px';
    wrap.style.height = (page.height * s) + 'px';
  }
  new ResizeObserver(rescale).observe(stage);
  box.addEventListener('animationend', function () { box.classList.remove('pulse'); });

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'render') {
      slides = msg.slides || [];
      if (msg.page && msg.page.width) page = msg.page;
      if (msg.fontsCss !== lastFonts) {         // equality guard: fontsCss is heavy
        lastFonts = msg.fontsCss || '';
        fontsTag.textContent = lastFonts;
      }
      if (msg.css !== lastCss) {
        lastCss = msg.css || '';
        deckTag.textContent = lastCss;
      }
      rescale();
      paint(true);
    } else if (msg.type === 'select') {
      idx = typeof msg.index === 'number' ? msg.index : 0;
      paint(false);
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

function paintBar() {
  counterNode.textContent = count ? `${index + 1} / ${count}` : '– / –';
  btnPrev.disabled = count === 0 || index <= 0;
  btnNext.disabled = count === 0 || index >= count - 1;
}

/**
 * Build the viewer (once) inside `container`: nav bar + iframe.
 * `onRequestSelect(index)` fires when the user presses ‹ or › — main.js
 * routes it (guarded slide selection for sliceable decks, direct show()
 * otherwise).
 * @param {{container: HTMLElement, onRequestSelect: (index: number) => void}} deps
 */
export function init({ container, onRequestSelect }) {
  requestSelect = onRequestSelect;
  btnPrev = el('button', {
    class: 'btn btn-sm',
    type: 'button',
    'aria-label': 'Diapositive précédente',
    text: '‹',
    disabled: true,
    onclick: () => requestSelect(index - 1),
  });
  btnNext = el('button', {
    class: 'btn btn-sm',
    type: 'button',
    'aria-label': 'Diapositive suivante',
    text: '›',
    disabled: true,
    onclick: () => requestSelect(index + 1),
  });
  counterNode = el('span', { class: 'viewer-counter', 'aria-live': 'polite', text: '– / –' });

  iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('title', 'Aperçu de la diapositive');
  iframe.addEventListener('load', () => {
    frameReady = true;
    for (const m of pendingToFrame) iframe.contentWindow.postMessage(m, '*');
    pendingToFrame = [];
  });
  iframe.srcdoc = FRAME_SRCDOC;

  container.replaceChildren(
    el('div', { class: 'viewer-bar' }, [btnPrev, counterNode, btnNext]),
    el('div', { class: 'viewer-canvas' }, iframe),
  );
}

/**
 * Feed a fresh compile result to the iframe; the shown index is clamped to
 * the new slide count.
 * @param {import('./api.js').CompileResult} result
 */
export function setResult(result) {
  count = result.slides.length;
  index = Math.min(desired, Math.max(0, count - 1));
  post({
    type: 'render',
    slides: result.slides,
    css: result.css,
    fontsCss: result.fontsCss,
    page: result.page,
  });
  post({ type: 'select', index });
  paintBar();
}

/**
 * Show one slide (0-based, clamped to the last render).
 * @param {number} i
 */
export function show(i) {
  desired = Math.max(i, 0);
  index = count ? Math.min(desired, count - 1) : desired;
  post({ type: 'select', index });
  paintBar();
}

/** Index of the slide currently shown (0-based). */
export function getIndex() {
  return index;
}
