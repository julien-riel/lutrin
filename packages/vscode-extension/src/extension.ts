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

    vscode.commands.registerCommand('lutrin.showPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showWarningMessage('Open a Markdown file to show the preview.');
        return;
      }
      markAsDeck(editor.document.uri);
      previews.show(editor.document);
    }),

    vscode.commands.registerCommand('lutrin.exportPptx', () => exportPptx(client)),

    vscode.commands.registerCommand('lutrin.checkForUpdates', () =>
      updater.check({ silent: false }),
    ),

    vscode.workspace.onDidChangeTextDocument((e) => {
      const panel = previews.get(e.document);
      if (panel) panel.scheduleRefresh();
      else if (isDeck(e.document)) validateSoon(e.document);
    }),

    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isDeck(doc)) validateSoon(doc, 0);
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
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
