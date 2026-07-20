/**
 * The Mermaid rendering chain, whose failure mode is silence.
 *
 * A diagram that cannot be rendered degrades to a readable code block. That is
 * the right behaviour, and it is also why this broke unnoticed for so long: on
 * a fresh machine EVERY diagram degraded, and the deck still compiled, still
 * looked deliberate, and said nothing anyone would read as a defect. The
 * rendering used to hang off `@mermaid-js/mermaid-cli`, an optional peer
 * dependency that ~1 GB of Chromium made sure nobody installed.
 *
 * So the tests below guard the two pieces that replaced it — a browser found on
 * the machine, and a Mermaid bundle shipped inside the package — because
 * nothing in the output of a build would tell us if either went missing again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { findBrowser, resetBrowserCache, browserCacheDir } from '../src/deck/browser.mjs';
import { mermaidConfig, renderMermaidCached, lastMermaidError } from '../src/deck/assets.mjs';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(CORE, 'vendor', 'mermaid');
const BUNDLE = path.join(VENDOR, 'mermaid.min.js');

/** Runs `fn` with the environment patched, and restores it afterwards. */
function withEnv(patch, fn) {
  const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, process.env[k]]));
  Object.assign(process.env, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k];
  resetBrowserCache();
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetBrowserCache();
  }
}

// ---------------------------------------------------------------------------
// the vendored bundle
// ---------------------------------------------------------------------------

test('the Mermaid bundle is vendored, and published with the package', () => {
  assert.ok(fs.existsSync(BUNDLE), 'vendor/mermaid/mermaid.min.js is missing: nothing can render');

  const pkg = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8'));
  // `files` bounds the tarball. Forgetting `vendor` breaks the PUBLISHED
  // package while leaving the repository perfectly green — the exact shape of
  // bug this whole file exists to catch.
  assert.ok(
    pkg.files.includes('vendor'),
    '`files` must carry vendor/: it holds the Mermaid bundle',
  );
  assert.ok(
    fs.existsSync(path.join(VENDOR, 'LICENSE')),
    'the MIT licence must travel with the copied code',
  );
});

test('the vendored bundle matches the SHA-256 recorded next to it', () => {
  // The README is the single place the version and digest are written down.
  // Reading it here is what makes a half-finished upgrade — file replaced,
  // documentation not — fail rather than ship.
  const readme = fs.readFileSync(path.join(VENDOR, 'README.md'), 'utf8');
  const recorded = /SHA-256 \| `([a-f0-9]{64})`/.exec(readme);
  assert.ok(recorded, 'vendor/mermaid/README.md must record the bundle SHA-256');

  const actual = crypto.createHash('sha256').update(fs.readFileSync(BUNDLE)).digest('hex');
  assert.equal(
    actual,
    recorded[1],
    'the bundle and its recorded digest disagree: finish the upgrade, or restore the file',
  );
});

test('the bundle is the standalone build, which is what a blank page can load', () => {
  // The child injects this file into an about:blank page with no module
  // loader and no network. An ESM build would parse and do nothing, and the
  // symptom would be "mermaid is not defined" inside a subprocess nobody reads.
  const head = fs.readFileSync(BUNDLE, 'utf8').slice(0, 4096);
  assert.ok(
    !/^\s*import[\s{]/m.test(head),
    'a bare ESM build cannot be injected with addScriptTag({path})',
  );
});

// ---------------------------------------------------------------------------
// finding a browser
// ---------------------------------------------------------------------------

test('LUTRIN_BROWSER wins over everything, and is taken at its word', () => {
  // Pointed at this very file: findBrowser checks existence, not executability
  // — deciding whether a path is a working browser is the renderer's job, and
  // an explicit setting must not be quietly ignored.
  withEnv({ LUTRIN_BROWSER: BUNDLE }, () => {
    const found = findBrowser();
    assert.equal(found?.path, BUNDLE);
    assert.equal(found?.source, 'LUTRIN_BROWSER');
  });
});

test('PUPPETEER_EXECUTABLE_PATH is honored, for the containers that already set it', () => {
  withEnv({ LUTRIN_BROWSER: undefined, PUPPETEER_EXECUTABLE_PATH: BUNDLE }, () => {
    assert.equal(findBrowser()?.source, 'PUPPETEER_EXECUTABLE_PATH');
  });
});

test('an explicit path that does not exist falls back to autodetection', () => {
  // It must not pin the lookup to a dead path: a stale variable in a shell
  // profile would otherwise disable Mermaid rendering entirely, and the
  // fallback caption would blame the absence of a browser.
  const missing = path.join(CORE, 'no', 'such', 'browser');
  withEnv({ LUTRIN_BROWSER: missing }, () => {
    const found = findBrowser();
    assert.notEqual(found?.path, missing, 'a non-existent path must not be selected');
  });
});

test('findBrowser answers with a path and its provenance, or null', () => {
  resetBrowserCache();
  const found = findBrowser();
  // The machine running the suite may genuinely have no browser (a minimal CI
  // image): both answers are correct, only their SHAPE is asserted, since the
  // CLI prints `source` back to the user.
  if (found === null) return;
  assert.ok(fs.existsSync(found.path), 'the reported browser must exist');
  assert.equal(typeof found.source, 'string');
  assert.ok(found.source.length > 0, 'the provenance is displayed by `lutrin setup-mermaid`');
});

test('the browser cache sits in the user cache, never inside the package', () => {
  // node_modules must stay disposable: a browser downloaded into the installed
  // package would vanish on the next npm ci, silently.
  const dir = browserCacheDir();
  assert.ok(!dir.startsWith(CORE), `the downloaded browser must not live in the package (${dir})`);
  assert.equal(path.basename(dir), 'browser');
});

test('LUTRIN_CACHE relocates the browser cache', () => {
  withEnv({ LUTRIN_CACHE: '/tmp/lutrin-test-cache' }, () => {
    assert.equal(browserCacheDir(), path.join('/tmp/lutrin-test-cache', 'browser'));
  });
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

test('the theme config keeps HTML labels off, in every dialect that has them', () => {
  // Guarded elsewhere too (html.test.mjs), and worth repeating here: with
  // htmlLabels on, mermaid emits <foreignObject>, the sanitizer strips it along
  // with its content, and the HTML shows mute rectangles while the .pptx is
  // correct. A divergence that reads as a rendering bug, not a config one.
  const cfg = mermaidConfig();
  assert.equal(cfg.htmlLabels, false);
  assert.equal(cfg.flowchart.htmlLabels, false);
  assert.equal(cfg.class.htmlLabels, false);
});

test('a diagram renders to SVG whose labels are real text', { timeout: 120_000 }, (t) => {
  resetBrowserCache();
  if (!findBrowser()) return t.skip('no browser on this machine');

  const file = renderMermaidCached('flowchart LR\n  A[Rédaction] --> B[Diffusion]', {
    format: 'svg',
  });
  assert.ok(file, `rendering failed: ${lastMermaidError()}`);

  const svg = fs.readFileSync(file, 'utf8');
  assert.ok(/^\s*<svg/i.test(svg), 'the produced file must be an SVG');
  assert.ok(!/<foreignobject/i.test(svg), 'foreignObject would be stripped by the sanitizer');
  // The whole point of rendering rather than falling back: the words are there,
  // as text the sanitizer lets through, accents intact.
  const text = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ''))
    .join(' ');
  assert.match(text, /Rédaction/, 'the node labels must survive as SVG text');
  assert.match(text, /Diffusion/);
});

test('a diagram renders to PNG for the .pptx', { timeout: 120_000 }, (t) => {
  resetBrowserCache();
  if (!findBrowser()) return t.skip('no browser on this machine');

  const file = renderMermaidCached('flowchart TD\n  A[Start] --> B[End]', { format: 'png' });
  assert.ok(file, `rendering failed: ${lastMermaidError()}`);
  const buf = fs.readFileSync(file);
  assert.deepEqual(
    [...buf.subarray(0, 4)],
    [0x89, 0x50, 0x4e, 0x47],
    'PowerPoint gets a PNG, not an SVG renamed',
  );
});

test('an invalid diagram returns null rather than throwing', { timeout: 120_000 }, (t) => {
  resetBrowserCache();
  if (!findBrowser()) return t.skip('no browser on this machine');

  // The caller's contract: a broken diagram costs a text fallback, never a
  // failed build. A deck with one bad diagram still compiles.
  const out = renderMermaidCached('flowchart LR\n  ZQBROKEN[[[[', { format: 'svg' });
  assert.equal(out, null);
  assert.ok(lastMermaidError(), 'the reason must be available for the CLI to report');
});

test(
  'rendering twice costs one render: the cache answers the second time',
  { timeout: 120_000 },
  (t) => {
    resetBrowserCache();
    if (!findBrowser()) return t.skip('no browser on this machine');

    const src = 'flowchart LR\n  Cache --> Hit';
    const first = renderMermaidCached(src, { format: 'svg' });
    assert.ok(first, `rendering failed: ${lastMermaidError()}`);

    // Not a timing assertion — a slow CI would make that flaky. Identity of the
    // returned path is what says the cache answered: rendering again would have
    // written the same content-addressed name, but going through the browser at
    // all is what the live preview cannot afford, and the memo is what prevents it.
    const started = Date.now();
    const second = renderMermaidCached(src, { format: 'svg' });
    assert.equal(second, first);
    assert.ok(Date.now() - started < 1000, 'a cache hit must not launch a browser');
  },
);
