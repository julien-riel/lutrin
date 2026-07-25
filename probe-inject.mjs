/**
 * THROWAWAY PROBE (build brief §4 methodology) — does a picture survive inside
 * a .pptx table cell?
 *
 * Two routes, neither of which PptxGenJS can express, both written straight
 * into the slide XML the way pptx/render.mjs already post-processes it
 * (canonicalizeTitlePlaceholders, embedSlideTitles):
 *
 *   A. the picture as the CELL'S FILL — a:tcPr/a:blipFill, which is what
 *      PowerPoint's own "Shading > Picture" writes. Placement is expressed in
 *      thousandths of a per cent OF THE CELL (a:stretch/a:fillRect), so it does
 *      not need to know the row height PowerPoint decides.
 *   B. the picture FLOATED over the cell — a p:pic in the spTree at absolute
 *      coordinates computed from this engine's own row-height estimate.
 *
 * rId1 is already the reference icon on every slide, so nothing is added to
 * [Content_Types] or to the rels: the cell fill points at the image the slide
 * already carries.
 *
 * The verdict it produced is banked in docs/plans/widgets-next.md — Keynote
 * ignores the fillRect insets (12:1 smear) and the floated picture drifts 23 px
 * on a 26 px mark. Kept because a finding nobody can re-run is a claim.
 *
 *   node packages/core/src/cli.mjs build probe.deck.md -o probe-base.pptx
 *   node probe-inject.mjs probe-base.pptx probe.pptx
 *
 * The EST table below is the geometry the engine estimated for those two
 * tables: re-derive it if probe.deck.md changes.
 */
import fs from 'node:fs';
import JSZip from 'jszip';

const PX = 914400 / 96; // px → EMU
const src = process.argv[2];
const out = process.argv[3];

/** Geometry the engine estimated for each table (see probe.deck.md). */
const EST = {
  'ppt/slides/slide3.xml': {
    x: 48,
    y: 154,
    w: 1184,
    header: 36.4,
    rows: [36.4, 36.4, 36.4, 36.4, 36.4],
  },
  'ppt/slides/slide4.xml': { x: 48, y: 154, w: 1184, header: 36.4, rows: [81.2, 36.4, 36.4] },
};
const ICON = 26; // the `line` size, in px

/** a:blipFill for a cell, inset by percentages OF THE CELL. */
const fill = (rect) =>
  `<a:blipFill rotWithShape="1"><a:blip r:embed="rId1"/><a:stretch>${rect}</a:stretch></a:blipFill>`;

/** Insets (thousandths of a per cent) placing a `side`-px square in a
 *  `w` × `h` cell. `left` holds it against the cell's left margin instead. */
function inset(w, h, side, left = false) {
  const pc = (v, total) => Math.round((v / total) * 100000);
  const t = pc((h - side) / 2, h);
  return left
    ? `<a:fillRect l="${pc(8, w)}" t="${t}" r="${pc(w - 8 - side, w)}" b="${t}"/>`
    : `<a:fillRect l="${pc((w - side) / 2, w)}" t="${t}" r="${pc((w - side) / 2, w)}" b="${t}"/>`;
}

/** Injects `payload` into the tcPr of the nth <a:tc> — AFTER the border
 *  elements, which the CT_TableCellProperties sequence requires. */
function intoCell(xml, n, payload) {
  const cells = [...xml.matchAll(/<a:tc>[\s\S]*?<\/a:tc>/g)];
  if (!cells[n]) throw new Error(`cell ${n} not found (${cells.length} cells)`);
  const cell = cells[n][0];
  const fresh = cell.replace('</a:tcPr>', `${payload}</a:tcPr>`);
  if (fresh === cell) throw new Error(`cell ${n}: no </a:tcPr> to inject into`);
  return xml.replace(cell, fresh);
}

const zip = await JSZip.loadAsync(fs.readFileSync(src));

// ---- A: the fill, on slide 3 ------------------------------------------------
{
  const part = 'ppt/slides/slide3.xml';
  const g = EST[part];
  const cellW = g.w / 2; // two columns
  let xml = await zip.file(part).async('string');
  // cells run header(0,1), row0(2,3), row1(4,5)… → 2nd cell of row k = 3 + 2k
  xml = intoCell(xml, 3, fill('<a:fillRect/>')); // A1 stretched
  xml = intoCell(xml, 5, fill(inset(cellW, g.rows[1], ICON))); // A2 squared
  xml = intoCell(xml, 7, fill(inset(cellW, g.rows[2], 20, true))); // A3 left
  xml = intoCell(xml, 9, fill(inset(cellW, g.rows[3], ICON))); // A4 under text
  zip.file(part, xml);
}

// ---- B: the floated picture, on slide 4 -------------------------------------
{
  const part = 'ppt/slides/slide4.xml';
  const g = EST[part];
  const cellW = g.w / 2;
  const xml = await zip.file(part).async('string');
  // top of row B2 = table top + header + row B1, as the ENGINE estimated them
  const top = g.y + g.header + g.rows[0];
  const x = g.x + cellW + (cellW - ICON) / 2;
  const y = top + (g.rows[1] - ICON) / 2;
  // joined rather than concatenated: the repo's lint forbids `+` between
  // template literals, and its autofix would put this on one 500-column line
  const pic = [
    `<p:pic><p:nvPicPr><p:cNvPr id="99" name="Floated icon B2" descr="Icon check"/>`,
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`,
    `<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`,
    `<p:spPr><a:xfrm><a:off x="${Math.round(x * PX)}" y="${Math.round(y * PX)}"/>`,
    `<a:ext cx="${Math.round(ICON * PX)}" cy="${Math.round(ICON * PX)}"/></a:xfrm>`,
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
  ].join('');
  if (!xml.includes('</p:spTree>')) throw new Error('no spTree on slide 4');
  zip.file(part, xml.replace('</p:spTree>', `${pic}</p:spTree>`));
  console.log(`B2 floated at ${Math.round(x)},${Math.round(y)} px (estimate-derived)`);
}

fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`✓ ${out}`);
