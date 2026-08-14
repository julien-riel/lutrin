# Changelog

All notable changes to the Lutrin Agent Plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
version tracks the [`@lutrin/mcp`](https://www.npmjs.com/package/@lutrin/mcp)
server it pins.

## [1.3.0] — 2026-08-14

First released version of the plugin, at the version of the `@lutrin/mcp`
server it pins.

### Added

- The `kit-from-site` skill: derive an organization's brand kit from its
  website's URL — harvest the design system, distill it into `theme.json`,
  validate against the WCAG thresholds, package with `lutrin kit create`.
  Synced from the canonical copy in `packages/core`, like `deck`.
- Initial Agent Plugin (agent-plugins.org v1.0.0): `plugin.json` manifest,
  `mcp.json` launching the `lutrin` MCP server via `npx @lutrin/mcp`, and the
  `deck` skill synced from the canonical copy in `packages/core`.
- MCP tools: `validate_deck`, `build_deck`, `suggest_layout`.
