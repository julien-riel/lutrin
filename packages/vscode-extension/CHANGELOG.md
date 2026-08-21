# Changelog — Lutrin for VS Code

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This file covers the VS Code extension; the compiler's own changes are in the
[repository changelog](https://github.com/julien-riel/lutrin/blob/main/CHANGELOG.md).
The extension's version tracks the `@lutrin/core` compiler it embeds.

## [1.4.0] — 2026-08-21

The extension itself did not move. The compiler it embeds learned the language
of a deck, and stopped losing the paragraph written above a slide's sections —
both show up in the preview, in the export and in the underlines, with no new
setting to find.

### Changed

- `lang: fr` in the frontmatter puts the words the ENGINE writes into French —
  the callout labels, the "(suite)" of a paginated slide, the title of a
  generated agenda — declares the language in the HTML preview, and stamps it
  on every text run of the `.pptx`, so an exported deck opens spell-checked in
  its own language.
- The opening paragraph of a slide becomes a band on every layout that deals
  `##` sections into slots. On a timeline it used to become an anonymous
  milestone, on a SWOT the "Strengths" quadrant, and on six others it vanished
  from the preview with nothing underlined to say so.
- One diagnostic fewer to chase: a slide whose opening paragraph is a band no
  longer gets a `LAYOUT_SECTIONS` warning counting it as a section.

## [1.3.0] — 2026-08-14

The extension itself barely moved again; the compiler it embeds learned to
read signals your Markdown already carried, and gained the pieces a corporate
deck kept assembling by hand. Everything below shows up in the preview and the
export with no new setting to find.

### Added

Everything below is compiler 1.3.0, described in full in the
[repository changelog](https://github.com/julien-riel/lutrin/blob/main/CHANGELOG.md).

- **Six new layouts inferred from what you already wrote.** Four `##` sections
  become a 2 × 2 grid, five or six a row of three; a task list becomes a
  checklist, a numbered list of three to six short items becomes steps, a
  nested list becomes a hierarchy, three dated sections become a timeline. No
  new syntax — the preview simply stops paginating a vertical flow where a
  shape was meant.
- **A rule set your deck can pin.** Because those rules change how a deck
  already written comes out, every compilation names the slides whose layout
  would have differed before (`LAYOUT_RULES_CHANGED`, in the problems panel),
  and `inference: "1.0"` in the frontmatter freezes the old behaviour. The
  CLI's `lutrin migrate deck.md` writes the pin for you.
- **A generated agenda and a chapter rail.** `agenda: true` synthesizes the
  agenda slide from the deck's own chapters, and every section divider shows
  where you are in them.
- **The provenance line** — `<!-- source: … -->` sets a small caption at the
  foot of the content area, in room the engine reserves before placing
  anything.
- **Task lists, a real matrix, a checklist, an isotype chart, an annotated
  visual**, `table` with `zebra`/`emphasis`/`density`, optional lead and
  takeaway bands, `:::key` as a fifth semantic tint, the delivery-review
  charts (`bullet`, `dumbbell`, milestones on a `gantt`), and twelve more
  official layouts — the catalog doubles, from twelve to twenty-four:
  `eisenhower`,
  `effort-impact`, `gartner-quadrant`, `product-tour`, `architecture`,
  `glossary`, `share-of`, `pricing`, `kanban`, `team`, `okr` and
  `risk-map-3`.
- **`- [ ]` boxes stay editable in PowerPoint** — the checkbox is a real
  bullet character, not typed-in prose.
- **Kits customize more than colour** — a display/title font distinct from the
  body, themable surfaces (cover, section band, content page) and an accent
  group, all of them honoured by the preview.
- **Five diagram layouts the catalog could not express** — `cycle`,
  `hierarchy`, `venn`, `radial` and `apex`, asked for by name, drawn as
  native editable PowerPoint shapes and as an inline SVG in the preview from
  the same coordinates. The CLI's `--smartart` swaps the `.pptx` object for a
  genuine SmartArt graphic PowerPoint opens its own ribbon on.

### Fixed

- **Equations arrive as native OMML**, clickable and editable in PowerPoint,
  with the rendered picture kept as the fallback when a formula is out of
  OMML's reach.
- **Figures carry their vector beside their raster**, so a chart or a diagram
  stays crisp when a reader zooms in — and Mermaid diagrams no longer draw as
  black boxes in LibreOffice.
- **The `:::key` callout had no fill in the preview** — it rendered as bare
  text on the page background while the `.pptx` painted the panel. Both
  outputs now read the same tokens.

## [1.2.0] — 2026-07-29

The extension itself barely moved; the compiler it embeds gained most of a
corporate deck's visual vocabulary, and every bit of it shows up in the
preview and the export with no new setting to find.

### Added

Everything below is compiler 1.2.0, described in full in the
[repository changelog](https://github.com/julien-riel/lutrin/blob/main/CHANGELOG.md).

- **Six things a deck used to draw by hand.** Progress tracks
  (`:::progress`, with a target), status badges (`:::status`, and `==Owner==`
  inline), a heat matrix and a rating scorecard (`type: heat`,
  `type: rating`), stacked, share, waterfall and Gantt charts, and a
  `target:` line a series is judged against. Two more official layouts:
  `status-list` and `raid`.
- **Text that no longer overflows in silence.** Where a layout places content
  without pagination — a panel, a column, a cell — text that does not fit is
  re-flowed one step down a type scale, and the diagnostics panel reports
  every region the engine shrank (`SLIDE_DENSIFIED`).
- **Icons with a size** (`![large](lucide:leaf)`, `![line]` for the height of
  one line of body text), **table alignment** honoured from the delimiter row,
  and **kit images by alias** (`![](kit:hero-photo)`).
- **A run of text that eats an image now says so** — in a table cell, a bullet
  or a heading, each with its own quick-fixable diagnostic naming what does
  work there instead. These used to vanish at parse time, with nothing in the
  problems panel.

### Fixed

- **Mermaid diagrams render in the preview and the export.** The packaged
  extension never carried the Mermaid bundle its renderer injects into the
  browser it drives: every diagram fell back to its source as a code block,
  captioned "run `lutrin setup-mermaid`" — advice that could not help, since
  nothing was missing from the machine. The bundle now travels inside the VSIX.

## [1.1.1] — 2026-07-22

Windows decks now look like the preview. Every fix below was invisible on
the machine that builds the deck and greeted its recipients instead.

### Fixed

- **Charts, equations and icons render on every platform.** The packaged
  extension carried the native rasterizer (`@resvg/resvg-js`) of the machine
  that built it, and no other: on any other OS the export fell back to
  spec-as-text with `RASTER_UNAVAILABLE` warnings. The extension now ships
  the rasterizer prebuilds of all supported platforms (Windows x64/arm64,
  macOS, Linux glibc/musl/armhf).
- **Embedded brand fonts install on Windows** (compiler 1.1.1) — a kit font
  whose family name or bold/italic bits don't match what Windows font
  matching (GDI) needs used to hit every recipient with PowerPoint's
  "unable to install some embedded fonts / general failure" dialog. The
  compiler now checks each variant's Windows identity and refuses to embed
  an unmatchable one, naming the file and the table to rebuild.
- **A found icon is no longer reported as "not found"** when only its
  rasterization failed — the two failures now carry their own diagnostic.
- **Slide titles export left-aligned** (compiler 1.1.1), as the preview
  shows them — they inherited a centered style from the generated
  PowerPoint master.
- **Inline code and quote blocks are readable in the editor preview** —
  the webview's own stylesheet repainted undeclared surface properties
  (dark chips under a dark theme on a light slide); every surface property
  is now declared explicitly.

## [1.1.0] — 2026-07-20

First Marketplace release.

### Added

- **"Lutrin: New Presentation"** — opens a small deck that already
  compiles, preview beside the text, also reachable from File → New
  File… Editing a working example beats starting from a blank page.
- **Getting-started walkthrough** — create, preview, fix, export and
  brand a deck, from the Welcome page.
- **Explorer and editor-title menus** — preview and PowerPoint export on
  the right-click of any `*.deck.md`, export in the editor title `…`
  menu. Keybinding `Ctrl+K L` / `Cmd+K L` for the preview.
- **Marp compatibility** (compiler 1.1.0) — `marp: true` decks compile
  as they are; ignored directives are each reported, never lost.
- **Workspace-trust support** — in untrusted workspaces the preview,
  diagnostics and export keep working; `lutrin.defaultKit` and
  `lutrin.updateUrl` are read from user settings only.

### Fixed

- **Mermaid diagrams render on a fresh install** (compiler 1.1.0) —
  rendering now drives a browser already on the machine over a bundled
  Mermaid, instead of requiring a ~950 MB optional dependency almost
  nobody installed.

## [0.1.0]

Internal releases, distributed as a VSIX: live preview with cursor
tracking and incremental slide replacement, cold diagnostics on files
detected as decks, quick fixes from the compiler's suggestions,
PowerPoint export, optional embedded brand kit, self-update against an
internal `latest.json` manifest (sha256-verified).
