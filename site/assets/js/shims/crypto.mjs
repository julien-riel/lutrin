/**
 * `node:crypto` — the synchronous digests, in pure JavaScript.
 *
 * WHY THIS IS NOT A STUB. `deck/assets.mjs` opens its Mermaid cache lookup with
 * `crypto.createHash('sha1')…digest('hex')`, synchronously and outside any
 * try/catch. The Web Crypto API offers only `crypto.subtle.digest`, which is
 * async, so there is no way to satisfy that call site from the platform: a
 * throwing stub turns any deck containing a ```mermaid block into an uncaught
 * exception out of `compileHtml`. Hence a real SHA-1 here.
 *
 * SHA-256 is implemented alongside it because the licence store hashes with it,
 * and a shim that is right for one algorithm and wrong for the other is worse
 * than one that is right for both. Both are verified against the standard
 * "abc" test vectors by `packages/core/test/playground.test.mjs`.
 *
 * `createHmac` and `timingSafeEqual` are NOT implemented. They are reached only
 * when a licence record exists on disk, which cannot happen here — and a
 * hand-rolled constant-time comparison in a page is a worse idea than a clear
 * error nobody will ever see.
 */

const enc = new TextEncoder();

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** Message padded to a multiple of 64 bytes, with the bit length big-endian in
 *  the last eight. Shared by both algorithms — they differ only in the rounds. */
function padded(bytes) {
  const len = bytes.length;
  const total = ((len + 72) >> 6) << 6;
  const out = new Uint8Array(total);
  out.set(bytes);
  out[len] = 0x80;
  const dv = new DataView(out.buffer);
  dv.setUint32(total - 8, Math.floor(len / 536870912)); // len * 8 / 2^32
  dv.setUint32(total - 4, (len * 8) >>> 0);
  return out;
}

function sha1Words(bytes) {
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const m = padded(bytes);
  const dv = new DataView(m.buffer);
  const w = new Uint32Array(80);
  for (let i = 0; i < m.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 80; t++) {
      const v = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
      w[t] = ((v << 1) | (v >>> 31)) >>> 0;
    }
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      let f;
      let k;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = tmp;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
  }
  return h;
}

// prettier-ignore
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Words(bytes) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const m = padded(bytes);
  const dv = new DataView(m.buffer);
  const w = new Uint32Array(64);
  for (let i = 0; i < m.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let j = 0; j < 8; j++) h[j] = (h[j] + next[j]) >>> 0;
  }
  return [...h];
}

const hex = (words) => words.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join('');

const ALGORITHMS = { sha1: sha1Words, sha256: sha256Words };

export function createHash(algorithm) {
  const name = String(algorithm).toLowerCase().replace('-', '');
  const run = ALGORITHMS[name];
  if (!run) throw new Error(`crypto.createHash: "${algorithm}" is not available in the browser`);
  // Chunks are kept as BYTES. `String(chunk)` on a Uint8Array yields
  // "137,80,78,…" — a digest of the wrong bytes, silently, and the caller
  // that hashes bytes here is the kit-archive reader naming what a visitor
  // uploaded. Strings are encoded as UTF-8, exactly as Node's update() does.
  let chunks = [];
  return {
    update(chunk) {
      chunks.push(chunk instanceof Uint8Array ? chunk : enc.encode(String(chunk)));
      return this;
    },
    digest(encoding) {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const data = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) {
        data.set(c, at);
        at += c.length;
      }
      chunks = [];
      const out = hex(run(data));
      if (encoding === 'hex' || encoding === undefined) return out;
      throw new Error(`crypto digest: encoding "${encoding}" is not available in the browser`);
    },
  };
}

const unavailable = (what) => () => {
  throw new Error(`crypto.${what} is not available in the browser playground`);
};

export const createHmac = unavailable('createHmac');
export const timingSafeEqual = unavailable('timingSafeEqual');
export const randomUUID = () => globalThis.crypto.randomUUID();

export default { createHash, createHmac, timingSafeEqual, randomUUID };
