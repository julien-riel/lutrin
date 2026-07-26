/**
 * Shared plumbing for the LOCAL dev servers — `lutrin preview` (cli.mjs) and
 * `lutrin kit edit` (kit/edit-server.mjs).
 *
 * Everything here exists because listening on 127.0.0.1 is necessary but not
 * sufficient, and because both servers push change notifications over SSE.
 * The pieces are deliberately small and framework-free (node:http only):
 * each server keeps its own routing, its own watch policy and its own
 * messages — what is shared is exactly what must not drift between them
 * (the anti-rebinding guard, the port fallback, the SSE client set).
 */

/**
 * Hosts admitted by a local server.
 *
 * Listening on 127.0.0.1 is NOT enough: a third-party site can have its own
 * domain resolve to the local loopback (DNS rebinding) and have the server —
 * hence the content being served or written — read by the victim's browser.
 * The countermeasure is to refuse any request whose `Host` header is not a
 * local name: a browser ALWAYS sends the name it resolved.
 */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The host name of a `Host` header (port removed, IPv6 brackets kept). */
export function hostnameOf(header) {
  if (typeof header !== 'string' || !header) return null;
  if (header.startsWith('[')) return header.slice(0, header.indexOf(']') + 1) || null;
  const colon = header.indexOf(':');
  return (colon === -1 ? header : header.slice(0, colon)).toLowerCase();
}

/**
 * The DNS-rebinding guard, applied and answered in one move: true means the
 * request was refused AND the 403 already written — the caller just returns.
 * `what` names the server in the refusal text ('preview', 'editor', …).
 */
export function refuseNonLocalHost(req, res, what = 'preview') {
  const hostname = hostnameOf(req.headers.host);
  if (hostname && LOCAL_HOSTS.has(hostname)) return false;
  res.writeHead(403, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(
    `403 — Host header "${req.headers.host ?? '(absent)'}" refused: this ${what} only answers to localhost / 127.0.0.1.\n`,
  );
  return true;
}

/**
 * Listens on the first free port starting from `port`.
 *
 * A busy port surfaced as an uncaught EADDRINUSE — a stack trace for a
 * perfectly ordinary case (two previews open). We announce and we switch; the
 * caller learns the port ACTUALLY listened on. (`port: 0` lets the OS pick:
 * read the truth from `server.address().port`.)
 */
export function listenFromPort(server, port, attempts = 20) {
  return new Promise((resolve, reject) => {
    let current = port;
    let remaining = attempts;
    const onError = (e) => {
      if (e?.code !== 'EADDRINUSE' || remaining-- <= 0) {
        server.off('error', onError);
        reject(e);
        return;
      }
      console.log(`⚠ port ${current} busy — switching to ${current + 1}`);
      current += 1;
      server.listen(current, '127.0.0.1');
    };
    server.on('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(current);
    });
    server.listen(current, '127.0.0.1');
  });
}

/**
 * The SSE side of a live server: one hub = one set of connected clients.
 *
 *   - `handle(req, res)` answers the event-stream endpoint (`/__events`) and
 *     tracks the client until it disconnects;
 *   - `broadcast(data, event?)` pushes one message to every client — with no
 *     `event` name it is the anonymous message `EventSource.onmessage`
 *     receives (the preview's `data: reload`), with one it must be listened
 *     to by name (`addEventListener('kit-changed', …)`);
 *   - `close()` ends every connection (a server that stops must not leave
 *     sockets holding `server.close()` open forever).
 */
export function createSseHub() {
  const clients = new Set();
  return {
    handle(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(':ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    broadcast(data, event = null) {
      const frame = `${event ? `event: ${event}\n` : ''}data: ${data}\n\n`;
      for (const c of clients) c.write(frame);
    },
    close() {
      for (const c of clients) c.end();
      clients.clear();
    },
    get size() {
      return clients.size;
    },
  };
}
