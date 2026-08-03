# The kit editor

`lutrin kit edit` opens a kit in a local web editor: the color tokens, the
fonts, the layouts, the images and the kit's identity, each in its own panel,
beside a preview compiled by the **real engine** — the same compiler that runs
`lutrin build`, applied to a specimen deck that covers every surface a kit
restyles. Nothing in the editor approximates: what the preview shows is what a
deck compiled under this kit gets, and every edit is recompiled before it is
saved.

A kit stays what it always was — **data, never code**: the editor reads and
writes `kit.json`, `theme.json`, `layouts/*.json` and the files under `fonts/`
and `images/`. Everything the editor produces can be written by hand, and
everything written by hand shows up in the editor.

> **See it before installing anything:**
> [info.lutrin.app/kit-editor.html](https://info.lutrin.app/kit-editor.html)
> is a screenshot tour of every panel below. The shots are committed under
> `site/assets/img/kit-editor/`; regenerate them from the real editor with
> `node scripts/kit-editor-shots.mjs` (it drives a local Chrome, so re-run it
> whenever a panel's layout changes).

## Starting it

```bash
lutrin kit edit <name|directory> [--port 4322] [--create] [--name <name>]
```

- A **bare name** designates an installed kit (the ones `lutrin kit list`
  shows), exactly as `--kit` reads one: a same-named directory in the current
  folder does not shadow it — pass it as a path (`./name`) to edit it in
  place.
- A **path** designates a kit directory, which must carry `kit.json`.
- `--create` scaffolds a brand-new kit at the path: `kit.json`, a `theme.json`
  copied from the engine's default theme — so the editor starts from the
  exact tokens the engine uses, not from an empty object — and the `layouts/`,
  `images/` and `fonts/` directories. The kit's name is derived from the
  directory unless `--name` says otherwise (lowercase letters, digits and
  hyphens, e.g. `brand-acme`). `--create` on a directory that already carries
  `kit.json` is an error: nothing is ever overwritten.

The default port is **4322**, so a deck preview (4321) and a kit editor run
side by side; a busy port switches to the next free one and says so. The
server listens on **127.0.0.1 only** — it is a workbench, not a service (see
the security model below).

## Starting from the brand's PowerPoint template

A brand rarely starts on a blank page: it usually already exists as a `.potx`
the designer maintains. That file is a legitimate starting point, and there is
a command for it:

```bash
lutrin kit import <brand.potx|brand.pptx> [-o <directory>] [--name <name>] [--force]
```

It writes a kit directory — `./<name>` unless `-o` says otherwise, the name
derived from the file unless `--name` says otherwise — with the same layout
`--create` scaffolds, so what comes out is an ordinary kit you can open in the
editor, pack with `lutrin kit create` and install anywhere.

**What is read is data, and only data**: the theme part's colour scheme (its
twelve slots) and its two type families, plus the slide master's colour map —
which is what decides whether the dark slot is the ink or the background — and
the presentation's slide size, used *only* to warn that a 4:3 template will
not compose as 4:3.

Those twelve slots become **fourteen colour tokens**, by derivation rather
than transcription: a straight copy would leave the primary ramp, the surface
ramp and the highlight tints on the engine's default blue, so an indigo brand
would get blue architecture layers. The accent ramp and the neutral ramp are
rebuilt with the engine's own relationships applied to your accent, and the
chart palette becomes accents 1 to 6 in that order. Three things are read and
dropped, each with a note saying so: the heading family (lutrin composes with
one text family), the link colours (there is no link-colour token), and any
semantic reading of the accents — a template carries no semantics, and calling
an accent "warning" because it happens to be yellow would assign a meaning the
designer never assigned.

**What is not read is a decision, not an unfinished importer.** The template's
slide layouts, its placeholder positions, its master geometry and its type
sizes are all left behind — deliberately. Honouring a placeholder box would
import exactly the author-positioning this project refuses: the engine
composes the page from the deck's intent, and a kit carries colours, type and
assets, never coordinates. A title's 44 pt was chosen *for* a box of a given
width at a given position; importing the number without the box imports half a
decision. The template's images are left behind too — a kit's signatures are
picked deliberately (`logos.cover`, `logos.section`) — and so is its embedded
font data: a `.potx` ships TrueType only, and `resolveTheme` drops any
`fonts.files` variant with no `.woff2` twin, which is what keeps the HTML and
the `.pptx` identical. Naming a family is not redistributing it, and the one
path that would redistribute stays closed.

Because a designer handing over `brand.potx` reasonably believes the layouts
came along, the import never leaves that silent: it prints a note **counting**
what it discarded, and writes a `README.md` into the generated kit saying what
was imported, what was not and why — with the template's SHA-256, so whoever
inherits the directory in six months can tell which file it came from.

**A palette that fails the WCAG thresholds is reported, never adjusted.** A
colour corrected behind your back would be a brand that is not the brand,
shipped under the brand's name, with nothing downstream ever saying which
token moved. The verdict comes from the same `THEME_CONTRAST` check every
build runs, on the kit as actually written — Microsoft's own default Office
theme, imported, warns on five chart colours.

The import is a starting point, not a conversion: PowerPoint tints its accents
per theme variant, and a very light or very saturated accent will need a hand.
That hand is the next command:

```bash
lutrin kit edit ./brandkit
```

## The preview

The right-hand side always shows the **specimen deck** — metrics, a split with
an icon, charts, callouts, tables, everything a kit repaints — compiled with
your current working state overlaid in memory. Unsaved edits are visible
immediately and touch nothing on disk until you save. A slide selector shows
one slide or all of them.

The diagnostics drawer at the bottom counts errors, warnings and infos from
the kit itself and from the last compile; clicking a diagnostic jumps to the
panel it points at (a contrast warning lands on the token involved, a font
problem on its variant card).

**Compare, press-and-hold**: hold the Compare button — or the `B` key — to see
the last *saved* state of the kit; release to come back to your edits. It is a
before/after on the same slides, available as soon as a saved state has been
compiled once.

## Tokens

The theme's colors, grouped by their real domains — Brand, Neutrals, Surfaces,
Highlights, Semantic — plus the chart palette (ordered, reorderable), the
layer shades (fill + ink pairs) and the trend inks. Each row pairs a native
color picker with a hex field; each group has a "Reset to default".

The engine checks the WCAG thresholds on every recompile, so a color that
breaks legibility answers **while you are picking it**: the `THEME_CONTRAST`
diagnostics of the last compile are anchored directly under the rows they
involve — main text against the page, chart colors, layer inks, callout and
trend inks.

A kit without a `theme.json` starts from an empty state; "Create theme from
defaults" seeds it with the engine's own tokens.

## Fonts

Two family choices — body and mono — and three embedded variants: regular,
bold, italic. **Each embedded variant is a `.ttf` plus a `.woff2` twin of the
same name**, both in `fonts/`: the `.ttf` is what gets embedded in the
`.pptx`, the `.woff2` is what the HTML output uses. The panel shows the pair
status of every declared variant, and a missing twin is named for what it is.

The pitfall the panel warns about: **a family name without embedded files is a
promise the `.pptx` cannot keep** — the file will use whatever font is
installed on the viewer's machine. Stick to a universal family (Arial,
Georgia…) or upload the files.

Uploads are checked against their actual bytes (a mislabeled or corrupted file
is refused, not silently stored), the pangram preview uses the real uploaded
font, and the family name read from the `.ttf` itself is proposed when it
differs from the theme's.

## Layouts

A kit layout is a **named preset of one of the engine's generators** — a base
plus the parameters that base publishes — never free geometry: the engine
still owns placement, exactly as it does in a deck. The panel lists the kit's
layouts, and "New layout" is a two-step flow: pick a base (built-in generator
or official layout), then fill a form generated from that base's published
parameter schema — sections bounds, density, alignment, panel tints, whatever
the base declares. A parameter left at its default is omitted from the
definition, so an alias with no parameters stays a pure alias.

The form carries its own live preview: a synthetic one-slide deck using the
definition being edited, compiled by the same engine. Definitions are
validated by the very code that loads kit layouts — what the editor refuses is
exactly what a compile would refuse (`LAYOUT_DEF_*`). Names are lowercase
letters, digits and hyphens, 2 to 32 characters, starting with a letter.

## Images

Every image the theme names, plus the orphan files sitting in `images/` that
nothing references yet. An upload ends in an **alias** — lowercase letters,
digits and hyphens, 2 to 32 characters — written into the theme's `images`
map; decks then place it with the usual roles:

```markdown
![](kit:hero-photo)
![right](kit:hero-photo)
```

Once resolved, a kit image behaves exactly like a local one — same roles, same
placement by the engine, embedded in the `.pptx` and inlined in the HTML; an
alias the kit does not declare produces `KIT_IMAGE_UNKNOWN` with the nearest
declared alias suggested. See the "Kit images" section of
[the DSL reference](dsl.md). Each card offers a one-slide throwaway preview of
the alias, renaming an alias, and adopting an orphan under a fresh alias.
Image uploads, like fonts, are checked against their actual bytes.

## Kit — identity, logos, export

The manifest's display metadata — version, description, author, homepage — is
editable and written straight to `kit.json`. The **name is locked**: it is the
kit's install identity (the directory it installs under, the name decks
reference) — renaming is a new kit, not an edit.

The four logo slots live here too: cover and section, each with a PNG/JPEG
file (embedded as-is in `.pptx` exports) and an SVG variant (inlined in HTML
exports).

**Export .deckkit** — in the top bar and in this panel — packs the kit into
the same archive `lutrin kit create` produces; the panel surfaces the
archive's **SHA-256**, the same reproducible digest `kit install` prints on
the receiving side.

## Saving

Two kinds of writes, deliberately different:

- **Theme and layout edits are working copies.** They drive the preview
  immediately but touch nothing on disk until **Save kit** (enabled only when
  something changed; leaving the page with unsaved edits warns first).
- **File uploads and deletes are immediate** — fonts, images, logos. A binary
  either is in the kit or is not; there is no draft of a file.

The editor watches the kit directory. An edit made outside the editor — your
text editor, a `git checkout` — reloads the state when nothing is at stake,
and raises a conflict banner when you have unsaved work: reload the kit from
disk, or keep editing and decide later. Your edits are never silently
discarded, and yours never silently overwrite the disk.

## Security model, in brief

The editor is a local workbench that writes to your disk, and its server is
built accordingly:

- binds **127.0.0.1 only** and refuses requests whose `Host` header is not
  local (the DNS-rebinding guard shared with `lutrin preview`);
- refuses any mutating request whose `Origin` is not the editor's own — a
  malicious page in the same browser cannot rewrite the kit through you;
- every read and write is **confined to the kit directory** — client-supplied
  names are reduced to a plain basename, an escaping path or symlink is a 404;
- uploads are size-capped and checked against **magic bytes**: the extension
  promises a format, the first bytes must keep the promise;
- kit files are served **inert** (a strict CSP, no execution) — a kit remains
  data even when displayed, honoring the installer's promise that nothing in
  a kit ever runs.

Do not expose the port beyond the machine; the guards above assume a local
browser, not a network.
