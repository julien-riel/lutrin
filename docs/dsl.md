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
[callouts and metrics](#callouts-and-metrics) ·
[images and icons](#images-icons-diagrams) ·
[charts](#charts) ·
[equations](#equations-latex) ·
[animations](#animations) ·
[notes](#presenter-notes) ·
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
| `kit` | name of an installed kit, path to a kit directory, path to a `.json` file, or `none` to force the generic theme |
| `animate` | `true` animates every slide (see [Animations](#animations)); an effect value (`fade`, `wipe`, `zoom`, `appear`) imposes it on the whole deck |
| `assets` | `vendor` copies remote images into `assets/remote/` next to the `.md` |

Surrounding quotes are stripped (`title: "My title"` = `title: My title`).
Other keys are ignored by the compiler — `deck: true`, for example, only
helps the VS Code extension recognize a deck.

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

Eight layouts express an **intent** that content alone does not reveal. They
are **never inferred**: they must be asked for with `<!-- layout: … -->`. In
all of them, each `## H2` section becomes a panel, a milestone, a layer, a
quadrant or a step.

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

Their content is **not paginated**: keep it short. A section count outside the
bounds produces `LAYOUT_SECTIONS` (the surplus will be ignored, a shortfall
will leave gaps).

---

## Official layouts

Ten layouts shipped with the compiler
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
| `metrics` | `max` (1–6, default 4), `cardHeight` (120–320 px, default 176) |
| `comparison` | `panels` (list of variants), `pad` (0–48 px) |
| `pillars` | `panels`, `accent` (boolean) |
| `timeline` | `dot` (20–48 px), `arrow`, `numbered`, `orientation` (`horizontal`/`vertical`) |
| `layers` | `ratios`, `shades`, `shape` (`stack`/`funnel`/`pyramid`) |
| `swot` | `kinds` (tint per quadrant) |
| `grid` | `cols` (1–4), `panels`, `kinds`, `headed` |
| `steps` | `connector` (`arrow`/`line`/`none`), `panels` |
| `focus` | `align` (`center`/`left`), `accent`, `scale` (0.5–2.5) |

Like the structured layouts, they are **never inferred**: always asked for
with `<!-- layout: … -->`. An invalid definition produces
`LAYOUT_DEF_INVALID`; an unknown parameter produces `LAYOUT_DEF_ADJUSTED` and
the deck compiles without it.

A complete example, ready to copy: `examples/kit-slate/layouts/`.

---

## Text, lists, tables, quotes

Ordinary Markdown works: paragraphs, **bold**, *italic*, `inline code`,
links, bullet and numbered lists (nesting on three levels), tables.

Lists and tables that run too long are **paginated** automatically into
"(cont.)" slides — do not shorten the content to "make it fit" (the
`SLIDE_PAGINATED` diagnostic, purely informational).

A quote, with optional attribution: the last paragraph of a quote block that
starts with a dash becomes the source.

```markdown
> The compiler chooses the layout, the author describes the content.
>
> — The project's contract
```

---

## Callouts and metrics

Five directives, written as `:::` blocks:

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

**Lucide icons** — `![](lucide:name)` places an icon from
[lucide.dev](https://lucide.dev) (`bike`, `house`, `leaf`, `chart-bar`…). Its
color is the theme's `primary` ink; `![neutral](lucide:name)`,
`![secondary](…)` and `![white](…)` are the other inks allowed. An unknown
name produces `UNKNOWN_ICON`.

**Mermaid** — a ```` ```mermaid ```` block is rendered as an image, using a
browser already installed on the machine (Chrome, Edge, Brave or Chromium; set
`LUTRIN_BROWSER` to pick one). With no browser to be found, the block degrades
to a readable fallback — the source, with a note; `lutrin setup-mermaid`
reports what is missing and can download one.

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

- `type`: `bar`, `barh` (horizontal bars), `line`, `area`, `pie`,
  `doughnut`, `radar`.
- `categories` (or `catégories`): the x axis. Absent, they are numbered.
- Every other line `Name: v1, v2, …` is a **series**; decimals use a
  **point**. A line starting with `#` is a comment.
- `pie` and `doughnut` display a single series only, of positive shares; the
  rest is dropped with a `CHART_DATA_IGNORED` diagnostic.

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

- **PowerPoint** — native on-click animations, imported by Keynote too. The
  "(cont.)" slides produced by pagination also receive the **Morph**
  transition (fade fallback before PowerPoint 2019). QuickLook and PNG
  exports ignore animations: everything is visible there.
- **HTML** — clicking the slide reveals the next step (counter at the top
  right; a click after the last one resets). Without JavaScript, in print and
  in PDF export, everything is visible.

---

## Presenter notes

```markdown
<!-- notes: recall the schedule, do not dwell on the table -->
```

Invisible on screen. In the `.pptx` these are the native notes; in the HTML, a
`<details class="notes">` under the slide, and the **presenter view** of
presentation mode (the `N` key) displays them with the timer and the next
slide.

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
| `UNKNOWN_DIRECTIVE` | error | unknown `:::name` |
| `ORPHAN_DIRECTIVE` | warning | `<!-- layout/notes/animate -->` that no slide follows |
| `UNKNOWN_LAYOUT` | error | layout does not exist (with a suggestion) |
| `LAYOUT_SECTIONS` | warning | `##` section count outside the layout's bounds |
| `BLOCK_OVERFLOW` | warning | a block overflows its region in a non-paginated layout |
| `METRICS_DROPPED` | warning | more `:::metric` cards than the layout displays |
| `MISSING_IMAGE`, `UNKNOWN_ICON` | warning | resource not found |
| `INVALID_CHART`, `CHART_DATA_IGNORED` | warning | `chart` specification could not be parsed, or data dropped |
| `ALERT_CONTENT_DROPPED` | warning | block not rendered inside a callout |
| `UNKNOWN_ANIMATE` | warning | unknown animation effect |
| `KIT_*`, `THEME_*` | error/warning | kit not found or invalid theme entry |
| `THEME_CONTRAST` | warning | WCAG threshold not met by the applied theme |
| `LAYOUT_SUGGESTION` | info | the content betrays a structured intent |
| `SLIDE_PAGINATED` | info | the slide is split into "(cont.)" |
| `IMAGE_UPSCALED` | info | local image stretched beyond its native size |

Complete list: `capabilities().diagnostics`.

---

## What the DSL deliberately does not allow

There is no syntax for setting coordinates, sizes, explicit columns or
colors. This is not a gap: it is the project's contract. What looks like a
need for positioning is almost always a layout to ask for
(`<!-- layout: … -->`), a custom layout to define (`layouts/*.json`) or a
theme token to change in a kit.
