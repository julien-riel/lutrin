/**
 * Diagram geometry: a `smartart` block → pure numbers, and the SVG twin.
 *
 * This module is the SINGLE source of coordinates for the five diagram
 * layouts (`cycle`, `hierarchy`, `venn`, `radial`, `apex`). Three
 * consumers read it and none of them computes geometry of its own:
 *
 *   - the HTML renderer inlines `smartArtSvg()` at the region's exact size;
 *   - the .pptx renderer draws `smartArtGeometry()` as native editable shapes;
 *   - the OOXML SmartArt injector serialises the same geometry into
 *     `ppt/diagrams/drawingN.xml`, the cache every non-PowerPoint reader
 *     displays.
 *
 * Those three agree because they read one function, not because three
 * implementations were kept in step.
 *
 * ROTATION CONVENTION — honoured on both sides, and the one thing a reader
 * has to know before touching this file. A rotated element is described by
 * its UNROTATED box `{x, y, w, h}` plus `rotate`, in degrees CLOCKWISE about
 * the box centre. Those are exactly PptxGenJS's `rotate:` semantics, so the
 * .pptx passes the number through untouched; the SVG twin writes
 * `transform="rotate(deg cx cy)"`, which is the same sign about the same
 * centre. Nothing here is described by its rotated corners.
 *
 * Coordinates are REGION-LOCAL: the origin is the region's top-left, and the
 * callers translate. A `viewBox` of exactly `0 0 w h` is what makes the SVG
 * comparable with the shape list.
 *
 * Colour discipline, as everywhere else in the engine: tokens are read at
 * CALL time through the lazy accessors below, never copied into module
 * constants — a kit repainting the palette after this module loaded must be
 * reflected in the diagram of the same process (the `chart.mjs` rule).
 */

import {
  COLORS,
  FONTS,
  LAYER_SHADES,
  TYPE,
  SPACE,
  composite,
  solidInk,
  textWidth,
} from './tokens.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FONT = () => `${FONTS.body}, Helvetica, Arial, sans-serif`;
const ink = () => COLORS.neutralPrimary;
const line = () => COLORS.neutralStroke;

/** Shade `i`, CLAMPED to the last one the kit provides — a kit may ship
 *  fewer shades than a diagram has nodes, and a monotonic gradient beats an
 *  `.ink` of undefined (the rule `layers` already follows). */
function shade(i) {
  const last = LAYER_SHADES.length - 1;
  return (
    LAYER_SHADES[Math.min(Math.max(i, 0), Math.max(last, 0))] ?? {
      fill: COLORS.primary,
      ink: COLORS.ground,
    }
  );
}

const round = (v) => Math.round(v * 100) / 100;
const rad = (deg) => (deg * Math.PI) / 180;

/** Bearing of the vector a→b, in degrees clockwise from "pointing right" —
 *  the convention `rotate` uses. */
const bearing = (ax, ay, bx, by) => (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;

/**
 * The largest centred square inside `w × h`. Every family lays out inside it:
 * a cycle in a 16:9 region would otherwise be an oval, and an oval of nodes
 * reads as a mistake rather than as a ring.
 */
function square(w, h) {
  const s = Math.min(w, h);
  return { x: (w - s) / 2, y: (h - s) / 2, s };
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/**
 * Nodes evenly spaced on a ring, joined by arrows, starting at the top and
 * running clockwise — the reading order of a process that closes on itself.
 *
 * The node diameter shrinks with the count so that eight nodes do not touch:
 * the exponent is gentle on purpose (a ring of three should not be made of
 * three huge discs either).
 */
function cycleGeometry(nodes, w, h) {
  const { x: ox, y: oy, s } = square(w, h);
  const n = nodes.length;
  const nodeD = s * 0.32 * (6 / Math.max(n, 6)) ** 0.35;
  const nodeR = nodeD / 2;
  const R = s / 2 - nodeR;
  const cx = ox + s / 2;
  const cy = oy + s / 2;

  const centres = nodes.map((_, i) => {
    const a = rad(-90 + (360 * i) / n);
    return { cx: cx + R * Math.cos(a), cy: cy + R * Math.sin(a) };
  });

  const shapes = centres.map((c, i) => ({
    role: 'node',
    i,
    x: round(c.cx - nodeR),
    y: round(c.cy - nodeR),
    w: round(nodeD),
    h: round(nodeD),
    prst: 'ellipse',
    fill: shade(i).fill,
    ink: shade(i).ink,
    line: null,
    alpha: 1,
  }));

  // one arrow per edge, including the closing one: a cycle that does not
  // close is a `steps` layout drawn in a circle
  const links = centres.map((c, i) => {
    const d = centres[(i + 1) % n];
    const full = Math.hypot(d.cx - c.cx, d.cy - c.cy);
    const gap = nodeR + SPACE.xs;
    const len = Math.max(full - 2 * gap, 8);
    const t0 = gap / full;
    const t1 = 1 - gap / full;
    const mx = c.cx + ((d.cx - c.cx) * (t0 + t1)) / 2;
    const my = c.cy + ((d.cy - c.cy) * (t0 + t1)) / 2;
    const thick = Math.max(10, nodeD * 0.22);
    return {
      role: 'arrow',
      from: i,
      to: (i + 1) % n,
      x: round(mx - len / 2),
      y: round(my - thick / 2),
      w: round(len),
      h: round(thick),
      rotate: round(bearing(c.cx, c.cy, d.cx, d.cy)),
      prst: 'rightArrow',
      color: line(),
    };
  });

  const pt = Math.max(9, Math.min(TYPE.body, Math.round(nodeD / 5)));
  const labels = shapes.map((sh, i) => ({
    of: i,
    x: sh.x + 6,
    y: sh.y + 6,
    w: round(sh.w - 12),
    h: round(sh.h - 12),
    text: nodes[i].text,
    sub: nodes[i].sub ?? null,
    pt,
    ink: sh.ink,
    align: 'center',
    valign: 'middle',
  }));

  return { family: 'cycle', shapes, links, labels };
}

/**
 * A tidy tree, laid out by sub-width: every node owns a horizontal band
 * proportional to the number of leaves beneath it, and sits centred over it.
 * Connectors are orthogonal 2 px rectangles — down out of the parent, across,
 * down into the child — so NOTHING in this family is rotated. That is a
 * deliberate simplification: an org chart drawn with diagonal edges reads as
 * a network, and the elbow is what says "reports to".
 */
function hierarchyGeometry(roots, w, h) {
  const depthOf = (list, depth) => {
    let max = depth;
    for (const node of list) {
      if (node.children?.length) max = Math.max(max, depthOf(node.children, depth + 1));
    }
    return max;
  };
  const depth = depthOf(roots, 0);

  const leaves = (node) =>
    node.children?.length ? node.children.reduce((sum, c) => sum + leaves(c), 0) : 1;

  const levelH = h / (depth + 1);
  const boxH = Math.min(levelH * 0.52, 64);
  const shapes = [];
  const links = [];
  const labels = [];
  const index = new Map();

  const place = (list, x0, width, d) => {
    const total = list.reduce((sum, node) => sum + leaves(node), 0) || 1;
    let cursor = x0;
    for (const node of list) {
      const share = (leaves(node) / total) * width;
      const boxW = Math.min(share - SPACE.xs, 220);
      const cx = cursor + share / 2;
      const i = shapes.length;
      const sh = {
        role: 'node',
        i,
        x: round(cx - boxW / 2),
        y: round(d * levelH + (levelH - boxH) / 2),
        w: round(Math.max(boxW, 48)),
        h: round(boxH),
        prst: 'roundRect',
        fill: shade(d).fill,
        ink: shade(d).ink,
        line: null,
        radius: 8,
        alpha: 1,
      };
      shapes.push(sh);
      index.set(node, i);
      labels.push({
        of: i,
        x: sh.x + 6,
        y: sh.y + 4,
        w: round(sh.w - 12),
        h: round(sh.h - 8),
        text: node.text,
        sub: null,
        pt: Math.max(9, Math.min(TYPE.body, Math.round(boxH / 3))),
        ink: sh.ink,
        align: 'center',
        valign: 'middle',
      });
      if (node.children?.length) place(node.children, cursor, share, d + 1);
      cursor += share;
    }
  };
  place(roots, 0, w, 0);

  // elbows, walked after placement so both endpoints are known
  const connect = (list) => {
    for (const node of list) {
      if (!node.children?.length) continue;
      const p = shapes[index.get(node)];
      const py = p.y + p.h;
      const midY = round(py + (levelH - boxH) / 2 + boxH / 4);
      for (const child of node.children) {
        const c = shapes[index.get(child)];
        links.push({
          role: 'edge',
          from: index.get(node),
          to: index.get(child),
          x: round(p.x + p.w / 2 - 1),
          y: round(py),
          w: 2,
          h: round(midY - py),
          rotate: 0,
          prst: 'rect',
          color: line(),
        });
        const x0 = Math.min(p.x + p.w / 2, c.x + c.w / 2) - 1;
        const x1 = Math.max(p.x + p.w / 2, c.x + c.w / 2) + 1;
        links.push({
          role: 'edge',
          from: index.get(node),
          to: index.get(child),
          x: round(x0),
          y: midY,
          w: round(x1 - x0),
          h: 2,
          rotate: 0,
          prst: 'rect',
          color: line(),
        });
        links.push({
          role: 'edge',
          from: index.get(node),
          to: index.get(child),
          x: round(c.x + c.w / 2 - 1),
          y: midY,
          w: 2,
          h: round(c.y - midY),
          rotate: 0,
          prst: 'rect',
          color: line(),
        });
      }
      connect(node.children);
    }
  };
  connect(roots);

  return { family: 'hierarchy', shapes, links, labels };
}

/**
 * Overlapping translucent discs. The discs carry NO outline in either
 * renderer, and that is a parity decision rather than a taste one:
 * PptxGenJS's `transparency` applies to the fill only — there is no line
 * transparency in its API — so an outline would come out opaque in the .pptx
 * and translucent in the SVG, on a shape whose whole point is that the
 * overlap shows through.
 *
 * Labels sit at each disc's OUTWARD centroid, never over an intersection: the
 * intersection is the argument the slide is making, and covering it with a
 * word would be covering the point.
 */
function vennGeometry(nodes, w, h, overlap) {
  const { x: ox, y: oy, s } = square(w, h);
  const n = nodes.length;
  const cx = ox + s / 2;
  const cy = oy + s / 2;

  // `overlap` is the share of a disc's DIAMETER that its neighbour covers, so
  // adjacent centres sit `d · (1 − overlap)` apart. The diameter then falls
  // out of the requirement that the whole figure fit the square — solving for
  // it here rather than scaling afterwards is what keeps three discs and eight
  // the same distance from the edge.
  const gap = 1 - overlap;
  const spread = n === 1 ? 0 : n === 2 ? gap / 2 : gap / (2 * Math.sin(Math.PI / n));
  const d = (0.98 * s) / (2 * (spread + 0.5));
  const r = d / 2;
  const R = d * spread;

  const centres = nodes.map((_, i) => {
    if (n === 1) return { cx, cy };
    if (n === 2) return { cx: cx + (i === 0 ? -R : R), cy };
    const a = rad(-90 + (360 * i) / n);
    return { cx: cx + R * Math.cos(a), cy: cy + R * Math.sin(a) };
  });

  const alpha = 0.22;
  const shapes = centres.map((c, i) => ({
    role: 'disc',
    i,
    x: round(c.cx - r),
    y: round(c.cy - r),
    w: round(d),
    h: round(d),
    prst: 'ellipse',
    fill: shade(i).fill,
    // the ink is measured against the surface the reader actually sees: the
    // disc composited onto the deck's ground at 22 %, not the opaque shade
    ink: solidInk(composite(shade(i).fill, COLORS.ground, alpha), ink()),
    line: null,
    alpha,
  }));

  const pt = Math.max(9, Math.min(TYPE.body, Math.round(d / 9)));
  const labels = shapes.map((sh, i) => {
    const c = centres[i];
    // push the label away from the centre of the figure, into the crescent
    // that belongs to this disc alone
    const outX = n === 1 ? 0 : c.cx - cx;
    const outY = n === 1 ? 0 : c.cy - cy;
    const norm = Math.hypot(outX, outY) || 1;
    const off = r * 0.46;
    const lx = c.cx + (outX / norm) * off;
    const ly = c.cy + (outY / norm) * off;
    const lw = d * 0.62;
    const lh = Math.max(pt * 2.4, 28);
    return {
      of: i,
      x: round(lx - lw / 2),
      y: round(ly - lh / 2),
      w: round(lw),
      h: round(lh),
      text: nodes[i].text,
      sub: null,
      pt,
      ink: sh.ink,
      align: 'center',
      valign: 'middle',
    };
  });

  return { family: 'venn', shapes, links: [], labels };
}

/**
 * A hub with satellites on a ring, joined by thin spokes. The hub is the
 * platform, the service, the team; the satellites are what depend on it.
 * Spokes run hub edge → satellite edge, so no line disappears under a disc.
 */
function radialGeometry(hub, nodes, w, h) {
  const { x: ox, y: oy, s } = square(w, h);
  const n = nodes.length;
  const hubD = s * 0.3;
  const satD = s * 0.22 * (6 / Math.max(n, 6)) ** 0.3;
  const R = s / 2 - satD / 2;
  const cx = ox + s / 2;
  const cy = oy + s / 2;

  const shapes = [
    {
      role: 'hub',
      i: 0,
      x: round(cx - hubD / 2),
      y: round(cy - hubD / 2),
      w: round(hubD),
      h: round(hubD),
      prst: 'ellipse',
      fill: shade(0).fill,
      ink: shade(0).ink,
      line: null,
      alpha: 1,
    },
  ];

  const centres = nodes.map((_, i) => {
    const a = rad(-90 + (360 * i) / n);
    return { cx: cx + R * Math.cos(a), cy: cy + R * Math.sin(a), a };
  });

  centres.forEach((c, i) => {
    shapes.push({
      role: 'node',
      i: i + 1,
      x: round(c.cx - satD / 2),
      y: round(c.cy - satD / 2),
      w: round(satD),
      h: round(satD),
      prst: 'ellipse',
      fill: shade(i + 1).fill,
      ink: shade(i + 1).ink,
      line: null,
      alpha: 1,
    });
  });

  const links = centres.map((c, i) => {
    const full = Math.hypot(c.cx - cx, c.cy - cy);
    const start = hubD / 2;
    const end = full - satD / 2;
    const len = Math.max(end - start, 4);
    const t = (start + end) / 2 / full;
    const mx = cx + (c.cx - cx) * t;
    const my = cy + (c.cy - cy) * t;
    return {
      role: 'spoke',
      from: 0,
      to: i + 1,
      x: round(mx - len / 2),
      y: round(my - 1),
      w: round(len),
      h: 2,
      rotate: round(bearing(cx, cy, c.cx, c.cy)),
      prst: 'rect',
      color: line(),
    };
  });

  const hubPt = Math.max(10, Math.min(TYPE.lead, Math.round(hubD / 5)));
  const satPt = Math.max(9, Math.min(TYPE.body, Math.round(satD / 5)));
  const labels = shapes.map((sh, k) => ({
    of: k,
    x: sh.x + 6,
    y: sh.y + 6,
    w: round(sh.w - 12),
    h: round(sh.h - 12),
    text: k === 0 ? hub : nodes[k - 1].text,
    sub: null,
    pt: k === 0 ? hubPt : satPt,
    ink: sh.ink,
    align: 'center',
    valign: 'middle',
  }));

  return { family: 'radial', shapes, links, labels };
}

/**
 * Stacked bands of a triangle, apex first — a hierarchy of magnitude rather
 * than of reporting: proportions, priorities, a Maslow.
 *
 * WHY THE BANDS ARE CUSTOM GEOMETRY AND NOT THE `trapezoid` PRESET. The preset
 * takes its slope from its own adjustment, which defaults to insetting the top
 * edge by `min(w,h)·0.125` per side. Stack those and the silhouette that comes
 * out is a spire — a base a quarter as wide as the figure is tall — because
 * the band's height, not the pyramid's, is what sets the slope. A pyramid
 * whose sides are the sides of ONE triangle has to state its own points, and
 * `points` is honoured by all three consumers (SVG path, `custGeom` in the
 * .pptx, `a:custGeom` in the drawing cache) from this one list.
 *
 * Reading order is TOP-DOWN: the first `##` is the apex. Office's own Basic
 * Pyramid fills from the bottom; ours does not, because everything else in this
 * DSL reads in document order down the slide and a diagram that silently
 * reversed its sections would be the one place it did not.
 */
function pyramidGeometry(nodes, w, h) {
  const { x: ox, y: oy, s } = square(w, h);
  const n = nodes.length;
  const cx = ox + s / 2;
  const band = s / n;
  // A band is separated from the next by a hairline so the levels read as
  // levels. The widths are still measured on the UNBROKEN triangle, so the two
  // sloping sides stay straight across the gaps.
  const gap = Math.min(SPACE.xs / 2, band * 0.12);
  const halfAt = (y) => (y - oy) / 2; // base = height: apex at the top, full width at the bottom

  const shapes = nodes.map((_, i) => {
    const yTop = oy + i * band;
    const yBot = oy + (i + 1) * band - gap;
    const topHalf = halfAt(yTop);
    const botHalf = halfAt(yBot);
    const bh = yBot - yTop;
    // points are RELATIVE to the shape's own box, which is the box of its
    // widest edge — the same convention `rotate` uses for the rest of the file
    const pts =
      topHalf <= 0.01
        ? [
            [botHalf, 0],
            [2 * botHalf, bh],
            [0, bh],
          ]
        : [
            [botHalf - topHalf, 0],
            [botHalf + topHalf, 0],
            [2 * botHalf, bh],
            [0, bh],
          ];
    return {
      role: 'level',
      i,
      x: round(cx - botHalf),
      y: round(yTop),
      w: round(2 * botHalf),
      h: round(bh),
      prst: 'custGeom',
      points: pts.map(([px_, py_]) => [round(px_), round(py_)]),
      fill: shade(i).fill,
      ink: shade(i).ink,
      line: null,
      alpha: 1,
    };
  });

  const pt = Math.max(9, Math.min(TYPE.body, Math.round(band / 2.6)));
  const labels = shapes.map((sh, i) => {
    // the label sits inside the band's NARROWEST usable width, so a word never
    // runs out over the sloping side; the apex gets a floor rather than a
    // zero-width box
    const yTop = oy + i * band;
    const inner = Math.max(2 * halfAt(yTop) - SPACE.xs, sh.w * 0.42);
    return {
      of: i,
      x: round(cx - inner / 2),
      y: round(sh.y + 2),
      w: round(inner),
      h: round(sh.h - 4),
      text: nodes[i].text,
      sub: null,
      pt,
      ink: sh.ink,
      align: 'center',
      valign: 'middle',
    };
  });

  return { family: 'apex', shapes, links: [], labels };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Region-local geometry of a `smartart` block.
 *
 * @param {object} block `{ family, nodes, hub?, numbered?, overlap? }`
 * @param {number} w region width in px
 * @param {number} h region height in px
 * @returns {{family:string, shapes:object[], links:object[], labels:object[]}}
 */
export function smartArtGeometry(block, w, h) {
  const nodes = block.nodes ?? [];
  let g;
  switch (block.family) {
    case 'cycle':
      g = cycleGeometry(nodes, w, h);
      break;
    case 'hierarchy':
      g = hierarchyGeometry(nodes, w, h);
      break;
    case 'venn':
      g = vennGeometry(nodes, w, h, block.overlap ?? 0.32);
      break;
    case 'radial':
      g = radialGeometry(block.hub ?? '', nodes, w, h);
      break;
    case 'apex':
      g = pyramidGeometry(nodes, w, h);
      break;
    default:
      return { family: block.family, shapes: [], links: [], labels: [] };
  }
  // A label is the one rect a family may push outward on purpose (the Venn
  // crescent), so the clamp lives here rather than in four places: a text box
  // that leaves the region is clipped by `.figure{overflow:hidden}` in the
  // HTML and simply lost in the .pptx, and neither is a thing to discover in
  // front of an audience.
  for (const l of g.labels) {
    l.x = round(Math.min(Math.max(l.x, 0), Math.max(w - l.w, 0)));
    l.y = round(Math.min(Math.max(l.y, 0), Math.max(h - l.h, 0)));
  }
  return g;
}

/**
 * The OOXML `rightArrow` silhouette, written out rather than approximated:
 * the .pptx draws the preset, and the SVG has to draw the same outline or the
 * two renderings differ in the one place a reader compares them.
 *
 * ECMA-376 preset geometry, default adjustments (adj1 = adj2 = 50000):
 * shaft half-height `ss·adj1/200000`, head length `ss·adj2/100000`, with
 * `ss = min(w, h)`.
 */
function rightArrowPath(x, y, w, h) {
  const ss = Math.min(w, h);
  const dy = ss * 0.25;
  const dx = Math.min(ss * 0.5, w);
  const hc = y + h / 2;
  const x1 = x + w - dx;
  return [
    `M${round(x)},${round(hc - dy)}`,
    `L${round(x1)},${round(hc - dy)}`,
    `L${round(x1)},${round(y)}`,
    `L${round(x + w)},${round(hc)}`,
    `L${round(x1)},${round(y + h)}`,
    `L${round(x1)},${round(hc + dy)}`,
    `L${round(x)},${round(hc + dy)}`,
    'Z',
  ].join('');
}

/**
 * Greedy word wrap at `width`, using the engine's own character-width
 * estimate so that the break lands where the .pptx text box will put it.
 *
 * A word longer than the whole line is left alone rather than cut: hyphenating
 * "Infrastructure" at an arbitrary letter is worse than one line that runs a
 * little wide, and the caller's box is a text box, not a clip.
 */
function wrap(text, width, pt) {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    if (textWidth(`${line} ${word}`, pt) <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** `transform` for a rotated box, or '' — the convention stated in the
 *  module header, in the one place the SVG side spells it out. */
const rotateAttr = (el) =>
  el.rotate
    ? ` transform="rotate(${el.rotate} ${round(el.x + el.w / 2)} ${round(el.y + el.h / 2)})"`
    : '';

/**
 * The SVG twin of `smartArtGeometry`, at exactly `w × h`.
 *
 * Hard rules, all of them learned from `chart.mjs` and from what inlining
 * costs in a single-document deck:
 *   - NO `id`, no `<defs>`, no `<marker>`, no `url(#…)`. Ids inlined into one
 *     HTML document are global to the deck, which is why `uniquifySvgIds`
 *     exists for the SVG we do not author. Arrowheads are explicit paths.
 *   - `w`/`h` are NEVER clamped. A viewBox that is not exactly the region is
 *     not comparable with the shape list, and comparability is the point.
 *   - Translucency is `fill-opacity`, the form the charts already use.
 */
export function smartArtSvg(block, w, h) {
  const g = smartArtGeometry(block, w, h);
  const parts = [];

  for (const l of g.links) {
    if (l.prst === 'rightArrow') {
      parts.push(
        `<path d="${rightArrowPath(l.x, l.y, l.w, l.h)}" fill="#${l.color}"${rotateAttr(l)}/>`,
      );
    } else {
      parts.push(
        `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="#${l.color}"${rotateAttr(l)}/>`,
      );
    }
  }

  for (const s of g.shapes) {
    const op = s.alpha < 1 ? ` fill-opacity="${s.alpha}"` : '';
    if (s.points) {
      // the same point list the .pptx writes as `custGeom`, translated out of
      // the shape's own box into region coordinates
      const d = s.points
        .map(([px_, py_], k) => `${k ? 'L' : 'M'}${round(s.x + px_)},${round(s.y + py_)}`)
        .join('');
      parts.push(`<path d="${d}Z" fill="#${s.fill}"${op}/>`);
    } else if (s.prst === 'ellipse') {
      parts.push(
        `<ellipse cx="${round(s.x + s.w / 2)}" cy="${round(s.y + s.h / 2)}" rx="${round(s.w / 2)}" ry="${round(s.h / 2)}" fill="#${s.fill}"${op}/>`,
      );
    } else {
      const r = s.radius ? ` rx="${s.radius}" ry="${s.radius}"` : '';
      parts.push(
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${r} fill="#${s.fill}"${op}/>`,
      );
    }
  }

  for (const l of g.labels) {
    const cx = round(l.x + l.w / 2);
    const subPt = Math.max(8, l.pt - 2);
    // WRAPPED, because the .pptx side wraps whether we ask it to or not: a
    // PowerPoint text box breaks its content at the box width, and an SVG
    // `<text>` does not. Left alone, "Web playground" runs out past the edge
    // of its disc in the HTML and sits on two tidy lines in the deck — the
    // two outputs disagreeing about the one thing this module exists to keep
    // identical.
    const lines = [
      ...wrap(l.text, l.w, l.pt).map((text) => ({ text, size: l.pt, bold: true })),
      ...(l.sub ? wrap(l.sub, l.w, subPt).map((text) => ({ text, size: subPt, bold: false })) : []),
    ];
    const lead = l.pt * 1.25;
    const top = round(l.y + l.h / 2 - ((lines.length - 1) * lead) / 2 + l.pt * 0.34);
    lines.forEach((line, k) => {
      parts.push(
        `<text x="${cx}" y="${round(top + k * lead)}" font-size="${line.size}" fill="#${l.ink}" text-anchor="middle"${line.bold ? ' font-weight="600"' : ''}>${esc(line.text)}</text>`,
      );
    });
  }

  return `<svg viewBox="0 0 ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}" xmlns="http://www.w3.org/2000/svg" font-family="${esc(FONT())}">${parts.join('')}</svg>`;
}
