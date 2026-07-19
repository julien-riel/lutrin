/**
 * Worker IPC (editor hosts): requests are SERIALIZED — since the theme and
 * the user layouts are module state mutated by each compilation, two
 * interleaved requests would produce a hybrid rendering that is silently
 * wrong. These tests fork the real worker and pin down: the queue (two
 * back-to-back compiles, different themes, no mixing), the `started`
 * message (clients rearm their watchdog on it), the protocol's
 * `themePath` field, and the refusal of commands inherited from
 * Object.prototype.
 */

import './setup.mjs'; // hermetic even under direct invocation (the fork inherits the env)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(here, '..', 'src', 'worker', 'worker.mjs');

/** Forks the worker and returns { send, messagesFor, close } — each request
 *  accumulates its messages ({started}, then {ok, result}). */
function forkWorker(t) {
  const w = fork(WORKER, [], { silent: true, execArgv: [] });
  t.after(() => w.kill());
  const byId = new Map(); // id → { messages: [], resolve }
  w.on('message', (msg) => {
    const entry = byId.get(msg.id);
    if (!entry) return;
    entry.messages.push(msg);
    if ('ok' in msg) entry.resolve(entry.messages);
  });
  return {
    send(id, cmd, payload) {
      const entry = { messages: [] };
      entry.promise = new Promise((resolve) => {
        entry.resolve = resolve;
      });
      byId.set(id, entry);
      w.send({ id, cmd, payload });
      return entry.promise;
    },
  };
}

test('worker: two back-to-back compiles with different themes — responses in order, no hybrid rendering', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-worker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ colors: { primary: '123ABC' } }));
  const themed = '---\ntitle: A\ntheme: ./theme.json\n---\n\n# Slide A\n\nText A.\n';
  const plain = '---\ntitle: B\n---\n\n# Slide B\n\nText B.\n';

  const worker = forkWorker(t);
  // send BOTH without waiting for the first response: this is exactly the
  // interleaving scenario the queue has to neutralize
  const pA = worker.send(1, 'compile', { source: themed, baseDir: dir });
  const pB = worker.send(2, 'compile', { source: plain, baseDir: dir });
  const [msgsA, msgsB] = await Promise.all([pA, pB]);

  const doneA = msgsA[msgsA.length - 1];
  const doneB = msgsB[msgsB.length - 1];
  assert.equal(doneA.ok, true, doneA.error?.message);
  assert.equal(doneB.ok, true, doneB.error?.message);

  const cssA = doneA.result.css;
  const cssB = doneB.result.css;
  assert.match(cssA, /#123ABC/, 'deck A carries ITS OWN theme');
  assert.doesNotMatch(cssA, /#1D4ED8/, 'deck A holds no default primary (no hybrid)');
  assert.match(cssB, /#1D4ED8/, 'deck B is on the default theme');
  assert.doesNotMatch(cssB, /#123ABC/, "deck A's theme did not leak into B");
});

test('worker: the started message precedes every response (clients rearm their watchdog)', async (t) => {
  const worker = forkWorker(t);
  const msgs = await worker.send(1, 'validate', {
    source: '# Slide\n\nText.\n',
    baseDir: os.tmpdir(),
  });
  assert.equal(msgs[0].started, true, 'started emitted as execution begins');
  assert.equal(msgs[msgs.length - 1].ok, true);
});

test('worker: an Object.prototype method is not a command — same refusal as a name that does not exist', async (t) => {
  const worker = forkWorker(t);

  // reference: what the protocol promises for a name that does not exist
  const unknown = await worker.send(1, 'doesNotExist', {});
  const refusal = unknown[unknown.length - 1];
  assert.equal(refusal.ok, false);
  assert.match(refusal.error.message, /unknown command/);

  // HANDLERS is an object literal: without a guard, `HANDLERS.toString` brings
  // back an inherited function, the worker CALLS it and replies { ok: true,
  // result: '[object Undefined]' } — a silent failure on a "success" path,
  // with hosts then destructuring result.slides / result.diagnostics as empty
  for (const cmd of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    const msgs = await worker.send(`proto-${cmd}`, cmd, {});
    const done = msgs[msgs.length - 1];
    assert.equal(done.ok, false, `${cmd} must NEVER reply with success`);
    assert.match(done.error.message, /unknown command/, cmd);
  }
});

test("worker: the protocol's themePath takes precedence over the frontmatter", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-worker-tp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'frontmatter.json'),
    JSON.stringify({ colors: { primary: '111111' } }),
  );
  fs.writeFileSync(
    path.join(dir, 'imposed.json'),
    JSON.stringify({ colors: { primary: '123ABC' } }),
  );
  const source = '---\ntitle: A\ntheme: ./frontmatter.json\n---\n\n# Slide\n\nText.\n';

  const worker = forkWorker(t);
  const msgs = await worker.send(1, 'compile', {
    source,
    baseDir: dir,
    themePath: path.join(dir, 'imposed.json'),
  });
  const done = msgs[msgs.length - 1];
  assert.equal(done.ok, true, done.error?.message);
  assert.match(done.result.css, /#123ABC/, 'the themePath imposed by the host is applied');
  assert.doesNotMatch(done.result.css, /#111111/);
});
