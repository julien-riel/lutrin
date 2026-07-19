/**
 * The webview's CSP is the only barrier between the compiled content and
 * script execution in the preview. These tests state it directive by
 * directive rather than comparing the shell against a golden: a golden would
 * say "the HTML changed", not "the barrier fell".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { nonce, webviewShell } from '../src/webviewHtml.ts';

/** Content of the content= attribute of the CSP tag. */
function csp(html: string): string {
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  assert.ok(m, 'no Content-Security-Policy tag in the shell');
  return m[1];
}

/** Value of a given CSP directive. */
function directive(html: string, name: string): string {
  const found = csp(html)
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));
  assert.ok(found, `missing directive: ${name}`);
  return found.slice(name.length + 1).trim();
}

describe('webview — nonce', () => {
  /** 300 draws: enough for every reachable symbol to be seen (the coupon
   *  collector asks for ~270 for 64 symbols). */
  const draws = Array.from({ length: 300 }, () => nonce());

  it('produces a different nonce on every call — a fixed nonce protects nothing', () => {
    assert.equal(new Set(draws).size, draws.length);
  });

  it('carries at least 128 bits of entropy — a guessable nonce closes nothing', () => {
    // We do not pin the alphabet (pinning it catches nothing: `Math.random()`
    // over [a-z0-9] would respect it). We measure what the delivered nonce can
    // be worth at best: log2(observed symbols) × length. Below that threshold
    // the nonce can be enumerated, and `script-src 'nonce-…'` stops being a
    // barrier.
    const symbols = new Set(draws.join(''));
    const length = Math.min(...draws.map((n) => n.length));
    const bits = Math.log2(symbols.size) * length;
    assert.ok(
      bits >= 128,
      `nonce of ${length} chars over ${symbols.size} symbols = ${bits.toFixed(1)} bits < 128`,
    );
  });

  it('only emits characters that are safe in an HTML attribute and a CSP directive', () => {
    // A nonce containing `"`, `'`, `;` or `<` would escape the `nonce="…"`
    // attribute or the directive: injection through the nonce itself.
    // base64url ([A-Za-z0-9_-]) is closed on that point.
    for (const n of draws) assert.match(n, /^[A-Za-z0-9_-]+$/);
  });

  it('draws from a cryptographic source — the measured entropy cannot see it', () => {
    // The three tests above measure the RESULT: uniqueness, theoretical
    // maximum entropy, alphabet. None of them attests the SOURCE, and that is
    // structural — a `Math.random()` drawing 22 characters from the base64url
    // alphabet would satisfy all three while being entirely predictable (the
    // state of xorshift128+ can be reconstructed from a handful of outputs).
    // Only reading the code closes that gap, so the docblock of
    // webviewHtml.ts raises "never Math.random()" into a rule: this test enforces it.
    const src = readFileSync(new URL('../src/webviewHtml.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /Math\.random\s*\(/, 'the nonce must come from node:crypto');
    assert.match(code, /randomBytes\s*\(/);
  });
});

describe('webview — Content-Security-Policy', () => {
  const html = webviewShell('vscode-webview://abc/media/preview.js', 'nonce123');

  it('forbids everything by default (default-src none)', () => {
    assert.equal(directive(html, 'default-src'), "'none'");
  });

  it('only allows script under the nonce of this turn', () => {
    assert.equal(directive(html, 'script-src'), "'nonce-nonce123'");
  });

  it('carries no wildcard and no remote source — no *, no http(s):, no blob:', () => {
    const c = csp(html);
    assert.doesNotMatch(c, /\*/, 'a wildcard in the CSP opens the preview to an arbitrary source');
    assert.doesNotMatch(c, /https?:/, 'no network source may be allowed');
    assert.doesNotMatch(c, /blob:/);
  });

  it('never allows unsafe-inline or unsafe-eval on the script side', () => {
    const s = directive(html, 'script-src');
    assert.doesNotMatch(s, /unsafe-inline/);
    assert.doesNotMatch(s, /unsafe-eval/);
  });

  it('limits images and fonts to inline data — no leak to a host', () => {
    assert.equal(directive(html, 'img-src'), 'data:');
    assert.equal(directive(html, 'font-src'), 'data:');
  });

  it('carries the nonce on the only script tag of the shell', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    assert.equal(scripts.length, 1);
    assert.match(scripts[0], /nonce="nonce123"/);
  });

  it('the tag nonce is the CSP one — otherwise the script does not load', () => {
    // With the nonce ACTUALLY delivered, and without presuming its alphabet:
    // what counts is that the two coincide, and too narrow a pattern would
    // make a disagreement look like an absence.
    const n = nonce();
    const real = webviewShell('media/preview.js', n);
    const inCsp = directive(real, 'script-src').match(/^'nonce-(.+)'$/);
    const onTag = real.match(/<script[^>]*\bnonce="([^"]*)"/);
    assert.ok(inCsp, 'script-src carries no nonce');
    assert.ok(onTag, 'the script tag carries no nonce');
    assert.equal(inCsp[1], onTag[1]);
    assert.equal(inCsp[1], n, 'the published nonce is not the one asked of the shell');
  });

  it('loads the script from the URI supplied by the host, never inline', () => {
    assert.match(html, /<script[^>]*src="vscode-webview:\/\/abc\/media\/preview\.js"><\/script>/);
  });
});
