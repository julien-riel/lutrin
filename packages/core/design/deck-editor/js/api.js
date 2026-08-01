/**
 * api.js — typed fetch client for every `lutrin edit` route, plus the SSE
 * subscription. No other module talks to the network.
 *
 * Every method rejects with an ApiError carrying the server's status and
 * message. Two 409s are NORMAL outcomes, not failures: /api/compile answers
 * {error:'superseded'} when a newer compile overtook this one (the compile
 * loop swallows it — see compile.js), and BOTH /api/slide and /api/compile
 * answer {error:'conflict'} when baseVersion no longer matches the file on
 * disk (main.js and compile.js turn it into the conflict banner). A third
 * typed refusal, 422 {error:'boundary'}, means the server's post-splice net
 * caught a weld its guards did not foresee — nothing was written, and main.js
 * words the refusal for the user instead of surfacing the raw token.
 */

/** @typedef {{severity:'error'|'warning'|'info', code:string, message:string, line?:number, slide?:number}} Diagnostic */
/** @typedef {{title:string|null, layout:string|null, notes:string[], animate:string|null, intro:string, sections:{heading:string, body:string}[]}} SlideParts */
/** @typedef {{index:number, startLine:number, endLine:number, source:string, title:string|null, layout:string|null, inferredLayout?:string|null, parts:SlideParts|null}} SlideSlice */
/** @typedef {{layouts:string[], officialLayouts:object[], userLayouts:object[], layoutSections:Record<string,{min:number,max:number}>, layoutParams:Record<string,object>}} Capabilities */
/** @typedef {{path:string, version:string, meta:object, sliceable:boolean, sceneOffset:number, slides:SlideSlice[], capabilities:Capabilities, diagnostics:Diagnostic[]}} DeckState */
/** @typedef {{slides:string[], css:string, fontsCss:string, stats:object, diagnostics:Diagnostic[], page:{width:number,height:number}, sceneOffset:number}} CompileResult */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} message server-provided error message
   * @param {object|null} payload full JSON error body when the server sent one
   */
  constructor(status, message, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** True when a rejected compile was superseded by a newer one (drop silently).
 *  The 409s are TYPED by their body — a conflict must never be swallowed. */
export const isSuperseded = (err) =>
  err instanceof ApiError && err.status === 409 && err.payload?.error === 'superseded';

/** True when a slide save lost the race against the file on disk (banner). */
export const isConflict = (err) =>
  err instanceof ApiError && err.status === 409 && err.payload?.error === 'conflict';

/** True when the server's boundary net refused the splice (422): the edit
 *  would have welded into a neighbouring slide — nothing was written. */
export const isBoundary = (err) =>
  err instanceof ApiError && err.status === 422 && err.payload?.error === 'boundary';

async function request(method, url, { json } = {}) {
  const opts = { method, headers: {} };
  if (json !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new ApiError(0, `Serveur de l'éditeur injoignable (${e?.message ?? e})`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body (never expected on API routes) */
  }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  return body;
}

export const api = {
  /**
   * Recursive tree of the served directory — only .deck.md files, empty
   * directories pruned.
   * @returns {Promise<{root:string, entries:object[], truncated?:boolean}>}
   */
  getTree: () => request('GET', '/api/tree'),

  /**
   * Slices, capabilities and metadata of one deck file.
   * @param {string} path root-relative path of a .deck.md file
   * @returns {Promise<DeckState>}
   */
  getDeck: (path) => request('GET', `/api/deck?path=${encodeURIComponent(path)}`),

  /**
   * Compile a deck to HTML fragments. With index/source/baseVersion the
   * SERVER splices the unsaved slide text into the file it re-reads (D2);
   * with `{ path }` alone it compiles the disk. Rejects ApiError(409
   * {error:'superseded'}) when a newer compile overtook this one — drop —
   * and ApiError(409 {error:'conflict'}) when baseVersion is stale — banner.
   * @param {{path:string, index?:number, source?:string, baseVersion?:string}} body
   * @returns {Promise<CompileResult>}
   */
  compile: (body) => request('POST', '/api/compile', { json: body }),

  /**
   * Replace ONE slide's source slice on disk. Rejects ApiError(409
   * {error:'conflict'}) when baseVersion no longer matches the disk.
   * @param {{path:string, index:number, source:string, baseVersion:string}} body
   * @returns {Promise<{version:string, sliceable:boolean, slides:SlideSlice[]}>}
   */
  putSlide: (body) => request('PUT', '/api/slide', { json: body }),

  isSuperseded,
  isConflict,
  isBoundary,
};

// ------ SSE: deck-changed ---------------------------------------------------

const changeListeners = new Set();
let eventSource = null;
let retryTimer = null;

function connectEvents() {
  if (eventSource) return;
  eventSource = new EventSource('/__events');
  eventSource.addEventListener('deck-changed', (ev) => {
    let payload = null;
    try {
      payload = JSON.parse(ev.data);
    } catch {
      /* a malformed event still means "something changed" */
    }
    for (const fn of changeListeners) fn(payload ?? {});
  });
  // EventSource retries transient failures on its own; only a CLOSED stream
  // needs a fresh object — recreate it gently after 2 s.
  eventSource.onerror = () => {
    if (eventSource?.readyState === EventSource.CLOSED) {
      eventSource = null;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (changeListeners.size) connectEvents();
      }, 2000);
    }
  };
}

/**
 * Subscribe to "a deck changed on disk" (server watcher, own writes
 * suppressed). fn receives { path } — the root-relative file that moved.
 * Returns an unsubscribe function.
 * @param {(payload: {path?: string}) => void} fn
 */
export function onDeckChanged(fn) {
  changeListeners.add(fn);
  connectEvents();
  return () => changeListeners.delete(fn);
}
