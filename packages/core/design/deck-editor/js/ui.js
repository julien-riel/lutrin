/**
 * ui.js — DOM helpers and the shared widgets of the deck editor chrome.
 * Every string that reaches the DOM goes through textContent/createTextNode —
 * no innerHTML anywhere in the chrome (the slides inside the viewer iframe
 * are the single sanctioned exception, owned by viewer.js).
 */

/**
 * Create an element.
 *   el('button', { class: 'btn', onclick: fn }, ['Enregistrer'])
 *   el('span', { class: 'mono', text: name })
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
 * Wrap an async function so calls made WHILE one is in flight are ignored —
 * the re-entrancy guard behind Enregistrer: a double Ctrl+S must not race
 * two PUTs of the same slide (the second would carry a stale baseVersion and
 * paint a phantom conflict). Deliberately not a queue: the second gesture
 * asked for the same save, not for another one.
 * @param {(...args: any[]) => Promise<any>} fn
 * @returns {(...args: any[]) => Promise<any>}
 */
export function singleFlight(fn) {
  let flying = false;
  return async (...args) => {
    if (flying) return undefined;
    flying = true;
    try {
      return await fn(...args);
    } finally {
      flying = false;
    }
  };
}

/**
 * Transient notification, bottom right. Kinds: 'success', 'error', 'info'.
 * Auto-dismisses after 4 s.
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
export function confirmDialog(
  message,
  { confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = {},
) {
  return new Promise((resolve) => {
    const ok = el('button', {
      class: danger ? 'btn btn-danger' : 'btn btn-primary',
      type: 'button',
      text: confirmLabel,
    });
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
 * active option (writing does not fire onChange). Options may carry
 * `disabled: true` — the button renders but cannot be pressed.
 * @param {{options: {value: string, label: string, disabled?: boolean}[],
 *          value?: string, label?: string,
 *          onChange?: (value: string) => void}} cfg
 * @returns {HTMLElement & {value: string}}
 */
export function segmented({ options, value, label, onChange }) {
  const root = el('div', { class: 'seg', role: 'group', 'aria-label': label ?? false });
  let active = value ?? options[0]?.value;
  const paint = () => {
    for (const b of root.children)
      b.setAttribute('aria-pressed', String(b.dataset.value === active));
  };
  for (const opt of options) {
    const b = el('button', {
      type: 'button',
      dataset: { value: opt.value },
      disabled: opt.disabled === true,
      text: opt.label,
    });
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
 * Labeled form row: 11 px semibold label above the control, optional hint
 * line under it.
 * @param {{label: string, control: HTMLElement, hint?: string, id?: string}} cfg
 * @returns {HTMLElement}
 */
export function field({ label, control, hint, id }) {
  if (id) control.id = id;
  return el('div', { class: 'field' }, [
    el('label', { class: 'label', for: id ?? false, text: label }),
    control,
    hint ? el('span', { class: 'hint', text: hint }) : null,
  ]);
}
