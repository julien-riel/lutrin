/**
 * The site's instrumentation — the tag and the ids.
 *
 * Every failure below is invisible from a dashboard, which is the whole
 * problem: no visitors and no tracker look exactly alike from there.
 *
 *   1. A PAGE THAT SHIPS BLIND. A page added without the tag records nothing
 *      at all, and a page recording nothing reads exactly like a page nobody
 *      visits. The pages that legitimately carry no tracker are therefore an
 *      explicit list here, so the absence is a decision on the record.
 *   2. A SITEMAP THAT FELL BEHIND. The set of pages worth measuring and the
 *      set worth indexing are the same set, and they drifted apart the moment
 *      one of them was maintained by hand alone.
 *
 * The site id and the domain are READ OUT OF `site/README.md` rather than
 * copied here: a second copy is a copy that drifts, and this way the file that
 * documents the tag is the file that authorizes it.
 *
 * This file used to guard a third thing — the UTM parameters on the checkout
 * links that sold a licence. There is no paid tier and no checkout any more,
 * so those checks went with them rather than being kept alive over an empty
 * set.
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
// 0. the pages this file reads really were read
// ---------------------------------------------------------------------------

test('there really are pages under site/ to hold to the rules below', () => {
  // A glob that silently returned nothing would make every check below pass
  // over an empty set — a green suite guarding nothing, which is the exact
  // shape of the failure this file was written against.
  assert.ok(
    TRACKED.length > 0,
    'no page found under site/ — this whole file would pass on nothing',
  );
});

// ---------------------------------------------------------------------------
// 1. the tag itself
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
// 2. the same set of pages, indexed
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
