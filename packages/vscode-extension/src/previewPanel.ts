/**
 * Preview panel: one webview per document.
 *
 * The HTML shell (CSP, container, script) is assigned only ONCE; updates go
 * through postMessage — the `media/preview.js` script replaces only the
 * slides whose HTML has changed, preserves the scroll position and the state
 * of the animations, and handles scaling (the core HTML renderer emits no
 * script in fragment mode: innerHTML would not execute them, and the CSP
 * only allows the script under nonce).
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CompilerClient, CompileResult } from './compilerClient';
import type { DeckDiagnostics } from './diagnostics';
import { imageRootsFor } from './imageRoots';
import { nonce, webviewShell } from './webviewHtml';

function baseDirOf(doc: vscode.TextDocument): string {
  if (doc.uri.scheme === 'file') return path.dirname(doc.uri.fsPath);
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}

export class PreviewManager implements vscode.Disposable {
  private readonly panels = new Map<string, PreviewPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: CompilerClient,
    private readonly diagnostics: DeckDiagnostics,
  ) {}

  show(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = new PreviewPanel(this.context, this.client, this.diagnostics, doc, () =>
      this.panels.delete(key),
    );
    this.panels.set(key, panel);
  }

  get(doc: vscode.TextDocument): PreviewPanel | undefined {
    return this.panels.get(doc.uri.toString());
  }

  dispose(): void {
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
  }
}

export class PreviewPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  /** Stable key of the document (URI): the only reliable link to it. Closing
   *  then reopening the file creates a NEW TextDocument object — capturing the
   *  constructor's own would recompile a dead, frozen document. So the live
   *  document is looked up by this key on every compilation (see liveDoc). */
  private readonly key: string;
  private slideMap: { slide: number; startLine: number }[] = [];
  private currentSlide = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private compiling = false;
  private queued = false;
  /** True as soon as the panel is closed: refresh() may be in flight on an
   *  await; without this flag, the next postMessage would hit a disposed
   *  webview (an exception in the try AND in the catch → unhandled rejection). */
  private disposed = false;

  constructor(
    context: vscode.ExtensionContext,
    private readonly client: CompilerClient,
    private readonly diagnostics: DeckDiagnostics,
    doc: vscode.TextDocument,
    private readonly onDispose: () => void,
  ) {
    this.key = doc.uri.toString();
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel(
      'lutrinPreview',
      `Preview — ${path.basename(doc.uri.path)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot] },
    );
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'preview.js'));
    const n = nonce();
    this.panel.webview.html = webviewShell(String(scriptUri), n);

    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.onDispose();
    });
    this.panel.webview.onDidReceiveMessage((msg: { type: string; slide?: number }) => {
      if (msg.type === 'slideClicked' && msg.slide) this.revealSource(msg.slide);
    });

    void this.refresh();
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  /** Debounced recompilation (typing in the editor). */
  scheduleRefresh(): void {
    const delay = vscode.workspace.getConfiguration('lutrin').get<number>('debounceMs', 300);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.refresh(), delay);
  }

  /** The LIVE document for this key, or `undefined` if it is closed. */
  private liveDoc(): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.key);
  }

  /** At most one compilation in flight; a keystroke during a compilation
   *  requeues exactly one (latest-wins — the worker serializes anyway). */
  private async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.compiling) {
      this.queued = true;
      return;
    }
    const doc = this.liveDoc();
    if (!doc) return; // document closed: nothing to recompile
    this.compiling = true;
    try {
      const result = await this.client.request<CompileResult>('compile', {
        source: doc.getText(),
        baseDir: baseDirOf(doc),
        imageRoots: imageRootsFor(doc),
      });
      if (this.disposed) return; // panel closed during the compilation
      this.slideMap = result.slideMap;
      this.diagnostics.publish(doc, result.diagnostics);
      void this.panel.webview.postMessage({
        type: 'update',
        slides: result.slides,
        animSteps: result.animSteps,
        css: result.css,
        fontsCss: result.fontsCss,
      });
    } catch (e) {
      if (this.disposed) return;
      // the webview may have been disposed between the await and here: the
      // postMessage would then throw on the `webview` getter — swallow it,
      // there is no longer anyone to report the error to
      try {
        void this.panel.webview.postMessage({ type: 'error', message: (e as Error).message });
      } catch {
        /* webview disposed: nothing to do */
      }
    } finally {
      this.compiling = false;
      if (!this.disposed && this.queued) {
        this.queued = false;
        void this.refresh();
      }
    }
  }

  /** Editor cursor → matching slide in the preview. */
  revealForLine(line1: number): void {
    if (!this.slideMap.length) return;
    let lo = 0;
    let hi = this.slideMap.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.slideMap[mid].startLine <= line1) lo = mid;
      else hi = mid - 1;
    }
    const slide = this.slideMap[lo].slide;
    if (slide !== this.currentSlide) {
      this.currentSlide = slide;
      void this.panel.webview.postMessage({ type: 'reveal', slide });
    }
  }

  /** (Double) click on a slide → source line in the editor. */
  private revealSource(slide: number): void {
    const entry = this.slideMap.find((s) => s.slide === slide);
    if (!entry) return;
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.key,
    );
    if (!editor) return;
    const pos = new vscode.Position(Math.max(0, entry.startLine - 1), 0);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    editor.selection = new vscode.Selection(pos, pos);
  }

  dispose(): void {
    this.disposed = true;
    this.panel.dispose();
  }
}
