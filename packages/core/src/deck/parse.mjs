/**
 * Front end of the compiler: enriched Markdown → presentation IR.
 *
 * Markdown is only an input DSL; past this stage, only the IR
 * (deck → slides → sections → blocks) travels through the pipeline. It is the
 * canonical representation that layout analysis, pagination and the render
 * engines all work on.
 *
 * DSL rules:
 *   - simple YAML frontmatter (title, subtitle, author, date, footer);
 *   - `# H1` or `---` opens a new slide;
 *   - `## H2` opens a section (a potential slot: column, panel…);
 *   - `:::info|success|warning|danger` → semantic callout;
 *   - `:::metric` (value then label) → metric card; a final line starting
 *     with `↑ ↗ ↓ ↘ →` (or `+`/`-` in front of a figure, or `=`) becomes the
 *     **trend** — up, down or flat. The color follows the direction
 *     (up = positive); suffix `(+)` / `(-)` to invert it when a fall is good
 *     news (costs, incidents);
 *   - `![cover|background|left|right](img)` → image role;
 *   - `![alt](https://…)` → remote image, downloaded and copied locally;
 *   - `![color?](lucide:name)` → Lucide icon (color: primary by default);
 *   - ```mermaid → diagram block;
 *   - ```math (or ```latex) → LaTeX equation; `$$…$$` alone in a paragraph
 *     works too;
 *   - ```chart → native chart (bar, barh, line, area, pie, doughnut, radar);
 *   - `<!-- notes: … -->` → presenter notes;
 *   - `<!-- layout: … -->` → imposed layout;
 *
 * A directive (`layout`, `notes`, `animate`) governs the slide that surrounds
 * it, and it may be written BEFORE that slide's `# H1`: announcing the layout
 * then the title is the natural order — and the only possible one when you
 * want to read the layout first. A directive met outside any slide is
 * therefore held pending and applied to the next slide that opens. If none
 * opens (end of file, or a `---` separator before any content), it has
 * nothing to govern: it comes out in `orphanDirectives` so that validation
 * says so, rather than vanishing without a word.
 *   - `<!-- animate -->` → progressive reveal of the slide's content
 *     (`animate: true` in the frontmatter for the whole deck,
 *     `<!-- animate: none -->` to exclude one slide); a value can impose the
 *     PowerPoint effect for the whole slide — `<!-- animate: fade -->`,
 *     `wipe`, `zoom`, `appear` — otherwise the effect is chosen per block
 *     type (see anim.mjs).
 */

import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';

export const CONTAINERS = ['info', 'success', 'warning', 'danger', 'metric'];

/** Block types a :::info/success/warning/danger callout knows how to render
 *  (single source of truth: both renderers, the layout's height estimation
 *  and validation all refer to it). Any other block is ignored at render time
 *  — with no height reserved, and reported through ALERT_CONTENT_DROPPED. */
export const ALERT_BLOCK_TYPES = new Set(['para', 'bullets']);
const IMAGE_ROLES = new Set(['cover', 'background', 'left', 'right']);
export const ICON_COLORS = new Set(['primary', 'neutral', 'secondary', 'white']);
export const CHART_TYPES = new Set(['bar', 'barh', 'line', 'area', 'pie', 'doughnut', 'radar']);

/** Blocks a list item can carry and that a bullet cannot contain (a list's IR
 *  knows nothing but runs): they are re-read as blocks in their own right and
 *  reinserted in their place in the block sequence.
 *
 *  `heading_open` is deliberately ABSENT from it: in this DSL a `#`/`##` is
 *  not a content block but a slide/section SEPARATOR. Re-reading it as a block
 *  would split the slide on a heading indented under a bullet — the heading's
 *  text must stay a bullet, as it always has. */
const ITEM_NESTED_BLOCKS = new Set(['table_open', 'fence', 'code_block', 'blockquote_open']);

function buildMd() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  for (const name of CONTAINERS) md.use(container, name);
  return md;
}

/**
 * A deck may *start* with `---` without having any frontmatter: the `---` is
 * then a horizontal rule, and the block delimited by the next `---` is
 * content — the first slide. The two must therefore be told apart.
 *
 * The test happens in two stages, deliberately asymmetric:
 *   - the **first** non-empty line must be a *strict* `key:` form — not
 *     indented, with no markdown block opener (`> * + - #`). It is that
 *     strict predicate which guards against the false positive: "> A quote:
 *     with a colon", an indented list or indented code all contain colons but
 *     never open a frontmatter;
 *   - the **following** lines are judged with a *tolerant* predicate (empty,
 *     `#` comment, indented continuation, or `key:`), so that a real
 *     frontmatter is not rejected wholesale because of a single unusual
 *     line — an accented key, a dotted key, an empty value, nested YAML, a
 *     YAML list, a comment.
 *
 * Detection is therefore "all or nothing" on the *block*, but key extraction
 * stays line by line: a line that cannot be read is skipped without costing
 * the others.
 */
const FM_KEY_STRICT = /^[^\s>*+\-#:][^:]*:(?:\s|$)/;
const FM_LINE_LOOSE = /^\s*$|^\s*#|^\s+\S|^[^\s:][^:]*:(?:\s|$)/;

export function looksLikeFrontmatter(block) {
  const lines = block.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first === -1) return false; // empty block: two `---` in a row
  if (!FM_KEY_STRICT.test(lines[first])) return false;
  return lines.slice(first + 1).every((l) => FM_LINE_LOOSE.test(l));
}

/** Minimal YAML frontmatter: flat `key: value`, delimited by `---`.
 *  `lineOffset`: lines consumed by the frontmatter, used to bring markdown-it
 *  positions (relative to the body) back to the source file. */
function splitFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m || !looksLikeFrontmatter(m[1])) return { meta: {}, body: src, lineOffset: 0 };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+?)\s*$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: src.slice(m[0].length), lineOffset: (m[0].match(/\n/g) ?? []).length };
}

/** Accumulates a markdown-it inline token into `runs`, keeping the emphasis
 *  state `state` up to date. The state is carried by the caller: it therefore
 *  survives an image that cuts the paragraph into two fragments. */
function pushRun(runs, t, state) {
  switch (t.type) {
    case 'strong_open':
      state.bold++;
      break;
    case 'strong_close':
      state.bold--;
      break;
    case 'em_open':
      state.italic++;
      break;
    case 'em_close':
      state.italic--;
      break;
    case 'link_open':
      state.link = t.attrGet('href');
      break;
    case 'link_close':
      state.link = null;
      break;
    case 'code_inline':
      runs.push({ text: t.content, code: true, bold: state.bold > 0, italic: state.italic > 0 });
      break;
    case 'softbreak':
    case 'hardbreak':
      runs.push({ text: ' ', soft: true });
      break;
    case 'image':
      // outside a paragraph (list, cell, heading) an image has no block to go
      // into; inside one, inlineParagraphBlocks() intercepts it first.
      break;
    case 'text':
    default:
      if (t.content) {
        runs.push({
          text: t.content,
          bold: state.bold > 0 || undefined,
          italic: state.italic > 0 || undefined,
          link: state.link || undefined,
        });
      }
  }
}

/** Flattens markdown-it's inline children into styled "runs". */
function inlineRuns(token) {
  const runs = [];
  const state = { bold: 0, italic: 0, link: null };
  for (const t of token.children ?? []) pushRun(runs, t, state);
  return runs;
}

export const runsToText = (runs) => runs.map((r) => r.text).join('');

/** markdown-it `image` token → `image` or `icon` block.
 *  `![role](…)`: the alt carries the role when it names one, otherwise the
 *  alternative text; `lucide:`/`icon:` switches to an icon. */
function imageBlock(img) {
  const alt = img.content ?? '';
  const src = img.attrGet('src') ?? '';
  const icon = src.match(/^(?:lucide|icon):(.+)$/i);
  if (icon) {
    return {
      type: 'icon',
      name: icon[1].trim().toLowerCase(),
      color: ICON_COLORS.has(alt) ? alt : 'primary',
    };
  }
  return {
    type: 'image',
    src,
    role: IMAGE_ROLES.has(alt) ? alt : 'auto',
    alt: IMAGE_ROLES.has(alt) ? '' : alt,
  };
}

/** Trims the edge whitespace of a fragment — the whitespace left behind when
 *  a neighbouring image is pulled out. A `code_inline`'s content is never
 *  touched. */
function trimEdgeRuns(runs) {
  const blank = (r) => !r.code && !/\S/.test(r.text ?? '');
  const out = runs.slice();
  while (out.length && blank(out[0])) out.shift();
  while (out.length && blank(out[out.length - 1])) out.pop();
  if (!out.length) return out;
  if (!out[0].code) out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const last = out.length - 1;
  if (!out[last].code) out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, '') };
  return out;
}

/** A paragraph's text fragment → `para` block, or `math` when the fragment is
 *  an isolated `$$…$$`. An empty fragment produces no block. */
function paraFromRuns(runs) {
  const trimmed = trimEdgeRuns(runs);
  if (!trimmed.length) return null;
  const math = runsToText(trimmed)
    .trim()
    .match(/^\$\$([\s\S]+)\$\$$/);
  if (math) return { type: 'math', source: math[1].trim() };
  return { type: 'para', runs: trimmed };
}

/**
 * Splits a paragraph's inline content into blocks, in source order.
 *
 * An image is no longer kept on the sole condition of being alone in its
 * paragraph: it always becomes a block, and the text around it stays a
 * paragraph — an image sharing its paragraph with text, or two images side by
 * side, are no longer silently thrown away.
 *
 * The emphasis state crosses images: "**bold ![](a.png) more**" renders both
 * fragments in bold, and a link surrounding an image keeps carrying the text
 * that follows it. Equation detection applies fragment by fragment, so that
 * "![](a.png) $$x^2$$" stays an equation.
 */
function inlineParagraphBlocks(token) {
  const blocks = [];
  const state = { bold: 0, italic: 0, link: null };
  let runs = [];
  const flush = () => {
    const b = paraFromRuns(runs);
    if (b) blocks.push(b);
    runs = [];
  };
  for (const t of token.children ?? []) {
    if (t.type === 'image') {
      flush();
      blocks.push(imageBlock(t));
      continue;
    }
    pushRun(runs, t, state);
  }
  flush();
  return blocks;
}

/**
 * `chart` specification — a line-by-line format, deliberately minimal:
 *
 *   type: bar            (bar, barh, line, area, pie, doughnut, radar)
 *   categories: Q1, Q2, Q3
 *   Sales: 120, 150, 180
 *   Costs: 80, 90, 95
 *
 * Each "Name: v1, v2, …" line is a series (decimals with a point).
 * Invalid specification → null: the caller falls back to a code block, and
 * the user sees their source as written rather than a broken slide.
 */
function parseChartSpec(source) {
  const spec = { chartType: 'bar', categories: [], series: [] };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) return null;
    const key = m[1].trim();
    const val = m[2].trim();
    const lower = key.toLowerCase();
    if (lower === 'type') {
      if (!CHART_TYPES.has(val.toLowerCase())) return null;
      spec.chartType = val.toLowerCase();
    } else if (lower === 'categories' || lower === 'catégories') {
      // `catégories` is a deliberately FRENCH input alias of the DSL key, kept
      // for the same reason as PRESET_ALIASES below: it is a value an author
      // types, not prose. Do not "translate" it away — see the note there.
      spec.categories = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      // `Number('')` is 0: a series with no values ("Sales:"), a hole
      // ("12, , 18") or a trailing comma ("12, 18,") therefore read as silent
      // zeros. An empty cell invalidates the specification — the author sees
      // their source and a diagnostic, never an invented zero.
      const parts = val.split(',').map((s) => s.trim());
      if (parts.some((s) => !s)) return null;
      const values = parts.map(Number);
      // `Number.isNaN` let ±Infinity through ("1e999", "Infinity")
      if (values.some((v) => !Number.isFinite(v))) return null;
      spec.series.push({ name: key, values });
    }
  }
  if (!spec.series.length) return null;
  if (!spec.categories.length) {
    spec.categories = spec.series[0].values.map((_, k) => String(k + 1));
  }
  return spec;
}

/**
 * Trend line of a `:::metric` card: direction (up, down, flat) + text. The
 * direction comes from the first character (`↑ ↗ ↓ ↘ →`, or `+`/`-` in front
 * of a figure, or `=`). The default sentiment follows the direction (up =
 * positive, down = negative, flat = neutral); a `(+)` or `(-)` suffix inverts
 * it — a fall in incidents is good news. Returns null if the line is not a
 * trend.
 */
export function parseTrend(text) {
  const m = text.match(/^(?:([↑↗])|([↓↘])|(→)|(=)|(?=[+\-−]\s?\d)([+\-−]))\s*(.*)$/u);
  if (!m) return null;
  const dir = m[1]
    ? 'up'
    : m[2] || m[5] === '-' || m[5] === '−'
      ? 'down'
      : m[3]
        ? 'flat'
        : m[4]
          ? 'flat'
          : 'up';
  // the +/− sign is part of the data ("+12 %"); the arrows and "=" are not
  let label = (m[5] ? m[5] + m[6] : m[6]).trim();
  let sentiment = dir === 'up' ? 'positive' : dir === 'down' ? 'negative' : 'neutral';
  const override = label.match(/\s*\((\+|-)\)\s*$/);
  if (override) {
    sentiment = override[1] === '+' ? 'positive' : 'negative';
    label = label.slice(0, override.index).trim();
  }
  return { dir, sentiment, text: label };
}

function parseComment(html) {
  const m = html.match(/<!--\s*(notes|layout|animate)\s*(?::\s*([\s\S]*?))?\s*-->/);
  return m ? { key: m[1], value: (m[2] ?? '').trim() } : null;
}

/** `<!-- animate -->`, `animate: true`… → true; `none|false|off|non|0` → false. */
export const animateFlag = (value) =>
  !/^(none|false|off|non|0)$/i.test(String(value ?? '').trim() || 'true');

/** Reveal effects a slide can impose (`<!-- animate: fade -->`). French
 *  aliases are accepted; single source of truth for validation and for
 *  `capabilities()`. With no value, the effect is chosen per block type. */
export const ANIM_PRESETS = ['appear', 'fade', 'wipe', 'zoom'];
/** The four non-canonical keys below are DELIBERATELY FRENCH: they are DSL
 *  input values an author types (`<!-- animate: fondu -->`), not prose, and
 *  the alias table is the only thing that makes them work. "Correcting"
 *  `fondu: 'fade'` into `fade: 'fade'` breaks such decks with no compile
 *  error — `animateFlag` still returns true while `animatePreset` returns
 *  null, so the imposed effect is lost in silence and no diagnostic is
 *  emitted. `apparaître` also carries a circumflex beside the unaccented
 *  `apparaitre`; the lookup lowercases but does no Unicode normalization, so
 *  an NFC/NFD shift would half-break the table. Leave this object as it is. */
const PRESET_ALIASES = {
  appear: 'appear',
  apparaitre: 'appear',
  apparaître: 'appear',
  fade: 'fade',
  fondu: 'fade',
  wipe: 'wipe',
  balayage: 'wipe',
  zoom: 'zoom',
};

/** `animate` value → normalized effect name, or null (boolean or unknown). */
export const animatePreset = (value) =>
  PRESET_ALIASES[
    String(value ?? '')
      .trim()
      .toLowerCase()
  ] ?? null;

/** Aliases (French) accepted alongside the canonical names — for validation's
 *  "did you mean" suggestions. */
export const ANIM_PRESET_ALIASES = Object.keys(PRESET_ALIASES).filter(
  (k) => PRESET_ALIASES[k] !== k,
);

/** `animate` values that are neither a boolean nor a known effect (for the
 *  "did you mean" validation). */
const ANIM_FLAGS = /^(|true|false|none|off|on|non|oui|yes|0|1)$/i;
export const isKnownAnimateValue = (value) =>
  ANIM_FLAGS.test(String(value ?? '').trim()) || animatePreset(value) !== null;

function newSlide() {
  return {
    title: null,
    titleRuns: null,
    layout: null,
    animate: null,
    notes: [],
    sections: [{ heading: null, blocks: [] }],
  };
}

/**
 * Converts markdown-it's token stream into the IR.
 * @returns {{ meta: object, slides: object[] }}
 */
export function parseDeck(source) {
  // A leading U+FEFF (Windows Notepad, PowerShell `>` redirection) precedes
  // the frontmatter's `---`: without stripping it, the frontmatter is not
  // recognized at all — the metadata is lost and the block ends up in the body
  // as a ghost slide. CI covers windows-latest; the BOM does not cost a line,
  // so source positions stay correct.
  const { meta, body, lineOffset } = splitFrontmatter(source.replace(/^\uFEFF/, ''));
  const tokens = buildMd().parse(body, {});
  // 1-based, in the source file (frontmatter included)
  const lineOf = (t) => (t?.map ? t.map[0] + lineOffset + 1 : undefined);

  const slides = [];
  let slide = null;

  /** Directives read outside any slide, pending the next one that opens. */
  let pending = [];
  const orphanDirectives = [];

  /** Applies a `<!-- key: value -->` directive to a slide. */
  function applyDirective(target, c) {
    if (c.key === 'notes') target.notes.push(c.value);
    else if (c.key === 'layout') {
      target.layout = c.value;
      target.layoutLine = c.line;
    } else if (c.key === 'animate') {
      target.animate = animateFlag(c.value);
      const preset = animatePreset(c.value);
      if (preset) target.animatePreset = preset;
      if (!isKnownAnimateValue(c.value)) {
        target.animateUnknown = c.value;
        target.animateLine = c.line;
      }
    }
  }

  const ensureSlide = () => {
    if (!slide) {
      slide = newSlide();
      // directives written between the separator and the title govern THIS
      // slide: apply them in source order, as if they had been written just
      // after the `# H1`
      for (const c of pending) applyDirective(slide, c);
      pending = [];
    }
    return slide;
  };
  const curSection = () => slide.sections[slide.sections.length - 1];
  const pushSlide = () => {
    if (slide) slides.push(slide);
    slide = null;
  };
  /** A `---` (or the end of the file) with no slide opened since: the pending
   *  directives govern nothing. The engine does not keep quiet about what
   *  failed — they come back out for validation. */
  const dropPending = () => {
    orphanDirectives.push(...pending);
    pending = [];
  };

  let i = 0;
  const n = tokens.length;

  /** Consumes a `:::name` container's tokens and returns its blocks. */
  function collectUntil(closeType) {
    const blocks = [];
    while (i < n && tokens[i].type !== closeType) {
      const b = readBlock();
      if (b) blocks.push(...(Array.isArray(b) ? b : [b]));
    }
    i++; // skip the *_close
    return blocks;
  }

  /** Reads a block starting at tokens[i]; advances i. May return null.
   *  Every block returned carries `line` (position in the source file). */
  function readBlock() {
    const line = lineOf(tokens[i]);
    const b = readBlockAt();
    if (b && line != null) {
      for (const x of Array.isArray(b) ? b : [b]) x.line ??= line;
    }
    return b;
  }

  function readBlockAt() {
    const t = tokens[i];

    // Lists (bulleted or numbered), with nesting.
    //
    // An item can carry something other than text: a table, a code block, a
    // quotation, a callout. Collecting every `inline` token indiscriminately
    // destroyed them — a table's cells became fake bullets, and a code block,
    // which emits no `inline` at all, vanished without a trace. The engine
    // only drops content at the registry's stated boundaries: those blocks are
    // therefore re-read as they are and reinserted IN THEIR PLACE in source
    // order — the list is split at the insertion point (bullets before, block,
    // bullets after) — rather than lost (or merely reported).
    // Only the `inline` tokens of an item's paragraph become bullets.
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const ordered = t.type === 'ordered_list_open';
      const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
      const out = [];
      let items = [];
      let itemsLine = null;
      // rank of the next top-level item: a numbered list cut in two by a
      // nested block must not restart at "1." after the block. `startAt` is
      // the same convention as the split performed by pagination.
      let rank = 1;
      /** Closes the current list chunk to let a block through. */
      const flushBullets = () => {
        if (!items.length) return;
        const b = { type: 'bullets', ordered, items };
        if (ordered && rank > 1) b.startAt = rank;
        if (itemsLine != null) b.line = itemsLine;
        rank += items.filter((it) => !it.level).length;
        out.push(b);
        items = [];
        itemsLine = null;
      };
      let depth = 0;
      let para = 0;
      i++;
      while (i < n) {
        const u = tokens[i];
        if (
          (u.type === 'bullet_list_open' || u.type === 'ordered_list_open') &&
          depth >= 0 &&
          u.level > t.level
        ) {
          depth++;
          i++;
          continue;
        }
        if (u.type === close && u.level === t.level) {
          i++;
          break;
        }
        if (u.type === 'bullet_list_close' || u.type === 'ordered_list_close') {
          depth--;
          i++;
          continue;
        }
        // A heading indented under a bullet does NOT open a section: its text
        // stays a bullet. It is therefore counted as an item paragraph, or
        // else the `para > 0` below would make it vanish without a trace.
        if (/^(paragraph|heading)_(open|close)$/.test(u.type)) {
          para += u.type.endsWith('_open') ? 1 : -1;
          i++;
          continue;
        }
        if (ITEM_NESTED_BLOCKS.has(u.type) || /^container_\w+_open$/.test(u.type)) {
          // the bullets already read come out BEFORE the block: source order is
          // real, and a table illustrating point 1 does not land after point 3
          flushBullets();
          // readBlock() consumes the whole block: its `inline` tokens (cells,
          // quotation…) can no longer be mistaken for bullets
          const b = readBlock();
          if (b) out.push(...(Array.isArray(b) ? b : [b]));
          continue;
        }
        if (u.type === 'inline' && para > 0) {
          // nesting level: roughly (token level - base level) / 2
          const lvl = Math.max(0, Math.floor((u.level - t.level - 2) / 2));
          items.push({ runs: inlineRuns(u), level: Math.min(lvl, 2) });
          itemsLine ??= lineOf(u);
        }
        i++;
      }
      flushBullets();
      // an empty list stays an empty list (downstream expects the block)
      if (!out.length) return { type: 'bullets', ordered, items: [] };
      return out.length === 1 ? out[0] : out;
    }

    switch (t.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        i += 3; // open, inline, close
        if (inline?.type !== 'inline') return null;
        // images and text become a sequence of blocks, in source order
        const blocks = inlineParagraphBlocks(inline);
        if (!blocks.length) return null;
        return blocks.length === 1 ? blocks[0] : blocks;
      }
      case 'heading_open': {
        const depth = Number(t.tag.slice(1));
        const inline = tokens[i + 1];
        i += 3;
        const runs = inline?.type === 'inline' ? inlineRuns(inline) : [];
        return { type: 'heading', depth, runs };
      }
      case 'fence': {
        i++;
        const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid') return { type: 'mermaid', source: t.content };
        if (lang === 'math' || lang === 'latex' || lang === 'tex')
          return { type: 'math', source: t.content.trim() };
        if (lang === 'chart') {
          const spec = parseChartSpec(t.content);
          if (spec) return { type: 'chart', ...spec };
          // spec could not be parsed → code stays visible, never a broken slide
          return { type: 'code', lang, source: t.content.replace(/\n$/, ''), invalidChart: true };
        }
        return { type: 'code', lang, source: t.content.replace(/\n$/, '') };
      }
      case 'code_block': {
        i++;
        return { type: 'code', lang: '', source: t.content.replace(/\n$/, '') };
      }
      case 'blockquote_open': {
        i++;
        const inner = collectUntil('blockquote_close');
        const paras = inner.filter((b) => b.type === 'para');
        // What is not a paragraph (list, table, image) cannot go inside a
        // quotation: the dropped TYPES are kept so that validation says so
        // (QUOTE_CONTENT_DROPPED), instead of a silent loss.
        const dropped = [...new Set(inner.filter((b) => b.type !== 'para').map((b) => b.type))];
        // Convention: a last paragraph starting with "—" = attribution.
        let cite = null;
        if (paras.length > 1) {
          const last = runsToText(paras[paras.length - 1].runs);
          if (/^[—–-]\s*/.test(last)) {
            cite = last.replace(/^[—–-]\s*/, '');
            paras.pop();
          }
        }
        return {
          type: 'quote',
          runs: paras.flatMap((p, k) => (k ? [{ text: ' ' }, ...p.runs] : p.runs)),
          cite,
          ...(dropped.length ? { dropped } : {}),
        };
      }
      case 'table_open': {
        const header = [];
        const rows = [];
        let inHead = false;
        let row = null;
        i++;
        while (i < n && tokens[i].type !== 'table_close') {
          const u = tokens[i];
          if (u.type === 'thead_open') inHead = true;
          else if (u.type === 'thead_close') inHead = false;
          else if (u.type === 'tr_open') row = [];
          else if (u.type === 'tr_close') (inHead ? header : rows).push(row);
          else if (u.type === 'inline') row.push(inlineRuns(u));
          i++;
        }
        i++;
        return { type: 'table', header: header[0] ?? [], rows };
      }
      case 'html_block': {
        i++;
        const c = parseComment(t.content);
        if (c) {
          const directive = { ...c, line: lineOf(t) };
          if (slide) applyDirective(slide, directive);
          else pending.push(directive);
        }
        return null;
      }
      case 'hr': {
        i++;
        return { type: 'hr' };
      }
      default: {
        // :::name containers
        const cm = t.type.match(/^container_(\w+)_open$/);
        if (cm) {
          i++;
          const kind = cm[1];
          const inner = collectUntil(`container_${kind}_close`);
          if (kind === 'metric') {
            // 1st line = value, the rest = label — whether the lines are
            // separate paragraphs or split by a plain soft break
            const lines = [];
            for (const p of inner.filter((b) => b.type === 'para')) {
              let cur = [];
              for (const r of p.runs) {
                if (r.soft) {
                  lines.push(cur);
                  cur = [];
                } else cur.push(r);
              }
              lines.push(cur);
            }
            const filled = lines.filter((l) => l.length);
            // last line read as a trend (↑ +12 %…) if it has the shape of one
            let trend = null;
            if (filled.length > 1) {
              trend = parseTrend(runsToText(filled[filled.length - 1]).trim());
              if (trend) filled.pop();
            }
            return {
              type: 'metric',
              value: filled[0] ? runsToText(filled[0]).trim() : '',
              label: filled
                .slice(1)
                .map((l) => runsToText(l).trim())
                .join(' '),
              ...(trend ? { trend } : {}),
            };
          }
          return { type: 'alert', kind, blocks: inner };
        }
        i++; // unhandled token
        return null;
      }
    }
  }

  while (i < n) {
    const t = tokens[i];

    if (t.type === 'hr') {
      i++;
      pushSlide();
      // a directive still pending here precedes a `---` with no slide having
      // opened in between: it governed nothing
      dropPending();
      continue;
    }

    const read = readBlock();
    if (!read) continue;

    // a paragraph mixing text and images returns several blocks: all of them
    // are placed, in source order
    for (const block of Array.isArray(read) ? read : [read]) {
      if (block.type === 'heading' && block.depth === 1) {
        pushSlide();
        ensureSlide();
        slide.titleRuns = block.runs;
        slide.title = runsToText(block.runs);
        slide.line ??= block.line;
        continue;
      }

      ensureSlide();
      slide.line ??= block.line;
      if (block.type === 'heading' && block.depth === 2) {
        // new section (potential slot)
        if (curSection().heading !== null || curSection().blocks.length) {
          slide.sections.push({ heading: block.runs, blocks: [] });
        } else {
          curSection().heading = block.runs;
        }
        continue;
      }
      if (block.type === 'hr') continue;
      curSection().blocks.push(block);
    }
  }
  pushSlide();
  dropPending();

  return {
    meta,
    slides: slides.filter((s) => s.title || s.sections.some((x) => x.blocks.length || x.heading)),
    // key absent when there is nothing to report: the IR of a healthy deck
    // does not change shape for an anomaly it does not have
    ...(orphanDirectives.length ? { orphanDirectives } : {}),
  };
}
