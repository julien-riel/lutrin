# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project applies [semantic versioning](https://semver.org/).

The packages in this repository carry their own version numbers: `@lutrin/core`
carries the compiler's version, `lutrin-vscode` and `lutrin-obsidian` that of
their editor host. Unless stated otherwise, an entry describes the compiler.

## [Unreleased]

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

[Unreleased]: https://github.com/julien-riel/lutrin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/julien-riel/lutrin/releases/tag/v1.0.0
