/**
 * Source slicing for the deck editor: the file is cut into one line slice per
 * slide, and everything between slices — `---` separators, blank lines,
 * orphan comments — stays "glue", untouched. Editing one slide is then a pure
 * line splice: the rest of the file is never rewritten, so nothing an author
 * wrote outside the edited slide can drift or be reformatted.
 *
 * The boundaries REUSE the tokens of parse.mjs (`token.map`): a `#` inside a
 * fence, a `---` under a setext heading or inside a `:::` container never
 * fool the cut, because they never fooled markdown-it. This module owns no
 * scanner of its own.
 *
 * A slice may also carry `parts` — a form-shaped view (title, directives,
 * intro, sections) that serializeParts() turns back into canonical markdown.
 * parts are only returned when the round trip is PROVEN faithful: the
 * serialized form must reparse to the very same slide IR, positions aside.
 * Anything the form cannot represent keeps `parts: null` and is edited as
 * text. The Marp dialect is not sliceable at all in v1: its slides split on
 * rules of their own (headingDivider, `---` only), and a wrong boundary is a
 * corrupted file — view-only is the honest answer.
 *
 * The write side lives here too: spliceSlice() is the ONE splice the editor
 * performs, with the boundary guards that keep a replaced slide from welding
 * into the glue around it.
 */

import { parseComment, parseDeck, tokenizeDeck } from './parse.mjs';

/** IR keys that record WHERE something sat in the file. Two parses of the
 *  same slide written at two different offsets differ in nothing else, so
 *  fidelity comparisons drop them — recursively, because a section carries
 *  `headingLine` and a directive `layoutLine`. */
const POSITION_KEYS = new Set(['line', 'layoutLine', 'animateLine', 'headingLine']);

/** Deep copy of an IR fragment with every position key removed. Exported so
 *  the tests (and the edit server) compare fidelity with the exact same
 *  notion of "same slide" as the guard below. */
export function stripPositions(value) {
  if (Array.isArray(value)) return value.map(stripPositions);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!POSITION_KEYS.has(k)) out[k] = stripPositions(v);
    }
    return out;
  }
  return value;
}

/** A comment that is NOT a directive: parseComment() ignores it, so it can
 *  sit in front of a serialized slice without changing anything — it is only
 *  there so the reparsed source can never be mistaken for a frontmatter or
 *  otherwise read differently at position zero of a file. */
const NEUTRAL_PREFIX = '<!-- slice -->\n\n';

/** The text runsToText() would produce for an inline token — used for its
 *  truthiness only: parseDeck drops a slide whose title collapses to '' and
 *  whose body never opened, and the slicer must drop the same candidate. The
 *  branches mirror pushRun(): images vanish from runs, breaks become spaces,
 *  a raw `<img>` is recorded elsewhere and produces no text. */
function inlineText(inline) {
  let out = '';
  for (const t of inline?.children ?? []) {
    if (t.type === 'text' || t.type === 'text_special' || t.type === 'code_inline') {
      out += t.content;
    } else if (t.type === 'badge_inline') out += t.content;
    else if (t.type === 'softbreak' || t.type === 'hardbreak') out += ' ';
    else if (t.type === 'html_inline' && !/^<img\b/i.test(t.content)) out += t.content;
  }
  return out;
}

/** True when the paragraph would yield at least one block — the mirror of
 *  parse.mjs's null paragraph: one holding nothing but a raw `<img>` (or
 *  emphasis markers around one) produces no block, therefore opens no slide
 *  and owns no lines. An image token always becomes a block; for the rest,
 *  only ink that survives trimming counts. */
function paragraphHasBlocks(inline) {
  for (const t of inline?.children ?? []) {
    if (t.type === 'image' || t.type === 'code_inline' || t.type === 'badge_inline') return true;
    if ((t.type === 'text' || t.type === 'text_special') && /\S/.test(t.content)) return true;
    if (t.type === 'html_inline' && !/^<img\b/i.test(t.content)) return true;
  }
  return false;
}

/** Index just past the block opened at tokens[i]: the matching `*_close` sits
 *  at the same nesting level, whatever same-named blocks are nested inside. */
function skipPast(tokens, i) {
  const t = tokens[i];
  const close = t.type.replace(/_open$/, '_close');
  let j = i + 1;
  while (j < tokens.length && !(tokens[j].type === close && tokens[j].level === t.level)) j++;
  return j + 1;
}

/** An html_block whose WHOLE trimmed content is one directive comment, and
 *  nothing else. parseComment() matches a directive ANYWHERE in the block —
 *  `<div>…</div>\n<!-- layout: x -->` still sets the layout in parseDeck, so
 *  the slicer must honour the same ownership — but only a pure block may be
 *  BLANKED out of the form text: blanking a mixed one would destroy the
 *  author's markup the moment the form is written back. */
const PURE_DIRECTIVE = /^<!--\s*(?:notes|layout|animate)\s*(?::[\s\S]*?)?-->$/;

/** markdown-it-container maps its open token as [start, closing-marker line):
 *  alone among block tokens, the closing `:::` is left OUT of the map. The
 *  slicer gives it back its last line whenever the marker really is there —
 *  an auto-closed container at EOF has none to give back. */
const CLOSING_FENCE = /^\s{0,3}:{3,}\s*$/;

/**
 * Walks the top-level tokens and groups them into slide candidates, replaying
 * parseDeck's boundary rules: a `# H1` or the first content block opens a
 * slide, an `hr` or the next `# H1` closes it, a directive comment belongs to
 * the open slide or waits (pending) for the next one to open. Every owned
 * token contributes its line range (body-relative); tokens parseDeck reads as
 * nothing — a non-directive HTML block, an inkless paragraph — own no lines
 * and open nothing. `keep` mirrors parseDeck's empty-slide filter.
 *
 * `lines`/`lineOffset` are only consulted to spot a container's closing
 * fence (see CLOSING_FENCE).
 */
function scanSlides(tokens, lines, lineOffset) {
  const candidates = [];
  let cur = null;
  let pending = [];

  const open = () => {
    if (cur) return;
    cur = { segments: pending, keep: false, first: null };
    pending = [];
  };
  const close = () => {
    if (cur) candidates.push(cur);
    cur = null;
  };
  const ownContent = (t, end = t.map[1]) => {
    open();
    cur.first ??= t.map[0];
    cur.keep = true;
    cur.segments.push({ kind: 'content', start: t.map[0], end });
  };

  let i = 0;
  const n = tokens.length;
  while (i < n) {
    const t = tokens[i];
    if (t.level !== 0 || !t.type) {
      i++;
      continue;
    }
    if (t.type === 'hr') {
      // slide separator — and directives still pending have nothing left to
      // govern: parseDeck reports them as orphans, the slicer leaves their
      // lines in the glue
      close();
      pending = [];
      i++;
      continue;
    }
    if (t.type === 'html_block') {
      const c = parseComment(t.content);
      if (c) {
        const seg = {
          kind: 'directive',
          key: c.key,
          value: c.value,
          pure: PURE_DIRECTIVE.test(t.content.trim()),
          start: t.map[0],
          end: t.map[1],
        };
        if (cur) cur.segments.push(seg);
        else pending.push(seg);
      }
      // any other HTML block is inert in parseDeck (a null block): it opens
      // no slide and owns no lines — glue, or interior text of the slide it
      // happens to sit inside
      i++;
      continue;
    }
    if (t.type === 'heading_open') {
      const depth = Number(t.tag.slice(1));
      const inline = tokens[i + 1]?.type === 'inline' ? tokens[i + 1] : null;
      if (depth === 1) {
        close();
        open();
        cur.first ??= t.map[0];
        cur.segments.push({
          kind: 'title',
          text: inline?.content ?? '',
          start: t.map[0],
          end: t.map[1],
        });
        // parseDeck's empty-slide filter: an H1 whose text collapses to ''
        // does not, on its own, keep the slide alive
        if (inlineText(inline)) cur.keep = true;
      } else if (depth === 2) {
        open();
        cur.first ??= t.map[0];
        // a section heading keeps the slide even with nothing under it
        cur.keep = true;
        cur.segments.push({
          kind: 'section',
          text: inline?.content ?? '',
          start: t.map[0],
          end: t.map[1],
        });
      } else {
        // ### and deeper are ordinary content blocks
        ownContent(t);
      }
      i = skipPast(tokens, i);
      continue;
    }
    if (t.type === 'paragraph_open') {
      if (tokens[i + 1]?.type === 'inline' && paragraphHasBlocks(tokens[i + 1])) ownContent(t);
      i += 3; // open, inline, close
      continue;
    }
    if (t.type === 'fence' || t.type === 'code_block') {
      ownContent(t);
      i++;
      continue;
    }
    if (/_open$/.test(t.type) && t.map) {
      // list, blockquote, table, ::: container — every one of them yields a
      // block in parseDeck, even empty
      const isContainer = /^container_\w+_open$/.test(t.type);
      const fenceLine = lines[t.map[1] + lineOffset] ?? '';
      const end = isContainer && CLOSING_FENCE.test(fenceLine) ? t.map[1] + 1 : t.map[1];
      ownContent(t, end);
      i = skipPast(tokens, i);
      continue;
    }
    i++; // stray token: nothing to own
  }
  close();
  return candidates;
}

/**
 * The canonical markdown of a slide's `parts` — the exact inverse the form
 * editor writes back. Order is fixed (title, layout/animate, intro, sections,
 * notes at the end) and chunks are separated by one blank line; the guard in
 * buildParts() proves per slide that this normalization changes nothing in
 * the IR before a form is ever offered.
 */
export function serializeParts(parts) {
  const chunks = [];
  if (parts.title != null) chunks.push(`# ${parts.title}`.trimEnd());
  const directives = [];
  if (parts.layout != null) directives.push(`<!-- layout: ${parts.layout} -->`);
  if (parts.animate != null) {
    // a bare `<!-- animate -->` reads back as the empty value: keep writing
    // the spelling the author knows rather than a dangling colon
    directives.push(
      parts.animate === '' ? '<!-- animate -->' : `<!-- animate: ${parts.animate} -->`,
    );
  }
  if (directives.length) chunks.push(directives.join('\n'));
  if (parts.intro) chunks.push(parts.intro);
  for (const section of parts.sections ?? []) {
    const heading = `## ${section.heading}`.trimEnd();
    chunks.push(section.body ? `${heading}\n\n${section.body}` : heading);
  }
  if (parts.notes?.length) {
    chunks.push(parts.notes.map((n) => `<!-- notes: ${n} -->`).join('\n'));
  }
  return chunks.join('\n\n');
}

/**
 * Form-shaped view of one candidate, or null when the form cannot faithfully
 * represent the slice. Directive and heading lines are BLANKED, not removed,
 * when extracting intro/section text: a comment sitting between two
 * paragraphs was separating them, and removing its line would weld them into
 * one. The fidelity guard then reparses the canonical serialization and
 * demands the exact original IR (positions aside) — one deep comparison
 * covering every normalization this module dares to make.
 */
function buildParts(cand, original, lines, lineOffset, startLine, endLine) {
  let title = null;
  let layout = null;
  let animate = null;
  const notes = [];
  const sections = [];
  const masked = new Set(); // 0-based file lines erased from intro/body text

  for (const seg of cand.segments) {
    if (seg.kind === 'content') continue;
    // a directive sharing its html_block with author markup (`<div>…</div>`
    // above it, a stray `<!-- TODO -->`, prose after the `-->`): the form
    // would have to blank those lines to extract intro/body text, and the
    // serialization would write the bare directive back — the markup is gone
    // and, the IR having never held it, the fidelity guard below would not
    // notice. Raw text is the only faithful editor for such a slide.
    if (seg.kind === 'directive' && !seg.pure) return null;
    const from = seg.start + lineOffset;
    const to = seg.end + lineOffset; // exclusive
    for (let k = from; k < to; k++) masked.add(k);
    if (seg.kind === 'title') title = seg.text;
    else if (seg.kind === 'section') sections.push({ heading: seg.text, from, to });
    else if (seg.key === 'layout') layout = seg.value;
    else if (seg.key === 'animate') animate = seg.value;
    else notes.push(seg.value);
  }

  /** Exact source text of the file lines [from, to) — masked lines blanked,
   *  blank edges trimmed, carriage returns dropped (the canonical form is
   *  written back with bare newlines either way). */
  const regionText = (from, to) => {
    const out = [];
    for (let k = from; k < to; k++) out.push(masked.has(k) ? '' : lines[k].replace(/\r$/, ''));
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
  };

  const introEnd = sections.length ? sections[0].from : endLine;
  const parts = {
    title,
    layout,
    notes,
    animate,
    intro: regionText(startLine - 1, introEnd),
    sections: sections.map((s, k) => ({
      heading: s.heading,
      body: regionText(s.to, k + 1 < sections.length ? sections[k + 1].from : endLine),
    })),
  };

  try {
    const reparsed = parseDeck(`${NEUTRAL_PREFIX}${serializeParts(parts)}\n`);
    if (reparsed.slides.length !== 1) return null;
    const same =
      JSON.stringify(stripPositions(reparsed.slides[0])) ===
      JSON.stringify(stripPositions(original));
    return same ? parts : null;
  } catch {
    return null;
  }
}

/**
 * Cuts a deck source into per-slide line slices.
 *
 * @returns {{ meta: object, sliceable: boolean, lineCount: number,
 *             slides: Array<{ index: number, startLine: number, endLine: number,
 *                             source: string, title: string|null,
 *                             layout: string|null, parts: object|null }> }}
 *
 * `startLine`/`endLine` are 1-based and inclusive, in the COMPLETE file
 * (frontmatter included); a directive written before its slide's `# H1` is
 * inside the slice, trailing blank lines are not. `lineCount` counts the
 * `\n`-separated slots of the source — the same array a splice works on.
 * Slices are disjoint and ordered, and align index for index with
 * `parseDeck(source).slides`; should the scan ever disagree with the parser,
 * the deck comes back `sliceable: false` rather than editable through wrong
 * boundaries.
 */
export function sliceDeck(source) {
  const { lineOffset, tokens, marp } = tokenizeDeck(source);
  const lines = source.split('\n');
  const lineCount = lines.length;
  const parsed = parseDeck(source);
  if (marp) return { meta: parsed.meta, sliceable: false, lineCount, slides: [] };
  // A lone `\r` — classic-Mac endings, or a paste mangled in transit — is a
  // line break to markdown-it but not to split('\n'): every position the two
  // sides exchange would disagree, and a splice through shifted numbers
  // corrupts the file. Pure CRLF is safe: each `\r\n` still contains one
  // `\n`, so the counts match and the `\r`s travel inside the slice text,
  // coming back verbatim at splice time. Same honest fallback as Marp.
  if (/\r(?!\n)/.test(source)) {
    return { meta: parsed.meta, sliceable: false, lineCount, slides: [] };
  }

  const kept = scanSlides(tokens, lines, lineOffset).filter((c) => c.keep);
  const blank = (idx) => !lines[idx] || !lines[idx].trim();

  const slides = kept.map((cand, index) => {
    const original = parsed.slides[index];
    if (!original) return null;
    const startLine = Math.min(...cand.segments.map((s) => s.start)) + lineOffset + 1;
    let endLine = Math.max(...cand.segments.map((s) => s.end)) + lineOffset;
    // a list's map may run past its last item into the blanks after it:
    // trailing blank lines are glue, not slide
    while (endLine > startLine && blank(endLine - 1)) endLine--;
    return {
      index,
      startLine,
      endLine,
      source: lines.slice(startLine - 1, endLine).join('\n'),
      title: original.title ?? null,
      layout: original.layout ?? null,
      parts: buildParts(cand, original, lines, lineOffset, startLine, endLine),
    };
  });

  // The scan must agree with parseDeck — same slides, same order, each
  // parser-reported first line inside its slice, slices strictly ordered. If
  // it ever does not (a boundary case this module missed), editing through
  // wrong slices could corrupt the file: view-only is the honest fallback.
  let prevEnd = 0;
  const aligned =
    kept.length === parsed.slides.length &&
    slides.every((s, k) => {
      if (!s || s.startLine <= prevEnd || s.endLine < s.startLine) return false;
      prevEnd = s.endLine;
      const line = parsed.slides[k].line;
      return line === undefined || (line >= s.startLine && line <= s.endLine);
    });
  if (!aligned) return { meta: parsed.meta, sliceable: false, lineCount, slides: [] };

  return { meta: parsed.meta, sliceable: true, lineCount, slides };
}

/** A separator standing alone on its line — `---`, `___` or `***`, as
 *  markdown reads them. The guards below watch for it in the GLUE, where no
 *  token exists to consult: the syntax is the only witness left. */
const BARE_HR = /^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/;

/** An ATX `# H1` line — the other slide opener a slice may butt against. */
const ATX_H1 = /^\s{0,3}#(?:\s|$)/;

/**
 * The one splice the editor performs: the slice's lines
 * [startLine..endLine], 1-based inclusive, replaced by `newText` (a trailing
 * `\n` is tolerated, not required). Lines are cut STRICTLY on `\n` —
 * sliceDeck refuses lone-`\r` sources upstream, and CRLF files keep their
 * `\r` inside the line text where a splice never looks.
 *
 * Two boundary guards keep the new text from welding into the glue around
 * it, because markdown reads across lines. A paragraph followed by a bare
 * `---` becomes a setext H2: the separator vanishes, two slides melt into
 * one, and a pending directive beyond the rule is silently captured by the
 * wrong slide. So a blank line is inserted after `newText` when its last
 * line has ink and the next file line is a bare rule or a `# H1`; and,
 * symmetrically, before it when the previous file line is a bare rule — a
 * file OPENING on `---` must not see yaml-looking text glued to it and wake
 * up with a frontmatter. The guards are deliberately over-eager: a spare
 * blank line between slides costs nothing, a lost separator costs a slide.
 * Whatever weld they still miss, the edit server's post-splice comparison of
 * every untouched slide turns into a visible error instead of a corruption.
 *
 * @returns {{ source: string }} the whole file, respliced
 */
export function spliceSlice(source, slice, newText) {
  const lines = source.split('\n');
  const text = newText.endsWith('\n') ? newText.slice(0, -1) : newText;
  const replacement = text.split('\n');
  const before = lines[slice.startLine - 2];
  const after = lines[slice.endLine];
  const ink = (l) => l != null && l.trim() !== '';
  const guardAfter =
    ink(replacement[replacement.length - 1]) &&
    after !== undefined &&
    (BARE_HR.test(after) || ATX_H1.test(after));
  const guardBefore = ink(replacement[0]) && before !== undefined && BARE_HR.test(before);
  if (guardAfter) replacement.push('');
  if (guardBefore) replacement.unshift('');
  lines.splice(slice.startLine - 1, slice.endLine - slice.startLine + 1, ...replacement);
  return { source: lines.join('\n') };
}
