/**
 * Writing help for the `:::` directives — one snippet per container the DSL
 * knows, offered when a line starts with `:::`.
 *
 * A SEPARATE module, and deliberately free of any import: playground.js feeds
 * these to CodeMirror's snippetCompletion, and packages/core/test/
 * playground.test.mjs compiles every one of them through the real validator.
 * That test is the honesty guarantee this file lives under: each template,
 * with its fields left at their default text, must produce ZERO diagnostics —
 * help that inserts something the validator then underlines is worse than no
 * help. Which is also why the templates repeat the documentation's own
 * examples (docs/dsl.md) rather than inventing leaner ones.
 *
 * Shape: `${…}` marks a tabbable field whose default text is the field's
 * content (CodeMirror snippet syntax). Each template CONTINUES a line that
 * already carries `:::` — it starts with the directive name, never with the
 * opening fence — and carries its own closing `:::`.
 *
 * The KEYS must cover `CONTAINERS` (deck/parse.mjs) exactly — the same live
 * list the validator checks unknown directives against. The coverage is
 * asserted by the test, so a container added to the DSL fails CI here until
 * it gets its snippet, instead of silently missing from the help.
 */

export const CONTAINER_SNIPPETS = {
  info: {
    detail: 'a neutral callout',
    template: 'info\n${A neutral callout — paragraphs and bullet lists only.}\n:::\n',
  },
  success: {
    detail: 'a green callout',
    template: 'success\n${What went well, in a sentence.}\n:::\n',
  },
  warning: {
    detail: 'an amber callout',
    template: 'warning\n${What needs attention, in a sentence.}\n:::\n',
  },
  danger: {
    detail: 'a red callout',
    template: 'danger\n${What is at risk, in a sentence.}\n:::\n',
  },
  metric: {
    detail: 'a metric card — value, label, optional trend',
    template: 'metric\n${42 %}\n${What this number measures}\n${↑ +12 pts vs last year}\n:::\n',
  },
  progress: {
    detail: 'a progress bar — share, label, optional caption',
    template:
      'progress ${success}\n${62 % / 80 %}\n${What is being delivered}\n${April 2026 — on track}\n:::\n',
  },
  status: {
    detail: 'a row of badges — nothing = ok, ! caution, !! critical, ? info',
    template: 'status\n${Scope, Schedule, Quality}\n${!Budget}\n${!!Risks}\n:::\n',
  },
};
