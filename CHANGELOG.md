# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project applies [semantic versioning](https://semver.org/).

The packages in this repository carry their own version numbers: `@lutrin/core`
carries the compiler's version, `lutrin-vscode` that of the editor host. Unless
stated otherwise, an entry describes the compiler.

## [Unreleased]

### Added

- **`lang:` in the frontmatter — the language of the words the ENGINE writes.**
  A deck is made of two kinds of text: what the author typed, and what the
  compiler adds around it. The second kind was English whatever the deck was
  written in — a French sentence inside a chip that said "Caution", a `Titre
  (cont.)`, an agenda slide titled "Agenda" — and the only way out was to ship
  a kit for the sole purpose of renaming five labels. `lang: fr` (or `en`, the
  default, optionally with a region: `fr-CA`) translates the five callout
  labels, the continuation suffix of a paginated slide and the title of a
  generated agenda. It also sets what the outputs DECLARE: `<html lang>` and
  the per-slide labels screen readers read, the chrome of the HTML deck's
  presentation mode (controls, help card, presenter window), and the
  **proofing language** of every text run of the `.pptx` — a French deck now
  opens in PowerPoint spell-checked in French instead of underlined in red
  from end to end. A
  kit's own `semantic.<kind>.label` still wins: the language supplies the
  default, the kit overrides it. An unsupported value compiles in English and
  says so, on its own line (`LANG_UNKNOWN`).

### Fixed

- **A Mermaid diagram that fails now says why.** The reason was reachable
  (`lastMermaidError()`) and kept getting lost on the way out. Every build
  renders each diagram twice — a PNG for the `.pptx`, an SVG for the HTML —
  and the second render, on success, cleared the single error slot the first
  had just written to: a diagram degraded to a code block, and nothing
  anywhere said what went wrong. A failure is now only ever forgotten by a
  success of its OWN. The mmdc renderer, whose `catch {}` recorded nothing at
  all, records its reason like the browser one always did; and a child killed
  on the 60-second bound is reported as a timeout rather than as
  "Command failed: …", which read like a broken diagram on a machine that was
  merely slow.

## [1.3.0] — 2026-08-14

The engine reads signals the Markdown already carried and the layout table
ignored: six new inference rules, gathered into a **rule set a deck can pin**,
because promoting a rule changes how decks already written come out and the
undo button had to exist before the rules moved. On top of them, the pieces a
corporate deck kept assembling by hand — a generated agenda, a provenance
line, task lists, a real matrix, an isotype chart, a visual with numbered
callouts, twelve more official layouts (the catalog doubles, from twelve to
twenty-four), and two bands (lead and takeaway) any of them can wear.

The `.pptx` got more native, too: equations land as real OMML you can click
into, five diagram layouts as shapes a presenter can select — or, with
`--smartart`, as a genuine OOXML SmartArt object — and every figure carries
its vector beside its raster. `--pdf` and `--png` write the PDF and the images
from the same pipeline, without a second tool.

And Lutrin became something one can reach without installing it — a playground
on the site that is the real compiler running in the visitor's browser, an
Agent Plugin with an MCP server ([`@lutrin/mcp`](https://www.npmjs.com/package/@lutrin/mcp),
first published at this version), and a second agent skill that derives a
brand kit from a website's URL.

### Added

- **Six new inference rules, and a rule set to version them.** The engine now
  reads signals the Markdown already carried and the layout table ignored. Four
  titled `##` sections become a 2 × 2 `grid`, five or six a row of three, seven
  to nine a compact three — instead of all of them falling through to a
  paginated vertical flow. A lone task list (`- [ ]`) becomes `checklist`, a
  lone numbered list of three to six short items becomes `steps`, a lone nested
  list with one root becomes `hierarchy`. Three or more `##` sections all
  naming a date or a phase become `timeline` — the detection was already
  shipping as a suggestion, only the promotion was missing. And sections that
  repeat the same internal shape become a mosaic of cards, because the
  regularity *is* the intent.

  No new syntax anywhere: every one of those is something an author writes to
  mean something. The bounds are deliberate — a numbered list past six items,
  or with an item longer than about twelve words, is content and stays a flow;
  a nested list with two roots is two trees and stays a flow.

- **Inference rule sets (`inference:`), `LAYOUT_RULES_CHANGED`, and
  `lutrin migrate`.** Promoting a rule changes how decks already written come
  out, so every compilation now names the slides whose layout would have
  differed under the previous rules (`LAYOUT_RULES_CHANGED`, info) — that is
  the real safety net, and the pin is the undo button. A deck freezes its rules
  with `inference: "1.0"` in the frontmatter; what is versioned is the RULE SET
  and never the engine, because a `lutrin:` pin would freeze the rendering
  fixes and the new blocks too and nobody would ever update. Three sets are
  maintained, and `lutrin migrate deck.md` writes the pin and lists the slides
  it protects. A deck that *declares* its rule set is not told: the notice
  catches rules moving under a deck, and a deck that named the rules it was
  written against cannot have moved silently — which is also what makes the
  notice finite, since the slides `migrate` just listed stop being listed on
  every build from then on.

- **Optional regions: a lead band and a takeaway band.** A line of text above
  two columns is not a layout — it is a region, and the region composes. A
  paragraph before the first `##` becomes a band on top; a `:::key` closing the
  last section becomes a band underneath (the block is already called
  "Takeaway"). Defined once and shared by `two-columns`, `three-columns`,
  `comparison`, `pillars`, `grid`, `matrix` and `steps`, with `leadPanel`,
  `leadRatio` and `leadAlign` for kits to tune. One family gained instead of
  one layout per combination.

- **Five structured bases.** `matrix` — the mosaic of `grid` plus real named
  axes, whose labels belong to the layout and not to the deck. `columns` — the
  content flow balanced over two or three columns, a third overflow behaviour
  between pagination and densification. `checklist` — a task list as ticked
  lines, ruled, one or two columns. `pictogram` — the isotype chart, a hundred
  units with the share that counts filled in, fed by a `:::progress` or a
  percentage already written. `annotated` — a visual with numbered callouts
  placed around it and joined by leaders, the callouts dealt top to bottom down
  each side so no two leaders can cross.

- **`table` as a parameterized base.** `zebra`, `emphasis`
  (`header`/`first-column`/`both`/`none`) and `density` — the whole table
  family a kit could want, without a second placement engine.

- **Task lists.** `- [ ]` and `- [x]` are read as a state rather than as three
  characters of prose: the box replaces the bullet marker in both outputs (a
  real `☐`/`☑` bullet in the `.pptx`, so it stays editable and re-indentable),
  and a ticked line steps back into the secondary ink.

- **Eight official layouts** on the new bases, data only: `eisenhower`,
  `effort-impact`, `gartner-quadrant`, `product-tour`, `architecture`,
  `glossary`, `share-of`, `pricing`.

- **The playground's full tour covers all of it.** "The whole tour" — the
  reference deck that shows every layout and every block, one slide each —
  gains twenty-three slides: the six new inference rules each on the signal it
  reads, the five new bases, the eight official layouts, the two bands and the
  checkbox. It declares `inference: "1.1"`, which is both the honest statement
  of what it demonstrates and a working example of the pin.

- **The `kit-from-site` skill.** A second agent skill, beside `deck`: given a
  website's URL, it walks an agent through deriving the organization's brand
  kit — harvest the design system (CSS custom properties, action color, type
  families, logo, corner radii), distill it into a `theme.json` (one primary,
  an explicit six-color chart palette, the right logo variant per surface),
  validate against the engine's WCAG thresholds on a smoke deck, and package
  with `lutrin kit create`. Authored once in
  `packages/core/skills/kit-from-site/`, synced to `.claude/skills/` and
  `plugin/skills/` by `scripts/sync-skill.mjs` — now multi-skill, with the
  same byte-identity guard.

- **The generated agenda.** `agenda: true` in the frontmatter synthesizes
  the agenda slide right after the cover, from the deck itself — which is
  the point: an agenda typed by hand lies the day a chapter is renamed, one
  the engine derives on every build cannot. It lists the deck's chapters
  (its section slides) as a numbered list, falls back to the slide titles
  in a deck without chapters, and paginates like any content flow. Every
  section divider additionally receives the chapter rail — the full list
  under the title, the current chapter in the section ink, the others
  dimmed toward the surface ("you are here"), from one geometry function
  both renderers read. `agenda: Sommaire` names the slide. A deck with
  nothing to list, or a Marp deck, is told so by the new `AGENDA_EMPTY`.

- **`<!-- source: … -->` — the provenance line.** The one line a data-heavy
  slide owes its reader, and the one an author must not be able to typeset
  by hand: a small caption at the foot of the content area, in the muted
  ink. The engine reserves the band before placing anything, so pagination
  and auto-fit never claim the room. Several directives join into one line
  (` · `). An orphan is `ORPHAN_DIRECTIVE` like its siblings; on a section
  or cover slide — no content area — the new `SOURCE_UNPLACED` says the
  line is not drawn rather than letting the directive vanish. This is the
  fork `docs/plans/widgets-next.md` designated when it rejected `:::source`
  as a block.

- **Three chart types for the delivery review.** `bullet` is the multi-KPI
  board — one row per indicator, its value as a bar and ITS OWN target as a
  rule on the track (`Availability: 99.1 % / 99.5 %`, the same
  value-then-commitment order as `:::progress`); each row runs on its own
  scale because eight KPIs share no unit, so the figures are drawn on every
  row and are not optional. `dumbbell` draws what moved between two states —
  a dot per state, the gap as a line, exactly two series on a shared axis
  (the surplus is dropped and reported). And `gantt` learns milestones:
  `^Q3` is a diamond at the center of its period, composable with spans on
  one lane (`Build: Q1 - Q2, ^Q3`) — its own spelling because promoting a
  single period silently would make the same source draw two different
  pictures depending on how long the task is.

- **`:::key` — the fifth semantic tint.** The four others judge (good, bad,
  careful); `key` designates: the takeaway box of a busy slide, labelled
  "Takeaway", set in the brand's own tint — the pale pair LAYER_SHADES
  already validates, so a kit repainting its primary repaints the callout
  for free. One list feeds every place an author names a tint, so
  `:::progress key` works too, and the completion, the validator and the
  contrast suite picked the new word up from the lists they already read.

- **Four official layouts, one JSON file each.** `kanban` (a headed column
  per stage — To do, Doing, Done), `team` (one centered card per person;
  pairs with a kit layout adding the portraits through `images`), `okr`
  (one headed panel per objective, key results as `:::progress` bars
  inside), and `risk-map-3` — the 3 × 3 enterprise risk matrix, nine tinted
  cells from green to red in the same reading order as `risk-map`. To make
  the ninth cell representable, the `grid` base now accepts **2 to 9**
  sections (was 8) — not silent for anyone: a 9-section grid used to get
  LAYOUT_SECTIONS and lose its ninth cell, and now places it. Validation
  suggests `kanban` when the headings read To do / Doing (LAYOUT_SUGGESTION).

- **A layout can place a kit image the deck never writes.** Four bases take
  it in a `layouts/*.json`: `split` (`"image": "kit:<alias>"` — the visual
  beside the text, the existing `side` and `ratio` saying where and how
  wide), `hero` (the full-page background), `section` (the branded divider —
  the photo full-bleed under a scrim of the section surface at 85 % opacity,
  one constant both renderers read, so the slide stays the brand's colour
  and the validated title ink keeps roughly its contrast whatever the
  photo), and `grid` (`"images": [...]` — one image per cell, cycling by
  cell position like `panels`; the generator places it as a band at the head
  of the cell and flows the text below, rather than pushing it through the
  flow whose fixed 280 px estimate would overflow any dense mosaic — the
  team page: portrait, name, role). Only kit aliases are accepted, never a
  file path or a URL — the kit is the one place a brand's images are
  declared, confined and validated, and a layout that could name an
  arbitrary file would bypass exactly that; `checkParam` refuses the form at
  registration, and whether the alias exists is judged against the ACTIVE
  kit at compile time, where `KIT_IMAGE_UNKNOWN` lands on the slide's
  `<!-- layout: … -->` line with the usual did-you-mean. The deck's content
  keeps the last word: a slide — or a grid cell — that brings its own visual
  keeps it, and the layout's image stays away, said out loud by the new
  `LAYOUT_IMAGE_UNUSED` (info, naming the cells concerned), because an
  automatic decision the author cannot see is a decision they cannot refuse;
  `section`, which places no content, always applies it. The synthesized
  image blocks travel the ordinary road from there — asset prepass,
  embedding, placeholder on an unknown alias — in both outputs.

- **The special fences write their first draft too.** A line starting
  `` ``` `` completes into the three fences the compiler treats as more than
  code — `chart` (a full bar-chart spec with categories, two series and a
  target), `math` (an equation that actually renders), `mermaid` (a minimal
  flowchart) — as tabbable snippets, closing fence included. Any other
  fence (` ```js `) matches nothing and the popup closes: the help never
  gets between an author and a plain code block. The compiler exports no
  list of special fences, so their test asserts behavior instead of
  membership: each template, parsed, must yield a block of its own type,
  and the math default is rendered through MathJax on Node rather than
  merely validated.

- **The `:::` directives write their own first draft.** A line starting
  `:::` completes into the seven containers the DSL knows — the four
  callouts, `metric`, `progress`, `status` — and accepting one inserts a
  whole worked block as a snippet: fields the Tab key walks, closing `:::`
  included, the documentation's own examples as the default text. The names
  come from `CONTAINERS` (deck/parse.mjs), the live list the validator
  checks unknown directives against; the templates live in
  `site/assets/js/deck-snippets.mjs` under a test that compiles every one of
  them through `validateDeck` and demands zero diagnostics — help that
  inserts something the validator then underlines is worse than no help,
  and a directive added to the DSL fails CI until it gets its snippet.

- **Your own kit uploads into the playground, and stays.** The kit picker's
  last entry takes a `.deckkit` — the same archive `lutrin kit install`
  takes — and reads it with the same `readKitArchive`: zip-slip refusal,
  extension allowlist, size limits, manifest validation, the CLI's own
  refusal wording. `kit/archive.mjs` went runtime-neutral to make that
  possible (JSZip's `internalStream` instead of `nodeStream`, `Uint8Array`
  instead of `Buffer`, `TextDecoder` instead of `Buffer.toString`) with the
  anti-zip-bomb budget still enforced *during* inflation, and Node behaves
  exactly as before. What is persisted in IndexedDB is the archive's BYTES,
  not the extracted tree: the next visit remounts without re-uploading and
  re-validates from scratch — the bytes were kept, not the trust, and a rule
  tightened since the upload re-refuses it. "New" forgets the kit with the
  rest of the workspace. The crypto shim learned to hash bytes on the way
  (its `update()` stringified a `Uint8Array` into "137,80,78,…" — a digest
  of the wrong thing, silently), pinned against Node's own.

- **The playground compiles under a kit.** A picker in the bar offers the
  eight example kits; choosing one fetches the kit's files — theme, fonts,
  logos, its own layouts — into the page's virtual filesystem (file list from
  `/kits/index.json`, generated by `site-serve.mjs` and written by
  `pages.yml`, the two pinned to each other by a test) and hands the compiler
  a `themePath`. From there on nothing is playground-specific: the same code
  that resolves a kit directory on disk reads the manifest, validates and
  confines the theme, embeds the fonts, registers the kit's layouts — which
  therefore appear in the layout completion the moment the kit is active,
  because the completion reads the live registry, not a list of its own. The
  choice persists with the rest of the workspace and restores before the
  first compile, so a branded deck reopens branded rather than flashing the
  default. Exports inherit the kit the preview shows. `path.normalize`
  joined the path shim on the way (the kit-confinement checks call it),
  pinned against Node's own like the rest of the computing shims.

- **Everything the DSL asks from a closed list completes itself.** The layout
  directive came first — thirty-seven names nobody remembers in full: `<!-- l`
  offers the directive keys and chains straight into the values,
  `<!-- layout: ` lists the layouts with their catalogue descriptions as
  detail text, and accepting closes the comment when the line has not written
  `-->` yet. Then the rest of the closed lists followed: `<!-- animate: ` and
  the frontmatter's `animate:` offer the presets plus `true`/`none`;
  `](lucide:` (and `](icon:`) offers the icon set, its ~2 000 names fetched
  once, on first ask, from an index both site generators publish beside the
  icons — the layouts.json pattern, with a test pinning the two generators to
  each other; `](kit:` offers the image aliases the active kit declares, each
  with its declared path — and with no kit active it offers nothing, which is
  the truth rather than a guess. Every list is the LIVE view the validator
  checks the same syntax against (`LAYOUTS`, `ANIM_PRESETS`, `KIT_IMAGES`):
  completion can never suggest what validation would then flag, and a name
  added to any catalogue appears in the popup and the validator at once.

- **The playground's pane is CodeMirror 6.** The textarea served the demo; an
  editor deserves an editor. CodeMirror was chosen over Monaco deliberately:
  it ships genuine browser ESM the site's import map resolves with no build
  step — the founding constraint of `site/` — where Monaco would put ~3.5 MB
  of AMD loader on the critical path, and it weighs a fraction as much. What
  the swap buys: Markdown highlighting and line numbers in the site's dark
  pane, the validator's findings drawn as squiggles under the offending line
  (message on hover, marks in the gutter — the same `validateDeck` findings
  the clickable list shows), native undo/redo that survives programmatic
  inserts, Tab indentation and Markdown list continuation from the keymap.
  Every workbench feature — autosave and restore, drag-and-drop images,
  caret↔slide sync, Open/Save — carries over on top of a four-verb seam, and
  the harness scripts drive the page through a published
  `window.lutrinEditorHooks`, because a canvas of spans has no `.value` to
  set. A second graph-walking test keeps every transitive `@codemirror`/
  `@lezer` specifier covered by the import map, so a missing entry fails in CI
  rather than at link time in a visitor's tab.

- **The playground grows into an editor.** A page that renders everything and
  forgets everything is a demo; this closes the gap between the two, entirely
  in the visitor's browser. The deck now autosaves — source and file name to
  localStorage, dropped images to IndexedDB — and is restored on the next
  visit, images landing in the virtual `/deck/` *before* the first compile so
  a restored deck never opens on a false "missing image" note. Decks are
  files: New / Open… / Save `.md` and `Ctrl`/`Cmd`+`S`, through the File
  System Access API where the browser has it (Open holds the handle, so the
  next save writes the same file without a dialog) and a download everywhere
  else; the file name is editable in the editor bar and its stem names all
  three artifacts. The notes area leads with `validateDeck()` — the same
  validator the CLI prints from — as clickable, line-anchored findings, and
  the caret and the preview track each other through the `sourceLine` every
  scene already carried: the caret highlights its slide, clicking a slide
  jumps to the line that produced it. Tab indents, and insertions go through
  the undo stack. None of it runs in the landing page's embedded card, which
  is a taster, not a workspace — and nothing is ever stored anywhere but the
  visitor's own browser.

- **The playground draws diagrams, icons and dropped images.** Three of the
  four things the page used to name as impossible fell to one observation: the
  compiler's synchronous call sites cannot await a render, but every one of
  them begins by looking at a disk, and the page controls the disk. After each
  compile, playground.js renders the Mermaid diagrams the scene graph asked
  for — with the bundle `@lutrin/core` already ships, loaded like MathJax, so
  the page and the CLI run the *same* Mermaid — fetches the Lucide icons the
  deck names from the site's own origin (never a third party: an icon name is
  something about your deck), writes both exactly where `renderMermaidCached()`
  and `lucideSvg()` will look, and compiles once more over the filled disk. A
  local image is the manual version of the same move: drop the file onto the
  editor and its bytes land in the virtual `/deck/`, embedded from tab memory,
  uploaded nowhere. The new `mermaidContentKey()` export is the naming
  contract that keeps pre-renderers and the compiler's lookup in step; the
  `.pptx` export carries the diagram at the same 3× raster the CLI produces.

  The gap notes shrank to what actually fails, and each offers `npx lutrin`
  only when the command genuinely is the remedy — a diagram Mermaid refused or
  an icon the pinned set lacks fails identically there. The one true CLI-only
  case left is a remote image URL. `scripts/playground-raster-check.mjs` now
  proves the whole loop end to end: the diagram and the icon reach the
  preview, and the exported `.pptx` carries them as sound PNGs rather than as
  their source text.

- **Equations reach the page, both halves of them.** LaTeX was the last block
  type the playground could not carry, and the reason it gave was true as far as
  it went: `deck/assets.mjs` builds MathJax out of seven bare specifiers,
  `mathjax-full` is CommonJS, and no import map can resolve any of them. What
  the page never said is that the same package also publishes
  `es5/tex-svg-full.js` — a UMD bundle a classic `<script>` runs perfectly well.
  `site/assets/js/shims/mathjax.mjs` loads it exactly as `shims/jszip.mjs` loads
  JSZip, and `mathDocument()` now picks between two engines rather than owning
  one: the seven imports on Node, the bundle where there is a `document`.

  **The MathML half survives**, which is the whole point of doing it this way.
  An equation carries two things into a `.pptx` — the picture and the MathML
  `pptx/omml.mjs` turns into a native `<m:oMath>` PowerPoint lets you click
  into — and the bundle reaches them through different names (`tex2svg`,
  `tex2mml`) than the modules do. That is why `mathDocument()` returns an
  interface with those two methods instead of the four MathJax objects it used
  to hand out: a backend that produced only the picture would look completely
  correct, and every equation exported from the page would quietly stop being
  editable. `scripts/playground-raster-check.mjs` now drives an equation through
  the real page and asserts both — the PNG *and* the `<m:oMath>`.

  Two things that were nearly missed, and both fail silently:

  - `tex2svg` returns an `<mjx-container>` holding the `<svg>` **and** an
    `<mjx-assistive-mml>` beside it. Serializing the container, the way the Node
    engine serializes its lite node, yields two top-level elements — a string
    that still looks like an SVG, still passes every width check, and is refused
    by the strict XML parser behind `<img>`. Every equation went back to a code
    block, and the failure read as "this browser has no rasterizer". The `<svg>`
    element is what gets serialized. (`enableAssistiveMml: false` does not
    prevent this; the menu component reinstates it.)
  - The bundle must be `tex-svg-**full**`. The smaller one carries only the
    default TeX packages and `autoload` fetches the rest **from a CDN** —
    a network call on a page whose promise is that your text never leaves your
    machine, and a divergence from the CLI, which builds its input jax with
    `AllPackages`.

  2.3 MB, fetched on the first equation of a session and never for a visitor who
  only types — `mathDocument()` is called from `mathSvg()` and nowhere else. The
  playground's gap list no longer names equations; what it reports now is
  `mathTotal - mathRendered`, which is invalid LaTeX or a bundle that could not
  be fetched.

- **The browser is a rasterizer, and the compiler now uses it.** `svgToPng()`
  had exactly one backend — `@resvg/resvg-js`, a native module — so everywhere
  it could not load, the engine concluded nothing could be rasterized at all.
  The playground said so in as many words: charts "travel as their
  specification in text" because "turning one into a picture needs a native
  rasterizer no page can load". That was never true. `<img>` decodes an SVG,
  `canvas.drawImage` paints it and `toBlob` hands back PNG bytes.

  `deck/raster-browser.mjs` is that second backend, tried when resvg is out of
  reach — resvg still comes first where it loads, because it is the
  deterministic one the goldens and the fidelity check are measured against.
  Charts, equations, icons and **native SmartArt** are therefore reachable from
  a page: the SmartArt path only ever needed the raster fallback it could not
  get. A kit's font travels with the picture — an SVG inside an `<img>` cannot
  see the page's `@font-face` rules, so the glyphs are inlined into the SVG as
  `data:` URIs, the same information resvg receives through `fontFiles`.

  Measured rather than presumed, on the compiler's own output: the text renders
  accents included, an internal `<style>` block is honoured (the very thing that
  defeats LibreOffice's SVG import), and the canvas is not tainted.

- **The playground hands over the file.** It compiled a deck in the visitor's
  browser and then had nowhere to put it: the preview was the whole output, and
  the `.pptx` was withheld on purpose — *"that one is the reason to install"*.
  Two buttons now download both real outputs, built in the tab and uploaded
  nowhere.

  Neither is an export of the preview. The `.html` is `compileHtml` called
  again *without* `fragment`, so it is the standalone document
  `lutrin build --html` writes, presenter mode and fit script included. The
  `.pptx` is the PowerPoint renderer itself — `renderDeckBytes`, the new entry
  point that hands the finished package back instead of leaving it on disk,
  with all eight post-processing passes on the way. Measured rather than
  assumed: browser and CLI produce a package whose every part is byte-identical
  but `docProps/core.xml`, where PptxGenJS stamps the clock.

  Three things made the renderer runnable in a page, and each was a silent
  failure until it was not:

  - **`ZIP_BYTES`** (`src/pptx/bytes.mjs`). Every pass round-trips the zip and
    every one asked JSZip for a `nodebuffer` — a type that exists only on Node
    and *throws* in a browser, on whichever pass reaches it first, with the
    package already half written. They ask per runtime now, and a test greps for
    the literal: a pass added later would copy its neighbour and break the page
    and nothing else.
  - **`pptx.write()` rather than `pptx.writeFile()`.** PptxGenJS's `writeFile`
    branches on the runtime and, off Node, pushes a *download* — the visitor
    would have got a half-finished package before a single post-pass ran.
  - **The `fs` shim keeps bytes as bytes.** The package is written into it and
    reopened between passes; stringifying on the way in would have failed as a
    corrupt archive rather than as a lost write.

  `jszip` and `pptxgenjs` are `import()`ed on the first click and never before —
  half a megabyte a reader who only types does not pay for. JSZip ships no ESM
  at all, so a shim loads its UMD bundle as a classic script and re-exports the
  global.

  **The gaps are not the same on both sides, and the page says which.** A chart
  is live SVG in the preview and a *raster* in PowerPoint, so charts, equations
  and icons travel into the `.pptx` as their specification in text. The engine
  already reported that as `RASTER_UNAVAILABLE`; the diagnostic now carries a
  `count`, so the page can state the number and replace the one part that is
  untrue in a browser — *"run `npm install`"* is not advice a visitor can take.

  Instrumented as `playground exported`, with `format` and `mode`. Deliberately
  not folded into `pptx downloaded`, which counts the demo deck coming off a
  link: merged, neither *"did the real-PowerPoint claim land"* nor *"did a
  reader leave with their own deck"* would have an answer.

- **The landing page now compiles.** The playground was the fifth link in the
  navigation bar and a paragraph three sections down, so the fastest thing a
  visitor can do on `info.lutrin.app` — put their own words through the engine —
  was also the least visible. A **Try it right here** section sits one scroll
  under the headline, the hero's primary button leads to it, and the bar carries
  a single coloured *Try it live* that survives the mobile collapse.

  The section frames `playground.html?embed=1` rather than loading the compiler
  a second time: the import map, the shims and the load order are the hard part
  of that page, and a copy of them on `index.html` would be a copy that drifts.
  The flag strips only what the card already says around it — header, footer,
  headline, install line, closing links — and makes the two panes fill the
  frame. The frame is lazy, through the loader the gallery already used, so a
  reader who never scrolls that far downloads none of it.

  Instrumented, because otherwise nothing would say whether it worked:
  `playground edited` fires on the first keystroke, once, with `mode=embed` or
  `mode=page`. It is the only event on the site that reports somebody compiling
  their own deck rather than intending to.

- **Kits that customize more than colour.** A kit could set the palette, the
  body face, the type scale and the corner radii, but every deck still opened
  on a white cover, set its titles in the body face and signed each slide with
  the same primary bar — so kits read as "the colours that changed". Three
  token groups close that gap, each backward-compatible (its default is exactly
  what the renderers used to hard-code, so a theme that names none compiles
  byte-for-byte as before, the goldens included):

  - **`fonts.display`** — an optional second family worn by the cover, section
    and slide titles and the pull-quote (a serif headline over a sans body, the
    way a brand actually reads). Embeddable through `fonts.displayFiles` under
    the same twin/licence/GDI rules as the body files, as a second
    `<p:embeddedFont>` group in the `.pptx` and its own `@font-face` in the
    HTML. Absent, the titles keep the body family.
  - **`surface`** — the three slide backgrounds and the inks on them
    (`pageBg`, `coverBg`/`coverInk`/`coverMutedInk`, `sectionBg`/`sectionInk`):
    a dark cover, a darker section band, a tinted content page. Derived from the
    palette and overridable; the WCAG harness gained the matching pairs, so a
    darkened surface with an ink that fails is reported on every build.
  - **`accent`** — the signature flourishes (`bar` for the cover bar, the
    content title's accent segment, the focus bar and the quotation mark;
    `rule` for the title hairline), decoupled from the brand/link `primary`.

  All three are first-class in the kit editor (a Display family field, a
  Surfaces card and an Accent card, with contrast diagnostics anchored to the
  row they involve), listed in `capabilities().theme`, and seeded in
  `design/themes/default.json`. The eight gallery kits were rebuilt to exercise
  the whole schema — display faces, surfaces, accents, brand chart palettes,
  SVG signatures and opinionated layouts — so the same specimen is now
  unmistakable from one kit to the next, greyscale included.

- **Two gallery kits now bring their headline font with them.** `press-noir`
  ships Oswald and `market-coral` ships Fraunces (SIL OFL 1.1, no Reserved Font
  Name, `fsType 0`), as `.ttf` + `.woff2` twins under the kit's `fonts/`, with
  the licence beside them. A display family named but not shipped is only
  visible to a reader who happens to own it: on the Linux box that renders the
  published gallery, every kit's titles used to come back in the fallback face.
  The specimens on info.lutrin.app now show the typeface the kit means.

- **The kit editor uploads the display font too.** `fonts.displayFiles` had to
  be written by hand: the Fonts panel offered three variant cards, and they all
  belonged to the body face. It now carries a set per embeddable family — an
  upload under the display face declares `fonts.displayFiles`, previews under
  its own name, and proposes a **display** family rather than renaming the body
  one. A `.ttf` dropped on a face with no family yet adopts the family the font
  reports, which is what makes the display upload do anything at all (the
  engine drops display files that no `fonts.display` names) — and the panel says
  so under the cards when that is the state. The shared `fonts/` directory
  lists which face and variant uses each file, deleting a file cleans the
  declarations of both, and a `fonts.displayFiles.*` diagnostic now opens the
  Fonts panel on the right card instead of landing in Tokens.

- **`accent.coverBar`** — the cover's flourish, on its own token. The cover is
  the one surface a kit paints in its own brand colour, and a bar left on
  `accent.bar` then drew itself in the colour it lies on: the flourish simply
  disappeared. `coverBar` follows `bar` unless set (so a theme that names
  neither renders exactly as before, goldens included), and the WCAG harness
  now measures it against `surface.coverBg` at the 3:1 asked of a graphic
  object. That check found three covers whose bar was already invisible — the
  example theme, `press-noir` and `signal-violet` — and let `market-coral` drop
  the pale-cover workaround for the full-colour cover it wanted.

- **Native OMML equations.** An equation now lands in the `.pptx` as a real
  PowerPoint equation — the one its own editor opens and edits — instead of a
  picture of one. It is written the way PowerPoint writes its own, both halves
  every time: `mc:Choice Requires="a14"` carries `a14:m/m:oMathPara/m:oMath`
  with the runs set in Cambria Math, and `mc:Fallback` carries the MathJax
  picture as a **locked** shape (`a:spLocks … noTextEdit="1"`). Nothing is lost
  to a reader without OMML — Keynote, LibreOffice, Google Slides and Quick Look
  draw exactly the image they drew yesterday, its SVG twin included.

  The conversion is **exact or it does not happen**. `pptx/omml.mjs` walks the
  MathML MathJax already built on its way to the SVG — no second parse of the
  LaTeX, and no new dependency — and returns null rather than guess:
  `menclose` (a `\cancel` that vanished would change the maths),
  `mmultiscripts`, a ragged matrix, an unknown `mathvariant`. An equation it
  declines keeps the picture it already was, and `lutrin build` reports how
  many did. Closes gap #4 of
  [docs/plans/competitor-gaps.md](docs/plans/competitor-gaps.md);
  `node scripts/reference-pptx.mjs` checks the encoding against a deck
  PowerPoint itself wrote.

- **`apex`, a fifth diagram layout.** Levels stacked into a triangle, apex
  first, read top-down in document order like every other layout in this DSL —
  drawn everywhere, and editable as real OOXML SmartArt under `--smartart`,
  alongside `cycle`, `hierarchy`, `venn` and `radial`.

  It is a pyramid, and is deliberately not called one: **`pyramid` was already
  taken** by the official catalog layout (`layers` with `shape: pyramid`),
  whose bands hold a heading *and* its paragraph where `apex` holds labels
  alone. The two are not interchangeable, so they do not share a name — and
  decks written against `layout: pyramid` are untouched.

- **An Agent Plugin, and an MCP server.** Lutrin is now packaged as a portable
  Agent Plugin ([agent-plugins.org](https://agent-plugins.org) v1.0.0) under the
  top-level `plugin/` directory: a closed `plugin.json` manifest (name
  `lutrin`), an `mcp.json` launching the server via `npx -y @lutrin/mcp@<version>`
  (pinned), and the `deck` skill. The skill is authored once in
  `packages/core/skills/deck/SKILL.md` and synced byte-identical to
  `.claude/skills/deck` and `plugin/skills/deck` by `scripts/sync-skill.mjs`.

  The new **`@lutrin/mcp`** package is a publishable MCP server — a thin adapter
  over `@lutrin/core` — exposing the compiler loop as tools: `validate_deck`
  (the `--json` deck doctor), `build_deck` (`.pptx`/`.html`, refusing to write a
  deck in error unless forced), and `suggest_layout` (per-slide inferred layouts
  and structured-intent suggestions). Errors are structured results, never a
  transport crash; Mermaid and equations degrade to text when no browser is
  present. Conformance, skill-sync and version-pin tests guard it in CI, and its
  behavioural suite drives the server over the MCP protocol against the hermetic
  fixture. See [docs/plans/agent-plugin.md](docs/plans/agent-plugin.md).

- **A PDF writer, and image export.** `lutrin build deck.md --pdf` writes the
  deck as a PDF: one page per slide at 1280 × 720, no margin, every animation
  step open, the notes left out — and an **outline** of the slide titles, so a
  reader navigates by name instead of scrolling. `--png` and `--jpeg` name a
  stem and write one file per slide beside it, at twice the slide size. The
  extension of `-o` is enough on its own: `-o handout.pdf` needs no flag.

  It is the same standalone HTML the `--html` output already produced, printed
  by a browser the compiler already knew how to find — `browser.mjs` and
  `puppeteer-core` were there for Mermaid. Nothing in the new module decides
  geometry or pagination; the images even read the same `@media print`
  stylesheet the PDF does, which is what makes an exported frame and its PDF
  page the same picture rather than two renderings that agree today.

  **A browser is REQUIRED for these three, and that is new.** Everywhere else a
  missing browser or rasterizer degrades and says so; there is no degraded PDF,
  so the build refuses before writing a byte and names the three ways to fix it
  (an installed Chromium, `lutrin setup-mermaid`, or `LUTRIN_BROWSER`). CI
  proves it works headless on Linux, macOS and Windows through a smoke step
  that fails rather than skips when no browser is found — a skipped export is
  not a tested one.

  **The presenter notes are not in the PDF.** Marp writes them as annotation
  objects; that means writing PDF objects, which means a PDF library, and this
  compiler does not take a dependency for one flag. The comparison pages were
  narrowed to that one remaining claim rather than losing the concession —
  including two that had quietly become false in our favour.

- **Four diagram layouts, and real OOXML SmartArt behind them.** `cycle`,
  `hierarchy`, `venn` and `radial` are the four shapes the catalog could not
  express: a process that closes on itself, a tree, an intersection, a hub. As
  ever they are asked for, never inferred — `<!-- layout: cycle -->` — and the
  content is the ordinary DSL: `##` sections are the nodes, a nested bullet
  list is the tree, and the paragraph before the first `##` is the hub of a
  radial. A `cycle` section's first paragraph becomes its node's second line.

  **By default they are native editable PowerPoint shapes** — real discs,
  boxes and arrows a presenter can select — and an inline SVG in the HTML,
  from the same coordinates. The two outputs are pixel-identical, and the
  geometry lives in one module both renderers read, so they cannot drift.

  **`--smartart` asks for the other thing.** With the flag (or `smartart:` in
  the frontmatter), the `.pptx` carries a genuine `<p:graphicFrame>` and five
  `ppt/diagrams/*` parts, and PowerPoint opens its own *SmartArt Design*
  ribbon on the object — Text Pane, Change Layout, Change Colors. It is the
  first thing this compiler adds to the package rather than rewriting, and the
  first that is **opt-in because it costs something**: Keynote and macOS Quick
  Look show nothing for it, PowerPoint re-lays the diagram out with its own
  engine (so what is guaranteed there is the frame, the node count, the
  reading order and the palette — not the coordinates), and the object is not
  animated. Every other reader draws the cached geometry, which *is* the
  coordinates. Without the flag nothing changes and a diagram displays
  everywhere, which is why the published demo is built without it.

  The colours are the kit's, written out literally rather than referenced from
  the theme: PptxGenJS ships a fixed Office palette and lutrin never rewrites
  it, so a theme-accent diagram would have rendered Office blue inside a
  branded deck. The consequence is worth knowing — running *Change Colors* in
  PowerPoint's gallery replaces the brand palette, and the way back is to
  rebuild.

  None of the five parts is vendored from Microsoft; all are authored from the
  ECMA-376 vocabulary, because this repository is MIT and MIT grants
  downstream sublicensing. Two diagnostics come with the layouts:
  `SMARTART_NODES` when a tree yields fewer than two nodes, and
  `SMARTART_TEXT` when formatting inside a label is dropped. A family whose
  layout definition PowerPoint mislays can be turned off on its own line and
  falls back to native shapes. See
  [docs/plans/smartart.md](docs/plans/smartart.md) — including the checks a
  human with PowerPoint still has to sign off.

- **Figures in the `.pptx` now carry their vector as well as their raster.** A
  chart, a Mermaid diagram, a Lucide icon and a LaTeX equation are all born as
  SVG, and until now that SVG was thrown away the instant resvg had rasterised
  it: the deck shipped the PNG alone, and the comparison pages on the site
  conceded as much. The picture now carries both. **What it does not change is
  the important half**: the PNG is still the picture's fill, byte for byte, and
  still what Keynote, LibreOffice, QuickLook and every Office before 2019 draw
  — they ignore an extension they do not know. The vector rides beside it, in
  the extension Office reserves for exactly this, so PowerPoint 2019 and later
  scale a diagram to the projector without softening it. Nothing to write in
  the deck; `build` reports how many images carry one, next to the line that
  already counts the animated slides. Text, tables and shapes were never images
  and still are not.

  **The vector is opt-in on evidence, and that asymmetry is deliberate.** A
  malformed SVG costs nothing today — resvg returns nothing, the block degrades
  to a readable fallback. The same bytes *inside* the package make PowerPoint
  declare the whole file corrupt, which is a failure of an entirely different
  order. So three structural checks run first — an `<svg>` root carrying the
  SVG namespace, no bare `&`, balanced tags — and anything that does not pass
  simply stays the raster it already was. The injection is a post-processor
  that reopens the zip and leaves the file untouched on any surprise, and it
  finds its pictures **by the name the renderer gave them**, never by counting
  `<p:pic>` ordinals: a hero image or a logo is a picture too, and would shift
  every count after it. Measured on a 200 KB deck: 7.3 KB, no part removed, no
  PNG altered, every existing relationship still pointing where it did.

- **A kit can be derived from the brand's PowerPoint template** —
  `lutrin kit import <brand.potx|brand.pptx>`. A brand rarely starts on a blank
  page: it exists as a `.potx` a designer maintains, and asking someone to
  retype twelve hex values into a `theme.json` was asking them to copy a file
  they already had. The command reads the theme part's colour scheme and its
  body typeface and writes an ordinary kit directory — one you can open in
  `lutrin kit edit`, pack with `lutrin kit create`, install anywhere. Twelve
  scheme slots become fourteen colour tokens by *derivation*, not
  transcription: a straight copy would have left the primary ramp, the surface
  ramp and the highlight tints on the engine's default blue, so an indigo brand
  would have got blue architecture layers.

  **It reads no geometry, and that is the design decision, not an unfinished
  importer.** The template's slide layouts, its placeholder boxes, its master
  geometry and its type sizes are left where they are — honouring a
  placeholder box would import exactly the author-positioning this project
  refuses, and it would arrive under the honest-sounding name of "completing
  the importer". A title's point size was chosen *for* a box of a given width
  at a given position; importing the number without the box imports half a
  decision. Since a designer who hands over `brand.potx` reasonably believes
  the layouts came along, the refusal is said out loud twice: a note that
  **counts** what was discarded, on every import, and a `README.md` written
  into the generated kit — with the template's SHA-256 — so the fact outlives
  whoever ran the command.

  **A palette that fails the WCAG thresholds is reported, never adjusted.** A
  colour corrected behind the user's back is a brand that is not the brand,
  shipped under the brand's name, with nothing downstream saying which token
  moved. The verdict is the `THEME_CONTRAST` check every build already runs, on
  the kit as actually written — Microsoft's own default Office theme, imported,
  warns on five chart colours and stays exactly as Microsoft drew it. One
  palette is refused rather than half-imported: a master that maps its
  background to the dark slot yields the accent ramp and the chart colours
  only, because every surface token lutrin derives ramps toward the
  *template's* background while the engine's own stays light — and "ordinary
  ink on a muted panel" is a pair the contrast check does not measure, so half
  a dark palette would fail silently instead of loudly.

- **The HTML deck stopped being the poor relation of the `.pptx`.** An animated
  deck built to HTML made its blocks *appear*, one step per click, and that was
  the whole of it: `<!-- animate: zoom -->` produced a zoom in PowerPoint and a
  plain toggle in the browser — one source line meaning two different things.
  The four effects (`fade`, `wipe`, `zoom`, `appear`) now apply in both outputs,
  and they are read from **one table**, `deck/anim.mjs`, that both renderers
  ask. Not a copy kept in step: the same table. It moved out of `pptx/` for a
  second reason as well — the browser playground compiles the HTML renderer, and
  `pptx/anim.mjs` drags `node:fs` and JSZip in behind it, which is a whole OOXML
  post-processor loaded into a page that will never write a `.pptx`.

  Movement is something a reader can be made ill by, so every effect rule sits
  under `@media (prefers-reduced-motion:no-preference)`: ask your system for
  stillness and the steps still reveal, they simply arrive without travel. The
  print block neutralises all three properties, because an entrance effect left
  standing prints what the audience has not seen yet — a metric frozen at 40 %
  scale, a panel clipped down to nothing. And every rule is gated on
  `.slide-frame[data-anim-steps]`, the attribute the deck editor strips to show
  a slide whole: an ungated `opacity:0` would have blanked the editor, the print
  rendering and the site's demo iframe alike.

- **Presentation mode grew the chrome a projector needs: a progress bar,
  on-screen controls and an overview grid.** A thin bar along the bottom says
  how far through the deck you are, and two arrow buttons sit above it — for a
  room where the laptop is out of reach, or a deck driven from a touch screen.
  Both follow the pointer: shown while it moves, gone a couple of seconds after
  it stops, so a slide left standing is projected with nothing on it. The
  buttons grey out at the *real* ends of the deck only — a step still to be
  revealed counts as a "next", so the last slide of an animated deck is not
  finished yet. They are named `present-*` on purpose: `.progress` and its two
  children already belong to the `:::progress` block of the DSL.

  **`O` shows the whole deck at once.** Not thumbnails: the slides themselves,
  already in the document at their fixed geometry, laid into a CSS grid and
  rescaled by the fit script from a single dispatched `resize` — a stylesheet
  and one event are the entire implementation. Click a slide, or move with the
  arrows and press `Enter`, to jump there. The click listener is registered in
  the **capture** phase, or a tap in the grid would also reach the reveal
  handler on the slide and advance a step on the way out.

  **`Esc` now steps out one level at a time** — the help panel, then the grid,
  then the mode — instead of tearing everything down from wherever you were.

- **A wall clock in the presenter view.** Beside the elapsed timer, the time of
  day, to the minute and no further: a clock that ticks steals the eye the notes
  need. The two answer different questions — the timer says how long you have
  been talking, the clock says whether you are late, and a room is booked by the
  second one. It is filled in when the window opens rather than half a second
  later on the first tick, which is the half second in which a presenter looks
  at it.

- **Printing the standalone HTML now gives a 16:9 PDF.** The page declared
  `@page{margin:0}` and nothing else, so the browser laid a 1280 × 720 frame
  onto the reader's default paper — A4 portrait — and scaled or cropped it. The
  document now emits `@page{size:1280px 720px;margin:0}`, and with the print
  rules that were already there (one slide per page, the fit transform undone,
  every animation step open, notes hidden) the browser's own print dialog became
  a working export. It is injected by the **complete document only**: the same
  stylesheet is handed to hosts — the VS Code webview, the editing SPA — where
  an `@page` rule is not ours to set and would repaginate the host's own
  printing, which is why the old rule had to leave `baseCss()` to make room for
  this one.

  It is not a Lutrin PDF *writer*, and the difference is worth saying out loud
  rather than letting a user discover it: no notes annotations, no outline of
  the slides, no PNG or JPEG export. It gives a handout and a fallback for a
  machine with no PowerPoint.

- **`lutrin new` — a first deck without a blank page.** The starter deck that
  "Lutrin: New Presentation" has always opened in VS Code now lives in the
  compiler (`deck/sample.mjs`), and the command line hands out the same one: two
  surfaces giving a different first deck is a second thing to keep correct.
  `lutrin new` writes `presentation.deck.md`, `lutrin new talk` adds the
  extension you left off, and a file that already exists is **refused** unless
  `--force` — the same word and the same policy as `kit install` and `build`. A
  name ending in `.deck.md` drops the `deck: true` preamble it does not need,
  while the VS Code untitled buffer, which has no name at all, keeps it, since
  nothing else would mark it as a deck. The deck it writes validates with zero
  diagnostics: a starter that greets you with warnings says "broken" before you
  have typed anything.

- **Frontmatter `notes:` — the cover finally has somewhere to put its note.**
  The cover generated from `title:` is the one slide no `<!-- notes: -->` can
  reach: there is no line in the source to hang the comment on. `notes:` in the
  frontmatter is that missing line, and it lands in the `.pptx` notes slide and
  the HTML presenter view like any other slide's notes. A flat one-line value,
  like every key there — the frontmatter reader is a one-line-per-key scanner,
  so no block form exists to write. With no cover to carry it (no `title:`, or a
  Marp deck, where `title:` is HTML metadata and the first slide is the author's
  own) the line is inert, and now says so: `COVER_NOTES_ORPHAN`, positioned on
  the `notes:` line.

  One consequence stated plainly, because the documentation promises that
  unknown frontmatter keys are ignored: a deck already carrying `notes:` as
  private metadata will now hand that line to its cover. Rename the key if it
  was never meant to be spoken.

  Deliberately **not** done: making a `<!-- notes: -->` written before the first
  heading attach to the cover. That comment already belongs to the first real
  slide, and moving it would silently relocate the notes of every deck that has
  one.

- **`checkout clicked` — the site can finally see someone leave to buy.** The
  three events already there watched a reader arrive, copy a command and open
  the deck, and then lost them: the `utm_*` on a `buy.polar.sh` link travels
  OUT with the visitor and is read by Polar, so this site's last sight of a
  buyer was the page they left from — not even the click. It now fires with the
  placement and the tier, **read out of the link's own UTM parameters** rather
  than a list in the JavaScript: a second list is a list that drifts, and this
  way the act that makes a new checkout link attributable in Polar is the same
  act that instruments it here. A link carrying none reports `untagged`, so the
  omission shows up in the report instead of looking like a link nobody
  clicked.

  It does not delay the navigation, and does not need to: the tracker served at
  `cloud.umami.is/script.js` posts with `fetch(…, { keepalive: true })` — read
  out of the shipped script, which is the only way to know — and that is
  precisely the browser's undertaking to let a request outlive the document
  that started it. A `preventDefault()` and a timeout would have bought the
  datum at the price of a slower checkout.

- **A convention for the UTM coming IN, and the measured reason it has to be
  one.** The site tagged everything going out and nothing coming in, so every
  announcement — a Hacker News post, a Reddit comment, a README link — arrived
  indistinguishable from someone typing the domain. Measured on 2026-08-01,
  `channel` returned exactly one row (`direct`) and `referrer` returned none:
  *"what did the launch bring"* had no answer to give. `site/README.md` now
  fixes a small closed vocabulary for each of `utm_source`, `utm_medium` and
  `utm_campaign`, chosen to survive the one constraint that shapes it — **the
  stats route refuses the `utm_*` metric types outright**, leaving them
  readable only through `channel`, which buckets them, and `referrer`, which a
  link opened from an app, a PDF or a QR code never sends at all.

- **`packages/core/test/site-analytics.test.mjs` — the prose is now enforced.**
  *"When adding a checkout link, give it a UTM"* was a sentence, and a sentence
  fails silently. The test reads the placement and tier lists **out of
  `site/README.md`** — one list, not a copy — and holds every `buy.polar.sh`
  href in `site/*.html` to them; it requires the Umami tag, the right website
  id and `data-domains` on every page, **with an explicit allowlist for the
  ones that must not have it**, so an uninstrumented page is a decision on the
  record rather than an oversight; and it keeps `sitemap.xml` equal to that
  same set of pages. A page that ships blind is a page nobody notices is blind:
  no visitors and no tracker look identical from a dashboard.

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

- **The `:::key` callout had no fill in the HTML.** The stylesheet emitted a
  rule per semantic kind — info, success, warning, danger — and stopped one
  short: `.alert-key` was never written, so the takeaway callout rendered as
  bare text on the page background while the `.pptx` (which paints
  `SEMANTIC[kind]` generically) gave the same block its tinted panel. One
  rule closes the gap; both outputs now read `semantic.key.fill`/`.text`.

- **A picture exported from the playground was the words `404 /tmp/…`.**
  pptxgenjs takes a different branch in a page: given a `path` it fetches the
  string instead of reading a file, and a compiler temp path answers 404 — so
  it embedded THE BODY OF THE 404 as the image. The `.pptx` opened without a
  complaint, with a picture frame on the slide and 42 bytes of error text
  inside it. Local images now travel as bytes wherever this is not Node
  (`localImage`, pptx/render.mjs), which also makes `data` skip that fetch
  entirely. `node scripts/playground-raster-check.mjs` drives the real page and
  asserts every media part is a PNG by its magic bytes — it fails, loudly, when
  the bridge is removed.

- **The font line of `build` named the wrong family.** A kit that ships glyphs
  for its display family alone was reported as `font "<body family>" embedded
  (2 variants)` — crediting the embedded variants to the one typeface that was
  *not* in the deliverable. Both renderers now report which families they
  actually carried (`embeddedFontFamilies`), and the CLI names them.

- **The gallery's font guard was granted per kit, not per family.** A kit
  shipping `fonts.files` had *every* slot exempted from the
  installed-everywhere check, display family included, while a kit shipping only
  `fonts.displayFiles` was held to it for the very family whose glyphs travel
  with it. The exemption now follows the files that carry each family, and the
  kits that ship glyphs are checked for what silently drops a variant: a missing
  `.woff2` twin, a restricted `fsType`, a family name or style bits Windows
  would refuse.

- **A Mermaid diagram drew as black boxes in LibreOffice.** The `.pptx` carries
  a correct PNG and, beside it, a vector twin for readers that prefer it.
  Mermaid's SVG is the only one we do not author: it sets its fills from an
  internal `<style>` (`#lutrin-diagram .node rect{…}`, no `fill` on the rect at
  all) and sizes itself with `width="100%"`. A reader that skips those rules
  paints every node with the SVG default — black — and pushes the labels out of
  their boxes.

  Two beliefs fell with it. It is not "any renderer that is not a browser":
  resvg is not a browser and renders it correctly, so the failure is
  LibreOffice's SVG import specifically. And LibreOffice was listed among the
  readers that *ignore* the `asvg:svgBlip` extension — it does not, it reads it
  and prefers the SVG, which is how a correct raster ended up replaced by a
  wrong vector.

  `svgPartSafe` now refuses any SVG carrying an internal stylesheet, so that
  picture keeps the raster it always had and every renderer agrees. The cost is
  sharpness at zoom on Mermaid diagrams alone; the other ten SVGs of the demo
  keep their twin. Earning it back means inlining the computed CSS as
  presentation attributes — [docs/plans/svg-css-inline.md](docs/plans/svg-css-inline.md).

- **`RASTER_UNAVAILABLE` counted diagrams it should not have.** The message
  says the blocks were replaced by their specification **in text** — true of a
  chart, an equation and an icon, and never of a diagram: with no rasterizer
  there is no stand-in picture, so the diagram falls through to native drawn
  shapes and comes out complete. Counting one inflated a number the sentence
  then attributed to the other three.

  Removing it does not make the case silent. A new `SMARTART_UNAVAILABLE`
  warning says what actually happened — the diagrams are drawn as native shapes,
  the slides are complete, and only the editable object `--smartart` asked for
  is missing. A warning rather than an error, because nothing is absent from
  the slide.

- **A built-in layout could silently shadow the official catalog.** Built-ins
  register before `design/layouts/*.json`, so a built-in taking a catalog
  name made the catalog entry throw `already exists` — a throw
  `loadOfficialLayouts` swallows into a diagnostic. The official layout simply
  vanished, and every deck naming it got the built-in instead, with nothing in
  the output to say why. A regression test now reads the catalog **directory**
  and fails if any file never reaches the registry; reading the directory
  rather than a hand-kept list is the point, since a list can be edited to
  match the breakage.

- **A mistyped callout in a Marp deck was silent.** Validation used to abandon
  its `:::` scan entirely for a `marp: true` deck, on the sound ground that three
  colons are not Marp syntax — a line starting that way there is usually prose, a
  Docusaurus admonition or a Pandoc fenced div. What it cost was the one case
  that matters: `:::Info` opens no callout (the container plugin is
  case-sensitive), so it printed its own colons onto the slide with nothing said
  anywhere. The scan now **narrows** instead of stopping. In a Marp deck only a
  casing slip on a real lutrin callout is reported, and as a **warning** rather
  than an error, since a Marp deck must keep compiling. Everything else starting
  with `:::` is still left alone, on purpose: it is someone else's syntax, and
  turning a third-party deck that compiles today into one that refuses to is not
  a trade a heuristic may make.

- **`site/README.md` listed the wrong metric types for the stats route**, and
  wrongly in the direction that costs something: `entry` and `exit` were
  missing, and they are the ones that answer *which page did they arrive on* —
  a question `path` cannot answer at all, since it counts every view and a page
  everybody passes through outranks the page they landed on. `title`,
  `country`, `region`, `city`, `browser`, `device`, `os`, `language`, `screen`
  and `tag` were missing too, and `url` was listed although this gateway
  refuses it: here the type is called `path`. Re-measured against the live
  route on 2026-08-01 and written down as a table of what answers `200` and
  what answers `400` — the refusals being the half that changes what you can
  ask.

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
  instead is an open question, recorded in the checklist that is no longer kept
  here (see *Removed*, below).

- **The README's comparison overstated two things and got Pandoc wrong.** It
  said Marp and Pandoc deliver "an image or a frozen block"; Pandoc's PowerPoint
  writer emits native text boxes, native tables and OMML equations, and Marp has
  had `--pptx-editable` since CLI 4.1.0. It also credited Lutrin with native
  charts, which are rasterised images in the `.pptx`. All three corrected.

### Changed

- `LAYOUT_SUGGESTION` is no longer emitted for an intent the engine has already
  acted on: three dated headings are inferred as `timeline` since rule set 1.1,
  so advising a directive that would change nothing is noise.

- **The `.pptx` no longer carries zip directory entries.** A package Office
  writes has none; ours had one per folder, an artefact of JSZip materialising
  a parent for every path handed to `file()`. Nothing in OPC forbids them and
  no reader ever objected — this was never a defect, just the last line of
  `docs/reference-pptx.md` that read differently from PowerPoint for a reason
  nobody had chosen. Dropped by a final post-write pass, which also makes the
  file marginally smaller.

- **Morph is no longer the privilege of paginated slides.** The transition
  existed, and only the engine could ask for it: a slide too long to fit was
  split into "(cont.)" pages, and those pages morphed. An author who wrote two
  slides called `# Roadmap` — the same board, one step further on — got a cut.
  The rule is now the one a reader would have guessed: **any run of consecutive
  slides showing the same title morphs**, the title holding still while the
  content changes under it. A paginated run followed by a slide the author
  titled the same way is one continuity, not two: a continuation page still
  *shows* "(cont.)", but it remembers the title the author wrote and is paired
  on that, so the chain no longer cuts at the seam. Titles are compared
  trimmed — leading and trailing
  space is invisible on the slide, and refusing to pair on it would be a
  failure the author cannot see — while case and inner spacing are visible and
  left to mean what they say. An untitled slide breaks the run, and a title
  that comes back on slide 3 and slide 20 gets nothing: that is a coincidence,
  not a continuity, and dissolving slide 19 into slide 20 for 700 ms would be
  the tool inventing a relationship.

  **The behaviour change is deliberate and there is no flag for it.** A deck of
  ten slides all titled `# Question` now carries nine Morph transitions where
  it carried none. The engine decides the presentation of a deck — that is the
  contract, and an opt-out flag would be a coordinate by another name — so the
  way to say "these are separate slides" is to give them separate titles, which
  is also what tells the audience.

  It fixed a latent bug on the way. The shape renamed to pair the two slides
  was "the first `<p:sp>` of the slide", which on a `hero` slide is the Lutrin
  attribution and not the title. No deck could reach that case while only
  pagination built chains; widening the rule made it reachable, and the old
  code would have morphed two watermarks into each other while the titles
  blinked. The rename is now anchored on the title placeholder itself, and a
  chain whose slides are not really consecutive is refused with a warning
  instead of written.

- **"Lutrin" is now stated as a trademark** in `LICENSE` and both READMEs. The
  code stays MIT, licensing check included; the name does not travel with it. A
  fork is free — under another name.

### Removed

- **The Obsidian plugin, `packages/obsidian-plugin/`.** It was never released:
  private, version 0.1.0, and its own README said it was a work in progress
  that nothing documented or shipped. What it did cost was real all the same —
  a second packager assembling its own `dist/core`, a second suite and a second
  bundle in the CI matrix, a release directory verified and uploaded on every
  commit, and a `>=22`-engine manifest to keep in step with three others. A
  surface nobody could install is a surface that only ever spends.

  **The engine loses nothing.** The worker is still an IPC process the host
  forks, `imageRoots` still widens the local-image trust roots beyond the
  deck's directory (the VS Code extension declares the workspace), and the SVG
  sanitizer still stands between an inlined logo and an Electron renderer —
  none of those three were the plugin's, they were the host contract's, and the
  VS Code extension exercises all of them. The one behaviour that leaves with
  the plugin is the translation of `![[…]]` wiki embeds, which lived entirely
  on the host side: the core never knew that syntax existed. `resolveImagePath`
  keeps decoding percent-encoded paths, because file names with accents and
  spaces need it on their own.

  `npm run typecheck` and `npm run build` at the root now name one host, the
  CI keeps two test suites instead of three, and the `obsidian` types package
  leaves `THIRD-PARTY-NOTICES.md`.

- **The two revenue planning documents**, `docs/plans/site-and-revenue.md` and
  its checklist, are no longer kept here. A price considered and not announced
  is not the same kind of document as a plan for auto-fit, and this repository
  is public.

- **`scripts/analytics.mjs`, and with it `npm run analytics`.** The reader went
  where its readings are kept, which is not here. It holds no credential —
  those are in `<config>/analytics.json` and always were — but a tool whose
  whole purpose is to turn a Share URL into the site's traffic belongs with the
  traffic. The `curl` recipe it automates stays documented in `site/README.md`:
  it contains no secret, and Umami's undocumented `x-umami-share-context`
  header is worth writing down somewhere public.

  **Nothing else moved, and the site least of all.** `site/` is deployed at
  `info.lutrin.app` — its pages are public whatever repository holds them — and
  `pages.yml` compiles the demo deck and serves `packages/core` to the
  playground from `HEAD`. That is what makes the demo unable to drift from the
  compiler; splitting the site out would have spent it to hide something
  already visible. The licence path (`packages/core/src/license/`) stays for the
  same reason: the paywall is runtime, and it ships inside the MIT package. So
  does the instrumentation in `site/assets/js/main.js` — four custom events
  that fire in the visitor's own browser, where devtools already shows them.

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

[1.3.0]: https://github.com/julien-riel/lutrin/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/julien-riel/lutrin/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/julien-riel/lutrin/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/julien-riel/lutrin/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/julien-riel/lutrin/releases/tag/v1.0.0
