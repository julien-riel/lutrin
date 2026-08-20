/**
 * The deck's LANGUAGE (frontmatter `lang:`): the words the engine writes, and
 * the language the outputs declare.
 *
 * Four properties are pinned here, and each one had a failure mode of its own:
 *
 *   1. the callout labels, "(cont.)" and the generated agenda title follow the
 *      language — the whole point of the feature;
 *   2. a kit's explicit `semantic.<kind>.label` still WINS over the language.
 *      The language is a default under the theme, not an override on top of
 *      it: a kit that renamed a callout must keep its wording;
 *   3. nothing leaks between compilations. The hosts are warm processes, and a
 *      French deck followed by an English one used to be exactly the kind of
 *      bug nobody reproduces on their own machine;
 *   4. an unknown language is a diagnostic, never a failure, and it is
 *      positioned on the `lang:` line — an author sent to line 1 to fix line 6
 *      is an author who gives up.
 *
 * Every test that compiles a deck restores the default state through the same
 * door the compiler uses (prepareDeckContext with an empty frontmatter), for
 * the reason theme.test.mjs states: a failure midway must not cascade.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { LANGS, htmlLang, lang, normalizeLang, pptxLang, setLang, t } from '../src/deck/i18n.mjs';
import { SEMANTIC } from '../src/deck/tokens.mjs';
import { prepareDeckContext } from '../src/deck/context.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';
import { validateDeck } from '../src/deck/validate.mjs';
import { compileHtml } from '../src/html/render.mjs';
import { renderDeck } from '../src/pptx/render.mjs';

/** Compiles a deck exactly as a host does: parse → context → scenes. */
function compile(source, opts = {}) {
  const deck = parseDeck(source);
  const prep = prepareDeckContext(deck.meta, { baseDir: process.cwd(), ...opts });
  return { deck, prep, scenes: buildScenes(deck) };
}

/** The reset every host performs at the head of the NEXT compilation. */
const restoreDefaults = () => prepareDeckContext({}, { baseDir: process.cwd() });

// ---------------------------------------------------------------------------
// The catalogs
// ---------------------------------------------------------------------------

test('every key of the catalog is really translated in every language', () => {
  // The catalogs are private to the module on purpose (no call site may reach
  // for a raw string), so they are read through t(). A key MISSING from a
  // language falls back to English and would come back equal to it — which is
  // exactly the silent half-translation this guards against, hence the list of
  // keys whose value must DIFFER, written out in full.
  const differ = [
    'viewer.previousSlide',
    'viewer.noNotes',
    'viewer.presenterView',
    'viewer.shortcuts',
    'viewer.helpOverview',
    'viewer.hintIdle',
    'callout.success',
    'callout.warning',
    'callout.key',
    'slide.continued',
    'slide.agenda',
    'a11y.slideRole',
    'a11y.slideLabel',
    'a11y.pictogram',
  ];
  setLang(null); // the reference set is read in the default language
  const english = Object.fromEntries(differ.map((k) => [k, t(k)]));
  setLang('fr');
  for (const k of differ) assert.notEqual(t(k), english[k], `${k}: not translated`);
  setLang(null);
  for (const k of differ) assert.equal(t(k), english[k], 'back to English');
});

test('t() fills the {name} slots, and an unknown key comes back as itself', () => {
  setLang('en');
  assert.equal(t('a11y.slideLabel', { n: 3, total: 12 }), 'Slide 3 of 12');
  setLang('fr');
  assert.equal(t('a11y.slideLabel', { n: 3, total: 12 }), 'Diapositive 3 sur 12');
  assert.equal(t('nope.nothing'), 'nope.nothing');
  setLang(null);
});

test('normalizeLang: tolerant on form, strict on support', () => {
  assert.deepEqual(normalizeLang('fr'), { code: 'fr', tag: 'fr', region: null });
  assert.deepEqual(normalizeLang('  FR-ca '), { code: 'fr', tag: 'fr-CA', region: 'CA' });
  assert.deepEqual(normalizeLang('fr_CA'), { code: 'fr', tag: 'fr-CA', region: 'CA' });
  // supported languages only: a well-formed tag we cannot translate is refused
  // rather than declared on an English page
  assert.equal(normalizeLang('de'), null);
  assert.equal(normalizeLang('français'), null);
  assert.equal(normalizeLang(''), null);
  assert.equal(normalizeLang(null), null);
  assert.deepEqual(LANGS, ['en', 'fr']);
});

test('the outputs declare the tag the deck named; the .pptx always a region', () => {
  setLang('fr');
  assert.equal(htmlLang(), 'fr');
  assert.equal(pptxLang(), 'fr-FR', 'no region named: the default of the language');
  setLang('fr-CA');
  assert.equal(htmlLang(), 'fr-CA');
  assert.equal(pptxLang(), 'fr-CA', 'a named region is kept as it is');
  assert.deepEqual(lang(), { code: 'fr', tag: 'fr-CA' });
  setLang(null);
  assert.equal(htmlLang(), 'en');
  assert.equal(pptxLang(), 'en-US');
});

// ---------------------------------------------------------------------------
// The words the engine writes
// ---------------------------------------------------------------------------

const CALLOUTS = '---\ntitle: T\nlang: fr\n---\n\n# A\n\n:::warning\nx\n:::\n';

test('lang: fr translates the callout labels', (t2) => {
  t2.after(restoreDefaults);
  compile(CALLOUTS);
  assert.equal(SEMANTIC.warning.label, 'Attention');
  assert.equal(SEMANTIC.success.label, 'Point clé');
  assert.equal(SEMANTIC.key.label, 'À retenir');
  assert.equal(SEMANTIC.danger.label, 'Important');
});

test('lang: fr names the generated agenda and the continuation slides', (t2) => {
  t2.after(restoreDefaults);
  // a long flow: enough content for the pagination to open a second page
  const body = Array.from({ length: 40 }, (_, k) => `- point number ${k + 1}`).join('\n');
  const { scenes } = compile(
    `---\ntitle: T\nlang: fr\nagenda: true\n---\n\n# Résultats\n\n${body}\n`,
  );
  assert.equal(
    scenes.find((s) => s.layout === 'agenda')?.title,
    'Sommaire',
    'the bare `agenda: true` flag takes the title of the language',
  );
  const cont = scenes.filter((s) => s.continued);
  assert.ok(cont.length, 'the fixture must paginate for this test to mean anything');
  assert.ok(
    cont.every((s) => s.title.endsWith(' (suite)')),
    `continuation titles: ${cont.map((s) => s.title).join(' | ')}`,
  );
  assert.equal(
    cont[0].titleKey,
    'Résultats',
    'the author’s title is kept beside the displayed one',
  );
});

test('a named agenda still names the slide, in any language', (t2) => {
  t2.after(restoreDefaults);
  const { scenes } = compile(
    '---\ntitle: T\nlang: fr\nagenda: Plan de match\n---\n\n# A\n\ntext\n',
  );
  assert.equal(scenes.find((s) => s.layout === 'agenda')?.title, 'Plan de match');
});

test('the paginated-slide diagnostic names the title the author wrote', (t2) => {
  t2.after(restoreDefaults);
  const body = Array.from({ length: 40 }, (_, k) => `- point number ${k + 1}`).join('\n');
  const source = `---\ntitle: T\nlang: fr\n---\n\n# Résultats\n\n${body}\n`;
  const d = validateDeck(source, { baseDir: process.cwd() }).find(
    (x) => x.code === 'SLIDE_PAGINATED',
  );
  assert.ok(d, 'the fixture must paginate');
  assert.match(d.message, /"Résultats"/, 'no "(suite)" suffix left inside the quotes');
  assert.match(d.message, /"\(suite\)"/, 'and the suffix it speaks of is the French one');
});

// ---------------------------------------------------------------------------
// A kit still wins
// ---------------------------------------------------------------------------

test('a kit label overrides the language; the tints it does not name follow it', (t2) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-lang-'));
  t2.after(() => {
    restoreDefaults();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const themeFile = path.join(dir, 'theme.json');
  fs.writeFileSync(
    themeFile,
    JSON.stringify({ name: 'x', semantic: { warning: { label: 'Vigilance' } } }),
  );
  compile(`---\ntitle: T\nlang: fr\nkit: ${themeFile}\n---\n\n# A\n\ntext\n`);
  assert.equal(SEMANTIC.warning.label, 'Vigilance', 'the kit named it: the kit wins');
  assert.equal(SEMANTIC.success.label, 'Point clé', 'the kit said nothing: the language applies');
});

// ---------------------------------------------------------------------------
// No leak between decks (warm hosts)
// ---------------------------------------------------------------------------

test('a deck that names no language never inherits the previous one', (t2) => {
  t2.after(restoreDefaults);
  compile(CALLOUTS);
  assert.equal(SEMANTIC.warning.label, 'Attention');
  const { scenes } = compile('---\ntitle: T\nagenda: true\n---\n\n# A\n\ntext\n');
  assert.equal(SEMANTIC.warning.label, 'Caution');
  assert.equal(scenes.find((s) => s.layout === 'agenda')?.title, 'Agenda');
});

// ---------------------------------------------------------------------------
// An unknown language
// ---------------------------------------------------------------------------

test('an unknown language warns on its own line and compiles in English', (t2) => {
  t2.after(restoreDefaults);
  const source = '---\ntitle: T\nauthor: A\nlang: de\n---\n\n# A\n\n:::warning\nx\n:::\n';
  const d = validateDeck(source, { baseDir: process.cwd() }).find((x) => x.code === 'LANG_UNKNOWN');
  assert.ok(d, 'LANG_UNKNOWN');
  assert.equal(d.severity, 'warning');
  assert.equal(d.line, 4, 'the `lang:` line, not the head of the file');
  assert.match(d.message, /en, fr/);
  assert.equal(d.suggestion, undefined, '"de" is not a typo for "en": no shrug of a suggestion');
  assert.equal(SEMANTIC.warning.label, 'Caution', 'the deck compiles, in English');
});

test('a typo gets its suggestion', (t2) => {
  t2.after(restoreDefaults);
  const { prep } = compile('---\ntitle: T\nlang: fra\n---\n\n# A\n\ntext\n');
  assert.equal(prep.diagnostics.find((d) => d.code === 'LANG_UNKNOWN')?.suggestion, 'fr');
});

// ---------------------------------------------------------------------------
// All the way to the outputs
// ---------------------------------------------------------------------------

test('HTML: the document declares the language and the chrome speaks it', async (t2) => {
  t2.after(restoreDefaults);
  const { html } = await compileHtml(
    '---\ntitle: Bilan\nlang: fr-CA\n---\n\n# Contexte\n\n:::warning\nDélais.\n:::\n',
    process.cwd(),
  );
  assert.match(html, /<html lang="fr-CA">/);
  assert.match(html, /class="alert-label">Attention</);
  assert.match(html, /aria-roledescription="diapositive"/);
  assert.match(html, /aria-label="Diapositive 1 sur 2 — Bilan"/);
});

test('HTML: the presentation-mode chrome is generated in the deck’s language', async (t2) => {
  t2.after(restoreDefaults);
  const { html } = await compileHtml(
    '---\ntitle: Bilan\nlang: fr\n---\n\n# Contexte\n\ntexte\n\n<!-- notes: à dire -->\n',
    process.cwd(),
  );
  assert.match(html, /<summary>Notes<\/summary>/, 'the notes disclosure of each slide');
  assert.match(html, /"Diapositive suivante"/, 'the on-screen control and the presenter label');
  assert.match(html, /"Mode présentateur"/, 'the title of the presenter window');
  assert.match(html, /"Raccourcis"/, 'the help card');
  // an apostrophe inside a translation used to be a syntax error waiting in the
  // GENERATED file only — where no test reading the source would see it, and
  // where it takes the whole presentation mode down (tjs, i18n.mjs)
  assert.match(html, /vue d’ensemble/, 'the help card names the overview');
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Function(script), 'a generated script does not parse');
  }
});

test('.pptx: every run carries the deck’s proofing language', async (t2) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-lang-pptx-'));
  t2.after(() => {
    restoreDefaults();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const source = '---\ntitle: Bilan\nlang: fr-CA\n---\n\n# Contexte\n\n:::warning\nDélais.\n:::\n';
  const { deck, scenes } = compile(source);
  const out = path.join(dir, 'deck.pptx');
  await renderDeck(scenes, deck.meta, process.cwd(), out);

  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(xml, /<a:t>Attention<\/a:t>/, 'the callout label is translated');
  const runs = [...xml.matchAll(/<a:rPr\b[^>]*\blang="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(runs.length, 'the slide must carry text runs');
  assert.deepEqual(
    [...new Set(runs.filter((l) => l !== 'fr-CA'))],
    ['en-US'],
    'only PptxGenJS’s own hard-coded fields may stay en-US (the slide-number field)',
  );
  assert.ok(
    !/<a:t>[^<]*[Dd]élais[^<]*<\/a:t>[\s\S]{0,200}lang="en-US"/.test(xml),
    'no author text left under en-US',
  );
});
