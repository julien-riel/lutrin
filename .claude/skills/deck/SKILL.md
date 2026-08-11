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
     unpaginated layout (column, panel) even after the engine has spent the
     text scale on it: follow the advice in the message (trim, split, switch
     layouts) — nothing automatic is left to try;
   - `SLIDE_DENSIFIED` (info) — a region did not fit and was re-flowed a
     step down the text scale (`compact`, then `dense`). The deck is correct
     as it stands; shorten that region if you want the deck's default size
     back;
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
   npx lutrin build path/to/file.md -o output.pdf              # PDF, one page per slide
   npx lutrin build path/to/file.md --png -o frames.png        # frames-01.png, …
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
diagnostic semantics. For a status board or a dense one-pager, read
`docs/dashboard-guide.md`: it holds the accepted `:::progress` values, the
badge prefixes, the text scale step by step and a copy-pasteable dashboard
layout. When in doubt about what the installed version
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

Twelve layouts express an **intent** (compare, set milestones, stack, loop…)
that the content alone does not reveal: ask for them with
`<!-- layout: … -->`. In all of them each `## H2` section becomes a panel /
milestone / layer / quadrant / cell / step / node, and `<!-- animate -->`
reveals them one by one. The
content is **not** paginated there: stay brief (validation warns if the
number of sections does not fit).

| Layout | `##` sections | Rendering |
|---|---|---|
| `comparison` | exactly 2 | before / after: understated panel on the left, target panel highlighted (primary-color rule) on the right |
| `pillars` | 2 to 4 | pillars with a primary-color accent at the top — guiding principles, offerings, focus areas (a Lucide icon at the head of a pillar is welcome) |
| `timeline` | 2 to 6 | numbered milestones on an arrowed axis — roadmap, phases (section title = date or phase name) |
| `layers` | 2 to 5 | stacked architecture layers, from the base (dark shade) to the surface; **or** a single bullet list — one item per layer |
| `swot` | exactly 4 | 2 × 2 matrix in semantic tints, in this order: Strengths, Weaknesses, Opportunities, Threats |
| `grid` | 2 to 9 | R × C mosaic of panels — project portfolio, offerings, team, 2 × 2 or 3 × 3 matrices |
| `steps` | 2 to 6 | sequential process: step panels joined by arrows — journeys, "how it works" |
| `focus` | — | ONE message: the first paragraph becomes a large figure / key sentence, full frame, the rest is the context underneath |
| `cycle` | 3 to 8 | discs on a closed loop joined by arrows — a process that returns to its start (a section's first paragraph becomes the node's second line) |
| `hierarchy` | — | a tree with elbow connectors, fed by a **nested bullet list** (or `##` sections, each heading a branch) — org chart, breakdown |
| `venn` | 2 to 4 | overlapping translucent discs; the intersection is the argument |
| `radial` | 2 to 8 | a hub and its satellites — the **lead paragraph** (before the first `##`) is the hub, each `##` a spoke |
| `apex` | 2 to 6 | levels stacked into a triangle, the apex first — proportions, priorities. NOT `pyramid`, which is the official layout of bands carrying a heading *and* its paragraph |

The last five are **diagrams**. Their labels are plain text: bold, italic,
code, links and badges inside a node are dropped (`SMARTART_TEXT` says so).
They take no `density` / `align` / `panels` / `radius`; `cycle` takes
`numbered`, `venn` takes `overlap`.

**Real SmartArt.** `lutrin build deck.md --smartart` (or `smartart: true` in
the frontmatter) exports those five as genuine OOXML SmartArt: PowerPoint
opens its own *SmartArt Design* ribbon on the object. It is opt-in because it
costs something — **Keynote and macOS Quick Look show nothing**, PowerPoint
re-lays the diagram out with its own engine (so the frame, the node count, the
reading order and the palette are guaranteed, not the coordinates), and the
object is not animated. Without the flag a diagram is native editable shapes,
pixel-identical to the HTML, and displays everywhere. The flag is ignored on
the HTML path.

### Official layouts (shipped catalog, pure data)

Twelve named layouts, built on the bases above with parameters
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
| `raid` | swot, compact | the RAID log: Risks, Assumptions, Issues, Dependencies |
| `status-list` | 1-column grid, dense text | a status board: progress bars and badges, stacked |

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
5. host default — kit imposed by the editor host (VS Code);
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
  "fonts": { "body": "My Font", "display": "My Display", "files": { "regular": "./fonts/MyFont.ttf" } },
  "surface": { "coverBg": "0B1F3A", "coverInk": "FFFFFF", "coverMutedInk": "AEBED6" },
  "accent": { "bar": "0B5394", "coverBar": "6FA8DC", "rule": "CED4DA" },
  "logos": { "cover": "./logo.png", "section": "./logo-white.png" },
  "chartColors": ["0B5394", "B87F00", "0A8A76", "D3310A", "005E99", "8A5C00"]
}
```

- Accepted groups: `colors`, `fonts` (`body`, `mono`, `display` — the second
  family the titles and the pull-quote wear; `+ files`/`displayFiles`
  `.regular/bold/italic`, each a .ttf with a .woff2 of the same name beside it
  for the HTML), `type`, `space`, `page` (margins only — `width`/`height` are
  the physical frame), `rounded`, `chrome` (cover/section/footer geometry),
  `surface` (`pageBg`, `coverBg`/`coverInk`/`coverMutedInk`,
  `sectionBg`/`sectionInk` — the slide backgrounds and the inks on them),
  `accent` (`bar`/`rule` — the signature flourishes and the title rule; plus
  `coverBar`, the cover bar alone, which follows `bar` unless set — set it when
  `surface.coverBg` is the brand colour, or the bar draws itself in the colour
  it lies on),
  `chartColors`, `layerShades`, `trendInk`, `semantic`, `logos`
  (`cover`/`section` as PNG/JPEG; `coverSvg`/`sectionSvg` slots for an SVG
  served in the HTML rendering). Exact list: `capabilities().theme`.
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
`split.ratio/side`, `metrics.max/cardHeight`,
`grid.cols/panels/kinds/spans/headed` (`spans` = the columns each cell takes,
cycling — six panels over a full-width band is `[1,1,1,1,1,1,3]` at `cols: 3`),
`steps.connector/panels`, `focus.align/accent/scale`. Four parameters govern
how the text and the surfaces look, and they are the **only** sanctioned way
to ask for any of it:

- `density` (`comfortable` / `compact` / `dense`) — on `grid`, `comparison`,
  `pillars`, `steps`, `swot`, `layers` and `content`. Scales the paragraphs,
  lists, tables and callouts the layout places: the lever for a board of six
  panels, and the only way to ask for smaller body text (a point size is never
  written in a deck). The engine pulls the same lever by itself — a bounded
  region (panel, column, cell) that overflows is re-flowed one step down, two
  at most, and says so through `SLIDE_DENSIFIED`; a flowing `content` slide is
  paginated instead and never densified. So setting `density` by hand is about
  the look wanted, not about making things fit.
- `panels` — a variant per panel: the neutral ones (`muted`, `highlight`,
  `pillar`) or a tint in one of two tones, `warning` (pale callout surface) or
  `warning-solid` (saturated chip: status pill, state bar, coloured band). The
  ink follows the tone by itself, and a solid panel imposes it on every block
  it holds.
- `radius` (`sm` / `md` / `lg` / `pill`) — on `comparison`, `pillars`, `grid`
  and `steps`; overrides the radius the variant has by default, `pill` being
  half the shorter side.
- `align` (`left` / `center` / `right`) — on `content`, `grid`, `metrics` and
  `focus` (centered by default there). The ONLY way to align text: a deck
  never aligns a paragraph of its own. The sole exception is a table column,
  aligned by its Markdown delimiter row (`|---:|` right, `|:-:|` centre),
  which both outputs honour.

Semantic values reference **design tokens** (panel variants,
info/success/warning/danger tints, layer shades) — never raw colors: the
layout picks the variant, the theme defines its color. Never inferred —
always requested with `<!-- layout: … -->`. Invalid definition →
`LAYOUT_DEF_INVALID`; unknown parameter → `LAYOUT_DEF_ADJUSTED` (the deck
compiles without it). Living example: `examples/kit-slate/layouts/` (the same
layouts, shipped in a kit).

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

**Progress bars and status badges** — the two components of a status board.
Write these rather than a table of "Item | % | Status": a table says the same
thing and shows none of it.

```markdown
:::progress success
100 %
Online services
Delivered in April
:::

:::status
Scope, Schedule, Quality
!Budget
!!Recruitment
:::
```

`:::progress` takes the share on the first line (`75 %`, `0.75` or `3/4` — a
figure out of range is clamped), optionally followed by the target it is judged
against (`62 % / 80 %`, drawn as a rule on the track), then the label, then an
optional caption; the
word after the directive is the tint (`info` — the default — `success`,
`warning` or `danger`). A first line that is no share at all is not guessed
at: the card degrades to the paragraph written and `INVALID_PROGRESS` says so.
`:::status` is a **row** of badges, one per comma: nothing = success, `!` =
caution, `!!` = critical, `?` = information. The same badge exists inline —
`Each commitment carries an ==Owner==; one that slips is ==!At risk==.` — as a
pill in the HTML and, PowerPoint having no rounded background for a text run,
as a highlighted run in the `.pptx`: a documented degradation, not a bug.

`<!-- layout: status-list -->` stacks such sections into a status board, one
band per `##`.

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
e.g. `bike`, `house`, `leaf`, `chart-bar`). Resolution:
`node_modules/lucide-static` → user cache `~/.cache/lutrin/icons/lucide/` →
unpkg download (cached). Ideal at the head of a column (`## title`, then icon,
then text).

The alt slot holds **intent words**, in any order — an ink and a size:

| | Words | Default |
|---|---|---|
| Ink | `primary`, `neutral`, `secondary`, `white` (dark panels only) | `primary` |
| Size | `line`, `small`, `medium`, `large` | `medium` |

```markdown
![large](lucide:leaf)           one step up from the slot's size
![neutral small](lucide:leaf)   both words, either order
![line](lucide:leaf)            as tall as one line of body text
```

Sizes are words, never points: `small`/`medium`/`large` are factors on the size
the slot already governs, so a narrow column still wins over a `large` icon.
`line` is the smallest and follows the body text instead of a factor — the
theme's, and the step a crowded region was re-flowed at — for an icon standing
beside text. Never write a point size: the engine owns dimensions.

The slot is intent **or** description, never half of each: the words apply only
if the alt is nothing but vocabulary. `![A white arrow](lucide:arrow-right)` is
a sentence and is read as no intent at all — do not expect `white` inside one
to tint anything, and do not write a description hoping it will be read out
(both formats describe an icon by its NAME). A lone unknown word IS taken for
an intent and reported: `![big]` → `UNKNOWN_ICON_WORD` with the nearest word
suggested. Two inks or two sizes: the first wins, `ICON_WORD_CONFLICT` names
the other. Casing is free (`![Large]` = `![large]`).

An icon is never the visual of a `split`: it flows with the text, at the head
of its column. The visual column is for a chart, a diagram or a photo.

**An icon cannot go inside a sentence** — nor a table cell, a bullet or a
heading, which are sentences too. A run of text holds text in both formats: a
DrawingML cell is a text body, and the engine leaves row heights to PowerPoint,
so there is no geometry to float an image against. An icon written into one is
dropped and reported (`TABLE_CONTENT_DROPPED`, `LIST_CONTENT_DROPPED`,
`HEADING_CONTENT_DROPPED`) — write it on its own line, above the list or under
the heading. For a status column, use an inline badge (`==Delivered==`,
`==!At risk==`); for a matrix of marks, `type: heat` or `type: rating`.

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

- `type`: `bar`, `barh` (horizontal bars), `stacked-bar`, `stacked-barh`,
  `share-bar`, `share-barh` (each category normalised to 100 %), `line`,
  `area`, `pie`, `doughnut`, `radar`, `waterfall`, `gantt`, `rating`, `heat`. Each
  `Name: v1, v2, …` line is a series (decimals with a **point**).
  `pie`/`doughnut`: a single series.
- `target:` (or `cible:`) — the line a series is judged against (an SLA, a
  budget), drawn dashed in the deck's ink and taken into the scale. Reserved
  only when the value is a SINGLE number, so a series named "Target" survives.
- `waterfall` — a bridge from an opening figure to a closing one; the first and
  last categories are the anchors, `totals:` names them when there is a
  mid-bridge subtotal. The one chart where hue carries the SIGN (rise, fall)
  rather than the identity.
- `rating` — a scorecard of part-filled discs, options × criteria. `scale:`
  declares the denominator and is never inferred from the largest value seen;
  at `scale: 4` the fills land on the quarters. Drawn, not typeset.
- `heat` — a tinted matrix (rows × columns) on the theme's layer shades, each
  cell keeping its number. `scale:` is near-essential: without it the ramp
  normalises on the largest value present, so one outlier repaints the grid —
  the figure labels the bound "(largest value)" when that happens.
- `gantt` — lanes spanning periods: `Discovery: Q1 - Q2`, both ends included,
  a comma for several bars on one lane, `now:` for the "we are here" rule. The
  only way to draw a DURATION in this DSL.
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
- **PPTX, slides that share a title**: consecutive slides showing the same
  title get the **Morph** transition (the title holds still, the content
  carries on; fade fallback before PowerPoint 2019) — the pages of a paginated
  slide, and the slides an author titled the same way. Automatic, nothing to
  write; different titles opt out. A title repeated far apart gets nothing.
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
- Printing: `@media print` puts one slide per page — which is what both the
  hand-printed PDF and `lutrin build --pdf` use.
- **PDF and images**: `--pdf` writes one page per slide with an outline of the
  slide titles; `--png` / `--jpeg` name a STEM and write one file per slide at
  2×, reading the same print stylesheet so an image and its PDF page match.
  `-o deck.pdf` is enough on its own. These three REQUIRE a browser (Chrome,
  Edge, Brave, Chromium, or `lutrin setup-mermaid`'s download) and refuse
  before writing without one — unlike Mermaid, where a missing browser only
  degrades the diagram. The presenter notes are NOT in the PDF: annotations
  would mean a PDF library, and that dependency is declined.

## Engine architecture (for evolving it)

npm workspaces monorepo: the engine lives in `packages/core` (no organization
brand ships with it — they live in their own repositories, as kits) and the
VS Code extension (live preview, diagnostics, export) in
`packages/vscode-extension`.

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
| `src/deck/anim.mjs` | The one entrance-effect table both renderers read |
| `src/pptx/svg.mjs` | Vector twin of a picture in the .pptx (`asvg:svgBlip`), PNG kept as the fallback |
| `src/deck/svg.mjs` | Sanitizing outside SVG, and fitness to become an XML part |
| `src/kit/from-template.mjs` | Kit derived from a `.potx`/`.pptx` — colours and type only, never geometry |
| `src/pptx/morph.mjs` | Morph transition between consecutive slides sharing a title (zip post-processing, fade fallback) |
| `src/cli.mjs` | `lutrin` CLI (`build`, `preview`, `validate`, `vendor`, `inspect`, `config`, `kit`, `capabilities`) |
| `src/vendor.mjs` | `lutrin vendor` — freezing external dependencies into the deck's directory |
| `src/kit/archive.mjs` | `.deckkit` archives: package, download, install (guard rails — see `SECURITY.md`) |
| `src/worker/worker.mjs` | IPC worker for the editor host (VS Code); types in `protocol.d.ts` |
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
