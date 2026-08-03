# DSL reference

The Markdown of a Lutrin deck is not an output format: it is a **DSL** that
describes content and intent. Page layout — the layout, positions, sizes,
colors — is decided by the engine. Writing a deck therefore means saying
*what is on the slide*, never *where to put it*.

This page describes everything the compiler actually understands. When in
doubt, the `lutrin capabilities` command answers in JSON from the installed
engine: that is what is authoritative, and this page is its readable
translation.

**Pass it the deck** — `lutrin capabilities <deck.md>` — as soon as a kit or a
`layouts/` directory comes into play: with no argument it describes only the
bare engine (built-in layouts and the official catalog, `userLayouts` empty),
and therefore ignores the brand this deck compiles under. With no deck at
hand, `--kit <ref>` publishes a brand's catalog.

Contents:
[frontmatter](#frontmatter) ·
[splitting](#splitting-into-slides) ·
[inferred layouts](#inferred-layouts) ·
[structured layouts](#structured-layouts-on-request) ·
[official layouts](#official-layouts) ·
[custom layouts](#custom-layouts-layoutsjson) ·
[text](#text-lists-tables-quotes) ·
[callouts, metrics, progress, status](#callouts-metrics-progress-and-status) ·
[images and icons](#images-icons-diagrams) ·
[diagrams](#diagrams-cycle-hierarchy-venn-radial) ·
[charts](#charts) ·
[equations](#equations-latex) ·
[animations](#animations) ·
[notes](#presenter-notes) ·
[HTML and PDF](#html-output-presentation-mode-and-pdf) ·
[diagnostics](#diagnostics)

---

## Frontmatter

A **flat** YAML block (`key: value`, one per line) delimited by `---`. It
generates the cover slide.

```yaml
---
title: Presentation title
subtitle: Subtitle
author: Author
date: July 2026
footer: Footer text                # default: title
notes: what to say over the cover  # presenter notes of the generated cover
kit: my-kit                        # brand to apply (see below)
animate: true                      # animates the whole deck
assets: vendor                     # keeps remote images next to the .md
---
```

| Key | Effect |
|---|---|
| `title` | cover title, and default footer |
| `subtitle`, `author`, `date` | secondary lines of the cover |
| `footer` | footer text, when it must differ from the title |
| `notes` | presenter notes of the **cover generated from `title:`** — the one slide no `<!-- notes: -->` can reach, since there is no line in the source to hang the comment on. A flat one-line value like every key here (the frontmatter reader is a one-line-per-key scanner: there is no block form to write). With no generated cover — no `title:`, or a Marp deck — the line is inert and says so: `COVER_NOTES_ORPHAN` |
| `kit` | name of an installed kit, path to a kit directory, path to a `.json` file, or `none` to force the generic theme |
| `animate` | `true` animates every slide (see [Animations](#animations)); an effect value (`fade`, `wipe`, `zoom`, `appear`) imposes it on the whole deck |
| `assets` | `vendor` copies remote images into `assets/remote/` next to the `.md` |
| `smartart` | `true` exports the diagram layouts as real OOXML SmartArt (see [Diagrams](#diagrams-cycle-hierarchy-venn-radial)) — ignored on the HTML path |
| `marp` | `true` reads the deck as **Marp Markdown** instead of this DSL — see [docs/marp.md](marp.md) |

Surrounding quotes are stripped (`title: "My title"` = `title: My title`).
Other keys are ignored by the compiler — `deck: true`, for example, only
helps the VS Code extension recognize a deck.

`notes` used to be one of those ignored keys, and the consequence is worth
stating plainly: a deck that already carries `notes:` as private metadata now
hands that line to its cover — in the `.pptx` notes and in the HTML presenter
view. Rename the key if it was never meant to be spoken.

`theme:` is still accepted as a **deprecated alias** of `kit:` and produces
the `KIT_DEPRECATED_KEY` diagnostic.

---

## Splitting into slides

- `# H1` opens a new slide; the H1 is its title.
- `---` (horizontal rule) also splits, without giving a title.
- A `# H1` **with no content at all** becomes a **section** slide: primary
  color background, title set large.
- `## H2` opens an **internal section** of the slide — a column, a panel, a
  milestone, a quadrant, depending on the layout.
- `### H3` and beyond are rendered as they are, as a subheading in the flow of
  the content: they split nothing and open no section.

The number of `##` sections is the main signal given to the engine: two
sections make two columns, three make three, and the structured layouts turn
them into panels.

---

## Inferred layouts

With no instruction, the engine chooses from the content. The rules are
evaluated in this order, and the first one that applies wins:

| Slide content | Layout |
|---|---|
| a `cover` or `background` image | `hero` — full-page image |
| no block | `cover` if it is the first slide, otherwise `section` |
| first slide, 1 or 2 paragraphs, no `##` section | `cover` |
| at least 2 `:::metric` blocks, and little else | `metrics` — cards |
| a lone quote | `quote` |
| text **and** a visual (image, `chart`, `mermaid`) | `split` — text 42 %, visual 58 % |
| a table (with at most one other block) | `table` |
| exactly 2 titled `##` sections | `two-columns` |
| exactly 3 titled `##` sections | `three-columns` |
| a lone code block | `code` |
| a lone Mermaid diagram | `diagram` |
| a lone chart | `chart` — full area |
| everything else | `content` — **paginated** vertical flow |

Forcing a layout, when inference does not guess the intent:

```markdown
# Slide title

<!-- layout: split -->

The content…
```

**Where to write it** — a directive applies to the slide **that surrounds
it**, and the unambiguous place is AFTER the `# H1`, in the body of the slide
it governs. Written just above the `# H1`, it still applies to the slide that
follows **provided no slide is open** at that point — that is, at the top of
the file or right after a `---`. Otherwise (the common case: content precedes
it in the same slide), it is the **previous** slide that it silently
reconfigures. And a directive after which no slide opens — under the last
`---` of the file, for example — governs nothing: it produces
`ORPHAN_DIRECTIVE` and has no effect. The same rule holds for
`<!-- notes: … -->` and `<!-- animate -->`.

An unknown layout name produces `UNKNOWN_LAYOUT` with a "did you mean"
suggestion. The living list is in `capabilities().layouts` — queried with the
deck (`lutrin capabilities <deck.md>`), failing which the kit's layouts and
those of the neighbouring `layouts/` directory are absent from it even though
validation does accept them.

---

## Structured layouts (on request)

Twelve layouts express an **intent** that content alone does not reveal. They
are **never inferred**: they must be asked for with `<!-- layout: … -->`. In
all of them, each `## H2` section becomes a panel, a milestone, a layer, a
quadrant, a step or a node.

| Layout | `##` sections | Rendering |
|---|---|---|
| `comparison` | 2 | before / after: understated panel on the left, highlighted panel on the right |
| `pillars` | 2 to 4 | pillars with an accent band — principles, offerings, priorities |
| `timeline` | 2 to 6 | numbered milestones on an arrowed axis (section title = date or phase) |
| `layers` | 2 to 5 | layers stacked from the base to the surface; **or** a single bullet list, one item per layer |
| `swot` | 4 | a 2 × 2 matrix in semantic tints, in the order Strengths, Weaknesses, Opportunities, Threats |
| `grid` | 2 to 8 | a mosaic of panels — portfolio, offerings, 2 × 2 matrix |
| `steps` | 2 to 6 | steps joined by arrows — a journey, "how it works" |
| `focus` | — | ONE message: the first paragraph becomes a large figure or a full-frame sentence, the rest serves as context |
| `cycle` | 3 to 8 | discs on a closed loop, joined by arrows — a process that returns to its start |
| `hierarchy` | — | a tree with elbow connectors, fed by a **nested bullet list** (or `##` sections, each heading a branch) |
| `venn` | 2 to 4 | overlapping translucent discs; the intersection is the argument |
| `radial` | 2 to 8 | a hub and its satellites — the **lead paragraph** is the hub, each `##` a spoke |

The last four are the **diagram layouts**; they have a section of their own
[below](#diagrams-cycle-hierarchy-venn-radial).

Their content is **not paginated**: keep it short. A section count outside the
bounds produces `LAYOUT_SECTIONS` (the surplus will be ignored, a shortfall
will leave gaps).

---

## Official layouts

Twelve layouts shipped with the compiler
(`packages/core/design/layouts/*.json`). They are parameterized structured
layouts — **data**, not code — and they are always available.

| Layout | Base | Intent |
|---|---|---|
| `before-after` | comparison | understated current state → highlighted target |
| `pros-cons` | comparison (green / red) | weighing a decision |
| `roadmap` | vertical timeline | dated milestones of a plan, in a column |
| `journey` | steps | the path of a request or a user |
| `priority-matrix` | grid 2 × 2 | effort / impact |
| `risk-map` | grid 2 × 2, tinted | probability / severity, from green to red |
| `funnel` | layers as a funnel | volumes narrowing step by step |
| `pyramid` | layers as a pyramid | a hierarchy, from apex to foundations |
| `key-message` | focus | the figure or the sentence that must stick |
| `portfolio` | grid, 3 columns with headers | projects or services as a mosaic |
| `raid` | swot, compact | the RAID log: Risks, Assumptions, Issues, Dependencies |
| `status-list` | grid, 1 column, dense | a status board: progress bars and badges, stacked |

Validation **suggests** them when the content betrays the intent: sections
"Pros" / "Cons" propose `pros-cons`, headings "Probability" / "Severity"
ordered from benign to critical propose `risk-map`, four sections in the
canonical order propose `swot`, and titles starting with a date or "Phase 2"
propose `timeline` (the `LAYOUT_SUGGESTION` diagnostic).

Exact definitions: `capabilities().officialLayouts`.

---

## Custom layouts (`layouts/*.json`)

A `layouts/` directory **next to the deck** defines parameterized layouts, one
file per definition. They are validated, suggested by "did you mean" and
published in `capabilities().userLayouts` — without recompiling anything at
all. Mind the form of the command: since this directory is known only by its
position beside the `.md`, only `lutrin capabilities <deck.md>` lists them;
the bare form returns `userLayouts: []`.

```json
{
  "name": "pros-cons-custom",
  "base": "comparison",
  "sections": { "min": 2, "max": 2 },
  "panels": ["success", "danger"],
  "pad": 24,
  "description": "Decision: for (green) / against (red)."
}
```

- `base` — a built-in **or official** layout; placement is inherited from it.
- `sections` — bounds, within those of the base.
- any other top-level key is a **parameter** of the base.

Semantic values designate **tokens** (panel variants, `info`/`success`/
`warning`/`danger` tints, layer shades), never raw colors: the layout picks
the variant, the theme decides its color.

Parameters published by the bases (exact types, domains and defaults in
`capabilities().layoutParams`):

| Base | Parameters |
|---|---|
| `split` | `ratio` (0.2–0.8, default 0.42), `side` (`right`/`left`) |
| `metrics` | `max` (1–6, default 4), `cardHeight` (120–320 px, default 176), `align` |
| `comparison` | `panels` (list of variants), `pad` (0–48 px), `density`, `radius` |
| `pillars` | `panels`, `accent` (boolean), `density`, `radius` |
| `timeline` | `dot` (20–48 px), `arrow`, `numbered`, `orientation` (`horizontal`/`vertical`) |
| `layers` | `ratios`, `shades`, `shape` (`stack`/`funnel`/`pyramid`), `density` |
| `swot` | `kinds` (tint per quadrant), `density` |
| `grid` | `cols` (1–4), `panels`, `kinds`, `spans`, `headed`, `density`, `radius`, `align` |
| `steps` | `connector` (`arrow`/`line`/`none`), `panels`, `density`, `radius` |
| `content` | `density`, `align` |
| `focus` | `align` (default `center`), `accent`, `scale` (0.5–2.5) |
| `cycle` | `numbered` (boolean, default `true`) |
| `venn` | `overlap` (0–0.6, default 0.32 — the share of a disc its neighbour covers) |

`hierarchy` and `radial` publish no parameter: a tree and a wheel have nothing
to configure that is not already in the content. Nor do any of the four take
`density`, `align`, `panels` or `radius` — a diagram's labels do not flow
through the block layout, so those settings would be lies.

`panels` takes the neutral variants (`muted`, `highlight`, `pillar`) and the
four tints in two tones: `warning` is the pale callout surface, `warning-solid`
the saturated chip — a status pill, a state bar, a coloured band. The ink
follows the tone (the theme picks it per tint, always at 4.5:1) and a
saturated panel imposes it on every block that writes straight onto it —
paragraphs, lists, headings, tables, quotes, the label of a bar — so the text
is legible without anyone naming a colour. Blocks that bring a surface of
their own keep their own ink, measured against that surface: a callout, a
metric card, a code block, a badge. `radius` — `sm`, `md`, `lg` or `pill` —
overrides the radius each variant has by default; `pill` is half the shorter
side, whatever the panel's size.

**`spans` — cells that span several columns.** A list of column counts,
cycling like `panels`: `"cols": 3, "spans": [1, 1, 1, 1, 1, 1, 3]` puts six
panels over a full-width band. Placement is a left-to-right flow, exactly as a
reader scans — a cell that no longer fits opens the next row, and the gap a
wide cell leaves at the end of a row is kept rather than filled by a later
cell. That is deliberate: the author wrote those sections in an order, and
reading order is the one thing a mosaic must not rearrange. A span wider than
the grid is a full-width cell, never an overflow.

`align` — `left` (default), `center` or `right` — is the horizontal alignment
of the text the layout places: the blocks in the flow (`content`), the text
inside the cells (`grid`), what is written under the cards (`metrics`), the key
message (`focus`, centered by default). It exists **only** as a layout setting:
a deck never aligns a paragraph of its own, because choosing where the ink sits
in a region is the engine's job, not the author's. The one exception is a table
column, whose alignment comes from the Markdown itself (see below).

`density` — `comfortable` (default), `compact` or `dense` — is the text scale
of the blocks the layout places: paragraphs, lists, tables and callouts are
sized down from the theme's own tokens (× 0.78 and × 0.64, rounded to the half
point, never below 7 pt). It is what a dashboard of six panels needs, and it
is expressed as an intent word in the layout definition: a point size never
appears in the deck itself.

It is also the engine's **auto-fit** lever. Where a region is bounded — a
panel, a column, a cell, anything a layout places without pagination — content
that does not fit is re-flowed one step down the scale, and a second step if it
still does not. The whole region steps down together (three type sizes in one
panel would read as a bug, not as a fit), and the steps are the three above,
nothing in between. Only what the scale touches makes a region shrinkable: one
holding nothing but an image, a diagram or a code block is left exactly as it
is, since announcing a densification the rendering would deny is worse than
saying nothing. `dense` is the floor: below it the engine stops and
`BLOCK_OVERFLOW` says so, with the clause "already at the densest step" so the
advice does not repeat what the compiler has already done. Every densified
region is reported by `SLIDE_DENSIFIED` (info) — an automatic size is a
decision, and the author has to be able to refuse it by shortening the text.

**Pagination wins over auto-fit.** In a flowing layout (`content` and its
"(cont.)" slides) nothing is ever densified: a flow has somewhere to put the
overflow, and shrinking it instead would trade a legible second slide for a
cramped single one.

Like the structured layouts, they are **never inferred**: always asked for
with `<!-- layout: … -->`. An invalid definition produces
`LAYOUT_DEF_INVALID`; an unknown parameter produces `LAYOUT_DEF_ADJUSTED` and
the deck compiles without it.

A complete example, ready to copy: `examples/kit-slate/layouts/`. A dashboard
definition using `density`, `radius`, `align` and the saturated panel tints,
with the deck that goes with it:
[the dashboard guide](dashboard-guide.md#building-a-dashboard-layout).

---

## Text, lists, tables, quotes

Ordinary Markdown works: paragraphs, **bold**, *italic*, `inline code`,
links, bullet and numbered lists (nesting on three levels), tables.

Lists and tables that run too long are **paginated** automatically into
"(cont.)" slides — do not shorten the content to "make it fit" (the
`SLIDE_PAGINATED` diagnostic, purely informational).

A table's **delimiter row is honoured**: `|---:|` right-aligns the column,
`|:-:|` centres it, in both outputs. Saying "this column holds figures" is
content, like `**bold**` — the alignment is read once per column, from the
header, because Markdown has no per-cell syntax.

```markdown
| Line     | Share | Amount |
|----------|:-----:|-------:|
| Licences |  42 % |  1 517 |
```

In the HTML a right-aligned column also gets tabular figures
(`font-variant-numeric: tabular-nums`), so the thousands line up under one
another and not just the last digit. The `.pptx` does not: DrawingML run
properties carry no OpenType feature switch, and the only OOXML mechanism that
would do it — a decimal tab stop — means writing tab characters into the cells.
The default body face (Arial) has tabular figures anyway, so the two outputs
agree unless a kit ships a font with proportional digits.

Inside a sentence, `==Action==` marks a **badge** — a status word set off from
the prose, tinted by an optional prefix (`==!At risk==`). See
[status badges](#status-badges) for the prefixes and for what the `.pptx` can
and cannot draw.

A quote, with optional attribution: the last paragraph of a quote block that
starts with a dash becomes the source.

```markdown
> The compiler chooses the layout, the author describes the content.
>
> — The project's contract
```

---

## Callouts, metrics, progress and status

Seven directives, written as `:::` blocks:

```markdown
:::info
A neutral callout. Also: success, warning, danger.
:::
```

A callout only renders **paragraphs and bullet lists**. Any other block
(image, table, code) would be ignored inside it: move it out of the callout —
the compiler reports this with `ALERT_CONTENT_DROPPED`.

The fifth directive is the metric card: first line the value, the rest the
label.

```markdown
:::metric
42 %
Share of cases handled in under 5 days
↑ +12 pts vs 2025
:::
```

Two cards or more on a slide trigger the `metrics` layout.

**Trend** — the last line of a card becomes a trend if it starts with
`↑ ↗ ↓ ↘ →`, with `=`, or with `+`/`-` followed by a digit. The color follows
the direction: a rise in green, a fall in red, flat in gray. When a fall is
good news (incidents, costs, delays), suffix `(+)` to display it in green;
`(-)` inverts the other way.

```markdown
:::metric
142
Major incidents
↓ -38 % (+)
:::
```

Beyond the layout's ceiling (4 cards by default), the surplus is removed and
reported by `METRICS_DROPPED`.

### Progress bars

`:::progress` reads like a metric card: the share first, then the label, then
an optional caption. The word after the directive is the **tint** — the same
four words a callout takes, never a colour; with no word at all the bar is
drawn in `info`.

```markdown
:::progress success
100 %
Online leisure services
15 April 2026 — delivered
:::
```

A bar can also carry the **target it is judged against** — `62 % / 80 %`, the
share first, the commitment second. The marker is a rule standing on the track,
in the deck's own ink: it changes no height, which is why it is a property of
the bar and not a component of its own. A target of exactly 0 or 100 % lands on
an end cap and is left undrawn.

The two forms cannot be confused, and the rule is worth stating because a
fraction is also a slash: the WHOLE line is read as a single share first, and a
split additionally requires a per cent sign. So `3/4` stays three quarters,
`1/0` stays the diagnostic it has always been, and the comma is never a
separator here — in the default locale it is the decimal point.

The share accepts `75 %`, `75%`, `0.75` and `3/4`. A figure outside 0–100 % is
**clamped** (a typo in the figure, not in the syntax); a first line that is not
a share at all degrades the card to the paragraph you wrote and reports
`INVALID_PROGRESS`, the way an unparsable `chart` falls back to a code block.
An unknown tint is reported by `UNKNOWN_PROGRESS_KIND` with a "did you mean"
suggestion, and the bar falls back to `info` rather than being refused.

The percentage rides **inside** the fill when the fill is wide enough to hold
it and beside it otherwise; the threshold is the engine's, identical in both
outputs.

### Status badges

`:::status` is a **row** of badges, one per comma. The severity travels on the
item itself: nothing = success, `!` = caution, `!!` = critical, `?` = for
information. Writing one severity per line is a reading convenience, not
syntax.

```markdown
:::status
Scope, Schedule, Quality, HR
!Budget, !Stakeholders
!!Risks
:::
```

The row wraps on its own, over as many lines as it needs, and reports the
height it really occupies — so pagination and `BLOCK_OVERFLOW` see the truth.

A badge also exists **inline**, inside a sentence, with the same prefixes:

```markdown
Each commitment carries an ==Owner==; one that slips is tagged ==!At risk==.
```

The two marks must close on the same line. A `==` inside a code span, an
unclosed one and a longer run (`====`) stay the characters you typed — a badge
is a word set off from the prose, not a way of colouring a paragraph.

The HTML draws it as a rounded pill. The `.pptx` **cannot**: DrawingML gives a
text run no rounded background, so the run is emitted with a `highlight` — the
tint and the readable ink survive, the pill shape does not. That degradation is
deliberate and stated here rather than left to be discovered when the file is
opened.

One more difference between the two, for the block forms: a label too long for
the room it was measured in is **clipped** in the browser and **overruns** in
PowerPoint, which has no equivalent of `overflow: hidden`. Neither is pretty;
both are visible, which is the point — shorten the label.

Assembling these two directives into a whole status board — the layout that
holds them, what the engine fits by itself, and what is still out of reach —
is the subject of [the dashboard guide](dashboard-guide.md).

---

## Images, icons, diagrams

```markdown
![alt](image.png)              placed by the engine (split layout if there is text)
![left](image.png)             forces the visual to the left
![right](image.png)            forces the visual to the right
![cover](image.png)            full-page image (hero layout)
![background](image.png)       the same — the image becomes the slide background
```

Paths are relative to the `.md` file. A missing image produces
`MISSING_IMAGE` and a clean placeholder — never a broken slide. A local image
stretched well beyond its native size produces `IMAGE_UPSCALED`.

**Remote images** — `![alt](https://…)` is downloaded at compile time then
**embedded in the deliverable**: the presentation, once open, has no network
dependency. The copy goes into the user cache `~/.cache/lutrin/remote/`,
shared across projects; compiling writes nothing into the deck's directory.
`assets: vendor` in the frontmatter (or `--vendor-assets` on the CLI) keeps it
in `assets/remote/` next to the `.md` — useful only if the directory must be
self-contained.

**Kit images** — `![right](kit:hero-photo)` places an image the active kit
declares. A kit names its images in its `theme.json`:

```json
"images": { "hero-photo": "./images/hero.jpg", "team": "./images/team.png" }
```

Aliases are lowercase (`[a-z][a-z0-9-]{1,31}`; `constructor` and `prototype`
are reserved); paths are relative to the kit's `theme.json` and confined to
the kit, exactly like its logos. Once the
alias is resolved, the image behaves **exactly like a local one**: same roles
(`left`, `right`, `cover`, `background`), same placement by the engine,
embedded in the `.pptx` and inlined in the HTML. An alias the kit does not
declare produces `KIT_IMAGE_UNKNOWN` — with the nearest declared alias
suggested — and the usual placeholder; so does `kit:…` in a deck compiled
without a kit, since the default theme declares no images. The kit editor
(`lutrin kit edit`, [docs/kit-editor.md](kit-editor.md)) manages these
aliases visually — upload, rename, per-alias preview.

**Lucide icons** — `![](lucide:name)` places an icon from
[lucide.dev](https://lucide.dev) (`bike`, `house`, `leaf`, `chart-bar`…). An
unknown name produces `UNKNOWN_ICON`.

The alt slot of an icon carries **intent words**, in any order: an ink and a
size. The ink is the theme's `primary` by default; `neutral`, `secondary` and
`white` are the others allowed (`white` for dark panels only). The size is
`line`, `small`, `medium` (the default) or `large` — words, never points, and
the slot always keeps the last say: a column narrower than the icon wins.

```markdown
![](lucide:leaf)                icon in the primary ink, at the slot's size
![large](lucide:leaf)           the same, one step up
![neutral small](lucide:leaf)   both words, either order
![line](lucide:leaf)            as tall as one line of body text
```

`small`, `medium` and `large` are factors on the size the engine derives from
the slot. `line` is the smallest and follows a different rule: it is the height
of **one line of body text** — the theme's, and the step a crowded region was
re-flowed at, so the icon matches the line it stands beside even where the
engine had to densify. Use it for an icon *beside* text, at the head of a line
or in a cramped panel.

It is not an *inline* icon: **a run of text renders text only**, in a table
cell, in a bullet and in a heading alike. An icon written inside one of them is
dropped and reported — `TABLE_CONTENT_DROPPED`, `LIST_CONTENT_DROPPED`,
`HEADING_CONTENT_DROPPED`. Write it on its own line instead: above the list,
under the heading. For a status column in a table, use an inline badge
(`==Delivered==`, `==!At risk==`); for a whole matrix of marks, `type: heat` or
`type: rating`.

The slot is intent **or** description, never half of each: the words apply only
when the alt is nothing but vocabulary. `![A white arrow](lucide:arrow-right)`
is a sentence, so it is read as no intent at all (the icon draws in `primary`)
— an ink picked out of a description drew white on white. A lone word is always
an intent, since an icon's alt is rendered nowhere: `![big](lucide:leaf)` is
reported by `UNKNOWN_ICON_WORD`, with the nearest word suggested, and the icon
still draws. Two inks or two sizes: the first wins, `ICON_WORD_CONFLICT` names
the other. Casing does not matter (`![Large]` = `![large]`).

**Mermaid** — a ```` ```mermaid ```` block is rendered as an image, using a
browser already installed on the machine (Chrome, Edge, Brave or Chromium; set
`LUTRIN_BROWSER` to pick one). With no browser to be found, the block degrades
to a readable fallback — the source, with a note; `lutrin setup-mermaid`
reports what is missing and can download one.

**Figures in the `.pptx` carry their vector as well.** A chart, a Mermaid
diagram, a Lucide icon and a LaTeX equation are all born as SVG, and the
`.pptx` now ships that SVG alongside the raster it used to ship alone. The
picture's fill stays the PNG; the vector rides in an extension that PowerPoint
2019 and later prefer, so the figure stays sharp at any zoom there, while
Keynote, LibreOffice and older Office ignore an extension they do not know and
draw exactly the image they always drew. Nothing to write, and nothing lost
either way. Text, tables and shapes were never images and still are not.

---

## Diagrams (`cycle`, `hierarchy`, `venn`, `radial`)

Four shapes an outline cannot make. They are layouts, not blocks: the slide IS
the diagram, and its `##` sections (or its bullet list) are its nodes.

```markdown
# How a release moves

<!-- layout: cycle -->

## Plan

Scope agreed with the sponsors.

## Build

## Review

## Ship
```

A heading is the node's label; a section's first paragraph becomes its second
line (`cycle` only). A tree is written the way a tree already reads:

```markdown
# Who reports to whom

<!-- layout: hierarchy -->

- Delivery
  - Engineering
    - Platform
    - Product
  - Design
```

`hierarchy` also accepts `##` sections — each heading a branch, its bullets the
leaves. `radial` reads the paragraph before the first `##` as the **hub**, and
falls back to the slide title when there is none:

```markdown
# The compiler and what leans on it

<!-- layout: radial -->

Compiler core

## CLI

## VS Code

## Web playground
```

Labels are drawn as **plain text**: bold, italic, code, links and badges inside
a node are dropped, and `SMARTART_TEXT` says so. A `hierarchy` that yields
fewer than two nodes produces `SMARTART_NODES`.

### Real SmartArt in the `.pptx`

By default a diagram is drawn as **native PowerPoint shapes** — real discs,
boxes and arrows a presenter can select and nudge — and as an inline SVG in the
HTML, from the same coordinates. Both outputs are pixel-identical.

`--smartart` asks for the other thing: a genuine SmartArt object.

```sh
lutrin build deck.md --smartart -o deck.pptx
```

or, for the hosts that pass no options (the VS Code extension among them):

```yaml
---
title: Operating model
smartart: true
---
```

The flag is a `.pptx` concern and is **ignored on the HTML path**: `--html
--smartart` produces exactly the bytes `--html` produces.

What you gain: PowerPoint opens its own *SmartArt Design* ribbon on the object
— Text Pane, Change Layout, Change Colors — and re-lays the diagram out with
its own engine.

What it costs, stated plainly because it reverses a rule this compiler
otherwise keeps:

- **Keynote and macOS Quick Look show nothing.** Apple's importer dispatches on
  the layout identifier and does not know lutrin's. Everywhere else — charts,
  Mermaid, equations, icons — this engine ships an image precisely so that it
  displays everywhere; a SmartArt object cannot. That is why the flag is
  opt-in and why the default stays native shapes.
- **The two outputs stop being pixel-identical inside the frame.** PowerPoint
  re-runs its own layout, so what is guaranteed there is the frame rectangle,
  the node count, the reading order and the palette — not the coordinates.
  Every other reader (LibreOffice, Google Slides, Apache POI) draws the cached
  geometry, which IS the coordinates.
- **A converted diagram is not animated** in the `.pptx`. The HTML twin still
  reveals it on click.
- **Change Colors replaces the brand palette** with an Office one, and the only
  way back is to rebuild. The colours shipped are the kit's, written out
  literally rather than referenced from the theme — which is what keeps a
  branded deck branded in every renderer.

---

## Charts

A ```` ```chart ```` block carries a line-by-line specification:

````markdown
```chart
type: bar
categories: Q1, Q2, Q3, Q4
Planned: 120, 150, 180, 210
Actual: 110, 155, 175, 190
```
````

- `type`: `bar`, `barh` (horizontal bars), `stacked-bar`, `stacked-barh`,
  `share-bar`, `share-barh`, `line`, `area`, `pie`, `doughnut`, `radar`,
  `waterfall`, `gantt`, `rating`, `heat`.
- `categories` (or `catégories`): the x axis. Absent, they are numbered.
- Every other line `Name: v1, v2, …` is a **series**; decimals use a
  **point**. A line starting with `#` is a comment.
- `pie` and `doughnut` display a single series only, of positive shares; the
  rest is dropped with a `CHART_DATA_IGNORED` diagnostic.
- `target:` (or `cible:`) draws the line a series is judged against — a
  commitment, an SLA, a budget. **Only when the value is a single number**: a
  list stays an ordinary series, so a series legitimately named "Target" is
  never swallowed. The rule is dashed, in the deck's own ink, and it enters the
  scale so it never falls outside its own frame. It means nothing on `pie`,
  `doughnut` and `radar`.

**Stacked and share** — `stacked-bar` adds the series up per category;
`share-bar` normalises each category to 100 % and labels the segments past 7 %.
The scale reads the per-category *totals*, positives stack up from zero and
negatives down from it.

**`waterfall`** — the bridge from an opening figure to a closing one. The first
and last categories are the anchors; `totals: Budget, Subtotal, Actual` names
them instead when the bridge has an intermediate subtotal. This is the one
chart where **hue carries the sign** rather than the identity: rises in the
success tint, falls in the danger tint, anchors in the neutral ink. Every bar
carries its number — a bridge without them is a shape.

**`rating`** — the scorecard of part-filled discs: options down the side,
criteria across the top. `scale:` declares the denominator, and declaring it is
the point — a scale derived from the largest value seen would let one new score
rescale every other row in the deck.

````markdown
```chart
type: rating
categories: Fit to process, Cost of change, Risk
Rebuild in house: 4, 2, 4
Buy the module: 2, 5, 2
scale: 5
```
````

The fill is a fraction of the disc, so the granularity is the scale's: at
`scale: 4` the discs land exactly on the quarters drawn by hand for forty
years. A score past the scale reads as full rather than wrapping. The discs are
**drawn**, never typeset — ◐ (U+25D0) is absent from WGL4, so a kit shipping a
narrow face would put a tofu box on the slide.

**`heat`** — the same matrix as `rating`, tinted instead of filled: coverage,
maturity, risk. The ramp is the theme's five layer shades, each already paired
with an ink that clears 4.5:1, so a kit repaints the whole grid for free and the
figure survives greyscale. Every cell keeps its number — a tint says "more", not
"more than what".

`scale:` matters more here than anywhere. Without it the ramp normalises
against the **largest value present**, which means one outlier repaints the
grid and two months of the same report read differently; the figure admits it
by labelling the bound "(largest value)". Declare `scale:` and a heat map
becomes comparable from one deck to the next.

**`gantt`** — named lanes spanning periods, and the only chart here that draws
a *duration*:

````markdown
```chart
type: gantt
categories: Q1, Q2, Q3, Q4
now: Q2
Discovery: Q1 - Q2
Partner API: Q1, Q3 - Q4
```
````

A span is `from - to`, **both ends included**; the comma keeps the meaning it
has everywhere else — a list — so a lane can carry several bars. `now:` draws
the "we are here" rule at the start of that period. One period name that
resolves to nothing invalidates the spec (`INVALID_CHART`).

Colors come from the theme's palette, adjusted and validated (color blindness,
contrast ≥ 3:1). Six series at most stay readable; beyond that, group into
"Other". **Never pick the colors by hand** — there is in fact no syntax for
doing so.

The chart is rendered as an **image**: faithful everywhere (PowerPoint,
Keynote, QuickLook), but not editable in PowerPoint. The choice is
deliberate — native OOXML charts are invisible in Keynote and QuickLook.

A specification that could not be parsed falls back to a code block shown as
it is, with the `INVALID_CHART` diagnostic.

---

## Equations (LaTeX)

Three equivalent spellings: ```` ```math ````, ```` ```latex ````
(or ```` ```tex ````), or `$$…$$` alone in a paragraph.

````markdown
```math
S = \frac{\sum_{i=1}^{n} p_i \cdot c_i}{N} \times (1 + \tau)
```
````

Rendered by MathJax, centered, at its natural size. A readable fallback (the
source with a note) if `mathjax-full` is not installed or if the LaTeX is
invalid.

---

## Animations

`<!-- animate -->` in a slide makes its content appear step by step: one block
at a time, lists **point by point**, columns and `##` sections as a block.
`animate: true` in the frontmatter animates the whole deck;
`<!-- animate: none -->` excludes one slide from it. Covers and section slides
are never animated, and the title always stays visible.

Four effects can be imposed — `<!-- animate: fade -->`, `wipe`, `zoom`,
`appear`. With no named effect, each block receives the one that suits its
nature: fade for text, wipe for the panels of structured layouts, zoom for
milestones and metrics. An unknown value produces `UNKNOWN_ANIMATE`.

Depending on the output:

- **PowerPoint** — native on-click animations, imported by Keynote too.
  **Consecutive slides showing the same title** also receive the **Morph**
  transition (fade fallback before PowerPoint 2019): the pages of a paginated
  slide, and the slides you deliberately titled the same way — the title holds
  still while the content changes under it. Nothing to write, and giving two
  slides different titles is how you opt out. A title that comes back far
  apart is a coincidence, not a continuity, and gets nothing. QuickLook and PNG
  exports ignore animations: everything is visible there.
- **HTML** — clicking the slide reveals the next step (counter at the top
  right; a click after the last one resets), and the four effects apply here
  too. They are read from the **same table** the `.pptx` reads, so
  `<!-- animate: zoom -->` means one movement in both outputs, and a block with
  no imposed effect gets the same one on both sides — fade for a paragraph,
  zoom for a `:::metric`. A reader whose system asks for stillness
  (`prefers-reduced-motion`) gets the steps without the movement: what appears
  is unchanged, only the travel is dropped. Without JavaScript, in print and in
  PDF export, everything is visible and at rest.

---

## Presenter notes

```markdown
<!-- notes: recall the schedule, do not dwell on the table -->
```

Invisible on screen. In the `.pptx` these are the native notes; in the HTML, a
`<details class="notes">` under the slide, and the **presenter view** of
presentation mode (the `N` key) displays them with the timer and the next
slide.

The generated cover takes its note from the frontmatter instead — `notes:`,
see [Frontmatter](#frontmatter) — because no comment in the source can reach a
slide the engine synthesized.

---

## HTML output: presentation mode and PDF

`lutrin build deck.md -o deck.html` writes one standalone page: fonts, images
and diagrams inlined, nothing to serve. It scrolls like a document, and the `P`
key turns it into a projector.

| Key | Effect |
|---|---|
| `P` | enter / leave presentation mode — full screen, one slide fitted to the window |
| `→` `Space` `PgDn` | next animation step, then the next slide |
| `←` `PgUp` | previous step, then the previous slide |
| `Home` `End` | first / last slide |
| `N` | presenter view, in a second window |
| `O` | overview of the whole deck as a grid |
| `Esc` | step out **one level**: the help panel, then the grid, then the mode |
| `?` | the list above, on screen |

While you present, a thin **progress bar** runs along the bottom of the screen
and two **arrow buttons** sit above it — for a room where the laptop is out of
reach, or a deck driven from a touch screen. Both follow the pointer: shown
while it moves, gone a couple of seconds after it stops, so a slide left
standing is projected with nothing on it. The buttons grey out at the real ends
of the deck only: a step still to be revealed counts as a "next", so the last
slide of an animated deck is not finished yet.

`O` lays the whole deck out as a grid. These are not images but the slides
themselves, rescaled: **click one to jump there**. The selected slide is
outlined and kept scrolled into view, and `Enter`, `O` or `Esc` all leave the
grid on it.

The **presenter view** (`N`) opens a second window with the current slide, the
next one, the notes of the slide — the cover's frontmatter `notes:` included —
an elapsed timer (click it to start or pause, `reset` to zero it) and the
**wall clock**, to the minute. The two answer different questions: the timer
says how long you have been talking, the clock says whether you are late, and a
room is booked by the clock.

### PDF and images

```sh
lutrin build deck.md --pdf              # deck.pdf — one page per slide
lutrin build deck.md --png -o out.png   # out-01.png, out-02.png, …
lutrin build deck.md --jpeg -o out.jpg  # the same, in JPEG
```

The extension of `-o` is enough on its own: `-o handout.pdf` needs no flag.

The PDF is the standalone HTML, printed by a browser the compiler drives — so
it is the page you already previewed, at 1280 × 720, one slide per sheet, no
margin, every animation step open and the notes left out. It carries an
**outline**: the slide titles, in order, so a reader navigates by name rather
than by scrolling.

`--png` and `--jpeg` name a **stem**, not a file: one image per slide is written
beside it, numbered and zero-padded, at twice the slide size. They read the same
print stylesheet the PDF does, so an exported image and its PDF page are the
same picture.

**A browser is required for these three**, and it is the only place in the
compiler where one is. A chart without a rasterizer degrades to its source and
says so; there is no degraded PDF, so the build refuses before writing a byte
and tells you how to fix it. Chrome, Edge, Brave or Chromium already installed
will do; `lutrin setup-mermaid` downloads one; `LUTRIN_BROWSER=/path/to/chrome`
overrides everything.

Say what this is not: **the notes are not in the PDF**. Marp writes them as PDF
annotation objects; doing that means writing PDF objects, which means a PDF
library, and this compiler does not take a dependency for one flag. The notes
are in the `.pptx` and in the HTML presenter view (`N`).

---

## Diagnostics

`lutrin validate <deck.md>` returns diagnostics positioned at a line, in three
severities: `error` (the rendering will not be the expected one), `warning`
(probably not intended), `info` (automatic behaviour worth knowing about).
`--json` gives the same thing in a machine-readable form, with exit code 1 if
errors remain.

**`lutrin build` applies the same verdict**: as soon as one `error` diagnostic
remains, it displays them, exits with code 1 and **writes no file**. Passing
`--force` compiles anyway (errors on screen, exit code 0) — that is for a
draft you want to look at, not for getting rid of a message.

One nuance about kits: a `KIT_NOT_FOUND` is fatal only if the kit was asked
for **EXPLICITLY**, through `--kit` or through the frontmatter `kit:` key. A
kit coming from an implicit default (project, user, editor) and not found
stays a warning, and the deck compiles with the generic theme.

The main ones:

| Code | Severity | Meaning |
|---|---|---|
| `UNKNOWN_DIRECTIVE` | error | unknown `:::name` — in a Marp deck, only a casing slip is reported, and as a warning ([docs/marp.md](marp.md)) |
| `ORPHAN_DIRECTIVE` | warning | `<!-- layout/notes/animate -->` that no slide follows |
| `UNKNOWN_LAYOUT` | error | layout does not exist (with a suggestion) |
| `LAYOUT_SECTIONS` | warning | `##` section count outside the layout's bounds |
| `SMARTART_NODES` | warning | a `hierarchy` slide yields fewer than two nodes |
| `SMARTART_TEXT` | info | bold, italic, code, a link or a badge inside a diagram label — drawn as plain text |
| `BLOCK_OVERFLOW` | warning | a block overflows its region in a non-paginated layout, the text scale spent |
| `METRICS_DROPPED` | warning | more `:::metric` cards than the layout displays |
| `MISSING_IMAGE`, `UNKNOWN_ICON` | warning | resource not found |
| `IMAGE_PATH_ESCAPE` | error | image outside the deck's directory — the build writes no file |
| `UNKNOWN_ICON_WORD`, `ICON_WORD_CONFLICT` | warning | an icon's alt names neither an ink nor a size, or names two of one |
| `INVALID_CHART`, `CHART_DATA_IGNORED` | warning | `chart` specification could not be parsed, or data dropped |
| `INVALID_PROGRESS` | warning | `:::progress` value unreadable — the card falls back to a paragraph |
| `UNKNOWN_PROGRESS_KIND` | warning | unknown tint after `:::progress` |
| `ALERT_CONTENT_DROPPED` | warning | block not rendered inside a callout |
| `QUOTE_CONTENT_DROPPED` | warning | block not rendered inside a quotation |
| `TABLE_CONTENT_DROPPED`, `LIST_CONTENT_DROPPED`, `HEADING_CONTENT_DROPPED` | warning | an image or icon written into a cell, a bullet or a heading, which render text only |
| `UNKNOWN_ANIMATE` | warning | unknown animation effect |
| `COVER_NOTES_ORPHAN` | warning | frontmatter `notes:` with no cover to carry it — no `title:`, or a Marp deck |
| `KIT_*`, `THEME_*` | error/warning | kit not found or invalid theme entry |
| `THEME_CONTRAST` | warning | WCAG threshold not met by the applied theme |
| `LAYOUT_SUGGESTION` | info | the content betrays a structured intent |
| `SLIDE_PAGINATED` | info | the slide is split into "(cont.)" |
| `SLIDE_DENSIFIED` | info | a region was re-flowed a step down the text scale to fit |
| `IMAGE_UPSCALED` | info | local image stretched beyond its native size |

Complete list: `capabilities().diagnostics`.

---

## What the DSL deliberately does not allow

There is no syntax for setting coordinates, sizes, explicit columns or
colors. This is not a gap: it is the project's contract. What looks like a
need for positioning is almost always a layout to ask for
(`<!-- layout: … -->`), a custom layout to define (`layouts/*.json`) or a
theme token to change in a kit.
