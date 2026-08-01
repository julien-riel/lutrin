/**
 * main.js — boot and shell wiring: the topbar (file name, dirty indicator,
 * Enregistrer), the anti-loss guards, the #deck= hash route, the conflict
 * banner, the SSE deck-changed flow and the keyboard shortcuts. Panels
 * (tree, slides, viewer, form) mount here and talk back through callbacks.
 *
 * Slice indices and compiled fragment indices are two different numberings
 * when the deck has an implicit cover (sceneOffset 1 — D4): everything here
 * converts through store.fragmentIndex()/entryForFragment(), never by hand.
 */

import { api, isBoundary, isConflict, onDeckChanged } from './api.js';
import * as compile from './compile.js';
import * as form from './form.js';
import * as slides from './slides.js';
import { store } from './store.js';
import * as tree from './tree.js';
import * as ui from './ui.js';
import * as viewer from './viewer.js';

const $ = (id) => document.getElementById(id);

// ------ topbar ---------------------------------------------------------------

function paintShell() {
  const s = store.get();
  $('file-name').textContent = s.deck?.path ?? 'Aucun fichier ouvert';
  $('dirty-indicator').hidden = !s.dirty;
  $('btn-save').disabled = !s.dirty;
  const banner = $('conflict-banner');
  banner.hidden = !s.conflict;
  // the 'lost' state swaps the Recharger/Garder pair for a read-only copy of
  // the text whose slide vanished, plus a Fermer button
  const lost = s.conflict === 'lost';
  $('btn-conflict-reload').hidden = lost;
  $('btn-conflict-keep').hidden = lost;
  $('btn-conflict-dismiss').hidden = !lost;
  const detached = $('conflict-detached');
  detached.hidden = !lost;
  if (lost) detached.value = s.detached ?? '';
  if (s.conflict)
    $('conflict-message').textContent =
      s.conflict === 'save'
        ? 'Le fichier a changé sur disque — l’enregistrement a été refusé.'
        : lost
          ? 'La diapositive éditée n’existe plus dans le fichier rechargé — ' +
            'copiez votre texte ci-dessous avant de fermer.'
          : 'Le fichier a changé sur disque pendant vos modifications.';
}

// ------ anti-loss guard --------------------------------------------------------

/** Confirm before discarding unsaved work; resolves true when safe to go on. */
async function confirmDiscard() {
  if (!store.get().dirty) return true;
  return ui.confirmDialog('Des modifications non enregistrées seront perdues. Continuer ?', {
    confirmLabel: 'Abandonner',
    danger: true,
  });
}

// ------ open / select ----------------------------------------------------------

async function openDeck(path) {
  const s = store.get();
  if (s.deck?.path === path) return;
  if (!(await confirmDiscard())) return;
  let payload;
  try {
    payload = await api.getDeck(path);
  } catch (e) {
    ui.toast(e?.message ?? 'Ouverture du fichier impossible', 'error');
    return;
  }
  store.openDeck(payload);
  const hash = `#deck=${encodeURIComponent(path)}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  compile.runCompile('open');
}

async function selectSlide(index) {
  const s = store.get();
  const count = s.deck?.slides?.length ?? 0;
  const target = Math.min(Math.max(index, 0), count - 1);
  if (target < 0 || target === s.current) return;
  const wasDirty = s.dirty;
  if (!(await confirmDiscard())) return;
  store.selectSlide(target); // the 'current' subscription moves the viewer
  // abandoned edits were in the last compile — bring the preview back to disk
  if (wasDirty) compile.runCompile('select');
}

async function selectCover() {
  const s = store.get();
  if (s.coverSelected) return;
  const wasDirty = s.dirty;
  if (!(await confirmDiscard())) return;
  store.selectCover();
  if (wasDirty) compile.runCompile('select');
}

/** ‹ › in the viewer bar and ←/→: the fragment index is mapped back to a
 *  list entry — cover included — when the deck is sliceable; free fragment
 *  browsing otherwise (Marp). */
function requestViewerSelect(fragment) {
  const s = store.get();
  if (!s.deck?.sliceable) {
    viewer.show(fragment);
    return;
  }
  const entry = store.entryForFragment(fragment);
  if (entry.cover) selectCover();
  else selectSlide(entry.index);
}

// ------ save + conflicts ---------------------------------------------------------

/** Single-flight (C6): a save in progress swallows re-entrant Ctrl+S — a
 *  second PUT would carry the same baseVersion and 409 as a phantom
 *  conflict. The button is disabled for the whole flight; paintShell
 *  re-enables it whenever the slide is still dirty. */
const save = ui.singleFlight(async () => {
  const s = store.get();
  if (!s.dirty || s.current < 0 || !s.deck) return;
  const btn = $('btn-save');
  btn.disabled = true;
  try {
    const res = await api.putSlide({
      path: s.deck.path,
      index: s.current,
      source: s.workingSource,
      baseVersion: s.deck.version,
    });
    store.refreshDeck(res);
    ui.toast('Diapositive enregistrée');
    compile.runCompile('saved');
  } catch (e) {
    if (isConflict(e)) store.setConflict('save');
    else if (isBoundary(e))
      // the server's boundary net (422) refused the splice: word the refusal
      // — the raw 'boundary' token means nothing to the person typing
      ui.toast(
        'Enregistrement refusé : cette version déborderait sur une diapositive ' +
          'voisine. Rien n’a été écrit.',
        'error',
      );
    else ui.toast(e?.message ?? 'Enregistrement impossible', 'error');
    paintShell(); // re-enable the button: the slide is still dirty
  }
});

/** Fetch the deck again; keepMine re-anchors the unsaved working text onto
 *  the slide it belongs to (store.refreshDeck — content first, never a blind
 *  index), or parks it in the 'lost' banner when the slide is gone. */
async function reloadDeck({ keepMine }) {
  const path = store.get().deck?.path;
  if (!path) return;
  let payload;
  try {
    payload = await api.getDeck(path);
  } catch (e) {
    ui.toast(e?.message ?? 'Rechargement impossible', 'error');
    return; // the banner stays — the reload did not happen
  }
  store.refreshDeck(payload, { keepWorking: keepMine });
  compile.runCompile(keepMine ? 'conflict-keep' : 'conflict-reload');
}

// ------ keyboard -----------------------------------------------------------------

const typing = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
      return;
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') requestViewerSelect(viewer.getIndex() - 1);
    else if (e.key === 'ArrowRight') requestViewerSelect(viewer.getIndex() + 1);
  });
}

// ------ boot ----------------------------------------------------------------------

function deckFromHash() {
  const m = /^#deck=(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

async function boot() {
  tree.init({ container: $('tree-host'), onOpen: openDeck });
  slides.init({ container: $('slides-host'), onSelect: selectSlide, onSelectCover: selectCover });
  viewer.init({ container: $('viewer-pane'), onRequestSelect: requestViewerSelect });
  form.init({ container: $('form-host') });

  $('btn-save').addEventListener('click', save);
  $('btn-conflict-reload').addEventListener('click', () => reloadDeck({ keepMine: false }));
  $('btn-conflict-keep').addEventListener('click', () => reloadDeck({ keepMine: true }));
  $('btn-conflict-dismiss').addEventListener('click', () => store.clearDetached());
  wireKeyboard();

  window.addEventListener('beforeunload', (e) => {
    if (store.get().dirty) e.preventDefault();
  });

  store.subscribe((_s, path) => {
    paintShell();
    if (path === 'working') compile.runCompile('edit');
    if (path === 'current' || path === 'deck') {
      const fragment = store.fragmentIndex();
      if (fragment >= 0) viewer.show(fragment);
    }
  });

  compile.onResult((result, err) => {
    if (err) {
      // same wording rule as the save path: a 422 boundary is a typed
      // refusal of the working text, not an opaque server token
      ui.toast(
        isBoundary(err)
          ? 'Aperçu impossible : ce texte déborderait sur une diapositive voisine.'
          : (err.message ?? 'Compilation impossible'),
        'error',
      );
      return;
    }
    viewer.setResult(result);
  });

  onDeckChanged((payload) => {
    tree.refresh(); // files may have appeared or vanished anywhere
    const s = store.get();
    if (!s.deck || payload?.path !== s.deck.path) return;
    if (s.dirty) store.setConflict('external');
    else reloadDeck({ keepMine: false });
  });

  window.addEventListener('hashchange', () => {
    const path = deckFromHash();
    if (path && path !== store.get().deck?.path) openDeck(path);
  });

  await tree.refresh();
  const initial = deckFromHash();
  if (initial) await openDeck(initial);
}

boot();
