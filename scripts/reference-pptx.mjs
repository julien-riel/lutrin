#!/usr/bin/env node
/**
 * Reference packages: what PowerPoint itself writes, next to what we write.
 *
 * `scripts/smartart-probe.mjs` ends with seven questions for a human, because
 * no PowerPoint runs here. Four of those questions still need eyes. THREE of
 * them are really questions about BYTES — does our package carry the parts,
 * the content types and the relationships a PowerPoint-authored one carries —
 * and bytes can be compared without PowerPoint, as long as there is something
 * authentic to compare against.
 *
 * This script fetches that something: a small corpus of `.pptx` files written
 * by Microsoft PowerPoint — SmartArt diagrams, and native OMML equations —
 * then reads our own `--smartart` output through the shipping code path and
 * reports where the two packages agree, where they deliberately differ, and
 * where a difference would be a defect.
 *
 *   node scripts/reference-pptx.mjs           # fetch (cached) + report
 *   node scripts/reference-pptx.mjs --fetch   # download only
 *   node scripts/reference-pptx.mjs --list    # the corpus and its provenance
 *
 * NOT A CI STEP, and never should be: it needs the network, and it reads files
 * whose upstream can move. It is a bench instrument — run it when the OOXML
 * writers change, and when gap #4 (editable OMML equations) is picked up.
 *
 * NOTHING IS VENDORED. The corpus lands in `.reference-pptx/`, ignored by git.
 * `docs/plans/smartart.md` explains why Microsoft-authored Office data files
 * cannot be checked into an MIT repository, and the same reasoning covers
 * checking in the bug-report attachments that carry them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(here, '..', 'packages', 'core', 'src');
const CACHE = path.resolve(here, '..', '.reference-pptx');

const LO = 'https://raw.githubusercontent.com/LibreOffice/core/master/sd/qa/unit/data/pptx';

/**
 * Eight files, each earning its place. The SmartArt seven come from
 * LibreOffice's Impress test corpus, which is mostly bug-report attachments —
 * i.e. real decks people made in PowerPoint and then complained about. The
 * equation pair is the point of the exercise for gap #4: one file PowerPoint
 * wrote, one a generator wrote, and the difference between them is the whole
 * lesson.
 */
const SOURCES = [
  {
    file: 'smartart-accent-process.pptx',
    url: `${LO}/smartart-accent-process.pptx`,
    kind: 'smartart',
    proves: 'the baseline skeleton — Office preset layout process3',
  },
  {
    file: 'smartart-org-chart.pptx',
    url: `${LO}/smartart-org-chart.pptx`,
    kind: 'smartart',
    proves: 'a hierarchy, the family with the most pres nodes',
  },
  {
    file: 'smartart-cycle-matrix.pptx',
    url: `${LO}/smartart-cycle-matrix.pptx`,
    kind: 'smartart',
    proves: 'a cycle, against ours',
  },
  {
    file: 'tdf149551_SmartArt_Venn.pptx',
    url: `${LO}/tdf149551_SmartArt_Venn.pptx`,
    kind: 'smartart',
    proves: 'a venn, against ours',
  },
  {
    file: 'tdf149551_SmartArt_Pyramid.pptx',
    url: `${LO}/tdf149551_SmartArt_Pyramid.pptx`,
    kind: 'smartart',
    proves: 'a family we do not ship — what a stacked layout looks like',
  },
  {
    file: 'smartart-picture-strip.pptx',
    url: `${LO}/smartart-picture-strip.pptx`,
    kind: 'smartart',
    proves: 'a diagram that owns pictures — the one case with ppt/diagrams/_rels',
  },
  {
    file: 'tdf129372.pptx',
    url: `${LO}/tdf129372.pptx`,
    kind: 'omml',
    proves: 'PowerPoint’s own equation encoding, fallback picture included',
  },
  {
    file: 'linear_perm_slides.pptx',
    url: 'https://raw.githubusercontent.com/Noi1r/powerpoint-skill/main/example/linear_perm_slides/linear_perm_slides.pptx',
    kind: 'omml',
    proves: 'a generator’s equation encoding — bare a14:m, no fallback',
  },
];

/* ------------------------------------------------------------------ fetch */

async function fetchCorpus() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const s of SOURCES) {
    const dest = path.join(CACHE, s.file);
    if (fs.existsSync(dest)) {
      console.log(`  cached  ${s.file}`);
      continue;
    }
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`${s.url} — HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // A proxy that answers HTML to a binary request would otherwise be cached
    // as a .pptx and fail much later, in the reader, as a parse error.
    if (buf.subarray(0, 2).toString() !== 'PK') throw new Error(`${s.url} — not a zip`);
    fs.writeFileSync(dest, buf);
    console.log(`  fetched ${s.file.padEnd(34)} ${(buf.length / 1024).toFixed(0)} kB`);
  }
}

/* ----------------------------------------------------------------- reading */

const DIAGRAM_RELS = {
  diagramData: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
  diagramLayout:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout',
  diagramQuickStyle:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle',
  diagramColors:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors',
  diagramDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
};

const count = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * Everything this script compares, read out of one package. Deliberately flat:
 * a report that has to be understood before it can be read is a report nobody
 * runs twice.
 */
async function readPackage(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const text = async (n) => (zip.files[n] ? await zip.files[n].async('string') : '');

  const types = await text('[Content_Types].xml');
  const data1 = await text('ppt/diagrams/data1.xml');
  const layout1 = await text('ppt/diagrams/layout1.xml');
  const colors1 = await text('ppt/diagrams/colors1.xml');
  const quick1 = await text('ppt/diagrams/quickStyle1.xml');

  // The slide that carries the first diagram: its .rels is where the drawing
  // relId resolves, and finding it by search rather than by index keeps this
  // honest for decks whose diagram is not on slide 1.
  let slideRels = '';
  for (const n of names.filter((n) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n))) {
    const r = await text(n);
    if (r.includes(DIAGRAM_RELS.diagramData)) {
      slideRels = r;
      break;
    }
  }

  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  let graphicData = false;
  for (const n of slides) graphicData ||= (await text(n)).includes('drawingml/2006/diagram');
  let oMath = 0;
  let a14m = 0;
  let altContent = 0;
  let fallback = 0;
  for (const n of slides) {
    const s = await text(n);
    oMath += count(s, '<m:oMath');
    a14m += count(s, '<a14:m');
    // Only the AlternateContent blocks that actually wrap an equation count;
    // a deck can carry others (ink, 3D models) that say nothing about math.
    for (const block of s.split('<mc:AlternateContent').slice(1)) {
      const end = block.indexOf('</mc:AlternateContent>');
      const scope = end === -1 ? block : block.slice(0, end);
      if (!scope.includes('<a14:m')) continue;
      altContent += 1;
      if (scope.includes('<mc:Fallback')) fallback += 1;
    }
  }

  const modelExt = /<dsp:dataModelExt[^>]*>/.exec(data1)?.[0] ?? '';
  return {
    diagrams: names.filter((n) => /^ppt\/diagrams\/data\d+\.xml$/.test(n)).length,
    diagramParts: names.filter((n) => /^ppt\/diagrams\/[^/]+\.xml$/.test(n)).sort(),
    diagramRelsDir: names.some((n) => n.startsWith('ppt/diagrams/_rels/')),
    dirEntries: names.filter((n) => n.endsWith('/')).length,
    overrides: Object.fromEntries(
      Object.entries({
        data: 'diagramData+xml',
        layout: 'diagramLayout+xml',
        quickStyle: 'diagramStyle+xml',
        colors: 'diagramColors+xml',
        drawing: 'diagramDrawing+xml',
      }).map(([k, v]) => [k, types.includes(v)]),
    ),
    relTypes: Object.fromEntries(
      Object.entries(DIAGRAM_RELS).map(([k, v]) => [k, slideRels.includes(v)]),
    ),
    graphicData,
    modelExtRelId: /relId="([^"]+)"/.exec(modelExt)?.[1] ?? null,
    modelExtMinVer: /minVer="([^"]+)"/.exec(modelExt)?.[1] ?? null,
    modelExtResolves: (() => {
      const id = /relId="([^"]+)"/.exec(modelExt)?.[1];
      return Boolean(id) && new RegExp(`Id="${id}"`).test(slideRels);
    })(),
    layoutUniqueId: /uniqueId="([^"]+)"/.exec(layout1)?.[1] ?? null,
    layoutGalleries: {
      sampData: layout1.includes('<dgm:sampData'),
      styleData: layout1.includes('<dgm:styleData'),
      clrData: layout1.includes('<dgm:clrData'),
    },
    presNodes: count(data1, 'type="pres"'),
    colorLabels: count(colors1, '<dgm:styleLbl'),
    quickStyleLabels: count(quick1, '<dgm:styleLbl'),
    colorRefs: colors1.includes('schemeClr') ? 'schemeClr' : colors1 ? 'srgbClr' : '—',
    math: { oMath, a14m, altContent, fallback },
  };
}

/** Our own package, built through the path that ships. */
async function buildOurs() {
  const { parseDeck } = await import(path.join(CORE, 'deck', 'parse.mjs'));
  const { buildScenes } = await import(path.join(CORE, 'deck', 'layout.mjs'));
  const { renderDeck } = await import(path.join(CORE, 'pptx', 'render.mjs'));

  const source = `---
title: reference comparison
---

# Cycle

<!-- layout: cycle -->

## Plan

Understand the need.

## Build

Choose the shape.

## Ship

Put it online.

---

# Hierarchy

<!-- layout: hierarchy -->

- Direction
  - Product
  - Engineering
`;

  const work = fs.mkdtempSync(path.join(CACHE, 'ours-'));
  const out = path.join(work, 'ours.pptx');
  const deck = parseDeck(source);
  await renderDeck(buildScenes(deck), deck.meta, work, out, { smartart: true });
  const buf = fs.readFileSync(out);
  fs.rmSync(work, { recursive: true, force: true });
  return buf;
}

/* ----------------------------------------------------------------- report */

const yes = (b) => (b ? 'yes' : 'NO');

function reportSmartArt(ours, refs) {
  console.log('\nSmartArt — package skeleton\n');
  // The reference column is a SET, not a list: six files agreeing on a value
  // is one fact, and printing it six times buries the one row where they do
  // not agree.
  const row = (label, get) => {
    const seen = [...new Set(refs.map((r) => String(get(r.pkg))))];
    console.log(
      `  ${label.padEnd(24)} ours: ${String(get(ours)).padEnd(22)} PowerPoint: ${seen.join(' | ')}`,
    );
  };

  row('diagrams in the deck', (p) => p.diagrams);
  row('xml parts per diagram', (p) => (p.diagrams ? p.diagramParts.length / p.diagrams : 0));
  row('ppt/diagrams/_rels', (p) => yes(p.diagramRelsDir));
  row('content-type overrides', (p) => `${Object.values(p.overrides).filter(Boolean).length}/5`);
  row('slide rel types', (p) => `${Object.values(p.relTypes).filter(Boolean).length}/5`);
  row('dgm graphicData', (p) => yes(p.graphicData));
  row('dataModelExt resolves', (p) => yes(p.modelExtResolves));
  row('dataModelExt minVer', (p) =>
    (p.modelExtMinVer ?? '—').replace('http://schemas.openxmlformats.org', '…'),
  );
  row('gallery data', (p) => `${Object.values(p.layoutGalleries).filter(Boolean).length}/3`);
  row('pres nodes', (p) => p.presNodes);
  row('colour labels', (p) => p.colorLabels);
  row('quick-style labels', (p) => p.quickStyleLabels);
  row('colour references', (p) => p.colorRefs);
  row('layout uniqueId', (p) => (p.layoutUniqueId ?? '—').replace(/^urn:/, '').slice(0, 34));
  row('zip directory entries', (p) => p.dirEntries);

  // The invariants: a reference and ours must agree, or the package is wrong.
  const musts = [
    ['five diagram parts', ours.diagramParts.length >= 5],
    ['five content-type overrides', Object.values(ours.overrides).every(Boolean)],
    ['five slide relationships', Object.values(ours.relTypes).every(Boolean)],
    ['diagram graphicData on the slide', ours.graphicData],
    // Not a universal law: smartart-picture-strip.pptx HAS ppt/diagrams/_rels,
    // because a diagram that owns pictures relates to them from data1/drawing1.
    // It holds for a diagram without media, which is every diagram we write.
    ['no ppt/diagrams/_rels (we ship no media inside a diagram)', !ours.diagramRelsDir],
    ['dataModelExt resolves in the slide rels', ours.modelExtResolves],
    [
      'dataModelExt minVer matches PowerPoint',
      refs
        .filter((r) => r.src.kind === 'smartart' && r.pkg.modelExtMinVer)
        .every((r) => r.pkg.modelExtMinVer === ours.modelExtMinVer),
    ],
    ['sampData / styleData / clrData present', Object.values(ours.layoutGalleries).every(Boolean)],
  ];
  console.log('\n  Invariants');
  let bad = 0;
  for (const [what, ok] of musts) {
    if (!ok) bad += 1;
    console.log(`    ${ok ? '✓' : '✗'} ${what}`);
  }

  console.log(`
  Known, deliberate divergences — not defects, but the cost is real:
    · layout uniqueId is ours (urn:lutrin.dev/…), not an Office preset. The
      diagram is SmartArt to PowerPoint either way; the Change Layout gallery
      shows our entry rather than a built-in one.
    · colorsN/quickStyleN carry the labels our layouts use, where PowerPoint
      ships the full vocabulary (49). A pres node whose styleLbl we never wrote
      renders with no fill — which is exactly why PRES_STYLE and the layout are
      derived from one table.
    · colours are literal srgbClr; PowerPoint's are schemeClr. Deliberate: a
      theme-accent diagram would render Office blue inside a branded deck.
`);
  return bad;
}

function reportMath(ours, refs) {
  console.log('OMML equations — the encodings in the wild\n');
  for (const r of refs) {
    const m = r.pkg.math;
    console.log(
      `  ${r.src.file.padEnd(30)} oMath ${String(m.oMath).padStart(3)}  a14:m ${String(m.a14m).padStart(3)}  ` +
        `AlternateContent ${m.altContent}  Fallback ${m.fallback}`,
    );
  }
  console.log(
    `  ${'ours (--smartart deck)'.padEnd(30)} oMath ${String(ours.math.oMath).padStart(3)}  ` +
      `a14:m ${String(ours.math.a14m).padStart(3)}  AlternateContent ${ours.math.altContent}  Fallback ${ours.math.fallback}`,
  );
  console.log(`
  Ours is zero on every column, by design and by release note: an equation is
  a picture today (competitor-gaps.md, gap #4). The two references are the two
  shapes gap #4 could take, and they are not equivalent:

    tdf129372.pptx        mc:AlternateContent → mc:Choice Requires="a14" → a14:m
                          → m:oMathPara/m:oMath, runs carrying Cambria Math,
                          with mc:Fallback holding a LOCKED picture shape
                          (a:blipFill + a:spLocks noEditPoints/noTextEdit/…).
                          PowerPoint writes both halves, every time.

    linear_perm_slides    a14:m dropped straight into <a:p>, no AlternateContent
                          and no fallback. Editable in PowerPoint, INVISIBLE in
                          renderers that do not implement OMML.

  The first is the target: it is the only one where "the fallback has to stay"
  is satisfied by the format itself rather than by a promise.
`);
}

/* -------------------------------------------------------------------- main */

if (process.argv.includes('--list')) {
  for (const s of SOURCES)
    console.log(`${s.kind.padEnd(9)} ${s.file.padEnd(34)} ${s.proves}\n${' '.repeat(10)}${s.url}`);
  process.exit(0);
}

console.log(`Corpus → ${CACHE}\n`);
await fetchCorpus();
if (process.argv.includes('--fetch')) process.exit(0);

const refs = [];
for (const src of SOURCES) {
  refs.push({ src, pkg: await readPackage(fs.readFileSync(path.join(CACHE, src.file))) });
}
const ours = await readPackage(await buildOurs());

const bad = reportSmartArt(
  ours,
  refs.filter((r) => r.src.kind === 'smartart'),
);
reportMath(
  ours,
  refs.filter((r) => r.src.kind === 'omml'),
);

if (bad) {
  console.error(`${bad} invariant(s) broken — our package is not shaped like PowerPoint's.`);
  process.exit(1);
}
console.log('Every invariant holds. The remaining questions are the visual ones,');
console.log('and those are still scripts/smartart-probe.mjs plus a human.');
