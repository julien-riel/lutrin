/**
 * panels/fonts.js — the Fonts panel: the two family choices (fonts.body /
 * fonts.mono), the three embedded variants (regular / bold / italic) as
 * .ttf + .woff2 pairs living in fonts/, and the inventory of what sits on
 * disk. Uploads and deletes hit the API immediately; the theme's
 * fonts.files declaration is a working-copy edit that Save kit persists.
 *
 * The server suppresses kit-changed for its own writes, so after an upload
 * or a delete this panel refreshes its view of fonts/ itself (one GET
 * /api/state kept panel-local — never store.replaceState, which is the
 * shell's).
 */

import { ttfFamilyName } from '../ttf.js';

/** Mirrors the theme sanitizer's family filter (theme.mjs). */
const FAMILY_RE = /^[\p{L}\p{N} .,'-]{1,64}$/u;
/** Mirrors the server's upload gate (edit-server.mjs FONT_FILENAME_RE). */
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VARIANTS = ['regular', 'bold', 'italic'];
const VARIANT_LABELS = { regular: 'Regular', bold: 'Bold', italic: 'Italic' };
const PANGRAM = 'Grumpy wizards make toxic brew for the evil queen and jack.';
const NOTE_TEXT =
  "Without embedded font files, the .pptx will use a font installed on the viewer's " +
  'machine. Stick to a universal family (Arial, Georgia…) or upload the files.';

let ctx = null;
let host = null;
let unsubscribe = null;
/** The store, kept across unmounts: a delete confirmed mid-navigation must
 *  still clean the theme's variant declarations (the store outlives panels). */
let storeRef = null;
/** True while the change reaching the store came from our own family inputs
 *  — the DOM is already right, a re-render would steal the caret. */
let selfEdit = false;
/** Panel-local view of fonts/ on disk, refreshed after our own uploads and
 *  deletes; null → read snap.state.fonts.files. */
let diskFiles = null;
const uploading = new Map(); // variant → file name in flight
const previews = new Map(); // variant → {face, family, fileName} (FontFace API)
/** woff2 kit-relative path → {face, family} — previews of pairs already on
 *  disk, loaded through api.fileUrl (inert route, correct font MIME). */
const diskFaces = new Map();
let proposal = null; // {family} read from the last .ttf, differing from fonts.body
let noteEl = null;

// ------ path helpers (theme paths are relative to theme.json's directory) ----

function themeDirParts() {
  const anchor = storeRef.get().state?.themeAnchor ?? 'theme.json';
  const parts = anchor.split('/');
  parts.pop();
  return parts; // [] when theme.json sits at the kit root
}

/** Declared theme path → kit-relative path ('./fonts/X.ttf' → 'fonts/X.ttf'),
 *  or null when the path LEAVES the kit ('../../fonts/X.ttf') — mirrors
 *  kitRelOf in images.js/kit.js; a silent pop() on the empty array would map
 *  an escaping path onto an in-kit one and report a pair the compile cannot
 *  embed as fine. */
function toKitRel(declared) {
  const s = String(declared);
  if (!s || s.startsWith('/')) return null;
  const parts = themeDirParts();
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/') || null;
}

/** Kit-relative path → the path to write into the theme. */
function fromKitRel(kitRel) {
  const depth = themeDirParts().length;
  return depth ? '../'.repeat(depth) + kitRel : `./${kitRel}`;
}

// ------ disk truth ------------------------------------------------------------

const filesOnDisk = () => diskFiles ?? ctx.store.get().state?.fonts?.files ?? [];
const hasFile = (kitRel) => filesOnDisk().some((f) => f.file === kitRel);
const basename = (p) => String(p).split('/').pop();
const fmtBytes = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

async function refreshDisk() {
  if (!ctx) return;
  try {
    const st = await ctx.api.getState();
    diskFiles = st.fonts?.files ?? [];
  } catch {
    /* keep the last known list — the next state reload fixes it */
  }
}

// ------ theme edits -------------------------------------------------------------

function declareVariant(variant, kitRel) {
  ctx.store.update(`theme.fonts.files.${variant}`, fromKitRel(kitRel));
}

function clearVariant(variant) {
  const files = storeRef.get().theme?.fonts?.files;
  if (!files || typeof files[variant] !== 'string') return;
  const remaining = Object.keys(files).filter((k) => k !== variant && VARIANTS.includes(k));
  if (remaining.length) storeRef.update(`theme.fonts.files.${variant}`, undefined);
  else storeRef.update('theme.fonts.files', undefined); // never leave files: {}
}

/** Variants whose declared pair uses this kit-relative file (.ttf or twin). */
function usageOf(kitRel) {
  const files = storeRef.get().theme?.fonts?.files ?? {};
  const used = [];
  for (const v of VARIANTS) {
    if (typeof files[v] !== 'string') continue;
    const ttfRel = toKitRel(files[v]);
    if (!ttfRel) continue; // escapes the kit — matches no kit file
    if (ttfRel === kitRel || ttfRel.replace(/\.ttf$/i, '.woff2') === kitRel) used.push(v);
  }
  return used;
}

// ------ uploads -----------------------------------------------------------------

/** Family name of a FontFace fed by the woff2 already sitting on disk —
 *  created once per file, so re-renders never re-fetch. */
function diskPreviewFamily(woffRel) {
  const known = diskFaces.get(woffRel);
  if (known) return known.family;
  try {
    const family = `p-fonts-disk-${woffRel.replace(/[^A-Za-z0-9]+/g, '-')}`;
    const face = new FontFace(family, `url("${ctx.api.fileUrl(woffRel)}")`);
    document.fonts.add(face);
    face.load().catch(() => {
      /* unreadable file — the pangram falls back, the pair status says more */
    });
    diskFaces.set(woffRel, { face, family });
    return family;
  } catch {
    return null;
  }
}

/** Drop the disk previews whose file is gone (after deletes and reloads). */
function pruneDiskFaces() {
  for (const [rel, { face }] of diskFaces) {
    if (!hasFile(rel)) {
      document.fonts.delete(face);
      diskFaces.delete(rel);
    }
  }
}

function setPreview(variant, fileName, buf) {
  const old = previews.get(variant);
  if (old) document.fonts.delete(old.face);
  previews.delete(variant);
  try {
    const family = `p-fonts-preview-${variant}`;
    const face = new FontFace(family, buf);
    if (face.status === 'error') return;
    document.fonts.add(face);
    previews.set(variant, { face, family, fileName });
  } catch {
    /* unreadable woff2 — no preview; the compile diagnostics say more */
  }
}

function afterUpload(variant, name, ext, buf) {
  const snap = ctx.store.get();
  if (ext === '.ttf') {
    declareVariant(variant, `fonts/${name}`);
    const family = ttfFamilyName(buf);
    if (family && FAMILY_RE.test(family)) {
      const body = snap.theme?.fonts?.body;
      if (!body) {
        proposal = null;
        ctx.store.update('theme.fonts.body', family);
      } else proposal = family === body ? null : { family };
    }
  } else {
    setPreview(variant, name, buf);
    const declared = snap.theme?.fonts?.files?.[variant];
    const twin = `fonts/${name.replace(/\.woff2$/i, '.ttf')}`;
    if (!declared && hasFile(twin)) declareVariant(variant, twin);
    else if (declared) {
      // The variant is already declared, so nothing edited the store — yet the
      // .woff2 the main HTML preview inlines just changed on disk, and the
      // server suppresses its own kit-changed. Without this the slide preview
      // would keep the OLD font until an unrelated edit; the .ttf branch gets a
      // recompile for free through declareVariant → store.update.
      ctx.compile.runCompile('font-woff2-replace');
    }
  }
}

async function handleFiles(variant, fileList) {
  const list = [...fileList].sort(
    (a, b) => (a.name.toLowerCase().endsWith('.ttf') ? 0 : 1) - (b.name.toLowerCase().endsWith('.ttf') ? 0 : 1),
  );
  for (const file of list) {
    if (!ctx) return; // unmounted mid-flight
    const name = file.name;
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    if (ext !== '.ttf' && ext !== '.woff2') {
      ctx.ui.toast(`"${name}": only .ttf and .woff2 files can be uploaded here.`, 'error');
      continue;
    }
    if (!FILENAME_RE.test(name)) {
      ctx.ui.toast(`"${name}": use letters, digits, dots, hyphens and underscores only (no spaces).`, 'error');
      continue;
    }
    if (hasFile(`fonts/${name}`)) {
      const ok = await ctx.ui.confirmDialog(`Replace fonts/${name}?`, {
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!ok || !ctx) continue;
    }
    uploading.set(variant, name);
    render();
    try {
      const buf = await file.arrayBuffer();
      await ctx.api.putFont(name, buf);
      await refreshDisk();
      if (!ctx) return;
      afterUpload(variant, name, ext, buf);
      ctx.ui.toast(`Uploaded fonts/${name}`);
    } catch (e) {
      if (!ctx) return;
      ctx.ui.toast(e?.message ?? `Upload of ${name} failed`, 'error');
    }
    uploading.delete(variant);
    render();
  }
}

async function deleteDiskFile(entry) {
  // captured up front: a delete confirmed then outlived by the panel (the
  // user navigates mid-flight) must still clean the theme declarations that
  // point at the deleted .ttf — storeRef survives the unmount
  const { api, ui } = ctx;
  const ok = await ui.confirmDialog(
    `Delete ${entry.file} from the kit? Decks using this kit lose the embedded font.`,
    { confirmLabel: 'Delete', danger: true },
  );
  if (!ok) return;
  try {
    await api.deleteFont(basename(entry.file));
  } catch (e) {
    ui.toast(e?.message ?? 'Delete failed', 'error');
    return;
  }
  // clean the theme entries whose .ttf just went away (twin loss shows as a
  // missing-file status instead — the variant is still declared)
  const files = storeRef.get().theme?.fonts?.files ?? {};
  for (const v of VARIANTS) {
    if (typeof files[v] === 'string' && toKitRel(files[v]) === entry.file) clearVariant(v);
  }
  ui.toast(`Deleted ${entry.file}`);
  await refreshDisk();
  render();
}

// ------ rendering ----------------------------------------------------------------

function updateNote() {
  if (!noteEl || !ctx) return;
  const fonts = ctx.store.get().theme?.fonts ?? {};
  const files = fonts.files;
  const hasFiles = files !== null && typeof files === 'object' && Object.keys(files).length > 0;
  noteEl.hidden = !(typeof fonts.body === 'string' && fonts.body && !hasFiles);
}

function familyField(key, label, hint, placeholder) {
  const { el, field } = ctx.ui;
  const err = el('span', { class: 'error', hidden: true });
  const input = el('input', {
    class: 'input',
    value: ctx.store.get().theme?.fonts?.[key] ?? '',
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
    oninput: () => {
      const v = input.value;
      if (v !== '' && !FAMILY_RE.test(v)) {
        err.textContent = "Letters, digits, spaces and . , ' - only (64 characters max) — not applied.";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      selfEdit = true;
      ctx.store.update(`theme.fonts.${key}`, v === '' ? undefined : v);
      updateNote();
    },
  });
  const row = field({ label, control: input, hint, id: `p-fonts-${key}` });
  row.append(err);
  return row;
}

function familiesCard() {
  const { el } = ctx.ui;
  const children = [
    el('h3', { class: 'card-title', text: 'Families' }),
    familyField('body', 'Body family', 'Headings and running text — the name written into the .pptx.', 'Arial'),
  ];
  if (proposal) {
    children.push(
      el('div', { class: 'p-fonts-proposal' }, [
        el('span', {}, [
          'The uploaded font reports its family as ',
          el('span', { class: 'mono', text: proposal.family }),
          '.',
        ]),
        el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: `Use ${proposal.family}`,
          onclick: () => {
            const family = proposal.family;
            proposal = null;
            ctx.store.update('theme.fonts.body', family);
          },
        }),
      ]),
    );
  }
  children.push(
    familyField('mono', 'Mono family', 'Code blocks and figures.', 'Courier New'),
  );
  return el('section', { class: 'card p-fonts-families' }, children);
}

function statusRow(kind, file, note) {
  const { el } = ctx.ui;
  return el('div', { class: `p-fonts-status is-${kind}` }, [
    el('span', { class: 'mono', text: file }),
    el('span', { class: 'p-fonts-status-note', text: note }),
  ]);
}

function dropzone(variant) {
  const { el } = ctx.ui;
  const input = el('input', {
    type: 'file',
    accept: '.ttf,.woff2',
    multiple: true,
    class: 'p-fonts-input',
    'aria-label': `Upload ${VARIANT_LABELS[variant]} font files`,
  });
  input.addEventListener('change', () => {
    if (input.files?.length) handleFiles(variant, input.files);
    input.value = '';
  });
  const zone = el('div', { class: 'p-fonts-drop' }, [
    el('span', { text: 'Drop the .ttf and its .woff2 twin here, or' }),
    el('button', { class: 'btn btn-sm', type: 'button', text: 'Browse files', onclick: () => input.click() }),
    input,
  ]);
  for (const evName of ['dragenter', 'dragover']) {
    zone.addEventListener(evName, (e) => {
      e.preventDefault();
      zone.classList.add('is-drag');
    });
  }
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag');
    if (e.dataTransfer?.files?.length) handleFiles(variant, e.dataTransfer.files);
  });
  return zone;
}

function variantCard(variant) {
  const { el } = ctx.ui;
  const declared = ctx.store.get().theme?.fonts?.files?.[variant];
  const rows = [];
  let woffOnDisk = null; // kit-relative .woff2 of a declared pair, when present
  if (typeof declared === 'string') {
    const kitRel = toKitRel(declared);
    rows.push(
      el('div', { class: 'p-fonts-declared' }, [
        el('span', { class: 'mono', text: declared }),
        el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: 'Remove from theme',
          title: 'The files stay on disk',
          onclick: () => clearVariant(variant),
        }),
      ]),
    );
    if (!kitRel) {
      rows.push(
        statusRow('bad', basename(declared), 'Points outside the kit — it cannot travel with it'),
      );
    } else if (!/\.ttf$/i.test(kitRel)) {
      rows.push(statusRow('bad', basename(kitRel), 'Must point at a .ttf file'));
    } else {
      const woffRel = kitRel.replace(/\.ttf$/i, '.woff2');
      const ttfOk = hasFile(kitRel);
      const woffOk = hasFile(woffRel);
      if (woffOk) woffOnDisk = woffRel;
      rows.push(statusRow(ttfOk ? 'ok' : 'missing', basename(kitRel), ttfOk ? 'On disk' : 'Missing'));
      rows.push(
        statusRow(
          woffOk ? 'ok' : 'missing',
          basename(woffRel),
          woffOk ? 'On disk' : 'Missing — the HTML preview needs the .woff2 twin',
        ),
      );
    }
  } else {
    rows.push(el('p', { class: 'p-fonts-none', text: 'No file for this variant yet.' }));
  }
  const pv = previews.get(variant);
  if (pv) {
    const line = el('p', { class: 'p-fonts-preview', text: PANGRAM });
    line.style.fontFamily = `"${pv.family}"`;
    rows.push(line, el('span', { class: 'p-fonts-preview-src', text: `Preview from ${pv.fileName}` }));
  } else if (woffOnDisk) {
    const family = diskPreviewFamily(woffOnDisk);
    if (family) {
      const line = el('p', { class: 'p-fonts-preview', text: PANGRAM });
      line.style.fontFamily = `"${family}"`;
      rows.push(
        line,
        el('span', { class: 'p-fonts-preview-src', text: `Preview from ${basename(woffOnDisk)}` }),
      );
    }
  }
  const inFlight = uploading.get(variant);
  if (inFlight) {
    rows.push(
      el('div', { class: 'p-fonts-upload' }, [
        el('span', { class: 'mono', text: `Uploading ${inFlight}…` }),
        el('progress', { class: 'p-fonts-progress' }),
      ]),
    );
  } else rows.push(dropzone(variant));
  return el('section', { class: 'card p-fonts-variant', dataset: { variant } }, [
    el('h3', { class: 'card-title', text: VARIANT_LABELS[variant] }),
    ...rows,
  ]);
}

function diskCard() {
  const { el } = ctx.ui;
  const list = filesOnDisk();
  const body = list.length
    ? el(
        'ul',
        { class: 'p-fonts-file-list' },
        list.map((f) => {
          const used = usageOf(f.file);
          return el('li', { class: 'p-fonts-file' }, [
            el('span', { class: 'mono', text: basename(f.file) }),
            el('span', { class: 'p-fonts-size', text: fmtBytes(f.bytes) }),
            el('span', {
              class: used.length ? 'mono p-fonts-used' : 'p-fonts-unused',
              text: used.length ? used.join(', ') : 'Not referenced',
            }),
            el('button', {
              class: 'btn btn-sm btn-danger',
              type: 'button',
              text: 'Delete',
              onclick: () => deleteDiskFile(f),
            }),
          ]);
        }),
      )
    : el('p', {
        class: 'p-fonts-none',
        text: 'No font files yet — upload a .ttf and its .woff2 twin to embed a brand font.',
      });
  return el('section', { class: 'card p-fonts-disk' }, [
    el('h3', { class: 'card-title', text: 'Files in fonts/' }),
    body,
  ]);
}

function render() {
  if (!host || !ctx) return;
  pruneDiskFaces();
  const { el } = ctx.ui;
  if (!ctx.store.get().theme) {
    noteEl = null;
    host.replaceChildren(
      el('div', { class: 'empty' }, [
        el('h2', { class: 'empty-title', text: 'No theme yet' }),
        el('p', {
          text:
            'Font choices live in theme.json. Create the theme in the Tokens panel first, ' +
            'then come back to pick families and embed files.',
        }),
      ]),
    );
    return;
  }
  noteEl = el('div', { class: 'p-fonts-note', role: 'note' }, [
    el('strong', { text: 'No embedded font files' }),
    el('p', { text: NOTE_TEXT }),
  ]);
  updateNote();
  host.replaceChildren(
    familiesCard(),
    noteEl,
    el('div', { class: 'p-fonts-sect' }, [
      el('h3', { class: 'label', text: 'Embedded variants' }),
      el('p', {
        text:
          'Each variant is a .ttf embedded in the .pptx plus a .woff2 twin of the same ' +
          'name for the HTML.',
      }),
    ]),
    ...VARIANTS.map(variantCard),
    diskCard(),
  );
}

export default {
  id: 'fonts',
  label: 'Fonts',

  /**
   * @param {HTMLElement} container panel host, emptied by the router
   * @param {{store: object, api: object, compile: object, ui: object}} ctx
   */
  mount(container, context) {
    ctx = context;
    host = container;
    storeRef = context.store;
    ctx.ui.ensureStylesheet('js/panels/fonts.css');
    render();
    unsubscribe = ctx.store.subscribe((_snap, path) => {
      if (path === 'state') {
        diskFiles = null; // fresh server truth supersedes our local overlay
        render();
        return;
      }
      if (!path.startsWith('theme')) return;
      if (selfEdit) {
        selfEdit = false; // our own family typing — the input already shows it
        return;
      }
      render();
    });
  },

  /** '#fonts/regular' → scroll the matching variant card into view. */
  onRoute(sub) {
    if (!host || !VARIANTS.includes(sub)) return;
    host.querySelector(`[data-variant="${sub}"]`)?.scrollIntoView({ block: 'start' });
  },

  unmount() {
    unsubscribe?.();
    unsubscribe = null;
    for (const { face } of previews.values()) document.fonts.delete(face);
    previews.clear();
    for (const { face } of diskFaces.values()) document.fonts.delete(face);
    diskFaces.clear();
    uploading.clear();
    diskFiles = null;
    proposal = null;
    noteEl = null;
    selfEdit = false;
    host = null;
    ctx = null;
  },
};
