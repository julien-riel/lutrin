/**
 * Quick-fix: the compiler's "did you mean" suggestions become one-click
 * actions in the editor — replace a faulty layout or preset name, apply a
 * structured layout suggested by the validator.
 */

import * as vscode from 'vscode';
import type { DeckDiagnostic } from './compilerClient';
import type { DeckDiagnostics } from './diagnostics';

/** A diagnostic that carries an actionable suggestion. The guard serves both as
 *  a filter and as proof for the type checker: without it, `actionFor` would
 *  have to assert with `!` an invariant the caller has already checked. */
type Suggested = DeckDiagnostic & { suggestion: string };
const hasSuggestion = (d: DeckDiagnostic | undefined): d is Suggested =>
  typeof d?.suggestion === 'string' && d.suggestion.length > 0;

export class DeckQuickFixes implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  };

  constructor(private readonly diagnostics: DeckDiagnostics) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    _range: vscode.Range,
    ctx: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of ctx.diagnostics) {
      if (diag.source !== 'lutrin') continue;
      const raw = this.diagnostics.find(doc, diag.range.start.line, String(diag.code ?? ''));
      if (!hasSuggestion(raw)) continue;
      const action = this.actionFor(doc, diag, raw);
      if (action) actions.push(action);
    }
    return actions;
  }

  private actionFor(
    doc: vscode.TextDocument,
    diag: vscode.Diagnostic,
    raw: Suggested,
  ): vscode.CodeAction | null {
    const line = doc.lineAt(diag.range.start.line);
    const replaceToken = (pattern: RegExp, title: string): vscode.CodeAction | null => {
      const m = line.text.match(pattern);
      if (!m || m.index == null) return null;
      const start = line.range.start.translate(0, m.index + m[1].length);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(start, start.translate(0, m[2].length)),
        raw.suggestion,
      );
      return this.action(title, edit, diag);
    };

    switch (raw.code) {
      // the capture stops BEFORE the closing "-->" (or end of line for the
      // frontmatter): without a space before -->, a greedy capture would
      // swallow the dashes and the replacement would destroy the comment — and
      // with it every bit of content up to the next "-->" on the re-parse
      case 'UNKNOWN_LAYOUT':
        return replaceToken(
          /(layout\s*:\s*)([\w-]+?)(?=\s*(?:-->|$))/,
          `Replace with "${raw.suggestion}"`,
        );
      case 'UNKNOWN_ANIMATE':
        return replaceToken(
          /(animate\s*:\s*)([^\s>-]+(?:-[^\s>-]+)*)/,
          `Replace with "${raw.suggestion}"`,
        );
      case 'UNKNOWN_DIRECTIVE':
        // the "```mermaid" suggestion changes the structure (fence ≠ directive):
        // only offer the replacement for a directive name
        if (raw.suggestion.startsWith('`')) return null;
        return replaceToken(/(:{3,}\s*)([A-Za-z][\w-]*)/, `Replace with "${raw.suggestion}"`);
      case 'LAYOUT_SUGGESTION': {
        // titled slide: insert the layout comment under the "#";
        // slide opened by "---": the line the diagnostic points at is already
        // content (often a "##") — insert BEFORE it, to open the slide
        const edit = new vscode.WorkspaceEdit();
        if (/^#\s/.test(line.text)) {
          edit.insert(doc.uri, line.range.end, `\n\n<!-- layout: ${raw.suggestion} -->`);
        } else {
          edit.insert(doc.uri, line.range.start, `<!-- layout: ${raw.suggestion} -->\n\n`);
        }
        return this.action(`Apply the "${raw.suggestion}" layout`, edit, diag);
      }
      default:
        return null;
    }
  }

  private action(
    title: string,
    edit: vscode.WorkspaceEdit,
    diag: vscode.Diagnostic,
  ): vscode.CodeAction {
    const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    a.edit = edit;
    a.diagnostics = [diag];
    a.isPreferred = true;
    return a;
  }
}
