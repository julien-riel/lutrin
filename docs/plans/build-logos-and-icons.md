# Build brief — icon sizes, the deep walker, the logo wall, and one experiment

This is an implementation brief, not an exploration: the design decisions below
are taken, and where one is still open it says so and says who takes it. The
reasoning behind each is in
[logos-testimonial-icons.md](logos-testimonial-icons.md); read it once, then
work from here.

Read also: `CONTRIBUTING.md` (the contract, output parity, the test rules) and
[docs/dsl.md](../dsl.md).

Work in this order. Items 1 and 4 are independent of everything; 2 must land
before 3.

---

## 1. A semantic size for icons

`![](lucide:leaf)` draws at `Math.min(r.w, r.h, 160)` — the slot decides, and
an author cannot say that an icon heading a pillar should be smaller than one
opening a section.

### The syntax

The alt slot already carries an intent word for colour, validated against
`ICON_COLORS` (`parse.mjs`). Add a size word to the same slot, in any order:

```markdown
![](lucide:leaf)                  medium, primary — unchanged
![large](lucide:leaf)             large, primary
![neutral small](lucide:leaf)     both words, either order
```

`imageBlock()` currently does `ICON_COLORS.has(alt) ? alt : 'primary'` on the
WHOLE alt. Split it on whitespace, match each word against `ICON_COLORS` and
against the new `ICON_SIZES`, and — this is the part that is easy to skip —
**report a word that matches neither**. An author who writes `![big]` must get
`UNKNOWN_ICON`-style feedback with a "did you mean" (`suggest.mjs`, `closest`),
not silence. Add the diagnostic code, add it to the canonical list in
`validate.mjs`, and assert it appears in `capabilities().diagnostics`.

### The sizes

Three words — `small`, `medium` (the default), `large` — as **factors** applied
to the size both renderers already compute, so the slot still governs and the
word only adjusts. Put them in `deck/tokens.mjs` beside the other design
constants.

**Open decision, yours:** whether a kit may retune them. If yes, they become a
themable group, which means adding the group to `THEME_KEYS`, to `ALL_LIVE`,
**and** to `design/themes/default.json` — `theme.test.mjs` has an anti-drift
check that fails if the JSON mirror and the tokens disagree. If no, they stay
module-private and a kit that wants different icon sizes cannot have them. My
recommendation: start private, and let the first kit that asks carry the
change.

### Done when

Both renderers honour the factor (`addIcon` in `pptx/render.mjs`, `htmlIcon` in
`html/render.mjs`), a parity test asserts the same block yields the same size on
both sides at each of the three words, the unknown-word diagnostic is tested,
`docs/dsl.md` and `.claude/skills/deck/SKILL.md` document the words, and the
goldens have not moved — an icon with no size word must produce a block with no
size key at all.

---

## 2. The deep block walker

Prerequisite for item 3. Land it alone, before it.

The asset prepass in both renderers sees only `sc.elements.map(e => e.block)`
(`html/render.mjs:1556`, `pptx/render.mjs:1416`). Anything nested inside a block
is never fetched, never resolved, never embedded.

Build one walker in `deck/` — a block walker knows no output format, so
`boundary.test.mjs` stays satisfied; confirm that rather than assume it. Every
composite block declares its children in ONE place, and keeping that place small
is the design goal. `alert.blocks` goes through it too, even though its children
carry no assets today: a walker with a single user proves nothing.

**Measured baseline:** across `demo`, `reference`, `all-blocks` and `whats-new`
there are 28 assets today, all top-level, none nested. So this change alters no
existing output, and **a golden that moves while you land it is a defect in the
walker** — that is the assertion to write first.

### Done when

Three tests pass: a nested remote image is fetched and embedded, a nested local
image resolves against the deck's directory, a nested missing image still
produces `MISSING_IMAGE`. Plus the goldens-do-not-move assertion.

---

## 3. The logo wall

`:::logos`, one image per line. A row that reflows, with the logos optically
matched.

```markdown
:::logos
![Ville de Montréal](logos/montreal.svg)
![Hydro-Québec](logos/hq.png)
![Polytechnique](logos/poly.png)
:::
```

### What makes it a block rather than a grid

Two things, and if you do not implement them there is no reason to build this
at all — `grid` plus one image per cell already compiles today:

1. **Optical normalisation.** A 6:1 wordmark and a 1:1 roundel scaled to the
   same height look nothing alike. Equalise the optical *area* instead:
   `imageDims()` (`deck/assets.mjs:236`) reads native dimensions, and the same
   prepass that fetches the image can measure it. Write down the formula you
   use and why, because the next person will want to tune it.
2. **A row that wraps by itself.** `logoLayout(block, widthPx)` in
   `deck/tokens.mjs`, on the `badgeLayout()` model: the wrap is computed once in
   `deck/`, and `blockHeight()` *and* both renderers read that one answer. Three
   ways of wrapping would be three geometries.

### Decisions taken

- **No desaturation in version one.** A logo is someone else's trademark;
  altering it can be a legal question, not only an aesthetic one. If greyscale
  is wanted later it is a layout parameter, with colour as the default, never a
  silent transformation.
- **Alt text is mandatory** and carries the organisation's name — `altText` in
  the `.pptx`, `alt` in the HTML. A wall of eleven unlabelled images would be
  the least accessible thing this engine produces. An entry with no alt text is
  worth a diagnostic.
- **A missing logo degrades like any image**: the placeholder and
  `MISSING_IMAGE`, never a hole that silently changes the wrap.

### Done when

The block renders in both formats, the demo and `all-blocks.deck.md` carry one
with a `ZQ…` marker (`parity.test.mjs` goes red until they do — intended), the
goldens are regenerated with the diff re-read, and a test asserts that two logos
of very different aspect ratios come out at comparable optical weight. That last
one is the feature; without it this is a grid.

---

## 4. The inline icon — run the experiment before designing anything

**Expected outcome: this is closed.** The experiment exists to prove it with
evidence rather than assert it, and to bank the result either way.

A run becomes an OOXML `<a:r>`, which holds run properties and text. PptxGenJS's
run options are `align`, `bold`, `breakLine`, `bullet`, `highlight`,
`hyperlink`, `softBreak` — no image; `addImage` is a method on the *slide*. So
an inline icon in the `.pptx` could only be an image floated over the text box
where the glyph would have fallen, at coordinates PowerPoint computes at render
time from a font this engine does not measure.

### The experiment

Write a throwaway script that emits one `.pptx`: a text box with a sentence, and
an `addImage` positioned where you believe the icon belongs. Then open it in
**PowerPoint, Keynote and LibreOffice**, at two window sizes, and capture each.

- If the icon holds its place in all three, report back — the design changes and
  this brief is wrong.
- If it drifts anywhere, record the result in the REJECTED section of
  [widgets-next.md](widgets-next.md) with the captures, and stop.

### Do not reach for `bullet.characterCode`

It looks like the free way to put a mark in front of every item. A character
code is a **Unicode glyph**, so it lands back on the finding already banked: ●
(U+25CF) and ○ (U+25CB) are in WGL4 and survive font substitution, most of what
anyone reaches for is not, and a Lucide icon has no Unicode equivalent at all.
The supported way to put an icon at the head of a line is an icon **block**
placed there by the layout.

---

## What holds throughout

- **The contract.** Intent and content from the author; sizes, positions and
  colours from the engine, a `layouts/*.json` or a kit. A size *word* is intent;
  a size in points is not.
- **Parity judged by the least capable viewer.** This branch paid for that
  lesson twice: `highlight` is a PowerPoint extension Keynote drops, and the
  inline badge rendered white-on-white until the pale pair replaced it. Ask what
  Keynote, QuickLook and LibreOffice show.
- **A test that fails before the fix.** Break the implementation, run the file,
  confirm red. Two tests on this branch looked fine and only bit after mutation.
- **Goldens move only for new block types.** Anything else is a defect.
