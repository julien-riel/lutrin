/**
 * HTML renderer: scenes → standalone HTML document.
 *
 * Same contract as the PPTX renderer: all the geometry comes from the layout
 * engine (scenes in px on the 1280 × 720 grid), the renderer takes no layout
 * decision of its own. Every slide is an absolutely positioned 1280 × 720 px
 * surface, scaled to its container by a small inline script — the HTML
 * rendering is therefore geometrically identical to the .pptx.
 *
 * The document is 100 % standalone (designed for a VS Code webview — live
 * preview — where every external request is blocked by the CSP):
 *   - theme fonts inlined as base64 (woff2) when the theme provides them;
 *   - local and remote images inlined as data URIs;
 *   - charts, Lucide icons, MathJax equations and Mermaid diagrams inlined as
 *     SVG (vector: sharp at any zoom level) — every SVG we did not author
 *     goes through sanitizeSvg first.
 *
 * Three optional inline scripts equip the complete document (never the
 * fragment mode): scaling (FIT_SCRIPT), steps on click (ANIM_SCRIPT) and the
 * standalone presenter mode (PRESENT_SCRIPT — key P: full screen; key N:
 * notes/timer view in a second window).
 *
 * API for a programmatic host (VS Code plugin):
 *   - renderDeckHtml(scenes, meta, baseDir) → { html, stats }
 *   - compileHtml(markdown, { baseDir })    → { html, stats, scenes, meta }
 * The DOM is stable and addressable: every slide carries `id="slide-N"`,
 * `data-slide` and `data-layout` (scroll restoration, editor → preview
 * synchronization).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHROME,
  COLORS,
  FONTS,
  FONT_FILES,
  LOGOS,
  TYPE,
  SPACE,
  PAGE,
  SEMANTIC,
  TREND_INK,
  panelStyle,
} from '../deck/tokens.mjs';
import { ALERT_BLOCK_TYPES, parseDeck } from '../deck/parse.mjs';
import { buildScenes } from '../deck/layout.mjs';
import { prepareDeckContext } from '../deck/context.mjs';
import { chartSvg } from '../deck/chart.mjs';
import { highlightLine } from '../deck/highlight.mjs';
import {
  fetchRemoteImage,
  iconSvg,
  mathSvg,
  renderMermaidCached,
  resolveLocalImage,
  vendorRemoteAssets,
} from '../deck/assets.mjs';

/** @font-face variants of the FONTS.body family — the .woff2 paths are
 *  derived from the .ttf of FONT_FILES (same names, .woff2 extension), so a
 *  theme that ships its .ttf ships its .woff2 alongside them. */
const FONT_FACE_VARIANTS = [
  { key: 'regular', weight: 400, style: 'normal' },
  { key: 'bold', weight: 700, style: 'normal' },
  { key: 'italic', weight: 400, style: 'italic' },
];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Absolute positioning style of an element inside the slide. */
const at = (r, withH = false) =>
  `left:${Math.round(r.x)}px;top:${Math.round(r.y)}px;width:${Math.round(r.w)}px;${withH ? `height:${Math.round(r.h)}px;` : ''}`;

// ---------------------------------------------------------------------------
// Text: IR runs → inline HTML
// ---------------------------------------------------------------------------

function runsHtml(runs) {
  return runs
    .map((r) => {
      let s = esc(r.text);
      if (r.code) s = `<code>${s}</code>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      if (r.italic) s = `<em>${s}</em>`;
      if (r.link) s = `<a href="${esc(r.link)}">${s}</a>`;
      return s;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Inlined resources: images (data URI), SVG with unique identifiers
// ---------------------------------------------------------------------------

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Cache key carrying the file's digest (path + mtime + size). Without it, in
 *  a warm process — `lutrin preview`, VS Code worker, Obsidian plugin — an
 *  image replaced on disk would serve its old content forever: the watcher
 *  recompiles, but the cache returned the stale base64. Same recipe as the
 *  font memo (fontFacesCss). */
function fileCacheKey(file) {
  try {
    const st = fs.statSync(file);
    return `${file}|${st.mtimeMs}|${st.size}`;
  } catch {
    return file; // does not exist: the read will fail anyway
  }
}

const dataUriCache = new Map();
function fileToDataUri(file) {
  const key = fileCacheKey(file);
  if (dataUriCache.has(key)) return dataUriCache.get(key);
  let uri = null;
  try {
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    uri = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    uri = null;
  }
  dataUriCache.set(key, uri);
  return uri;
}

/** Makes an SVG's internal identifiers unique (Mermaid's styles and url(#…)
 *  collide as soon as two diagrams are inlined). */
function uniquifySvgIds(svg, prefix) {
  const id = svg.match(/<svg[^>]*\sid="([^"]+)"/)?.[1];
  if (!id) return svg;
  return svg.replaceAll(`"${id}"`, `"${prefix}"`).replaceAll(`#${id}`, `#${prefix}`);
}

// ---------------------------------------------------------------------------
// Sanitizing SVG that came from outside
// ---------------------------------------------------------------------------

/**
 * Three sources of SVG enter the document without our having written them:
 * the logos of a KIT, the Lucide icons (user cache or CDN) and the diagrams
 * rendered by mmdc. All three go through sanitizeSvg, and that is the only
 * inlining path.
 *
 * `kit/archive.mjs` promises in so many words that a kit is DATA — "nothing
 * that is installed will ever be executed" — while `.svg` sits in its
 * extension allow-list. Without what follows, a logo carrying `<script>` or
 * `onload=` runs: the Obsidian plugin drops this HTML through innerHTML into
 * an Electron renderer, with no CSP to catch it.
 *
 * The parsing is done by hand rather than by successive replacements: a
 * `replace(/<script[^>]*>/gi, '')` is easy to bypass (mixed case, an
 * unquoted attribute containing a `>`, entities in the value). We retokenize,
 * we re-emit what we understood, and the rest does not come back out — the
 * default is refusal, not a free pass.
 *
 * THE `<style>` CASE. An SVG inlined into HTML has no style scope of its own:
 * its `<style>` is a GLOBAL stylesheet, reaching the whole deck. We keep it
 * anyway, with its content filtered, for two reasons. First, mmdc puts ALL of
 * a Mermaid diagram's formatting in there — dropping it would render every
 * diagram in black on transparent, with nothing to signal it (`uniquifySvgIds`
 * above exists precisely because these stylesheets tread on each other).
 * Second, `archive.mjs`'s promise is about EXECUTION, not about appearance: a
 * kit is made exactly to change the look of the deck, and its `theme.json` can
 * already repaint it white through perfectly legitimate settings. The line to
 * hold is therefore not "the kit must not be able to style anything", it is
 * "nothing the kit brings executes and nothing goes out to the network". Hence
 * the filter: no `@import`, no `@namespace`, and no `url()` that is not a
 * `#local` fragment — neither in the stylesheet, nor in a `style` attribute,
 * nor in a presentation attribute (`fill`, `filter`, `mask`…). That is what
 * closes both the outgoing request and exfiltration by attribute selector +
 * `url()`.
 *
 * AND ITS BODY IS NOT RAW TEXT. That is true of an HTML `<style>`, not of
 * ours: ours is always inside `<svg>`, hence in FOREIGN CONTENT, where the
 * parser merely "inserts a foreign element" without ever switching the
 * tokenizer to RAWTEXT. The body is therefore read as MARKUP, and `img` is on
 * the list of elements that break out of foreign content:
 * `<style>…<img src=x onerror=…>` produces a real HTML image, and the handler
 * fires. This is the only place where we re-emitted input without having
 * retokenized it — exactly the gap that bypasses live on.
 * (Observed in a browser, not deduced from the specification: the body
 * `a{color:red}<img src=x onerror=…>` comes out of the tree as an HTML `<img>`
 * and the handler runs, without any `<script>` appearing at all.)
 * A stylesheet containing a `<` is therefore refused wholesale: no legitimate
 * CSS from a logo or an mmdc diagram needs one.
 */

/** Elements never re-emitted, ALONG WITH their content. */
const SVG_DROPPED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'handler',
  'listener',
]);
/** Animations: harmless, unless they target an attribute that is not
 *  (`<set attributeName="onload" to="…">`). */
const SVG_ANIMATION_ELEMENTS = new Set(['animate', 'animatetransform', 'animatemotion', 'set']);
/** Attributes whose value is a URL — hence a vector for navigation or, more
 *  seriously, for automatic fetching (see `svgUrlAllowed`). */
const SVG_URL_ATTRS = new Set([
  'href',
  'xlink:href',
  'src',
  'action',
  'formaction',
  'data',
  'ping',
]);
/** Elements whose URL may only designate a fragment of the current document:
 *  a `<use href="https://…">` is a network request AND a DOM graft. `<image>`
 *  is not on the list — a `data:image/png` is legitimate there, and it is
 *  `svgUrlAllowed` that cuts off the remote case for it. */
const SVG_LOCAL_ONLY_ELEMENTS = new Set(['use', 'textpath', 'mpath']);
/** Attribute name re-emitted as is: nothing else can be a real name. */
const SVG_ATTR_NAME_RE = /^[A-Za-z_:][\w:.-]*$/;
/** Characters browsers ignore at the head of a URL: a "javascript:" broken up
 *  by tabs or exotic spaces is still a javascript:. Control characters and the
 *  zero-width joiner are precisely the TARGET of this class — flagging them as
 *  suspicious inverts the intent. */
const URL_NOISE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: they are the target
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: same, ZWJ included
  /[\u0000-\u0020\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

/** CSS comments: removed BEFORE inspection, and it is the comment-free version
 *  that is re-emitted — what we read is exactly what we write. */
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/** Decodes a value's entities in order to INSPECT it (never to re-emit it):
 *  `&#106;avascript:` is a `javascript:` from the browser's point of view. */
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeCodePoint(Number.parseInt(d, 10)))
    .replace(
      /&(quot|apos|amp|lt|gt|Tab|NewLine|colon|sol|lpar|rpar);/gi,
      (_, n) =>
        ({
          quot: '"',
          apos: "'",
          amp: '&',
          lt: '<',
          gt: '>',
          tab: '\t',
          newline: '\n',
          colon: ':',
          sol: '/',
          lpar: '(',
          rpar: ')',
        })[n.toLowerCase()],
    );
}

const safeCodePoint = (n) =>
  Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';

/** Decodes CSS escapes in order to INSPECT a text: in CSS, `@\69 mport` is an
 *  `@import` and `\75 rl(…)` a `url(…)` — the browser's tokenizer resolves
 *  them before we do. */
function decodeCssEscapes(s) {
  return String(s)
    .replace(/\\([0-9a-f]{1,6})[ \t\n\f\r]?/gi, (_, h) => safeCodePoint(Number.parseInt(h, 16)))
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1');
}

/**
 * Normalized form of a URL as the browser will read it. The `\` is folded onto
 * `/` — the URL parser conflates them for special schemes, so that `\\host/x`
 * is the `//host/x` of the next paragraph. Above all, we do NOT decode CSS
 * escapes here: inside a URL the `\` is a character, not an escape, and
 * decoding it would make `\\host` read as `/host` — a local URL instead of a
 * remote machine.
 */
function urlProbe(raw) {
  return decodeEntities(raw).replace(URL_NOISE_RE, '').replace(/\\/g, '/').toLowerCase();
}

/** Normalized form of a CSS text: there, the `\` IS an escape, and the
 *  browser's tokenizer resolves it before reading `@import` or `url(`.
 *  Comments are dropped HERE and not only in the body of a `<style>`: a
 *  presentation attribute is CSS too, and `u/*z*\/rl(…)` is a `url()` there
 *  for the browser while the raw text shows none. */
function cssProbe(raw) {
  return decodeCssEscapes(decodeEntities(raw))
    .replace(CSS_COMMENT_RE, '')
    .replace(URL_NOISE_RE, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

/**
 * Is a URL allowed into the document? A local fragment, a bitmap image as a
 * data:, and — on an `<a>` only — http(s) and mailto. `javascript:` and
 * `data:text/html` are code; so is `data:image/svg+xml` (a referenced SVG
 * carries scripts of its own).
 *
 * FETCHING VERSUS NAVIGATION, and that is the WHOLE rule — but it is read on
 * the element + attribute PAIR, not on the element alone. An `href` (or
 * `xlink:href`) carried by an `<a>` is only followed if the reader clicks: it
 * betrays no one at render time, and refusing it would rule out the legitimate
 * case of the clickable logo. The OTHER URL attributes of an `<a>` do not
 * navigate: `ping` is a fetching beacon — the browser sends a background POST
 * on click, to a host the reader sees nowhere — and `src`, `data`, `action`,
 * `formaction` carry no navigation meaning on an `<a>`. They therefore stay
 * under the common regime. Everywhere
 * else — `<image>`, `<feImage>`, a legacy `href` on `<filter>`, `<pattern>`,
 * `<marker>` or a gradient — the URL is LOADED, on its own, at render time, on
 * every recipient of the `.html`: it is a tracking beacon (IP, User-Agent,
 * timestamp, identifier planted by the kit's author), and it makes the promise
 * of `SECURITY.md` §2 false — "once opened, the presentation has no network
 * dependency left". Hence the default: outside `<a>`, no remote scheme,
 * whatever the element. The refusal bears on the CLASS of the URL, not on a
 * list of elements that would have to be kept up to date — that is the only
 * shape that covers the loading element we will have forgotten — and, through
 * `SVG_NAVIGATION_ATTRS`, the fetching attribute we will have forgotten on `<a>`.
 */
/** The only attributes through which an `<a>` NAVIGATES. Closed list: any
 *  other URL attribute of an `<a>` loads without a click, or means nothing. */
const SVG_NAVIGATION_ATTRS = new Set(['href', 'xlink:href']);

function svgUrlAllowed(raw, tagName, attrName) {
  const v = urlProbe(raw);
  if (SVG_LOCAL_ONLY_ELEMENTS.has(tagName)) return v.startsWith('#');
  if (!v) return true;
  // `//host/x` has no scheme but does designate a remote machine: the browser
  // lends it the document's own. It is an absolute URL in disguise.
  if (v.startsWith('//')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v);
  if (!scheme) return true; // relative or fragment: no scheme to refuse
  if (
    tagName === 'a' &&
    SVG_NAVIGATION_ATTRS.has(attrName) &&
    ['http', 'https', 'mailto'].includes(scheme[1])
  )
    return true;
  return /^data:image\/(png|jpeg|gif|webp);/.test(v);
}

/**
 * Any `url()` cited in CSS may only designate a fragment of the current
 * document. This is the rule that cuts off the network: a remote `url()` is an
 * outgoing request at render time and — paired with an attribute selector — an
 * exfiltration channel that reads the DOM character by character.
 */
function cssUrlsAreLocal(css) {
  const probe = cssProbe(css);
  let i = 0;
  for (;;) {
    const at = probe.indexOf('url(', i);
    if (at < 0) return true;
    const close = probe.indexOf(')', at);
    if (close < 0) return false; // url() never closed: we could not read it
    const target = probe.slice(at + 4, close).replace(/^["']|["']$/g, '');
    if (target && !target.startsWith('#')) return false;
    i = close + 1;
  }
}

/**
 * Is a stylesheet allowed in? No `@import` and no `@namespace` (they go and
 * fetch a document elsewhere), and no remote `url()`. The verdict bears on the
 * WHOLE stylesheet: excising the offending rule would mean rewriting CSS, and
 * a miscounted brace reactivates everything that follows — we refuse
 * wholesale, which is what refusal by default means.
 */
function cssStylesheetAllowed(css) {
  const probe = cssProbe(css);
  if (probe.includes('@import') || probe.includes('@namespace')) return false;
  return cssUrlsAreLocal(css);
}

/**
 * The body of a `<style>` is re-emitted as is — it is the only input we do not
 * retokenize. But inside `<svg>` the parser reads it as MARKUP (see the
 * header), so that a `<` there opens a real HTML tag. We therefore refuse the
 * stylesheet as soon as it carries a literal `<`: that is THE vector, verified
 * in a browser.
 *
 * The entity form is refused IN ADDITION, out of caution and not out of
 * necessity: having checked, `&lt;img …>` stays text in the body of an SVG
 * `<style>` (the tokenizer recognizes tags BEFORE resolving entities, so a
 * character reference cannot reopen the "tag open" state). We refuse it all
 * the same because no logo CSS needs it and because the cost of a refusal is
 * nil, where the cost of an oversight is not.
 */
function cssHasMarkup(css) {
  return String(css).includes('<') || decodeEntities(css).includes('<');
}

/**
 * Reads the tag beginning at `start` (`svg[start] === '<'`).
 * @returns {{name, closing, selfClose, attrs, end}|null} null if this `<` does
 *          not open a tag (it is then part of the text).
 */
function readSvgTag(s, start) {
  let i = start + 1;
  const closing = s[i] === '/';
  if (closing) i++;
  const nm = /^[A-Za-z_][\w:.-]*/.exec(s.slice(i));
  if (!nm) return null;
  const name = nm[0];
  i += name.length;
  const attrs = [];
  let selfClose = false;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '>') {
      i++;
      break;
    }
    if (s[i] === '/') {
      selfClose = true;
      i++;
      continue;
    }
    const am = /^[^\s=/>]+/.exec(s.slice(i));
    if (!am) {
      i++;
      continue;
    }
    const aname = am[0];
    i += aname.length;
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    let value = null;
    if (s[j] === '=') {
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '"' || s[j] === "'") {
        const quote = s[j];
        const close = s.indexOf(quote, ++j);
        value = close < 0 ? s.slice(j) : s.slice(j, close);
        i = close < 0 ? s.length : close + 1;
      } else {
        // unquoted value: it stops at the first whitespace or `>`
        const vm = /^[^\s>]*/.exec(s.slice(j));
        value = vm[0];
        i = j + value.length;
      }
    }
    // no `=`: boolean attribute; `i` stays after the name, the whitespace
    // swallowed by `j` will be read again on the next pass
    attrs.push({ name: aname, value });
  }
  return { name, closing, selfClose, attrs, end: i };
}

/** Re-emits an opening tag, attribute by attribute — whatever is not
 *  explicitly admitted is left aside. */
function svgTagHtml(tag) {
  const tagName = tag.name.toLowerCase();
  let out = `<${tag.name}`;
  for (const a of tag.attrs) {
    if (!SVG_ATTR_NAME_RE.test(a.name)) continue;
    const an = a.name.toLowerCase();
    if (/^on/.test(decodeEntities(an))) continue; // any event handler
    if (SVG_URL_ATTRS.has(an) && a.value != null && !svgUrlAllowed(a.value, tagName, an)) continue;
    // `fill`, `filter`, `mask`, `clip-path`, `marker-*` and `style` carry
    // `url()`: they are presentation attributes, not URLs, so they escape
    // SVG_URL_ATTRS — and a remote `url()` there sends a request out over the
    // network just as surely.
    if (a.value != null && !cssUrlsAreLocal(a.value)) continue;
    if (an === 'style' && a.value != null && !cssStylesheetAllowed(a.value)) continue;
    out +=
      a.value == null
        ? ` ${a.name}`
        : ` ${a.name}="${a.value.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  }
  return out + (tag.selfClose ? '/>' : '>');
}

/** An animation targeting a handler or a URL amounts to writing the forbidden
 *  attribute — same verdict. */
function svgAnimationForbidden(tagName, tag) {
  if (!SVG_ANIMATION_ELEMENTS.has(tagName)) return false;
  const target = decodeEntities(
    tag.attrs.find((a) => a.name.toLowerCase() === 'attributename')?.value ?? '',
  )
    .replace(URL_NOISE_RE, '')
    .toLowerCase();
  return /^on/.test(target) || SVG_URL_ATTRS.has(target);
}

/**
 * Sanitizes an SVG that came from outside and prepares it for inlining (the
 * `<?xml … ?>` prologue, the comments and the declarations are dropped along
 * the way: none of that means anything in an HTML document).
 */
export function sanitizeSvg(svg) {
  if (typeof svg !== 'string' || !svg) return '';
  let out = '';
  let i = 0;
  let dropping = null; // { name, depth } — dropped element, content included
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    if (lt < 0) {
      if (!dropping) out += svg.slice(i);
      break;
    }
    if (!dropping) out += svg.slice(i, lt);
    if (svg.startsWith('<!--', lt)) {
      const e = svg.indexOf('-->', lt + 4);
      i = e < 0 ? svg.length : e + 3;
      continue;
    }
    if (svg.startsWith('<?', lt) || svg.startsWith('<!', lt)) {
      const e = svg.indexOf('>', lt);
      i = e < 0 ? svg.length : e + 1;
      continue;
    }
    const tag = readSvgTag(svg, lt);
    if (!tag) {
      if (!dropping) out += '&lt;'; // literal `<` from the text
      i = lt + 1;
      continue;
    }
    i = tag.end;
    const name = tag.name.toLowerCase();
    if (dropping) {
      // the content of a dropped element is not re-emitted; only its closing
      // (nesting included) is of interest. A tag that is never closed
      // therefore carries away the end of the document — in the right
      // direction.
      if (name === dropping.name) {
        if (tag.closing) {
          if (--dropping.depth <= 0) dropping = null;
        } else if (!tag.selfClose) dropping.depth++;
      }
      continue;
    }
    if (SVG_DROPPED_ELEMENTS.has(name) || svgAnimationForbidden(name, tag)) {
      if (!tag.closing && !tag.selfClose) dropping = { name, depth: 1 };
      continue;
    }
    if (name === 'style' && !tag.closing && !tag.selfClose) {
      // The body runs to the first `</style`, whatever it contains: that is
      // where the element closes, whether the parser sees text or markup in
      // it. We therefore take it in one block — but we re-emit it only if it
      // is CSS and NOTHING BUT CSS (cssHasMarkup), failing which it would be
      // the only input to get in without having been retokenized.
      const rest = svg.slice(i).search(/<\/style/i);
      const raw = (rest < 0 ? svg.slice(i) : svg.slice(i, i + rest)).replace(CSS_COMMENT_RE, '');
      if (rest < 0) i = svg.length;
      else {
        const closeTag = readSvgTag(svg, i + rest);
        i = closeTag ? closeTag.end : svg.length;
      }
      if (!cssHasMarkup(raw) && cssStylesheetAllowed(raw))
        out += `${svgTagHtml(tag)}${raw}</style>`;
      continue;
    }
    out += tag.closing ? `</${tag.name}>` : svgTagHtml(tag);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block rendering (same regions as the PPTX renderer)
// ---------------------------------------------------------------------------

/** Ink imposed by the layout (dark layers, quadrant titles…). */
const ink = (block) => (block.color ? `color:#${block.color};` : '');

function htmlPara(block, r) {
  return `<p class="para el" style="${at(r)}${ink(block)}">${runsHtml(block.runs)}</p>`;
}

function htmlHeading(block, r) {
  // `size` (pt) and `align`: key message of the focus layout — otherwise a slot title
  const extra = `${block.size ? `font-size:${block.size}pt;` : ''}${block.align === 'center' ? 'text-align:center;' : ''}`;
  return `<h3 class="slot-heading el" style="${at(r)}${ink(block)}${extra}">${runsHtml(block.runs)}</h3>`;
}

/** Rebuilds the nesting from the flattened items `{ runs, level }`. */
function htmlBullets(block, r) {
  const tag = block.ordered ? 'ol' : 'ul';
  // `startAt`: chunk of a numbered list split by pagination. Only the root
  // list resumes the count; sub-lists start again from 1.
  const start = block.ordered && block.startAt > 1 ? ` start="${block.startAt}"` : '';
  let out = '';
  let level = -1;
  for (const it of block.items) {
    while (level < it.level) {
      out += `<${tag}${level < 0 ? start : ''}>`;
      level++;
    }
    while (level > it.level) {
      out += `</${tag}>`;
      level--;
    }
    out += `<li>${runsHtml(it.runs)}</li>`;
  }
  while (level >= 0) {
    out += `</${tag}>`;
    level--;
  }
  return `<div class="bullets el" style="${at(r)}${ink(block)}">${out}</div>`;
}

function htmlCode(block, r) {
  const lines = block.source.split('\n').map((line) =>
    highlightLine(line, block.lang)
      .map((seg) => {
        const t = esc(seg.text);
        // the contract is `kind`, never the color: a theme can change the
        // design tokens without silently breaking the hl-* classes
        if (seg.kind === 'string') return `<span class="hl-str">${t}</span>`;
        if (seg.kind === 'keyword') return `<span class="hl-kw">${t}</span>`;
        if (seg.kind === 'comment') return `<span class="hl-com">${t}</span>`;
        return t;
      })
      .join(''),
  );
  return `<pre class="code el" style="${at(r, true)}">${lines.join('\n')}</pre>`;
}

function htmlTable(block, r) {
  const row = (cells, tag) =>
    `<tr>${cells.map((c) => `<${tag}>${runsHtml(c)}</${tag}>`).join('')}</tr>`;
  const head = block.header.length ? `<thead>${row(block.header, 'th')}</thead>` : '';
  const body = block.rows.map((cells) => row(cells, 'td')).join('');
  return `<table class="table el" style="${at(r)}">${head}<tbody>${body}</tbody></table>`;
}

function htmlAlert(block, r) {
  const kind = SEMANTIC[block.kind] ? block.kind : 'info';
  const sem = SEMANTIC[kind];
  // outside ALERT_BLOCK_TYPES: ignored (height not reserved by blockHeight,
  // reported to the author by the ALERT_CONTENT_DROPPED diagnostic)
  const inner = block.blocks
    .filter((b) => ALERT_BLOCK_TYPES.has(b.type))
    .map((b) => {
      if (b.type === 'para') return `<p>${runsHtml(b.runs)}</p>`;
      return `<ul>${b.items.map((it) => `<li>${runsHtml(it.runs)}</li>`).join('')}</ul>`;
    })
    .join('');
  return (
    `<div class="alert alert-${kind} el" style="${at(r, true)}">` +
    `<div class="alert-label">${esc(sem.label)}</div>${inner}</div>`
  );
}

/** Canonical trend arrow (the glyph typed in is not preserved). */
const TREND_GLYPH = { up: '↑', down: '↓', flat: '→' };

function htmlMetric(block, r) {
  const t = block.trend;
  const trend = t
    ? `<div class="metric-trend" style="color:#${TREND_INK[t.sentiment]}">${TREND_GLYPH[t.dir]} ${esc(t.text)}</div>`
    : '';
  return (
    `<div class="metric el" style="${at(r, true)}">` +
    `<div class="metric-value">${esc(block.value)}</div>` +
    `<div class="metric-label">${esc(block.label)}</div>${trend}</div>`
  );
}

// ---------------------------------------------------------------------------
// Blocks synthesized by the structured layouts (comparison, pillars,
// timeline, layers, swot) — never coming straight from the DSL
// ---------------------------------------------------------------------------

function htmlPanel(block, r) {
  const style = panelStyle(block);
  const border = style.line ? `border:${style.line.width}px solid #${style.line.color};` : '';
  const radius =
    block.variant === 'accent'
      ? 2
      : block.variant === 'layer' || block.variant === 'semantic'
        ? 4
        : 8;
  const accent =
    block.variant === 'pillar' && block.accent !== false ? '<div class="panel-accent"></div>' : '';
  return (
    `<div class="panel el" style="${at(r, true)}background:#${style.fill};${border}border-radius:${radius}px">` +
    `${accent}</div>`
  );
}

function htmlTimelineAxis(block, r) {
  const arrow = block.arrow !== false;
  const cls = `${block.vertical ? 'tl-axis-v' : 'tl-axis'}${arrow ? '' : ' tl-no-arrow'}`;
  const head = arrow ? `<div class="${block.vertical ? 'tl-arrow-v' : 'tl-arrow'}"></div>` : '';
  return `<div class="${cls} el" style="${at(r, true)}">${head}</div>`;
}

function htmlTimelineDot(block, r) {
  return `<div class="tl-dot el" style="${at(r, true)}">${block.numbered === false ? '' : block.index}</div>`;
}

function htmlQuote(block, r) {
  const cite = block.cite ? `<figcaption>— ${esc(block.cite)}</figcaption>` : '';
  return (
    `<figure class="quote el" style="${at(r, true)}">` +
    `<div class="quote-mark">"</div><blockquote>${runsHtml(block.runs)}</blockquote>${cite}</figure>`
  );
}

function htmlImage(block, r, ctx, { fullBleed = false } = {}) {
  const file = /^https?:/.test(block.src)
    ? (ctx.remote.get(block.src) ?? null)
    : resolveLocalImage(ctx.imageRoots, block.src);
  const uri = file && fs.existsSync(file) ? fileToDataUri(file) : null;
  if (uri) {
    const cover = fullBleed || block.role === 'background' || block.role === 'cover';
    return `<img class="el ${cover ? 'img-cover' : 'img-contain'}" style="${at(r, true)}" src="${uri}" alt="${esc(block.alt ?? '')}">`;
  }
  return (
    `<div class="placeholder el" style="${at(r, true)}">` +
    `<span>[image: ${esc(block.alt || block.src)}]</span></div>`
  );
}

function htmlMermaid(block, r, ctx) {
  const svg = ctx.mermaid.get(block);
  if (svg) return `<div class="figure mermaid el" style="${at(r, true)}">${svg}</div>`;
  // faithful fallback: source shown as a code block + a caption
  return `${htmlCode({ lang: 'mermaid', source: block.source }, { ...r, h: r.h - 24 })}<div class="fallback-caption el" style="left:${Math.round(r.x)}px;top:${Math.round(r.y + r.h - 22)}px;width:${Math.round(r.w)}px;">Mermaid diagram — run \`lutrin setup-mermaid\` for graphical rendering</div>`;
}

function htmlIcon(block, r, ctx) {
  const svg = ctx.icons.get(block);
  if (!svg) return ''; // icon not found: nothing rather than a broken box
  const size = Math.round(Math.min(r.w, r.h, 160));
  // flush left, like the text (the brand is left-aligned)
  return (
    `<div class="icon el" style="${at(r, true)}">` +
    `<div class="icon-box" style="width:${size}px;height:${size}px">${sanitizeSvg(svg)}</div></div>`
  );
}

function htmlMath(block, r, ctx) {
  const m = ctx.math.get(block);
  if (m) {
    // natural size of the equation, centered; shrunk only if it overflows
    const scale = Math.min(1, r.w / m.displayW, r.h / m.displayH);
    const w = m.displayW * scale;
    const h = m.displayH * scale;
    const svg = m.svg.replace(/^<svg[^>]*>/, (tag) =>
      tag
        .replace(/width="[^"]+"/, `width="${w.toFixed(1)}px"`)
        .replace(/height="[^"]+"/, `height="${h.toFixed(1)}px"`),
    );
    return `<div class="figure el" style="${at(r, true)}">${svg}</div>`;
  }
  return `${htmlCode({ lang: 'latex', source: block.source }, { ...r, h: r.h - 24 })}<div class="fallback-caption el" style="left:${Math.round(r.x)}px;top:${Math.round(r.y + r.h - 22)}px;width:${Math.round(r.w)}px;">LaTeX equation — install mathjax-full for graphical rendering</div>`;
}

/** Charts: in-house SVG at the slot's exact dimensions, inlined as is. */
function htmlChart(block, r) {
  return `<div class="figure el" style="${at(r, true)}">${chartSvg(block, r.w, r.h)}</div>`;
}

/** Exported for the parity test with the PPTX renderer: the two tables must
 *  cover exactly the same block types. */
export const BLOCK_RENDERERS = {
  para: htmlPara,
  heading: htmlHeading,
  bullets: htmlBullets,
  code: htmlCode,
  table: htmlTable,
  alert: htmlAlert,
  metric: htmlMetric,
  quote: htmlQuote,
  image: htmlImage,
  mermaid: htmlMermaid,
  icon: htmlIcon,
  math: htmlMath,
  chart: htmlChart,
  panel: htmlPanel,
  'timeline-axis': htmlTimelineAxis,
  'timeline-dot': htmlTimelineDot,
};

// ---------------------------------------------------------------------------
// Slide chrome (same geometries as the PPTX masters)
// ---------------------------------------------------------------------------

const logoSvgCache = new Map(); // key: file digest — safe across themes AND after a hot edit
function logoHtml(file, heightPx, cls = '') {
  if (!file) return ''; // theme without a signature (generic default)
  const key = fileCacheKey(file);
  let inner = logoSvgCache.get(key);
  if (inner === undefined) {
    if (!fs.existsSync(file)) inner = '';
    else if (path.extname(file).toLowerCase() === '.svg')
      inner = sanitizeSvg(fs.readFileSync(file, 'utf8'));
    else {
      // bitmap logo (theme): inlined as a data URI, resized by the style
      const uri = fileToDataUri(file);
      inner = uri ? `<img src="${uri}" alt="">` : '';
    }
    logoSvgCache.set(key, inner);
  }
  // decorative: the signature repeats on every slide, no point having screen
  // readers announce it
  return inner
    ? `<div class="logo ${cls}" aria-hidden="true" style="height:${heightPx}px">${inner}</div>`
    : '';
}

function coverHtml(scene) {
  const parts = [logoHtml(LOGOS.coverSvg, CHROME.cover.logoH, 'logo-cover')];
  parts.push('<div class="cover-bar"></div>');
  parts.push(`<h1 class="cover-title">${esc(scene.title ?? '')}</h1>`);
  if (scene.subtitle) parts.push(`<p class="cover-subtitle">${esc(scene.subtitle)}</p>`);
  if (scene.byline) parts.push(`<p class="cover-byline">${esc(scene.byline)}</p>`);
  return parts.join('\n');
}

function sectionHtml(scene) {
  return `<h2 class="section-title">${esc(scene.title ?? '')}</h2>\n${logoHtml(LOGOS.sectionSvg, CHROME.section.logoH, 'logo-section')}`;
}

function contentHtml(scene, num, footerText, ctx) {
  const parts = [];
  const hero = scene.master === 'hero' && Boolean(scene.image);
  if (hero) {
    parts.push(
      htmlImage(scene.image, { x: 0, y: 0, w: PAGE.width, h: PAGE.height }, ctx, {
        fullBleed: true,
      }),
    );
  }
  if (scene.title) {
    const title = scene.titleRuns ? runsHtml(scene.titleRuns) : esc(scene.title);
    parts.push(`<div class="slide-title">${title}</div>`);
  }
  // hero: in PPTX, the master's rule and footer are COVERED by the full-frame
  // image — do not paint them on top in HTML (parity); the page number, for
  // its part, is written after the image and stays visible
  if (!hero) parts.push('<div class="title-accent"></div><div class="title-rule"></div>');
  for (const el of scene.elements) {
    const fn = BLOCK_RENDERERS[el.block.type];
    if (!fn) continue;
    let frag = fn(el.block, el.region, ctx);
    if (el.step != null) {
      if (el.block.type === 'bullets' && el.stepCount > 1) {
        // list bullet by bullet: one step per <li> (the container stays visible)
        let k = el.step;
        frag = frag.replace(/<li>/g, () => `<li data-step="${k++}">`);
      } else {
        frag = frag.replace(/^<(\w+)/, `<$1 data-step="${el.step}"`);
      }
    }
    parts.push(frag);
  }
  if (!hero) parts.push(`<div class="footer-text">${esc(footerText)}</div>`);
  parts.push(`<div class="footer-num">${num}</div>`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Stylesheet (design tokens of the active theme — see tokens.mjs)
// ---------------------------------------------------------------------------

// ~300 kB of base64 woff2: encoded once per process — memo KEYED BY THEME
// (family + files): a theme that changes the fonts within the same process
// (preview, warm worker) must not serve the previous ones again
let _fontFaces = null;
let _fontFacesKey = null;
function fontFacesCss() {
  const key = [FONTS.body, FONT_FILES.regular, FONT_FILES.bold, FONT_FILES.italic].join('|');
  if (_fontFaces && _fontFacesKey === key) return _fontFaces;
  const faces = [];
  for (const f of FONT_FACE_VARIANTS) {
    const ttf = FONT_FILES[f.key];
    if (typeof ttf !== 'string') continue;
    const file = ttf.replace(/\.ttf$/i, '.woff2');
    if (!fs.existsSync(file)) continue;
    const b64 = fs.readFileSync(file).toString('base64');
    faces.push(
      `@font-face{font-family:"${FONTS.body}";font-weight:${f.weight};font-style:${f.style};` +
        `src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:swap}`,
    );
  }
  _fontFacesKey = key;
  return (_fontFaces = { css: faces.join('\n'), count: faces.length });
}

function baseCss() {
  const C = COLORS;
  const CH = CHROME;
  return `
*{box-sizing:border-box}
body{margin:0;background:#${C.underground2};font-family:"${FONTS.body}",-apple-system,'Segoe UI',Arial,sans-serif;color:#${C.neutralPrimary}}
.deck{max-width:1328px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:24px}
.slide-frame{position:relative;width:100%;height:720px;overflow:hidden;background:#${C.ground};border:1px solid #${C.neutralStroke};border-radius:4px}
.slide{position:absolute;left:0;top:0;width:${PAGE.width}px;height:${PAGE.height}px;overflow:hidden;transform-origin:0 0;background:#${C.ground}}
.el{position:absolute;margin:0}
a{color:#${C.primary};text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:"${FONTS.mono}",monospace;color:#${C.primaryDarker}}

/* chrome of content slides */
.slide-title{position:absolute;left:${PAGE.margin}px;top:${SPACE.lg}px;width:${PAGE.width - 2 * PAGE.margin}px;height:${PAGE.titleHeight - SPACE.lg - 8}px;display:flex;align-items:center;font-size:${TYPE.slideTitle}pt;font-weight:700;line-height:1.15}
.title-accent{position:absolute;left:${PAGE.margin}px;top:${PAGE.titleHeight}px;width:${CH.title.accentW}px;height:${CH.title.accentH}px;background:#${C.primary}}
.title-rule{position:absolute;left:${PAGE.margin + CH.title.accentW}px;top:${PAGE.titleHeight + 1}px;width:${PAGE.width - 2 * PAGE.margin - CH.title.accentW}px;height:1px;background:#${C.neutralStroke}}
.footer-text{position:absolute;left:${PAGE.margin}px;top:${PAGE.height - PAGE.footerHeight}px;width:${CH.footer.textW}px;height:${CH.footer.h}px;display:flex;align-items:center;font-size:${TYPE.caption}pt;color:#${C.neutralSecondary}}
.footer-num{position:absolute;left:${PAGE.width - PAGE.margin - CH.footer.numW}px;top:${PAGE.height - PAGE.footerHeight}px;width:${CH.footer.numW}px;height:${CH.footer.h}px;display:flex;align-items:center;justify-content:flex-end;font-size:${TYPE.caption}pt;color:#${C.neutralSecondary}}

/* cover */
.logo{position:absolute;left:${PAGE.margin}px;top:${PAGE.margin}px}
.logo svg,.logo img{height:100%;width:auto;display:block}
.logo-section{top:auto;bottom:${PAGE.margin}px}
.cover-bar{position:absolute;left:${PAGE.margin}px;top:${CH.cover.barY}px;width:${CH.cover.barW}px;height:${CH.cover.barH}px;background:#${C.primary}}
.cover-title{position:absolute;left:${PAGE.margin}px;top:${CH.cover.titleY}px;width:${PAGE.width - 2 * PAGE.margin}px;margin:0;font-size:${TYPE.coverTitle}pt;font-weight:700;line-height:1.15}
.cover-subtitle{position:absolute;left:${PAGE.margin}px;top:${CH.cover.subtitleY}px;width:${PAGE.width - 2 * PAGE.margin}px;margin:0;font-size:${TYPE.coverSubtitle}pt;color:#${C.neutralSecondary};line-height:1.3}
.cover-byline{position:absolute;left:${PAGE.margin}px;top:${PAGE.height - CH.cover.bylineBottom}px;width:${PAGE.width - 2 * PAGE.margin}px;height:${CH.cover.bylineH}px;display:flex;align-items:center;margin:0;font-size:${TYPE.small}pt;color:#${C.neutralSecondary}}

/* section (green background) */
.slide.master-section{background:#${C.primary}}
.section-title{position:absolute;left:${PAGE.margin}px;top:${CH.section.titleY}px;width:${PAGE.width - 2 * PAGE.margin}px;height:${CH.section.titleH}px;display:flex;align-items:center;margin:0;font-size:${TYPE.sectionTitle}pt;font-weight:700;color:#${C.ground};line-height:1.2}

/* blocks */
.para{font-size:${TYPE.body}pt;line-height:1.4}
.slot-heading{font-size:${TYPE.sectionHeading}pt;font-weight:700;line-height:1.3}
.bullets ul,.bullets ol{margin:0;padding-left:28px;font-size:${TYPE.bullet}pt;line-height:1.3}
.bullets ul ul,.bullets ol ol,.bullets ul ol,.bullets ol ul{font-size:${TYPE.bulletNested}pt;margin-top:6px}
.bullets li{margin-bottom:6px}
.bullets li::marker{color:#${C.neutralSecondary}}
.code{background:#${C.underground1};border:1px solid #${C.neutralStroke};border-radius:8px;padding:${SPACE.xs}px ${SPACE.sm}px;font-family:"${FONTS.mono}",monospace;font-size:${TYPE.code}pt;line-height:1.3;color:#${C.neutralPrimary};overflow:hidden;white-space:pre}
.hl-kw{color:#${C.primaryDarker};font-weight:700}
.hl-str{color:#${C.positiveDark}}
.hl-com{color:#${C.neutralSecondary};font-style:italic}
.table{border-collapse:collapse;font-size:${TYPE.tableBody}pt}
.table th{background:#${C.underground1};font-weight:700;text-align:left}
.table th,.table td{border-bottom:1px solid #${C.neutralStroke};padding:7px 8px;vertical-align:middle}
.alert{border-radius:4px;padding:${SPACE.xs}px ${SPACE.sm}px;font-size:${TYPE.body}pt;line-height:1.3;overflow:hidden}
.alert-label{font-size:${TYPE.small}pt;font-weight:700;margin-bottom:2px}
.alert p{margin:0}
.alert ul{margin:0;padding-left:24px}
.alert-info{background:#${SEMANTIC.info.fill};color:#${SEMANTIC.info.text}}
.alert-success{background:#${SEMANTIC.success.fill};color:#${SEMANTIC.success.text}}
.alert-warning{background:#${SEMANTIC.warning.fill};color:#${SEMANTIC.warning.text}}
.alert-danger{background:#${SEMANTIC.danger.fill};color:#${SEMANTIC.danger.text}}
.metric{background:#${C.ground};border:1px solid #${C.neutralStroke};border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${SPACE.xs}px}
.metric-value{font-size:${TYPE.metricValue}pt;font-weight:700;color:#${C.primary};line-height:1.05}
.metric-label{font-size:${TYPE.metricLabel}pt;color:#${C.neutralSecondary};margin-top:6px}
.metric-trend{font-size:${TYPE.small}pt;font-weight:700;margin-top:8px}

/* structured layouts: panels, timeline */
.panel{overflow:hidden}
.panel-accent{position:absolute;left:${SPACE.xs}px;right:${SPACE.xs}px;top:0;height:4px;background:#${C.primary}}
.tl-axis{background:linear-gradient(#${C.neutralStroke},#${C.neutralStroke}) no-repeat 0 50%/calc(100% - 14px) 2px}
.tl-axis.tl-no-arrow{background-size:100% 2px}
.tl-arrow{position:absolute;right:0;top:50%;transform:translateY(-50%);width:0;height:0;border-left:14px solid #${C.neutralStroke};border-top:7px solid transparent;border-bottom:7px solid transparent}
.tl-axis-v{background:linear-gradient(#${C.neutralStroke},#${C.neutralStroke}) no-repeat 50% 0/2px calc(100% - 14px)}
.tl-axis-v.tl-no-arrow{background-size:2px 100%}
.tl-arrow-v{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:0;height:0;border-top:14px solid #${C.neutralStroke};border-left:7px solid transparent;border-right:7px solid transparent}
.tl-dot{display:flex;align-items:center;justify-content:center;background:#${C.primary};color:#${C.ground};border:2px solid #${C.ground};border-radius:50%;font-size:${TYPE.metricLabel}pt;font-weight:700;box-sizing:border-box}
.quote blockquote{position:absolute;left:96px;right:32px;top:0;bottom:64px;display:flex;align-items:center;margin:0;font-size:${TYPE.quote}pt;font-style:italic;line-height:1.4}
.quote-mark{position:absolute;left:0;top:-10px;font-size:72pt;font-weight:700;color:#${C.primary};line-height:1}
.quote figcaption{position:absolute;right:32px;bottom:12px;font-size:${TYPE.body}pt;color:#${C.neutralSecondary}}
.img-contain{object-fit:contain}
.img-cover{object-fit:cover}
.placeholder{background:#${C.underground1};border:1px dashed #${C.neutralStroke};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:${TYPE.small}pt;color:#${C.neutralSecondary}}
.figure{display:flex;align-items:center;justify-content:center;overflow:hidden}
.figure svg{max-width:100%;max-height:100%}
.icon{display:flex;align-items:center}
.icon-box svg{width:100%;height:100%;display:block}
.fallback-caption{position:absolute;font-size:${TYPE.caption}pt;font-style:italic;color:#${C.neutralSecondary}}

/* animations: appear on click (slides carrying data-anim-steps) */
.slide-frame[data-anim-steps]{cursor:pointer}
.slide-frame[data-anim-steps] [data-step]{visibility:hidden}
.slide-frame[data-anim-steps] [data-step].step-shown{visibility:visible}
.anim-count{position:absolute;right:12px;top:8px;font-size:11px;color:#${C.neutralTertiary};font-variant-numeric:tabular-nums;pointer-events:none;z-index:2}

/* presenter notes (below the slide, outside the geometry) */
.notes{font-size:10pt;color:#${C.neutralSecondary};padding:4px 2px}
.notes summary{cursor:pointer}
.notes p{margin:4px 0 0}

@media print{
  body{background:#fff}
  .deck{max-width:none;padding:0;gap:0}
  .slide-frame{width:${PAGE.width}px;height:${PAGE.height}px !important;border:none;border-radius:0;break-after:page}
  .slide{transform:none !important}
  .slide-frame [data-step]{visibility:visible !important}
  .anim-count{display:none}
  .notes{display:none}
  @page{margin:0}
}`;
}

/** Rules of the presenter mode (PRESENT_SCRIPT) — a function separate from
 *  baseCss() by design: injected into the complete document only, so the CSS
 *  of the fragment mode (webview) stays identical. Everything is scoped under
 *  `body.presenting` or under the `.present-*` elements created by the script:
 *  the normal rendering and the @media print block of baseCss() do not change. */
function presentCss() {
  const C = COLORS;
  return `
/* presentation mode: a single slide, centered, dark neutral background */
body.presenting{background:#0b0b0b;overflow:hidden}
body.presenting .deck{max-width:none;padding:0;gap:0}
body.presenting .slide-frame,body.presenting .notes{display:none}
body.presenting .slide-frame.present-current{display:block;position:fixed;left:0;top:0;right:0;bottom:0;margin:auto;border:none;border-radius:0;z-index:10}
body.presenting .anim-count{display:none} /* the step counter is not projected */
/* discreet strip: shortcut in normal mode, counter while presenting */
.present-hint{position:fixed;right:16px;bottom:12px;z-index:20;padding:4px 10px;font-size:12px;color:#${C.neutralSecondary};background:rgba(255,255,255,.85);border:1px solid #${C.neutralStroke};border-radius:4px;pointer-events:none}
body.presenting .present-hint{color:#8a8f98;background:none;border-color:transparent}
/* help (? key) */
.present-help{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;min-width:340px;padding:20px 28px;background:rgba(11,11,11,.94);color:#e9ecef;border-radius:8px;font-size:13px;line-height:2;cursor:pointer}
.present-help.open{display:block}
.present-help b{display:block;margin-bottom:6px;font-size:14px}
.present-help kbd{display:inline-block;min-width:20px;margin-right:6px;padding:0 6px;background:#2a2a2a;border-radius:4px;font-family:inherit;font-size:12px;text-align:center}
/* the presentation-mode chrome never prints (the print rendering of baseCss()
   stays identical; PRESENT_SCRIPT exits the mode before printing) */
@media print{.present-hint,.present-help{display:none}}`;
}

/** Scaling of the slides — the only piece of JS, optional (without it, the
 *  slides stay at 1280 px and the container crops them).
 *  A function (not a module constant): PAGE must be read AFTER applyTheme. */
const fitScript = () => `
(function(){
  var frames = Array.prototype.slice.call(document.querySelectorAll('.slide-frame'));
  function fit(){
    for (var i = 0; i < frames.length; i++){
      var f = frames[i];
      var s = f.clientWidth / ${PAGE.width};
      f.style.height = (${PAGE.height} * s) + 'px';
      f.firstElementChild.style.transform = 'scale(' + s + ')';
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(document.body);
  window.addEventListener('resize', fit);
  fit();
})();`;

/** Click-to-reveal on animated slides (data-anim-steps): each click shows the
 *  next step; a click after the last one resets. Without JS (or when
 *  printing), all the content is visible.
 *  Every animated slide exposes its state on the element —
 *  `frame.__anim = { total, shown, set(n) }` — consumed by presentScript() to
 *  drive the steps from the keyboard; the click behaviour is unchanged.
 *  A function by symmetry with fitScript()/presentScript() (nothing to
 *  interpolate). */
const animScript = () => `
(function(){
  var frames = document.querySelectorAll('.slide-frame[data-anim-steps]');
  for (var i = 0; i < frames.length; i++)(function(f){
    var total = Number(f.getAttribute('data-anim-steps'));
    var els = Array.prototype.slice.call(f.querySelectorAll('[data-step]'));
    var badge = document.createElement('div');
    badge.className = 'anim-count';
    f.appendChild(badge);
    var st = f.__anim = {
      total: total,
      shown: 0,
      set: function(n){
        st.shown = n < 0 ? 0 : n > total ? total : n;
        badge.textContent = st.shown + ' / ' + total;
        for (var k = 0; k < els.length; k++)
          els[k].classList.toggle('step-shown', Number(els[k].getAttribute('data-step')) < st.shown);
      }
    };
    f.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('a')) return; // clickable links
      // in presentation mode, no reset in front of an audience: after the last
      // step, the click does nothing (the arrow keys change slide)
      if (st.shown >= total && document.body.classList.contains('presenting')) return;
      st.set(st.shown < total ? st.shown + 1 : 0);
    });
    st.set(0);
  })(frames[i]);
})();`;

/** Standalone presenter mode — complete document only, never in fragment
 *  mode. Zero dependencies, designed for a .html opened over file:// by a
 *  double click (no request, no server). Shortcuts:
 *    P                  enter / exit (full screen if allowed — the mode also
 *                       works windowed if the browser refuses);
 *    → Space PgDn       next animation step, then next slide;
 *    ← PgUp             previous step, then previous slide;
 *    Home / End         first / last slide;
 *    N                  presenter view (2nd window);
 *    Esc                exit;  ?  help.
 *  The presenter view is an about:blank filled in by document.write and driven
 *  by a direct window reference: over file:// the origin is opaque and
 *  BroadcastChannel is not reliable — the direct reference is the only robust
 *  channel locally. All the logic (the timer included) lives in the main
 *  window; the second one contains no script at all.
 *  A function (not a module constant): PAGE and COLORS must be read AFTER
 *  applyTheme. */
const presentScript = () => `
(function(){
  var W = ${PAGE.width}, H = ${PAGE.height};
  var frames = Array.prototype.slice.call(document.querySelectorAll('.slide-frame'));
  if (!frames.length) return;
  var current = 0;
  var presenting = false;
  var notesWin = null;                             // presenter view
  var timer = { acc: 0, from: 0, running: false }; // timer (state on the main side)
  var tick = null;

  // Notes: innerHTML of the <p> of the <details class="notes"> that follows
  // each slide (content already escaped by the renderer, reinjectable as is).
  var notes = [];
  for (var i = 0; i < frames.length; i++){
    var sib = frames[i].nextElementSibling;
    var ps = sib && sib.classList && sib.classList.contains('notes') ? sib.querySelectorAll('p') : [];
    var list = [];
    for (var k = 0; k < ps.length; k++) list.push(ps[k].innerHTML);
    notes.push(list);
  }

  // Animation state set by ANIM_SCRIPT (absent if the slide is not animated)
  function anim(n){ return frames[n].__anim || null; }

  // ------ discreet strip + help (?) -----------------------------------------
  var hint = document.createElement('div');
  hint.className = 'present-hint';
  document.body.appendChild(hint);
  var help = document.createElement('div');
  help.className = 'present-help';
  help.innerHTML = '<b>Shortcuts</b>' +
    '<div><kbd>P</kbd>enter / exit presentation mode</div>' +
    '<div><kbd>→</kbd><kbd>Space</kbd><kbd>PgDn</kbd>next step or slide</div>' +
    '<div><kbd>←</kbd><kbd>PgUp</kbd>previous step or slide</div>' +
    '<div><kbd>Home</kbd><kbd>End</kbd>first / last slide</div>' +
    '<div><kbd>N</kbd>presenter view (notes, timer)</div>' +
    '<div><kbd>Esc</kbd>exit</div>';
  document.body.appendChild(help);
  help.addEventListener('click', function(){ help.classList.remove('open'); });
  function updateHint(){
    hint.textContent = presenting
      ? (current + 1) + ' / ' + frames.length + ' — N: notes · Esc: exit · ?: help'
      : 'P: presentation mode · ?: help';
  }
  updateHint();

  // ------ scaling of the current slide --------------------------------------
  function fitCurrent(){
    if (!presenting) return;
    var f = frames[current];
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    f.style.width = (W * s) + 'px';
    f.style.height = (H * s) + 'px';
    f.firstElementChild.style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fitCurrent);

  /** Most visible slide in the window (starting point of presentation mode). */
  function mostVisible(){
    var best = 0, max = -Infinity;
    for (var n = 0; n < frames.length; n++){
      var r = frames[n].getBoundingClientRect();
      var vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (vis > max){ max = vis; best = n; }
    }
    return best;
  }

  // ------ navigation: animation steps first, slides afterwards --------------
  function goTo(n, atEnd){
    if (n < 0 || n >= frames.length) return;
    frames[current].classList.remove('present-current');
    frames[current].style.width = '';
    current = n;
    var a = anim(n);
    if (a) a.set(atEnd ? a.total : 0); // going backwards: every step already revealed
    frames[n].classList.add('present-current');
    fitCurrent(); updateHint(); sync();
  }
  function next(){
    var a = anim(current);
    if (a && a.shown < a.total){ a.set(a.shown + 1); sync(); return; }
    goTo(current + 1, false);
  }
  function prev(){
    var a = anim(current);
    if (a && a.shown > 0){ a.set(a.shown - 1); sync(); return; }
    goTo(current - 1, true);
  }

  // ------ entering / leaving the mode ---------------------------------------
  function enter(){
    if (presenting) return;
    presenting = true;
    document.body.classList.add('presenting');
    current = mostVisible();
    var a = anim(current);
    if (a) a.set(0);
    frames[current].classList.add('present-current');
    fitCurrent(); updateHint();
    // full screen if allowed — if refused, the mode stays windowed
    var p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(function(){});
  }
  function exit(){
    if (!presenting) return;
    presenting = false;
    help.classList.remove('open');
    var f = frames[current];
    f.classList.remove('present-current');
    f.style.width = '';
    document.body.classList.remove('presenting');
    closePresenter();
    if (document.fullscreenElement && document.exitFullscreen){
      var p = document.exitFullscreen();
      if (p && p.catch) p.catch(function(){});
    }
    window.dispatchEvent(new Event('resize')); // FIT_SCRIPT rescales the slides
    f.scrollIntoView({ block: 'center' });
    updateHint();
  }
  // Esc in full screen is absorbed by the browser: we follow the real state.
  // Exception: opening the presenter view (window.open) makes the browser
  // leave full screen — within the second that follows, we stay in windowed
  // presentation mode instead of tearing everything down.
  document.addEventListener('fullscreenchange', function(){
    if (presenting && !document.fullscreenElement && Date.now() - popupAt > 1000) exit();
  });
  window.addEventListener('beforeprint', function(){ exit(); }); // printing unchanged

  // ------ presenter view (2nd window, no embedded script) -------------------
  var PRES_CSS = 'html,body{height:100%;overflow:hidden}' +
    'body{margin:0;display:flex;flex-direction:column;background:#0b0b0b;color:#e9ecef}' +
    '.p-top{flex:none;display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #2a2a2a}' +
    '#t-timer{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;color:#8a8f98;cursor:pointer}' +
    '#t-timer.run{color:#e9ecef}' +
    '#t-reset{font:inherit;font-size:14px;color:#8a8f98;background:none;border:1px solid #2a2a2a;border-radius:4px;padding:2px 10px;cursor:pointer}' +
    '#t-count{margin-left:auto;font-size:14px;color:#8a8f98;font-variant-numeric:tabular-nums}' +
    '.p-cols{flex:1;min-height:0;display:flex;gap:16px;padding:16px}' +
    '.p-main{flex:3;min-width:0}' +
    '.p-side{flex:2;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px}' +
    // the cloned slides inherit their ink from body (baseCss): restore it —
    // background and ink from the design tokens, no hard-coded white (dark theme)
    '.p-frame{position:relative;overflow:hidden;background:#${COLORS.ground};border-radius:4px;color:#${COLORS.neutralPrimary}}' +
    '.p-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a8f98}' +
    '.p-notes{flex:1;min-height:0;overflow:auto;font-size:22px;line-height:1.5}' +
    '.p-notes p{margin:0 0 12px}' +
    '.p-notes .p-empty{color:#8a8f98;font-style:italic}' +
    '#p-cur [data-step]{visibility:hidden}' +          // the current slide follows
    '#p-cur [data-step].step-shown{visibility:visible}'; // the step state; the next one shows everything
  var PRES_BODY = '<div class="p-top">' +
    '<span id="t-timer" title="Start / pause">00:00</span>' +
    '<button id="t-reset" type="button" title="Reset">reset</button>' +
    '<span id="t-count"></span></div>' +
    '<div class="p-cols"><div class="p-main"><div class="p-frame" id="p-cur"></div></div>' +
    '<div class="p-side"><div class="p-label">Next slide</div><div class="p-frame" id="p-next"></div>' +
    '<div class="p-label">Notes</div><div class="p-notes" id="p-notes"></div></div></div>';

  var popupAt = 0; // timestamp of the last window.open (guards fullscreenchange)
  function presOpen(){ return notesWin && !notesWin.closed; }
  function openPresenter(){
    if (presOpen()){ notesWin.focus(); sync(); return; }
    popupAt = Date.now();
    var w = window.open('', 'lutrinPresenter', 'width=1100,height=680');
    if (!w){ // window blocked: presentation mode stays usable, but say so
      hint.textContent = 'Window blocked — allow pop-ups to get the presenter view';
      return;
    }
    notesWin = w;
    var doc = w.document;
    doc.open();
    // the deck's stylesheet (fonts included) is reused as is
    // NB: the body tags are split so that their closing literal stays unique
    // in the generated document — lutrin preview injects its SSE client
    // before the LAST occurrence (a contract tested by html.test)
    doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Presenter view</title><style>' +
      document.querySelector('style').textContent + PRES_CSS +
      '</style></head><bo' + 'dy>' + PRES_BODY + '</bo' + 'dy></html>');
    doc.close();
    doc.getElementById('t-timer').onclick = toggleTimer;
    doc.getElementById('t-reset').onclick = resetTimer;
    doc.onkeydown = presenterKeys;
    w.addEventListener('resize', fitPanes);
    if (!tick) tick = setInterval(tickTimer, 500);
    sync();
  }
  function closePresenter(){
    if (presOpen()) notesWin.close();
    notesWin = null;
    if (tick){ clearInterval(tick); tick = null; }
  }
  window.addEventListener('beforeunload', closePresenter);

  function fitPane(pane, maxH){
    var slide = pane.firstElementChild;
    if (!slide){ pane.style.width = ''; pane.style.height = '0'; return; }
    var s = Math.min(pane.parentNode.clientWidth / W, (maxH || H) / H);
    pane.style.width = (W * s) + 'px';
    pane.style.height = (H * s) + 'px';
    slide.style.transform = 'scale(' + s + ')';
  }
  function fitPanes(){
    if (!presOpen()) return;
    var doc = notesWin.document;
    var main = doc.querySelector('.p-main');
    fitPane(doc.getElementById('p-cur'), main ? main.clientHeight : H);
    fitPane(doc.getElementById('p-next'), notesWin.innerHeight * 0.3);
  }
  /** Pushes the current state to the presenter view (direct reference). */
  function sync(){
    if (!presOpen()) return;
    var doc = notesWin.document;
    var a = anim(current);
    doc.getElementById('t-count').textContent = (current + 1) + ' / ' + frames.length +
      (a ? ' — step ' + a.shown + '/' + a.total : '');
    doc.getElementById('p-cur').innerHTML = frames[current].firstElementChild.outerHTML;
    doc.getElementById('p-next').innerHTML =
      current + 1 < frames.length ? frames[current + 1].firstElementChild.outerHTML : '';
    var list = notes[current];
    doc.getElementById('p-notes').innerHTML = list.length
      ? '<p>' + list.join('</p><p>') + '</p>'
      : '<p class="p-empty">No notes for this slide.</p>';
    fitPanes();
  }

  // ------ timer (click: start / pause; button: reset) -----------------------
  function timerText(){
    var s = Math.floor((timer.acc + (timer.running ? Date.now() - timer.from : 0)) / 1000);
    var two = function(x){ return (x < 10 ? '0' : '') + x; };
    var h = Math.floor(s / 3600);
    return (h ? h + ':' : '') + two(Math.floor(s / 60) % 60) + ':' + two(s % 60);
  }
  function tickTimer(){
    if (!presOpen()){ // window closed by hand: the interval cleans itself up
      if (tick){ clearInterval(tick); tick = null; }
      return;
    }
    var el = notesWin.document.getElementById('t-timer');
    if (el){ el.textContent = timerText(); el.className = timer.running ? 'run' : ''; }
  }
  function toggleTimer(){
    if (timer.running){ timer.acc += Date.now() - timer.from; timer.running = false; }
    else { timer.from = Date.now(); timer.running = true; }
    tickTimer();
  }
  function resetTimer(){ timer.acc = 0; timer.from = Date.now(); tickTimer(); }

  // ------ keyboard (same keys in both windows) ------------------------------
  function navKey(e){
    var k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown'){ next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp'){ prev(); }
    else if (k === 'Home'){ goTo(0, false); }
    else if (k === 'End'){ goTo(frames.length - 1, false); }
    else return false;
    e.preventDefault();
    return true;
  }
  function presenterKeys(e){
    if (navKey(e)) return;
    if (e.key === 'Escape') notesWin.close();
  }
  document.addEventListener('keydown', function(e){
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var k = e.key;
    if (k === '?'){ help.classList.toggle('open'); e.preventDefault(); return; }
    if (k === 'p' || k === 'P'){ presenting ? exit() : enter(); e.preventDefault(); return; }
    if (!presenting) return; // in scrolling mode, the browser keeps its keys
    if (k === 'Escape'){ help.classList.contains('open') ? help.classList.remove('open') : exit(); return; }
    if (k === 'n' || k === 'N'){ openPresenter(); e.preventDefault(); return; }
    navKey(e);
  });
  // a click on an animated slide (ANIM_SCRIPT) changes the step: resynchronize
  document.addEventListener('click', function(){
    if (presenting) setTimeout(sync, 0);
  });
})();`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Shared core: renders each scene as an HTML fragment (`<div
 * class="slide-frame">…` followed by the notes). Consumed by the complete
 * document (renderDeckHtml) and by the fragment mode of compileHtml (VS Code
 * webview, slide-by-slide update).
 *
 * @returns {Promise<{slides: string[], stats: object}>}
 */
async function renderSlideFragments(scenes, meta, baseDir, opts = {}) {
  const vendor = vendorRemoteAssets(meta, opts.vendor);
  // ------ pre-pass: everything that requires asynchronous work --------------
  const allBlocks = scenes.flatMap((sc) => [
    ...sc.elements.map((e) => e.block),
    ...(sc.image ? [sc.image] : []), // image of the hero layout, outside the elements
  ]);
  const ofType = (t) => allBlocks.filter((b) => b.type === t);

  // Mermaid diagrams → inline SVG (persistent cache, unique identifiers)
  const mermaidBlocks = ofType('mermaid');
  const mermaid = new Map();
  mermaidBlocks.forEach((b, k) => {
    const file = renderMermaidCached(b.source, { format: 'svg', baseDir });
    if (file)
      mermaid.set(b, uniquifySvgIds(sanitizeSvg(fs.readFileSync(file, 'utf8')), `mmd-${k}`));
  });

  // Remote images → user cache (or assets/remote/ if the deck vendors them),
  // then data URI: the HTML document stays standalone in both cases
  const remote = new Map();
  const remoteUrls = [
    ...new Set(
      ofType('image')
        .map((b) => b.src)
        .filter((s) => /^https?:/.test(s)),
    ),
  ];
  await Promise.all(
    remoteUrls.map(async (url) => {
      const local = await fetchRemoteImage(url, baseDir, { vendor });
      if (local) remote.set(url, local);
    }),
  );

  // Lucide icons → recolored inline SVG
  const icons = new Map();
  await Promise.all(
    ofType('icon').map(async (b) => {
      const svg = await iconSvg(b.name, { color: b.color });
      if (svg) icons.set(b, svg);
    }),
  );

  // LaTeX equations → inline MathJax SVG
  const math = new Map();
  await Promise.all(
    ofType('math').map(async (b) => {
      const m = await mathSvg(b.source);
      if (m) math.set(b, m);
    }),
  );

  // trust roots for local images: the deck's directory, plus the project/vault
  // roots declared by the host (containment — assets.mjs)
  const imageRoots = [baseDir, ...(opts.imageRoots ?? [])];
  const ctx = { baseDir, imageRoots, mermaid, remote, icons, math };
  const footerText = meta.footer ?? meta.title ?? '';

  const slides = scenes.map((scene, k) => {
    let body;
    let masterCls;
    if (scene.master === 'cover') {
      masterCls = 'master-cover';
      body = coverHtml(scene);
    } else if (scene.master === 'section') {
      masterCls = 'master-section';
      body = sectionHtml(scene);
    } else {
      masterCls = scene.master === 'hero' ? 'master-hero' : 'master-content';
      body = contentHtml(scene, k + 1, footerText, ctx);
    }
    const notes = scene.notes?.length
      ? `<details class="notes"><summary>Notes</summary><p>${scene.notes.map(esc).join('</p><p>')}</p></details>`
      : '';
    const anim = scene.animSteps ? ` data-anim-steps="${scene.animSteps}"` : '';
    // role="group" + aria-roledescription (APG carousel pattern): role="img"
    // would hide all the real content — links, tables — from screen readers
    const label = `Slide ${k + 1} of ${scenes.length}${scene.title ? ` — ${scene.title}` : ''}`;
    return (
      `<div class="slide-frame" id="slide-${k + 1}" data-slide="${k + 1}" data-layout="${esc(scene.layout)}"${anim}>` +
      `<div class="slide ${masterCls}" role="group" aria-roledescription="slide" aria-label="${esc(label)}">\n${body}\n</div></div>${notes}`
    );
  });

  return {
    slides,
    stats: {
      slideCount: scenes.length,
      warnings: [], // filled in by the caller (theme fallbacks, etc.)
      fontsEmbedded: fontFacesCss().count,
      animatedSlides: scenes.filter((s) => s.animSteps).length,
      mermaidRendered: mermaid.size,
      mermaidTotal: mermaidBlocks.length,
      remoteFetched: remote.size,
      remoteTotal: remoteUrls.length,
      remoteVendored: vendor,
      iconsRendered: icons.size,
      iconsTotal: ofType('icon').length,
      mathRendered: math.size,
      mathTotal: ofType('math').length,
    },
  };
}

/**
 * @param {Array}  scenes  scenes produced by buildScenes()
 * @param {object} meta    frontmatter of the deck
 * @param {string} baseDir directory of the source file (image resolution)
 * @param {object} [opts] `vendor` forces remote images to be copied into the
 *                        project (CLI flag; otherwise frontmatter `assets:`)
 * @returns {Promise<{html: string, stats: object}>}
 */
export async function renderDeckHtml(scenes, meta, baseDir, opts = {}) {
  const { slides, stats } = await renderSlideFragments(scenes, meta, baseDir, opts);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title ?? scenes[0]?.title ?? 'Presentation')}</title>
<style>
${fontFacesCss().css}
${baseCss()}
${presentCss()}
</style>
</head>
<body>
<main class="deck">
${slides.join('\n')}
</main>
<script>${fitScript()}</script>
${scenes.some((s) => s.animSteps) ? `<script>${animScript()}</script>` : ''}
<script>${presentScript()}</script>
</body>
</html>
`;

  return { html, stats };
}

/**
 * Convenience for a programmatic host (VS Code plugin, tests): Markdown (DSL)
 * → standalone HTML document, in a single call.
 *
 * `fragment: true` (webview): instead of the complete document, returns
 * `{ slides, css, fontsCss, … }` — one standalone fragment per slide, the
 * stylesheet returned separately, and NO script (the host provides fit/animations; HTML
 * injected through innerHTML would not run its <script> anyway).
 */
export async function compileHtml(
  source,
  {
    baseDir = process.cwd(),
    fragment = false,
    themePath = null,
    defaultTheme = null,
    vendor = undefined,
    imageRoots = [],
  } = {},
) {
  const deck = parseDeck(source);
  // theme + user layouts of the deck — BEFORE buildScenes (the geometry of the
  // scenes depends on the design tokens)
  const prep = prepareDeckContext(deck.meta, { baseDir, themePath, defaultTheme });
  const scenes = buildScenes(deck);
  if (fragment) {
    const { slides, stats } = await renderSlideFragments(scenes, deck.meta, baseDir, {
      vendor,
      imageRoots,
    });
    stats.warnings.push(...prep.diagnostics.map((d) => d.message));
    return {
      slides,
      css: baseCss(),
      fontsCss: fontFacesCss().css,
      stats,
      scenes,
      deck,
      meta: deck.meta,
      themeFile: prep.themeFile,
    };
  }
  const { html, stats } = await renderDeckHtml(scenes, deck.meta, baseDir, { vendor, imageRoots });
  stats.warnings.push(...prep.diagnostics.map((d) => d.message));
  return { html, stats, scenes, deck, meta: deck.meta, themeFile: prep.themeFile };
}
