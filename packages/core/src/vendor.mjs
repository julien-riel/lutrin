/**
 * `lutrin vendor` — make a deck's directory self-contained.
 *
 * Compiling must write nothing into the source tree: remote images and Mermaid
 * diagrams go to the user cache, and the kit is installed once per machine.
 * That is the right default, but it assumes THIS machine — a directory that is
 * handed on, archived or cloned elsewhere only compiles identically if its
 * dependencies travel with it.
 *
 * Vendoring is therefore the explicit act that freezes those dependencies into
 * the directory:
 *
 *   assets/remote/   downloaded remote images
 *   assets/mermaid/  rendered diagrams (compilable without mmdc installed)
 *   assets/kit/      the resolved kit — fonts and logos included
 *
 * Only a KIT is vendored. A BARE FILE theme (`kit: ./theme.json`) has no tree
 * of its own: its tree is the deck's, and copying it would mean copying the
 * author's entire neighbourhood — drafts included — into a directory meant to
 * be handed on. So nothing is vendored in that case, and it is said out loud;
 * this is the opposite of the command's contract, and that deserves a notice.
 *
 * The deck's frontmatter is rewritten accordingly (`assets: vendor`, and
 * `kit: ./assets/kit`). This is deliberately a visible modification of the
 * source file rather than an implicit convention: the kit precedence chain
 * (CLI > frontmatter > project > user > host > generic) is the most-read
 * contract in the project, and slipping a hidden level "if there is an
 * assets/kit/" into it would cost more than two honest frontmatter lines.
 *
 * Accepted consequence: after vendoring, the deck uses ITS copy of the kit,
 * including on the original machine. That is what freezing means — updating
 * the kit requires re-running vendor.
 */

import fs from 'node:fs';
import path from 'node:path';
import { looksLikeFrontmatter, parseDeck } from './deck/parse.mjs';
import { buildScenes } from './deck/layout.mjs';
import { prepareDeckContext } from './deck/context.mjs';
import { resolveTheme } from './deck/theme.mjs';
import { fetchRemoteImage, mermaidVendorDir, renderMermaidCached } from './deck/assets.mjs';
import { ALLOWED_EXT, SKIP_DIRS } from './kit/archive.mjs';

/** Every block of the scenes, hero layout included (the same flattening as the
 *  renderers: a hero image is not in `elements`). */
const allBlocks = (scenes) =>
  scenes.flatMap((sc) => [...sc.elements.map((e) => e.block), ...(sc.image ? [sc.image] : [])]);

/**
 * Walks up from `themeFile` to the directory holding the `kit.json` that
 * includes it.
 *
 * The theme's own directory cannot stand in for the kit: `kit.json` declares
 * its theme by a relative path that may descend (`theme: themes/x.json`). And
 * above all, a BARE FILE theme has no kit at all — that is what `null` says
 * here, and it is what forbids vendoring the directory around it (the deck's,
 * most of the time: the whole neighbourhood would go along).
 */
function kitRoot(themeFile) {
  let dir = path.dirname(path.resolve(themeFile));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'kit.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Is `target` inside `parent` (or parent itself)? */
function isUnder(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * A vendoring target we allow ourselves to DELETE recursively.
 *
 * `assets/kit/` is purged before every copy (see below), and an rm -rf is the
 * only operation in this command that destroys work. So it is confined to what
 * we produced ourselves: a path under the deck's directory, and a directory
 * holding a `kit.json` — the signature of a kit copy. Any other content
 * already in place there belongs to the user.
 */
function purgeable(baseDir, destDir) {
  if (!isUnder(baseDir, destDir)) return false;
  if (!fs.existsSync(destDir)) return true;
  return fs.statSync(destDir).isDirectory() && fs.existsSync(path.join(destDir, 'kit.json'));
}

/**
 * Says what is occupying the place, when `purgeable` has refused.
 *
 * The user reads this message at the precise moment they are looking for why
 * their vendoring was refused: talking about a "directory without a kit.json"
 * when `assets/kit` is a FILE would send them looking for the wrong thing. The
 * two situations also call for different gestures (renaming a file, or moving
 * a working directory), so they are told apart.
 */
function occupiedReason(destDir) {
  if (fs.existsSync(destDir) && !fs.statSync(destDir).isDirectory())
    return `${destDir} already exists and is a file, not a kit directory. Move or delete it, then re-run vendor.`;
  return `${destDir} already exists and is not a kit copy (no kit.json). Move or delete this directory, then re-run vendor.`;
}

/**
 * Copies a kit into the deck's directory.
 *
 * We copy the kit's TREE rather than only the files cited by the theme:
 * `theme.json` references its fonts and its logos by relative paths
 * (`./fonts/Body.ttf`), which must keep resolving in the copy. The allow-list
 * is the one used for .deckkit archives — the same definition of "what a kit
 * is allowed to contain", data only, nothing executable.
 *
 * `srcDir` is the kit's ROOT (the one holding `kit.json`), never some arbitrary
 * directory: see `kitRoot`.
 */
function copyKit(srcDir, destDir) {
  let files = 0;
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true })) {
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(r);
      } else if (entry.isFile() && ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) {
        fs.mkdirSync(path.dirname(path.join(destDir, r)), { recursive: true });
        fs.copyFileSync(path.join(srcDir, r), path.join(destDir, r));
        files++;
      }
    }
  };
  walk('');
  return files;
}

/**
 * Rewrites one frontmatter key (added if absent), preserving the rest of the
 * file byte for byte.
 *
 * The project's frontmatter parser is flat (`key: value`, parse.mjs), so a
 * line-by-line rewrite is faithful to it — no YAML to rebuild, no comments and
 * no ordering to lose. A deck WITHOUT frontmatter is given one: it is the only
 * way to carry the declaration.
 */
export function setFrontmatterKey(source, key, value) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  // The SAME predicate as parse.mjs: a deck may begin with `---` (a horizontal
  // rule) without having frontmatter. Without that sharing, `assets: vendor`
  // was injected INTO the first slide (a key never honoured), and an empty
  // block at the top mutilated the author's file. In those cases we prefix a
  // fresh frontmatter rather than edit a block that is not one.
  if (!m || !looksLikeFrontmatter(m[1])) return `---\n${key}: ${value}\n---\n\n${source}`;
  const nl = m[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (i >= 0) {
    if (lines[i] === `${key}: ${value}`) return source; // already up to date: touch nothing
    lines[i] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }
  // end offset of the opening `---` line (handles \n and \r\n) — never
  // indexOf(m[1]), which is 0 when m[1] is empty and destroys the delimiter
  const start = m[0].indexOf('\n') + 1;
  return source.slice(0, start) + lines.join(nl) + source.slice(start + m[1].length);
}

/**
 * Materializes the deck's external dependencies inside its directory.
 *
 * Does not throw on a missing resource: an offline image or a diagram mmdc
 * cannot render is *reported*, not fatal — the deck stays compilable, with the
 * usual fallbacks. Only a deck that could not be read fails.
 *
 * @param {string} input path of the .md
 * @param {object} [opts] { themePath } — the CLI's `--kit`, which takes priority
 * @returns {Promise<object>} report for the CLI display
 */
export async function vendorDeck(input, { themePath = null } = {}) {
  const baseDir = path.dirname(path.resolve(input));
  const source = fs.readFileSync(input, 'utf8');
  const deck = parseDeck(source);
  const prep = prepareDeckContext(deck.meta, { baseDir, themePath });
  const scenes = buildScenes(deck);
  const blocks = allBlocks(scenes);

  const report = {
    baseDir,
    warnings: prep.diagnostics.map((d) => d.message),
    images: { done: 0, total: 0 },
    mermaid: { done: 0, total: 0 },
    kit: null,
    frontmatter: [],
  };

  // ---- remote images -------------------------------------------------------
  const urls = [
    ...new Set(
      blocks
        .filter((b) => b.type === 'image')
        .map((b) => b.src)
        .filter((s) => /^https?:/.test(s)),
    ),
  ];
  report.images.total = urls.length;
  const fetched = await Promise.all(
    urls.map((u) => fetchRemoteImage(u, baseDir, { vendor: true })),
  );
  report.images.done = fetched.filter(Boolean).length;

  // ---- Mermaid diagrams ----------------------------------------------------
  // both formats: the .pptx consumes PNG, the HTML consumes SVG — a
  // self-contained directory must be able to produce either
  const sources = [...new Set(blocks.filter((b) => b.type === 'mermaid').map((b) => b.source))];
  report.mermaid.total = sources.length;
  if (sources.length) {
    const dir = mermaidVendorDir(baseDir);
    for (const src of sources) {
      const rendered = ['png', 'svg']
        .map((format) => renderMermaidCached(src, { format, baseDir }))
        .filter(Boolean);
      if (rendered.length) fs.mkdirSync(dir, { recursive: true });
      for (const f of rendered) {
        const dest = path.join(dir, path.basename(f));
        if (path.resolve(f) !== path.resolve(dest)) fs.copyFileSync(f, dest);
      }
      // partial rendering (a single format): the deck compiles, but not for
      // both targets — that is not "done"
      if (rendered.length === 2) report.mermaid.done++;
    }
  }

  // ---- kit -----------------------------------------------------------------
  // Only a KIT is vendored. `kitName` is resolveTheme's mark of a kit (a file
  // theme has a null `kitName`): without it there is no tree to copy, only a
  // .json sitting somewhere — and the directory around it is the deck's, which
  // we will not copy into itself.
  const { path: themeFile, kitName } = resolveTheme(deck.meta, { baseDir, themePath });
  const srcDir = themeFile && kitName ? kitRoot(themeFile) : null;
  if (srcDir) {
    const destDir = path.join(baseDir, 'assets', 'kit');
    if (path.resolve(srcDir) === path.resolve(destDir)) {
      report.kit = { name: kitName, files: 0, alreadyVendored: true };
    } else if (!purgeable(baseDir, destDir)) {
      // the place is taken by something other than our own copy: we do not
      // destroy it, and above all we do not rewrite the frontmatter towards it
      report.warnings.push(`Kit "${kitName}" not vendored: ${occupiedReason(destDir)}`);
    } else {
      // full replacement: a re-vendored kit must not inherit the files of a
      // previous version (a renamed font, a removed logo)
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });
      report.kit = { name: kitName, files: copyKit(srcDir, destDir) };
    }
  } else if (themeFile && !isUnder(baseDir, themeFile)) {
    // a bare file theme outside the directory: freezing it would mean guessing
    // what it cites and inventing a kit around it; saying so is better than
    // blindly copying a directory that is not a kit
    report.warnings.push(
      `Theme ${themeFile}: bare file outside the deck's directory — it will NOT travel with it. Copy it next to the deck (and adjust "kit:"), or turn it into a kit (lutrin kit create).`,
    );
  }

  // ---- frontmatter ---------------------------------------------------------
  let out = source;
  // `assets: vendor` only makes sense if there are remote images: on a deck
  // that has none, it would be a line of noise in the author's file — and
  // vendoring must only modify the source for a reason
  if (report.images.total) {
    const before = out;
    out = setFrontmatterKey(out, 'assets', 'vendor');
    if (out !== before) report.frontmatter.push('assets: vendor');
  }
  if (report.kit && !report.kit.alreadyVendored) {
    const before = out;
    out = setFrontmatterKey(out, 'kit', './assets/kit');
    if (out !== before) report.frontmatter.push('kit: ./assets/kit');
  }
  if (out !== source) fs.writeFileSync(input, out);

  return report;
}
