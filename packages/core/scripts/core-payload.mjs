/**
 * The part of packages/core that travels inside a packaged host — shared by the
 * packaging scripts of the VS Code extension and the Obsidian plugin, which
 * both build a standalone `dist/core`.
 *
 * `vendor/` is in the list, and that is the whole reason this file exists.
 * Mermaid renders in a browser driven by puppeteer-core, and the bundle it
 * injects into that browser is `vendor/mermaid/mermaid.min.js` (see
 * deck/assets.mjs, MERMAID_BUNDLE). The two packagers used to copy `src` and
 * `design` only: the bundle never reached the VSIX, `renderMermaidBrowser()`
 * found no file at its path, returned null, and EVERY diagram in a packaged
 * host degraded to its source as a code block — silently, and on every machine,
 * however well provisioned. Only the dev mode (dist/core symlinked to the
 * repository, vendor included) ever rendered a diagram, which is exactly why
 * the hole survived: it is invisible from the place one develops.
 *
 * The subdirectories are therefore ONE list, in ONE place, and a missing
 * Mermaid bundle FAILS the build rather than shipping.
 *
 * `design/editor` is deliberately dropped: the kit-editor SPA (~372 KB of JS +
 * woff2) is served only by the CLI's `lutrin kit edit`, and no host has a code
 * path that reaches it. It stays in the npm package's `files` list.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Core subdirectories copied verbatim into a host's `dist/core`. */
export const CORE_SUBDIRS = ['src', 'design', 'vendor'];

/**
 * Copies the core payload into `distCore` and writes the reduced package.json
 * that the subsequent `npm install --omit=dev` reads.
 *
 * @param {string} coreRoot packages/core
 * @param {string} distCore the dist/core to fill (must not exist yet, or be empty)
 */
export function copyCorePayload(coreRoot, distCore) {
  const editorDir = path.join(coreRoot, 'design', 'editor');
  const withoutEditor = (src) => src !== editorDir && !src.startsWith(editorDir + path.sep);

  for (const sub of CORE_SUBDIRS) {
    fs.cpSync(path.join(coreRoot, sub), path.join(distCore, sub), {
      recursive: true,
      filter: withoutEditor,
    });
  }

  // A packaged host without this file renders no diagram at all, and says so
  // nowhere: better to stop the build than to ship it.
  const bundle = path.join(distCore, 'vendor', 'mermaid', 'mermaid.min.js');
  if (!fs.existsSync(bundle)) {
    console.error(`✖ the vendored Mermaid bundle did not land in dist/core (${bundle})`);
    process.exit(1);
  }

  const corePkg = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(distCore, 'package.json'),
    JSON.stringify(
      {
        name: corePkg.name,
        version: corePkg.version,
        type: 'module',
        dependencies: corePkg.dependencies,
      },
      null,
      2,
    ),
  );
}
