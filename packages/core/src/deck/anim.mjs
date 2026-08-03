/**
 * Choice of the entrance effect — the one table both renderers read.
 *
 * The effect an animated block receives is a property of the DECK, not of a
 * file format: the same `<!-- animate: zoom -->` must mean the same movement
 * in the .pptx and in the HTML. So the table lives here, in deck/, and the two
 * renderers import it; `pptx/anim.mjs` re-exports it for the callers that knew
 * it at its old address.
 *
 * It sits in deck/ rather than in pptx/ for a second, harder reason: the HTML
 * renderer is compiled into the browser playground, and `pptx/anim.mjs` pulls
 * in `node:fs` and JSZip. Importing the preset from there would drag the whole
 * OOXML post-processor into a page that will never write a .pptx.
 */

/** Effect per block type (default: fade). A panel is revealed by a wipe
 *  upwards, a milestone or a metric bursts in with a zoom — the brand's
 *  visual hierarchy, translated into movement.
 *
 *  The keys are the SHAPE kinds the .pptx renderer records, which is why
 *  `panel` and `timeline-dot` have no HTML counterpart: those two are drawn by
 *  the PowerPoint writer as shapes of their own, where the HTML renders the
 *  whole structured block as one element. Both renderers ask this table the
 *  same question and get the same answer for every kind they both know. */
export const PRESET_BY_KIND = {
  panel: 'wipe',
  'timeline-dot': 'zoom',
  metric: 'zoom',
  // a bar fills, it does not appear: the wipe is the movement the shape
  // already describes
  progress: 'wipe',
};

export const presetFor = (kind, override) => override ?? PRESET_BY_KIND[kind] ?? 'fade';
