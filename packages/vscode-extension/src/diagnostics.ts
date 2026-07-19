/** Publishing the compiler's diagnostics into the editor. */

import * as vscode from 'vscode';
import type { DeckDiagnostic } from './compilerClient';

const SEVERITY: Record<DeckDiagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export class DeckDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('lutrin');
  /** Structured diagnostics from the compiler, by document — the quick-fix
   *  finds there the `suggestion` that the displayed message carries only as
   *  text. */
  private readonly raw = new Map<string, DeckDiagnostic[]>();

  publish(doc: vscode.TextDocument, diags: DeckDiagnostic[]): void {
    this.raw.set(doc.uri.toString(), diags);
    this.collection.set(
      doc.uri,
      diags.map((d) => {
        const line = Math.max(0, Math.min(d.line - 1, doc.lineCount - 1));
        const range = doc.lineAt(line).range;
        // LAYOUT_SUGGESTION: the suggestion is a recommendation already
        // stated in the message, not the correction of a typo
        const message =
          d.suggestion && d.code !== 'LAYOUT_SUGGESTION'
            ? `${d.message} Did you mean "${d.suggestion}"?`
            : d.message;
        const diag = new vscode.Diagnostic(range, message, SEVERITY[d.severity]);
        diag.source = 'lutrin';
        diag.code = d.code;
        return diag;
      }),
    );
  }

  /** Structured diagnostic displayed at this line (0-based) with this code. */
  find(doc: vscode.TextDocument, zeroBasedLine: number, code: string): DeckDiagnostic | undefined {
    return this.raw
      .get(doc.uri.toString())
      ?.find(
        (d) =>
          d.code === code && Math.max(0, Math.min(d.line - 1, doc.lineCount - 1)) === zeroBasedLine,
      );
  }

  clear(uri: vscode.Uri): void {
    this.raw.delete(uri.toString());
    this.collection.delete(uri);
  }

  dispose(): void {
    this.raw.clear();
    this.collection.dispose();
  }
}
