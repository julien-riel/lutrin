# CLI reference

Everything the `lutrin` command can do, with the semantics that matter when
you script it. The quick tour lives in the [README](../README.md); this page
is the contract.

```bash
npx lutrin new [file.deck.md] [--force]        # starter deck, already compiles
npx lutrin build <deck.md> [-o output.pptx|output.html] [--kit <ref>] [--force] [--verbose]
npx lutrin preview <deck.md> [--port 4321]     # local server + auto reload
npx lutrin edit [directory] [--port 4323]      # local web editor, one slide at a time
npx lutrin validate <deck.md> [--json]         # positioned diagnostics
npx lutrin inspect <deck.md>                   # IR and scenes as JSON
npx lutrin vendor <deck.md>                    # freezes the deck's external dependencies
npx lutrin capabilities [<deck.md>] [--kit <ref>]   # layouts, directives… as JSON
npx lutrin config [--kit <ref>|--unset]        # user default kit (see docs/kits.md)
npx lutrin kit <install|list|remove|create|import|edit> …   # see docs/kits.md
npx lutrin license activate <key>              # claims a seat; removes the attribution
npx lutrin license status [--json]             # state of the licence on this machine
npx lutrin license deactivate                  # frees the seat for another machine
```

The output format is deduced from the extension of `-o`. Every compilation
command accepts `--kit <name|file.json|directory>` — resolution and precedence
are documented in [docs/kits.md](kits.md).

## `new`

`lutrin new` with no name writes `presentation.deck.md`, adds the extension to
a bare name, and refuses to overwrite a file that already exists — pass
`--force` if that is what you meant. It is the same starter deck the VS Code
command "Lutrin: New Presentation" opens.

## `edit`

**`lutrin edit` opens the decks of a directory in a local web editor** — a
file tree of its `.deck.md` files, a live preview compiled by the real
engine, and editing **one slide at a time**: the server rewrites only the
lines of the slide being saved, so nothing an author wrote elsewhere in the
file is ever reformatted. Like the kit editor, it serves 127.0.0.1 only.

## `capabilities`

`capabilities` with no argument describes the **bare** engine: built-in
layouts and official catalog, `userLayouts` empty. **Passing it the deck** —
`npx lutrin capabilities my-deck.md` — honors the `kit:` of its frontmatter
and additionally publishes the kit's layouts and the `layouts/*.json` sitting
next to the `.md`: that is the form to query in a project with a brand. With
no deck, `--kit <ref>` publishes the catalog of that brand, the current
directory serving as the base. A kit asked for explicitly but not found is an
error (exit code 1, nothing on standard output) rather than a generic catalog
delivered in silence; a `layouts/*.json` that could not be read warns on the
error output only, so that `| jq` remains possible.

## `build` and errors

**`build` does not deliver a deck with errors.** If validation returns at least
one diagnostic of severity `error` — unknown directive, non-existent layout,
kit asked for explicitly but unresolvable — the command prints the errors,
exits with **exit code 1** and writes no file. `--force` compiles anyway,
errors on screen, and exits with code 0: that is for a draft you want to look
at. `validate` also exits with code 1 as soon as one error remains.

An important nuance about kits: an **explicit** kit (`--kit`, or `kit:` in the
frontmatter) that does not resolve is an error, and therefore blocks `build`.
A kit coming from an **implicit** default — project, user, editor host —
and not found returns only a warning: a stale user default must not block
the compilation of a project that asked for nothing.

## `license`

**Activate once, then compile offline.** The activation is the only step that
needs the network: the state is cached in `~/.config/lutrin/license.json`
(mode 0600, beside `config.json`) and no compilation ever waits on Polar.
Lutrin re-checks with Polar at most once a week, *after* a deck has been
written, and a licence keeps working for **30 days** without a successful
check — a plane, a VPN or a Polar outage never brings the attribution back.
Past those 30 days, `lutrin license status` while online is what restores it.

The record is sealed against the machine it was activated on: copying
`license.json` to another machine does not license that machine, it just makes
the file be ignored. Run `activate` on each of your machines instead — it costs
nothing.

**A seat is a person, not a machine**, and the count is *declarative*: nothing
in the tool counts your colleagues. You buy a tier and invite people by email;
Polar grants the benefit to each member individually, so everyone receives
**their own licence key**, usable on **as many machines as they work on** —
laptop, desktop, the build server, a CI runner. Tiers and prices:
[info.lutrin.app/pricing.html](https://info.lutrin.app/pricing.html).
