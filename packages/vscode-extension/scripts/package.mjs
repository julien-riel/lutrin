/**
 * Assembles dist/ for the extension.
 *
 *   --dev   dist/core = symlink to packages/core (core changes are visible at
 *           the next "Reload Window", with no copy); the core's imports
 *           resolve their dependencies through the node_modules hoisted to
 *           the monorepo root (Node follows symlinks).
 *
 *   --vsix  a real copy of packages/core/{src,design} into dist/core, with a
 *           reduced package.json + `npm install --omit=dev` INSIDE dist/core:
 *           the runtime dependencies (including the native resvg prebuild)
 *           travel inside the VSIX. Then `vsce package --no-dependencies`
 *           (the node_modules hoisted by the workspaces cannot be read by
 *           vsce).
 *
 * The worker lives in the core (core/src/worker/worker.mjs): it travels with
 * dist/core in both modes, nothing to copy.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, '..');
const coreRoot = path.resolve(extRoot, '..', 'core');
const repoRoot = path.resolve(extRoot, '..', '..');
const dist = path.join(extRoot, 'dist');
const distCore = path.join(dist, 'core');

const mode = process.argv.includes('--vsix') ? 'vsix' : 'dev';

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(path.join(dist, 'worker.mjs'), { force: true }); // leftover from before the extraction into the core
fs.rmSync(distCore, { recursive: true, force: true });

if (mode === 'dev') {
  fs.symlinkSync(path.relative(dist, coreRoot), distCore, 'dir');
  installBrandKit();
  console.log(`✓ dist/ (dev) — core symlinked to ${path.relative(extRoot, coreRoot)}`);
  process.exit(0);
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
 * are visible on reload); in VSIX everything is copied.
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

// ------ VSIX mode -----------------------------------------------------------

/**
 * Guard FIRST, before any copying: without it, we install 38 runtime packages
 * and embed the kit — two minutes — only to end up on a `vsce` that fails
 * because the esbuild build never happened, and whose real diagnostic
 * ("Extension entrypoint(s) missing") drowns in a stack trace.
 */
if (!fs.existsSync(path.join(extRoot, 'dist', 'extension.js'))) {
  console.error('✖ dist/extension.js missing — run `npm run build -w lutrin-vscode` first');
  process.exit(1);
}

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

installBrandKit();

// THIRD-PARTY-NOTICES.md lives at the repository root (it covers all of Lutrin)
// but must travel inside the VSIX next to the LICENSE: vsce only embeds the
// extension's directory, so we copy it there before packaging.
fs.copyFileSync(
  path.join(repoRoot, 'THIRD-PARTY-NOTICES.md'),
  path.join(extRoot, 'THIRD-PARTY-NOTICES.md'),
);

console.log('vsce package…');
try {
  // without --yes: npx resolves the @vscode/vsce pinned as a devDependency
  // (reproducible version) instead of pulling the latest one from the registry
  // on every build
  execSync('npx @vscode/vsce package --no-dependencies', { cwd: extRoot, stdio: 'inherit' });
} catch (e) {
  // vsce has ALREADY said everything on stderr (stdio: 'inherit'): execSync's
  // stack trace and its { status, signal, output } object would only bury its
  // diagnostic under ten lines of noise
  console.error(`✖ vsce package failed: ${e.message}`);
  process.exit(1);
}

// Update manifest: to be published on the internal server NEXT TO the VSIX;
// installed extensions consult it through the lutrin.updateUrl setting.
// The sha256 digest is verified by the updater before installation — a
// manifest without a digest is refused.
const extPkg = JSON.parse(fs.readFileSync(path.join(extRoot, 'package.json'), 'utf8'));
const vsixName = `${extPkg.name}-${extPkg.version}.vsix`;
const sha256 = createHash('sha256')
  .update(fs.readFileSync(path.join(extRoot, vsixName)))
  .digest('hex');
fs.writeFileSync(
  path.join(extRoot, 'latest.json'),
  `${JSON.stringify({ version: extPkg.version, vsix: vsixName, sha256 }, null, 2)}\n`,
);
console.log(`✓ ${vsixName} + latest.json generated in packages/vscode-extension/`);
console.log('  → publish both files in the same place on the internal server;');
console.log('  → point the "lutrin.updateUrl" setting at the URL of the latest.json.');
