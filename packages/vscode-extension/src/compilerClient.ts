/**
 * Compilation worker client: fork, request/response protocol keyed by id,
 * restart on unexpected exit, guard timeout (mmdc can block for 60 s per
 * diagram — inside the worker, never inside the extension host).
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';

// IPC protocol types: single source of truth in the core (type-only, erased at
// bundling — nothing from the core is embedded in extension.js).
export type {
  CompileResult,
  DeckDiagnostic,
  ExportResult,
  RenderStats,
  ValidateResult,
} from '../../core/src/worker/protocol';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Re-arms the guard timeout — called on the worker's `started` message
   *  (requests are serialized: waiting in the queue does not count). */
  rearm: () => void;
  /** Worker that received this request. The `pending` map is shared across
   *  successive workers (restart): the exit or the error of an OLD worker must
   *  reject only ITS requests, not those already handed to a new worker. */
  worker: cp.ChildProcess;
}

/** The host's last-resort kit when the setting is empty: the one the build
 *  bundled into `<dist>/kits/` (scripts/package.mjs — see installBrandKit). No
 *  name is hard-coded: the repository is generic, and the organization that
 *  builds the host picks its kit. The first directory carrying a kit.json wins;
 *  if there is none, we return `''` and the generic theme applies. The document
 *  always wins: frontmatter `kit:`, project default, user default
 *  (~/.config/lutrin) and `kit: none` all take precedence over this host
 *  default (see worker/protocol.d.ts and core/deck/theme.mjs). */
export const fallbackKit = (workerPath: string): string => {
  const kitsDir = path.resolve(path.dirname(workerPath), '..', '..', '..', 'kits');
  try {
    const found = fs
      .readdirSync(kitsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(kitsDir, e.name))
      .find((dir) => fs.existsSync(path.join(dir, 'kit.json')));
    return found ?? '';
  } catch {
    return ''; // no kits/: build without a brand kit, the normal case
  }
};

export class CompilerClient implements vscode.Disposable {
  private worker: cp.ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  constructor(
    private readonly workerPath: string,
    private readonly log: vscode.OutputChannel,
    /** The `lutrin.defaultKit` setting — the default kit of THIS editor (host
     *  default). Empty = the bundled kit, if there is one. Read on every request: a
     *  change of setting takes effect on the next compilation. */
    private readonly defaultThemeOf: () => string = () => '',
  ) {}

  private ensureWorker(): cp.ChildProcess {
    if (this.worker) return this.worker;
    this.log.appendLine(`starting the worker: ${this.workerPath}`);
    // fork from the extension host: Electron sets ELECTRON_RUN_AS_NODE, so the
    // child is a real Node (ESM, native modules).
    const w = cp.fork(this.workerPath, [], { silent: true, execArgv: [] });
    w.stdout?.on('data', (d) => this.log.append(String(d)));
    w.stderr?.on('data', (d) => this.log.append(String(d)));
    w.on(
      'message',
      (msg: {
        id: number;
        ok?: boolean;
        started?: boolean;
        result?: unknown;
        error?: { message: string };
      }) => {
        const p = this.pending.get(msg.id);
        if (!p) return;
        if (msg.started) {
          p.rearm(); // the request leaves the queue: the guard restarts from zero
          return;
        }
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error?.message ?? 'worker error'));
      },
    );
    w.on('exit', (code) => {
      if (this.worker === w) this.worker = null;
      this.rejectPendingOf(w, new Error(`the compilation worker stopped (code ${code})`));
    });
    // Without this handler, an error from the fork (binary not found, EPIPE…)
    // becomes an uncaught exception in the extension host, and the in-flight
    // requests hang until the guard timeout. We reject FROM THIS WORKER, as on exit.
    w.on('error', (e) => {
      if (this.worker === w) this.worker = null;
      this.log.appendLine(`worker error: ${e.message}`);
      this.rejectPendingOf(w, new Error(`the compilation worker failed: ${e.message}`));
    });
    this.worker = w;
    return w;
  }

  /** Rejects and removes the in-flight requests handed to THIS worker; those of
   *  a new worker (after a restart) are left intact. */
  private rejectPendingOf(w: cp.ChildProcess, err: Error): void {
    for (const [id, p] of this.pending) {
      if (p.worker !== w) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(err);
    }
  }

  request<T>(cmd: string, payload: unknown, timeoutMs = 90_000): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('client closed'));
    const id = this.nextId++;
    const w = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      const onTimeout = () => {
        this.pending.delete(id);
        this.restart(); // worker probably stuck: start again clean
        reject(new Error(`compilation timed out (${cmd})`));
      };
      const p: Pending = {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer: setTimeout(onTimeout, timeoutMs),
        rearm: () => {
          clearTimeout(p.timer);
          p.timer = setTimeout(onTimeout, timeoutMs);
        },
        worker: w,
      };
      this.pending.set(id, p);
      // host default injected here: an explicit payload field takes precedence
      const defaultTheme = this.defaultThemeOf().trim() || fallbackKit(this.workerPath);
      w.send({ id, cmd, payload: { defaultTheme, ...(payload as object) } });
    });
  }

  restart(): void {
    this.worker?.kill();
    this.worker = null;
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.kill();
    this.worker = null;
  }
}
