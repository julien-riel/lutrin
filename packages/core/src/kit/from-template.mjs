/**
 * `lutrin kit import` — deriving a kit from a PowerPoint template
 * (.potx/.pptx). The import produces DATA — colour and type tokens — and
 * NEVER geometry.
 *
 * Lives in `src/kit/` and not in `src/deck/` for the reason archive.mjs states
 * in its own header: this module depends on JSZip, and the compiler core knows
 * no library of that kind (boundary.test.mjs).
 *
 * WHAT IT REFUSES TO READ, AND WHY IT MUST GO ON REFUSING
 * ------------------------------------------------------
 * The project contract (CONTRIBUTING, "The project contract") is that the
 * author describes intent and content and the engine decides the layout. A kit
 * therefore carries colours, type and assets — never coordinates.
 *
 * That refusal is enforced STRUCTURALLY rather than by filtering: this module
 * opens exactly three parts of the package, and not one of them contains a
 * coordinate.
 *
 *   1. the theme part (`ppt/theme/themeN.xml`) — its colour scheme and its
 *      font scheme;
 *   2. the slide master, read for ONE element, its colour map, which is what
 *      decides whether `dk1` is the ink or the background;
 *   3. `ppt/presentation.xml`, read for the slide size — which is used to
 *      WARN that a 4:3 template will not compose as 4:3, never to resize
 *      anything.
 *
 * There is no code path here that opens a layout part, that walks a shape
 * tree, or that parses an offset or an extent. Do not add one. Honouring a
 * placeholder box would import exactly the author-positioning the contract
 * refuses, and it would arrive under the honest-sounding name of "completing
 * the importer". The same answer covers the two other requests that will
 * follow: the master's text styles (a 44 pt title is a size chosen FOR a box
 * of a given width at a given position — importing the number without the box
 * imports half a decision) and the layouts themselves.
 *
 * Because a designer who hands over `brand.potx` believes their layouts came
 * along, the silence is broken twice rather than left to this comment:
 * `KIT_IMPORT_LAYOUTS_DISCARDED` is emitted on EVERY import, counting what was
 * left behind, and a README is generated into the kit so the fact outlives the
 * person who ran the command.
 *
 * WHAT HAS NO DESTINATION
 * -----------------------
 * Three things are read and dropped, each with a diagnostic: the major
 * (heading) font, because lutrin has ONE text family (`FONTS = { body, mono }`);
 * `hlink`/`folHlink`, because there is no link-colour token; and any semantic
 * reading of the accents — a .potx carries no SEMANTICS, and calling accent 4
 * "warning" because Office's happens to be yellow would assign a meaning the
 * designer never assigned. The four semantic families keep the engine's
 * accessible defaults.
 *
 * DERIVATION, NOT TRANSCRIPTION
 * -----------------------------
 * A colour scheme has 12 slots; lutrin's palette has 26 colour tokens.
 * Transcribing the 12 would leave the primary ramp, the surface ramp and the
 * highlight tints at the engine's default blue — an indigo brand with blue
 * architecture layers. So the substance of this module is six recipes, and
 * their constants were MEASURED against the engine's own default theme so that
 * an imported accent sits where the engine's accent sits. Two colour models,
 * because each is the one that actually reproduces the reference palette: the
 * primary family is a hue ramp (HSL luminance, PowerPoint's own ladder), the
 * neutral/surface ramp is a straight sRGB mix.
 *
 * ACCESSIBILITY
 * -------------
 * An imported palette that fails WCAG contrast is REPORTED, never adjusted.
 * Adjusting it would hand back a brand that is not the brand, under the
 * brand's name, with nothing downstream ever saying which token was moved.
 * Refusing it would make the feature useless — Microsoft's own default Office
 * theme fails five chart-colour pairs. So the command warns, and the verdict
 * comes from the engine's own `themeContrastDiagnostics()` run on the kit as
 * actually written. One refinement makes that defensible rather than merely
 * loud: this module never CREATES a failing pair it could have avoided —
 * `semantic`, `trendInk` and `layerShades` are deliberately left out of the
 * theme so `deriveTokens()`/`solidInk()` go on choosing legible inks from the
 * imported palette. What warns is what the brand actually says.
 *
 * Nothing throws. Every failure and every degradation is a diagnostic
 * `{ severity, code, message }`, in the style of `readKit`/`resolveTheme`: the
 * caller decides whether to refuse the import, this module does not decide on
 * its behalf.
 */

import crypto from 'node:crypto';
import JSZip from 'jszip';
import { luminance } from '../deck/tokens.mjs';
import { parseKitManifest } from '../deck/kit.mjs';

// ---------------------------------------------------------------------------
// The parts, and only these
// ---------------------------------------------------------------------------

/** Where the theme part sits when the relationship walk cannot reach it. The
 *  fallback is a CONVENTION, not the format: `theme2`/`theme3` are the notes
 *  and handout masters, which is why the walk is tried first. */
const THEME_FALLBACK = 'ppt/theme/theme1.xml';
const PRESENTATION = 'ppt/presentation.xml';
const CONTENT_TYPES = '[Content_Types].xml';

/** The 12 slots of a DrawingML colour scheme, in the order OOXML declares
 *  them. */
const SCHEME_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
];

/** The slots a token is actually derived from. `hlink`/`folHlink` are read (so
 *  the diagnostics can say they were seen and dropped) but their absence is
 *  not worth a word: nothing depends on them. */
const MAPPED_SLOTS = SCHEME_SLOTS.slice(0, 10);

/** The three slots without which there is no palette to import. */
const ESSENTIAL_SLOTS = ['dk1', 'lt1', 'accent1'];

/**
 * System colours, for a `<a:sysClr>` that carries no `lastClr`.
 *
 * `lastClr` is the value PowerPoint itself last computed on a real machine and
 * always wins; this table is what remains when a file was written by a tool
 * that omitted it. The values are the Windows defaults, because that is the
 * platform the names describe — a theme that leans on them has already tied
 * itself to one desktop.
 */
const SYS_CLR = {
  windowText: '000000',
  window: 'FFFFFF',
  '3dFace': 'F0F0F0',
  '3dShadow': 'A0A0A0',
  captionText: '000000',
  highlight: '0078D7',
  highlightText: 'FFFFFF',
  btnFace: 'F0F0F0',
  btnText: '000000',
  grayText: '6D6D6D',
  infoBk: 'FFFFE1',
  infoText: '000000',
};

/**
 * Families installed on every machine that matters, in both outputs. The list
 * is the one kit-gallery.test.mjs already holds the published kits to; a family
 * outside it is still written (it is the brand's face, and the designer's
 * machine has it) but the fallback is announced.
 */
const UNIVERSAL_FONTS = new Set([
  'Arial',
  'Arial Black',
  'Courier New',
  'Georgia',
  'Impact',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]);

/**
 * resolveTheme's own font-name regex (theme.mjs, `json.fonts` validation).
 * Duplicated here on purpose and not exported from there: the point is that the
 * importer must never WRITE a value the resolver would later drop with a
 * THEME_BAD_VALUE — a kit that warns on every build about a name this module
 * chose is the tool blaming the user for its own output. If the resolver's rule
 * moves, this one moves with it.
 */
const FONT_NAME_RE = /^[\p{L}\p{N} .,'-]{1,64}$/u;

/** 16:9, the frame lutrin composes — `page.width`/`page.height` are locked in
 *  resolveTheme, so a template of another shape is a warning, never a resize. */
const TARGET_RATIO = 16 / 9;
const RATIO_TOLERANCE = 0.01;

// ---------------------------------------------------------------------------
// XML, by regular expression
//
// The project carries no XML dependency and its three other OOXML modules are
// regex-based: this is house style, not a shortcut. A theme part is simple and
// stable, and the one real hazard is the PREFIX — DrawingML is bound to `a:` by
// every Microsoft writer, but that binding is a choice of the document, not of
// the format. Every element is therefore matched on its LOCAL name, and a form
// that cannot be read becomes a diagnostic rather than a silent zero.
// ---------------------------------------------------------------------------

/** Opening tag of `name`, whatever prefix the document bound it to. */
const openTag = (name) => new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*?)(/?)>`);

/** Value of an attribute inside a tag's attribute text. */
const attr = (text, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(text ?? '');
  return m ? m[1] : null;
};

/**
 * Content of the `name` element, or null if it is absent. An empty string
 * means the element is there and empty — a distinction the callers need, since
 * an absent colour slot and an unreadable one are two different reports.
 */
function blockOf(xml, name) {
  if (typeof xml !== 'string') return null;
  const m = openTag(name).exec(xml);
  if (!m) return null;
  if (m[2] === '/') return '';
  const rest = xml.slice(m.index + m[0].length);
  const close = new RegExp(`</(?:[\\w.-]+:)?${name}\\s*>`).exec(rest);
  return close ? rest.slice(0, close.index) : rest;
}

/** The five predefined XML entities plus numeric references — a font family is
 *  read out of an ATTRIBUTE, and "Foo &amp; Bar" is a legal family name. */
const unescapeXml = (s) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Normalizes a part reference against the part that carries it: a relationship
 * target is relative to its own part's directory, and `../theme/theme1.xml`
 * held by `ppt/slideMasters/slideMaster1.xml` designates `ppt/theme/theme1.xml`.
 * Written here rather than taken from `node:path` because OPC part names are
 * POSIX whatever the host — a Windows separator in a package name is a name
 * character, not a directory.
 */
function resolvePart(base, target) {
  if (typeof target !== 'string' || !target.trim()) return null;
  const clean = target.replace(/\\/g, '/').trim();
  if (clean.startsWith('/')) return clean.slice(1);
  const segments = base.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/** The `_rels` part that describes `part`'s relationships. */
function relsOf(part) {
  const cut = part.lastIndexOf('/');
  const dir = cut === -1 ? '' : part.slice(0, cut + 1);
  return `${dir}_rels/${part.slice(cut + 1)}.rels`;
}

/**
 * Targets of the relationships whose type ends in `/<suffix>`, resolved against
 * `base`. External targets are skipped: a relationship pointing outside the
 * package designates a file on someone else's machine.
 */
function relTargets(relsXml, suffix, base) {
  if (!relsXml) return [];
  const out = [];
  for (const m of relsXml.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)>/g)) {
    const type = attr(m[1], 'Type');
    if (!type || !type.endsWith(`/${suffix}`)) continue;
    if (attr(m[1], 'TargetMode') === 'External') continue;
    const resolved = resolvePart(base, attr(m[1], 'Target'));
    if (resolved) out.push(resolved);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colour arithmetic
//
// Two models, and neither is a preference: each is the one that reproduces the
// reference palette. `relight` is OOXML's own luminance modulation — a
// `<a:lumMod>`/`<a:lumOff>` pair means exactly `L' = clamp(L·mod + off)` on the
// HSL luminance, which is why it lives here and not in tokens.mjs: it describes
// PowerPoint's colour picker, not lutrin's design system.
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const channels = (hex) => [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) =>
  rgb
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

function toHsl(hex) {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60) % 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return hexOf(rgb.map((v) => (v + m) * 255));
}

/** OOXML luminance modulation: the step a designer sees in PowerPoint's colour
 *  picker ("Lighter 40 %" is 0.60/0.40). */
const relight = (hex, lumMod, lumOff) => {
  const hsl = toHsl(hex);
  return fromHsl({ ...hsl, l: clamp(hsl.l * lumMod + lumOff, 0, 1) });
};

/** Straight sRGB interpolation, `t` = 0 at `a`, 1 at `b`. */
function mix(a, b, t) {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return hexOf([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

// ---------------------------------------------------------------------------
// EXPORT 1 — reading the template
// ---------------------------------------------------------------------------

/**
 * Reads a .potx/.pptx package and returns its colour scheme, its fonts and the
 * counts of what the import leaves behind. Never throws: an unreadable package
 * is an `error` diagnostic and a null scheme.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {Promise<{ scheme: object|null, fonts: object|null, themeName: string|null,
 *                     masterName: string|null, sldSz: {cx:number, cy:number}|null,
 *                     counts: object, diagnostics: Array }>}
 */
export async function readTemplateTheme(buf) {
  const diagnostics = [];
  const push = (severity, code, message) => diagnostics.push({ severity, code, message });
  const counts = { layouts: 0, media: 0, embeddedFonts: 0, masters: 0 };
  const bare = {
    scheme: null,
    fonts: null,
    themeName: null,
    masterName: null,
    sldSz: null,
    counts,
    diagnostics,
  };

  if (!buf || !buf.length) {
    push(
      'error',
      'KIT_IMPORT_UNREADABLE',
      'Kit import: the file is empty — a .potx or a .pptx is a zip package.',
    );
    return bare;
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    push(
      'error',
      'KIT_IMPORT_UNREADABLE',
      `Kit import: this file could not be read as a package (${e?.message ?? e}) — a .potx or a .pptx is a zip archive. Export the template again from PowerPoint.`,
    );
    return bare;
  }

  // OPC compares part names case-insensitively, and a package written by
  // another tool may not use Microsoft's casing: resolving through a lowercase
  // index costs one map and removes a whole class of "no theme part" reports
  // on packages that plainly have one.
  const index = new Map();
  for (const name of Object.keys(zip.files))
    if (!zip.files[name].dir) index.set(name.toLowerCase(), name);
  const read = async (part) => {
    const real = index.get(part.toLowerCase());
    return real ? zip.file(real).async('string') : null;
  };

  // --- what is left behind, counted so the diagnostics can be concrete ------
  // The layouts are counted through the package's CONTENT TYPES, which is the
  // spec's own way to enumerate parts by kind — and it keeps this module from
  // ever naming, let alone resolving, a layout part's path. Nothing here opens
  // one.
  const contentTypes = await read(CONTENT_TYPES);
  counts.layouts = (contentTypes?.match(/slideLayout\+xml/g) ?? []).length;
  for (const name of index.values()) {
    if (/^ppt\/media\//i.test(name)) counts.media += 1;
    if (/\.fntdata$/i.test(name)) counts.embeddedFonts += 1;
  }

  const presentation = await read(PRESENTATION);
  counts.masters = (presentation?.match(/<(?:[\w.-]+:)?sldMasterId\b/g) ?? []).length;
  if (!counts.masters) counts.masters = (contentTypes?.match(/slideMaster\+xml/g) ?? []).length;
  if (counts.masters > 1)
    push(
      'info',
      'KIT_IMPORT_MULTIPLE_MASTERS',
      `Kit import: the template declares ${counts.masters} slide masters; only the first governs the default look and only its palette was read. A brand template often carries three, with different colours — check the result against the master you meant.`,
    );

  // --- the slide size, read to WARN and for nothing else ---------------------
  let sldSz = null;
  const sldSzTag = presentation ? openTag('sldSz').exec(presentation) : null;
  if (sldSzTag) {
    const cx = Number(attr(sldSzTag[1], 'cx'));
    const cy = Number(attr(sldSzTag[1], 'cy'));
    if (Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0) sldSz = { cx, cy };
  }

  // --- the walk to the theme part -------------------------------------------
  // Grabbing theme1.xml blind is right only by convention: theme2/theme3 are
  // the notes and handout masters. The walk goes presentation → its first
  // slide master → that master's theme, which is the theme PowerPoint itself
  // would show you.
  const masterName = relTargets(await read(relsOf(PRESENTATION)), 'slideMaster', PRESENTATION)[0];
  const masterXml = masterName ? await read(masterName) : null;
  const themeTarget = masterName
    ? relTargets(await read(relsOf(masterName)), 'theme', masterName)[0]
    : null;

  let themePart = themeTarget;
  let themeXml = themePart ? await read(themePart) : null;
  if (!themeXml && themePart !== THEME_FALLBACK) {
    themePart = THEME_FALLBACK;
    themeXml = await read(themePart);
  }
  if (!themeXml) {
    push(
      'error',
      'KIT_IMPORT_NO_THEME',
      'Kit import: this package carries no theme part — there is nothing to import. A .potx exported from PowerPoint always has one; check that the file is a template or a presentation and not a renamed archive.',
    );
    return bare;
  }

  // --- the colour map, the master's one contribution ------------------------
  // It is what decides whether dk1 is the ink or the background, and it is the
  // ONLY element read out of the master part: the regex is anchored on it, and
  // nothing else in that part is ever looked at.
  let clrMap = null;
  const clrMapTag = masterXml ? openTag('clrMap').exec(masterXml) : null;
  if (clrMapTag) {
    clrMap = {};
    for (const logical of ['bg1', 'tx1', 'bg2', 'tx2']) {
      const slot = attr(clrMapTag[1], logical);
      if (slot && SCHEME_SLOTS.includes(slot)) clrMap[logical] = slot;
    }
  } else {
    push(
      'warning',
      'KIT_IMPORT_CLRMAP_ASSUMED',
      `Kit import: the colour map of ${masterName ? `"${masterName}"` : 'the slide master'} could not be read — the standard mapping was assumed (text 1 = dk1, background 1 = lt1). If the template's master inverts them, the imported palette will be inverted too.`,
    );
  }

  // --- the palette ----------------------------------------------------------
  const schemeBlock = blockOf(themeXml, 'clrScheme');
  const scheme = clrMap ? { clrMap } : {};
  if (schemeBlock) {
    for (const slot of SCHEME_SLOTS) {
      const { hex, reason, detail } = pickColor(schemeBlock, slot);
      if (hex) {
        scheme[slot] = hex;
        continue;
      }
      if (!MAPPED_SLOTS.includes(slot)) continue; // hlink/folHlink map nowhere
      if (reason === 'sysclr')
        push(
          'warning',
          'KIT_IMPORT_SYSCLR',
          `Kit import: ${slot} is a system colour ("${detail}") with no lastClr and no known value — the slot was skipped and the engine's own token stands. Open the template in PowerPoint and save it: PowerPoint writes the resolved value into lastClr.`,
        );
      else
        push(
          'warning',
          'KIT_IMPORT_SLOT_UNREADABLE',
          reason === 'absent'
            ? `Kit import: the colour scheme declares no ${slot} — the tokens derived from it keep the engine's values.`
            : `Kit import: ${slot} is expressed as ${detail}, a colour form this importer does not read — the slot was skipped and the engine's own token stands.`,
        );
    }
  }

  if (!ESSENTIAL_SLOTS.every((slot) => scheme[slot])) {
    // Half a palette mixed with the engine's blue is worse than no import: the
    // user would ship a kit that is neither their brand nor the default, and
    // nothing downstream would say which half is which.
    push(
      'error',
      'KIT_IMPORT_NO_COLORS',
      `Kit import: no usable colour scheme in ${themePart} — ${schemeBlock ? `${ESSENTIAL_SLOTS.filter((s) => !scheme[s]).join(', ')} could not be resolved` : 'the theme part carries no colour scheme'}. Importing half a palette would leave the rest of the kit on the engine's own blue.`,
    );
    return bare;
  }

  // --- the type -------------------------------------------------------------
  const fontBlock = blockOf(themeXml, 'fontScheme');
  const fonts = {
    major: latinOf(fontBlock, 'majorFont'),
    minor: latinOf(fontBlock, 'minorFont'),
  };

  return {
    scheme,
    fonts,
    themeName: attr(openTag('theme').exec(themeXml)?.[1], 'name'),
    masterName: masterName ?? null,
    sldSz,
    counts,
    diagnostics,
  };
}

/**
 * The colour of one scheme slot, in either of the two forms that carry one
 * (`srgbClr`, `sysClr`) and in either spelling of each — self-closing or
 * container.
 *
 * The container form is the one worth naming: a slot written
 * `<a:srgbClr val="4472C4"><a:alpha val="50000"/></a:srgbClr>` is still that
 * colour. The child transforms describe how the colour is USED, not what it
 * is, and skipping the slot because it carries one would refuse a perfectly
 * ordinary template.
 *
 * A form nobody writes in a scheme but the format allows (`scrgbClr`,
 * `prstClr`, `hslClr`) is reported by name rather than guessed at: this is the
 * likeliest real-world bug report, and a diagnostic naming the element is what
 * makes it a five-minute fix.
 */
function pickColor(schemeBlock, slot) {
  const block = blockOf(schemeBlock, slot);
  if (block == null) return { hex: null, reason: 'absent' };
  const m = /<(?:[\w.-]+:)?(srgbClr|sysClr|scrgbClr|prstClr|hslClr|schemeClr)\b([^>]*?)\/?>/.exec(
    block,
  );
  if (!m) return { hex: null, reason: 'form', detail: 'an unrecognized colour element' };
  const [, kind, attrs] = m;
  if (kind === 'srgbClr') {
    const val = attr(attrs, 'val');
    return /^[0-9a-fA-F]{6}$/.test(val ?? '')
      ? { hex: val.toUpperCase(), reason: null }
      : { hex: null, reason: 'form', detail: `srgbClr val="${val ?? ''}"` };
  }
  if (kind === 'sysClr') {
    const last = attr(attrs, 'lastClr');
    // lastClr first: it is what PowerPoint itself last computed on a real
    // machine, and it is more trustworthy than any table we could keep.
    if (/^[0-9a-fA-F]{6}$/.test(last ?? '')) return { hex: last.toUpperCase(), reason: null };
    const val = attr(attrs, 'val');
    if (val && SYS_CLR[val]) return { hex: SYS_CLR[val], reason: null };
    return { hex: null, reason: 'sysclr', detail: val ?? '' };
  }
  return { hex: null, reason: 'form', detail: `<${kind}>` };
}

/**
 * The latin family of `majorFont` or `minorFont`.
 *
 * The FIRST `<a:latin>` of the block and nothing else: `<a:ea>`/`<a:cs>` and
 * the `<a:font script="…">` list are the per-script substitutes, and pptxgenjs
 * — our own writer — emits `<a:ea typeface=""/>`, so an empty `typeface` must
 * read as absent rather than as a family named "".
 */
function latinOf(fontSchemeBlock, which) {
  const block = blockOf(fontSchemeBlock, which);
  if (block == null) return null;
  const m = openTag('latin').exec(block);
  if (!m) return null;
  const face = unescapeXml(attr(m[1], 'typeface') ?? '').trim();
  return face || null;
}

// ---------------------------------------------------------------------------
// EXPORT 2 — the mapping
// ---------------------------------------------------------------------------

/**
 * Turns a colour scheme and a font scheme into a lutrin theme. PURE: no zip, no
 * disk, no clock — this is the function that carries the recipes, and the one
 * the tests hammer.
 *
 * @param {object} scheme  slots of the colour scheme, plus its `clrMap`
 * @param {{major?: string|null, minor?: string|null}|null} fonts
 * @param {{ name?: string|null, clrMap?: object|null }} [opts]
 * @returns {{ theme: object|null, diagnostics: Array }}
 */
export function themeFromScheme(scheme, fonts, { name = null, clrMap = null } = {}) {
  const diagnostics = [];
  const push = (severity, code, message) => diagnostics.push({ severity, code, message });

  if (!scheme || typeof scheme !== 'object' || !ESSENTIAL_SLOTS.every((s) => scheme[s])) {
    push(
      'error',
      'KIT_IMPORT_NO_COLORS',
      'Kit import: the colour scheme carries neither dk1, lt1 nor accent1 — there is no palette to derive from.',
    );
    return { theme: null, diagnostics };
  }

  // The colour map comes FIRST: `<p:clrMap bg1="lt1" tx1="dk1" …>` is what
  // decides whether dk1 is the ink or the background, and a master that
  // inverts the pair inverts the whole import. Identity when the master could
  // not be read — reported there, not here.
  const map = clrMap ?? scheme.clrMap ?? {};
  const through = (logical, fallback) => scheme[map[logical] ?? fallback] ?? null;
  const tx1 = through('tx1', 'dk1');
  const bg1 = through('bg1', 'lt1');
  const tx2 = through('tx2', 'dk2');
  const bg2 = through('bg2', 'lt2');

  const colors = {};

  // DARK-SCHEME GUARD. A dark master (clrMap bg1="dk1" tx1="lt1") would import
  // a dark `ground`, and every surface lutrin derives AROUND it is light:
  // underground1/2, highlightLight/Strong, and panelStyle('muted'), which
  // returns `ink: null` — "the deck's ordinary ink". A dark ground would put
  // white text on a near-white panel at about 1.05:1, and
  // themeContrastDiagnostics() does not measure that pair: the failure would be
  // SILENT. Refusing the pair loudly beats importing a broken kit quietly.
  const dark = luminance(bg1) < luminance(tx1);
  if (dark) {
    push(
      'warning',
      'KIT_IMPORT_DARK_SCHEME',
      `Kit import: this master maps its background to the dark slot (#${bg1}) and its text to the light one (#${tx1}) — NO surface colour was imported (ground, neutralPrimary, brandBlack, underground1/2 and the neutral ramp), and the engine's light surfaces stand. lutrin derives its panels and highlight tints as light tones, and the pair "ordinary ink on a muted panel" is not one the contrast check measures, so importing half of a dark palette would fail silently rather than loudly. The accent ramp and the chart colours WERE imported: they derive from accent 1 and owe the background nothing. If this brand really is a dark one, build it with lutrin kit edit, where every pair is checked as you set it.`,
    );
  } else {
    colors.neutralPrimary = tx1;
    // `brand`/`brandBlack` are read by no renderer today — they exist in
    // tokens.mjs and in its anti-drift mirror. Written anyway, for coherence
    // the day one of them is wired up: a kit that carries the palette minus
    // two tokens is harder to explain than one that carries all of it.
    colors.brandBlack = tx1;
    colors.ground = bg1;
  }

  // EVERY surface token below ramps toward bg1, so none of them may be written
  // when bg1 is the dark slot: the engine's ground stays light while
  // underground2 would arrive dark, and a muted panel — panelStyle('muted'),
  // whose ink is "the deck's ordinary ink" — would put dark text on a dark
  // panel. That is the same silent failure the guard above exists to prevent,
  // one step down the ramp, and skipping only ground/neutralPrimary/brandBlack
  // would leave it standing. Half a palette is worse than none: the engine's
  // own surfaces stand, and the accent ramp below is imported regardless
  // because it derives from accent1 and owes the background nothing.
  if (!dark) {
    if (tx2) {
      colors.neutralSecondary = tx2; // literally the template's "text 2"
      // The neutral ramp measures as a straight sRGB mix on the engine's own
      // theme (ADB2BD sits at 0.474/0.450/0.476 of neutralSecondary→ground, and
      // CED4DA at 0.686/0.693/0.706): one constant per step, consistent to ±0.03
      // across the three channels, which is the evidence that these are the
      // engine's own relationships and not invented ones.
      colors.neutralTertiary = mix(tx2, bg1, 0.47);
      colors.neutralStroke = mix(tx2, bg1, 0.69);
    }
    if (bg2) {
      colors.underground2 = bg2; // the template's "background 2"
      colors.underground1 = mix(bg2, bg1, 0.79); // reproduces F8F9FA exactly
    }
  }

  const accent1 = scheme.accent1;
  colors.primary = accent1;
  colors.brand = accent1; // the default theme keeps brand === primary
  // The accent ramp sits on PowerPoint's OWN ladder, which is the ladder the
  // designer already saw in the colour picker: "Lighter 40 %" is lumMod 0.60 /
  // lumOff 0.40, and the engine's own primaryLighter measures 0.6784 against
  // that ladder's 0.688 — a congruence worth keeping.
  colors.primaryLighter = relight(accent1, 0.6, 0.39);
  // The ladder would say "Darker 25 %" (lumMod 0.75). It was LEFT on purpose:
  // the engine's own primaryDarker sits at 0.6857, and that value is what keeps
  // LAYER_SHADES[0] — ground on primaryDarker — above 4.5:1. Following the
  // ladder here would produce an architecture-layers slide whose top layer
  // fails the check on almost every imported brand.
  colors.primaryDarker = relight(accent1, 0.686, 0);
  colors.highlightStrong = relight(accent1, 0.15, 0.855);
  colors.highlightLight = relight(accent1, 0.08, 0.93);

  const theme = {};
  if (typeof name === 'string' && name.trim()) theme.name = name.trim();
  theme.colors = colors;

  // --- type -----------------------------------------------------------------
  const major = fonts?.major ?? null;
  const minor = fonts?.minor ?? null;
  if (minor) {
    if (FONT_NAME_RE.test(minor)) {
      theme.fonts = { body: minor };
      if (!UNIVERSAL_FONTS.has(minor))
        push(
          'warning',
          'KIT_IMPORT_FONT_UNRESOLVED',
          `Kit import: the kit names "${minor}" and ships no font file — both outputs fall back on whatever is installed, so a machine without "${minor}" renders the deck in its system default. Drop ${minor}.ttf and ${minor}.woff2 into the kit's fonts/ directory and declare fonts.files in theme.json (lutrin kit edit does it for you).`,
        );
    } else {
      // Never write what the resolver will refuse: resolveTheme drops a family
      // whose name leaves letters/digits/spaces/.,'- (the families are
      // interpolated into the generated HTML's CSS), and it drops it with a
      // THEME_BAD_VALUE on every single build.
      push(
        'warning',
        'KIT_IMPORT_FONT_NAME',
        `Kit import: the template's body family, "${minor}", contains characters lutrin does not allow in a font name (letters, digits, spaces and . , ' -) — no family was written, and the engine's own stands. Set fonts.body by hand if the real family has a usable name.`,
      );
    }
  } else {
    push(
      'warning',
      'KIT_IMPORT_NO_FONT',
      "Kit import: the theme part declares no body typeface — the kit keeps the engine's default family. Set fonts.body in theme.json if the brand has one.",
    );
  }
  if (major && minor && major !== minor)
    push(
      'info',
      'KIT_IMPORT_FONT_MAJOR_DROPPED',
      `Kit import: the template sets headings in "${major}" and body in "${minor}"; lutrin composes with a single text family — "${minor}" was imported. A heading family would be a second font token, and the engine has none.`,
    );

  // --- the categorical palette ----------------------------------------------
  // tokens.mjs states the rule this obeys: "a theme that changes primary must
  // supply its own chartColors". Importing accent1 and leaving the chart
  // palette on the engine's teal is exactly the incoherence that comment warns
  // about. Six slots, six accents, fixed order.
  const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(
    (s) => scheme[s],
  );
  if (accents.every(Boolean)) theme.chartColors = accents;
  else
    push(
      'warning',
      'KIT_IMPORT_ACCENTS_PARTIAL',
      `Kit import: only ${accents.filter(Boolean).length} of the 6 accents resolved — chartColors was not written at all, and the engine's six accessible colours stand. A short array would silently shorten the categorical palette, and the seventh series would then be grouped under "Other" too early.`,
    );

  // The slots that were read and have nowhere to go. Said once, so that a user
  // comparing the kit against the template knows what is missing on purpose.
  const links = Boolean(scheme.hlink || scheme.folHlink);
  push(
    'info',
    'KIT_IMPORT_SLOTS_UNMAPPED',
    `Kit import: ${links ? 'the link colours (hlink, folHlink) and ' : ''}any semantic reading of the accents ${links ? 'were' : 'was'} not imported — ${links ? 'lutrin has no link-colour token, and ' : ''}a template carries no semantics: calling an accent "warning" because it happens to be yellow would assign a meaning the designer never assigned. The :::info/:::success/:::warning/:::danger tints keep the engine's accessible defaults.`,
  );

  return { theme, diagnostics };
}

// ---------------------------------------------------------------------------
// EXPORT 3 — the whole import
// ---------------------------------------------------------------------------

/**
 * Reads a template and returns everything `lutrin kit import` writes: the
 * manifest, the theme, the README, and the diagnostics that justify all three.
 *
 * Nothing is written here — the caller decides, and refuses on the first
 * `error` (rule 1: a command that fails leaves nothing behind).
 *
 * @param {Buffer|Uint8Array} buf
 * @param {{ name?: string, sourceName?: string }} [opts]
 * @returns {Promise<{ manifest: object|null, theme: object|null, readme: string|null,
 *                     diagnostics: Array }>}
 */
export async function kitFromTemplate(buf, { name = null, sourceName = 'the template' } = {}) {
  const diagnostics = [];
  const push = (severity, code, message) => diagnostics.push({ severity, code, message });
  const nothing = { manifest: null, theme: null, readme: null, diagnostics };

  // The name first, and through parseKitManifest rather than through a copy of
  // its rule: a name refused here must be refused with the same words `kit
  // install` uses, since it is the same constraint (the name becomes a
  // directory). Cheapest check first, too — no point unzipping to learn that.
  const { manifest: validated, diagnostics: nameDiags } = parseKitManifest(
    { name },
    { where: 'kit import' },
  );
  diagnostics.push(...nameDiags);
  if (!validated) return nothing;

  const template = await readTemplateTheme(buf);
  diagnostics.push(...template.diagnostics);
  if (diagnostics.some((d) => d.severity === 'error')) return nothing;

  const { theme, diagnostics: themeDiags } = themeFromScheme(template.scheme, template.fonts, {
    name: `${validated.name} (imported from ${sourceName})`,
  });
  diagnostics.push(...themeDiags);
  if (!theme || diagnostics.some((d) => d.severity === 'error')) return nothing;

  const { counts, sldSz, themeName, masterName } = template;

  // THE HEADLINE, emitted on every import, count included — even at zero. The
  // others are conditional because "0 images were left behind" is noise; this
  // one is the sentence the whole feature owes the person who handed over a
  // .potx believing their layouts came with it.
  push(
    'info',
    'KIT_IMPORT_LAYOUTS_DISCARDED',
    `Kit import: the template's ${counts.layouts} slide layout${counts.layouts === 1 ? '' : 's'}, their placeholder positions and the master geometry were not imported — lutrin composes the page from the deck's intent; a kit carries colours, type and assets, never coordinates. Neither were the master's type sizes: a title's point size was chosen for a box of a given width at a given position.`,
  );

  if (counts.media)
    push(
      'info',
      'KIT_IMPORT_MEDIA_DISCARDED',
      `Kit import: ${counts.media} image${counts.media === 1 ? ' sits' : 's sit'} in the template's media; none was imported — a kit's signatures are chosen deliberately (logos.cover, logos.section). Extract the ones you want and declare them in theme.json.`,
    );

  if (counts.embeddedFonts)
    push(
      'info',
      'KIT_IMPORT_EMBEDDED_FONTS',
      `Kit import: the template embeds ${counts.embeddedFonts} font variant${counts.embeddedFonts === 1 ? '; it was' : 's; they were'} not imported. resolveTheme drops any fonts.files variant that has no .woff2 twin — that is what keeps the HTML and the .pptx identical — and a .potx ships TrueType only, so a kit built from those bytes would be refused by our own resolver. Drop <Family>.ttf and <Family>.woff2 into the kit's fonts/ directory and add fonts.files to theme.json (lutrin kit edit does it for you).`,
    );

  if (sldSz && Math.abs(sldSz.cx / sldSz.cy - TARGET_RATIO) > RATIO_TOLERANCE)
    push(
      'warning',
      'KIT_IMPORT_SLIDE_SIZE',
      `Kit import: the template composes ${(sldSz.cx / sldSz.cy).toFixed(2)}:1 (${sldSz.cx}×${sldSz.cy} EMU) and lutrin composes 16:9. The frame is not themable — page.width and page.height are refused by resolveTheme — so the colours and the type apply, the geometry does not.`,
    );

  const manifest = {
    name: validated.name,
    description: `Colours and type imported from ${sourceName}${themeName ? ` (theme "${themeName}")` : ''}.`,
  };

  return {
    manifest,
    theme,
    readme: renderReadme({
      name: validated.name,
      sourceName,
      digest: crypto.createHash('sha256').update(buf).digest('hex'),
      themeName,
      masterName,
      counts,
      theme,
      fonts: template.fonts,
    }),
    diagnostics,
  };
}

/**
 * The kit's README.
 *
 * Generated rather than left to the diagnostics because the terminal output
 * scrolls away and the kit does not: the person who inherits this directory in
 * six months, and who will wonder why the brand's layouts are not in it, reads
 * this file. Provenance is stated in the same breath as the refusals — the
 * template's digest is what lets its author say which file this came from.
 */
function renderReadme({ name, sourceName, digest, themeName, masterName, counts, theme, fonts }) {
  const line = (label, value) => `- **${label}** — ${value}`;
  return `# ${name}

Colours and type imported from \`${sourceName}\` by \`lutrin kit import\` on ${new Date()
    .toISOString()
    .slice(0, 10)}.

${line('Source theme', themeName ? `"${themeName}"` : '(unnamed)')}
${line('Slide master', masterName ?? '(not reached — the standard colour map was assumed)')}
${line('SHA-256 of the template', `\`${digest}\``)}

## What was imported

${line('The palette', `${Object.keys(theme.colors).length} tokens of \`colors\` — the template's text/background pair, its second text and background, and accent 1, from which lutrin derives its primary ramp (\`primaryLighter\`, \`primaryDarker\`, \`highlightLight\`, \`highlightStrong\`) and its surface ramp (\`underground1\`, \`neutralTertiary\`, \`neutralStroke\`)`)}
${line('The chart palette', theme.chartColors ? '`chartColors` — accents 1 to 6, in that order' : "not written: fewer than six accents resolved, so the engine's six accessible colours stand")}
${line('The body typeface', theme.fonts?.body ? `\`fonts.body\` = ${theme.fonts.body}${fonts?.major && fonts.major !== theme.fonts.body ? ` (the template's heading family, ${fonts.major}, has no destination — lutrin composes with a single text family)` : ''}` : "not written: the engine's own family stands")}

No byte of the template was copied into this kit. It carries colour values and
a family name — naming a font family is not redistributing it, and the one path
that would redistribute (extracting the embedded font data) is closed
deliberately.

## What was NOT imported, and why

${line('Layouts, placeholder positions, master geometry', `${counts.layouts} slide layout${counts.layouts === 1 ? '' : 's'} left behind. lutrin composes the page from the deck's intent: the author describes content, the engine decides where it goes. A kit carries colours, type and assets, never coordinates. This is not an unfinished importer — honouring a placeholder box would import exactly the positioning the format refuses.`)}
${line('Type sizes', "the master's title point size was chosen FOR a box of a given width at a given position; importing the number without the box imports half a decision.")}
${line('Images', `${counts.media} in the template. A kit's signatures are chosen deliberately (\`logos.cover\`, \`logos.section\`): extract the ones you want, put them in \`images/\`, and declare them in \`theme.json\`.`)}
${line('Embedded fonts', `${counts.embeddedFonts} variant${counts.embeddedFonts === 1 ? '' : 's'} in the template. \`resolveTheme\` drops any \`fonts.files\` variant with no \`.woff2\` twin, so the HTML and the .pptx stay identical; a .potx ships TrueType only. Drop \`<Family>.ttf\` and \`<Family>.woff2\` into \`fonts/\` and declare \`fonts.files\`.`)}
${line('Link colours', "the template's `hlink`/`folHlink`. lutrin has no link-colour token.")}
${line('Semantics', `the \`:::info\` / \`:::success\` / \`:::warning\` / \`:::danger\` tints keep the engine's accessible defaults. A template carries no semantics: calling an accent "warning" because it happens to be yellow would assign a meaning nobody assigned.`)}

## Before you ship it

This is a starting point, not a conversion. PowerPoint tints its accents per
theme variant, and the ramps above are lutrin's own relationships applied to
your accent — a very light or very saturated accent will need a hand.

Colours that fail the WCAG contrast thresholds are **reported, never
adjusted**: an adjusted colour would be a brand that is not the brand, shipped
under the brand's name. \`lutrin build\` warns about the same pairs on every
compile, so fix them here or accept them knowingly.

\`\`\`sh
lutrin kit edit .          # palette, type and layouts, in the browser
lutrin kit create .        # pack it into a .deckkit
lutrin build deck.md --kit .
\`\`\`
`;
}
