/**
 * Polar (polar.sh) license-key client — the three customer-portal endpoints
 * Lutrin needs, and nothing else.
 *
 * These endpoints are PUBLIC (no bearer token): the license key itself is the
 * credential, which is what lets a CLI installed on a customer's machine talk
 * to Polar without shipping an organization secret. Never add an access token
 * here — it would end up in a published npm tarball.
 *
 * TWO COUNTS, not to be confused — the mistake is easy and it reached the docs
 * once already:
 *   • a SEAT is a person, and it is Polar's billing that counts them. The
 *     subscription is priced per seat, seats are assigned by email, and each
 *     member receives THEIR OWN license key. Nothing in this file sees seats.
 *   • an ACTIVATION is a machine, counted per key by `limit_activations`. That
 *     is the only count this module deals with: `activate` consumes one,
 *     `deactivate` returns one, and Polar answers 403 when a key has no
 *     activation left — a business signal, not a transport error.
 *
 * The products sold today set NO activation cap (a customer installs on as many
 * machines as they work on), so the 403 path is currently unreachable in
 * production. It is kept, and tested, because the cap is one field in the
 * Polar benefit: turning it on must not require a release of the CLI.
 */

/** Organization that issues the keys. Not a secret — it travels in the body of
 *  every request, and the customer-portal endpoints are authenticated by the
 *  license key itself, not by us. `LUTRIN_POLAR_ORG` overrides it, for a sandbox
 *  organization or a test. */
const ORGANIZATION_ID = '394a2464-5d91-4c6f-98eb-4728ea2ecf99';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Failure carrying a stable `code` — the callers (CLI, hosts) map it onto a
 *  message and an exit status, and must never have to match on wording. */
export class LicenseError extends Error {
  constructor(code, message, { status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'LicenseError';
    this.code = code;
    this.status = status;
  }
}

export const polarApiBase = () =>
  (process.env.LUTRIN_POLAR_API || 'https://api.polar.sh').replace(/\/+$/, '');

export const polarOrganizationId = () => (process.env.LUTRIN_POLAR_ORG || ORGANIZATION_ID).trim();

/**
 * POSTs to a customer-portal endpoint and returns the parsed body (null on
 * 204). Turns every failure into a LicenseError with a code, so that no caller
 * ever sees a raw fetch rejection.
 *
 * 404 is deliberately NOT reported as "wrong key" alone: Polar answers 404 both
 * for a key it does not know and for a key that belongs to another
 * organization, and a misconfigured ORGANIZATION_ID would otherwise send the
 * user hunting for a typo in a key that is perfectly valid.
 */
async function post(endpoint, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const organizationId = polarOrganizationId();
  if (!organizationId)
    throw new LicenseError(
      'ORG_UNCONFIGURED',
      'This build of Lutrin carries no Polar organization id — licensing is unavailable. Set LUTRIN_POLAR_ORG, or report the issue at https://github.com/julien-riel/lutrin/issues.',
    );

  const url = `${polarApiBase()}/v1/customer-portal/license-keys/${endpoint}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...body, organization_id: organizationId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // AbortSignal.timeout rejects with a TimeoutError; everything else here is
    // DNS, TLS or a dead link — both mean "we could not ask", which is what the
    // offline grace period exists for
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new LicenseError(
      timedOut ? 'TIMEOUT' : 'NETWORK',
      timedOut
        ? `Polar did not answer within ${Math.round(timeoutMs / 1000)} s (${url}).`
        : `Could not reach Polar (${url}): ${e?.message ?? e}`,
      { cause: e },
    );
  }

  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null; // an error page, a proxy: the status carries the meaning
  }
  if (res.ok) return payload;

  const detail = detailOf(payload);
  if (res.status === 403)
    throw new LicenseError(
      'ACTIVATIONS_EXHAUSTED',
      `This licence key is already active on all the machines it allows${detail ? ` — ${detail}` : ''}. Run "lutrin license deactivate" on a machine you no longer use, or free one from the Polar customer portal.`,
      { status: res.status },
    );
  if (res.status === 404)
    throw new LicenseError(
      'KEY_UNKNOWN',
      `Polar does not know this license key${detail ? ` — ${detail}` : ''}. Check the key you pasted (and, if you build Lutrin yourself, that LUTRIN_POLAR_ORG is the organization that issued it).`,
      { status: res.status },
    );
  if (res.status === 422)
    throw new LicenseError(
      'INVALID_REQUEST',
      `Polar rejected the request${detail ? ` — ${detail}` : ''}.`,
      { status: res.status },
    );
  throw new LicenseError('HTTP', `Polar answered ${res.status}${detail ? ` — ${detail}` : ''}.`, {
    status: res.status,
  });
}

/** Human-readable part of a Polar error body ({detail: string} or the FastAPI
 *  validation shape {detail: [{msg, loc}]}). The trailing full stop is trimmed:
 *  Polar punctuates its sentences, our messages continue afterwards, and the
 *  two together produced "does not exist.. Check the key you pasted". */
function detailOf(payload) {
  const d = payload?.detail;
  const text =
    typeof d === 'string'
      ? d
      : Array.isArray(d)
        ? d
            .map((e) => e?.msg)
            .filter(Boolean)
            .join('; ')
        : '';
  return text.replace(/\.\s*$/, '');
}

/**
 * Consumes one of the key's activations for this machine.
 *
 * @param {string} key    the license key, as pasted by the customer
 * @param {object} opts   `label` identifies the machine in the customer portal
 *                        (hostname + user, so that a customer can tell their
 *                        own machines apart when freeing one up)
 * @returns {Promise<{activationId: string, licenseKey: object}>}
 */
export async function activateKey(key, { label, meta = undefined, timeoutMs } = {}) {
  const payload = await post('activate', { key, label, meta }, { timeoutMs });
  const activationId = payload?.id;
  if (!activationId)
    throw new LicenseError('INVALID_RESPONSE', 'Polar accepted the activation but returned no id.');
  return { activationId, licenseKey: payload.license_key ?? null };
}

/**
 * Re-checks a key already activated on this machine. `activation_id` is
 * REQUIRED by Polar as soon as the key limits activations — which every
 * key with an activation cap does — so it is passed unconditionally.
 *
 * `increment_usage` is never sent: activations are not metered usage, and quietly
 * burning a usage unit on every build would exhaust a `limit_usage` the
 * customer never agreed to spend that way.
 *
 * @returns {Promise<object>} the license-key object (status, expires_at, …)
 */
export async function validateKey(key, { activationId, timeoutMs } = {}) {
  const payload = await post(
    'validate',
    { key, activation_id: activationId ?? null },
    { timeoutMs },
  );
  if (!payload?.status)
    throw new LicenseError('INVALID_RESPONSE', 'Polar returned a license key with no status.');
  return payload;
}

/** Frees the activation this machine holds, so another can take it. */
export async function deactivateKey(key, activationId, { timeoutMs } = {}) {
  await post('deactivate', { key, activation_id: activationId }, { timeoutMs });
}
