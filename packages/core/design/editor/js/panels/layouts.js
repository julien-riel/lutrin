/**
 * layouts.js — the Layouts panel: the kit's own arrangements.
 *
 * Three views, panel-local: the LIST of kit layouts (server truth merged with
 * the working copies), the base PICKER (step 1 of "New layout"), and the FORM
 * (step 2 / edit) whose controls are GENERATED from the base's paramSchema.
 * "Save layout" writes the working copy (store.update → dirty → the shell
 * recompiles); the topbar's Save kit does the PUT. Deletes are immediate disk
 * calls behind a confirm.
 *
 * LIVE PREVIEW: the shell's compile loop has no source override, so the form
 * carries its own sandboxed iframe (same opaque-origin CSP recipe as the
 * shell's) and compiles a synthetic one-slide deck — frontmatter + a
 * `<!-- layout: name -->` slide with sections.min placeholder sections —
 * through api.compile, with the form's definition overlaid on the working
 * layouts. Debounced, single-flight; a 409 (superseded by a shell compile)
 * retries once. The main preview never leaves the specimen.
 *
 * PARAMETER SEMANTICS: a control left at its default is OMITTED from the
 * definition — an alias with no parameters stays a pure alias. For a layout
 * built on an OFFICIAL base, "default" means the official's own preset value
 * (registerLayout merges the base's params underneath), so equality is
 * measured against that, not the root generator's default.
 */

import { isSuperseded } from '../api.js';

const NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED_DEF_KEYS = new Set(['name', 'base', 'sections', 'description']);
const PREVIEW_DEBOUNCE_MS = 350;
const PREVIEW_RETRY_MS = 600;
/** Registration name of the preview definition while the form's own name is
 *  not (yet) usable — invalid, or colliding with a reserved name. */
const SCRATCH_NAME = 'preview-scratch';
const LIST_CAP = 16; // checkParam's hard cap on enum-list / number-list
/** UI bounds for explicit `sections` on a base that publishes none —
 *  registerLayout accepts any 1 ≤ min ≤ max, the cap is editor comfort. */
const FREE_SECTIONS = { min: 1, max: 16 };

let ctx = null;
let host = null;
let unsubStore = null;

let view = 'list'; // 'list' | 'pick' | 'form'
let form = null;
/** Disk deletes this session, not yet visible in state (the server suppresses
 *  the kit-changed event for its own writes) — filters the stale entries. */
const deletedNames = new Set();
/** The state object deletedNames is relative to. A replaceState that happens
 *  while this panel is UNMOUNTED must not leave the filter hiding fresher
 *  server truth — mount() reconciles by identity. */
let seenState = null;

function syncWithState(state) {
  if (state === seenState) return;
  seenState = state;
  deletedNames.clear();
}

// ------ live preview machinery ---------------------------------------------

let frame = null;
let frameReady = false;
let framePending = null;
let pvTimer = null;
let pvRetry = null;
let pvInflight = false;
let pvQueued = false;
let pvStatus = null;
let pvDiags = null;
let lastToastedError = '';

const el = (tag, attrs, children) => ctx.ui.el(tag, attrs, children);

// Same recipe as the shell's preview frame: opaque origin, a CSP that admits
// only what compiled slides carry. innerHTML happens INSIDE this sandbox,
// on compiler output — never in the panel's own DOM.
const FRAME_SRCDOC = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #edece8; }
  #box { width: 1280px; height: 720px; transform-origin: 0 0; overflow: hidden; background: #fff; }
</style>
</head>
<body>
<div id="box"></div>
<style id="fonts-css"></style>
<style id="deck-css"></style>
<script>
  var box = document.getElementById('box');
  var fontsTag = document.getElementById('fonts-css');
  var deckTag = document.getElementById('deck-css');
  var lastFonts = '';
  var lastCss = '';
  var lastSlide = null;
  function rescale() {
    box.style.transform = 'scale(' + document.documentElement.clientWidth / 1280 + ')';
  }
  new ResizeObserver(rescale).observe(document.documentElement);
  rescale();
  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || msg.type !== 'render') return;
    if (msg.fontsCss !== lastFonts) { lastFonts = msg.fontsCss || ''; fontsTag.textContent = lastFonts; }
    if (msg.css !== lastCss) { lastCss = msg.css || ''; deckTag.textContent = lastCss; }
    if (msg.slide !== lastSlide) { lastSlide = msg.slide || ''; box.innerHTML = lastSlide; }
  });
<\/script>
</body>
</html>`;

// ------ snapshot helpers -----------------------------------------------------

const caps = () => ctx.store.get().state?.capabilities ?? { bases: [], reservedNames: [] };
const baseEntry = () => caps().bases.find((b) => b.name === form?.baseName) ?? null;
const rootBaseOf = (entry) => (entry.builtin ? entry.name : (entry.base ?? entry.name));

/** Effective default of a parameter: the official base's preset when the
 *  base carries one, the root generator's default otherwise. */
function dfltOf(key, spec) {
  const e = baseEntry();
  if (e?.params && key in e.params) return e.params[key];
  return spec.default;
}

const sameAsDefault = (v, d) => JSON.stringify(v) === JSON.stringify(d ?? null);

/** Every name a new layout cannot take (kit side — reserved names are checked
 *  separately for a dedicated message). */
function takenNames() {
  const s = ctx.store.get();
  const names = new Set(s.layouts.keys());
  for (const l of s.state?.layouts ?? []) if (!deletedNames.has(l.name)) names.add(l.name);
  return names;
}

/** The list's rows: server truth (minus this session's deletes) merged with
 *  the working copies; a working def wins over the disk one. */
function inventory() {
  const s = ctx.store.get();
  const rows = new Map();
  for (const l of s.state?.layouts ?? []) {
    if (deletedNames.has(l.name)) continue;
    rows.set(l.name, {
      name: l.name,
      file: l.file,
      onDisk: true,
      broken: l.def === null && !s.layouts.has(l.name),
      def: s.layouts.get(l.name) ?? l.def,
    });
  }
  for (const [name, def] of s.layouts) {
    if (!rows.has(name)) rows.set(name, { name, file: null, onDisk: false, broken: false, def });
  }
  for (const r of rows.values()) r.dirty = s.dirty.layouts.has(r.name);
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ------ shared view bits -----------------------------------------------------

function gotoList() {
  if (location.hash === '#layouts') {
    view = 'list';
    form = null;
    render();
  } else {
    location.hash = '#layouts';
  }
}

/** field() with a mono label (param keys, names — exact data) and a live
 *  error line the validators repaint through setErr(). */
function labeledField(label, control, { hint, mono = true, errKey = null } = {}) {
  const f = ctx.ui.field({ label, control, hint });
  if (mono) f.querySelector('.label')?.classList.add('p-layouts-label-mono');
  if (errKey) {
    const e = el('span', { class: 'error', hidden: true });
    form.errEls[errKey] = e;
    f.append(e);
  }
  return f;
}

/** Records an error under `key` (null clears it) and repaints its line.
 *  `paint: false` keeps a blocking error silent (pristine name field). */
function setErr(key, msg, paint = true) {
  if (!form) return;
  if (msg) form.errors[key] = msg;
  else delete form.errors[key];
  const node = form.errEls[key];
  if (node) {
    node.textContent = paint && msg ? msg : '';
    node.hidden = !(paint && msg);
  }
}

function onFormEdited() {
  if (form?.saveBtn) form.saveBtn.disabled = Object.keys(form.errors).length > 0;
  schedulePreview();
}

// ------ list view -------------------------------------------------------------

function render() {
  if (!host) return;
  if (view === 'list') renderList();
  else if (view === 'pick') renderPicker();
  else renderForm();
}

function renderList() {
  frame = null;
  frameReady = false;
  pvStatus = null;
  pvDiags = null;
  const rows = inventory();
  const newBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'New layout',
    onclick: () => {
      location.hash = '#layouts/new';
    },
  });
  if (!rows.length) {
    host.replaceChildren(
      el('div', { class: 'empty' }, [
        el('h2', { class: 'empty-title', text: 'No layouts yet' }),
        el('p', { text: 'Create one to give this kit its own arrangements.' }),
        el('div', { class: 'p-layouts-empty-cta' }, newBtn),
      ]),
    );
    return;
  }
  host.replaceChildren(
    el('div', { class: 'p-layouts-head' }, [
      el('span', { class: 'label', text: rows.length === 1 ? '1 kit layout' : `${rows.length} kit layouts` }),
      el('span', { class: 'p-layouts-flex' }),
      newBtn,
    ]),
    ...rows.map(listRow),
  );
}

function listRow(row) {
  const badges = [];
  if (row.dirty) badges.push(el('span', { class: 'p-layouts-badge is-unsaved', text: 'Unsaved' }));
  if (row.broken) badges.push(el('span', { class: 'p-layouts-badge is-broken', text: 'Unreadable' }));
  const meta = [];
  if (typeof row.def?.base === 'string')
    meta.push(el('span', { class: 'p-layouts-meta', text: `base: ${row.def.base}` }));
  if (row.def?.sections)
    meta.push(
      el('span', {
        class: 'p-layouts-meta',
        text: `${row.def.sections.min}–${row.def.sections.max} sections`,
      }),
    );
  meta.push(el('span', { class: 'p-layouts-meta', text: row.file ?? 'not written to disk yet' }));
  return el('div', { class: 'card p-layouts-item' }, [
    el('div', { class: 'p-layouts-toprow' }, [
      el('span', { class: 'p-layouts-name', text: row.name }),
      ...badges,
      el('span', { class: 'p-layouts-flex' }),
      el('div', { class: 'p-layouts-actions' }, [
        row.broken
          ? null
          : el('button', {
              class: 'btn btn-sm',
              type: 'button',
              text: 'Edit',
              onclick: () => {
                location.hash = `#layouts/${row.name}`;
              },
            }),
        el('button', {
          class: 'btn btn-danger btn-sm',
          type: 'button',
          text: 'Delete',
          onclick: () => deleteRow(row),
        }),
      ]),
    ]),
    el('div', { class: 'p-layouts-metarow' }, meta),
    row.broken
      ? el('p', {
          class: 'p-layouts-broken',
          text: 'This file could not be read as JSON — fix it on disk or delete it.',
        })
      : row.def?.description
        ? el('p', { class: 'p-layouts-desc', text: row.def.description })
        : null,
  ]);
}

async function deleteRow(row) {
  // captured up front: a delete that outlives the panel (the user navigates
  // mid-confirm or mid-flight) must still drop the working copy and toast
  const { api, store, ui } = ctx;
  const msg = row.onDisk
    ? `Delete layout "${row.name}"? The file is removed from the kit immediately.`
    : `Remove layout "${row.name}"? It has not been written to the kit yet.`;
  const label = row.onDisk ? 'Delete' : 'Remove';
  if (!(await ui.confirmDialog(msg, { confirmLabel: label, danger: true }))) return;
  try {
    if (row.onDisk) {
      await api.deleteLayout(row.name);
      deletedNames.add(row.name);
    }
    // forgetLayout, not update(…, undefined): the file is already gone from
    // disk, nothing is left to save — the tree must NOT turn dirty
    if (store.get().layouts.has(row.name)) store.forgetLayout(row.name);
    else render();
    ui.toast(row.onDisk ? 'Layout deleted' : 'Layout removed');
  } catch (e) {
    ui.toast(e?.message ?? 'Delete failed', 'error');
  }
}

// ------ base picker (New layout, step 1) ---------------------------------------

function renderPicker() {
  const { bases } = caps();
  const groups = [
    ['Built-in', bases.filter((b) => b.builtin)],
    ['Official', bases.filter((b) => b.official)],
  ];
  host.replaceChildren(
    el('div', { class: 'p-layouts-head' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: '‹ Back', onclick: gotoList }),
      el('span', { class: 'label', text: 'New layout — choose a base' }),
    ]),
    el('p', {
      class: 'p-layouts-intro',
      text: 'A kit layout is a named preset of a base: it inherits the placement and locks in your choices.',
    }),
    ...groups.flatMap(([label, list]) =>
      list.length
        ? [
            el('h3', { class: 'label p-layouts-group', text: label }),
            el('div', { class: 'p-layouts-bases' }, list.map(baseCard)),
          ]
        : [],
    ),
  );
}

function baseCard(b) {
  const nParams = Object.keys(b.paramSchema ?? {}).length;
  const meta = [];
  if (b.sections) meta.push(`${b.sections.min}–${b.sections.max} sections`);
  meta.push(nParams === 0 ? 'no parameters' : nParams === 1 ? '1 parameter' : `${nParams} parameters`);
  if (b.official && b.base) meta.push(`built on ${b.base}`);
  return el(
    'button',
    {
      class: 'p-layouts-base-card',
      type: 'button',
      onclick: () => openForm({ mode: 'new', baseName: b.name }),
    },
    [
      el('span', { class: 'p-layouts-name', text: b.name }),
      b.description ? el('span', { class: 'p-layouts-desc', text: b.description }) : null,
      el('span', { class: 'p-layouts-meta', text: meta.join(' · ') }),
    ],
  );
}

// ------ form (New layout step 2 / edit) -----------------------------------------

function openForm({ mode, baseName, def = null }) {
  form = {
    mode,
    editingName: mode === 'edit' ? def.name : null,
    baseName,
    name: def?.name ?? '',
    description: def?.description ?? '',
    secMin: def?.sections?.min != null ? String(def.sections.min) : '',
    secMax: def?.sections?.max != null ? String(def.sections.max) : '',
    params: {},
    errors: {},
    errEls: {},
    nameTouched: mode === 'edit',
    saveBtn: null,
  };
  if (def) {
    for (const [k, v] of Object.entries(def)) {
      if (!RESERVED_DEF_KEYS.has(k)) form.params[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  view = 'form';
  render();
  validateName();
  validateSections();
  onFormEdited();
}

function renderForm() {
  const entry = baseEntry();
  const head = el('div', { class: 'p-layouts-head' }, [
    el('button', { class: 'btn btn-sm', type: 'button', text: '‹ Back', onclick: gotoList }),
    el('span', {
      class: 'label',
      text:
        form.mode === 'new' ? `New layout on ${form.baseName}` : `Edit layout ${form.editingName}`,
    }),
  ]);
  if (!entry) {
    host.replaceChildren(
      head,
      el('div', { class: 'card' }, [
        el('p', {
          class: 'p-layouts-broken',
          text: `The base "${form.baseName}" is not available — this layout cannot be edited here.`,
        }),
      ]),
    );
    return;
  }

  const identity = el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Identity' }),
    labeledField('Name', nameControl(), {
      hint:
        form.mode === 'edit'
          ? 'The name is the layout’s identity — delete and recreate to rename.'
          : 'Lowercase letters, digits and hyphens — decks ask for it with <!-- layout: name -->.',
      errKey: 'name',
    }),
    labeledField('Description', descControl(), {
      mono: false,
      hint: 'Optional — shown in this list and to deck authors.',
    }),
  ]);

  const baseMeta = [];
  if (entry.sections) baseMeta.push(`${entry.sections.min}–${entry.sections.max} sections`);
  if (entry.official && entry.base) baseMeta.push(`built on ${entry.base}`);
  const baseBox = el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Base' }),
    el('div', { class: 'p-layouts-baseline' }, [
      el('span', { class: 'p-layouts-name', text: entry.name }),
      baseMeta.length ? el('span', { class: 'p-layouts-meta', text: baseMeta.join(' · ') }) : null,
    ]),
    entry.description ? el('p', { class: 'p-layouts-desc', text: entry.description }) : null,
    labeledField('Sections', sectionsControl(entry), {
      hint: entry.sections
        ? `How many ## sections a slide carries — between ${entry.sections.min} and ${entry.sections.max} for this base. Leave empty to inherit.`
        : 'Optional — how many ## sections a slide must carry. Leave empty for no rule.',
      errKey: 'sections',
    }),
  ]);

  const schema = entry.paramSchema ?? {};
  const keys = Object.keys(schema);
  const unknown = Object.keys(form.params).filter((k) => !schema[k]);
  const paramsBox = el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Parameters' }),
    keys.length === 0 && unknown.length === 0
      ? el('p', { class: 'p-layouts-desc', text: 'This base has no parameters.' })
      : null,
    ...keys.map((k) => paramRow(k, schema[k])),
    ...unknown.map(unknownRow),
  ]);

  pvStatus = el('p', { class: 'p-layouts-status', text: 'Compiling preview…' });
  pvDiags = el('ul', { class: 'p-layouts-diags', hidden: true });
  const preview = el('div', { class: 'card p-layouts-preview' }, [
    el('h3', { class: 'card-title', text: 'Preview' }),
    el('div', { class: 'p-layouts-frame-wrap' }, buildFrame()),
    pvStatus,
    pvDiags,
  ]);

  form.saveBtn = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Save layout',
    disabled: true,
    onclick: saveLayout,
  });
  const foot = el('div', { class: 'p-layouts-foot' }, [
    el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: gotoList }),
    form.saveBtn,
  ]);

  host.replaceChildren(head, identity, baseBox, paramsBox, preview, foot);
}

// ------ form controls -----------------------------------------------------------

function nameControl() {
  const locked = form.mode === 'edit';
  const input = el('input', {
    class: 'input mono',
    value: form.name,
    placeholder: 'before-after',
    spellcheck: 'false',
    readonly: locked,
  });
  if (!locked) {
    input.addEventListener('input', () => {
      form.name = input.value;
      form.nameTouched = true;
      validateName();
      onFormEdited();
    });
  }
  return input;
}

function validateName() {
  const n = form.name.trim();
  let msg = null;
  if (!n) msg = 'Give the layout a name.';
  else if (!NAME_RE.test(n))
    msg =
      'Lowercase letters, digits and hyphens, starting with a letter, 2 to 32 characters — like "before-after".';
  else if (n !== form.editingName) {
    if (caps().reservedNames.includes(n))
      msg = `"${n}" is already a built-in or official layout — pick another name.`;
    else if (takenNames().has(n)) msg = `A layout named "${n}" already exists in this kit.`;
  }
  setErr('name', msg, form.nameTouched || n !== '');
  return !msg;
}

function descControl() {
  const t = el('textarea', { class: 'textarea', rows: '2', placeholder: 'What this layout is for' });
  t.value = form.description;
  t.addEventListener('input', () => {
    form.description = t.value;
    onFormEdited();
  });
  return t;
}

function sectionsControl(entry) {
  const b = entry.sections;
  const mk = (which, ph) => {
    const i = el('input', {
      type: 'number',
      class: 'input mono p-layouts-num',
      min: String((b ?? FREE_SECTIONS).min),
      max: String((b ?? FREE_SECTIONS).max),
      step: '1',
      placeholder: ph == null ? '' : String(ph),
      value: form[which],
    });
    i.addEventListener('input', () => {
      form[which] = i.value.trim();
      validateSections();
      onFormEdited();
    });
    return i;
  };
  return el('div', { class: 'p-layouts-fixedrow' }, [
    mk('secMin', b?.min),
    el('span', { class: 'p-layouts-dash', text: '–' }),
    mk('secMax', b?.max),
  ]);
}

/** null = omit `sections` from the def, an object = include it, undefined =
 *  invalid input (an error is recorded under 'sections'). */
function validateSections() {
  const b = baseEntry()?.sections ?? FREE_SECTIONS;
  const a = form.secMin;
  const z = form.secMax;
  if (a === '' && z === '') {
    setErr('sections', null);
    return null;
  }
  if (a === '' || z === '') {
    setErr('sections', 'Set both minimum and maximum, or leave both empty.');
    return undefined;
  }
  const min = Number(a);
  const max = Number(z);
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    setErr('sections', 'Whole numbers only.');
    return undefined;
  }
  if (min < b.min || max > b.max || min > max) {
    setErr('sections', `Between ${b.min} and ${b.max} sections, minimum ≤ maximum.`);
    return undefined;
  }
  setErr('sections', null);
  return { min, max };
}

function paramRow(key, spec) {
  let control;
  switch (spec.type) {
    case 'number':
      control = numberControl(key, spec);
      break;
    case 'boolean':
      control = booleanControl(key, spec);
      break;
    case 'enum':
      control = enumControl(key, spec);
      break;
    case 'enum-list':
      control = listControl(key, spec);
      break;
    case 'number-list':
      control = spec.items ? fixedListControl(key, spec) : listControl(key, spec);
      break;
    default:
      control = el('p', { class: 'p-layouts-desc', text: `Unsupported parameter type "${spec.type}".` });
  }
  return labeledField(key, control, { hint: spec.description, errKey: key });
}

function unknownRow(key) {
  const row = el('div', { class: 'p-layouts-unknown' }, [
    el('span', { class: 'p-layouts-meta', text: `${key}: ${JSON.stringify(form.params[key])}` }),
    el('span', { class: 'p-layouts-broken', text: 'Not a parameter of this base.' }),
    el('button', {
      class: 'btn btn-sm',
      type: 'button',
      text: 'Remove',
      onclick: () => {
        delete form.params[key];
        row.remove();
        onFormEdited();
      },
    }),
  ]);
  return row;
}

function numberControl(key, spec) {
  const dflt = dfltOf(key, spec);
  const step = spec.integer ? '1' : '0.01';
  const isSet = form.params[key] !== undefined;
  const slider = el('input', {
    type: 'range',
    class: 'p-layouts-slider',
    min: String(spec.min),
    max: String(spec.max),
    step,
    value: String(isSet ? form.params[key] : (dflt ?? spec.min)),
  });
  const num = el('input', {
    type: 'number',
    class: 'input mono p-layouts-num',
    min: String(spec.min),
    max: String(spec.max),
    step,
    placeholder: dflt == null ? '' : String(dflt),
    value: isSet ? String(form.params[key]) : '',
  });
  const apply = (raw, fromSlider) => {
    if (raw === '') {
      delete form.params[key];
      setErr(key, null);
      slider.value = String(dflt ?? spec.min);
    } else {
      const v = Number(raw);
      const bad = !Number.isFinite(v)
        ? 'Enter a number.'
        : spec.integer && !Number.isInteger(v)
          ? 'Whole numbers only.'
          : v < spec.min || v > spec.max
            ? `Between ${spec.min} and ${spec.max}.`
            : null;
      if (bad) {
        delete form.params[key];
        setErr(key, bad);
      } else {
        setErr(key, null);
        if (sameAsDefault(v, dflt)) delete form.params[key];
        else form.params[key] = v;
        slider.value = String(v);
        if (fromSlider) num.value = String(v);
      }
    }
    onFormEdited();
  };
  slider.addEventListener('input', () => apply(slider.value, true));
  num.addEventListener('input', () => apply(num.value, false));
  return el('div', { class: 'p-layouts-numrow' }, [slider, num]);
}

function booleanControl(key, spec) {
  const dflt = Boolean(dfltOf(key, spec));
  const input = el('input', { type: 'checkbox' });
  input.checked = form.params[key] !== undefined ? Boolean(form.params[key]) : dflt;
  input.addEventListener('change', () => {
    if (input.checked === dflt) delete form.params[key];
    else form.params[key] = input.checked;
    onFormEdited();
  });
  return el('label', { class: 'toggle' }, [input, el('span', { class: 'track' })]);
}

function enumControl(key, spec) {
  const dflt = dfltOf(key, spec);
  const options = [];
  if (dflt == null) options.push({ value: '', label: 'Default' });
  for (const v of spec.values) options.push({ value: v, label: v });
  const seg = ctx.ui.segmented({
    options,
    value: form.params[key] ?? dflt ?? '',
    onChange: (v) => {
      if (v === '' || v === dflt) delete form.params[key];
      else form.params[key] = v;
      onFormEdited();
    },
  });
  seg.classList.add('p-layouts-seg');
  return seg;
}

/** Chip list for enum-list and free number-list. Duplicates are MEANINGFUL
 *  (the values cycle over panels/cells), which rules out ui.tagInput — it
 *  deduplicates. Enum values are added from a suggestions row, numbers from
 *  a bounded input. */
function listControl(key, spec) {
  const numeric = spec.type === 'number-list';
  const dflt = dfltOf(key, spec);
  const values = Array.isArray(form.params[key]) ? [...form.params[key]] : [];
  const emptyNote = el('span', {
    class: 'p-layouts-chips-empty',
    text: Array.isArray(dflt) ? `Default: ${dflt.join(', ')}` : 'Empty — the base decides.',
  });
  const row = el('div', { class: 'p-layouts-chiprow' });
  const paint = () => {
    row.replaceChildren(
      ...(values.length
        ? values.map((v, i) =>
            el('span', { class: 'tag' }, [
              String(v),
              el('button', {
                type: 'button',
                'aria-label': `Remove ${v}`,
                text: '×',
                onclick: () => {
                  values.splice(i, 1);
                  commit();
                },
              }),
            ]),
          )
        : [emptyNote]),
    );
  };
  const commit = () => {
    setErr(key, null);
    if (!values.length) delete form.params[key];
    else if (numeric && spec.sumMax && values.reduce((s, v) => s + v, 0) > spec.sumMax) {
      delete form.params[key];
      setErr(key, `The values must sum to at most ${spec.sumMax}.`);
    } else if (sameAsDefault(values, dflt)) delete form.params[key];
    else form.params[key] = [...values];
    paint();
    onFormEdited();
  };
  let adder;
  if (!numeric) {
    adder = el(
      'div',
      { class: 'p-layouts-sugg' },
      spec.values.map((v) =>
        el('button', {
          type: 'button',
          class: 'p-layouts-sugg-btn',
          text: `+ ${v}`,
          onclick: () => {
            if (values.length >= LIST_CAP) return;
            values.push(v);
            commit();
          },
        }),
      ),
    );
  } else {
    const num = el('input', {
      type: 'number',
      class: 'input mono p-layouts-num',
      min: String(spec.min),
      max: String(spec.max),
      step: spec.integer ? '1' : '0.01',
      placeholder: 'Add a value',
    });
    const add = () => {
      const v = Number(num.value);
      if (num.value.trim() === '' || !Number.isFinite(v)) return;
      if (spec.integer && !Number.isInteger(v)) {
        setErr(key, 'Whole numbers only.');
        onFormEdited();
        return;
      }
      if (v < spec.min || v > spec.max) {
        setErr(key, `Between ${spec.min} and ${spec.max}.`);
        onFormEdited();
        return;
      }
      if (values.length >= LIST_CAP) return;
      num.value = '';
      values.push(v);
      commit();
    };
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
    adder = el('div', { class: 'p-layouts-addrow' }, [
      num,
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Add', onclick: add }),
    ]);
  }
  paint();
  return el('div', { class: 'p-layouts-chips' }, [row, adder]);
}

/** number-list with an exact count (spec.items): one input per slot — all
 *  empty omits the parameter, all filled includes it, anything else is an
 *  error. */
function fixedListControl(key, spec) {
  const dflt = dfltOf(key, spec);
  const current = Array.isArray(form.params[key]) ? form.params[key] : null;
  const inputs = Array.from({ length: spec.items }, (_, i) =>
    el('input', {
      type: 'number',
      class: 'input mono p-layouts-num',
      min: String(spec.min),
      max: String(spec.max),
      step: spec.integer ? '1' : '0.01',
      placeholder: Array.isArray(dflt) && dflt[i] != null ? String(dflt[i]) : '',
      value: current && current[i] != null ? String(current[i]) : '',
    }),
  );
  const apply = () => {
    const raws = inputs.map((i) => i.value.trim());
    if (raws.every((r) => r === '')) {
      delete form.params[key];
      setErr(key, null);
      onFormEdited();
      return;
    }
    let bad = null;
    let vals = null;
    if (raws.some((r) => r === '')) bad = `Fill all ${spec.items} values, or none.`;
    else {
      vals = raws.map(Number);
      if (vals.some((v) => !Number.isFinite(v))) bad = 'Enter numbers.';
      else if (spec.integer && vals.some((v) => !Number.isInteger(v))) bad = 'Whole numbers only.';
      else if (vals.some((v) => v < spec.min || v > spec.max))
        bad = `Each value between ${spec.min} and ${spec.max}.`;
      else if (spec.sumMax && vals.reduce((s, v) => s + v, 0) > spec.sumMax)
        bad = `The values must sum to at most ${spec.sumMax}.`;
    }
    if (bad) {
      delete form.params[key];
      setErr(key, bad);
    } else {
      setErr(key, null);
      if (sameAsDefault(vals, dflt)) delete form.params[key];
      else form.params[key] = vals;
    }
    onFormEdited();
  };
  for (const i of inputs) i.addEventListener('input', apply);
  return el('div', { class: 'p-layouts-fixedrow' }, inputs);
}

// ------ definition + save --------------------------------------------------------

/** The definition the form currently describes. form.params only ever holds
 *  valid, non-default values, so this is safe for both preview and save. */
function buildDef(name) {
  const def = { name, base: form.baseName };
  const d = form.description.trim();
  if (d) def.description = d;
  const sec = validateSections();
  if (sec) def.sections = sec;
  for (const [k, v] of Object.entries(form.params)) def[k] = Array.isArray(v) ? [...v] : v;
  return def;
}

function saveLayout() {
  form.nameTouched = true;
  const okName = validateName();
  validateSections();
  if (!okName || Object.keys(form.errors).length) {
    onFormEdited();
    return;
  }
  const name = form.name.trim();
  ctx.store.update(`layouts.${name}`, buildDef(name));
  ctx.ui.toast('Layout saved — Save kit writes it to disk');
  gotoList();
}

// ------ live preview --------------------------------------------------------------

function buildFrame() {
  frameReady = false;
  framePending = null;
  frame = el('iframe', { class: 'p-layouts-frame', title: 'Layout preview', sandbox: 'allow-scripts' });
  frame.addEventListener('load', () => {
    frameReady = true;
    if (framePending) {
      frame.contentWindow.postMessage(framePending, '*');
      framePending = null;
    }
  });
  frame.srcdoc = FRAME_SRCDOC;
  return frame;
}

function postFrame(msg) {
  if (!frame) return;
  if (!frameReady) framePending = msg;
  else frame.contentWindow.postMessage(msg, '*');
}

/** Name the preview definition registers under: the form's name when it is
 *  usable, a scratch name otherwise (invalid or reserved — placement is the
 *  same under any name). */
function previewName() {
  const n = form.name.trim();
  if (NAME_RE.test(n) && !caps().reservedNames.includes(n)) return n;
  return SCRATCH_NAME;
}

/** One-slide synthetic deck: minimal frontmatter, the layout under test, and
 *  sections.min placeholder sections — or, for the bases that read specific
 *  content, the smallest honest specimen of it. */
function syntheticSource(name, def, entry) {
  const lines = [
    '---',
    'title: Layout preview',
    '---',
    '',
    '# Placeholder heading',
    '',
    `<!-- layout: ${name} -->`,
    '',
  ];
  const n = def.sections?.min ?? entry?.sections?.min ?? 0;
  if (n > 0) {
    for (let k = 1; k <= n; k++)
      lines.push(`## Placeholder ${k}`, '', '- A short bullet', '- Another short bullet', '');
  } else {
    lines.push(...bodyFor(entry ? rootBaseOf(entry) : 'content'));
  }
  return lines.join('\n');
}

function bodyFor(root) {
  switch (root) {
    case 'metrics':
      return [
        ':::metric',
        '64 %',
        'Placeholder measure',
        '↑ +12 pts',
        ':::',
        '',
        ':::metric',
        '7',
        'Second measure',
        '→ stable',
        ':::',
        '',
      ];
    case 'quote':
      return ['> A short placeholder quotation, kept to a single line.', '>', '> — Placeholder', ''];
    case 'table':
      return [
        '| Column | Column | Column |',
        '|:-------|:------:|-------:|',
        '| Alpha  | 12     | 34 %   |',
        '| Beta   | 7      | 58 %   |',
        '',
      ];
    case 'code':
      return ['```js', 'const placeholder = true;', 'export default placeholder;', '```', ''];
    case 'chart':
      return ['```chart', 'type: bar', 'categories: Q1, Q2, Q3', 'Placeholder: 8, 12, 15', '```', ''];
    case 'diagram':
      return ['```mermaid', 'graph LR', '  A[Start] --> B[Finish]', '```', ''];
    case 'split':
      return ['![large](lucide:palette)', '', '- A short bullet', '- Another short bullet', ''];
    case 'cover':
    case 'section':
    case 'hero':
      return ['A short placeholder line under the title.', ''];
    case 'focus':
      return ['One short key message.', ''];
    // `hierarchy` is the one diagram family that declares no section bounds,
    // so it lands here rather than taking the "##" branch above — and a tree
    // previewed with one level would show nothing of what it is for.
    case 'hierarchy':
      return [
        '- Placeholder root',
        '  - First branch',
        '    - A leaf',
        '  - Second branch',
        '',
      ];
    default:
      return ['A short placeholder paragraph.', '', '- A short bullet', '- Another short bullet', ''];
  }
}

function previewBody() {
  const s = ctx.store.get();
  const entry = baseEntry();
  const name = previewName();
  const def = { ...buildDef(name), name };
  const layouts = [];
  for (const [n, d] of s.layouts) {
    if (n !== name && n !== form.editingName) layouts.push(d);
  }
  layouts.push(def);
  const body = { source: syntheticSource(name, def, entry), layouts };
  if (s.theme) body.theme = s.theme;
  return body;
}

function schedulePreview() {
  if (view !== 'form') return;
  clearTimeout(pvTimer);
  clearTimeout(pvRetry);
  pvTimer = setTimeout(pumpPreview, PREVIEW_DEBOUNCE_MS);
}

async function pumpPreview() {
  if (!ctx || view !== 'form' || !form) return;
  if (pvInflight) {
    pvQueued = true;
    return;
  }
  pvInflight = true;
  try {
    const result = await ctx.api.compile(previewBody());
    paintPreview(result);
  } catch (e) {
    if (isSuperseded(e)) {
      // a shell compile outran this one (latest-wins server): retry once
      clearTimeout(pvRetry);
      pvRetry = setTimeout(pumpPreview, PREVIEW_RETRY_MS);
    } else if (ctx) {
      setPreviewStatus(e?.message ?? 'Compile failed');
      if (e?.message && e.message !== lastToastedError) {
        lastToastedError = e.message;
        ctx.ui.toast(e.message, 'error');
      }
    }
  } finally {
    pvInflight = false;
    if (pvQueued) {
      pvQueued = false;
      if (ctx && view === 'form') pumpPreview();
    }
  }
}

function paintPreview(result) {
  if (!frame || view !== 'form') return;
  // the frontmatter always synthesizes a cover as slide 1 — the layout under
  // test is the LAST slide of the synthetic deck
  postFrame({
    type: 'render',
    slide: result.slides[result.slides.length - 1] ?? '',
    css: result.css,
    fontsCss: result.fontsCss,
  });
  setPreviewStatus(result.slides.length ? '' : 'Nothing to render for this layout.');
  paintDiags(result.diagnostics ?? []);
}

function setPreviewStatus(msg) {
  if (!pvStatus) return;
  pvStatus.textContent = msg;
  pvStatus.hidden = !msg;
}

function paintDiags(diags) {
  if (!pvDiags) return;
  if (!diags.length) {
    pvDiags.replaceChildren();
    pvDiags.hidden = true;
    return;
  }
  pvDiags.hidden = false;
  const shown = diags.slice(0, 8);
  pvDiags.replaceChildren(
    ...shown.map((d) =>
      el('li', { class: `p-layouts-diag sev-${d.severity}` }, [
        el('span', { class: 'p-layouts-diag-code', text: d.code ?? d.severity }),
        el('span', { text: d.message ?? '' }),
      ]),
    ),
    diags.length > shown.length
      ? el('li', { class: 'p-layouts-diag-more', text: `+ ${diags.length - shown.length} more` })
      : null,
  );
}

// ------ store subscription ---------------------------------------------------------

function onStoreChange(snap, path) {
  if (path === 'state') {
    // fresh server truth: this session's delete filters are obsolete
    syncWithState(snap.state);
    if (view === 'form') {
      // the form keeps its local edits; recheck collisions, recompile preview
      validateName();
      onFormEdited();
    } else {
      render();
    }
  } else if (view === 'list' && (path === 'dirty' || path.startsWith('layouts'))) {
    render();
  }
}

// ------ panel module ----------------------------------------------------------------

export default {
  id: 'layouts',
  label: 'Layouts',

  /**
   * @param {HTMLElement} container panel host, emptied by the router
   * @param {{store: object, api: object, compile: object, ui: object}} context
   */
  mount(container, context) {
    ctx = context;
    host = container;
    // a replaceState may have happened while unmounted — reconcile first
    syncWithState(ctx.store.get().state);
    ctx.ui.ensureStylesheet('js/panels/layouts.css');
    view = 'list';
    form = null;
    render();
    unsubStore = ctx.store.subscribe(onStoreChange);
  },

  unmount() {
    unsubStore?.();
    unsubStore = null;
    clearTimeout(pvTimer);
    clearTimeout(pvRetry);
    pvTimer = null;
    pvRetry = null;
    pvInflight = false;
    pvQueued = false;
    frame = null;
    frameReady = false;
    framePending = null;
    pvStatus = null;
    pvDiags = null;
    form = null;
    view = 'list';
    host = null;
    ctx = null;
  },

  /** '#layouts' → list, '#layouts/new' → base picker, '#layouts/<name>' →
   *  edit form for that working copy. */
  onRoute(sub) {
    if (!sub) {
      view = 'list';
      form = null;
      render();
      return;
    }
    if (sub === 'new') {
      if (view === 'form' && form?.mode === 'new') return; // base already chosen
      view = 'pick';
      form = null;
      render();
      return;
    }
    const def = ctx.store.get().layouts.get(sub);
    if (!def || typeof def.base !== 'string') {
      ctx.ui.toast(`Layout "${sub}" cannot be edited — it is missing or unreadable.`, 'error');
      gotoList();
      return;
    }
    openForm({ mode: 'edit', baseName: def.base, def });
  },
};
