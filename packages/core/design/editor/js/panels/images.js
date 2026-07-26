/**
 * panels/images.js — the Images panel: every image the theme names (working
 * copy first), an upload flow that ends in an alias, the orphan files sitting
 * in images/, and a throwaway one-slide preview for any alias.
 *
 * Binary writes (upload, file delete) hit the API immediately; alias edits
 * only touch the working theme — Save kit persists them. Fresh uploads and
 * deletions are remembered locally (localBytes / locallyDeleted) because the
 * server suppresses its own watcher events: /api/state only catches up on
 * the next reload, and these caches bridge the gap (kept across remounts,
 * reconciled whenever a fresh state arrives).
 */

const ALIAS_RE = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED_ALIASES = new Set(['constructor', 'prototype', '__proto__']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

let host = null;
let panelCtx = null;
let unsubscribe = null;
let guardRegistered = false;

/** Upload (or orphan adoption) waiting for its alias. `alias` carries what
 *  the user typed, so a re-render never resets the field to the suggestion. */
let naming = null; // { file: File|null, orphan: string|null, fileName, ext, size, alias: string|null }
let renaming = null; // alias whose card shows the rename form
let focusPending = false;

/** kit-relative path → bytes for files uploaded this session. */
const localBytes = new Map();
/** kit-relative paths deleted this session and still listed by the state. */
const locallyDeleted = new Set();
/** The state object the caches above are relative to. A replaceState that
 *  happens while this panel is UNMOUNTED must not leave them filtering
 *  fresher server truth — mount() reconciles by identity. */
let seenState = null;

function syncWithState(state) {
  if (state === seenState) return;
  seenState = state;
  localBytes.clear();
  locallyDeleted.clear();
}

// ------ path helpers (theme-relative ⇄ kit-relative) -------------------------

const extOf = (name) => {
  const m = /\.[^./]+$/.exec(String(name).toLowerCase());
  return m ? m[0] : '';
};

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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

// ------ alias rules -----------------------------------------------------------

function aliasError(alias, taken) {
  if (!ALIAS_RE.test(alias))
    return 'Use lowercase letters, digits and hyphens — start with a letter, 2 to 32 characters.';
  if (RESERVED_ALIASES.has(alias)) return `"${alias}" is a reserved word — pick another alias.`;
  if (taken.has(alias)) return `Alias "${alias}" is already taken.`;
  return null;
}

function suggestAlias(fileName, taken) {
  let base = String(fileName)
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  if (!/^[a-z]/.test(base)) base = base ? `img-${base}`.slice(0, 32) : 'image';
  if (base.length < 2) base = 'image';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate) || RESERVED_ALIASES.has(candidate)) {
    const suffix = `-${n}`;
    n += 1;
    candidate = base.slice(0, 32 - suffix.length) + suffix;
  }
  return candidate;
}

// ------ working copy ----------------------------------------------------------

function workingEntries(theme) {
  const out = [];
  const images = theme?.images;
  if (images && typeof images === 'object' && !Array.isArray(images)) {
    for (const [alias, p] of Object.entries(images)) {
      if (typeof p === 'string') out.push({ alias, path: p });
    }
  }
  return out;
}

// ------ actions -----------------------------------------------------------------

function startNaming(file) {
  const ext = extOf(file.name);
  if (!IMAGE_EXTS.has(ext)) {
    panelCtx.ui.toast('Only PNG, JPEG, GIF, WebP or SVG images can join a kit.', 'error');
    return;
  }
  naming = { file, orphan: null, fileName: file.name, ext, size: file.size, alias: null };
  renaming = null;
  focusPending = true;
  render();
}

function startOrphanNaming(orphanPath) {
  const base = orphanPath.split('/').pop();
  naming = {
    file: null,
    orphan: orphanPath,
    fileName: orphanPath,
    ext: extOf(base),
    size: null,
    alias: null,
  };
  renaming = null;
  focusPending = true;
  render();
}

async function copyMarkdown(alias) {
  const snippet = `![](kit:${alias})`;
  try {
    await navigator.clipboard.writeText(snippet);
    panelCtx.ui.toast(`Copied ${snippet}`);
  } catch {
    panelCtx.ui.toast(`Clipboard blocked — the snippet is ${snippet}`, 'error');
  }
}

async function deleteEntry(entry, exists, kitRel) {
  const { ui, api, store } = panelCtx;
  const deletable = Boolean(exists && kitRel && /^images\/[^/]+$/.test(kitRel));
  const message = deletable
    ? `Delete image "${entry.alias}"? The file ${kitRel} is removed from disk now; the alias removal is saved with the kit.`
    : `Remove alias "${entry.alias}"? No file is deleted.`;
  const ok = await ui.confirmDialog(message, {
    confirmLabel: deletable ? 'Delete' : 'Remove',
    danger: true,
  });
  if (!ok) return;
  if (deletable) {
    try {
      await api.deleteImage(kitRel.slice('images/'.length));
      localBytes.delete(kitRel);
      locallyDeleted.add(kitRel);
    } catch (e) {
      if (e?.status !== 404) {
        ui.toast(e?.message ?? 'Delete failed', 'error');
        return;
      }
    }
  }
  store.update(['theme', 'images', entry.alias], undefined);
  ui.toast(`Image "${entry.alias}" removed`);
}

async function deleteOrphan(orphanPath) {
  const { ui, api } = panelCtx;
  const ok = await ui.confirmDialog(`Delete ${orphanPath} from disk?`, {
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteImage(orphanPath.split('/').pop());
    localBytes.delete(orphanPath);
    locallyDeleted.add(orphanPath);
    ui.toast(`${orphanPath} deleted`);
    render();
  } catch (e) {
    ui.toast(e?.message ?? 'Delete failed', 'error');
  }
}

// ------ one-slide preview -------------------------------------------------------

function slideDocOf(result) {
  // Compiler output into a sandboxed, opaque-origin frame — the same CSP and
  // isolation recipe as the shell's preview iframe.
  const slide = result.slides[result.slides.length - 1] ?? '';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ',
    'img-src data:; font-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">',
    '<style>html,body{margin:0;background:#EDECE8}',
    '.wrap{height:calc(var(--s,.5)*720px);overflow:hidden}',
    '.box{width:1280px;height:720px;transform:scale(var(--s,.5));transform-origin:0 0;',
    'overflow:hidden;background:#fff}</style>',
    `<style>${result.fontsCss ?? ''}</style>`,
    `<style>${result.css ?? ''}</style>`,
    '</head><body><div class="wrap"><div class="box">',
    slide,
    '</div></div><script>',
    'function fit(){document.documentElement.style.setProperty("--s",',
    'String(document.documentElement.clientWidth/1280))}',
    'window.addEventListener("resize",fit);fit();',
    '</script></body></html>',
  ].join('');
}

function openSlideDialog(alias, result) {
  const { el } = panelCtx.ui;
  const frame = document.createElement('iframe');
  frame.className = 'p-images-preview-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', `Preview of kit:${alias}`);
  frame.srcdoc = slideDocOf(result);
  const close = el('button', { class: 'btn', type: 'button', text: 'Close' });
  const dialog = el('dialog', { class: 'dialog p-images-preview-dialog' }, [
    el('p', { class: 'p-images-preview-title' }, [
      'A split slide placing ',
      el('span', { class: 'mono', text: `kit:${alias}` }),
    ]),
    frame,
    el('div', { class: 'dialog-actions' }, [close]),
  ]);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

async function previewInSlide(alias, btn) {
  const { api, store, ui } = panelCtx;
  const s = store.get();
  const source = [
    '# Image preview',
    '',
    '<!-- layout: split -->',
    '',
    `![right](kit:${alias})`,
    '',
    `- The visual on the right is kit:${alias}, in the right role`,
    '- Other alt roles: cover, left and background',
    '- The slide uses the kit theme and fonts',
  ].join('\n');
  const body = { source, layouts: [...s.layouts.values()] };
  if (s.theme) body.theme = s.theme;
  btn.disabled = true;
  try {
    const result = await api.compile(body);
    if (!panelCtx) return; // unmounted mid-compile — drop the dialog
    openSlideDialog(alias, result);
  } catch (e) {
    if (api.isSuperseded(e))
      ui.toast('Preview was superseded by a newer compile — try again.', 'info');
    else ui.toast(e?.message ?? 'Preview failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ------ rendering ----------------------------------------------------------------

function renderHelpCard() {
  const { el } = panelCtx.ui;
  return el('div', { class: 'card p-images-help' }, [
    el('h3', { class: 'card-title', text: 'Using kit images in a deck' }),
    el('ul', { class: 'p-images-help-list' }, [
      el('li', {}, [el('span', { class: 'mono', text: '![](kit:alias)' }), ' places the image on the slide.']),
      el('li', {}, [
        'Alt roles pick the placement: ',
        el('span', { class: 'mono', text: 'cover' }),
        ', ',
        el('span', { class: 'mono', text: 'left' }),
        ', ',
        el('span', { class: 'mono', text: 'right' }),
        ' or ',
        el('span', { class: 'mono', text: 'background' }),
        '.',
      ]),
      el('li', {}, ['Aliases are saved in the theme; the files travel inside the kit.']),
    ]),
  ]);
}

function renderNamingCard(taken, knownFiles) {
  const { el, field } = panelCtx.ui;
  const input = el('input', {
    class: 'input mono p-images-focus',
    value: naming.alias ?? suggestAlias(naming.fileName.split('/').pop(), taken),
    spellcheck: 'false',
  });
  const errorLine = el('span', { class: 'p-images-error' });
  const addBtn = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: naming.file ? 'Add image' : 'Add alias',
  });
  const cancelBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Cancel',
    onclick: () => {
      naming = null;
      render();
    },
  });
  const check = () => {
    const msg = aliasError(input.value.trim(), taken);
    errorLine.textContent = msg ?? '';
    addBtn.disabled = Boolean(msg);
    return !msg;
  };
  async function commit() {
    if (!check()) return;
    // captured up front: an upload that outlives the panel (the user
    // navigates mid-flight) must still write its alias and toast — the
    // store outlives every panel, panelCtx does not
    const { store, api, ui } = panelCtx;
    const alias = input.value.trim();
    const state = store.get().state;
    const pending = naming;
    addBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      let kitRel;
      if (pending.file) {
        kitRel = `images/${alias}${pending.ext}`;
        if (knownFiles.has(kitRel)) {
          const ok = await ui.confirmDialog(`Replace the existing file ${kitRel}?`, {
            confirmLabel: 'Replace',
            danger: true,
          });
          if (!ok) {
            addBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
          }
        }
        const put = await api.putImage(`${alias}${pending.ext}`, pending.file);
        localBytes.set(kitRel, put.bytes ?? pending.size ?? 0);
        locallyDeleted.delete(kitRel);
      } else {
        kitRel = pending.orphan;
      }
      const creatingTheme = !store.get().theme;
      if (naming === pending) naming = null;
      store.update(['theme', 'images', alias], themeRelOf(state, kitRel));
      ui.toast(`Image "${alias}" ready — place it with ![](kit:${alias})`);
      if (creatingTheme) ui.toast('A theme.json will be created when you save the kit.', 'info');
    } catch (e) {
      ui.toast(e?.message ?? 'Upload failed', 'error');
      addBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  }
  input.addEventListener('input', () => {
    naming.alias = input.value;
    check();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  addBtn.addEventListener('click', commit);
  check();
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: naming.file ? 'Name the new image' : 'Name this file' }),
    el('p', { class: 'p-images-name-file' }, [
      el('span', { class: 'mono', text: naming.fileName }),
      naming.size != null ? el('span', { class: 'p-images-note-inline', text: formatBytes(naming.size) }) : null,
    ]),
    field({
      label: 'Alias',
      control: input,
      hint: 'Lowercase letters, digits and hyphens — 2 to 32 characters, starting with a letter. "constructor" and "prototype" are reserved.',
    }),
    errorLine,
    el('div', { class: 'p-images-name-actions' }, [addBtn, cancelBtn]),
  ]);
}

function renderUploadCard(taken, knownFiles) {
  const { el } = panelCtx.ui;
  if (naming) return renderNamingCard(taken, knownFiles);
  const fileInput = el('input', {
    type: 'file',
    class: 'p-images-file',
    accept: '.png,.jpg,.jpeg,.gif,.webp,.svg',
    onchange: (e) => {
      const f = e.target.files?.[0];
      if (f) startNaming(f);
      e.target.value = '';
    },
  });
  const zone = el('div', { class: 'p-images-drop' }, [
    el('p', { class: 'p-images-drop-lead', text: 'Drop an image here' }),
    el('p', { class: 'p-images-drop-sub', text: 'PNG, JPEG, GIF, WebP or SVG — 15 MB at most' }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: 'Choose image',
      onclick: () => fileInput.click(),
    }),
    fileInput,
  ]);
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) startNaming(f);
  });
  return el('div', { class: 'card' }, [
    el('h3', { class: 'card-title', text: 'Add an image' }),
    zone,
  ]);
}

function renameCard(entry, taken) {
  const { el } = panelCtx.ui;
  const others = new Set(taken);
  others.delete(entry.alias);
  const input = el('input', {
    class: 'input mono p-images-focus',
    value: entry.alias,
    spellcheck: 'false',
  });
  const errorLine = el('span', { class: 'p-images-error' });
  const save = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Rename' });
  const cancel = el('button', {
    class: 'btn btn-sm',
    type: 'button',
    text: 'Cancel',
    onclick: () => {
      renaming = null;
      render();
    },
  });
  const check = () => {
    const v = input.value.trim();
    const msg = v === entry.alias ? null : aliasError(v, others);
    errorLine.textContent = msg ?? '';
    save.disabled = Boolean(msg);
    return !msg;
  };
  const commit = () => {
    if (!check()) return;
    const next = input.value.trim();
    renaming = null;
    if (next === entry.alias) {
      render();
      return;
    }
    panelCtx.store.update(['theme', 'images', next], entry.path);
    panelCtx.store.update(['theme', 'images', entry.alias], undefined);
    panelCtx.ui.toast(`Alias renamed — decks now use kit:${next}`);
  };
  input.addEventListener('input', check);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      renaming = null;
      render();
    }
  });
  save.addEventListener('click', commit);
  check();
  return el('div', { class: 'p-images-card' }, [
    el('span', { class: 'label', text: 'Rename alias' }),
    input,
    errorLine,
    el('div', { class: 'p-images-actions' }, [save, cancel]),
  ]);
}

function imageCard(entry, infoByPath, knownFiles, taken) {
  const { el } = panelCtx.ui;
  if (renaming === entry.alias) return renameCard(entry, taken);
  const state = panelCtx.store.get().state;
  const kitRel = kitRelOf(state, entry.path);
  const info = infoByPath.get(entry.path);
  const exists = info ? info.exists : Boolean(kitRel && knownFiles.has(kitRel));
  const bytes = info?.bytes ?? (kitRel ? (localBytes.get(kitRel) ?? null) : null);
  const ext = extOf(entry.path);

  const thumb = el('div', { class: 'p-images-thumb' });
  if (exists && kitRel) {
    thumb.append(
      el('img', {
        src: panelCtx.api.fileUrl(kitRel),
        alt: entry.alias,
        loading: 'lazy',
        onerror: (e) => e.target.setAttribute('hidden', ''),
      }),
    );
  }

  const meta = [el('span', { text: ext ? ext.slice(1).toUpperCase() : 'file' })];
  if (exists && bytes != null) meta.push(el('span', { text: formatBytes(bytes) }));
  if (!exists) meta.push(el('span', { class: 'p-images-missing', text: 'Missing file' }));

  const previewBtn = el('button', {
    class: 'btn btn-sm',
    type: 'button',
    text: 'Preview in a slide',
    disabled: !exists,
    title: exists ? false : 'The image file is missing',
  });
  previewBtn.addEventListener('click', () => previewInSlide(entry.alias, previewBtn));

  return el('div', { class: 'p-images-card' }, [
    thumb,
    el('span', { class: 'p-images-alias', text: entry.alias }),
    el('div', { class: 'p-images-meta' }, meta),
    el('div', { class: 'p-images-actions' }, [
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: 'Copy markdown',
        onclick: () => copyMarkdown(entry.alias),
      }),
      previewBtn,
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: 'Rename',
        onclick: () => {
          renaming = entry.alias;
          naming = null;
          focusPending = true;
          render();
        },
      }),
      el('button', {
        class: 'btn btn-danger btn-sm',
        type: 'button',
        text: 'Delete',
        onclick: () => deleteEntry(entry, exists, kitRel),
      }),
    ]),
  ]);
}

function orphanRow(orphanPath) {
  const { el } = panelCtx.ui;
  return el('div', { class: 'p-images-orphan' }, [
    el('div', { class: 'p-images-orphan-thumb' }, [
      el('img', {
        src: panelCtx.api.fileUrl(orphanPath),
        alt: '',
        loading: 'lazy',
        onerror: (e) => e.target.setAttribute('hidden', ''),
      }),
    ]),
    el('span', { class: 'mono p-images-orphan-path', text: orphanPath }),
    el('button', {
      class: 'btn btn-sm',
      type: 'button',
      text: 'Add alias',
      onclick: () => startOrphanNaming(orphanPath),
    }),
    el('button', {
      class: 'btn btn-danger btn-sm',
      type: 'button',
      text: 'Delete file',
      onclick: () => deleteOrphan(orphanPath),
    }),
  ]);
}

function render() {
  if (!host) return;
  const { el } = panelCtx.ui;
  const snap = panelCtx.store.get();
  const state = snap.state;
  const entries = workingEntries(snap.theme);
  const taken = new Set(entries.map((e) => e.alias));

  const infoByPath = new Map();
  for (const im of state?.images ?? []) infoByPath.set(im.path, im);

  const knownFiles = new Set(localBytes.keys());
  for (const o of state?.orphans ?? []) knownFiles.add(o);
  for (const im of state?.images ?? []) {
    if (!im.exists) continue;
    const r = kitRelOf(state, im.path);
    if (r) knownFiles.add(r);
  }
  for (const gone of locallyDeleted) knownFiles.delete(gone);

  const referenced = new Set();
  for (const e of entries) {
    const r = kitRelOf(state, e.path);
    if (r) referenced.add(r);
  }
  const orphans = (state?.orphans ?? []).filter(
    (o) => !referenced.has(o) && !locallyDeleted.has(o),
  );

  const parts = [renderUploadCard(taken, knownFiles), renderHelpCard()];
  if (entries.length) {
    parts.push(el('h3', { class: 'label p-images-section', text: `Kit images (${entries.length})` }));
    parts.push(
      el('div', { class: 'p-images-grid' }, entries.map((e) => imageCard(e, infoByPath, knownFiles, taken))),
    );
  } else {
    parts.push(
      el('div', { class: 'empty' }, [
        el('h2', { class: 'empty-title', text: 'No images yet' }),
        el('p', {}, [
          'Upload an image and give it an alias — a deck places it with ',
          el('span', { class: 'mono p-images-token', text: '![](kit:alias)' }),
          '.',
        ]),
      ]),
    );
  }
  if (orphans.length) {
    parts.push(
      el('h3', { class: 'label p-images-section', text: `Unreferenced files (${orphans.length})` }),
    );
    parts.push(
      el('p', { class: 'p-images-note', text: 'These files sit in images/ with no alias pointing at them.' }),
    );
    parts.push(el('div', { class: 'p-images-orphans' }, orphans.map((o) => orphanRow(o))));
  }
  host.replaceChildren(...parts);
  if (focusPending) {
    focusPending = false;
    const f = host.querySelector('.p-images-focus');
    if (f) {
      f.focus();
      f.select?.();
    }
  }
}

export default {
  id: 'images',
  label: 'Images',

  /**
   * @param {HTMLElement} container panel host, emptied by the router
   * @param {{store: object, api: object, compile: object, ui: object}} ctx
   */
  mount(container, ctx) {
    host = container;
    panelCtx = ctx;
    if (!guardRegistered) {
      guardRegistered = true;
      // naming/rename forms are unsaved work the shell must not wipe silently
      ctx.store.registerDraftGuard(() => naming !== null || renaming !== null);
    }
    // a replaceState may have happened while unmounted — reconcile first
    syncWithState(ctx.store.get().state);
    ctx.ui.ensureStylesheet('js/panels/images.css');
    render();
    unsubscribe = ctx.store.subscribe((snap, path) => {
      if (path === 'state') {
        // fresh server truth — the local caches are stale by definition
        syncWithState(snap.state);
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
    naming = null;
    renaming = null;
    focusPending = false;
  },
};
