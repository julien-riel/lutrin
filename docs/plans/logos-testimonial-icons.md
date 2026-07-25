# Brief — logo wall, customer testimonial, and icons that carry a size

Three requests. They are grouped because the first two share a prerequisite,
and because the third is really three requests wearing one coat — with three
different answers.

Read first: `CONTRIBUTING.md` (the contract, output parity, the test rules),
[docs/dsl.md](../dsl.md), and [widgets-next.md](widgets-next.md) for how the
last review weighed a block against a layout. The rule that decided every item
there decides these too: **a block costs a parse rule, a `blockHeight`, two
renderers, the demo, the fixture, both goldens and two parity nets. A layout
costs a JSON file.** Reach for the cheap form unless you can say what it fails
to do.

---

## Step 0 — the deep block walker, and why it is justified NOW

The asset prepass in both renderers collects only the blocks a scene places:

```js
const allBlocks = scenes.flatMap((sc) => [
  ...sc.elements.map((e) => e.block),
  ...(sc.image ? [sc.image] : []),
]);
```

`html/render.mjs:1556`, `pptx/render.mjs:1416`. Anything nested inside a block
is invisible to it: never fetched, never resolved, never embedded — the HTML
falls through to the `[image: …]` placeholder and the `.pptx` gets nothing.

[reopening-rating-and-person.md](reopening-rating-and-person.md) refused to
build that walker for `:::person`, on the grounds that a `grid` cell already
draws a governance slide and the walker would have had one speculative user.
**Both items below carry an image inside a block, so that objection is now
answered** — build the walker first, as its own change, with its own tests:

- a nested remote image is fetched into the cache and embedded;
- a nested local image resolves against the deck's directory;
- a nested missing image still produces `MISSING_IMAGE` rather than silence;
- `alert.blocks` goes through the same walker, even though its children carry
  no assets today — a walker with one user proves nothing.

It lives in `deck/`, so both renderers read the same one (a block walker knows
no output format; `boundary.test.mjs` stays satisfied — check it). Every
composite block declares its children in one place, and that place is the thing
to keep small.

**Measured before you start:** across `examples/demo.deck.md`,
`reference.deck.md`, `all-blocks.deck.md` and `whats-new.deck.md` there are 28
assets today, **all at the top level, none nested**. So the walker changes no
existing output, and a golden that moves while you land it is a defect in the
walker.

---

## 1. The logo wall

A row or grid of customer, partner or funder logos. The closing slide of a
sales deck, the credibility slide of an RFP response, the sponsor band of an
all-hands.

### What already works, and what it fails at

`grid` + one `![](logo.png)` per cell compiles today. I checked. What it cannot
do is the thing that makes a logo wall look professional rather than assembled:

**Optical normalisation.** Logos have wildly different aspect ratios — a
wordmark is 6:1, a roundel is 1:1. Scaling both to the same *height* makes the
wordmark dominate; scaling both to the same *width* makes the roundel dominate.
Designers equalise the **optical area** instead. That is arithmetic on native
dimensions, and `imageDims()` in `deck/assets.mjs` already reads them (it is
what `containRect()` uses).

Second thing a grid cannot do: **wrap by itself**. A grid needs its column
count chosen by hand; eleven logos want a row that reflows, exactly as
`badgeLayout()` reflows badges.

### If those two are the case, it is a block

`:::logos` with one image per line, geometry in `deck/tokens.mjs` as
`logoLayout(block, widthPx)` returning boxes local to the block — follow
`badgeLayout()`, whose whole point is that the wrap is computed once in `deck/`
and read by both renderers *and* by `blockHeight()`.

Decide and write down:

- **Does the block desaturate?** A wall of logos in twelve brand colours is
  noise, and greyscale is the convention. But a logo is someone else's
  trademark, and altering it can be a legal matter as much as an aesthetic one.
  If you do it, it must be a layout parameter with colour as the default, never
  a silent transformation.
- **Alt text.** Each logo is an organisation's name, and the name must reach
  `altText` in the `.pptx` and `alt` in the HTML. A wall of eleven unlabelled
  images is the least accessible thing this engine would produce.
- **The height rule.** `blockHeight()` must know the answer before either
  renderer runs; derive it from the row count `logoLayout()` computes, exactly
  as the badge row does.

---

## 2. The customer testimonial

A quotation, a face, and an attribution that is really three fields: a person,
a role, an organisation.

### Start by trying NOT to make it a block

`quote` already exists, already takes an attribution (`cite`), and already has
a layout of its own. The honest first question is whether this is **a property
of `quote`** rather than a new type:

```markdown
> The permit flow went from three weeks to two days.
>
> — Virginie Tremblay, Director of Permits, Ville de Montréal

![](virginie.jpg)
```

An image beside a quote already produces a `split`. What that does not give you
is the round avatar next to the attribution, and the attribution parsed into
its parts rather than left as one line.

**My recommendation:** extend `quote` with an optional avatar and a structured
attribution, and see how far that gets before writing `:::testimonial`. A
property costs a fraction of a block, and `quote` is exactly where a reader
would look for it.

Two things to settle either way:

- **Where the avatar comes from.** If it is a nested image, this is what makes
  step 0 necessary. If instead the author writes the image as a sibling block
  and the engine associates them, say precisely by what rule — proximity rules
  are the kind of magic that reads as a bug the first time it guesses wrong.
- **Round avatars.** The HTML crops with `border-radius: 50%`. The `.pptx` has
  `ShapeType.ellipse` as an image frame, and PptxGenJS exposes image cropping —
  verify what it actually emits and what Keynote does with it, on a real file,
  before designing around it. If the circle does not survive, a square avatar
  in both is better than a circle in one.

---

## 3. Icons — three requests, three answers

The request was: choose an icon's size semantically, use one inline in a
sentence, and possibly use one as a drop cap with text wrapping around it.
These have genuinely different verdicts, and conflating them would sink the
one that is easy.

### 3a. A semantic size — DO THIS ONE

Today `addIcon` draws at `Math.min(r.w, r.h, 160)`: the slot decides, and the
author cannot say that an icon heading a pillar should be smaller than one
carrying a section.

The DSL already puts an intent word in the alt slot for colour —
`![neutral](lucide:leaf)`, validated against `ICON_COLORS` in `parse.mjs`.
Extend the same slot with a size word: `![neutral large](lucide:leaf)`. Words,
never points — `small`, `medium`, `large`, resolved against the theme so a kit
can retune them. Both renderers already centre the icon in its slot, so this is
a factor applied to the size they compute, plus validation and a diagnostic for
an unknown word, on the `UNKNOWN_ICON` model.

Cheap, useful, entirely within the contract. Ship it on its own.

### 3b. An icon inside a sentence — most likely CLOSED, and prove it first

A run in this engine is `{ text, bold, italic, code, link, badge }` and it
becomes an OOXML `<a:r>`, which holds run properties and **text**. PptxGenJS's
run options are `breakLine`, `highlight`, `hyperlink`, `softBreak` — I grepped
the type definitions; there is no image among them, and `addImage` is a method
on the *slide*, not something a run can carry.

So an inline icon in the `.pptx` could only be an image floated over the text
box at the coordinates where the glyph would have fallen — and those
coordinates are computed by PowerPoint at render time, from a font this engine
does not measure. Guessing them means an icon that lands next to the wrong word
on someone else's machine.

**Before writing anything:** try it. Emit a text box with a sentence and an
`addImage` positioned where you believe the icon belongs, open the file in
PowerPoint *and* Keynote at two window sizes, and photograph the result. If it
holds, the design changes; if it drifts, this is closed and should be recorded
in the REJECTED section of [widgets-next.md](widgets-next.md) with the
evidence, so nobody spends the afternoon again.

**The fallback worth having either way:** an icon at the head of a *line* is
not an inline icon, and it covers most of what people mean when they ask for
this.

One trap on the way there. PptxGenJS does expose `bullet.characterCode` on a
text run, and it looks like the free way to put a mark in front of every item —
but a character code is a **Unicode glyph**, so it lands straight back on the
finding banked in [widgets-next.md](widgets-next.md): ● (U+25CF) and ○ (U+25CB)
are in WGL4 and survive any substituted font, while most of what anyone would
reach for is not, and a kit shipping a narrow face puts a tofu box on the
slide. A Lucide icon has no Unicode equivalent at all. So the fallback is an
icon **placed as a block** at the head of the line by the layout — which the
engine already knows how to do — never a bullet character.

### 3c. A drop cap with text wrapping around it — CLOSED as asked, open as composition

Text that flows around a shape needs a **text flow engine**. This compiler has
none, deliberately: it places blocks in rectangular regions and estimates their
heights (`blockHeight`, `flowBlocks`). The HTML could fake it with `float`, and
the `.pptx` cannot fake it at all — a DrawingML text box is a rectangle, and
there is no wrap-around-shape between two separate shapes. Building it on one
side only is the divergence `CONTRIBUTING.md` forbids.

But look at what a drop cap is actually for: an icon set large at the start of
a passage, the text beside it. That is a **composition**, and it exists:

```json
{ "name": "opener", "base": "split", "ratio": 0.22, "side": "left" }
```

An icon in a narrow left column, the text in the wide one. No wrapping, and no
one asked for the text to close underneath the icon — they asked for the icon
to introduce the passage.

**What to do:** ship that layout in the official catalog with a name that says
what it is for, document it as the answer to "drop cap", and record the true
wrap as refused with the reason. If the visual difference turns out to matter
to a real deck, that is new evidence and the question reopens.

---

## What holds for all of it

- **The contract.** Intent and content from the author; sizes, positions and
  colours from the engine, a `layouts/*.json` or a kit.
- **Parity, judged by the least capable viewer.** The lesson this branch paid
  for twice: `highlight` is a PowerPoint extension Keynote drops, and the
  badge came out white-on-white until the pale pair replaced it. Ask what
  Keynote, QuickLook and LibreOffice show — not what PowerPoint offers.
- **A test that fails before the fix.** Break the implementation, run the file,
  confirm it goes red. Two tests on this branch looked fine and only bit after
  mutation showed they did not.
- **Goldens move only for new block types.** Anything else is a defect.
- **Every new block type joins `examples/demo.deck.md` and
  `test/fixtures/all-blocks.deck.md`** with a `ZQ…` marker, or `parity.test.mjs`
  goes red — which is the intended behaviour, not an obstacle.

## Suggested order

1. **3a**, the semantic icon size — an afternoon, no prerequisite, pure gain.
2. **Step 0**, the walker — now justified, and it unblocks both items below.
3. **1**, the logo wall — the clearer of the two, and optical normalisation is
   the argument that makes it a block rather than a grid.
4. **2**, the testimonial — try it as a property of `quote` first.
5. **3c**, the `opener` layout — a JSON file, and it closes the drop-cap
   request honestly.
6. **3b** only if the experiment in it succeeds. Expect it not to.
