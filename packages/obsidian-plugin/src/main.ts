/**
 * Obsidian plugin "Lutrin" — host for the lutrin compiler
 * (packages/core), same architecture as the VS Code extension:
 *
 *   Obsidian renderer (this file + preview.ts)
 *        │  IPC (compilerClient.ts)
 *        ▼
 *   Node worker (dist/core/src/worker/worker.mjs — a single one, it lives in the core)
 *        │  import
 *        ▼
 *   core (dist/core — symlink in dev, standalone copy in release)
 *
 * The plugin never compiles in the renderer: Mermaid (execFileSync, up to
 * 60 s) and resvg live in the worker. See scripts/package.mjs for how the
 * plugin directory is assembled.
 */

import {
  FileSystemAdapter,
  type MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from 'obsidian';
import * as path from 'node:path';
import { CompilerClient, type CompileResult, type ExportResult } from './compilerClient';
import { DeckPreviewView, FONT_STYLE_ID, VIEW_TYPE_DECK } from './preview';
import { translateWikiEmbedsForVault } from './wikilinks';

interface LutrinSettings {
  /** Delay (ms) between a keystroke and the preview being recompiled. */
  debounceMs: number;
  /** Open the produced file (PowerPoint, browser) after an export. */
  openAfterExport: boolean;
  /** Path to a Node binary to use for the worker (empty = detection). */
  nodePath: string;
  /** This editor's default kit for decks without a kit of their own (the name of
   *  a kit installed in ~/.config/lutrin/kits/, a kit directory, a .json file, or
   *  "none"). Empty = the kit shipped with the plugin, if there is one. */
  defaultKit: string;
}

const DEFAULT_SETTINGS: LutrinSettings = {
  debounceMs: 400,
  openAfterExport: true,
  nodePath: '',
  defaultKit: '',
};

export default class LutrinPlugin extends Plugin {
  settings: LutrinSettings = { ...DEFAULT_SETTINGS };
  client!: CompilerClient;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<LutrinSettings> & { defaultTheme?: string };
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // `defaultTheme` was the name of the setting before the rename to kits:
    // carrying it over keeps an update from silently dropping the vault back
    // onto the generic theme. Carried over once only — the next save writes
    // nothing but `defaultKit`.
    if (!this.settings.defaultKit && saved?.defaultTheme) {
      this.settings.defaultKit = saved.defaultTheme;
      await this.saveSettings();
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice('Lutrin: this plugin requires a local vault (desktop).');
      return;
    }
    const workerPath = path.join(
      adapter.getBasePath(),
      this.manifest.dir ?? '',
      'core',
      'src',
      'worker',
      'worker.mjs',
    );
    this.client = new CompilerClient(
      workerPath,
      () => this.settings.nodePath,
      () => this.settings.defaultKit,
    );

    this.registerView(VIEW_TYPE_DECK, (leaf) => new DeckPreviewView(leaf, this));

    this.addRibbonIcon('presentation', 'Show presentation preview', () => void this.openPreview());
    this.addCommand({
      id: 'show-preview',
      name: 'Show presentation preview',
      callback: () => void this.openPreview(),
    });
    this.addCommand({
      id: 'export-pptx',
      name: 'Export to PowerPoint (.pptx)',
      callback: () => void this.exportDeck('pptx'),
    });
    this.addCommand({
      id: 'export-html',
      name: 'Export to standalone HTML',
      callback: () => void this.exportDeck('html'),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        menu.addItem((item) =>
          item
            .setTitle('Export to PowerPoint (.pptx)')
            .setIcon('presentation')
            .onClick(() => void this.exportDeck('pptx', file)),
        );
      }),
    );

    this.addSettingTab(new LutrinSettingTab(this));
    // the @font-face rules injected into document.head by the preview
    this.register(() => document.getElementById(FONT_STYLE_ID)?.remove());
  }

  onunload(): void {
    this.client?.dispose();
  }

  // ------ paths and sources -------------------------------------------------

  /** Root of the vault. A trusted image root handed to the core: without it,
   *  the core would refuse to embed a local image outside the deck's own
   *  directory — which would rule out the attachments stored elsewhere in the
   *  vault. */
  vaultRoot(): string {
    return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
  }

  absPath(file: TFile): string {
    return path.join(this.vaultRoot(), file.path);
  }

  baseDirOf(file: TFile): string {
    return path.dirname(this.absPath(file));
  }

  /** Live content of the editor if the note is open, otherwise the disk. */
  private async sourceOf(file: TFile): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path === file.path) return view.editor.getValue();
    }
    return this.app.vault.cachedRead(file);
  }

  /** Source ready for the compiler: wiki embeds translated into Markdown. */
  private async dslOf(file: TFile): Promise<string> {
    return translateWikiEmbedsForVault(this.app, await this.sourceOf(file), file.path);
  }

  async compileFile(file: TFile): Promise<CompileResult> {
    return this.client.request<CompileResult>('compile', {
      source: await this.dslOf(file),
      baseDir: this.baseDirOf(file),
      imageRoots: [this.vaultRoot()],
    });
  }

  // ------ commands ------------------------------------------------------------

  private activeMdFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === 'md' ? file : null;
  }

  async openPreview(): Promise<void> {
    const file = this.activeMdFile();
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DECK)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('split', 'vertical');
      await leaf.setViewState({ type: VIEW_TYPE_DECK, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    // Obsidian ≥ 1.7 defers instantiating views: as long as the view is not
    // loaded, `leaf.view` is a DeferredView and a cast to DeckPreviewView
    // would throw. We force the load, then set the file only once the real
    // view is in place.
    // biome-ignore lint/suspicious/noExplicitAny: loadIfDeferred absent from obsidian's public types
    await (leaf as any).loadIfDeferred?.();
    if (leaf.view instanceof DeckPreviewView && file) leaf.view.setFile(file);
  }

  async exportDeck(kind: 'pptx' | 'html', target?: TFile): Promise<void> {
    const file = target ?? this.activeMdFile();
    if (!file) {
      new Notice('Lutrin: no active Markdown note.');
      return;
    }
    const outPath = `${this.absPath(file).replace(/\.deck\.md$|\.md$/i, '')}.${kind}`;
    const notice = new Notice(`Compiling "${file.basename}"…`, 0);
    try {
      const { stats } = await this.client.request<ExportResult>(
        kind === 'pptx' ? 'exportPptx' : 'exportHtml',
        {
          source: await this.dslOf(file),
          baseDir: this.baseDirOf(file),
          outPath,
          imageRoots: [this.vaultRoot()],
        },
      );
      // what the OOXML post-processing steps gave up on (animations, fonts):
      // the file is valid but incomplete — never silently
      const warnings = stats.warnings ?? [];
      const warnText = warnings.map((w) => `\n⚠ ${w}`).join('');
      const plural = stats.slideCount === 1 ? '' : 's';
      notice.setMessage(
        `✓ ${path.basename(outPath)} — ${stats.slideCount} slide${plural}${warnText}`,
      );
      setTimeout(() => notice.hide(), warnings.length ? 12000 : 6000);
      if (this.settings.openAfterExport) this.openInSystem(outPath);
    } catch (e) {
      notice.setMessage(`✖ Export failed: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => notice.hide(), 12000);
    }
  }

  /** Opens the produced file with the system application (PowerPoint, browser). */
  private openInSystem(filePath: string): void {
    try {
      // `window.require` only exists in the desktop Electron renderer: the
      // cast is the only way to reach it, and every link in the chain is
      // optional so that an Obsidian on mobile, or without Electron, simply
      // falls into the catch below.
      // biome-ignore lint/suspicious/noExplicitAny: access to the untyped Electron API
      (window as any).require?.('electron')?.shell?.openPath?.(filePath);
    } catch {
      // not blocking: the export succeeded, the file is there
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class LutrinSettingTab extends PluginSettingTab {
  constructor(private readonly pluginRef: LutrinPlugin) {
    super(pluginRef.app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Recompile delay')
      .setDesc('Milliseconds between a keystroke and the preview being updated.')
      .addSlider((slider) =>
        slider
          .setLimits(100, 2000, 100)
          .setValue(this.pluginRef.settings.debounceMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.pluginRef.settings.debounceMs = v;
            await this.pluginRef.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Node path (optional)')
      .setDesc(
        'Node.js binary used for the compiler (version 18 or later — an older ' +
          'binary is rejected). Empty = automatic detection (Homebrew, /usr/local, ' +
          'PATH, nvm), with a fallback on Obsidian in Node mode. ' +
          'Applied the next time the compiler starts.',
      )
      .addText((text) =>
        text
          .setPlaceholder('/opt/homebrew/bin/node')
          .setValue(this.pluginRef.settings.nodePath)
          .onChange(async (v) => {
            this.pluginRef.settings.nodePath = v;
            await this.pluginRef.saveSettings();
            this.pluginRef.client.restart();
          }),
      );

    new Setting(containerEl)
      .setName('Open after export')
      .setDesc('Open the .pptx (PowerPoint / Keynote) or the .html (browser) once produced.')
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.openAfterExport).onChange(async (v) => {
          this.pluginRef.settings.openAfterExport = v;
          await this.pluginRef.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Default kit')
      .setDesc(
        'Kit applied to notes without a kit of their own: the name of a kit installed in ' +
          '~/.config/lutrin/kits/, the path of a kit directory, the path of a .json file, ' +
          'or "none" for the generic theme. Empty = the kit shipped with the plugin, if there ' +
          'is one. The note always wins: frontmatter "kit:", project default ' +
          '(package.json) and user default (lutrin config, shared across tools) take ' +
          'precedence over this setting. Taken into account at the next compilation.',
      )
      .addText((text) =>
        text
          .setPlaceholder('my-kit')
          .setValue(this.pluginRef.settings.defaultKit)
          .onChange(async (v) => {
            this.pluginRef.settings.defaultKit = v.trim();
            await this.pluginRef.saveSettings();
          }),
      );
  }
}
