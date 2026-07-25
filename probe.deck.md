---
title: Probe — can a picture live inside a table cell?
subtitle: Two routes, five variants, one file — open it in PowerPoint AND in Keynote
footer: Lutrin probe · a:tcPr/a:blipFill and a floated p:pic
---

# The icon, drawn the way the compiler draws it today

![line](lucide:check)

The mark above is the reference: a `p:pic` of its own, 26 px square, the size
of one line of body text. Both routes below try to put that same picture
inside a table cell. What must be judged is whether it appears at all, whether
it stays square, and whether it stays in its cell.

# A — the picture as the cell's fill

![line](lucide:check)

| Variant | Cell |
|---|---|
| A1 · stretched to the whole cell | |
| A2 · squared on an ESTIMATED row height | |
| A3 · small, held to the left | |
| A4 · the same fill, under text | Delivered |
| A5 · inline badge, the control that ships | ==Delivered== |

<!-- notes: A1 to A4 carry a:tcPr/a:blipFill referencing the same image as the reference icon. A5 is injected with nothing: it is what the compiler produces today. -->

# B — the picture floated over the cell

![line](lucide:check)

| Variant | Cell |
|---|---|
| B1 · a first row whose sentence is long enough to wrap onto a second line inside its own cell, which is exactly what makes PowerPoint grow a row beyond the height this engine estimated for it | |
| B2 · floated at the estimated coordinates | |
| B3 · inline badge, the control | ==Delivered== |

<!-- notes: B2 is a p:pic added to the spTree at coordinates computed from the engine's own row-height estimate. If PowerPoint gives row B1 a different height than the estimate, B2 drifts out of its cell. -->
