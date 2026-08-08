/**
 * Native OMML equations, injected into the .pptx (post-processing).
 *
 * The renderer writes every equation as a picture — MathJax → SVG → PNG, which
 * is what shipped before this pass existed and is what still ships whenever
 * anything below declines. This pass turns that picture into the pair
 * PowerPoint itself writes:
 *
 *   <mc:AlternateContent>
 *     <mc:Choice Requires="a14">  a shape whose paragraph holds <a14:m><m:oMath>
 *     <mc:Fallback>               the SAME shape, locked, filled with the picture
 *
 * BOTH HALVES, EVERY TIME. `.reference-pptx/tdf129372.pptx` — a deck a person
 * built in PowerPoint — is the model, and the reason the fallback is not
 * optional is `.reference-pptx/linear_perm_slides.pptx`, the other shape a
 * generator can take: `a14:m` dropped straight into `<a:p>` with no
 * AlternateContent at all. That file is editable in PowerPoint and INVISIBLE
 * in every renderer without an OMML implementation, LibreOffice included. An
 * equation nobody can see is worse than a picture everybody can.
 *
 * WHY A PICTURE FIRST, RATHER THAN THE SHAPE DIRECTLY. Same reason as
 * `smartart.mjs`: PptxGenJS has no notion of `m:oMath`, and writing a picture
 * we then replace gives this pass a shape to find, a rectangle to read back
 * rather than recompute, and a correct rendering already in place if the
 * replacement does not happen. The `<a:blipFill>` is lifted VERBATIM out of
 * that picture, so the fallback keeps the vector twin `svg.mjs` may have hung
 * off its blip — the fallback of the fallback.
 *
 * FAILS SAFE, the contract every post-processing pass in this directory keeps:
 * a missing part, a name that matches twice, a picture with no readable
 * transform — each is a warning and a picture left standing, never a .pptx
 * PowerPoint has to repair. The conversion itself has already had its say by
 * the time we get here: `omml.mjs` returns null rather than guess, and an
 * equation with no OMML never reaches this module.
 *
 * IDEMPOTENCE IS PER EQUATION, not per slide, for the reason `smartart.mjs`
 * spells out: a slide-wide guard freezes a half-converted slide in that state.
 */

import fs from 'node:fs';
import JSZip from 'jszip';

const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';

/** Top-level shapes an equation may be sitting in. `mc:AlternateContent` is in
 *  the alternation because it is how an ALREADY converted equation reads, and
 *  reading it as "done" rather than as "not found" is what makes a second run
 *  quiet instead of noisy. */
const BLOCK_RE = /<p:pic>[\s\S]*?<\/p:pic>|<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escAttr = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The `<a:off>`/`<a:ext>` of the picture — read back rather than recomputed,
 *  so the shape lands exactly where the equation was drawn. */
function readXfrm(block) {
  const off = block.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/);
  const ext = block.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
  return off && ext ? { x: off[1], y: off[2], cx: ext[1], cy: ext[2] } : null;
}

/** id, name and description of the picture, reused verbatim so that anything
 *  addressing it by id — an entrance animation, a comment — still resolves.
 *  PowerPoint gives BOTH branches the same id, and so do we. */
function readCNvPr(block) {
  const m = block.match(/<p:cNvPr\s+id="(\d+)"\s+name="([^"]*)"([^>]*)>/);
  if (!m) return null;
  return { id: m[1], name: m[2], descr: m[3].match(/\sdescr="([^"]*)"/)?.[1] ?? '' };
}

/**
 * The picture's whole blip fill, kept as it is — it carries the raster's
 * relationship id and, when `svg.mjs` has already run, the vector twin hung off
 * the same blip. The fallback keeps both.
 *
 * The RENAME is not cosmetic: a `<p:pic>` holds a `<p:blipFill>` (the
 * PresentationML picture fill), while a `<p:sp>` fills its `<p:spPr>` with the
 * DrawingML `<a:blipFill>`. Same content model, different namespace, and the
 * wrong one is a repair dialog.
 */
function readBlipFill(block) {
  const m = block.match(/<([pa]):blipFill([^>]*)>([\s\S]*?)<\/\1:blipFill>/);
  return m ? `<a:blipFill${m[2]}>${m[3]}</a:blipFill>` : null;
}

/** `<p:nvSpPr>` — the same identity on both branches, `locks` only on the
 *  fallback. `noTextEdit` is the one that matters: it stops a reader whose
 *  renderer took the fallback from typing into what is really a picture. */
const nvSpPr = (cNvPr, locks) =>
  [
    '<p:nvSpPr>',
    `<p:cNvPr id="${cNvPr.id}" name="${escAttr(cNvPr.name)}"`,
    cNvPr.descr ? ` descr="${escAttr(cNvPr.descr)}"` : '',
    '/>',
    locks
      ? '<p:cNvSpPr><a:spLocks noRot="1" noChangeAspect="1" noMove="1" noResize="1" noEditPoints="1" noAdjustHandles="1" noChangeArrowheads="1" noChangeShapeType="1" noTextEdit="1"/></p:cNvSpPr>'
      : '<p:cNvSpPr/>',
    '<p:nvPr/>',
    '</p:nvSpPr>',
  ].join('');

const xfrmXml = (x) =>
  `<a:xfrm><a:off x="${x.x}" y="${x.y}"/><a:ext cx="${x.cx}" cy="${x.cy}"/></a:xfrm>`;

const GEOM = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

/**
 * The two halves.
 *
 * `wrap="none"` + `spAutoFit` on the Choice branch is what the reference
 * package carries, and it is right: PowerPoint owns the layout of an equation
 * and will size the shape to it. The box we hand it is already the picture's
 * natural size, so the two agree to within a rounding.
 */
function alternateContentXml({ cNvPr, xfrm, blipFill, omml }) {
  const choice = [
    '<p:sp>',
    nvSpPr(cNvPr, false),
    `<p:spPr>${xfrmXml(xfrm)}${GEOM}<a:noFill/></p:spPr>`,
    '<p:txBody>',
    '<a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr>',
    '<a:lstStyle/>',
    `<a:p><a:pPr algn="ctr"/><a14:m>${omml}</a14:m><a:endParaRPr lang="en-US"/></a:p>`,
    '</p:txBody>',
    '</p:sp>',
  ].join('');
  // the empty run with `noFill` is the reference's own: a shape whose text
  // body is genuinely empty is legal but PowerPoint does not write one
  const fallback = [
    '<p:sp>',
    nvSpPr(cNvPr, true),
    `<p:spPr>${xfrmXml(xfrm)}${GEOM}${blipFill}</p:spPr>`,
    '<p:txBody><a:bodyPr/><a:lstStyle/>',
    '<a:p><a:r><a:rPr lang="en-US"><a:noFill/></a:rPr><a:t> </a:t></a:r></a:p>',
    '</p:txBody>',
    '</p:sp>',
  ].join('');
  return [
    `<mc:AlternateContent xmlns:mc="${NS_MC}">`,
    `<mc:Choice xmlns:a14="${NS_A14}" Requires="a14">${choice}</mc:Choice>`,
    `<mc:Fallback>${fallback}</mc:Fallback>`,
    '</mc:AlternateContent>',
  ].join('');
}

/**
 * Injects native equations into a .pptx already written to disk.
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @param {Map<number, Array<{name:string, omml:string}>>} slideEquations by
 *        slide number (1-based): the pictures to replace, keyed by the
 *        `objectName` the renderer gave them. Equations `omml.mjs` declined to
 *        convert are NOT in this map — they never left the picture stage.
 * @returns {Promise<{count:number, warnings:string[]}>} equations made native,
 *          and what was left as a picture — never silently.
 */
export async function embedEquations(pptxPath, slideEquations) {
  const warnings = [];
  if (!slideEquations?.size) return { count: 0, warnings };

  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  let done = 0;

  for (const [n, entries] of slideEquations) {
    const slideName = `ppt/slides/slide${n}.xml`;
    const slideFile = zip.file(slideName);
    if (!slideFile) {
      warnings.push(`slide ${n}: ${slideName} missing from the .pptx — equations stay pictures`);
      continue;
    }
    let xml = await slideFile.async('string');
    let slideDone = 0;

    for (const { name, omml } of entries) {
      const nameRe = new RegExp(`<p:cNvPr\\b[^>]*\\sname="${escapeRe(name)}"`);
      const blocks = (xml.match(BLOCK_RE) ?? []).filter((b) => nameRe.test(b));
      if (blocks.length !== 1) {
        warnings.push(
          `slide ${n}: equation "${name}" ${blocks.length === 0 ? 'not found' : 'is not unique'} — it stays a picture`,
        );
        continue;
      }
      const block = blocks[0];
      if (block.startsWith('<mc:AlternateContent')) continue; // already native

      const xfrm = readXfrm(block);
      const cNvPr = readCNvPr(block);
      const blipFill = readBlipFill(block);
      if (!xfrm || !cNvPr || !blipFill) {
        warnings.push(
          `slide ${n}: equation "${name}" has no readable picture shape — it stays a picture`,
        );
        continue;
      }

      const shape = alternateContentXml({ cNvPr, xfrm, blipFill, omml });
      // A REPLACER FUNCTION, not a string: `$&`, `$'` and the backtick form
      // are all reachable from an equation's own glyphs, and String.replace
      // would interpret them inside the replacement.
      xml = xml.replace(block, () => shape);
      slideDone += 1;
    }

    if (slideDone) {
      zip.file(slideName, xml);
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
