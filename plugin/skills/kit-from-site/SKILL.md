---
name: kit-from-site
description: Derive a Lutrin brand kit (deck kit) from a website URL — read the site's design system (colors, typography, logo, corner radii), distill it into a kit (kit.json + theme.json + logos), validate it against the engine's WCAG thresholds and preview it on a specimen deck. Use whenever the user asks for a kit, a theme or branded decks "matching our site / this URL / our brand", or to convert a site's design system into a Lutrin kit.
---

# Brand kit from a website (Lutrin)

Given a **site URL**, produce a **kit**: the distributable unit of a brand for
the Lutrin presentation compiler — a directory carrying `kit.json`, a
`theme.json` of design tokens, and optionally logos, fonts and layouts. A kit
is **pure data, never code**; once installed (`lutrin kit install`) or
referenced by path, every deck that says `kit: <name>` in its frontmatter
comes out wearing the brand. Full kit reference: `docs/kits.md`.

A site is not a slide, so this is a **distillation, not a transcription**: the
goal is a deck that a reader of the site recognizes at a glance — the action
color, the type, the signature — not a copy of every hue the CSS contains.
When in doubt, take less.

## Step 1 — Harvest the site

Fetch the page and read what the brand actually ships. Use whatever fetch
capability is available (`curl -sL <url>`, or the agent's web-fetch tool);
JavaScript-rendered markup rarely matters here because the design system lives
in the CSS and the `<head>`.

1. **The homepage HTML** — and from it, every linked stylesheet
   (`<link rel="stylesheet">`; fetch them too, they hold the tokens).
2. **A design-system page if one exists** — try `/brand`, `/design`,
   `/styleguide`, a Storybook, or a documented CSS-variables sheet. When the
   organization publishes its tokens, that page outranks anything inferred
   from the homepage.
3. In the CSS, in this order of reliability:
   - **CSS custom properties** (`--color-primary`, `--brand-*`, design-token
     blocks on `:root`) — the closest thing to the org's own token names;
   - the **action color**: buttons, links, the header/footer accents — the
     color the site uses when it wants a click is the brand's `primary`,
     even when another color covers more pixels;
   - **`font-family` stacks** on `body` and on headings, and any `@font-face`
     rules (note the font's name AND its license if you can find it);
   - **`border-radius`** conventions (sharp corporate square vs rounded
     product pill) — they map to the `rounded` tokens;
   - background tones: page background, dark bands, hero/section surfaces.
4. In the `<head>`: `<meta name="theme-color">`, `og:image`, the favicon and
   `apple-touch-icon` — fallback sources for the brand color and the mark.
5. **The logo**: an SVG in the header is the best capture (crisp at any
   size); otherwise a PNG. Look for a **light-on-dark variant** too (often in
   the footer, or a `-white`/`-inverse` asset) — section slides sit the logo
   on the brand color and need it.

Screenshot-based color picking is a last resort: CSS values are exact,
pixels are not.

## Step 2 — Distill the tokens

Map the harvest onto the theme's token groups. The full template to copy is
`packages/core/design/themes/default.json` (applying it unchanged is a no-op);
override **only what the brand changes** — every token you do not write keeps
its accessible default, so a small theme is a feature, not laziness. All
colors are hex **without `#`** (`"1D4ED8"`).

| Site evidence | Theme tokens |
|---|---|
| The action color | `colors.primary`, `colors.brand`, `accent.bar` |
| Its dark / light ramp (hover states, tints) | `colors.primaryDarker`, `colors.primaryLighter` |
| Pale tinted surfaces (selected rows, info bands) | `colors.highlightLight`, `colors.highlightStrong` |
| Page background, dark hero/footer bands | `surface.pageBg`, `surface.coverBg`/`coverInk`/`coverMutedInk`, `surface.sectionBg`/`sectionInk` |
| Body / heading families | `fonts.body`, `fonts.display` (and `fonts.files` — see below) |
| Corner radii | `rounded.sm/md/lg` |
| Data-viz or accent set | `chartColors` — six entries, **always explicit** |
| Logo, and its light-on-dark variant | `logos.cover` / `logos.section` (PNG/JPEG for the .pptx) and `logos.coverSvg` / `logos.sectionSvg` (SVG, served in the HTML) |

The judgement calls, and how to make them:

- **One primary.** A site with three accents still gets ONE `colors.primary`
  — the action color. The derived groups (architecture layers, panels,
  Mermaid, icons) follow it automatically; a second accent's place is in
  `chartColors`.
- **Ramp missing?** Derive `primaryDarker` / `primaryLighter` from the
  primary by shifting lightness while keeping the hue (a hover state on the
  site often IS the darker step). `highlightLight` / `highlightStrong` are
  pale tints of the primary — think "selected table row", not "button".
- **`chartColors` never derive.** The engine deliberately refuses to invent a
  chart palette from the primary: supply six distinguishable colors, each
  ≥ 3:1 against white. Start from the site's accent set, then adjust
  lightness until the contrast holds; fill out with hue-spread neutrals when
  the site offers fewer than six.
- **Dark cover?** If the site leads with a dark hero, set `surface.coverBg`
  with `coverInk`/`coverMutedInk` to match — and when `coverBg` **is** the
  brand color, set `accent.coverBar` to a lighter tint, or the cover bar
  draws itself in the color it lies on.
- **Fonts: families are safe, files are licensed.** Naming a family
  (`fonts.body: "Inter"`) is always allowed but embeds nothing: both outputs
  fall back together on whatever is installed — safe only for
  widely-installed families (Arial, Georgia, Verdana…). Embedding requires
  `fonts.files` (`.ttf`, with a same-named `.woff2` beside each for the
  HTML) and that is only legitimate when the font's license permits
  redistribution — Google Fonts (OFL) yes, a site's licensed webfont
  (Typekit/commercial `@font-face`) **no**. When the license is unclear:
  name the closest widely-installed family and say so in the kit's README.
- **Logos: right variant per surface.** `logos.cover` sits on the cover
  background, `logos.section` on `sectionBg` (usually the brand color — use
  the white/inverse variant). **No white variant → omit `logos.section`**; a
  dark logo on a brand-colored band reads as a bug, and an omitted logo is
  just the neutral default. Prefer the SVG slots (`coverSvg`/`sectionSvg`)
  plus a PNG fallback for the `.pptx`; never upscale a favicon.

## Step 3 — Write the kit

A directory named after the brand (lowercase letters, digits, hyphens):

```text
acme/
├── kit.json          the manifest
├── theme.json        the tokens (step 2)
├── logo-cover.svg    + logo-cover.png for the .pptx
├── logo-section.svg  the light-on-dark variant, if the site has one
└── README.md         source URL, harvest date, what was inferred vs read
```

`kit.json`:

```json
{
  "name": "acme",
  "version": "1.0.0",
  "description": "Acme's brand, derived from https://acme.example (2026-08).",
  "theme": "./theme.json"
}
```

The README matters: record the **source URL and date**, which tokens were
read from the CSS and which were inferred, and any contrast adjustment made in
step 4 — the next person re-deriving the kit after a site redesign needs that
provenance. (`lutrin kit import` records the same kind of provenance when
starting from a `.potx`.)

## Step 4 — Validate, look at it, iterate

Write a smoke deck next to the kit, exercising every surface the kit
restyles — cover, section divider, content, metrics, a chart, callouts:

````markdown
---
title: Kit smoke test
subtitle: Every surface the brand touches
author: Kit derivation
kit: ./acme
---

# Section divider

# Content and callouts

Body text, a [link-colored reference](https://example.org), a list.

:::key
The takeaway callout wears the brand tint.
:::

# Metrics

:::metric
42%
A metric card
↑ +12 pts
:::

:::metric
1.8 M
Another
:::

# A chart

```chart
type: bar
categories: Q1, Q2, Q3, Q4
Series A: 120, 150, 180, 210
Series B: 110, 155, 175, 190
```
````

Then the loop:

```bash
npx lutrin validate smoke.md --json   # exit 1 while any error remains
npx lutrin build smoke.md -o smoke.html --verbose
```

- **Fix every `THEME_*` diagnostic.** An invalid token is dropped with a
  diagnostic, never a broken build — so a silent success with warnings means
  part of the brand did not apply. `THEME_CONTRAST` is the one to take
  seriously: the engine checks WCAG (inks ≥ 4.5:1, chart colors ≥ 3:1) and
  **reports rather than silently adjusting** — fixing is your job. Keep the
  hue, move the lightness; the brand survives a darkened ink, it does not
  survive an unreadable slide.
- **Look at the HTML** (open it, or capture it headless) next to the site.
  The question is not "are the hexes equal" but "would the site's reader
  recognize this deck": action color right, type feels right, cover and
  section slides carry the signature, charts readable.
- Iterate on `theme.json` until both hold. The HTML and the `.pptx` come out
  of the same scene, so checking the HTML checks the geometry of both — still
  build the `.pptx` once at the end (`npx lutrin build smoke.md -o smoke.pptx`).

## Step 5 — Package and hand over

```bash
npx lutrin kit create acme            # packs the directory into acme.deckkit
npx lutrin kit install acme.deckkit   # → referenceable as `kit: acme` anywhere
npx lutrin config --kit acme          # optional: user-wide default
```

Or skip installation: a deck can reference the directory directly
(`kit: ./acme` relative to the deck), which keeps the brand versioned with
the documents. Hand the directory to a human with `lutrin kit edit acme` —
the local web editor with live WCAG checks — for tuning past the derivation.

## Boundaries

- **A brand belongs to its organization.** Deriving a kit from a site is for
  that organization's own decks (or work done for it) — do not publish a kit
  carrying someone else's logo and identity as if it were yours, and do not
  ship font files the license does not allow to travel.
- **Data only.** A kit never contains code; nothing from the site's JS
  belongs in it. Colors, type, radii, logos — that is the whole surface.
- **The engine owns the layout.** Do not try to reproduce the site's grid,
  spacing or component geometry: `page`, `type` and `chrome` overrides are
  for exceptional cases, and a kit that fights the engine loses legibility.
  What travels is the palette and the signature.
- **Prefer the org's published tokens** over anything inferred; and when the
  user can supply the brand's `.potx` instead, `lutrin kit import` is the
  better starting point — combine both when available (template for palette
  and type, site for logos and surfaces).
