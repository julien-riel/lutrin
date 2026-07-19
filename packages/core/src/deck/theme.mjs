/**
 * JSON themes — new styles without recompiling, distributed as KITS
 * (kit.mjs for the manifest, kit/archive.mjs for `.deckkit` packaging).
 *
 * A theme is referenced in six ways, by decreasing priority:
 *   1. CLI flag `--kit` (name of an installed kit, JSON file, or directory);
 *   2. frontmatter `kit:` — name of an installed kit, JSON file next to the
 *      deck (`./my-theme.json`, resolved relative to the deck's directory) or
 *      kit directory; `kit: none` forces the default theme.
 *      `theme:` is still accepted as a DEPRECATED ALIAS (diagnostic);
 *   3. project default: the `"lutrin": { "kit": … }` field of the first
 *      package.json found while walking up from the deck's directory —
 *      the organization declares its kit once;
 *   4. USER default: the `"kit"` field of `<configRoot>/config.json`
 *      (`~/.config/lutrin`, overridable by `LUTRIN_CONFIG`) — a kit
 *      chosen once and shared across ALL of the user's projects,
 *      plugins included. Below the project default (more specific), above
 *      the host default (the brand imposed by a plugin is thereby overridden
 *      by the user's explicit choice);
 *   5. HOST default (`defaultTheme`): branded extensions (VS Code,
 *      Obsidian) ship their kit and impose it on decks that choose
 *      nothing — below everything else, so that the document always wins;
 *   6. otherwise, the default theme (generic design tokens from tokens.mjs).
 *
 * THREE FORMS of reference, and three only (see resolveThemeRef):
 *
 *   - `none` — explicit opt-out;
 *   - a BARE NAME (`brand-acme`) — kit installed in `<configRoot>/kits/`,
 *     resolved by name from any project: "install once, use everywhere",
 *     with nothing to do in each project;
 *   - a PATH — a `.json` file (bare theme, historical behaviour) or a
 *     directory carrying a `kit.json` (unpacked kit, not installed). That is
 *     how extensions designate the kit they ship.
 *
 * Resolution through node_modules has been REMOVED: a theme is no longer
 * distributed as an npm package. Do not reintroduce it — it forced an `npm i`
 * per project, a walk up the tree, a CORE_ROOT fallback for the hosts, and it
 * is the only reason two resolution paths were needed.
 *
 * A KIT (kit.mjs) carries its `kit.json` manifest: theme.json + layouts/ +
 * fonts + logos. Its theme.json follows exactly the file-theme schema —
 * fonts and logos resolved relative to it, therefore INSIDE the kit; its
 * layouts/ directory provides JSON layouts loaded on every compilation
 * (context.mjs).
 *
 * CONFINEMENT of the asset paths (`logos`, `fonts.files`) — see
 * `withinAny`: those paths designate files that will be READ and then
 * EMBEDDED in the deliverable, so a theme that chooses them chooses what
 * leaves the machine. The allowed root depends on the theme's PROVENANCE,
 * because the trust is not the same:
 *
 *   - theme from a KIT — the kit is THIRD-PARTY content, installed from an
 *     archive: it is confined to ITS directory, strictly. Without that, a
 *     `"cover": "../../../.ssh/id_rsa"` would be read and embedded in the
 *     .pptx;
 *   - FILE theme (outside a kit) — written by the deck's author, who is
 *     already master of their own project: the root is the deck's directory
 *     (more precisely the one the reference was resolved from) OR the theme's.
 *     Confining such a theme to its own directory alone would break the
 *     legitimate arrangement "kit: ./design/theme.json" pointing at
 *     "../fonts/Body.ttf", for no gain: the author can write whatever they
 *     want anyway.
 *
 * The theme overrides the tokens of tokens.mjs by IN-PLACE MUTATION:
 * ES bindings being live and every consumer reading the tokens at call time,
 * no renderer changes.
 *
 * Life cycle — the hosts (extension worker, preview) are hot processes
 * shared between decks: applyTheme() ALWAYS restarts from the snapshot of the
 * default values taken at load time, then merges the theme, then re-runs
 * deriveTokens() so that the derived groups (LAYER_SHADES, SEMANTIC,
 * TREND_INK, PAGE margins) follow the palette, then re-merges the explicit
 * overrides of those groups. applyTheme(null) therefore restores exactly the
 * default theme — never a theme leak between requests.
 *
 * Validation (resolveTheme) NEVER throws: a theme that could not be read or an
 * invalid entry becomes a diagnostic and the entry is dropped — the deck
 * always compiles, on the default theme if need be.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COLORS,
  FONTS,
  FONT_FILES,
  LOGOS,
  TYPE,
  SPACE,
  PAGE,
  ROUNDED,
  CHROME,
  CHART_COLORS,
  LAYER_SHADES,
  TREND_INK,
  SEMANTIC,
  deriveTokens,
} from './tokens.mjs';
import { closest } from './suggest.mjs';
import { readKit, KIT_MANIFEST, KIT_NAME_RE } from './kit.mjs';

// ---------------------------------------------------------------------------
// Snapshot of the default values (generic theme from tokens.mjs)
// ---------------------------------------------------------------------------

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Groups merged BEFORE deriveTokens() (base values). */
const BASE_GROUPS = {
  colors: COLORS,
  fonts: FONTS,
  type: TYPE,
  space: SPACE,
  rounded: ROUNDED,
  chrome: CHROME,
};
/** Groups merged AFTER deriveTokens() (overrides of the derived ones) — PAGE
 *  is one of them: deriveTokens() recomputes margin/gutter/footerHeight from
 *  SPACE, so an explicit theme override must be merged AFTER in order to take
 *  precedence over the recomputation (otherwise it would be silently
 *  overwritten). */
const DERIVED_GROUPS = { page: PAGE, trendInk: TREND_INK, semantic: SEMANTIC };
const ALL_LIVE = {
  ...BASE_GROUPS,
  ...DERIVED_GROUPS,
  chartColors: CHART_COLORS,
  layerShades: LAYER_SHADES,
  logos: LOGOS,
  fontFiles: FONT_FILES,
};

const BASE = clone(ALL_LIVE); // taken at load time, after the initial deriveTokens()

/** Top-level keys accepted in a theme file. */
export const THEME_KEYS = [
  'name',
  'colors',
  'fonts',
  'type',
  'space',
  'page',
  'rounded',
  'chrome',
  'chartColors',
  'layerShades',
  'trendInk',
  'semantic',
  'logos',
];

// ---------------------------------------------------------------------------
// Safe in-place merge
// ---------------------------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Deep merge of `src` into `target`, limited to the keys `target` already
 *  has (a theme can neither inject inert keys nor pollute the prototype).
 *  Arrays replace the whole array. */
function mergeInto(target, src) {
  if (!isPlainObject(src)) return;
  for (const key of Object.keys(src)) {
    if (UNSAFE_KEYS.has(key) || !Object.hasOwn(target, key)) continue;
    const val = src[key];
    if (isPlainObject(target[key]) && isPlainObject(val)) mergeInto(target[key], val);
    else if (Array.isArray(target[key]) && Array.isArray(val))
      target[key].splice(0, target[key].length, ...clone(val));
    else if (val !== undefined && !isPlainObject(val) && !Array.isArray(val)) target[key] = val;
  }
}

/** Restores a live object to be identical to its snapshot. */
function restore(live, base) {
  if (Array.isArray(live)) {
    live.splice(0, live.length, ...clone(base));
    return;
  }
  for (const k of Object.keys(live)) if (!Object.hasOwn(base, k)) delete live[k];
  for (const k of Object.keys(base)) {
    if (isPlainObject(base[k]) || Array.isArray(base[k])) {
      if (!Object.hasOwn(live, k) || typeof live[k] !== typeof base[k]) live[k] = clone(base[k]);
      else restore(live[k], base[k]);
    } else live[k] = base[k];
  }
}

/**
 * Applies a theme (an object already validated by resolveTheme), or restores
 * the default theme with `null`. Always called at the head of a compilation —
 * never once per process.
 */
export function applyTheme(theme = null) {
  for (const [key, live] of Object.entries(ALL_LIVE)) restore(live, BASE[key]);
  if (!theme) return;

  for (const [key, live] of Object.entries(BASE_GROUPS)) mergeInto(live, theme[key]);
  deriveTokens();
  for (const [key, live] of Object.entries(DERIVED_GROUPS)) mergeInto(live, theme[key]);
  if (Array.isArray(theme.chartColors) && theme.chartColors.length)
    CHART_COLORS.splice(0, CHART_COLORS.length, ...theme.chartColors);
  if (Array.isArray(theme.layerShades) && theme.layerShades.length)
    LAYER_SHADES.splice(0, LAYER_SHADES.length, ...clone(theme.layerShades));

  // paths already resolved (relative to the theme file) by resolveTheme;
  // the *Svg slots (HTML output) fall back on the bitmap, a dedicated .svg wins
  if (theme.logos?.cover) {
    LOGOS.cover = theme.logos.cover;
    LOGOS.coverSvg = theme.logos.cover;
  }
  if (theme.logos?.section) {
    LOGOS.section = theme.logos.section;
    LOGOS.sectionSvg = theme.logos.section;
  }
  if (theme.logos?.coverSvg) LOGOS.coverSvg = theme.logos.coverSvg;
  if (theme.logos?.sectionSvg) LOGOS.sectionSvg = theme.logos.sectionSvg;
  if (theme.fonts?.files) {
    // the theme defines ITS font: the variants it does not provide must not
    // fall back on the default theme's files (mixed weights)
    FONT_FILES.regular = theme.fonts.files.regular ?? null;
    FONT_FILES.bold = theme.fonts.files.bold ?? null;
    FONT_FILES.italic = theme.fonts.files.italic ?? null;
  } else if (theme.fonts?.body && theme.fonts.body !== BASE.fonts.body) {
    // family changed WITHOUT files: do not embed the default's glyphs under
    // the new name (the HTML would render the default font in disguise while
    // PowerPoint renders the real one) — no embedding at all, both outputs
    // fall back together on the installed font
    FONT_FILES.regular = FONT_FILES.bold = FONT_FILES.italic = null;
  }
}

// ---------------------------------------------------------------------------
// WCAG contrast (shared with test/contrast.test.mjs)
// ---------------------------------------------------------------------------

/** WCAG 2.x relative luminance of a 6-digit hex color (without #). */
export function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Checks, on the LIVE tokens (after applyTheme), the thresholds the brand
 * claims and that contrast.test.mjs guarantees for the default theme —
 * a user theme may violate them without any test breaking: this is where
 * the accessibility promise is kept for it too.
 */
export function themeContrastDiagnostics() {
  const diags = [];
  const check = (ratio, min, what) => {
    if (ratio < min)
      diags.push({
        severity: 'warning',
        code: 'THEME_CONTRAST',
        message: `Theme: ${what} — contrast ${ratio.toFixed(2)}:1 < ${min}:1 (the brand's WCAG threshold).`,
      });
  };
  // pairs that are everywhere in the rendering (all the deck's text depends on them)
  check(
    contrastRatio(COLORS.neutralPrimary, COLORS.ground),
    4.5,
    `main text (#${COLORS.neutralPrimary}) on the background`,
  );
  check(
    contrastRatio(COLORS.neutralSecondary, COLORS.ground),
    4.5,
    `secondary text — footers, captions (#${COLORS.neutralSecondary}) on the background`,
  );
  check(
    contrastRatio(COLORS.ground, COLORS.primary),
    3,
    `section slide title (#${COLORS.ground} on the primary background #${COLORS.primary}, large bold type)`,
  );
  for (const c of CHART_COLORS)
    check(contrastRatio(c, COLORS.ground), 3, `chart color #${c} on the background`);
  LAYER_SHADES.forEach((s, k) =>
    check(contrastRatio(s.ink, s.fill), 4.5, `ink of layer ${k + 1} (#${s.ink} on #${s.fill})`),
  );
  for (const [kind, sem] of Object.entries(SEMANTIC))
    check(
      contrastRatio(sem.text, sem.fill),
      4.5,
      `text of the :::${kind} callout (#${sem.text} on #${sem.fill})`,
    );
  for (const [kind, ink] of Object.entries(TREND_INK))
    check(
      contrastRatio(ink, COLORS.ground),
      4.5,
      `"${kind}" trend ink (#${ink}) on the background`,
    );
  return diags;
}

// ---------------------------------------------------------------------------
// Resolution + validation of a theme file
// ---------------------------------------------------------------------------

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const normHex = (v) => String(v).replace(/^#/, '').toUpperCase();

/** A true regular file — existsSync would accept a directory, which would
 *  then make the renderers crash with EISDIR in the middle of the render. */
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Is `p` INSIDE `base` (or `base` itself), lexically? */
const contains = (base, p) => {
  const r = path.relative(base, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/**
 * Confinement of an asset path (logo, font) within one of the allowed
 * roots — see the module header for the choice of those roots.
 *
 * The symbolic link is checked AFTER resolution: without that, a kit would
 * embed a `logo.png → /etc/passwd` link whose declared path is nonetheless
 * beyond reproach. BOTH sides are dereferenced, or neither — comparing a
 * realpath against a root that is not one would make every legitimate file
 * look like an escape as soon as the root crosses a symbolic link (macOS's
 * /var → /private/var, and many a HOME). Same reasoning, and same shape,
 * as `insideKit` (kit.mjs).
 */
function within(root, abs) {
  const base = path.resolve(root);
  if (!contains(base, abs)) return false;
  try {
    // the path may not exist: with no link to dereference, the lexical check
    // above is authoritative (the absence will be reported afterwards as
    // "not found", not as an escape)
    if (!contains(fs.realpathSync(base), fs.realpathSync(abs))) return false;
  } catch {
    /* does not exist */
  }
  return true;
}

const withinAny = (abs, roots) => roots.some((root) => within(root, abs));

/** The .woff2 twin of a .ttf: same path but for the extension (inlined in the HTML). */
const twin = (ttf) => ttf.replace(/\.ttf$/i, '.woff2');

// ---------------------------------------------------------------------------
// Theme references: file, npm package, project default
// ---------------------------------------------------------------------------

/** A reference that explicitly designates a PATH (never a kit name). */
const looksLikePath = (ref) =>
  path.isAbsolute(ref) || /^[.~]/.test(ref) || ref.includes('/') || ref.includes('\\');

/**
 * True if `ref` designates an INSTALLED KIT by its name rather than a path:
 * a bare name matching KIT_NAME_RE, with no separator and no path prefix.
 * `theme.json` remains a file (the dot excludes it from KIT_NAME_RE), and
 * `./brand` a path. Used by the CLI to decide whether `--kit` resolves against
 * the current directory (path) or is passed as is to resolveTheme (kit name,
 * resolved from the user config, hence independent of the cwd).
 */
export function isKitName(ref) {
  return typeof ref === 'string' && !looksLikePath(ref) && KIT_NAME_RE.test(ref);
}

// ---------------------------------------------------------------------------
// User configuration: default theme and installed themes shared across
// projects (~/.config/lutrin) — mirror of userCacheRoot() (assets.mjs).
// ---------------------------------------------------------------------------

/** User configuration root: LUTRIN_CONFIG, otherwise XDG_CONFIG_HOME/lutrin,
 *  otherwise ~/.config/lutrin. Evaluated on EVERY call (hot hosts and tests
 *  change the environment in flight). The directory may not exist: every read
 *  then fails cleanly.
 *
 *  `MTL_DECK_CONFIG` is still honoured as a fallback — the tool used to be
 *  called mtl-deck, and a script or a CI that sets it must not silently start
 *  writing elsewhere. It is read only when LUTRIN_CONFIG is absent. */
export function userConfigRoot() {
  return (
    process.env.LUTRIN_CONFIG ||
    process.env.MTL_DECK_CONFIG ||
    (process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, 'lutrin')
      : path.join(os.homedir(), '.config', 'lutrin'))
  );
}

/** Former configuration root (the tool used to be called mtl-deck) — a source
 *  for the migration, never a destination. */
function legacyConfigRoot() {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'mtl-deck')
    : path.join(os.homedir(), '.config', 'mtl-deck');
}

/** Directory of the INSTALLED KITS at user level, resolved by name from any
 *  project. */
export const userKitsDir = () => path.join(userConfigRoot(), 'kits');

/**
 * Migrates the old `themes/` configuration to `kits/`, once.
 *
 * Called by the config reads rather than by an entry point: the hosts
 * (extension worker, Obsidian plugin) have no startup to hook it into, and a
 * user moving from one version to the next must find their themes again
 * without a gesture, whichever tool they arrive through.
 *
 * Migrates ONLY if `kits/` does not exist: two directories side by side mean
 * the migration has already happened and that `themes/` is a leftover —
 * overwriting it would destroy the work done since. Never throws: a migration
 * that cannot happen (permissions, full disk) leaves the old directory intact,
 * and the absence of a kit will report itself.
 *
 * @returns {{ migrated: boolean, from: string|null, to: string|null }}
 */
export function migrateUserConfig() {
  const root = userConfigRoot();
  const moves = [];

  // 1. root: ~/.config/mtl-deck → ~/.config/lutrin (the tool was renamed).
  //    Skipped if the user drives the root through an environment variable:
  //    they designated a precise directory, it is not ours to move.
  const pinned = process.env.LUTRIN_CONFIG || process.env.MTL_DECK_CONFIG;
  const legacy = legacyConfigRoot();
  if (!pinned && isDir(legacy) && !isDir(root)) {
    try {
      fs.mkdirSync(path.dirname(root), { recursive: true });
      fs.renameSync(legacy, root);
      moves.push({ from: legacy, to: root });
    } catch {
      /* permissions, disk: the old config stays intact */
    }
  }

  // 2. themes → kits (change of vocabulary), INSIDE the current root
  const from = path.join(root, 'themes');
  const to = path.join(root, 'kits');
  if (isDir(from) && !isDir(to)) {
    try {
      fs.renameSync(from, to);
      moves.push({ from, to });
    } catch {
      /* same: the old directory stays intact */
    }
  }

  // historical shape kept (a single move = the direct fields), plus `moves`
  // for the callers that want to announce everything
  const last = moves[moves.length - 1];
  return { migrated: moves.length > 0, from: last?.from ?? null, to: last?.to ?? null, moves };
}

/** User configuration file (default theme, settings to come). */
const userConfigFile = () => path.join(userConfigRoot(), 'config.json');

/**
 * The user's default kit: the `"kit"` field of config.json — shared across
 * all projects, above the host default. NEVER throws: config absent →
 * { ref: null } (the common case); could not be read or field of the wrong
 * type → a diagnostic, and the deck compiles anyway.
 *
 * `"theme"` is still read as a fallback (configs written before kits): a user
 * who updates the tool does not lose their default. `setUserKit` rewrites the
 * key under the new name at the first modification.
 *
 * @returns {{ ref: string|null, error: {code: string, message: string}|null }}
 */
export function readUserKit() {
  migrateUserConfig();
  const file = userConfigFile();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ref: null, error: null }; // no user config: normal
  }
  let conf;
  try {
    conf = JSON.parse(raw);
  } catch (e) {
    return {
      ref: null,
      error: {
        code: 'USER_CONFIG_INVALID',
        message: `User configuration could not be read: ${file} — invalid JSON (${e?.message ?? e}). Ignored.`,
      },
    };
  }
  if (!isPlainObject(conf))
    return {
      ref: null,
      error: {
        code: 'USER_CONFIG_INVALID',
        message: `User configuration: ${file} must be a JSON object ({ "kit": … }). Ignored.`,
      },
    };
  const key = conf.kit != null ? 'kit' : 'theme'; // "theme": historical fallback
  const val = conf[key];
  if (val == null) return { ref: null, error: null }; // valid object, no default
  if (typeof val === 'string' && val.trim()) return { ref: val.trim(), error: null };
  return {
    ref: null,
    error: {
      code: 'USER_CONFIG_INVALID',
      message: `User configuration: the "${key}" field of ${file} must be a non-empty string (name of an installed kit, path, or "none"). Ignored.`,
    },
  };
}

/** A kit installed under `<kits>/<name>/`: a directory carrying kit.json.
 *  null otherwise. */
function userKitDir(name) {
  const dir = path.join(userKitsDir(), name);
  return isFile(path.join(dir, KIT_MANIFEST)) ? dir : null;
}

/**
 * Kits installed in `<kits>/` (for `config` and `kit list`). Sorted by name;
 * never throws.
 *
 * A directory whose manifest is invalid is listed all the same, with its
 * `error`: `kit list` must SHOW a broken kit — omitting it would leave the
 * user facing a directory they can see in their file browser and that the tool
 * claims does not exist. Only directories with no kit.json at all are ignored
 * (leftovers, `.DS_Store`, interrupted extraction).
 *
 * @returns {Array<{ name: string, path: string, manifest: object|null, error: string|null }>}
 */
export function listInstalledKits() {
  migrateUserConfig();
  const dir = userKitsDir();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (!isFile(path.join(p, KIT_MANIFEST))) continue;
    const { manifest, diagnostics } = readKit(p);
    const err = diagnostics.find((d) => d.severity === 'error');
    out.push({ name: e.name, path: p, manifest, error: err ? err.message : null });
  }
  return out;
}

/**
 * Writes the user's default kit into config.json (creates the directory if
 * needed, PRESERVES the other existing keys). An empty/null `ref` removes the
 * default. Returns the path of the file written.
 *
 * ALWAYS removes the old `theme` key: leaving it beside `kit` would give a
 * config with two truths of which readUserKit reads only one, and the user
 * would believe they had set a default that does not apply.
 */
export function setUserKit(ref) {
  const root = userConfigRoot();
  const file = path.join(root, 'config.json');
  let conf = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isPlainObject(parsed)) conf = parsed;
  } catch {
    // config absent or unreadable: start again from an empty object — we
    // overwrite only what was not usable anyway
  }
  delete conf.theme;
  if (typeof ref === 'string' && ref.trim()) conf.kit = ref.trim();
  else delete conf.kit;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);
  return file;
}

/**
 * PROJECT kit default: the first package.json found while walking up from
 * `baseDir` that carries { "lutrin": { "kit": … } }. Lets an organization
 * declare its kit once for all its decks. `theme` is still read as a fallback
 * (projects written before kits).
 */
function projectKitRef(baseDir) {
  let dir = path.resolve(baseDir);
  for (;;) {
    const pj = path.join(dir, 'package.json');
    if (isFile(pj)) {
      try {
        // "lutrin" is the current field; "mtl-deck" the one from before the
        // rename. Two cascading fallbacks — the project may have been written
        // before kits AND before the rename — without either of them asking
        // anything of someone whose project already works.
        const json = JSON.parse(fs.readFileSync(pj, 'utf8'));
        const conf = json?.lutrin ?? json?.['mtl-deck'];
        const t = conf?.kit ?? conf?.theme;
        if (typeof t === 'string' && t.trim()) return { ref: t.trim(), fromDir: dir, source: pj };
      } catch {
        // package.json could not be read: it declares nothing, keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolves a reference to its theme FILE and, if there is one, the layouts
 * directory that comes with it.
 *
 * Three forms, in this order:
 *   1. BARE NAME matching KIT_NAME_RE → installed kit (`<configRoot>/kits/<name>`);
 *   2. PATH to a directory carrying `kit.json` → kit not installed
 *      (unpacked, shipped by a host);
 *   3. PATH to a `.json` file → bare theme, without layouts.
 *
 * A bare name that ALSO designates a file existing relative to `fromDir`
 * keeps its file meaning: `theme: mytheme.json` has always designated the
 * neighbouring file, and an installed kit of the same name must not divert it
 * silently.
 *
 * `kitDir` is filled in only for a KIT: it is what tells resolveTheme that the
 * theme is third-party content, and gives the confinement root for its logos
 * and its fonts (module header). A file theme has a null `kitDir`.
 *
 * @returns {{ file: string|null, layoutsDir: string|null, kitDir: string|null,
 *             kitName: string|null, error: {code, message}|null }}
 */
function resolveThemeRef(ref, fromDir) {
  const none = { file: null, layoutsDir: null, kitDir: null, kitName: null, error: null };
  const asFile = path.resolve(fromDir, ref);

  // --- bare name: installed kit --------------------------------------------
  if (isKitName(ref) && !isFile(asFile)) {
    const dir = userKitDir(ref);
    if (!dir)
      return {
        ...none,
        error: {
          code: 'KIT_NOT_FOUND',
          message: `Kit not found: "${ref}" — no kit by that name in ${userKitsDir()}, and no ${asFile} file. Install it (kit install <file.deckkit | URL>), or fix the reference.`,
        },
      };
    return fromKitDir(dir, ref, none);
  }

  // --- path to a kit directory ---------------------------------------------
  if (isDir(asFile)) {
    if (!isFile(path.join(asFile, KIT_MANIFEST)))
      return {
        ...none,
        error: {
          code: 'KIT_INVALID',
          message: `Kit: ${asFile} is a directory without ${KIT_MANIFEST}.`,
        },
      };
    return fromKitDir(asFile, ref, none);
  }

  // --- path to a bare theme file (historical behaviour) --------------------
  return { ...none, file: asFile };
}

/** The part common to both ways of reaching a kit (by name, by path):
 *  read its manifest and extract from it what resolveTheme needs. */
function fromKitDir(dir, ref, none) {
  const { manifest, themeFile, layoutsDir, diagnostics } = readKit(dir);
  if (!manifest) {
    const err = diagnostics.find((d) => d.severity === 'error');
    return {
      ...none,
      error: {
        code: err?.code ?? 'KIT_INVALID',
        message: `Kit "${ref}": ${err?.message ?? 'manifest could not be read'}`,
      },
    };
  }
  // a LAYOUTS-ONLY kit is legitimate (readKit allows it): no theme file, but
  // a layoutsDir to load — the default theme stays in place
  return {
    file: themeFile,
    layoutsDir,
    kitDir: path.resolve(dir),
    kitName: manifest.name,
    error: null,
  };
}

/** The PAGE keys that are the physical frame of the slide. */
const PAGE_LOCKED = new Set(['width', 'height']);
const LOGO_EXTS = new Set(['.png', '.jpg', '.jpeg']);
const FONT_VARIANTS = ['regular', 'bold', 'italic'];

/**
 * Loads and validates the theme designated by `themePath` (CLI flag, which
 * takes precedence), `meta.kit` (frontmatter, resolved relative to baseDir),
 * the project default (nearest package.json carrying "lutrin": { "kit": … }),
 * the user default, or `defaultTheme` (host default, last resort before the
 * generic one). Each reference is the name of an installed kit, a kit
 * directory or a JSON file; `kit: none` forces the default theme (ignoring
 * project, user and host).
 *
 * @returns {{ theme: object|null, path: string|null,
 *             layoutsDir: string|null, kitName: string|null,
 *             diagnostics: Array<{severity, code, message, suggestion?}> }}
 *          `theme` is a CLEANED object (invalid entries dropped, colors
 *          normalized, paths resolved) ready for applyTheme;
 *          `layoutsDir`/`kitName` describe the resolved kit (layouts to be
 *          loaded by prepareDeckContext); the diagnostics carry no line —
 *          the caller positions them (the frontmatter's `kit:` line on the
 *          validation side).
 */
export function resolveTheme(
  meta = {},
  { baseDir = process.cwd(), themePath = null, defaultTheme = null } = {},
) {
  const diags = [];
  const push = (severity, code, message, suggestion) =>
    diags.push({ severity, code, message, ...(suggestion ? { suggestion } : {}) });
  const bare = { theme: null, path: null, layoutsDir: null, kitName: null };

  // frontmatter: `kit:` is the current key, `theme:` a deprecated alias —
  // decks written before kits must keep compiling, but their author must know
  // that the key is going to disappear
  let frontmatter = null;
  if (typeof meta?.kit === 'string' && meta.kit.trim()) {
    frontmatter = meta.kit.trim();
  } else if (typeof meta?.theme === 'string' && meta.theme.trim()) {
    frontmatter = meta.theme.trim();
    push(
      'warning',
      'KIT_DEPRECATED_KEY',
      'Frontmatter: "theme:" is deprecated — rename it to "kit:" (same value). The key will be removed in a later version.',
    );
  }

  let ref = themePath ?? frontmatter;
  let fromDir = baseDir;
  // a kit designated by the USER DEFAULT (global config.json) that does not
  // resolve must never make `validate` fail for a project that asked for
  // nothing: its resolution errors are downgraded to warnings (like
  // USER_CONFIG_INVALID). A kit chosen by the deck (frontmatter/CLI) or by the
  // project stays an error: the author opted for THIS kit, at THIS scope.
  let fromUserDefault = false;
  if (!ref) {
    const proj = projectKitRef(baseDir);
    if (proj) {
      ref = proj.ref;
      fromDir = proj.fromDir;
    } else {
      // USER default (config.json, shared across projects): below the project
      // default (more specific), ABOVE the host default — a kit chosen here
      // applies everywhere, plugins included
      const user = readUserKit();
      if (user.error) push('warning', user.error.code, user.error.message);
      if (user.ref) {
        ref = user.ref;
        fromDir = userConfigRoot(); // paths resolved from the config directory
        fromUserDefault = true;
      } else if (typeof defaultTheme === 'string' && defaultTheme.trim()) {
        ref = defaultTheme.trim(); // host default
      } else {
        return { ...bare, diagnostics: diags };
      }
    }
  }
  if (ref === 'none') return { ...bare, diagnostics: diags }; // explicit opt-out
  const sev = fromUserDefault ? 'warning' : 'error';

  // The generic fallback is PROMISED only where it actually happens: on the
  // user default downgraded to a warning, compilation carries on under the
  // default theme. On the explicit path (error), build stops and prints that
  // nothing was produced — so the diagnostic must limit itself there to the
  // finding and the remedy, on pain of contradicting itself on the next line
  // and sending the author looking for a file that does not exist. The rule
  // holds for ALL resolution failures, not only for the kit that was not
  // found: malformed JSON is the most frequent case, and it was still using
  // the lying formula.
  const withFallback = (msg) =>
    sev === 'warning' ? `${msg} The default theme will be used.` : msg;

  const { file, layoutsDir, kitDir, kitName, error } = resolveThemeRef(ref, fromDir);
  if (error) {
    push(sev, error.code, withFallback(error.message));
    return { ...bare, diagnostics: diags };
  }
  const found = { layoutsDir, kitName };

  // LAYOUTS-ONLY kit: nothing to validate on the token side, but layoutsDir
  // must come back up — the deck keeps the default theme AND receives the layouts
  if (!file) return { ...bare, ...found, diagnostics: diags };

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    push(sev, 'THEME_NOT_FOUND', withFallback(`Theme not found: ${ref} (resolved to ${file}).`));
    return { ...bare, diagnostics: diags };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    push(
      sev,
      'THEME_INVALID',
      withFallback(`Theme could not be read: ${ref} — invalid JSON (${e?.message ?? e}).`),
    );
    return { ...bare, diagnostics: diags };
  }
  if (!isPlainObject(json)) {
    push(
      sev,
      'THEME_INVALID',
      withFallback(`Theme could not be read: ${ref} — a JSON object is expected.`),
    );
    return { ...bare, diagnostics: diags };
  }

  const themeDir = path.dirname(file);
  const theme = {};

  // --- confinement of the asset paths (logos, fonts) -----------------------
  // Allowed roots according to the theme's provenance — see the header. A KIT
  // is locked into its own home; a FILE theme may draw on its directory or on
  // the one its reference was resolved from (the deck's directory for a
  // frontmatter `kit:` or a `--kit`, the project root for a project default,
  // the config directory for a user default).
  const assetRoots = kitDir ? [kitDir] : [themeDir, fromDir];
  /** True if `p` is admitted; otherwise pushes the EXACT diagnostic of its branch. */
  const confined = (p, what, rawPath) => {
    if (withinAny(p, assetRoots)) return true;
    push(
      'warning',
      'THEME_PATH_ESCAPE',
      kitDir
        ? `Theme: ${what} (${rawPath}) leaves the "${kitName}" kit (${kitDir}) — a kit may only designate the files it contains; ignored.`
        : `Theme: ${what} (${rawPath}) leaves the project — a file theme may only designate files in its own directory (${themeDir}) or in the deck's (${fromDir}); ignored.`,
    );
    return false;
  };

  const unknownKey = (key, candidates, where) =>
    push(
      'warning',
      'THEME_UNKNOWN_KEY',
      `Theme: unknown key "${key}"${where ? ` in ${where}` : ''} — ignored.`,
      closest(key, candidates) ?? undefined,
    );

  /** Cleans a theme object against the corresponding snapshot: hex colors
   *  normalized, finite numbers, unknown keys dropped. */
  function sanitize(src, base, where, { colorsOnly = false } = {}) {
    const out = {};
    for (const key of Object.keys(src)) {
      if (UNSAFE_KEYS.has(key)) continue;
      if (!Object.hasOwn(base, key)) {
        unknownKey(key, Object.keys(base), where);
        continue;
      }
      const val = src[key];
      const ref2 = base[key];
      if (isPlainObject(ref2)) {
        if (isPlainObject(val)) {
          const sub = sanitize(val, ref2, `${where}.${key}`, { colorsOnly });
          if (Object.keys(sub).length) out[key] = sub;
        } else
          push('warning', 'THEME_BAD_VALUE', `Theme: ${where}.${key} must be an object — ignored.`);
        continue;
      }
      if (typeof ref2 === 'number') {
        if (typeof val === 'number' && Number.isFinite(val) && val >= 0) out[key] = val;
        else
          push(
            'warning',
            'THEME_BAD_VALUE',
            `Theme: ${where}.${key} must be a positive number — ignored.`,
          );
        continue;
      }
      // strings: a hex color where the default is a color, text otherwise
      if (colorsOnly || HEX_RE.test(ref2)) {
        if (typeof val === 'string' && HEX_RE.test(val)) out[key] = normHex(val);
        else
          push(
            'warning',
            'THEME_BAD_VALUE',
            `Theme: ${where}.${key} must be a 6-digit hex color ("#0B735F") — ignored.`,
          );
      } else if (typeof val === 'string' && val.trim()) out[key] = val.trim();
      else
        push(
          'warning',
          'THEME_BAD_VALUE',
          `Theme: ${where}.${key} must be a non-empty string — ignored.`,
        );
    }
    return out;
  }

  for (const key of Object.keys(json)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (!THEME_KEYS.includes(key)) {
      unknownKey(key, THEME_KEYS);
    }
  }

  // object groups → sanitize; a group that is NOT an object is reported
  // (same treatment as fonts/logos — never a silent no-op)
  const OBJECT_GROUPS = [
    ['colors', { colorsOnly: true }],
    ['type', {}],
    ['space', {}],
    ['rounded', {}],
    ['chrome', {}],
    ['trendInk', { colorsOnly: true }],
    ['semantic', {}],
  ];
  for (const [key, opts] of OBJECT_GROUPS) {
    if (json[key] == null) continue;
    if (!isPlainObject(json[key])) {
      push('warning', 'THEME_BAD_VALUE', `Theme: ${key} must be an object — ignored.`);
      continue;
    }
    theme[key] = sanitize(json[key], BASE[key], key, opts);
  }

  if (json.page != null && isPlainObject(json.page)) {
    const page = { ...json.page };
    for (const locked of PAGE_LOCKED) {
      if (Object.hasOwn(page, locked)) {
        push(
          'warning',
          'THEME_BAD_VALUE',
          `Theme: page.${locked} is the physical frame of the slide (16:9 at 96 dpi) — not themable, ignored.`,
        );
        delete page[locked];
      }
    }
    theme.page = sanitize(page, BASE.page, 'page');
  } else if (json.page != null) {
    push('warning', 'THEME_BAD_VALUE', 'Theme: page must be an object — ignored.');
  }

  if (json.chartColors != null) {
    if (
      Array.isArray(json.chartColors) &&
      json.chartColors.length &&
      json.chartColors.every((c) => typeof c === 'string' && HEX_RE.test(c))
    )
      theme.chartColors = json.chartColors.map(normHex);
    else
      push(
        'warning',
        'THEME_BAD_VALUE',
        'Theme: chartColors must be a non-empty array of hex colors — ignored.',
      );
  }

  if (json.layerShades != null) {
    if (
      Array.isArray(json.layerShades) &&
      json.layerShades.length &&
      json.layerShades.every(
        (s) => isPlainObject(s) && HEX_RE.test(s.fill ?? '') && HEX_RE.test(s.ink ?? ''),
      )
    )
      theme.layerShades = json.layerShades.map((s) => ({
        fill: normHex(s.fill),
        ink: normHex(s.ink),
      }));
    else
      push(
        'warning',
        'THEME_BAD_VALUE',
        'Theme: layerShades must be a non-empty array of { fill, ink } hex colors — ignored.',
      );
  }

  if (json.fonts != null && isPlainObject(json.fonts)) {
    const { files, ...families } = json.fonts;
    theme.fonts = sanitize(families, BASE.fonts, 'fonts');
    // the families are interpolated as they are into the CSS of the generated
    // HTML document: letters/digits/spaces/.,'- only — a font name never needs
    // anything else, and nothing can be injected into it
    for (const k of Object.keys(theme.fonts)) {
      if (!/^[\p{L}\p{N} .,'-]{1,64}$/u.test(theme.fonts[k])) {
        push(
          'warning',
          'THEME_BAD_VALUE',
          `Theme: fonts.${k} contains characters not allowed in a font name — ignored.`,
        );
        delete theme.fonts[k];
      }
    }
    if (files != null) {
      if (!isPlainObject(files)) {
        push(
          'warning',
          'THEME_BAD_VALUE',
          'Theme: fonts.files must be an object { regular, bold, italic } — ignored.',
        );
      } else {
        const resolved = {};
        for (const variant of Object.keys(files)) {
          if (!FONT_VARIANTS.includes(variant)) {
            unknownKey(variant, FONT_VARIANTS, 'fonts.files');
            continue;
          }
          const rawPath = String(files[variant]);
          const p = path.resolve(themeDir, rawPath);
          if (path.extname(p).toLowerCase() !== '.ttf')
            push(
              'warning',
              'THEME_BAD_VALUE',
              `Theme: fonts.files.${variant} must be a .ttf (embedded in the .pptx; its .woff2 twin of the same name is inlined in the HTML) — ignored.`,
            );
          // confinement BEFORE any read: TWO files leave in the deliverables
          // (the .ttf in the .pptx, its .woff2 twin in the HTML). The twin
          // carries the same path but for the extension, yet it is a distinct
          // file: it may be a link that leaves where the .ttf stays
          // well-behaved. Each is therefore judged on its own.
          else if (!confined(p, `fonts.files.${variant}`, rawPath)) {
            /* reported */
          } else if (
            !confined(twin(p), `the .woff2 twin of fonts.files.${variant}`, path.basename(twin(p)))
          ) {
            /* reported */
          } else if (!isFile(p))
            push(
              'warning',
              'THEME_BAD_VALUE',
              `Theme: font fonts.files.${variant} not found (${files[variant]}) — ignored.`,
            );
          else if (!isFile(twin(p)))
            push(
              'warning',
              'THEME_BAD_VALUE',
              `Theme: the .woff2 twin of fonts.files.${variant} is missing (${path.basename(p).replace(/\.ttf$/i, '.woff2')} expected next to the .ttf) — variant ignored, to keep the HTML and the .pptx identical.`,
            );
          else resolved[variant] = p;
        }
        if (Object.keys(resolved).length) theme.fonts.files = resolved;
      }
    }
    // files WITHOUT a family name: the glyphs would be embedded/inlined under
    // the DEFAULT family — the HTML would render the theme's font disguised as
    // that family while PowerPoint rendered the real installed font (silent
    // HTML/.pptx divergence). fonts.files requires fonts.body.
    if (theme.fonts.files && !theme.fonts.body) {
      push(
        'warning',
        'THEME_BAD_VALUE',
        'Theme: fonts.files supplies fonts without fonts.body (the family name) — without it, the glyphs would be embedded under the default font and the HTML would diverge from the .pptx; fonts.files ignored.',
      );
      delete theme.fonts.files;
    }
  } else if (json.fonts != null) {
    push(
      'warning',
      'THEME_BAD_VALUE',
      'Theme: fonts must be an object { body, mono, files } — ignored.',
    );
  }

  if (json.logos != null && isPlainObject(json.logos)) {
    theme.logos = {};
    // cover/section: bitmap required (embedded as it is in the .pptx);
    // coverSvg/sectionSvg: variant for the HTML output, .svg allowed
    const LOGO_SLOTS = ['cover', 'section', 'coverSvg', 'sectionSvg'];
    for (const slot of Object.keys(json.logos)) {
      if (!LOGO_SLOTS.includes(slot)) {
        unknownKey(slot, LOGO_SLOTS, 'logos');
        continue;
      }
      const svgSlot = slot.endsWith('Svg');
      const rawPath = String(json.logos[slot]);
      const p = path.resolve(themeDir, rawPath);
      const ext = path.extname(p).toLowerCase();
      if (!(LOGO_EXTS.has(ext) || (svgSlot && ext === '.svg')))
        push(
          'warning',
          'THEME_BAD_VALUE',
          svgSlot
            ? `Theme: logos.${slot} must be an SVG, a PNG or a JPEG (inlined in the HTML) — ignored.`
            : `Theme: logos.${slot} must be a PNG or a JPEG (embedded as it is in the .pptx; SVG goes in logos.${slot}Svg) — ignored.`,
        );
      // confinement BEFORE any read: this file leaves in the deliverable
      else if (!confined(p, `logos.${slot}`, rawPath)) {
        /* reported */
      } else if (!isFile(p))
        push(
          'warning',
          'THEME_BAD_VALUE',
          `Theme: logo logos.${slot} not found (${json.logos[slot]}) — the default signature will be kept.`,
        );
      else theme.logos[slot] = p;
    }
    if (!Object.keys(theme.logos).length) delete theme.logos;
  } else if (json.logos != null) {
    push(
      'warning',
      'THEME_BAD_VALUE',
      'Theme: logos must be an object { cover, section, coverSvg, sectionSvg } — ignored.',
    );
  }

  // groups emptied by the cleaning: remove them (clean theme, exact no-op)
  for (const k of Object.keys(theme)) {
    if (isPlainObject(theme[k]) && !Object.keys(theme[k]).length) delete theme[k];
  }

  return { theme, path: file, ...found, diagnostics: diags };
}
