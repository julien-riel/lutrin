# Title layouts

Four decks, one per value of `titleLayout:`, each two slides: the cover it is
named after, and a slide saying what that layout decided.

| File | `titleLayout` | What to look at |
| --- | --- | --- |
| `default.deck.md` | absent | the composition that has always shipped — the baseline the other three are read against |
| `image-right.deck.md` | `image-right` | the photograph on the right half, full-bleed; text, logo and accent bar on the left |
| `image-left.deck.md` | `image-left` | the mirror. The logo travels with the text, because the top-left margin is under the photograph |
| `image-full.deck.md` | `image-full` | the photograph across the page, under a scrim, with the words over it |
| `panel.deck.md` | `image-right` | **the same layout, dressed by a kit**: the photograph inset off the edges, its corners rounded, and the split narrowed. Not a line of it is in the deck |

```bash
lutrin build examples/title-layouts/image-right.deck.md -o cover.pptx
lutrin build examples/title-layouts/image-right.deck.md --html -o cover.html
lutrin build examples/title-layouts/image-right.deck.md --png -o cover.png
```

Each deck carries `assets: vendor`, so the first build downloads its photograph
into `assets/remote/` next to the deck and every build after that is offline.

## Building all four

```bash
cd examples/title-layouts
for v in default image-right image-left image-full; do
  lutrin build $v.deck.md --kit none -o out/$v.pptx
  lutrin build $v.deck.md --kit none --html -o out/$v.html
  lutrin build $v.deck.md --kit none --png -o out/$v.png
done
# panel.deck.md names its kit in the frontmatter — no --kit here
lutrin build panel.deck.md -o out/panel.pptx
lutrin build panel.deck.md --html -o out/panel.html
lutrin build panel.deck.md --png -o out/panel.png
```

`--kit none` forces the generic theme, so the result is the same for everybody
rather than whatever kit `lutrin config` happens to point at. Drop it to see
the covers in your own brand.

## What a kit settles — `panel-kit/`

The kit beside these decks is a `kit.json` and a `theme.json`, and the theme is
five lines:

```json
{ "chrome": { "cover": {
  "splitRatio": 0.45, "imageInset": 40, "imageRadius": 24,
  "imageOpacity": 0.9, "scrimAlpha": 0.55
} } }
```

`panel.deck.md` is `image-right.deck.md` with one `kit:` line added, so putting
`out/image-right-01.png` beside `out/panel-01.png` shows exactly what those
five numbers do and nothing else. `imageInset` is the one that changes the
character: above 0 the photograph stops bleeding off the page and becomes a
panel laid on the cover. `imageRadius` only shows because of it — at a bleed,
three of the four corners are off the page.

`out/` and `assets/remote/` are both **ignored by git**: the first is rendered
output (~25 MB), the second holds photographs this repository deliberately does
not redistribute.

## The photographs

Referenced by their Wikimedia URL and **not redistributed here**. Both are
CC BY-SA, which asks that the attribution travel with the image — that is why
the credit is in the byline of each cover rather than only in this file.

- "Everest North Face toward Base Camp" — © Luca Galuzzi, www.galuzzi.it,
  [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)
- "Fronalpstock, Switzerland" — © Hannes Röst,
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

## Two things these decks are meant to show

**The photograph is a half of the page, not a picture in a margin.** It runs to
the top, the bottom and the outer edge. That is what makes the cover read as a
composition rather than as a slide with an image on it.

**`image-full` is a compromise, and the deck says so on its second slide.** The
scrim sits at `0.6` — weaker than the `0.85` of a section divider, where the
photograph only tints a band of brand colour. Both numbers are theme tokens
(`chrome.cover.scrimAlpha`, `chrome.cover.splitRatio`), so a kit settles them
once for every deck it dresses. A dark or busy photograph can still take the
cover ink under its contrast threshold with nothing to warn you: the engine
measures colours, never pixels.
