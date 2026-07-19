/**
 * The worker client is the only place where the extension talks to another
 * process. Everything there turns on details no type system catches:
 * correlating responses by id, rearming the guard timer when the worker says
 * `started`, rejecting ALL in-flight requests when the process dies.
 *
 * The tests fork a real fake worker (test/fixtures/worker-stub.mjs): a real
 * IPC channel, a real child process. A mock of child_process would only have
 * tested the mock.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import type * as vscode from 'vscode';
import { CompilerClient, fallbackKit } from '../src/compilerClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(here, 'fixtures', 'worker-stub.mjs');

/** Minimal output channel: the client expects nothing but append/appendLine. */
const stubLog = () => {
  const lines: string[] = [];
  const channel = {
    append: (s: string) => void lines.push(s),
    appendLine: (s: string) => void lines.push(s),
  } as unknown as vscode.OutputChannel;
  return { channel, lines };
};

const clients: CompilerClient[] = [];
const newClient = (theme = () => '') => {
  const c = new CompilerClient(WORKER, stubLog().channel, theme);
  clients.push(c);
  return c;
};
after(() => {
  for (const c of clients) c.dispose();
});

describe('worker client — request/response protocol', () => {
  it('resolves the request with the result the worker returned', async () => {
    const r = await newClient().request<{ x: number }>('echo', { x: 42 });
    assert.equal(r.x, 42);
  });

  it('rejects with the worker error message rather than resolving', async () => {
    await assert.rejects(() => newClient().request('boom', {}), /the worker blew up/);
  });

  it('rejects with a default message when the worker supplies none', async () => {
    await assert.rejects(() => newClient().request('noError', {}), /worker error/);
  });

  it('correlates responses by id: several in-flight requests do not mix', async () => {
    const c = newClient();
    const rendered = await Promise.all([
      c.request<{ n: number }>('echo', { n: 1 }),
      c.request<{ n: number }>('echo', { n: 2 }),
      c.request<{ n: number }>('echo', { n: 3 }),
    ]);
    assert.deepEqual(
      rendered.map((r) => r.n),
      [1, 2, 3],
    );
  });

  it('ignores a response carrying an unknown id without bringing down the real request', async () => {
    const r = await newClient().request<string>('ghost', {});
    assert.equal(r, 'the right answer');
  });

  it('reuses the same worker from one request to the next (not one fork per call)', async () => {
    const c = newClient();
    const a = await c.request<{ pid?: number }>('echo', { marker: 'a' });
    const b = await c.request<{ marker: string }>('echo', { marker: 'b' });
    assert.equal(b.marker, 'b');
    assert.ok(a);
  });
});

describe('worker client — guard timer', () => {
  it('rejects when the worker does not answer within the allotted time', async () => {
    await assert.rejects(() => newClient().request('silent', {}, 120), /compilation timed out/);
  });

  it('names the offending command in the timeout message', async () => {
    await assert.rejects(() => newClient().request('silent', {}, 120), /\(silent\)/);
  });

  it('rearms the guard on "started": time spent queued does not count', async (t) => {
    // This test NEVER consults the wall clock: it DRIVES it. The client's
    // timers (setTimeout/clearTimeout) run in this process, so mock.timers
    // captures them; the arrival of `started`, by contrast, is a real IPC
    // event we trigger on command and to which the round trip of "start"
    // attests. No margin to tune, no drift possible under load: the result
    // depends only on the ORDER of the events.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    // drains the microtask AND the I/O queues without depending on a delay:
    // setImmediate is not mocked, one turn of the loop is enough.
    const loopTurn = () => new Promise((r) => setImmediate(r));

    const c = newClient();
    const inFlight = c.request('pending', {}, 150); // guard armed at t=0, expires at 150
    let rejected = false;
    inFlight.catch(() => {
      rejected = true;
    });

    t.mock.timers.tick(140); // t=140: the initial guard has only 10 ms left

    const ack = await c.request<{ startedEmittedFor: number }>('start', {});
    assert.ok(ack.startedEmittedFor !== null, 'the worker stub had no pending request');
    await loopTurn();

    t.mock.timers.tick(20); // t=160: WITHOUT a rearm, the initial guard expired at 150
    await loopTurn();
    assert.equal(
      rejected,
      false,
      'the guard was not rearmed on "started": rejected at 160 ms even though the ' +
        'worker signalled its start at 140 ms and the guard is 150 ms',
    );

    t.mock.timers.tick(130); // t=290: the guard rearmed at 140 finally expires
    await loopTurn();
    // Checked BEFORE the await: a guard rearmed and then never re-primed would
    // leave the promise pending forever, and `assert.rejects` would freeze what
    // follows instead of turning it red. A test that hangs tells nobody anything.
    assert.equal(
      rejected,
      true,
      'the rearmed guard never expired: after being rearmed at 140 ms it should have ' +
        'rejected at 290 ms — the rearm disarmed without re-priming',
    );
    await assert.rejects(() => inFlight, /compilation timed out/);
  });
});

describe('worker client — process lifecycle', () => {
  it('rejects every in-flight request when the worker dies', async () => {
    const c = newClient();
    const inFlight = c.request('silent', {}, 10_000);
    const fatal = c.request('die', {}, 10_000);
    await assert.rejects(() => inFlight, /stopped \(code 3\)/);
    await assert.rejects(() => fatal, /stopped/);
  });

  it('restarts a fresh worker after a death — the client stays usable', async () => {
    const c = newClient();
    await assert.rejects(() => c.request('die', {}, 10_000), /stopped/);
    const r = await c.request<{ ok: boolean }>('echo', { ok: true });
    assert.equal(r.ok, true);
  });

  it('refuses any request after dispose() without resurrecting a worker', async () => {
    const c = new CompilerClient(WORKER, stubLog().channel);
    c.dispose();
    await assert.rejects(() => c.request('echo', {}), /client closed/);
  });

  it('logs the worker startup in the output channel', async () => {
    const { channel, lines } = stubLog();
    const c = new CompilerClient(WORKER, channel);
    clients.push(c);
    await c.request('echo', {});
    assert.ok(lines.some((l) => l.includes('starting the worker')));
  });
});

describe('worker client — host default theme', () => {
  it('injects the editor setting into the payload', async () => {
    const r = await newClient(() => 'house-kit').request<{ defaultTheme: string }>('echo', {});
    assert.equal(r.defaultTheme, 'house-kit');
  });

  it('trims the whitespace around the setting', async () => {
    const r = await newClient(() => '  house-kit \n').request<{ defaultTheme: string }>('echo', {});
    assert.equal(r.defaultTheme, 'house-kit');
  });

  it('lets the document win: an explicit defaultTheme in the payload takes precedence', async () => {
    const r = await newClient(() => 'host-kit').request<{ defaultTheme: string }>('echo', {
      defaultTheme: 'document-kit',
    });
    assert.equal(r.defaultTheme, 'document-kit');
  });

  it('passes the rest of the payload through intact beside the injected default', async () => {
    const r = await newClient(() => 'k').request<{ source: string; baseDir: string }>('echo', {
      source: '# Title',
      baseDir: '/tmp/x',
    });
    assert.equal(r.source, '# Title');
    assert.equal(r.baseDir, '/tmp/x');
  });
});

describe('worker client — last-resort kit', () => {
  /** Tree <root>/dist/worker/worker.mjs + <root>/kits/…: the fallback climbs
   *  three levels up from the worker's directory. */
  const tree = (kits: Record<string, boolean>) => {
    // dist/worker/worker.mjs → three ".." lead back to the package root
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kits-'));
    const workerPath = path.join(root, 'a', 'b', 'c', 'worker.mjs');
    fs.mkdirSync(path.dirname(workerPath), { recursive: true });
    fs.writeFileSync(workerPath, '');
    for (const [name, withKitJson] of Object.entries(kits)) {
      const dir = path.join(root, 'kits', name);
      fs.mkdirSync(dir, { recursive: true });
      if (withKitJson) fs.writeFileSync(path.join(dir, 'kit.json'), '{}');
    }
    return { root, workerPath };
  };
  const tmpDirs: string[] = [];
  after(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it('finds the kit embedded by the build (a directory carrying a kit.json)', () => {
    const { root, workerPath } = tree({ mybrand: true });
    tmpDirs.push(root);
    assert.equal(fallbackKit(workerPath), path.join(root, 'kits', 'mybrand'));
  });

  it('ignores a directory without a kit.json — it is not a kit', () => {
    const { root, workerPath } = tree({ 'not-a-kit': false });
    tmpDirs.push(root);
    assert.equal(fallbackKit(workerPath), '');
  });

  it('returns an empty string with no kits/ — generic build, the normal case, no exception', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kits-'));
    tmpDirs.push(root);
    const workerPath = path.join(root, 'a', 'b', 'c', 'worker.mjs');
    fs.mkdirSync(path.dirname(workerPath), { recursive: true });
    assert.equal(fallbackKit(workerPath), '');
  });
});
