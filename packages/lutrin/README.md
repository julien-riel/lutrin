# lutrin

The `lutrin` command — a Markdown → PowerPoint / HTML presentation compiler.

```bash
npx lutrin build deck.md -o deck.pptx     # PowerPoint
npx lutrin build deck.md -o deck.html     # standalone HTML
npx lutrin preview deck.md                # local server, reloads on save
npx lutrin validate deck.md               # positioned diagnostics
```

Or install it once:

```bash
npm install -g lutrin
```

This package is a thin entry point. Everything — the compiler, the layout
engine, the renderers and the official layout catalog — lives in
[`@lutrin/core`](https://www.npmjs.com/package/@lutrin/core), its only
dependency. Install this one if you want the command; depend on `@lutrin/core`
directly if you want the library.

The DSL, the kit format and the full CLI reference are documented in the
[repository](https://github.com/julien-riel/lutrin).

MIT © Julien Riel
