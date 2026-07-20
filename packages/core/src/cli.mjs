#!/usr/bin/env node
/**
 * lutrin — a Markdown → PowerPoint / HTML presentation compiler,
 * themable (generic theme by default; an organization's brand shipped
 * as a KIT — directory or .deckkit archive, see `lutrin kit`).
 *
 * Usage:
 *   lutrin build <input.md> [-o output.pptx|output.html] [--html] [--kit <kit|file.json|directory>] [--vendor-assets] [--verbose] [--force]
 *   lutrin preview <input.md> [--port 4321] [--kit <kit|file.json|directory>]
 *   lutrin validate <input.md> [--json] [--kit <kit|file.json|directory>]
 *   lutrin inspect <input.md> [-o output.json] [--kit <kit|file.json|directory>]
 *   lutrin vendor <input.md> [--kit <kit|file.json|directory>]
 *   lutrin config [--kit <kit|file.json|none>] [--unset]
 *   lutrin kit install <file.deckkit|https://…> [--force] [--name <name>]
 *   lutrin kit list | remove <name> | create <directory> [-o <file.deckkit>]
 *   lutrin capabilities [<input.md>] [--kit <kit|file.json|directory>] [--json]
 *
 * `lutrin <input.md> …` with no subcommand = `build` (compatibility).
 * `--kit` takes precedence over the frontmatter `kit:` key (which is itself
 * resolved relative to the deck's directory), over the project default
 * (a package.json carrying "lutrin": { "kit": … }) and over the user default
 * (`lutrin config`, shared across projects — see theme.mjs).
 *
 * Remote images go to the user cache (`~/.cache/lutrin/remote/`): compiling
 * writes nothing into the source tree. `--vendor-assets`, or `assets: vendor`
 * in the frontmatter, copies them into `assets/remote/` next to the deck — for
 * a self-contained directory (archiving, handover).
 *
 * TWO RULES hold this whole module together, and every function below is
 * merely their application:
 *
 *   1. CHECK BEFORE WRITING. A command that fails leaves nothing behind it:
 *      the output extension, the path, the requested kit and the deck's
 *      diagnostics are all checked before the first byte is written. The
 *      historical fault — `-o report` produced a file "report" that nothing
 *      knows how to open, because the post-processing failed AFTER the
 *      write — is the one these upfront checks remove.
 *   2. DO NOT SILENCE WHAT FAILED. A kit requested EXPLICITLY (`--kit`, or
 *      the frontmatter `kit:`) and not found is an ERROR: delivering the deck
 *      under the generic theme would hand over a document that is wrong to
 *      the eye, and `vendor` even announced "the directory is self-contained"
 *      for a directory stripped of the intended brand. An IMPLICIT default
 *      (the user config shared across projects) that fails to resolve stays a
 *      plain warning: the deck asked for nothing, the generic fallback is
 *      legitimate — that distinction is carried by the severity of
 *      resolveTheme's diagnostics (see theme.mjs).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeck } from './deck/parse.mjs';
import { buildScenes } from './deck/layout.mjs';
import { prepareDeckContext } from './deck/context.mjs';
import { FONTS } from './deck/tokens.mjs';
import { closest } from './deck/suggest.mjs';
import {
  isKitName,
  resolveTheme,
  userConfigRoot,
  userKitsDir,
  listInstalledKits,
  readUserKit,
  setUserKit,
  migrateUserConfig,
} from './deck/theme.mjs';
import { validateDeck, capabilities } from './deck/validate.mjs';
import { readKit, parseKitManifest } from './deck/kit.mjs';
import {
  readKitArchive,
  packKit,
  fetchKitArchive,
  installKitArchive,
  sha256,
} from './kit/archive.mjs';

const COMMANDS = [
  'build',
  'preview',
  'validate',
  'inspect',
  'capabilities',
  'config',
  'kit',
  'vendor',
  'setup-mermaid',
];

const USAGE = `Usage:
  lutrin build <input.md> [-o output.pptx|output.html] [--html] [--kit <kit|file.json|directory>] [--vendor-assets] [--verbose] [--force]
  lutrin preview <input.md> [--port 4321] [--kit <kit|file.json|directory>]
  lutrin validate <input.md> [--json] [--kit <kit|file.json|directory>]
  lutrin inspect <input.md> [-o output.json] [--kit <kit|file.json|directory>]
  lutrin vendor <input.md> [--kit <kit|file.json|directory>]
  lutrin config [--kit <kit|file.json|none>] [--unset]
  lutrin kit install <file.deckkit|https://…> [--force] [--name <name>]
  lutrin kit list
  lutrin kit remove <name>
  lutrin kit create <directory> [-o <file.deckkit>]
  lutrin capabilities [<input.md>] [--kit <kit|file.json|directory>] [--json]
  lutrin setup-mermaid [--yes]
  lutrin --version | --help`;

/** Help that was ASKED FOR is an answer (stdout, exit code 0); usage recalled
 *  for want of arguments is an error (stderr, non-zero exit code). A script
 *  running `lutrin --help | …` must not receive an empty stream. */
function usage(code = 1) {
  if (code === 0) console.log(USAGE);
  else console.error(USAGE);
  process.exit(code);
}

/** Usage error: one line on stderr, exit code 1 — never a stack trace. */
function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** The published version: the one in the package's package.json, not a copied
 *  constant that would diverge on the first `npm version`. */
function printVersion() {
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  console.log(JSON.parse(fs.readFileSync(pkg, 'utf8')).version);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Argument parser — STRICT
// ---------------------------------------------------------------------------

/**
 * Every command declares its flags and their arity: `'value'` (the flag
 * consumes an argument) or `'boolean'`. Everything else is refused.
 *
 * The old parser swallowed any `-xyz` and set it as a true flag: a typo
 * (`--kti brand`) compiled silently WITHOUT the brand, and a trailing `-o`
 * absorbed the next flag as a file name. The contract is now: what is not
 * understood is said.
 */
const FLAGS_KIT = { kit: 'value', theme: 'value' }; // `--theme`: deprecated alias
const FLAG_SPECS = {
  build: {
    ...FLAGS_KIT,
    o: 'value',
    output: 'value',
    html: 'boolean',
    'vendor-assets': 'boolean',
    verbose: 'boolean',
    force: 'boolean',
    ir: 'boolean',
  },
  preview: { ...FLAGS_KIT, port: 'value' },
  validate: { ...FLAGS_KIT, json: 'boolean' },
  // no `ir` here: on `inspect`, the flag never did anything — the command IS
  // the dump. It is kept only on `build` (compatibility with the old `--ir`,
  // removed from argv before delegating); elsewhere the strict parser refuses
  // it with its suggestion, rather than accepting it with no effect.
  inspect: { ...FLAGS_KIT, o: 'value', output: 'value' },
  vendor: { ...FLAGS_KIT },
  config: { ...FLAGS_KIT, unset: 'boolean' },
  kit: { name: 'value', o: 'value', output: 'value', force: 'boolean' },
  // `capabilities` takes the same kit flags as the deck commands: the catalog
  // it publishes IS AUTHORITATIVE, so it must be able to be the catalog of the
  // real context (installed kit, layouts/ next to the deck) and not just that
  // of the bare engine.
  capabilities: { ...FLAGS_KIT, json: 'boolean' },
  // `--yes` is what authorizes the ~200 MB download: a browser never arrives
  // on a machine because someone ran a diagnostic.
  'setup-mermaid': { yes: 'boolean' },
};

/**
 * Splits `argv` into { _: positionals, …flags }.
 *
 *   - the GNU form `--kit=value` is understood (split on the FIRST "=");
 *   - `--kit=` (empty value) and `--html=true` (valued boolean) are named
 *     errors, not guessed values — since `--html=false` disables nothing,
 *     accepting it would be a lie;
 *   - the suggestion is computed on the NAME ALONE: on "name=value", no edit
 *     distance ever finds the intended flag again;
 *   - `--` ends the options (POSIX): without it, a deck named `-deck.md` was
 *     not compilable at all.
 */
function parseArgs(argv, spec = {}) {
  const names = Object.keys(spec);
  const args = { _: [] };
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (endOfOptions) {
      args._.push(a);
      continue;
    }
    if (a === '--') {
      endOfOptions = true;
      continue;
    }
    if (a === '-h' || a === '--help') usage(0);
    // a lone `-` is a positional by convention (standard input), not a flag
    if (!a.startsWith('-') || a === '-') {
      args._.push(a);
      continue;
    }

    const eq = a.indexOf('=');
    const written = eq === -1 ? a : a.slice(0, eq); // the "--kit" of "--kit=value"
    const name = written.replace(/^--?/, '');
    const dash = written.startsWith('--') ? '--' : '-';
    const arity = spec[name];

    if (!arity) {
      const nearest = closest(name, names);
      fail(`unknown flag: ${written}${nearest ? ` — did you mean "${dash}${nearest}"?` : ''}`);
    }

    if (arity === 'boolean') {
      if (eq !== -1) fail(`${written} takes no value: it is a flag, remove "=${a.slice(eq + 1)}".`);
      args[name] = true;
      continue;
    }

    if (eq !== -1) {
      const value = a.slice(eq + 1);
      if (!value) fail(`${written} expects a value — it is empty after the "=".`);
      args[name] = value;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) fail(`${written} expects a value.`);
    if (next.startsWith('-') && next !== '-')
      fail(
        `${written} expects a value — "${next}" looks like a flag (use "${written}=${next}" if that really is the intended value).`,
      );
    args[name] = next;
    i++;
  }
  return args;
}

/** The input file: one only, and one that exists. A second positional was
 *  silently ignored — the author believed two decks had been compiled. */
function requireInput(args) {
  if (args._.length > 1)
    fail(`a single input file is expected — got ${args._.length}: ${args._.join(', ')}`);
  const input = args._[0];
  if (!input) usage();
  if (!fs.existsSync(input)) fail(`file not found: ${input}`);
  return input;
}

const readSource = (input) => fs.readFileSync(input, 'utf8');
const baseDirOf = (input) => path.dirname(path.resolve(input));
/** The CLI's --kit: the NAME of an installed kit is passed through to
 *  resolveTheme as is (resolved from the user config, hence independent of the
 *  cwd); ANY other reference is a path resolved against the current directory
 *  (not the deck) — a non-existent path thus becomes an explicit error, never a
 *  silent namesake next to the deck. `--theme` is still accepted as a
 *  deprecated alias. */
const themePathOf = (args) => {
  const ref =
    typeof args.kit === 'string' ? args.kit : typeof args.theme === 'string' ? args.theme : null;
  if (ref === null) return null;
  return isKitName(ref) || ref === 'none' ? ref : path.resolve(ref);
};

const SEVERITY_ICON = { error: '✖', warning: '⚠', info: 'ℹ' };

/**
 * The safety net for the EXPLICIT kit (rule 2 at the top of the module): the
 * resolution is played DRY, before any write, and its errors stop the command.
 *
 * It is resolveTheme that arbitrates explicit vs implicit: it downgrades to
 * `warning` what comes from the user default, and leaves at `error` what the
 * deck or the project designated. Here, we only honour that severity — the
 * rule stays stated in a single place.
 */
function requireKit(meta, { baseDir, themePath }) {
  const { diagnostics } = resolveTheme(meta, { baseDir, themePath });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (!errors.length) return;
  for (const d of errors) console.error(`✖ ${d.code} — ${d.message}`);
  console.error(
    '  The kit was requested explicitly (--kit, or the frontmatter "kit:"): nothing was produced.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/**
 * Checking the output path BEFORE compiling (rule 1): the extension must match
 * the format actually written, and the path must not be a directory (the write
 * otherwise failed with a bare EISDIR, halfway through rendering).
 */
function checkOutput(output, html) {
  const ext = path.extname(output).toLowerCase();
  const ok = html ? ext === '.html' || ext === '.htm' : ext === '.pptx';
  if (!ok)
    fail(
      html
        ? `output "${output}": an HTML output must have the .html extension.`
        : `output "${output}": a PowerPoint output must have the .pptx extension (or compile to HTML with --html).`,
    );
  let st = null;
  try {
    st = fs.statSync(output);
  } catch {
    /* absent: this is the common case */
  }
  if (st && !st.isFile()) fail(`output "${output}": this path exists and is not a file.`);
}

/** The extension of an output, checked BEFORE the first byte is written
 *  (rule 1): a file delivered under a name that nothing knows how to open is
 *  the fault these upfront checks remove. */
function checkOutputExt(output, ext, what) {
  if (path.extname(output).toLowerCase() !== ext)
    fail(`output "${output}": ${what} must have the ${ext} extension.`);
}

/** The parent directories of an output are created — `-o dist/v2/deck.html`
 *  failed with ENOENT after compiling everything. */
const prepareOutputDir = (output) =>
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });

/** A deck's diagnostics, printed in the shape `validate` uses. */
const printDiagnostic = (input, d) => {
  const hint =
    d.suggestion && d.code !== 'LAYOUT_SUGGESTION' ? ` (did you mean "${d.suggestion}"?)` : '';
  // a RENDER diagnostic attaches to no line of the source: the file name alone
  // is better than "deck.md:undefined"
  const where = d.line == null ? input : `${input}:${d.line}`;
  console.error(
    `${where} ${SEVERITY_ICON[d.severity]} ${d.severity} ${d.code}\n  ${d.message}${hint}`,
  );
};

async function cmdBuild(argv) {
  const args = parseArgs(argv, FLAG_SPECS.build);
  // compatibility: the old `--ir` — the flag is REMOVED from argv, inspect's
  // spec no longer knows it (see FLAG_SPECS.inspect)
  if (args.ir) return cmdInspect(argv.filter((a) => a !== '--ir' && a !== '-ir'));
  const input = requireInput(args);
  let output = args.o ?? args.output ?? null;
  const html = Boolean(args.html) || /\.html?$/i.test(output ?? '');
  output ??= input.replace(/\.md$/i, '') + (html ? '.html' : '.pptx');
  checkOutput(output, html);

  const baseDir = baseDirOf(input);
  const themePath = themePathOf(args);
  const source = readSource(input);
  const deck = parseDeck(source);
  requireKit(deck.meta, { baseDir, themePath });

  // theme + the deck's layouts/*.json — before buildScenes (themed geometry)
  const prep = prepareDeckContext(deck.meta, { baseDir, themePath });
  const scenes = buildScenes(deck);

  // ERROR diagnostics: compiling in spite of them produced a wrong deck without
  // saying anything. `--force` is still the escape hatch — a showable draft is
  // sometimes worth more than a refusal — but it is explicit and noisy.
  const diagnostics = validateDeck(source, { baseDir, themePath, deck, scenes });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    for (const d of errors) printDiagnostic(input, d);
    if (!args.force) {
      console.error(
        `\n${errors.length} error${errors.length > 1 ? 's' : ''} — nothing was written. Fix them, or compile anyway with --force.`,
      );
      process.exit(1);
    }
    console.error(
      `\n${errors.length} error${errors.length > 1 ? 's' : ''} — compilation forced (--force): the output may be incomplete.`,
    );
  }

  // EMPTY deck: `validate` already sees it (EMPTY_DECK) but as a warning, and
  // build therefore delivered a 47 kB .pptx without a single slide, announced
  // by a ✓ and exit code 0 — the one place in the journey where the success
  // line lies. The refusal is pronounced HERE, before the first byte is written
  // (rule 1); --force is still the escape hatch, and the final line then
  // becomes a ⚠.
  const empty = diagnostics.find((d) => d.code === 'EMPTY_DECK');
  if (empty) {
    printDiagnostic(input, empty);
    if (!args.force) {
      console.error(
        '\n0 slides — nothing was written. Check the input file, or compile anyway with --force.',
      );
      process.exit(1);
    }
  }

  if (args.verbose) {
    scenes.forEach((s, k) =>
      console.error(
        `  slide ${k + 1}  [${s.layout}${s.animSteps ? ` · ${s.animSteps} steps` : ''}]  ${s.title ?? '(untitled)'}`,
      ),
    );
  }

  // --vendor-assets takes precedence over the frontmatter `assets:` (as --kit
  // does over kit:)
  const vendor = args['vendor-assets'] ? true : undefined;

  prepareOutputDir(output);
  let stats;
  if (html) {
    const { renderDeckHtml } = await import('./html/render.mjs');
    const out = await renderDeckHtml(scenes, deck.meta, baseDir, { vendor });
    fs.writeFileSync(output, out.html);
    stats = out.stats;
  } else {
    const { renderDeck } = await import('./pptx/render.mjs');
    stats = await renderDeck(scenes, deck.meta, baseDir, output, { vendor });
  }
  stats.warnings = [...prep.diagnostics.map((d) => d.message), ...(stats.warnings ?? [])];

  // RENDER diagnostics: produced during the write, hence outside validateDeck's
  // upfront net. They only reached this point folded into `stats.warnings` — a
  // RASTER_UNAVAILABLE of severity `error` printed as a ⚠ under a green ✓, at
  // exit code 0, for a .pptx whose charts had become text: exactly the lie that
  // the refusal of the empty deck, a few lines above, has just forbidden.
  //
  // The output is NOT deleted, unlike the empty deck: the fallback is
  // deliberate (a readable slide is better than a hole) and the cause is the
  // installation, not the deck — destroying the file would deprive the author
  // whose platform has no @resvg/resvg-js of any export at all. But a truncated
  // deliverable does not announce itself as a full success: ⚠ instead of ✓, the
  // diagnostic printed as the error it is, and exit code 1 — with --force as
  // the escape hatch, as for the two previous refusals.
  const renderErrors = (stats.diagnostics ?? []).filter((d) => d.severity === 'error');

  console.log(
    stats.slideCount === 0
      ? `⚠ ${output} — 0 slides. ${empty?.message ?? 'No slides: neither a frontmatter `title:`, nor a `# heading` in the body.'}`
      : renderErrors.length
        ? `⚠ ${output} — ${stats.slideCount} slides, INCOMPLETE rendering (see below)`
        : `✓ ${output} — ${stats.slideCount} slides`,
  );
  if (stats.fontsEmbedded)
    console.log(
      html
        ? `  font "${FONTS.body}" inlined (${stats.fontsEmbedded} woff2 variant${stats.fontsEmbedded > 1 ? 's' : ''})`
        : `  font "${FONTS.body}" embedded (${stats.fontsEmbedded} variant${stats.fontsEmbedded > 1 ? 's' : ''})`,
    );
  if (stats.animatedSlides)
    console.log(
      html
        ? `  ${stats.animatedSlides} animated slide${stats.animatedSlides > 1 ? 's' : ''} — click the slide to reveal the steps`
        : `  ${stats.animatedSlides} animated slide${stats.animatedSlides > 1 ? 's' : ''} — appear on click (native PowerPoint animations)`,
    );
  if (stats.morphSlides)
    console.log(
      `  ${stats.morphSlides} "(cont.)" slide${stats.morphSlides > 1 ? 's' : ''} in Morph transition (fade fallback before PowerPoint 2019)`,
    );
  if (stats.mermaidTotal && stats.mermaidRendered < stats.mermaidTotal) {
    const missing = stats.mermaidTotal - stats.mermaidRendered;
    console.log(
      `  ${missing} Mermaid diagram${missing > 1 ? 's' : ''} rendered as a text fallback — run \`lutrin setup-mermaid\` to diagnose`,
    );
  }
  if (stats.remoteTotal) {
    const dest = stats.remoteVendored ? 'assets/remote/ (self-contained deck)' : 'the user cache';
    console.log(
      `  ${stats.remoteFetched}/${stats.remoteTotal} remote images downloaded into ${dest}`,
    );
    if (stats.remoteFetched < stats.remoteTotal)
      console.log(
        '  → the images that were not downloaded keep a placeholder (check the URL or the connection)',
      );
  }
  if (stats.iconsTotal && stats.iconsRendered < stats.iconsTotal) {
    const missing = stats.iconsTotal - stats.iconsRendered;
    console.log(
      `  ${missing} icon${missing > 1 ? 's' : ''} not found — check the name on lucide.dev`,
    );
  }
  if (stats.mathTotal && stats.mathRendered < stats.mathTotal) {
    const missing = stats.mathTotal - stats.mathRendered;
    console.log(
      `  ${missing} equation${missing > 1 ? 's' : ''} rendered as a text fallback (invalid LaTeX, or install mathjax-full)`,
    );
  }
  // error diagnostics ALSO travel in `warnings` (the only channel historically
  // printed): remove them here so they are not said twice, once under the right
  // icon and once under the wrong one
  const saidAsError = new Set(renderErrors.map((d) => d.message));
  for (const w of stats.warnings ?? []) if (!saidAsError.has(w)) console.log(`  ⚠ ${w}`);

  if (renderErrors.length) {
    for (const d of renderErrors) printDiagnostic(input, d);
    if (!args.force) {
      console.error(
        `\n${renderErrors.length} render error${renderErrors.length > 1 ? 's' : ''} — ${output} was written, but truncated. Fix them, or accept the output as it is with --force.`,
      );
      process.exit(1);
    }
    console.error(
      `\n${renderErrors.length} render error${renderErrors.length > 1 ? 's' : ''} — accepted (--force).`,
    );
  }
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

function cmdValidate(argv) {
  const args = parseArgs(argv, FLAG_SPECS.validate);
  const input = requireInput(args);
  const diagnostics = validateDeck(readSource(input), {
    baseDir: baseDirOf(input),
    themePath: themePathOf(args),
  });
  const errors = diagnostics.filter((d) => d.severity === 'error').length;

  if (args.json) {
    console.log(JSON.stringify({ valid: errors === 0, diagnostics }, null, 2));
  } else if (!diagnostics.length) {
    console.log(`✓ ${input} — no diagnostics`);
  } else {
    for (const d of diagnostics) {
      // LAYOUT_SUGGESTION: the suggestion is a recommendation already stated in
      // the message, not the correction of a typo
      const hint =
        d.suggestion && d.code !== 'LAYOUT_SUGGESTION' ? ` (did you mean "${d.suggestion}"?)` : '';
      console.log(
        `${input}:${d.line} ${SEVERITY_ICON[d.severity]} ${d.severity} ${d.code}\n  ${d.message}${hint}`,
      );
    }
    const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
    console.log(
      `\n${errors} error${errors !== 1 ? 's' : ''}, ${warnings} warning${warnings !== 1 ? 's' : ''}`,
    );
  }
  process.exit(errors ? 1 : 0);
}

// ---------------------------------------------------------------------------
// inspect (formerly --ir)
// ---------------------------------------------------------------------------

function cmdInspect(argv) {
  const args = parseArgs(argv, FLAG_SPECS.inspect);
  const input = requireInput(args);
  const baseDir = baseDirOf(input);
  const themePath = themePathOf(args);
  const deck = parseDeck(readSource(input));
  // the reference JSON describes the geometry actually produced: publishing it
  // under the generic theme when a kit was requested would make it wrong
  requireKit(deck.meta, { baseDir, themePath });
  // same preparation as build: the reference JSON shows the geometry actually
  // produced, theme and user layouts included
  prepareDeckContext(deck.meta, { baseDir, themePath });
  const scenes = buildScenes(deck);
  const json = JSON.stringify({ meta: deck.meta, slides: deck.slides, scenes }, null, 2);

  // `-o` was declared, consumed by the parser… and never read: the 116 kB of
  // JSON went to stdout, no file was written, and the CI that then read
  // that file only failed at the next step (rule 2).
  const out = args.o ?? args.output ?? null;
  if (out === null) {
    console.log(json);
    return;
  }
  checkOutputExt(out, '.json', 'an inspection output'); // before writing (rule 1)
  prepareOutputDir(out);
  fs.writeFileSync(out, json);
  console.log(`✓ ${out} — ${scenes.length} slides`);
}

// ---------------------------------------------------------------------------
// preview — local server + recompile on change + SSE reload
// ---------------------------------------------------------------------------

const SSE_CLIENT = `<script>new EventSource('/__events').onmessage = () => location.reload();</script>`;

/**
 * Hosts admitted by the preview server.
 *
 * Listening on 127.0.0.1 is NOT enough: a third-party site can have its own
 * domain resolve to the local loopback (DNS rebinding) and have the preview —
 * hence the content of the deck being written — read by the victim's browser.
 * The countermeasure is to refuse any request whose `Host` header is not a local
 * name: a browser ALWAYS sends the name it resolved.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The host name of a `Host` header (port removed, IPv6 brackets kept). */
function hostnameOf(header) {
  if (typeof header !== 'string' || !header) return null;
  if (header.startsWith('[')) return header.slice(0, header.indexOf(']') + 1) || null;
  const colon = header.indexOf(':');
  return (colon === -1 ? header : header.slice(0, colon)).toLowerCase();
}

/**
 * Listens on the first free port starting from `port`.
 *
 * A busy port surfaced as an uncaught EADDRINUSE — a stack trace for a
 * perfectly ordinary case (two previews open). We announce and we switch; the
 * caller learns the port ACTUALLY listened on.
 */
function listenFromPort(server, port, attempts = 20) {
  return new Promise((resolve, reject) => {
    let current = port;
    let remaining = attempts;
    const onError = (e) => {
      if (e?.code !== 'EADDRINUSE' || remaining-- <= 0) {
        server.off('error', onError);
        reject(e);
        return;
      }
      console.log(`⚠ port ${current} busy — switching to ${current + 1}`);
      current += 1;
      server.listen(current, '127.0.0.1');
    };
    server.on('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(current);
    });
    server.listen(current, '127.0.0.1');
  });
}

async function cmdPreview(argv) {
  const args = parseArgs(argv, FLAG_SPECS.preview);
  const input = requireInput(args);
  const requested = args.port ?? '4321';
  if (!/^\d+$/.test(String(requested)) || Number(requested) < 1 || Number(requested) > 65535)
    fail(`--port expects an integer between 1 and 65535 — got "${requested}".`);
  const port = Number(requested);
  const absInput = path.resolve(input);
  const baseDir = baseDirOf(input);
  const themePath = themePathOf(args);
  requireKit(parseDeck(readSource(absInput)).meta, { baseDir, themePath });
  const { compileHtml } = await import('./html/render.mjs');

  let html = '<!doctype html><p>compiling…</p>';
  let watchedThemeDir = null; // theme directory OUTSIDE baseDir, watched separately
  let themeWatcher = null;
  async function recompile() {
    const t = Date.now();
    const source = readSource(absInput);
    const { html: doc, stats, themeFile } = await compileHtml(source, { baseDir, themePath });
    // inject before the LAST </body>: the document's inline scripts may contain
    // that literal (the first one found is not necessarily the right one)
    const at = doc.lastIndexOf('</body>');
    html = at === -1 ? doc + SSE_CLIENT : doc.slice(0, at) + SSE_CLIENT + doc.slice(at);
    watchTheme(themeFile);
    const diagnostics = validateDeck(source, { baseDir, themePath });
    console.log(`↻ ${stats.slideCount} slides in ${Date.now() - t} ms`);
    for (const d of diagnostics)
      console.log(`  ${input}:${d.line} ${SEVERITY_ICON[d.severity]} ${d.code} — ${d.message}`);
  }

  // a theme outside the deck's directory (--theme ../elsewhere.json, or a
  // frontmatter reference going up) escapes the main fs.watch: watch ITS
  // directory too (the directory, not the file — editors replace the file when
  // saving it), and follow path changes between recompilations
  function watchTheme(themeFile) {
    const dir = themeFile ? path.dirname(themeFile) : null;
    const outside = dir && dir !== baseDir && !dir.startsWith(baseDir + path.sep);
    const target = outside ? dir : null;
    if (target === watchedThemeDir) return;
    themeWatcher?.close();
    themeWatcher = null;
    watchedThemeDir = target;
    if (target) themeWatcher = fs.watch(target, (_event, name) => onFsEvent(name));
  }
  await recompile();

  const clients = new Set();
  const server = http.createServer((req, res) => {
    // `no-store` everywhere: the deck is recompiled on every keystroke, a page
    // kept in cache would show an already-wrong state on reload
    const hostname = hostnameOf(req.headers.host);
    if (!hostname || !LOCAL_HOSTS.has(hostname)) {
      res.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        `403 — Host header "${req.headers.host ?? '(absent)'}" refused: this preview only answers to localhost / 127.0.0.1.\n`,
      );
      return;
    }
    if (req.url === '/__events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(':ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  // Watches the file's directory (editors often replace the file instead of
  // writing it in place), ignoring the outputs and, for a deck that vendors its
  // images, what the compilation itself writes (assets/remote/). The same
  // debounce serves the theme watcher (watchTheme).
  let timer = null;
  const IGNORE = /(^|\/)assets\/remote\/|\.(html|pptx)$/;
  function onFsEvent(name) {
    if (!name || IGNORE.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await recompile();
        for (const c of clients) c.write('data: reload\n\n');
      } catch (e) {
        console.error(`✖ ${e.message}`);
      }
    }, 150);
  }
  fs.watch(baseDir, { recursive: true }, (_event, name) => onFsEvent(name));

  const listening = await listenFromPort(server, port);
  console.log(`Preview: http://localhost:${listening}  (Ctrl-C to quit)`);
}

// ---------------------------------------------------------------------------
// config — default kit and installed kits at the user level
// ---------------------------------------------------------------------------

function cmdConfig(argv) {
  const args = parseArgs(argv, FLAG_SPECS.config);
  const root = userConfigRoot();
  const configFile = path.join(root, 'config.json');
  const rootSource = process.env.LUTRIN_CONFIG
    ? 'LUTRIN_CONFIG'
    : process.env.XDG_CONFIG_HOME
      ? 'XDG_CONFIG_HOME'
      : 'default';

  // a config written before kits still carries themes/: migrate it here, where
  // the user sees the result, rather than letting them discover an empty
  // directory
  const moved = migrateUserConfig();
  // announce EVERY move: the root move (mtl-deck → lutrin) and the themes/ →
  // kits/ rename can happen in the same run, and showing only the last one
  // would suggest the old directory is still there
  for (const m of moved.moves ?? []) console.log(`✓ configuration migrated: ${m.from} → ${m.to}`);
  if (moved.moves?.length) console.log();

  // ------ write -------------------------------------------------------------
  if (args.unset) {
    const file = setUserKit(null);
    console.log(`✓ user default kit removed — ${file}`);
    return;
  }
  const posed =
    typeof args.kit === 'string' && args.kit.trim()
      ? args.kit.trim()
      : typeof args.theme === 'string' && args.theme.trim()
        ? args.theme.trim()
        : null;
  if (posed) {
    const file = setUserKit(posed);
    console.log(`✓ user default kit: ${posed}\n  written to ${file}`);
    if (posed === 'none') {
      console.log('  → "none" forces the generic theme in every project with no kit of its own.');
      return;
    }
    // check that the reference resolves from the config directory (it may also
    // be installed later: we warn without blocking)
    const { theme, layoutsDir, diagnostics } = resolveTheme({ kit: posed }, { baseDir: root });
    for (const d of diagnostics) console.log(`  ${SEVERITY_ICON[d.severity] ?? '•'} ${d.message}`);
    if ((theme || layoutsDir) && !diagnostics.some((d) => d.severity === 'error'))
      console.log(`  → kit resolved${theme?.name ? ` ("${theme.name}")` : ''}.`);
    return;
  }

  // ------ read --------------------------------------------------------------
  const { ref, error } = readUserKit();
  const kits = listInstalledKits();
  console.log('Lutrin configuration');
  console.log(`  Directory     : ${root}  [${rootSource}]`);
  console.log(`  Config file   : ${configFile}${fs.existsSync(configFile) ? '' : '  (absent)'}`);
  console.log(
    `  Default kit   : ${error ? `⚠ ${error.message}` : (ref ?? '(none — the host or generic default applies)')}`,
  );
  console.log(`  Installed kits: ${userKitsDir()}${kits.length ? '' : '  (none)'}`);
  for (const k of kits) {
    const version = k.manifest?.version ? ` v${k.manifest.version}` : '';
    console.log(
      `    - ${k.name.padEnd(24)}${k.error ? `⚠ ${k.error}` : `${version.padEnd(10)}${k.path}`}`,
    );
  }
  console.log('\nSet    : lutrin config --kit <installed-name | file.json | directory | none>');
  console.log('Remove : lutrin config --unset');
  console.log(
    'Precedence: --kit > frontmatter "kit:" > project default (package.json) > THIS user default > host default.',
  );
}

// ---------------------------------------------------------------------------
// kit — install, list, remove, pack
// ---------------------------------------------------------------------------

const KIT_ACTIONS = ['install', 'list', 'remove', 'create'];

async function cmdKit(argv) {
  const args = parseArgs(argv, FLAG_SPECS.kit);
  const [action, target] = args._;
  if (!KIT_ACTIONS.includes(action)) {
    console.error(`Usage:
  lutrin kit install <file.deckkit|https://…> [--force] [--name <name>]
  lutrin kit list
  lutrin kit remove <name>
  lutrin kit create <directory> [-o <file.deckkit>]`);
    process.exit(1);
  }

  // ------ list --------------------------------------------------------------
  if (action === 'list') {
    const kits = listInstalledKits();
    if (!kits.length) {
      console.log(`No kit installed in ${userKitsDir()}.`);
      console.log('Install: lutrin kit install <file.deckkit | https://…>');
      return;
    }
    console.log(`Installed kits (${userKitsDir()}):`);
    for (const k of kits) {
      if (k.error) {
        console.log(`  ⚠ ${k.name.padEnd(24)} ${k.error}`);
        continue;
      }
      const v = k.manifest.version ? `v${k.manifest.version}` : '';
      console.log(`  • ${k.name.padEnd(24)} ${v.padEnd(10)} ${k.manifest.description ?? ''}`);
    }
    return;
  }

  // ------ remove ------------------------------------------------------------
  if (action === 'remove') {
    if (!target) {
      console.error('Usage: lutrin kit remove <name>');
      process.exit(1);
    }
    const kits = listInstalledKits();
    const found = kits.find((k) => k.name === target);
    if (!found) {
      console.error(`✖ kit "${target}" is not installed.`);
      if (kits.length) console.error(`  Installed: ${kits.map((k) => k.name).join(', ')}`);
      process.exit(1);
    }
    fs.rmSync(found.path, { recursive: true, force: true });
    console.log(`✓ kit "${target}" removed — ${found.path}`);
    // a user default pointing at the removed kit would become a warning on
    // every compilation: say it HERE, where the user can act
    if (readUserKit().ref === target)
      console.log(
        `  ⚠ it was still the user default kit — change it with "lutrin config --kit <name>" or "--unset".`,
      );
    return;
  }

  // ------ create ------------------------------------------------------------
  if (action === 'create') {
    if (!target) {
      console.error('Usage: lutrin kit create <directory> [-o <file.deckkit>]');
      process.exit(1);
    }
    // extension checked BEFORE packing (rule 1): an archive written under
    // another name does not install — better not to produce it at all
    const requested = args.o ?? args.output ?? null;
    if (requested !== null) checkOutputExt(requested, '.deckkit', 'a kit archive');
    const { buffer, manifest, entries, skipped } = await packKit(target);
    const out = requested ?? `${manifest.name}.deckkit`;
    prepareOutputDir(out);
    fs.writeFileSync(out, buffer);
    console.log(
      `✓ ${out} — kit "${manifest.name}"${manifest.version ? ` v${manifest.version}` : ''}, ${entries.length} file${entries.length > 1 ? 's' : ''}, ${(buffer.length / 1024).toFixed(1)} kB`,
    );
    console.log(`  sha256: ${sha256(buffer)}`);
    // never silence what was skipped: a logo missing from the kit would
    // otherwise be discovered on a user's first compilation
    for (const s of skipped) console.log(`  ⚠ skipped: ${s}`);
    return;
  }

  // ------ install -----------------------------------------------------------
  if (!target) {
    console.error('Usage: lutrin kit install <file.deckkit|https://…>');
    process.exit(1);
  }
  const remote = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
  let buf;
  if (remote) {
    // announce AFTER validating the protocol: "downloading http://…" followed
    // by a refusal would suggest a request had gone out
    if (!/^https:\/\//i.test(target)) {
      console.error(
        `✖ install — Protocol refused: ${target.split('://')[0]}:// — only https is accepted to install a kit.`,
      );
      process.exit(1);
    }
    console.log(`downloading ${target}…`);
    buf = await fetchKitArchive(target);
  } else {
    if (!fs.existsSync(target)) {
      console.error(`✖ file not found: ${target}`);
      process.exit(1);
    }
    buf = fs.readFileSync(target);
  }

  const archive = await readKitArchive(buf);
  if (typeof args.name === 'string' && args.name.trim()) {
    // rename AT INSTALL TIME: two variants of the same kit can coexist. The
    // name goes through the SAME validation as the manifest's own.
    const renamed = parseKitManifest(
      { ...archive.manifest, name: args.name.trim() },
      { where: '--name' },
    );
    if (!renamed.manifest) {
      console.error(
        `✖ --name: ${renamed.diagnostics.find((d) => d.severity === 'error')?.message}`,
      );
      process.exit(1);
    }
    archive.manifest = renamed.manifest;
  }

  for (const d of archive.diagnostics)
    console.log(`  ${SEVERITY_ICON[d.severity] ?? '•'} ${d.message}`);
  const { dir, replaced } = installKitArchive(archive, userKitsDir(), {
    force: Boolean(args.force),
  });
  const m = archive.manifest;
  console.log(
    `✓ kit "${m.name}"${m.version ? ` v${m.version}` : ''} ${replaced ? 'replaced' : 'installed'} — ${dir}`,
  );
  console.log(`  sha256: ${archive.digest}`);

  // check what has just been written: if the kit is not readable by the
  // resolver, say it now rather than on the first compilation
  const check = readKit(dir);
  for (const d of check.diagnostics)
    console.log(`  ${SEVERITY_ICON[d.severity] ?? '•'} ${d.message}`);
  if (!check.manifest) process.exit(1);
  console.log(`  use: lutrin build <deck.md> --kit ${m.name}   or   lutrin config --kit ${m.name}`);
}

// ---------------------------------------------------------------------------
// vendor
// ---------------------------------------------------------------------------

async function cmdVendor(argv) {
  const args = parseArgs(argv, FLAG_SPECS.vendor);
  const input = requireInput(args);
  const themePath = themePathOf(args);
  // the safety net BEFORE vendorDeck: vendoring without the requested kit would
  // write a directory announced as "self-contained" and stripped of the
  // intended brand — the worst of all results, since it would only be
  // discovered at the recipient's end
  requireKit(parseDeck(readSource(input)).meta, { baseDir: baseDirOf(input), themePath });
  const { vendorDeck } = await import('./vendor.mjs');
  const r = await vendorDeck(input, { themePath });

  const reportLine = (done, total, what, where) =>
    console.log(`${done === total ? '✓' : '⚠'} ${done}/${total} ${what} → ${where}`);

  if (r.images.total) reportLine(r.images.done, r.images.total, 'remote images', 'assets/remote/');
  if (r.mermaid.total)
    reportLine(r.mermaid.done, r.mermaid.total, 'Mermaid diagrams', 'assets/mermaid/');
  if (r.kit?.alreadyVendored) console.log(`✓ kit "${r.kit.name}" already vendored`);
  else if (r.kit) console.log(`✓ kit "${r.kit.name}" (${r.kit.files} files) → assets/kit/`);

  // The warnings go out BEFORE any verdict, and notably before the early
  // return: the two cases that refuse a kit (place already taken by a foreign
  // directory, bare theme file outside the deck's directory) are exactly the
  // ones that leave `r.kit` at null. Returning early printed "Nothing to vendor:
  // … no kit" to an author who had just asked for one — and sent them away
  // with a directory they believed was self-contained.
  for (const w of r.warnings) console.log(`⚠ ${w}`);

  if (!r.images.total && !r.mermaid.total && !r.kit) {
    console.log(
      r.warnings.length
        ? '\nNothing was vendored: see above. The directory is NOT self-contained.'
        : 'Nothing to vendor: this deck has no remote image, no diagram and no kit.',
    );
    return;
  }
  for (const f of r.frontmatter) console.log(`  frontmatter: ${f}`);
  if (r.mermaid.done < r.mermaid.total)
    console.log('  → diagrams not rendered: run `lutrin setup-mermaid`, then re-run vendor');
  if (r.images.done < r.images.total)
    console.log('  → images not downloaded: check the URL or the connection, then re-run vendor');
  // self-containment is announced ONLY if nothing was left aside: until now the
  // promise followed the warning that contradicted it
  console.log(
    r.warnings.length
      ? '\nINCOMPLETE directory: see the warnings above — it will not compile identically offline.'
      : '\nThe directory is self-contained: it compiles offline, with no kit installed.',
  );
}

// ---------------------------------------------------------------------------
// setup-mermaid
// ---------------------------------------------------------------------------

/**
 * Reports on the Mermaid rendering chain and, if nothing can drive it, offers
 * to download a browser.
 *
 * The command exists because the failure it fixes is invisible: a diagram that
 * cannot be rendered degrades to a readable code block, which is the right
 * behaviour and looks, to the author, exactly like a compiler that does not do
 * diagrams. This says out loud what is installed and what is missing.
 *
 * The download stays opt-in — `--yes` or an answered prompt. Nothing here runs
 * during a build.
 */
async function cmdSetupMermaid(argv) {
  const args = parseArgs(argv, FLAG_SPECS['setup-mermaid']);
  const { findBrowser, downloadHeadlessShell, browserCacheDir } = await import(
    './deck/browser.mjs'
  );
  const { findMmdc, renderMermaidCached } = await import('./deck/assets.mjs');

  const mmdc = findMmdc();
  let browser = findBrowser({ refresh: true });

  console.log('Mermaid rendering:');
  console.log(`  browser: ${browser ? `${browser.path} (${browser.source})` : 'none found'}`);
  console.log(`  mermaid-cli: ${mmdc ?? 'not installed (optional — the browser is enough)'}`);

  if (!browser) {
    if (!args.yes) {
      console.log(
        [
          '',
          'No Chrome, Edge, Brave or Chromium was found, and Mermaid needs a browser',
          'to measure the text it lays out.',
          '',
          'Installing any of those is the lightest fix. Otherwise lutrin can download',
          `chrome-headless-shell (~200 MB) into ${browserCacheDir()}.`,
          '',
          'Re-run with --yes to download it.',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\nDownloading chrome-headless-shell into ${browserCacheDir()} …`);
    const exe = await downloadHeadlessShell((line) => console.log(line));
    console.log(`✓ browser installed: ${exe}`);
    browser = findBrowser({ refresh: true });
  }

  // A found browser is not a working one — an install can be broken, a
  // container can lack the shared libraries Chrome links against. Render a
  // diagram and say so, rather than promising on the strength of a file
  // existing.
  process.stdout.write('\nRendering a test diagram … ');
  const out = renderMermaidCached('flowchart LR\n  A[Lutrin] --> B[Mermaid]', { format: 'svg' });
  if (out) {
    console.log('✓');
    console.log('\nMermaid diagrams will render. Nothing else to install.');
    return;
  }
  const { lastMermaidError } = await import('./deck/assets.mjs');
  console.log('✖');
  console.log(`\nThe browser was found but could not render: ${lastMermaidError() ?? 'unknown'}`);
  console.log('Set LUTRIN_BROWSER to another browser, or re-run with --yes to download one.');
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

/**
 * The engine's catalog — the source of truth that the documentation translates
 * and that agents query before writing a deck.
 *
 * With no argument, it describes the BARE engine: built-in layouts and the
 * official catalog. That was its only form, and it was a lie by omission as
 * soon as a brand came into play — `capabilities()` was called WITHOUT a
 * context, so `userLayouts` stayed empty while validation, for its part, knew
 * the kit's layouts perfectly: the same directory refused
 * `<!-- layout: my-four -->` with an UNKNOWN_LAYOUT naming `my-four` that
 * `capabilities` had never listed. An agent working in a branded project
 * therefore NEVER saw that brand's layouts.
 *
 * With a deck and/or `--kit`, we take exactly the path of `validate` and
 * `inspect`: explicit kit required (rule 2), then `prepareDeckContext` — after
 * which the registry holds the kit's layouts and the deck's `layouts/*.json`,
 * and `capabilities()` publishes them.
 */
function cmdCapabilities(argv) {
  // `--json` is the EXPLICIT form of the default (the output has always been
  // JSON): accepted, with no effect — but any other flag is refused
  const args = parseArgs(argv, FLAG_SPECS.capabilities);
  if (args._.length > 1)
    fail(`a single input file is expected — got ${args._.length}: ${args._.join(', ')}`);
  const input = args._[0] ?? null;
  if (input !== null && !fs.existsSync(input)) fail(`file not found: ${input}`);
  const themePath = themePathOf(args);

  if (input !== null || themePath !== null) {
    // the deck is read only for its frontmatter: that is what carries "kit:",
    // and ignoring it would publish the catalog of a brand OTHER than the one
    // this deck compiles under
    const meta = input === null ? {} : parseDeck(readSource(input)).meta;
    const baseDir = input === null ? process.cwd() : baseDirOf(input);
    requireKit(meta, { baseDir, themePath });
    const { diagnostics } = prepareDeckContext(meta, { baseDir, themePath });
    // an unreadable custom layout must not be erased under a catalog that does
    // not contain it (rule 2) — but on STDERR: stdout stays JSON that `| jq`
    // can work with
    for (const d of diagnostics.filter((d) => d.severity !== 'info'))
      console.error(`${SEVERITY_ICON[d.severity]} ${d.severity} ${d.code} — ${d.message}`);
  }

  console.log(JSON.stringify(capabilities(), null, 2));
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (!argv.length) usage(1);
if (argv[0] === '-h' || argv[0] === '--help') usage(0);
if (argv[0] === '--version' || argv[0] === '-v') printVersion();

// compatibility: `lutrin file.md …` (or the old cli with --html/--ir) = build.
// But a MISSPELLED subcommand must no longer slip into that fallback:
// `lutrin buidl deck.md` then accused the input file — which existed — of not
// being found, which helps nobody.
const [head, ...rest] = argv;
if (!COMMANDS.includes(head) && !head.startsWith('-') && !fs.existsSync(head)) {
  const nearest = closest(head, COMMANDS);
  if (nearest) fail(`unknown subcommand: ${head} — did you mean "${nearest}"?`);
}
const command = COMMANDS.includes(head) ? head : 'build';
const rest2 = COMMANDS.includes(head) ? rest : argv;

try {
  switch (command) {
    case 'build':
      await cmdBuild(rest2);
      break;
    case 'preview':
      await cmdPreview(rest2);
      break;
    case 'validate':
      cmdValidate(rest2);
      break;
    case 'inspect':
      cmdInspect(rest2);
      break;
    case 'config':
      cmdConfig(rest2);
      break;
    case 'kit':
      await cmdKit(rest2);
      break;
    case 'vendor':
      await cmdVendor(rest2);
      break;
    case 'capabilities':
      cmdCapabilities(rest2);
      break;
    case 'setup-mermaid':
      await cmdSetupMermaid(rest2);
      break;
    default:
      usage();
  }
} catch (e) {
  // never a raw stack trace: the COMMAND and the cause, nothing else.
  // The old net prefixed with rest2[0] — the first argument, often a perfectly
  // valid path, designated as the culprit of an error that came from
  // elsewhere.
  console.error(`✖ ${command} — ${e?.message ?? e}`.trim());
  process.exit(1);
}
