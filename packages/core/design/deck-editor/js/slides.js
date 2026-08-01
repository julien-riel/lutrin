/**
 * slides.js — the slide list pane: number, title (or a placeholder), the
 * effective layout as a badge (explicit directive, or the inferred one
 * marked "(auto)"), and a dirty dot on the slide being edited.
 *
 * When the frontmatter title generates an implicit cover (sceneOffset 1 —
 * D4) the list opens with a "Couverture" pseudo-entry: selectable, never
 * editable. Entries are numbered like the compiled fragments — cover = 1,
 * slice i = i + 1 + offset — so the list, the viewer counter and ‹ › all
 * speak the same numbers.
 */

import { store } from './store.js';
import { el } from './ui.js';

let container = null;
let onSelect = null; // (index) => void — main.js guards and selects
let onSelectCover = null; // () => void — same guard, cover pseudo-entry

function coverEntry(s) {
  return el(
    'li',
    {},
    el(
      'button',
      {
        class: 'slide-item is-cover',
        type: 'button',
        'aria-current': s.coverSelected ? 'true' : false,
        onclick: () => onSelectCover(),
      },
      [
        el('span', { class: 'slide-num', text: '1' }),
        el('span', { class: 'slide-title', text: 'Couverture' }),
        el('span', { class: 'slide-badge', text: 'frontmatter' }),
      ],
    ),
  );
}

function render() {
  const s = store.get();
  if (!s.deck) {
    container.replaceChildren(el('p', { class: 'slides-empty', text: 'Aucun fichier ouvert.' }));
    return;
  }
  if (!s.deck.sliceable) {
    container.replaceChildren(
      el('p', {
        class: 'slides-empty',
        text: 'Dialecte Marp : la liste par diapositive n’est pas disponible.',
      }),
    );
    return;
  }
  const offset = store.sceneOffset();
  if (!s.deck.slides.length && !offset) {
    container.replaceChildren(
      el('p', { class: 'slides-empty', text: 'Aucune diapositive dans ce fichier.' }),
    );
    return;
  }
  const entries = offset === 1 ? [coverEntry(s)] : [];
  entries.push(
    ...s.deck.slides.map((slide, i) => {
      const badge =
        slide.layout ?? (slide.inferredLayout ? `${slide.inferredLayout} (auto)` : null);
      const isCurrent = i === s.current && !s.coverSelected;
      return el(
        'li',
        {},
        el(
          'button',
          {
            class: 'slide-item',
            type: 'button',
            'aria-current': isCurrent ? 'true' : false,
            onclick: () => onSelect(i),
          },
          [
            el('span', { class: 'slide-num', text: String(i + 1 + offset) }),
            el('span', {
              class: `slide-title${slide.title ? '' : ' is-untitled'}`,
              text: slide.title ?? '(sans titre)',
            }),
            isCurrent && s.dirty
              ? el('span', { class: 'slide-dirty', 'aria-label': 'Modifiée', text: '●' })
              : null,
            badge ? el('span', { class: 'slide-badge', text: badge }) : null,
          ],
        ),
      );
    }),
  );
  container.replaceChildren(el('ol', { class: 'slide-list' }, entries));
}

/**
 * Mount the slide list into `container`; clicking a slide calls
 * `onSelect(index)`, clicking the cover pseudo-entry calls `onSelectCover()`.
 * @param {{container: HTMLElement, onSelect: (index: number) => void,
 *          onSelectCover: () => void}} deps
 */
export function init(deps) {
  container = deps.container;
  onSelect = deps.onSelect;
  onSelectCover = deps.onSelectCover;
  store.subscribe((_snap, path) => {
    if (path === 'deck' || path === 'current' || path === 'working') render();
  });
  render();
}
