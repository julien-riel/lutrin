# `site/` — the landing pages

Static source. **No build step, no bundler, no dependency**, and that is a
constraint rather than an accident: everything here is served exactly as it is
committed. `.github/workflows/pages.yml` copies this directory into `_site/`,
drops in a `demo.html` and a `demo.pptx` compiled from `examples/demo.deck.md`
by the engine at `HEAD`, and deploys the result to GitHub Pages.

| File | What it is |
| --- | --- |
| `index.html` | the landing page, including the tiers and the FAQ |
| `playground.html` | the compiler, running in the visitor's browser — see below |
| `pricing.html` | all five purchase options, in USD and CAD |
| `gallery.html` | eight kits, one deck — see below |
| `kit-editor.html` | a tour of `lutrin kit edit`, from committed screenshots |
| `lutrin-vs-*.html` | four comparison pages, one template, each dated |
| `robots.txt`, `sitemap.xml` | **add a line to the sitemap for every new page** |
| `CNAME` | the custom domain — see below |
| `demo.html`, `demo.pptx` | **compiled by CI, never committed** (gitignored) |
| `gallery/`, `kits/` | **built by `scripts/gallery.mjs`, never committed** (gitignored) |

The slides on the landing page are not screenshots: they are `<iframe>`s onto
the real compiled deck, cropped to one slide and scaled by `assets/js/main.js`.
That is the rule the whole site holds itself to — nothing here may show
something the compiler does not actually produce.

## The domain

`CNAME` carries **`info.lutrin.app`**, and that is the host every absolute URL
in this repository names. It is not a preference — it is what is actually
served: `info.lutrin.app` is a `CNAME` onto `julien-riel.github.io`, resolves to
the four GitHub Pages addresses, and `GET repos/julien-riel/lutrin/pages`
answers `"cname": "info.lutrin.app"`. `cp -R site/.` in the Pages workflow
carries the file into the artifact, so no workflow change is needed.

**The apex `lutrin.app` does not serve this site**, and pointing anything at it
would take the site down rather than move it. It resolves to a registrar's
address (OVH) and answers with a redirect to `www.lutrin.app`, which does not
resolve at all. The mailbox is a different matter: `contact@lutrin.app` rides
on MX records and is unaffected by any of this — which is why the site
advertises an apex address while linking an `info.` host.

**The `CNAME` file and the Pages setting must agree, and both must match DNS.**
GitHub reads the file out of each artifact: a deploy carrying `lutrin.app`
would switch the custom domain to a host that answers from OVH, redirect
`julien-riel.github.io/lutrin` there with a 301 browsers cache hard, and take
the site off the air. That is the failure this file exists to prevent.

Still a person's, both outside this repository:

- **`Enforce HTTPS`** in *Settings → Pages*. The certificate is issued and
  `https://info.lutrin.app/` answers 200 today, but the API still reports
  `https_enforced: false`, so plain `http://` is served rather than redirected.
- **Moving to the apex, if that is ever wanted.** Four `A` records on
  `lutrin.app` to `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` (or an
  `ALIAS`/`ANAME`), then `CNAME`, the Pages setting and every absolute URL in
  the repository change together — `git grep info.lutrin.app` is the list.

`lutrin.dev` and `lutrin.ai` are held but not served. GitHub Pages accepts
exactly one custom domain, so they must never be added to `CNAME`.

## Running it locally

```sh
npm run site          # once — compiles demo.html, demo.pptx and the gallery
npm run site:serve    # http://127.0.0.1:4400/
```

**Opening a page with `file://` does not work, and cannot be made to.** The
playground needs a real origin: modules loaded from `file://` get an opaque one
and `fetch` is refused outright.

`site:serve` copies nothing. It maps three virtual routes onto the working
copy — `/core/src` → `packages/core/src`, `/core/design/layouts` →
`packages/core/design/layouts` (with the manifest generated per request), and
`/vendor/<pkg>` → `node_modules/<pkg>` — so **editing the compiler and
reloading the page shows the change**, with no restart and no build step. The
Pages workflow does the same mapping with `cp`, because a deploy has no
working copy to point at.

Which packages `/vendor/` will serve is read out of the import map in
`playground.html` rather than listed in the script: there are already two
copies of that list (the map and the workflow) and a test that keeps them
equal, and a third copy is the one nobody would remember to update.

Pass a port if 4400 is taken: `npm run site:serve -- 4500`.

## The playground

`playground.html` runs **the real compiler** — `packages/core/src`, served
verbatim and imported unchanged. Not a re-implementation, not a server call, and
verified: on four decks the browser produced scenes, stylesheet and HTML
**byte-identical** to Node's.

There is still **no build step**. What makes that possible:

- **An import map** in `playground.html` resolves the eight `node:*` specifiers
  the compiler statically imports, plus `markdown-it` and its five transitive
  dependencies. Import maps resolve `node:fs` like any other specifier.
- **`assets/js/shims/`** — `path`, `os`, `url` and `crypto` compute for real
  (`path` and `crypto` are pinned against Node's own by
  `packages/core/test/playground.test.mjs`); `fs` is a read-only map filled
  before the compiler is imported; `unavailable.mjs` throws for
  `child_process`, `dns` and `module`, which every call site already handles.
- **A classic `<script>` stubbing `window.process` before the module.**
  `deck/assets.mjs` reads `process.env` at module scope, on its first
  statement. Out of order, the page dies before anything runs.
- **Three copies in `pages.yml`**: `packages/core/src` → `_site/core/src`,
  `design/layouts` → `_site/core/design/layouts` (plus a manifest written
  *beside* it), and seven npm packages → `_site/vendor/`.

`_site/core/` is not a stylistic choice. `deck/layout.mjs` and
`deck/assets.mjs` derive the package root from
`fileURLToPath(import.meta.url)` — in a browser, the URL's pathname — so
`/core/src/deck/layout.mjs` must resolve `../..` to a directory that really
holds `design/layouts`.

### Two things it must keep doing

1. **Refuse rather than mislead.** `deck/layout.mjs` loads the official layout
   catalogue synchronously at module scope. An empty catalogue renders a dozen
   layouts with wrong geometry, so the page counts what registered against the
   manifest and **stops** if they disagree. The engine now says so too —
   `loadOfficialLayouts()` reports `LAYOUT_CATALOG_MISSING` where it used to
   hold a bare `catch {}` that pushed no diagnostic at all — but the page keeps
   its own count: it is the one that knows how many the manifest promised.
2. **Name what a browser cannot draw.** Mermaid needs a subprocess, LaTeX needs
   a CommonJS package no import map can load, icons and images need a disk —
   and all four vanish *silently*. `describeGaps()` inspects the scene graph
   itself and says which are missing, naming the CLI.

**If you add a `node:` import anywhere reachable from `html/render.mjs`,
`packages/core/test/playground.test.mjs` fails.** That test walks the real
static import graph rather than a maintained list, because a browser refuses
the whole graph over one unmapped specifier — at link time, in production, and
nowhere else.

## The kit gallery

`gallery.html` shows eight kits, each with **the same slide** compiled inside
it. Holding the content still is the whole mechanism: every difference a
visitor sees comes from the kit, so the page compares brands rather than
decks. The sources are `examples/kits/` — eight kit directories and the one
`specimen.deck.md` they all compile.

`scripts/gallery.mjs` writes both halves, from that one directory:

```
<out>/kits/<name>.deckkit     what `lutrin kit install <url>` downloads
<out>/gallery/<name>.html     the specimen, compiled into that kit
```

`npm run site` runs it with `site/`, `.github/workflows/pages.yml` with
`_site/`. **The loop exists once, in the script** — a second copy written out
in YAML would be the one that drifts, the same reason the playground's
vendored package list is read out of the import map.

Three things `packages/core/test/kit-gallery.test.mjs` will not let drift:
the cards and `examples/kits/` must name exactly the same kits (a kit with no
card is invisible; a card with no kit is a 404 inside an install command),
every tile must frame the **same** slide and a slide the specimen actually
has, and every kit must clear the engine's own contrast thresholds. The rules
the kits themselves are held to — invented archetypes, no logo, universally
installed fonts only — are in `examples/kits/README.md`.

`robots.txt` disallows `/gallery/` for the reason it disallows `/demo.html`:
eight compiled decks carrying identical prose would compete with the page that
presents them. The trailing slash is what keeps `/gallery.html` crawlable.

## Analytics

**Umami Cloud**, one `<script defer>` in the `<head>` of all nine pages and
nothing else — `assets/js/main.js` needed no change, because the `track()` it
already had calls `window.umami.track` when it is there and does nothing when
it is not.

```html
<script defer src="https://cloud.umami.is/script.js"
        data-website-id="40e68dbe-f445-4ae8-a1e7-505d2824cd02"
        data-domains="info.lutrin.app"></script>
```

- **The site id is public**: it ships in every page, and it identifies the site
  rather than granting anything. The API key that READS the numbers is not
  here and never will be — see below.
- **Cookie-free, so no consent banner.** That is a requirement rather than a
  preference: a banner is itself a conversion cost, and consent declines make
  the numbers wrong on top of it.
- **`data-domains` is why local work does not pollute the numbers.** The
  tracker only reports from the host named there, so `npm run site:serve` on
  127.0.0.1 loads the script and sends nothing — verified in a real browser,
  not assumed. The consequence to remember: served from any other hostname,
  the page records nothing at all.

### Reading the numbers

The dashboard is `cloud.umami.is`; the API answers at `https://api.umami.is/v1`
with an `x-umami-api-key` header, 50 calls per 15 seconds. That API is the
reason this provider was chosen over Plausible, whose Stats API and custom
event properties are both Business-plan features — the numbers have to be
readable by whoever is asking, including an agent, without a browser session.

The key lives **outside this repository**, in
`~/.config/lutrin/analytics.json` (`chmod 600`):

```json
{ "provider": "umami", "websiteId": "…", "apiKey": "…", "region": "us" }
```

Useful shapes: `/websites/<id>/stats?startAt=<ms>&endAt=<ms>` for the totals,
`/websites/<id>/metrics?type=utm_medium&…` to see which checkout link converts,
`/websites/<id>/events/series` for the three events below.

### The three custom events

| Event | Fires when | Props | Why it is worth a name |
| --- | --- | --- | --- |
| `command copied` | any `copy` button is clicked, on either page | `command` | the reader intends to run Lutrin — the closest thing to an install this page can see |
| `pptx downloaded` | any link ending in `.pptx` | — | proof that the "real PowerPoint, not an image" claim landed |
| `deck opened` | `demo.html`, from the buttons or a gallery card | `slide` | which slide pulled them in, which is what the gallery is for |

`command copied` fires on the click, not on the clipboard promise: a browser
that denies clipboard access still tells us the reader wanted the command.

### UTM on the checkout links

Every `buy.polar.sh` link carries
`?utm_source=site&utm_medium=<placement>&utm_campaign=<tier>`. Without the
placement, three links to the same product are indistinguishable in the report,
and knowing *which one converts* is the whole reason to measure.

| `utm_medium` | Where |
| --- | --- |
| `card` | a tier card on the landing page |
| `card-secondary` | the quiet "or buy it by card" under Organisation's *Contact us* |
| `footer-cta` | the closing call to action on the landing page |
| `pricing-table` | a row of the table on `pricing.html` |
| `pricing-cta` | the closing call to action on `pricing.html` |

`utm_campaign` is the tier: `solo`, `team`, `studio`, `organisation`,
`solo-lifetime`.

**When adding a checkout link, give it a UTM.** One that carries none is
invisible in the report and looks exactly like direct traffic.

## Rules this directory is held to

- **No fabricated proof.** No testimonial, customer name, logo or usage figure
  that has not been supplied and cleared by the person or organisation named.
  The testimonial markup in `index.html` is written and commented out for
  exactly this reason; the counters beside it are live shields.io badges, so
  the page cannot state a number that has stopped being true.
- **No claim the compiler does not keep.** Every sentence here must be
  checkable against the code. Two benefits were removed under this rule —
  *Private brand kits included* and *CI included* — because both described
  something already free to everybody.
- **New page? Check `git status`.** `.gitignore` ignores `*.html` globally and
  re-includes `site/**/*.html`; a page dropped somewhere else is skipped by
  `git add site/` with no error at all. This has bitten this repository before.
  The trap now runs both ways: that negation also re-includes anything
  *generated* under `site/`, so `site/demo.html` and `site/gallery/` each need
  their own re-ignore line. A new generated tree here without one gets
  committed, silently.
