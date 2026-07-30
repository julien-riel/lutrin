/**
 * Where the activated license lives: `license.json`, beside config.json in the
 * user configuration root (`~/.config/lutrin` — see userConfigRoot, which
 * LUTRIN_CONFIG and XDG_CONFIG_HOME redirect). One file per machine, because one
 * machine holds one ACTIVATION of its owner's key (a seat is a person, and it is
 * Polar's billing that counts those — see polar.mjs).
 *
 * The record is SEALED with an HMAC keyed on the account (user + platform +
 * home): copying a licensed `license.json` onto another machine breaks the seal,
 * which is the whole point — otherwise one activation would license a whole team
 * by file copy and the count would mean nothing.
 *
 * That seal is a tamper flag, NOT a DRM: Lutrin is MIT and this very file tells
 * anyone reading it how to forge one. It stops a copied file and an accidental
 * edit, and it is deliberately not more than that — the paid tier is worth
 * buying for the licence and the support, not because the check is unbreakable.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userConfigRoot } from '../deck/theme.mjs';

/** Current shape of the record. Bumped if a field ever changes meaning: a
 *  record from the future is IGNORED rather than misread (an older Lutrin must
 *  not decide it holds a valid licence because it recognised three fields out
 *  of five). */
export const LICENSE_RECORD_VERSION = 1;

export const licenseFile = () => path.join(userConfigRoot(), 'license.json');

/** Fields covered by the seal, in a fixed order — the signature must not
 *  depend on JSON key order, which JSON.stringify inherits from insertion. */
const SEALED_FIELDS = [
  'v',
  'key',
  'activationId',
  'label',
  'status',
  'activationLimit',
  'expiresAt',
  'validatedAt',
];

/** HMAC key: stable for one account on one machine, and never written to disk.
 *  hostname is deliberately EXCLUDED — it changes with a VPN or a DHCP lease,
 *  and a licence that stopped applying because the Wi-Fi renamed the machine
 *  would look exactly like a bug. */
function sealKey() {
  let account = 'unknown';
  try {
    account = os.userInfo().username;
  } catch {
    // no passwd entry (some containers): the seal still works, it just binds to
    // the platform and home directory alone
  }
  return crypto
    .createHash('sha256')
    .update(`lutrin/license-seal/v1\n${account}\n${process.platform}\n${os.homedir()}`)
    .digest();
}

function seal(record) {
  const canonical = SEALED_FIELDS.map((f) => `${f}=${record[f] ?? ''}`).join('\n');
  return crypto.createHmac('sha256', sealKey()).update(canonical).digest('hex');
}

/** Constant-time comparison: a length-independent `===` on hex digests leaks
 *  nothing useful here, but timing-safe comparison is the habit worth keeping in
 *  code that verifies a signature. */
function sealMatches(record) {
  const expected = Buffer.from(seal(record), 'hex');
  const got = Buffer.from(typeof record.sig === 'string' ? record.sig : '', 'hex');
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

/**
 * Reads the sealed record. NEVER throws — a machine with no licence is the
 * normal case, and a licence that cannot be read must degrade to "unlicensed"
 * (the attribution comes back) rather than break a compilation.
 *
 * @returns {{record: object|null, error: {code: string, message: string}|null}}
 */
export function readLicenseRecord() {
  const file = licenseFile();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { record: null, error: null }; // no licence installed: normal
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      record: null,
      error: {
        code: 'LICENSE_UNREADABLE',
        message: `Licence file could not be read: ${file} — invalid JSON (${e?.message ?? e}). Run "lutrin license activate <key>" again.`,
      },
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return {
      record: null,
      error: {
        code: 'LICENSE_UNREADABLE',
        message: `Licence file ${file} must be a JSON object. Run "lutrin license activate <key>" again.`,
      },
    };
  if (parsed.v !== LICENSE_RECORD_VERSION)
    return {
      record: null,
      error: {
        code: 'LICENSE_VERSION',
        message: `Licence file ${file} was written by another version of Lutrin (format v${parsed.v ?? '?'}, expected v${LICENSE_RECORD_VERSION}). Run "lutrin license activate <key>" again.`,
      },
    };
  if (!parsed.key || !parsed.activationId)
    return {
      record: null,
      error: {
        code: 'LICENSE_INCOMPLETE',
        message: `Licence file ${file} carries no key or no activation. Run "lutrin license activate <key>" again.`,
      },
    };
  if (!sealMatches(parsed))
    return {
      record: null,
      error: {
        code: 'LICENSE_SEAL',
        message: `Licence file ${file} does not match this machine or has been edited — it is ignored. Run "lutrin license activate <key>" on this machine (each machine activates the key where it is used).`,
      },
    };
  return { record: parsed, error: null };
}

/**
 * Writes (and seals) the record, creating the configuration root if needed.
 * Mode 0600: the file holds a purchased key, which has no business being
 * world-readable on a shared machine.
 *
 * @returns {string} the path written
 */
export function writeLicenseRecord(record) {
  const root = userConfigRoot();
  const file = licenseFile();
  const body = { v: LICENSE_RECORD_VERSION, ...record };
  const sealed = { ...body, sig: seal(body) };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sealed, null, 2)}\n`, { mode: 0o600 });
  // an EXISTING file keeps its own mode through writeFileSync: fix it too, so a
  // record written by an older version stops being readable by everyone
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows, exotic filesystem: the record is written, that is what matters */
  }
  return file;
}

/** Removes the record. Returns the path if there was one to remove, null
 *  otherwise — the caller reports "no licence installed" rather than claiming a
 *  removal that did not happen. */
export function clearLicenseRecord() {
  const file = licenseFile();
  try {
    fs.rmSync(file);
    return file;
  } catch {
    return null;
  }
}

/** Label shown in the customer's Polar portal to identify this ACTIVATION. The
 *  customer has to recognise their own machines to free one up, so hostname is
 *  the useful half; the username disambiguates two accounts on one machine. */
export function activationLabel() {
  let user = 'unknown';
  try {
    user = os.userInfo().username;
  } catch {
    /* see sealKey */
  }
  return `${os.hostname()} (${user})`;
}
