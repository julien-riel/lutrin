/**
 * Marp dialect (Marpit + Marp Core) — helpers of the front end.
 *
 * A deck opting in with `marp: true` in its frontmatter is read with Marp
 * semantics instead of the lutrin DSL:
 *   - slides split on `---` only (`# H1` does not split; `headingDivider`
 *     restores heading splits when the deck asks for it);
 *   - the first `#`/`##` of a slide is its title, later `##` open sections;
 *   - an HTML comment is a presenter note, unless it carries directives;
 *   - `![bg …]` images become the slide background (or a split side), and
 *     the Marp sizing/filter keywords of an alt are consumed;
 *   - fragmented lists (`*` bullets, `1)` items) animate their slide;
 *   - `<!-- fit -->` in a heading is removed (fitting is the engine's job).
 *
 * Marp directives with no lutrin equivalent are COLLECTED, not lost: the
 * parser returns them in `deck.marpIgnored` and validation reports each one
 * (MARP_DIRECTIVE_IGNORED, info). Purely cosmetic directives that lutrin's
 * engine already decides on its own (class, paginate, math, lang…) are
 * accepted in silence. The lutrin extensions — `<!-- layout: … -->`,
 * `<!-- notes: … -->`, `<!-- animate -->`, `kit:` and the `:::` callouts —
 * keep working inside a Marp deck.
 */

/** Marp global directives (deck-wide; also the Marp CLI metadata keys). */
export const MARP_GLOBAL = new Set([
  'theme',
  'style',
  'headingDivider',
  'lang',
  'size',
  'math',
  'marp',
  'title',
  'description',
  'keywords',
  'url',
  'image',
]);

/** Marp local directives (per-slide, inherited; `_` prefix = spot). */
export const MARP_LOCAL = new Set([
  'paginate',
  'header',
  'footer',
  'class',
  'backgroundColor',
  'backgroundImage',
  'backgroundPosition',
  'backgroundRepeat',
  'backgroundSize',
  'color',
]);

/** lutrin's own comment directives — valid in a Marp deck too (extension). */
const LUTRIN_COMMENT_KEYS = new Set(['notes', 'layout', 'animate']);

/** `marp: true` (frontmatter) opts the deck into the Marp dialect. */
export const isMarpDeck = (meta) => /^true$/i.test(String(meta?.marp ?? '').trim());

/**
 * Sorts a Marp directive into what the engine does with it:
 *   - 'lutrin'  — layout/notes/animate, routed through the normal machinery;
 *   - 'footer'  — mapped onto the deck footer (meta.footer, last one wins);
 *   - 'divider' — headingDivider, changes how slides split;
 *   - 'silent'  — accepted without effect NOR noise: the engine already
 *     decides pagination, classes, math rendering… on its own;
 *   - 'ignored' — no lutrin equivalent; reported by MARP_DIRECTIVE_IGNORED.
 * Spot directives (`_key`) classify like their base key, except `_footer`,
 * which would need a per-slide footer lutrin does not have.
 */
export function classifyMarpDirective(key) {
  const spot = key.startsWith('_');
  const base = spot ? key.slice(1) : key;
  if (LUTRIN_COMMENT_KEYS.has(base)) return spot ? 'ignored' : 'lutrin';
  if (base === 'footer') return spot ? 'ignored' : 'footer';
  // `_headingDivider` does not exist in Marp (the `_` prefix only applies to
  // LOCAL directives): consumed in silence, like Marp Core does with an
  // unknown key mixed into a directive comment
  if (base === 'headingDivider') return spot ? 'silent' : 'divider';
  // pagination, section classes, math engine, language and the HTML metadata
  // (title, description…) are things the engine or the renderer already
  // handles its own way: accepting them costs nothing and warns about nothing
  if (
    [
      'paginate',
      'class',
      'math',
      'lang',
      'marp',
      'title',
      'subtitle',
      'author',
      'date',
      'description',
      'keywords',
      'url',
      'image',
    ].includes(base)
  ) {
    return 'silent';
  }
  if (MARP_LOCAL.has(base)) return 'ignored';
  if (MARP_GLOBAL.has(base)) return 'ignored';
  return 'silent';
}

const DIRECTIVE_KEY = /^(_?[A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/;
/** The lutrin comment grammar, valid on a comment's WHOLE body: it accepts a
 *  bare `<!-- animate -->` and a multiline `<!-- notes: … -->`, which the
 *  strict line-by-line reading below would misread as prose. */
const LUTRIN_COMMENT = /^\s*(notes|layout|animate)\s*(?::\s*([\s\S]*?))?\s*$/;

const isKnownKey = (key) => {
  // `_` only exists on Marp's LOCAL directives; anything else spot-prefixed
  // is not a directive at all — the comment stays a note, like in Marpit
  if (key.startsWith('_')) return MARP_LOCAL.has(key.slice(1));
  return MARP_LOCAL.has(key) || MARP_GLOBAL.has(key) || LUTRIN_COMMENT_KEYS.has(key);
};

/** One comment body → its directives, or null when the comment is prose. */
function commentDirectives(body) {
  const lutrin = body.match(LUTRIN_COMMENT);
  if (lutrin) return [{ key: lutrin[1], value: (lutrin[2] ?? '').trim() }];
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '');
  const pairs = lines.map((l) => l.trim().match(DIRECTIVE_KEY));
  if (!lines.length || !pairs.every(Boolean) || !pairs.some((m) => isKnownKey(m[1]))) return null;
  return pairs.map((m) => ({ key: m[1], value: m[2].replace(/^["']|["']$/g, '') }));
}

/**
 * Reads an html_block in Marp mode: `{ directives, notes }`, each possibly
 * empty. Each comment of the block is classified ON ITS OWN, per the Marp
 * contract: every non-empty line `key: value` with at least one known key
 * (Marp or lutrin) → directives; any other comment → a presenter note,
 * whitespace-trimmed, line breaks preserved. Returns null when the block is
 * not made of comments (raw HTML: ignored, as in the lutrin DSL, except
 * `<style>` which is reported as the `style` directive it is).
 */
export function parseMarpComment(html) {
  if (/^\s*<style[\s>]/i.test(html))
    return { directives: [{ key: 'style', value: '' }], notes: [] };
  const comments = [...html.matchAll(/<!--([\s\S]*?)-->/g)];
  if (!comments.length) return null;
  // anything outside the comments (real markup) disqualifies the block
  if (/\S/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) return null;
  const directives = [];
  const notes = [];
  for (const m of comments) {
    const parsed = commentDirectives(m[1]);
    if (parsed) {
      directives.push(...parsed);
      continue;
    }
    const note = m[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .join('\n')
      .trim();
    if (note) notes.push(note);
  }
  return { directives, notes };
}

/**
 * `headingDivider: 2` splits before every heading of level <= 2;
 * `headingDivider: [1, 3]` only at the exact levels listed. Returns a Set of
 * levels, or null when the value cannot be read (the deck then splits on
 * `---` only, like a value-less Marp deck).
 */
export function parseHeadingDivider(value) {
  const raw = String(value ?? '').trim();
  const list = raw.match(/^\[([^\]]*)\]$/);
  const levels = new Set();
  if (list) {
    for (const part of list[1].split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n >= 1 && n <= 6) levels.add(n);
    }
    return levels.size ? levels : null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 6) return null;
  for (let k = 1; k <= n; k++) levels.add(k);
  return levels;
}

/**
 * Interprets the frontmatter of a Marp deck, in place. `theme:` is moved to
 * `marpTheme` so that it never reaches kit resolution — a Marp theme name is
 * not a lutrin kit, and leaving it would turn `theme: gaia` into a fatal
 * KIT_NOT_FOUND. Returns the heading divider and the directives to report.
 */
export function marpMeta(meta) {
  const ignored = [];
  if (meta.theme != null) {
    meta.marpTheme = meta.theme;
    delete meta.theme;
    ignored.push({ key: 'theme', value: meta.marpTheme });
  }
  let divider = null;
  if (meta.headingDivider != null) divider = parseHeadingDivider(meta.headingDivider);
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'headingDivider' || key === 'marpTheme') continue;
    if (key === 'size') {
      // only worth a report when it asks for something else than the engine's
      // fixed 16:9 canvas
      if (!/^16\s*:\s*9$/.test(String(value).trim())) ignored.push({ key, value });
      continue;
    }
    if (classifyMarpDirective(key) === 'ignored') ignored.push({ key, value });
  }
  return { divider, ignored };
}

const BG_SIZE = /^(fit|contain|cover|auto|\d+(?:\.\d+)?%)$/;
const DIMENSION = /^(?:w|h|width|height):\S+$/;
const FILTER =
  /^(blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|opacity|saturate|sepia)(?::\S+)?$/;
const SPLIT_SIDE = /^(left|right)(?::\d+(?:\.\d+)?%)?$/;

/**
 * Maps the Marp alt grammar of an image block, in place. `![bg …]` becomes
 * the slide background (role `background`), `bg left`/`bg right` the image
 * side of a split slide; sizing keywords and CSS filters are consumed — the
 * engine sizes and styles on its own. Whatever remains is the alt text.
 */
export function marpImage(block) {
  if (block.type !== 'image') return block;
  const words = (block.alt ?? '').split(/\s+/).filter(Boolean);
  // like Marpit, `bg` is recognized at ANY position among the alt keywords
  const bgIdx = words.indexOf('bg');
  const bg = bgIdx !== -1;
  if (bg) words.splice(bgIdx, 1);
  let side = null;
  const rest = [];
  for (const w of words) {
    if (bg) {
      const s = w.match(SPLIT_SIDE);
      if (s) {
        side = s[1];
        continue;
      }
      if (w === 'vertical' || BG_SIZE.test(w)) continue;
    }
    if (DIMENSION.test(w) || FILTER.test(w)) continue;
    rest.push(w);
  }
  if (bg) block.role = side ?? 'background';
  block.alt = rest.join(' ');
  return block;
}

/** Removes inline HTML comments (`# <!-- fit --> Title`, a comment written
 *  mid paragraph) from a run list. A code run is never touched. Each removed
 *  comment body is handed to `onComment` — Marpit reads directives and notes
 *  in inline comments too, they must not vanish. The `fit` marker is the one
 *  inline comment that is pure markup: it is dropped without a callback. */
export function stripInlineComments(runs, onComment) {
  const out = [];
  for (const r of runs ?? []) {
    if (r.code || !r.text?.includes('<!--')) {
      out.push(r);
      continue;
    }
    const text = r.text.replace(/<!--([\s\S]*?)-->/g, (_, body) => {
      if (onComment && !/^\s*fit\s*$/.test(body)) onComment(body);
      return '';
    });
    if (/\S/.test(text) || r.soft) out.push({ ...r, text });
  }
  // the comment leaves its separating space behind ("<!-- fit --> Title"):
  // trim the edges so the title does not start with a blank
  if (out.length && !out[0].code) out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const last = out.length - 1;
  if (last >= 0 && !out[last].code)
    out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, '') };
  return out.filter((r) => r.code || r.soft || r.text !== '' || r.link);
}

/**
 * Marp post-reading of the blocks a readBlock() returned: images remapped
 * (`![bg …]`), inline comments stripped from the texts and routed through
 * `onComment` (directives and notes live in inline comments too), paragraphs
 * emptied by the stripping dropped. `fragmented` flags survive only on
 * top-level bullet blocks — the slide loop turns them into the slide's
 * animation.
 */
export function marpBlocks(read, onComment) {
  const blocks = Array.isArray(read) ? read : [read];
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'image':
        out.push(marpImage(b));
        continue;
      case 'para':
      case 'quote': {
        b.runs = stripInlineComments(b.runs, onComment);
        if (b.runs.length) out.push(b);
        continue;
      }
      case 'heading':
        b.runs = stripInlineComments(b.runs, onComment);
        out.push(b);
        continue;
      case 'bullets':
        b.items = b.items
          .map((it) => ({ ...it, runs: stripInlineComments(it.runs, onComment) }))
          .filter((it) => it.runs.length);
        out.push(b);
        continue;
      case 'alert':
        // a fragmented list nested in a callout reveals with the callout:
        // the flag must not leak into the IR
        for (const inner of b.blocks) delete inner.fragmented;
        out.push(b);
        continue;
      default:
        out.push(b);
    }
  }
  if (!out.length) return null;
  return out.length === 1 && !Array.isArray(read) ? out[0] : out;
}
