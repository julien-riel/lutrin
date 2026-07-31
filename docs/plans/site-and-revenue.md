# Plan — the site, and turning it into revenue

## Where this comes from

A review of `site/` and of the licensing path, read against one question: what
stands between the landing page as it is and a product that earns money.

The page itself is not the problem. Its copy is better than most: `the part
nobody hired you for` names the pain (`site/index.html:85`), `What it will
refuse to do` names four competitors by name and concedes what they do better
(`site/index.html:329`), and the slides are compiled by CI at `HEAD` rather
than screenshotted, so the demo cannot drift from the compiler.

What is missing is the machinery around it. There is no measurement, no way to
contact a human, no proof, no trial that does not require Node, and the paid
tiers promise something the code does not deliver.

The ten items below are that machinery. They are ordered by value ÷ cost, with
dependencies respected. Nothing here is committed to; this is the order to take
them in if they are taken.

**Status, 2026-07-30.** Ten of the ten have shipped, on the branch
`plan/site-and-revenue` — item 10, the kit gallery, went in last. The one that
has not is the one an agent cannot do: item 9 needs a human with a sandbox and
test money. The answers that unblocked the rest are recorded in
[site-and-revenue-checklist.md](site-and-revenue-checklist.md), which is also
where the four decisions still outstanding live. Read that file before this
one.

| # | What | Cost | Status |
|---|---|---|---|
| 1 | [Analytics and UTM](#1-analytics-and-utm) | 2 hours | **partly** — UTM and the three events shipped; Umami Cloud chosen, and nothing is measured until the account exists |
| 2 | [The upsell line at the end of `build`](#2-the-upsell-line-at-the-end-of-build) | 1 hour | **done** |
| 3 | [A real domain](#3-a-real-domain) | an evening | **done** — `lutrin.app`; DNS and the Pages setting are still a human's |
| 4 | [FAQ and social proof](#4-faq-and-social-proof) | a day | **done** — FAQ in full; proof is live counters, no testimonial invented |
| 5 | [The browser playground](#5-the-browser-playground) | 1–2 weeks | **done** — no bundler needed; `npm run site:serve` |
| 6 | [Repair the pricing section](#6-repair-the-pricing-section) | half a day | **done** |
| 7 | [Give the Team tier something to sell](#7-give-the-team-tier-something-to-sell) | varies | **half** — the unbacked claims are gone; what replaces them is decision 6 |
| 8 | [Four comparison pages, plus robots and sitemap](#8-four-comparison-pages-plus-robots-and-sitemap) | 2 days | **done** |
| 9 | [Settle the Polar expiry question](#9-settle-the-polar-expiry-question) | an evening | **NOT DONE** — needs a human, and still blocks selling |
| 10 | [A gallery of public kits](#10-a-gallery-of-public-kits) | 2–3 days | **done** — eight kits, one specimen deck, archives built by CI |

Items 2, 5, 8 and 10 are pure engineering and can be handed to an agent whole.
Items 1, 3, 4, 6, 7 and 9 each contain one decision or one credential a human
has to supply; each says so in its own section, and the agent's part is scoped
around it. Those decisions are gathered, with the consequence of each answer,
in [site-and-revenue-checklist.md](site-and-revenue-checklist.md) — the answers
belong there, where the next session can read them.

## What an agent must not do here

This plan touches marketing copy and a payment flow, which is not the usual
ground. Four hard rules, and none of them is negotiable:

- **Never invent a testimonial, a customer name, a logo, or a usage number.**
  Item 4 asks for social proof; if none has been supplied, the agent builds the
  empty component and stops. A fabricated quote on a pricing page is fraud, and
  it is the kind that gets noticed.
- **Never claim a capability the code does not have.** Every sentence added to
  `site/` must be checkable against the compiler. This is the rule the page has
  honoured so far, and the reason it reads as credible.
- **Never touch the production Polar organisation.** Item 9 is run against a
  sandbox, by a human, with test money.
- **No new runtime dependency**, per `CONTRIBUTING.md`. The site is static with
  no build step; keep it that way. The playground (item 5) is the one place
  this will be tempting — see its section for the constraint it has to meet.

Everything else in `CONTRIBUTING.md` still applies: English for documentation
and diagnostics, `biome check .` clean, `node:test` and nothing else.

---

## 1. Analytics and UTM

### What is wrong

There is no analytics of any kind in `site/`. Not a script, not a pixel,
nothing. The number of visitors, where they come from, how many reach
`#pricing`, and how many click through to Polar are all unknown, and therefore
so is the effect of every other item in this plan.

### What to build

A single privacy-respecting, cookie-free script in both pages, and campaign
parameters on the six Polar links so the checkout can be attributed.

- Add the provider snippet to `site/index.html` and `site/kit-editor.html`.
  Cookie-free is a requirement, not a preference: it keeps the page out of
  consent-banner territory, which is itself a conversion cost.
- Append `?utm_source=site&utm_medium=<placement>&utm_campaign=<tier>` to every
  `buy.polar.sh` link. There are six: three tier cards
  (`site/index.html:293`, `:299`, `:305`), two in the aside (`:309`, `:311`)
  and one in the closing CTA (`:322`). `<placement>` distinguishes the card
  from the aside from the footer CTA — otherwise the three are indistinguishable
  in the report, and knowing which one converts is the entire point.
- Record three custom events: `copy` button used (the hero and kit-editor
  commands), `.pptx` downloaded, `demo.html` opened.

### Needs a human

Which provider, and its account. Plausible and Umami both fit; Umami can be
self-hosted, Plausible cannot without work. The agent takes the choice as
given.

### Done when

- Both pages load the snippet, and `biome check .` is clean.
- All six Polar links carry distinct, correct UTM parameters.
- A note in `site/README.md` (create it) records where the dashboard lives and
  what the three custom events mean, so the next reader does not have to guess.

---

## 2. The upsell line at the end of `build`

### What is wrong

`lutrin build` never says that it added the attribution. The watermark is
decided inside `applyBranding` (`packages/core/src/license/index.mjs:113`) at
render time; `licenseState()` is imported by the CLI (`cli.mjs:77`) but called
only in the `license` sub-commands (`cli.mjs:1314`, `cli.mjs:1342`). The build
path is silent.

So the user discovers the mention when they open the `.pptx` — or in front of
a client. That is the single moment where the product's one paid benefit is
felt, and it is currently a surprise rather than an offer.

There is a second, smaller defect in the same area: `BRAND_MENTION` is
`'Généré avec Lutrin'` (`license/index.mjs:42`), in French, while the site, the
README and every CLI string are in English. An anglophone buyer ships a deck
carrying a French line.

### What to build

**(a)** After a successful build with no licence, one line on stdout — not a
warning, not a nag, and never on `--json`:

```
✓ deck.pptx — 37 slides
  Carries the Lutrin attribution. Remove it: lutrin license activate <key>
  https://julien-riel.github.io/lutrin/#pricing
```

Print it once per build, only when `licenseState().licensed` is false, and keep
it out of every machine-readable path — an agent driving `validate --json` must
not have to parse around it.

**(b)** Decide the language of `BRAND_MENTION`. Two defensible answers: make it
English to match the product surface, or localise it from the deck's `lang`.
The second is more work and more correct. Either way it stops being a French
string on an English product by accident.

### Done when

- A build without a licence prints the three lines; a licensed build prints
  nothing extra; `--json` output is byte-identical to before in both cases.
- `packages/core/test/license.test.mjs` covers all three.
- The mention's language is a deliberate, documented choice.

---

## 3. A real domain

### What is wrong

`julien-riel.github.io/lutrin` reads as a personal project, because it is one.
That is fine for the $59 tier and fatal for the $2,990 one: nobody routes a
purchase order of that size to a personal GitHub Pages URL.

### What to build

Point a bought domain at the existing Pages deploy and update every absolute
URL in the repository.

- `site/CNAME` with the domain, and the DNS records at the registrar.
- `.github/workflows/pages.yml` needs no change — `cp -R site/.` already
  carries the CNAME file into `_site`.
- Update `rel=canonical` and every `og:url` / `og:image` in both pages
  (`site/index.html:8`, `:13`, `:14`; `site/kit-editor.html` has the same
  three).
- Update `cli.mjs:1344`, the `homepage` fields in the two published packages,
  and the README's opening link.
- Keep the Pages URL working: GitHub redirects it once the custom domain is
  set, so no link already in the wild breaks.

### Needs a human

Buying the domain and setting the DNS. The agent does everything downstream of
`site/CNAME` existing.

### Done when

Every absolute `julien-riel.github.io/lutrin` in the repository is either
updated or deliberately left (there is none that should be), and `grep -rn
"julien-riel.github.io"` returns only what was decided to keep.

---

## 4. FAQ and social proof

### What is wrong

The pricing section (`site/index.html:279-326`) answers no question a
professional buyer has. Not one of: can I have an invoice, are taxes included,
what happens to decks I already shipped when the licence lapses, how many
machines, what if I cancel, do you refund. And there is no proof of any kind —
no testimonial, no logo, no download count, no star count.

For a purchase from a stranger, on a personal domain, at $449, that is the
first objection and the second.

### What to build

**(a) A FAQ of eight questions** under the tier cards, as a `<details>` list —
no JavaScript. Draft answers must be checked against the code before being
written, in particular:

- *Does the attribution come back on decks I already built?* No. The mention is
  baked into the file at build time (`license/index.mjs:113`); an expired
  licence affects the next build, not the last one. Say so plainly — it is
  reassuring and it is true.
- *How many machines?* A seat is a person; the key's activation limit governs
  machines (`cli.mjs:1358`). The page already says this at `:316`; the FAQ
  should repeat it where it is asked.
- *What if I am offline?* 30 days without reaching the network, per
  `LICENSE_REASON.STALE` (`cli.mjs:1261`).

**(b) A proof strip** between the tiers and the FAQ: two or three named
testimonials with role and organisation, or npm download and GitHub star
counts, or both.

### Needs a human

The testimonials. **If none have been supplied, build the markup, leave it
commented out with a note saying what it needs, and ship the FAQ alone.** Do
not fill it with plausible-sounding quotes, and do not soften this by inventing
"a consultant" or "a project manager at a large organisation".

Download and star counts can be fetched and hard-coded by CI, or simply
omitted; a shields.io badge is honest and costs nothing.

### Done when

Eight questions, each answer traceable to a line of code or to a Polar setting,
and no unverifiable claim anywhere on the page.

---

## 5. The browser playground

### What is wrong

The only way to see Lutrin work on your own content is to have Node ≥ 22 and
run `npx`. That filter sits *before* the first experience of value. Everything
the page shows is the demo deck — impressive, and about somebody else's
content.

### What to build

A third page, `site/playground.html`: a textarea on the left, the compiled
slide on the right, recompiled as you type. HTML output only; `.pptx` stays
behind the install, which keeps the download a reason to install.

The hard constraint is the deploy: GitHub Pages is static, so the compiler must
run in the browser. Two questions to settle before writing UI, in this order:

1. **Does `packages/core` reach the browser at all?** It is ESM and
   dependency-light, but `renderDeckHtml` and everything upstream of it must be
   audited for `node:` imports. Mermaid and remote images will not work
   client-side; the playground can refuse both with a clear message rather
   than pretend.
2. **If it does not, what is the smallest subset that does?** Parse → IR →
   layout → scene → HTML, with charts drawn as SVG, is the whole path the page
   needs. A bundle that omits the pptx renderer is likely most of the answer.

If neither is achievable without a build step, stop and report rather than
introducing a bundler into a site that has none — that is a decision for a
human, not a workaround.

Seed the textarea with the funnel example already in the tabs
(`site/index.html:127-138`); the reader recognises it, edits it, and is
immediately looking at their own deck.

### Done when

- The page compiles a deck client-side with no network call after load.
- The three tab examples all compile in it.
- `site/` still has no build step, or a human has explicitly approved one.
- Mermaid and remote images degrade with a message naming the CLI.

---

## 6. Repair the pricing section

### What is wrong

Three defects in one block:

- **Five purchase options, three of them buried in prose.** Studio at $990,
  Solo lifetime at $149 and the Canadian prices are all inside one paragraph
  (`site/index.html:308-320`). A buyer who has to read a paragraph to discover
  a lifetime option does not buy — they postpone.
- **The closing CTA is `Buy Team — $449 a year`** (`site/index.html:322`). It
  sends a first-time anonymous visitor to the second most expensive plan. The
  default should be Solo: a Solo customer who brings their team six months
  later is worth more than an abandoned cart.
- **There is no way to reach a human.** The footer (`site/index.html:356-364`)
  has GitHub, npm, docs and the demo — no address, no form. Nobody spends
  $2,990 by card without asking about invoicing, a framework agreement, or
  where the kits are hosted.

### What to build

- Three cards on the landing page, one marked as recommended. Studio, the
  lifetime option and the currency table move to a dedicated `site/pricing.html`
  linked from under the cards.
- The closing CTA becomes Solo.
- The Organisation card's button becomes **Contact us**, not **Buy** — a
  `mailto:` is enough. That tier is a conversation, and pricing it behind one
  is also how the number stops being a wall.
- Keep every existing Polar link working, with its UTM from item 1.

### Needs a human

The contact address, and confirmation that Organisation should move to
contact-based rather than self-serve. Both are one-line answers.

### Done when

The landing page offers three options and one conversation; no price appears
only inside a paragraph; and `site/pricing.html` carries everything that was
removed, with nothing lost.

---

## 7. Give the Team tier something to sell

### What is wrong

The only difference between Solo and Team is the number of people, and the one
benefit the page claims for Team — *Private brand kits included*
(`site/index.html:298`) — describes a capability that is already free for
everybody. `lutrin kit install <file|url>` (`cli.mjs:108`) takes any file or
any URL and checks no licence. Anyone can build and host a private kit at no
cost.

That is a promise with nothing behind it on a page asking $449. It has to
become true or it has to go.

### What to build

Pick one of three, cheapest first:

1. **A named support channel and a response commitment.** Costs nothing to
   build, and is often the line that releases a budget on the buyer's side.
2. **A team console.** The admin sees who has activated, revokes, reassigns.
   Polar's customer portal may already cover most of it — check before
   building.
3. **The distributed organisation kit.** A stable URL `lutrin kit install`
   follows, versioned, updated for the whole team at once. This is the real
   need behind the claim: that the brand does not drift across ten machines.
   It is also the most work, and the most defensible.

**Until one of them exists, remove the phrase from `site/index.html:298`.**
That deletion is not blocked on anything and should not wait for the decision.

### Needs a human

Which of the three, and whether to ship the deletion now. The deletion is the
default: an unbacked claim on a pricing page is a refund and a bad word waiting
to happen.

### Done when

Every benefit listed on a paid tier is either enforced by the code or is a
commitment a human has agreed to honour.

---

## 8. Four comparison pages, plus robots and sitemap

### What is wrong

`site/` has two pages, one language, no `robots.txt` and no `sitemap.xml`. The
queries that convert here are narrow and high-intent — *markdown to
powerpoint*, *generate pptx from markdown*, *marp export pptx editable*,
*automate powerpoint from markdown* — and the page ranks for none of them.

The material already exists. `README.md`'s *Why not Marp / Slidev / reveal.js /
Pandoc?* and the page's own *What it will refuse to do*
(`site/index.html:329`) are the argument, written honestly, sitting at the
bottom of a page nobody arrives at by search.

### What to build

Four pages on one template — `lutrin-vs-marp`, `-slidev`, `-revealjs`,
`-pandoc` — each with: what the other does better, said sincerely and first;
what Lutrin does differently; a comparison table; and the same deck compiled
by both where that is possible.

The honesty is not a courtesy, it is the mechanism. A comparison page that
concludes "we win on everything" is discounted on sight; the existing copy's
credibility comes precisely from conceding reveal.js's interactivity and
Pandoc's range, and the new pages inherit that or they are worth nothing.

Add `site/robots.txt` and a `site/sitemap.xml` listing every page.

### Depends on

Item 3 — build these once, on the final domain, or every canonical URL is
written twice.

### Done when

Four pages ship, each one's claims about the competitor verified against that
competitor's current documentation and dated, `sitemap.xml` lists all of them,
and `.gitignore` has one negation per new page (the global `*.html` artifact
ignore silently swallows them otherwise — this has bitten this repository
before).

---

## 9. Settle the Polar expiry question

### What is wrong

This is not an improvement, it is a lock on the door.

The product's `license_keys` benefit issues keys with `expires.ttl` of one
year, and `licenseState()` treats a passed `expires_at` as `EXPIRED` — the
attribution returns. Whether an annual renewal pushes `expires_at` forward is
**unverified**. If it does not, every paying customer loses their licence in
month twelve, silently, having paid.

The first real renewal is July 2027. Acquiring customers before this is settled
builds a cohort that breaks by itself.

### What to test

On a **sandbox** Polar organisation, never production: a benefit with a TTL of
days rather than a year, a test subscription, and an observation of what
happens to `expires_at` at renewal.

Two fixes, if renewal extends nothing:

- Treat `EXPIRED` as a trigger to revalidate against Polar rather than as a
  verdict.
- Or drop the TTL from the benefit entirely and rely on `status`, which Polar
  sets to `revoked` when the subscription ends.

The second is simpler and probably right: the subscription's state is the fact,
and the TTL is a second source of truth that can only ever disagree with it.

### Needs a human

The sandbox organisation and the test payment.

### Done when

The behaviour is known, recorded in this file with the date it was observed,
and — if the answer is bad — fixed and covered by a test in
`packages/core/test/license.test.mjs`.

---

## 10. A gallery of public kits

### What is wrong

The page promises that an organisation's brand travels as a kit
(`site/index.html:269-274`), and shows the reader no kit at all. The kit editor
page photographs `examples/kit-slate` and says so. Nothing helps a visitor
picture their own brand, which is the step between *interesting* and *this is
for us*.

### What to build

Six to eight public kits, each installable in one command, each displayed with
the **same** slide compiled in it — the comparison is the whole point, and it
only works if the content is held constant.

- Kits live in the repository, are built into `.deckkit` archives by CI, and
  are served from the site so `lutrin kit install <url>` works against a real
  URL.
- Extend `.github/workflows/pages.yml` to compile one specimen deck per kit,
  the way it already compiles `demo.deck.md`. The gallery must never be
  screenshots — that is the rule the rest of the site holds itself to.
- **Invent the brands.** Never ship a kit resembling a real organisation's
  identity; `scripts/kit-editor-shots.mjs` already refuses to photograph a real
  brand, and this holds to the same line.

The side benefit is that a visitor sees what a kit costs to make, which is the
opening for the service that builds one from a customer's brand guidelines.

### Done when

Every kit in the gallery installs from the published URL in one command, the
specimen slides are compiled by CI at `HEAD`, and no kit is traceable to a real
organisation.

### What shipped — 2026-07-30

Eight kits in `examples/kits/`, one `specimen.deck.md` compiled into each, and
`site/gallery.html` showing the same slide eight times over. `scripts/gallery.mjs`
writes both halves — `<out>/kits/<name>.deckkit` and
`<out>/gallery/<name>.html` — and is run by `npm run site` against `site/` and
by `pages.yml` against `_site/`, so the loop exists once rather than twice.

Three decisions worth recording, because each was a fork:

- **The brands are archetypes, not invented companies.** "A newsroom", "a
  university", "an industrial supplier" — no name, no logo, no wordmark. The
  plan said to invent brands and never resemble a real one; an archetype
  cannot resemble anyone, and it still lets a reader picture their own.
- **The tile shows the layered slide, not the chart or the cover.** Both were
  built and looked at first. At the size a tile is actually read, a slide with
  body text says nothing and a cover says only two words; the layered slide
  puts the whole palette on screen at once, which is what eight tiles side by
  side are for.
- **No kit ships fonts.** A theme that changes the family without
  `fonts.files` embeds nothing at all, deliberately, so both outputs fall back
  together — safe only for the families every machine already has. The
  allowlist is enforced by `packages/core/test/kit-gallery.test.mjs`, which
  also refuses a kit whose palette the engine itself would warn about, and a
  page whose cards and kit directories have drifted apart.

---

## The strategic fork this plan does not settle

Three things were deliberately left out — a French version of the site, an
official GitHub Action, and a done-for-you service that turns a customer's
brand guidelines into a kit.

They are not oversights. They belong to a choice nobody has made yet:

- **Self-serve volume.** The playground, the comparison pages, the kit gallery,
  low prices, many small customers. The site is written for this today.
- **High-touch service.** Kits built to order, a handful of organisations,
  five-figure engagements. The *product* argues for this more naturally than
  the page does — a strict engine, a corporate brand, a compiler that refuses
  improvisation is an enterprise story, and building the kit is the work the
  customer cannot do and will pay most for.

Items 1 through 10 are worth doing under either. The three that were left out
are not; each only pays off on one side of the fork. Settle the fork, then add
them.
