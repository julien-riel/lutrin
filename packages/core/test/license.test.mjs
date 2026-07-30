/**
 * Licensing and the "Généré avec Lutrin" attribution.
 *
 * Two contracts are held here, and they are the ones the monetisation rests on:
 *
 *   1. A deck compiled WITHOUT a licence carries the attribution — on all four
 *      layouts, in HTML and in the .pptx (zip reopened: what a client receives,
 *      not what the renderer thinks it wrote).
 *   2. A deck compiled WITH a valid licence carries it NOWHERE, and every way a
 *      licence can be forged or aged out brings it straight back.
 *
 * Every test drives LUTRIN_CONFIG at a temporary directory — the licence lives
 * beside config.json, and setup.mjs already points the whole suite at a
 * non-existent root ("no licence installed", the normal case). Polar is a local
 * HTTP server: the suite must never depend on the network, and the ACTIVATION
 * accounting — machines per key, which is what the CLI enforces — is precisely
 * what deserves to be exercised end to end.
 */

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {
  BRAND_MENTION,
  LICENSE_CLOCKS,
  activateLicense,
  brandMention,
  deactivateLicense,
  licenseState,
  maybeRevalidate,
  polarOrganizationId,
} from '../src/license/index.mjs';
import { readLicenseRecord, writeLicenseRecord } from '../src/license/store.mjs';
import { compileHtml } from '../src/html/render.mjs';
import { renderDeck } from '../src/pptx/render.mjs';
import { parseDeck } from '../src/deck/parse.mjs';
import { buildScenes } from '../src/deck/layout.mjs';

const { DAY_MS } = LICENSE_CLOCKS;

/** Temporary configuration root, restored after the test — the environment is
 *  process-wide and a leak would license (or unlicense) every later test. */
function tempConfig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-license-'));
  const previous = process.env.LUTRIN_CONFIG;
  process.env.LUTRIN_CONFIG = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.LUTRIN_CONFIG;
    else process.env.LUTRIN_CONFIG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * A local stand-in for Polar's customer-portal endpoints, with real activation
 * accounting: `machines` is the key's `limit_activations`, and the 403 once they
 * are all taken is the behaviour the paid tier rests on.
 */
function fakePolar(
  t,
  { machines = 2, status = 'granted', expiresAt = null, key = 'GOOD-KEY' } = {},
) {
  const activations = new Map();
  const calls = [];
  const licenseKey = () => ({
    id: 'lk_test',
    status,
    display_key: '****-TEST',
    limit_activations: machines,
    expires_at: expiresAt,
  });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = JSON.parse(body || '{}');
      calls.push({ url: req.url, body: p });
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(obj === null ? '' : JSON.stringify(obj));
      };
      if (p.key !== key) return send(404, { detail: 'LicenseKey does not exist.' });
      if (req.url.endsWith('/activate')) {
        if (activations.size >= machines)
          return send(403, { detail: 'License key activation limit already reached.' });
        const id = `act_${activations.size + 1}`;
        activations.set(id, p.label);
        return send(200, { id, license_key_id: 'lk_test', license_key: licenseKey() });
      }
      if (req.url.endsWith('/validate')) {
        if (p.activation_id && !activations.has(p.activation_id))
          return send(404, { detail: 'Activation does not exist.' });
        return send(200, licenseKey());
      }
      if (req.url.endsWith('/deactivate')) {
        activations.delete(p.activation_id);
        return send(204, null);
      }
      send(404, { detail: 'no route' });
    });
  });
  server.listen(0, '127.0.0.1');
  const previous = { api: process.env.LUTRIN_POLAR_API, org: process.env.LUTRIN_POLAR_ORG };
  const ready = new Promise((resolve) => {
    server.on('listening', () => {
      process.env.LUTRIN_POLAR_API = `http://127.0.0.1:${server.address().port}`;
      process.env.LUTRIN_POLAR_ORG = 'org_test';
      resolve();
    });
  });
  t.after(async () => {
    for (const [k, v] of Object.entries({
      LUTRIN_POLAR_API: previous.api,
      LUTRIN_POLAR_ORG: previous.org,
    }))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await new Promise((r) => server.close(r));
  });
  return { ready, activations, calls };
}

/** Three slides, three layouts: the frontmatter `title:` produces the cover, the
 *  first heading a content slide, and the bare heading a section — so one deck
 *  exercises all three masters. */
const DECK = `---
title: Licence
footer: Footer of the author
---

# A content slide

Some text.

# A section
`;

/** The hero layout, whose full-frame image COVERS the master's chrome: the
 *  attribution has to be painted per slide there, and that is the one code path
 *  the three-master deck above cannot reach. */
const HERO_DECK = `---
title: Hero
---

# A photograph

![cover](pixel.png)
`;

/** Occurrences of the attribution in a compiled HTML document, MINUS the one in
 *  the stylesheet comment-free rule set (the class name, not the text): the
 *  mention itself only ever appears in the slides. */
const countInHtml = (html) => html.split(BRAND_MENTION).length - 1;

/** Occurrences across every XML part of a .pptx — masters (slideLayouts) and
 *  slides alike. What travels to the client is what is counted. */
async function countInPptx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  let n = 0;
  for (const name of Object.keys(zip.files).filter((f) => f.endsWith('.xml')))
    if ((await zip.file(name).async('string')).includes(BRAND_MENTION)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// the attribution
// ---------------------------------------------------------------------------

test('unlicensed: every layout carries the attribution in HTML', async (t) => {
  tempConfig(t);
  const { html } = await compileHtml(DECK, { baseDir: process.cwd() });
  // three slides, three mentions: content, section and cover each get one —
  // the two layouts with no footer band included, which is the whole point of
  // painting it per layout rather than only in the footer
  assert.equal(countInHtml(html), 3);
  assert.match(html, /class="footer-brand"/);
  assert.match(html, /class="footer-brand brand-section"/);
  assert.match(html, /class="footer-brand brand-cover"/);
  // and the author's own footer is untouched beside it
  assert.match(html, /class="footer-text">Footer of the author</);
});

test('unlicensed: the hero layout gets its own copy, over the image', async (t) => {
  tempConfig(t);
  const fixtures = path.join(import.meta.dirname, 'fixtures');
  const { html, scenes } = await compileHtml(HERO_DECK, { baseDir: fixtures });
  assert.equal(
    scenes.find((s) => s.master === 'hero') !== undefined,
    true,
    'the fixture must really produce a hero slide',
  );
  // cover + hero: the hero mention is written after the image, like the page
  // number, so the full-frame photograph cannot bury it
  assert.equal(countInHtml(html), 2);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-hero-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'hero.pptx');
  const deck = parseDeck(HERO_DECK);
  await renderDeck(buildScenes(deck), deck.meta, fixtures, out);
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const heroSlide = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.ok(heroSlide.includes(BRAND_MENTION), 'the hero slide carries the attribution itself');
});

test('unlicensed: the .pptx carries it on the three masters', async (t) => {
  tempConfig(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pptx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'deck.pptx');
  const deck = parseDeck(DECK);
  await renderDeck(buildScenes(deck), deck.meta, process.cwd(), out);
  // DECK_CONTENT, DECK_COVER, DECK_SECTION — one master object each, inherited
  // by every slide, so the count is of layouts and not of slides
  assert.equal(await countInPptx(out), 3);
});

test('licensed: the attribution disappears from both formats', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');
  assert.equal(licenseState().licensed, true);

  const { html } = await compileHtml(DECK, { baseDir: process.cwd() });
  assert.equal(countInHtml(html), 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-pptx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'deck.pptx');
  const deck = parseDeck(DECK);
  await renderDeck(buildScenes(deck), deck.meta, process.cwd(), out);
  assert.equal(await countInPptx(out), 0);
});

test('brandMention: the explicit override beats the licence, both ways', (t) => {
  tempConfig(t);
  assert.equal(brandMention({}), BRAND_MENTION); // no licence
  assert.equal(brandMention({ branding: false }), null);
  assert.equal(brandMention({ branding: true }), BRAND_MENTION);
});

// ---------------------------------------------------------------------------
// activations (machines per key)
// ---------------------------------------------------------------------------

test('one activation is consumed per machine, and exhaustion is reported as such', async (t) => {
  const first = tempConfig(t);
  const polar = fakePolar(t, { machines: 2 });
  await polar.ready;

  await activateLicense('GOOD-KEY');
  assert.equal(readLicenseRecord().record.activationLimit, 2);
  assert.equal(polar.activations.size, 1);

  // a second machine: another configuration root, same key
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-license-2-'));
  t.after(() => fs.rmSync(second, { recursive: true, force: true }));
  process.env.LUTRIN_CONFIG = second;
  await activateLicense('GOOD-KEY');
  assert.equal(polar.activations.size, 2);

  // a third one has nothing left to take
  const third = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-license-3-'));
  t.after(() => fs.rmSync(third, { recursive: true, force: true }));
  process.env.LUTRIN_CONFIG = third;
  await assert.rejects(activateLicense('GOOD-KEY'), (e) => {
    assert.equal(e.code, 'ACTIVATIONS_EXHAUSTED');
    return true;
  });
  process.env.LUTRIN_CONFIG = first;
});

test('re-activating on the same machine does not burn a second activation', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t, { machines: 2 });
  await polar.ready;
  await activateLicense('GOOD-KEY');
  const again = await activateLicense('GOOD-KEY');
  assert.equal(again.releasedPreviousActivation, true);
  assert.equal(polar.activations.size, 1); // one activation held, not two
});

test('deactivate frees the activation and removes the record', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t, { machines: 1 });
  await polar.ready;
  await activateLicense('GOOD-KEY');
  const { removed, activationFreed } = await deactivateLicense();
  assert.ok(removed);
  assert.equal(activationFreed, true);
  assert.equal(polar.activations.size, 0);
  assert.equal(licenseState().licensed, false);
  assert.equal(licenseState().reason, 'NO_LICENSE');
});

test('an unknown key is refused and installs nothing', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await assert.rejects(activateLicense('WRONG'), (e) => e.code === 'KEY_UNKNOWN');
  assert.equal(licenseState().licensed, false);
  assert.equal(licenseState().reason, 'NO_LICENSE');
});

// ---------------------------------------------------------------------------
// the record, and the ways a licence stops applying
// ---------------------------------------------------------------------------

test('an edited record is ignored — and the attribution comes back', async (t) => {
  const dir = tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');

  const file = path.join(dir, 'license.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.expiresAt = '2099-01-01T00:00:00Z'; // a hand-extended licence
  fs.writeFileSync(file, JSON.stringify(record));

  const state = licenseState();
  assert.equal(state.licensed, false);
  assert.equal(state.reason, 'LICENSE_SEAL');
  const { html } = await compileHtml(DECK, { baseDir: process.cwd() });
  assert.equal(countInHtml(html), 3);
});

test('a record sealed on another machine is ignored', async (t) => {
  const dir = tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');

  // The seal binds to the account + platform + home, so moving the home
  // directory is what another machine looks like from here — and is exactly how
  // a copied file behaves.
  //
  // BOTH variables, because os.homedir() reads a different one per platform:
  // HOME on POSIX, USERPROFILE on Windows. Setting only HOME left this test
  // green on macOS and Linux while asserting nothing at all on Windows, where
  // the home never moved and the seal therefore still matched.
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'lutrin-home-'));
  process.env.HOME = elsewhere;
  process.env.USERPROFILE = elsewhere;
  t.after(() => {
    for (const [k, v] of Object.entries(previous))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  // precondition, not decoration: if the override stops moving the home the
  // test would pass by testing nothing, which is how the Windows hole opened
  assert.equal(os.homedir(), elsewhere, 'the home directory must really have moved');
  assert.equal(licenseState().reason, 'LICENSE_SEAL');
  assert.equal(fs.existsSync(path.join(dir, 'license.json')), true); // still there, just not trusted
});

test('a revoked or expired key does not license anything', (t) => {
  tempConfig(t);
  const now = Date.now();
  writeLicenseRecord({
    key: 'K',
    activationId: 'A',
    label: 'test',
    status: 'revoked',
    activationLimit: 5,
    expiresAt: null,
    validatedAt: new Date(now).toISOString(),
  });
  assert.equal(licenseState(now).reason, 'REVOKED');

  writeLicenseRecord({
    key: 'K',
    activationId: 'A',
    label: 'test',
    status: 'granted',
    activationLimit: 5,
    expiresAt: new Date(now - DAY_MS).toISOString(),
    validatedAt: new Date(now).toISOString(),
  });
  assert.equal(licenseState(now).reason, 'EXPIRED');
});

test('offline grace: usable for 30 days, then not — and revalidation is due at 7', (t) => {
  tempConfig(t);
  const now = Date.now();
  const record = (ageDays) => ({
    key: 'K',
    activationId: 'A',
    label: 'test',
    status: 'granted',
    activationLimit: 5,
    expiresAt: null,
    validatedAt: new Date(now - ageDays * DAY_MS).toISOString(),
  });

  writeLicenseRecord(record(3));
  let state = licenseState(now);
  assert.equal(state.licensed, true);
  assert.equal(state.revalidationDue, false);

  writeLicenseRecord(record(10)); // past the weekly check, still licensed
  state = licenseState(now);
  assert.equal(state.licensed, true);
  assert.equal(state.revalidationDue, true);

  writeLicenseRecord(record(31)); // past the grace period
  state = licenseState(now);
  assert.equal(state.licensed, false);
  assert.equal(state.reason, 'STALE');
});

test('a validation dated in the future does not buy an endless grace period', (t) => {
  tempConfig(t);
  const now = Date.now();
  writeLicenseRecord({
    key: 'K',
    activationId: 'A',
    label: 'test',
    status: 'granted',
    activationLimit: 5,
    expiresAt: null,
    validatedAt: new Date(now + 400 * DAY_MS).toISOString(),
  });
  assert.equal(licenseState(now).reason, 'CLOCK');
});

// ---------------------------------------------------------------------------
// periodic revalidation
// ---------------------------------------------------------------------------

test('revalidation is a no-op while the record is fresh', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');
  const before = polar.calls.length;
  const result = await maybeRevalidate();
  assert.equal(result.attempted, false);
  assert.equal(polar.calls.length, before); // no network on a fresh licence
});

test('revalidation refreshes an aged record and keeps it licensed', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');
  const record = readLicenseRecord().record;
  writeLicenseRecord({
    ...record,
    validatedAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
  });
  assert.equal(licenseState().revalidationDue, true);

  const result = await maybeRevalidate();
  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  const state = licenseState();
  assert.equal(state.licensed, true);
  assert.equal(state.revalidationDue, false); // the clock restarted
});

test('a key Polar no longer knows is recorded as revoked', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');
  // Polar forgets the activation (refund, key deleted from the portal)
  polar.activations.clear();
  const result = await maybeRevalidate({ force: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REVOKED');
  assert.equal(licenseState().licensed, false);
  assert.equal(licenseState().reason, 'REVOKED');
});

test('Polar unreachable: the licence survives on its grace period', async (t) => {
  tempConfig(t);
  const polar = fakePolar(t);
  await polar.ready;
  await activateLicense('GOOD-KEY');
  const validatedAt = readLicenseRecord().record.validatedAt;

  // no server on that port: this is the aeroplane, the VPN, Polar down
  process.env.LUTRIN_POLAR_API = 'http://127.0.0.1:1';
  const result = await maybeRevalidate({ force: true, timeoutMs: 1500 });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.ok(['NETWORK', 'TIMEOUT'].includes(result.reason), `unexpected reason: ${result.reason}`);
  // untouched record, still licensed: exactly what the grace period is for
  assert.equal(readLicenseRecord().record.validatedAt, validatedAt);
  assert.equal(licenseState().licensed, true);
});

/**
 * The build must SHIP an organization id.
 *
 * It is one constant in polar.mjs, it is not a secret, and it is the single
 * point of deployment configuration the whole feature rests on: released empty,
 * every `lutrin license activate` in the world fails with ORG_UNCONFIGURED and
 * nothing else in the suite notices — every other test sets LUTRIN_POLAR_ORG
 * itself, which is exactly what would hide the omission.
 */
test('the shipped build carries an organization id, overridable by the environment', (t) => {
  const previous = process.env.LUTRIN_POLAR_ORG;
  delete process.env.LUTRIN_POLAR_ORG;
  t.after(() => {
    if (previous === undefined) delete process.env.LUTRIN_POLAR_ORG;
    else process.env.LUTRIN_POLAR_ORG = previous;
  });
  const shipped = polarOrganizationId();
  assert.notEqual(
    shipped,
    '',
    'polar.mjs ships with no organization id — licensing is dead on arrival',
  );
  assert.match(
    shipped,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'the organization id must be the uuid Polar issued, not a placeholder',
  );

  // the escape hatch the rest of this suite (and any sandbox) depends on
  process.env.LUTRIN_POLAR_ORG = 'org_sandbox';
  assert.equal(polarOrganizationId(), 'org_sandbox');
});

test('with the organization id blanked, licensing fails loudly instead of half-working', async (t) => {
  tempConfig(t);
  // A fork, or a build that stripped the constant: the guard must still name the
  // cause rather than let a request go out with an empty organization_id.
  const previous = process.env.LUTRIN_POLAR_ORG;
  process.env.LUTRIN_POLAR_ORG = '   '; // blank, not absent — absent falls back to the shipped id
  t.after(() => {
    if (previous === undefined) delete process.env.LUTRIN_POLAR_ORG;
    else process.env.LUTRIN_POLAR_ORG = previous;
  });
  await assert.rejects(activateLicense('GOOD-KEY'), (e) => e.code === 'ORG_UNCONFIGURED');
});
