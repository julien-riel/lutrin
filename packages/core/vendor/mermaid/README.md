# Vendored Mermaid

`mermaid.min.js` — the standalone UMD bundle of [Mermaid](https://mermaid.js.org),
copied verbatim from the npm package. MIT, see `LICENSE`.

| | |
|---|---|
| Version | 11.16.0 |
| Source | `mermaid@11.16.0/dist/mermaid.min.js` |
| SHA-256 | `74d7c46dabca328c2294733910a8aa1ed0c37451776e8d5295da38a2b758fb9b` |

## Why a copy in the repository rather than a dependency

Mermaid needs a browser: it measures the text it lays out, so it cannot render
without a layout engine. The two obvious ways to get one both cost far more
than this file:

- `@mermaid-js/mermaid-cli` pulls Puppeteer, which downloads a Chrome — 405 MB
  of `node_modules` plus ~540 MB of browser, measured, on every install. That is
  what made mermaid-cli an optional peer dependency nobody installs, and
  therefore what made diagrams silently degrade to a text fallback on a fresh
  machine.
- Depending on `mermaid` itself installs 83 MB, of which 56 MB are source maps.
  We load exactly one file out of it.

So we take the one file. `browser.mjs` finds a browser already on the machine
and `mermaid-render.mjs` loads this bundle into it; `@resvg/resvg-js`, already a
dependency, turns the SVG into the PNG the .pptx needs.

## Upgrading

Version-bumping is a copy, and the two version markers must move together:

```sh
npm pack mermaid@<version>          # or npm i mermaid@<version> in a scratch dir
cp .../mermaid/dist/mermaid.min.js packages/core/vendor/mermaid/
shasum -a 256 packages/core/vendor/mermaid/mermaid.min.js
```

Then update the table above, the `@mermaid-js/mermaid-cli` peer range in
`packages/core/package.json` (kept in step so both rendering paths speak the
same Mermaid dialect), and `THIRD-PARTY-NOTICES.md`. `test/mermaid.test.mjs`
asserts the bundle is present and that its recorded SHA-256 matches, so a
half-finished upgrade fails the suite rather than shipping.
