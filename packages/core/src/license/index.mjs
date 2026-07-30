/**
 * Licence state, and the one question the renderers ask: does this deck carry
 * the Lutrin attribution?
 *
 * Design rule — NO NETWORK ON THE COMPILATION PATH. `licenseState()` is
 * synchronous and reads a single small file: a build never waits on Polar, never
 * fails because the customer is on a plane, and never slows a preview down.
 * The network is touched in exactly two places: `activateLicense()` (an explicit
 * command) and `maybeRevalidate()`, which the CLI calls AFTER the deck is
 * written, at most once a week.
 *
 * Two clocks decide the rest:
 *   • REVALIDATE_AFTER — beyond this, the next command tries Polar again.
 *   • OFFLINE_GRACE    — beyond this, with no successful validation, the licence
 *                        stops applying and the attribution comes back.
 * The gap between the two is what a revoked or refunded key costs us, and what
 * an offline customer is allowed before being nagged.
 */
import {
  LicenseError,
  activateKey,
  deactivateKey,
  polarOrganizationId,
  validateKey,
} from './polar.mjs';
import {
  clearLicenseRecord,
  licenseFile,
  readLicenseRecord,
  activationLabel,
  writeLicenseRecord,
} from './store.mjs';

export { LicenseError, licenseFile, polarOrganizationId };

const DAY_MS = 86_400_000;
const REVALIDATE_AFTER_MS = 7 * DAY_MS;
const OFFLINE_GRACE_MS = 30 * DAY_MS;

/**
 * Attribution carried by every deck compiled without a licence. Single source
 * of truth for both renderers — HTML and PPTX must never drift.
 *
 * ENGLISH, deliberately, and not localised from the deck's `lang`. It used to
 * read "Généré avec Lutrin", which put a French line on a product whose site,
 * README and every diagnostic are in English: an anglophone buyer shipped a
 * client deck carrying it by accident rather than by choice. Localising it
 * instead would be more correct and is the tempting answer, but it makes the
 * attribution a feature with a matrix to maintain — and the one string a
 * customer pays to remove is not where translation earns its keep.
 */
export const BRAND_MENTION = 'Made with Lutrin';

/** Polar's `status` for a key that is actually usable. Anything else (`revoked`,
 *  `disabled`) means the licence no longer applies. */
const GRANTED = 'granted';

const ms = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? null : t;
};

/**
 * Is a licence in force on this machine, and why not?
 *
 * Synchronous, never throws. `reason` is 'OK' when licensed, otherwise a stable
 * code the CLI turns into a sentence:
 *   NO_LICENSE   nothing installed (the common case)
 *   LICENSE_*    the record is unreadable, sealed for another machine, …
 *   REVOKED      Polar reported a status other than `granted`
 *   EXPIRED      past `expires_at`
 *   STALE        no successful validation for longer than the grace period
 *   CLOCK        the record claims a validation in the future
 *
 * @param {number} [now] milliseconds — injectable so tests can age a record
 *                       without touching the system clock
 * @returns {{licensed: boolean, reason: string, record: object|null,
 *            error: object|null, revalidationDue: boolean,
 *            expiresAt: number|null, validatedAt: number|null}}
 */
export function licenseState(now = Date.now()) {
  const { record, error } = readLicenseRecord();
  const base = { record, error, revalidationDue: false, expiresAt: null, validatedAt: null };
  if (!record) return { ...base, licensed: false, reason: error ? error.code : 'NO_LICENSE' };

  const expiresAt = ms(record.expiresAt);
  const validatedAt = ms(record.validatedAt);
  const state = { ...base, expiresAt, validatedAt };

  if (record.status !== GRANTED) return { ...state, licensed: false, reason: 'REVOKED' };
  if (expiresAt != null && expiresAt <= now)
    return { ...state, licensed: false, reason: 'EXPIRED' };
  // A record with no readable validatedAt is treated as never validated rather
  // than as freshly validated: the failure mode has to be "asks Polar again",
  // not "trusts a field it could not parse".
  if (validatedAt == null)
    return { ...state, licensed: false, reason: 'STALE', revalidationDue: true };
  // A clock pushed forward would otherwise buy an unlimited grace period; one
  // day of tolerance absorbs timezone and NTP skew.
  if (validatedAt > now + DAY_MS) return { ...state, licensed: false, reason: 'CLOCK' };

  const age = now - validatedAt;
  if (age > OFFLINE_GRACE_MS)
    return { ...state, licensed: false, reason: 'STALE', revalidationDue: true };
  return {
    ...state,
    licensed: true,
    reason: 'OK',
    revalidationDue: age > REVALIDATE_AFTER_MS,
  };
}

/**
 * The attribution to paint, or null when the deck goes out unbranded.
 *
 * `opts.branding` overrides the licence — `false` for a host that paints the
 * mention itself, `true` for the tests that must see it whatever the developer
 * running them happens to have installed. Anything else asks the licence.
 */
export function brandMention(opts = {}) {
  if (opts.branding === false) return null;
  if (opts.branding === true) return BRAND_MENTION;
  return licenseState().licensed ? null : BRAND_MENTION;
}

/** Fields of a Polar license-key object worth keeping locally. `usage` and
 *  `validations` are NOT stored: they are counters owned by Polar, and a stale
 *  copy of them in a local file can only mislead. */
const recordFrom = (key, activationId, licenseKey, now) => ({
  key,
  activationId,
  label: activationLabel(),
  status: licenseKey?.status ?? GRANTED,
  activationLimit: licenseKey?.limit_activations ?? null,
  expiresAt: licenseKey?.expires_at ?? null,
  validatedAt: new Date(now).toISOString(),
  displayKey: licenseKey?.display_key ?? null,
});

/**
 * Activates this machine on the key and stores the sealed record.
 *
 * An existing record is DEACTIVATED first, best effort: re-running `activate` on
 * a machine that already holds an activation would otherwise burn a second one,
 * and a key good for 5 machines would run out after two reinstalls. The
 * deactivation failing is not fatal — the new activation is what the user asked
 * for, and a leaked one can be freed from the customer portal.
 *
 * @returns {Promise<{file: string, state: object, releasedPreviousActivation: boolean}>}
 */
export async function activateLicense(key, { timeoutMs, now = Date.now() } = {}) {
  const trimmed = (key ?? '').trim();
  if (!trimmed) throw new LicenseError('KEY_MISSING', 'No licence key given.');

  const previous = readLicenseRecord().record;
  let releasedPreviousActivation = false;
  if (previous?.key && previous?.activationId) {
    try {
      await deactivateKey(previous.key, previous.activationId, { timeoutMs });
      releasedPreviousActivation = true;
    } catch {
      // already freed from the portal, offline, or a key that no longer exists:
      // none of it should stop the activation the user is asking for
    }
  }

  const { activationId, licenseKey } = await activateKey(trimmed, {
    label: activationLabel(),
    timeoutMs,
  });
  // `activate` answers with the key embedded, but not every deployment fills
  // `status`/`expires_at` there — one validate call settles it, and it is also
  // the call that proves the activation we just created actually validates.
  let resolved = licenseKey;
  if (!resolved?.status) {
    try {
      resolved = await validateKey(trimmed, { activationId, timeoutMs });
    } catch {
      resolved = licenseKey; // keep the activation; the weekly revalidation will fill the gaps
    }
  }
  const file = writeLicenseRecord(recordFrom(trimmed, activationId, resolved, now));
  return { file, state: licenseState(now), releasedPreviousActivation };
}

/**
 * Frees this machine's activation and removes the local record.
 *
 * The record is removed EVEN IF Polar could not be reached: a user who runs
 * `deactivate` wants this machine to stop using the licence, and leaving the
 * record in place would keep the deck unbranded on a machine they consider
 * released. The activation may then linger on Polar's side — reported, so it can be
 * freed from the portal.
 *
 * @returns {Promise<{removed: string|null, activationFreed: boolean, error: LicenseError|null}>}
 */
export async function deactivateLicense({ timeoutMs } = {}) {
  const record = readLicenseRecord().record;
  let activationFreed = false;
  let error = null;
  if (record?.key && record?.activationId) {
    try {
      await deactivateKey(record.key, record.activationId, { timeoutMs });
      activationFreed = true;
    } catch (e) {
      error = e;
    }
  }
  return { removed: clearLicenseRecord(), activationFreed, error };
}

/**
 * Asks Polar again if the last successful validation is old enough — the
 * periodic half of "activate online, then run offline".
 *
 * Called by the CLI AFTER the deck has been written, so a slow answer delays
 * nothing the user is waiting for, with a short timeout because nobody is
 * waiting for it at all. Never throws.
 *
 * A key Polar no longer knows (refunded, deleted) is recorded as revoked, which
 * brings the attribution back on the very next build instead of at the end of
 * the grace period.
 *
 * @returns {Promise<{attempted: boolean, ok: boolean, reason: string|null}>}
 */
export async function maybeRevalidate({ timeoutMs = 4000, force = false, now = Date.now() } = {}) {
  const state = licenseState(now);
  const record = state.record;
  if (!record) return { attempted: false, ok: false, reason: state.reason };
  if (!force && !state.revalidationDue) return { attempted: false, ok: true, reason: null };

  try {
    const licenseKey = await validateKey(record.key, {
      activationId: record.activationId,
      timeoutMs,
    });
    writeLicenseRecord(recordFrom(record.key, record.activationId, licenseKey, now));
    return { attempted: true, ok: true, reason: null };
  } catch (e) {
    if (e?.code === 'KEY_UNKNOWN') {
      writeLicenseRecord({ ...record, status: 'revoked' });
      return { attempted: true, ok: false, reason: 'REVOKED' };
    }
    // offline, timeout, Polar down: the grace period is exactly what covers
    // this, and the record keeps its previous validatedAt
    return { attempted: true, ok: false, reason: e?.code ?? 'UNKNOWN' };
  }
}

/** Days the licence may still be used without reaching Polar — for
 *  `license status`, which is the only place a countdown is useful. */
export function graceDaysLeft(state = licenseState()) {
  if (state.validatedAt == null) return 0;
  const left = (state.validatedAt + OFFLINE_GRACE_MS - Date.now()) / DAY_MS;
  return Math.max(0, Math.floor(left));
}

export const LICENSE_CLOCKS = { REVALIDATE_AFTER_MS, OFFLINE_GRACE_MS, DAY_MS };
