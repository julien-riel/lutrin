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
 *
 * `display` is the OPTIONAL second family, worn by the large titles (cover,
 * section, slide title) and the pull-quote — the "brand voice" a serif
 * display over a sans body gives a deck. Absent (`null`), the titles keep the
 * body family, so a theme that says nothing composes exactly as before. Read
 * it through `displayFace()`, never `FONTS.display` directly: the fallback to
 * body lives there, in one place.
 */
export const FONTS = {
  body: 'Arial',
  mono: 'Courier New',
  display: null,
};

/** The family the titles are set in: the theme's display family, or the body
 *  family when it declares none. Read at call time (FONTS is mutated in place
 *  by applyTheme) — never copied at module load. */
export const displayFace = () => FONTS.display || FONTS.body;

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
 * Files of the embedded DISPLAY font, themable exactly like FONT_FILES but for
 * the `fonts.display` family: the .ttf goes into the .pptx (a second
 * `<p:embeddedFont>` group, under the display typeface), its .woff2 twin into
 * the HTML `@font-face`. Empty by default (no display font, or a display family
 * that names an installed font without shipping its glyphs).
 */
export const DISPLAY_FONT_FILES = {
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

/**
 * Named images of the theme, themable: alias → absolute path, filled by
 * applyTheme() from a theme's `images` map (paths resolved relative to the
 * theme.json and CONFINED by resolveTheme, exactly like the logos). A deck
 * references them as `![role](kit:<alias>)`; once the alias is substituted,
 * both renderers treat the path exactly like a local deck image. The default
 * theme declares none — an empty object, restored between compilations by the
 * same snapshot mechanism as every other live group.
 */
export const KIT_IMAGES = {};

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

/** Points → pixels on the 1280 × 720 grid (96 dpi / 72 pt per inch). */
export const PT_TO_PX = 96 / 72;

/** Average advance width (px) of one character at `pt`. A crude 0.52 em, and
 *  deliberately so: measuring for real would mean loading the kit's font
 *  metrics into `src/deck/`, which knows no output format. Both the height
 *  estimator (textHeight, layout.mjs) and the components that must place text
 *  side by side (badgeLayout, progressLayout) read it, so an approximation
 *  that drifts drifts identically everywhere. */
export const charWidth = (pt) => pt * PT_TO_PX * 0.52;

/** Rough width (px) of a text at `pt` — see charWidth on why it is an estimate. */
export const textWidth = (text, pt) => String(text).length * charWidth(pt);

/**
 * Discrete text scale a layout can ask for. Three steps and not a continuous
 * range: a panel's text has to stay comparable to its neighbour's, and
 * "this panel is dense and still overflows" is actionable where "this panel
 * is at 0.83" is not. FACTORS, not absolute sizes — a kit shipping a 16 pt
 * body keeps its own proportions. Structural, like LINE_HEIGHT: a theme
 * changes the tokens the factors apply to, never the factors.
 */
export const TEXT_DENSITY = { comfortable: 1, compact: 0.78, dense: 0.64 };

/** Floor of the scale (pt): under this the deliverable stops being
 *  projectable, and clamping is the honest place to say so. */
const TEXT_SIZE_FLOOR = 7;

/** The scale's only rounding — half a point, floored. Centralized so a size
 *  stamped by the layout engine and the same size recomputed by a renderer
 *  can never differ by a fraction of a point. */
const roundSize = (pt) => Math.max(TEXT_SIZE_FLOOR, Math.round(pt * 2) / 2);

/**
 * A theme token scaled to a density step. `comfortable` — and any step the
 * scale does not know — returns the token untouched, so the caller has
 * nothing to stamp and the scene of a deck that asked for nothing stays
 * byte-identical.
 */
export function scaleTextToken(pt, density) {
  const factor = TEXT_DENSITY[density];
  return factor == null || factor === 1 ? pt : roundSize(pt * factor);
}

/** Theme token a block's text is drawn from. `part` picks a block's SECONDARY
 *  text — the sub-level of a bullet list, the label of a callout — which the
 *  theme sizes independently of the body. */
function textToken(type, part) {
  switch (type) {
    case 'bullets':
      return part === 'nested' ? TYPE.bulletNested : TYPE.bullet;
    case 'table':
      return TYPE.tableBody;
    case 'heading':
      return TYPE.sectionHeading;
    case 'code':
      return TYPE.code;
    case 'quote':
      return TYPE.quote;
    case 'alert':
      return part === 'label' ? TYPE.small : TYPE.body;
    default:
      return TYPE.body;
  }
}

/**
 * Effective font size (pt) of a text block.
 *
 * `block.size` is a SYNTHESIZED IR field: the layout engine writes it (a
 * layout's `density`, the key message of `focus`), an author never does —
 * a point size in the deck's prose would be positioning by another name.
 * Absent, the theme's token for the block's kind applies.
 *
 * Both renderers AND blockHeight() go through here: a block that renders
 * smaller must also MEASURE smaller, or pagination places it wrong, and two
 * renderers reading the same accessor cannot drift apart.
 */
export function blockFontSize(block, part = 'body') {
  const token = textToken(block.type, part);
  if (!block.size) return token;
  if (part === 'body') return block.size;
  // secondary text keeps the RATIO the theme gave it, rather than a fixed
  // offset: "size - 1" would flatten a kit whose sub-level is two points
  // below its body, and would drive a 16 pt kit onto the floor at `dense`
  return roundSize((block.size * token) / textToken(block.type, 'body'));
}

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

/** Utility radii, in px on the 1280 × 720 grid like every other geometry
 *  token: px() converts them for the PPTX `rectRadius`, which takes an
 *  absolute length (it is the OOXML `adj` underneath that is a ratio of the
 *  shorter side, and PptxGenJS computes it). */
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
  /** "Generated with Lutrin" attribution, on decks compiled without a licence.
   *  Its own zone rather than a suffix on the footer text: the author's footer
   *  keeps its full width (48 → 648 px), the attribution sits right-aligned
   *  before the page number (948 → 1168 px, where the number's zone starts), and no deck title
   *  can ever run into it. Painted on cover and section layouts too, which have
   *  no footer — see the renderers. */
  brand: {
    w: 220,
    h: 24,
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

/**
 * Surfaces of the three slide kinds — the backgrounds and the inks that ride
 * on them. Derived from COLORS (recipe in deriveTokens) so a repainted palette
 * carries them along, and OVERRIDABLE as a theme's `surface` group (a
 * DERIVED_GROUP, merged after the derivation): this is what lets a kit give the
 * cover a colour, darken the section band or tint the content page WITHOUT
 * touching the semantics of the palette.
 *
 * Every default equals what the renderers used to hard-code — coverBg/pageBg
 * the ground, the cover inks the neutral text, the section band the primary
 * with white on it — so a theme that names no `surface` composes byte-for-byte
 * as before.
 */
export const SURFACE = {};

/** Tints of the :::info/success/warning/danger callouts.
 *  fill/text derived from COLORS (deriveTokens); label localizable. */
export const SEMANTIC = {};

// ---------------------------------------------------------------------------
// WCAG contrast — here rather than in theme.mjs (which re-exports it) because
// deriveTokens() has to CHOOSE an ink against a fill it has just computed, and
// tokens.mjs is the module nothing else may depend on.
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
 * Ink for a SATURATED tint: the first candidate that clears AA, in order of
 * preference — the family's own dark ink (which keeps the chip inside its
 * hue), then white, then the deck's ordinary ink.
 *
 * A rule rather than four literals, because the literals were only right for
 * the palette they were read off. A kit repainting `colors.positive` used to
 * keep the ink chosen for the default green and fell under AA — and, since
 * themeContrastDiagnostics() measures the pair, it warned twice on every build
 * of a deck that used no saturated tint at all. Preference before maximum on
 * purpose: the amber clears AA with its own brown (4.84:1) and would otherwise
 * take the near-black that scores higher and belongs to no family.
 *
 * Nothing clears 4.5:1 → the best of the three, and THEME_CONTRAST says so.
 */
/**
 * The colour a translucent fill actually produces over a background —
 * `alpha × top + (1 − alpha) × bottom`, per channel.
 *
 * It exists so that ink on a translucent surface is chosen against the
 * surface the READER sees, not against the opaque colour named in the token.
 * A Venn disc painted at 22 % is, to the eye, a very pale tint; picking its
 * ink from the full-strength shade would put white text on near-white and
 * pass every contrast check by measuring a pair nothing displays.
 */
export function composite(top, bottom, alpha) {
  const chan = (hex, i) => Number.parseInt(hex.slice(i, i + 2), 16);
  return [0, 2, 4]
    .map((i) =>
      Math.round(alpha * chan(top, i) + (1 - alpha) * chan(bottom, i))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase(),
    )
    .join('');
}

export function solidInk(fill, familyDark) {
  const candidates = [familyDark, COLORS.ground, COLORS.neutralPrimary].filter(Boolean);
  return (
    candidates.find((ink) => contrastRatio(ink, fill) >= 4.5) ??
    candidates.reduce((best, ink) =>
      contrastRatio(ink, fill) > contrastRatio(best, fill) ? ink : best,
    )
  );
}

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

  // Surfaces: the defaults reproduce exactly what the renderers hard-coded
  // before the group existed. `coverMutedInk` is the subtitle/byline ink, the
  // secondary text a coloured cover still needs; `sectionInk` is the ink on the
  // full-bleed section band (white on the primary, by default).
  Object.assign(SURFACE, {
    pageBg: COLORS.ground,
    coverBg: COLORS.ground,
    coverInk: COLORS.neutralPrimary,
    coverMutedInk: COLORS.neutralSecondary,
    sectionBg: COLORS.primary,
    sectionInk: COLORS.ground,
  });

  // Two tones per tint: `fill`/`text` is the pale callout surface, and
  // `solid`/`solidText` the saturated chip — a status pill, a state bar, a
  // full-bleed band. The four saturated tokens are nowhere near equally dark
  // (white clears AA on the blue and the red, and collapses on the amber at
  // 1.73:1 and the green at 3.19:1), so the ink is COMPUTED per tint by
  // solidInk() rather than written down: a kit repaints the palette, and four
  // literals would go on describing the palette they were read off.
  Object.assign(SEMANTIC, {
    info: {
      fill: COLORS.informativeLight,
      text: COLORS.informativeDark,
      solid: COLORS.informative,
      solidText: solidInk(COLORS.informative, COLORS.informativeDark),
      label: 'Info',
    },
    success: {
      fill: COLORS.positiveLight,
      text: COLORS.positiveDark,
      solid: COLORS.positive,
      solidText: solidInk(COLORS.positive, COLORS.positiveDark),
      label: 'Key point',
    },
    warning: {
      fill: COLORS.warningLight,
      text: COLORS.warningDark,
      solid: COLORS.warning,
      solidText: solidInk(COLORS.warning, COLORS.warningDark),
      label: 'Caution',
    },
    danger: {
      fill: COLORS.negativeLight,
      text: COLORS.negativeDark,
      solid: COLORS.negative,
      solidText: solidInk(COLORS.negative, COLORS.negativeDark),
      label: 'Important',
    },
  });
}
deriveTokens();

/**
 * Panel styles of the structured layouts (comparison, pillars, layers,
 * swot): fill + rule + ink per variant — a flat system, no shadow. Shared by
 * both renderers to guarantee identical rendering.
 *
 * `ink` is the colour the text placed ON the panel must take, and `null`
 * means "the deck's ordinary ink" — a near-white surface imposes nothing, and
 * a layout that stamped neutralPrimary on it would write a colour into every
 * scene that has one. It is a returned slot rather than a call-site guess
 * because the tone changes the answer for one and the same tint, and the
 * saturated ink is not deducible from the pale one — see deriveTokens().
 */
export function panelStyle(block) {
  switch (block.variant) {
    case 'accent':
      // solid accent bar (focus layout) — same ink as the title rule
      return { fill: COLORS.primary, line: null, ink: COLORS.ground };
    case 'highlight':
      return {
        fill: COLORS.highlightLight,
        line: { color: COLORS.primary, width: 1.25 },
        ink: null,
      };
    case 'pillar':
      return { fill: COLORS.ground, line: { color: COLORS.neutralStroke, width: 1 }, ink: null };
    case 'semantic': {
      const sem = SEMANTIC[block.kind] ?? SEMANTIC.info;
      return block.tone === 'solid'
        ? { fill: sem.solid, line: null, ink: sem.solidText }
        : { fill: sem.fill, line: null, ink: sem.text };
    }
    case 'layer': {
      // a theme may replace layerShades with a shorter array (or an empty
      // one): fall back rather than read `.fill` of undefined mid-render
      const shade = LAYER_SHADES[block.shade] ?? LAYER_SHADES[0];
      return {
        fill: shade?.fill ?? COLORS.underground1,
        line: null,
        ink: shade?.ink ?? COLORS.neutralPrimary,
      };
    }
    case 'muted':
    default:
      return {
        fill: COLORS.underground1,
        line: { color: COLORS.neutralStroke, width: 1 },
        ink: null,
      };
  }
}

/**
 * Corner radius (px) of a panel. One source for both renderers rather than
 * the same three-way ternary written twice: the accent bar is all but square,
 * the tinted surfaces (architecture layers, semantic quadrants) take the
 * medium radius, the framed panels the large one — unless the layout asked
 * for a radius, which then wins.
 *
 * `pill` is measured, not looked up: half the shorter side is what makes the
 * ends semicircular at any height, and a token could only be right for one
 * size. ROUNDED.pill is the answer for a caller with no box to measure.
 */
export function panelRadius(block, region) {
  if (block.radius === 'pill') return region ? Math.min(region.w, region.h) / 2 : ROUNDED.pill;
  if (block.radius) return ROUNDED[block.radius] ?? ROUNDED.lg;
  switch (block.variant) {
    case 'accent':
      return ROUNDED.sm;
    case 'layer':
    case 'semantic':
      return ROUNDED.md;
    default:
      return ROUNDED.lg;
  }
}

// ---------------------------------------------------------------------------
// Internal geometry of the two composite blocks (progress, badge)
//
// Both are drawn from several shapes, and the two renderers must place those
// shapes at the SAME coordinates — otherwise a bar whose percentage sits
// inside the fill in the HTML and beside it in the .pptx is a divergence no
// dispatch-table test can see. So the geometry is computed here, once, in
// coordinates LOCAL to the block's region: a renderer adds the region's own
// origin and converts to its unit. blockHeight() reads the same functions,
// which is what makes pagination agree with what is actually drawn.
// ---------------------------------------------------------------------------

/** A progress row: label on the left, bar on the right, optional caption
 *  underneath. Heights are fixed — a bar is an object of known size, and the
 *  wrapping of a label that does not fit is the layout's problem. */
const PROGRESS = { rowH: 28, captionH: 18, barH: 20, labelRatio: 0.34 };

export function progressLayout(block, widthPx) {
  const w = Math.max(1, widthPx);
  const labelW = Math.round(w * PROGRESS.labelRatio);
  const barX = labelW + SPACE.sm;
  const barW = Math.max(1, w - barX);
  const barY = (PROGRESS.rowH - PROGRESS.barH) / 2;
  const value = Math.min(1, Math.max(0, block.value ?? 0));
  const fillW = Math.round(barW * value);
  const text = `${Math.round(value * 100)} %`;
  const pctW = Math.ceil(textWidth(text, TYPE.small));
  // the percentage rides INSIDE the fill as soon as the fill can hold it with
  // its padding, and sits beside it otherwise. One threshold, read by both
  // renderers: the number must not be in two different places in the two
  // deliverables.
  const inside = fillW >= pctW + 2 * SPACE.xs;
  const bar = { x: barX, y: barY, w: barW, h: PROGRESS.barH };
  return {
    h: block.caption ? PROGRESS.rowH + PROGRESS.captionH : PROGRESS.rowH,
    label: { x: 0, y: 0, w: labelW, h: PROGRESS.rowH },
    bar,
    fill: { ...bar, w: fillW },
    pct: inside
      ? { text, inside, align: 'right', x: barX, y: barY, w: fillW - SPACE.xs, h: PROGRESS.barH }
      : {
          text,
          inside,
          align: 'left',
          // clamped: a fill just under the threshold must not push the number
          // out of the block's own region
          x: Math.min(barX + fillW + SPACE.xs, Math.max(barX, w - pctW)),
          y: barY,
          w: pctW,
          h: PROGRESS.barH,
        },
    // The target: a 2 px rule standing across the track where the commitment
    // sits. Height unchanged — that is the whole reason this is a property of
    // the bar and not a block of its own. A target of 0 or 1 would land on an
    // end cap and read as a drawing artefact, so it is only marked strictly
    // inside.
    ...(Number.isFinite(block.target) && block.target > 0 && block.target < 1
      ? {
          marker: {
            x: barX + Math.round(barW * block.target) - 1,
            y: barY - 2,
            w: 2,
            h: PROGRESS.barH + 4,
            reached: value >= block.target,
          },
        }
      : {}),
    ...(block.caption ? { caption: { x: 0, y: PROGRESS.rowH, w, h: PROGRESS.captionH } } : {}),
  };
}

/** A row of badges, wrapped over as many lines as the width needs. The wrap
 *  lives here rather than in a CSS `flex-wrap`, because the .pptx has no
 *  flow layout at all: shapes are placed absolutely, and blockHeight() must
 *  know the answer before either renderer runs. */
const BADGE = { h: 26, padX: 10, gapX: SPACE.xs, gapY: 6 };

export function badgeLayout(block, widthPx) {
  const w = Math.max(1, widthPx);
  const items = [];
  let x = 0;
  let y = 0;
  for (const it of block.items ?? []) {
    const itemW = Math.min(w, Math.ceil(textWidth(it.text, TYPE.small)) + 2 * BADGE.padX);
    if (x && x + itemW > w) {
      x = 0;
      y += BADGE.h + BADGE.gapY;
    }
    items.push({ ...it, x, y, w: itemW, h: BADGE.h });
    x += itemW + BADGE.gapX;
  }
  return { items, h: items.length ? y + BADGE.h : 0 };
}

/**
 * The size an author may ASK FOR on an icon — a word, never a point size.
 *
 * The words are FACTORS, not dimensions: they scale the cap and the flow
 * height, and the slot still governs. `![small](lucide:leaf)` in a column
 * narrower than 78 px is 78 px wide nowhere — it is as wide as the column,
 * exactly like the default. The word adjusts, it never positions.
 *
 * Module-private on purpose: making these themable means a THEME_KEYS group,
 * an ALL_LIVE entry and a mirror in design/themes/default.json, and no kit has
 * asked. The first one that does carries the change (build brief §1).
 */
const ICON = { max: 160, flowHeight: 112 };
export const ICON_SCALE = { small: 0.7, medium: 1, large: 1.4 };

/**
 * The size an icon ASKS for, in px, before the slot has its say — and the two
 * words obey two different rules on purpose.
 *
 * `small`/`medium`/`large` are FACTORS on the engine's own dimension (`base`:
 * the drawing cap, or the height the flow reserves). `line` is not a factor at
 * all: it is the height of ONE LINE of body text, read from the theme at call
 * time, so an icon standing beside a sentence matches the sentence rather than
 * a number chosen here — and a kit shipping a 16 pt body gets a taller one for
 * free. That is why it cannot be a fourth entry in ICON_SCALE.
 */
function iconIntrinsic(block, base) {
  // `line` follows the body text ALL the way: the theme's token, and the step
  // the region was re-flowed at when auto-fit had to densify it (scaleBlocks
  // stamps it). Reading the un-densified token drew an icon 1.5× the line it
  // labels, exactly where the space was scarcest.
  if (block?.size === 'line')
    return scaleTextToken(TYPE.body, block.density) * PT_TO_PX * LINE_HEIGHT;
  return base * (ICON_SCALE[block?.size] ?? 1);
}

/**
 * Side of the square an icon is drawn in, in px — the ONE answer both
 * renderers read. Two `Math.min` written twice drifted apart the first time
 * one of them gained a factor; this is the same lesson badgeLayout() banked.
 *
 * Never zero, never negative: an over-subscribed column hands out a negative
 * share, and a negative extent is not a small icon — it is a `<a:ext>` outside
 * ST_PositiveCoordinate, i.e. a .pptx PowerPoint offers to repair. The floor
 * keeps the file valid; the overflow it stands for is reported elsewhere.
 */
export const iconSize = (block, region) =>
  Math.max(1, Math.round(Math.min(region.w, region.h, iconIntrinsic(block, ICON.max))));

/** Height an icon reserves when it flows in a region (blockHeight). Same rule
 *  as the drawing: an icon that DRAWS larger must also MEASURE larger, or the
 *  block underneath it is placed on top of it. */
export const iconFlowHeight = (block) => Math.round(iconIntrinsic(block, ICON.flowHeight));
