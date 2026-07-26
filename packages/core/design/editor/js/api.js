/**
 * api.js — typed fetch client for every `lutrin kit edit` route, plus the
 * SSE subscription. No other module talks to the network.
 *
 * Every method rejects with an ApiError carrying the server's status and
 * message; /api/compile's 409 {error:'superseded'} is a normal outcome the
 * compile loop swallows (see compile.js).
 */

/** @typedef {{severity:'error'|'warning'|'info', code:string, message:string, line?:number, slide?:number}} Diagnostic */
/** @typedef {{slides:string[], css:string, fontsCss:string, slideMap:{slide:number,startLine:number}[], animSteps:(object|null)[], stats:object, diagnostics:Diagnostic[]}} CompileResult */
/** @typedef {{name:string, manifest:object|null, kitDiagnostics:Diagnostic[], theme:object|null, themeExists:boolean, themeAnchor:string, layouts:{name:string,file:string,def:object|null}[], fonts:{files:{file:string,bytes:number}[], pairs:{variant:string,path:string,ttf:boolean,woff2:boolean}[]}, images:{alias:string,path:string,ext:string,bytes:number|null,exists:boolean}[], orphans:string[], capabilities:{bases:object[], reservedNames:string[]}, defaults:object, version:string}} ServerState */

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

/** True when a rejected compile was superseded by a newer one (drop it silently). */
export const isSuperseded = (err) => err instanceof ApiError && err.status === 409;

async function request(method, url, { json, binary } = {}) {
  const opts = { method, headers: {} };
  if (json !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(json);
  } else if (binary !== undefined) {
    opts.headers['Content-Type'] = 'application/octet-stream';
    opts.body = binary;
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new ApiError(0, `Editor server unreachable (${e?.message ?? e})`);
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

const seg = (name) => encodeURIComponent(name);

export const api = {
  /** @returns {Promise<ServerState>} */
  getState: () => request('GET', '/api/state'),

  /**
   * Compile the specimen (or `source`) under the kit, with the working
   * copies overlaid. Rejects ApiError(409) when superseded — test with
   * isSuperseded() and drop silently.
   * @param {{source?:string, theme?:object, layouts?:object[]}} body
   * @returns {Promise<CompileResult>}
   */
  compile: (body) => request('POST', '/api/compile', { json: body }),

  /**
   * @param {object} theme full content of theme.json
   * @returns {Promise<{file:string, diagnostics:Diagnostic[]}>}
   */
  putTheme: (theme) => request('PUT', '/api/theme', { json: { theme } }),

  /**
   * Update kit.json's display metadata (version, description, author,
   * homepage — an empty string removes a key). The name is locked server-side.
   * @param {object} manifest the fields to update
   * @returns {Promise<{file:string, manifest:object, diagnostics:Diagnostic[]}>}
   */
  putManifest: (manifest) => request('PUT', '/api/manifest', { json: { manifest } }),

  /**
   * @param {string} name layout name (lowercase, digits, hyphens); must equal def.name
   * @param {object} def full layout definition
   * @returns {Promise<{file:string, diagnostics:Diagnostic[]}>}
   */
  putLayout: (name, def) => request('PUT', `/api/layouts/${seg(name)}`, { json: { def } }),

  /** @returns {Promise<{deleted:string}>} */
  deleteLayout: (name) => request('DELETE', `/api/layouts/${seg(name)}`),

  /**
   * @param {string} filename e.g. "Inter-Bold.ttf" or "Inter-Bold.woff2"
   * @param {Blob|File|ArrayBuffer|Uint8Array} bytes raw font bytes
   * @returns {Promise<{file:string, bytes:number}>}
   */
  putFont: (filename, bytes) => request('PUT', `/api/fonts/${seg(filename)}`, { binary: bytes }),

  /** @returns {Promise<{deleted:string}>} */
  deleteFont: (filename) => request('DELETE', `/api/fonts/${seg(filename)}`),

  /**
   * @param {string} filename "<alias>.<png|jpg|jpeg|gif|webp|svg>" — the server
   *        checks the magic bytes against the extension.
   * @param {Blob|File|ArrayBuffer|Uint8Array} bytes raw image bytes
   * @returns {Promise<{alias:string, file:string, bytes:number}>}
   */
  putImage: (filename, bytes) => request('PUT', `/api/images/${seg(filename)}`, { binary: bytes }),

  /** @returns {Promise<{deleted:string}>} */
  deleteImage: (filename) => request('DELETE', `/api/images/${seg(filename)}`),

  /**
   * URL of a kit file served inert (images and fonts keep their MIME type,
   * everything else is plain text). For <img src> and FontFace previews,
   * never for fetch+eval.
   * @param {string} relPath kit-relative path, e.g. "images/logo.svg"
   */
  fileUrl: (relPath) => `/api/files/${relPath.split('/').map(seg).join('/')}`,

  /** Download URL of the packed kit (used by the topbar's Export link). */
  exportUrl: '/api/export',

  /**
   * Pack the kit and hand back the archive with the metadata the headers
   * carry — for panels that surface the checksum next to the download.
   * @returns {Promise<{blob: Blob, sha256: string|null, filename: string}>}
   */
  async exportKit() {
    let res;
    try {
      res = await fetch('/api/export');
    } catch (e) {
      throw new ApiError(0, `Editor server unreachable (${e?.message ?? e})`);
    }
    if (!res.ok) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
    }
    const disp = res.headers.get('Content-Disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? 'kit.deckkit';
    return { blob: await res.blob(), sha256: res.headers.get('X-Kit-Sha256'), filename: name };
  },

  /** True when a rejected compile was superseded by a newer one (same as the
   *  module export — mirrored here so panels reach it through ctx.api). */
  isSuperseded,
};

// ------ SSE: kit-changed --------------------------------------------------

const changeListeners = new Set();
let eventSource = null;
let retryTimer = null;

function connectEvents() {
  if (eventSource) return;
  eventSource = new EventSource('/__events');
  eventSource.addEventListener('kit-changed', () => {
    for (const fn of changeListeners) fn();
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
 * Subscribe to "the kit changed on disk" (server watcher, own writes
 * suppressed). Returns an unsubscribe function.
 * @param {() => void} fn
 */
export function onKitChanged(fn) {
  changeListeners.add(fn);
  connectEvents();
  return () => changeListeners.delete(fn);
}
