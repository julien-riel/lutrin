/* The hero signature: a compiled slide, briefly wearing every artefact of the
 * work you are not going to do — selection handles, alignment guides, a
 * dimension readout — which then leave.
 *
 * All of the motion is in CSS (see .stage.play in main.css). This file only
 * decides WHEN, and that decision is the whole reason it exists:
 *
 *   - never, under prefers-reduced-motion, and never without JS: the artefacts
 *     are `display: none` until .play is added, so the default state of the
 *     page is the finished slide. A visitor who sees nothing loses nothing;
 *   - not before the slide is actually there. Handles drawn around an empty
 *     grey box read as a broken widget, so the sequence waits for the deck
 *     iframe to load (with a ceiling, in case it never does);
 *   - not before the hero is on screen, for the visitor who lands deep-linked
 *     further down the page.
 *
 * It plays once. The point is made once.
 */
(() => {
  const stage = document.getElementById('stage');
  if (!stage) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const frame = stage.querySelector('iframe');
  let played = false;

  const play = () => {
    if (played) return;
    played = true;
    // one frame of breathing room: the deck paints, THEN it gets selected
    requestAnimationFrame(() => {
      setTimeout(() => stage.classList.add('play'), 220);
    });
  };

  /** Resolves when the embedded deck has painted — or after 2.5 s, whichever
   *  comes first. The ceiling matters: a deck that fails to load must not cost
   *  the page its opening move, and the artefacts look no worse over the
   *  placeholder grey than they do over nothing at all. */
  const deckReady = new Promise((resolve) => {
    if (!frame || frame.contentDocument?.readyState === 'complete') return resolve();
    frame.addEventListener('load', resolve, { once: true });
    setTimeout(resolve, 2500);
  });

  const onScreen = new Promise((resolve) => {
    if (!('IntersectionObserver' in window)) return resolve();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          resolve();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(stage);
  });

  Promise.all([deckReady, onScreen]).then(play);
})();
