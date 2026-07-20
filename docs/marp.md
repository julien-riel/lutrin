# Marp compatibility

A deck written for [Marp](https://marp.app) (Marpit + Marp Core) compiles as
it is: `marp: true` in the frontmatter — the pragma every Marp deck already
carries — switches the parser to the **Marp dialect**. No CLI flag, no
renaming: the same detection works in the CLI, the VS Code extension, the
Obsidian plugin and the worker.

```markdown
---
marp: true
paginate: true
footer: My footer
---

# First slide

Content…

---

## Second slide

* appears
* point by point
```

A complete example: [`examples/marp-demo.md`](../examples/marp-demo.md).

The philosophy is the project's usual contract, applied to someone else's
dialect: the **content** of the Marp deck is preserved; the **look** — layout,
colors, chrome — is decided by the engine and the theme, as with any lutrin
deck. What cannot be honoured is reported (`MARP_DIRECTIVE_IGNORED`,
severity info), never lost in silence.

## What changes with `marp: true`

| Marp writes | Lutrin does |
|---|---|
| `---` (or `***`, `___`) between slides | opens a new slide — a `# H1` alone no longer splits |
| `headingDivider: 2` (frontmatter or comment; array form `[1, 3]` accepted) | restores splitting before the listed heading levels; a **global** directive, like in Marp: the last definition wins and applies to the whole deck, earlier slides included |
| first `#` or `##` of a slide | the slide's title; `<!-- fit -->` is stripped (fitting is the engine's job) |
| the first subheading level used below the title | opens sections — columns, panels, per the inferred or requested layout. `##` under a `#` title, `###` under a `##` title, or even `####` straight under a `##`: the Marp conventions map by themselves. Deeper headings stay subheadings in the flow |
| `<div class="columns">` … `</div>` (the Marp column idiom) | the divs are ignored (raw HTML), and the headings they wrap structure the slide — the intent, columns, is recovered by the engine |
| `<!-- a plain comment -->` | a presenter note of the slide it appears in (several accumulate, line breaks preserved; inline comments in a paragraph count too). A slide holding only a note exists and keeps it |
| `<!-- directive: value -->` | read as a Marp directive, inline comments included — see the table below |
| `![bg](img)` | the slide background (the `hero` layout); `bg` is recognized at any position of the alt |
| `![bg left](img)`, `![bg right:40%](img)` | the image side of a `split` slide; the size is consumed |
| `w:`, `h:`, `width:`, `height:`, CSS filters in an alt | consumed — the engine sizes and styles on its own |
| `*` bullets, `1)` items (fragmented lists) | the slide animates, point by point (`<!-- animate: none -->` opts out) |
| `$$…$$` | an equation, as in the lutrin DSL |

Several `![bg]` on one slide (Marp composes them side by side): the first
wins, the others return to the content flow.

## Directives

| Directive | Fate |
|---|---|
| `footer:` | mapped onto the deck footer (the last definition wins — lutrin's footer is deck-wide) |
| `headingDivider:` | honoured (see above) |
| `paginate:`, `class:` / `_class:`, `math:`, `lang:`, `title:`, `description:`… | accepted in silence: pagination, slide classes, math rendering and HTML metadata are already the engine's or the renderer's business |
| `theme:` | **not** a lutrin kit: reported by `MARP_DIRECTIVE_IGNORED`, the generic theme applies. To brand the deck, use `kit:` — it works in a Marp deck too |
| `style:`, `header:`, `size:` (other than `16:9`), `backgroundColor:`, `backgroundImage:`, `backgroundPosition:`, `backgroundRepeat:`, `backgroundSize:`, `color:` and their `_` spot variants | no lutrin equivalent — each occurrence reported by `MARP_DIRECTIVE_IGNORED` (info): the deck compiles, the engine decides these things itself |

There is deliberately no syntax to force colors or positions — that is [the
project's contract](dsl.md#what-the-dsl-deliberately-does-not-allow), and it
holds for imported decks: what looks like a need for `backgroundColor` is a
theme token to change in a kit.

## Lutrin extensions inside a Marp deck

The lutrin additions keep working, so a Marp deck can be **progressively
enriched** without leaving the dialect:

- `<!-- layout: pros-cons -->` — ask for a [structured layout](dsl.md#structured-layouts-on-request);
- `<!-- notes: … -->`, `<!-- animate -->` — notes and reveal, lutrin-style;
- `:::info` … `:::metric` — callouts and metric cards;
- `kit: my-kit` (frontmatter) — brand the deck;
- ```` ```chart ````, ```` ```mermaid ````, `![](lucide:name)` — charts,
  diagrams, icons.

Mind one nuance: with `marp: true`, the `:::` scan of validation is off (three
colons are prose in Marp), so a mistyped `:::Info` degrades to a paragraph
without a diagnostic.

## What does not carry over

- **Marp themes and CSS** (`theme: gaia`, `style:`, `<style>` blocks,
  `class: invert`) — lutrin themes are [kits](dsl.md#frontmatter); the CSS of
  a Marp theme has no meaning for a PPTX.
- **Slide-scoped chrome** — per-slide `header:`, background colors, `size:`
  other than 16:9. The engine's layouts and the theme's tokens cover these
  intents.
- **Fully empty slides** — a slide with nothing at all between two `---` is
  dropped (one that carries a presenter note is kept). Marp would render it
  blank.
- **Multiple `![bg]` composition** — Marp tiles several backgrounds side by
  side; here the first wins and the others return to the content flow.
