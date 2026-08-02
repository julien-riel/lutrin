/**
 * The site's instrumentation — the tag, the ids, and the UTM on the checkout
 * links.
 *
 * `site/README.md` was the only thing holding this together, in a sentence:
 * *"When adding a checkout link, give it a UTM."* A sentence fails silently,
 * and every failure below is invisible from a dashboard — which is the whole
 * problem, because no visitors and no tracker look exactly alike from there.
 *
 *   1. A CHECKOUT LINK WITH NO UTM. It converts, Polar records the order, and
 *      this site's report files the click under direct traffic —
 *      indistinguishable from the two other links pointing at the same
 *      product. Knowing WHICH ONE persuades is the entire reason the
 *      parameters are on the link.
 *   2. A PLACEMENT INVENTED ON THE SPOT. `utm_medium=pricing_table` instead of
 *      `pricing-table` does not fail anywhere: it opens a second row in the
 *      report, splits the count between them, and both look small.
 *   3. A PAGE THAT SHIPS BLIND. A page added without the tag records nothing
 *      at all, and a page recording nothing reads exactly like a page nobody
 *      visits. The pages that legitimately carry no tracker are therefore an
 *      explicit list here, so the absence is a decision on the record.
 *   4. A SITEMAP THAT FELL BEHIND. The set of pages worth measuring and the
 *      set worth indexing are the same set, and they drifted apart the moment
 *      one of them was maintained by hand alone.
 *
 * The placement and tier lists are READ OUT OF `site/README.md` rather than
 * copied here. A second list is a list that drifts, and this way the file that
 * documents a placement is the file that authorizes it: add the row there
 * first, and this test is what makes that order the cheap one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SITE = path.join(REPO, 'site');
const README = fs.readFileSync(path.join(SITE, 'README.md'), 'utf8');

/** The origin the site is actually served from — the one every `<loc>` of the
 *  sitemap has to agree with. */
const PUBLIC_ORIGIN = 'https://info.lutrin.app';

const UMAMI_SRC = 'https://cloud.umami.is/script.js';

/**
 * Pages that must NOT carry the tracker, each with the reason.
 *
 * The list is the point. "This page has no tag" and "someone forgot the tag"
 * are the same fact on disk, and only an explicit entry tells them apart —
 * so a new page is instrumented by default, and an exemption has to be
 * written down before the suite goes green.
 */
const UNTRACKED = new Map([
  [
    'demo.html',
    'the compiled demo deck — output of `npm run site`, not a page of the site (absent from the sitemap and from robots.txt for the same reason)',
  ],
]);

/**
 * The body of a `###` section of `site/README.md`, up to the next heading of
 * that level.
 *
 * Not a convenience: the file carries TWO `utm_medium` tables — one for the
 * links going OUT to Polar, one for the announcements coming IN — and only the
 * first authorizes a checkout placement. Reading the whole file would quietly
 * admit `hn-comment` as a placement.
 */
function section(title) {
  const from = README.indexOf(`### ${title}`);
  assert.notEqual(
    from,
    -1,
    `site/README.md no longer has a "### ${title}" section — this test reads its lists from it`,
  );
  const rest = README.slice(from + 4);
  const to = rest.indexOf('\n### ');
  return to === -1 ? rest : rest.slice(0, to);
}

const OUTGOING = section('UTM going out — the checkout links');

/** `| \`card\` | a tier card on the landing page |` → `card` */
const PLACEMENTS = [...OUTGOING.matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|/gm)].map((m) => m[1]);

/** "`utm_campaign` is the tier: `solo`, `team`, …" — one sentence, wrapped
 *  across lines by the formatter, hence the lazy scan up to the full stop. */
const TIERS = (() => {
  const m = /`utm_campaign` is the tier:([\s\S]*?)\./.exec(OUTGOING);
  assert.ok(m, 'site/README.md no longer names the tiers — this test reads them from it');
  return [...m[1].matchAll(/`([a-z][a-z-]*)`/g)].map((x) => x[1]);
})();

/** The tag as `site/README.md` publishes it: the id and the domain come from
 *  the document, so the document and the pages cannot disagree. */
const TAG = (() => {
  const m = /data-website-id="([0-9a-f-]{36})"[\s\S]{0,200}?data-domains="([^"]+)"/.exec(README);
  assert.ok(
    m,
    'site/README.md no longer shows the Umami tag — this test reads the site id and the domain from it',
  );
  return { websiteId: m[1], domains: m[2] };
})();

const PAGES = fs
  .readdirSync(SITE)
  .filter((f) => f.endsWith('.html'))
  .sort();
const TRACKED = PAGES.filter((f) => !UNTRACKED.has(f));

// ---------------------------------------------------------------------------
// 0. the lists this file reads really were read
// ---------------------------------------------------------------------------

test('the placement and tier lists come out of site/README.md, and are not empty', () => {
  // A parse that silently returned nothing would make every check below pass
  // over an empty set — a green suite guarding nothing, which is the exact
  // shape of the failure this file was written against.
  assert.ok(
    PLACEMENTS.length >= 2,
    `only ${PLACEMENTS.length} placement(s) parsed out of site/README.md — the table's shape changed`,
  );
  assert.ok(
    TIERS.length >= 2,
    `only ${TIERS.length} tier(s) parsed out of site/README.md — the sentence's shape changed`,
  );
  assert.ok(
    TRACKED.length > 0,
    'no page found under site/ — this whole file would pass on nothing',
  );
});

// ---------------------------------------------------------------------------
// 1. the UTM going out
// ---------------------------------------------------------------------------

test('every checkout link carries a UTM, and one site/README.md authorizes', () => {
  const faults = [];
  let seen = 0;
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    for (const [, raw] of html.matchAll(/href="(https:\/\/buy\.polar\.sh\/[^"]*)"/g)) {
      seen++;
      // an href is HTML: the separators are written `&amp;`
      const url = new URL(raw.replaceAll('&amp;', '&'));
      const q = url.searchParams;
      const where = `${page}: …${url.pathname.slice(-12)}`;
      const got = (k) => q.get(k) ?? 'absent';
      if (q.get('utm_source') !== 'site')
        faults.push(`${where} — utm_source is "${got('utm_source')}", expected "site"`);
      if (!PLACEMENTS.includes(q.get('utm_medium')))
        faults.push(
          `${where} — utm_medium "${got('utm_medium')}" is no placement of site/README.md (${PLACEMENTS.join(', ')})`,
        );
      if (!TIERS.includes(q.get('utm_campaign')))
        faults.push(
          `${where} — utm_campaign "${got('utm_campaign')}" is no tier of site/README.md (${TIERS.join(', ')})`,
        );
    }
  }
  assert.deepEqual(
    faults,
    [],
    'checkout links the report cannot tell apart — add the row to site/README.md first, then the link',
  );
  assert.ok(seen > 0, 'no buy.polar.sh link found under site/ — this check would pass on nothing');
});

// ---------------------------------------------------------------------------
// 2. the tag itself
// ---------------------------------------------------------------------------

test('every page carries the tracker, with the site id and the domain of site/README.md', () => {
  const faults = [];
  for (const page of TRACKED) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    if (!html.includes(UMAMI_SRC)) {
      faults.push(
        `${page} — no tracker at all: it records nothing, and reads as a page nobody visits`,
      );
      continue;
    }
    if (!html.includes(`data-website-id="${TAG.websiteId}"`))
      faults.push(
        `${page} — site id differs from the one site/README.md publishes (${TAG.websiteId})`,
      );
    // Without data-domains the tracker reports from ANY host it is served
    // from, so `npm run site:serve` on 127.0.0.1 would post into the real
    // numbers. Its absence costs correctness, not coverage.
    if (!html.includes(`data-domains="${TAG.domains}"`))
      faults.push(
        `${page} — data-domains absent or not "${TAG.domains}": local work would pollute the numbers`,
      );
  }
  assert.deepEqual(faults, [], 'pages the dashboard cannot see, or sees under the wrong site');
});

test('a page carrying no tracker is a decision on the record', () => {
  for (const [page, why] of UNTRACKED) {
    const file = path.join(SITE, page);
    // demo.html is compiled output and gitignored: absent from a fresh clone,
    // which is not a failure — there is simply nothing to hold to the rule.
    if (!fs.existsSync(file)) continue;
    assert.ok(
      !fs.readFileSync(file, 'utf8').includes(UMAMI_SRC),
      `${page} now carries the tracker, while this file lists it as deliberately untracked (${why}) — drop the entry, or the tag`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. the same set of pages, indexed
// ---------------------------------------------------------------------------

test('the sitemap lists exactly the pages that are instrumented', () => {
  const xml = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  // the landing page is served at the origin itself, never as /index.html
  const expected = TRACKED.map((p) =>
    p === 'index.html' ? `${PUBLIC_ORIGIN}/` : `${PUBLIC_ORIGIN}/${p}`,
  ).sort();
  assert.deepEqual(
    listed,
    expected,
    'the sitemap and the instrumented pages disagree — a page worth measuring is a page worth indexing, and the two lists are maintained in one gesture or not at all',
  );
});
