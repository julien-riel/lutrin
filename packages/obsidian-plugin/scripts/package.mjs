/**
 * Assemble dist/ — the complete Obsidian plugin directory, ready to be copied
 * (or symlinked) into `<vault>/.obsidian/plugins/lutrin/`.
 *
 *   --dev       dist/core = symlink to packages/core (changes to the core are
 *               visible on the next plugin reload, with no copy); the core's
 *               imports resolve their dependencies through the node_modules
 *               hoisted to the root of the monorepo.
 *
 *   --release   a real copy of packages/core/{src,design} into dist/core,
 *               with a reduced package.json + `npm install --omit=dev` INSIDE
 *               dist/core: the runtime dependencies (including the native
 *               resvg prebuild) travel with the plugin. dist/ becomes standalone.
 *
 *   --vault <path>   (optional, repeatable) symlink dist/ into
 *               `<path>/.obsidian/plugins/lutrin` for development.
 *
 * In both modes: manifest.json, versions.json and styles.css are copied into
 * dist/ next to main.js (produced by esbuild.mjs). The worker lives in the
 * core (core/src/worker/worker.mjs) and travels with dist/core.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const coreRoot = path.resolve(pluginRoot, '..', 'core');
const repoRoot = path.resolve(pluginRoot, '..', '..');
const dist = path.join(pluginRoot, 'dist');
const distCore = path.join(dist, 'core');

const mode = process.argv.includes('--release') ? 'release' : 'dev';
const vaultIdx = process.argv.indexOf('--vault');
const vault = vaultIdx !== -1 ? process.argv[vaultIdx + 1] : null;

fs.mkdirSync(dist, { recursive: true });
for (const f of ['manifest.json', 'versions.json', 'styles.css']) {
  fs.copyFileSync(path.join(pluginRoot, f), path.join(dist, f));
}
// legal notices: the licence and the third-party notices live at the root of
// the repository and must travel with the shipped package
for (const f of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
  fs.copyFileSync(path.join(repoRoot, f), path.join(dist, f));
}
fs.rmSync(path.join(dist, 'worker.mjs'), { force: true }); // leftover from before the extraction into the core
fs.rmSync(distCore, { recursive: true, force: true });

if (mode === 'dev') {
  fs.symlinkSync(path.relative(dist, coreRoot), distCore, 'dir');
  console.log(`✓ dist/ (dev) — core symlinked to ${path.relative(pluginRoot, coreRoot)}`);
} else {
  for (const sub of ['src', 'design']) {
    fs.cpSync(path.join(coreRoot, sub), path.join(distCore, sub), { recursive: true });
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
  console.log('installing the core runtime dependencies into dist/core…');
  execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', {
    cwd: distCore,
    stdio: 'inherit',
  });
  console.log('✓ dist/ (release) — standalone plugin directory');
}

/**
 * Embedded brand kit — OPTIONAL.
 *
 * Lutrin ships no organization brand: a brand binds a trademark, it belongs
 * to whoever holds it and lives in its own repository. An organization
 * building its own host can embed one, designated by `LUTRIN_BRAND_KIT` (a
 * kit directory or a `.deckkit` archive), or by a `.brandkit` file at the root
 * of the repository containing that path (untracked — handy for not setting an
 * environment variable in every shell).
 *
 * Its absence is NEVER an error: a public clone builds without a kit and
 * starts on the generic theme. A kit that is ASKED FOR but not found, on the
 * other hand, fails the build — shipping a package silently deprived of its
 * brand would only surface at the user's end.
 *
 * The name of the installation directory comes from the kit's MANIFEST, never
 * from a name hard-coded here. In dev a directory is symlinked (brand tweaks
 * are visible on reload); in release everything is copied.
 */
function installBrandKit() {
  const kitsDir = path.join(dist, 'kits');
  fs.rmSync(kitsDir, { recursive: true, force: true });

  const pointer = path.join(repoRoot, '.brandkit');
  const src =
    process.env.LUTRIN_BRAND_KIT?.trim() ||
    (fs.existsSync(pointer) ? fs.readFileSync(pointer, 'utf8').trim() : '');

  if (!src) {
    console.log('· no brand kit embedded (LUTRIN_BRAND_KIT / .brandkit not set) — generic theme');
    return;
  }
  const abs = path.resolve(repoRoot, src);
  if (!fs.existsSync(abs)) {
    console.error(`✖ brand kit asked for but not found: ${abs}`);
    process.exit(1);
  }

  fs.mkdirSync(kitsDir, { recursive: true });

  if (fs.statSync(abs).isDirectory()) {
    // the name comes from the manifest — a kit repository may be called something else
    const manifest = JSON.parse(fs.readFileSync(path.join(abs, 'kit.json'), 'utf8'));
    const dst = path.join(kitsDir, manifest.name);
    if (mode === 'dev') {
      fs.symlinkSync(path.relative(kitsDir, abs), dst, 'dir');
    } else {
      // SELECTIVE copy: a kit repository also carries its tests and its
      // node_modules, which have no business in the shipped package
      for (const sub of [
        'kit.json',
        'theme.json',
        'layouts',
        'fonts',
        'logo',
        'DESIGN.md',
        'NOTICE.md',
      ]) {
        const from = path.join(abs, sub);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(dst, sub), { recursive: true });
      }
    }
    console.log(`✓ brand kit "${manifest.name}" embedded from ${abs}`);
    return;
  }

  // .deckkit archive: installed by the core itself, hence with its safeguards
  execSync(`node "${path.join(coreRoot, 'src', 'cli.mjs')}" kit install "${abs}" --force`, {
    env: { ...process.env, LUTRIN_CONFIG: dist },
    stdio: 'inherit',
  });
  console.log(`✓ brand kit embedded from the archive ${abs}`);
}

installBrandKit();

if (vault) {
  const pluginsDir = path.join(vault, '.obsidian', 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    console.error(`✗ ${pluginsDir} not found — is this really an Obsidian vault?`);
    process.exit(1);
  }
  const target = path.join(pluginsDir, 'lutrin');
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(dist, target, 'dir');
  console.log(`✓ symlink ${target} → dist/`);
  console.log('  → enable "Lutrin" in Settings › Community plugins.');
}
