/**
 * Font embedding in the .pptx (post-processing).
 *
 * PptxGenJS cannot embed fonts, but the OOXML format allows it: each TTF
 * variant becomes a `ppt/fonts/fontN.fntdata` part (raw TTF data, not
 * obfuscated — this is what PowerPoint itself writes for a .pptx),
 * referenced from `<p:embeddedFontLst>` in ppt/presentation.xml. So we reopen
 * the zip produced by PptxGenJS and inject into it the variants the active
 * theme provides (FONT_FILES).
 *
 * Not every font grants the right: the OS/2 table carries an `fsType` field
 * saying what its foundry allows, and "Restricted License embedding" means
 * no. Embedding anyway means redistributing a licensed font inside a file
 * that circulates — the .pptx leaves by email, there is no taking it back.
 * The permission is therefore CHECKED here (readFsType), font by font, and a
 * refusal is reported to the author rather than left to guesswork: the kit may
 * well be theirs, the font rarely is.
 *
 * PowerPoint (Windows/macOS/web) then loads the font even when it is not
 * installed on the machine; Keynote and LibreOffice ignore embedded fonts
 * and keep the documented Arial fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { FONTS, FONT_FILES } from '../deck/tokens.mjs';

/** Variants of the FONTS.body family; the label is the OOXML element targeted.
 *  The TTF paths come from FONT_FILES (themable) — read at call time. */
const VARIANTS = [
  { element: 'p:regular', key: 'regular' },
  { element: 'p:bold', key: 'bold' },
  { element: 'p:italic', key: 'italic' },
];

const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Embedding permission: the fsType field of the OS/2 table
// ---------------------------------------------------------------------------

/** Offset of `fsType` (big-endian uint16) within the OS/2 table — just after
 *  version, xAvgCharWidth, usWeightClass and usWidthClass. */
const FSTYPE_OFFSET = 8;

/** The four license levels fit in bits 0-3; the rest of the field (no
 *  subsetting, bitmap only) does not concern us, we embed the whole file
 *  as is. */
const FSTYPE_RESTRICTED = 0x0002; // "Restricted License embedding": no

/**
 * fsType of an sfnt font whose header (offset table) starts at `base`.
 * The header: version on 4 bytes, numTables on 2, then three binary-search
 * fields we ignore; the table records follow at +12, 16 bytes each (tag,
 * checksum, offset, length).
 * @returns {number|null} null if the font has no OS/2 table
 */
function sfntFsType(buf, base) {
  const numTables = buf.readUInt16BE(base + 4);
  for (let k = 0; k < numTables; k++) {
    const rec = base + 12 + k * 16;
    if (buf.toString('latin1', rec, rec + 4) !== 'OS/2') continue;
    return buf.readUInt16BE(buf.readUInt32BE(rec + 8) + FSTYPE_OFFSET);
  }
  return null;
}

/**
 * Reads the embedding permission declared by a font file.
 *
 * 0 = installable, 2 = Restricted License embedding, 4 = preview & print,
 * 8 = editable embedding. Only 2 shuts the door on us.
 *
 * Collections (.ttc): the file carries several fonts and we embed it WHOLE.
 * The value kept is that of the first font — it is the one the variant
 * designates — unless any one of the fonts in the collection is Restricted:
 * that refusal wins, since it would go into the deliverable along with the
 * others.
 *
 * @param {string} file path to a .ttf, .otf or .ttc
 * @returns {number|null} null if the file could not be read or has a
 *          structure we do not know how to read — the caller warns without
 *          blocking: taking the wrong side here would mean refusing to export
 *          a deck over a font nobody disputes.
 */
export function readFsType(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  try {
    if (buf.toString('latin1', 0, 4) !== 'ttcf') return sfntFsType(buf, 0);
    const numFonts = buf.readUInt32BE(8);
    const all = [];
    for (let k = 0; k < numFonts; k++) all.push(sfntFsType(buf, buf.readUInt32BE(12 + k * 4)));
    if (all.some((v) => v != null && v & FSTYPE_RESTRICTED)) return FSTYPE_RESTRICTED;
    return all[0] ?? null;
  } catch {
    // offset out of bounds, truncated table: malformed font file
    return null;
  }
}

/**
 * Embeds the brand font into a .pptx already written to disk.
 * Idempotent; touches nothing if the TTFs are absent.
 *
 * @param {string} pptxPath path to the .pptx to modify in place
 * @returns {Promise<{count:number, warnings:string[]}>} embedded variants
 *          (count 0 if the TTFs are absent — documented Arial fallback); any
 *          bail-out on an unexpected structure is reported as a warning.
 */
export async function embedFonts(pptxPath) {
  const warnings = [];
  const present = VARIANTS.map((v) => ({ ...v, file: FONT_FILES[v.key] })).filter(
    (v) => typeof v.file === 'string' && fs.existsSync(v.file),
  );

  // license filter: what is refused does not go into the deliverable, and the
  // author learns it here rather than by receiving a cease-and-desist
  const variants = present.filter((v) => {
    const fsType = readFsType(v.file);
    if (fsType == null) {
      warnings.push(
        `Font "${path.basename(v.file)}" (${v.key}): embedding permission could not be read (OS/2 table absent or malformed file) — embedded anyway, to be checked with its foundry.`,
      );
      return true;
    }
    if (fsType & FSTYPE_RESTRICTED) {
      warnings.push(
        `Font "${path.basename(v.file)}" (${v.key}): its foundry forbids embedding (fsType ${fsType}, "Restricted License embedding") — not embedded, machines without this font will read the deck with the fallback font.`,
      );
      return false;
    }
    return true;
  });

  if (!variants.length) return { count: 0, warnings };

  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const presFile = zip.file('ppt/presentation.xml');
  const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
  const typesFile = zip.file('[Content_Types].xml');
  if (!presFile || !relsFile || !typesFile) {
    warnings.push('.pptx without the expected presentation.xml/rels — fonts not embedded');
    return { count: 0, warnings };
  }

  let pres = await presFile.async('string');
  if (pres.includes('<p:embeddedFontLst>')) return { count: variants.length, warnings }; // already done

  // Binary parts: ppt/fonts/fontN.fntdata (raw TTF)
  variants.forEach((v, k) => {
    zip.file(`ppt/fonts/font${k + 1}.fntdata`, fs.readFileSync(v.file));
  });

  // [Content_Types].xml: content type of the fntdata parts
  let types = await typesFile.async('string');
  if (!types.includes('Extension="fntdata"')) {
    types = types.replace(
      '</Types>',
      '<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>',
    );
    zip.file('[Content_Types].xml', types);
  }

  // Relationships: a fresh rId per variant
  const rels = await relsFile.async('string');
  const maxId = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])));
  const relXml = variants
    .map(
      (v, k) =>
        `<Relationship Id="rId${maxId + 1 + k}" Type="${REL_TYPE}" Target="fonts/font${k + 1}.fntdata"/>`,
    )
    .join('');
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    rels.replace('</Relationships>', `${relXml}</Relationships>`),
  );

  // presentation.xml: embedTrueTypeFonts attribute + list of the embedded
  // fonts (position per the CT_Presentation schema: after <p:notesSz>).
  if (!/embedTrueTypeFonts=/.test(pres)) {
    pres = pres.replace('<p:presentation ', '<p:presentation embedTrueTypeFonts="1" ');
  }
  const fontRefs = variants.map((v, k) => `<${v.element} r:id="rId${maxId + 1 + k}"/>`).join('');
  const fontLst = `<p:embeddedFontLst><p:embeddedFont><p:font typeface="${esc(FONTS.body)}"/>${fontRefs}</p:embeddedFont></p:embeddedFontLst>`;
  const patched = pres.replace(/(<p:notesSz[^>]*\/>|<\/p:notesSz>)/, `$1${fontLst}`);
  if (patched === pres) {
    // unexpected structure: break nothing, but say so
    warnings.push('presentation.xml without the expected <p:notesSz> — fonts not embedded');
    return { count: 0, warnings };
  }
  zip.file('ppt/presentation.xml', patched);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(pptxPath, buf);
  return { count: variants.length, warnings };
}
