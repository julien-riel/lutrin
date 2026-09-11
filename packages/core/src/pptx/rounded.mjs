/**
 * Rounded corners on a picture, applied to a .pptx already written to disk.
 *
 * WHY A POST-PASS. PptxGenJS writes a picture's geometry itself, and the only
 * choice it offers is a rectangle or an ellipse:
 *
 *     <a:prstGeom prst="${rounding ? 'ellipse' : 'rect'}"><a:avLst/></a:prstGeom>
 *
 * There is no hook for `roundRect` and no adjust value to pass, so a corner
 * radius cannot be asked for at `addImage` time at all. Leaving it out of the
 * .pptx was the alternative, and it is the one thing this engine will not do:
 * a kit that rounds its cover photograph must round it in both outputs or the
 * two have drifted, which is the failure the whole shared-geometry design
 * exists to prevent.
 *
 * The surgery is the smallest that works — one `prstGeom` per picture, found by
 * the `objectName` the renderer gave it. Anything unexpected is LEFT ALONE and
 * reported: a square corner is a cosmetic loss, and a malformed `prstGeom`
 * would make PowerPoint call the whole file corrupt.
 */
import fs from 'node:fs';
import JSZip from 'jszip';
import { ZIP_BYTES } from './bytes.mjs';

/** One `<p:pic>…</p:pic>`, non-greedy so two pictures never merge into one. */
const PIC_RE = /<p:pic>[\s\S]*?<\/p:pic>/g;

/** The geometry PptxGenJS writes for a picture, in either of its two spellings
 *  (it emits a self-closing avLst; a future version might not). */
const RECT_GEOM =
  /<a:prstGeom\s+prst="rect">\s*(?:<a:avLst\s*\/>|<a:avLst>\s*<\/a:avLst>)\s*<\/a:prstGeom>/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rounds the corners of named pictures in place.
 *
 * Idempotent: a picture already carrying a `roundRect` is skipped rather than
 * rounded twice, so running the pass over its own output changes nothing.
 *
 * @param {string} pptxPath the .pptx to modify in place
 * @param {Map<number, Array<{name: string, adj: number}>>} rounded by slide
 *        number (1-based): the pictures to round, keyed by the `objectName` the
 *        renderer gave them, with the OOXML adjust value already computed
 *        (tokens.mjs — it is a property of the shape, not of this file).
 * @returns {Promise<{count: number, warnings: string[]}>}
 */
export async function roundPictures(pptxPath, rounded) {
  const warnings = [];
  if (!rounded?.size) return { count: 0, warnings };
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  let done = 0;

  for (const [n, pictures] of rounded) {
    const slideName = `ppt/slides/slide${n}.xml`;
    const slideFile = zip.file(slideName);
    if (!slideFile) {
      warnings.push(`slide ${n}: ${slideName} missing from the .pptx — corners left square`);
      continue;
    }
    let xml = await slideFile.async('string');
    let slideDone = 0;

    for (const { name, adj } of pictures) {
      if (!(adj > 0)) continue; // a radius of zero IS a square corner: nothing to do
      // found by the name the renderer gave it, anchored on cNvPr's own `name=`
      // — `descr` sits in the same element and often repeats the label, which a
      // bare includes() would match too. Two shapes sharing a name would make
      // the choice arbitrary, so neither is touched.
      const nameRe = new RegExp(`<p:cNvPr\\b[^>]*\\sname="${escapeRe(name)}"`);
      const pics = (xml.match(PIC_RE) ?? []).filter((p) => nameRe.test(p));
      if (pics.length !== 1) {
        warnings.push(
          `slide ${n}: picture "${name}" ${pics.length === 0 ? 'not found' : 'is not unique'} — its corners stay square`,
        );
        continue;
      }
      const pic = pics[0];
      if (pic.includes('prst="roundRect"')) continue; // already rounded
      if (!RECT_GEOM.test(pic)) {
        warnings.push(
          `slide ${n}: picture "${name}" carries a geometry this build did not write — its corners stay square`,
        );
        continue;
      }
      const round = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
      xml = xml.replace(pic, pic.replace(RECT_GEOM, round));
      slideDone++;
    }

    if (slideDone) {
      zip.file(slideName, xml);
      done += slideDone;
    }
  }

  if (done)
    fs.writeFileSync(
      pptxPath,
      await zip.generateAsync({ type: ZIP_BYTES, compression: 'DEFLATE' }),
    );
  return { count: done, warnings };
}
