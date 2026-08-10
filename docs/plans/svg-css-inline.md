# Inline the CSS of a foreign SVG, and get the vector twin back

**Status: not started.** The defect it would close is already closed the cheap
way — `svgPartSafe` refuses an SVG carrying an internal `<style>`, so the
reader gets the correct raster. This plan is about getting the *sharpness*
back, not about correctness.

## What happened

`scripts/pptx-fidelity.mjs` renders the HTML and the `.pptx` side by side and
compares pixels. On `examples/demo.deck.md` it found one real defect: slide 8's
Mermaid diagram drew every node as a **filled black box** with its label
escaping to the right.

One anomaly, two symptoms. Of the eleven SVGs the demo embeds, `vector-8-1.svg`
is the only one **we do not author** — it comes from mermaid and passes through
verbatim. Mermaid targets a browser, so:

```
<svg id="lutrin-diagram" width="100%" style="max-width: 264.34375px;" viewBox="0 0 264.34375 548">
<style> #lutrin-diagram .node rect{fill:…}   ← 4953 bytes of CSS
<rect class="background" style="stroke: none">    ← no fill attribute at all
```

A reader that does not apply those rules paints the nodes with the SVG default
— black — and has no basis for `width="100%"`, so the text leaves its box.

## What was measured, and the claim it corrected

| path | result |
|---|---|
| HTML (browser) — the reference | correct |
| the PNG embedded in the `.pptx` | **correct** |
| the SVG through resvg | correct |
| the SVG through LibreOffice Impress | **broken** |

`pptx-fidelity.md` first explained this as "a renderer that is not a browser
does not run that CSS". That is not right: resvg is not a browser and renders
it correctly. The failure is LibreOffice's SVG import specifically.

A second belief fell with it. `pptx/svg.mjs` claimed LibreOffice was among the
readers that ignore the `asvg:svgBlip` extension. It is not — Impress reads it
and **prefers the SVG over the PNG**, which is why a vector that disagrees with
its raster is not a harmless upgrade there.

**Nobody has tested what PowerPoint 2019+ does with this SVG**, and that is the
open question that decides how much this plan is worth. If PowerPoint behaves
like Impress, the same defect was hitting the primary target all along.

## Re-measured on `c600e18`

Everything above still holds; three details are worth pinning down before
anyone picks this up again.

**The gate is doing exactly what it was built to do.** `examples/demo.deck.md`
builds to eleven PNGs and ten SVGs. The one raster with no vector twin is
`ppt/media/image-8-1.png`, the Mermaid diagram — `svgPartSafe` refuses it on
the `<style>` test and nothing else in the deck is affected.

**The test to write first is not quite the one described below.** That
paragraph says to pull `ppt/media/vector-8-1.svg` out of the zip and assert its
node rects carry a `fill`. There is no such entry in the zip today: the twin is
declined, so the file is absent entirely. The test that fails on today's tree
asserts *absence*; after the change it has to assert both that the part exists
**and** that its node rects carry a `fill` of their own. A test written the
original way would pass vacuously on a build where the transform silently
declined.

**Impress still reproduces, and the picture is unambiguous.** Rebuilding with
the `<style>` line at `deck/svg.mjs:486` disabled ships the twin, and slide 8
renders in Impress as solid dark boxes with every label pushed clear of its
box; the same slide from an unmodified build is correct. So the cheap fix is
not merely defensible, it is load-bearing for Impress readers.

One caveat for whoever runs this next: `scripts/pptx-fidelity.mjs` needs
`libreoffice-impress`, not just `libreoffice-core`. A box with only the core
package fails with `source file could not be loaded`, which reads like a
corrupt `.pptx` and is not one.

## The work

Inline the computed CSS onto the elements as presentation attributes, before
`svgPartSafe` sees the string, then let the twin ship as usual.

The hard parts, in the order they will bite:

- resolving scoped selectors (`#lutrin-diagram .node rect`) without a browser,
  on output whose shape mermaid is free to change between versions;
- `width="100%"` plus an inline `style="max-width:…"` has to become a real
  width, taken from the `viewBox`;
- the specificity order has to be respected, or a rule that was being
  overridden wins;
- `svgPartSafe` is deliberately conservative, and for a good reason: a
  malformed part makes PowerPoint declare the whole file corrupt. Anything this
  transform emits has to keep passing every check that is already there.

The test to write first is the one that fails today: build the demo, pull
`ppt/media/vector-8-1.svg` out of the zip, and assert the node rects carry a
`fill` of their own.

## Why it was not done straight away

The cheap fix makes the deck correct everywhere immediately, and costs only
sharpness at zoom on Mermaid diagrams — the other ten SVGs keep theirs. The
ambitious fix earns that sharpness back and is worth doing on evidence that
someone zooms into a Mermaid diagram in PowerPoint, or that PowerPoint shows
the same defect Impress does.
