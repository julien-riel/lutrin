/**
 * Morph transition between consecutive slides sharing a title
 * (post-processing).
 *
 * When two slides in a row show the same title, the chrome (title, rules)
 * keeps its geometry from one to the next: that is exactly the ground the
 * PowerPoint Morph transition (2019+/365) covers. It happens for two reasons,
 * and the injector does not distinguish them — pagination splitting a dense
 * slide into "(cont.)" pages, and an author deliberately titling two slides
 * the same way. We reopen the zip and, for every slide of a chain but the
 * first, inject `<p159:morph>` wrapped in `mc:AlternateContent` with a
 * `<p:fade/>` fallback — versions that ignore the p159 namespace play a fade,
 * never an error.
 *
 * Shape pairing is made reliable by the PowerPoint "!!name" convention:
 * every slide of one chain receives the same title name `!!title-N` in its
 * `cNvPr` — Morph then pairs the titles by name despite the "(cont.)"
 * suffix in the text, and the title glides instead of blinking. At the
 * slightest structural disagreement, the chain is left intact — never a
 * broken .pptx.
 */

import fs from 'node:fs';
import JSZip from 'jszip';
import { ZIP_BYTES } from './bytes.mjs';

const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS_P159 = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';
const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

const MORPH_XML = `<mc:AlternateContent xmlns:mc="${NS_MC}"><mc:Choice xmlns:p159="${NS_P159}" Requires="p159"><p:transition xmlns:p14="${NS_P14}" spd="slow" p14:dur="700"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;

/** Renames the `cNvPr` of the shape carrying the TITLE placeholder.
 *
 *  Anchored on `<p:ph type="title">`, not on shape order: on a content slide
 *  the title is indeed the renderer's first write, but on a `hero` slide the
 *  first `<p:sp>` is the Lutrin attribution, written after the full-frame
 *  image. Renaming that one would pair two watermarks and leave the titles
 *  blinking. `hero` was unreachable while only pagination built chains, and
 *  became reachable the moment consecutive author slides could morph.
 *
 *  The pattern matches both the canonical `<p:ph type="title"/>` left by
 *  canonicalizeTitlePlaceholders and the raw PptxGenJS form that survives
 *  wherever canonicalization bailed out.
 *
 *  Returns null when the slide carries no title placeholder. */
function renameTitleShape(xml, newName) {
  const ph = xml.search(/<p:ph\b[^>]*\stype="title"/);
  if (ph === -1) return null;
  const spStart = xml.lastIndexOf('<p:sp>', ph);
  if (spStart === -1) return null;
  const zone = xml.slice(spStart, ph); // cNvPr precedes the ph inside nvSpPr
  const m = zone.match(/<p:cNvPr id="(\d+)" name="([^"]*)"/);
  if (!m) return null;
  return (
    xml.slice(0, spStart) +
    zone.replace(m[0], `<p:cNvPr id="${m[1]}" name="${newName}"`) +
    xml.slice(ph)
  );
}

/**
 * Injects the Morph transition into a .pptx already written to disk.
 * Idempotent; any chain with an unexpected structure is ignored (and reported).
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @param {Array<number[]>} chains runs of CONSECUTIVE 1-based slide numbers
 *        sharing a title; the transition is placed on every slide but the
 *        first. A chain that is not consecutive is refused, with a warning.
 * @returns {Promise<{count:number, warnings:string[]}>} transitions placed
 */
export async function embedMorph(pptxPath, chains) {
  const warnings = [];
  if (!chains?.length) return { count: 0, warnings };
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  let done = 0;

  for (const [ci, chain] of chains.entries()) {
    // Morph only ever compares a slide with the one BEFORE it, so a chain
    // whose numbers are not strictly consecutive would pair slides the
    // audience never sees in sequence. The caller guarantees this; refusing
    // rather than trusting, because the feature is unsound without it.
    if (chain.some((n, k) => k > 0 && n !== chain[k - 1] + 1)) {
      warnings.push(`slides ${chain.join(', ')}: not consecutive — Morph transition ignored`);
      continue;
    }
    // atomic edit per chain: renaming the titles only makes sense if every
    // slide in the chain conforms
    const edits = [];
    let ok = true;
    for (const n of chain) {
      const name = `ppt/slides/slide${n}.xml`;
      const file = zip.file(name);
      const xml = file && (await file.async('string'));
      if (!xml) {
        warnings.push(`slide ${n}: ${name} missing from the .pptx — Morph transition ignored`);
        ok = false;
        break;
      }
      let out = renameTitleShape(xml, `!!title-${ci + 1}`);
      if (!out) {
        warnings.push(`slide ${n}: title placeholder not found — Morph transition ignored`);
        ok = false;
        break;
      }
      if (n !== chain[0] && !out.includes('<p:transition') && !out.includes('p159:morph')) {
        // CT_Slide schema position: the transition follows <p:clrMapOvr>
        if (!out.includes('</p:clrMapOvr>')) {
          warnings.push(
            `slide ${n}: unexpected structure (no clrMapOvr) — Morph transition ignored`,
          );
          ok = false;
          break;
        }
        out = out.replace('</p:clrMapOvr>', `</p:clrMapOvr>${MORPH_XML}`);
      }
      edits.push([name, out]);
    }
    if (!ok) continue;
    for (const [name, out] of edits) zip.file(name, out);
    done += chain.length - 1;
  }

  if (done)
    fs.writeFileSync(
      pptxPath,
      await zip.generateAsync({ type: ZIP_BYTES, compression: 'DEFLATE' }),
    );
  return { count: done, warnings };
}
