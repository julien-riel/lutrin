# Kits — an organization's brand

A **kit** gathers a theme, its layouts, its fonts and its logos into one
distributable unit: a directory carrying a `kit.json`, or a `.deckkit`
archive. A kit travels **with the deck**, not with the binary — no
re-packaging of the VSIX.

```bash
lutrin kit install <file.deckkit | https://…>   # into ~/.config/lutrin/kits/
lutrin kit list
lutrin kit remove <name>
lutrin kit create <directory>                   # produces the .deckkit
lutrin kit import <brand.potx|brand.pptx>       # derives a kit from a template
lutrin kit edit <name|directory> [--create]     # local web editor (see below)
```

**`lutrin kit import` starts a kit from the file the designer already has** —
the brand's PowerPoint template. It reads the theme's colour scheme and its
body typeface and derives the kit's palette from them. Out comes an ordinary
kit directory — `./<name>` unless `-o` says otherwise, with a generated
`README.md` recording the template's SHA-256. It reads **no
geometry**: the template's layouts, its placeholder boxes and its master's
type sizes stay where they are, and the command says so on every import rather
than let you assume they travelled — the engine composes the page, which is
the whole contract. A palette that fails the WCAG thresholds is **reported,
never silently adjusted**. Details:
[docs/kit-editor.md](kit-editor.md).

**`lutrin kit edit` opens a kit in a local web editor** — tokens with live
WCAG contrast checks, embedded fonts, layouts, images, `.deckkit` export —
with a preview compiled by the real engine, on 127.0.0.1 only. `--create`
scaffolds a fresh kit from the default theme. The full tour:
[docs/kit-editor.md](kit-editor.md), or
[see it in pictures](https://info.lutrin.app/kit-editor.html).

**Eight kits are published and installable right now** —
[the gallery](https://info.lutrin.app/gallery.html) shows each of them with the
same slide compiled inside it, so the only thing that changes from one to the
next is the brand. Their sources are in
[`examples/kits/`](../examples/kits/); the brands are archetypes, invented so
that no real organization's identity is shipped.

A kit contains only **data** — never code: installation runs nothing, refuses
any entry that would escape the kit, bounds the size and accepts only `https`.
The sha256 printed at installation is reproducible.

**No organization brand ships with Lutrin**: brand guidelines bind a trademark
— they belong to whoever holds it and live in their own repository.
[`examples/kit-slate/`](../examples/kit-slate/) shows a complete,
royalty-free kit, ready to copy.

## Referencing a kit

By decreasing precedence:

1. CLI flag `--kit <name|file.json|directory>`;
2. frontmatter `kit:` — the name of an installed kit, a file relative to the
   deck, a kit directory, or `none` to force the generic theme:

   ```yaml
   kit: my-kit
   ```

   (`theme:` is still accepted as a deprecated alias, with a diagnostic.)
3. project default — `"lutrin": { "kit": … }` in the nearest `package.json`
   going up from the deck;
4. user default — `~/.config/lutrin/config.json` (see below);
5. host default — kit imposed by the editor host (the VS Code extension's
   `lutrin.defaultKit`);
6. generic theme "Slate".

An **explicit** kit (levels 1–2) that does not resolve is an error and blocks
`build`; an **implicit** default (levels 3–5) that does not resolve only
warns — a stale user default must not block a project that asked for nothing.

## JSON theme and layouts, without a kit

The two pieces of a kit can also be used separately, placed next to the deck:

- **JSON theme** — a file that overrides the design tokens of the default
  theme (colors, fonts — families and embedded files —, logos, named images,
  chrome geometry, chart palette…); the derived groups (layers, callouts,
  trends) follow the palette. Any invalid entry becomes a diagnostic
  (`THEME_*`), and the WCAG thresholds are checked (`THEME_CONTRAST`).
  Complete template to copy:
  `packages/core/design/themes/default.json` (canonical mirror of the
  default theme, guaranteed no-op by an anti-drift test); example:
  [`examples/theme-example.json`](../examples/theme-example.json).
- **User layouts** — a `layouts/` directory defines validated aliases of the
  built-in layouts (`{ "name": "before-after", "base": "comparison",
  "sections": { "min": 2, "max": 2 } }`). Validation, "did you mean" and
  `capabilities` cover them for free — the last one on condition that it is
  passed the deck or `--kit`, failing which it does not see that directory.
  Examples: [`examples/kit-slate/layouts/`](../examples/kit-slate/layouts/).

Warm hosts (the extension's worker, the preview server) reapply the context on
every compilation from a snapshot — never a leak of a theme or a layout
between two decks.

## User configuration — shared across projects and plugins

A kit chosen **once** applies to all your decks, in the CLI as well as in the
plugins:

```bash
lutrin config                    # directory, default kit, installed kits
lutrin config --kit my-kit       # default shared across every project
lutrin config --unset            # back to the host/generic default
```

The configuration lives in `~/.config/lutrin/` (overridable through the
`LUTRIN_CONFIG` variable; `XDG_CONFIG_HOME` honored): `config.json` carries
the user default (level 4 above), `kits/` the installed kits, referenceable by
name from any project.

In the plugins, this default is taken into account automatically (the
compilation worker reads the same configuration). The document always wins:
the frontmatter `kit:` and the project default take precedence.
