# Changelog — @lutrin/mcp

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the package applies [semantic versioning](https://semver.org/). The version
tracks the Lutrin Agent Plugin that pins it.

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
