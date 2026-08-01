/**
 * compile.js — the live-preview loop: debounced (300 ms), single-flight,
 * latest-wins. A compile superseded by a newer one (server 409) is dropped
 * silently; a compile refused because the file changed under an unsaved edit
 * (409 conflict) raises the conflict banner; everything else reaches the
 * onResult listeners.
 *
 * The client rebuilds NOTHING. When the current slide is dirty the body
 * carries { path, index, source, baseVersion } and the SERVER re-reads the
 * file, checks the version and splices the working text into it — one splice
 * implementation, one set of boundary guards, on the side that owns the
 * file. A clean state sends { path } alone and the server compiles the disk.
 */

import { api, isConflict, isSuperseded } from './api.js';
import { store } from './store.js';

const DEBOUNCE_MS = 300;

let timer = null;
let inflight = false;
let queued = false;

let lastResult = null; // last successful CompileResult
const resultListeners = new Set();

/**
 * Body of the next POST /api/compile: `{ path }` when the preview should
 * show the disk, plus `{ index, source, baseVersion }` when the current
 * slide carries unsaved work — the server does the splice, and refuses with
 * a 409 conflict when baseVersion no longer matches the file. Exported for
 * the tests.
 * @returns {{path: string, index?: number, source?: string, baseVersion?: string}}
 */
export function buildBody() {
  const s = store.get();
  const body = { path: s.deck.path };
  if (s.dirty && s.current >= 0) {
    body.index = s.current;
    body.source = s.workingSource;
    body.baseVersion = s.deck.version;
  }
  return body;
}

// ------ compile loop ---------------------------------------------------------

async function flight() {
  inflight = true;
  let result = null;
  let error = null;
  try {
    result = await api.compile(buildBody());
  } catch (err) {
    error = err;
  }
  inflight = false;
  if (result) {
    lastResult = result;
    for (const fn of resultListeners) fn(result, null);
  } else if (isConflict(error)) {
    // the file moved under an unsaved edit: same conflict banner as a save,
    // in its 'external' wording — nothing was refused, nothing written yet
    store.setConflict('external');
  } else if (!isSuperseded(error)) {
    for (const fn of resultListeners) fn(null, error);
  }
  if (queued) {
    queued = false;
    flight(); // re-run once with the NEWEST store state
  }
}

/**
 * Ask for a recompile of the current working state. Debounced 300 ms,
 * single-flight, latest-wins: bursts collapse, a compile superseded by a
 * newer one (server 409) is dropped silently.
 * @param {string} [_reason] free label for debugging ('open', 'edit', …)
 */
export function runCompile(_reason) {
  if (!store.get().deck) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
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

/** Last successful CompileResult, or null. */
export function getLastResult() {
  return lastResult;
}
