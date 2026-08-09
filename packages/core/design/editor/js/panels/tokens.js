/**
 * tokens.js — the Tokens panel: the theme's 26 colors grouped by their real
 * domains (Brand, Neutrals, Surfaces, Highlights, Semantic), plus the chart
 * palette, the layer shades and the trend inks. Edits go through
 * ctx.store.update() only — the shell recompiles the preview by itself and
 * Save kit writes the working theme to disk. THEME_CONTRAST diagnostics of
 * the last compile are anchored under the rows they involve.
 */

const HEX_RE = /^#?([0-9A-Fa-f]{6})$/;

/** '1D4ED8' from ' #1d4ed8 ' — null when the value is not a 6-digit hex. */
function normHex(value) {
  const m = HEX_RE.exec(String(value ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

const COLOR_GROUPS = [
  {
    title: 'Brand',
    desc:
      'The accent family — primary draws title rules, accent panels, section backgrounds ' +
      'and icons; the lighter and darker steps ladder the layer shades.',
    // brand / brandBlack are deliberately absent: they are defined in the token
    // model but NO renderer consumes them (no COLORS.brand / COLORS.brandBlack,
    // no dynamic access) — editing them changed nothing in HTML or PPTX, so the
    // panel would present two dead swatches. The consumed accent steps stay.
    keys: ['primary', 'primaryLighter', 'primaryDarker'],
  },
  {
    title: 'Neutrals',
    desc:
      'Text and line inks — main body text, secondary footers and captions, tertiary ' +
      'details, hairline strokes and table borders.',
    keys: ['neutralPrimary', 'neutralSecondary', 'neutralTertiary', 'neutralStroke'],
  },
  {
    title: 'Surfaces',
    desc:
      'Backgrounds — ground is the slide page; the underground tones fill muted panels, ' +
      'table stripes and chart gridlines.',
    keys: ['underground1', 'underground2', 'ground'],
  },
  {
    title: 'Highlights',
    desc: 'Pale tints of the accent — highlight panel fills and the lightest layer shades.',
    keys: ['highlightLight', 'highlightStrong'],
  },
  {
    title: 'Semantic',
    desc:
      'Status families for callouts and chips — the base color fills solid chips, dark is ' +
      'their text ink, light the pale callout surface.',
    keys: [
      'informative',
      'informativeDark',
      'informativeLight',
      'positive',
      'positiveDark',
      'positiveLight',
      'warning',
      'warningDark',
      'warningLight',
      'negative',
      'negativeDark',
      'negativeLight',
    ],
    breaks: new Set(['positive', 'warning', 'negative']),
  },
];

/** :::callout kind → color token family (SEMANTIC recipe in deck/tokens.mjs). */
const CALLOUT_FAMILY = {
  info: 'informative',
  success: 'positive',
  warning: 'warning',
  danger: 'negative',
};

const TREND_KINDS = ['positive', 'negative', 'neutral'];

let ctx = null;
let host = null;
let unsubStore = null;
let unsubCompile = null;
let pendingFocus = null;
let lastShape = { hasTheme: false, chart: 0, shades: 0, pinnedSem: false };

/** Live color controls, synced in place on store changes. */
const controls = [];
/** Diagnostic anchors: key → {item, diagBox, focusEl}. */
const anchors = new Map();

// ------ effective values (working theme over the kit defaults) --------------

function defaults() {
  return ctx.store.get().state?.defaults ?? {};
}

function eff() {
  const { theme } = ctx.store.get();
  const d = defaults();
  return {
    color: (key) => theme?.colors?.[key] ?? d.colors?.[key] ?? '',
    chartColors: (Array.isArray(theme?.chartColors) && theme.chartColors.length
      ? theme.chartColors
      : (d.chartColors ?? [])
    ).slice(),
    layerShades: (Array.isArray(theme?.layerShades) && theme.layerShades.length
      ? theme.layerShades
      : (d.layerShades ?? [])
    ).map((s) => ({ ...s })),
    trendInk: { ...(d.trendInk ?? {}), ...(theme?.trendInk ?? {}) },
    surface: (key) => theme?.surface?.[key] ?? d.surface?.[key] ?? '',
    accent: (key) => theme?.accent?.[key] ?? d.accent?.[key] ?? '',
  };
}

function shapeOf() {
  const theme = ctx.store.get().theme;
  const hasTheme = Boolean(theme);
  if (!hasTheme) return { hasTheme, chart: 0, shades: 0, pinnedSem: false };
  const e = eff();
  const sem = theme.semantic;
  const pinnedSem = Boolean(sem && typeof sem === 'object' && !Array.isArray(sem));
  return { hasTheme, chart: e.chartColors.length, shades: e.layerShades.length, pinnedSem };
}

// ------ color control (swatch + hex field) -----------------------------------

function paintSwatch(swatch, colorInput, raw) {
  const v = normHex(raw);
  swatch.style.backgroundColor = v ? `#${v}` : 'transparent';
  if (document.activeElement !== colorInput) colorInput.value = `#${v ?? '000000'}`;
}

/**
 * A swatch opening the native color picker plus a mono hex field.
 * `get` reads the current raw value from the store, `set(hex)` writes an
 * uppercase 6-digit value back. Registers itself for in-place refresh.
 */
function colorControl({ aria, get, set, compact = false }) {
  const { el } = ctx.ui;
  const colorInput = el('input', {
    type: 'color',
    'aria-label': `${aria} — color picker`,
    oninput: (e) => set(e.target.value.slice(1).toUpperCase()),
  });
  const swatch = el('label', { class: 'p-tokens-swatch', title: 'Pick a color' }, [colorInput]);
  const hexInput = el('input', {
    class: `input mono p-tokens-hex${compact ? ' p-tokens-hex-sm' : ''}`,
    value: normHex(get()) ?? String(get() ?? ''),
    spellcheck: 'false',
    maxlength: '7',
    'aria-label': `${aria} — hex value`,
    oninput: () => {
      const v = normHex(hexInput.value);
      hexInput.classList.toggle('p-tokens-invalid', !v);
      if (!v) hexInput.setAttribute('aria-invalid', 'true');
      else {
        hexInput.removeAttribute('aria-invalid');
        if (v !== normHex(get())) set(v);
      }
    },
    onblur: () => {
      hexInput.value = normHex(get()) ?? String(get() ?? '');
      hexInput.classList.remove('p-tokens-invalid');
      hexInput.removeAttribute('aria-invalid');
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') hexInput.blur();
    },
  });
  paintSwatch(swatch, colorInput, get());
  controls.push({ swatch, colorInput, hexInput, get });
  return { swatch, hexInput };
}

/** Wrap a row with its diagnostics box and register the anchor. */
function withDiag(anchor, row, focusEl) {
  const { el } = ctx.ui;
  const diagBox = el('div', { class: 'p-tokens-diags', hidden: true });
  const item = el('div', {}, [row, diagBox]);
  anchors.set(anchor, { item, diagBox, focusEl });
  return item;
}

function tokenRow({ name, aria, anchor, get, set, breakBefore = false }) {
  const { el } = ctx.ui;
  const c = colorControl({ aria: aria ?? name, get, set });
  const row = el('div', { class: `p-tokens-row${breakBefore ? ' p-tokens-break' : ''}` }, [
    c.swatch,
    el('span', { class: 'p-tokens-name', text: name }),
    c.hexInput,
  ]);
  return withDiag(anchor, row, c.hexInput);
}

function groupHead(title, onReset) {
  const { el } = ctx.ui;
  return el('div', { class: 'p-tokens-gh' }, [
    el('h3', { class: 'card-title', text: title }),
    el('button', {
      class: 'p-tokens-reset',
      type: 'button',
      text: 'Reset to default',
      onclick: onReset,
    }),
  ]);
}

// ------ cards ------------------------------------------------------------------

/**
 * The Semantic families (info/success/warning/danger) reach the callouts and
 * chips ONLY through the derived `semantic` block (deriveTokens: theme.mjs).
 * When a theme pins that block explicitly, theme.mjs merges it AFTER the
 * derivation, so these palette edits recompute tones that the pinned block
 * then overwrites — the swatches would edit nothing, silently. A fresh kit no
 * longer ships the block (scaffoldKit), but an installed brand may; surface it
 * with a one-click way to hand the callouts back to the palette.
 */
function pinnedSemanticNotice() {
  const sem = ctx.store.get().theme?.semantic;
  if (!sem || typeof sem !== 'object' || Array.isArray(sem)) return null;
  const { el } = ctx.ui;
  return el('div', { class: 'p-tokens-pinned' }, [
    el('p', {
      text:
        'This theme pins explicit callout tones (a “semantic” block) that override these ' +
        'colors — editing them changes nothing in the callouts until the block is removed.',
    }),
    el('button', {
      class: 'btn btn-sm',
      type: 'button',
      text: 'Make callouts follow the palette',
      onclick: () => ctx.store.update('theme.semantic', undefined),
    }),
  ]);
}

function groupCard(group) {
  const { el } = ctx.ui;
  return el('section', { class: 'card' }, [
    groupHead(group.title, () => {
      const { theme } = ctx.store.get();
      const next = { ...(theme?.colors ?? {}) };
      for (const k of group.keys) next[k] = defaults().colors?.[k] ?? next[k];
      ctx.store.update('theme.colors', next);
    }),
    el('p', { class: 'p-tokens-desc', text: group.desc }),
    group.title === 'Semantic' ? pinnedSemanticNotice() : null, // el() skips null
    ...group.keys.map((key) =>
      tokenRow({
        name: key,
        anchor: `colors.${key}`,
        get: () => eff().color(key),
        set: (hex) => ctx.store.update(['theme', 'colors', key], hex),
        breakBefore: group.breaks?.has(key),
      }),
    ),
  ]);
}

const setChart = (arr) => ctx.store.update('theme.chartColors', arr);

function chartRow(i, count) {
  const { el } = ctx.ui;
  const get = () => eff().chartColors[i];
  const set = (hex) => {
    const a = eff().chartColors;
    a[i] = hex;
    setChart(a);
  };
  const move = (delta) => () => {
    const a = eff().chartColors;
    const j = i + delta;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setChart(a);
  };
  const iconBtn = (label, title, disabled, onclick) =>
    el('button', {
      class: 'p-tokens-ibtn',
      type: 'button',
      title,
      'aria-label': title,
      disabled,
      text: label,
      onclick,
    });
  const c = colorControl({ aria: `Chart color ${i + 1}`, get, set });
  const row = el('div', { class: 'p-tokens-row' }, [
    el('span', { class: 'p-tokens-idx', text: String(i + 1) }),
    c.swatch,
    c.hexInput,
    el('span', { class: 'p-tokens-flex' }),
    iconBtn('↑', `Move chart color ${i + 1} up`, i === 0, move(-1)),
    iconBtn('↓', `Move chart color ${i + 1} down`, i === count - 1, move(1)),
    iconBtn(
      '×',
      count <= 1 ? 'At least one chart color is required' : `Remove chart color ${i + 1}`,
      count <= 1,
      () => {
        const a = eff().chartColors;
        if (a.length <= 1) return;
        a.splice(i, 1);
        setChart(a);
      },
    ),
  ]);
  return withDiag(`chartColors.${i}`, row, c.hexInput);
}

function chartCard() {
  const { el } = ctx.ui;
  const colors = eff().chartColors;
  const addBtn = el('button', {
    class: 'btn btn-sm',
    type: 'button',
    text: 'Add color',
    onclick: () => {
      const a = eff().chartColors;
      pendingFocus = `chartColors.${a.length}`;
      a.push(a[a.length - 1] ?? '888888');
      setChart(a);
    },
  });
  const diagBox = el('div', { class: 'p-tokens-diags', hidden: true });
  const card = el('section', { class: 'card' }, [
    groupHead('Chart colors', () => setChart((defaults().chartColors ?? []).slice())),
    el('p', {
      class: 'p-tokens-desc',
      text:
        'Categorical palette for chart series, applied in this order — series beyond the ' +
        'palette group under “Other”.',
    }),
    ...colors.map((_, i) => chartRow(i, colors.length)),
    el('div', { class: 'p-tokens-actions' }, [addBtn]),
    diagBox,
  ]);
  anchors.set('chartColors', { item: card, diagBox, focusEl: addBtn });
  return card;
}

const setShades = (arr) => ctx.store.update('theme.layerShades', arr);

function shadesCard() {
  const { el } = ctx.ui;
  const { theme } = ctx.store.get();
  const shades = eff().layerShades;
  const grid = el('div', { class: 'p-tokens-shades' }, [
    el('span', {}),
    el('span', { class: 'p-tokens-ch', text: 'Fill' }),
    el('span', { class: 'p-tokens-ch', text: 'Ink' }),
  ]);
  shades.forEach((_, i) => {
    const part = (name) => ({
      get: () => eff().layerShades[i]?.[name],
      set: (hex) => {
        const a = eff().layerShades;
        a[i] = { ...a[i], [name]: hex };
        setShades(a);
      },
    });
    const fill = colorControl({ aria: `Layer ${i + 1} fill`, compact: true, ...part('fill') });
    const ink = colorControl({ aria: `Layer ${i + 1} ink`, compact: true, ...part('ink') });
    const fillCell = el('div', { class: 'p-tokens-pair' }, [fill.swatch, fill.hexInput]);
    const inkCell = el('div', { class: 'p-tokens-pair' }, [ink.swatch, ink.hexInput]);
    const diagBox = el('div', { class: 'p-tokens-diags p-tokens-span', hidden: true });
    grid.append(
      el('span', { class: 'p-tokens-slabel', text: `Layer ${i + 1}` }),
      fillCell,
      inkCell,
      diagBox,
    );
    anchors.set(`layerShades.${i}`, { item: fillCell, diagBox, focusEl: fill.hexInput });
  });
  return el('section', { class: 'card' }, [
    groupHead('Layer shades', () =>
      setShades((defaults().layerShades ?? []).map((s) => ({ ...s }))),
    ),
    el('p', {
      class: 'p-tokens-desc',
      text:
        'Fills of the layers layout, base (darkest) to surface (lightest) — each pairs a ' +
        'fill with the ink that stays readable on it.',
    }),
    theme?.layerShades?.length
      ? null
      : el('p', {
          class: 'p-tokens-hint',
          text: 'Currently derived from the accent palette — editing saves explicit shades.',
        }),
    grid,
  ]);
}

function trendCard() {
  const { el } = ctx.ui;
  const { theme } = ctx.store.get();
  return el('section', { class: 'card' }, [
    groupHead('Trend inks', () =>
      ctx.store.update('theme.trendInk', { ...(defaults().trendInk ?? {}) }),
    ),
    el('p', {
      class: 'p-tokens-desc',
      text:
        'Inks of the metric-card trend deltas — positive, negative and neutral — set ' +
        'against the slide background.',
    }),
    theme?.trendInk
      ? null
      : el('p', {
          class: 'p-tokens-hint',
          text: 'Currently derived from the semantic colors — editing saves explicit inks.',
        }),
    ...TREND_KINDS.map((kind) =>
      tokenRow({
        name: kind,
        aria: `Trend ink ${kind}`,
        anchor: `trendInk.${kind}`,
        get: () => eff().trendInk[kind],
        set: (hex) => ctx.store.update(['theme', 'trendInk', kind], hex),
      }),
    ),
  ]);
}

const SURFACE_KEYS = [
  ['pageBg', 'Content page background'],
  ['coverBg', 'Cover background'],
  ['coverInk', 'Cover title ink'],
  ['coverMutedInk', 'Cover subtitle / byline ink'],
  ['sectionBg', 'Section band background'],
  ['sectionInk', 'Section title ink'],
];

function surfaceCard() {
  const { el } = ctx.ui;
  const { theme } = ctx.store.get();
  return el('section', { class: 'card' }, [
    groupHead('Surfaces', () =>
      ctx.store.update('theme.surface', { ...(defaults().surface ?? {}) }),
    ),
    el('p', {
      class: 'p-tokens-desc',
      text:
        'The three slide backgrounds and the inks on them — a coloured cover, a darker ' +
        'section band, a tinted content page. Contrast is checked against each background.',
    }),
    theme?.surface
      ? null
      : el('p', {
          class: 'p-tokens-hint',
          text: 'Currently derived from the palette — editing saves explicit surfaces.',
        }),
    ...SURFACE_KEYS.map(([key, label], i) =>
      tokenRow({
        name: label,
        aria: `Surface ${label}`,
        anchor: `surface.${key}`,
        get: () => eff().surface(key),
        set: (hex) => ctx.store.update(['theme', 'surface', key], hex),
        breakBefore: key === 'sectionBg',
      }),
    ),
  ]);
}

const ACCENT_KEYS = [
  ['bar', 'Accent bar'],
  ['rule', 'Title rule'],
];

function accentCard() {
  const { el } = ctx.ui;
  const { theme } = ctx.store.get();
  return el('section', { class: 'card' }, [
    groupHead('Accent', () => ctx.store.update('theme.accent', { ...(defaults().accent ?? {}) })),
    el('p', {
      class: 'p-tokens-desc',
      text:
        'The signature flourishes — the bar over a cover title, the accent segment of a ' +
        'content title rule, the focus bar and the quotation mark — and the hairline rule.',
    }),
    theme?.accent
      ? null
      : el('p', {
          class: 'p-tokens-hint',
          text: 'Currently derived from the palette — editing saves explicit accents.',
        }),
    ...ACCENT_KEYS.map(([key, label]) =>
      tokenRow({
        name: label,
        aria: `Accent ${label}`,
        anchor: `accent.${key}`,
        get: () => eff().accent(key),
        set: (hex) => ctx.store.update(['theme', 'accent', key], hex),
      }),
    ),
  ]);
}

function emptyState() {
  const { el } = ctx.ui;
  return el('div', { class: 'empty' }, [
    el('h2', { class: 'empty-title', text: 'No theme yet' }),
    el('p', {
      text: 'This kit inherits the default palette. Create a theme to start shaping its colors.',
    }),
    el('div', { class: 'p-tokens-empty-action' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: 'Create theme from defaults',
        onclick: () => {
          const d = ctx.store.get().state?.defaults;
          if (!d) {
            ctx.ui.toast('No default theme available.', 'error');
            return;
          }
          const theme = structuredClone(d);
          const kitName = ctx.store.get().state?.name;
          if (kitName) theme.name = kitName;
          ctx.store.update('theme', theme);
        },
      }),
    ]),
  ]);
}

// ------ diagnostics anchoring ---------------------------------------------------

/** Anchor key a THEME_CONTRAST message points at (theme.mjs writes them). */
function anchorFor(message, e) {
  if (message.includes('main text')) return 'colors.neutralPrimary';
  if (message.includes('secondary text')) return 'colors.neutralSecondary';
  if (message.includes('cover title')) return 'surface.coverInk';
  if (message.includes('cover subtitle')) return 'surface.coverMutedInk';
  if (message.includes('section slide title')) return 'surface.sectionInk';
  let m = message.match(/chart color #([0-9A-Fa-f]{6})/);
  if (m) {
    const hex = m[1].toUpperCase();
    const i = e.chartColors.findIndex((c) => normHex(c) === hex);
    return i >= 0 ? `chartColors.${i}` : 'chartColors';
  }
  m = message.match(/ink of layer (\d+)/);
  if (m) return `layerShades.${Number(m[1]) - 1}`;
  m = message.match(/:::(\w+) callout/);
  if (m) return CALLOUT_FAMILY[m[1]] ? `colors.${CALLOUT_FAMILY[m[1]]}Dark` : null;
  m = message.match(/solid (\w+) panel/);
  if (m) return CALLOUT_FAMILY[m[1]] ? `colors.${CALLOUT_FAMILY[m[1]]}` : null;
  m = message.match(/"(\w+)" trend ink/);
  if (m) return TREND_KINDS.includes(m[1]) ? `trendInk.${m[1]}` : null;
  return null;
}

function paintDiags() {
  if (!anchors.size) return;
  for (const a of anchors.values()) {
    a.diagBox.replaceChildren();
    a.diagBox.hidden = true;
  }
  const diags =
    ctx.compile.getLastResult()?.diagnostics ?? ctx.store.get().state?.kitDiagnostics ?? [];
  const e = eff();
  for (const d of diags) {
    if (String(d.code ?? '').toUpperCase() !== 'THEME_CONTRAST') continue;
    const key = anchorFor(String(d.message ?? ''), e);
    const a = key ? anchors.get(key) : null;
    if (!a) continue; // stays visible in the diagnostics drawer
    a.diagBox.append(
      ctx.ui.el('p', {
        class: `p-tokens-diag p-tokens-sev-${d.severity ?? 'warning'}`,
        text: d.message ?? '',
      }),
    );
    a.diagBox.hidden = false;
  }
}

// ------ render / refresh ----------------------------------------------------------

function render() {
  controls.length = 0;
  anchors.clear();
  lastShape = shapeOf();
  const { theme, state } = ctx.store.get();
  if (!state) {
    host.replaceChildren();
    return;
  }
  if (!theme) {
    host.replaceChildren(emptyState());
    return;
  }
  host.replaceChildren(
    ...COLOR_GROUPS.map(groupCard),
    surfaceCard(),
    accentCard(),
    chartCard(),
    shadesCard(),
    trendCard(),
  );
  paintDiags();
  if (pendingFocus) {
    anchors.get(pendingFocus)?.focusEl?.focus();
    pendingFocus = null;
  }
}

/** Sync every control in place — the focused field keeps the user's text. */
function refresh() {
  for (const c of controls) {
    paintSwatch(c.swatch, c.colorInput, c.get());
    if (document.activeElement !== c.hexInput) {
      c.hexInput.value = normHex(c.get()) ?? String(c.get() ?? '');
      c.hexInput.classList.remove('p-tokens-invalid');
      c.hexInput.removeAttribute('aria-invalid');
    }
  }
  paintDiags(); // chart-color anchors follow the values
}

export default {
  id: 'tokens',
  label: 'Tokens',

  /**
   * @param {HTMLElement} container panel host, emptied by the router
   * @param {{store: object, api: object, compile: object, ui: object}} context
   */
  mount(container, context) {
    ctx = context;
    host = container;
    ctx.ui.ensureStylesheet('js/panels/tokens.css');
    render();
    unsubStore = ctx.store.subscribe((_snap, path) => {
      const p = String(path);
      if (p !== 'state' && !p.startsWith('theme')) return;
      const shape = shapeOf();
      const structural =
        p === 'state' ||
        p === 'theme' ||
        shape.hasTheme !== lastShape.hasTheme ||
        shape.chart !== lastShape.chart ||
        shape.shades !== lastShape.shades ||
        shape.pinnedSem !== lastShape.pinnedSem;
      lastShape = shape;
      if (structural) render();
      else refresh();
    });
    unsubCompile = ctx.compile.onResult((result) => {
      if (result) paintDiags();
    });
  },

  unmount() {
    unsubStore?.();
    unsubCompile?.();
    unsubStore = unsubCompile = null;
    controls.length = 0;
    anchors.clear();
    pendingFocus = null;
    host = null;
    ctx = null;
  },

  /** '#tokens/colors.primary' scrolls to and focuses the named row. */
  onRoute(sub) {
    if (!sub) return;
    const a = anchors.get(sub);
    if (!a) return;
    a.item.scrollIntoView({ block: 'center' });
    a.focusEl?.focus?.();
  },
};
