/**
 * Compilation context of a deck: theme + theme layouts + user layouts.
 *
 * The SINGLE insertion point, called after parseDeck and before buildScenes
 * by every entry point of the pipeline (CLI build/inspect/preview, worker,
 * compileHtml, validateDeck): the tokens and the layout registry are module
 * state mutated in place, and hosts are warm processes shared between
 * decks — so every compilation starts again from a fresh state (user
 * layouts reset, theme re-applied from the default snapshot), then loads
 * what comes with THIS deck: the theme (frontmatter `theme: ./x.json` or
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
  loadThemeLayouts,
  loadUserLayouts,
  resetUserLayouts,
} from './layout.mjs';
import { applyTheme, resolveTheme, themeContrastDiagnostics } from './theme.mjs';

/**
 * @param {object} meta deck frontmatter (deck.meta)
 * @param {object} [opts] { baseDir, themePath, defaultTheme } — themePath
 *                 (CLI --theme) takes precedence over meta.theme;
 *                 defaultTheme (host) applies only if nothing else names a
 *                 theme
 * @returns {{ diagnostics: Array, theme: object|null, themeFile: string|null }}
 */
export function prepareDeckContext(
  meta = {},
  { baseDir = process.cwd(), themePath = null, defaultTheme = null } = {},
) {
  resetUserLayouts();
  // official catalog (design/layouts/): loaded once at startup — a file that
  // could not be read would signal a broken installation, on every deck
  const diagnostics = [...OFFICIAL_LAYOUT_DIAGS];
  const {
    theme,
    path: themeFile,
    layoutsDir,
    kitName,
    diagnostics: themeDiags,
  } = resolveTheme(meta, { baseDir, themePath, defaultTheme });
  diagnostics.push(...themeDiags);
  applyTheme(theme);
  // kit layouts BEFORE the deck's own: a collision is reported on the deck's
  // definition, attributed to the kit
  if (layoutsDir) diagnostics.push(...loadThemeLayouts(layoutsDir, kitName));
  diagnostics.push(...loadUserLayouts(baseDir));
  if (theme) diagnostics.push(...themeContrastDiagnostics());
  return { diagnostics, theme, themeFile };
}
