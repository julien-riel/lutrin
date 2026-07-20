/**
 * Finding a browser — the layout engine Mermaid needs.
 *
 * Mermaid measures the text it lays out (that is how it sizes nodes and routes
 * edges), so it cannot render without a real layout engine. The historical way
 * to give it one was `@mermaid-js/mermaid-cli`, which pulls Puppeteer and
 * downloads a Chrome: 405 MB of `node_modules` plus ~540 MB of browser, on
 * every install. That price is exactly why it stayed an optional peer
 * dependency nobody installed — and therefore why diagrams degraded to a text
 * fallback on every fresh machine, silently.
 *
 * The observation this module rests on: a machine that compiles a presentation
 * almost always already HAS a browser. Driving that one costs `puppeteer-core`
 * (28 MB, and, unlike `puppeteer`, it never downloads anything) instead of
 * three quarters of a gigabyte.
 *
 * Order of preference, most explicit first:
 *
 *   1. `LUTRIN_BROWSER` — the escape hatch: an unusual install, a sandbox, a
 *      pinned build. Never second-guessed, and a wrong path is reported rather
 *      than silently skipped, otherwise setting the variable at all would be
 *      indistinguishable from not setting it;
 *   2. `PUPPETEER_EXECUTABLE_PATH` — the same intent, spelled the way the
 *      surrounding ecosystem already spells it (containers, CI images);
 *   3. `~/.cache/lutrin/browser/` — what `lutrin setup-mermaid` downloads when
 *      the machine really has no browser. Preferred over a system install
 *      because it is the one WE provisioned, at a version we know renders;
 *   4. the system browsers, in the order below.
 *
 * Chrome, Edge, Brave and Chromium are all Chromium: any of them drives the
 * CDP endpoint puppeteer-core speaks. Firefox and Safari are deliberately
 * absent — Safari has no CDP at all, and Firefox's support does not cover what
 * mermaid's rendering needs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Root of the user cache — same resolution as assets.mjs (LUTRIN_CACHE,
 *  MTL_DECK_CACHE for the tool's former name, XDG, then ~/.cache/lutrin).
 *  Duplicated rather than imported: assets.mjs imports THIS module, and the
 *  cycle would be paid on every load for six lines. */
function userCacheRoot() {
  return (
    process.env.LUTRIN_CACHE ||
    process.env.MTL_DECK_CACHE ||
    (process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, 'lutrin')
      : path.join(os.homedir(), '.cache', 'lutrin'))
  );
}

/** Where `lutrin setup-mermaid` puts the browser it downloads. */
export const browserCacheDir = () => path.join(userCacheRoot(), 'browser');

/** Candidate system paths, per platform, in order of preference. */
function systemCandidates() {
  const {
    HOME = '',
    LOCALAPPDATA = '',
    PROGRAMFILES = '',
    'PROGRAMFILES(X86)': PF86 = '',
  } = process.env;

  if (process.platform === 'darwin')
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];

  if (process.platform === 'win32')
    return [
      `${PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${PF86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${PF86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${PROGRAMFILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ];

  // Linux and the other unices: absolute paths first (a container often has the
  // binary without a populated PATH), then the names, resolved below.
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
    '/snap/bin/chromium',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'brave-browser',
  ];
}

/** Resolves a bare command name through PATH. `which`/`where` rather than a
 *  hand-rolled PATH walk, so that shims and symlinks resolve the way the shell
 *  would. */
function onPath(name) {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // `where` can return several lines; the first is the one that would run
    const first = out.split(/\r?\n/)[0].trim();
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

const EXE_NAMES = new Set([
  'chrome-headless-shell',
  'chrome-headless-shell.exe',
  'chrome',
  'chrome.exe',
]);

/**
 * The browser previously downloaded into the user cache, or null.
 *
 * A bounded depth-first walk rather than a hard-coded path: `@puppeteer/browsers`
 * nests its installs as `<cache>/chrome-headless-shell/<platform>-<build>/…`,
 * and on macOS the executable sits inside a further `.app` bundle. Spelling
 * that shape out here would make the lookup a hostage to a layout the
 * downloader is free to change; four levels of `readdir` over a directory that
 * holds at most a couple of browsers costs nothing.
 *
 * Directory entries are visited newest-name-last-first so that a cache holding
 * two versions yields the recent one — the one the last `setup-mermaid` asked
 * for.
 */
function cachedBrowser(dir = browserCacheDir(), depth = 0) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // no cache directory yet
  }
  const sorted = entries.sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of sorted)
    if (!entry.isDirectory() && EXE_NAMES.has(entry.name)) return path.join(dir, entry.name);
  for (const entry of sorted) {
    if (!entry.isDirectory()) continue;
    const found = cachedBrowser(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

let _browser; // memoized: the lookup stats a dozen paths, once per process

/**
 * Path of a usable browser, or null — in which case the caller keeps its text
 * fallback and the CLI points at `lutrin setup-mermaid`.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.refresh] recompute instead of returning the memo —
 *   `setup-mermaid` needs it after downloading a browser into the cache.
 * @returns {{path:string,source:string}|null} `source` names where it came
 *   from, so the CLI can say WHICH browser it is about to drive.
 */
export function findBrowser({ refresh = false } = {}) {
  if (!refresh && _browser !== undefined) return _browser;

  for (const [envVar, label] of [
    ['LUTRIN_BROWSER', 'LUTRIN_BROWSER'],
    ['PUPPETEER_EXECUTABLE_PATH', 'PUPPETEER_EXECUTABLE_PATH'],
  ]) {
    const value = process.env[envVar];
    if (!value) continue;
    // An explicit setting that does not resolve is a configuration error, not
    // an absence: fall through to autodetection, but say so — a silent skip
    // here is a support ticket that starts with "but I set the variable".
    if (fs.existsSync(value)) return (_browser = { path: value, source: label });
    console.warn(`lutrin: ${label}="${value}" does not exist — looking for a browser elsewhere`);
  }

  const cached = cachedBrowser();
  if (cached) return (_browser = { path: cached, source: 'downloaded by lutrin setup-mermaid' });

  for (const candidate of systemCandidates()) {
    const resolved = path.isAbsolute(candidate)
      ? fs.existsSync(candidate)
        ? candidate
        : null
      : onPath(candidate);
    if (resolved) return (_browser = { path: resolved, source: 'installed on the system' });
  }

  return (_browser = null);
}

/** Test seam: forget the memoized lookup. */
export function resetBrowserCache() {
  _browser = undefined;
}

/** The build `setup-mermaid` downloads when the machine has no browser at all.
 *  chrome-headless-shell rather than a full Chrome: ~200 MB against ~350 MB,
 *  measured, and it is the only mode we ever drive. Pinned, so that two
 *  machines provisioned months apart render the same diagram identically. */
export const HEADLESS_SHELL_VERSION = '150.0.7871.24';

/**
 * Downloads chrome-headless-shell into `~/.cache/lutrin/browser/` and returns
 * its path.
 *
 * Only ever called by `lutrin setup-mermaid`, and only after the user has said
 * yes: a compile never downloads a browser behind anyone's back — that silent
 * ~1 GB is the whole reason mermaid rendering was broken by default in the
 * first place.
 *
 * `@puppeteer/browsers` ships with puppeteer-core, so the downloader costs no
 * extra dependency.
 *
 * @param {(text:string)=>void} [onProgress]
 * @returns {Promise<string>} path of the executable
 */
export async function downloadHeadlessShell(onProgress = () => {}) {
  const { install, resolveBuildId, detectBrowserPlatform, Browser } = await import(
    '@puppeteer/browsers'
  );
  const cacheDir = browserCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`unsupported platform: ${process.platform}/${process.arch}`);

  // The pin is a starting point, not a contract with the CDN: a build that has
  // been rotated out resolves to the current one for that channel rather than
  // failing the setup outright.
  let buildId = HEADLESS_SHELL_VERSION;
  try {
    buildId = await resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, buildId);
  } catch {
    buildId = await resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, 'stable');
  }

  let lastPercent = -1;
  const installed = await install({
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId,
    cacheDir,
    downloadProgressCallback: (downloaded, total) => {
      if (!total) return;
      const percent = Math.floor((downloaded / total) * 100);
      // every 5 %: enough to show life, few enough not to flood a CI log
      if (percent >= lastPercent + 5) {
        lastPercent = percent;
        onProgress(`  downloading chrome-headless-shell ${buildId} — ${percent}%`);
      }
    },
  });

  resetBrowserCache();
  return installed.executablePath;
}
