# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project applies [semantic versioning](https://semver.org/).

The packages in this repository carry their own version numbers: `@lutrin/core`
carries the compiler's version, `lutrin-vscode` and `lutrin-obsidian` that of
their editor host. Unless stated otherwise, an entry describes the compiler.

## [Unreleased]

### Added

- **A text scale — `density`.** A layout definition can now place its text one
  or two steps under the theme's own sizes: `comfortable` (the default),
  `compact` and `dense`, on `grid`, `comparison`, `pillars`, `steps`, `swot`,
  `layers` and `content`. They are factors applied to each block's own token
  (× 0.78 and × 0.64, rounded to the half point, never under 7 pt), so a kit
  shipping a 16 pt body keeps its proportions, and they are asked for by an
  intent word in a JSON layout — a point size still appears nowhere in a deck.
  Paragraphs, lists, tables and callouts follow the scale in both outputs
  **and** in the height estimate pagination trusts, which is what keeps a
  block that renders smaller from being placed as if it had not.
- **Solid semantic tints, and a radius a layout can choose.** Each of the four
  tints gained a saturated fill and the ink that goes with it, measured at
  4.5:1 tint by tint rather than assumed — white on the amber sits near 1.8:1
  and was never an option. A `panels` entry names the tone: `warning` is the
  pale callout surface, `warning-solid` the saturated chip (status pill, state
  bar, coloured band), and a solid panel imposes its ink on every block it
  holds, so nothing is half-repainted. `radius` — `sm`, `md`, `lg` or `pill` —
  overrides the radius a variant carries by default, `pill` being half the
  shorter side whatever the panel measures.
- **Progress bars — `:::progress`.** The share on the first line (`75 %`,
  `75%`, `0.75` or `3/4`, clamped to 0–100 %), then the label, then an
  optional caption; the word after the directive names the tint, the same
  four a callout takes. The percentage rides inside the fill when the fill can
  hold it and beside it otherwise — one threshold, computed in the engine, so
  the number is never in two different places in the two outputs. A value that
  cannot be read degrades the card to the paragraph the author wrote and says
  so (`INVALID_PROGRESS`); an unknown tint says so too
  (`UNKNOWN_PROGRESS_KIND`).
- **Status badges — `:::status`.** A row of badges, one per comma, each
  carrying its own severity: nothing = success, `!` = caution, `!!` =
  critical, `?` = information. The row wraps itself and reports the height it
  really occupies, so pagination and `BLOCK_OVERFLOW` see the truth. The same
  badge exists **inline** — `==Owner==`, `==!At risk==` — as a rounded pill in
  the HTML and, DrawingML having no rounded background for a text run, as a
  highlighted run in the `.pptx`: a degradation that is documented in
  `docs/dsl.md` rather than discovered when the file is opened.
- **`status-list`**, an eleventh official layout (grid, one column, dense
  text): a status board, one band per `##` section.
- **Alignment.** A table's delimiter row is honoured at last: `|---:|`
  right-aligns the column and `|:-:|` centres it, in both outputs. Saying "this
  column holds figures" is content, like `**bold**` — until now markdown-it
  resolved it and the engine dropped it without a word. A right-aligned column
  also gets tabular figures in the HTML, so the thousands line up under one
  another; the `.pptx` does not, DrawingML run properties carrying no OpenType
  feature switch. Layouts gained an `align` parameter (`content`, `grid`,
  `metrics`, and `focus`, whose key message can now sit right as well as
  centred). A deck still cannot align a paragraph of its own: where the ink
  sits in a region is the engine's decision, not the author's.
- **Auto-fit — a bounded region no longer overflows in silence.** Where a
  layout places content without pagination (a panel, a column, a cell), text
  that does not fit is re-flowed one step down the text scale, and a second
  step if it still does not. The whole region steps down together — three type
  sizes in one panel would read as a bug rather than as a fit — the steps are
  the three the scale declares and nothing in between, and `dense` is the
  floor: below it the engine stops and `BLOCK_OVERFLOW` fires, now with the
  clause "already at the densest step" so its advice no longer suggests what
  the compiler has already done. Every region the engine shrank is reported by
  `SLIDE_DENSIFIED` (info): an automatic size is a decision, and the author has
  to be able to refuse it. **Pagination wins**: a flowing `content` slide is
  split into "(cont.)" slides and is never densified — a flow layout has
  somewhere to put the overflow, and shrinking it instead would trade a
  legible second slide for a cramped single one.

## [1.1.1] — 2026-07-22

A deck that leaves the machine now survives the trip: every fix below was
invisible where the deck was built and broke where it was opened.

### Fixed

- **Slide titles export left-aligned**, as the HTML output has always shown
  them. Title placeholders carried no explicit alignment and inherited the
  centered `titleStyle` PptxGenJS hard-codes into the generated slide
  master — every title of every deck rendered centered in PowerPoint,
  Keynote and Quick Look.
- **Embedded brand fonts now install on Windows.** Windows font matching
  (GDI) pairs an embedded font by its OWN family name (`name` table,
  nameID 1) and bold/italic bits, never by the declared typeface — webfont
  cuts, where each weight ships as its own single-style family, hit every
  recipient with PowerPoint's "unable to install some embedded fonts /
  general failure" dialog. `embedFonts()` now reads each variant's Windows
  identity (`readFontIdentity`) and refuses to embed an unmatchable one,
  naming the file, what Windows would see, and the table to rebuild.
- **A found icon is no longer reported as "not found"** when only its
  rasterization failed. The `lucide:` diagnostic conflated "SVG missing"
  with "rasterizer missing", sending authors hunting for a network problem
  when their install simply shipped another platform's resvg binary — that
  case is `RASTER_UNAVAILABLE`'s, which names the remedy.
- **`lutrin-vscode` 1.1.1 / `lutrin-obsidian` — the packaged hosts
  rasterize on every platform.** The `npm install` into the shipped
  `dist/core` kept only the `@resvg/resvg-js` prebuild of the machine that
  built the package: a VSIX built on macOS reached Windows users with
  every chart, equation and icon replaced by its specification in text.
  Both packaging scripts now pull the prebuilds of all supported platforms
  (Windows x64/arm64, macOS x64/arm64, Linux glibc/musl/armhf), pinned to
  the resolved version, and fail the build if one is missing.
- Inline code and quote blocks are readable again in the editor previews.
  The fragment CSS declared only the properties the theme cares about; the
  VS Code webview's own stylesheet then repainted what was left undeclared —
  `code` got a padded chip in `--vscode-textPreformat-background`, dark
  under a dark editor theme, illegible on a light slide (blockquotes, same
  hazard). Every surface property is now declared explicitly, even at its
  neutral value, so no host default can bleed into the slides.

### Added

- **`lutrin-vscode` 1.1.0 — first Marketplace release.** Marketplace
  metadata (icon, banner, categories, badges, workspace-trust and remote
  support), a "Lutrin: New Presentation" command opening a starter deck
  that already compiles, a getting-started walkthrough, Explorer /
  editor-title menus and a `Ctrl+K L` keybinding for the preview, and a
  `Release — VS Code extension` workflow publishing on `vscode-v*` tags
  (Marketplace, optionally Open VSX, VSIX attached to a GitHub release).
  Setup and procedure: [publication.md](publication.md). Details:
  [the extension changelog](packages/vscode-extension/CHANGELOG.md).

## [1.1.0] — 2026-07-20

### Fixed

- Mermaid diagrams now render on a fresh install. They used to need
  `@mermaid-js/mermaid-cli`, an optional peer dependency almost nobody
  installed because it pulls ~950 MB (405 MB of `node_modules` and a ~540 MB
  Chrome download): every diagram silently degraded to its source as a code
  block, which looks exactly like a compiler that does not do diagrams.
  Rendering now drives a browser **already installed** on the machine — Chrome,
  Edge, Brave or Chromium — over a Mermaid bundle shipped inside the package.
  Cost: `puppeteer-core` (28 MB, and unlike `puppeteer` it downloads nothing)
  plus 3.5 MB of vendored Mermaid, against 950 MB.

### Added

- **Marp compatibility** — a deck written for [Marp](https://marp.app)
  compiles as it is: `marp: true` in the frontmatter (the pragma every Marp
  deck already carries) switches the parser to the Marp dialect, in every
  entry point at once — CLI, worker, VS Code, Obsidian. Slides split on `---`
  only (`headingDivider` honoured, global and retroactive like in Marp), the
  first `#`/`##` of a slide is its title, and the first subheading level
  used below it opens sections (`###` or `####` under a `##` title — the
  common Marp conventions, including the `<div class="columns">` idiom whose
  divs are ignored while the headings they wrap become real columns),
  HTML comments become presenter notes, `![bg]` images become slide
  backgrounds (`bg left`/`bg right` = split sides), fragmented lists (`*`,
  `1)`) animate their slide, `footer:` maps onto the deck footer. Directives
  with no lutrin equivalent (`style:`, `theme:`, `backgroundColor:`…) are
  each reported by the new `MARP_DIRECTIVE_IGNORED` diagnostic (info) —
  never lost in silence — and the lutrin extensions (`<!-- layout: … -->`,
  `:::metric`, `kit:`, charts, Mermaid) keep working inside a Marp deck.
  Documented in docs/marp.md, with examples/marp-demo.md as a live example.
- `lutrin setup-mermaid`: reports which browser will render diagrams, renders a
  test diagram to prove it works rather than promising, and — only with
  `--yes` — downloads `chrome-headless-shell` (~200 MB) into
  `~/.cache/lutrin/browser/` for a machine that has no browser at all. A build
  never downloads anything by itself.
- `LUTRIN_BROWSER` selects the browser to drive;
  `PUPPETEER_EXECUTABLE_PATH` is honored too, for images that already set it.

### Changed

- `@mermaid-js/mermaid-cli` stays supported and is preferred when installed,
  but it is now a compatibility path rather than the engine. The fallback
  caption and the CLI now point at `lutrin setup-mermaid` instead of asking for
  a ~1 GB install.

## [1.0.0] — 2026-07-18

First public release. The project previously existed under the name
`mtl-deck`, with one organization's brand built into the engine; this version
extracted it and made the engine generic.

### Added

- Published on npm as two packages: `lutrin` is the command (`npx lutrin`),
  `@lutrin/core` is the compiler behind it, usable as a library.
- Markdown (DSL) compiler → PowerPoint `.pptx` and standalone HTML, both
  outputs built from the **same** geometric scene.
- Layout inference from the content, placement into regions and
  overflow-avoiding pagination; eight structured layouts requested with
  `<!-- layout: … -->` and a catalog of ten official layouts.
- Custom layouts: a `layouts/*.json` directory next to the deck defines
  parameterized variants of the built-in layouts, without recompiling.
- "Deck doctor": line-anchored diagnostics — overflows measured in pixels, a
  structured layout suggested from the content, under-resolution images, the
  theme's WCAG contrast checked. `lutrin validate --json` for agents.
- `chart` blocks (seven chart types), Mermaid, LaTeX, Lucide icons,
  `:::info|success|warning|danger` callouts, `:::metric` cards with a trend.
- Native entrance animations in the `.pptx` (the effect chosen by block type),
  Morph transition on paginated slides, click-to-reveal in the HTML.
- Standalone presenter mode in the generated HTML: full screen, notes, a timer
  in a second window — no server, no network request.
- **Kits**: a theme, its layouts, its fonts and its logos as one distributable
  unit (a directory or a `.deckkit` archive). `lutrin kit
  create|install|list|remove`, installation from a file or an `https` URL,
  data only — never any code executed.
- Containment of what a kit brings in: nothing runs, and **nothing goes out to
  the network**. The SVG sanitizer admits a remote URL for navigation only
  (the `href` of an `<a>`), never for an attribute that would trigger a load —
  so a kit cannot plant a tracking pixel in a presentation you send on. A
  kit's paths are confined to its own directory, and its archive resists
  *zip slip*.
- Tables, code blocks and quotations **nested inside a list item**: kept and
  rendered in place, in source order.
- `build --force`: accepts a truncated output. Without it, an export deprived
  of a rasterizer — charts, Mermaid and LaTeX replaced by their specification
  as text — exits with an error rather than under a `✓`, as does a deck with
  no slide at all.
- Shared user configuration (`~/.config/lutrin/`): a kit chosen once applies
  to every project and to the editor extensions (`lutrin config`).
- `lutrin vendor`: freezes remote images, rendered diagrams and the resolved
  kit into the deck's directory, which then compiles offline.
- `lutrin preview`: a local server with automatic recompilation and reload.
- VS Code extension: live preview, underlined diagnostics, one-click fixes,
  `.pptx` export.
- Obsidian plugin: live preview, clickable diagnostics, exports, wiki embeds
  `![[image.png]]` translated.
- Agent skill (`.claude/skills/deck/`) and the `lutrin capabilities` command:
  the engine's capabilities can be queried as JSON rather than guessed at.
  Passing the deck — `lutrin capabilities my-deck.md` — additionally publishes
  the kit's layouts and the neighbouring `layouts/*.json`; that is the form to
  use in a project that has a brand.
- Slide titles in the OOXML sense in the `.pptx`: PowerPoint's Outline mode is
  usable, and screen readers get back their mechanism for announcing a slide.
- Public documentation: the DSL reference (`docs/dsl.md`), the security policy
  (`SECURITY.md`), a contribution guide.
- Continuous integration on three operating systems and two versions of Node:
  lint, typecheck, tests of all three packages, and a build of the artifacts
  that are actually distributed (VSIX, Obsidian plugin directory), published
  on every run. The sixteen block types are now rendered in **both** formats
  by the suite, and no longer merely measured.

### Changed

- The project, its commands and its settings are renamed `mtl-deck` →
  `lutrin` (CLI `lutrin`, configuration `~/.config/lutrin/`, settings
  `lutrin.*`). The old names are still read as a fallback: `MTL_DECK_CONFIG`,
  the `"mtl-deck"` field of a `package.json`, the VS Code setting
  `mtlDeck.defaultTheme`, and the old configuration `~/.config/mtl-deck/` is
  migrated on first launch.
- The word "theme" becomes "kit" wherever it designates a complete brand: the
  `--kit` flag, the `kit:` frontmatter, the `lutrin.defaultKit` setting.
  `--theme` and `theme:` remain accepted as deprecated aliases — in the
  frontmatter they produce the `KIT_DEPRECATED_KEY` diagnostic.

### Removed

- **Distribution of a theme as an npm package.** Resolution through
  `node_modules` (`"lutrin": { "theme": "@org/package" }`, the `THEME_PKG_*`
  diagnostics) is gone: it imposed one `npm install` per project and a second
  resolution path. Kits replace it — an installed kit is referenced by its
  name from any project.
- Every organization brand shipped with the engine. Brand guidelines commit an
  organization's mark: they live in their own repository, as a kit.

[Unreleased]: https://github.com/julien-riel/lutrin/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/julien-riel/lutrin/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/julien-riel/lutrin/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/julien-riel/lutrin/releases/tag/v1.0.0
