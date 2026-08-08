# Does the .pptx look like the deck?

Every other check in this repository reads the PowerPoint we *wrote*: the XML
is well-formed, the shape is on the slide, the colour is the token's. None of
them can answer the only question a reader asks — **does it look right?** A
shape can be perfectly spelled and land two inches off. A font can resolve to
something else entirely and the XML stays valid.

`scripts/pptx-fidelity.mjs` renders both sides and compares the pixels.

```bash
node scripts/pptx-fidelity.mjs                        # examples/demo.deck.md
node scripts/pptx-fidelity.mjs examples/*.deck.md
node scripts/pptx-fidelity.mjs deck.md --threshold 4 --out /tmp/fid
```

```
HTML  →  Chromium screenshot, one PNG per slide     (the reference)
PPTX  →  LibreOffice Impress → PDF → pdftoppm PNG   (a third party's read)
```

The HTML side is the reference because it is the scene we *intended*: the same
`renderDeckHtml` output backs `lutrin preview` and the VS Code webview, so
whatever the browser draws is what the author was shown. LibreOffice sits on
the other side precisely **because it is not us** — it re-reads the OOXML with
an implementation that owes our renderer nothing, which is the whole value of
the comparison. PowerPoint would be the better judge still, and cannot be
driven headless on a Linux runner; Impress is the closest honest substitute.

The script writes a side-by-side contact sheet (`report.html`), worst slide
first, with a difference blend you can flip on per slide. **Reading that page
is the point** — the numbers only decide where to look first.

## What it needs

```sh
# Debian/Ubuntu
apt-get install libreoffice-impress poppler-utils
# macOS
brew install --cask libreoffice && brew install poppler
```

Plus a Chromium the PNG export can drive — the same one `lutrin setup-mermaid`
provisions, or `LUTRIN_BROWSER`. All three are checked *before* any work, and
each failure names what to install: a run that dies on the fortieth slide
teaches nothing this cannot.

One trap is worth naming, because it costs an afternoon. `libreoffice-core`
alone installs `soffice` and **cannot open a .pptx** — Impress is a separate
package on Debian. What you get is `Error: source file could not be loaded`,
which reads exactly like a corrupt file we wrote. The script sniffs for the
Impress module beside `soffice` and says so instead.

## Reading the numbers

Two renderers never agree pixel for pixel: they hint text differently, round
subpixels differently, antialias curves differently. A slide a human would call
identical still lights up a few percent of its edge pixels. So there are two
numbers, and only one of them is a verdict:

- **fine** — the raw disagreement at 2560×1440. Never zero. Informational.
- **coarse** — both frames boxed down to 640×360 *first*, which averages
  antialiasing away and leaves what is worth failing over: a block in the wrong
  place, a missing shape, a colour that changed, text that reflowed onto
  another line. This is what `--threshold` applies to.

A slide-count mismatch is not a score, it is a missing slide: the script says
so plainly and exits non-zero regardless of the threshold.

**Fonts are the honest caveat.** Impress draws with the fonts installed on the
machine, and a bare container has neither Inter nor a brand face, so it
substitutes and every glyph shifts — which reflows lines, which moves blocks.
On such a runner the whole deck sits in a 2–5% band that means nothing at all.

So the default threshold is not one number but two: **3%** where the deck's
faces are installed, **6%** where they are not — and the script says which it
picked, and why, on the line above the results. A check that goes red by
default on the machine most people run it on is a check they learn to ignore.
`--threshold` overrides both. Install the deck's fonts before treating a
number here as a bug.

This is deliberately **not a CI step**, for the same reason as
`reference-pptx.mjs`: the answer depends on which fonts the runner happens to
have, and a check whose threshold drifts with the image is a check people learn
to ignore.

## What it found

Run against `examples/demo.deck.md` (41 slides, no brand fonts installed):
**40 of 41 faithful**, one over the bar — the ~3–5% band being font
substitution, uniformly, and the outlier being real. Titles,
rules, tinted panels, SWOT quadrants, tables, gauges and the engine-drawn
charts all land where the HTML puts them, in the right colours.

One real defect, and the comparison isolates it exactly: **the Mermaid diagram**
(slide 8) draws every node as a filled black box with its label escaping to the
right. The cause is visible in the package — of the eleven SVGs the demo
embeds, `vector-8-1.svg` is the only one carrying an internal `<style>` block
(mermaid's own output, passed through verbatim), with rules scoped
`#lutrin-diagram .node rect{…}`, and the only one whose root is `width="100%"`.
The SVGs *we* emit use presentation attributes and absolute widths, and every
one of them renders correctly.

A renderer that is not a browser does not run that CSS, so the fills fall back
to black. That is not a LibreOffice quirk to wave away: the .pptx carries a
raster fallback for exactly this reason, and a consumer choosing the SVG gets
the broken one. The fix is to inline the computed CSS onto the elements as
presentation attributes before the SVG is embedded.
