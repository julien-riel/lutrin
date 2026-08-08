/**
 * The five `ppt/diagrams/*` parts of a real OOXML SmartArt object.
 *
 * Pure string builders — no I/O, no zip, no engine imports beyond the
 * geometry it is handed. `pptx/smartart.mjs` writes what this returns.
 *
 * WHAT EACH PART IS FOR, because the split is not obvious and getting it
 * wrong is the usual way a diagram silently disappears:
 *
 *   dataN.xml       the MODEL — points and connections, plus a `type="pres"`
 *                   tree. Not a cache: strip the pres tree and PowerPoint
 *                   draws floating text with no shapes.
 *   layoutN.xml     the ALGORITHM — a program in the DrawingML constraint
 *                   language. PowerPoint RE-RUNS it on load, which is what
 *                   makes the object editable and what makes its output ours
 *                   only insofar as this file is right.
 *   colorsN.xml     the palette, as literal `srgbClr` (see below).
 *   quickStyleN.xml the shape style — the four `a:*Ref` a CT_ShapeStyle
 *                   requires, in order.
 *   drawingN.xml    the CACHE — our exact geometry, frozen. PowerPoint
 *                   ignores it and recomputes; LibreOffice, Apache POI and
 *                   Google Slides render it and never run an engine of their
 *                   own. Omitting it ships blank frames to those readers.
 *
 * WHY LITERAL COLOURS AND NOT `schemeClr`. The obvious design is to reference
 * the theme's accents so a diagram inherits the kit's brand for free. That
 * seam does not exist here: PptxGenJS writes a FIXED Office theme
 * (`accent1 4472C4, accent2 ED7D31, …` — `makeXmlTheme`), lutrin never
 * rewrites `ppt/theme/theme1.xml`, and no `schemeClr` is emitted anywhere in
 * this renderer. A theme-accent diagram would therefore render Office blue
 * and orange inside a Telus deck — on a product whose whole premise is brand
 * kits. So the colours come from the same `LAYER_SHADES` the geometry used,
 * written out, and one palette holds across PowerPoint, LibreOffice, POI, the
 * fallback picture and the HTML twin.
 *
 * The consequence to know: a reader who runs *Change Colors* in PowerPoint's
 * SmartArt gallery replaces the brand palette with an Office one and cannot
 * get it back except by rebuilding. That is the right trade — the file we
 * ship is on-brand in every renderer — but it is a real one.
 *
 * LICENSING. Every one of these parts is authored here, from the ECMA-376
 * vocabulary. Microsoft's own built-in layout definitions are not vendored:
 * this repository is MIT, MIT grants downstream sublicensing, and checking in
 * Microsoft-authored Office data files would make lutrin's outbound grant
 * misleading to everyone who depends on it. No THIRD-PARTY-NOTICES.md entry
 * is required for this change.
 */

import crypto from 'node:crypto';

const NS_DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Element text. Applied to EVERY `<a:t>` body: one node labelled `A & B`
 *  otherwise yields malformed XML and PowerPoint's repair dialog. */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Attribute value — the same, plus the quote forms. */
export const escAttr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * Per-family constants.
 *
 * `smartart` is a KILL SWITCH. A family whose layout definition PowerPoint
 * lays out badly can be turned off on its own line and falls back to native
 * shapes, with no warning, because the native drawing is correct — a cycle on
 * the stock `cycle` algorithm and a venn on overlapping discs are materially
 * different bets and there is no reason they succeed or fail together.
 */
export const FAMILIES = {
  cycle: {
    loTypeId: 'urn:lutrin.dev/2026/layout/cycle',
    loCatId: 'cycle',
    smartart: true,
  },
  hierarchy: {
    loTypeId: 'urn:lutrin.dev/2026/layout/hierarchy',
    loCatId: 'hierarchy',
    smartart: true,
  },
  venn: {
    loTypeId: 'urn:lutrin.dev/2026/layout/venn',
    loCatId: 'relationship',
    smartart: true,
  },
  radial: {
    loTypeId: 'urn:lutrin.dev/2026/layout/radial',
    loCatId: 'relationship',
    smartart: true,
  },
  'pyramid-diagram': {
    loTypeId: 'urn:lutrin.dev/2026/layout/pyramid-diagram',
    // the SmartArt CATEGORY vocabulary, which is Microsoft's and does have a
    // `pyramid` — unlike the layout name, which is ours and was already taken
    loCatId: 'pyramid',
    smartart: true,
  },
};

const QS_TYPE_ID = 'urn:lutrin.dev/2026/quickstyle/flat1';
const CS_TYPE_ID = 'urn:lutrin.dev/2026/colors/brand1';

/** px → EMU, the unit every `a:off`/`a:ext` in a drawing part uses. */
const emu = (px) => Math.round((px / 96) * 914400);

/**
 * Deterministic braced upper-case GUIDs.
 *
 * Derived from a hash of the diagram's index and the point's role, never from
 * randomness: two builds of the same deck must produce byte-identical parts,
 * which is what lets the .pptx be diffed and the injector be idempotent.
 */
function guid(index, role, ordinal = 0) {
  const h = crypto
    .createHash('sha1')
    .update(`lutrin:smartart:${index}:${role}:${ordinal}`)
    .digest('hex')
    .toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}}`;
}

const txEmpty = '<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></dgm:t>';
const txOf = (text) =>
  `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(text)}</a:t></a:r></a:p></dgm:t>`;

// ---------------------------------------------------------------------------
// The model: flatten a family's content into points, edges and a pres tree
// ---------------------------------------------------------------------------

/**
 * One shape of data for all four families: a list of nodes (with a parent
 * index, so a hierarchy is the same structure as a ring), plus the pres
 * entries that present them.
 *
 * `presStyleIdx`/`presStyleCnt` drive the colour cycle — `fillClrLst
 * meth="cycle"` indexes idx over cnt. Get them wrong and every node comes out
 * the same colour.
 */
function modelOf(family, block) {
  const nodes = [];
  const walk = (list, parent, depth) => {
    for (const n of list ?? []) {
      const i = nodes.length;
      nodes.push({ text: n.text, sub: n.sub ?? null, parent, depth });
      if (n.children?.length) walk(n.children, i, depth + 1);
    }
  };

  if (family === 'radial') {
    nodes.push({ text: block.hub ?? '', sub: null, parent: -1, depth: 0 });
    walk(block.nodes, 0, 1);
  } else if (family === 'hierarchy') {
    walk(block.nodes, -1, 0);
  } else {
    walk(block.nodes, -1, 0);
  }
  return nodes;
}

/** Does this family draw a connector between consecutive/parent-child nodes?
 *  A venn's discs and a pyramid's bands touch: there is nothing to draw
 *  between them, and a transition point PowerPoint cannot place is a shape it
 *  drops on the floor. */
const hasTransitions = (family) => family !== 'venn' && family !== 'pyramid-diagram';

/**
 * presName → styleLbl, per family — the ONE table.
 *
 * PowerPoint regenerates the presentation tree from `layoutN.xml` on load, so
 * a `presStyleLbl` written into `dataN.xml` survives only if the layout node
 * of the same name carries the same `styleLbl`. Deriving both sides from this
 * object is what keeps them from drifting: where they disagree, the layout
 * wins and every shape whose label was not shipped in `colorsN.xml` /
 * `quickStyleN.xml` renders with no fill, no line and no font — a diagram of
 * invisible shapes, with nothing in the file to say why.
 */
const PRES_STYLE = {
  cycle: { node: 'node1', sibTrans: 'sibTrans2D1' },
  hierarchy: { rootText: 'node0', rootTextSub: 'node1', rootConnector: 'parChTrans1D2' },
  venn: { vennNode: 'vennNode1' },
  radial: { hubNode: 'node0', spokeNode: 'node1', spokeConn: 'fgAcc1' },
  'pyramid-diagram': { pyraLevel: 'node1' },
};

/** The pres node a data point is presented by. */
function presNodeName(family, node, i) {
  if (family === 'hierarchy') return node.depth === 0 ? 'rootText' : 'rootTextSub';
  if (family === 'radial') return i === 0 ? 'hubNode' : 'spokeNode';
  if (family === 'venn') return 'vennNode';
  if (family === 'pyramid-diagram') return 'pyraLevel';
  return 'node';
}

/** The connector that introduces it, if the family draws one. A root has
 *  nothing above it, and a hub is not a spoke. */
function presTransName(family, node, i) {
  if (!hasTransitions(family)) return null;
  if (family === 'hierarchy') return node.parent === -1 ? null : 'rootConnector';
  if (family === 'radial') return i === 0 ? null : 'spokeConn';
  return 'sibTrans';
}

// ---------------------------------------------------------------------------
// dataN.xml
// ---------------------------------------------------------------------------

function buildData(family, block, index, drawingRelId) {
  const fam = FAMILIES[family];
  const nodes = modelOf(family, block);
  const n = nodes.length;
  const id = {
    doc: guid(index, 'doc'),
    node: (i) => guid(index, 'node', i),
    par: (i) => guid(index, 'parTrans', i),
    sib: (i) => guid(index, 'sibTrans', i),
    cxn: (i) => guid(index, 'cxn', i),
    presRoot: guid(index, 'presRoot'),
    presNode: (i) => guid(index, 'presNode', i),
    presTrans: (i) => guid(index, 'presTrans', i),
    presOf: (i) => guid(index, 'presOf', i),
    presPar: (i) => guid(index, 'presParOf', i),
  };

  // --- data points ---------------------------------------------------------
  const pts = [
    [
      `<dgm:pt modelId="${id.doc}" type="doc">`,
      `<dgm:prSet loTypeId="${escAttr(fam.loTypeId)}" loCatId="${escAttr(fam.loCatId)}" `,
      `qsTypeId="${QS_TYPE_ID}" qsCatId="simple" csTypeId="${CS_TYPE_ID}" csCatId="accent1"/>`,
      `<dgm:spPr/>${txEmpty}</dgm:pt>`,
    ].join(''),
  ];
  nodes.forEach((nd, i) => {
    pts.push(`<dgm:pt modelId="${id.node(i)}"><dgm:prSet/><dgm:spPr/>${txOf(nd.text)}</dgm:pt>`);
  });
  if (hasTransitions(family)) {
    nodes.forEach((_, i) => {
      pts.push(
        `<dgm:pt modelId="${id.par(i)}" type="parTrans" cxnId="${id.cxn(i)}"><dgm:prSet/><dgm:spPr/>${txEmpty}</dgm:pt>`,
        `<dgm:pt modelId="${id.sib(i)}" type="sibTrans" cxnId="${id.cxn(i)}"><dgm:prSet/><dgm:spPr/>${txEmpty}</dgm:pt>`,
      );
    });
  }

  // --- presentation tree ---------------------------------------------------
  //
  // `dgm:dir` and `dgm:resizeHandles` are children of
  // CT_LayoutVariablePropertySet, NOT of `dgm:prSet` — emitting them bare
  // under prSet is schema-invalid and is a repair prompt.
  const rootName = {
    cycle: 'cycle',
    hierarchy: 'hierRoot',
    venn: 'venn',
    radial: 'radial',
    // family name → presName: the two differ here alone, because the layout
    // name had to grow a suffix while the pres node it drives did not
    'pyramid-diagram': 'pyramid',
  }[family];
  pts.push(
    [
      `<dgm:pt modelId="${id.presRoot}" type="pres">`,
      `<dgm:prSet presAssocID="${id.doc}" presName="${rootName}" presStyleCnt="0">`,
      '<dgm:presLayoutVars><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:presLayoutVars>',
      '</dgm:prSet><dgm:spPr/></dgm:pt>',
    ].join(''),
  );

  const presChildren = []; // in DOCUMENT order — presParOf srcOrd follows it
  nodes.forEach((nd, i) => {
    const name = presNodeName(family, nd, i);
    pts.push(
      [
        `<dgm:pt modelId="${id.presNode(i)}" type="pres">`,
        `<dgm:prSet presAssocID="${id.node(i)}" presName="${name}" `,
        `presStyleLbl="${PRES_STYLE[family][name]}" presStyleIdx="${i}" presStyleCnt="${n}"/>`,
        '<dgm:spPr/></dgm:pt>',
      ].join(''),
    );
    presChildren.push(id.presNode(i));
    const trans = presTransName(family, nd, i);
    if (trans) {
      pts.push(
        [
          `<dgm:pt modelId="${id.presTrans(i)}" type="pres">`,
          `<dgm:prSet presAssocID="${id.sib(i)}" presName="${trans}" `,
          `presStyleLbl="${PRES_STYLE[family][trans]}" presStyleIdx="${i}" presStyleCnt="${n}"/>`,
          '<dgm:spPr/></dgm:pt>',
        ].join(''),
      );
      presChildren.push(id.presTrans(i));
    }
  });

  // --- connections ---------------------------------------------------------
  const cxns = [];
  nodes.forEach((nd, i) => {
    const src = nd.parent === -1 ? id.doc : id.node(nd.parent);
    const ord = nodes.filter((o, k) => k < i && o.parent === nd.parent).length;
    cxns.push(
      [
        `<dgm:cxn modelId="${id.cxn(i)}" srcId="${src}" destId="${id.node(i)}" `,
        `srcOrd="${ord}" destOrd="0"`,
        hasTransitions(family) ? ` parTransId="${id.par(i)}" sibTransId="${id.sib(i)}"` : '',
        '/>',
      ].join(''),
    );
  });

  let of = 0;
  const presId = escAttr(fam.loTypeId);
  cxns.push(
    [
      `<dgm:cxn modelId="${id.presOf(of++)}" type="presOf" srcId="${id.doc}" `,
      `destId="${id.presRoot}" srcOrd="0" destOrd="0" presId="${presId}"/>`,
    ].join(''),
  );
  nodes.forEach((nd, i) => {
    cxns.push(
      [
        `<dgm:cxn modelId="${id.presOf(of++)}" type="presOf" srcId="${id.node(i)}" `,
        `destId="${id.presNode(i)}" srcOrd="0" destOrd="0" presId="${presId}"/>`,
      ].join(''),
    );
    if (presTransName(family, nd, i)) {
      cxns.push(
        [
          `<dgm:cxn modelId="${id.presOf(of++)}" type="presOf" srcId="${id.sib(i)}" `,
          `destId="${id.presTrans(i)}" srcOrd="0" destOrd="0" presId="${presId}"/>`,
        ].join(''),
      );
    }
  });
  presChildren.forEach((destId, k) => {
    cxns.push(
      [
        `<dgm:cxn modelId="${id.presPar(k)}" type="presParOf" srcId="${id.presRoot}" `,
        `destId="${destId}" srcOrd="${k}" destOrd="0" presId="${presId}"/>`,
      ].join(''),
    );
  });

  // `relId` resolves against the SLIDE's relationship part, not a diagram
  // rels part — no `ppt/diagrams/_rels` exists in a PowerPoint-authored file,
  // and both Apache POI and LibreOffice look the drawing up there.
  const ext = [
    '<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">',
    `<dsp:dataModelExt xmlns:dsp="${NS_DSP}" relId="${escAttr(drawingRelId)}" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>`,
    '</a:ext></dgm:extLst>',
  ].join('');

  return [
    `${HEAD}<dgm:dataModel xmlns:dgm="${NS_DGM}" xmlns:a="${NS_A}">`,
    `<dgm:ptLst>${pts.join('')}</dgm:ptLst>`,
    `<dgm:cxnLst>${cxns.join('')}</dgm:cxnLst>`,
    '<dgm:bg/><dgm:whole/>',
    `${ext}</dgm:dataModel>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// layoutN.xml — authored, never vendored (see the header)
// ---------------------------------------------------------------------------

/** Sample data: what the *Change Layout* gallery previews and what supplies
 *  the starter shapes. Without it that gallery opens blank for our entry. */
function sampleModel(withTrans) {
  const pts = [
    '<dgm:pt modelId="0" type="doc"/>',
    '<dgm:pt modelId="1"><dgm:prSet phldr="1"/></dgm:pt>',
    '<dgm:pt modelId="2"><dgm:prSet phldr="1"/></dgm:pt>',
    '<dgm:pt modelId="3"><dgm:prSet phldr="1"/></dgm:pt>',
  ];
  const cxns = [];
  if (withTrans) {
    pts.push(
      '<dgm:pt modelId="4" type="sibTrans" cxnId="7"/>',
      '<dgm:pt modelId="5" type="sibTrans" cxnId="8"/>',
      '<dgm:pt modelId="6" type="sibTrans" cxnId="9"/>',
    );
  }
  for (let i = 0; i < 3; i++) {
    cxns.push(
      [
        `<dgm:cxn modelId="${7 + i}" srcId="0" destId="${1 + i}" srcOrd="${i}" destOrd="0"`,
        withTrans ? ` sibTransId="${4 + i}"` : '',
        '/>',
      ].join(''),
    );
  }
  return [
    '<dgm:dataModel>',
    `<dgm:ptLst>${pts.join('')}</dgm:ptLst>`,
    `<dgm:cxnLst>${cxns.join('')}</dgm:cxnLst>`,
    '<dgm:bg/><dgm:whole/></dgm:dataModel>',
  ].join('');
}

/** The text node every family reuses: a shape with its label centred. */
const textNode = (name, styleLbl, shape, extra = '') =>
  [
    `<dgm:layoutNode name="${name}" styleLbl="${styleLbl}">`,
    '<dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst>',
    '<dgm:alg type="tx"><dgm:param type="txAnchorVertCh" val="mid"/></dgm:alg>',
    `<dgm:shape type="${shape}"><dgm:adjLst/></dgm:shape>`,
    '<dgm:presOf axis="desOrSelf" ptType="node"/>',
    `<dgm:constrLst>${extra}`,
    '<dgm:constr type="lMarg" refType="primFontSz" fact="0.2"/>',
    '<dgm:constr type="rMarg" refType="primFontSz" fact="0.2"/>',
    '<dgm:constr type="tMarg" refType="primFontSz" fact="0.2"/>',
    '<dgm:constr type="bMarg" refType="primFontSz" fact="0.2"/>',
    '</dgm:constrLst>',
    '<dgm:ruleLst><dgm:rule type="primFontSz" val="8" fact="NaN" max="NaN"/></dgm:ruleLst>',
    '</dgm:layoutNode>',
  ].join('');

const LAYOUT_BODY = {
  // A ring of discs joined by connectors. `hideLastTrans="0"` is load-bearing:
  // at its default the arrow that CLOSES the ring disappears, and a cycle that
  // does not close is a `steps` layout drawn in a circle.
  cycle: () =>
    [
      '<dgm:layoutNode name="cycle">',
      '<dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>',
      '<dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/></dgm:alg>',
      '<dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst>',
      '<dgm:constr type="w" for="ch" ptType="node" refType="w" fact="0.32"/>',
      '<dgm:constr type="h" for="ch" ptType="node" refType="w" refFor="ch" refPtType="node"/>',
      '<dgm:constr type="w" for="ch" ptType="sibTrans" refType="w" refFor="ch" refPtType="node" fact="0.28"/>',
      '<dgm:constr type="sibSp" refType="w" refFor="ch" refPtType="node" fact="0.42"/>',
      '<dgm:constr type="primFontSz" for="ch" ptType="node" op="equ" val="16"/>',
      '</dgm:constrLst><dgm:ruleLst/>',
      '<dgm:forEach name="nodes" axis="ch" ptType="node">',
      textNode('node', 'node1', 'ellipse'),
      '<dgm:forEach name="siblings" axis="followSib" ptType="sibTrans" cnt="1" hideLastTrans="0">',
      '<dgm:layoutNode name="sibTrans" styleLbl="sibTrans2D1">',
      '<dgm:alg type="conn"><dgm:param type="begPts" val="auto"/><dgm:param type="endPts" val="auto"/><dgm:param type="endSty" val="filled"/></dgm:alg>',
      '<dgm:shape type="conn"><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/>',
      '<dgm:constrLst><dgm:constr type="h" refType="w" fact="1.2"/><dgm:constr type="connDist"/></dgm:constrLst>',
      '<dgm:ruleLst/></dgm:layoutNode></dgm:forEach>',
      '</dgm:forEach></dgm:layoutNode>',
    ].join(''),

  // The stock org-chart pair: `hierRoot` holds a node and its child band,
  // `hierChild` recurses. The connector is the elbow that says "reports to".
  hierarchy: () =>
    [
      '<dgm:layoutNode name="hierRoot">',
      '<dgm:varLst><dgm:resizeHandles val="exact"/></dgm:varLst>',
      '<dgm:alg type="hierRoot"><dgm:param type="hierAlign" val="tCtrCh"/></dgm:alg>',
      '<dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst>',
      '<dgm:constr type="primFontSz" for="des" ptType="node" op="equ" val="14"/>',
      '</dgm:constrLst><dgm:ruleLst/>',
      '<dgm:forEach name="roots" axis="ch" ptType="node">',
      '<dgm:layoutNode name="rootComposite">',
      '<dgm:alg type="composite"/><dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst>',
      '<dgm:constr type="w" for="ch" forName="rootText" refType="w"/>',
      '<dgm:constr type="h" for="ch" forName="rootText" refType="h"/>',
      '</dgm:constrLst><dgm:ruleLst/>',
      textNode('rootText', 'node0', 'roundRect'),
      '</dgm:layoutNode>',
      '<dgm:layoutNode name="hierChild">',
      '<dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg>',
      '<dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst/><dgm:ruleLst/>',
      '<dgm:forEach name="children" axis="ch" ptType="parTrans" cnt="1">',
      '<dgm:layoutNode name="rootConnector" styleLbl="parChTrans1D2">',
      '<dgm:alg type="conn"><dgm:param type="dim" val="1D"/><dgm:param type="endSty" val="noArr"/></dgm:alg>',
      '<dgm:shape type="conn"><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/>',
      '<dgm:constrLst><dgm:constr type="w" val="1"/></dgm:constrLst><dgm:ruleLst/>',
      '</dgm:layoutNode></dgm:forEach>',
      '<dgm:forEach name="recurse" axis="ch" ptType="node">',
      '<dgm:layoutNode name="hierRootSub">',
      '<dgm:alg type="hierRoot"/><dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst/><dgm:ruleLst/>',
      textNode('rootTextSub', 'node1', 'roundRect'),
      '</dgm:layoutNode></dgm:forEach>',
      '</dgm:layoutNode>',
      '</dgm:forEach></dgm:layoutNode>',
    ].join(''),

  // A Venn IS a cycle whose nodes are large enough to overlap — that is how
  // the stock "Basic Venn" is built, and it is why no special algorithm is
  // needed: `w fact 0.68` against a `sibSp` of zero puts the discs into each
  // other. No transitions exist, so nothing is drawn between them.
  venn: () =>
    [
      '<dgm:layoutNode name="venn">',
      '<dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>',
      '<dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/></dgm:alg>',
      '<dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst>',
      '<dgm:constr type="w" for="ch" ptType="node" refType="w" fact="0.68"/>',
      '<dgm:constr type="h" for="ch" ptType="node" refType="w" refFor="ch" refPtType="node"/>',
      '<dgm:constr type="sibSp" val="0"/>',
      '<dgm:constr type="primFontSz" for="ch" ptType="node" op="equ" val="14"/>',
      '</dgm:constrLst><dgm:ruleLst/>',
      '<dgm:forEach name="discs" axis="ch" ptType="node">',
      textNode('vennNode', 'vennNode1', 'ellipse'),
      '</dgm:forEach></dgm:layoutNode>',
    ].join(''),

  // A hub held in the centre by a composite, and a cycle of satellites around
  // it. The first child of the data is the hub — that is the convention the
  // layout generator writes and the one this reads back.
  radial: () =>
    [
      '<dgm:layoutNode name="radial">',
      '<dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>',
      '<dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/><dgm:param type="ctrShpMap" val="fNode"/></dgm:alg>',
      '<dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst>',
      '<dgm:constr type="w" for="ch" ptType="node" refType="w" fact="0.22"/>',
      '<dgm:constr type="h" for="ch" ptType="node" refType="w" refFor="ch" refPtType="node"/>',
      '<dgm:constr type="sibSp" refType="w" refFor="ch" refPtType="node" fact="0.15"/>',
      '<dgm:constr type="primFontSz" for="ch" ptType="node" op="equ" val="14"/>',
      '</dgm:constrLst><dgm:ruleLst/>',
      '<dgm:forEach name="hub" axis="ch" ptType="node" st="1" cnt="1">',
      textNode('hubNode', 'node0', 'ellipse'),
      '</dgm:forEach>',
      '<dgm:forEach name="spokes" axis="ch" ptType="node" st="2">',
      textNode('spokeNode', 'node1', 'ellipse'),
      '<dgm:forEach name="spokeLinks" axis="followSib" ptType="sibTrans" cnt="1">',
      '<dgm:layoutNode name="spokeConn" styleLbl="fgAcc1">',
      '<dgm:alg type="conn"><dgm:param type="dim" val="1D"/><dgm:param type="endSty" val="noArr"/></dgm:alg>',
      '<dgm:shape type="conn"><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/>',
      '<dgm:constrLst><dgm:constr type="w" val="1"/><dgm:constr type="connDist"/></dgm:constrLst>',
      '<dgm:ruleLst/></dgm:layoutNode></dgm:forEach>',
      '</dgm:forEach></dgm:layoutNode>',
    ].join(''),

  // The stock `pyra` algorithm, which knows how to stack trapezoids into one
  // triangle — the thing the preset `trapezoid` alone cannot do, since its
  // slope comes from the BAND's height rather than the figure's.
  //
  // `linDir fromT` is not the Office default and is deliberate: Basic Pyramid
  // fills from the bottom, so the first item typed lands at the base. Every
  // other layout in this DSL reads in document order down the slide, and a
  // diagram that silently reversed its sections would be the one place it did
  // not. The drawing cache and the SVG twin put the first node at the apex;
  // this makes PowerPoint's own engine agree.
  'pyramid-diagram': () =>
    [
      '<dgm:layoutNode name="pyramid">',
      '<dgm:varLst><dgm:dir/><dgm:animLvl val="lvl"/><dgm:resizeHandles val="exact"/></dgm:varLst>',
      '<dgm:alg type="pyra">',
      '<dgm:param type="linDir" val="fromT"/>',
      '<dgm:param type="txDir" val="fromT"/>',
      '<dgm:param type="pyraLvlNode" val="pyraLevel"/>',
      '</dgm:alg>',
      '<dgm:shape><dgm:adjLst/></dgm:shape><dgm:presOf/>',
      '<dgm:constrLst>',
      '<dgm:constr type="primFontSz" for="des" ptType="node" op="equ" val="14"/>',
      '</dgm:constrLst><dgm:ruleLst/>',
      '<dgm:forEach name="levels" axis="ch" ptType="node">',
      textNode('pyraLevel', 'node1', 'trapezoid'),
      '</dgm:forEach></dgm:layoutNode>',
    ].join(''),
};

const LAYOUT_TITLE = {
  cycle: ['Lutrin cycle', 'Stages on a closed loop, joined by arrows.'],
  hierarchy: ['Lutrin hierarchy', 'A tree of boxes joined by elbows.'],
  venn: ['Lutrin venn', 'Overlapping discs; the intersection is the argument.'],
  radial: ['Lutrin radial', 'A hub surrounded by what depends on it.'],
  'pyramid-diagram': ['Lutrin pyramid', 'Levels stacked into a triangle, the apex first.'],
};

function buildLayout(family) {
  const fam = FAMILIES[family];
  const [title, desc] = LAYOUT_TITLE[family];
  const sample = sampleModel(hasTransitions(family));
  return [
    `${HEAD}<dgm:layoutDef xmlns:dgm="${NS_DGM}" xmlns:a="${NS_A}" uniqueId="${escAttr(fam.loTypeId)}">`,
    `<dgm:title val="${escAttr(title)}"/><dgm:desc val="${escAttr(desc)}"/>`,
    `<dgm:catLst><dgm:cat type="${escAttr(fam.loCatId)}" pri="1000"/></dgm:catLst>`,
    `<dgm:sampData>${sample}</dgm:sampData>`,
    `<dgm:styleData>${sample}</dgm:styleData>`,
    `<dgm:clrData>${sample}</dgm:clrData>`,
    LAYOUT_BODY[family](),
    '</dgm:layoutDef>',
  ].join('');
}

// ---------------------------------------------------------------------------
// colorsN.xml and quickStyleN.xml
// ---------------------------------------------------------------------------

/**
 * THE FULL STYLE-LABEL VOCABULARY, in the order PowerPoint writes it, with the
 * role each label plays in our palette.
 *
 * We used to declare only the two to four labels our own layouts name. That is
 * enough right up to the moment it is not, and the failure is the expensive
 * one described at the top of this file: PowerPoint REGENERATES the pres tree
 * from `layoutN.xml` on load, a regenerated `presStyleLbl` we never declared
 * finds nothing in `colorsN.xml`, and the shape renders with no fill, no line
 * and no font — invisible, with nothing in the file to say why. Declaring the
 * whole vocabulary costs 49 elements per part and removes the failure mode.
 *
 * The roles, and why they are not one:
 *   lead   the shape a family singles out — a root, a hub, an apex. First
 *          shade alone.
 *   node   everything else that holds content. The shade cycle.
 *   line   connectors, callouts and accents: the link colour.
 *   revTx  text drawn OVER a filled shape rather than inside one. Its "fill"
 *          is the ink, and its text colour the shade — inverted on purpose.
 *
 * `IS_*` guesswork from the name is what this table replaces:
 * `fgAccFollowNode1` matches /Acc/ and is a node, not a connector.
 */
const STYLE_VOCABULARY = {
  node0: 'lead',
  alignNode1: 'node',
  node1: 'node',
  lnNode1: 'node',
  vennNode1: 'node',
  node2: 'node',
  node3: 'node',
  node4: 'node',
  fgImgPlace1: 'node',
  alignImgPlace1: 'node',
  bgImgPlace1: 'node',
  sibTrans2D1: 'line',
  fgSibTrans2D1: 'line',
  bgSibTrans2D1: 'line',
  sibTrans1D1: 'line',
  callout: 'line',
  asst0: 'lead',
  asst1: 'node',
  asst2: 'node',
  asst3: 'node',
  asst4: 'node',
  parChTrans2D1: 'line',
  parChTrans2D2: 'line',
  parChTrans2D3: 'line',
  parChTrans2D4: 'line',
  parChTrans1D1: 'line',
  parChTrans1D2: 'line',
  parChTrans1D3: 'line',
  parChTrans1D4: 'line',
  fgAcc1: 'line',
  conFgAcc1: 'line',
  alignAcc1: 'line',
  trAlignAcc1: 'line',
  bgAcc1: 'line',
  solidFgAcc1: 'line',
  solidAlignAcc1: 'line',
  solidBgAcc1: 'line',
  fgAccFollowNode1: 'node',
  alignAccFollowNode1: 'node',
  bgAccFollowNode1: 'node',
  fgAcc0: 'lead',
  fgAcc2: 'line',
  fgAcc3: 'line',
  fgAcc4: 'line',
  bgShp: 'node',
  dkBgShp: 'lead',
  trBgShp: 'node',
  fgShp: 'node',
  revTx: 'revTx',
};

/** Every style label the two parts declare. One list for every family: a label
 *  is either in the vocabulary or it does not exist, and a family that grows a
 *  new pres node tomorrow is already covered. */
const STYLE_LABELS = Object.keys(STYLE_VOCABULARY);

/**
 * The invariant PRES_STYLE exists to protect, asserted where it can still be
 * acted on: a label the layout names but the vocabulary does not declare would
 * ship a diagram of invisible shapes. Thrown at module load rather than
 * checked in a test alone — this one is not worth discovering in a deck.
 */
for (const [family, map] of Object.entries(PRES_STYLE))
  for (const lbl of Object.values(map))
    if (!STYLE_VOCABULARY[lbl])
      throw new Error(`SmartArt ${family}: styleLbl "${lbl}" is not in the style vocabulary`);

const clrLst = (tag, colors, meth) =>
  `<dgm:${tag} meth="${meth}">${colors.map((c) => `<a:srgbClr val="${c}"/>`).join('')}</dgm:${tag}>`;

function styleLbl(name, fills, inks) {
  const meth = fills.length > 1 ? 'cycle' : 'repeat';
  return [
    `<dgm:styleLbl name="${name}">`,
    clrLst('fillClrLst', fills, meth),
    clrLst('linClrLst', fills, meth),
    '<dgm:effectClrLst/><dgm:txLinClrLst/>',
    clrLst('txFillClrLst', inks, meth),
    '<dgm:txEffectClrLst/></dgm:styleLbl>',
  ].join('');
}

function buildColors(family, geometry) {
  const nodeShapes = geometry.shapes;
  const fills = nodeShapes.map((s) => s.fill);
  const inks = nodeShapes.map((s) => s.ink);
  const linkColor = geometry.links[0]?.color ?? fills[0] ?? '888888';
  // `lead` takes the first shade alone, so the rest cycle over what is left —
  // but only where there IS something left: a two-node diagram would otherwise
  // hand `node` an empty list and every shape would come out unpainted.
  const rest = fills.slice(1).length ? fills.slice(1) : fills;
  const restInk = inks.slice(1).length ? inks.slice(1) : inks;
  const hasLead = Object.values(PRES_STYLE[family]).includes('node0');
  const lbls = STYLE_LABELS.map((name) => {
    switch (STYLE_VOCABULARY[name]) {
      case 'line':
        return styleLbl(name, [linkColor], [inks[0] ?? '000000']);
      case 'lead':
        return styleLbl(name, [fills[0]], [inks[0]]);
      case 'revTx':
        // text over a filled shape: the ink is the surface and the shade is
        // the letterform, which is what "reversed" means
        return styleLbl(name, [inks[0]], [fills[0]]);
      default:
        // a family with no singled-out shape has no reason to skip a shade
        return hasLead ? styleLbl(name, rest, restInk) : styleLbl(name, fills, inks);
    }
  }).join('');
  return [
    `${HEAD}<dgm:colorsDef xmlns:dgm="${NS_DGM}" xmlns:a="${NS_A}" uniqueId="${CS_TYPE_ID}">`,
    '<dgm:title val="Lutrin brand"/><dgm:desc val=""/>',
    '<dgm:catLst><dgm:cat type="accent1" pri="11000"/></dgm:catLst>',
    `${lbls}</dgm:colorsDef>`,
  ].join('');
}

/**
 * `dgm:style` is `a:CT_ShapeStyle`, which REQUIRES all four of `a:lnRef`,
 * `a:fillRef`, `a:effectRef`, `a:fontRef`, in that order. A partial one is
 * schema-invalid — a repair prompt. And `fillRef idx="0"` means *no theme
 * fill*, in which case `colorsN.xml` never reaches the shape at all.
 */
const SHAPE_STYLE = [
  '<dgm:style>',
  '<a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef>',
  '<a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>',
  '<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef>',
  '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>',
  '</dgm:style>',
].join('');

const SCENE =
  '<dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d>';

function buildQuickStyle() {
  const lbls = STYLE_LABELS.map(
    (name) =>
      `<dgm:styleLbl name="${name}">${SCENE}<dgm:sp3d/><dgm:txPr/>${SHAPE_STYLE}</dgm:styleLbl>`,
  ).join('');
  return [
    `${HEAD}<dgm:styleDef xmlns:dgm="${NS_DGM}" xmlns:a="${NS_A}" uniqueId="${QS_TYPE_ID}">`,
    '<dgm:title val="Lutrin flat"/><dgm:desc val=""/>',
    '<dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst>',
    `${SCENE}${lbls}</dgm:styleDef>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// drawingN.xml — the cache every non-PowerPoint reader displays
// ---------------------------------------------------------------------------

function dspSp(modelId, sh, label) {
  const alpha = sh.alpha < 1 ? `<a:alpha val="${Math.round(sh.alpha * 100000)}"/>` : '';
  const fill = `<a:solidFill><a:srgbClr val="${sh.fill}">${alpha}</a:srgbClr></a:solidFill>`;
  // A shape carrying its own point list states its outline rather than naming
  // a preset: the pyramid's bands are the bands of ONE triangle, and no preset
  // adjustment expresses that (see `pyramidGeometry`). The path is written at
  // the shape's own size, so `a:path w/h` is the extent and the points are the
  // same box-relative numbers the SVG twin and the native shapes draw.
  const geom = sh.points
    ? [
        '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>',
        '<a:rect l="l" t="t" r="r" b="b"/><a:pathLst>',
        `<a:path w="${emu(sh.w)}" h="${emu(sh.h)}">`,
        sh.points
          .map(
            ([x, y], k) =>
              `<a:${k ? 'lnTo' : 'moveTo'}><a:pt x="${emu(x)}" y="${emu(y)}"/></a:${k ? 'lnTo' : 'moveTo'}>`,
          )
          .join(''),
        '<a:close/></a:path></a:pathLst></a:custGeom>',
      ].join('')
    : sh.prst === 'ellipse'
      ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
      : sh.prst === 'roundRect'
        ? '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'
        : sh.prst === 'rightArrow'
          ? '<a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom>'
          : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const rot = sh.rotate ? ` rot="${Math.round(sh.rotate * 60000)}"` : '';
  // The text body is FULLY formatted on purpose. An unformatted cache draws
  // top-left black 18 pt labels where the twin draws centred branded text,
  // which defeats the only reason this part is shipped.
  const body = label
    ? [
        '<dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" ',
        'lIns="45720" tIns="45720" rIns="45720" bIns="45720" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr>',
        '<a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r>',
        `<a:rPr lang="en-US" sz="${Math.round(label.pt * 100)}" b="1" kern="1200">`,
        `<a:solidFill><a:srgbClr val="${label.ink}"/></a:solidFill></a:rPr>`,
        `<a:t>${esc(label.text)}</a:t></a:r></a:p></dsp:txBody>`,
      ].join('')
    : '<dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></dsp:txBody>';
  const txXfrm = label
    ? [
        `<dsp:txXfrm><a:off x="${emu(label.x)}" y="${emu(label.y)}"/>`,
        `<a:ext cx="${emu(label.w)}" cy="${emu(label.h)}"/></dsp:txXfrm>`,
      ].join('')
    : '';
  return [
    `<dsp:sp modelId="${modelId}">`,
    '<dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>',
    '<dsp:spPr>',
    `<a:xfrm${rot}><a:off x="${emu(sh.x)}" y="${emu(sh.y)}"/><a:ext cx="${emu(sh.w)}" cy="${emu(sh.h)}"/></a:xfrm>`,
    `${geom}${fill}<a:ln><a:noFill/></a:ln><a:effectLst/>`,
    '</dsp:spPr>',
    `${body}${txXfrm}</dsp:sp>`,
  ].join('');
}

function buildDrawing(family, block, geometry, index) {
  const nodes = modelOf(family, block);
  const sps = [];
  // links first — a cache is drawn in document order, and the arrows belong
  // behind the discs exactly as they do in the native fallback
  geometry.links.forEach((l, k) => {
    sps.push(dspSp(guid(index, 'presTrans', k), { ...l, fill: l.color, alpha: 1 }, null));
  });
  geometry.shapes.forEach((s, k) => {
    const label = geometry.labels.find((l) => l.of === k) ?? null;
    sps.push(dspSp(guid(index, 'presNode', Math.min(k, nodes.length - 1)), s, label));
  });
  return [
    `${HEAD}<dsp:drawing xmlns:dsp="${NS_DSP}" xmlns:a="${NS_A}">`,
    '<dsp:spTree>',
    '<dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr>',
    '<dsp:grpSpPr/>',
    `${sps.join('')}</dsp:spTree></dsp:drawing>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * The five parts of one diagram.
 *
 * @param {object} arg
 * @param {string} arg.family   one of FAMILIES
 * @param {object} arg.block    the `smartart` block
 * @param {object} arg.geometry `smartArtGeometry(block, w, h)` — region-local
 * @param {number} arg.index    package-wide part number (dataK.xml, …)
 * @param {string} arg.drawingRelId rId of the drawing part on the SLIDE's rels
 * @returns {{data:string, layout:string, colors:string, quickStyle:string, drawing:string}}
 */
export function buildDiagramParts({ family, block, geometry, index, drawingRelId }) {
  if (!FAMILIES[family]) throw new Error(`unknown SmartArt family "${family}"`);
  if (!geometry?.shapes?.length) throw new Error(`diagram ${index}: no geometry to serialise`);
  if (!drawingRelId) throw new Error(`diagram ${index}: no relationship id for the drawing part`);
  return {
    data: buildData(family, block, index, drawingRelId),
    layout: buildLayout(family),
    colors: buildColors(family, geometry),
    quickStyle: buildQuickStyle(),
    drawing: buildDrawing(family, block, geometry, index),
  };
}
