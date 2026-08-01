/**
 * Deck-editor SPA (design/deck-editor/): the browser modules are plain ESM
 * with no top-level DOM access, so node can test the logic UNDER the panels
 * — the compile body and its conflict handling (C1), the cover mapping
 * (C2/D4), the content re-anchoring behind "Garder ma version" (C3), the
 * header-confined layout directive (C4), the per-note serialization (C5),
 * the single-flight guard (C6) and the unknown-layout option (C7) — plus
 * the byte parity of the client serializeParts with slice.mjs, which form.js
 * must mirror exactly for its soft lock to mean anything.
 *
 * The store is a singleton: every test opens a fresh deck payload first, so
 * order never leaks state.
 */

import './setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiError, api, isBoundary } from '../design/deck-editor/js/api.js';
import * as compile from '../design/deck-editor/js/compile.js';
import {
  applyLayoutToSource,
  layoutSelectModel,
  serializeParts,
} from '../design/deck-editor/js/form.js';
import { store } from '../design/deck-editor/js/store.js';
import { singleFlight } from '../design/deck-editor/js/ui.js';
import { serializeParts as serverSerializeParts, sliceDeck } from '../src/deck/slice.mjs';
import { readAllBlocks } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Minimal slide slice as GET /api/deck ships it. */
function slice(index, startLine, endLine, source, title = null, layout = null) {
  return { index, startLine, endLine, source, title, layout, inferredLayout: null, parts: null };
}

/** Minimal /api/deck payload; override what the test cares about. */
function payload(overrides = {}) {
  return {
    path: 'demo.deck.md',
    version: 'v1',
    meta: {},
    sliceable: true,
    sceneOffset: 0,
    slides: [],
    capabilities: {},
    diagnostics: [],
    ...overrides,
  };
}

// ------ C1 — compile body is the D2 contract, no client rebuild --------------

test('C1: compile body is {path} clean, {path,index,source,baseVersion} dirty', () => {
  // the client-side reconstruction (and its frontmatter re-emitter) is GONE
  assert.equal('buildWorkingSource' in compile, false);
  store.openDeck(payload({ slides: [slice(0, 1, 1, '# One', 'One')] }));
  assert.deepEqual(compile.buildBody(), { path: 'demo.deck.md' });
  store.setWorking('# One edited');
  assert.deepEqual(compile.buildBody(), {
    path: 'demo.deck.md',
    index: 0,
    source: '# One edited',
    baseVersion: 'v1',
  });
});

test('C1: a 409 conflict from compile raises the conflict banner', async () => {
  store.openDeck(payload({ slides: [slice(0, 1, 1, '# One', 'One')] }));
  store.setWorking('# One edited');
  const real = api.compile;
  api.compile = async () => {
    throw new ApiError(409, 'conflict', { error: 'conflict' });
  };
  const failures = [];
  const off = compile.onResult((_result, err) => failures.push(err));
  try {
    compile.runCompile('test');
    await new Promise((resolve) => setTimeout(resolve, 500)); // > 300 ms debounce
    assert.equal(store.get().conflict, 'external');
    // a conflict is a banner, never a toast: no listener saw an error
    assert.deepEqual(failures, []);
  } finally {
    off();
    api.compile = real;
    store.setConflict(null);
  }
});

test('a 422 boundary from compile reaches the error listeners, typed — not a banner', async () => {
  // the server's boundary net must stay a VISIBLE error in the client loop:
  // typed (isBoundary, so main.js can word it), delivered to the listeners
  // (unlike a superseded compile) and never mistaken for a version conflict
  store.openDeck(payload({ slides: [slice(0, 1, 1, '# One', 'One')] }));
  store.setWorking('# One edited');
  const real = api.compile;
  api.compile = async () => {
    throw new ApiError(422, 'boundary', { error: 'boundary' });
  };
  const failures = [];
  const off = compile.onResult((_result, err) => failures.push(err));
  try {
    compile.runCompile('test');
    await new Promise((resolve) => setTimeout(resolve, 500)); // > 300 ms debounce
    assert.equal(failures.length, 1);
    assert.equal(isBoundary(failures[0]), true);
    assert.equal(isBoundary(new ApiError(422, 'other', { error: 'other' })), false);
    assert.equal(store.get().conflict, null); // a boundary is not a conflict
  } finally {
    off();
    api.compile = real;
    store.setConflict(null);
  }
});

// ------ C2 — cover pseudo-entry and the fragment mapping (D4) ----------------

test('C2: fragment = slice + sceneOffset, cover is fragment 0', () => {
  store.openDeck(
    payload({
      sceneOffset: 1,
      slides: [slice(0, 4, 5, '# One', 'One'), slice(1, 7, 8, '# Two', 'Two')],
    }),
  );
  assert.equal(store.get().current, 0);
  assert.equal(store.fragmentIndex(), 1); // slice 0 shows as the SECOND fragment
  assert.deepEqual(store.entryForFragment(0), { cover: true });
  assert.deepEqual(store.entryForFragment(1), { index: 0 });
  assert.deepEqual(store.entryForFragment(2), { index: 1 });

  store.selectCover();
  assert.equal(store.get().coverSelected, true);
  assert.equal(store.get().current, -1); // nothing editable while the cover shows
  assert.equal(store.get().dirty, false);
  assert.equal(store.fragmentIndex(), 0);

  store.selectSlide(1);
  assert.equal(store.get().coverSelected, false);
  assert.equal(store.fragmentIndex(), 2);
});

test('C2: without a cover the mapping is the identity and selectCover refuses', () => {
  store.openDeck(payload({ slides: [slice(0, 1, 1, '# One', 'One')] }));
  assert.equal(store.fragmentIndex(), 0);
  assert.deepEqual(store.entryForFragment(0), { index: 0 });
  store.selectCover(); // no cover in this deck: must be a no-op
  assert.equal(store.get().coverSelected, false);
  assert.equal(store.get().current, 0);
});

test('C2: the cover selection survives a reload that keeps the title', () => {
  store.openDeck(payload({ sceneOffset: 1, slides: [slice(0, 4, 4, '# One', 'One')] }));
  store.selectCover();
  store.refreshDeck(
    payload({ version: 'v2', sceneOffset: 1, slides: [slice(0, 4, 4, '# One', 'One')] }),
  );
  assert.equal(store.get().coverSelected, true);
  assert.equal(store.fragmentIndex(), 0);
});

// ------ C3 — "Garder ma version" re-anchors by content, never by index -------

const DECK_ABC = () =>
  payload({
    slides: [
      slice(0, 1, 1, '# A', 'A'),
      slice(1, 3, 5, '# B\n\ntext', 'B'),
      slice(2, 7, 7, '# C', 'C'),
    ],
  });

test('C3: keepWorking follows the slice whose source matches (insertion above)', () => {
  store.openDeck(DECK_ABC());
  store.selectSlide(1);
  store.setWorking('# B\n\nedited');
  store.refreshDeck(
    payload({
      version: 'v2',
      slides: [
        slice(0, 1, 1, '# X', 'X'), // inserted on top: every index shifts
        slice(1, 3, 3, '# A', 'A'),
        slice(2, 5, 7, '# B\n\ntext', 'B'),
        slice(3, 9, 9, '# C', 'C'),
      ],
    }),
    { keepWorking: true },
  );
  const s = store.get();
  assert.equal(s.current, 2); // followed B, not the old index 1 (now A)
  assert.equal(s.workingSource, '# B\n\nedited');
  assert.equal(s.dirty, true);
  // the slide at the OLD index was never touched by the preserved text
  assert.equal(s.deck.slides[1].source, '# A');
});

test('C3: falls back to startLine, then to title', () => {
  store.openDeck(DECK_ABC());
  store.selectSlide(1);
  store.setWorking('# B\n\nedited');
  // source changed on disk, but the slice still starts at line 3
  store.refreshDeck(
    payload({
      version: 'v2',
      slides: [slice(0, 1, 1, '# A', 'A'), slice(1, 3, 5, '# B\n\nchanged', 'B')],
    }),
    { keepWorking: true },
  );
  assert.equal(store.get().current, 1);
  assert.equal(store.get().workingSource, '# B\n\nedited');

  // source AND position changed: the title is the last anchor left
  store.refreshDeck(
    payload({
      version: 'v3',
      slides: [slice(0, 1, 1, '# A', 'A'), slice(1, 9, 11, '# B moved\n\nzzz', 'B')],
    }),
    { keepWorking: true },
  );
  assert.equal(store.get().current, 1);
  assert.equal(store.get().workingSource, '# B\n\nedited');
  assert.equal(store.get().dirty, true);
});

test('C3: an unanchorable slide parks the text as detached — no overwrite', () => {
  store.openDeck(DECK_ABC());
  store.selectSlide(1);
  store.setWorking('# B\n\nedited');
  store.refreshDeck(
    payload({ version: 'v2', slides: [slice(0, 1, 1, '# A', 'A')] }), // B is gone
    { keepWorking: true },
  );
  const s = store.get();
  assert.equal(s.conflict, 'lost');
  assert.equal(s.detached, '# B\n\nedited');
  assert.equal(s.current, 0); // clean selection, back on the first slide
  assert.equal(s.workingSource, '# A'); // NOT the preserved text
  assert.equal(s.dirty, false);
  store.clearDetached();
  assert.equal(store.get().conflict, null);
  assert.equal(store.get().detached, null);
});

// ------ C4 — layout directive confined to the header zone --------------------

test('C4: applyLayoutToSource never rewrites a directive-looking line in a fence', () => {
  const src = '# T\n\n```md\n<!-- layout: quote -->\n```';
  assert.equal(
    applyLayoutToSource(src, 'hero'),
    '# T\n\n<!-- layout: hero -->\n\n```md\n<!-- layout: quote -->\n```',
  );
  // nothing in the header to remove: the fence line stays the author's
  assert.equal(applyLayoutToSource(src, null), src);
});

test('C4: only the header directive is replaced or removed', () => {
  const src = '# T\n\n<!-- layout: quote -->\n\ntext\n\n<!-- layout: literal -->';
  assert.equal(
    applyLayoutToSource(src, 'hero'),
    '# T\n\n<!-- layout: hero -->\n\ntext\n\n<!-- layout: literal -->',
  );
  assert.equal(applyLayoutToSource(src, null), '# T\n\ntext\n\n<!-- layout: literal -->');
});

test('C4: a slice opening on a fence gets its directive above, fence intact', () => {
  const src = '```js\nconst x = 1;\n```';
  assert.equal(applyLayoutToSource(src, 'code'), `<!-- layout: code -->\n\n${src}`);
});

// ------ C5 — one comment per note, multi-line notes survive -------------------

test('C5: a multi-line note serializes as ONE notes comment', () => {
  const parts = {
    title: 'T',
    layout: null,
    notes: ['line one\nline two', 'second'],
    animate: null,
    intro: '',
    sections: [],
  };
  const out = serializeParts(parts);
  assert.equal(out.match(/<!-- notes:/g).length, 2); // not three
  assert.ok(out.includes('<!-- notes: line one\nline two -->'));
  assert.equal(out, serverSerializeParts(parts)); // byte parity, this shape too
});

// ------ C6 — single-flight save guard -----------------------------------------

test('C6: singleFlight ignores re-entrant calls while one is in flight', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const run = singleFlight(async () => {
    calls += 1;
    await gate;
  });
  const first = run();
  run();
  run();
  assert.equal(calls, 1); // the two overlapping calls were swallowed
  release();
  await first;
  await run(); // the guard reopens once the flight lands
  assert.equal(calls, 2);
});

// ------ C7 — unknown layout stays visible as itself ----------------------------

test('C7: an unknown layout is offered as "name (inconnu)", never Automatique', () => {
  const caps = {
    layouts: ['hero', 'quote'],
    officialLayouts: [],
    userLayouts: [],
    layoutSections: {},
    layoutParams: {},
  };
  const known = layoutSelectModel(caps, 'hero', null);
  assert.equal(known.unknown, null);
  assert.equal(known.value, 'hero');

  const unknown = layoutSelectModel(caps, 'vanished', 'grid');
  assert.equal(unknown.unknown, 'vanished');
  assert.equal(unknown.value, 'vanished');

  const auto = layoutSelectModel(caps, null, 'grid');
  assert.equal(auto.unknown, null);
  assert.equal(auto.value, '');
  assert.equal(auto.autoLabel, 'Automatique (grid inféré)');
});

// ------ client/server serialization parity -------------------------------------

test('client serializeParts is byte-identical to slice.mjs on every real slide', () => {
  const specimen = fs.readFileSync(
    path.join(here, '..', 'design', 'editor', 'specimen.deck.md'),
    'utf8',
  );
  const synthetic = [
    '# Solo\n\nA paragraph.\n\n<!-- notes: n1 -->',
    '<!-- layout: hero -->\n<!-- animate -->\n\n# Full\n\nintro\n\n## S1\n\nbody\n\n## S2',
    'No title here, just prose.\n\n## Only section',
  ].join('\n\n---\n\n');
  let checked = 0;
  for (const source of [readAllBlocks(), specimen, synthetic]) {
    for (const sl of sliceDeck(source).slides) {
      if (!sl.parts) continue;
      checked += 1;
      assert.equal(serializeParts(sl.parts), serverSerializeParts(sl.parts));
    }
  }
  assert.ok(checked > 0, 'the fixtures must yield at least one form-editable slide');
});
