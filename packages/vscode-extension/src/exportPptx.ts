/** "Export to PowerPoint" command: compiles a document into a .pptx. */

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CompilerClient, ExportResult } from './compilerClient';
import { imageRootsFor } from './imageRoots';

/**
 * `uri` is what VS Code passes when the command comes from a context menu
 * (Explorer right-click, editor tab): the CLICKED resource, which need not be
 * the active editor — right-clicking neither opens nor focuses the file. The
 * palette and keybinding pass nothing: then, and only then, the active editor
 * is the document meant.
 */
export async function exportPptx(client: CompilerClient, uri?: vscode.Uri): Promise<void> {
  const doc = uri
    ? await vscode.workspace.openTextDocument(uri)
    : vscode.window.activeTextEditor?.document;
  if (!doc || doc.languageId !== 'markdown') {
    void vscode.window.showWarningMessage('Open a presentation Markdown file before exporting.');
    return;
  }
  if (doc.isUntitled) {
    void vscode.window.showWarningMessage(
      'Save the file before exporting (the .pptx is written next to the .md).',
    );
    return;
  }
  if (doc.isDirty) await doc.save();

  // aligned with Obsidian: `talk.deck.md` → `talk.pptx` (not `talk.deck.pptx`)
  const outPath = `${doc.uri.fsPath.replace(/\.deck\.md$|\.md$/i, '')}.pptx`;
  try {
    const { stats } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'PowerPoint export…' },
      () =>
        client.request<ExportResult>('exportPptx', {
          source: doc.getText(),
          baseDir: path.dirname(doc.uri.fsPath),
          outPath,
          imageRoots: imageRootsFor(doc),
        }),
    );
    // what the OOXML post-processing steps gave up on (animations, fonts):
    // the .pptx is valid but incomplete — never silent
    for (const w of stats.warnings ?? []) {
      void vscode.window.showWarningMessage(`PowerPoint export: ${w}`);
    }
    const OPEN = 'Open';
    const REVEAL = 'Reveal file';
    const choice = await vscode.window.showInformationMessage(
      `Exported: ${path.basename(outPath)}`,
      OPEN,
      REVEAL,
    );
    if (choice === OPEN) void vscode.env.openExternal(vscode.Uri.file(outPath));
    else if (choice === REVEAL)
      void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outPath));
  } catch (e) {
    void vscode.window.showErrorMessage(`Export failed: ${(e as Error).message}`);
  }
}
