/**
 * Injection of the entrance animations into the .pptx (post-processing).
 *
 * PptxGenJS cannot produce animations, but the OOXML format describes them
 * in the `<p:timing>` tree of each slideN.xml. So we reopen the zip written
 * by PptxGenJS and inject into it, for every animated slide, a main "on
 * click" sequence of native entrance effects (the very XML PowerPoint
 * writes for itself):
 *   - one step = one click; all the objects of a step appear together
 *     (the first as clickEffect, the following ones as withEffect);
 *   - a bullet list is built "by paragraph" (`<p:bldP build="p">` + one
 *     `<p:pRg>` range per item): each bullet appears on its own click,
 *     exactly like PowerPoint's native animation;
 *   - the effect is chosen by the semantics of the block (PRESET_BY_KIND):
 *     fade for text, wipe for the panels of structured layouts, zoom for
 *     timeline milestones and metrics — unless an effect is imposed on the
 *     slide by `<!-- animate: fade|wipe|zoom|appear -->`.
 *
 * Objects are matched to shapes by order of appearance in the `<p:spTree>`:
 * the renderer records one entry per addText / addShape / addImage /
 * addTable call (null = chrome that is not animated), in the exact order in
 * which PptxGenJS writes the shapes. The page-number placeholder
 * (type="sldNum"), added by the master, is excluded from the count. At the
 * slightest structural mismatch, the slide is left exactly as it is —
 * never a broken .pptx.
 */

import fs from 'node:fs';
import JSZip from 'jszip';

/** Effect per block type (default: fade). A panel is revealed by a wipe
 *  upwards, a milestone or a metric bursts in with a zoom — the brand's
 *  visual hierarchy, translated into movement. */
export const PRESET_BY_KIND = {
  panel: 'wipe',
  'timeline-dot': 'zoom',
  metric: 'zoom',
};

export const presetFor = (kind, override) => override ?? PRESET_BY_KIND[kind] ?? 'fade';

/** Top-level shapes of the spTree, in document order. */
const SHAPE_RE = /<p:(sp|pic|graphicFrame)>([\s\S]*?)<\/p:\1>/g;

/** `cNvPr` ids of the animatable shapes of a slideN.xml, in write order. */
function shapeIds(xml) {
  const ids = [];
  for (const m of xml.matchAll(SHAPE_RE)) {
    if (m[1] === 'sp' && /type="sldNum"/.test(m[2])) continue; // placeholder from the master
    const id = m[2].match(/<p:cNvPr id="(\d+)"/);
    if (id) ids.push(Number(id[1]));
  }
  return ids;
}

/** Target element of a behaviour: whole shape, or paragraph range. */
function tgtEl(target) {
  const txEl =
    target.para != null ? `<p:txEl><p:pRg st="${target.para}" end="${target.para}"/></p:txEl>` : '';
  return `<p:tgtEl><p:spTgt spid="${target.spid}">${txEl}</p:spTgt></p:tgtEl>`;
}

/** "Make visible" behaviour of a target (whole shape or paragraph). */
function setVisible(nid, target) {
  return `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${tgtEl(target)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
}

/** Filtered entrance transition (fade, wipe) on a target. */
function animEffect(nid, target, filter, dur = 400) {
  return `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}"/>${tgtEl(target)}</p:cBhvr></p:animEffect>`;
}

/** Growth from 40 % to 100 % of a target (zoom effect). */
function animScale(nid, target, dur = 400) {
  return `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>${tgtEl(target)}</p:cBhvr><p:from x="40000" y="40000"/><p:to x="100000" y="100000"/></p:animScale>`;
}

/** Entrance effects: presetID/presetSubtype = the label shown in
 *  PowerPoint's Animations pane; the child behaviours do the effect. */
const EFFECTS = {
  appear: { presetID: 1, subtype: 0, extra: () => '' },
  fade: { presetID: 10, subtype: 0, extra: (nid, t) => animEffect(nid, t, 'fade') },
  wipe: { presetID: 22, subtype: 1, extra: (nid, t) => animEffect(nid, t, 'wipe(up)') },
  zoom: {
    presetID: 23,
    subtype: 0,
    extra: (nid, t) => animEffect(nid, t, 'fade') + animScale(nid, t),
  },
};

/** Entrance effect of a target, according to its preset (resolved by presetFor). */
function effectPar(nid, target, nodeType) {
  const fx = EFFECTS[target.preset] ?? EFFECTS.appear;
  return `<p:par><p:cTn id="${nid()}" presetID="${fx.presetID}" presetClass="entr" presetSubtype="${fx.subtype}" fill="hold" grpId="0" nodeType="${nodeType}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${setVisible(nid, target)}${fx.extra(nid, target)}</p:childTnLst></p:cTn></p:par>`;
}

/** One click: all the targets of the step appear together. */
function clickPar(nid, targets) {
  const effects = targets
    .map((t, k) => effectPar(nid, t, k === 0 ? 'clickEffect' : 'withEffect'))
    .join('');
  return `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
}

/** Complete `<p:timing>` tree of a slide. */
function timingXml(stepTargets) {
  let id = 0;
  const nid = () => ++id;
  const rootId = nid();
  const seqId = nid();
  const clicks = stepTargets.map((targets) => clickPar(nid, targets)).join('');

  // <p:bldLst>: build mode per shape — "by paragraph" for lists, whole shape
  // (background included) for the rest
  const byPara = new Map();
  for (const targets of stepTargets)
    for (const t of targets) byPara.set(t.spid, (byPara.get(t.spid) ?? false) || t.para != null);
  const bld = [...byPara]
    .map(([spid, p]) =>
      p
        ? `<p:bldP spid="${spid}" grpId="0" build="p"/>`
        : `<p:bldP spid="${spid}" grpId="0" animBg="1"/>`,
    )
    .join('');

  return `<p:timing><p:tnLst><p:par><p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clicks}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${bld}</p:bldLst></p:timing>`;
}

/**
 * Injects the entrance animations into a .pptx already written to disk.
 * Idempotent; any slide with an unexpected structure is ignored.
 *
 * @param {string} pptxPath path of the .pptx to modify in place
 * @param {Map<number, {entries: Array<null|{step:number, paras?:number, kind?:string}>, preset: string|null}>} slideAnims
 *        by slide number (1-based): `entries` = one entry per shape written
 *        (in the order of the addText/addShape/addImage/addTable calls) —
 *        null = chrome that is not animated; {step, kind} = entrance step
 *        and block type (choice of the effect); {step, paras: n} = text
 *        built by paragraph (n items); `preset` = effect imposed on the
 *        slide (otherwise PRESET_BY_KIND decides per shape).
 * @returns {Promise<{count:number, warnings:string[]}>} animated slides and
 *          warnings — every slide left untouched is reported, never
 *          silently ignored.
 */
export async function embedAnimations(pptxPath, slideAnims) {
  const warnings = [];
  if (!slideAnims?.size) return { count: 0, warnings };
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  let done = 0;

  for (const [n, { entries, preset }] of slideAnims) {
    const name = `ppt/slides/slide${n}.xml`;
    const file = zip.file(name);
    if (!file) {
      warnings.push(`slide ${n}: ${name} missing from the .pptx — animations ignored`);
      continue;
    }
    const xml = await file.async('string');
    if (xml.includes('<p:timing>')) continue; // already done (idempotence, not a failure)

    const ids = shapeIds(xml);
    if (ids.length !== entries.length) {
      // unexpected structure: break nothing, but say so
      warnings.push(
        `slide ${n}: unexpected structure (${ids.length} shapes in the XML, ` +
          `${entries.length} expected) — animations ignored`,
      );
      continue;
    }

    // step → targets (one bullet = one step; several shapes = the same click)
    const stepTargets = [];
    entries.forEach((entry, k) => {
      if (!entry) return;
      const fx = presetFor(entry.kind, preset);
      if (entry.paras > 1) {
        for (let p = 0; p < entry.paras; p++)
          (stepTargets[entry.step + p] ??= []).push({ spid: ids[k], para: p, preset: fx });
      } else {
        (stepTargets[entry.step] ??= []).push({ spid: ids[k], preset: fx });
      }
    });
    const steps = stepTargets.filter(Boolean);
    if (!steps.length) continue;

    zip.file(name, xml.replace('</p:sld>', `${timingXml(steps)}</p:sld>`));
    done++;
  }

  if (done)
    fs.writeFileSync(
      pptxPath,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    );
  return { count: done, warnings };
}
