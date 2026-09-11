# Changelog — @lutrin/mcp

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the package applies [semantic versioning](https://semver.org/). The version
tracks the Lutrin Agent Plugin that pins it.

## [2.0.0] — 2026-09-10

The server is unchanged, and the version tracks the plugin that pins it. What
moved is the compiler behind it, in two ways an agent driving the tools can
see.

### Removed

- **The "Made with Lutrin" attribution**, and the seat licence that removed it.
  A deck built through `build_deck` now comes out unmarked whatever the machine
  it was built on. `capabilities` no longer publishes the `license` command.

### Added

- **`capabilities` publishes `titleLayouts`**, and the frontmatter keys
  `titleLayout` and `titleImage` beside them — an agent writing a deck can give
  its cover a photograph in one half of the page, in the other, or across all
  of it. The diagnostics `TITLE_LAYOUT_UNKNOWN`, `TITLE_IMAGE_MISSING` and
  `TITLE_IMAGE_UNUSED` are published with them, and reported by
  `validate_deck`.

## [1.5.0] — 2026-08-24

The server is unchanged, and the version tracks the plugin that pins it. What
moved is under `build_deck`: a `metrics` or `timeline` slide comes back centred
between the top and the bottom of its frame rather than hung from the title.

## [1.4.0] — 2026-08-21

The server itself is unchanged; the compiler behind it moved, and two of its
answers travel through the tools.

### Changed

- `capabilities` (which every tool's guidance is drawn from) now publishes the
  frontmatter key `lang` and the `languages` it accepts, so an agent writing a
  French deck names the language instead of leaving the engine's own words in
  English.
- `validate_deck` gained the `LANG_UNKNOWN` diagnostic, and stopped reporting
  `LAYOUT_SECTIONS` about a slide whose opening paragraph is a band rather than
  a section — an agent that "fixed" that warning used to delete a paragraph the
  engine had placed correctly.

## [1.3.0] — 2026-08-14

First published version: the package did not exist at 1.2.0, and the version
number joins the line the plugin pins rather than starting its own.

### Added

- Initial MCP server: a thin stdio adapter over `@lutrin/core` exposing the
  compiler loop as tools — `validate_deck`, `build_deck` (`.pptx`/`.html`) and
  `suggest_layout`. Errors are structured results, never a transport crash; the
  pipeline is serialized so concurrent calls cannot corrupt the shared token
  state. Published so the plugin's pinned `npx @lutrin/mcp@<version>` resolves.
