/**
 * Stub worker: speaks the IPC protocol of the real one (packages/core/src/worker/)
 * without compiling anything. It makes it possible to exercise the CLIENT —
 * correlation by id, rearming of the watchdog timeout on `started`, rejection of
 * every in-flight request when the process exits — for real, over a real IPC
 * channel between two real processes. A child_process mock would only have
 * proven the mock.
 *
 * Recognised commands (the `cmd` field of the request):
 *   echo    → replies ok with the payload received (used to observe what the
 *             client injects: defaultTheme and its precedence order);
 *   boom    → replies ok:false with an error message;
 *   noError → replies ok:false WITHOUT an error field (client default message);
 *   pending → remembers its id and never replies: the request stays in flight,
 *             ready to receive a `started` driven by the test;
 *   start   → sends `started` for the id remembered by `pending`, THEN
 *             acknowledges on its own id. Since the IPC channel preserves order,
 *             the round trip of `start` proves to the test that the `started`
 *             has arrived — no delay to guess, no clock to consult;
 *   silent  → never replies at all (exercises the watchdog timeout);
 *   die     → exits the process without replying (exercises the mass rejection);
 *   ghost   → replies on an unknown id before replying on the right one
 *             (the client must ignore the intruder without crashing).
 */

/** Id of the last `pending` request: the one `start` will address its `started`
 *  to. The test therefore does not need to know the client's numbering. */
let pendingId = null;

process.on('message', (msg) => {
  const { id, cmd, payload } = msg;
  switch (cmd) {
    case 'echo':
      process.send({ id, ok: true, result: payload });
      break;
    case 'boom':
      process.send({ id, ok: false, error: { message: 'the worker blew up' } });
      break;
    case 'noError':
      process.send({ id, ok: false });
      break;
    case 'pending':
      pendingId = id;
      break;
    case 'start':
      if (pendingId !== null) process.send({ id: pendingId, started: true });
      process.send({ id, ok: true, result: { startedEmittedFor: pendingId } });
      break;
    case 'silent':
      break;
    case 'die':
      process.exit(3);
      break;
    case 'ghost':
      process.send({ id: 9999, ok: true, result: 'nonexistent request' });
      process.send({ id, ok: true, result: 'the right answer' });
      break;
    default:
      process.send({ id, ok: false, error: { message: `unknown command: ${cmd}` } });
  }
});
