# `site/` — the landing pages

Static source. **No build step, no bundler, no dependency**, and that is a
constraint rather than an accident: everything here is served exactly as it is
committed. `.github/workflows/pages.yml` copies this directory into `_site/`,
drops in a `demo.html` and a `demo.pptx` compiled from `examples/demo.deck.md`
by the engine at `HEAD`, and deploys the result to GitHub Pages.

| File | What it is |
| --- | --- |
| `index.html` | the landing page, including the tiers and the FAQ |
| `playground.html` | the compiler, running in the visitor's browser — see below; `?embed=1` is the same page stripped for the landing page's card |
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

`site:serve` copies nothing. It maps four virtual routes onto the working
copy — `/core/src` → `packages/core/src`, `/core/design/layouts` →
`packages/core/design/layouts` (with the manifest generated per request),
`/core/vendor` → `packages/core/vendor` (the Mermaid bundle), and
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
  dependencies, plus `jszip` and `pptxgenjs` for the `.pptx` export. Import maps
  resolve `node:fs` like any other specifier. The map is also where the
  playground's own loaders ask for what the compiler never imports: the
  Mermaid bundle (`mermaid/umd`, served out of `@lutrin/core`'s vendored copy
  under `/core/vendor/`) and the Lucide icon files (the `lucide-static/icons/`
  prefix entry).
- **`assets/js/shims/`** — `path`, `os`, `url` and `crypto` compute for real
  (`path` and `crypto` are pinned against Node's own by
  `packages/core/test/playground.test.mjs`); `fs` is a map filled before the
  compiler is imported, and it is no longer read-only in practice — the `.pptx`
  export writes the package into it and reopens it once per post-processing
  pass, which is why it keeps bytes as bytes; `unavailable.mjs` throws for
  `child_process`, `dns` and `module`, which every call site already handles;
  `jszip.mjs` publishes JSZip's UMD bundle as a module (see below).
- **A classic `<script>` stubbing `window.process` before the module.**
  `deck/assets.mjs` reads `process.env` at module scope, on its first
  statement. Out of order, the page dies before anything runs.
- **Four copies in `pages.yml`**: `packages/core/src` → `_site/core/src`,
  `design/layouts` → `_site/core/design/layouts` (plus a manifest written
  *beside* it), `packages/core/vendor` → `_site/core/vendor` (the Mermaid
  bundle the package ships), and eleven npm packages → `_site/vendor/`.

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
2. **Name what could not be drawn.** The list used to be long — Mermaid needs
   a subprocess, icons and images need a disk, all vanishing *silently* — and
   it has been worked down item by item, each time the same way LaTeX was:

   - **LaTeX** fell first (`shims/mathjax.mjs`). MathJax is CommonJS and no
     import map can load it, but the package also publishes
     `es5/tex-svg-full.js`, a UMD bundle a classic `<script>` runs — the JSZip
     trick — and `deck/assets.mjs` picks the browser engine over its seven
     Node imports when it sees a `document`. Both halves survive the change of
     API: `tex2svg` for the picture, `tex2mml` for the MathML that becomes a
     native OMML equation in the `.pptx`.
   - **Mermaid, icons and local images** fell to the *provisioning loop*
     (`provision()` in playground.js). The compiler's call sites are
     synchronous and cannot await a render — but they all begin by looking at
     a disk, and the page controls the disk. After each compile the page
     renders the diagrams the scene graph asked for (the bundle `@lutrin/core`
     ships, loaded like MathJax), fetches the icons it named (same-origin, out
     of `/vendor/lucide-static/`), writes both where the compiler looks —
     `mermaidContentKey()` names the file, the deck's virtual
     `assets/mermaid/` and the icon cache hold it — and compiles once more
     over the filled disk. A dropped image is the manual version of the same
     move: the bytes land in the virtual `/deck/`, and the compiler finds a
     file that was, as far as it can tell, always there.

   What `describeGaps()` reports now is what actually FAILED here, each line
   only offering `npx lutrin` when that is genuinely the remedy: a diagram
   Mermaid refused (it refuses it on the CLI too), an icon the pinned Lucide
   set does not have (same), an image no file was dropped for, and the one
   true CLI-only case left — a remote image URL, which needs the disk cache
   only the CLI has. Equations are the same shape: `describeMath()` reports
   the leftover, `stats.mathTotal - stats.mathRendered`.

### The workbench

What separates the page from a demo, and all of it in the visitor's browser —
none of it in the embedded card (`?embed=1`), which is a taster and must
neither swallow work in progress nor restore someone's deck into a marketing
page:

- **It remembers.** The source and the file name autosave to localStorage,
  dropped images to IndexedDB, and `restoreWorkspace()` puts all of it back —
  images into the virtual `/deck/` *before* the first compile, so a restored
  deck never opens on a false "missing image" note. Storage is best-effort
  throughout: a private window that denies it gets an editor that cannot
  remember, not an editor that cannot edit.
- **Decks are files.** New / Open… / Save `.md` (and `Ctrl`/`Cmd`+`S`), through
  the File System Access API where the browser has it — Open holds the handle,
  so the second save writes the same file without a dialog — and through a
  download everywhere else. The file name is editable in the editor bar; typed
  or opened, its stem names all three artifacts (`.md`, `.html`, `.pptx`).
  Empty, the deck's own title keeps naming them, live, in the placeholder.
- **Findings are places.** The notes area leads with `validateDeck()` — the
  same validator the CLI prints from and the VS Code extension underlines
  with — one button per finding, severity and line first; clicking one puts
  the caret on the line. A kit-image warning that reaches both channels
  (renderer stats and validator) is shown once, as the clickable form.
- **The two panes track each other.** Every scene carries `sourceLine`, so the
  caret highlights and scrolls to the slide it is inside (`selectionchange`,
  rAF-throttled), and clicking a slide jumps the caret to the line that
  produced it. No parsing in the page: the compiler stamped the mapping.

### The two downloads

The page hands out both real outputs, built in the tab and uploaded nowhere.
Neither is an export of the preview:

- **`.html`** is `compileHtml` called again *without* `fragment` — the complete
  standalone document `lutrin build --html` writes, presenter mode and fit
  script included, rather than the slide fragments the preview frame stacks.
- **`.pptx`** is `renderDeckBytes` (`packages/core/src/pptx/render.mjs`), the
  PowerPoint renderer itself, its eight post-processing passes included. It is
  `import()`ed **on the first click** and never before: `jszip` and `pptxgenjs`
  are half a megabyte, and a reader who only types must not pay for them.

Three things made the .pptx renderer runnable here, and they are worth knowing
before touching any of them:

1. **`ZIP_BYTES`** (`src/pptx/bytes.mjs`). Every pass round-trips the zip, and
   every one of them used to ask JSZip for a `nodebuffer` — a type that exists
   only on Node and **throws** in a browser, on whichever pass reaches it first,
   with the package already half written. They now ask `bytes.mjs`, which picks
   `nodebuffer` or `uint8array` per runtime. `playground.test.mjs` greps for the
   literal, because a new pass that copied its neighbour would break the page
   and nothing else.
2. **`pptx.write()` rather than `pptx.writeFile()`.** PptxGenJS's `writeFile`
   branches on the runtime and, off Node, pushes a **download** — the visitor
   would get a half-finished package before a single post-pass had run. Asking
   for the bytes and writing them through `fs` is the same zip and behaves the
   same wherever `fs` does.
3. **The `fs` shim keeps bytes as bytes.** The package is written into it and
   reopened between passes; a `String(data)` on the way in would hand the next
   `JSZip.loadAsync` a mangled zip, and it would fail as a *corrupt archive*
   rather than as a lost write.

`jszip` is the one dependency with no ESM build at all — `main` is CommonJS and
the browser field points at a browserify UMD bundle. `shims/jszip.mjs` loads
that bundle as a **classic script**, in sloppy mode, the way it expects to be
loaded, and re-exports `window.JSZip`; its top-level `await` is what makes
everything importing `jszip` link only once the bundle has run. The bundle's URL
is asked of the import map (`jszip/umd`) rather than written into the shim, so
the vendored-package list stays in one place — the same reason `site-serve.mjs`
reads it out of the map.

**Measured, not assumed:** on the funnel example the browser and
`node packages/core/src/cli.mjs build` produce a `.pptx` whose every part is
byte-identical, `docProps/core.xml` excepted — PptxGenJS stamps the clock into
it. `renderDeckBytes` is held to the same standard against `renderDeck` by
`packages/core/test/pptx-e2e.test.mjs`.

**The gaps are not the same on both sides**, and the page says so from the
export's own stats rather than from the preview's. A chart is live SVG in the
frame and a *raster* in PowerPoint, so charts, equations and icons — which need
`@resvg/resvg-js`, a native binary — arrive in the `.pptx` as their
specification in text. The engine already reports that as `RASTER_UNAVAILABLE`;
what the page rewrites is the remedy, because *"run `npm install` in the lutrin
package"* is not something a visitor can act on. The diagnostic carries a
`count` field for exactly that: the page states the number without parsing it
back out of a sentence that is free to change.

### `?embed=1` — the same page, in the landing page's card

The landing page's **Try it right here** section, one scroll under the
headline, is an `<iframe>` onto `playground.html?embed=1`. It is deliberately
**not** a second in-page playground: the import map, the shims, the
`window.process` stub and the load order are the hard part of this page, and a
copy of them on `index.html` would be a copy that drifts the first time one of
them changes.

The flag does exactly two things, both in CSS (`playground.css`, the `embed`
block):

- **Strips what the card already says** — the site header and footer, the
  headline, the install line, the closing links. The compiler, the three
  examples, the two downloads, the status line and the honesty notes stay,
  because those are the page.
- **Makes the app fill the frame.** An `<iframe>` never grows to its document,
  so the frame's height is set on the landing page (`.try-frame`) and the embed
  lays itself out as a flex column to whatever it is given. The two numbers are
  therefore independent: resizing the card does not need a matching change
  here.

`index.html` gives the frame a `data-src`, not a `src`, so **main.js's existing
lazy loader** is what fetches it — the compiler and its layout catalogue start
downloading when the section comes within 500 px of the viewport, and a reader
who never scrolls that far pays nothing. With JavaScript off the frame would
stay an empty box, so a `<noscript>` in the head removes it and the paragraph
beside it says why.

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
nothing else — installing it took no change at all in `assets/js/main.js`,
because the `track()` that file already had calls `window.umami.track` when it
is there and does nothing when it is not. That is the property worth
protecting: every event added since goes through the same helper, and reaching
for `window.umami` directly would turn the next provider change from one line
into a hunt.

`packages/core/test/site-analytics.test.mjs` holds the pages to all of this —
the tag, the ids, and the UTM on the checkout links.

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
- **The landing page's playground card records a second pageview**, and that is
  the deliberate price of framing the real page rather than copying it: the
  `<iframe>` loads `playground.html?embed=1`, which carries the tag like every
  other page. So `path` for `/playground.html` counts *card loads plus page
  visits*, and the two are separated by the **`query`** metric — `embed=1` for
  the card, no query string for the page. (Suppressing the tag inside the frame
  would also suppress `playground edited`, which is the event worth having.)
  This is the first thing on this site to arrive with a query string at all, so
  it is also the measurement the *UTM coming in* section below is waiting on:
  read `query` back and write down what it actually returns.

### Reading the numbers

The dashboard is `cloud.umami.is`. **The free plan grants no API key** — that
is a Pro feature, and it is the one thing the documentation would not confirm
before signing up. What does work at $0 is the **Share URL**: the public
dashboard Umami serves is driven by a token anyone holding the link can get,
and the same token answers the ordinary stats endpoints.

```sh
# 1. the share id → a token (and the website id)
curl -s https://gateway-us.umami.is/api/share/<shareId>
# 2. any stats endpoint, with TWO headers — the context one is not optional
curl -s -H "x-umami-share-token: <token>" -H "x-umami-share-context: 1" \
  "https://gateway-us.umami.is/api/websites/<websiteId>/stats?startAt=<ms>&endAt=<ms>"
```

The script that does all of that and prints it — `npm run analytics`, with
`-- --days 30` for a longer window and `-- --json` to pipe it somewhere — is
**kept outside this repository**, as of 2026-08-01, along with the readings it
produces. It holds no credential, but a tool whose whole purpose is to turn a
Share URL into figures belongs with the figures. The recipe above is left here
because it contains no secret, and because the `x-umami-share-context` header
appears on no Umami documentation page — it was found by watching what their
own shared dashboard sends, and that is worth writing down somewhere public.

The credentials it reads are described below.

Which metric types the route accepts was **measured against the live gateway
on 2026-08-01**, not read in a documentation page — upstream documents none of
it, and the refusals are the interesting half:

| Answers `200` | Answers `400` |
| --- | --- |
| `path`, `entry`, `exit`, `event`, `title`, `query`, `referrer`, `channel`, `tag`, `language`, `screen`, `country`, `region`, `city`, `browser`, `device`, `os` | `url`, `host`, `utm_source`, `utm_medium`, `utm_campaign` |

Three things in that table are worth spelling out:

- **`entry` and `exit`** answer the landing-page and the exit-page questions,
  and **`path` answers neither** — it counts every view, so a page everyone
  passes through outranks the page they actually arrived on.
- **`url` is not a type here**; on this gateway it is called `path`. So is
  `host`, which is refused outright.
- **The `utm_*` types are refused**, which is the whole reason the incoming-UTM
  section below has to be written the way it is.

Host is `gateway-us.umami.is` for a US account, `gateway-eu` for an EU one.

**What happens past the click is not an Umami question**, and it is worth being
clear about it: the `utm_source`/`utm_medium`/`utm_campaign` on each
`buy.polar.sh` link leave with the visitor and are read by **Polar**. Umami now
sees the click itself — `checkout clicked` carries the placement and the tier —
and nothing after it. The order, the amount and whether it was refunded are
read on the other side, and **the two halves are not reconciled here**: one
answers *which link is persuasive*, the other *what was actually paid*.

**The trade-off, and it is a real one: a Share URL is public.** Anyone holding
the link reads the site's traffic — no password, no expiry. For a marketing
site that is a mild disclosure rather than a leak, but it is a choice rather
than an accident, and it is revocable: regenerating the Share URL invalidates
the old one. If these numbers should stay private, the alternative is $20 a
month for Pro and a real API key.

So the share id belongs **outside this repository**, in
`~/.config/lutrin/analytics.json` (`chmod 600`) — a public repo is exactly
where a "public enough" link stops being a considered choice:

```json
{ "provider": "umami", "websiteId": "…", "shareId": "…", "region": "us" }
```

### The six custom events

| Event | Fires when | Props | Why it is worth a name |
| --- | --- | --- | --- |
| `command copied` | any `copy` button is clicked, on either page | `command` | the reader intends to run Lutrin — the closest thing to an install this page can see |
| `playground edited` | the first keystroke in the playground, embedded or on its own page | `mode` | the only event that reports somebody **compiling their own deck**; every other one reports an intention |
| `playground exported` | either download button in the playground | `format`, `mode` | one step past editing: a visitor **leaving with a file they made** |
| `pptx downloaded` | any link ending in `.pptx` | — | proof that the "real PowerPoint, not an image" claim landed |
| `deck opened` | `demo.html`, from the buttons or a gallery card | `slide` | which slide pulled them in, which is what the gallery is for |
| `checkout clicked` | any `https://buy.polar.sh/` link, anywhere on the site | `placement`, `tier` | the last thing this site can see a buyer do — past it, only Polar knows |

`playground exported` is deliberately **not** folded into `pptx downloaded`.
That one counts the demo deck coming off a link and answers *did the "real
PowerPoint" claim land*; this one counts a reader exporting **their own** deck.
Merged, neither question has an answer. Its `format` is `html` or `pptx` —
which of the two outputs people actually want is the thing nobody currently
knows — and its `mode` separates the landing page's card from the page, exactly
as `playground edited` does.

`playground edited` fires **once** per page, on the first `input` — the question
is how many readers cross from looking to using, not how fast they type. Its
`mode` is `embed` on the landing page's card and `page` on `playground.html`,
and it is the prop that answers whether framing the playground on the landing
page did anything: both arrive under the same path, so nothing else separates
them.

`command copied` fires on the click, not on the clipboard promise: a browser
that denies clipboard access still tells us the reader wanted the command.

`checkout clicked` reads its two props **out of the link's own UTM parameters**
— `utm_medium` → `placement`, `utm_campaign` → `tier` — rather than from a list
in the JavaScript. A second list is a list that drifts; this way the act that
makes a new checkout link attributable in Polar is the same act that
instruments it here. A link carrying no UTM reports `untagged` instead of
nothing, so the omission shows up in the report rather than looking like a link
nobody clicked.

**It fires on the click and does not delay it.** The visitor leaves for
`buy.polar.sh` immediately, and the event still lands: the tracker served at
`cloud.umami.is/script.js` posts with `fetch(…, { keepalive: true })` — read out
of the shipped script itself on 2026-08-01, not assumed — and `keepalive` is
precisely the browser's undertaking to let a request outlive the document that
started it. So there is no `preventDefault()` and no timeout in that branch,
and there must not be: a slower checkout would cost more than the datum is
worth. If that ever stops being true of the tracker, the symptom is silent —
an event that is dropped this way is dropped without a trace — so it is the
first thing to re-read if the `checkout clicked` count starts looking thin
against the orders on Polar's side.

### UTM going out — the checkout links

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
invisible in the report and looks exactly like direct traffic. That sentence
used to be the only thing enforcing it;
`packages/core/test/site-analytics.test.mjs` now reads the two lists **out of
this file** and holds every `buy.polar.sh` href in `site/*.html` to them, so a
link with no UTM — or with a placement invented on the spot — fails the build
instead of the report. Add the row here first; the test is what makes that
order the cheap one.

### UTM coming in — the announcements

The site tags what goes **out** to Polar and, until this section, tagged
nothing coming **in**. The consequence is not theoretical: measured on
2026-08-01, `channel` returned exactly one row — `direct`, 3 — and `referrer`
returned none at all. Every announcement, wherever it was posted, is landing in
the same undifferentiated bucket, and *"what did the launch actually bring"*
has no answer to give.

So every link posted anywhere gets tagged, in this shape:

```
https://info.lutrin.app/<page>?utm_source=<where>&utm_medium=<what kind of link>&utm_campaign=<why it was posted>
```

**`utm_source` — where it was posted.**

| Value | Where |
| --- | --- |
| `hn` | Hacker News |
| `reddit` | any subreddit |
| `linkedin` | a post or a comment on LinkedIn |
| `x` | X / Twitter |
| `mastodon` | any instance |
| `discord` | a Discord server |
| `github` | the repository README, a release note, an issue |
| `newsletter` | an emailed issue |

**`utm_medium` — what kind of link it is.**

| Value | What |
| --- | --- |
| `post` | a submission or a post written for the purpose |
| `comment` | a reply inside somebody else's thread |
| `profile` | a bio, a pinned link, a signature |
| `readme` | a link inside a repository or a documentation page |
| `email` | a newsletter issue or a direct mail |

**`utm_campaign` — why it was posted.**

| Value | Why |
| --- | --- |
| `launch` | the first announcement of the project |
| `release` | a version going out |
| `kits` | the gallery and the kit editor |
| `playground` | the in-browser compiler |
| `comparison` | one of the `lutrin-vs-*` pages |
| `evergreen` | no campaign behind it — a profile, a README, a signature |

Which words these are matters far less than that they were **chosen once and
reused**. `x` and `twitter` in the same report are two sources that are one, and
nothing in the pipeline will ever tell you so. A new value is a new row here,
written before the link is posted.

Three things this convention has to survive, and they shape it:

- **`utm_source`, `utm_medium` and `utm_campaign` are not readable as metric
  types** — the route refuses all three (measured; see the table above). What
  reads them is `channel`, which *buckets* them into a handful of groups, plus
  `referrer` for the ones that arrive with one.
- **How `channel` buckets a tagged visit has not been measured**, because
  nothing has ever arrived tagged. Neither has what `query` does with a UTM
  string: it answers `200` and has returned zero rows to date, since no visit
  has yet carried a query string at all. **The first tagged link is that
  measurement** — read both back, and write down here what came out. Do not
  fill this paragraph in from an upstream documentation page; that is how the
  metric-type list came to be wrong.
- **A referrer is not a fallback.** A link opened from a mobile app, a PDF, a
  QR code or a chat client arrives with no referrer whatsoever and is
  indistinguishable from someone typing the domain. For those, the UTM on the
  link is the *only* record that the visit came from somewhere — which is why
  the tag goes on every link, including the ones that would have sent a
  referrer anyway.

Point the link at the page that answers the post — `pricing.html`,
`playground.html`, a `lutrin-vs-*` page — rather than always at `/`. `entry`
is then the metric that says which one people actually arrived on, and `path`
is the one that cannot tell you.

**`utm_source=site` is reserved** and never appears on an inbound link: it is
the word this site speaks to Polar on the way out. Inbound sources name the
place the visitor came *from*, outbound ones name this site as the place they
came from — same parameter, opposite ends of the visit, and mixing them makes
both unreadable.

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
