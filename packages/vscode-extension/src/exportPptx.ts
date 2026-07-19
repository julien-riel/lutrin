/** "Export to PowerPoint" command: compiles the active document into a .pptx. */

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CompilerClient, ExportResult } from './compilerClient';
import { imageRootsFor } from './imageRoots';

export async function exportPptx(client: CompilerClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showWarningMessage('Open a presentation Markdown file before exporting.');
    return;
  }
  const doc = editor.document;
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
