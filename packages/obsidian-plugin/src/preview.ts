/**
 * Preview view — the Obsidian equivalent of the VS Code webview.
 *
 * The slides (standalone HTML fragments from compileHtml's `fragment` mode)
 * are injected into a **shadow DOM**: the deck's CSS (the `*` reset,
 * `.slide`, `.metric`…) never reaches Obsidian's interface, and
 * conversely. One exception: the `@font-face` rules (base64 woff2) must
 * live in `document.head` — Chrome ignores @font-face declared inside
 * a shadow root; family names, for their part, resolve everywhere.
 *
 * Behaviour:
 *   - follows the active Markdown note; recompiles on keystroke (debounced) on
 *     the editor's **live** content, not the file on disk;
 *   - diagnostics in a banner above the slides, click → source line;
 *   - click on a slide → source line (animated slide: the click reveals
 *     the next step, as in the HTML export);
 *   - scaling of the 1280 × 720 slides as the panel is resized.
 */

import { ItemView, type MarkdownView, type TFile, type WorkspaceLeaf } from 'obsidian';
import type LutrinPlugin from './main';
import type { CompileResult, DeckDiagnostic } from './compilerClient';

export const VIEW_TYPE_DECK = 'lutrin-preview';
export const FONT_STYLE_ID = 'lutrin-fonts';

const PAGE_W = 1280;
const PAGE_H = 720;

/** Extra styling, on the shadow side: gentle blending into the Obsidian theme. */
const SUPPLEMENT_CSS = `
:host{display:block}
body{background:transparent}
.deck{background:transparent;padding:16px}
.notes{color:var(--text-muted)}
.slide-frame:not([data-anim-steps]){cursor:pointer}
`;

const SEVERITY_ICON: Record<DeckDiagnostic['severity'], string> = {
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
};

export class DeckPreviewView extends ItemView {
  private plugin: LutrinPlugin;
  private file: TFile | null = null;
  private shadow!: ShadowRoot;
  private styleEl!: HTMLStyleElement;
  private deckEl!: HTMLElement;
  private diagEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private observer: ResizeObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private compiling = false;
  private queued = false;

  constructor(leaf: WorkspaceLeaf, plugin: LutrinPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DECK;
  }

  getDisplayText(): string {
    return this.file ? `Preview: ${this.file.basename}` : 'Show presentation preview';
  }

  getIcon(): string {
    return 'presentation';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('lutrin-view');

    this.diagEl = root.createDiv({ cls: 'lutrin-diagnostics' });
    this.emptyEl = root.createDiv({
      cls: 'lutrin-empty',
      text: 'Open a Markdown note to see the presentation.',
    });
    const host = root.createDiv({ cls: 'lutrin-host' });
    this.shadow = host.attachShadow({ mode: 'open' });
    this.styleEl = document.createElement('style');
    this.shadow.appendChild(this.styleEl);
    this.deckEl = document.createElement('main');
    this.deckEl.className = 'deck';
    this.shadow.appendChild(this.deckEl);

    // recompile on keystroke (the editor's live content)
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, info) => {
        if (info.file && this.file && info.file.path === this.file.path) this.schedule();
      }),
    );
    // follow the active Markdown note
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (f && f.extension === 'md' && f.path !== this.file?.path) this.setFile(f);
      }),
    );
    // changes made outside the editor (sync, external script)
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f.path === this.file?.path) this.schedule();
      }),
    );

    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(host);

    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === 'md') this.setFile(active);
  }

  async onClose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.observer?.disconnect();
    this.observer = null;
  }

  setFile(file: TFile): void {
    this.file = file;
    // `updateHeader` exists on WorkspaceLeaf but is absent from obsidian's
    // public types — hence the cast, and the optional call should it disappear.
    // biome-ignore lint/suspicious/noExplicitAny: untyped Obsidian API
    (this.leaf as any).updateHeader?.();
    this.schedule(0);
  }

  private schedule(delay = this.plugin.settings.debounceMs): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.compileNow(), delay);
  }

  private async compileNow(): Promise<void> {
    if (!this.file) return;
    if (this.compiling) {
      this.queued = true;
      return;
    }
    this.compiling = true;
    try {
      const result = await this.plugin.compileFile(this.file);
      this.render(result);
    } catch (e) {
      this.renderError(e instanceof Error ? e.message : String(e));
    } finally {
      this.compiling = false;
      if (this.queued) {
        this.queued = false;
        this.schedule(0);
      }
    }
  }

  // ------ render -------------------------------------------------------------

  private render(result: CompileResult): void {
    // fonts: upsert into document.head — a THEMED deck changes the
    // @font-face rules mid-session; the string comparison avoids
    // re-parsing ~300 kB of base64 woff2 on every keystroke (the original intent)
    let fonts = document.getElementById(FONT_STYLE_ID) as HTMLStyleElement | null;
    if (!fonts) {
      fonts = document.createElement('style');
      fonts.id = FONT_STYLE_ID;
      document.head.appendChild(fonts);
    }
    if (fonts.textContent !== result.fontsCss) fonts.textContent = result.fontsCss;
    this.emptyEl.hide();
    this.styleEl.textContent = result.css + SUPPLEMENT_CSS;
    this.deckEl.innerHTML = result.slides.join('\n');
    this.wireSlides(result);
    this.fit();
    this.renderDiagnostics(result.diagnostics);
  }

  private renderError(message: string): void {
    this.diagEl.empty();
    this.diagEl.show();
    const row = this.diagEl.createDiv({ cls: 'lutrin-diag lutrin-diag-error' });
    row.createSpan({ text: `${SEVERITY_ICON.error} ${message}` });
  }

  private renderDiagnostics(diagnostics: DeckDiagnostic[]): void {
    this.diagEl.empty();
    if (!diagnostics.length) {
      this.diagEl.hide();
      return;
    }
    this.diagEl.show();
    for (const d of diagnostics) {
      const row = this.diagEl.createDiv({ cls: `lutrin-diag lutrin-diag-${d.severity}` });
      row.createSpan({ cls: 'lutrin-diag-line', text: `${SEVERITY_ICON[d.severity]} ${d.line}` });
      row.createSpan({ text: d.message + (d.suggestion ? ` (suggestion: ${d.suggestion})` : '') });
      row.addEventListener('click', () => this.jumpToLine(d.line));
    }
  }

  /** Fits each 1280 × 720 slide to the width of the panel. */
  private fit(): void {
    for (const frame of Array.from(this.shadow.querySelectorAll<HTMLElement>('.slide-frame'))) {
      const s = frame.clientWidth / PAGE_W;
      if (!s) continue;
      frame.style.height = `${PAGE_H * s}px`;
      const slide = frame.firstElementChild as HTMLElement | null;
      if (slide) slide.style.transform = `scale(${s})`;
    }
  }

  /** Click → source line; animated slides → step-by-step reveal. */
  private wireSlides(result: CompileResult): void {
    const frames = Array.from(this.shadow.querySelectorAll<HTMLElement>('.slide-frame'));
    for (const frame of frames) {
      const num = Number(frame.getAttribute('data-slide'));
      const startLine = result.slideMap[num - 1]?.startLine ?? 1;
      const total = Number(frame.getAttribute('data-anim-steps') || 0);
      if (!total) {
        frame.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('a')) return;
          this.jumpToLine(startLine);
        });
        continue;
      }
      // same behaviour as the HTML export: one click = one step
      const els = Array.from(frame.querySelectorAll<HTMLElement>('[data-step]'));
      let shown = 0;
      const badge = document.createElement('div');
      badge.className = 'anim-count';
      frame.appendChild(badge);
      const update = () => {
        badge.textContent = `${shown} / ${total}`;
        for (const el of els)
          el.classList.toggle('step-shown', Number(el.getAttribute('data-step')) < shown);
      };
      frame.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        shown = shown < total ? shown + 1 : 0;
        update();
      });
      update();
    }
  }

  private jumpToLine(line: number): void {
    if (!this.file) return;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path === this.file.path) {
        this.app.workspace.revealLeaf(leaf);
        const pos = { line: Math.max(0, line - 1), ch: 0 };
        view.editor.setCursor(pos);
        view.editor.scrollIntoView({ from: pos, to: pos }, true);
        return;
      }
    }
  }
}
