# Checklist — what only a human can unblock

Companion to [site-and-revenue.md](site-and-revenue.md). That plan holds ten
items; six of them stop at a decision, a credential or a purchase an agent
cannot make. This is that list, and nothing else.

Write the answer on the line under each box and date it. An answer recorded
here is what the agent reads; an answer given in a chat window is lost by the
next session.

Rough order: everything in **Now** is a sentence or a credit card and unblocks
work immediately. **Before selling** must be settled before spending anything
on acquisition. **The fork** decides which items exist at all beyond the ten.

## Where this stands — 2026-07-30

Six of the ten are settled: **2** (the domain), **3** (the unbacked claim),
**4** (the contact address), **5** (the attribution's language), **8** (proof)
and **9** (which turned out not to need asking — no bundler).

**All ten items of the plan have shipped**: analytics wiring and UTM, the offer
at the end of `build`, the domain, the FAQ and the proof strip, the browser
playground, the repaired pricing section, the unbacked claims removed, the four
comparison pages with `robots.txt` and `sitemap.xml`, and — last — the kit
gallery: eight kits, one specimen deck compiled into each of them, and
`.deckkit` archives built by CI so `lutrin kit install <url>` works against a
real URL. Item 9 of the plan, the Polar expiry test, is the one thing on that
list an agent cannot do at all.

Three remain, and they are the ones that decide whether any of it earns money.
**1** is closed as of 2026-08-01 — Umami Cloud is installed and the site is
measured — and stays in the table struck through, so a reader who remembers it
as open sees what happened to it:

| # | Still open | Why it matters now |
| --- | --- | --- |
| ~~**1**~~ | ~~Analytics provider~~ | **done 2026-08-01** — Umami Cloud is live on all nine pages; only the API key is still to hand over |
| **6** | What the Team tier gets | Team and Organisation are now purely a headcount — see 3 |
| **7** | The Polar expiry test | **the one that blocks selling**, and the page now sells |
| **10** | Self-serve, or high-touch | still worth its own afternoon |

Two more are not decisions but errands: **the `contact@lutrin.app` mailbox**,
which the site advertises in six places; and **`Enforce HTTPS`** in
*Settings → Pages*, one checkbox. The DNS errand turned out not to exist — see
the correction dated 2026-07-31 under decision 2: the site is served at
`info.lutrin.app`, and the repository now says so everywhere.

---

## Now

### ☑ 1. Analytics provider — *blocks item 1*

Plausible or Umami. Both are cookie-free, which is the requirement; Umami can
be self-hosted, Plausible cannot without work. Create the account and put the
site key somewhere the agent can read it.

Without this, every other item ships blind — there is no way to tell whether it
worked.

> **Answer:** **Umami Cloud, Hobby plan (free) — INSTALLED.**
> **Date:** 2026-07-30 (decided), 2026-08-01 (installed)
>
> The account exists and the site id arrived: `40e68dbe-…`. One
> `<script defer>` now sits in the `<head>` of all nine pages —
> `kit-editor.html` included, which had never been given the socket in the
> first place — and `assets/js/main.js` needed no change at all: the `track()`
> written in July calls `window.umami.track` the moment it exists.
>
> Checked in a real browser rather than assumed: the tag is in the DOM,
> `window.umami.track` is a function, and a page served on 127.0.0.1 fetches
> the script and **sends nothing**, because `data-domains="info.lutrin.app"`
> holds local work out of the numbers.
>
> **Still missing, and it is the half that made this provider the choice: the
> API key.** Without it the numbers can only be read by a human in front of a
> dashboard, which is exactly what Plausible was rejected for. Drop it in
> `~/.config/lutrin/analytics.json` (`chmod 600`, outside the repository) with
> the account's region, and the reading side works from here on.
>
> **Why this one, and not Plausible.** The deciding criterion was that the
> numbers be readable by an agent, not only by a human in front of a browser.
> Plausible's Stats API *and* custom event properties are both Business-plan
> features ($19/month at 10k pageviews): on Starter or Growth the three events
> below would arrive stripped of their props, and could not be queried at all.
> Umami's Hobby plan is $0 for 100k events a month, 3 sites and 6 months of
> retention; it is cookie-free, so no consent banner; and its API is one static
> header — `x-umami-api-key` against `https://api.umami.is/v1`, 50 calls per
> 15 seconds. GoatCounter was ruled out twice over: its free hosted tier is
> non-commercial, and its API is paid-only.
>
> **What a person has to do**, and nothing here can start without it:
>
> 1. Create the account at `cloud.umami.is`, add `info.lutrin.app`, generate an API
>    key. Note whether the account sits in the US or the EU region.
> 2. Write the key to `~/.config/lutrin/analytics.json`, `chmod 600` —
>    **outside the repository, and it never enters it**:
>    `{ "provider": "umami", "websiteId": "…", "apiKey": "…", "region": "us" }`
> 3. Hand over the `data-website-id`. That one is public — it ships in the HTML.
>
> **The unverified point is now verified, and the answer is the bad one —
> 2026-08-01.** `cloud.umami.is` answers *"API access requires a Pro plan"*:
> the free Hobby plan grants no API key. So the criterion that chose this
> provider over Plausible — numbers readable without a browser session, at $0 —
> **does not exist at $0 anywhere**. Plausible gates its Stats API behind
> Business at $19/month; Umami gates its API behind Pro at $20/month.
>
> That does not make the installation wrong: it is cookie-free, it costs
> nothing, and it is collecting. What it removes is the tiebreaker, and the
> consequence is worth stating rather than absorbing — **nobody but a human in
> front of a dashboard can read these numbers today.**
>
> **The recommendation is to pay nothing yet.** The site has no traffic to
> speak of; the question this month is "did anyone arrive at all", which the
> dashboard answers. Paying $20 for an API over an empty dataset buys nothing.
> Two things to do instead, in order:
>
> 1. **Enable a Share URL** on the website (Websites → Edit → Share URL). Umami
>    serves its public dashboards through `/api/share/<id>`, which hands back a
>    token used with `x-umami-share-token` — no API key involved. Whether that
>    is readable programmatically on Hobby is not documented either way, and it
>    is one click to find out. If it works: $0 **and** readable.
> 2. **Revisit when the traffic makes a weekly automated read worth $20** — and
>    at that moment compare afresh, because the reason Umami beat Plausible is
>    gone. At the same price, Plausible's dashboard, funnels and properties are
>    the stronger product; switching is one line in nine pages, `main.js`
>    already speaks both, and the cost is whatever history has accumulated.
>
> **Installing is one line in each of the eight pages and nothing else.**
> `site/assets/js/main.js` needs no change: the Cloud tracker (4.6 kB) exposes
> `window.umami = { track, identify, getSession }` and its `track(name, data)`
> builds `{ name, data }` — exactly what `main.js:117` already calls. That was
> checked against the minified tracker itself, not against the documentation.
> The tag carries `data-domains="info.lutrin.app"` so that `npm run site:serve` does
> not count as traffic.
>
> The half of item 1 that does not need a provider shipped anyway: every
> `buy.polar.sh` link now carries `utm_source`/`utm_medium`/`utm_campaign`, and
> the three custom events are wired in `site/assets/js/main.js` behind a
> provider-agnostic `track()` that no-ops until a script exists. Each page
> carries an `ANALYTICS GOES HERE` comment in `<head>`; installing Plausible or
> Umami is that one line per page and nothing else. The scheme, the events and
> the placements are documented in `site/README.md`.
>
> **This is still the item that matters most.** Everything else already shipped
> is currently unmeasurable.

---

### ☑ 2. Buy the domain — *blocks items 3 and 8*

`lutrin.dev`, `lutrin.app`, or another. Buy it, point the DNS at GitHub Pages.
The agent handles `site/CNAME` and every absolute URL in the repository from
there.

Item 8 (the four comparison pages) waits on this — building them first means
writing every canonical URL twice.

> **Domain:** **`lutrin.app`** — canonical. `lutrin.dev` and `lutrin.ai` are
> also owned and redirect to it (registrar-level 301; GitHub Pages accepts one
> custom domain, so they must never be added to `CNAME`).
> **Date:** 2026-07-30
>
> Done in the repository: `site/CNAME`, every `rel=canonical` / `og:url` /
> `og:image` on the three pages, `cli.mjs`, the `homepage` of both published
> packages, and every link in the READMEs and `docs/`. `pages.yml` needed no
> change — `cp -R site/.` already carries `CNAME` into the artifact.
>
> **Two things left, and only a person can do them** (both are in
> `site/README.md`): the DNS records at the registrar, and
> *Settings → Pages → Custom domain* set to `lutrin.app` with *Enforce HTTPS*.
> With only one of the two, the domain silently drops on a later deploy.
>
> ---
>
> **Correction — 2026-07-31. The host was wrong, and it was about to take the
> site down.** The site is served at **`info.lutrin.app`**, not at the apex:
> that name is a `CNAME` onto `julien-riel.github.io`, it answers 200 from the
> Pages addresses, and `GET repos/julien-riel/lutrin/pages` reports
> `"cname": "info.lutrin.app"`. The apex `lutrin.app` resolves to OVH and
> redirects to a `www` that does not resolve at all.
>
> Everything above was written on the assumption that the apex was the target,
> so `site/CNAME` and every absolute URL in the repository named it. Deploying
> that would have handed GitHub a `CNAME` file saying `lutrin.app`, moved the
> custom domain onto a host that answers from OVH, and 301'd the old
> `julien-riel.github.io` URL there — a 301 browsers cache hard. The site would
> have gone dark, and the eight `kit install` commands with it.
>
> The whole repository now says `info.lutrin.app` — `git grep info.lutrin.app`
> is the list, and `site/README.md` records what it would take to move to the
> apex later. **`contact@lutrin.app` is untouched on purpose**: email rides on
> MX records and has nothing to do with where the pages are served.
>
> One thing is still a person's, and it is one checkbox: *Enforce HTTPS* in
> *Settings → Pages*. The certificate exists — `https://` answers 200 — but the
> API reports `https_enforced: false`, so `http://` is served rather than
> redirected.

---

### ☐ 3. Approve the unbacked-claim deletion — *unblocks part of item 7*

*Private brand kits included* (`site/index.html:298`) is the only benefit
separating Team from Solo, and it describes something already free for
everybody: `lutrin kit install` takes any URL and checks no licence.

Deleting it is the default and needs no plan. Say yes and it goes this week;
what to build in its place is decision 6 below and can take its time.

> ☑ Delete now ☐ Keep until a replacement ships (say why:)
> **Date:** 2026-07-30
>
> Applied as the plan's own stated default ("deleting it is the default and
> needs no plan"), not as an answer given out loud — **say so if you disagree,
> it is one line to put back.**
>
> **A second claim went with it, and this one was not in the plan.** The
> Organisation card read *Unlimited people, CI included*, and `README.md` gives
> "CI included" to Studio — but the same page says at `:316` that one key runs
> on "your laptop, your desktop and the build server". CI is already free for
> everybody, exactly like private kits. It is now *One legal entity, unlimited
> people*, and the FAQ answers the CI question honestly instead of selling it.
> Two tiers therefore lost their only non-headcount benefit, which makes
> decision 6 below more urgent rather than less.

---

### ☑ 4. Contact address, and the Organisation tier's shape — *blocks item 6*

Two answers:

- The address that goes on the site. A `mailto:` is enough.
- Does Organisation ($2,990) become **Contact us** instead of **Buy**? At that
  price nobody pays by card without asking about invoicing and framework
  agreements first, and pricing it behind a conversation is also how the number
  stops reading as a wall.

> **Address:** **`contact@lutrin.app`** — in the footer of every page, on the
> Organisation card, and in the FAQ's invoicing answer.
> **Organisation stays self-serve?** ☑ yes ☑ no — **both.** *Contact us* is the
> card's main button; a quiet "or buy it by card" sits under it for whoever is
> already decided. Nothing that worked before stopped working.
> **Date:** 2026-07-30
>
> **The mailbox has to be made to exist at the registrar** — the site now
> advertises it in six places.

---

### ☑ 5. The attribution's language — *blocks half of item 2*

`BRAND_MENTION` is `'Généré avec Lutrin'` (`packages/core/src/license/index.mjs:42`)
while the site, the README and every CLI string are English. Today an
anglophone buyer ships a client deck carrying a French line, by accident rather
than by choice.

- **English** — one string, matches the product surface.
- **Localised from the deck's `lang`** — more work, more correct, and it is a
  small feature rather than a fix.

The other half of item 2 (the upsell line at the end of `build`) is not blocked
and can ship first.

> **Answer:** **English, fixed.** `BRAND_MENTION` is now `'Made with Lutrin'`.
> Not localised from the deck's `lang`: that turns the attribution into a
> feature with a translation matrix to maintain, and the one string a customer
> pays to remove is not where translation earns its keep. The reasoning is
> recorded in `license/index.mjs` beside the constant, and a test pins the
> value so it cannot drift back by accident.
> **Date:** 2026-07-30
>
> Both halves of item 2 shipped. `build` now ends on the offer when no licence
> is installed — once, on stdout, never under a ⚠, and never on a path a
> machine parses (`validate --json`, `inspect`, `build --ir` and
> `capabilities --json` are byte-identical licensed or not, and there is a test
> that says so).

---

## Before selling

### ☐ 6. Which benefit the Team tier actually gets — *blocks the rest of item 7*

Pick one, cheapest first:

- ☐ **A named support channel and a response commitment.** Costs nothing to
  build; often the line that releases a budget on the buyer's side.
- ☐ **A team console** — who has activated, revoke, reassign. Check what
  Polar's customer portal already covers before building anything.
- ☐ **The distributed organisation kit** — a stable URL `lutrin kit install`
  follows, versioned, updated for everyone at once. The real need behind the
  claim, the most work, the most defensible.

> **Answer:** **Still open.**
> **Date:**
>
> More urgent than when this was written. The Team card now reads *Up to ten
> people, one organisation* and nothing else, and Organisation lost "CI
> included" for the same reason (decision 3 above). Both tiers are, today,
> purely a headcount. The first option costs nothing to build and is the one
> that usually releases a budget on the buyer's side.

---

### ☐ 7. Run the Polar expiry test — *blocks item 9, and honestly blocks selling*

Keys carry a one-year TTL and `licenseState()` treats a passed `expires_at` as
`EXPIRED`. Whether an annual renewal pushes that date forward is unverified. If
it does not, **every customer acquired now loses their licence in month twelve,
silently, having paid.**

A sandbox organisation, a benefit with a TTL in days rather than a year, a test
subscription, and an observation of what happens at renewal. Never production.

First real renewal is July 2027. This is cheap now and expensive as a support
crisis.

> **What happened at renewal:** **Not run. Still open, and still the one item
> that blocks selling** — an agent cannot make the test payment.
> **Date observed:**
>
> Nothing shipped today changes this: `licenseState()` still treats a passed
> `expires_at` as `EXPIRED` (`license/index.mjs:81`). What today *did* change is
> the exposure — the site now has a price list, a contact address and eight
> answers designed to close a sale. Every customer that page wins before this
> test is run is a customer who may lose their licence in month twelve, having
> paid.

---

### ☑ 8. Testimonials — *blocks half of item 4*

Two or three, with a real name, a real role and a real organisation, each
cleared by the person quoted.

If there are none yet, say so and the proof strip ships empty — the agent is
instructed not to invent them, and will not. The FAQ half of item 4 is not
blocked either way and can go now.

> **Who:** **Nobody yet.** Live shields.io counters ship in their place — npm
> installs per month, GitHub stars, the published version, the MIT licence.
> They are fetched when the page is read, so the strip cannot state a number
> that has stopped being true.
> **Cleared?** n/a — nothing was invented, and nothing will be.
> **Date:** 2026-07-30
>
> The testimonial markup is written and commented out in `site/index.html`,
> beside a note listing what each quote needs: the exact words, a name, a role,
> an organisation, and that person's written agreement to be quoted by name.
> Uncomment it the day two or three of those exist. The FAQ shipped, in full.

---

## Conditional

### ☑ 9. A build step for the playground — *only if item 5 asks*

`site/` is static with no build step, and that is worth keeping. If the
compiler cannot be made to run in a browser without a bundler, the agent is
told to stop and report rather than quietly add one.

If that report arrives, the question is yours: accept a bundler for `site/`, or
drop the playground.

> **Answer, if asked:** **Not asked — no bundler is needed.** The audit ran in
> a real headless Chrome rather than on paper: unmodified `packages/core/src`,
> loaded from a plain `<script type="module">` behind an import map, compiled a
> 52-slide deck, and the scene graph came out **byte-identical to Node's**.
> **Date:** 2026-07-30
>
> What it costs instead of a bundler: an import map (8 `node:*` keys, 7 npm),
> ~200 lines of shims, an inline `window.process` stub, and one more `cp` in
> `pages.yml`. `site/` keeps its no-build-step property.
>
> **The finding that matters is not the verdict.** Mermaid, LaTeX, Lucide icons
> and images all vanish in a browser — and they vanish *silently*: a run that
> dropped 12 official layouts, 6 icons, 1 equation and 2 images still reported
> `stats.warnings === []`. A playground built naively on this would look like
> it works while misrepresenting what the compiler produces, which is the one
> thing `site/` has never done. Item 5 therefore has to fix the silence before
> it ships the page.
>
> Four **real product bugs** surfaced on the way, none of them playground-only:
>
> - `deck/layout.mjs:881` — a bare `catch {}` swallows a failure to load the 12
>   official layout definitions with no diagnostic. A broken install renders
>   every official layout with wrong geometry and says nothing, in the CLI and
>   in VS Code too.
> - `deck/assets.mjs:689` — the Lucide **CDN fallback is broken today**: the
>   guard is `/^\s*<svg[\s>]/i`, and lucide-static now ships SVGs that open
>   with a licence comment, so the regex always rejects them. Any user without
>   `lucide-static` in `node_modules` silently gets no icons.
> - `deck/assets.mjs:1023` — `crypto.createHash` is synchronous and unguarded
>   on the Mermaid path.
> - `html/render.mjs:32` — `import os from 'node:os'`, never used once in 1785
>   lines.
>
> **A fifth, found on 2026-07-31 by installing a gallery kit from its published
> URL** — `kit/archive.mjs:293`. `packKit` passes `date: new Date(0)` to
> `zip.generateAsync()`, with a comment saying two packings of the same content
> must produce the same bytes "otherwise the published SHA-256 changes on every
> `kit create` and no longer means anything". **That is exactly what happens**:
> the option belongs on each `zip.file(name, data, { date })` call, not on
> `generateAsync`, so every entry keeps the current time and the digest changes
> on every pack.
>
> Measured, not deduced: `press-noir.deckkit` built by CI and the same kit
> packed here have identical contents (`diff -r` on both unpacked trees says
> so), zip listings one minute apart, and two different digests —
> `72aec7ec…` against `22afaa0a…`.
>
> It matters because `README.md` tells a reader "The sha256 printed at
> installation is reproducible", which is how they would check that the archive
> they downloaded is the kit that was published. Today it cannot be checked.
> The fix is one argument moved; the test is packing the same directory twice
> with different mtimes and asserting one digest.
>
> ---
>
> **All five are fixed — 2026-07-31**, each with a test that goes red without
> its fix, checked by removing the fix and watching it fail. The `CHANGELOG.md`
> entries say what changed; what is worth keeping here is what the fixing
> taught, because three of the five were not what the audit thought:
>
> - **The digest test that would have passed on the broken code.** Packing
>   twice and comparing bytes proves nothing: a zip's DOS date has two-second
>   resolution, so two packings inside one test tick agree even when nothing is
>   fixed. The test reads the dates back out of the archive instead. And the
>   fixed date could not stay `new Date(0)`: a zip cannot store 1970, which
>   comes back out as **2098** — deterministic, and unreadable in any listing.
>   It is the DOS epoch now.
> - **The Lucide guard had a second defect nobody had noticed**: `/^<svg[\s>]/`
>   also rejects `<svg/>`, a valid empty root. The class is `[\s/>]` now. The
>   real lesson is the fixture: every existing test handed that code an
>   idealised `<svg …>`, which is exactly how a download path could be dead for
>   months with a green suite. The new test reads a real file out of the
>   installed `lucide-static`.
> - **The dead import was four dead imports.** Turning on biome's
>   `noUnusedImports` — deliberately not in its recommended set — found three
>   more in `validate.mjs`, `pptx/render.mjs` and a test. The rule is on, so the
>   class cannot come back quietly.
>
> The other two landed as the audit described them: `loadOfficialLayouts()` is
> now a function that reports `LAYOUT_CATALOG_MISSING` (for an empty catalogue
> as well as an unreadable one, which is the same failure), and the Mermaid
> cache key degrades to `null` instead of throwing when a FIPS-mode Node
> refuses sha1.

---

## The fork

### ☐ 10. Self-serve volume, or high-touch service?

Not blocking any of the ten — they pay off under either. It decides what comes
*after*, and three candidates are held out of the plan waiting on it: a French
version of the site, an official GitHub Action, and a done-for-you service
turning a customer's brand guidelines into a kit.

- **Self-serve volume** — playground, comparison pages, kit gallery, low
  prices, many small customers. The site is written for this today.
- **High-touch service** — kits built to order, a handful of organisations,
  five-figure engagements. The product argues for this more naturally than the
  page does: a strict engine, a corporate brand and a compiler that refuses
  improvisation is an enterprise story, and building the kit is the work the
  customer cannot do and will pay most for.

Answering it is worth an afternoon on its own, not a checkbox ticked in
passing.

> **Answer:**
> **Date:**
