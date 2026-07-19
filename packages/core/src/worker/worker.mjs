/**
 * Compilation worker — a dedicated Node process, launched by the editor hosts
 * (VS Code extension: fork; Obsidian plugin: spawn of a system Node).
 *
 * All of the compilation (including mmdc/execFileSync, blocking for up to 60 s
 * per Mermaid diagram, and the native resvg module) lives here: the host only
 * does IPC round trips and never freezes.
 *
 * One and the same for both hosts: it lives in the core (the extensions point
 * at `dist/core/src/worker/worker.mjs` — a faithful copy of the core in
 * production, a symlink in development), so its asset resolution through
 * import.meta.url and its node_modules stay intact.
 *
 * Protocol (IPC, types in ./protocol.d.ts):
 *   → { id, cmd: 'compile',    payload: { source, baseDir, themePath?, defaultTheme?, imageRoots? } }
 *   → { id, cmd: 'validate',   payload: { source, baseDir, themePath?, defaultTheme?, imageRoots? } }
 *   → { id, cmd: 'exportPptx', payload: { source, baseDir, outPath, themePath?, defaultTheme?, imageRoots? } }
 *   → { id, cmd: 'exportHtml', payload: { source, baseDir, outPath, themePath?, defaultTheme?, imageRoots? } }
 *   ← { id, ok: true, result } | { id, ok: false, error: { message } }
 *
 * `imageRoots`: additional roots (beyond the deck's directory) from which a
 * LOCAL image may be embedded — containment against arbitrary file reads
 * (assets.mjs). Absent/empty ⇒ only the deck's directory is admitted.
 *
 * Requests are SERIALIZED (a promise queue): the theme and the user layouts
 * are module state mutated by each compilation — two interleaved requests
 * (deck A being rendered while deck B applies its theme) would produce a
 * hybrid rendering, silently wrong.
 */

import fs from 'node:fs/promises';
import { compileHtml, renderDeckHtml } from '../html/render.mjs';
import { parseDeck } from '../deck/parse.mjs';
import { buildScenes } from '../deck/layout.mjs';
import { prepareDeckContext } from '../deck/context.mjs';
import { renderDeck } from '../pptx/render.mjs';
import { validateDeck } from '../deck/validate.mjs';

const HANDLERS = {
  async compile({ source, baseDir, themePath, defaultTheme, imageRoots }) {
    const { slides, css, fontsCss, stats, scenes, deck } = await compileHtml(source, {
      baseDir,
      fragment: true,
      themePath,
      defaultTheme,
      imageRoots,
    });
    return {
      slides,
      css,
      fontsCss,
      stats,
      slideMap: scenes.map((s, k) => ({ slide: k + 1, startLine: s.sourceLine ?? 1 })),
      animSteps: scenes.map((s) => s.animSteps ?? null),
      // deck and scenes reused: a single parse/layout pass per keystroke
      diagnostics: validateDeck(source, {
        baseDir,
        themePath,
        defaultTheme,
        imageRoots,
        deck,
        scenes,
      }),
    };
  },

  async validate({ source, baseDir, themePath, defaultTheme, imageRoots }) {
    return { diagnostics: validateDeck(source, { baseDir, themePath, defaultTheme, imageRoots }) };
  },

  async exportPptx({ source, baseDir, outPath, themePath, defaultTheme, imageRoots }) {
    const deck = parseDeck(source);
    const prep = prepareDeckContext(deck.meta, { baseDir, themePath, defaultTheme });
    const scenes = buildScenes(deck);
    const stats = await renderDeck(scenes, deck.meta, baseDir, outPath, { imageRoots });
    stats.warnings = [...prep.diagnostics.map((d) => d.message), ...(stats.warnings ?? [])];
    return { stats, outPath };
  },

  async exportHtml({ source, baseDir, outPath, themePath, defaultTheme, imageRoots }) {
    const deck = parseDeck(source);
    const prep = prepareDeckContext(deck.meta, { baseDir, themePath, defaultTheme });
    const scenes = buildScenes(deck);
    const { html, stats } = await renderDeckHtml(scenes, deck.meta, baseDir, { imageRoots });
    stats.warnings = [...prep.diagnostics.map((d) => d.message), ...(stats.warnings ?? [])];
    await fs.writeFile(outPath, html);
    return { stats, outPath };
  },
};

/**
 * TOLERANT send: the IPC channel can be closed out from under us (host killed,
 * extension reloaded). A send exception propagated as is would travel through
 * the request's catch and reject the QUEUE — every subsequent request would
 * then be left without an answer, in a worker that is nonetheless alive. What
 * does not get out is lost, never fatal.
 */
function post(message) {
  try {
    process.send?.(message);
  } catch {
    /* channel closed: the client will notice through its own watchdog timer */
  }
}

let queue = Promise.resolve(); // serialization: one request at a time

/**
 * An IPC message is EXTERNAL data: nothing guarantees its shape. Destructuring
 * outright (`({ id, cmd, payload })`) threw OUTSIDE the try on `null` or on a
 * string — the exception escaped the handler, and the worker died on a
 * malformed message. So the shape is validated first: anything that is not an
 * object carrying an `id` has nobody to answer to and is ignored; the rest
 * follows the normal path, errors included.
 */
process.on('message', (message) => {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return;
  const { id, cmd, payload } = message;
  if (id === undefined || id === null) return;

  queue = queue
    .then(async () => {
      try {
        // the request ENTERS execution: the client rearms its watchdog timer
        // from here on (waiting in the queue must not count — otherwise a
        // healthy request would expire behind a long Mermaid render, and the
        // client's restart() would kill the worker mid-work)
        post({ id, started: true });
        // Object.hasOwn: HANDLERS is a literal — without the guard, a cmd
        // 'toString' (or 'constructor', 'valueOf'…) would surface a function
        // inherited from Object.prototype, would pass the test below and would
        // be CALLED: the worker would answer { ok: true, result: '[object …]' }
        // instead of the protocol error, and the host would destructure undefined
        const handler =
          typeof cmd === 'string' && Object.hasOwn(HANDLERS, cmd) ? HANDLERS[cmd] : null;
        if (!handler) throw new Error(`unknown command: ${cmd}`);
        post({ id, ok: true, result: await handler(payload ?? {}) });
      } catch (e) {
        post({ id, ok: false, error: { message: e?.message ?? String(e) } });
      }
    })
    // final safeguard: whatever happens in the chain link above, the queue restarts from a
    // RESOLVED promise — a rejected queue never repairs itself
    .catch(() => {});
});
