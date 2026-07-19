/**
 * Preview webview script (the only JS the CSP allows, under a nonce).
 *
 * Receives compilations by postMessage and:
 *   - replaces only the slides whose HTML has changed (no flash, scroll
 *     position preserved);
 *   - scales the slides to the panel (the equivalent of the core HTML
 *     renderer's FIT_SCRIPT, which emits no script in fragment mode);
 *   - handles click-to-reveal on animated slides, keeping the animation state
 *     from one recompilation to the next;
 *   - highlights/scrolls to the slide under the cursor (`reveal` message) and
 *     signals a double-click on a slide (jump back to the source line).
 */

/* global acquireVsCodeApi */
(() => {
  const vscode = acquireVsCodeApi();
  const deck = document.getElementById('deck');
  const errorBar = document.getElementById('error-bar');
  const PAGE_W = 1280;
  const PAGE_H = 720;

  let prevSlides = [];
  const animShown = new Map(); // slide index → steps revealed

  // ------ scaling ------------------------------------------------------------

  function fit() {
    const frames = deck.querySelectorAll('.slide-frame');
    for (const f of frames) {
      const s = f.clientWidth / PAGE_W;
      f.style.height = `${PAGE_H * s}px`;
      if (f.firstElementChild) f.firstElementChild.style.transform = `scale(${s})`;
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(document.body);
  window.addEventListener('resize', fit);

  // ------ animations (click to reveal) ---------------------------------------

  function wireAnimation(wrap, index) {
    const frame = wrap.querySelector('.slide-frame[data-anim-steps]');
    if (!frame) return;
    const total = Number(frame.getAttribute('data-anim-steps'));
    const els = frame.querySelectorAll('[data-step]');
    let shown = Math.min(animShown.get(index) || 0, total);
    const badge = document.createElement('div');
    badge.className = 'anim-count';
    frame.appendChild(badge);
    const update = () => {
      badge.textContent = `${shown} / ${total}`;
      for (const el of els)
        el.classList.toggle('step-shown', Number(el.getAttribute('data-step')) < shown);
    };
    frame.addEventListener('click', (e) => {
      if (e.target.closest?.('a')) return;
      shown = shown < total ? shown + 1 : 0;
      animShown.set(index, shown);
      update();
    });
    update();
  }

  // ------ incremental rendering -----------------------------------------------

  function render(slides, animSteps) {
    const sameCount = prevSlides.length === slides.length && deck.children.length === slides.length;
    if (!sameCount) {
      deck.textContent = '';
      slides.forEach((html, k) => {
        const wrap = document.createElement('div');
        wrap.className = 'slide-wrap';
        wrap.dataset.idx = String(k);
        wrap.innerHTML = html;
        deck.appendChild(wrap);
        wireAnimation(wrap, k);
        wireClick(wrap, k);
      });
    } else {
      slides.forEach((html, k) => {
        if (prevSlides[k] === html) return;
        const wrap = deck.children[k];
        wrap.innerHTML = html;
        wireAnimation(wrap, k);
        wireClick(wrap, k);
      });
    }
    prevSlides = slides;
    fit();
  }

  function wireClick(wrap, index) {
    // the `ondblclick` property (and not addEventListener): the incremental
    // branch calls wireClick again on a wrap that PERSISTS from one
    // recompilation to the next — a reassignment replaces the listener, an
    // addEventListener would stack them.
    wrap.ondblclick = () => vscode.postMessage({ type: 'slideClicked', slide: index + 1 });
  }

  // ------ cursor tracking -------------------------------------------------------

  function revealSlide(n) {
    const frame = deck.querySelector(`#slide-${n}`);
    if (!frame) return;
    for (const f of deck.querySelectorAll('.slide-frame.active')) f.classList.remove('active');
    frame.classList.add('active');
    frame.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ------ messages from the extension --------------------------------------------

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      const fontsCss = document.getElementById('fonts-css');
      const deckCss = document.getElementById('deck-css');
      // a comparison (not "written once"): a theme added/removed mid-session
      // changes the @font-face rules — the equality guard still avoids
      // reassigning ~300 kB of base64 on every keystroke
      if (fontsCss.textContent !== msg.fontsCss) fontsCss.textContent = msg.fontsCss;
      if (deckCss.textContent !== msg.css) deckCss.textContent = msg.css;
      errorBar.style.display = 'none';
      render(msg.slides, msg.animSteps);
    } else if (msg.type === 'reveal') {
      revealSlide(msg.slide);
    } else if (msg.type === 'error') {
      errorBar.textContent = `Compilation error: ${msg.message}`;
      errorBar.style.display = 'block';
    }
  });
})();
