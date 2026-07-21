## Brand kits

The generic theme ships with the extension. An organization's identity
— colors, fonts, logos, cover layouts — comes as a **kit**, a
`.deckkit` archive installed once:

```bash
npx lutrin kit install acme.deckkit
```

Then either name it per deck in the frontmatter:

```yaml
kit: acme
```

…or set `lutrin.defaultKit` in your settings for every deck this editor
compiles. The document always wins: frontmatter first, then the
project's default, then yours.

The same kit styles the CLI, the Obsidian plugin and this extension —
one brand, four tools.
