/**
 * Same IPC protocol as on the VS Code side, but a different launch: from
 * Obsidian's renderer we `spawn` a system Node rather than `fork`.
 * These tests exercise the protocol over a real child process, and check that
 * the worker-death error message stays diagnosable (it is the only feedback an
 * Obsidian user gets when nothing starts at all).
 *
 * `nodePathSetting` receives `process.execPath`: the Node running the tests is
 * a perfectly valid candidate, and findSystemNode keeps it without depending
 * on what happens to be installed on the machine.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { CompilerClient, fallbackKit } from '../src/compilerClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(here, 'fixtures', 'worker-stub.mjs');

const clients: CompilerClient[] = [];
const newClient = (theme = () => '') => {
  const c = new CompilerClient(WORKER, () => process.execPath, theme);
  clients.push(c);
  return c;
};
after(() => {
  for (const c of clients) c.dispose();
});

describe('Obsidian client — request/response protocol', () => {
  it('resolves the request with the result the worker returned', async () => {
    const r = await newClient().request<{ x: number }>('echo', { x: 42 });
    assert.equal(r.x, 42);
  });

  it('rejects with the worker error message', async () => {
    await assert.rejects(() => newClient().request('boom', {}), /the worker blew up/);
  });

  it('correlates responses by id: several in-flight requests do not mix', async () => {
    const c = newClient();
    const rendered = await Promise.all([
      c.request<{ n: number }>('echo', { n: 1 }),
      c.request<{ n: number }>('echo', { n: 2 }),
    ]);
    assert.deepEqual(
      rendered.map((r) => r.n),
      [1, 2],
    );
  });

  it('ignores a response carrying an unknown id', async () => {
    assert.equal(await newClient().request<string>('ghost', {}), 'the right answer');
  });
});

describe('Obsidian client — guard timer', () => {
  it('rejects when the worker does not answer within the allotted time', async () => {
    await assert.rejects(() => newClient().request('silent', {}, 120), /compilation timed out/);
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
    await assert.rejects(() => inFlight, /compilation timed out/);
  });
});

describe('Obsidian client — process lifecycle', () => {
  it('rejects every in-flight request when the worker dies, citing the code', async () => {
    const c = newClient();
    const inFlight = c.request('silent', {}, 10_000);
    const fatal = c.request('die', {}, 10_000);
    await assert.rejects(() => inFlight, /stopped \(code 3\)/);
    await assert.rejects(() => fatal, /stopped/);
  });

  it('restarts a fresh worker after a death', async () => {
    const c = newClient();
    await assert.rejects(() => c.request('die', {}, 10_000), /stopped/);
    assert.equal((await c.request<{ ok: boolean }>('echo', { ok: true })).ok, true);
  });

  it('the old worker dying does not carry off the requests of the fresh worker (restart)', async () => {
    // Historical bug: the `pending` map, shared across successive workers, was
    // cleared wholesale on the exit of ANY worker. After a restart (e.g. a
    // change to the "Node path" setting), the exit of the old one wrongly
    // rejected requests already handed to the fresh one.
    const c = newClient();
    const previous = c.request('silent', {}, 10_000); // in flight on worker A
    c.restart(); // A is killed, this.worker = null — but `previous` stays tagged A
    const fresh = c.request<{ ok: boolean }>('echo', { ok: true }, 10_000); // → worker B
    // A's (asynchronous) exit must reject ONLY `previous`; `fresh` lives on
    const [, freshResult] = await Promise.all([assert.rejects(() => previous, /stopped/), fresh]);
    assert.equal(freshResult.ok, true);
  });

  it('refuses any request after dispose()', async () => {
    const c = new CompilerClient(WORKER, () => process.execPath);
    c.dispose();
    await assert.rejects(() => c.request('echo', {}), /client closed/);
  });

  it('reports a configured but unusable Node path instead of rejecting it in silence', async () => {
    // without that mention, the message would advise the user to do exactly
    // what they have just done
    const c = new CompilerClient(WORKER, () => '/path/that/does/not/exist/node');
    clients.push(c);
    await assert.rejects(
      () => c.request('die', {}, 10_000),
      /configured Node path was rejected.*does\/not\/exist\/node/s,
    );
  });
});

describe('Obsidian client — host default theme', () => {
  it('injects the plugin setting into the payload', async () => {
    const r = await newClient(() => 'house-kit').request<{ defaultTheme: string }>('echo', {});
    assert.equal(r.defaultTheme, 'house-kit');
  });

  it('lets the document win: an explicit defaultTheme in the payload takes precedence', async () => {
    const r = await newClient(() => 'host-kit').request<{ defaultTheme: string }>('echo', {
      defaultTheme: 'document-kit',
    });
    assert.equal(r.defaultTheme, 'document-kit');
  });
});

describe('Obsidian client — last-resort kit', () => {
  const tmpDirs: string[] = [];
  after(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });
  /** <root>/kits/… + <root>/a/b/c/worker.mjs: the fallback climbs three
   *  levels up from the worker's directory. */
  const tree = (kits: Record<string, boolean>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-kits-obs-'));
    tmpDirs.push(root);
    const workerPath = path.join(root, 'a', 'b', 'c', 'worker.mjs');
    fs.mkdirSync(path.dirname(workerPath), { recursive: true });
    for (const [name, withKitJson] of Object.entries(kits)) {
      const dir = path.join(root, 'kits', name);
      fs.mkdirSync(dir, { recursive: true });
      if (withKitJson) fs.writeFileSync(path.join(dir, 'kit.json'), '{}');
    }
    return { root, workerPath };
  };

  it('finds the kit embedded by the build (a directory carrying a kit.json)', () => {
    const { root, workerPath } = tree({ mybrand: true });
    assert.equal(fallbackKit(workerPath), path.join(root, 'kits', 'mybrand'));
  });

  it('ignores a directory without a kit.json — it is not a kit', () => {
    const { workerPath } = tree({ 'not-a-kit': false });
    assert.equal(fallbackKit(workerPath), '');
  });

  it('returns an empty string with no kits/ — generic build, no exception', () => {
    const { workerPath } = tree({});
    assert.equal(fallbackKit(workerPath), '');
  });
});
