/* Page behavior: iframe scaling, tabs, copy button, reveals, parallax.
 * The embedded slides are the real compiled deck (demo.html), one iframe per
 * anchor #slide-N; each iframe shows a 1330px-wide viewport of the deck,
 * cropped to the slide and scaled to its container. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------ iframe scaling
  // Deck geometry at a 1330px viewport: the slide is 1280x720 at (25, 0)
  // once the anchor has scrolled it to the top of the iframe's viewport.
  const SLIDE_W = 1280;
  const SLIDE_X = 25;
  function fit(boxEl) {
    const iframe = boxEl.querySelector('iframe');
    if (!iframe) return;
    const s = boxEl.clientWidth / SLIDE_W;
    iframe.style.transform = `scale(${s})`;
    iframe.style.left = `${-SLIDE_X * s}px`;
  }
  const boxes = [].slice.call(document.querySelectorAll('.slidebox'));
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver((entries) => {
      entries.forEach((e) => {
        fit(e.target);
      });
    });
    boxes.forEach((b) => {
      ro.observe(b);
    });
  } else {
    const refit = () => {
      boxes.forEach(fit);
    };
    addEventListener('resize', refit);
    refit();
  }

  // Scroll an iframe's deck to its slide. Never through an anchor in the
  // src: fragment navigation inside an iframe also scrolls the parent page,
  // so the deck is loaded plain and positioned with scrollTo(), which stays
  // inside the frame.
  function pin(iframe) {
    const n = iframe.getAttribute('data-slide');
    if (!n) return;
    try {
      const doc = iframe.contentDocument;
      const el = doc?.getElementById(`slide-${n}`);
      if (el)
        iframe.contentWindow.scrollTo(
          0,
          el.getBoundingClientRect().top + iframe.contentWindow.scrollY,
        );
    } catch (e) {
      /* not ready yet — the load handler will retry */
    }
  }
  [].slice.call(document.querySelectorAll('iframe[data-slide]')).forEach((f) => {
    f.addEventListener('load', () => {
      pin(f);
    });
    if (f.contentDocument && f.contentDocument.readyState === 'complete') pin(f);
  });

  // Deferred gallery iframes: give them their src when they come close.
  const lazy = [].slice.call(document.querySelectorAll('iframe[data-src]'));
  function load(iframe) {
    if (!iframe.src) iframe.src = iframe.getAttribute('data-src');
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            load(e.target);
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '500px' },
    );
    lazy.forEach((f) => {
      io.observe(f);
    });
  } else {
    lazy.forEach(load);
  }

  // ----------------------------------------------------------------- tabs
  const tabs = [].slice.call(document.querySelectorAll('.tab'));
  const pairFrame = document.getElementById('pair-frame');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      const paneId = tab.getAttribute('aria-controls');
      [].slice.call(document.querySelectorAll('.src')).forEach((p) => {
        p.hidden = p.id !== paneId;
      });
      [].slice.call(document.querySelectorAll('.pair-caption')).forEach((c) => {
        c.hidden = c.getAttribute('data-for') !== paneId;
      });
      pairFrame.setAttribute('data-slide', tab.getAttribute('data-slide'));
      pin(pairFrame);
    });
  });

  // ----------------------------------------------------------------- copy
  [].slice.call(document.querySelectorAll('.copy')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      const ok = () => {
        btn.textContent = 'copied';
        btn.classList.add('done');
        setTimeout(() => {
          btn.textContent = 'copy';
          btn.classList.remove('done');
        }, 1600);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok);
    });
  });

  // -------------------------------------------------------------- reveals
  const toReveal = [].slice.call(document.querySelectorAll('.reveal'));
  if (reduced || !('IntersectionObserver' in window)) {
    toReveal.forEach((el) => {
      el.classList.add('in');
    });
  } else {
    const rio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            rio.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    toReveal.forEach((el) => {
      rio.observe(el);
    });
  }

  // ------------------------------------------------------------- parallax
  // Gallery columns drift at slightly different rates around their resting
  // position — enough to feel the depth, never enough to fight the reader.
  const cols = [].slice.call(document.querySelectorAll('[data-plx]'));
  if (!reduced && cols.length && matchMedia('(pointer: fine)').matches) {
    let ticking = false;
    const apply = () => {
      ticking = false;
      const mid = innerHeight / 2;
      cols.forEach((col) => {
        const r = col.getBoundingClientRect();
        let delta = (r.top + r.height / 2 - mid) * Number.parseFloat(col.getAttribute('data-plx'));
        delta = Math.max(-56, Math.min(56, delta));
        col.style.transform = `translate3d(0,${delta.toFixed(1)}px,0)`;
      });
    };
    addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(apply);
        }
      },
      { passive: true },
    );
    apply();
  }
})();
