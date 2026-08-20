/**
 * The words the ENGINE writes, in the deck's language.
 *
 * A deck is made of two kinds of text: what the author typed, and what the
 * compiler adds around it — the label a `:::warning` wears ("Caution"), the
 * "(cont.)" a paginated slide gains, the title of the agenda it synthesizes.
 * The first kind was always the author's; the second was English, hard-coded
 * in the renderers, whatever the deck was written in. A French deck came out
 * with a French sentence inside an English chip, and the only escape was to
 * ship a kit for the sole purpose of renaming five labels.
 *
 * `lang:` in the frontmatter names the language of the SECOND kind. Two are
 * supported — `en` (the default) and `fr` — and the value is a BCP-47 tag, so
 * a region may be named (`fr-CA`): the strings follow the base subtag, the
 * full tag is what the outputs declare (`<html lang>`, the proofing language
 * of the `.pptx`). An unknown language is a diagnostic, never a failure: the
 * deck compiles in English and is told so (`LANG_UNKNOWN`, context.mjs).
 *
 * LIFE CYCLE — the same as the theme's, and for the same reason: the hosts
 * (extension worker, preview server, playground) are warm processes shared
 * between decks. `setLang()` is called by prepareDeckContext at the head of
 * EVERY compilation, with `undefined` restoring the default: a deck that
 * names no language can never inherit the previous deck's.
 *
 * WHY A LEAF MODULE — tokens.mjs imports it (the callout labels are derived
 * tokens like any other), and tokens.mjs is the module nothing else may
 * depend on. This one therefore imports nothing at all.
 *
 * ADDING A LANGUAGE — add a full entry to STRINGS. Every catalog must carry
 * exactly the same keys as `en`, which i18n.test.mjs verifies: a missing key
 * would fall back to English silently, and a deck would come out half
 * translated with nothing to say why.
 */

/** Base subtag → the region the outputs declare when the deck names none.
 *  A proofing language of "fr" alone is accepted by PowerPoint but leaves the
 *  variant to the reader's install; naming one keeps the spell-check
 *  deterministic. */
const DEFAULT_REGION = { en: 'US', fr: 'FR' };

const FALLBACK = 'en';

/**
 * The catalogs. Keys are flat and dotted, grouped by surface:
 *   - `callout.*`  the label of a `:::info|success|warning|danger|key` block;
 *   - `slide.*`    what the engine writes into a slide TITLE;
 *   - `a11y.*`     text no one sees and every screen reader reads;
 *   - `viewer.*`   the chrome of the HTML deck's presentation mode — the
 *                  on-screen controls, the help card, the presenter window.
 *                  It is read by ONE person, the presenter, on their own
 *                  screen; it is in the catalog all the same, because that
 *                  person is the one who wrote `lang: fr`.
 *
 * `{name}` placeholders are filled by `t()`.
 */
const STRINGS = {
  en: {
    'callout.info': 'Info',
    'callout.success': 'Key point',
    'callout.warning': 'Caution',
    'callout.danger': 'Important',
    'callout.key': 'Takeaway',
    'slide.continued': '(cont.)',
    'slide.agenda': 'Agenda',
    'a11y.slideRole': 'slide',
    'a11y.slideLabel': 'Slide {n} of {total}',
    'a11y.pictogram': '{filled} out of {total}',
    'viewer.previousSlide': 'Previous slide',
    'viewer.nextSlide': 'Next slide',
    'viewer.notes': 'Notes',
    'viewer.noNotes': 'No notes for this slide.',
    'viewer.presenterView': 'Presenter view',
    'viewer.timerToggle': 'Start / pause',
    'viewer.timerReset': 'Reset',
    'viewer.timerResetShort': 'reset',
    'viewer.popupBlocked': 'Window blocked — allow pop-ups to get the presenter view',
    'viewer.shortcuts': 'Shortcuts',
    'viewer.helpPresent': 'enter / exit presentation mode',
    'viewer.helpNext': 'next step or slide',
    'viewer.helpPrevious': 'previous step or slide',
    'viewer.helpEnds': 'first / last slide',
    'viewer.helpPresenter': 'presenter view (notes, timer)',
    'viewer.helpOverview': 'overview of every slide',
    'viewer.helpExit': 'exit',
    'viewer.hintPresenting': 'N: notes · O: overview · Esc: exit · ?: help',
    'viewer.hintIdle': 'P: presentation mode · ?: help',
  },
  fr: {
    'callout.info': 'Info',
    'callout.success': 'Point clé',
    'callout.warning': 'Attention',
    'callout.danger': 'Important',
    'callout.key': 'À retenir',
    // "(suite)" and not "(suite…)": the suffix lands in a title the engine
    // already measured, and the ellipsis buys nothing a reader does not get
    // from the word itself.
    'slide.continued': '(suite)',
    // The generated agenda lists the deck's chapters — a table of contents,
    // not a meeting's order of business: "Sommaire", which is also the value
    // the documentation has always used in its `agenda: Sommaire` example.
    'slide.agenda': 'Sommaire',
    'a11y.slideRole': 'diapositive',
    'a11y.slideLabel': 'Diapositive {n} sur {total}',
    'a11y.pictogram': '{filled} sur {total}',
    'viewer.previousSlide': 'Diapositive précédente',
    'viewer.nextSlide': 'Diapositive suivante',
    'viewer.notes': 'Notes',
    'viewer.noNotes': 'Aucune note pour cette diapositive.',
    'viewer.presenterView': 'Mode présentateur',
    'viewer.timerToggle': 'Démarrer / pause',
    'viewer.timerReset': 'Réinitialiser',
    'viewer.timerResetShort': 'réinit.',
    'viewer.popupBlocked':
      'Fenêtre bloquée — autorisez les fenêtres surgissantes pour la vue présentateur',
    'viewer.shortcuts': 'Raccourcis',
    'viewer.helpPresent': 'entrer / quitter le mode présentation',
    'viewer.helpNext': 'étape ou diapositive suivante',
    'viewer.helpPrevious': 'étape ou diapositive précédente',
    'viewer.helpEnds': 'première / dernière diapositive',
    'viewer.helpPresenter': 'vue présentateur (notes, minuterie)',
    'viewer.helpOverview': 'vue d’ensemble des diapositives',
    'viewer.helpExit': 'quitter',
    // The keys keep their English mnemonics — they are the keys of the
    // keyboard, not words: renaming them would describe a key nobody presses.
    'viewer.hintPresenting': 'N : notes · O : vue d’ensemble · Échap : quitter · ? : aide',
    'viewer.hintIdle': 'P : mode présentation · ? : aide',
  },
};

/** The languages a deck may name. */
export const LANGS = Object.keys(STRINGS);

/** Current language of the compilation — read at call time, never copied at
 *  module load (setLang mutates the binding between decks). */
let CURRENT = { code: FALLBACK, tag: FALLBACK, region: null };

/**
 * Reads a frontmatter `lang:` value as a BCP-47 tag.
 *
 * Tolerant on FORM (case, `fr_CA` with an underscore, surrounding spaces),
 * strict on SUPPORT: a well-formed tag whose language has no catalog returns
 * null, because pretending to support it would print English under a French
 * `<html lang="de">` — worse than saying nothing.
 *
 * @param {*} value the raw frontmatter value
 * @returns {{code:string, tag:string, region:string|null}|null}
 */
export function normalizeLang(value) {
  if (value == null) return null;
  const m = String(value)
    .trim()
    .match(/^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}))?$/);
  if (!m) return null;
  const code = m[1].toLowerCase();
  if (!STRINGS[code]) return null;
  const region = m[2] ? m[2].toUpperCase() : null;
  return { code, tag: region ? `${code}-${region}` : code, region };
}

/**
 * Sets the language of the compilation that is starting. Called ONCE per
 * deck, by prepareDeckContext, before anything reads a token.
 *
 * @param {*} [value] the frontmatter `lang:` value — absent or unreadable
 *                    restores the default (English)
 * @returns {{code:string, tag:string, unknown:string|null}} `unknown` carries
 *          the value that could not be read, for the caller to report
 */
export function setLang(value) {
  const parsed = normalizeLang(value);
  CURRENT = parsed ?? { code: FALLBACK, tag: FALLBACK, region: null };
  const named = value != null && String(value).trim() !== '';
  return { code: CURRENT.code, tag: CURRENT.tag, unknown: !parsed && named ? String(value) : null };
}

/** The language in force: `code` is the catalog (`fr`), `tag` the BCP-47 tag
 *  the deck named (`fr-CA`). */
export function lang() {
  return { code: CURRENT.code, tag: CURRENT.tag };
}

/** The tag an output declares — `<html lang>`. The deck's own tag: a deck that
 *  named `fr-CA` says `fr-CA`, one that named `fr` says `fr`. */
export function htmlLang() {
  return CURRENT.tag;
}

/** The proofing language of the `.pptx` runs (`<a:rPr lang="…">`), which is
 *  what PowerPoint spell-checks against. Always regionalized: PowerPoint reads
 *  a bare "fr" as "whatever French this install has", and a deck that says
 *  nothing about its region gets DEFAULT_REGION rather than a guess made on
 *  the reader's machine. */
export function pptxLang() {
  return `${CURRENT.code}-${CURRENT.region ?? DEFAULT_REGION[CURRENT.code] ?? 'US'}`;
}

/**
 * One string of the current catalog.
 *
 * Falls back to English key by key rather than catalog by catalog: a language
 * that gained a key late still translates everything else. A key in NO catalog
 * comes back as itself — visible in the output, which is how a typo in a call
 * site is meant to be found.
 *
 * @param {string} key dotted key of the catalog
 * @param {Record<string, string|number>} [vars] values for the `{name}` slots
 */
/**
 * One string of the catalog as a JAVASCRIPT STRING LITERAL, quotes included —
 * for the scripts the HTML renderer generates by concatenation.
 *
 * `'` + t(k) + `'` was never an option: the first translation carrying an
 * apostrophe ("vue d'ensemble") would have closed the literal and taken the
 * whole presentation mode down with a syntax error, in the generated file
 * only — where no test that reads the source would ever see it.
 */
export function tjs(key, vars) {
  return JSON.stringify(t(key, vars));
}

export function t(key, vars) {
  const raw = STRINGS[CURRENT.code]?.[key] ?? STRINGS[FALLBACK][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (all, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : all,
  );
}
