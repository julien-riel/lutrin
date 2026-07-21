/**
 * The document "Lutrin: New Presentation" opens. In its own module, WITHOUT
 * importing 'vscode': the test suite runs it through the core's validateDeck
 * to guarantee the first deck a user ever sees compiles without a single
 * diagnostic — a starter that greets you with warnings would say "broken"
 * before you have typed anything.
 *
 * Deliberately small: it is a starting point, not the demo. Every construct
 * it shows (frontmatter, notes, columns, callout, animation) is one the user
 * will keep; the full tour lives in examples/demo.deck.md and on the site.
 */

export const NEW_DECK_SAMPLE = `---
deck: true
# ^ tells the Lutrin extension to validate this file as a presentation
# whatever its name. Files named *.deck.md do not need it. This key MUST
# stay the first line of the block: the core only recognizes a frontmatter
# whose first line is a "key:" line (a leading # would read as a heading
# after a horizontal rule).
title: My presentation
subtitle: Compiled from Markdown by Lutrin
author: Your name
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
Export with "Lutrin: Export to PowerPoint" — the animations come along.
:::
`;
