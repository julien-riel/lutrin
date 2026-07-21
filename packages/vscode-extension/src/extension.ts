/**
 * Entry point of the "Lutrin" extension.
 *
 * Architecture: the extension host never compiles — a dedicated Node worker
 * (dist/core/src/worker/worker.mjs, a single one, living in the core; see
 * compilerClient.ts) does all the work. Here: commands, listeners,
 * panels, diagnostics.
 */

import * as vscode from 'vscode';
import { CompilerClient, type CompileResult } from './compilerClient';
import { DeckDiagnostics } from './diagnostics';
import { DeckQuickFixes } from './quickfix';
import { isDeck, markAsDeck } from './deckDetector';
import { imageRootsFor } from './imageRoots';
import { newDeck } from './newDeck';
import { PreviewManager } from './previewPanel';
import { exportPptx } from './exportPptx';
import { Updater } from './updater';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Lutrin');
  const client = new CompilerClient(
    context.asAbsolutePath('dist/core/src/worker/worker.mjs'),
    log,
    // `lutrin.defaultKit` is the current setting; `mtlDeck.defaultTheme` the
    // one from before the rename. Reading it as a fallback keeps an update
    // from silently dropping the editor back to the generic theme — VS Code
    // keeps the settings of the old identifier in settings.json.
    () =>
      vscode.workspace.getConfiguration('lutrin').get<string>('defaultKit', '') ||
      vscode.workspace.getConfiguration('mtlDeck').get<string>('defaultTheme', ''),
  );
  const diagnostics = new DeckDiagnostics();
  const previews = new PreviewManager(context, client, diagnostics);
  const updater = new Updater(context, log);
  context.subscriptions.push(log, client, diagnostics, previews, updater);
  updater.start();

  // Untitled deck whose preview panel is waiting to be re-keyed onto the
  // file: document its save is about to open (see onDidCloseTextDocument).
  // The text match is the pairing proof; the timestamp only stops a stale
  // stash from claiming an unrelated file opened much later.
  let savedUntitled: { key: string; text: string; at: number } | null = null;
  const followUntitledSave = (doc: vscode.TextDocument): void => {
    if (
      savedUntitled &&
      doc.uri.scheme === 'file' &&
      doc.languageId === 'markdown' &&
      Date.now() - savedUntitled.at < 5000 &&
      doc.getText() === savedUntitled.text
    ) {
      previews.rekey(savedUntitled.key, doc);
      markAsDeck(doc.uri);
      savedUntitled = null;
    }
  };

  // "Cold" diagnostics (with no preview open) for files detected as decks:
  // validation alone in the worker, with no HTML rendering.
  const validateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const validateSoon = (doc: vscode.TextDocument, delay = 500): void => {
    const key = doc.uri.toString();
    clearTimeout(validateTimers.get(key));
    validateTimers.set(
      key,
      setTimeout(() => {
        validateTimers.delete(key);
        client
          .request<Pick<CompileResult, 'diagnostics'>>('validate', {
            source: doc.getText(),
            baseDir:
              doc.uri.scheme === 'file' ? vscode.Uri.joinPath(doc.uri, '..').fsPath : undefined,
            imageRoots: imageRootsFor(doc),
          })
          .then((r) => {
            if (doc.isClosed) return; // closed during validation: no ghost diagnostic
            diagnostics.publish(doc, r.diagnostics);
          })
          .catch((e) => log.appendLine(`validation: ${e.message}`));
      }, delay),
    );
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      'markdown',
      new DeckQuickFixes(diagnostics),
      DeckQuickFixes.metadata,
    ),

    // Context menus (Explorer, editor tab) pass the CLICKED resource's URI —
    // which need not be the active editor, right-clicking focuses nothing.
    // The palette and keybinding pass no argument: the active editor it is.
    vscode.commands.registerCommand('lutrin.showPreview', async (uri?: vscode.Uri) => {
      const doc = uri
        ? await vscode.workspace.openTextDocument(uri)
        : vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        void vscode.window.showWarningMessage('Open a Markdown file to show the preview.');
        return;
      }
      markAsDeck(doc.uri);
      previews.show(doc);
    }),

    vscode.commands.registerCommand('lutrin.newDeck', () => newDeck()),

    vscode.commands.registerCommand('lutrin.exportPptx', (uri?: vscode.Uri) =>
      exportPptx(client, uri),
    ),

    vscode.commands.registerCommand('lutrin.checkForUpdates', () =>
      updater.check({ silent: false }),
    ),

    vscode.workspace.onDidChangeTextDocument((e) => {
      const panel = previews.get(e.document);
      if (panel) panel.scheduleRefresh();
      else if (isDeck(e.document)) validateSoon(e.document);
    }),

    vscode.workspace.onDidOpenTextDocument((doc) => {
      followUntitledSave(doc);
      if (isDeck(doc)) validateSoon(doc, 0);
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      // Saving an untitled document (the "New Presentation" flow) does not
      // save it in place: VS Code closes it and opens the SAME text under a
      // file: URI. A preview panel keyed to the untitled URI would survive,
      // apparently healthy, and silently never refresh again. The
      // open/close order is not contractual, so both handlers look for the
      // counterpart: here an already-open twin, otherwise a stash the open
      // handler above consumes.
      if (doc.isUntitled && previews.get(doc)) {
        const twin = vscode.workspace.textDocuments.find(
          (d) =>
            d.uri.scheme === 'file' && d.languageId === 'markdown' && d.getText() === doc.getText(),
        );
        if (twin) {
          previews.rekey(doc.uri.toString(), twin);
          markAsDeck(twin.uri);
        } else {
          savedUntitled = { key: doc.uri.toString(), text: doc.getText(), at: Date.now() };
        }
      }
      // cancel the pending validation: without this, its timer would publish
      // ghost diagnostics for a file that is already closed
      const key = doc.uri.toString();
      clearTimeout(validateTimers.get(key));
      validateTimers.delete(key);
      diagnostics.clear(doc.uri);
    }),

    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.languageId !== 'markdown') return;
      const panel = previews.get(e.textEditor.document);
      panel?.revealForLine(e.selections[0].active.line + 1);
    }),
  );

  // Deck files already open at activation
  for (const doc of vscode.workspace.textDocuments) {
    if (isDeck(doc)) validateSoon(doc, 0);
  }
}

export function deactivate(): void {}
