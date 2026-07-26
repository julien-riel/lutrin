/**
 * main.js — boot and shell wiring: state load, hash router over the panel
 * registry, Save kit / Export, the diagnostics drawer, the Compare hold and
 * the kit-changed conflict flow. Panels never touch this file (contract:
 * scratchpad ui-contract.md); they register through panels/index.js.
 */

import { api, onKitChanged } from './api.js';
import { store } from './store.js';
import * as compile from './compile.js';
import * as ui from './ui.js';
import { PANELS } from './panels/index.js';

const $ = (id) => document.getElementById(id);

/** ctx handed to every panel's mount(). */
const ctx = { store, api, compile, ui };

// ------ router --------------------------------------------------------------

const registry = new Map(PANELS.map((p) => [p.id, p]));
let currentPanel = null;
let currentId = null;

function placeholderPanel(id) {
  const label = id.charAt(0).toUpperCase() + id.slice(1);
  return {
    id,
    label,
    mount(container) {
      container.replaceChildren(
        ui.el('div', { class: 'empty' }, [
          ui.el('h2', { class: 'empty-title', text: label }),
          ui.el('p', { text: 'This panel has not landed yet.' }),
        ]),
      );
    },
    unmount() {},
  };
}

function route() {
  const hash = (location.hash || '#tokens').slice(1);
  const [id, ...rest] = hash.split('/');
  const sub = rest.join('/');
  if (id === currentId && currentPanel) {
    currentPanel.onRoute?.(sub);
    paintRail(id);
    return;
  }
  currentPanel?.unmount?.();
  const host = $('panel-host');
  host.replaceChildren();
  currentPanel = registry.get(id) ?? placeholderPanel(id);
  currentId = id;
  currentPanel.mount(host, ctx);
  if (sub) currentPanel.onRoute?.(sub);
  paintRail(id);
}

function paintRail(activeId) {
  for (const item of document.querySelectorAll('.rail-item'))
    item.classList.toggle('is-active', item.dataset.panel === activeId);
}

// ------ topbar: name, dirty, save, export ------------------------------------

function paintShell() {
  const s = store.get();
  $('kit-name').textContent = s.state?.name ?? '…';
  const dirty = store.isDirty();
  $('dirty-indicator').hidden = !dirty;
  $('btn-save').disabled = !dirty;
  $('conflict-banner').hidden = !s.conflict;
  $('btn-compare').disabled = !s.savedSnapshot;
}

async function saveKit() {
  if (!store.isDirty()) return;
  const btn = $('btn-save');
  btn.disabled = true;
  try {
    const s = store.get();
    // the writes answer 200 with diagnostics for values the compiler will
    // ignore (a pre-existing junk key round-tripped by Save) — surface them
    let warnings = 0;
    const count = (res) =>
      (res?.diagnostics ?? []).filter((d) => d.severity !== 'info').length;
    if (s.dirty.theme.size && s.theme) warnings += count(await api.putTheme(s.theme));
    for (const name of s.dirty.layouts) {
      const def = s.layouts.get(name);
      if (def) warnings += count(await api.putLayout(name, def));
    }
    store.replaceState(await api.getState());
    compile.markSavedNow(); // the compiled working copies ARE the saved state now
    if (warnings)
      ui.toast(
        `Kit saved — ${warnings} warning${warnings === 1 ? '' : 's'}, see Diagnostics`,
        'info',
      );
    else ui.toast('Kit saved');
  } catch (e) {
    ui.toast(e?.message ?? 'Save failed', 'error');
    paintShell(); // re-enable Save: the kit is still dirty
  }
}

// ------ diagnostics drawer ----------------------------------------------------

/** Panel a diagnostic points at — drives the drawer's click-through.
 *  Takes the message too: the core lumps token, font and image theme problems
 *  under one code (THEME_BAD_VALUE — no code ever contains "FONT"), so only the
 *  message tells a fonts.files.* or images.* problem from a plain token one. */
function targetOf(code, message = '') {
  const c = String(code ?? '').toUpperCase();
  const m = String(message ?? '');
  if (c.startsWith('LAYOUT')) return 'layouts';
  if (c.includes('IMAGE') || c.includes('IMG')) return 'images';
  if (c.includes('FONT')) return 'fonts';
  // THEME_BAD_VALUE carries fonts.files.*, images.* and token problems alike —
  // route the two that own a panel by their message domain, the rest to Tokens.
  if (c === 'THEME_BAD_VALUE') {
    if (/\bfonts\.files\b/.test(m)) return 'fonts';
    if (/\bimages\b/.test(m)) return 'images';
    return 'tokens';
  }
  if (c.startsWith('THEME') || c.includes('CONTRAST') || c.includes('SHADE')) return 'tokens';
  if (c.startsWith('KIT')) return 'kit';
  return null; // deck-content diagnostics (specimen) — informative, no panel
}

/** Deep link inside the target panel, when the message names one
 *  ("fonts.files.bold" → #fonts/bold — the Fonts panel scrolls to the card). */
function subTargetOf(target, message) {
  if (target !== 'fonts') return '';
  return /fonts\.files\.(regular|bold|italic)/.exec(String(message ?? ''))?.[1] ?? '';
}

function paintDiagnostics() {
  const kitDiags = store.get().state?.kitDiagnostics ?? [];
  const compileDiags = compile.getLastResult()?.diagnostics ?? [];
  const all = [...kitDiags, ...compileDiags];
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of all) counts[d.severity] = (counts[d.severity] ?? 0) + 1;
  for (const sev of ['error', 'warning', 'info']) {
    const node = $(`count-${sev}`);
    node.textContent = String(counts[sev]);
    node.classList.toggle('has-some', counts[sev] > 0);
  }
  const list = $('drawer-list');
  if (!all.length) {
    list.replaceChildren(ui.el('li', { class: 'drawer-empty', text: 'No diagnostics.' }));
    return;
  }
  const order = { error: 0, warning: 1, info: 2 };
  all.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  list.replaceChildren(
    ...all.map((d) => {
      const target = targetOf(d.code, d.message);
      const where = d.slide ? `slide ${d.slide}` : d.line ? `line ${d.line}` : '';
      const item = ui.el(
        target ? 'button' : 'div',
        {
          class: `drawer-item sev-${d.severity}`,
          type: target ? 'button' : false,
          dataset: target ? { target } : {},
        },
        [
          ui.el('span', { class: 'code', text: d.code ?? d.severity }),
          ui.el('span', { text: d.message ?? '' }),
          where ? ui.el('span', { class: 'where', text: where }) : null,
        ],
      );
      if (target) {
        const sub = subTargetOf(target, d.message);
        item.addEventListener('click', () => {
          location.hash = sub ? `#${target}/${sub}` : `#${target}`;
        });
      }
      return ui.el('li', {}, item);
    }),
  );
}

function wireDrawer() {
  const head = $('drawer-toggle');
  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') === 'true';
    head.setAttribute('aria-expanded', String(!open));
    $('drawer-body').hidden = open;
  });
}

// ------ preview bar: slide selector + Compare ---------------------------------

function paintSlideSelect(count) {
  const select = $('slide-select');
  const prev = select.value;
  if (select.options.length !== count + 1) {
    select.replaceChildren(
      ui.el('option', { value: 'all', text: 'All slides' }),
      ...Array.from({ length: count }, (_, i) =>
        ui.el('option', { value: String(i + 1), text: String(i + 1) }),
      ),
    );
    const keep = [...select.options].some((o) => o.value === prev);
    select.value = keep ? prev : 'all';
    // the iframe keeps its own filter — a coerced selection must be POSTED,
    // or a stale filter > count hides every slide behind an 'All slides' label
    if (!keep) compile.setSlideFilter(0);
  }
  select.disabled = count === 0;
}

function wireCompare() {
  const btn = $('btn-compare');
  let held = false;
  const hold = (on) => {
    if (on === held) return;
    if (on && btn.disabled) return;
    held = on;
    btn.classList.toggle('is-holding', on);
    compile.setCompareHeld(on);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    hold(true);
  });
  for (const ev of ['pointerup', 'pointercancel']) btn.addEventListener(ev, () => hold(false));
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) hold(true);
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') hold(false);
  });
  btn.addEventListener('blur', () => hold(false));
  // hold the B key anywhere outside a text control
  const typing = (t) =>
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'b' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing(e.target)) return;
    hold(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'b') hold(false);
  });
  window.addEventListener('blur', () => hold(false));
}

// ------ boot ------------------------------------------------------------------

async function boot() {
  wireDrawer();
  wireCompare();
  $('btn-save').addEventListener('click', saveKit);
  $('btn-conflict-reload').addEventListener('click', async () => {
    try {
      store.replaceState(await api.getState());
    } catch (e) {
      ui.toast(e?.message ?? 'Editor server unreachable', 'error');
      return; // the banner stays — the reload did not happen
    }
    compile.runCompile('conflict-reload');
  });
  $('btn-conflict-keep').addEventListener('click', () => store.update('conflict', false));
  $('slide-select').addEventListener('change', (e) => {
    const v = e.target.value;
    compile.setSlideFilter(v === 'all' ? 0 : Number(v));
  });
  window.addEventListener('beforeunload', (e) => {
    if (store.isDirty() || store.hasDrafts()) e.preventDefault();
  });

  store.subscribe((_snap, path) => {
    paintShell();
    // the preview follows every edit of the working copies
    if (path.startsWith('theme') || path.startsWith('layouts') || path === 'state')
      compile.runCompile(path);
  });

  compile.onResult((result, err) => {
    if (err) {
      ui.toast(err.message ?? 'Compile failed', 'error');
      return;
    }
    paintDiagnostics();
    paintSlideSelect(result.slides.length);
    // a clean tree's first compile IS the saved state — arm Compare with it
    if (!store.get().savedSnapshot && !store.isDirty()) compile.markSavedNow();
  });

  onKitChanged(async () => {
    // panel-local drafts (metadata form, naming cards…) count as unsaved
    // work: a silent replaceState would wipe them without a word
    if (store.isDirty() || store.hasDrafts()) store.update('conflict', true);
    else {
      try {
        store.replaceState(await api.getState());
      } catch (e) {
        ui.toast(e?.message ?? 'Editor server unreachable', 'error');
        return;
      }
      compile.runCompile('kit-changed');
    }
  });

  compile.initPreview({ store, container: $('preview-canvas') });

  try {
    store.replaceState(await api.getState());
  } catch (e) {
    ui.toast(e?.message ?? 'Editor server unreachable', 'error');
    return;
  }
  paintDiagnostics(); // kit diagnostics are visible before the first compile
  route();
  window.addEventListener('hashchange', route);
}

boot();
