# The gallery kits

The eight kits behind [lutrin.app/gallery.html](https://lutrin.app/gallery.html),
and `specimen.deck.md` — the one deck that is compiled into every one of them.

```
examples/kits/
├── specimen.deck.md      the same words in all eight, and the reason the gallery works
├── civic-forest/         a public body
├── ledger-oxblood/       a firm that bills by the hour
├── clinic-teal/          a care provider
├── foundry-graphite/     an industrial supplier
├── market-coral/         a consumer brand
├── signal-violet/        a software company
├── press-noir/           a newsroom
└── campus-indigo/        a university
```

Each is a kit directory in the ordinary sense — `kit.json` and `theme.json`,
nothing else. `scripts/gallery.mjs` packs them into `.deckkit` archives and
compiles the specimen into each, for the site and for the deploy alike.

## Four rules, and the reasons

**The brands are archetypes, not organisations.** No kit is named after a real
body, carries anyone's logo, or reproduces anyone's identity — there is no
organisation behind `press-noir` to resemble. A *kind* of organisation is
enough to let a reader picture their own brand, and it is the only version of
this that is safe to publish.

**The content is held constant.** The comparison is the whole point of the
gallery, and it only means something if the words do not move. One specimen
deck, eight kits: every difference on the page comes from the kit. A kit
therefore must not carry a layout the specimen uses, or the other seven would
have to carry it too.

**No kit ships font files, so every `fonts.body` names a family that is
already on the reader's machine.** This is not a preference. A theme that
changes the family without supplying `fonts.files` embeds nothing at all
(`deck/theme.mjs`, in `applyTheme`) — deliberately, so the HTML cannot render
the default font in disguise while PowerPoint renders the real one. Both
outputs fall back together on whatever is installed, which is safe only for
the handful of families that always are. The allowlist is pinned by
`packages/core/test/kit-gallery.test.mjs`.

**Every kit clears the engine's own contrast thresholds.** `themeContrastDiagnostics()`
must return nothing for each of them — a gallery whose specimens compile with
accessibility warnings would be advertising the opposite of what the product
claims. The same test checks it.

## Adding one

Create the directory, then add its card to `site/gallery.html`. The test fails
if the two lists disagree, in either direction: a kit with no card is invisible,
and a card with no kit is a 404 in an install command.

## What these deliberately do not show

A kit can also carry **layouts**, **fonts** and **logos** — see
[`examples/kit-slate/`](../kit-slate/) for one that carries layouts, and the
[kit editor](https://lutrin.app/kit-editor.html) for the workbench that builds
one. These eight vary the theme alone, because that is the axis a visitor can
compare eight of at a glance.
