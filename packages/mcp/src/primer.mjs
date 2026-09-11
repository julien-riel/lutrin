/**
 * The Lutrin DSL in one screen: the server's `instructions`, which a client
 * hands its model at initialization — so an agent that only knows "Markdown"
 * learns, before it writes a single slide, that `#` splits slides, that `##`
 * is a column, that `:::metric` exists and that colours are never written.
 *
 * It travels in every session's context, hence the budget: the test caps it,
 * and every layout, directive, fence, comment and chart name it cites is
 * checked against `capabilities()` so it cannot drift from the engine. It is
 * a crib, not the reference — `packages/core/skills/deck/SKILL.md` and
 * `docs/dsl.md` hold the details, `validate_deck` holds the truth.
 */

export const PRIMER_MAX_CHARS = 3600;

export const DSL_PRIMER = `Lutrin compiles Markdown decks: describe CONTENT, the engine decides layout. Never write colours, sizes, positions, HTML or CSS in a deck.

STRUCTURE
- Frontmatter (\`---\` YAML) makes the cover: title, subtitle, author, date, footer, kit, lang (en|fr), agenda: true, titleLayout (image-right|image-left|image-full) + titleImage.
- \`# H1\` = a NEW SLIDE and its title (also \`---\`). A \`# H1\` with nothing under it = section divider.
- \`## H2\` = a section INSIDE the slide — never a slide title: 2 → two columns, 3 → three, 4–9 → grid of cards.
- Keep slides short; long lists/tables paginate by themselves ("cont."). Text + one visual → split.
- Force a layout with \`<!-- layout: name -->\` on the slide. Structured layouts (one \`##\` per panel/step/node, not paginated): comparison, pillars, timeline, layers, swot, grid, steps, focus, cycle, hierarchy, venn, radial, apex, matrix, columns, checklist, pictogram, annotated. Official named ones: before-after, pros-cons, roadmap, journey, priority-matrix, risk-map, risk-map-3, funnel, pyramid, key-message, portfolio, raid, status-list, kanban, team, okr, eisenhower, effort-impact, gartner-quadrant, product-tour, architecture, glossary, share-of, pricing.
- Other slide comments: \`<!-- notes: … -->\` (presenter), \`<!-- source: … -->\` (provenance caption), \`<!-- animate -->\` (step reveal; \`animate: fade|wipe|zoom|appear|none\`).

COMPONENTS (a \`:::\` line opens, a bare \`:::\` closes)
- Callouts: :::info :::success :::warning :::danger :::key (the takeaway).
- :::metric — big figure, then label, optional trend line "↑ +12 pts" (↑↗↓↘→, suffix (+) when a drop is good). ≥ 2 on a slide → metric cards.
- :::progress [info|success|warning|danger|key] — share first ("75 %", "3/4", "62 % / 80 %" with target), then label, optional caption.
- :::status — one row of badges: "Scope, !Budget, !!Hiring, ?Note" (nothing = ok, ! = caution, !! = critical, ? = info). Inline badge: ==Owner==, ==!At risk==.
- Prefer these to a "Item | % | Status" table.

VISUALS
- \`![alt](img.png)\` (path relative to the deck, or https URL, embedded at build); \`![left]\`/\`![right]\` pick the side, \`![cover]\`/\`![background]\` fill the page.
- Icons: \`![](lucide:leaf)\` — alt holds only intent words: primary|neutral|secondary|white, line|small|medium|large. On its own line, never inside a sentence, bullet, heading or table cell.
- Charts: \`\`\`chart fence, "type: bar" then "categories: Q1, Q2" and one "Series: 1, 2" line per series. Types: bar, barh, stacked-bar, stacked-barh, share-bar, share-barh, line, area, pie, doughnut, radar, waterfall, gantt, rating, heat, bullet, dumbbell. Decimal point, ≤ 6 series, no colours.
- \`\`\`mermaid → diagram; \`\`\`math / \`\`\`latex → equation; \`> quote\` + "— Author" → pull quote; \`- [ ]\` → checklist; 3–6 numbered short items → steps; one nested list → hierarchy.

LOOP: write → validate_deck (fix every error; heed LAYOUT_SUGGESTION) → build_deck. build_deck refuses a deck with errors; do not reach for \`force\`.`;
