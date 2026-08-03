/**
 * Sanitizing SVG that came from outside, and deciding whether a string may
 * become an XML part of a .pptx.
 *
 * This lived in html/render.mjs while the HTML document was the only surface
 * that inlined an SVG. The .pptx now ships the vector alongside its raster
 * (pptx/svg.mjs), so the same guard has to run on the same three sources
 * before their bytes enter an OOXML package — and pptx/ importing from html/
 * would be a layering inversion. It is the same code, moved: html/render.mjs
 * re-exports sanitizeSvg so its callers and the sanitize test are untouched.
 */

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
 * `onload=` runs: a host dropping this HTML into an Electron renderer through
 * innerHTML executes it, and the fragment mode is made for exactly that.
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
// Fitness to become an XML part
// ---------------------------------------------------------------------------

/**
 * May this string be written into a .pptx as an `image/svg+xml` part?
 *
 * A different question from sanitizeSvg's, and a harder consequence. An SVG
 * that is merely UGLY renders badly in a browser and nothing else; an SVG that
 * is not WELL-FORMED XML makes PowerPoint declare the whole file corrupt and
 * offer to repair it. Today a broken SVG only makes resvg return null and the
 * code-block fallback appear, which is a visible degradation with no victim —
 * once the bytes ship, the same input takes the entire deck down with it.
 *
 * So the vector path is opt-IN on evidence, never opt-out on suspicion: three
 * cheap structural checks, and anything that does not pass simply stays the
 * raster it is today. A false negative costs a sharp image; a false positive
 * costs the deliverable.
 *
 * @param {string} svg
 * @returns {boolean}
 */
export function svgPartSafe(svg) {
  if (typeof svg !== 'string' || svg.length < 16) return false;
  // a root element, and the SVG namespace on it: a standalone part has no
  // host document to inherit it from, unlike an SVG inlined in HTML
  const root = svg.match(/<svg\b[^>]*>/i);
  if (!root || !/\sxmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/i.test(root[0])) return false;
  // a bare "&" is the classic way a generator produces XML no parser accepts
  if (/&(?!(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/.test(svg)) return false;
  // Balanced tags: a truncated SVG — a rasterizer killed mid-write, a cache
  // entry cut short — must never enter the zip. Same walk as sanitizeSvg,
  // counting instead of re-emitting, so the two agree on what a tag is.
  let depth = 0;
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    if (lt < 0) break;
    if (svg.startsWith('<!--', lt)) {
      const e = svg.indexOf('-->', lt + 4);
      if (e < 0) return false; // unterminated comment: truncated
      i = e + 3;
      continue;
    }
    if (svg.startsWith('<?', lt) || svg.startsWith('<!', lt)) {
      const e = svg.indexOf('>', lt);
      if (e < 0) return false;
      i = e + 1;
      continue;
    }
    const tag = readSvgTag(svg, lt);
    if (!tag) {
      i = lt + 1; // a literal `<` in the text — caught by the entity test above
      continue;
    }
    i = tag.end;
    if (tag.closing) {
      if (--depth < 0) return false;
    } else if (!tag.selfClose) depth++;
  }
  return depth === 0;
}
