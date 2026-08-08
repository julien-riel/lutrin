# Changelog — @lutrin/mcp

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the package applies [semantic versioning](https://semver.org/). The version
tracks the Lutrin Agent Plugin that pins it.

## [Unreleased]

### Added

- Initial MCP server: a thin stdio adapter over `@lutrin/core` exposing the
  compiler loop as tools — `validate_deck`, `build_deck` (`.pptx`/`.html`) and
  `suggest_layout`. Errors are structured results, never a transport crash; the
  pipeline is serialized so concurrent calls cannot corrupt the shared token
  state. Published so the plugin's pinned `npx @lutrin/mcp@<version>` resolves.
