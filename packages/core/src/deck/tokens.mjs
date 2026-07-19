/**
 * Design tokens of the compiler's DEFAULT theme: a generic, neutral
 * system ("Slate") — no branding. The complete JSON mirror lives in
 * design/themes/default.json (a template to copy when theming an
 * organization); an anti-drift test guarantees it stays identical to
 * these values. Organization brands are KITS (kit.json + theme.json
 * + layouts/ + fonts), resolved by resolveTheme (theme.mjs).
 *
 * Units: the 16:9 slide is 13.333 × 7.5 in, that is exactly
 * 1280 × 720 px at 96 dpi. Everything is therefore composed in pixels on
 * the system's 8 px grid, and converted to inches at render time (px / 96).
 *
 * Themability: each group is an object mutated IN PLACE by
 * `applyTheme()` (theme.mjs) — consumers must read the tokens at call
 * time, never copy them when the module loads. The derived groups
 * (PAGE.margin/gutter/footerHeight, LAYER_SHADES, TREND_INK,
 * SEMANTIC) are recomputed by `deriveTokens()` so they follow a theme's
 * palette.
 */

export const COLORS = {
  primary: '1D4ED8',
  primaryLighter: '60A5FA',
  primaryDarker: '1E3A8A',
  brand: '1D4ED8',
  brandBlack: '111827',
  neutralPrimary: '212529',
  neutralSecondary: '637381',
  neutralTertiary: 'ADB2BD',
  neutralStroke: 'CED4DA',
  underground1: 'F8F9FA',
  underground2: 'DEE2E6',
  ground: 'FFFFFF',
  highlightLight: 'EFF6FF',
  highlightStrong: 'DBEAFE',
  informative: '0079C4',
  informativeDark: '004B7B',
  informativeLight: 'E6F5F9',
  positive: '0DA566',
  positiveDark: '025D29',
  positiveLight: 'E7F6F0',
  warning: 'FFB833',
  warningDark: '6C4600',
  warningLight: 'FEFAE6',
  negative: 'D3310A',
  negativeDark: '851A00',
  negativeLight: 'FFEBE6',
};

/**
 * Default font: Arial — installed everywhere, identical rendering in
 * PowerPoint and in browsers without embedding anything. A theme supplies
 * its family through `fonts.body` and its files through `fonts.files`.
 */
export const FONTS = {
  body: 'Arial',
  mono: 'Courier New',
};

/**
 * Files of the embedded font, themable: `regular`/`bold`/`italic` are
 * the .ttf files embedded in the .pptx; the HTML renderer inlines the
 * same names as .woff2 (same file name, .woff2 extension — supply both
 * formats side by side). A theme's paths are resolved relative to the
 * theme file by resolveTheme(). The default embeds nothing (Arial is
 * already on the machine).
 */
export const FONT_FILES = {
  regular: null,
  bold: null,
  italic: null,
};

/**
 * Chrome signatures (logos), themable: `cover` is placed at the top of the
 * cover slide, `section` (a reversed variant, meant for the primary
 * background) at the bottom of section slides. `cover`/`section` feed the
 * PPTX (bitmap required: png/jpg); `coverSvg`/`sectionSvg` the HTML output
 * (svg accepted, falling back to the bitmap). Absolute paths after
 * resolveTheme(). The default has no signature: both renderers simply omit
 * the logo when the path is null or not found.
 */
export const LOGOS = {
  cover: null,
  coverSvg: null,
  section: null,
  sectionSvg: null,
};

/** Sizes in points, derived from the DESIGN.md scale (px × 0.75 = pt),
 *  bumped up one notch for projection. */
export const TYPE = {
  coverTitle: 40,
  coverSubtitle: 20,
  sectionTitle: 32,
  slideTitle: 26,
  sectionHeading: 16, // h2 inside a slide (slot title)
  lead: 16,
  body: 14,
  bullet: 14,
  bulletNested: 13,
  small: 11,
  caption: 9,
  code: 11,
  metricValue: 44,
  metricLabel: 12,
  quote: 22,
  tableBody: 12,
  tableHeader: 12,
};

export const LINE_HEIGHT = 1.4; // structural, not themable (scalar export)

/** 8 px grid (DESIGN.md: xs 8 · sm 16 · md 24 · lg 32 · xl 40 · xxl 48). */
export const SPACE = { xs: 8, sm: 16, md: 24, lg: 32, xl: 40, xxl: 48 };

/** Slide geometry, in pixels (1280 × 720 @96 dpi).
 *  width/height are the physical 16:9 frame — never themable;
 *  margin/gutter/footerHeight are derived from SPACE (deriveTokens). */
export const PAGE = {
  width: 1280,
  height: 720,
  margin: SPACE.xxl, // 48 px
  gutter: SPACE.md, // 24 px
  titleHeight: 96, // 2 × 48: title zone of content slides
  footerHeight: SPACE.lg, // 32 px
};

/** Utility radii (px). PPTX rectangles take a 0–1 ratio. */
export const ROUNDED = { sm: 2, md: 4, lg: 8, pill: 64 };

/**
 * Chrome of the cover/section layouts and of the content masters — geometry
 * shared by BOTH renderers (pptx and html) so that parity is structural
 * rather than two sets of literals to keep in sync.
 * All values in px on the 1280 × 720 grid.
 */
export const CHROME = {
  cover: {
    barY: 280, // accent bar above the title
    barW: 96,
    barH: 6,
    titleY: 304,
    titleH: 120,
    subtitleY: 424,
    subtitleH: 72,
    bylineBottom: 80, // distance byline → bottom of page
    bylineH: 32,
    logoH: 44,
  },
  section: {
    titleY: 288,
    titleH: 144,
    logoH: 32,
  },
  title: {
    accentW: 64, // accent segment of the title rule
    accentH: 4,
  },
  footer: {
    textW: 600,
    h: 24,
    numW: 64, // page number, right-aligned
  },
};

export const px = (v) => v / 96; // px → inches

/** Usable content area of a content slide (below the title, above the footer). */
export function contentArea() {
  const x = PAGE.margin;
  const y = PAGE.titleHeight + SPACE.sm;
  return {
    x,
    y,
    w: PAGE.width - 2 * PAGE.margin,
    h: PAGE.height - y - PAGE.footerHeight - SPACE.sm,
  };
}

/**
 * Categorical chart palette — six neutral hues (teal, ochre, blue, red,
 * dark blue, brown), lightness and chroma tuned to pass the six dataviz
 * accessibility checks (OKLCH band 0.43–0.77, chroma ≥ 0.10, adjacent CVD
 * ΔE ≥ 12, contrast ≥ 3:1 on white). Fixed order — never assign in a
 * loop: past six series, group the rest under "Other". Palette independent
 * of COLORS: a theme that changes `primary` must supply its own
 * `chartColors`.
 */
export const CHART_COLORS = ['0A8A76', 'B87F00', '0079C4', 'D3310A', '005E99', '8A5C00'];

/**
 * Shades of the `layers` layout (architecture layers), from the base (dark)
 * up to the surface (light) — only hues of the primary token, the system's
 * only accent. `ink` = the ink legible on the shade (contrast ≥ 4.5:1);
 * white on the two dark shades only.
 * Derived from COLORS — recipe in deriveTokens().
 */
export const LAYER_SHADES = [];

/** Trend inks of the `:::metric` cards (dark: small body text).
 *  Derived from COLORS — recipe in deriveTokens(). */
export const TREND_INK = {};

/** Tints of the :::info/success/warning/danger callouts.
 *  fill/text derived from COLORS (deriveTokens); label localizable. */
export const SEMANTIC = {};

/**
 * Recipes for the groups derived from COLORS/SPACE: run when the module
 * loads, then re-run by applyTheme() AFTER a theme is merged so that
 * LAYER_SHADES, SEMANTIC, TREND_INK and PAGE's margins follow the
 * palette — an explicit theme override on a derived group is then
 * re-merged on top (theme.mjs).
 */
export function deriveTokens() {
  PAGE.margin = SPACE.xxl;
  PAGE.gutter = SPACE.md;
  PAGE.footerHeight = SPACE.lg;

  LAYER_SHADES.splice(
    0,
    LAYER_SHADES.length,
    { fill: COLORS.primaryDarker, ink: COLORS.ground },
    { fill: COLORS.primary, ink: COLORS.ground },
    { fill: COLORS.primaryLighter, ink: COLORS.neutralPrimary },
    { fill: COLORS.highlightStrong, ink: COLORS.primaryDarker },
    { fill: COLORS.highlightLight, ink: COLORS.primaryDarker },
  );

  Object.assign(TREND_INK, {
    positive: COLORS.positiveDark,
    negative: COLORS.negativeDark,
    neutral: COLORS.neutralSecondary,
  });

  Object.assign(SEMANTIC, {
    info: { fill: COLORS.informativeLight, text: COLORS.informativeDark, label: 'Info' },
    success: { fill: COLORS.positiveLight, text: COLORS.positiveDark, label: 'Key point' },
    warning: { fill: COLORS.warningLight, text: COLORS.warningDark, label: 'Caution' },
    danger: { fill: COLORS.negativeLight, text: COLORS.negativeDark, label: 'Important' },
  });
}
deriveTokens();

/**
 * Panel styles of the structured layouts (comparison, pillars, layers,
 * swot): fill + rule per variant — a flat system, no shadow. Shared by
 * both renderers to guarantee identical rendering.
 */
export function panelStyle(block) {
  switch (block.variant) {
    case 'accent':
      // solid accent bar (focus layout) — same ink as the title rule
      return { fill: COLORS.primary, line: null };
    case 'highlight':
      return { fill: COLORS.highlightLight, line: { color: COLORS.primary, width: 1.25 } };
    case 'pillar':
      return { fill: COLORS.ground, line: { color: COLORS.neutralStroke, width: 1 } };
    case 'semantic':
      return { fill: (SEMANTIC[block.kind] ?? SEMANTIC.info).fill, line: null };
    case 'layer':
      return { fill: (LAYER_SHADES[block.shade] ?? LAYER_SHADES[0]).fill, line: null };
    case 'muted':
    default:
      return { fill: COLORS.underground1, line: { color: COLORS.neutralStroke, width: 1 } };
  }
}
