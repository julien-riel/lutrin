# Example kit — "Slate+"

A complete, royalty-free **kit**, meant to be copied to build your own
organization's. It fits in four files.

```
kit-slate/
├── kit.json                        manifest (the only required file)
├── theme.json                      tokens — overrides only what it changes
└── layouts/
    ├── three-pillars.json          alias of the "pillars" layout
    └── finding-recommendation.json alias of the "comparison" layout
```

A layout from the kit is called from a deck by its name:

```md
<!-- layout: finding-recommendation -->
```

## Try it

```sh
lutrin kit create examples/kit-slate -o slate-plus.deckkit
lutrin kit install slate-plus.deckkit
lutrin build my-deck.md --kit slate-plus
```

Without installing it, by pointing at its directory:

```sh
lutrin build my-deck.md --kit examples/kit-slate
```

## What the example shows

**A theme overrides, it does not redefine.** `theme.json` holds only six
colors, a chart palette and two radii: everything else comes from the generic
theme. The complete mirror of the tokens is
`packages/core/design/themes/default.json` — copy that one if you would rather
start from an exhaustive base than from a delta.

**Layouts are parameterized aliases**, not code. Each one names a built-in
layout through `base` and pins its parameters. The list of parameters each
base accepts:

```sh
lutrin capabilities | python3 -c "import json,sys; print(json.load(sys.stdin)['layoutParams'])"
```

Two mistakes do not cost the same. An **unknown parameter** is simply ignored:
diagnostic `LAYOUT_DEF_ADJUSTED`, non-blocking, and the layout keeps its
defaults. A **value outside its domain** is more serious: diagnostic
`LAYOUT_DEF_INVALID`, and it is the **whole** layout that is rejected — every
slide that asks for it then falls back to `UNKNOWN_LAYOUT` (severity *error*),
and `lutrin build` exits with code 1. Better one key too many than one wrong
value.

**A kit contains data and nothing else.** No `.mjs`, no `.js`, no binary can
get in — `lutrin kit install` refuses them. That is what makes installing from
a URL defensible: nothing that is installed is ever executed.

## Going further

A real kit usually adds its fonts and its logos:

```
fonts/MyFont-Regular.ttf        + its .woff2 twin of the same name
logo/signature.png              bitmap, embedded as is in the .pptx
logo/signature.svg              variant inlined into the HTML
```

Declared in `theme.json`:

```json
{
  "fonts": {
    "body": "My Font",
    "files": { "regular": "./fonts/MyFont-Regular.ttf" }
  },
  "logos": { "cover": "./logo/signature.png", "coverSvg": "./logo/signature.svg" }
}
```

`fonts.files` **requires** `fonts.body`: without the family name, the glyphs
would be embedded under the default font and the HTML would diverge from the
`.pptx`. Every `.ttf` must have its `.woff2` of the same name next to it — the
first goes into PowerPoint, the second into the HTML, and that is what
guarantees two identical outputs.
