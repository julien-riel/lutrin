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

/**
 * The three fences the compiler treats as more than code — same contract as
 * the containers below, with one difference in how the coverage is held: the
 * compiler exports no list of special fences (the dispatch is inline in
 * parse.mjs), so the test asserts BEHAVIOR instead — each template, parsed,
 * must yield a block of its own type. A fence name that stopped being
 * special would fail as "came out a code block", which is exactly the
 * regression that matters.
 *
 * The math default avoids `{}` on purpose: a snippet field runs to the first
 * `}`, so `\frac{1}{2}` would end the field early. Pythagoras compiles just
 * as well and survives the syntax.
 */
export const FENCE_SNIPPETS = {
  chart: {
    detail: 'a native chart — bar, line, pie…, drawn in the kit colours',
    // numbered `${n:text}` fields, NOT `${text}`: a purely numeric name
    // (`${165}`) is read as a field ORDER with no default text, and the
    // inserted deck then carries an empty `target:` the chart parser refuses
    template:
      'chart\ntype: ${1:bar}\ncategories: ${2:Q1, Q2, Q3, Q4}\n${3:Planned}: ${4:120, 150, 180, 210}\n${5:Actual}: ${6:110, 155, 175, 190}\ntarget: ${7:165}\n```\n',
  },
  math: {
    detail: 'a LaTeX equation — native and editable in the .pptx',
    template: 'math\n${a^2 + b^2 = c^2}\n```\n',
  },
  mermaid: {
    detail: 'a Mermaid diagram, rendered by the engine',
    template: 'mermaid\nflowchart LR\n  ${start[Start]} --> ${finish[Finish]}\n```\n',
  },
};

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
  key: {
    detail: 'the takeaway box, in the brand tint',
    template: 'key\n${The one thing to remember from this slide.}\n:::\n',
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
