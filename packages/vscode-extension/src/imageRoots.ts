/**
 * Trusted image roots for containment on the worker side.
 *
 * The core refuses to embed a local image whose path leaves the deck's
 * directory, EXCEPT under one of the extra roots the host supplies. For VS
 * Code, that root is the workspace directory that contains the document: this
 * allows a project's images to be kept somewhere other than the file's own
 * directory. Outside a workspace (an isolated file), the list is empty and only
 * the deck's directory remains admissible.
 */

import * as vscode from 'vscode';

export function imageRootsFor(doc: vscode.TextDocument): string[] {
  const directory = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  return directory ? [directory] : [];
}
