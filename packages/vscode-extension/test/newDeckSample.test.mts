/**
 * The starter deck is the first Lutrin output a Marketplace user ever sees.
 * It must compile CLEAN — not merely without errors: a single warning or info
 * in a document we wrote ourselves reads as "this tool complains about its
 * own example". The core's validateDeck is called directly (same entry the
 * worker uses), so this fails the moment the DSL and the sample drift apart.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NEW_DECK_SAMPLE } from '../src/newDeckSample.ts';
// @ts-expect-error — the core is plain .mjs, typed nowhere; the shapes under
// test are asserted below.
import { parseDeck } from '../../core/src/deck/parse.mjs';
// @ts-expect-error — same.
import { validateDeck } from '../../core/src/deck/validate.mjs';

describe('starter deck (Lutrin: New Presentation)', () => {
  it('compiles without any diagnostic, of any severity', () => {
    const diags = validateDeck(NEW_DECK_SAMPLE) as Array<{
      severity: string;
      code: string;
      message: string;
      line: number;
    }>;
    assert.deepEqual(
      diags.map((d) => `${d.severity} ${d.code} l.${d.line}: ${d.message}`),
      [],
    );
  });

  it('parses as the deck it claims to be — the frontmatter is recognized', () => {
    // "Zero diagnostics" alone is blind here: a frontmatter the core does NOT
    // recognize (e.g. one whose first line is a # comment) degrades into
    // perfectly valid markdown — an hr, then the comment lines as heading
    // slides — and validate stays green while the user sees garbage. Only
    // structural assertions catch that drift.
    const deck = parseDeck(NEW_DECK_SAMPLE) as {
      meta: Record<string, unknown>;
      slides: Array<{ title?: string }>;
    };
    assert.equal(deck.meta.title, 'My presentation');
    assert.deepEqual(
      deck.slides.map((s) => s.title),
      ['Write content, not layout', 'Two ideas side by side', 'Reveal step by step'],
    );
  });

  it('declares deck: true so diagnostics survive a save under any name', () => {
    const fm = NEW_DECK_SAMPLE.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(fm, 'the sample must open with a frontmatter');
    assert.match(fm[1], /^deck\s*:\s*true\s*$/m);
  });
});
