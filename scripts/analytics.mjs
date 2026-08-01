#!/usr/bin/env node
/**
 * Reads the site's traffic — `npm run analytics [-- --days 30] [-- --json]`.
 *
 * The point of this file is that the numbers are readable WITHOUT a browser
 * session: by a person in a terminal, and by an agent doing a weekly check.
 * That was the criterion that picked Umami over Plausible (see decision 1 of
 * docs/plans/site-and-revenue-checklist.md), and a dashboard nobody can query
 * is a dashboard that gets looked at once.
 *
 * Two ways in, and the free one is not documented anywhere upstream:
 *
 *   - **Share URL** (what the free plan allows). `GET /api/share/<shareId>`
 *     returns a token; that token, WITH `x-umami-share-context: 1`, answers
 *     the ordinary stats endpoints. The context header is not optional and
 *     appears on no documentation page — it was found by watching what
 *     Umami's own shared dashboard sends. Remember what it implies: a Share
 *     URL is public, so anyone holding the link reads these numbers.
 *   - **API key** (Pro, $20/month). Same endpoints under
 *     `https://api.umami.is/v1` with `x-umami-api-key`. Supported here so
 *     that upgrading changes one line of JSON and nothing else.
 *
 * Credentials live in `<config>/analytics.json`, never in this repository —
 * `userConfigRoot()` is the same root the CLI uses, so LUTRIN_CONFIG moves
 * both together:
 *
 *     { "provider": "umami", "websiteId": "…", "shareId": "…", "region": "us" }
 */

import fs from 'node:fs';
import path from 'node:path';
import { userConfigRoot } from '../packages/core/src/deck/theme.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const days = Number(flag('--days', '7'));
const asJson = argv.includes('--json');

const CONFIG = path.join(userConfigRoot(), 'analytics.json');

/** Stops with the thing to DO, not with a stack: the whole failure mode of
 *  this script is a file that was never created. */
function fail(message, hint) {
  console.error(`✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

if (!fs.existsSync(CONFIG))
  fail(
    `no analytics credentials at ${CONFIG}`,
    'Create it (chmod 600): { "provider": "umami", "websiteId": "…", "shareId": "…", "region": "us" }',
  );

let conf;
try {
  conf = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
} catch (e) {
  fail(`${CONFIG} is not valid JSON (${e?.message ?? e})`);
}

const { websiteId, shareId, apiKey, region = 'us' } = conf;
if (!websiteId) fail(`${CONFIG} declares no "websiteId"`);
if (!shareId && !apiKey)
  fail(
    `${CONFIG} declares neither "shareId" nor "apiKey"`,
    'The free plan has no API key — enable a Share URL and put its id here.',
  );

const gateway = `https://gateway-${region === 'eu' ? 'eu' : 'us'}.umami.is`;
const base = apiKey ? 'https://api.umami.is/v1' : gateway;

/** The auth headers for whichever way in is configured. */
async function headers() {
  if (apiKey) return { 'x-umami-api-key': apiKey };
  const res = await fetch(`${gateway}/api/share/${shareId}`);
  if (!res.ok)
    fail(
      `share id refused: HTTP ${res.status}`,
      'Regenerated or revoked? The Share URL is under Websites → Edit → Share URL.',
    );
  const { token } = await res.json();
  if (!token) fail('the share endpoint returned no token');
  // BOTH headers, always: the token alone answers 401, which is the one thing
  // about this route that costs an hour if it is not written down.
  return { 'x-umami-share-token': token, 'x-umami-share-context': '1' };
}

const end = Date.now();
const start = end - days * 86_400_000;
const auth = await headers();

async function get(pathAndQuery) {
  const url = `${base}/api/websites/${websiteId}/${pathAndQuery}`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) fail(`HTTP ${res.status} on ${pathAndQuery}`, (await res.text()).slice(0, 200));
  return res.json();
}

// `channel`, not `utm_medium`: this route accepts path, event, referrer,
// channel and query, and refuses the utm_* types outright (measured, not
// assumed). It would answer the wrong question anyway — the UTM parameters on
// the site's `buy.polar.sh` links travel OUT to Polar and are read there.
// Umami only ever sees UTM parameters on links pointing IN, which is what
// `channel` summarises.
const range = `startAt=${start}&endAt=${end}`;
const [stats, pages, events, referrers, channels] = await Promise.all([
  get(`stats?${range}`),
  get(`metrics?${range}&type=path&limit=10`),
  get(`metrics?${range}&type=event&limit=10`),
  get(`metrics?${range}&type=referrer&limit=10`),
  get(`metrics?${range}&type=channel&limit=10`),
]);

if (asJson) {
  console.log(JSON.stringify({ days, stats, pages, events, referrers, channels }, null, 2));
  process.exit(0);
}

const n = (v) => (typeof v === 'object' ? (v?.value ?? 0) : (v ?? 0));
/** `x`/`y` is what the metrics endpoints return: label and count. */
const table = (title, rows, empty) => {
  console.log(`\n${title}`);
  if (!rows.length) return console.log(`  ${empty}`);
  for (const r of rows) console.log(`  ${String(r.y).padStart(4)}  ${r.x || '(direct)'}`);
};

console.log(`Last ${days} day${days > 1 ? 's' : ''} — ${apiKey ? 'API key' : 'share link'}`);
console.log(
  `  ${n(stats.pageviews)} pageviews · ${n(stats.visitors)} visitors · ` +
    `${n(stats.visits)} visits · ${n(stats.bounces)} bounces · ` +
    `${Math.round(n(stats.totaltime) / 60)} min on the site`,
);
table('PAGES', pages, '(nothing yet)');
// The three wired in site/assets/js/main.js: command copied, pptx downloaded,
// deck opened. An empty list here means the events are not reaching Umami —
// worth noticing, since nothing else on the site would say so.
table('CUSTOM EVENTS', events, '(none — check that the tracker is on the page)');
table('REFERRERS', referrers, '(direct only)');
table('CHANNELS', channels, '(direct only)');
// Which of the six checkout links converts is NOT here and cannot be: the
// utm_source/medium/campaign on each `buy.polar.sh` link leaves with the
// visitor and is read by Polar. Umami's last sight of a buyer is the page
// they left from — and not even the click, since no event is wired to it.
console.log('\nCheckout attribution lives in Polar: the UTM leaves with the visitor.');
