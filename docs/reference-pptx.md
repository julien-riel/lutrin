# Reference packages — what PowerPoint itself writes

Two features in lutrin are judged against a file we cannot produce here:
**SmartArt** (shipped, `--smartart`) and **editable OMML equations** (shipped
— gap #4 in `plans/competitor-gaps.md`). For both, the question is the same:
*does our zip look like one PowerPoint wrote?*

`scripts/smartart-probe.mjs` answers the visual half by handing files to a
human. This page is the other half: a small corpus of **PowerPoint-authored**
`.pptx` files, and a script that reads them beside our own output.

```bash
node scripts/reference-pptx.mjs           # fetch (cached) + report
node scripts/reference-pptx.mjs --list    # the corpus and its provenance
```

The corpus lands in `.reference-pptx/`, which git ignores. **Nothing is
vendored** — for the reason `plans/smartart.md` gives about Microsoft-authored
data files in an MIT repository, which covers the bug-report attachments that
carry them just as well. The script is deliberately **not a CI step**: it needs
the network, and upstream can move.

## The corpus

Seven files come from LibreOffice's Impress test corpus
(`sd/qa/unit/data/pptx/`), which is mostly bug-report attachments — real decks
people built in PowerPoint and then complained about. That provenance is the
point: they are not synthesised by another writer.

| File | Why it is in the corpus |
|---|---|
| `smartart-accent-process.pptx` | the baseline skeleton, Office preset `…/layout/process3` |
| `smartart-org-chart.pptx` | a hierarchy — the family with the most `pres` nodes (34) |
| `smartart-cycle-matrix.pptx` | a cycle, against ours |
| `tdf149551_SmartArt_Venn.pptx` | a venn, against ours |
| `tdf149551_SmartArt_Pyramid.pptx` | a family we do not ship |
| `smartart-picture-strip.pptx` | a diagram that owns pictures — the one case with `ppt/diagrams/_rels` |
| `tdf129372.pptx` | **PowerPoint's own equation encoding**, fallback included |
| `linear_perm_slides.pptx` | a generator's equation encoding — bare `a14:m`, no fallback |

Sources: <https://github.com/LibreOffice/core> (`sd/qa/unit/data/pptx/`) and
<https://github.com/Noi1r/powerpoint-skill> (`example/linear_perm_slides/`).

## What the comparison says today

Every invariant holds — our package is shaped like PowerPoint's:

- five parts per diagram (`data`, `layout`, `quickStyle`, `colors`, `drawing`)
  with the same five content-type overrides and the same five relationship
  types on the slide;
- `a:graphicData uri="…/drawingml/2006/diagram"` carrying `dgm:relIds`;
- `dsp:dataModelExt/@relId` resolving in the **slide's** relationship part, and
  no `ppt/diagrams/_rels` — which is right for a diagram without media, and
  `smartart-picture-strip.pptx` shows the exception: a diagram that owns
  pictures relates to them from `data1`/`drawing1`;
- `sampData` / `styleData` / `clrData` present, so the Change Layout, Styles
  and Colors galleries have something to draw.

**Probe question 7 is now answered.** PowerPoint writes

```xml
<dsp:dataModelExt relId="rId6" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>
```

— a namespace URI, not a version number like `12.0`. Ours is byte-identical
across all six SmartArt references. It is no longer provisional.

### The three divergences, and what they cost

| | ours | PowerPoint |
|---|---|---|
| `layoutN.xml` `uniqueId` | `urn:lutrin.dev/2026/layout/<family>` | `urn:microsoft.com/office/officeart/2005/8/layout/<preset>` |
| `colorsN` / `quickStyleN` `styleLbl` entries | the 2–4 our layouts use | 49, the full vocabulary |
| colour references | literal `srgbClr` | `schemeClr` |

None is a defect, and all three follow from decisions `plans/smartart.md`
argues: the layout definition is authored here rather than vendored, and the
colours are the deck's rather than the theme's. The cost is worth naming:

- a `presStyleLbl` PowerPoint regenerates that our colour part never declared
  falls back to a default we did not ship — which is exactly why `PRES_STYLE`
  and the layout definition derive from one table;
- *Change Colors* in PowerPoint's gallery replaces the brand palette with an
  Office one, and there is no way back except rebuilding.

One cosmetic difference used to be worth a line, and is now closed: our zip
carried 20 **directory entries** — an artefact of JSZip, which materialises a
folder for every parent of a path handed to `file()` — where Office packages
carry none. Nothing in OPC ever forbade them and no consumer objected, so this
was never a defect; it was simply the last row of the table that read
differently from PowerPoint for a reason nobody had chosen. `pptx/zip-tidy.mjs`
drops them as the last post-write pass, and the `zip directory entries` row now
reads `0` on both sides.

## Equations: the two encodings, and why only one is the target

`tdf129372.pptx` was the file to match, and it is now the file we match:

```xml
<mc:AlternateContent>
  <mc:Choice Requires="a14">
    <p:sp>…<a:p><a14:m><m:oMathPara><m:oMath>
        <m:r><a:rPr lang="fr-FR"><a:latin typeface="Cambria Math"/></a:rPr><m:t>𝜕</m:t></m:r>
    </m:oMath></m:oMathPara></a14:m></a:p>…</p:sp>
  </mc:Choice>
  <mc:Fallback>
    <p:sp>… <a:spLocks noRot="1" noChangeAspect="1" … noTextEdit="1"/> …
        <a:blipFill><a:blip r:embed="rId2"/>…</a:blipFill> …</p:sp>
  </mc:Fallback>
</mc:AlternateContent>
```

PowerPoint writes **both halves, every time**: the equation for anything that
implements OMML, and a locked picture shape for everything that does not. That
is the format satisfying gap #4's "the fallback has to stay" on its own, rather
than us promising it.

`linear_perm_slides.pptx` is the other shape — `a14:m` dropped straight into
`<a:p>`, no `mc:AlternateContent`, no fallback. It is editable in PowerPoint
and **invisible** in renderers that do not implement OMML, LibreOffice
included. It is a useful negative example, and it is not the target — which is
why `bare a14:m` is a column in the report and why ours has to read zero.

### What the comparison says now

`node scripts/reference-pptx.mjs` builds a deck carrying an equation and checks
seven invariants against `tdf129372.pptx`, all of them holding today:

- at least one native equation, and **every** `a14:m` wrapped in
  `mc:AlternateContent` — the negative example fails this one on all fourteen
  of its equations;
- one `mc:Choice` / `mc:Fallback` pair per equation, the Choice carrying
  `m:oMath`, its runs set in **Cambria Math**;
- the Fallback shape locked with `noTextEdit`, and its `r:embed` resolving to a
  media part that is really in the zip.

An equation whose conversion is **not exact** never reaches the file: it stays
the picture it already was (`pptx/omml.mjs` returns null rather than guess),
and the CLI reports how many did. That refusal is the feature, not a shortfall
of it — `plans/competitor-gaps.md` §4 makes the point that an equation
converted almost right is worse than a picture.
