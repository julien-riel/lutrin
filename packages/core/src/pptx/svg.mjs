/**
 * Vector twin of a picture, injected into the .pptx (post-processing).
 *
 * A chart, a Mermaid diagram, a Lucide icon and a LaTeX equation are all born
 * as SVG and were, until now, thrown away the instant resvg had rasterised
 * them: the .pptx carried the PNG alone, and the three comparison pages on the
 * site conceded as much — "charts, diagrams, equations and icons are rasterised
 * images". They no longer have to be. Since Office 2016 a picture may carry a
 * SECOND representation, an `image/svg+xml` part referenced from an extension
 * on `<a:blip>`:
 *
 *   <a:blip r:embed="rIdPNG">
 *     <a:extLst>
 *       <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
 *         <asvg:svgBlip xmlns:asvg="…/2016/SVG/main" r:embed="rIdSVG"/>
 *       </a:ext>
 *     </a:extLst>
 *   </a:blip>
 *
 * THE PNG STAYS THE FILL. `r:embed` on the blip itself keeps pointing at the
 * raster, and only the extension names the vector: PowerPoint 2019+ draws the
 * SVG and scales it without softening, while Keynote, QuickLook, LibreOffice
 * and every older Office ignore an extension they do not know and draw exactly
 * the image they drew yesterday. Shipping both is the whole point — this is an
 * upgrade for readers that can take it, never a demand made of the others.
 *
 * DO NOT REPLACE THIS WITH PptxGenJS'S OWN SVG SUPPORT. Handing `addImage` an
 * `.svg` path writes the right extLst, but on the Node path the library fills
 * the PNG fallback part with a literal broken-image icon — so precisely the
 * readers this fallback exists for would show a broken picture. The whole
 * reason this module reopens the zip by hand is to keep the two
 * representations honest.
 *
 * Shapes are found by NAME. Every shape the renderer writes gets a unique
 * `objectName` (wrapSlide), which lands in `cNvPr name=`; matching on that is
 * far steadier than counting `<p:pic>` elements, since a hero image or a logo
 * is a picture too and would shift every ordinal after it. A name that is
 * missing, or that appears twice, means the document is not the one we wrote:
 * that picture is left alone — never a broken .pptx.
 */

import fs from 'node:fs';
import JSZip from 'jszip';

/** The extension URI Office reserves for the vector twin of a picture, and the
 *  namespace of the element inside it. Fixed by the format, not by us. */
const SVG_EXT_URI = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const NS_ASVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';

/** `<p:pic>` blocks of a slide, with the name and the blip of each. */
const PIC_RE = /<p:pic>[\s\S]*?<\/p:pic>/g;

/** Highest rId already used by a relationship part, so the ones we add are new. */
function maxRelId(relsXml) {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Injects the vector twins into a .pptx already written to disk.
 * Idempotent; any picture whose structure is unexpected is left as it is.
 *
 * `[Content_Types].xml` needs no work: PptxGenJS already declares
 * `<Default Extension="svg" ContentType="image/svg+xml"/>` unconditionally —
 * verified on a real output, and asserted by the test suite so a library
 * upgrade that dropped it could not pass silently.
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @param {Map<number, Array<{name:string, svg:string}>>} slideVectors by slide
 *        number (1-based): the shapes that have a vector source, keyed by the
 *        `objectName` the renderer gave them.
 * @returns {Promise<{count:number, warnings:string[]}>} pictures given a vector
 *          twin, and what was left behind — never silently.
 */
export async function embedVectorImages(pptxPath, slideVectors) {
  const warnings = [];
  if (!slideVectors?.size) return { count: 0, warnings };
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  let done = 0;

  for (const [n, vectors] of slideVectors) {
    const slideName = `ppt/slides/slide${n}.xml`;
    const relsName = `ppt/slides/_rels/slide${n}.xml.rels`;
    const slideFile = zip.file(slideName);
    const relsFile = zip.file(relsName);
    if (!slideFile || !relsFile) {
      warnings.push(`slide ${n}: ${slideName} missing from the .pptx — vector images ignored`);
      continue;
    }
    let xml = await slideFile.async('string');
    let rels = await relsFile.async('string');
    if (xml.includes(SVG_EXT_URI)) continue; // already done (idempotence, not a failure)

    let rid = maxRelId(rels);
    let slideDone = 0;

    for (const { name, svg } of vectors) {
      // the picture is found by the name the renderer gave it; two shapes
      // sharing a name would make the choice arbitrary, so neither is touched.
      // Anchored on cNvPr's own `name=` — `descr` sits in the same element and
      // often repeats the label, which a bare includes() would match too.
      const nameRe = new RegExp(
        `<p:cNvPr\\b[^>]*\\sname="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
      );
      const pics = (xml.match(PIC_RE) ?? []).filter((p) => nameRe.test(p));
      if (pics.length !== 1) {
        warnings.push(
          `slide ${n}: picture "${name}" ${pics.length === 0 ? 'not found' : 'is not unique'} — it stays a raster image`,
        );
        continue;
      }
      const pic = pics[0];
      const blip = pic.match(/<a:blip\b[^>]*>/);
      if (!blip) {
        warnings.push(`slide ${n}: picture "${name}" has no blip — it stays a raster image`);
        continue;
      }
      // a self-closing blip has no children to append to: open it first
      const selfClosing = blip[0].endsWith('/>');
      const openTag = selfClosing ? `${blip[0].slice(0, -2)}>` : blip[0];
      const closeTag = selfClosing ? '</a:blip>' : '';

      rid += 1;
      const part = `media/vector-${n}-${slideDone + 1}.svg`;
      zip.file(`ppt/${part}`, svg);
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../${part}"/></Relationships>`,
      );
      const ext = `<a:extLst><a:ext uri="${SVG_EXT_URI}"><asvg:svgBlip xmlns:asvg="${NS_ASVG}" r:embed="rId${rid}"/></a:ext></a:extLst>`;
      const patched = pic.replace(blip[0], `${openTag}${ext}${closeTag}`);
      xml = xml.replace(pic, patched);
      slideDone += 1;
    }

    if (slideDone) {
      zip.file(slideName, xml);
      zip.file(relsName, rels);
      done += slideDone;
    }
  }

  if (done)
    fs.writeFileSync(
      pptxPath,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    );
  return { count: done, warnings };
}
