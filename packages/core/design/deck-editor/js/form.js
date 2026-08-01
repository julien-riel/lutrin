/**
 * form.js — the editing panel: layout selector (grouped from the deck's
 * capabilities), the layout-dependent form over the slide's `parts`, the
 * raw-source mode, and the Formulaire/Source toggle.
 *
 * The form owns a working CLONE of the current slide's parts; every
 * keystroke serializes it back to canonical markdown (serializeParts — the
 * exact format slice.mjs emits server-side) and pushes it into the store as
 * the working text, which main.js turns into a live compile. Raw-source
 * edits flow the other way and soft-lock the form: parts are only
 * re-derived server-side, so the form waits for the next GET/PUT.
 *
 * The panel re-renders on slide/deck changes, NEVER on its own keystrokes —
 * a re-render would steal the focus mid-word.
 */

import { store } from './store.js';
import { el, field, segmented } from './ui.js';

let host = null;

let mode = 'form'; // 'form' | 'source' — reset per slide
let parts = null; // working clone of the current slide's parts (or null)
let introVisible = false;
let renderedFor = null; // "path:index" the clone belongs to

// ------ canonical serialization ----------------------------------------------

/**
 * Serialize form parts to the canonical slide markdown — the EXACT mirror of
 * slice.mjs' serializeParts (§1 of the design contract): title, directives,
 * intro, sections, notes as trailing comments; blocks separated by one blank
 * line, no trailing newline. Every branch matches the server byte for byte —
 * the soft lock below compares the two serializations, and a divergence
 * (a dropped bare `<!-- animate -->`, a trimmed intro) would either lock the
 * form for nothing or silently rewrite what the author never touched.
 * @param {import('./api.js').SlideParts} p
 * @returns {string}
 */
export function serializeParts(p) {
  const blocks = [];
  if (p.title != null) blocks.push(`# ${p.title}`.trimEnd());
  const directives = [];
  if (p.layout != null) directives.push(`<!-- layout: ${p.layout} -->`);
  if (p.animate != null) {
    // a bare `<!-- animate -->` reads back as the empty value: keep writing
    // the spelling the author knows rather than a dangling colon
    directives.push(p.animate === '' ? '<!-- animate -->' : `<!-- animate: ${p.animate} -->`);
  }
  if (directives.length) blocks.push(directives.join('\n'));
  if (p.intro) blocks.push(p.intro);
  for (const section of p.sections ?? []) {
    const heading = `## ${section.heading}`.trimEnd();
    blocks.push(section.body ? `${heading}\n\n${section.body}` : heading);
  }
  if (p.notes?.length) blocks.push(p.notes.map((n) => `<!-- notes: ${n} -->`).join('\n'));
  return blocks.join('\n\n');
}

// ------ source-mode layout directive -----------------------------------------

const LAYOUT_LINE_RE = /^\s*<!--\s*layout\s*:.*-->\s*$/;

/** A whole HTML comment on one line — with blanks and the initial `# H1`,
 *  the only lines a slice's header zone may hold. */
const ONE_LINE_COMMENT_RE = /^\s*<!--.*-->\s*$/;

/** An ATX `# H1` line (a lone `#` counts, `##` does not). */
const ATX_H1_RE = /^\s{0,3}#(?:\s|$)/;

/**
 * Number of leading lines forming the slice's HEADER zone: blank lines,
 * one-line HTML comments and the initial `# H1`, stopping at the first
 * content block. The layout directive is only ever read, replaced or
 * removed inside this zone — a `<!-- layout: … -->` further down is the
 * author's text (a code sample in a fence, a literal comment between
 * paragraphs), and the old whole-slice scan used to rewrite it in place.
 * @param {string[]} lines
 * @returns {number}
 */
function headerEnd(lines) {
  let seenTitle = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || ONE_LINE_COMMENT_RE.test(line)) continue;
    if (!seenTitle && ATX_H1_RE.test(line)) {
      seenTitle = true;
      continue;
    }
    return i;
  }
  return lines.length;
}

/** Index of the layout directive line INSIDE the header zone, or -1. */
function layoutLineAt(lines) {
  const header = headerEnd(lines);
  for (let i = 0; i < header; i++) {
    if (LAYOUT_LINE_RE.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Insert, replace or remove the `<!-- layout: … -->` line in a raw slice —
 * how the layout selector acts while in source mode. Confined to the header
 * zone: nothing beyond the first content block is ever touched.
 * @param {string} text raw slice source
 * @param {string|null} layout null removes the directive
 * @returns {string}
 */
export function applyLayoutToSource(text, layout) {
  const lines = text.split('\n');
  const at = layoutLineAt(lines);
  if (layout === null) {
    if (at >= 0) {
      lines.splice(at, 1);
      // a blank left doubled by the removal reads as glue — drop one
      if (at < lines.length && at > 0 && lines[at] === '' && lines[at - 1] === '')
        lines.splice(at, 1);
    }
    return lines.join('\n');
  }
  if (at >= 0) {
    lines[at] = `<!-- layout: ${layout} -->`;
    return lines.join('\n');
  }
  // canonical position: right under the title when there is one, else on top
  if (/^#\s/.test(lines[0] ?? '')) lines.splice(1, 0, '', `<!-- layout: ${layout} -->`);
  else lines.unshift(`<!-- layout: ${layout} -->`, '');
  return lines.join('\n');
}

/** Layout named by the working slice's HEADER directive, or null. */
function layoutOfSource(text) {
  const lines = text.split('\n');
  const at = layoutLineAt(lines);
  return at >= 0 ? /layout\s*:\s*(.*?)\s*-->/.exec(lines[at])?.[1] || null : null;
}

// ------ helpers ----------------------------------------------------------------

function pushParts() {
  store.setWorking(serializeParts(parts));
}

function rebuild(slide) {
  parts = slide.parts ? structuredClone(slide.parts) : null;
  introVisible = Boolean(parts?.intro?.trim());
  mode = parts ? 'form' : 'source';
}

/** Grouped options of the layout selector, from the deck's capabilities. */
function layoutGroups(capabilities) {
  const caps = capabilities ?? {};
  const official = (caps.officialLayouts ?? []).map((d) => d.name);
  const user = caps.userLayouts ?? [];
  const special = new Set([...official, ...user.map((d) => d.name)]);
  return [
    { label: 'Intégrés', names: (caps.layouts ?? []).filter((n) => !special.has(n)) },
    { label: 'Officiels', names: official },
    { label: 'Kit', names: user.filter((d) => d.origin).map((d) => d.name) },
    { label: 'Projet', names: user.filter((d) => !d.origin).map((d) => d.name) },
  ].filter((g) => g.names.length);
}

/** Description of a layout when its catalog/user definition carries one. */
function layoutDescription(capabilities, name) {
  if (!name) return null;
  const defs = [...(capabilities?.officialLayouts ?? []), ...(capabilities?.userLayouts ?? [])];
  return defs.find((d) => d.name === name)?.description ?? null;
}

/**
 * Data model of the layout selector: the option groups, the label of the
 * Automatique entry, the value to select, and — when the slice names a
 * layout no capability group knows (a typo, a kit gone missing) — an extra
 * `unknown` entry rendered as "name (inconnu)". Falling back to Automatique
 * would lie: the directive is still in the source, and the first real change
 * would silently rewrite it. Exported for the tests.
 * @param {import('./api.js').Capabilities} capabilities
 * @param {string|null} currentLayout explicit directive of the slice
 * @param {string|null} inferred layout the server inferred
 */
export function layoutSelectModel(capabilities, currentLayout, inferred) {
  const groups = layoutGroups(capabilities);
  const known = new Set(groups.flatMap((g) => g.names));
  return {
    groups,
    unknown: currentLayout && !known.has(currentLayout) ? currentLayout : null,
    value: currentLayout ?? '',
    autoLabel: inferred ? `Automatique (${inferred} inféré)` : 'Automatique',
  };
}

function boundsLabel(bounds) {
  if (!bounds) return null;
  return bounds.min === bounds.max
    ? `${bounds.min} sections`
    : `${bounds.min}–${bounds.max} sections`;
}

// ------ rendering ---------------------------------------------------------------

function message(text) {
  return el('p', { class: 'form-note', text });
}

function emptyState(title, text) {
  return el('div', { class: 'empty' }, [
    el('h2', { class: 'empty-title', text: title }),
    el('p', { text }),
  ]);
}

function renderLayoutField(s, slide) {
  const caps = s.deck.capabilities;
  const currentLayout =
    mode === 'form' && parts ? (parts.layout ?? null) : layoutOfSource(s.workingSource ?? '');
  const inferred = slide.inferredLayout ?? null;
  const model = layoutSelectModel(caps, currentLayout, inferred);
  const select = el('select', { class: 'select' }, [
    el('option', { value: '', text: model.autoLabel }),
    ...model.groups.map((group) =>
      el(
        'optgroup',
        { label: group.label },
        group.names.map((name) => el('option', { value: name, text: name })),
      ),
    ),
    // a directive naming a layout nobody declares stays visible AS ITSELF —
    // never shown as Automatique, which would misstate the source
    model.unknown
      ? el('option', { value: model.unknown, text: `${model.unknown} (inconnu)` })
      : null,
  ]);
  select.value = model.value;
  select.addEventListener('change', () => {
    const chosen = select.value || null;
    if (mode === 'form' && parts) {
      parts.layout = chosen;
      pushParts();
    } else {
      store.setWorking(applyLayoutToSource(store.get().workingSource ?? '', chosen), {
        fromSource: true,
      });
    }
    render(); // description + section bounds follow the new layout
  });
  const description = layoutDescription(caps, currentLayout);
  const bounds = caps?.layoutSections?.[currentLayout ?? inferred];
  const hint = [description, boundsLabel(bounds)].filter(Boolean).join(' — ');
  return field({ label: 'Layout', control: select, hint: hint || undefined, id: 'layout-select' });
}

function renderFormFields(s, slide) {
  const nodes = [];

  // title
  const titleInput = el('input', { class: 'input', type: 'text', value: parts.title ?? '' });
  titleInput.addEventListener('input', () => {
    parts.title = titleInput.value.trim() ? titleInput.value : null;
    pushParts();
  });
  nodes.push(field({ label: 'Titre', control: titleInput, id: 'slide-title' }));

  // intro — hidden until it has content or the user asks for it
  if (introVisible) {
    const introArea = el('textarea', { class: 'textarea mono' });
    introArea.value = parts.intro ?? '';
    introArea.addEventListener('input', () => {
      parts.intro = introArea.value;
      pushParts();
    });
    nodes.push(field({ label: 'Intro', control: introArea, id: 'slide-intro' }));
  } else {
    nodes.push(
      el('div', { class: 'field' }, [
        el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: '+ intro',
          onclick: () => {
            introVisible = true;
            render();
            document.getElementById('slide-intro')?.focus();
          },
        }),
      ]),
    );
  }

  // sections, bounded by the effective layout's declared min/max
  const caps = s.deck.capabilities;
  const effective = parts.layout ?? slide.inferredLayout ?? null;
  const bounds = effective ? caps?.layoutSections?.[effective] : null;
  const min = bounds?.min ?? 0;
  const max = bounds?.max ?? Number.POSITIVE_INFINITY;
  parts.sections.forEach((section, i) => {
    const headingInput = el('input', {
      class: 'input',
      type: 'text',
      value: section.heading,
      'aria-label': `Titre de la section ${i + 1}`,
    });
    headingInput.addEventListener('input', () => {
      section.heading = headingInput.value;
      pushParts();
    });
    const bodyArea = el('textarea', {
      class: 'textarea mono',
      'aria-label': `Contenu de la section ${i + 1}`,
    });
    bodyArea.value = section.body;
    bodyArea.addEventListener('input', () => {
      section.body = bodyArea.value;
      pushParts();
    });
    nodes.push(
      el('div', { class: 'section-card' }, [
        el('div', { class: 'section-card-head' }, [
          el('span', { class: 'label', text: `Section ${i + 1}` }),
          el('button', {
            class: 'btn btn-sm',
            type: 'button',
            text: 'Supprimer',
            'aria-label': `Supprimer la section ${i + 1}`,
            disabled: parts.sections.length <= min,
            onclick: () => {
              parts.sections.splice(i, 1);
              pushParts();
              render();
            },
          }),
        ]),
        headingInput,
        el('div', { style: 'height:6px' }),
        bodyArea,
      ]),
    );
  });
  nodes.push(
    el('div', { class: 'section-actions' }, [
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: 'Ajouter une section',
        disabled: parts.sections.length >= max,
        onclick: () => {
          parts.sections.push({ heading: '', body: '' });
          pushParts();
          render();
        },
      }),
      bounds ? el('span', { class: 'hint', text: boundsLabel(bounds) }) : null,
    ]),
  );

  // notes — ONE textarea per note: a note may span several lines inside its
  // <!-- notes: … --> comment, and the old single textarea joined on '\n'
  // then split on '\n', turning one two-line note into two notes at the
  // first keystroke. Each textarea now carries its note verbatim.
  nodes.push(el('div', { class: 'field' }, el('span', { class: 'label', text: 'Notes' })));
  (parts.notes ?? []).forEach((note, i) => {
    const noteArea = el('textarea', {
      class: 'textarea mono',
      'aria-label': `Note ${i + 1}`,
    });
    noteArea.value = note;
    noteArea.addEventListener('input', () => {
      parts.notes[i] = noteArea.value;
      pushParts();
    });
    nodes.push(
      el('div', { class: 'note-row' }, [
        noteArea,
        el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: 'Supprimer',
          'aria-label': `Supprimer la note ${i + 1}`,
          onclick: () => {
            parts.notes.splice(i, 1);
            pushParts();
            render();
          },
        }),
      ]),
    );
  });
  nodes.push(
    el('div', { class: 'section-actions' }, [
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: 'Ajouter une note',
        onclick: () => {
          parts.notes = parts.notes ?? [];
          parts.notes.push('');
          pushParts();
          render();
        },
      }),
      el('span', { class: 'hint', text: 'Notes du présentateur.' }),
    ]),
  );
  return nodes;
}

function renderSourceField(s) {
  const area = el('textarea', {
    class: 'textarea mono source',
    'aria-label': 'Source markdown de la diapositive',
  });
  area.value = s.workingSource ?? '';
  area.addEventListener('input', () => {
    store.setWorking(area.value, { fromSource: true });
  });
  return el('div', { class: 'field' }, area);
}

function render() {
  const s = store.get();
  if (!s.deck) {
    host.replaceChildren(
      emptyState('Aucun fichier ouvert', 'Choisissez un fichier .deck.md dans l’arborescence.'),
    );
    return;
  }
  if (!s.deck.sliceable) {
    host.replaceChildren(
      message(
        'Dialecte Marp : l’édition par diapositive n’est pas disponible. ' +
          'L’aperçu du fichier reste actif.',
      ),
    );
    return;
  }
  if (s.coverSelected) {
    // the implicit cover has no slice to edit: it is drawn from the
    // frontmatter, and the YAML header lives outside every slice
    host.replaceChildren(
      emptyState(
        'Couverture',
        'Couverture générée depuis le frontmatter — le titre s’édite dans ' +
          'l’en-tête YAML du fichier.',
      ),
    );
    return;
  }
  if (s.current < 0) {
    host.replaceChildren(
      emptyState('Aucune diapositive', 'Sélectionnez une diapositive dans la liste.'),
    );
    return;
  }
  const slide = s.deck.slides[s.current];
  const key = `${s.deck.path}:${s.current}:${s.deck.version}`;
  if (renderedFor !== key) {
    rebuild(slide);
    renderedFor = key;
  }

  // soft lock: the working text no longer matches what this form would emit
  // (hand-edited in source mode, or preserved across a conflict reload) —
  // parts are stale until the server re-derives them on the next GET/PUT
  const locked = s.dirty && (s.sourceEdited || !parts || serializeParts(parts) !== s.workingSource);
  if (locked || !parts) mode = 'source';

  const nodes = [];
  nodes.push(
    el('div', { class: 'form-head' }, [
      segmented({
        label: 'Mode d’édition',
        options: [
          { value: 'form', label: 'Formulaire', disabled: locked || !parts },
          { value: 'source', label: 'Source' },
        ],
        value: mode,
        onChange: (value) => {
          mode = value;
          render();
        },
      }),
    ]),
  );
  if (!parts)
    nodes.push(
      message(
        'Cette diapositive dépasse ce que le formulaire sait représenter — édition en mode source.',
      ),
    );
  else if (locked)
    nodes.push(
      message(
        'Modifiée en mode source : le formulaire se resynchronisera après ' +
          'l’enregistrement ou le rechargement.',
      ),
    );

  nodes.push(renderLayoutField(s, slide));
  if (mode === 'form' && parts && !locked) nodes.push(...renderFormFields(s, slide));
  else nodes.push(renderSourceField(s));
  host.replaceChildren(...nodes);
}

/**
 * Mount the editing panel into `container`. Re-renders on deck/slide/conflict
 * changes; its own keystrokes only push working text (no re-render).
 * @param {{container: HTMLElement}} deps
 */
export function init(deps) {
  host = deps.container;
  store.subscribe((_snap, path) => {
    if (path === 'deck' || path === 'current') render();
  });
  render();
}
