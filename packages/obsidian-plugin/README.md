# Obsidian plugin — Lutrin

Live preview, diagnostics and PowerPoint / HTML export of Markdown
presentations (the `lutrin` DSL) straight inside Obsidian. Desktop only
(`isDesktopOnly`): compilation lives in a dedicated Node worker — the same
worker the VS Code extension uses, which lives in the core (a system Node is
looked up first, see the "Node path" setting).

## Installation (development)

```bash
npm install                              # at the monorepo root
npm run build -w lutrin-obsidian       # dist/ with core symlinked
node packages/obsidian-plugin/scripts/package.mjs --dev --vault "/path/to/MyVault"
```

Then in Obsidian: Settings → Community plugins → enable
"Lutrin". (Reload Obsidian after a rebuild:
Ctrl/Cmd-P → "Reload app without saving".)

## Installation (standalone)

```bash
npm run release -w lutrin-obsidian
```

produces `packages/obsidian-plugin/dist/` — a **standalone** plugin
directory (core copied, dependencies installed inside it) to copy into
`<vault>/.obsidian/plugins/lutrin/`.

## Usage

- **Preview**: the "presentation" ribbon icon, or the "Show presentation
  preview" command. The panel follows the active Markdown note and
  recompiles as you type. Click a slide → source line; on animated slides
  the click reveals the next step.
- **Diagnostics**: a banner above the slides (same messages as
  `lutrin validate`), click → source line.
- **Export**: the "Export to PowerPoint (.pptx)" / "Export to standalone
  HTML" commands (also in the file context menu). The file is written next
  to the note and opened according to the setting.
- **Vault images**: wiki embeds `![[photo.png]]` are translated for the
  compiler; the alias becomes the role (`![[photo.png|right]]`,
  `|cover`, `|background` — the roles are the DSL's, see
  [docs/dsl.md](../../docs/dsl.md)).

## Architecture

```
Obsidian renderer (main.ts, preview.ts — shadow DOM)
     │ IPC (compilerClient.ts)
     ▼
Node worker (dist/core/src/worker/worker.mjs — single, it lives in the core:
             compile / validate / exportPptx / exportHtml)
     │ import
     ▼
core (dist/core → packages/core; symlink in dev, copy in release)
```

Slides, layouts, charts, Mermaid, LaTeX: all the behaviour is that of the
`packages/core` compiler — see its documentation.
