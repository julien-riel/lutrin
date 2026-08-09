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

  // ------------------------------------------------------------ analytics
  // Provider-agnostic, and deliberately so: the tag in <head> is Umami today
  // (site/README.md records the decision and what each event means), and this
  // helper predates it — it cost a property lookup and did nothing until the
  // day the tag landed, which is exactly why installing one was one line in
  // one place rather than a hunt through this file. Keep calls going through
  // here: reaching for `window.umami` directly is what would undo that.
  const track = (name, props) => {
    if (typeof window.plausible === 'function') window.plausible(name, { props });
    else if (window.umami && typeof window.umami.track === 'function')
      window.umami.track(name, props);
  };

  const CHECKOUT = 'https://buy.polar.sh/';

  // All four events. Delegated from the document rather than bound per link,
  // because the gallery cards, the two hero buttons, the pricing table and the
  // footer all point at the same handful of targets and the list grows every
  // time a page is added.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.indexOf(CHECKOUT) === 0) {
      // The props are read out of the link's OWN UTM parameters rather than
      // from a list kept here. A second list is a list that drifts; this way
      // the act that makes a new checkout link attributable in Polar is the
      // same act that instruments it. One carrying no UTM reports `untagged`
      // rather than nothing at all, so the drift is visible in the report
      // instead of silently looking like a link nobody clicked.
      const utm = new URL(href).searchParams;
      track('checkout clicked', {
        placement: utm.get('utm_medium') || 'untagged',
        tier: utm.get('utm_campaign') || 'untagged',
      });
      // Nothing here defers the navigation, and nothing needs to: the Umami
      // tracker posts with `fetch(…, { keepalive: true })` — read out of the
      // script it actually serves — which the browser is required to let
      // outlive the document. A preventDefault() and a timeout would buy a
      // datum at the price of a slower checkout, which is the wrong trade.
    } else if (href.endsWith('.pptx')) track('pptx downloaded');
    else if (href === 'demo.html' || href.indexOf('demo.html#') === 0)
      track('deck opened', { slide: href.split('#')[1] || 'first' });
  });

  // ----------------------------------------------------- playground edited
  // The only event on this site that reports somebody COMPILING something of
  // their own — every other one reports an intention. It fires on the first
  // keystroke and never again (`once`), because the question is how many
  // readers cross from looking to using, not how fast they type.
  //
  // `mode` separates the card on the landing page from the full page: the two
  // arrive as the same path in the report, and without this prop there is no
  // way to tell whether framing the playground on the landing page did
  // anything at all.
  const pgSource = document.getElementById('pg-source');
  if (pgSource) {
    pgSource.addEventListener(
      'input',
      () => {
        track('playground edited', {
          mode: document.documentElement.classList.contains('is-embed') ? 'embed' : 'page',
        });
      },
      { once: true },
    );
  }

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
      // Reported on the CLICK, not on the clipboard promise: a browser that
      // denies clipboard access still tells us the reader wanted the command,
      // which is the thing being measured.
      track('command copied', { command: text });
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
