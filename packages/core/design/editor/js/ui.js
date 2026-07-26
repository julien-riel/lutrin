/**
 * ui.js — DOM helpers and the shared widgets. Every string that reaches the
 * DOM goes through textContent/createTextNode — no innerHTML anywhere in the
 * chrome (the slides inside the iframe are the single sanctioned exception,
 * owned by compile.js).
 */

/**
 * Create an element.
 *   el('button', { class: 'btn', onclick: fn }, ['Save kit'])
 *   el('span', { class: 'mono', text: alias })
 * attrs: 'class', 'dataset' (object), 'text' (textContent), on<event>
 * (listener), true → boolean attribute, false/null/undefined → skipped.
 * children: element | string (becomes a TEXT node) | null, or an array.
 * @param {string} tag
 * @param {object} [attrs]
 * @param {(Node|string|null)[]|Node|string} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * Transient notification, bottom right. Kinds: 'success' (brass), 'error',
 * 'info'. Auto-dismisses after 4 s.
 * @param {string} message
 * @param {'success'|'error'|'info'} [kind]
 */
export function toast(message, kind = 'success') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = el('div', { class: `toast kind-${kind}`, role: 'status', text: message });
  host.append(t);
  setTimeout(() => t.remove(), 4000);
}

/**
 * Native <dialog> confirmation. Resolves true on confirm, false otherwise.
 * @param {string} message
 * @param {{confirmLabel?: string, cancelLabel?: string, danger?: boolean}} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const ok = el('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', text: confirmLabel });
    const cancel = el('button', { class: 'btn', type: 'button', text: cancelLabel });
    const dialog = el('dialog', { class: 'dialog' }, [
      el('p', { text: message }),
      el('div', { class: 'dialog-actions' }, [cancel, ok]),
    ]);
    let verdict = false;
    ok.addEventListener('click', () => {
      verdict = true;
      dialog.close();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(verdict);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Segmented control. Returns the element; element.value reads/writes the
 * active option (writing does not fire onChange).
 * @param {{options: {value: string, label: string}[], value?: string,
 *          onChange?: (value: string) => void}} cfg
 * @returns {HTMLElement & {value: string}}
 */
export function segmented({ options, value, onChange }) {
  const root = el('div', { class: 'seg', role: 'group' });
  let active = value ?? options[0]?.value;
  const paint = () => {
    for (const b of root.children) b.setAttribute('aria-pressed', String(b.dataset.value === active));
  };
  for (const opt of options) {
    const b = el('button', { type: 'button', dataset: { value: opt.value }, text: opt.label });
    b.addEventListener('click', () => {
      if (active === opt.value) return;
      active = opt.value;
      paint();
      onChange?.(active);
    });
    root.append(b);
  }
  paint();
  Object.defineProperty(root, 'value', {
    get: () => active,
    set: (v) => {
      active = v;
      paint();
    },
  });
  return root;
}

/**
 * Chip list with a free-text input (Enter or comma adds, × or Backspace on
 * empty removes). Values render in Plex Mono.
 * @param {{values?: string[], placeholder?: string,
 *          validate?: (value: string) => boolean,
 *          onChange: (values: string[]) => void}} cfg
 * @returns {HTMLElement}
 */
export function tagInput({ values = [], placeholder = '', validate, onChange }) {
  const list = [...values];
  const input = el('input', { type: 'text', placeholder });
  const root = el('div', { class: 'tag-input' });
  const paint = () => {
    root.replaceChildren(
      ...list.map((v, i) =>
        el('span', { class: 'tag' }, [
          v,
          el('button', {
            type: 'button',
            'aria-label': `Remove ${v}`,
            text: '×',
            onclick: () => {
              list.splice(i, 1);
              paint();
              onChange([...list]);
            },
          }),
        ]),
      ),
      input,
    );
  };
  const commit = () => {
    const v = input.value.trim();
    if (!v || list.includes(v) || (validate && !validate(v))) return;
    list.push(v);
    input.value = '';
    paint();
    input.focus();
    onChange([...list]);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      paint();
      input.focus();
      onChange([...list]);
    }
  });
  input.addEventListener('blur', commit);
  paint();
  return root;
}

/**
 * Labeled form row: 11 px semibold label above the control, optional hint or
 * error line under it.
 * @param {{label: string, control: HTMLElement, hint?: string, error?: string,
 *          id?: string}} cfg
 * @returns {HTMLElement}
 */
export function field({ label, control, hint, error, id }) {
  if (id) control.id = id;
  return el('div', { class: 'field' }, [
    el('label', { class: 'label', for: id ?? false, text: label }),
    control,
    hint ? el('span', { class: 'hint', text: hint }) : null,
    error ? el('span', { class: 'error', text: error }) : null,
  ]);
}

/**
 * Idempotently add a stylesheet (each panel links its own CSS file on first
 * mount: ensureStylesheet('js/panels/tokens.css')).
 * @param {string} href
 */
export function ensureStylesheet(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return;
  document.head.append(el('link', { rel: 'stylesheet', href }));
}
