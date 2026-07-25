# Brief — reopening `:::rating` and `:::person`

Both were proposed in the widgets review and both were **rejected**; see the
REJECTED section of [widgets-next.md](widgets-next.md). `:::rating` scored
4.3/10, last of thirty candidates. `:::person` scored 4.7.

This is not a plan. It is the brief for whoever wants to reopen them, and its
first instruction is the important one:

> **The rejections are findings, not opinions. Your job is to REFUTE them with
> evidence, not to route around them.** If you build either widget without
> answering the objection below, you will ship the exact defect the review
> predicted, and the review will have been the cheaper way to learn it.

Read first: `CONTRIBUTING.md` (the contract, output parity, the test rules),
[docs/dsl.md](../dsl.md), and the two objection paragraphs in
[widgets-next.md](widgets-next.md). Then read the code the objections cite —
they cite it precisely because the arguments are checkable.

---

## `:::rating` — options against criteria, as filled discs

The Harvey ball: a row of discs, each empty, quarter, half, three-quarter or
full, one per criterion. The idiom of consulting decks for forty years.

### Objection 1 — the denominator is never declared, and this is the hard one

Every proposed syntax wrote a bare number:

```markdown
:::rating
Fit to process: 4
Cost of change: 2
:::
```

**`4` is 4/5 to one author and 4/10 to another.** Deriving the scale from the
observed maximum is worse than leaving it undeclared: adding one `5` anywhere
silently rescales every other row in the deck, so the same source produces two
different pictures depending on data that has nothing to do with the row being
drawn. That is the failure this project refuses on every change it ships.

**What you must produce:** a spelling where the scale is stated and cannot
drift. `Fit to process: 4/5` is the obvious candidate — it reuses the fraction
form `parseProgressValue()` already accepts, it is per-row so a deck can mix
scales, and it needs no reserved key. Write it down and check it against the
`:::progress` grammar, because the two must not disagree about what `3/4`
means.

### Objection 2 — the glyph does not survive, and neither does the shape

This is the finding to carry into anything that ever draws a mark:

- **● (U+25CF) and ○ (U+25CB) are in WGL4**, hence present in Arial and in
  every face that substitutes for it.
- **◐ (U+25D0) — the Harvey ball everyone reaches for — is not.** A kit
  shipping a narrow font puts a tofu box in front of the committee.

So the typographic route is closed for the partial states. The drawn route has
its own trap, and it is worse. PptxGenJS does expose `angleRange` on
`pie`/`arc` — the option is real, which is exactly what makes this easy to walk
into — but it writes an OOXML shape *adjustment*, and **a viewer that ignores
the adjustment draws the preset's default 270° wedge**: a confidently wrong
score on the slide, in front of the committee, with nothing that looks broken
for anyone to notice. Compare the inline-badge defect this branch fixed
(commit `763d877`): a badge that vanished was at least visibly absent.

**What you must produce, before writing the block:** a real `.pptx` containing
`angleRange` wedges at 25 %, 50 % and 75 %, opened in **Keynote, QuickLook and
LibreOffice**, and a screenshot of each. The export recipe is in
`.claude/skills/deck/SKILL.md`. If any of the three draws 270°, arcs are out
engine-wide — and the fallback is five WGL4-safe marks (filled versus hollow,
which also separates the extremes without relying on hue, and survives
greyscale), which is no longer a Harvey ball and should be named something
else.

### Objection 3 — a table already says it, and more precisely

`| Fit to process | 4 | 5 | 3 |` states the judgement exactly, prints in
greyscale, needs no key, and is already supported. **Answer this in one
paragraph** before you start: what does a reader get from part-filled discs
that they do not get from that table? "It looks like a consulting deck" is an
honest answer, but it has to be said out loud so it can be weighed.

### If all three are answered

An ordinary block: `CONTAINERS` entry, a `ratingLayout()` in `deck/tokens.mjs`
returning boxes local to the block (follow `badgeLayout()` — the wrap and the
geometry live in `deck/`, so both renderers and `blockHeight()` read one
answer), a `blockHeight` case, both `BLOCK_RENDERERS`, a slide in
`examples/demo.deck.md`, a `ZQ…` marker in `test/fixtures/all-blocks.deck.md`,
both goldens regenerated, and the parity and full-render nets extended. Budget
the same as `badge` took, and note that `parity.test.mjs` asserts the demo
contains one block of every type — the suite goes red the moment the renderer
tables know a type the demo does not.

---

## `:::person` — a face on a governance slide

### Objection 1 — it is unbuildable as specified, and this is verified

The asset prepass in both renderers collects:

```js
const allBlocks = scenes.flatMap((sc) => [
  ...sc.elements.map((e) => e.block),
  ...(sc.image ? [sc.image] : []),
]);
```

`html/render.mjs:1556` and `pptx/render.mjs:1416`. It sees the blocks a scene
places and **nothing nested inside them**. A `person` block carrying an avatar
would therefore never have its image fetched, resolved or embedded: `htmlImage`
falls straight through to the `[image: …]` placeholder, and the `.pptx` gets
nothing. No block in the engine is composite *and* carries an asset today,
which is why this has never bitten.

**What you must build first, as its own change:** a deep block walker, in
`deck/` so both renderers read the same one (a block walker knows no output
format, so `boundary.test.mjs` is satisfied — check it). Every composite block
declares its children; `alert.blocks` is the existing precedent and should go
through the same walker even though its children carry no assets today, or the
walker has one user and proves nothing.

Land that walker with its own test — a nested remote image is fetched, a nested
local image resolves, a nested missing image produces `MISSING_IMAGE` — and
only then consider the block. If the walker is not worth landing on its own,
`:::person` is not worth landing either.

### Objection 2 — a grid cell already does this

An image, a heading and a paragraph in a `grid` cell produce a usable
governance slide today, with no new code. **State what `:::person` adds** that
this does not:

- a *row* of people that wraps by itself (the `badgeLayout()` argument, and the
  strongest one — a `grid` needs its column count chosen by hand);
- a round avatar, which no existing block can draw;
- initials as a fallback when there is no photo, which is what most
  organizations actually have.

If those three are the case, make it. If only the third is, it is a `grid`
layout and a convention, not a block.

### Watch for

- **Photographs are the most likely thing in this repo to leak.** Remote images
  are already cached, confined and embedded (`deck/assets.mjs`, and read
  `SECURITY.md`); a nested one must take exactly that path, not a new one.
- The contract line: a name, a role and a photo are **content**. A size, a crop
  and a position are not — the engine decides those.
- Initials are derived from the name, never typed. An author who can type
  initials will type them inconsistently.

---

## What holds for both

- **The contract.** An author writes intent and content; anything
  configurable goes in a `layouts/*.json` or a kit's theme. A new block that
  needs the author to tune it against the output is refused however useful.
- **Parity.** Both `BLOCK_RENDERERS` tables, and a documented, deliberate
  degradation where PowerPoint cannot follow. The lesson of this branch:
  degrade toward what the *least capable viewer* shows, not toward what
  PowerPoint offers — `highlight` is a PowerPoint extension, Keynote drops it,
  and the badge went white-on-white until the pale pair replaced it.
- **A test that fails before the fix.** Break your implementation and run the
  file; if it stays green, the test asserts nothing. Two tests in this branch
  looked fine and only bit after mutation showed they did not.
- **Goldens move only for new block types.** Any other movement is a defect in
  the change.

## The deliverable

Before any implementation: a short document answering the objections above,
with the Keynote/QuickLook/LibreOffice screenshots for `:::rating` and the
walker's test for `:::person`. Then, if the answers hold, the implementation —
and if they do not, add what you learned to the REJECTED section of
[widgets-next.md](widgets-next.md) so the next person starts from your evidence
rather than from the same idea.
