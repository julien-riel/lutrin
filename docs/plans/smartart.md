# SmartArt — four diagram layouts, and real OOXML SmartArt behind them

## What shipped

Four built-in layouts the rest of the catalog could not express, and one new
block type behind all four.

| Layout | Content | Draws |
|---|---|---|
| `cycle` | 3–8 `##` sections | discs on a closed ring, joined by arrows |
| `hierarchy` | a nested bullet list, or `##` sections | a tidy tree with elbow connectors |
| `venn` | 2–4 `##` sections | overlapping translucent discs |
| `radial` | a lead paragraph + 2–8 `##` sections | a hub and its satellites |

They are **never inferred**: like every structured layout, each is asked for
with `<!-- layout: … -->`.

By default a diagram is drawn as **native editable PowerPoint shapes** —
ellipses, rounded rectangles, arrows and text boxes — and as an inline SVG in
the HTML, from the same coordinates. `--smartart` (or `smartart:` in the
frontmatter) upgrades the `.pptx` to a real `<p:graphicFrame>` backed by five
`ppt/diagrams/*` parts, which is what makes PowerPoint open its own SmartArt
UI on the object.

## Why one block type and not four

Both renderer dispatch tables receive `el.block` and nothing else, so a marker
at the element level is invisible to them. And `wrapSlide` records one entry
per PptxGenJS call while `anim.mjs` pairs scene objects to `<p:spTree>` shapes
by order of appearance — dropping **every** animation on a slide whose counts
disagree. One block ⇒ one element ⇒ one recorded shape ⇒ a 1:1 swap the
animation pass cannot notice.

`widgets-next.md` prices a block type as expensive. Four families pay it once;
`family` is a field.

## The geometry lives in one place

`packages/core/src/deck/smartart.mjs` returns region-local numbers, and three
consumers read them: the HTML twin, the native `.pptx` shapes, and the injected
`drawingN.xml`. They agree because they read one function.

`smartArtGeometry()` is computed ONCE, in the raster pre-pass, and stored beside
the PNG in `ctx.diagrams`. Computing it three times from three separately-passed
rectangles would agree today only because `r` *is* `el.region`, and nothing
asserts that.

**Rotation convention**, honoured on both sides: a rotated element is its
UNROTATED box plus `rotate`, in degrees clockwise about the box centre. Those
are PptxGenJS's `rotate:` semantics exactly; the SVG writes
`transform="rotate(deg cx cy)"`. `parity` in `smartart.test.mjs` asserts the
triple for every link, because links are the only rotated things and an
inverted sign would send every arrow the wrong way round the ring while leaving
the boxes identical.

## Why the inner geometry is not in `demo.scenes.json`

A diagram is one element, so the scene golden shows one rectangle and says
nothing about the ring inside it. `packages/core/test/smartart.test.mjs` is the
golden for diagram geometry, and `test/golden/smartart.geometry.json` is the
snapshot.

## Colours: literal, never `schemeClr`

The tempting design is to reference the theme's accents so a diagram inherits
the kit brand for free. **That seam does not exist.** PptxGenJS writes a FIXED
Office theme (`accent1 4472C4, accent2 ED7D31, …`), lutrin never rewrites
`ppt/theme/theme1.xml`, and no `schemeClr` is emitted anywhere in this
renderer. A theme-accent diagram would render Office blue and orange inside a
Telus deck — on a product whose premise is brand kits.

So `colorsN.xml` carries literal `srgbClr` taken from the same `LAYER_SHADES`
the geometry used. One palette across PowerPoint, LibreOffice, Apache POI, the
fallback picture and the HTML.

The trade to know: a reader who runs *Change Colors* in PowerPoint's gallery
replaces the brand palette with an Office one and cannot get it back except by
rebuilding.

## Licensing

Every one of the five parts is authored here, from the ECMA-376 vocabulary.
Microsoft's built-in layout definitions are **not** vendored.

The reason is **outbound**, not upstream: this repository is MIT, MIT grants
downstream sublicensing, and checking in Microsoft-authored Office data files
would make lutrin's own outbound grant misleading to every consumer of the
package. `THIRD-PARTY-NOTICES.md` cannot fix that — it documents licences you
*have*.

**No `THIRD-PARTY-NOTICES.md` entry is required for this change.**

## The pres tree, per family

`dataN.xml` carries a `type="pres"` tree. It is not a cache: strip it and
PowerPoint draws floating text with no shapes. PowerPoint also REGENERATES it
from `layoutN.xml` on load, so a `presStyleLbl` the layout node does not carry
is replaced by a default we never shipped — the colour lookup then misses and
the shape renders with no fill, no line and no font.

Both sides therefore derive from one table, `PRES_STYLE` in
`packages/core/src/pptx/diagram-parts.mjs`.

| Family | Root `presName` | Node `presName` → `styleLbl` | Connector `presName` → `styleLbl` |
|---|---|---|---|
| `cycle` | `cycle` | `node` → `node1` | `sibTrans` → `sibTrans2D1` |
| `hierarchy` | `hierRoot` | `rootText` → `node0` (depth 0), `rootTextSub` → `node1` (deeper) | `rootConnector` → `parChTrans1D2` |
| `venn` | `venn` | `vennNode` → `vennNode1` | — (no transitions exist between discs) |
| `radial` | `radial` | `hubNode` → `node0`, `spokeNode` → `node1` | `spokeConn` → `fgAcc1` |

`presStyleIdx`/`presStyleCnt` drive the colour cycle (`fillClrLst meth="cycle"`
indexes idx over cnt). Get them wrong and every node is the same colour.

`presParOf` `srcOrd` runs 0,1,2,… over the pres children in DOCUMENT order,
interleaved node/connector as the `forEach` walks them.

## Details that bite

- `dgm:dir` and `dgm:resizeHandles` are children of
  `CT_LayoutVariablePropertySet`, **not** of `dgm:prSet` — bare under `prSet`
  is schema-invalid.
- `dgm:style` is `a:CT_ShapeStyle`: all four of `a:lnRef`, `a:fillRef`,
  `a:effectRef`, `a:fontRef`, in that order. A partial one is a repair prompt.
  `fillRef idx="0"` means *no theme fill*, which silently discards
  `colorsN.xml`.
- `hideLastTrans="0"` on the cycle's sibling `forEach` is load-bearing: at its
  default the arrow that CLOSES the ring disappears.
- `sampData`, `styleData` and `clrData` populate the Change Layout / Styles /
  Colors galleries. Without them those galleries open blank for our entry and
  the human gate below returns a false negative on the whole approach.
- `dgm:bg` and `dgm:whole` are `minOccurs="0"`. We emit them for consistency
  with PowerPoint's own output; **no test asserts their presence**, because the
  format does not require it.
- `relId` on `dsp:dataModelExt` resolves against the **slide's** relationship
  part. No `ppt/diagrams/_rels` exists in a PowerPoint-authored file, and both
  Apache POI (`XSLFDiagram`) and LibreOffice resolve the drawing there.
- Escaping is mandatory throughout: one node label containing `&` or `<` would
  otherwise yield malformed XML and a repair dialog. The graphic-frame swap
  uses a **replacer function**, because `$&`, `$'` and the backtick form are
  reachable from a node label and `String.replace` would interpret them.

## What is NOT verified, and how to verify it

**The acceptance criterion is not checkable on the machine this was built on.**
There is no PowerPoint here, Keynote cannot be driven without an Accessibility
grant, and `soffice` is not installed. Every previous OOXML injection in this
repository (morph, anim, fonts, svg) could be verified by asserting what was
written; "PowerPoint opens its native SmartArt UI" cannot.

What IS verified, by `smartart.test.mjs` and `pptx-e2e.test.mjs`: the five
parts are well-formed and byte-deterministic; every `presName` has a layout
node and every `presStyleLbl` is shipped in both the colour and quick-style
parts; every connection names a point that exists; the palette is literal and
matches the drawing cache; the graphic frame lands on the picture's own
transform and id; the drawing cache resolves the way POI reads it; a second
pass is a byte-identical no-op; and every failure mode leaves a correct picture
plus a warning rather than a broken `.pptx`.

### The gate

```sh
node scripts/smartart-probe.mjs           # round A: one file per family
node scripts/smartart-probe.mjs --sweep   # round B: node counts 2…8
```

Round A is one file per family on purpose: PowerPoint gives no per-slide
attribution when it refuses a package, so a failing twenty-slide file teaches
only that something in it is wrong.

Open them in real PowerPoint (Windows **and** macOS) and fill this in:

| # | Question | Windows | macOS |
|---|---|---|---|
| 1 | Opens with no repair dialog? | | |
| 2 | Ribbon shows *SmartArt Design*, and the galleries show our entry? | | |
| 3 | Node count and reading order right at n = 2, 3, 6, 8? | | |
| 4 | What does *Reset Graphic* do? | | |
| 5 | Colours are the deck's, not Office blue? | | |
| 6 | Two diagrams of one family in one deck both load? | | |
| 7 | Keynote / LibreOffice / Google Slides — what renders? | | |
| 8 | Literal `dsp:dataModelExt/@minVer` in a PowerPoint-authored file | | |

A blank frame in **Keynote is expected** and documented in
[the DSL reference](../dsl.md): Apple's importer dispatches on the layout id
and does not know ours. A blank frame in **LibreOffice** is a bug — it means
the drawing cache is wrong.

Where `soffice` is on `PATH`, converting the probes catches that in minutes
rather than after a human round-trip. The probe prints the directory it wrote
to — it is `os.tmpdir()`, which is **not** `/tmp` on macOS but a per-user
`/var/folders/…` path, so take it from the output rather than typing it:

```sh
DIR=$(node scripts/smartart-probe.mjs | sed -n 's/^Probes written to //p')
soffice --headless --convert-to pdf --outdir "$DIR" "$DIR"/*.pptx
open "$DIR"
```

It is **not** a gate, and it answers none of the PowerPoint questions above —
LibreOffice does not know the SmartArt ribbon and never re-runs our
`layoutN.xml`. It checks the cache, nothing more.

### The kill switch

`FAMILIES.<family>.smartart` in `packages/core/src/pptx/diagram-parts.mjs`.
Set it to `false` and that family falls back to native shapes — with no
warning, because the native drawing is correct. A cycle on the stock `cycle`
algorithm and a venn on overlapping discs are materially different bets and
there is no reason they succeed or fail together, so "cycle ships, venn does
not" is a shippable outcome.

Iteration cap: three human rounds per family. After that the family stays
native.

## Known and accepted

- **Keynote and macOS Quick Look show nothing** for a diagram carrying our
  layout id. This reverses the rule the codebase applies to charts, Mermaid,
  maths and icons — "an image displays everywhere" — which is why SmartArt is
  opt-in, why the default is native shapes, and why `npm run site` builds
  without the flag.
- **A converted diagram is not animated in the `.pptx`.** The frame replaces
  the picture after the timing tree is written. The HTML twin keeps its reveal;
  the divergence is documented rather than papered over by coupling the HTML
  renderer to a PowerPoint export option.
- **The placeholder PNG becomes an orphan** in the zip after a successful swap.
  Legal OPC, tolerated by PowerPoint, prunable later.
- **In SmartArt mode the fallback picture needs `@resvg/resvg-js`.** Where the
  rasterizer is absent, `addSmartArt` falls back to native shapes and SmartArt
  does not happen. `RASTER_UNAVAILABLE` already fires, so it is not silent —
  but every `--smartart` end-to-end assertion is gated on `rasterAvailable()`.
- **`dsp:dataModelExt/@minVer`** is shipped as the DrawingML diagram namespace
  URI, provisionally. Every consumer inspected ignores it and reads only
  `relId`, so the risk is low; question 8 of the gate settles it.
