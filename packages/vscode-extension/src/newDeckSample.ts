/**
 * The document "Lutrin: New Presentation" opens.
 *
 * The deck itself lives in the core (packages/core/src/deck/sample.mjs), so
 * that `lutrin new` on the command line and this command hand out the same
 * first deck. This module is the extension's view of it: no 'vscode' import,
 * so the test suite can run it through the core's validateDeck and guarantee
 * the first deck a user ever sees compiles without a single diagnostic.
 *
 * No filename is passed: the command opens an UNTITLED buffer, which has no
 * name for `deck: true` to be inferred from — so the key is kept.
 */

import { newDeckSample } from '../../core/src/deck/sample.mjs';

export const NEW_DECK_SAMPLE = newDeckSample();
