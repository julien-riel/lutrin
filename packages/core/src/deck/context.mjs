/**
 * Compilation context of a deck: language + theme + theme layouts + user
 * layouts.
 *
 * The SINGLE insertion point, called after parseDeck and before buildScenes
 * by every entry point of the pipeline (CLI build/inspect/preview, worker,
 * compileHtml, validateDeck): the tokens and the layout registry are module
 * state mutated in place, and hosts are warm processes shared between
 * decks — so every compilation starts again from a fresh state (user
 * layouts reset, theme re-applied from the default snapshot), then loads
 * what comes with THIS deck: the language (frontmatter `lang:`, which the
 * words the engine writes are drawn from — see i18n.mjs), the theme
 * (frontmatter `theme: ./x.json` or
 * `theme: @org/package`, CLI flag `--theme`, or the project default from
 * the nearest package.json — see theme.mjs), the `layouts/` of the resolved
 * theme package, and the deck's own `layouts/*.json`.
 * The theme travels with the document or is installed by npm into the
 * project: no re-packaging of the extensions to theme a deck.
 *
 * Never throws: any problem (theme that could not be read, invalid layout,
 * insufficient contrast) becomes a diagnostic { severity, code, message,
 * suggestion? } WITHOUT a line — the caller positions it (validateDeck: the
 * frontmatter `theme:` line; CLI/worker: stats.warnings).
 */

import {
  OFFICIAL_LAYOUT_DIAGS,
  loadThemeLayoutDefs,
  loadThemeLayouts,
  loadUserLayouts,
  resetUserLayouts,
} from './layout.mjs';
import { LANGS, setLang } from './i18n.mjs';
import { editDistance } from './suggest.mjs';
import { applyTheme, resolveTheme, themeContrastDiagnostics } from './theme.mjs';

/**
 * @param {object} meta deck frontmatter (deck.meta) — `lang` and `theme`/`kit`
 *                 are read here
 * @param {object} [opts] { baseDir, themePath, defaultTheme, kitData } —
 *                 themePath (CLI --theme) takes precedence over meta.theme;
 *                 defaultTheme (host) applies only if nothing else names a
 *                 theme.
 *                 `kitData: { theme?, layouts? }` — in-memory kit overlay (a
 *                 kit editor previewing an UNSAVED state): the kit is still
 *                 RESOLVED as usual (themePath/frontmatter/defaults), kitData
 *                 only replaces the CONTENT read from its disk. `theme` stands
 *                 in for the kit's theme.json (same validation, diagnostics
 *                 and confinement — resolveTheme's `themeData`; without any
 *                 kit resolved it applies anchored at the deck's baseDir);
 *                 `layouts` (array of layout definitions) stands in for the
 *                 kit's layouts/*.json — an EMPTY array is a kit without
 *                 layouts, absent/undefined keeps the disk behavior. A
 *                 reference that FAILS to resolve keeps its disk behavior for
 *                 BOTH halves: neither `theme` nor `layouts` applies
 *                 (replacing content cannot repair a resolution failure).
 *                 Nothing persists past this call: the next compilation
 *                 without kitData starts from the same reset and re-reads
 *                 the disk.
 * @returns {{ diagnostics: Array, theme: object|null, themeFile: string|null }}
 */
export function prepareDeckContext(
  meta = {},
  { baseDir = process.cwd(), themePath = null, defaultTheme = null, kitData = null } = {},
) {
  // The language BEFORE the theme: the callout labels are derived from it
  // (tokens.mjs, deriveTokens) and applyTheme is what re-derives them, so a
  // language set afterwards would be read by nothing. Called unconditionally —
  // a deck that names none restores English, which is what keeps a warm host
  // from lending one deck's language to the next.
  const { unknown: unknownLang } = setLang(meta.lang);
  resetUserLayouts();
  // official catalog (design/layouts/): loaded once at startup — a file that
  // could not be read would signal a broken installation, on every deck
  const diagnostics = [...OFFICIAL_LAYOUT_DIAGS];
  if (unknownLang)
    diagnostics.push({
      severity: 'warning',
      code: 'LANG_UNKNOWN',
      message: `Unknown language "${unknownLang}" — the engine's words (callout labels, "(cont.)", the generated agenda title) stay in English. Supported: ${LANGS.join(', ')}.`,
      // Distance 1, where the rest of the compiler uses `closest` (2): the
      // codes are two letters long, so ANY unknown pair is within 2 of both —
      // "de" would be answered "did you mean en?", which is not a typo
      // correction, it is a shrug. At 1 the suggestion only fires on what a
      // typo actually looks like: "eng", "fra", "ne".
      suggestion: LANGS.find((l) => editDistance(unknownLang.trim().toLowerCase(), l) <= 1),
    });
  const {
    theme,
    path: themeFile,
    layoutsDir,
    kitName,
    failed: kitFailed,
    diagnostics: themeDiags,
  } = resolveTheme(meta, { baseDir, themePath, defaultTheme, themeData: kitData?.theme ?? null });
  diagnostics.push(...themeDiags);
  applyTheme(theme);
  // kit layouts BEFORE the deck's own: a collision is reported on the deck's
  // definition, attributed to the kit
  const layoutDefs = Array.isArray(kitData?.layouts) ? kitData.layouts : null;
  if (kitData?.layouts != null && !layoutDefs)
    diagnostics.push({
      severity: 'warning',
      code: 'LAYOUT_DEF_INVALID',
      message:
        'kitData.layouts must be an array of layout definitions — ignored, the kit layouts on disk apply.',
    });
  // `!kitFailed`: the overlay replaces the CONTENT of the resolved kit, never
  // its RESOLUTION — when the reference failed (kit not found/invalid, theme
  // unreadable), the layouts half is refused exactly like the theme half was
  // (resolveTheme already dropped themeData); disk behavior loads nothing
  if (layoutDefs && !kitFailed) diagnostics.push(...loadThemeLayoutDefs(layoutDefs, kitName));
  else if (layoutsDir) diagnostics.push(...loadThemeLayouts(layoutsDir, kitName));
  diagnostics.push(...loadUserLayouts(baseDir));
  if (theme) diagnostics.push(...themeContrastDiagnostics());
  return { diagnostics, theme, themeFile };
}
