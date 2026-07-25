# Plan 5 — Auto-fit: no silent overflow

## Problem

Nothing shrinks, nothing truncates. `flowBlocks()` places a block at the height
`blockHeight()` estimates and moves on; where pagination is disabled — which is
**every structured layout**, every column, every panel — a block that does not
fit simply keeps going, out of its region and over whatever is underneath.

The first render of the dashboard is the exhibit: three panels of overlapping
text, unreadable, and the compiler reported it as a `BLOCK_OVERFLOW` warning
that a batch job would never have read. The fix was manual — shortening the
descriptions of the follow-up panel one word at a time until the line count
came out right.

For a deck written by hand that is merely annoying. For a deck generated from
data — which is what a status board is — it is the difference between a tool
that can be automated and one that cannot: the author of the template never
sees the sentence that overflows.

## What exists today

`BLOCK_OVERFLOW` (`validate.mjs`, threshold 12 px) fires *after* the scene is
built and changes nothing about it. `SLIDE_PAGINATED` covers the flow layouts
only. The `metrics` layout drops surplus cards (`METRICS_DROPPED`), and
`buildScenes` truncates section counts at the registry bounds — so there is a
precedent for the engine acting on excess, and a precedent for it reporting
what it did.

## Dependency

This plan is the **policy**; [plan 1](01-text-scale.md) is the **lever**.
Auto-fit works by re-flowing a region one density step down, which requires
the density steps to exist. Plan 1 first.

## The rule

In `flowBlocks()`, when `paginate: false` and the flowed content exceeds the
region:

1. re-flow the whole region at the next density step down;
2. repeat, at most twice (`comfortable` → `compact` → `dense`);
3. if it still overflows, place it as today and let `BLOCK_OVERFLOW` fire —
   with a message that now says the engine already tried.

Three properties this shape has, and each was a candidate mistake:

- **The whole region steps down, never a single block.** Shrinking only the
  offending paragraph gives a panel with three type sizes in it, which looks
  like a bug rather than a fit.
- **The step is discrete.** A continuous best-fit factor makes every panel a
  slightly different size and makes the goldens meaningless.
- **The floor is honest.** Below `dense`, the engine stops and says so. Text
  at 6 pt is not a fit; it is a failure with the evidence hidden.

## Diagnostics

`SLIDE_DENSIFIED` — new, severity `info`, in the same family as
`SLIDE_PAGINATED`:

> Panel "Follow-up items" was rendered one density step down (compact) to fit
> its region — shorten the content to keep the deck's default size.

`BLOCK_OVERFLOW` keeps its code and severity but gains a clause when
densification was already attempted, so the advice stops suggesting something
the engine has done:

> …overflows its region by about 40 px (grid layout), already at the densest
> step — cut the content or split the slide.

Both codes must appear in the `capabilities().diagnostics` list; a
`validate.test.mjs` case asserts it, as it already does for the others.

## Cost

`flowBlocks()` is called once per region and is pure measurement — no I/O, no
rendering. A re-flow is a second pass over the same blocks; two re-flows is a
third. Worst case on a dense deck is roughly 3× the layout pass, which is a
few milliseconds against the seconds that Mermaid, fonts and image embedding
cost. Not worth optimising, and worth measuring once so the claim is not
merely asserted: `full-render.test.mjs` already times a full deck.

## Interaction with pagination

Where `paginate: true` (the `content` flow and its `(cont.)` slides),
**pagination wins and densification never runs**. A flow layout has somewhere
to put the overflow; shrinking it instead would silently trade a legible
second slide for a cramped single one. This is the one branch of the change
that is a policy call rather than a mechanic, and it should be stated in
`docs/dsl.md` in those terms.

## Tests

- `layout.test.mjs` — a panel whose content exceeds its region by 20 % comes
  back at `compact` with no overflow; one that exceeds it by 300 % comes back
  at `dense` **and** still flags `BLOCK_OVERFLOW`.
- `layout.test.mjs` — a deck that fits at `comfortable` produces scenes with
  no `size` key anywhere (goldens do not move; this is the assertion that
  protects every existing deck).
- `layout.test.mjs` — a `content` slide that overflows paginates and is never
  densified.
- `validate.test.mjs` — `SLIDE_DENSIFIED` at severity `info`; the amended
  `BLOCK_OVERFLOW` wording appears only after the densest step.
- A regression test built from the dashboard itself: the follow-up panel with
  its **original, unshortened** descriptions must render without overlap. That
  is the case that failed, and it is the one that proves the fix.

## Out of scope

- Truncation with an ellipsis. Losing an author's words silently is worse than
  overflowing visibly — at least an overflow is seen.
- Shrinking images, charts or diagrams: they already adapt to their slot.
- Auto-splitting a structured layout across slides. A `swot` is four quadrants
  by definition; a two-slide `swot` is not a `swot`.
