/**
 * Native rasterizer for EVERY platform the packaged host runs on — shared by
 * the packaging scripts of the hosts (VS Code extension, Obsidian plugin),
 * which each run `npm install --omit=dev` inside their dist/core.
 *
 * That install keeps only the @resvg/resvg-js prebuild of the MACHINE THAT
 * BUILDS: the binaries are twelve optionalDependencies that npm filters by
 * os/cpu. Shipped as is, the package rasterizes nowhere but on the builder's
 * platform — a VSIX built on macOS reaches a Windows user with
 * `RASTER_UNAVAILABLE` on every chart, equation and icon. One artifact serves
 * every platform (the update channels publish ONE file and ONE digest), so
 * the other platforms' prebuilds are pulled in explicitly, pinned to the
 * exact version npm just resolved. `--force` disarms npm's EBADPLATFORM
 * refusal to install a foreign binary; `--no-save` keeps the throwaway
 * package.json out of it.
 *
 * The list mirrors the platforms VS Code (desktop and remote server) and
 * Obsidian run on — resvg naming: `msvc` for Windows, `gnu`/`musl` for
 * glibc/Alpine Linux. A prebuild that did not land FAILS the build: a
 * silently dropped platform would only surface at a user's end, as a deck
 * whose charts turned into text.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TARGETS = [
  'win32-x64-msvc',
  'win32-arm64-msvc',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'linux-x64-musl',
  'linux-arm64-musl',
  'linux-arm-gnueabihf',
];

/** @param {string} coreDir the dist/core that just received `npm install` */
export function installResvgPrebuilds(coreDir) {
  const resvgPkg = path.join(coreDir, 'node_modules', '@resvg', 'resvg-js', 'package.json');
  const { version } = JSON.parse(fs.readFileSync(resvgPkg, 'utf8'));
  const pkgs = TARGETS.map((t) => `@resvg/resvg-js-${t}@${version}`);
  console.log(`installing the resvg prebuilds for every platform (${version})…`);
  execSync(`npm install --no-save --force --no-audit --no-fund ${pkgs.join(' ')}`, {
    cwd: coreDir,
    stdio: 'inherit',
  });
  const missing = TARGETS.filter((t) => {
    const dir = path.join(coreDir, 'node_modules', '@resvg', `resvg-js-${t}`);
    return !fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => f.endsWith('.node'));
  });
  if (missing.length) {
    console.error(`✖ resvg prebuild(s) missing after install: ${missing.join(', ')}`);
    process.exit(1);
  }
}
