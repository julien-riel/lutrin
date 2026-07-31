# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project applies [semantic versioning](https://semver.org/).

The packages in this repository carry their own version numbers: `@lutrin/core`
carries the compiler's version, `lutrin-vscode` and `lutrin-obsidian` that of
their editor host. Unless stated otherwise, an entry describes the compiler.

## [Unreleased]

### Added

- **The playground — the real compiler, in the visitor's browser.**
  `site/playground.html` imports `packages/core/src` **unchanged**: a textarea
  on the left, the compiled slides on the right, recompiled as you type, with
  nothing installed and nothing uploaded. Verified rather than asserted — on
  four decks the browser's scenes, stylesheet and emitted HTML come out
  **byte-identical to Node's**.

  And `site/` still has no build step. What replaces one: an import map
  resolving the eight `node:*` specifiers the compiler statically imports plus
  markdown-it and its five dependencies; ~250 lines of shims under
  `site/assets/js/shims/` (`path`, `os`, `url` and a pure-JS `crypto` that
  compute for real, a read-only `fs` filled before the compiler is imported,
  and throwing stubs for the three a browser cannot have); a classic script
  stubbing `window.process` before the module, because `deck/assets.mjs` reads
  `process.env` on the first statement it evaluates; and three copies in
  `pages.yml`.

  Two design rules the page holds itself to. It **refuses rather than
  misleads**: `deck/layout.mjs` loads the official layout catalogue inside a
  bare `catch {}` that reports nothing, so an empty catalogue would render a
  dozen layouts with wrong geometry and still say `warnings: []` — the page
  counts what registered and stops if it disagrees. And it **names what a
  browser cannot draw**: Mermaid, LaTeX, icons and images all vanish silently
  here, so it inspects the scene graph itself and says which are missing,
  pointing at the CLI. `packages/core/test/playground.test.mjs` walks the real
  import graph and fails the build if a new `node:` import is not mapped.

- **Four comparison pages** — `lutrin-vs-marp`, `-slidev`, `-revealjs`,
  `-pandoc` — plus `robots.txt` and `sitemap.xml`. Every claim about the other
  project was checked against its own current documentation on 2026-07-30, with
  the version and the date printed on the page. Each one **concedes first**, at
  length, before a word about Lutrin: that is the mechanism, not a courtesy.

- **A FAQ of eight questions and a contact address** on the landing page. Each
  answer is traceable to a line of the compiler, or names Polar where the code
  cannot answer. Proof beside it is live shields.io counters — never a stored
  number, and no testimonial has been invented.

- **A real domain, `lutrin.app`**, with `site/CNAME` and every absolute URL in
  the repository updated. DNS and the Pages setting are still a human's to do.


- **The "Made with Lutrin" attribution, and a per-seat licence that removes
  it.** Lutrin stays free to use, and the difference between the free and the
  paid tier is one line of text: a discreet mention at the bottom right of every
  slide — content, cover, section and hero, in the `.pptx` as in the HTML and in
  the editor previews. It sits in its own zone rather than as a suffix on the
  author's footer, which keeps its full width, and it cannot collide with the
  page number. No watermark, no slide cap, no feature held back.

  **`build` now says so.** A successful build with no licence ends on two extra
  lines naming the attribution and the command that removes it. Before, the
  author met the mention by opening the `.pptx` — sometimes in front of the
  client — which turned the product's one paid benefit into a surprise instead
  of an offer. It is said once, on stdout, never under a ⚠, never once a
  licence is installed, and never on a path a machine reads (`validate --json`,
  `inspect`, `build --ir`, `capabilities --json` are byte-identical either way).

- **`lutrin license activate | status | deactivate`.** Licences are sold per year
  through [Polar](https://polar.sh), by tier rather than by the seat: $59 USD for
  one person, $449 for a team of ten, $990 for thirty, $2,990 for an
  organisation, and $149 once for a solo lifetime licence on the current major
  line. The people count is **declarative** — nothing in the tool counts your
  colleagues, and a key works on every machine its owner uses, CI runners
  included. `activate` caches the sealed state in
  `~/.config/lutrin/license.json` (mode 0600), `deactivate` releases the machine,
  and re-activating on a machine that already holds an activation releases the
  previous one first, so a reinstall never costs a second.

  **No network on the compilation path.** Reading the licence is a synchronous
  read of one small file: a build never waits on Polar, never fails offline, and
  never slows a preview. Lutrin re-checks with Polar at most once a week, *after*
  the deck has been written, and a licence keeps applying for 30 days without a
  successful check — a plane, a VPN or a Polar outage does not bring the
  attribution back. A key Polar no longer knows is recorded as revoked, which
  restores the attribution on the next build instead of at the end of that grace
  period. The cached record is sealed against the account and machine it was
  activated on: copying it elsewhere makes it ignored, not honoured, and a
  hand-edited `expiresAt` is refused for the same reason.

### Fixed

- **The Lucide icon download had been dead, and said nothing.** The guard
  admitting a downloaded SVG required `<svg` at byte zero, and `lucide-static`
  opens every file it ships with an `<!-- @license … -->` line: every icon the
  CDN serves was rejected. Anyone without `lucide-static` in `node_modules`
  simply got no icons, with no diagnostic anywhere. The check now looks for the
  **root element**, skipping a licence notice, a comment or an XML declaration
  — and still refuses an HTML error page or a captive portal, which is what it
  is there for. The cached bytes are the bytes received, ISC notice included.
  The test that missed this handed the code an idealised `<svg …>`; it now
  reads a real file out of the installed package.

- **A missing official layout catalogue was a silence.** `deck/layout.mjs`
  loaded `design/layouts/*.json` inside a bare `catch {}`, on the theory that
  the built-in bases were enough. They are not: each of the twelve official
  layouts is a base **plus** its geometry, so a broken installation rendered
  `layout: journey` at the wrong proportions and reported
  `stats.warnings === []` — in the CLI and in VS Code alike. `loadOfficialLayouts()`
  now reports `LAYOUT_CATALOG_MISSING`, for an unreadable directory and for an
  empty one, which is the same failure said the same way.

- **A `.deckkit` digest that changed on every build.** `packKit` passed the
  fixed date to `generateAsync()`, which has no such option — JSZip dates an
  entry when `zip.file()` is called, so the sha256 was a function of the clock,
  and two builds of an unchanged kit published two digests. The date now goes
  on each entry, at the DOS epoch (1980-01-01: a zip cannot store 1970, which
  came back out as *2098*). `README.md` has been promising this digest is
  reproducible; now it is.

- **A cache-key line could take a whole render down.** `renderMermaidCached`
  called `crypto.createHash('sha1')` unguarded, and Node **throws** rather than
  returning when OpenSSL runs in FIPS mode. Every caller is written
  `if (file)`, so what should have cost one diagram cost the compilation. It
  now degrades like everything else on that path: no diagram, the source kept
  as a readable code block, and `lastMermaidError()` says why.

- **Four dead imports**, one of which cost the browser playground an import-map
  entry and a shim (`import os from 'node:os'`, unused across 1785 lines of
  `html/render.mjs`). `biome`'s `noUnusedImports` is now on — it is not in the
  recommended set — so the class cannot come back silently.

- **Two paid-tier benefits that described something already free.** *Private
  brand kits included* (Team) and *CI included* (Organisation) both named
  capabilities every user already has: `lutrin kit install` takes any URL and
  checks no licence, and one key already runs on a laptop, a desktop and a
  build server alike. Both are gone from the pricing section. What Team gets
  instead is an open question, recorded in
  `docs/plans/site-and-revenue-checklist.md`.

- **The README's comparison overstated two things and got Pandoc wrong.** It
  said Marp and Pandoc deliver "an image or a frozen block"; Pandoc's PowerPoint
  writer emits native text boxes, native tables and OMML equations, and Marp has
  had `--pptx-editable` since CLI 4.1.0. It also credited Lutrin with native
  charts, which are rasterised images in the `.pptx`. All three corrected.

### Changed

- **"Lutrin" is now stated as a trademark** in `LICENSE` and both READMEs. The
  code stays MIT, licensing check included; the name does not travel with it. A
  fork is free — under another name.

## [1.2.0] — 2026-07-29

The things a corporate deck kept redrawing by hand — a status board, stacked
and share bars, a bridge, a Gantt, a heat matrix, a scorecard, a progress
track — are now things the engine draws, from the same Markdown as everything
else. A kit became something one edits rather than hand-writes. And text that
does not fit a bounded region steps down a scale instead of overflowing in
silence, which is the fix the widgets made urgent: the more a layout places,
the more there is to place badly.

### Added

- **`lutrin kit edit` — the kit editor.** A kit could be installed, listed,
  packed and referenced, but editing one meant hand-writing JSON and compiling
  a deck to see what it did. `kit edit <name|directory>` serves a local web
  editor for one kit — tokens, fonts, layouts, images and the manifest's
  display metadata, each in its own panel — with a preview compiled by the
  REAL engine on a specimen deck covering every surface a kit restyles, the
  unsaved state overlaid in memory so nothing touches the disk before "Save
  kit". The WCAG contrast diagnostics of each compile land under the very
  color rows they involve; font uploads are `.ttf` + `.woff2` pairs checked
  against their actual bytes, with the no-embedded-files trap (`.pptx` falls
  back to the viewer's machine) called out in the panel; a kit layout remains
  what it always was — a validated, parameterized alias of a generator, never
  free geometry — built from the base's published parameter schema with its
  own one-slide live preview; press-and-hold Compare (the button, or `B`)
  swaps the preview to the last saved state and back. Export produces the same
  `.deckkit` as `kit create` and surfaces its reproducible SHA-256. The server
  binds 127.0.0.1 only, refuses non-local `Host` headers and foreign
  `Origin`s on every mutating request, confines every read and write to the
  kit directory, caps upload sizes and sniffs magic bytes — a kit stays data,
  even in its own editor. Port 4322 by default, so a deck preview (4321) runs
  beside it. The guide: `docs/kit-editor.md`.

- **`kit edit --create` — a kit from nothing.** The scaffold writes `kit.json`
  (the name derived from the directory, or `--name`), a `theme.json` copied
  from the engine's default theme — the editor starts from the exact tokens
  the engine uses, not from an empty object nobody can judge — and the
  `layouts/`, `images/` and `fonts/` directories. `--create` on a directory
  already carrying `kit.json` is an error: nothing is ever overwritten.

- **Kit images by alias — `![](kit:hero-photo)`.** A kit's `theme.json` can
  now declare `"images": { "hero-photo": "./images/hero.jpg" }`, and a deck
  places one by alias with the usual roles (`left`, `right`, `cover`,
  `background`). The deck names an intent and the kit owns the file — swap
  the kit and the imagery follows, no path into someone else's directory
  layout. Once resolved, the image rides the exact pipeline a local image
  rides — same placement, embedded in the `.pptx`, inlined in the HTML — and
  the paths obey the rules the logos already obey: relative to `theme.json`,
  confined to the kit. An alias the kit does not declare answers
  `KIT_IMAGE_UNKNOWN` with the nearest declared alias suggested and the usual
  placeholder; so does `kit:…` compiled without a kit, since the default
  theme declares no images.

- **`![line](lucide:leaf)` — an icon the height of one line of text.** The
  smallest of the four size words, and the only one that is not a factor on a
  constant of the engine: it is one line of BODY text, read from the theme, so
  a kit with a 16 pt body gets a taller icon without asking — and read at the
  STEP the region was re-flowed at, so a panel auto-fit had to densify gets an
  icon that still matches its line rather than one and a half. For an icon
  standing *beside* text. It cannot go *inside* a run of text — see below.

- **A run of text that eats an image now says so — in a cell, in a bullet and
  in a heading.** A cell holds runs, and an image has never been one:
  `![](lucide:check)` written in a status column was dropped at parse time and
  the cell came out empty, with nothing in the log. Neither format can hold it
  — a DrawingML cell is a text body, and this engine deliberately leaves row
  heights to PowerPoint, so there is no geometry to float an image against; it
  is the inline-icon finding one step worse, since one long cell shifts every
  row below it. A bullet and a heading lose it in exactly the same place
  (`pushRun`), so reporting the cell alone sent an author told "move it out of
  the table" into the next silent loss: hence `TABLE_CONTENT_DROPPED`,
  `LIST_CONTENT_DROPPED` and `HEADING_CONTENT_DROPPED`, each naming what does
  work there — an inline badge for a status column, `type: heat` or `type:
  rating` for a matrix of marks, the icon on its own line above the list or
  under the heading. The whitespace the image leaves behind goes with it, so a
  bullet reads "Done" and not " Done". An `<img>` written as raw HTML — which
  `html: true` accepts — counts as the same loss instead of being PRINTED as
  visible text. `QUOTE_CONTENT_DROPPED`, pushed since the quotation shipped,
  and `IMAGE_PATH_ESCAPE`, the one image error that aborts the build, were
  missing from the published list for the same reason nobody noticed this
  one.

- **A semantic size for icons — `![large](lucide:leaf)`.** The alt slot already
  carried an ink; it now carries a size in the same slot, in any order:
  `small`, `medium`, `large`. Words, never points — they are factors on the
  size both renderers already derive from the slot, so a column narrower than
  the square still wins, and an author never writes a dimension. The factor
  reaches the two renderers AND `blockHeight()` through one accessor: an icon
  that draws 1.4× larger must also measure 1.4× larger, or the next block in
  the flow lands on top of it — and the .pptx rasterizes it 1.4× denser too,
  or the icon the word exists to make prominent is the softest mark on the
  slide while the HTML, which inlines the SVG, stays sharp. The slot is intent **or** description and never
  half of each: the words apply only when the alt is nothing but vocabulary, so
  `![A white arrow](lucide:arrow-right)` stays the sentence someone wrote —
  reading `white` out of it drew the icon white on a white slide, and said
  nothing. A LONE word is always read as an intent, prose or not, because an
  icon's alt is rendered nowhere (both formats describe it by its name): that
  is how `![big]` used to draw a default icon and leave its author hunting, and
  it is now `UNKNOWN_ICON_WORD` — one diagnostic per alt, never one per word,
  with the nearest word suggested and the icon still drawn. Name two inks or
  two sizes and the first wins, with `ICON_WORD_CONFLICT` naming the other.

- **A `split` no longer swallows the `##` heading its author wrote.** `flat()`
  hands a generator the blocks of every section and not the headings, so a
  split flowed the text and dropped the title above it — in both outputs, with
  nothing in the log, on the very layout whose columns invite one. It is turned
  back into a block the way `content` has always done, at the head of its text
  column. In the same pass, a split whose visual column has nothing to put in
  it gives the width back to the text instead of leaving a hollow strip down
  the side of the slide.

  The drop cap that this layout family was asked for is still **refused**, and
  for the reason it always was: text flowing *around* a shape needs a text flow
  engine this compiler deliberately lacks — the HTML could fake it with a
  `float`, a DrawingML text box is a rectangle and could not, and one-sided is
  the divergence the contract forbids. An icon is not the visual of a split
  either: it flows with the text, where it has always been.

- **`type: heat` — the tinted matrix.** Coverage, maturity, risk: rows are
  series, columns are categories, and each cell takes one of the theme's five
  layer shades with the ink already paired to it, so the grid clears 4.5:1
  cell by cell, survives greyscale and is repainted by a kit for free. Five
  discrete steps rather than a gradient, and every cell keeps its number — a
  tint says "more", not "more than what". `scale:` normalises the ramp; without
  it the fallback is the largest value present, and the figure says so by
  labelling the bound "(largest value)", because that fallback is the trap: one
  outlier repaints the grid and two months of the same report stop being
  comparable.

- **`type: rating` — the scorecard of part-filled discs.** Options down the
  side, criteria across the top, and `scale:` declaring the denominator, which
  is the whole design: a scale derived from the largest value seen would let one
  new score rescale every other row of the deck. The discs are DRAWN and
  rasterised like every other figure here, which is what makes them possible at
  all — ◐ (U+25D0) is absent from WGL4 so a narrow kit font would show a tofu
  box, and an OOXML shape adjustment a viewer ignores draws the preset's 270°
  wedge, a confidently wrong score. At `scale: 4` the fills land exactly on the
  quarters. Rejected in the widgets review on those two rendering grounds, and
  reopened once the drawn route made both moot; as a chart type it costs a
  branch in `chart.mjs` rather than a block.

- **Grid cells that span several columns — `spans`.** A list of column counts
  on the `grid` generator, cycling like `panels`: six panels over a full-width
  band is `"cols": 3, "spans": [1, 1, 1, 1, 1, 1, 3]`. Placement stays a
  left-to-right flow — a cell that no longer fits opens the next row, and the
  gap a wide cell leaves at the end of a row is KEPT rather than filled by a
  later cell, because the author wrote those sections in an order and reading
  order is the one thing a mosaic must not rearrange. A span wider than the
  grid is a full-width cell, never an overflow. It lives in a layout
  definition, so a deck still says nothing about width.

- **Five chart types, and the line a series is judged against.** `stacked-bar`
  and `stacked-barh` add the series up per category; `share-bar` and
  `share-barh` normalise each category to 100 % and label the segments past
  7 %. The scale reads the per-category *totals*, so the tallest column always
  fits, and only the free end of a stack is rounded. `waterfall` draws the
  bridge from an opening figure to a closing one — the first and last
  categories anchor to zero, `totals:` names them when there is a mid-bridge
  subtotal, and it is the one chart where hue carries the SIGN rather than the
  identity. `gantt` draws lanes spanning periods (`Discovery: Q1 - Q2`, both
  ends included, a comma for several bars on one lane, `now:` for the "we are
  here" rule): **duration existed nowhere in this engine** — milestones and
  steps, never a start and an end. And `target:` (or `cible:`) draws the
  commitment a series is measured against, dashed, in the deck's own ink, taken
  into the scale so it can never fall outside its frame; reserved only when the
  value is a single number, so a series named "Target" still reads as a series.
- **A target on `:::progress`.** `62 % / 80 %` — the share, then the commitment
  it is judged against, marked by a rule standing on the track. The block's
  height does not change, which is why it is a property and not a component.
  The whole line is read as a single share first and a split additionally
  requires a per cent sign, so `3/4` stays three quarters and `1/0` stays the
  diagnostic it always was — and the comma is never a separator here, since in
  the default locale it is the decimal point.
- **`raid`, a twelfth official layout.** The RAID log (Risks, Assumptions,
  Issues, Dependencies) is a 2 × 2 the `swot` generator already draws: this is
  six lines of JSON and no code at all. Assumptions and Dependencies share the
  informative tint on purpose — both are things a programme relies on and does
  not own.

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

### Fixed

- **`lutrin kit edit` no longer dies at the first file change on Windows.** The
  editor watches the kit directory to reload it when something outside the
  editor touches it. libuv derives each event's name by asserting that the path
  Windows reports starts with the directory it was told to watch, and Windows
  reports in long form: a kit reached through a short 8.3 component
  (`C:\PROGRA~1\…`), a junction or a substituted drive failed that comparison
  and **aborted the process** — not an exception anything could catch or log,
  just a dead editor. The watcher is now pointed at the canonical path;
  the kit root itself is untouched, since it is the boundary every read and
  write is confined to.
- **Mermaid diagrams render in the packaged hosts.** The VS Code extension and
  the Obsidian plugin assemble their own `dist/core`, and both copied `src` and
  `design` only — the vendored Mermaid bundle (`vendor/mermaid/`), which the
  renderer injects into the browser it drives, never travelled. Every diagram
  in an installed extension therefore degraded to its source as a code block,
  on every machine, however well provisioned, while the development mode — where
  `dist/core` is a symlink to the repository — rendered them perfectly. The two
  packagers now share one payload list (`core/scripts/core-payload.mjs`), and a
  build whose `dist/core` lacks the bundle fails instead of shipping.

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

[Unreleased]: https://github.com/julien-riel/lutrin/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/julien-riel/lutrin/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/julien-riel/lutrin/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/julien-riel/lutrin/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/julien-riel/lutrin/releases/tag/v1.0.0
