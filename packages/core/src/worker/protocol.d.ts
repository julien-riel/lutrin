/**
 * IPC protocol of the compilation worker (worker.mjs) — the single source of
 * truth for the types exchanged between the worker and its hosts (VS Code
 * extension, Obsidian plugin). A pure type file: no code emitted.
 */

export interface DeckDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line: number;
  suggestion?: string;
}

/** Render stats; `warnings`: what the OOXML post-processing (animations/fonts)
 *  and the theme (file could not be read, insufficient contrast…) gave up on,
 *  never silently. */
export interface RenderStats {
  slideCount: number;
  fontsEmbedded: number;
  animatedSlides: number;
  /** "(cont.)" slides that received the Morph transition (PPTX). */
  morphSlides?: number;
  warnings?: string[];
  [k: string]: number | string[] | undefined;
}

/** Result of `compile`: HTML fragments for the webview + diagnostics. */
export interface CompileResult {
  slides: string[];
  css: string;
  fontsCss: string;
  stats: RenderStats;
  slideMap: { slide: number; startLine: number }[];
  animSteps: (number | null)[];
  diagnostics: DeckDiagnostic[];
}

/** Result of `exportPptx` / `exportHtml`. */
export interface ExportResult {
  stats: RenderStats;
  outPath: string;
}

/** Result of `validate`. */
export interface ValidateResult {
  diagnostics: DeckDiagnostic[];
}

export interface WorkerRequest {
  id: number;
  cmd: 'compile' | 'validate' | 'exportPptx' | 'exportHtml';
  /** `themePath` (optional): kit imposed by the host, absolute — OVERRIDES the
   *  frontmatter `kit:` key, which is resolved relative to `baseDir` (the theme
   *  file travels with the deck, not with the extension). `defaultTheme`
   *  (optional): the host's LAST-RESORT kit — the name of an installed kit, or
   *  the ABSOLUTE PATH of a kit directory bundled by the extension
   *  (`<dist>/kits/<name>`, chosen by the compilerClients' fallbackKit: the
   *  first kit bundled by the build, no hard-coded name) —
   *  applied only if neither the frontmatter, nor the project default, nor the
   *  user default names a kit; `kit: none` in the deck disables it. */
  payload: {
    source: string;
    baseDir?: string;
    outPath?: string;
    themePath?: string;
    defaultTheme?: string;
    /** Additional roots (beyond the deck's directory) a LOCAL image may be
     *  embedded from — containment against arbitrary file reads (assets.mjs).
     *  Absent/empty ⇒ the deck's directory only. VS Code: the workspace
     *  directory; Obsidian: the vault root. */
    imageRoots?: string[];
  };
}

export type WorkerResponse =
  /** Requests are serialized inside the worker; `started` is emitted when the
   *  request ENTERS execution — the client rearms its guard timeout there
   *  (time spent queued does not count towards the timeout). */
  | { id: number; started: true }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };
