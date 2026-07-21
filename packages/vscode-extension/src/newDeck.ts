/**
 * "Lutrin: New Presentation" — an untitled Markdown document pre-filled with a
 * small valid deck, marked as a deck for the session, preview opened at once.
 * The command exists for the first five minutes of use: the DSL is easier to
 * edit than to start, so we hand the user a deck that already compiles and
 * let them sculpt it with the preview beside the text.
 */

import * as vscode from 'vscode';
import { markAsDeck } from './deckDetector';
import { NEW_DECK_SAMPLE } from './newDeckSample';

export async function newDeck(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: NEW_DECK_SAMPLE,
  });
  markAsDeck(doc.uri);
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  // The preview command reads the active editor — the showTextDocument above
  // is awaited precisely so that this is the new document.
  await vscode.commands.executeCommand('lutrin.showPreview');
}
