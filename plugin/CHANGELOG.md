# Changelog

All notable changes to the Lutrin Agent Plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
version tracks the [`@lutrin/mcp`](https://www.npmjs.com/package/@lutrin/mcp)
server it pins.

## [Unreleased]

### Added

- Initial Agent Plugin (agent-plugins.org v1.0.0): `plugin.json` manifest,
  `mcp.json` launching the `lutrin` MCP server via `npx @lutrin/mcp`, and the
  `deck` skill synced from the canonical copy in `packages/core`.
- MCP tools: `validate_deck`, `build_deck`, `suggest_layout`.
