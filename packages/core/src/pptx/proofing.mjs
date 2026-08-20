/**
 * The PROOFING LANGUAGE of the exported `.pptx` — the `lang` attribute every
 * text run carries, and what PowerPoint spell-checks the deck against.
 *
 * PptxGenJS writes `lang="en-US"` on every run unless the call site says
 * otherwise, so a French deck opened in PowerPoint came out underlined in red
 * from the first slide to the last, and the only fix was to select all and
 * re-set the language by hand — on a file the whole point of which is that
 * nobody has to touch it after export.
 *
 * The stamp is applied ONCE, on the presentation object, rather than on the
 * thirty-odd `addText`/`addTable` call sites of the renderer: a call site
 * added later would silently go back to English, and a reviewer has no way to
 * see the omission. Wrapping the two methods that carry text puts the rule in
 * one place, where it can be read and tested.
 *
 * WHAT IT DOES NOT REACH — the speaker notes and the slide-number fields:
 * PptxGenJS hard-codes `en-US` in the XML of both, with no option to override.
 * Neither is spell-checked in the presentation itself, which is why this is
 * left as it is rather than patched from the outside.
 *
 * An explicit `lang` at a call site always wins: the stamp is a DEFAULT, and
 * a deck that one day mixes languages will set it run by run.
 */

import { pptxLang } from '../deck/i18n.mjs';

/** `lang` under the caller's options — never over them, and never by mutating
 *  the object the caller handed us (a call site may reuse a constant). */
const under = (opts, lang) => ({ lang, ...(opts ?? {}) });

/** PptxGenJS reads the options of EACH run for its properties, and inherits
 *  nothing but `color` from the block-level options — so a rich text passed as
 *  an array of runs has to be stamped run by run. A plain string is not an
 *  array: it becomes a single run that uses the block options directly, which
 *  `under()` has already stamped. */
const runs = (text, lang) =>
  Array.isArray(text) ? text.map((run) => ({ ...run, options: under(run.options, lang) })) : text;

/** A table cell is `{ text, options }`, a string, or a number; `text` may
 *  itself be an array of runs (that is how the renderer writes a cell whose
 *  words are not all bold). Every shape goes through the same two rules. */
const cells = (rows, lang) =>
  rows.map((row) =>
    row.map((cell) =>
      cell !== null && typeof cell === 'object' && !Array.isArray(cell)
        ? { ...cell, text: runs(cell.text, lang), options: under(cell.options, lang) }
        : { text: runs(cell, lang), options: { lang } },
    ),
  );

/**
 * Wraps `addSlide` so that every slide of this presentation stamps the deck's
 * language on the text it receives.
 *
 * @param {object} pptx the PptxGenJS instance, mutated in place and returned
 * @param {string} [lang] BCP-47 tag — defaults to the deck's (i18n.mjs)
 */
export function stampProofingLanguage(pptx, lang = pptxLang()) {
  const addSlide = pptx.addSlide.bind(pptx);
  pptx.addSlide = (...args) => {
    const slide = addSlide(...args);
    const addText = slide.addText.bind(slide);
    slide.addText = (text, opts) => addText(runs(text, lang), under(opts, lang));
    const addTable = slide.addTable.bind(slide);
    slide.addTable = (rows, opts) => addTable(cells(rows, lang), under(opts, lang));
    return slide;
  };
  return pptx;
}
