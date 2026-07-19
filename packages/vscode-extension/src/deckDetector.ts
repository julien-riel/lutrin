/**
 * A Markdown file "is a deck" (automatic features: diagnostics, cursor
 * tracking) if:
 *   1. its frontmatter contains `deck: true`; or
 *   2. its path matches the `lutrin.files` glob (default `**∕*.deck.md`); or
 *   3. the preview was opened manually for this document (session).
 * The preview command itself stays available on any Markdown — this only
 * avoids underlining READMEs with presentation diagnostics.
 */

import * as vscode from 'vscode';

const sessionDecks = new Set<string>();

export function markAsDeck(uri: vscode.Uri): void {
  sessionDecks.add(uri.toString());
}

export function isDeck(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'markdown') return false;
  if (sessionDecks.has(doc.uri.toString())) return true;

  const glob = vscode.workspace.getConfiguration('lutrin').get<string>('files', '**/*.deck.md');
  if (glob && vscode.languages.match({ language: 'markdown', pattern: glob }, doc) > 0) return true;

  // frontmatter `deck: true` (optional key, ignored by the compiler)
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 30), 0));
  const fm = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(fm && /^deck\s*:\s*true\s*$/m.test(fm[1]));
}
