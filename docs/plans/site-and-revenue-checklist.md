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

---

## Now

### ☐ 1. Analytics provider — *blocks item 1*

Plausible or Umami. Both are cookie-free, which is the requirement; Umami can
be self-hosted, Plausible cannot without work. Create the account and put the
site key somewhere the agent can read it.

Without this, every other item ships blind — there is no way to tell whether it
worked.

> **Answer:**
> **Date:**

---

### ☐ 2. Buy the domain — *blocks items 3 and 8*

`lutrin.dev`, `lutrin.app`, or another. Buy it, point the DNS at GitHub Pages.
The agent handles `site/CNAME` and every absolute URL in the repository from
there.

Item 8 (the four comparison pages) waits on this — building them first means
writing every canonical URL twice.

> **Domain:**
> **Date:**

---

### ☐ 3. Approve the unbacked-claim deletion — *unblocks part of item 7*

*Private brand kits included* (`site/index.html:298`) is the only benefit
separating Team from Solo, and it describes something already free for
everybody: `lutrin kit install` takes any URL and checks no licence.

Deleting it is the default and needs no plan. Say yes and it goes this week;
what to build in its place is decision 6 below and can take its time.

> ☐ Delete now ☐ Keep until a replacement ships (say why:)
> **Date:**

---

### ☐ 4. Contact address, and the Organisation tier's shape — *blocks item 6*

Two answers:

- The address that goes on the site. A `mailto:` is enough.
- Does Organisation ($2,990) become **Contact us** instead of **Buy**? At that
  price nobody pays by card without asking about invoicing and framework
  agreements first, and pricing it behind a conversation is also how the number
  stops reading as a wall.

> **Address:**
> **Organisation stays self-serve?** ☐ yes ☐ no
> **Date:**

---

### ☐ 5. The attribution's language — *blocks half of item 2*

`BRAND_MENTION` is `'Généré avec Lutrin'` (`packages/core/src/license/index.mjs:42`)
while the site, the README and every CLI string are English. Today an
anglophone buyer ships a client deck carrying a French line, by accident rather
than by choice.

- **English** — one string, matches the product surface.
- **Localised from the deck's `lang`** — more work, more correct, and it is a
  small feature rather than a fix.

The other half of item 2 (the upsell line at the end of `build`) is not blocked
and can ship first.

> **Answer:**
> **Date:**

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

> **Answer:**
> **Date:**

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

> **What happened at renewal:**
> **Date observed:**

---

### ☐ 8. Testimonials — *blocks half of item 4*

Two or three, with a real name, a real role and a real organisation, each
cleared by the person quoted.

If there are none yet, say so and the proof strip ships empty — the agent is
instructed not to invent them, and will not. The FAQ half of item 4 is not
blocked either way and can go now.

> **Who:**
> **Cleared?**
> **Date:**

---

## Conditional

### ☐ 9. A build step for the playground — *only if item 5 asks*

`site/` is static with no build step, and that is worth keeping. If the
compiler cannot be made to run in a browser without a bundler, the agent is
told to stop and report rather than quietly add one.

If that report arrives, the question is yours: accept a bundler for `site/`, or
drop the playground.

> **Answer, if asked:**
> **Date:**

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
