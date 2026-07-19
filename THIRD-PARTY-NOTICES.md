# Third-party components

Lutrin is distributed under the MIT licence (see `LICENSE`). It depends on the
components below, which remain under their own licences. None is strong
copyleft: the combination is compatible with MIT distribution.

The table lists the **direct** dependencies. The VSIX and Obsidian deliverables
also embed their **transitive** dependencies: each one is redistributed with its
own `LICENSE` file, exactly as it appears in `node_modules`.

## Runtime dependencies

| Component | Version | Licence | Note |
|---|---|---|---|
| [pptxgenjs](https://github.com/gitbrent/PptxGenJS) | 4.0.1 | MIT | `.pptx` generation |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 14.x | MIT | Markdown parsing |
| [markdown-it-container](https://github.com/markdown-it/markdown-it-container) | 4.x | MIT | `:::` directives |
| [jszip](https://github.com/Stuk/jszip) | 3.10.1 | MIT **or** GPL-3.0-or-later | dual licence; Lutrin takes **MIT** |
| [lucide-static](https://github.com/lucide-icons/lucide) | 1.x | ISC | icon set |
| [mathjax-full](https://github.com/mathjax/MathJax-src) | 3.2.x | Apache-2.0 | LaTeX rendering |
| [@resvg/resvg-js](https://github.com/yisibl/resvg-js) | 2.6.x | MPL-2.0 | SVG rasterization (native binary) |

**MPL-2.0** (`@resvg/resvg-js`) is *per-file* copyleft: it imposes nothing on
the code that uses it, but any modification made to its own files must be
published under MPL-2.0. Lutrin does not modify it.

**Apache-2.0** (`mathjax-full`) requires that the copyright notices and the
patent clause be preserved. The attribution is *Copyright © 2009 and later
years, The MathJax Consortium*; the full text of the licence is published at
[www.apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0)
and redistributed with the package in `node_modules`. `mj-context-menu`, pulled
in transitively by `mathjax-full`, falls under the same Apache-2.0 licence but
carries no `LICENSE` file of its own: it points at the same text.

## Development dependencies

| Component | Licence | Note |
|---|---|---|
| [esbuild](https://github.com/evanw/esbuild) | MIT | bundling of the extensions |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 | |
| [@mermaid-js/mermaid-cli](https://github.com/mermaid-js/mermaid-cli) | MIT | Mermaid rendering, optional |
| [obsidian](https://github.com/obsidianmd/obsidian-api) | MIT | types for the plugin API |
| [@biomejs/biome](https://github.com/biomejs/biome) | MIT OR Apache-2.0 | format and lint |

## Example content

`examples/demo.deck.md` references two photographs by their Wikimedia URL. They
are **not** redistributed in this repository; they are downloaded at compile
time, and `examples/assets/remote/` is ignored by git.

- "Everest North Face toward Base Camp" — © Luca Galuzzi, www.galuzzi.it,
  [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/). The author
  asks that the credit appear in the immediate vicinity of the image.
- "Fronalpstock, Switzerland" — © Hannes Röst,
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) or GFDL 1.2+.

If you reuse these slides, the credit must travel with the image: CC BY-SA
requires attribution and share-alike for any work derived from the photograph.

## Fonts

Lutrin embeds no font. The generic "Slate" theme relies on the fonts present on
the machine. A kit may supply its own font files: **it is up to the kit author
to make sure their licence allows incorporation into a document** (`.pptx`) and
its distribution.
