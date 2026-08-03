/**
 * Real OOXML SmartArt, injected into the .pptx (post-processing).
 *
 * The renderer draws every diagram twice over: as a picture, which is what
 * ships if anything here declines, and as a geometry object. This pass turns
 * the picture into a `<p:graphicFrame>` carrying `<dgm:relIds>`, writes the
 * five `ppt/diagrams/*` parts beside it, and lets PowerPoint open its own
 * SmartArt UI on the result — Text Pane, Change Layout, Change Colors.
 *
 * WHY A PICTURE FIRST, RATHER THAN THE FRAME DIRECTLY. PptxGenJS has no
 * concept of a diagram part, and no hook for adding one. Writing a picture we
 * then replace gives this pass a shape to find, a rectangle to read back
 * rather than recompute, and — the part that matters — a correct rendering of
 * the diagram already in place if the replacement does not happen. Every exit
 * below leaves that picture standing.
 *
 * WHAT "FAILS SAFE" MEANS HERE, because it is the contract every other
 * post-processing pass in this directory keeps: a missing part, a name that
 * matches twice, a family we do not recognise, a builder that throws — each
 * is a warning and a picture left alone, never a `.pptx` PowerPoint has to
 * repair. The one thing worse than a diagram that is not editable is a deck
 * that will not open.
 *
 * IDEMPOTENCE IS PER DIAGRAM, not per slide. A slide-wide guard would freeze
 * a half-converted slide — one diagram swapped, one warned about — in that
 * state forever, and would make a second run skip the write entirely, so
 * "the package is byte-identical" would be true by construction rather than
 * by correctness. The guard is therefore the block's own content.
 */

import fs from 'node:fs';
import JSZip from 'jszip';
import { FAMILIES, buildDiagramParts, escAttr } from './diagram-parts.mjs';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MS_REL = 'http://schemas.microsoft.com/office/2007/relationships';
const NS_DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** The five parts, in the order their rIds are allocated. `quickStyle` is the
 *  one whose relationship type and content type disagree with each other —
 *  `diagramQuickStyle` against `diagramStyle` — and it is not a typo. */
const PARTS = [
  {
    key: 'data',
    file: 'data',
    rel: `${REL}/diagramData`,
    type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml',
  },
  {
    key: 'layout',
    file: 'layout',
    rel: `${REL}/diagramLayout`,
    type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml',
  },
  {
    key: 'quickStyle',
    file: 'quickStyle',
    rel: `${REL}/diagramQuickStyle`,
    type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml',
  },
  {
    key: 'colors',
    file: 'colors',
    rel: `${REL}/diagramColors`,
    type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml',
  },
  {
    key: 'drawing',
    file: 'drawing',
    rel: `${MS_REL}/diagramDrawing`,
    type: 'application/vnd.ms-office.drawingml.diagramDrawing+xml',
  },
];

/** Top-level shapes a diagram may be sitting in. `graphicFrame` is in the
 *  alternation on purpose: it is how an ALREADY converted diagram reads, and
 *  reading it as "done" rather than as "not found" is what makes a second run
 *  quiet instead of noisy. */
const BLOCK_RE = /<p:(pic|graphicFrame)>[\s\S]*?<\/p:\1>/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function maxRelId(relsXml) {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * The next free `ppt/diagrams/dataK.xml` number, taken as MAX + 1 over what is
 * already there rather than as count + 1: a package holding `data2` and
 * `data5` has a count of two and would otherwise be handed `data3`, which is
 * free, and then `data4`, which is not the point — the invariant wanted is
 * "never reuse a live number", and only the maximum gives it.
 */
function nextPartIndex(zip) {
  let max = 0;
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^ppt\/diagrams\/data(\d+)\.xml$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** The `<a:off>`/`<a:ext>` of a shape, read back rather than recomputed: the
 *  frame must land exactly where the picture was, and the picture's own
 *  transform is the only statement of that which cannot be off by a rounding. */
function readXfrm(block) {
  const off = block.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/);
  const ext = block.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
  if (!off || !ext) return null;
  return { x: off[1], y: off[2], cx: ext[1], cy: ext[2] };
}

/** The `cNvPr` id and name of a shape — reused verbatim, so anything that
 *  addressed the picture by id (an animation, a comment) still resolves. */
function readCNvPr(block) {
  const m = block.match(/<p:cNvPr\s+id="(\d+)"\s+name="([^"]*)"/);
  return m ? { id: m[1], name: m[2] } : null;
}

function graphicFrameXml({ id, name, descr, xfrm, rIds }) {
  return [
    '<p:graphicFrame>',
    '<p:nvGraphicFramePr>',
    `<p:cNvPr id="${id}" name="${escAttr(name)}" descr="${escAttr(descr)}"/>`,
    '<p:cNvGraphicFramePr/><p:nvPr/>',
    '</p:nvGraphicFramePr>',
    `<p:xfrm><a:off x="${xfrm.x}" y="${xfrm.y}"/><a:ext cx="${xfrm.cx}" cy="${xfrm.cy}"/></p:xfrm>`,
    `<a:graphic><a:graphicData uri="${NS_DGM}">`,
    `<dgm:relIds xmlns:dgm="${NS_DGM}" xmlns:r="${REL}" `,
    `r:dm="${rIds.data}" r:lo="${rIds.layout}" r:qs="${rIds.quickStyle}" r:cs="${rIds.colors}"/>`,
    '</a:graphicData></a:graphic>',
    '</p:graphicFrame>',
  ].join('');
}

/**
 * Injects real SmartArt into a .pptx already written to disk.
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @param {Map<number, Array<{name:string, payload:object}>>} slideDiagrams by
 *        slide number (1-based): the placeholder pictures to replace, keyed by
 *        the `objectName` the renderer gave them.
 * @returns {Promise<{count:number, warnings:string[]}>} diagrams converted, and
 *          what was left as a picture — never silently.
 */
export async function embedSmartArt(pptxPath, slideDiagrams) {
  const warnings = [];
  if (!slideDiagrams?.size) return { count: 0, warnings };

  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));

  // Guarded before it is dereferenced: this is the one pass whose whole
  // contract is that it never fails hard, and a TypeError here would take the
  // entire export down with it.
  const ctFile = zip.file('[Content_Types].xml');
  if (!ctFile) {
    warnings.push('[Content_Types].xml missing from the .pptx — diagrams stay pictures');
    return { count: 0, warnings };
  }
  let contentTypes = await ctFile.async('string');

  let k = nextPartIndex(zip);
  let done = 0;
  const written = [];

  for (const [n, entries] of slideDiagrams) {
    const slideName = `ppt/slides/slide${n}.xml`;
    const relsName = `ppt/slides/_rels/slide${n}.xml.rels`;
    const slideFile = zip.file(slideName);
    const relsFile = zip.file(relsName);
    if (!slideFile || !relsFile) {
      warnings.push(`slide ${n}: ${slideName} missing from the .pptx — diagrams stay pictures`);
      continue;
    }
    let xml = await slideFile.async('string');
    let rels = await relsFile.async('string');
    let rid = maxRelId(rels);

    for (const { name, payload } of entries) {
      const family = payload?.family;
      if (!FAMILIES[family]?.smartart) continue; // family turned off: the picture is correct

      const nameRe = new RegExp(`<p:cNvPr\\b[^>]*\\sname="${escapeRe(name)}"`);
      const blocks = (xml.match(BLOCK_RE) ?? []).filter((b) => nameRe.test(b));
      if (blocks.length !== 1) {
        warnings.push(
          `slide ${n}: diagram "${name}" ${blocks.length === 0 ? 'not found' : 'is not unique'} — it stays a picture`,
        );
        continue;
      }
      const block = blocks[0];
      if (block.includes(NS_DGM)) continue; // already converted — idempotence, not a failure

      const xfrm = readXfrm(block);
      const cNvPr = readCNvPr(block);
      if (!xfrm || !cNvPr) {
        warnings.push(
          `slide ${n}: diagram "${name}" has no readable transform — it stays a picture`,
        );
        continue;
      }

      // rIds are allocated BEFORE the parts are built, because `dataK.xml`
      // has to name the drawing's own relationship inside itself.
      const rIds = {};
      for (const part of PARTS) rIds[part.key] = `rId${(rid += 1)}`;

      let parts;
      try {
        parts = buildDiagramParts({
          family,
          block: payload.block,
          geometry: payload.geometry,
          index: k,
          drawingRelId: rIds.drawing,
        });
      } catch (err) {
        // A builder that throws has told us the model is not one it can
        // serialise. That is a reason to keep the picture, not to lose it.
        warnings.push(
          `slide ${n}: diagram "${name}" could not be built (${err.message}) — it stays a picture`,
        );
        rid -= PARTS.length; // hand the ids back: nothing was written under them
        continue;
      }

      for (const part of PARTS) {
        const file = `ppt/diagrams/${part.file}${k}.xml`;
        zip.file(file, parts[part.key]);
        written.push({ file, type: part.type });
        rels = rels.replace(
          '</Relationships>',
          `<Relationship Id="${rIds[part.key]}" Type="${part.rel}" Target="../diagrams/${part.file}${k}.xml"/></Relationships>`,
        );
      }

      const frame = graphicFrameXml({
        id: cNvPr.id,
        name: cNvPr.name,
        descr: `SmartArt ${family}`,
        xfrm,
        rIds,
      });
      // A REPLACER FUNCTION, not a string: `$&`, `$'` and the backtick form
      // are all reachable from a node label, and String.replace would
      // interpret them inside the replacement.
      xml = xml.replace(block, () => frame);
      k += 1;
      done += 1;
    }

    zip.file(slideName, xml);
    zip.file(relsName, rels);
  }

  if (!done) return { count: 0, warnings };

  // Overrides are MANDATORY: without them the package's `Default` for the
  // `xml` extension types these parts as generic XML, and PowerPoint drops
  // the diagram without a word.
  const overrides = written
    .map((w) => `<Override PartName="/${w.file}" ContentType="${w.type}"/>`)
    .join('');
  contentTypes = contentTypes.replace('</Types>', `${overrides}</Types>`);
  zip.file('[Content_Types].xml', contentTypes);

  fs.writeFileSync(
    pptxPath,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  return { count: done, warnings };
}
