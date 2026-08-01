/**
 * tree.js — the file tree pane: GET /api/tree rendered as nested lists,
 * directories collapsible, .deck.md files clickable. The server already
 * filtered everything else out and pruned deck-less directories.
 */

import { api } from './api.js';
import { store } from './store.js';
import { el, toast } from './ui.js';

let container = null;
let onOpen = null; // (path) => void — main.js guards and loads
const collapsed = new Set(); // dir paths folded by the user, kept across refreshes

function renderEntries(entries) {
  return el(
    'ul',
    {},
    entries.map((entry) => {
      if (entry.type === 'dir') {
        const open = !collapsed.has(entry.path);
        const childList = renderEntries(entry.children ?? []);
        childList.hidden = !open;
        const btn = el(
          'button',
          { class: 'tree-dir', type: 'button', 'aria-expanded': String(open) },
          [chevron(), el('span', { class: 'tree-name', text: entry.name })],
        );
        btn.addEventListener('click', () => {
          const nowOpen = collapsed.has(entry.path);
          if (nowOpen) collapsed.delete(entry.path);
          else collapsed.add(entry.path);
          btn.setAttribute('aria-expanded', String(nowOpen));
          childList.hidden = !nowOpen;
        });
        return el('li', {}, [btn, childList]);
      }
      const active = store.get().deck?.path === entry.path;
      return el(
        'li',
        {},
        el(
          'button',
          {
            class: `tree-file${active ? ' is-active' : ''}`,
            type: 'button',
            'aria-current': active ? 'true' : false,
            onclick: () => onOpen(entry.path),
          },
          el('span', { class: 'tree-name', text: entry.name }),
        ),
      );
    }),
  );
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tree-chevron');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.5 3.5L5 6.5l2.5-3');
  svg.append(path);
  return svg;
}

function render() {
  const tree = store.get().tree;
  if (!tree) {
    container.replaceChildren(el('p', { class: 'tree-empty', text: 'Chargement…' }));
    return;
  }
  const nodes = [];
  if (!tree.entries?.length)
    nodes.push(el('p', { class: 'tree-empty', text: 'Aucun fichier .deck.md sous ce dossier.' }));
  else nodes.push(renderEntries(tree.entries));
  if (tree.truncated)
    nodes.push(el('p', { class: 'tree-note', text: 'Arborescence tronquée (trop d’entrées).' }));
  const root = el('div', { class: 'tree' }, nodes);
  container.replaceChildren(root);
}

/** Re-fetch the tree from the server and re-render (collapse state kept). */
export async function refresh() {
  try {
    store.setTree(await api.getTree());
  } catch (e) {
    toast(e?.message ?? 'Lecture de l’arborescence impossible', 'error');
  }
}

/**
 * Mount the tree into `container`; clicking a deck calls `onOpen(path)`.
 * @param {{container: HTMLElement, onOpen: (path: string) => void}} deps
 */
export function init(deps) {
  container = deps.container;
  onOpen = deps.onOpen;
  store.subscribe((_snap, path) => {
    if (path === 'tree' || path === 'deck') render();
  });
  render();
}
