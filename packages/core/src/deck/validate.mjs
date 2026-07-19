/**
 * Validation of a deck without generating it: positioned diagnostics (line in
 * the source file) consumed by `lutrin validate`, the VS Code extension
 * (underlines in the editor) and agents (`--json`).
 *
 * Severities: `error` (the rendering will not be the expected one), `warning`
 * (probably not intended), `info` (automatic behaviour worth knowing about).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseDeck,
  ALERT_BLOCK_TYPES,
  CONTAINERS,
  CHART_TYPES,
  ICON_COLORS,
  ANIM_PRESETS,
  ANIM_PRESET_ALIASES,
  isKnownAnimateValue,
  runsToText,
} from './parse.mjs';
import {
  buildScenes,
  blockHeight,
  inferLayout,
  LAYOUTS,
  LAYOUT_SECTIONS,
  layoutDef,
  layoutParams,
  layoutParamSchema,
  officialLayouts,
  userLayouts,
} from './layout.mjs';
import { hasLucideIcon, imageDims, imageWithinRoots, resolveImagePath } from './assets.mjs';
import { chartDataDiagnostics } from './chart.mjs';
import { LAYER_SHADES, PAGE, contentArea } from './tokens.mjs';
import { prepareDeckContext } from './context.mjs';
import { THEME_KEYS } from './theme.mjs';
import { closest } from './suggest.mjs';

/** Candidates for animation preset suggestions (names + French aliases). */
const ANIM_CANDIDATES = [...ANIM_PRESETS, ...ANIM_PRESET_ALIASES];

// ---------------------------------------------------------------------------
// Walking the blocks of the IR (the :::… callouts nest blocks)
// ---------------------------------------------------------------------------

function* walkBlocks(slide) {
  function* rec(blocks) {
    for (const b of blocks) {
      yield b;
      if (b.type === 'alert') {
        // only descend into what the callout renders: the content it drops is
        // already reported one block up by ALERT_CONTENT_DROPPED — re-flagging
        // it in cascade (nested callout) would produce nothing but noise
        yield* rec(b.blocks.filter((x) => ALERT_BLOCK_TYPES.has(x.type)));
      } else if (b.blocks) {
        yield* rec(b.blocks);
      }
    }
  }
  for (const s of slide.sections) yield* rec(s.blocks);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * @param {string} source  the complete Markdown (DSL)
 * @param {object} [opts]  { baseDir } — the file's directory (resolution of
 *                         images, theme and layouts/*.json); { themePath } —
 *                         imposed kit (CLI flag --kit, wins over the
 *                         frontmatter); { deck, scenes } — IR and scenes
 *                         already computed by the host (extension worker) so
 *                         parseDeck/buildScenes are not redone on every
 *                         keystroke.
 * @returns {Array<{severity:'error'|'warning'|'info', code:string, message:string, line:number, suggestion?:string}>}
 */
export function validateDeck(
  source,
  {
    baseDir = process.cwd(),
    themePath = null,
    defaultTheme = null,
    imageRoots = [],
    deck = null,
    scenes = null,
  } = {},
) {
  // trust roots for local images: the deck's directory + the project/vault
  // roots declared by the host (containment — assets.mjs)
  const imageTrustRoots = [baseDir, ...imageRoots];
  const diags = [];
  const push = (severity, code, message, line, suggestion) =>
    diags.push({ severity, code, message, line: line ?? 1, ...(suggestion ? { suggestion } : {}) });

  // ------ text scan: unknown directives -------------------------------------
  // markdown-it-container silently ignores an unknown `:::name` (rendered as a
  // paragraph) — only a scan of the source catches them. We skip the
  // frontmatter and the inside of ```…``` blocks to avoid false positives.
  // Leading BOM: `parseDeck` strips it on its side before parsing. This scan
  // re-scans the SAME source; without the same stripping, a deck saved as
  // UTF-8-BOM would make the two readings diverge (frontmatter and frontmatter
  // keys shifted) and would position diagnostics beside the mark. The stripping
  // happens AFTER the split, on the first line: a BOM only exists at the head
  // of a file, and this scan must ask nothing of `source` other than `.split` —
  // a hostile source would throw here, before the try/catch that turns an
  // impossible parse into a diagnostic rather than a crash.
  const lines = source.split(/\r?\n/);
  if (typeof lines[0] === 'string') lines[0] = lines[0].replace(/^\uFEFF/, '');
  let inFence = null;
  let inFrontmatter = lines[0]?.trim() === '---' ? 'open' : null;
  lines.forEach((raw, k) => {
    const line = raw.trim();
    if (inFrontmatter === 'open' && k > 0) {
      if (line === '---') inFrontmatter = null;
      return;
    }
    if (inFrontmatter === 'open' && k === 0) return;
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) inFence = fence[1][0];
      else if (fence[1][0] === inFence) inFence = null;
      return;
    }
    if (inFence) return;
    const dir = line.match(/^:{3,}\s*([A-Za-z][\w-]*)/);
    // CASE-SENSITIVE comparison, like markdown-it-container when opening:
    // `:::Info` opens no callout and renders as a literal paragraph.
    // Normalizing here would judge as "known" what the engine ignores, and
    // would neutralize this diagnostic exactly where it serves most — the
    // casing mistake.
    if (dir && !CONTAINERS.includes(dir[1])) {
      // mermaid/math/chart are ``` fences in this DSL, not directives
      const fenceLangs = ['mermaid', 'math', 'latex', 'chart'];
      const fence = closest(dir[1], fenceLangs);
      // only the case differs: name the cause, otherwise the author re-reads a
      // correctly spelled word without seeing what is wrong
      const cased = CONTAINERS.includes(dir[1].toLowerCase()) ? dir[1].toLowerCase() : null;
      push(
        'error',
        'UNKNOWN_DIRECTIVE',
        cased
          ? `Unknown directive ":::${dir[1]}": directives are written in lowercase — ":::${cased}".`
          : fence
            ? `Unknown directive ":::${dir[1]}" — "${fence}" is written as a code block: \`\`\`${fence} … \`\`\`.`
            : `Unknown directive ":::${dir[1]}" (directives: ${CONTAINERS.join(', ')}).`,
        k + 1,
        cased ?? (fence ? `\`\`\`${fence}` : closest(dir[1], CONTAINERS)),
      );
    }
  });

  // ------ IR -----------------------------------------------------------------
  // Validation must never throw: a deck that cannot be parsed becomes a
  // diagnostic, not a crash of the editor or of the CLI.
  if (!deck) {
    try {
      deck = parseDeck(source);
    } catch (e) {
      push('error', 'PARSE_ERROR', `Could not parse the document: ${e?.message ?? e}`, 1);
      return diags;
    }
  }

  // Directives the parser could not attach to any slide (end of file, or `---`
  // before any content). They have no effect: saying so here is the only trace
  // the author will ever get. Reported BEFORE the early return of EMPTY_DECK —
  // an empty deck is precisely the case where every directive is orphaned.
  for (const d of deck.orphanDirectives ?? []) {
    push(
      'warning',
      'ORPHAN_DIRECTIVE',
      `The <!-- ${d.key}: … --> directive governs no slide: none opens after it (a directive applies to the slide surrounding it, whether it precedes or follows its "# heading"). It will have no effect.`,
      d.line,
    );
  }

  if (!deck.slides.length && !deck.meta.title) {
    push(
      'warning',
      'EMPTY_DECK',
      'No slides: neither a frontmatter `title:`, nor a `# heading` in the body.',
      1,
    );
    return diags;
  }

  /** Line (1-based) of a frontmatter key, to position a diagnostic. */
  const metaLine = (key) => {
    if (lines[0]?.trim() !== '---') return 1;
    for (let k = 1; k < lines.length && lines[k].trim() !== '---'; k++) {
      if (new RegExp(`^${key}\\s*:`).test(lines[k])) return k + 1;
    }
    return 1;
  };

  // `animate:` in the frontmatter (whole deck) — the same check as the slide
  // comment, positioned on the frontmatter line
  if (deck.meta.animate != null && !isKnownAnimateValue(deck.meta.animate)) {
    push(
      'warning',
      'UNKNOWN_ANIMATE',
      `Unknown value "${deck.meta.animate}" for animate: (presets: ${ANIM_PRESETS.join(', ')} — or true/none).`,
      metaLine('animate'),
      closest(String(deck.meta.animate), ANIM_CANDIDATES) ?? undefined,
    );
  }

  // ------ theme + user layouts -----------------------------------------------
  // Loads layouts/*.json and applies the theme BEFORE the slide loop
  // (UNKNOWN_LAYOUT reads the live registry) and before the geometric audits
  // (the estimates must be the theme's). Scenes precomputed by the host were
  // built in the same state by compileHtml.
  const prep = prepareDeckContext(deck.meta, { baseDir, themePath, defaultTheme });
  // anchor on the frontmatter line that DESIGNATES the kit — `kit:` today,
  // `theme:` for decks written before. The KIT_* codes, like the THEME_* ones,
  // all speak of that line: forgetting them would send the user back to line 1,
  // where there is nothing to fix.
  // metaLine returns 1 when the key is absent, and never 1 when it is present
  // (line 1 is the opening "---"): 1 therefore means "no kit:"
  const lineOfKit = metaLine('kit');
  const kitLine = lineOfKit !== 1 ? lineOfKit : metaLine('theme');
  for (const d of prep.diagnostics) {
    const aboutKit = d.code.startsWith('THEME_') || d.code.startsWith('KIT_');
    push(d.severity, d.code, d.message, aboutKit ? kitLine : 1, d.suggestion);
  }

  for (const slide of deck.slides) {
    if (slide.layout && !LAYOUTS.includes(slide.layout)) {
      push(
        'error',
        'UNKNOWN_LAYOUT',
        `Unknown layout "${slide.layout}" (layouts: ${LAYOUTS.join(', ')}).`,
        slide.layoutLine ?? slide.line,
        closest(slide.layout, LAYOUTS),
      );
    }
    // structured layouts: the number of ## sections must fit — name comparisons
    // are made on the resolved BASE layout, so that a user alias
    // (layouts/*.json) inherits the same exceptions
    const expect = slide.layout && LAYOUT_SECTIONS[slide.layout];
    const layoutBase = slide.layout ? (layoutDef(slide.layout)?.base ?? slide.layout) : null;
    if (expect) {
      const secs = slide.sections.filter((s) => s.heading || s.blocks.length);
      // LEAD: in columns, what precedes the first "##" does not occupy a
      // column — layout.mjs flows it full width above (see the `lead` of
      // two-columns/three-columns, SAME condition here). Counting it made us
      // announce "4 sections found: the surplus will be ignored" where nothing
      // is ignored: a lying warning, worse than none.
      const lead =
        (layoutBase === 'two-columns' || layoutBase === 'three-columns') &&
        secs.length &&
        !secs[0].heading &&
        secs.some((s) => s.heading);
      const nSecs = secs.length - (lead ? 1 : 0);
      const bulletLayers =
        layoutBase === 'layers' &&
        !slide.sections.some((s) => s.heading) &&
        slide.sections.flatMap((s) => s.blocks).every((b) => b.type === 'bullets');
      if (!bulletLayers && (nSecs < expect.min || nSecs > expect.max)) {
        push(
          'warning',
          'LAYOUT_SECTIONS',
          `The "${slide.layout}" layout expects ${
            expect.min === expect.max ? expect.min : `${expect.min} to ${expect.max}`
          } "##" sections (${nSecs} found${
            layoutBase === 'layers' ? ', or a single bullet list — one item per layer' : ''
          }): the surplus will be ignored, the shortfall will leave gaps.`,
          slide.layoutLine ?? slide.line,
        );
      }
    }
    if (slide.animateUnknown != null) {
      push(
        'warning',
        'UNKNOWN_ANIMATE',
        `Unknown value "${slide.animateUnknown}" for <!-- animate: … --> (presets: ${ANIM_PRESETS.join(', ')} — or true/none).`,
        slide.animateLine ?? slide.line,
        closest(slide.animateUnknown, ANIM_CANDIDATES) ?? undefined,
      );
    }
    // quote layout: layout.mjs renders an EMPTY scene when the slide has no
    // block to quote (rather than crashing the renderers). It places, it does
    // not speak: without this diagnostic, the author sees a bare slide and
    // never learns why.
    if (layoutBase === 'quote' && ![...walkBlocks(slide)].length) {
      push(
        'warning',
        'QUOTE_EMPTY',
        `The "${slide.layout}" layout features the FIRST block on the slide, but this slide has nothing to quote: the slide will be empty — add the quotation under the title.`,
        slide.layoutLine ?? slide.line,
      );
    }
    // layers layout: the `shades` parameter indexes the kit's shades
    // (LAYER_SHADES). An index beyond them is CLAMPED to the lightest by
    // layout.mjs — two layers then end up the same tint, which shows without
    // explaining itself: it is the kit that lacks shades, not the deck.
    if (layoutBase === 'layers' && LAYER_SHADES.length) {
      const shades = layoutParams(slide.layout).shades;
      const over = Array.isArray(shades)
        ? [...new Set(shades.filter((s) => s > LAYER_SHADES.length - 1))]
        : [];
      if (over.length) {
        push(
          'warning',
          'LAYERS_SHADE_MISSING',
          `The "${slide.layout}" layout asks for shade ${over.join(', ')} (parameter "shades"), but the kit only provides ${LAYER_SHADES.length} layer shades — indices 0 to ${LAYER_SHADES.length - 1}: the layers concerned will fall back to the lightest.`,
          slide.layoutLine ?? slide.line,
        );
      }
    }
    // metrics layout: past the cap (parameter `max`, 4 by default), the surplus
    // is dropped without a trace — compare the resolved BASE layout (user
    // aliases included), the effective cap of the alias
    const nMetrics = [...walkBlocks(slide)].filter((b) => b.type === 'metric').length;
    const effLayout = slide.layout ?? inferLayout(slide, 1);
    if ((layoutDef(effLayout)?.base ?? effLayout) === 'metrics') {
      const maxCards = layoutParams(effLayout).max ?? 4;
      if (nMetrics > maxCards) {
        push(
          'warning',
          'METRICS_DROPPED',
          `${nMetrics} :::metric cards — the "${effLayout}" layout only displays ${maxCards}: ${
            nMetrics - maxCards === 1
              ? 'the last one will be dropped'
              : `the last ${nMetrics - maxCards} will be dropped`
          }. Spread them over two slides.`,
          slide.line,
        );
      }
    }
    for (const b of walkBlocks(slide)) {
      if (b.type === 'image' && !/^https?:/.test(b.src)) {
        const file = resolveImagePath(baseDir, b.src);
        if (!imageWithinRoots(file, imageTrustRoots)) {
          push(
            'error',
            'IMAGE_PATH_ESCAPE',
            `Image outside the deck's directory: ${b.src} — refused (it will not be embedded). An image must sit under the deck's directory or under a project/vault directory allowed by the editor.`,
            b.line,
          );
        } else if (!fs.existsSync(file)) {
          push(
            'warning',
            'MISSING_IMAGE',
            `Image not found: ${b.src} (a placeholder will be displayed).`,
            b.line,
          );
        }
      }
      if (b.type === 'icon' && hasLucideIcon(b.name) === false) {
        push(
          'warning',
          'UNKNOWN_ICON',
          `Lucide icon "${b.name}" not found — check the name on lucide.dev.`,
          b.line,
        );
      }
      if (b.type === 'code' && b.invalidChart) {
        push(
          'warning',
          'INVALID_CHART',
          `The \`chart\` specification could not be parsed — the block will be displayed as code. Expected: "type: ${[...CHART_TYPES].join('|')}", "categories: a, b", then "Series: v1, v2".`,
          b.line,
        );
      }
      // callouts: the renderers only render paragraphs and bullet lists — any
      // other block is ignored, and the author must know it
      if (b.type === 'alert') {
        for (const inner of b.blocks) {
          if (!ALERT_BLOCK_TYPES.has(inner.type)) {
            push(
              'warning',
              'ALERT_CONTENT_DROPPED',
              `The :::${b.kind} callout only renders paragraphs and bullet lists: the "${inner.type}" block will be ignored — move it out of the callout.`,
              inner.line ?? b.line,
            );
          }
        }
      }
      // quotation: only the text of paragraphs is kept — a list, a table or an
      // image written inside are dropped by the parser, as for the callouts,
      // and that must be said (parse.mjs sets `dropped`)
      if (b.type === 'quote' && b.dropped?.length) {
        for (const t of b.dropped) {
          push(
            'warning',
            'QUOTE_CONTENT_DROPPED',
            `A quotation only renders text: the "${t}" block it contains will be ignored — move it out of the quotation.`,
            b.line,
          );
        }
      }
      // cartesian and radar: chart.mjs truncates each series to the number of
      // categories BEFORE computing its scale (otherwise the surplus, never
      // plotted, crushes the visible plot). What it rules out, it says here —
      // the engine's rule: rendering places, validation speaks.
      for (const d of chartDataDiagnostics(b))
        push(d.severity, d.code, d.message, d.line ?? b.line);
      // pie/doughnut: a single series of positive shares, truncated to the
      // number of categories — the rest of the data is dropped at render time,
      // with no trace other than this diagnostic (same windows as chart.mjs:
      // the truncation applies BEFORE the clamp on negatives)
      if (b.type === 'chart' && (b.chartType === 'pie' || b.chartType === 'doughnut')) {
        if (b.series.length > 1) {
          push(
            'warning',
            'CHART_DATA_IGNORED',
            `Chart "${b.chartType}": ${b.series.length} series — only the first ("${b.series[0].name}") will be displayed. To compare series, use bar, line or radar.`,
            b.line,
          );
        }
        const extra = b.series[0].values.length - b.categories.length;
        if (extra > 0) {
          push(
            'warning',
            'CHART_DATA_IGNORED',
            `Chart "${b.chartType}": the series "${b.series[0].name}" carries ${b.series[0].values.length} values for ${b.categories.length} categories — ${extra === 1 ? 'the last one will be dropped' : `the last ${extra} will be dropped`}.`,
            b.line,
          );
        }
        // a series shorter than the categories: the rendering no longer invents
        // a 0 share for the categories without a value, but the author must
        // know they will not appear (same windows as the truncation)
        const missing = b.categories.length - b.series[0].values.length;
        if (missing > 0) {
          const orphans = b.categories.slice(b.series[0].values.length);
          push(
            'warning',
            'CHART_DATA_IGNORED',
            `Chart "${b.chartType}": ${b.categories.length} categories, but the series stops at value ${b.series[0].values.length} — ${missing === 1 ? `the category "${orphans[0]}" will have no share` : `the categories ${orphans.map((c) => `"${c}"`).join(', ')} will have no share`}.`,
            b.line,
          );
        }
        const shown = b.series[0].values.slice(0, b.categories.length);
        const neg = shown.filter((v) => v < 0).length;
        if (neg) {
          push(
            'warning',
            'CHART_DATA_IGNORED',
            `Chart "${b.chartType}": negative values are displayed as 0 (${neg} of them) — this type only represents positive shares; use bar or barh.`,
            b.line,
          );
        }
      }
    }
  }

  // ------ art direction: suggested structured layout -------------------------
  // reverse inference — structured layouts are never inferred, but some content
  // betrays the intent (SWOT, before/after, dated milestones)
  // NFD separates the letter from its diacritic, the character class removes
  // the diacritics: "résumé" and "resume" then compare as identical.
  // Targeting combining marks is the intention here, not a mistake.
  const norm = (runs) =>
    runsToText(runs)
      .toLowerCase()
      .normalize('NFD')
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: removal of diacritics after NFD
      .replace(/[\u0300-\u036f]/g, '');
  for (const slide of deck.slides) {
    if (slide.layout) continue;
    const heads = slide.sections.filter((s) => s.heading).map((s) => norm(s.heading));
    if (heads.length < 2) continue;
    const has = (re) => heads.some((h) => re.test(h));
    // milestones: the date/step must OPEN the section heading ("2024",
    // "Q1 2026", "Phase 2") — "Review of 2025" is not a milestone
    const dated = heads.filter((h) =>
      /^((19|20)\d{2}\b|[tq][1-4]\b|phase\s*\d|step\s*\d|milestone|week\s*\d|quarter\s*\d)/.test(h),
    ).length;
    let layout = null;
    let why = null;
    // swot: require the canonical order — the layout tints quadrants BY
    // POSITION (success, danger, info, warning); suggesting swot on unordered
    // sections would render "Threats" in green
    const SWOT_ORDER = ['strengths', 'weaknesses', 'opportunities', 'threats'];
    // the OFFICIAL layouts (design/layouts/) are suggested too — only if they
    // are properly loaded in the registry (catalog intact)
    const official = (name) => (LAYOUTS.includes(name) ? name : null);
    if (heads.length === 4 && SWOT_ORDER.every((k, i) => heads[i].includes(k))) {
      layout = 'swot';
      why = 'a strengths / weaknesses / opportunities / threats matrix';
    } else if (
      heads.length === 2 &&
      has(/^pros?\b/) &&
      has(/^cons?\b(?![-–])/) &&
      // "Pros for whom?" (a question) or "Con-artists" (hyphenated) are not a decision to weigh
      !heads.some((h) => h.includes('?')) &&
      official('pros-cons')
    ) {
      layout = 'pros-cons';
      why = 'a decision to weigh (pros / cons)';
    } else if (heads.length === 2 && has(/^before\b/) && has(/^after\b/)) {
      layout = 'comparison';
      why = 'a before / after comparison';
    } else if (heads.length === 2 && has(/current|today/) && has(/target|goal|tomorrow|future/)) {
      layout = 'comparison';
      why = 'a current-state / target comparison';
    } else if (
      heads.length === 4 &&
      heads.filter((h) => /probabilit|severity|likelihood/.test(h)).length >= 2 &&
      // the layout tints BY POSITION (green → red): require ascending order —
      // first quadrant benign, last critical — as for the canonical order of
      // the SWOT
      /low|minor/.test(heads[0]) &&
      /critical|major|high|severe/.test(heads[3]) &&
      official('risk-map')
    ) {
      layout = 'risk-map';
      why = 'a risk map (probability / severity)';
    } else if (dated >= Math.max(2, heads.length - 1)) {
      layout = 'timeline';
      why = 'dated milestones';
    }
    if (layout) {
      push(
        'info',
        'LAYOUT_SUGGESTION',
        `The "##" sections of this slide express ${why}: adding <!-- layout: ${layout} --> will display it with the dedicated layout.`,
        slide.line,
        layout,
      );
    }
  }

  // ------ geometric audits on the scenes --------------------------------------
  try {
    const allScenes = scenes ?? buildScenes(deck);

    // pagination (density info)
    const paginated = new Set();
    for (const scene of allScenes) {
      if (scene.continued && !paginated.has(scene.sourceLine)) {
        paginated.add(scene.sourceLine);
        push(
          'info',
          'SLIDE_PAGINATED',
          `The slide "${String(scene.title ?? '').replace(/ \(cont\.\)$/, '')}" overflows: its content is split into "(cont.)" slides.`,
          scene.sourceLine,
        );
      }
    }

    // overflow: estimated height vs region (unpaginated layouts: columns,
    // panels, split — the author can only fix it by knowing about it).
    // The lower bound is the bottom of the CONTENT AREA (672 px): that is where
    // panels and columns end — not the footer (688 px).
    const AUDITED = new Set([
      'para',
      'bullets',
      'heading',
      'code',
      'table',
      'alert',
      'quote',
      'math',
    ]);
    const ADVICE = {
      table: 'split the table or remove columns',
      bullets: 'shorten the bullets or spread them over two slides',
    };
    const area = contentArea();
    const areaBottom = area.y + area.h;
    for (const scene of allScenes) {
      if (scene.master === 'cover' || scene.master === 'section') continue;
      let flagged = 0;
      for (const el of scene.elements) {
        if (flagged >= 3 || !AUDITED.has(el.block.type)) continue;
        const needed = blockHeight(el.block, el.region.w);
        const overflow = Math.round(
          Math.max(needed - el.region.h, el.region.y + Math.max(needed, el.region.h) - areaBottom),
        );
        if (overflow > 12) {
          flagged++;
          push(
            'warning',
            'BLOCK_OVERFLOW',
            `The "${el.block.type}" block overflows its region by about ${overflow} px (${scene.layout} layout) — ${
              ADVICE[el.block.type] ?? 'trim the content or switch layouts'
            }.`,
            el.block.line ?? scene.sourceLine,
          );
        }
      }

      // resolution: a local image stretched beyond its native size
      const images = scene.elements
        .filter((el) => el.block.type === 'image')
        .concat(scene.image ? [{ block: scene.image, region: { w: PAGE.width } }] : []);
      for (const el of images) {
        const b = el.block;
        if (/^https?:/.test(b.src)) continue;
        const file = resolveImagePath(baseDir, b.src);
        // an image that escapes: refused for embedding (IMAGE_PATH_ESCAPE
        // already emitted) — nothing to audit about its resolution
        if (!imageWithinRoots(file, imageTrustRoots)) continue;
        if (!fs.existsSync(file)) continue;
        const dims = imageDims(file);
        if (!dims?.w) continue;
        // actual displayed width: the renderer frames with "contain" (ratio
        // preserved) — except the cover/background roles, stretched over the
        // region
        const cover = b.role === 'cover' || b.role === 'background';
        const displayed =
          cover || !dims.h || !el.region.h
            ? el.region.w
            : Math.min(el.region.w, (el.region.h * dims.w) / dims.h);
        if (displayed > dims.w * 1.3) {
          push(
            'info',
            'IMAGE_UPSCALED',
            `Image "${b.src}", ${dims.w} px wide, displayed at about ${Math.round(displayed)} px — risk of blur: supply a larger image.`,
            b.line ?? scene.sourceLine,
          );
        }
      }
    }
  } catch (e) {
    push('error', 'LAYOUT_ERROR', `Could not lay out the document: ${e?.message ?? e}`, 1);
  }

  return diags.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Engine capabilities (for agents and autocompletion)
// ---------------------------------------------------------------------------

export function capabilities() {
  // deep copy on output: the registry and the schemas are live module state —
  // a host that mutated the result would corrupt every subsequent deck of the
  // warm worker
  return structuredClone({
    layouts: LAYOUTS,
    // official layouts of the design/layouts/ catalog (base + parameters +
    // description) — never inferred, to be asked for by <!-- layout: … -->
    officialLayouts: officialLayouts(),
    // user layouts of the last prepared deck (layouts/*.json) — their full
    // definition, so that the agent knows where each alias comes from
    userLayouts: userLayouts(),
    layoutSections: Object.fromEntries(
      LAYOUTS.filter((l) => layoutDef(l)?.sections).map((l) => [l, layoutDef(l).sections]),
    ),
    // parameters of the built-in generators (review §3.3, step 3): to be set at
    // the top level of a layouts/*.json — types, domains and defaults published
    // so that agents discover them instead of inventing them
    layoutParams: Object.fromEntries(
      LAYOUTS.filter(
        (l) => layoutDef(l)?.builtin && Object.keys(layoutParamSchema(l) ?? {}).length,
      ).map((l) => [l, layoutParamSchema(l)]),
    ),
    directives: CONTAINERS,
    chartTypes: [...CHART_TYPES],
    iconColors: [...ICON_COLORS],
    codeFences: ['mermaid', 'math', 'latex', 'tex', 'chart'],
    comments: ['notes', 'layout', 'animate'],
    animatePresets: [...ANIM_PRESETS],
    frontmatter: ['title', 'subtitle', 'author', 'date', 'footer', 'animate', 'kit', 'assets'],
    outputs: ['pptx', 'html'],
    remoteImages:
      '`![](https://…)` images are downloaded then embedded in the deliverable (the presentation has no ' +
      'network dependency). They land in the user cache ~/.cache/lutrin/remote/, shared between projects — ' +
      "compiling writes nothing into the deck's directory. `assets: vendor` (frontmatter) or --vendor-assets " +
      '(CLI, which wins) copies them into assets/remote/ next to the .md, for a self-contained directory ' +
      'that can be archived, handed over or versioned.',
    vendor:
      '"lutrin vendor <deck.md>" freezes ALL external dependencies in the deck\'s directory: remote images ' +
      '(assets/remote/), already rendered Mermaid diagrams (assets/mermaid/ — the deck then compiles ' +
      'without @mermaid-js/mermaid-cli installed) and the resolved kit, fonts and logos included ' +
      '(assets/kit/). The frontmatter is rewritten accordingly (assets: vendor, kit: ./assets/kit): the ' +
      'declaration stays explicit, no hidden level is added to the precedence of kits. The directory then ' +
      'compiles offline, on a machine with no kit installed — at the price of a freeze: updating the kit ' +
      'means running vendor again.',
    theme: {
      frontmatter:
        'kit: my-kit (name of an installed kit), kit: ./my-theme.json (file resolved relative to the ' +
        "deck's directory) or kit: ./my-kit (directory carrying a kit.json); kit: none forces the default " +
        'theme. The CLI flag --kit wins; otherwise the project default via "lutrin": { "kit": … } of the ' +
        'nearest package.json. "theme:" is still accepted as a deprecated alias (diagnostic ' +
        'KIT_DEPRECATED_KEY).',
      precedence:
        '--kit (CLI) > frontmatter kit: > project default (package.json "lutrin".kit) > ' +
        'user default (config.json, see userConfig) > host default (extension) > generic theme.',
      userConfig:
        'kit shared between projects: the "kit" field of ~/.config/lutrin/config.json (overridable by ' +
        'LUTRIN_CONFIG; XDG_CONFIG_HOME respected) — set with "config --kit <ref>". ' +
        'Kits installed in ~/.config/lutrin/kits/<name>/ are referenced by name from any project.',
      reference:
        'design/themes/default.json (full mirror of the default theme, a template to copy)',
      kit:
        'a kit carries a kit.json { name, version?, theme?: "./theme.json", layouts?: "./layouts" } at its ' +
        'root (defaults: ./theme.json and ./layouts if it exists) — fonts/logos resolved relative to ' +
        'theme.json, inside the kit; distributed as a directory or as a .deckkit archive',
      keys: THEME_KEYS,
    },
    layoutsDir:
      'layouts/*.json next to the deck — { name, base (built-in or official layout), sections?: { min, max }, description?, …parameters of the base (see layoutParams) }',
    diagnostics: [
      'PARSE_ERROR',
      'LAYOUT_ERROR',
      'EMPTY_DECK',
      'UNKNOWN_DIRECTIVE',
      'ORPHAN_DIRECTIVE',
      'UNKNOWN_LAYOUT',
      'LAYOUT_SECTIONS',
      'UNKNOWN_ANIMATE',
      'METRICS_DROPPED',
      'MISSING_IMAGE',
      'UNKNOWN_ICON',
      'INVALID_CHART',
      'SLIDE_PAGINATED',
      'BLOCK_OVERFLOW',
      'LAYOUT_SUGGESTION',
      'IMAGE_UPSCALED',
      'ALERT_CONTENT_DROPPED',
      'CHART_DATA_IGNORED',
      'QUOTE_EMPTY',
      'LAYERS_SHADE_MISSING',
      'THEME_NOT_FOUND',
      'THEME_INVALID',
      'THEME_UNKNOWN_KEY',
      'THEME_BAD_VALUE',
      'THEME_CONTRAST',
      'KIT_NOT_FOUND',
      'KIT_INVALID',
      'KIT_UNKNOWN_KEY',
      'KIT_BAD_VALUE',
      'KIT_DEPRECATED_KEY',
      'USER_CONFIG_INVALID',
      'LAYOUT_DEF_INVALID',
      'LAYOUT_DEF_ADJUSTED',
    ],
  });
}
