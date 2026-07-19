---
name: deck
description: Compile a presentation from enriched Markdown (a DSL) into PowerPoint (.pptx) or standalone HTML (browser preview / webview), with a themable compiler — an organization's brand comes from installing its kit. Use whenever the user asks for a presentation, a deck, slides, a PowerPoint, a .pptx or an HTML preview — to write one, change one or regenerate one.
---

# Themable presentation compiler (Lutrin)

This repository holds a **presentation compiler**: Markdown is not the final
format but a **DSL** that describes content; layout is decided entirely by
the engine (layout inference, slot placement, anti-overflow pagination),
following the design tokens of the **active theme** — by default the neutral
"Slate" theme (blue, Arial, no logo), or an organization's brand supplied by
an installed **kit**.

Pipeline: `Markdown → AST (markdown-it) → IR → layout engine → scene → renderer`
Two renderers consume the **same scene** (identical geometry, in px on the
1280 × 720 grid): PptxGenJS → `.pptx`, and an HTML renderer → standalone
document (fonts, images and SVG inlined — no network dependency, designed
for a VS Code webview in live preview).

## IMPORTANT — which kit to use

Before writing a deck, check which kits are installed:

```bash
lutrin kit list
```

**If an organization kit is installed, use it by default** — it is almost
always what the user wants, even when they do not say so:

```yaml
kit: <kit-name>
```

Without a kit, rendering uses the **neutral generic theme**: no logo and no
embedded font. That is normal, not a bug.

⚠️ On the other hand, a kit requested **explicitly** (`--kit` on the CLI, or
`kit:` in the frontmatter) and not found produces a `KIT_NOT_FOUND` of
severity `error`: `lutrin build` **then refuses to compile** (exit code 1,
writes no file). Fix the reference, install the kit, or remove the `kit:`
key — rather than forcing. Only a kit coming from an implicit default
(project, user, editor) falls back silently to the generic theme.

Frontmatter equivalents: `--kit <name>` on the CLI (highest priority), `--kit
<directory>` for a kit that is not installed, a project default
`"lutrin": { "kit": … }` in the package.json nearest the deck, or a user
default `lutrin config --kit <name>` (shared across all projects). The deck's
frontmatter takes precedence over the last two.

## How to proceed

1. **Write the content** in a `.md` file, following the DSL below. NEVER
   think in terms of "layout": describe the content, the engine picks the
   layout. Do not put colors, sizes or positions in the Markdown.
2. **Validate before compiling** — positioned diagnostics (unknown
   directive, non-existent layout, missing image, `chart` spec that could not
   be parsed, slide that overflows…):
   ```bash
   npx lutrin validate path/to/file.md          # readable
   npx lutrin validate path/to/file.md --json   # for an agent (exit 1 on errors)
   ```
   Fix every error (the "did you mean …" suggestions are reliable) and look
   at the warnings before going on. Validation includes a **geometric
   quality check** ("deck doctor"):
   - `BLOCK_OVERFLOW` (warning) — a block overflows its region in an
     unpaginated layout (column, panel): follow the advice in the message
     (trim, split, switch layouts);
   - `LAYOUT_SUGGESTION` (info) — the content betrays a structured intent
     (SWOT, before/after, dated milestones): apply the `<!-- layout: … -->`
     that is proposed, unless there is a reason not to;
   - `IMAGE_UPSCALED` (info) — local image stretched beyond its native
     size: supply a larger visual;
   - `UNKNOWN_ANIMATE` (warning) — unknown animation effect.
   The complete list of codes lives in `capabilities().diagnostics`.
3. **Compile**:
   ```bash
   npx lutrin build path/to/file.md -o output.pptx --verbose   # PowerPoint
   npx lutrin build path/to/file.md -o output.html --verbose   # standalone HTML
   ```
   (`npm run pptx -- …` / `npm run html -- …` remain aliases.)
   `--verbose` lists the layout inferred for each slide — check that the
   inference matches the intent; if not, force it with `<!-- layout: … -->`.
   The format is inferred from the extension of `-o` (`….html` → HTML).

   ⚠️ **`build` fails if the deck carries a single `error` diagnostic**:
   it prints them, exits with **code 1** and **writes no file**. One
   unknown directive, one non-existent layout or one unresolvable `--kit` is
   enough. That is why step 2 (`validate`) is not optional: compiling an
   unvalidated deck is the fastest way to get an incomprehensible failure.

   ```bash
   npx lutrin build file.md -o output.pptx            # 1 error → exit 1, nothing written
   npx lutrin build file.md -o output.pptx --force    # compiles despite the errors
   ```

   **Do not reach for `--force` by reflex**: it fixes nothing, it ships a
   deck known to be faulty (layout replaced by a fallback, brand missing).
   It has exactly one legitimate use — showing a draft in progress, when the
   error is known and accepted. The right answer to a `build` in exit code 1
   is `lutrin validate file.md`, then the fix.
4. **Other commands**:
   - `npx lutrin preview file.md` — local server with automatic
     recompilation and reload (for a human who is editing);
   - `npx lutrin inspect file.md` — IR and scenes as JSON (debugging);
   - `npx lutrin vendor file.md` — freezes external dependencies into the
     deck's directory (remote images, rendered Mermaid diagrams, the kit with
     its fonts and logos) and updates the frontmatter. Offer it when the
     directory has to be handed over, archived or versioned: it then compiles
     offline, on a machine where the kit is not installed. The kit is
     **frozen** — updating it means running vendor again;
   - `npx lutrin capabilities [<deck.md>] [--kit <ref>]` — the layouts,
     directives, chart types and icon colors that are actually supported, as
     JSON. When in doubt about the available syntax, ask this command rather
     than inventing.

     ⚠️ **Always pass it the deck** as soon as a kit is involved:
     ```bash
     npx lutrin capabilities my-deck.md    # THE form to use
     npx lutrin capabilities               # BARE engine: userLayouts ALWAYS empty
     ```
     The bare form describes the engine alone — built-in layouts and the
     official catalog, `userLayouts: []`. With a deck, the frontmatter's
     `kit:` is honored and both the kit's layouts **and** the `layouts/*.json`
     sitting next to the deck are published: that is the only way to see the
     layouts of the brand this deck compiles under. Without a deck, `--kit
     <ref>` publishes a brand's catalog (the current directory then serves as
     the base); `--kit` takes precedence over the frontmatter's `kit:`, as
     everywhere else (`--theme` remains a deprecated alias). A kit requested
     explicitly and not found is an **error** (exit code 1, empty stdout) —
     never a generic catalog delivered in silence. A `layouts/*.json` that
     could not be read only warns on STDERR: stdout stays pure JSON, so
     `| jq` still works.
5. **Check the result** — the fastest way is to compile to HTML and open it
   (or capture it headless): the HTML rendering is geometrically identical to
   the .pptx.
   ```bash
   npm run html -- file.md && open file.html
   ```
   To inspect the .pptx itself: `qlmanage -t -s 1024 -o <directory> output.pptx`
   produces a PNG of the first slide (macOS); read that PNG for a visual
   check. To see **every** slide, export through Keynote:
   ```bash
   osascript -e 'tell application "Keynote"
     set doc to open (POSIX file "/absolute/path/output.pptx")
     export doc to (POSIX file "/absolute/path/png-directory") as slide images with properties {image format:PNG}
     close doc without saving
   end tell'
   ```

## The DSL

What follows is the working crib sheet. **The complete and current reference
is `docs/dsl.md`** (at the root of the repository): read it as soon as a
detail is missing here — frontmatter edge cases, exact layout parameters,
diagnostic semantics. When in doubt about what the installed version
supports, `npx lutrin capabilities <deck.md>` is authoritative on both —
**with the deck as an argument**: the bare form knows neither the
frontmatter's kit nor the neighbouring `layouts/*.json`, and would report
`userLayouts: []` in a project that defines some.

### Frontmatter (generates the cover slide)

```yaml
---
title: Presentation title
subtitle: Subtitle
author: Author name
date: July 2026
footer: Footer text            # default: title
kit: my-kit                    # installed kit, JSON file, directory or none (see "Themes")
---
```

### Splitting

- `# H1` → new slide (the H1 is its title); `---` (hr) splits as well.
- A `# H1` **with no content at all** → **section** slide (theme primary color background, white text).
- `## H2` → internal section: 2 H2 → `two-columns` layout, 3 H2 → `three-columns`.

### Automatically inferred layouts

| Slide content | Layout chosen |
|---|---|
| frontmatter / first text-only slide | `cover` |
| title alone | `section` |
| text + (mermaid, image or chart) | `split` (text 42% / visual 58%) |
| `cover`/`background` image | `hero` (full-page image) |
| dominant table | `table` |
| ≥ 2 `:::metric` blocks | `metrics` (cards) |
| quotation alone | `quote` |
| code block alone | `code` |
| Mermaid diagram alone | `diagram` (full area) |
| chart alone | `chart` (full area) |
| 2 or 3 `##` sections | `two-columns` / `three-columns` |
| everything else | `content` (paginated vertical flow) |

Force a layout: `<!-- layout: split -->` in the slide.

### Structured layouts (always on request, never inferred)

Eight layouts express an **intent** (compare, set milestones, stack…) that
the content alone does not reveal: ask for them with `<!-- layout: … -->`. In
all of them each `## H2` section becomes a panel / milestone / layer /
quadrant / cell / step, and `<!-- animate -->` reveals them one by one. The
content is **not** paginated there: stay brief (validation warns if the
number of sections does not fit).

| Layout | `##` sections | Rendering |
|---|---|---|
| `comparison` | exactly 2 | before / after: understated panel on the left, target panel highlighted (primary-color rule) on the right |
| `pillars` | 2 to 4 | pillars with a primary-color accent at the top — guiding principles, offerings, focus areas (a Lucide icon at the head of a pillar is welcome) |
| `timeline` | 2 to 6 | numbered milestones on an arrowed axis — roadmap, phases (section title = date or phase name) |
| `layers` | 2 to 5 | stacked architecture layers, from the base (dark shade) to the surface; **or** a single bullet list — one item per layer |
| `swot` | exactly 4 | 2 × 2 matrix in semantic tints, in this order: Strengths, Weaknesses, Opportunities, Threats |
| `grid` | 2 to 8 | R × C mosaic of panels — project portfolio, offerings, team, 2 × 2 matrices |
| `steps` | 2 to 6 | sequential process: step panels joined by arrows — journeys, "how it works" |
| `focus` | — | ONE message: the first paragraph becomes a large figure / key sentence, full frame, the rest is the context underneath |

### Official layouts (shipped catalog, pure data)

Ten named layouts, built on the bases above with parameters
(`packages/core/design/layouts/*.json`), always available — ask for them with
`<!-- layout: … -->` just like the built-in layouts. They document the bases
by example:

| Official layout | Base | Intent |
|---|---|---|
| `before-after` | comparison | understated current state → highlighted target |
| `pros-cons` | comparison (green / red panels) | weighing a decision |
| `roadmap` | vertical timeline | dated milestones of a plan, in a column |
| `journey` | steps | the path of a request or a user |
| `priority-matrix` | 2 × 2 grid | effort / impact — trade-offs |
| `risk-map` | tinted 2 × 2 grid | probability / severity, from green to red |
| `funnel` | layers as a funnel | volumes narrowing step by step |
| `pyramid` | layers as a pyramid | hierarchy, from apex to foundations |
| `key-message` | focus | the figure or the sentence that must stick |
| `portfolio` | 3-column grid with headers | projects / services as a mosaic |

Validation suggests them when the content betrays the intent ("Pros / Cons"
headings → `pros-cons`, "Probability / Severity" → `risk-map`). List and
definitions: `capabilities().officialLayouts`.

### Kits and themes (styles without recompiling)

A **kit** is a directory carrying a `kit.json`
(`{ name, version?, theme?: "./theme.json", layouts?: "./layouts" }`), or a
`.deckkit` archive. Its `theme.json` carries the design tokens, its
`layouts/` directory the JSON layouts loaded on every compilation. Kit not
found → `KIT_NOT_FOUND`; invalid manifest → `KIT_INVALID`. A kit contains
only **data**, never code.

Referencing a kit — precedence, from strongest to weakest:

1. `--kit <name | directory | file.json>` on the CLI;
2. `kit:` in the frontmatter — the name of an installed kit, a kit
   directory, or a **JSON file** relative to the deck's directory (the theme
   then **travels with the document**); `kit: none` forces the generic
   default;
3. project default `"lutrin": { "kit": … }` in the package.json nearest the
   deck;
4. user default — `lutrin config --kit <ref>`, shared across all projects and
   with the plugins;
5. host default — kit imposed by a plugin (VS Code, Obsidian);
6. generic "Slate" theme.

The frontmatter takes precedence over any configuration: the document always
wins. `theme:` is still accepted as a deprecated alias of `kit:` (diagnostic
`KIT_DEPRECATED_KEY`) — write `kit:`.

The theme overrides the default's design tokens; any invalid entry is
**dropped with a diagnostic** (`THEME_*`), never a broken compilation. Full
template to copy: `packages/core/design/themes/default.json` (the canonical
mirror of the default — applying it is a no-op); minimal example:
`examples/theme-example.json`; complete example kit:
`examples/kit-slate/`.

```json
{
  "name": "My organization",
  "colors": { "primary": "0B5394", "primaryDarker": "073763" },
  "fonts": { "body": "My Font", "files": { "regular": "./fonts/MyFont.ttf" } },
  "logos": { "cover": "./logo.png", "section": "./logo-white.png" },
  "chartColors": ["0B5394", "B87F00", "0A8A76", "D3310A", "005E99", "8A5C00"]
}
```

- Accepted groups: `colors`, `fonts` (+ `files.regular/bold/italic`, .ttf
  with a .woff2 of the same name beside it for the HTML), `type`, `space`,
  `page` (margins only — `width`/`height` are the physical frame),
  `rounded`, `chrome` (cover/section/footer geometry), `chartColors`,
  `layerShades`, `trendInk`, `semantic`, `logos` (`cover`/`section` as
  PNG/JPEG; `coverSvg`/`sectionSvg` slots for an SVG served in the HTML
  rendering). Exact list: `capabilities().theme`.
- The derived groups **follow the palette**: changing `colors.primary`
  recolors layers, panels, mermaid, icons — except `chartColors`, an
  independent accessibility palette to be supplied explicitly.
- Validation checks the **WCAG thresholds** on the theme
  (`THEME_CONTRAST`: charts ≥ 3:1, inks ≥ 4.5:1) — fix rather than ignore.

### User layouts (`layouts/*.json` next to the deck)

A `layouts/` directory next to the `.md` can define **parameterized layouts**
built on the bases (one file = one definition) — validated, suggested by "did
you mean" and listed in `capabilities().userLayouts` **when the deck is
passed as an argument** (`npx lutrin capabilities my-deck.md`; the bare form
ignores them):

```json
{ "name": "pros-cons-custom", "base": "comparison",
  "sections": { "min": 2, "max": 2 },
  "panels": ["success", "danger"], "pad": 24,
  "description": "Decision: pros (green) / cons (red)." }
```

`base`: a built-in **or official** layout (placement inherited); `sections`:
bounds within those of the base; any other key is a **parameter** of the
base generator, set at the top level of the JSON. Each base publishes its
parameters (types, domains, defaults) in `capabilities().layoutParams` —
consult them rather than inventing. Overview: `comparison.panels/pad`,
`pillars.panels/accent`, `timeline.dot/arrow/numbered/orientation`,
`layers.ratios/shades/shape` (stack, funnel, pyramid), `swot.kinds`,
`split.ratio/side`, `metrics.max/cardHeight`, `grid.cols/panels/kinds/headed`,
`steps.connector/panels`, `focus.align/accent/scale`. Semantic values
reference **design tokens** (panel variants, info/success/warning/danger
tints, layer shades) — never raw colors: the layout picks the variant, the
theme defines its color. Never inferred — always requested with
`<!-- layout: … -->`. Invalid definition → `LAYOUT_DEF_INVALID`; unknown
parameter → `LAYOUT_DEF_ADJUSTED` (the deck compiles without it). Living
example: `examples/kit-slate/layouts/` (the same layouts, shipped in a kit).

### Components

```markdown
:::warning
Callout text (also: info, success, danger).
:::

:::metric
42%
Metric label
↑ +12 pts vs 2025
:::
```

The last line of a `:::metric` card can carry the **trend**: it starts with
`↑ ↗ ↓ ↘ →` (or `+`/`-` in front of a figure, or `=`). The color follows the
direction — up green, down red, flat gray. When a decrease is good news
(incidents, costs, delays), suffix `(+)` to show it in green; `(-)` inverts
the other way:

```markdown
:::metric
142
Major incidents
↓ -38% (+)
:::
```

### Images and diagrams

- `![alt](image.png)` — placed by the engine (`split` layout if text goes with it).
- `![left](image.png)` / `![right](image.png)` — forces the side of the visual.
- `![cover](image.png)` or `![background](image.png)` — full-page image.
- Paths relative to the `.md` file. Missing image → clean placeholder.
- `![alt](https://…)` — **remote image**: downloaded at compile time then
  embedded in the deliverable (no network dependency for the presentation).
  The copy goes into the user cache `~/.cache/lutrin/remote/`, shared across
  projects: compiling writes nothing into the deck's directory. Add
  `assets: vendor` to the frontmatter (or `--vendor-assets`) to keep it in
  `assets/remote/` next to the `.md` — useful only if the directory has to be
  self-contained (archiving, handover, versioning). For free photographs,
  prefer CC0 / public-domain libraries and paste the direct file URL:
  [Openverse](https://openverse.org) (filter on the CC0 licence),
  [Wikimedia Commons](https://commons.wikimedia.org),
  [Pexels](https://pexels.com) / [Pixabay](https://pixabay.com) (very
  permissive in-house licences — check the attribution required).
- ```` ```mermaid ```` — rendered to PNG if `@mermaid-js/mermaid-cli` is
  installed, otherwise a readable fallback (source + note). Offer to install
  it if the user wants graphical diagrams.

### Icons (Lucide)

`![](lucide:name)` — icon from [lucide.dev](https://lucide.dev) (~2000 names,
e.g. `bike`, `house`, `leaf`, `chart-bar`). Rendered in the theme's `primary`
color by default; `![neutral](lucide:name)`, `![secondary](…)` or
`![white](…)` for the permitted inks. Resolution: `node_modules/lucide-static`
→ user cache `~/.cache/lutrin/icons/lucide/` → unpkg download (cached). Ideal
at the head of a column (`## title`, then icon, then text).

### Charts (bars, pie, lines…)

```` ```chart ```` with a line-by-line specification:

```markdown
```chart
type: bar
categories: Q1, Q2, Q3, Q4
Planned: 120, 150, 180, 210
Actual: 110, 155, 175, 190
```
```

- `type`: `bar`, `barh` (horizontal bars), `line`, `area`, `pie`,
  `doughnut`, `radar`. Each `Name: v1, v2, …` line is a series (decimals with
  a **point**). `pie`/`doughnut`: a single series.
- `CHART_COLORS` palette (tokens.mjs): tints of the active theme, adjusted
  and **validated** (color blindness, contrast); 6 series maximum — beyond
  that, group into "Other". Never pick the colors by hand.
- Rendered as an **image** (SVG → PNG): faithful everywhere (PowerPoint,
  Keynote, QuickLook) but not editable in PowerPoint — native OOXML charts
  are invisible in Keynote/QuickLook, which makes this a deliberate choice.
- Invalid specification → shown as a code block (never a broken slide).

### Equations (LaTeX)

```` ```math ```` (or ```` ```latex ````), or `$$…$$` alone in a paragraph:

```markdown
```math
S = \frac{\sum_{i=1}^{n} p_i \cdot c_i}{N} \times (1 + \tau)
```
```

Rendered through MathJax to PNG (`neutral-primary` ink), centered, at its
natural size. Readable fallback (source + note) if `mathjax-full` is not
installed.

### Animations (progressive reveal)

`<!-- animate -->` in a slide → its content appears step by step: one block
at a time, lists **point by point**, columns and `##` sections as a block
(each column = one step). `animate: true` in the frontmatter animates the
whole deck; `<!-- animate: none -->` excludes a slide. Cover and section
slides are never animated; the title and the chrome stay visible throughout.

- **PPTX**: native on-click animations (a `<p:timing>` tree injected in
  post-processing — Keynote imports them too). The effect follows the
  semantics of the block: **fade** for text, **wipe** for the panels of
  structured layouts, **zoom** for timeline milestones and metrics.
  `<!-- animate: fade -->` (or `wipe`, `zoom`, `appear`) imposes a single
  effect on the slide — `animate: fade` in the frontmatter, on the whole
  deck. QuickLook and the PNG export ignore animations: all the content is
  visible there.
- **PPTX, "(cont.)" slides**: every slide produced by pagination gets the
  **Morph** transition (the title slides across, the content carries on;
  fade fallback before PowerPoint 2019) — automatic, nothing to write.
- **HTML**: clicking the slide reveals the next step (counter in the top
  right; a click after the last step resets). Without JS, and in
  print / PDF export, everything is visible.
- **HTML, presenter mode**: the complete document embeds a standalone
  presentation mode (no server — double-clicking the .html is enough):
  `P` full screen, arrows/space to advance through steps then slides, `N`
  presenter view in a second window (notes, timer, next slide), `Esc` to
  leave, `?` for help. None of this appears in fragment mode (webview) or in
  print.

### Quotations and notes

```markdown
> Text of the quotation.
>
> — Attribution

<!-- notes: presenter notes, invisible on screen -->
```

## What the engine guarantees (do not work around it)

**Generic** guarantees, whatever the theme:

- **Automatic pagination**: lists and tables that are too long are split into
  "(cont.)" slides. Do not shorten the content to "make it fit".
- **Accessibility**: the default theme ("Slate") meets the WCAG thresholds
  (inks ≥ 4.5:1, charts ≥ 3:1) — and validation checks them on any applied
  theme.
- **Flat visual system**: 8 px grid, rules without shadows, rounded
  insets; built-in layouts and the official catalog always available.
- **Renderer parity**: the .pptx and the HTML come out of the same scene —
  identical geometry.
- **Default rendering with no logo and no embedded font**: that is normal, no
  warning is emitted (Arial fallback).

Guarantees of an **organization kit** — only if a kit is referenced and
installed:

- **Brand respected**: the kit's palette, typography and signature apply to
  both outputs. Chart colors come from the kit's `chartColors`, never derived
  from the primary.
- **Font embedded in the .pptx** if the kit supplies its `.ttf`
  (`fonts.files`) — PowerPoint displays it even with no font installed on the
  machine. Keynote, QuickLook and LibreOffice ignore embedded fonts → they
  fall back on the system font, unless it is installed locally. The HTML
  inlines the `.woff2` in base64: faithful in any browser, with no
  installation.
- **Signature** on the cover and the section slides if the kit supplies
  `logos`. A logo whose dimensions could not be read is OMITTED, never
  stretched.

## HTML output (preview / live preview)

- **100% standalone document**: woff2 fonts in base64, local and remote
  images as data URIs, charts / icons / equations / Mermaid as inline SVG. No
  external request — compatible with the CSP of a VS Code webview.
- **Same geometry as the .pptx**: every slide is an absolute 1280 × 720 px
  surface scaled to the container by a small inline script (the only piece of
  JS, and optional).
- **Addressable DOM** for a host (VS Code plugin): every slide carries
  `id="slide-N"`, `data-slide` and `data-layout`; presenter notes are
  `<details class="notes">` under the slide.
- **Programmatic API** (`packages/core/src/html/render.mjs`) for use without the CLI:
  ```js
  import { compileHtml } from './packages/core/src/html/render.mjs';
  const { html, stats } = await compileHtml(markdown, { baseDir });
  // fragment: true → { slides, css, fontsCss, … } for a webview (used
  // by the VS Code extension, which updates slide by slide)
  ```
- Printing: `@media print` puts one slide per page (hence PDF through the
  browser).

## Engine architecture (for evolving it)

npm workspaces monorepo: the engine lives in `packages/core` (no organization
brand ships with it — they live in their own repositories, as kits), the
VS Code extension (live preview, diagnostics, export) in `packages/vscode-extension`,
the Obsidian plugin (same functions, wiki embeds `![[…]]` translated) in
`packages/obsidian-plugin`.

| File (under `packages/core/`) | Role |
|---|---|
| `src/deck/tokens.mjs` | Design tokens of the generic design (mirror of the JSON `design/themes/default.json`) — the single source of visual truth; derived groups recomputed by `deriveTokens()` |
| `src/deck/theme.mjs` | JSON themes: `applyTheme` (in-place mutation from the snapshot), `resolveTheme` (validation), WCAG contrast |
| `src/deck/context.mjs` | `prepareDeckContext`: single insertion point for theme + user layouts, called before every `buildScenes` |
| `src/deck/parse.mjs` | Front end: Markdown → IR (`deck → slides → sections → blocks`, with source `line`) |
| `src/deck/layout.mjs` | Analysis (layout inference), slot placement, pagination; **layout registry** (`registerLayout`, generator parameters, official catalog `design/layouts/`, `layouts/*.json`) |
| `src/deck/validate.mjs` | Positioned diagnostics (`validateDeck`) and `capabilities()` |
| `src/deck/suggest.mjs` | "Did you mean …?" (edit distance), shared by validation / themes / layouts |
| `src/pptx/render.mjs` | Scene → PptxGenJS (masters, blocks, optional Mermaid) |
| `src/html/render.mjs` | Scene → standalone HTML document (+ `compileHtml` API, webview `fragment` mode) |
| `src/deck/chart.mjs` | `chart` blocks → SVG styled by the theme (bars, pie, lines, radar) |
| `src/deck/highlight.mjs` | Syntax highlighting of code blocks (shared segments) |
| `src/deck/assets.mjs` | Remote images, Lucide icons, LaTeX, Mermaid (persistent cache `~/.cache/lutrin/`) |
| `src/pptx/fonts.mjs` | Embedding the active theme's TTFs into the .pptx (zip post-processing) |
| `src/pptx/anim.mjs` | Native reveal animations in the .pptx (zip post-processing, `<p:timing>`, effect per block type) |
| `src/pptx/morph.mjs` | Morph transition of the "(cont.)" slides (zip post-processing, fade fallback) |
| `src/cli.mjs` | `lutrin` CLI (`build`, `preview`, `validate`, `vendor`, `inspect`, `config`, `kit`, `capabilities`) |
| `src/vendor.mjs` | `lutrin vendor` — freezing external dependencies into the deck's directory |
| `src/kit/archive.mjs` | `.deckkit` archives: package, download, install (guard rails — see `SECURITY.md`) |
| `src/worker/worker.mjs` | Single IPC worker for the editor hosts (VS Code, Obsidian); types in `protocol.d.ts` |
| `test/` | `node:test` harness: IR + scene goldens, non-mutation, renderer parity, validation |

To add a built-in layout: infer it in `inferLayout()`, register it in the
registry's built-in defs (`layout.mjs`) with its `paramSchema` (its placement
literals become parameters, default = current behaviour), place it in
`buildScenes()`; the renderers never have a layout decision to take. A
**variant** of an existing layout needs no code: a `layouts/*.json` file next
to the deck (base + parameters) is enough — and a variant of general interest
belongs in the official catalog `packages/core/design/layouts/`. To add a
component: container in `parse.mjs` (`CONTAINERS` list), height in
`blockHeight()`, rendering in **both** `BLOCK_RENDERERS` (`src/pptx/render.mjs`
and `src/html/render.mjs`), and an example in `examples/demo.deck.md` — that
is the exhaustive renderer coverage fixture, and the parity test fails as
long as one type of the renderers is absent from it.
After any change to the engine: `npm test` (IR and scene goldens;
`UPDATE_GOLDEN=1 npm test` regenerates after an intended change, inspect the
goldens diff before committing), then compile the demo to `.pptx` **and**
`.html` — `lutrin validate examples/demo.deck.md` must stay free of
diagnostics.

## Recommended agent loop

```text
write file.md
   ↓
npx lutrin validate file.md --json        → fix until valid: true
   ↓                                        (build refuses to compile before that)
npx lutrin build file.md -o output.html --verbose
   ↓
visual check (browser or headless capture), revisit the density
   ↓
npx lutrin build file.md -o output.pptx
```

The two exit codes that drive the loop: `validate` exits with **code 1** as
long as one `error` diagnostic remains, and so does `build` — and in that case
it writes nothing. A `build` in exit code 0 therefore means a file exists and
no error is left (unless `--force` was passed, in which case exit code 0 no
longer guarantees anything: re-read the output).
