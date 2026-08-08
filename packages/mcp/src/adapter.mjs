/**
 * The thin adapter between the MCP tools and `@lutrin/core`.
 *
 * Everything here is a WRAPPER over existing core exports — parse, validate,
 * layout, and the two renderers. No compiler logic lives in this package: it
 * would duplicate the core and, worse, would cross the `deck/`-imports-no-backend
 * boundary that `packages/core/test/boundary.test.mjs` enforces. The order of
 * operations mirrors the CLI's `build`/`validate` exactly, because that path is
 * the one the golden suite exercises.
 *
 * TWO invariants shape this file:
 *
 *   1. ERRORS ARE RESULTS, NOT CRASHES. A deck that fails validation, a missing
 *      file, a bad format — all return a structured object the tool turns into a
 *      normal (or `isError`) tool result. The stdio transport must never see a
 *      thrown error, or a single bad deck would take the whole server down.
 *
 *   2. THE PIPELINE IS SERIALIZED. `@lutrin/core` keeps the design tokens and
 *      the layout registry as MODULE state, mutated in place by
 *      `prepareDeckContext` before every `buildScenes` (it resets and re-applies
 *      from a snapshot — safe for a warm process compiling decks one after
 *      another). A CLI is one-shot so it never noticed; a server is not. Two
 *      compilations interleaving across a render `await` would corrupt each
 *      other's tokens (deck A rendered under deck B's kit). `runExclusive`
 *      threads every pipeline operation through one queue so a compilation
 *      finishes before the next begins.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareDeckContext } from '@lutrin/core/context';
import { renderDeckHtml } from '@lutrin/core/html';
import { buildScenes } from '@lutrin/core/layout';
import { parseDeck } from '@lutrin/core/parse';
import { renderDeck } from '@lutrin/core/pptx';
import { isKitName } from '@lutrin/core/theme';
import { validateDeck } from '@lutrin/core/validate';

/** A caller mistake (bad arguments, missing file): reported as an `isError`
 *  tool result with a readable message, never as an internal failure. */
export class UsageError extends Error {}

const FORMAT_EXT = { pptx: '.pptx', html: '.html' };

// --- pipeline serialization (invariant 2) ----------------------------------

let chain = Promise.resolve();

/** Run `fn` only once every previously queued pipeline operation has settled.
 *  The chain never rejects (a failed op must not wedge the queue); the caller
 *  still gets `fn`'s own resolution/rejection. */
export function runExclusive(fn) {
  const result = chain.then(() => fn());
  chain = result.then(
    () => {},
    () => {},
  );
  return result;
}

// --- input resolution -------------------------------------------------------

/**
 * A deck arrives either INLINE (`deck`, the text the agent already holds in
 * context) or as a `path` on disk — exactly one. `baseDir` (where relative
 * images and `layouts/*.json` resolve from) defaults to the deck's own
 * directory for a path, or the process cwd for inline text, and can be
 * overridden.
 */
function resolveSource({ deck, path: deckPath, baseDir }) {
  const hasInline = typeof deck === 'string' && deck.length > 0;
  const hasPath = typeof deckPath === 'string' && deckPath.length > 0;
  if (hasInline === hasPath)
    throw new UsageError('provide exactly one of `deck` (inline Markdown) or `path`');

  let source;
  let origin = null;
  let dir;
  if (hasPath) {
    origin = path.resolve(deckPath);
    if (!fs.existsSync(origin)) throw new UsageError(`file not found: ${deckPath}`);
    if (!fs.statSync(origin).isFile()) throw new UsageError(`not a file: ${deckPath}`);
    source = fs.readFileSync(origin, 'utf8');
    dir = path.dirname(origin);
  } else {
    source = deck;
    dir = process.cwd();
  }
  if (typeof baseDir === 'string' && baseDir) dir = path.resolve(baseDir);
  return { source, baseDir: dir, origin };
}

/** The explicit `kit` argument, mapped to core's `themePath` the way the CLI
 *  maps `--kit`: an installed kit name (or `none`) passes through untouched, any
 *  other reference is a path — resolved here against the deck's baseDir, so a
 *  kit file shipped beside the deck is found. */
function themePathOf(kit, baseDir) {
  if (typeof kit !== 'string' || !kit) return null;
  return isKitName(kit) || kit === 'none' ? kit : path.resolve(baseDir, kit);
}

const countBy = (diagnostics, severity) =>
  diagnostics.filter((d) => d.severity === severity).length;

// --- validate_deck ----------------------------------------------------------

/**
 * The `--json` deck doctor, as a tool: positioned diagnostics plus the same
 * `valid` verdict the CLI's `validate --json` prints. A deck full of errors is
 * a valid RESULT (`valid: false`), not a failure of the call.
 */
export function validateDeckTool(input = {}) {
  return runExclusive(() => {
    const { source, baseDir, origin } = resolveSource(input);
    const themePath = themePathOf(input.kit, baseDir);
    const diagnostics = validateDeck(source, { baseDir, themePath });
    const errorCount = countBy(diagnostics, 'error');
    return {
      valid: errorCount === 0,
      errorCount,
      warningCount: countBy(diagnostics, 'warning'),
      diagnostics,
      ...(origin ? { path: origin } : {}),
    };
  });
}

// --- build_deck -------------------------------------------------------------

/** Where the output goes, decided and CHECKED before a byte is written (the
 *  CLI's rule 1): an explicit `out` must carry the format's extension and not be
 *  a directory; otherwise it is derived next to the source deck, or — for an
 *  inline deck — under `${PLUGIN_DATA}` (the client's per-plugin data dir) or
 *  the system temp directory. */
function resolveOut(out, origin, format) {
  const ext = FORMAT_EXT[format];
  if (typeof out === 'string' && out) {
    const abs = path.resolve(out);
    if (path.extname(abs).toLowerCase() !== ext)
      throw new UsageError(`out "${out}" must have the ${ext} extension for format "${format}"`);
    if (fs.existsSync(abs) && !fs.statSync(abs).isFile())
      throw new UsageError(`out "${out}" exists and is not a file`);
    return abs;
  }
  if (origin) return `${origin.replace(/\.[^.]+$/, '')}${ext}`;
  const dir = process.env.PLUGIN_DATA || os.tmpdir();
  return path.join(dir, `deck${ext}`);
}

/** Only the render facts an agent can act on — omit the zero/absent ones so the
 *  payload stays small and every present key MEANS something. */
function renderSummary(stats) {
  const s = { slideCount: stats.slideCount };
  if (stats.fontsEmbedded) s.fontsEmbedded = stats.fontsEmbedded;
  if (stats.animatedSlides) s.animatedSlides = stats.animatedSlides;
  if (stats.morphSlides) s.morphSlides = stats.morphSlides;
  return s;
}

/** The graceful degradations the CLI narrates — surfaced so an agent knows the
 *  deck shipped but a browser was missing, an icon was misspelled, etc. Each is
 *  a plain sentence; an empty array means full fidelity. */
function degradations(stats) {
  const out = [];
  const short = (total, done, noun) => {
    if (total && done < total)
      out.push(`${total - done} ${noun}${total - done > 1 ? 's' : ''} degraded to a text fallback`);
  };
  short(stats.mermaidTotal, stats.mermaidRendered, 'Mermaid diagram');
  short(stats.mathTotal, stats.mathRendered, 'equation');
  if (stats.iconsTotal && stats.iconsRendered < stats.iconsTotal)
    out.push(
      `${stats.iconsTotal - stats.iconsRendered} icon(s) not found — check the name on lucide.dev`,
    );
  if (stats.remoteTotal && stats.remoteFetched < stats.remoteTotal)
    out.push(
      `${stats.remoteTotal - stats.remoteFetched} remote image(s) not downloaded — kept a placeholder`,
    );
  return out;
}

/**
 * Compile a deck to `.pptx` or `.html`. Mirrors the CLI `build`: parse → prepare
 * theme/layouts → build scenes → validate → (write). A deck carrying an `error`
 * diagnostic (or that is empty) is NOT written unless `force`, and the
 * diagnostics come back so the agent can fix them — the same "check before
 * writing" contract the CLI holds.
 *
 * PDF and image formats are deliberately out of scope here: they REQUIRE a
 * browser and cannot degrade, whereas `.pptx`/`.html` always produce a file
 * (Mermaid and equations fall back to text when no browser is found).
 */
export function buildDeckTool(input = {}) {
  return runExclusive(async () => {
    const format = input.format;
    if (format !== 'pptx' && format !== 'html')
      throw new UsageError(`format must be "pptx" or "html", got ${JSON.stringify(format)}`);

    const { source, baseDir, origin } = resolveSource(input);
    const themePath = themePathOf(input.kit, baseDir);
    const out = resolveOut(input.out, origin, format);

    const deck = parseDeck(source);
    prepareDeckContext(deck.meta, { baseDir, themePath });
    const scenes = buildScenes(deck);
    const diagnostics = validateDeck(source, { baseDir, themePath, deck, scenes });

    const errorCount = countBy(diagnostics, 'error');
    // EMPTY_DECK is only a warning, but writing a slide-less file and calling it
    // a success is the one lie the CLI refuses too — treat it as blocking.
    const empty = diagnostics.some((d) => d.code === 'EMPTY_DECK');
    if ((errorCount > 0 || empty) && !input.force) {
      return {
        written: null,
        blocked: true,
        format,
        valid: errorCount === 0,
        errorCount,
        warningCount: countBy(diagnostics, 'warning'),
        diagnostics,
        hint: 'fix the error diagnostics and retry, or pass force:true to compile anyway',
      };
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    let stats;
    if (format === 'pptx') {
      stats = await renderDeck(scenes, deck.meta, baseDir, out, {});
    } else {
      const rendered = await renderDeckHtml(scenes, deck.meta, baseDir, {});
      fs.writeFileSync(out, rendered.html);
      stats = rendered.stats;
    }

    // Render-time diagnostics of severity `error` (e.g. a missing rasterizer
    // that turned charts to text): the file was written but is truncated. Report
    // it as the CLI does — the deliverable exists, but it does not claim full
    // success.
    const renderErrors = (stats.diagnostics ?? []).filter((d) => d.severity === 'error');
    return {
      written: out,
      format,
      valid: errorCount === 0,
      errorCount,
      warningCount: countBy(diagnostics, 'warning'),
      summary: renderSummary(stats),
      degradations: degradations(stats),
      incompleteRender: renderErrors.length > 0,
      diagnostics,
      ...(renderErrors.length ? { renderErrors } : {}),
      ...(input.force && (errorCount > 0 || empty) ? { forced: true } : {}),
    };
  });
}
