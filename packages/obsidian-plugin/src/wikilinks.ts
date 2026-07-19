/**
 * Obsidian → DSL pre-pass: translates wiki embeds `![[image.png]]` into the
 * standard Markdown images `![alt](<absolute path>)` that the compiler
 * understands. The target is resolved through the vault index (metadataCache),
 * so the Obsidian shorthands (a bare file name, with no directory) work. The
 * alias in `![[img.png|right]]` becomes the role of the image (`right`,
 * `left`, `cover`, `background` — see the DSL).
 *
 * The frontmatter and the inside of ``` fences are left intact (the same
 * line-by-line scan as validate.mjs). Note embeds (`![[Another note]]`) are
 * not translated: they are left as they are.
 *
 * This file now does nothing but wire up the vault; the scan and the rewrite
 * live in `wikilinksCore.ts`, testable without Obsidian.
 */

import { type App, FileSystemAdapter } from 'obsidian';
import * as path from 'node:path';
import { translateWikiEmbeds } from './wikilinksCore';

export function translateWikiEmbedsForVault(app: App, source: string, sourcePath: string): string {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return source;
  const base = adapter.getBasePath();

  return translateWikiEmbeds(source, (target) => {
    const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    return dest ? path.join(base, dest.path) : null;
  });
}
