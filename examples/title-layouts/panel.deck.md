---
title: The panel
subtitle: The same layout, dressed by a kit
author: Lutrin
date: Photo © Luca Galuzzi · CC BY-SA 2.5
footer: Title layouts · a kit's cover style
titleLayout: image-right
titleImage: https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg/1920px-Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg
kit: ./panel-kit
assets: vendor
---

# What the kit changed

<!-- layout: split -->

- `splitRatio: 0.45` — the photograph takes a little less than half
- `imageInset: 40` — it is pulled 40 px off every edge of that band, so it
  reads as a panel laid on the cover rather than as a bleed
- `imageRadius: 24` — the panel's corners. They only show because of the
  inset: at a bleed, three of the four are off the page
- `imageOpacity: 0.9` — the picture itself, a touch quieter
- `scrimAlpha: 0.55` — the veil, unused here and set for the kit's
  `image-full` covers

None of it is written in the deck: the difference with `image-right.deck.md`
is one `kit:` line.

![right](https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/1920px-Fronalpstock_big.jpg)

Photo © Hannes Röst — Wikimedia Commons, CC BY-SA 3.0
