/**
 * Pure core of the wikilinks pre-pass — the line-by-line scan and the
 * rewrite, with nothing of Obsidian in it. `wikilinks.ts` is now no more than
 * the adapter that supplies the resolver (metadataCache + the vault base path).
 *
 * This split exists for the sake of testing: the scan carries three invariants
 * that a regression breaks in silence — the frontmatter is left intact, the
 * inside of ``` fences is left intact (the same scan as validate.mjs), and an
 * embed whose target is not an image is left as is (a note embed).
 */

import * as path from 'node:path';

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const EMBED = /!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** Resolves a wiki link to an ABSOLUTE path on disk, or `null` when the target
 *  is not found in the vault. The caller (wikilinks.ts) closes over access to
 *  the vault; here we know nothing but strings. */
export type TargetResolver = (target: string) => string | null;

export function translateWikiEmbeds(source: string, resolve: TargetResolver): string {
  const lines = source.split(/\r?\n/);
  let inFence: string | null = null;
  let inFrontmatter = lines[0]?.trim() === '---';

  return lines
    .map((raw, k) => {
      const line = raw.trim();
      if (inFrontmatter) {
        if (k > 0 && line === '---') inFrontmatter = false;
        return raw;
      }
      const fence = line.match(/^(`{3,}|~{3,})/);
      if (fence) {
        if (!inFence) inFence = fence[1][0];
        else if (fence[1][0] === inFence) inFence = null;
        return raw;
      }
      if (inFence) return raw;
      return raw.replace(EMBED, (m, target: string, alt?: string) => {
        const abs = resolve(target.trim());
        // not an image (note embed, or missing target): leave it as is
        if (!abs || !IMG_EXT.has(path.extname(abs).slice(1).toLowerCase())) return m;
        // <…>: markdown-it accepts spaces and accented characters in the destination
        return `![${(alt ?? '').trim()}](<${abs}>)`;
      });
    })
    .join('\n');
}
