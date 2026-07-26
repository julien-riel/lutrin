/**
 * panels/kit.js — kit identity: the manifest's display metadata (editable —
 * PUT /api/manifest writes it immediately; the name is locked, it is the
 * kit's install identity), the theme's logo slots, the kit diagnostics, and
 * an export that surfaces the archive's SHA-256.
 *
 * Logo files upload through PUT /api/images (the server accepts PNG, JPEG and
 * SVG there and checks the magic bytes); the slot itself is a theme edit
 * (theme.logos.<slot>) that Save kit persists.
 */

/** Mirrors the manifest's VERSION_RE (kit.mjs). */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const META_FIELDS = [
  { key: 'version', label: 'Version', mono: true, placeholder: '1.0.0' },
  { key: 'description', label: 'Description', mono: false, placeholder: 'What this kit is' },
  { key: 'author', label: 'Author', mono: false, placeholder: '' },
  { key: 'homepage', label: 'Homepage', mono: true, placeholder: 'https://…' },
];

const LOGO_SLOTS = [
  {
    slot: 'cover',
    label: 'Cover logo',
    hint: 'PNG or JPEG — cover slides, embedded as-is in PPTX exports.',
    exts: ['.png', '.jpg', '.jpeg'],
    extsLabel: 'PNG or JPEG',
    accept: '.png,.jpg,.jpeg',
    alias: 'logo-cover',
  },
  {
    slot: 'coverSvg',
    label: 'Cover logo (SVG)',
    hint: 'SVG preferred (PNG or JPEG also accepted) — inlined in HTML exports.',
    exts: ['.svg', '.png', '.jpg', '.jpeg'],
    extsLabel: 'SVG, PNG or JPEG',
    accept: '.svg,.png,.jpg,.jpeg',
    alias: 'logo-cover-svg',
  },
  {
    slot: 'section',
    label: 'Section logo',
    hint: 'PNG or JPEG — section slides, embedded as-is in PPTX exports.',
    exts: ['.png', '.jpg', '.jpeg'],
    extsLabel: 'PNG or JPEG',
    accept: '.png,.jpg,.jpeg',
    alias: 'logo-section',
  },
  {
    slot: 'sectionSvg',
    label: 'Section logo (SVG)',
    hint: 'SVG preferred (PNG or JPEG also accepted) — inlined in HTML exports.',
    exts: ['.svg', '.png', '.jpg', '.jpeg'],
    extsLabel: 'SVG, PNG or JPEG',
    accept: '.svg,.png,.jpg,.jpeg',
    alias: 'logo-section-svg',
  },
];

let host = null;
let panelCtx = null;
let unsubscribe = null;
/** The store, kept across unmounts: the draft guard below must keep working
 *  while another panel is on screen. */
let storeRef = null;
let guardRegistered = false;
let lastSha = null; // SHA-256 of the last export in this session
/** Manifest as last written through PUT /api/manifest — the server suppresses
 *  its own kit-changed, so state.manifest stays stale until the next reload. */
let localManifest = null;
/** Unsaved metadata edits, survives the re-renders logo uploads trigger. */
let metaDraft = null;
/** kit-relative paths of logo files uploaded this session (overwrite checks —
 *  /api/state only learns them on the next reload). */
const localLogoFiles = new Set();
/** The state object the local overlays above are relative to. A replaceState
 *  that happens while this panel is UNMOUNTED must not leave them filtering
 *  fresher server truth — mount() reconciles by identity. */
let seenState = null;

function syncWithState(state) {
  if (state === seenState) return;
  seenState = state;
  localLogoFiles.clear();
  localManifest = null;
  // localLogoFiles / localManifest are overlays describing the PREVIOUS server
  // truth — stale now. metaDraft is different: it is unsaved USER INPUT, and
  // the draft guard (metaDraftChanged/hasDrafts) already shields it from an
  // external reload. "Save kit" persists theme + layouts, then replaceState()s
  // for fresh truth — an UNGUARDED reload that used to wipe half-typed metadata
  // with it. Keep the draft while it still differs from the freshly loaded
  // manifest; drop it only once nothing is left to save.
  if (metaDraft && !metaDraftChanged()) metaDraft = null;
}

/** True while the metadata form holds edits not yet written to kit.json —
 *  the shell counts this as unsaved work before a silent state reload. */
function metaDraftChanged() {
  if (!metaDraft || !storeRef) return false;
  const m = localManifest ?? storeRef.get().state?.manifest ?? null;
  if (!m) return false;
  return META_FIELDS.some((f) => String(metaDraft[f.key] ?? '').trim() !== String(m[f.key] ?? ''));
}

// ------ path helpers (duplicated from images.js — panels share no module) ----

const extOf = (name) => {
  const m = /\.[^./]+$/.exec(String(name).toLowerCase());
  return m ? m[0] : '';
};

function themeDirOf(state) {
  const anchor = state?.themeAnchor ?? 'theme.json';
  const cut = anchor.lastIndexOf('/');
  return cut === -1 ? '' : anchor.slice(0, cut);
}

/** theme-relative path → kit-relative path (null when it leaves the kit). */
function kitRelOf(state, themeRel) {
  if (typeof themeRel !== 'string' || !themeRel || themeRel.startsWith('/')) return null;
  const parts = [];
  for (const s of `${themeDirOf(state)}/${themeRel}`.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(s);
  }
  return parts.join('/') || null;
}

/** kit-relative path → the path the theme should carry (relative to theme.json). */
function themeRelOf(state, kitRel) {
  const dir = themeDirOf(state);
  if (!dir) return `./${kitRel}`;
  const dirParts = dir.split('/');
  const relParts = kitRel.split('/');
  let common = 0;
  while (common < dirParts.length && dirParts[common] === relParts[common]) common += 1;
  const ups = dirParts.length - common;
  const tail = relParts.slice(common).join('/');
  return ups ? `${'../'.repeat(ups)}${tail}` : `./${tail}`;
}

function fileOnDisk(kitRel) {
  const snap = panelCtx.store.get();
  const state = snap.state;
  if (localLogoFiles.has(kitRel)) return true;
  if (state?.orphans?.includes(kitRel)) return true;
  for (const im of state?.images ?? []) {
    if (im.exists && kitRelOf(state, im.path) === kitRel) return true;
  }
  const logos = snap.theme?.logos;
  if (logos && typeof logos === 'object' && !Array.isArray(logos)) {
    for (const v of Object.values(logos)) {
      if (typeof v === 'string' && kitRelOf(state, v) === kitRel) return true;
    }
  }
  return false;
}

// ------ actions ---------------------------------------------------------------

async function uploadLogo(cfg, file) {
  const { ui, api, store } = panelCtx;
  const ext = extOf(file.name);
  if (!cfg.exts.includes(ext)) {
    ui.toast(`${cfg.label} takes ${cfg.extsLabel}.`, 'error');
    return;
  }
  const state = store.get().state;
  const fileName = `${cfg.alias}${ext}`;
  const kitRel = `images/${fileName}`;
  if (fileOnDisk(kitRel)) {
    const ok = await ui.confirmDialog(`Replace the existing file ${kitRel}?`, {
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await api.putImage(fileName, file);
  } catch (e) {
    ui.toast(e?.message ?? 'Upload failed', 'error');
    return;
  }
  localLogoFiles.add(kitRel);
  const creatingTheme = !store.get().theme;
  store.update(['theme', 'logos', cfg.slot], themeRelOf(state, kitRel));
  ui.toast(`${cfg.label} updated — save the kit to keep it.`);
  if (creatingTheme) ui.toast('A theme.json will be created when you save the kit.', 'info');
}

function clearLogo(cfg) {
  panelCtx.store.update(['theme', 'logos', cfg.slot], undefined);
  panelCtx.ui.toast(`${cfg.label} cleared — save the kit to keep it.`);
}

async function doExport(btn, shaLine, shaValue) {
  const { ui, api, store } = panelCtx;
  btn.disabled = true;
  try {
    const { blob, sha256, filename } = await api.exportKit();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `${store.get().state?.name ?? 'kit'}.deckkit`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    lastSha = sha256;
    shaValue.textContent = sha256 ?? '';
    shaLine.hidden = !sha256;
    ui.toast('Kit exported');
    if (!sha256) ui.toast('The export worked but its checksum header was missing.', 'info');
  } catch (e) {
    ui.toast(e?.message ?? 'Export failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ------ rendering ----------------------------------------------------------------

function metaRow(label, value, { mono = true, note = null } = {}) {
  const { el } = panelCtx.ui;
  return el('div', { class: 'p-kit-row' }, [
    el('span', { class: 'p-kit-key', text: label }),
    el('span', { class: 'p-kit-val' }, [
      el('span', { class: mono ? 'mono' : false, text: value || '—' }),
      note ? el('span', { class: 'p-kit-note', text: note }) : null,
    ]),
  ]);
}

/** The manifest the card edits: the last PUT's echo wins over stale state. */
function currentManifest() {
  return localManifest ?? panelCtx.store.get().state?.manifest ?? null;
}

function metaError(key, value) {
  if (key === 'version' && value !== '' && !VERSION_RE.test(value))
    return 'A version looks like "1.0.0" (an optional suffix like "-beta.2" is fine).';
  return null;
}

function manifestCard() {
  const { el, field } = panelCtx.ui;
  const m = currentManifest();
  if (!m) {
    return el('div', { class: 'card' }, [
      el('h3', { class: 'card-title', text: 'Kit metadata' }),
      el('p', {
        class: 'p-kit-note',
        text: 'No readable kit.json — this folder is not a valid kit yet. The diagnostics below tell the story.',
      }),
    ]);
  }

  const saved = {};
  for (const f of META_FIELDS) saved[f.key] = m[f.key] ?? '';
  if (!metaDraft) metaDraft = { ...saved };

  const saveBtn = el('button', {
    class: 'btn btn-primary btn-sm',
    type: 'button',
    text: 'Save metadata',
    disabled: true,
  });
  const errLines = {};
  const paint = () => {
    let changed = false;
    let invalid = false;
    for (const f of META_FIELDS) {
      const v = metaDraft[f.key];
      if (v.trim() !== saved[f.key]) changed = true;
      const msg = metaError(f.key, v.trim());
      errLines[f.key].textContent = msg ?? '';
      errLines[f.key].hidden = !msg;
      if (msg) invalid = true;
    }
    saveBtn.disabled = !changed || invalid;
  };
  const rows = META_FIELDS.map((f) => {
    const input = el(f.key === 'description' ? 'textarea' : 'input', {
      class: `${f.key === 'description' ? 'textarea' : 'input'}${f.mono ? ' mono' : ''}`,
      placeholder: f.placeholder,
      spellcheck: f.mono ? 'false' : false,
      rows: f.key === 'description' ? '2' : false,
      oninput: (e) => {
        metaDraft[f.key] = e.target.value;
        paint();
      },
    });
    input.value = metaDraft[f.key];
    errLines[f.key] = el('span', { class: 'error', hidden: true });
    const row = field({ label: f.label, control: input, id: `p-kit-meta-${f.key}` });
    row.append(errLines[f.key]);
    return row;
  });
  saveBtn.addEventListener('click', async () => {
    // captured up front: the PUT must land its echo (localManifest) and its
    // toast even when the user leaves the panel while it is in flight
    const { api, ui } = panelCtx;
    const body = {};
    for (const f of META_FIELDS) body[f.key] = metaDraft[f.key].trim();
    saveBtn.disabled = true;
    try {
      const res = await api.putManifest(body);
      localManifest = res.manifest;
      metaDraft = null;
      ui.toast('Kit metadata saved');
      render();
    } catch (e) {
      ui.toast(e?.message ?? 'Saving the metadata failed', 'error');
      paint(); // still changed — let the user retry
    }
  });
  paint();

  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Kit metadata' }),
    metaRow('Name', m.name, { note: 'The kit name is its install identity — it cannot change.' }),
    ...rows,
    el('div', { class: 'p-kit-meta-actions' }, [saveBtn]),
    metaRow('File', 'kit.json'),
  ]);
}

function logoRow(cfg) {
  const { el } = panelCtx.ui;
  const snap = panelCtx.store.get();
  const raw = snap.theme?.logos?.[cfg.slot];
  const current = typeof raw === 'string' ? raw : null;
  const kitRel = current ? kitRelOf(snap.state, current) : null;
  const fileInput = el('input', {
    type: 'file',
    accept: cfg.accept,
    class: 'p-kit-file',
    onchange: (e) => {
      const f = e.target.files?.[0];
      if (f) uploadLogo(cfg, f);
      e.target.value = '';
    },
  });
  const thumb = el('div', { class: 'p-kit-logo-thumb' });
  if (kitRel) {
    thumb.append(
      el('img', {
        src: panelCtx.api.fileUrl(kitRel),
        alt: '',
        onerror: (e) => e.target.setAttribute('hidden', ''),
      }),
    );
  }
  return el('div', { class: 'p-kit-logo' }, [
    thumb,
    el('div', { class: 'p-kit-logo-info' }, [
      el('span', { class: 'label', text: cfg.label }),
      current
        ? el('span', { class: 'mono p-kit-logo-path', text: current })
        : el('span', { class: 'p-kit-logo-unset', text: 'Not set' }),
      el('span', { class: 'p-kit-note', text: cfg.hint }),
    ]),
    el('div', { class: 'p-kit-logo-actions' }, [
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: current ? 'Replace' : 'Upload',
        onclick: () => fileInput.click(),
      }),
      current
        ? el('button', {
            class: 'btn btn-sm',
            type: 'button',
            text: 'Clear',
            onclick: () => clearLogo(cfg),
          })
        : null,
      fileInput,
    ]),
  ]);
}

function logosCard() {
  const { el } = panelCtx.ui;
  const snap = panelCtx.store.get();
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Logos' }),
    snap.theme
      ? null
      : el('p', {
          class: 'p-kit-note',
          text: 'This kit has no theme.json yet — uploading a logo creates one, saved with the kit.',
        }),
    ...LOGO_SLOTS.map((cfg) => logoRow(cfg)),
  ]);
}

function diagnosticsCard() {
  const { el } = panelCtx.ui;
  const diags = panelCtx.store.get().state?.kitDiagnostics ?? [];
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Kit diagnostics' }),
    diags.length
      ? el(
          'ul',
          { class: 'p-kit-diags' },
          diags.map((d) =>
            el('li', { class: `p-kit-diag is-${d.severity}` }, [
              el('span', { class: 'p-kit-dot', 'aria-hidden': 'true' }),
              el('span', { class: 'mono p-kit-code', text: d.code ?? d.severity }),
              el('span', { text: d.message ?? '' }),
            ]),
          ),
        )
      : el('p', { class: 'p-kit-note', text: 'No kit diagnostics.' }),
  ]);
}

function exportCard() {
  const { el } = panelCtx.ui;
  const shaValue = el('span', { class: 'mono p-kit-sha-val', text: lastSha ?? '' });
  const shaLine = el('p', { class: 'p-kit-sha', hidden: !lastSha }, [
    el('span', { class: 'label', text: 'SHA-256' }),
    shaValue,
  ]);
  const btn = el('button', { class: 'btn', type: 'button', text: 'Export .deckkit' });
  btn.addEventListener('click', () => doExport(btn, shaLine, shaValue));
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Export' }),
    el('p', {
      class: 'p-kit-note',
      text: 'Pack the kit into a single .deckkit file, ready to install anywhere.',
    }),
    btn,
    shaLine,
  ]);
}

function render() {
  if (!host) return;
  host.replaceChildren(manifestCard(), logosCard(), diagnosticsCard(), exportCard());
}

export default {
  id: 'kit',
  label: 'Kit',

  /**
   * @param {HTMLElement} container panel host, emptied by the router
   * @param {{store: object, api: object, compile: object, ui: object}} ctx
   */
  mount(container, ctx) {
    host = container;
    panelCtx = ctx;
    storeRef = ctx.store;
    if (!guardRegistered) {
      guardRegistered = true;
      ctx.store.registerDraftGuard(metaDraftChanged);
    }
    // a replaceState may have happened while unmounted — reconcile first
    syncWithState(ctx.store.get().state);
    ctx.ui.ensureStylesheet('js/panels/kit.css');
    render();
    unsubscribe = ctx.store.subscribe((_snap, path) => {
      if (path === 'state') {
        // fresh server truth — the local overlays are obsolete
        syncWithState(ctx.store.get().state);
        render();
      } else if (path.startsWith('theme')) {
        render();
      }
    });
  },

  unmount() {
    unsubscribe?.();
    unsubscribe = null;
    host = null;
    panelCtx = null;
  },
};
