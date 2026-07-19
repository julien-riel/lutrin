/**
 * Compilation worker client: spawn + IPC channel, request/response protocol
 * keyed by id, restart on unexpected exit, guard timeout (mmdc can block for
 * 60 s per diagram — inside the worker, never inside Obsidian's renderer).
 *
 * Same protocol as the VS Code extension, but NOT `child_process.fork`: from
 * Obsidian's renderer, fork relaunches the Obsidian binary with
 * ELECTRON_RUN_AS_NODE — which Obsidian blocks until its "Command line
 * interface" setting (Settings → General → Advanced) is enabled. So we launch
 * a **system Node** whenever we find one (the "Node path" setting first), and
 * we fall back on Obsidian-as-Node only as a last resort, with an error
 * message that explains both ways out.
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// IPC protocol types: single source of truth in the core (type-only, erased at
// bundling — nothing from the core is embedded in main.js).
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
  /** Worker that received this request. The `pending` map is shared across
   *  successive workers (restart on a "Node path" change, death of the
   *  process…); when a worker exits or errors, we reject only ITS requests —
   *  the exit of an old worker must not carry off those already handed to the
   *  new one. */
  worker: cp.ChildProcess;
  /** Re-arms the guard timeout — called on the worker's `started` message
   *  (requests are serialized: waiting in the queue does not count). */
  rearm: () => void;
}

const log = (...args: unknown[]) => console.log('[lutrin]', ...args);

const isWin = process.platform === 'win32';
const nodeName = isWin ? 'node.exe' : 'node';

/** Minimum Node version for the worker: the core relies on Node ≥ 18 APIs
 *  (global fetch for remote images, among others) — an older Node would start
 *  and then crash part-way through a compilation. */
const MIN_NODE_MAJOR = 18;

/** Major version of a Node binary (`node --version`), or null.
 *  killSignal SIGKILL: with the default SIGTERM, a shim that ignores it would
 *  block the synchronous call well beyond the timeout — inside Obsidian's
 *  renderer, that would freeze the whole UI. */
function nodeMajor(bin: string): number | null {
  try {
    const out = cp
      .execFileSync(bin, ['--version'], { timeout: 3000, killSignal: 'SIGKILL' })
      .toString()
      .trim();
    const m = out.match(/^v(\d+)\./);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

interface NodeSearch {
  node: string | null;
  /** Reason the user-configured path was rejected, if any — to be surfaced in
   *  the error messages: silently rejecting the path the user has just filled
   *  in makes the diagnostic incomprehensible ("fill in its path" when they
   *  already have). */
  preferredRejected: string | null;
}

/** System Node: user setting, usual locations, PATH, nvm.
 *  Every candidate executable is checked (`--version`): a Node that is too old
 *  is rejected rather than crashing later on inside the worker. */
function findSystemNode(preferred?: string): NodeSearch {
  const pref = preferred?.trim() || null;
  const candidates: string[] = [];
  if (pref) candidates.push(pref);
  if (!isWin) candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node');
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, nodeName));
  }
  // nvm: the most recent of the installed versions — descending NUMERIC sort
  // (lexicographically, "v9.11.2" would come before "v20.12.0")
  try {
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const parsed = fs
      .readdirSync(nvm)
      .map((name) => ({
        name,
        v:
          name
            .match(/^v(\d+)\.(\d+)\.(\d+)/)
            ?.slice(1)
            .map(Number) ?? null,
      }))
      .filter((x): x is { name: string; v: number[] } => x.v !== null)
      .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
    for (const { name } of parsed) candidates.push(path.join(nvm, name, 'bin', 'node'));
  } catch {
    // no nvm
  }
  let preferredRejected: string | null = null;
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    let reason: string | null = null;
    try {
      fs.accessSync(c, fs.constants.X_OK);
      const major = nodeMajor(c);
      if (major === null || major < MIN_NODE_MAJOR) {
        reason = `version ${major ?? 'could not be read'}, minimum ${MIN_NODE_MAJOR}`;
      }
    } catch {
      reason = 'not found or not executable';
    }
    if (reason === null) return { node: c, preferredRejected };
    if (c === pref) {
      preferredRejected = `${c} — ${reason}`;
      log(`configured Node path rejected: ${preferredRejected}`);
    } else if (!reason.startsWith('not found')) {
      log(`node rejected: ${c} (${reason})`);
    }
  }
  return { node: null, preferredRejected };
}

/** Main binary of the bundle (macOS: the renderer exposes the Helper, which
 *  does not launch on its own — we walk back up to
 *  `<App>.app/Contents/MacOS/<App>`). */
function mainElectronBinary(): string {
  const p = process.execPath;
  const m = p.match(/^(.*?\.app)\/Contents\/Frameworks\/[^/]*Helper[^/]*\.app\//);
  if (m) {
    const appDir = m[1];
    const main = path.join(appDir, 'Contents', 'MacOS', path.basename(appDir, '.app'));
    if (fs.existsSync(main)) return main;
  }
  return p;
}

/** The host's last-resort kit when the setting is empty: the one the build
 *  bundled into `<dist>/kits/` (scripts/package.mjs — see installBrandKit). No
 *  name is hard-coded: the repository is generic, and the organization that
 *  builds the host picks its kit. The first directory carrying a kit.json
 *  wins; if there is none, we return `''` and the generic theme applies. The
 *  document always wins: frontmatter `kit:`, project default, user default
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

export class CompilerClient {
  private worker: cp.ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;
  private lastStderr = '';
  private preferredRejected: string | null = null;

  constructor(
    private readonly workerPath: string,
    private readonly nodePathSetting: () => string,
    /** The "Default kit" setting — the default kit of THIS editor (host
     *  default). Empty = the bundled kit, if there is one. Read on every
     *  request: a change of
     *  setting takes effect on the next compilation, without restarting the worker. */
    private readonly defaultThemeOf: () => string = () => '',
  ) {}

  private ensureWorker(): cp.ChildProcess {
    if (this.worker) return this.worker;
    const { node: systemNode, preferredRejected } = findSystemNode(this.nodePathSetting());
    this.preferredRejected = preferredRejected;
    const cmd = systemNode ?? mainElectronBinary();
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.NODE_OPTIONS;
    if (!systemNode) env.ELECTRON_RUN_AS_NODE = '1';
    log(`starting the worker: ${this.workerPath}`);
    log(`runtime: ${cmd}${systemNode ? '' : ' (ELECTRON_RUN_AS_NODE)'}`);
    this.lastStderr = '';
    const w = cp.spawn(cmd, [this.workerPath], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    w.stdout?.on('data', (d) => log(String(d).trimEnd()));
    w.stderr?.on('data', (d) => {
      this.lastStderr = (this.lastStderr + String(d)).slice(-600);
      log(String(d).trimEnd());
    });
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
    w.on('exit', (code, signal) => {
      if (this.worker === w) this.worker = null;
      const stderr = this.lastStderr.trim();
      let message = `the compilation worker stopped (${signal ?? `code ${code}`})`;
      if (stderr) message += ` — ${stderr.split('\n').pop()}`;
      if (/command line interface/i.test(stderr)) {
        message = `Obsidian is blocking the launch of the compiler. Two ways out: install Node.js ${MIN_NODE_MAJOR} or later (or fill in its path in the plugin settings), or enable Settings → General → Advanced → "Command line interface".`;
      }
      // without this mention, the message above would advise exactly what the
      // user has already done, without saying that their path was rejected
      if (this.preferredRejected) {
        message += ` NB: the configured Node path was rejected (${this.preferredRejected}).`;
      }
      const err = new Error(message);
      this.rejectPendingOf(w, err);
    });
    w.on('error', (e) => {
      if (this.worker === w) this.worker = null;
      this.rejectPendingOf(w, e);
    });
    this.worker = w;
    return w;
  }

  /** Rejects the in-flight requests handed to `w`, and only those: after a
   *  restart, the old worker and the new one coexist until the first one dies,
   *  and its exit must not carry off the requests of the second. */
  private rejectPendingOf(w: cp.ChildProcess, err: Error): void {
    for (const [id, p] of this.pending) {
      if (p.worker !== w) continue;
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
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
        worker: w,
        timer: setTimeout(onTimeout, timeoutMs),
        rearm: () => {
          clearTimeout(p.timer);
          p.timer = setTimeout(onTimeout, timeoutMs);
        },
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
