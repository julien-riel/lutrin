/**
 * The deck a user is given when they have nothing yet — `lutrin new` on the
 * command line, "Lutrin: New Presentation" in VS Code.
 *
 * It lives in the core, and NOT in the extension where it was born, because
 * the two surfaces must hand out the same first deck: a starter that differs
 * between them is a second thing to keep correct. The extension re-exports it.
 *
 * The extension's test suite runs the result through validateDeck to guarantee
 * the first deck a user ever sees compiles without a single diagnostic — a
 * starter that greets you with warnings says "broken" before you have typed
 * anything.
 *
 * Deliberately small: it is a starting point, not the demo. Every construct it
 * shows (frontmatter, notes, columns, callout, animation) is one the user will
 * keep; the full tour lives in examples/demo.deck.md and on the site.
 */

/** `deck: true` marks a file the extension should validate as a presentation
 *  whatever its name. A `*.deck.md` file is recognized by its name alone, so
 *  the key — and the five lines explaining it — would be noise there. */
const DECK_KEY = `deck: true
# ^ tells the Lutrin extension to validate this file as a presentation
# whatever its name. Files named *.deck.md do not need it. This key MUST
# stay the first line of the block: the core only recognizes a frontmatter
# whose first line is a "key:" line (a leading # would read as a heading
# after a horizontal rule).
`;

/**
 * @param {string} [filename] name the deck is about to be written under; a
 *        `*.deck.md` name drops the `deck: true` preamble it does not need.
 *        Omitted (the VS Code untitled buffer, which has no name yet): the key
 *        is kept, because nothing else would mark the buffer as a deck.
 * @returns {string} the Markdown of the starter deck
 */
export function newDeckSample(filename) {
  const named = typeof filename === 'string' && /\.deck\.md$/i.test(filename);
  return `---
${named ? '' : DECK_KEY}title: My presentation
subtitle: Compiled from Markdown by Lutrin
author: Your name
notes: Presenter notes for the cover slide — they travel to PowerPoint too.
---

# Write content, not layout

- One \`#\` heading per slide — the engine lays it out
- Bullets, tables, images, diagrams and metrics are all blocks
- Overflowing content paginates by itself

<!-- notes: Speaker notes live in comments like this one. They travel to
PowerPoint and to the HTML presenter mode. -->

# Two ideas side by side

## What you write

- Plain Markdown
- Intent, not geometry

## What you get

- An editable .pptx
- A standalone HTML page

# Reveal step by step

<!-- animate -->

Blocks on an animated slide appear one click at a time.

:::success
Export to PowerPoint with \`lutrin build\` — the animations come along.
:::
`;
}
