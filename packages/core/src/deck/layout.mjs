/**
 * Layout engine: IR → scenes.
 *
 * Three passes, like a compiler:
 *   1. analysis   — infer each slide's layout from its content (title alone
 *                   → section; bullets + diagram → split; table → table;
 *                   etc.);
 *   2. placement  — assign each block to a slot (a region in px on the
 *                   1280 × 720 surface, aligned to the 8 px grid);
 *   3. pagination — estimate heights and split what overflows into
 *                   "(cont.)" continuation slides; where a region cannot
 *                   paginate, auto-fit re-flows it a step down the text
 *                   scale instead (flowBlocks).
 *
 * The scene produced is purely geometric: the renderer has no decision left
 * to make.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHROME,
  COLORS,
  LAYER_SHADES,
  PAGE,
  SPACE,
  TEXT_DENSITY,
  TYPE,
  LINE_HEIGHT,
  PT_TO_PX,
  badgeLayout,
  blockFontSize,
  charWidth,
  contentArea,
  iconFlowHeight,
  panelStyle,
  progressLayout,
  scaleTextToken,
} from './tokens.mjs';
import { isMarpDeck } from './marp.mjs';
import { ALERT_BLOCK_TYPES, animateFlag, animatePreset, runsToText } from './parse.mjs';
import { closest } from './suggest.mjs';

// ---------------------------------------------------------------------------
// Height estimation (px)
// ---------------------------------------------------------------------------

function textHeight(text, widthPx, pt, lineHeight = LINE_HEIGHT) {
  const cpl = Math.max(8, Math.floor(widthPx / charWidth(pt)));
  const lines = Math.max(1, Math.ceil((text.length || 1) / cpl));
  return lines * pt * PT_TO_PX * lineHeight;
}

export function blockHeight(block, widthPx) {
  switch (block.type) {
    case 'para':
      return textHeight(runsToText(block.runs), widthPx, blockFontSize(block)) + SPACE.xs;
    case 'bullets':
      return block.items.reduce(
        (h, it) =>
          h +
          textHeight(
            runsToText(it.runs),
            widthPx - 32 - it.level * 24,
            blockFontSize(block, it.level ? 'nested' : 'body'),
          ) +
          6,
        SPACE.xs,
      );
    case 'code': {
      const lines = block.source.split('\n').length;
      return lines * blockFontSize(block) * PT_TO_PX * 1.35 + SPACE.lg;
    }
    case 'table': {
      const pt = blockFontSize(block);
      const rowH = (cells) =>
        Math.max(
          ...cells.map((c) =>
            textHeight(runsToText(c), (widthPx - 16 * cells.length) / cells.length, pt),
          ),
          pt * PT_TO_PX * LINE_HEIGHT,
        ) + 14;
      return (
        rowH(block.header.length ? block.header : [[]]) +
        block.rows.reduce((h, r) => h + rowH(r), 0) +
        SPACE.xs
      );
    }
    case 'alert': {
      // only the blocks the renderers actually render count: reserving the
      // height of an ignored block would dig a visual hole in the callout.
      // The callout's own size travels down with them: both renderers set it
      // on the whole shape, so measuring the contents at the theme's token
      // would reserve a height nothing occupies.
      const inner = block.blocks
        .filter((b) => ALERT_BLOCK_TYPES.has(b.type))
        .reduce(
          (h, b) =>
            h + blockHeight(block.size ? { ...b, size: block.size } : b, widthPx - 2 * SPACE.sm),
          0,
        );
      return inner + 2 * SPACE.sm + blockFontSize(block, 'label') * PT_TO_PX * LINE_HEIGHT;
    }
    case 'metric':
      return 160;
    case 'progress':
      // a CONSTANT, like the metric card: a bar is an object of known size,
      // and a label too long to fit beside it is the layout's problem, not
      // the block's (progressLayout owns the two heights)
      return progressLayout(block, widthPx).h;
    case 'badge':
      // the row wraps its own items, and this is the only place the wrap can
      // be known: pagination trusts this number, and so do both renderers,
      // which place the badges from the same function
      return badgeLayout(block, widthPx).h + SPACE.xs;
    case 'quote':
      return (
        textHeight(runsToText(block.runs), widthPx - 2 * SPACE.xl, blockFontSize(block)) + SPACE.xl
      );
    case 'image':
    case 'mermaid':
    case 'chart':
      return 280; // visuals adapt to their slot; default flow value
    case 'math':
      // one equation "line" per \\ separator (multiline environments)
      return block.source.split('\\\\').length * 56 + SPACE.sm;
    case 'icon':
      // the size word an author may have asked for travels with the height:
      // a `large` icon that drew at 1.4× while still measuring 112 px would be
      // placed on top of whatever the flow put underneath it
      return iconFlowHeight(block);
    case 'heading':
      // imposed size (key message of the focus layout): the text may flow
      // over several lines — the estimate follows; otherwise one title line
      if (block.size)
        return textHeight(runsToText(block.runs), widthPx, blockFontSize(block)) + SPACE.xs;
      return blockFontSize(block) * PT_TO_PX * LINE_HEIGHT + SPACE.xs;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Pass 1 — analysis: layout inference
// ---------------------------------------------------------------------------

const flat = (slide) => slide.sections.flatMap((s) => s.blocks);
const count = (blocks, type) => blocks.filter((b) => b.type === type).length;

// ---------------------------------------------------------------------------
// Layout registry (review §3.3, step 2)
//
// The built-in layouts are registered here at load time; USER layouts
// (`layouts/*.json` files next to the deck) are added to it per compilation
// via loadUserLayouts(). A user layout is a named ALIAS of a built-in
// layout: `{ "name": "before-after", "base": "comparison", "sections":
// { "min": 2, "max": 2 } }` — it inherits the placement of its `base`, may
// tighten the section bounds, and validation ("did you mean",
// LAYOUT_SECTIONS) as well as capabilities() know about it for free, since
// they read the registry.
//
// LAYOUTS and LAYOUT_SECTIONS stay exported: they are LIVE VIEWS of the
// registry (same object references — consumers bound through ESM follow the
// registrations without changing).
// ---------------------------------------------------------------------------

const REGISTRY = new Map(); // name → { name, base?, sections?, description?, params?, paramSchema?, builtin?, official? }

// ---------------------------------------------------------------------------
// Generator parameters (review §3.3, step 3, phase A)
//
// Every built-in layout is a GENERATOR: its registry def declares a
// `paramSchema` (name → { type, domain, default, description }) — the single
// source of truth. A layouts/*.json file (user) or design/layouts/ file
// (official) sets parameters AT THE TOP LEVEL of the JSON, exactly like
// `sections`; registerLayout validates them (types, domains, "did you mean"),
// capabilities() publishes them. Semantic values reference design TOKENS
// (panelStyle variants, SEMANTIC tints, LAYER_SHADES shades), never raw
// colors; the defaults reproduce the historical behaviour exactly (an alias
// with no parameters stays a pure alias).
// ---------------------------------------------------------------------------

const SEMANTIC_KINDS = ['info', 'success', 'warning', 'danger'];

/** Admissible values of the `panels` parameters: the neutral variants of
 *  panelStyle() + the four semantic tints, pale (`success`) or saturated
 *  (`success-solid`) — the layout picks the variant, the theme defines its
 *  color. Two names for one tint rather than a separate `tone` parameter: the
 *  tone is per panel, and `panels` is already the per-panel list. */
const PANEL_VARIANTS = [
  'muted',
  'highlight',
  'pillar',
  ...SEMANTIC_KINDS,
  ...SEMANTIC_KINDS.map((k) => `${k}-solid`),
];

const panelsParam = (dflt, what) => ({
  type: 'enum-list',
  values: PANEL_VARIANTS,
  default: dflt,
  description: `panel variant per ${what}, cycling: muted, highlight, pillar or a semantic tint (pale, or saturated with the "-solid" suffix)`,
});

/** Corner radius of the panels a generator draws. Absent (the default) leaves
 *  each variant its own — an accent bar and a semantic quadrant are not
 *  rounded the same, and naming a step here would flatten that. */
const radiusParam = () => ({
  type: 'enum',
  values: ['sm', 'md', 'lg', 'pill'],
  default: null,
  description: 'corner radius of the panels: sm, md, lg or pill (default: per variant)',
});

/** Panel block described by one entry of a `panels`/`kinds` list. The IR keeps
 *  `tone` OMITTED for the pale tone: the scenes of a deck that asked for
 *  nothing must not gain a key. */
function panelFrom(spec) {
  const solid = spec.endsWith('-solid');
  const kind = solid ? spec.slice(0, -'-solid'.length) : spec;
  if (!SEMANTIC_KINDS.includes(kind)) return { variant: spec };
  return { variant: 'semantic', kind, ...(solid ? { tone: 'solid' } : {}) };
}

/** The author-facing surface of the text scale: an intent word, never a point
 *  size. Same spec on every generator that flows text into a bounded region —
 *  a panel, a cell, a band — since that is where a 14 pt body runs out of
 *  room first. */
const densityParam = () => ({
  type: 'enum',
  values: Object.keys(TEXT_DENSITY),
  default: 'comfortable',
  description: 'text scale of the blocks placed in the regions: comfortable, compact or dense',
});

/** Horizontal alignment offered by the generators that place text in a region
 *  of their own choosing. Deliberately NOT author-facing: `align` has exactly
 *  two producers — the table parser (which honours a Markdown delimiter row)
 *  and a layout definition. A paragraph an author could align by hand is
 *  positioning, and positioning is the engine's job. */
const alignParam = (what) => ({
  type: 'enum',
  values: ['left', 'center', 'right'],
  default: 'left',
  description: `horizontal alignment of ${what}`,
});

/** `align` as an IR field, OMITTED at the natural value: left is what every
 *  block has always rendered as, and a scene that asked for nothing must not
 *  gain a key. */
const alignAttr = (align) => (align && align !== 'left' ? { align } : {});

/** Block types both renderers actually align. A table has its own per-column
 *  alignment, read from the delimiter row, and a layout has no business
 *  overriding what the author wrote in the Markdown. */
const ALIGNED_BLOCKS = new Set(['para', 'bullets', 'heading']);

function alignBlocks(blocks, align) {
  const attr = alignAttr(align);
  if (!attr.align) return blocks;
  return blocks.map((b) => (ALIGNED_BLOCKS.has(b.type) ? { ...b, ...attr } : b));
}

/** Block types the scale is stamped on. `heading` is deliberately out — a
 *  slot title is short, and shrinking it along with the body would blur the
 *  hierarchy the panel exists to show; `code` and `quote` are out because
 *  their surfaces are fixed frames, and they are what an overflowing panel
 *  should be told to drop, not to squeeze. */
const SIZED_BLOCKS = new Set(['para', 'bullets', 'table', 'alert']);

/**
 * Stamps a text scale on the blocks a region is about to flow — the layout's
 * `density`, or the step auto-fit fell back to. The factor applies to each
 * block's OWN theme token, so a kit with a 16 pt body and a 12 pt table keeps
 * its proportions.
 *
 * Always applied to the ORIGINAL blocks (flowBlocks re-scales from them at
 * every step): a factor applied on top of a factor would land on sizes the
 * scale does not have.
 *
 * Returns the blocks UNTOUCHED at the default step: a scene of a deck that
 * asked for nothing must not carry a single `size` key, or every existing
 * deck's geometry moves and the goldens with it.
 */
function scaleBlocks(blocks, density) {
  if (!density || density === 'comfortable') return blocks;
  return blocks.map((b) => {
    if (SIZED_BLOCKS.has(b.type)) return { ...b, size: scaleTextToken(blockFontSize(b), density) };
    // An icon carries no point size — its `size` is a WORD, and stamping one
    // there would collide with it. What `line` needs is the STEP: it means one
    // line of body text, and a body stepped down to 9 pt beside a 26 px icon
    // is not one line but one and a half, in a region the engine has just
    // declared too tight. The factor words are factors on a constant of the
    // engine, so they are left alone.
    if (b.type === 'icon' && b.size === 'line') return { ...b, density };
    return b;
  });
}

/**
 * Block types repainted by the panel they sit in: those that put ink STRAIGHT
 * ONTO the panel's surface.
 *
 * The blocks left out are left out because they carry a surface of their own —
 * a callout its tint, a metric card and a code block their frame, a badge its
 * pill — so their ink is measured against that surface, not against the panel,
 * and repainting them would break the pair that was validated. The visuals
 * (image, chart, mermaid, math, icon) hold no body text to repaint.
 *
 * Getting this set wrong is not cosmetic: a table left out sat at 3.10:1 on a
 * solid danger panel, under AA, while three separate places in the docs
 * promised the opposite.
 */
/**
 * Where each cell of a `grid` sits, once cells may span several columns.
 *
 * Placement is a left-to-right flow, exactly as a reader scans: a cell that
 * does not fit on the current row opens the next one. NOT a best-fit packer —
 * a later cell must never jump ahead of an earlier one to fill a hole, because
 * the author wrote those sections in an order, and reading order is the one
 * thing a mosaic must not invent.
 *
 * The gap a wide cell leaves at the end of a row is therefore left empty, and
 * that gap is a layout worth having: it is how a board gets a full-width band
 * under its panels.
 *
 * `spans` cycles like `panels` and `kinds`, and every value is clamped to the
 * column count — a span of 3 in a 2-column grid is a full-width cell, never an
 * overflow.
 *
 * @returns {{cells: Array<{col:number,row:number,span:number}>, rows:number}}
 */
export function packGrid(n, cols, spans = null) {
  const cells = [];
  let col = 0;
  let row = 0;
  for (let k = 0; k < n; k++) {
    const span = Math.min(spans?.length ? spans[k % spans.length] : 1, cols);
    if (col + span > cols) {
      row++;
      col = 0;
    }
    cells.push({ col, row, span });
    col += span;
  }
  return { cells, rows: cells.length ? row + 1 : 1 };
}

const INKED_BLOCKS = new Set(['para', 'bullets', 'heading', 'table', 'quote', 'progress']);

/**
 * Applies a panel's ink to the blocks flowed INTO it. A saturated surface
 * imposes it on every block that writes directly on it: on a solid danger
 * panel the title is white and the ordinary body ink is 3.2:1 on the same red
 * — a half-repainted panel is worse than a pale one.
 *
 * A pale tint keeps stamping the slot title alone, as it always has: the
 * deck's ordinary ink is legible on it, and colouring every paragraph of every
 * existing scene would move every golden to say nothing new.
 */
function inkBlocks(blocks, panel) {
  const { ink } = panelStyle(panel);
  if (panel.tone !== 'solid' || !ink) return blocks;
  return blocks.map((b) => (INKED_BLOCKS.has(b.type) ? { ...b, color: ink } : b));
}

/** Validates a parameter value against its spec; returns the value (copied
 *  if a list), throws an Error otherwise. */
function checkParam(layoutName, key, spec, value) {
  const fail = (why) => {
    throw new Error(`parameter "${key}" of "${layoutName}": ${why}`);
  };
  switch (spec.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail('true or false expected');
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('number expected');
      if (spec.integer && !Number.isInteger(value)) fail('integer expected');
      if (value < spec.min || value > spec.max)
        fail(`${value} outside the domain ${spec.min}–${spec.max}`);
      return value;
    case 'enum': {
      if (typeof value !== 'string' || !spec.values.includes(value)) {
        const hint = typeof value === 'string' ? closest(value, spec.values) : null;
        fail(
          `"${value}" invalid${hint ? ` — did you mean "${hint}"?` : ''} (values: ${spec.values.join(', ')})`,
        );
      }
      return value;
    }
    case 'enum-list': {
      if (!Array.isArray(value) || !value.length)
        fail(`non-empty list expected (values: ${spec.values.join(', ')})`);
      if (value.length > 16) fail('list too long (16 values maximum)');
      for (const v of value) {
        if (typeof v !== 'string' || !spec.values.includes(v)) {
          const hint = typeof v === 'string' ? closest(v, spec.values) : null;
          fail(
            `"${v}" invalid${hint ? ` — did you mean "${hint}"?` : ''} (values: ${spec.values.join(', ')})`,
          );
        }
      }
      return [...value];
    }
    case 'number-list': {
      if (!Array.isArray(value) || !value.length) fail('non-empty list of numbers expected');
      if (value.length > 16) fail('list too long (16 values maximum)');
      if (spec.items && value.length !== spec.items) fail(`exactly ${spec.items} values expected`);
      for (const v of value) {
        if (typeof v !== 'number' || !Number.isFinite(v)) fail('numbers expected');
        if (spec.integer && !Number.isInteger(v)) fail('integers expected');
        if (v < spec.min || v > spec.max) fail(`${v} outside the domain ${spec.min}–${spec.max}`);
      }
      if (spec.sumMax && value.reduce((s, v) => s + v, 0) > spec.sumMax)
        fail(`the sum exceeds ${spec.sumMax}`);
      return [...value];
    }
    default:
      return fail(`unknown spec type "${spec.type}" (inconsistent built-in schema)`);
  }
}

/** Parameter schema of a layout's BASE (the built-in generator) — {} if the
 *  base has no parameters, null if the layout is unknown. */
export function layoutParamSchema(name) {
  const def = REGISTRY.get(name);
  if (!def) return null;
  const root = def.builtin ? def : REGISTRY.get(def.base);
  return root?.paramSchema ?? {};
}

/** Effective parameters of a layout: the generator's defaults, overridden by
 *  the def (official or user alias). {} if the layout is unknown. */
export function layoutParams(name) {
  const def = REGISTRY.get(name);
  if (!def) return {};
  const root = def.builtin ? def : REGISTRY.get(def.base);
  const out = {};
  for (const [k, s] of Object.entries(root?.paramSchema ?? {})) {
    out[k] = Array.isArray(s.default) ? [...s.default] : s.default;
  }
  return Object.assign(out, def.params);
}

/** Layouts that `<!-- layout: … -->` can impose (a live view of the
 *  registry, the source of truth for validation and `capabilities()`). The
 *  "structured" layouts (comparison, pillars, timeline, layers, swot) — and
 *  user layouts — are never inferred: they express an intent (to compare, to
 *  mark milestones, to stack…) that the content alone does not reveal — they
 *  are asked for explicitly. */
export const LAYOUTS = [];

/** Number of `##` sections expected by the column-based or structured
 *  layouts (a live view of the registry, the source of truth for validation
 *  AND for the placement bounds of the buildScenes switch): the surplus is
 *  removed without any other trace — validation is the only place to
 *  report it. */
export const LAYOUT_SECTIONS = {};

const LAYOUT_NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** Keys common to every definition — any other key name is a parameter of
 *  the base generator (validated against its paramSchema). */
const RESERVED_KEYS = ['name', 'base', 'sections', 'description'];

/**
 * Registers a layout. Non-built-in definitions (official or user) require a
 * built-in or official `base` whose placement they inherit; their `sections`
 * bounds must fit inside those of the base, and their other keys are
 * parameters validated against the generator's paramSchema. An alias of an
 * official layout is FLATTENED at registration (base = built-in generator,
 * the official's parameters merged underneath its own). Throws an Error on
 * the first invalid definition — loadUserLayouts() and the official catalog
 * loader turn it into a diagnostic.
 */
export function registerLayout(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def))
    throw new Error('layout definition expected (JSON object)');
  const {
    name,
    base,
    sections,
    description,
    builtin = false,
    official = false,
    origin = null,
    paramSchema = null,
  } = def;
  if (typeof name !== 'string' || !LAYOUT_NAME_RE.test(name))
    throw new Error(`name "${name}" invalid (lowercase, digits and hyphens, e.g. "before-after")`);
  if (REGISTRY.has(name)) {
    const prior = REGISTRY.get(name);
    const what = prior.builtin
      ? 'built-in layout'
      : prior.official
        ? 'official catalog layout'
        : prior.origin
          ? `layout provided by the ${prior.origin} theme`
          : 'user layout already loaded';
    throw new Error(
      `the layout "${name}" already exists (${what})${
        prior.official
          ? ' — remove or rename the local definition: the official definition already applies'
          : ''
      }`,
    );
  }
  let baseDef = null;
  if (!builtin) {
    if (typeof base !== 'string' || !REGISTRY.has(base)) {
      const hint = typeof base === 'string' ? closest(base, [...REGISTRY.keys()]) : null;
      throw new Error(
        `unknown base "${base ?? '(missing)'}"${hint ? ` — did you mean "${hint}"?` : ''} (built-in layouts: ${[...REGISTRY.keys()].filter((n) => REGISTRY.get(n).builtin).join(', ')})`,
      );
    }
    baseDef = REGISTRY.get(base);
    if (!baseDef.builtin && !baseDef.official)
      throw new Error(
        `base "${base}" is a user layout — inherit from a built-in or official layout`,
      );
  }
  // ultimate built-in generator (an official one already points at its own)
  const rootDef = baseDef ? (baseDef.builtin ? baseDef : REGISTRY.get(baseDef.base)) : null;
  let bounds = null;
  if (sections != null) {
    const { min, max } = sections;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min)
      throw new Error(`sections of "${name}" invalid (integer min/max, 1 ≤ min ≤ max)`);
    bounds = { min, max };
    const ref = baseDef?.sections;
    if (ref && (min < ref.min || max > ref.max))
      throw new Error(
        `sections of "${name}" (${min}–${max}) outside the bounds of base "${base}" (${ref.min}–${ref.max})`,
      );
  } else if (baseDef?.sections) {
    bounds = { ...baseDef.sections }; // inherited from the base
  }
  let params = null;
  if (!builtin) {
    const schema = rootDef?.paramSchema ?? {};
    const paramNames = Object.keys(schema);
    for (const [key, value] of Object.entries(def)) {
      if (
        RESERVED_KEYS.includes(key) ||
        key === 'builtin' ||
        key === 'official' ||
        key === 'origin'
      )
        continue;
      const spec = schema[key];
      if (!spec) {
        const hint = closest(key, paramNames);
        throw new Error(
          `unknown parameter "${key}" for base "${rootDef?.name ?? base}"${hint ? ` — did you mean "${hint}"?` : ''}${
            paramNames.length
              ? ` (parameters: ${paramNames.join(', ')})`
              : ' (this base has no parameters)'
          }`,
        );
      }
      (params ??= {})[key] = checkParam(name, key, spec, value);
    }
    // alias of an official one: its inherited settings, its own on top
    if (baseDef && !baseDef.builtin && baseDef.params) params = { ...baseDef.params, ...params };
  }
  const entry = {
    name,
    ...(builtin ? { builtin: true } : { base: rootDef.name }),
    ...(official ? { official: true } : {}),
    ...(origin ? { origin } : {}),
    ...(bounds ? { sections: bounds } : {}),
    ...(params ? { params } : {}),
    ...(typeof description === 'string' && description.trim()
      ? { description: description.trim() }
      : {}),
  };
  if (builtin && paramSchema) entry.paramSchema = paramSchema;
  REGISTRY.set(name, entry);
  LAYOUTS.push(name);
  if (bounds) LAYOUT_SECTIONS[name] = bounds;
  return entry;
}

// built-in layouts — placement lives in the buildScenes switch; each one's
// paramSchema exposes its settings to the JSON layouts (default = historical
// behaviour, the switch's literals turned into parameters)
[
  { name: 'cover', description: 'title slide: deck title, subtitle and date on the cover surface' },
  {
    name: 'section',
    description: 'chapter divider: a numbered section title on an accent surface',
  },
  { name: 'hero', description: 'full-bleed opener: a background visual under the title block' },
  { name: 'quote', description: 'a single quotation set large, with its attribution' },
  {
    name: 'metrics',
    description: 'a row of metric cards: value, label and trend delta',
    paramSchema: {
      max: {
        type: 'number',
        min: 1,
        max: 6,
        integer: true,
        default: 4,
        description: 'cap on displayed cards (the surplus is reported by METRICS_DROPPED)',
      },
      cardHeight: {
        type: 'number',
        min: 120,
        max: 320,
        integer: true,
        default: 176,
        description: 'card height (px)',
      },
      align: alignParam('the text placed under the cards'),
    },
  },
  {
    name: 'split',
    description: 'text beside a visual, split by an adjustable ratio',
    paramSchema: {
      ratio: {
        type: 'number',
        min: 0.2,
        max: 0.8,
        default: 0.42,
        description: 'share of the width taken by the text (the visual takes the rest)',
      },
      side: {
        type: 'enum',
        values: ['right', 'left'],
        default: 'right',
        description: 'side of the visual (![left](…) forces it image by image)',
      },
    },
  },
  {
    name: 'two-columns',
    description: 'two equal columns, one ## section each',
    sections: { min: 2, max: 2 },
  },
  {
    name: 'three-columns',
    description: 'three equal columns, one ## section each',
    sections: { min: 3, max: 3 },
  },
  {
    name: 'comparison',
    description: 'two panels side by side, muted versus highlighted',
    sections: { min: 2, max: 2 },
    paramSchema: {
      panels: panelsParam(['muted', 'highlight'], 'column'),
      pad: {
        type: 'number',
        min: 0,
        max: 48,
        integer: true,
        default: 16,
        description: 'inner padding of the panels (px)',
      },
      density: densityParam(),
      radius: radiusParam(),
    },
  },
  {
    name: 'pillars',
    description: 'upright panels with an accent bar, one per ## section',
    sections: { min: 2, max: 4 },
    paramSchema: {
      panels: panelsParam(['pillar'], 'pillar'),
      accent: { type: 'boolean', default: true, description: 'accent bar at the top of pillars' },
      density: densityParam(),
      radius: radiusParam(),
    },
  },
  {
    name: 'timeline',
    description: 'milestones as dots along an axis, horizontal or vertical',
    sections: { min: 2, max: 6 },
    paramSchema: {
      dot: {
        type: 'number',
        min: 20,
        max: 48,
        integer: true,
        default: 28,
        description: 'diameter of the dots (px)',
      },
      arrow: { type: 'boolean', default: true, description: 'arrowhead at the end of the axis' },
      numbered: {
        type: 'boolean',
        default: true,
        description: 'numbered dots (otherwise solid)',
      },
      orientation: {
        type: 'enum',
        values: ['horizontal', 'vertical'],
        default: 'horizontal',
        description: 'horizontal axis, or vertical on the left (roadmap in a column)',
      },
    },
  },
  {
    name: 'layers',
    description: 'stacked horizontal bands — also a funnel or a pyramid',
    sections: { min: 2, max: 5 },
    paramSchema: {
      ratios: {
        type: 'number-list',
        min: 0.1,
        max: 0.9,
        items: 2,
        sumMax: 1,
        default: [0.3, 0.68],
        description: 'width shares of a band, title / body',
      },
      shades: {
        type: 'number-list',
        min: 0,
        max: 4,
        integer: true,
        default: null,
        description: 'LAYER_SHADES indices per layer, cycling (default: dark to light)',
      },
      shape: {
        type: 'enum',
        values: ['stack', 'funnel', 'pyramid'],
        default: 'stack',
        description: 'full-width bands (stack), a funnel (narrowing) or a pyramid (widening)',
      },
      density: densityParam(),
    },
  },
  {
    name: 'swot',
    description: 'four semantic quadrants: strengths, weaknesses, opportunities, threats',
    sections: { min: 4, max: 4 },
    paramSchema: {
      kinds: {
        type: 'enum-list',
        values: SEMANTIC_KINDS,
        default: ['success', 'danger', 'info', 'warning'],
        description: 'semantic tint per quadrant (cycling)',
      },
      density: densityParam(),
    },
  },
  {
    name: 'grid',
    description: 'a mosaic of cells over a configurable number of columns',
    sections: { min: 2, max: 8 },
    paramSchema: {
      cols: {
        type: 'number',
        min: 1,
        max: 4,
        integer: true,
        default: 2,
        description: 'number of columns in the mosaic',
      },
      panels: panelsParam(['muted'], 'cell'),
      kinds: {
        type: 'enum-list',
        values: SEMANTIC_KINDS,
        default: null,
        description: 'semantic tints per cell, cycling (takes precedence over panels)',
      },
      spans: {
        type: 'number-list',
        min: 1,
        max: 4,
        integer: true,
        default: null,
        description:
          'columns each cell occupies, cycling — a cell that no longer fits opens the next row',
      },
      headed: {
        type: 'boolean',
        default: false,
        description: 'detached header per cell (title + rule)',
      },
      density: densityParam(),
      radius: radiusParam(),
      align: alignParam('the text inside the cells'),
    },
  },
  {
    name: 'steps',
    description: 'a left-to-right sequence of steps joined by connectors',
    sections: { min: 2, max: 6 },
    paramSchema: {
      connector: {
        type: 'enum',
        values: ['arrow', 'line', 'none'],
        default: 'arrow',
        description: 'link between steps: arrow, line or nothing',
      },
      panels: panelsParam(['muted'], 'step'),
      density: densityParam(),
      radius: radiusParam(),
    },
  },
  {
    name: 'focus',
    description: 'one key message set large in the middle of the slide',
    paramSchema: {
      align: {
        // its own spec rather than alignParam(): the key message is CENTERED
        // by default — the only generator where left is not the natural value
        type: 'enum',
        values: ['left', 'center', 'right'],
        default: 'center',
        description: 'alignment of the key message',
      },
      accent: {
        type: 'boolean',
        default: true,
        description: 'accent bar above the message',
      },
      scale: {
        type: 'number',
        min: 0.5,
        max: 2.5,
        default: 1,
        description: 'size factor of the key message',
      },
    },
  },
  { name: 'table', description: 'a slide-wide table from the markdown table' },
  { name: 'code', description: 'a syntax-highlighted code block on its own slide' },
  { name: 'diagram', description: 'a mermaid diagram rendered slide-wide' },
  { name: 'chart', description: 'a chart block rendered slide-wide' },
  {
    name: 'content',
    description: 'the default flow: headings, bullets and blocks top to bottom',
    paramSchema: { density: densityParam(), align: alignParam('the blocks in the flow') },
  },
].forEach((def) => registerLayout({ ...def, builtin: true }));

// ---------------------------------------------------------------------------
// OFFICIAL layouts (review §3.3, step 3, phase C): a pure-data catalog
// shipped with the product (design/layouts/*.json), built on the bases —
// registered at load time, never reset per deck. Each file follows the user
// layout schema (base + sections + parameters): the catalog documents the
// bases by example and serves as living test fixtures.
// ---------------------------------------------------------------------------

const OFFICIAL_DIR = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  'design',
  'layouts',
);

/** Problems loading the official catalog (a broken installation) — surfaced
 *  as diagnostics by prepareDeckContext on every compilation. */
export const OFFICIAL_LAYOUT_DIAGS = [];

/**
 * Registers the official catalogue found in `dir`, and returns what went
 * wrong rather than throwing — the caller is module scope, and a throw here
 * would take the whole compiler down on a broken installation.
 *
 * **The catalogue being ABSENT is a diagnostic, not a silence.** It used to be
 * a bare `catch {}` reasoning that "the built-in bases are enough": they are
 * not. Each of the twelve official layouts is a base plus its geometry, so an
 * empty catalogue does not remove `layout: journey` — it renders it as its
 * bare base, at the wrong proportions, and reports `stats.warnings === []`. A
 * deck comes out looking deliberate and wrong, in the CLI and in VS Code
 * alike, with nothing anywhere to read as a defect.
 *
 * An empty directory is the same failure as an unreadable one and says so the
 * same way: `readdirSync` throws on a missing package directory, and returns
 * `[]` when the files were simply never copied — which is exactly what a
 * browser's read-only filesystem shim does.
 *
 * Exported so the failure can be exercised: the module-scope call below reads
 * a directory that is always there in a sound installation, which is why this
 * went unnoticed for so long.
 */
export function loadOfficialLayouts(dir = OFFICIAL_DIR) {
  const diags = [];
  const broken = (why) => {
    diags.push({
      severity: 'warning',
      code: 'LAYOUT_CATALOG_MISSING',
      message: `Official layout catalogue ${why} (${dir}) — the official layouts fall back on their bare bases and their geometry will be wrong. Reinstall the package.`,
    });
    return diags;
  };

  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((x) => x.toLowerCase().endsWith('.json'))
      .sort();
  } catch (e) {
    return broken(`unreadable: ${e?.message ?? e}`);
  }
  if (!files.length) return broken('holds no layout at all');

  for (const f of files) {
    try {
      // builtin/official forced: a data file never decides its own level of
      // privilege in the registry
      registerLayout({
        ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
        builtin: false,
        official: true,
      });
    } catch (e) {
      diags.push({
        severity: 'warning',
        code: 'LAYOUT_DEF_INVALID',
        message: `Official layout design/layouts/${f}: ${e?.message ?? e} — ignored.`,
      });
    }
  }
  return diags;
}

OFFICIAL_LAYOUT_DIAGS.push(...loadOfficialLayouts());

/** Definition of a registered layout (null if unknown). */
export const layoutDef = (name) => REGISTRY.get(name) ?? null;

/** User layouts currently registered (for capabilities()). */
export const userLayouts = () => [...REGISTRY.values()].filter((d) => !d.builtin && !d.official);

/** Official layouts of the design/layouts/ catalog (for capabilities()). */
export const officialLayouts = () => [...REGISTRY.values()].filter((d) => d.official);

/** Removes every user layout — called at the head of each compilation: a
 *  warm worker must never serve one deck the layouts of another. The
 *  built-in AND the official ones stay. */
export function resetUserLayouts() {
  for (const [name, def] of REGISTRY) {
    if (def.builtin || def.official) continue;
    REGISTRY.delete(name);
    delete LAYOUT_SECTIONS[name];
  }
  LAYOUTS.splice(0, LAYOUTS.length, ...REGISTRY.keys());
}

/**
 * Tolerant loader for a directory of JSON layouts (one file = one
 * definition). Never throws: every invalid file becomes a diagnostic and is
 * ignored. `describe(f)` labels the file in the messages; `origin` (the name
 * of the theme package) is set on the registry entry so collision messages
 * can be attributed.
 */
function loadLayoutDir(dir, describe, origin = null) {
  const diags = [];
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort();
  } catch {
    return diags; // no directory: nothing to load
  }
  for (const f of files) {
    const file = path.join(dir, f);
    let def;
    try {
      def = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      diags.push({
        severity: 'warning',
        code: 'LAYOUT_DEF_INVALID',
        message: `Layout ${describe(f)} could not be read (invalid JSON: ${e?.message ?? e}) — ignored.`,
      });
      continue;
    }
    registerUserLayoutDef(def, describe(f), origin, diags);
  }
  return diags;
}

/**
 * Validates and registers ONE already-parsed definition — the code shared by
 * the disk loader (loadLayoutDir) and the in-memory kit overlay
 * (loadThemeLayoutDefs), so both produce the same registry entries and the
 * same LAYOUT_DEF_* diagnostics. `label` names the definition in the
 * messages the way a file path would.
 */
function registerUserLayoutDef(def, label, origin, diags) {
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    // shallow copy: the unknown-key filter below must never mutate the
    // caller's object (an in-memory definition belongs to the host)
    def = { ...def };
    // accepted keys: the four common ones + the parameters of the base's
    // generator — if the base does not resolve, nothing is filtered (it is
    // the base itself that registerLayout will report)
    const schema = typeof def.base === 'string' ? layoutParamSchema(def.base) : null;
    if (schema) {
      const known = new Set([...RESERVED_KEYS, ...Object.keys(schema)]);
      for (const key of Object.keys(def)) {
        if (known.has(key)) continue;
        diags.push({
          severity: 'warning',
          code: 'LAYOUT_DEF_ADJUSTED',
          message: `Layout ${label}: unknown key "${key}" — ignored.`,
          ...(closest(key, [...known]) ? { suggestion: closest(key, [...known]) } : {}),
        });
        delete def[key];
      }
    }
  }
  try {
    // builtin/official/origin forced: a data file cannot register a layout
    // that would survive the reset (a ghost leaking between the decks of a
    // warm host), pass itself off as an official one, or claim a
    // provenance of its own
    registerLayout({ ...def, builtin: false, official: false, origin });
  } catch (e) {
    diags.push({
      severity: 'warning',
      code: 'LAYOUT_DEF_INVALID',
      message: `Layout ${label}: ${e?.message ?? e} — ignored.`,
    });
  }
}

/**
 * Loads the user layouts from the `layouts/` directory next to the deck.
 *
 * @returns {Array<{severity, code, message, suggestion?}>}
 */
export function loadUserLayouts(baseDir) {
  return loadLayoutDir(path.join(baseDir, 'layouts'), (f) => `layouts/${f}`);
}

/**
 * Loads the layouts provided by a KIT (the layouts/ directory resolved by
 * resolveTheme from the kit.json). Registered at user level — so reloaded on
 * every compilation by prepareDeckContext, never leaking between the decks of
 * a warm host — but attributed to the kit (`origin`) so collisions are
 * explicit. Loaded BEFORE the deck's own layouts: on a duplicate, it is the
 * deck's definition that is reported and ignored.
 *
 * @returns {Array<{severity, code, message, suggestion?}>}
 */
export function loadThemeLayouts(dir, kitName) {
  return loadLayoutDir(dir, (f) => `${kitName}/layouts/${f}`, kitName);
}

/**
 * Registers KIT layout definitions supplied IN MEMORY (kitData.layouts — a
 * kit editor previewing unsaved files) in place of the kit's layouts/
 * directory: same level (user — reset on every compilation), same `origin`
 * attribution, same LAYOUT_DEF_* diagnostics as loadThemeLayouts. An empty
 * array is a kit without layouts — nothing is read from disk either way.
 *
 * @param {Array<object>} defs  one entry per layouts/*.json file content
 * @param {string|null} kitName provenance shown in collision messages
 * @returns {Array<{severity, code, message, suggestion?}>}
 */
export function loadThemeLayoutDefs(defs, kitName) {
  const diags = [];
  defs.forEach((def, k) => {
    // label the definition the way a file path would — by its name when it
    // has one, by its position otherwise (an invalid one may have neither)
    const name =
      def && typeof def === 'object' && typeof def.name === 'string' ? def.name : `#${k + 1}`;
    registerUserLayoutDef(def, `${kitName ?? 'kit'}/layouts/${name}`, kitName, diags);
  });
  return diags;
}

export function inferLayout(slide, index) {
  if (slide.layout) return slide.layout;
  const blocks = flat(slide);
  const visuals = blocks.filter(
    (b) =>
      b.type === 'mermaid' || b.type === 'chart' || (b.type === 'image' && b.role !== 'background'),
  );
  const textual = blocks.filter((b) => ['bullets', 'para'].includes(b.type));

  if (blocks.some((b) => b.type === 'image' && (b.role === 'cover' || b.role === 'background')))
    return 'hero';
  // cover/section with no content — but NOT when the slide sketches an outline
  // in columns: two (or three) `##` headings without a body are content that
  // the early return silently threw away (elements=0). We now let it fall
  // through to two-columns/three-columns, which do render those titles. A
  // single heading under a cover stays a cover (the section subtitle is
  // decorative there).
  if (!blocks.length && slide.sections.filter((s) => s.heading).length < 2)
    return index === 0 ? 'cover' : 'section';
  if (
    index === 0 &&
    !slide.sections.some((s) => s.heading) &&
    blocks.every((b) => b.type === 'para') &&
    blocks.length <= 2
  )
    return 'cover';
  if (count(blocks, 'metric') >= 2 && count(blocks, 'metric') >= blocks.length - 1)
    return 'metrics';
  if (blocks.length === 1 && blocks[0].type === 'quote') return 'quote';
  const sections = slide.sections.filter((s) => s.heading || s.blocks.length);
  if (visuals.length && textual.length) return 'split';
  if (count(blocks, 'table') && blocks.length <= 2) return 'table';
  if (sections.filter((s) => s.heading).length === 2) return 'two-columns';
  if (sections.filter((s) => s.heading).length === 3) return 'three-columns';
  if (blocks.length === 1 && blocks[0].type === 'code') return 'code';
  if (blocks.length === 1 && blocks[0].type === 'mermaid') return 'diagram';
  if (blocks.length === 1 && blocks[0].type === 'chart') return 'chart';
  return 'content';
}

// ---------------------------------------------------------------------------
// Passes 2 and 3 — placement + pagination
// ---------------------------------------------------------------------------

/** Density steps, from the deck's default down — the ladder auto-fit walks.
 *  TEXT_DENSITY declares them in that order and densityParam() publishes the
 *  same keys, so a theme adding a step cannot desynchronise the two. */
const DENSITY_LADDER = Object.keys(TEXT_DENSITY);

/** Slack (px) a region is granted before the engine calls it an overflow.
 *  Shared with the BLOCK_OVERFLOW audit (validate.mjs): with two thresholds
 *  the engine would either densify regions it never flags — invisible
 *  shrinking — or flag regions it could have fitted. */
export const OVERFLOW_TOLERANCE = 12;

/**
 * One pass of the flow, at a fixed text scale.
 *
 * `overflow` is how far past the region's bottom the content REALLY asks to
 * go, measured on the ESTIMATED heights and not on the placed ones: a block
 * taller than the whole region is placed clamped to it, and would otherwise
 * measure as a perfect fit — which is precisely the case auto-fit exists for.
 */
function flowOnce(blocks, region, paginate) {
  const pages = [];
  let page = [];
  let y = region.y;
  let wanted = region.y;

  const place = (block, h, need = h) => {
    page.push({ block, region: { x: region.x, y, w: region.w, h } });
    wanted = Math.max(wanted, y + need);
    y += h + SPACE.sm;
  };
  const breakPage = () => {
    if (page.length) pages.push(page);
    page = [];
    y = region.y;
  };
  const fits = (h) => y + h <= region.y + region.h;

  for (const block of blocks) {
    const rawH = blockHeight(block, region.w);

    if (!fits(rawH) && paginate) {
      // fine-grained splitting for divisible blocks
      // working copy: shift() must never empty the block held by the IR
      // (the deck has to stay reusable — inspect, a second render)
      if (block.type === 'bullets') {
        const rest = [...block.items];
        // A numbered list that gets split must carry on its numbering on the
        // next slide: without a starting rank, the audience reads "1." twice.
        // Only top-level items count — sub-lists have their own numbering,
        // which does restart at 1 under each parent. The starting rank may
        // already be set: `parse` also splits lists, at the point where a
        // table or a code block comes in between. Starting from 1 here would
        // shift the whole pagination of a chunk cut that way.
        let rank = block.startAt ?? 1;
        while (rest.length) {
          const taken = [];
          while (rest.length) {
            const trial = { ...block, items: [...taken, rest[0]] };
            if (!fits(blockHeight(trial, region.w)) && taken.length) break;
            taken.push(rest.shift());
          }
          const chunk = { ...block, items: taken };
          if (block.ordered && rank > 1) chunk.startAt = rank;
          rank += taken.filter((it) => !it.level).length;
          place(chunk, blockHeight(chunk, region.w));
          if (rest.length) breakPage();
        }
        continue;
      }
      if (block.type === 'table') {
        const rest = [...block.rows];
        while (rest.length) {
          const taken = [];
          while (rest.length) {
            const trial = { ...block, rows: [...taken, rest[0]] };
            if (!fits(blockHeight(trial, region.w)) && taken.length) break;
            taken.push(rest.shift());
          }
          place({ ...block, rows: taken }, blockHeight({ ...block, rows: taken }, region.w));
          if (rest.length) breakPage();
        }
        continue;
      }
      breakPage();
    }
    place(block, Math.min(rawH, region.h), rawH);
  }
  breakPage();
  return {
    pages: pages.length ? pages : [[]],
    overflow: wanted - (region.y + region.h),
  };
}

/**
 * Flows blocks into a region; returns pages of placed elements.
 *
 * Auto-fit: where the region is bounded — `paginate: false`, which is every
 * panel, every column, every cell — content that does not fit is re-flowed one
 * step down the text scale, as far as `dense` and no further. Three properties,
 * each of them a candidate mistake:
 *
 *   - the WHOLE region steps down, never the offending block alone: three type
 *     sizes in one panel reads as a bug rather than as a fit;
 *   - the step is DISCRETE — a continuous best-fit factor would give every
 *     panel a size of its own and make the goldens meaningless;
 *   - the floor is HONEST: below `dense` the engine stops and lets
 *     BLOCK_OVERFLOW say so. Text at 6 pt is not a fit, it is a failure with
 *     the evidence hidden.
 *
 * Where pagination is on, IT wins and nothing is densified: a flow layout has
 * somewhere to put the overflow, and shrinking instead would silently trade a
 * legible second slide for a cramped single one.
 *
 * A re-flow is a second pass over the same blocks — pure measurement, no I/O —
 * and two re-flows a third. Measured rather than assumed: a ten-slide board of
 * eight panels whose every panel walks the whole ladder lays out in 0.18 ms,
 * against 0.12 ms when nothing moves. Nothing to optimise against the seconds
 * Mermaid, fonts and image embedding cost.
 */
function flowBlocks(blocks, region, { paginate = true, density = 'comfortable' } = {}) {
  const first = Math.max(0, DENSITY_LADDER.indexOf(density));
  // only while the scale has something to bite on: a region holding nothing
  // but a diagram, an image or a code block does not shrink by a single pixel,
  // and reporting a densification the rendering denies is worse than silence
  const shrinkable = !paginate && blocks.some((b) => SIZED_BLOCKS.has(b.type));
  let step = first;
  let flowed = flowOnce(scaleBlocks(blocks, DENSITY_LADDER[step]), region, paginate);
  while (shrinkable && flowed.overflow > OVERFLOW_TOLERANCE && step < DENSITY_LADDER.length - 1) {
    step++;
    // re-scaled from the ORIGINAL blocks, never from the previous attempt: a
    // factor applied twice would land on a size the scale does not have
    flowed = flowOnce(scaleBlocks(blocks, DENSITY_LADDER[step]), region, paginate);
  }
  if (step > first) {
    // the mark rides on the ELEMENT rather than on the block: it records what
    // the engine did to the region, which is what SLIDE_DENSIFIED reports and
    // what BLOCK_OVERFLOW reads to stop advising what has already been done
    for (const page of flowed.pages) for (const el of page) el.densified = DENSITY_LADDER[step];
  }
  return flowed.pages;
}

/**
 * Assigns the animation steps (appear on click) to the elements of a scene.
 * One step = one click. Rules:
 *   - elements sharing a `group` (a column, a `##` section) appear together,
 *     one step per group;
 *   - a bullet list appears point by point (one step per item);
 *   - any other block is a step of its own.
 * The chrome (title, background hero image) is never animated.
 */
function assignAnimSteps(scene) {
  let step = 0;
  let prevGroup = null;
  for (const el of scene.elements) {
    const group = el.group ?? el.block.group;
    if (group != null) {
      if (prevGroup === null || group !== prevGroup) step++;
      prevGroup = group;
      el.step = step - 1;
      continue;
    }
    prevGroup = null;
    if (el.block.type === 'bullets' && el.block.items.length > 1) {
      el.step = step;
      el.stepCount = el.block.items.length;
      step += el.stepCount;
    } else {
      el.step = step++;
    }
  }
  if (step) scene.animSteps = step;
}

/** A last visual alone at the end of the flow stretches to the region's
 *  bottom. */
function stretchTrailingVisual(elements, region) {
  const last = elements[elements.length - 1];
  if (last && ['image', 'mermaid', 'chart'].includes(last.block.type)) {
    last.region.h = Math.max(last.region.h, region.y + region.h - last.region.y);
  }
}

/**
 * Compiles the deck into scenes ready to render.
 * @returns {Array<{master:string, layout:string, title:string|null, titleRuns:any, notes:string[], elements:any[]}>}
 */
export function buildScenes(deck) {
  const scenes = [];
  const meta = deck.meta ?? {};
  const deckAnimate = meta.animate != null && animateFlag(meta.animate);
  const deckPreset = meta.animate != null ? animatePreset(meta.animate) : null;

  // Implicit cover slide from the frontmatter. Not for a Marp deck: there,
  // `title:` is HTML metadata (Marp CLI) and the cover is the deck's own
  // first slide — an implicit one would double it.
  if (meta.title && !isMarpDeck(meta)) {
    scenes.push({
      master: 'cover',
      layout: 'cover',
      title: meta.title,
      subtitle: meta.subtitle ?? '',
      byline: [meta.author, meta.date].filter(Boolean).join(' · '),
      // The generated cover is the ONE slide no `<!-- notes: -->` can reach:
      // there is no slide in the source to hang the comment on. A frontmatter
      // `notes:` is that missing line, and it lands in the .pptx notesSlide
      // and the HTML presenter mode like any other slide's notes.
      // Flat scalar only — the frontmatter reader is a one-line-per-key
      // scanner, so there is no block form to write here.
      // Deliberately NOT done: attaching a `<!-- notes: -->` written before
      // the first heading to this cover. That comment already belongs to the
      // first real slide, and moving it would silently relocate the notes of
      // every deck that has one.
      notes: meta.notes ? [String(meta.notes)] : [],
      elements: [],
      sourceLine: 1,
    });
  }

  deck.slides.forEach((slide, idx) => {
    const layout = inferLayout(slide, scenes.length === 0 ? 0 : idx + 1);
    // user layout (registry): the scene keeps its name, the placement is that
    // of the built-in `base` layout; the section bounds come from the registry
    // (a single source, shared with validation)
    const kind = REGISTRY.get(layout)?.base ?? layout;
    const bounds = LAYOUT_SECTIONS[layout] ?? null;
    // effective generator parameters: the built-in layout's defaults,
    // overridden by the def (official or user) — phase A of §3.3
    const P = layoutParams(layout);
    const area = contentArea();
    const blocks = flat(slide);
    const base = {
      layout,
      title: slide.title,
      titleRuns: slide.titleRuns,
      notes: slide.notes,
      sourceLine: slide.line,
    };
    const animate = slide.animate ?? deckAnimate;
    // effect imposed for the slide (otherwise anim.mjs picks by block type)
    const preset = slide.animatePreset ?? deckPreset;
    const push = (extra) => {
      const scene = { master: 'content', ...base, ...extra };
      if (animate) {
        assignAnimSteps(scene);
        if (scene.animSteps && preset) scene.animPreset = preset;
      }
      scenes.push(scene);
    };

    switch (kind) {
      case 'cover': {
        const paras = blocks.filter((b) => b.type === 'para');
        scenes.push({
          master: 'cover',
          layout,
          title: slide.title ?? meta.title ?? '',
          subtitle: paras[0] ? runsToText(paras[0].runs) : (meta.subtitle ?? ''),
          byline: paras[1]
            ? runsToText(paras[1].runs)
            : [meta.author, meta.date].filter(Boolean).join(' · '),
          notes: slide.notes,
          elements: [],
          sourceLine: slide.line,
        });
        break;
      }
      case 'section': {
        scenes.push({
          master: 'section',
          layout,
          title: slide.title ?? '',
          notes: slide.notes,
          elements: [],
          sourceLine: slide.line,
        });
        break;
      }
      case 'hero': {
        const img = blocks.find((b) => b.type === 'image');
        const rest = blocks.filter((b) => b !== img);
        push({
          master: 'hero',
          image: img,
          elements: flowBlocks(rest, area, { paginate: false })[0],
        });
        break;
      }
      case 'quote': {
        // a slide forced into `quote` may have no block at all (title only,
        // or only content the layout does not place): we emit an EMPTY scene
        // rather than an element without a `block` — both renderers
        // dereference `el.block.type` without a guard and used to crash on it
        push({ elements: blocks.length ? [{ block: blocks[0], region: { ...area } }] : [] });
        break;
      }
      case 'metrics': {
        const metrics = blocks.filter((b) => b.type === 'metric');
        const rest = blocks.filter((b) => b.type !== 'metric');
        const max = P.max ?? 4;
        const cols = Math.min(metrics.length, max);
        const cardW = (area.w - (cols - 1) * PAGE.gutter) / cols;
        const cardH = P.cardHeight ?? 176;
        const elements = metrics.slice(0, max).map((m, k) => ({
          block: m,
          region: {
            x: area.x + k * (cardW + PAGE.gutter),
            y: area.y + SPACE.sm,
            w: cardW,
            h: cardH,
          },
        }));
        // the content under the cards stops at the bottom of the usable area:
        // the height is DERIVED from the region's real top, it is not
        // recomputed from area.h (which forgot the SPACE.sm offsetting the
        // cards and overflowed 16 px below the footer)
        const belowY = area.y + cardH + SPACE.lg + SPACE.sm;
        const below = { x: area.x, y: belowY, w: area.w, h: Math.max(0, area.y + area.h - belowY) };
        elements.push(...flowBlocks(alignBlocks(rest, P.align), below, { paginate: false })[0]);
        push({ elements });
        break;
      }
      case 'split': {
        const isVisual = (b) =>
          b.type === 'mermaid' ||
          b.type === 'chart' ||
          (b.type === 'image' && b.role !== 'background');
        // A "##" is CONTENT, not decoration, and flat() does not carry it: a
        // split flowing only section.blocks dropped the heading its author
        // wrote, in both outputs and without a word. `content` has always
        // turned it back into a block — the same treatment here, in the text
        // column where it belongs.
        const written = slide.sections
          .filter((s) => s.heading || s.blocks.length)
          .flatMap((s) =>
            s.heading ? [{ type: 'heading', depth: 2, runs: s.heading }, ...s.blocks] : s.blocks,
          );
        const visuals = written.filter(isVisual);
        const text = written.filter((b) => !isVisual(b));
        const flip = P.side === 'left' || visuals.some((b) => b.role === 'left'); // visual left
        const leftW = Math.round((area.w - PAGE.gutter) * (P.ratio ?? 0.42));
        const rightW = area.w - PAGE.gutter - leftW;
        // No visual, no column: a layout whose `ratio`/`side` reserve a narrow
        // strip left a hollow gutter down the slide when the slide it was
        // applied to had nothing to put in it. The text takes the area back.
        const textRegion = !visuals.length
          ? { ...area }
          : flip
            ? { x: area.x + rightW + PAGE.gutter, y: area.y, w: leftW, h: area.h }
            : { x: area.x, y: area.y, w: leftW, h: area.h };
        const visRegion = flip
          ? { x: area.x, y: area.y, w: rightW, h: area.h }
          : { x: area.x + leftW + PAGE.gutter, y: area.y, w: rightW, h: area.h };
        const elements = flowBlocks(text, textRegion, { paginate: false })[0];
        const visH = (visRegion.h - (visuals.length - 1) * PAGE.gutter) / visuals.length;
        visuals.forEach((v, k) =>
          elements.push({
            block: v,
            region: { ...visRegion, y: visRegion.y + k * (visH + PAGE.gutter), h: visH },
          }),
        );
        push({ elements });
        break;
      }
      case 'two-columns':
      case 'three-columns': {
        const sections = slide.sections.filter((s) => s.heading || s.blocks.length);
        // LEAD: what is written BEFORE the first "##" is not a column — it is
        // an opening. It flows full width above, and the columns start again
        // underneath it. Without this it consumed a column and the LAST
        // titled section vanished without a word: the engine only drops
        // content at the bounds the registry announces (LAYOUT_SECTIONS,
        // which validation reports), never by an accident of writing. A slide
        // forced into columns WITHOUT any "##" keeps its original placement:
        // its single anonymous section stays a column.
        const lead =
          sections.length && !sections[0].heading && sections.some((s) => s.heading)
            ? sections.shift()
            : null;
        const nCols = bounds?.max ?? (kind === 'two-columns' ? 2 : 3);
        const colW = (area.w - (nCols - 1) * PAGE.gutter) / nCols;
        const elements = [];
        let top = area.y;
        if (lead) {
          const flowed = flowBlocks(lead.blocks, { ...area }, { paginate: false })[0];
          flowed.forEach((el) => {
            el.group = 0;
          }); // animation: the lead = one step
          elements.push(...flowed);
          // the lead is NOT bounded in height: auto-fit will have tried the
          // scale on it, and if it still eats the slide it is BLOCK_OVERFLOW
          // (validate) that says so — the engine shrinks, it never trims what
          // the author wrote
          top = flowed.reduce((m, el) => Math.max(m, el.region.y + el.region.h), area.y) + SPACE.md;
        }
        const colH = Math.max(0, area.y + area.h - top);
        sections.slice(0, nCols).forEach((sec, k) => {
          const col = { x: area.x + k * (colW + PAGE.gutter), y: top, w: colW, h: colH };
          const colBlocks = sec.heading
            ? [{ type: 'heading', depth: 2, runs: sec.heading }, ...sec.blocks]
            : sec.blocks;
          const flowed = flowBlocks(colBlocks, col, { paginate: false })[0];
          stretchTrailingVisual(flowed, col);
          // animation: one column = one step, after the lead's
          flowed.forEach((el) => {
            el.group = lead ? k + 1 : k;
          });
          elements.push(...flowed);
        });
        push({ elements });
        break;
      }
      case 'comparison':
      case 'pillars': {
        // panels side by side: a comparison (current state understated /
        // target highlighted) or pillars (architecture principles, accent on
        // top) — per-column variants configurable (`panels`, cycling)
        const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
        const nCols =
          kind === 'comparison'
            ? (bounds?.max ?? 2)
            : Math.min(Math.max(secs.length, bounds?.min ?? 2), bounds?.max ?? 4);
        const colW = (area.w - (nCols - 1) * PAGE.gutter) / nCols;
        const pad = P.pad ?? SPACE.sm;
        const panels = P.panels ?? (kind === 'comparison' ? ['muted', 'highlight'] : ['pillar']);
        const elements = [];
        secs.slice(0, nCols).forEach((sec, k) => {
          const col = {
            x: area.x + k * (colW + PAGE.gutter),
            y: area.y + SPACE.xs,
            w: colW,
            h: area.h - SPACE.xs,
          };
          const panel = panelFrom(panels[k % panels.length]);
          const accented = panel.variant === 'pillar' && P.accent !== false;
          const block = {
            type: 'panel',
            ...panel,
            ...(panel.variant === 'pillar' && P.accent === false ? { accent: false } : {}),
            ...(P.radius ? { radius: P.radius } : {}),
          };
          elements.push({ block, region: { ...col }, group: k });
          const padTop = accented ? SPACE.md : pad; // room for the accent
          const inner = {
            x: col.x + pad,
            y: col.y + padTop,
            w: col.w - 2 * pad,
            h: col.h - padTop - pad,
          };
          const ink = panelStyle(block).ink;
          const colBlocks = sec.heading
            ? [
                { type: 'heading', depth: 2, runs: sec.heading, ...(ink ? { color: ink } : {}) },
                ...sec.blocks,
              ]
            : sec.blocks;
          const flowed = flowBlocks(inkBlocks(colBlocks, block), inner, {
            paginate: false,
            density: P.density,
          })[0];
          flowed.forEach((el) => {
            el.group = k;
          }); // animation: one panel = one step
          elements.push(...flowed);
        });
        push({ elements });
        break;
      }
      case 'timeline': {
        // milestones on an axis: each `##` section is a step (a phase, a
        // date); a dot on the axis, content beside it — horizontal axis
        // (default) or vertical on the left (roadmap in a column)
        const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
        // lower bound at 1 (not the registry min): a single section still
        // renders one milestone — validation reports the shortfall, no blank
        const n = Math.min(Math.max(secs.length, 1), bounds?.max ?? 6);
        const dotR = P.dot ?? 28;
        // only add the attributes for non-default values: the scenes of decks
        // without parameters stay identical (goldens intact)
        const dotBlock = (k) => ({
          type: 'timeline-dot',
          index: k + 1,
          ...(P.numbered === false ? { numbered: false } : {}),
        });
        const axisBlock = { type: 'timeline-axis', ...(P.arrow === false ? { arrow: false } : {}) };
        const headed = (sec) =>
          sec.heading
            ? [
                { type: 'heading', depth: 2, runs: sec.heading, color: COLORS.primaryDarker },
                ...sec.blocks,
              ]
            : sec.blocks;
        const elements = [];
        if (P.orientation === 'vertical') {
          const axisX = area.x + dotR / 2;
          const rowGap = SPACE.xs;
          const rowH = (area.h - SPACE.xs - (n - 1) * rowGap) / n;
          elements.push({
            block: { ...axisBlock, vertical: true },
            region: { x: axisX - 1, y: area.y + SPACE.xs, w: 2, h: area.h - SPACE.xs },
          });
          secs.slice(0, n).forEach((sec, k) => {
            const rowY = area.y + SPACE.xs + k * (rowH + rowGap);
            const grp = [
              { block: dotBlock(k), region: { x: axisX - dotR / 2, y: rowY, w: dotR, h: dotR } },
            ];
            const rightX = axisX + dotR / 2 + SPACE.md;
            grp.push(
              ...flowBlocks(
                headed(sec),
                { x: rightX, y: rowY, w: area.x + area.w - rightX, h: rowH },
                { paginate: false },
              )[0],
            );
            grp.forEach((el) => {
              el.group = k;
            }); // animation: one milestone = one step
            elements.push(...grp);
          });
          push({ elements });
          break;
        }
        const colW = (area.w - (n - 1) * PAGE.gutter) / n;
        const axisY = area.y + SPACE.md;
        elements.push({ block: axisBlock, region: { x: area.x, y: axisY - 1, w: area.w, h: 2 } });
        secs.slice(0, n).forEach((sec, k) => {
          const colX = area.x + k * (colW + PAGE.gutter);
          const grp = [
            { block: dotBlock(k), region: { x: colX, y: axisY - dotR / 2, w: dotR, h: dotR } },
          ];
          const below = {
            x: colX,
            y: axisY + dotR / 2 + SPACE.sm,
            w: colW,
            h: area.y + area.h - axisY - dotR / 2 - SPACE.sm,
          };
          grp.push(...flowBlocks(headed(sec), below, { paginate: false })[0]);
          grp.forEach((el) => {
            el.group = k;
          }); // animation: one milestone = one step
          elements.push(...grp);
        });
        push({ elements });
        break;
      }
      case 'layers': {
        // architecture layers: full-width bands stacked, from the base (dark
        // shade) to the surface — `##` sections, or the items of a bullet
        // list if the slide has no sections
        const secs = slide.sections.filter((s) => s.heading);
        const bulletsOnly = !secs.length && blocks.length === 1 && blocks[0].type === 'bullets';
        // surplus dropped at the registry bounds — that is what validation
        // (LAYOUT_SECTIONS) promises; before, the extra bands were silently
        // crushed one on top of another
        const items = (
          bulletsOnly
            ? blocks[0].items.map((it) => ({ runs: it.runs, blocks: [] }))
            : secs.map((s) => ({ runs: s.heading, blocks: s.blocks }))
        ).slice(0, bounds?.max ?? 5);
        const n = Math.max(items.length, 1);
        const gap = SPACE.xs;
        const bandH = (area.h - SPACE.xs - (n - 1) * gap) / n;
        const headH = TYPE.sectionHeading * PT_TO_PX * LINE_HEIGHT;
        const [titleRatio, bodyRatio] = P.ratios ?? [0.3, 0.68];
        // body start: title + a little slack — historical literal 0.32 when
        // nothing overrides it (0.3 + 0.02 is not 0.32 in floating point, and
        // the goldens must stay intact to the bit)
        const bodyStart = P.ratios ? titleRatio + 0.02 : 0.32;
        // funnel / pyramid: relative band width, linear between 1 and 0.45,
        // centered — stack (default): full width
        const minW = 0.45;
        const widthAt = (k) =>
          P.shape === 'funnel'
            ? 1 - (k * (1 - minW)) / Math.max(n - 1, 1)
            : P.shape === 'pyramid'
              ? minW + (k * (1 - minW)) / Math.max(n - 1, 1)
              : 1;
        const elements = [];
        items.forEach((it, k) => {
          // shades spread over the palette: 3 layers → dark, medium, light
          // (or imposed by the `shades` parameter, cycling)
          // the index is CLAMPED to the last available shade: a kit that
          // provides fewer shades than the `shades` asked for (or than there
          // are layers) keeps a monotonic gradient instead of crashing the
          // layout on an `.ink` of undefined. It is the CLAMPED index that
          // goes into the `panel` block: panelStyle() and the ink must point
          // at the same shade, or the text is computed for a background it
          // does not have.
          const lastShade = LAYER_SHADES.length - 1;
          const wanted = P.shades
            ? P.shades[k % P.shades.length]
            : n > 1
              ? Math.round((k * Math.max(lastShade, 0)) / (n - 1))
              : 0;
          const shade = Math.min(Math.max(wanted, 0), Math.max(lastShade, 0));
          const bandBlock = { type: 'panel', variant: 'layer', shade };
          const ink = panelStyle(bandBlock).ink;
          const bandW = area.w * widthAt(k);
          const band = {
            x: area.x + (area.w - bandW) / 2,
            y: area.y + SPACE.xs + k * (bandH + gap),
            w: bandW,
            h: bandH,
          };
          elements.push({ block: bandBlock, region: band, group: k });
          const hasBody = it.blocks.length > 0;
          const headW = hasBody ? band.w * titleRatio - SPACE.md : band.w - 2 * SPACE.md;
          elements.push({
            block: { type: 'heading', depth: 2, runs: it.runs, color: ink },
            region: { x: band.x + SPACE.md, y: band.y + (band.h - headH) / 2, w: headW, h: headH },
            group: k,
          });
          if (hasBody) {
            const body = {
              x: band.x + band.w * bodyStart,
              y: band.y + SPACE.xs,
              w: band.w * bodyRatio - SPACE.md,
              h: band.h - 2 * SPACE.xs,
            };
            const flowed = flowBlocks(
              it.blocks.map((b) => ({ ...b, color: ink })),
              body,
              { paginate: false, density: P.density },
            )[0];
            // description centered vertically in the band, like the title
            const bottom = flowed.reduce((m, el) => Math.max(m, el.region.y + el.region.h), body.y);
            const shift = Math.max(0, (body.h - (bottom - body.y)) / 2);
            flowed.forEach((el) => {
              el.region.y += shift;
              el.group = k;
            });
            elements.push(...flowed);
          }
        });
        push({ elements });
        break;
      }
      case 'swot': {
        // 2 × 2 matrix: sections in the order Strengths, Weaknesses,
        // Opportunities, Threats — panels in the semantic tints
        // (configurable through `kinds`, cycling)
        const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
        const kinds = P.kinds ?? ['success', 'danger', 'info', 'warning'];
        const maxCells = bounds?.max ?? 4;
        const rows = Math.max(Math.ceil(Math.min(secs.length, maxCells) / 2), 1);
        const cellW = (area.w - PAGE.gutter) / 2;
        const cellH = (area.h - SPACE.xs - (rows - 1) * PAGE.gutter) / rows;
        const elements = [];
        secs.slice(0, maxCells).forEach((sec, k) => {
          const cell = {
            x: area.x + (k % 2) * (cellW + PAGE.gutter),
            y: area.y + SPACE.xs + Math.floor(k / 2) * (cellH + PAGE.gutter),
            w: cellW,
            h: cellH,
          };
          const quadrant = { type: 'panel', ...panelFrom(kinds[k % kinds.length]) };
          elements.push({ block: quadrant, region: cell, group: k });
          const inner = {
            x: cell.x + SPACE.sm,
            y: cell.y + SPACE.sm,
            w: cell.w - 2 * SPACE.sm,
            h: cell.h - 2 * SPACE.sm,
          };
          const colBlocks = sec.heading
            ? [
                { type: 'heading', depth: 2, runs: sec.heading, color: panelStyle(quadrant).ink },
                ...sec.blocks,
              ]
            : sec.blocks;
          const flowed = flowBlocks(inkBlocks(colBlocks, quadrant), inner, {
            paginate: false,
            density: P.density,
          })[0];
          flowed.forEach((el) => {
            el.group = k;
          }); // animation: one quadrant = one step
          elements.push(...flowed);
        });
        push({ elements });
        break;
      }
      case 'grid': {
        // R × C mosaic of panels (review §3.3, phase B): a portfolio of
        // projects, offerings, a team, 2 × 2 matrices — one `##` section =
        // one cell; `kinds` (semantic) takes precedence over `panels`
        const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
        const maxCells = bounds?.max ?? 8;
        const n = Math.min(Math.max(secs.length, 1), maxCells);
        const cols = Math.min(P.cols ?? 2, n);
        const placed = packGrid(n, cols, P.spans);
        const rows = placed.rows;
        const unitW = (area.w - (cols - 1) * PAGE.gutter) / cols;
        const cellH = (area.h - SPACE.xs - (rows - 1) * PAGE.gutter) / rows;
        const headH = TYPE.sectionHeading * PT_TO_PX * LINE_HEIGHT;
        const panels = P.panels ?? ['muted'];
        const elements = [];
        secs.slice(0, n).forEach((sec, k) => {
          const slot = placed.cells[k];
          const cell = {
            x: area.x + slot.col * (unitW + PAGE.gutter),
            y: area.y + SPACE.xs + slot.row * (cellH + PAGE.gutter),
            // a cell spanning s columns also swallows the s-1 gutters it covers
            w: unitW * slot.span + PAGE.gutter * (slot.span - 1),
            h: cellH,
          };
          const spec = P.kinds ? P.kinds[k % P.kinds.length] : panels[k % panels.length];
          const block = {
            type: 'panel',
            ...panelFrom(spec),
            ...(P.radius ? { radius: P.radius } : {}),
          };
          elements.push({ block, region: cell, group: k });
          const inner = {
            x: cell.x + SPACE.sm,
            y: cell.y + SPACE.sm,
            w: cell.w - 2 * SPACE.sm,
            h: cell.h - 2 * SPACE.sm,
          };
          const ink = panelStyle(block).ink;
          const heading = sec.heading
            ? { type: 'heading', depth: 2, runs: sec.heading, ...(ink ? { color: ink } : {}) }
            : null;
          let flowRegion = inner;
          let cellBlocks = sec.blocks;
          if (P.headed && heading) {
            // detached header: title at the top of the cell, rule, content below
            elements.push({
              block: alignBlocks([heading], P.align)[0],
              region: { ...inner, h: headH },
              group: k,
            });
            elements.push({
              block: { type: 'timeline-axis', arrow: false },
              region: { x: inner.x, y: inner.y + headH + SPACE.xs, w: inner.w, h: 2 },
              group: k,
            });
            const contentY = inner.y + headH + SPACE.xs + SPACE.sm;
            // height clamped at 0: a dense mosaic (cols: 1 × 8 rows) must
            // never emit a negative region — the overflow stays visible
            // through BLOCK_OVERFLOW
            flowRegion = {
              x: inner.x,
              y: contentY,
              w: inner.w,
              h: Math.max(0, inner.h - (contentY - inner.y)),
            };
          } else if (heading) {
            cellBlocks = [heading, ...sec.blocks];
          }
          const flowed = flowBlocks(
            alignBlocks(inkBlocks(cellBlocks, block), P.align),
            flowRegion,
            { paginate: false, density: P.density },
          )[0];
          flowed.forEach((el) => {
            el.group = k;
          }); // animation: one cell = one step
          elements.push(...flowed);
        });
        push({ elements });
        break;
      }
      case 'steps': {
        // sequential process (review §3.3, phase B): step panels joined by
        // connectors (arrow, line or nothing) — a citizen journey, the path
        // of a request, a "how it works"
        const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
        const n = Math.min(Math.max(secs.length, 1), bounds?.max ?? 6);
        const connector = P.connector ?? 'arrow';
        const gap = connector === 'none' ? PAGE.gutter : 40;
        const stepW = (area.w - (n - 1) * gap) / n;
        const panels = P.panels ?? ['muted'];
        const elements = [];
        secs.slice(0, n).forEach((sec, k) => {
          const col = {
            x: area.x + k * (stepW + gap),
            y: area.y + SPACE.xs,
            w: stepW,
            h: area.h - SPACE.xs,
          };
          if (k && connector !== 'none') {
            // the connector appears with the step it introduces (group k)
            elements.push({
              block: { type: 'timeline-axis', ...(connector === 'line' ? { arrow: false } : {}) },
              region: { x: col.x - gap + (gap - 28) / 2, y: col.y + col.h / 2 - 1, w: 28, h: 2 },
              group: k,
            });
          }
          const panel = panelFrom(panels[k % panels.length]);
          const block = { type: 'panel', ...panel, ...(P.radius ? { radius: P.radius } : {}) };
          elements.push({ block, region: { ...col }, group: k });
          const padTop = panel.variant === 'pillar' ? SPACE.md : SPACE.sm; // room for the accent
          const inner = {
            x: col.x + SPACE.sm,
            y: col.y + padTop,
            w: col.w - 2 * SPACE.sm,
            h: col.h - padTop - SPACE.sm,
          };
          const ink = panelStyle(block).ink;
          const stepBlocks = sec.heading
            ? [
                { type: 'heading', depth: 2, runs: sec.heading, ...(ink ? { color: ink } : {}) },
                ...sec.blocks,
              ]
            : sec.blocks;
          const flowed = flowBlocks(inkBlocks(stepBlocks, block), inner, {
            paginate: false,
            density: P.density,
          })[0];
          flowed.forEach((el) => {
            el.group = k;
          }); // animation: one step at a time
          elements.push(...flowed);
        });
        push({ elements });
        break;
      }
      case 'focus': {
        // ONE message (review §3.3, phase B): a large figure or key sentence
        // filling the frame (the slide's first paragraph), context
        // underneath — the weapon against the overloaded slide. Any `##`
        // titles remain content (heading blocks), never thrown away.
        const withHeads = slide.sections.flatMap((s) =>
          s.heading ? [{ type: 'heading', depth: 2, runs: s.heading }, ...s.blocks] : s.blocks,
        );
        const msgIdx = withHeads.findIndex((b) => b.type === 'para');
        if (msgIdx < 0) {
          // no paragraph: plain flow, no pagination
          push({ elements: flowBlocks(withHeads, area, { paginate: false })[0] });
          break;
        }
        const msg = withHeads[msgIdx];
        const rest = withHeads.filter((_, i) => i !== msgIdx);
        const align = P.align ?? 'center';
        const size = Math.round(TYPE.coverTitle * (P.scale ?? 1));
        const msgBlock = {
          type: 'heading',
          depth: 1,
          runs: msg.runs,
          size,
          ...alignAttr(align),
        };
        const msgH = blockHeight(msgBlock, area.w);
        // message area: the whole content area, or its upper half if context
        // follows — the message is centered vertically in it; a message taller
        // than its area PUSHES the context down rather than overlapping it
        // (an overflow past the bottom of the page is still reported by
        // BLOCK_OVERFLOW)
        const contextY = rest.length
          ? area.y +
            Math.min(area.h, Math.max(Math.round(area.h * 0.58), SPACE.lg + msgH + SPACE.md))
          : area.y + area.h;
        const msgY = area.y + Math.max(SPACE.lg, (contextY - area.y - msgH) / 2);
        const elements = [];
        if (P.accent !== false) {
          const barW = CHROME.cover.barW;
          // the bar sits over the message, so it follows it: an accent still
          // pinned left above a right-aligned message reads as a stray rule
          const barX = { center: area.x + (area.w - barW) / 2, right: area.x + area.w - barW };
          elements.push({
            block: { type: 'panel', variant: 'accent' },
            region: {
              x: barX[align] ?? area.x,
              y: msgY - SPACE.md,
              w: barW,
              h: CHROME.cover.barH,
            },
            group: 0,
          });
        }
        elements.push({
          block: msgBlock,
          region: { x: area.x, y: msgY, w: area.w, h: msgH },
          group: 0,
        });
        if (rest.length) {
          const ctx = {
            x: area.x,
            y: contextY,
            w: area.w,
            h: Math.max(0, area.y + area.h - contextY),
          };
          elements.push(...flowBlocks(rest, ctx, { paginate: false })[0]);
        }
        push({ elements });
        break;
      }
      case 'table':
      case 'code':
      case 'diagram':
      case 'chart':
      case 'content':
      default: {
        // a single vertical flow, with pagination; if the slide has several
        // `##` sections, each section becomes an animation group
        const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
        const grouped = animate && secs.filter((s) => s.heading).length >= 2;
        const withHeadings = secs.flatMap((s, si) => {
          const blocks = s.heading
            ? [{ type: 'heading', depth: 2, runs: s.heading }, ...s.blocks]
            : s.blocks;
          return grouped ? blocks.map((b) => ({ ...b, group: si })) : blocks;
        });
        const pages = flowBlocks(alignBlocks(withHeadings, P.align), area, { density: P.density });
        pages.forEach((elements, p) => {
          stretchTrailingVisual(elements, area);
          push({
            elements,
            title: p === 0 ? slide.title : slide.title ? `${slide.title} (cont.)` : null,
            notes: p === 0 ? slide.notes : [],
            continued: p > 0 || undefined,
            // The title the AUTHOR wrote, kept on the continuation pages whose
            // displayed title gained a "(cont.)" suffix. The Morph chains pair
            // slides on this: without it a paginated run and an author slide
            // repeating the same heading would never merge, and the deck would
            // glide across the pages then cut hard into the author's slide.
            titleKey: (p > 0 && slide.title) || undefined,
          });
        });
        break;
      }
    }
  });

  return scenes;
}
