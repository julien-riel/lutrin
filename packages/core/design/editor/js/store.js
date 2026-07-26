/**
 * store.js — the editor's central state. One snapshot object, mutated only
 * through update()/replaceState()/markSaved(), each notifying subscribers.
 *
 * Shape (see get()):
 *   state          last /api/state payload (server truth, read-only)
 *   theme          WORKING COPY of theme.json (object|null — null: no theme yet)
 *   layouts        WORKING COPIES, Map<name, def>
 *   dirty          { theme:Set<string> (edited paths, '*' = whole object),
 *                    layouts:Set<string> (edited layout names) }
 *   savedSnapshot  {slides, css, fontsCss} of the last compile of the SAVED
 *                  state — what Compare shows while held (compile.js owns it)
 *   conflict       true when the kit changed on disk while dirty (banner)
 *
 * "Immutable-ish": update() copies every object along the edited path, so a
 * panel can compare references to know what moved; siblings stay shared.
 * Treat everything returned by get() as read-only.
 */

const snap = {
  state: null,
  theme: null,
  layouts: new Map(),
  dirty: { theme: new Set(), layouts: new Set() },
  savedSnapshot: null,
  conflict: false,
};

const listeners = new Set();
/** Panel-registered detectors of panel-local drafts (metadata form, naming
 *  cards…) — work the dirty sets cannot see, but that a silent replaceState
 *  would wipe all the same. See hasDrafts(). */
const draftGuards = new Set();

function notify(path) {
  for (const fn of listeners) fn(snap, path);
}

/** Path-copying deep set; value === undefined deletes the leaf. */
function setDeep(obj, parts, value) {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts;
  const copy = Array.isArray(obj) ? obj.slice() : { ...(obj ?? {}) };
  const key = Array.isArray(copy) && /^\d+$/.test(head) ? Number(head) : head;
  if (rest.length === 0) {
    if (value === undefined) {
      if (Array.isArray(copy) && typeof key === 'number') copy.splice(key, 1);
      else delete copy[key];
    } else copy[key] = value;
  } else copy[key] = setDeep(obj?.[key], rest, value);
  return copy;
}

export const store = {
  /** Current snapshot — read-only by convention. */
  get: () => snap,

  /**
   * Set a value by path and notify. Paths:
   *   'theme'                  replace the whole working theme (dirty '*')
   *   'theme.colors.primary'   deep-set inside the theme (dirty 'colors.primary')
   *   'layouts.<name>'         set the working def of one layout (dirty <name>)
   *   'layouts.<name>.params.x' deep-set inside one def (dirty <name>)
   *   'savedSnapshot' | 'conflict'  shell-level values, never dirty
   * Pass an ARRAY of segments when a key contains a dot:
   *   update(['theme', 'images', 'logo.dark'], 'images/logo-dark.svg')
   * value === undefined deletes the leaf key.
   * 'state', 'dirty' and bare 'layouts' are not writable here.
   * @param {string|string[]} path
   * @param {*} value
   */
  update(path, value) {
    const parts = Array.isArray(path) ? [...path] : String(path).split('.');
    const root = parts.shift();
    if (root === 'theme') {
      snap.theme = parts.length ? setDeep(snap.theme, parts, value) : value;
      snap.dirty.theme.add(parts.length ? parts.join('.') : '*');
    } else if (root === 'layouts') {
      if (!parts.length)
        throw new Error("update('layouts', …) is not allowed — update 'layouts.<name>'.");
      const name = parts.shift();
      const next = new Map(snap.layouts);
      if (!parts.length) {
        if (value === undefined) next.delete(name);
        else next.set(name, value);
      } else next.set(name, setDeep(next.get(name), parts, value));
      snap.layouts = next;
      snap.dirty.layouts.add(name);
    } else if (root === 'state' || root === 'dirty') {
      throw new Error(`'${root}' is not writable through update().`);
    } else {
      snap[root] = parts.length ? setDeep(snap[root], parts, value) : value;
    }
    notify(Array.isArray(path) ? path.join('.') : String(path));
  },

  /**
   * Reset from a fresh /api/state payload: server truth in, working copies
   * re-derived (deep clones), dirty and conflict cleared, savedSnapshot
   * invalidated (the next clean compile recaptures it — main.js wires that).
   * @param {import('./api.js').ServerState} serverState
   */
  replaceState(serverState) {
    snap.state = serverState;
    snap.theme = serverState.theme ? structuredClone(serverState.theme) : null;
    const map = new Map();
    for (const l of serverState.layouts ?? []) {
      if (l.def && typeof l.def === 'object') map.set(l.name, structuredClone(l.def));
    }
    snap.layouts = map;
    snap.dirty = { theme: new Set(), layouts: new Set() };
    snap.savedSnapshot = null;
    snap.conflict = false;
    notify('state');
  },

  /** Clear the dirty sets (after a successful save) and notify. */
  markSaved() {
    snap.dirty = { theme: new Set(), layouts: new Set() };
    notify('dirty');
  },

  /** True when anything differs from the kit on disk. */
  isDirty: () => snap.dirty.theme.size > 0 || snap.dirty.layouts.size > 0,

  /**
   * Drop the working copy of one layout WITHOUT marking anything dirty — for
   * a deletion already performed on disk (DELETE /api/layouts): nothing
   * differs from the kit anymore, so nothing is left to save.
   * @param {string} name
   */
  forgetLayout(name) {
    const next = new Map(snap.layouts);
    next.delete(name);
    snap.layouts = next;
    snap.dirty.layouts.delete(name);
    notify(`layouts.${name}`);
  },

  /**
   * Register a detector of panel-local draft work (returns true while a
   * draft exists). The shell consults hasDrafts() before silently replacing
   * the state on an external kit change. Returns an unregister function.
   * @param {() => boolean} fn
   */
  registerDraftGuard(fn) {
    draftGuards.add(fn);
    return () => draftGuards.delete(fn);
  },

  /** True while any registered panel holds unsaved panel-local work. */
  hasDrafts() {
    for (const fn of draftGuards) if (fn()) return true;
    return false;
  },

  /**
   * Subscribe to every change. fn(snapshot, changedPath) — changedPath is
   * 'state' after replaceState, 'dirty' after markSaved, else the update()
   * path. Returns an unsubscribe function.
   * @param {(snap: object, path: string) => void} fn
   */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
