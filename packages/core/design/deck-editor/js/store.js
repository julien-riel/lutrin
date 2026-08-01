/**
 * store.js — the editor's central state. One snapshot object, mutated only
 * through the methods below, each notifying subscribers with a path label.
 *
 * Shape (see get()):
 *   tree           last /api/tree payload (server truth)
 *   deck           last GET /api/deck payload — PUT responses are merged over
 *                  it (they carry version/sliceable/slides but neither meta
 *                  nor capabilities)
 *   current        index of the selected slide SLICE, -1 when none
 *   coverSelected  the implicit cover (frontmatter title) is selected — a
 *                  view-only pseudo-entry, so current is -1 and nothing is
 *                  editable while it shows
 *   workingSource  working text of the CURRENT slide's slice (null when no
 *                  slide is selected)
 *   dirty          workingSource differs from the slice on disk
 *   sourceEdited   the working text was typed in raw-source mode — the form
 *                  can no longer trust its parts until the next GET/PUT
 *   conflict       null | 'save' | 'external' | 'lost' — drives the banner
 *   detached       unsaved text whose slide vanished from the reloaded file
 *                  ('lost' banner: shown read-only for the user to copy)
 *
 * The cover mapping (D4): when the frontmatter has a title the compiler
 * inserts a cover scene BEFORE the first slice, so compiled fragment k shows
 * slice k−1. The server states the shift as `sceneOffset` (0 or 1); the
 * helpers below are the ONLY place the two numberings meet — everything else
 * asks fragmentIndex()/entryForFragment() instead of adding offsets by hand.
 *
 * Notification paths: 'tree', 'deck', 'current', 'working', 'conflict'.
 * Treat everything returned by get() as read-only.
 */

const snap = {
  tree: null,
  deck: null,
  current: -1,
  coverSelected: false,
  workingSource: null,
  dirty: false,
  sourceEdited: false,
  conflict: null,
  detached: null,
};

const listeners = new Set();

function notify(path) {
  for (const fn of listeners) fn(snap, path);
}

/** Cover scenes the compiler inserts before the first slice: 1 when the
 *  frontmatter title generates one, 0 otherwise. The server states it; an
 *  older payload without the field reads as 0 — no cover entry, no shift. */
function offsetOf(deck) {
  return deck?.sceneOffset === 1 ? 1 : 0;
}

/** Reset the per-slide working state from the slice at `index` (or none). */
function pickSlide(index) {
  const slides = snap.deck?.slides ?? [];
  snap.current = index >= 0 && index < slides.length ? index : -1;
  snap.coverSelected = false;
  snap.workingSource = snap.current >= 0 ? slides[snap.current].source : null;
  snap.dirty = false;
  snap.sourceEdited = false;
}

export const store = {
  /** Current snapshot — read-only by convention. */
  get: () => snap,

  /** @param {object} tree fresh /api/tree payload */
  setTree(tree) {
    snap.tree = tree;
    notify('tree');
  },

  /** Cover scenes before the first slice of the OPEN deck: 0 or 1. */
  sceneOffset: () => offsetOf(snap.deck),

  /**
   * Compiled fragment the current selection shows: 0 for the cover, slice
   * index + sceneOffset for a slide, -1 when nothing is selected.
   */
  fragmentIndex() {
    if (snap.coverSelected) return 0;
    return snap.current >= 0 ? snap.current + offsetOf(snap.deck) : -1;
  },

  /**
   * What a compiled fragment index points at in the slide list:
   * `{ cover: true }` for the implicit cover, `{ index }` (slice index,
   * possibly out of bounds — callers clamp) for everything else.
   * @param {number} fragment
   * @returns {{cover: true}|{index: number}}
   */
  entryForFragment(fragment) {
    const offset = offsetOf(snap.deck);
    if (offset === 1 && fragment <= 0) return { cover: true };
    return { index: fragment - offset };
  },

  /**
   * Open a deck: full reset of the per-file state, first slide selected when
   * the deck is sliceable and has any — else the cover when there is one.
   * @param {import('./api.js').DeckState} payload
   */
  openDeck(payload) {
    snap.deck = payload;
    snap.conflict = null;
    snap.detached = null;
    if (payload.sliceable && payload.slides.length) pickSlide(0);
    else {
      pickSlide(-1);
      // a deck that is nothing but a frontmatter title still has its cover
      snap.coverSelected = Boolean(payload.sliceable) && offsetOf(payload) === 1;
    }
    notify('deck');
  },

  /**
   * Replace the deck with fresh server truth while STAYING on the same file:
   * after a save (partial PUT payload merged over the old deck), a silent
   * reload, or a conflict resolution. Without `keepWorking` the selection is
   * clamped; with it ("Garder ma version") the edited slide is RE-ANCHORED
   * by content — the new slice whose source matches the old one, else the
   * one at the same startLine, else the same title — and the unsaved text
   * follows it there. A slide nothing re-anchors to gets NO reapplication at
   * all: pasting the text over whatever slice now sits at the old index
   * would overwrite a DIFFERENT slide, so the text moves to `detached` under
   * the 'lost' banner (the user copies it) and the selection falls back to
   * the first slide, clean.
   * @param {object} payload full GET payload or partial PUT payload
   * @param {{keepWorking?: boolean}} [opts]
   */
  refreshDeck(payload, { keepWorking = false } = {}) {
    const working = snap.workingSource;
    const prev = snap.current >= 0 ? (snap.deck?.slides?.[snap.current] ?? null) : null;
    const wasCover = snap.coverSelected;
    snap.deck = { ...snap.deck, ...payload };
    snap.conflict = null;
    snap.detached = null;
    const slides = snap.deck.slides ?? [];
    if (!snap.deck.sliceable) {
      pickSlide(-1);
      notify('deck');
      return;
    }
    if (wasCover && offsetOf(snap.deck) === 1) {
      // the cover is not content: it survives any reload that keeps a title
      pickSlide(-1);
      snap.coverSelected = true;
      notify('deck');
      return;
    }
    if (keepWorking && prev && working !== null) {
      let at = slides.findIndex((sl) => sl.source === prev.source);
      if (at < 0) at = slides.findIndex((sl) => sl.startLine === prev.startLine);
      if (at < 0 && prev.title != null) at = slides.findIndex((sl) => sl.title === prev.title);
      if (at >= 0) {
        pickSlide(at);
        snap.workingSource = working;
        snap.dirty = working !== slides[at].source;
        // the preserved text may or may not have come from the form —
        // form.js re-derives its own lock by comparing serializations
      } else {
        pickSlide(slides.length ? 0 : -1);
        snap.detached = working;
        snap.conflict = 'lost';
      }
      notify('deck');
      return;
    }
    pickSlide(Math.min(Math.max(snap.current, slides.length ? 0 : -1), slides.length - 1));
    notify('deck');
  },

  /**
   * Select a slide (the anti-loss guard is the CALLER's duty — main.js
   * confirms before discarding a dirty working text).
   * @param {number} index
   */
  selectSlide(index) {
    pickSlide(index);
    notify('current');
  },

  /**
   * Select the implicit cover — only meaningful when the deck has one
   * (sceneOffset 1); refused otherwise. Same caller-side anti-loss guard as
   * selectSlide.
   */
  selectCover() {
    if (!snap.deck?.sliceable || offsetOf(snap.deck) !== 1) return;
    pickSlide(-1);
    snap.coverSelected = true;
    notify('current');
  },

  /**
   * Set the working text of the current slide (from the form's serialization
   * or from raw-source typing).
   * @param {string} text
   * @param {{fromSource?: boolean}} [opts] fromSource marks a hand edit of
   *        the raw slice — the form soft-locks until the next GET/PUT
   */
  setWorking(text, { fromSource = false } = {}) {
    if (snap.current < 0) return;
    snap.workingSource = text;
    snap.dirty = text !== snap.deck.slides[snap.current].source;
    if (fromSource) snap.sourceEdited = snap.dirty;
    notify('working');
  },

  /** @param {null|'save'|'external'|'lost'} value */
  setConflict(value) {
    snap.conflict = value;
    notify('conflict');
  },

  /** Dismiss the 'lost' banner once the user has copied the detached text. */
  clearDetached() {
    snap.detached = null;
    snap.conflict = null;
    notify('conflict');
  },

  /** True when the current slide holds unsaved work. */
  isDirty: () => snap.dirty,

  /**
   * Subscribe to every change. fn(snapshot, changedPath). Returns an
   * unsubscribe function.
   * @param {(snap: object, path: string) => void} fn
   */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
