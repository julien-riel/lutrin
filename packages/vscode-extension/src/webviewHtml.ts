/**
 * HTML shell of the preview webview — extracted from `previewPanel.ts` so it
 * can be tested without `vscode`.
 *
 * This file carries the ONLY barrier against the execution of script injected
 * into the preview: the Content-Security-Policy. The core HTML renderer emits
 * no script in fragment mode, updates go through `innerHTML` (which does not
 * execute `<script>` tags), and the CSP closes the rest:
 *   default-src 'none'  → nothing is allowed by default;
 *   script-src 'nonce-…' → only the extension's `media/preview.js`, carrying
 *                          this turn's nonce, runs;
 *   img-src / font-src data: → no leak to a remote host;
 *   style-src 'unsafe-inline' → the theme CSS is injected inline
 *                          (CSS, not script: no execution).
 * Any loosening here — a `script-src *`, an `'unsafe-inline'` on the script
 * side — reopens the preview to code execution coming from the compiled
 * document.
 */

import { randomBytes } from 'node:crypto';

/**
 * CSP nonce — 128 bits drawn from the CSPRNG, fresh for every shell.
 *
 * The product's ONLY nonce generator: the shell relies ENTIRELY on
 * `script-src 'nonce-…'`, so the generator lives here, with the doctrine it
 * serves. Never `Math.random()`: the internal state of V8's xorshift128+ can
 * be reconstructed from a handful of outputs, and a guessable nonce closes
 * nothing any more. `node:crypto` is already in play (updater.ts).
 */
export function nonce(): string {
  return randomBytes(16).toString('base64url');
}

/** Shell assigned ONCE to `webview.html`; after that, everything goes through
 *  postMessage (see PreviewPanel). */
export function webviewShell(scriptUri: string, n: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'nonce-${n}';">
<style id="fonts-css"></style>
<style id="deck-css"></style>
<style>
  .msg{font-family:sans-serif;opacity:.7;padding:16px}
  .error-bar{position:fixed;left:0;right:0;bottom:0;background:#8e1b13;color:#fff;
    font:12px/1.5 sans-serif;padding:6px 12px;display:none;z-index:10}
  .slide-frame.active{outline:2px solid #097d6c;outline-offset:2px}
</style>
</head>
<body>
<main class="deck" id="deck"><p class="msg">Compiling…</p></main>
<div class="error-bar" id="error-bar"></div>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}
