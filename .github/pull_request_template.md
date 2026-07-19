<!--
Thank you for the contribution. The boxes below are not bureaucracy: each one
corresponds to a rule that has already cost a fix in this repository.
-->

## What this PR changes

<!-- The intent, not the list of files touched — the diff already gives it. -->

## Why

<!-- The problem solved. For a bug fix: link to the issue. -->

## Checks

- [ ] `npm test` passes.
- [ ] **Bug fix**: a test fails BEFORE the fix. Verified by commenting the fix
      out — a test that passes either way tests nothing.
- [ ] **Output parity**: the behaviour is consistent between `.pptx` and HTML,
      or degrades cleanly on the side that does not carry it.
- [ ] **New block type**: added to `examples/demo.deck.md`, the renderer
      coverage fixture.
- [ ] **Goldens regenerated** (`UPDATE_GOLDEN=1 npm test`): the diff has been
      reviewed and matches the intended change exactly, nothing more.
- [ ] Comments, diagnostics and documentation **in English**, explaining the
      WHY.
- [ ] No new dependency — or else it was discussed in an issue.
- [ ] `src/deck/` still knows nothing about any output format
      (`boundary.test.mjs` checks it).

## Notes for review

<!-- The obvious solutions ruled out and why; the points of uncertainty. -->
