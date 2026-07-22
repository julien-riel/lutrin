# Changelog — Lutrin for VS Code

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This file covers the VS Code extension; the compiler's own changes are in the
[repository changelog](https://github.com/julien-riel/lutrin/blob/main/CHANGELOG.md).
The extension's version tracks the `@lutrin/core` compiler it embeds.

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
