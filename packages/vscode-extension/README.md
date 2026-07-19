# VS Code extension — Lutrin

Write a presentation in Markdown and watch it compose beside the text:
live preview, diagnostics underlined in the editor, one-click fixes and
PowerPoint export. The compiler is the one from
[Lutrin](../../README.md) — the extension is only a host for it.

## Installation

The extension is not published on the Marketplace. From a clone of the repo:

```bash
npm install                    # at the root of the monorepo
npm run vsix -w lutrin-vscode  # → lutrin-vscode-<version>.vsix (+ latest.json)
```

Then, in VS Code: command palette → "Extensions: Install from
VSIX…". VS Code ≥ 1.90.

To develop: open the repo in VS Code and press **F5**. The build task
assembles `dist/` with the core symlinked — a "Reload Window" is then
enough to see changes made to the compiler.

## Usage

- **Preview** — command "Lutrin: Show Presentation Preview", available on
  any Markdown file. The panel updates as you type and follows the cursor;
  only the slides whose rendering changed are replaced, which preserves
  scrolling and animation state.
- **Diagnostics** — files recognized as decks are validated automatically,
  without opening the preview. The messages are those of `lutrin validate`,
  underlined on the right line.
- **One-click fixes** — the compiler's "did you mean…?" suggestions become
  *quick fixes*: correct a layout or effect name, apply the structured
  layout the validator proposes.
- **Export** — command "Lutrin: Export to PowerPoint (.pptx)".

A file is treated as a deck if it matches the `lutrin.files` glob
(`**/*.deck.md` by default), if it carries `deck: true` in its frontmatter, or
if the preview has been opened on it during the session.

## Settings

| Setting | Default | Effect |
|---|---|---|
| `lutrin.files` | `**/*.deck.md` | glob of the files validated automatically |
| `lutrin.debounceMs` | `300` | delay between typing and recompiling the preview |
| `lutrin.defaultKit` | *(empty)* | default kit **for this editor**, for decks that designate none |
| `lutrin.updateUrl` | *(empty)* | `https` URL of an update manifest; empty = feature disabled |

`lutrin.defaultKit` accepts the name of a kit installed in
`~/.config/lutrin/kits/`, the path of a kit directory, that of a `.json`
file, or `none`. It is the **weakest** level of precedence: the frontmatter
`kit:`, the project default (`package.json`) and the user default
(`lutrin config`) all take priority — the document always wins.

## Architecture

```text
extension host (extension.ts — commands, diagnostics, quick fixes)
     │ IPC (compilerClient.ts)
     ▼
Node worker (dist/core/src/worker/worker.mjs — it lives in the core)
     │ import
     ▼
core (dist/core → packages/core; symlink in dev, copy inside the VSIX)
```

The extension host **never compiles**: everything goes through a dedicated
Node worker, the same one the Obsidian plugin uses. The preview is a webview
whose HTML shell is written only once; updates arrive through `postMessage`.
The core's HTML renderer emits no script in fragment mode, which the
webview's CSP requires in any case.

A brand kit can be embedded in the VSIX at build time: point
`LUTRIN_BRAND_KIT` at its directory or its `.deckkit` archive. Without that
variable, the extension builds without a kit and starts on the generic theme.

## Automatic updates (optional)

VS Code does not update an extension installed from a VSIX by itself.
For a team distributing the VSIX by its own means, the extension ships
a checker: publish the `.vsix` **and** the `latest.json` generated with it
in the same place, over `https`, then point `lutrin.updateUrl` at the
manifest URL. The extension checks on activation and then once a day,
verifies the sha256 digest before installing, and offers "Update".
Manual command: "Lutrin: Check for Updates".

Its limits — in particular what the digest protects and what it does not
— are described in [SECURITY.md](../../SECURITY.md). With the setting
empty, the feature is inactive.
