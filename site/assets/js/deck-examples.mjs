/**
 * The playground's examples — the decks behind the buttons in the bar.
 *
 * A SEPARATE module, and deliberately free of any import: playground.js reads
 * it for the buttons, and packages/core/test/playground.test.mjs compiles
 * every deck here through the real validator. That test is the honesty
 * guarantee this file lives under: each example must produce ZERO diagnostics
 * — an example the validator then underlines would be the playground teaching
 * a mistake. The same test holds the buttons in playground.html to this list,
 * in both directions: an example with no button is invisible, a button with
 * no example is a dead click.
 *
 * Shape: `{ source, kit? }`. `kit` names an example kit from /kits/ that the
 * deck is written against — clicking that example switches the picker to it,
 * because the deck asks for layouts and images only that kit declares. The
 * test validates such a deck under that kit's theme, exactly as the page
 * compiles it.
 *
 * Order matters twice, and playground.html repeats it: the single-slide
 * teasers first (a reader arrives at something already recognised, and edits
 * rather than invents), then the multi-slide corporate decks, and the heavy
 * ones LAST — "An equation" is what fetches MathJax's 2.3 MB, "A diagram"
 * Mermaid's 3.5 MB, and "The whole tour" both. Nobody pays for any of it by
 * merely arriving on the page.
 */

export const DECK_EXAMPLES = {
  funnel: {
    source: `# Request triage

<!-- layout: funnel -->

## 2,400 received
All channels combined.

## 1,100 eligible
After checking the criteria.

## 320 selected
Funded this year.
`,
  },
  metrics: {
    source: `# Indicators

:::metric
33
Layouts available
↑ +2 this release
:::

:::metric
15
Chart types
↑ +7 this release
:::

:::metric
0
Coordinates in this file
→ by design
:::
`,
  },
  chart: {
    source: `# Budget by quarter

The chart is drawn by the engine, in the brand's colours, on a
palette checked for contrast and colour blindness.

\`\`\`chart
type: bar
categories: Q1, Q2, Q3, Q4
Planned: 120, 150, 180, 210
Actual: 110, 155, 175, 190
target: 165
\`\`\`
`,
  },

  // The corporate decks: several slides each, the shape a reader actually
  // ships — a quarterly review for a leadership room, a project update for a
  // steering committee. Same rule as every example: content only, zero
  // diagnostics.
  review: {
    source: `---
title: Q3 business review
subtitle: Revenue, delivery, and the plan for Q4
author: The leadership team
date: October 2026
---

# The quarter in numbers

:::metric
4.2 M
Quarterly revenue
↑ +9 % vs Q2
:::

:::metric
93 %
Renewal rate
↑ +2 pts
:::

:::metric
47
New accounts
→ flat
:::

:::metric
12 days
Median onboarding
↓ -3 days (+)
:::

# Revenue by segment

\`\`\`chart
type: bar
categories: Q4, Q1, Q2, Q3
Enterprise: 1.6, 1.8, 1.9, 2.2
Mid-market: 0.9, 1.0, 1.2, 1.3
Self-serve: 0.5, 0.6, 0.6, 0.7
\`\`\`

# Delivery, program by program

<!-- layout: status-list -->

## Platform migration

:::progress success
80 %
Data plane cut over
September — on track
:::

## Mobile app

:::progress warning
55 % / 70 %
Beta live in two markets, against a 70 % commitment
October — one sprint late
:::

## Commitments

:::status
Scope, Quality, Security
!Schedule
!!Hiring
:::

# The sales pipeline

<!-- layout: funnel -->

## 610 qualified leads
Marketing and referrals combined.

## 140 in evaluation
Proof of concept under way.

## 38 in contracting
Forecast to close this quarter.

# Where the risks sit

<!-- layout: risk-map -->

## Churn in mid-market

Two renewals slipped a quarter — both accounts assigned an executive sponsor.

## Hiring behind plan

Five open roles; the offer pipeline covers three.

## Cloud cost drift

Unit costs up 4 % — a savings plan is committed for November.

## Vendor lock-in

Single supplier on payments; a second is in procurement.

# The plan for Q4

<!-- layout: roadmap -->

## October

Close the mobile beta gap; ship the partner API to design partners.

## November

Land the cloud savings plan; two enterprise go-lives.

## December

Annual pricing review; Q1 targets to the board.

# One number to keep

<!-- layout: key-message -->

93 % of customers renewed

Retention carried the quarter — Q4 spends it on the pipeline.
`,
  },
  project: {
    source: `---
title: Atlas migration
subtitle: Steering committee — monthly update
author: The Atlas team
date: November 2026
---

# Where the work stands

<!-- layout: kanban -->

## To do

- Payment provider cut-over
- Archive the legacy store

## Doing

- Customer data backfill
- Load testing at 2× peak

## Done

- Identity migrated
- Read traffic on the new stack

# Objectives this quarter

<!-- layout: okr -->

## Move the data without losing a row

:::progress success
92 %
Accounts backfilled and reconciled
Zero variance on the last three runs
:::

## Keep the old stack boring

:::progress
100 %
Incident-free weeks, 9 of 9
Freeze holds until cut-over
:::

# The log

<!-- layout: raid -->

## Risks

The payment provider's test window slips into December.

## Assumptions

Peak traffic stays within 2× of today until January.

## Issues

Two reports still read from the legacy store.

## Dependencies

The network team delivers the private link this month.

# A decision for this board

<!-- layout: pros-cons -->

## Cut over in December

- The freeze ends four weeks earlier
- The team that built it is still assembled

## Wait for January

- Clear of the holiday peak
- One more full reconciliation cycle

# The path to go-live

<!-- layout: timeline -->

## Now

Backfill complete, dual-write on.

## Week 2

Load test at 2× peak, sign-off.

## Week 4

Cut-over rehearsal, rollback drill.

## Go-live

Write traffic switches; legacy goes read-only.

# Who is on it

<!-- layout: team -->

## Noor

Delivery lead — owns the cut-over plan.

## Marco

Data — backfill and reconciliation.

## Iris

Platform — load, observability, rollback.

## Sam

Payments — the provider integration.

# The ask

<!-- layout: focus -->

Confirm the December cut-over

The rehearsal is booked; the rollback drill is green. A decision today keeps
the freeze four weeks shorter.
`,
  },
  visual: {
    kit: 'studio-amber',
    source: `---
title: Studio Amber
subtitle: A kit that carries its own imagery
author: The studio
date: 2026
---

# The year the studio grew up

<!-- layout: opening -->

The layout is \`opening\` — the kit's \`hero\` base, and the kit's own skyline
under the title. Nothing in this file names an image.

# The work, beside the words

<!-- layout: showcase -->

- \`showcase\` is the kit's \`split\` base: text left, the skyline right
- The image comes from the layout — the deck never writes a path
- Swap the kit and the same slide comes out in the next brand's photo

# An image the deck asks for

The other direction: the deck can place a kit image itself, by its alias —
this slide writes \`![right](kit:skyline)\` and the kit answers with the file.

- Aliases are declared once, in the kit's \`theme.json\`
- \`kit:\` is the only way a deck names a brand asset — no paths, no URLs
- An unknown alias degrades to a placeholder, with a "did you mean"

![right](kit:skyline)

# Chapter two

<!-- layout: chapter -->

# The people

<!-- layout: faces -->

## Noor

Creative director.

## Marco

Type and systems.

## Iris

Client studio.

:::info
\`faces\` is a \`grid\` with the \`images\` parameter: one portrait per cell,
placed by the layout — the deck only writes names and roles.
:::

# Bring your own brand

- A kit is a directory: theme tokens, fonts, logos, images, layouts
- Declare images in \`theme.json\`, place them from layouts or with \`kit:\`
- Upload your own \`.deckkit\` with the picker above and recompile this deck

:::key
The deck stays words. The brand — colours, type, imagery — travels with
the kit.
:::
`,
  },

  // The heavy ones last: clicking "An equation" is what fetches MathJax's
  // 2.3 MB, clicking "A diagram" Mermaid's 3.5 MB — and "The whole tour"
  // pays for both, since it demonstrates every block the engine has. Nobody
  // pays for any of it by merely arriving on the page.
  math: {
    source: `# The model

The engine typesets LaTeX with MathJax, here and in the file you download.

\`\`\`math
\\frac{1}{2}\\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2
\`\`\`

\`\`\`math
e^{i\\pi} + 1 = 0
\`\`\`
`,
  },
  diagram: {
    source: `# How a deck gets made

The diagram is rendered right here, by the same Mermaid the
command line uses, in the brand's colours.

\`\`\`mermaid
flowchart LR
  md[Markdown] --> ast[AST] --> ir[IR]
  ir --> pptx[.pptx]
  ir --> html[HTML]
\`\`\`
`,
  },
  tour: {
    source: `---
title: The whole tour
subtitle: Every layout and every block, one slide each
author: Lutrin
date: 2026
---

# How to read this deck

- Every slide is built with the feature it names — the slide about columns
  has columns, the SWOT slide is a SWOT
- First the layouts the engine **infers** from your content, then the ones
  you **ask for** with \`<!-- layout: … -->\`, then the blocks
- The photo layouts — \`hero\`, \`split\` with a brand image — live in the
  "Slides with images" example, under the Studio Amber kit

# Layouts by inference

# Plain content

With no directive at all, the engine reads the slide and picks the layout.
Text like this becomes \`content\` — and a slide that runs long **paginates**
into "(cont.)" slides rather than shrinking.

- Lists nest
  - on three
    - levels
- A word can carry a badge: the build is ==Green==

# Two columns

## What you write

Two \`##\` headings under one title — anything under each.

## What you get

Two equal columns, styled by the theme. Three headings give three.

# Three columns, icon-led

## Write

![](lucide:pen-line)

One Markdown file, content only.

## Validate

![](lucide:badge-check)

Fix every diagnostic it reports.

## Present

![](lucide:monitor)

The same slides, in PowerPoint or a browser.

# A dominant table

| Layout | Sections | Picked when |
|--------|:--------:|-------------|
| \`content\` | — | text and lists |
| \`two-columns\` | 2 | two \`##\` headings |
| \`table\` | — | this very slide |
| \`metrics\` | — | two or more \`:::metric\` |
| \`quote\` | — | a quotation alone |

# Numbers that pop

:::metric
33
Layouts in this deck
→ all of them
:::

:::metric
2
Output formats
→ same geometry
:::

:::metric
0
Coordinates written
→ by design
:::

# Words worth quoting

> A quotation standing alone becomes the whole slide. Give it an
> attribution line and the engine sets both.
>
> — The quote layout, on itself

# A code block alone

\`\`\`js
const scenes = buildScenes(parseDeck(source));
render(scenes); // one scene graph, two outputs
\`\`\`

# A chart alone

\`\`\`chart
type: line
categories: Jan, Feb, Mar, Apr, May, Jun
Decks compiled: 4, 9, 15, 22, 31, 44
Hours saved: 2, 5, 9, 14, 21, 30
\`\`\`

# An equation

\`\`\`math
S = \\frac{\\sum_{i=1}^{n} p_i \\cdot c_i}{N} \\times (1 + \\tau)
\`\`\`

# A diagram

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[Layout engine] --> C[Scene]
  C --> D[.pptx]
  C --> E[HTML]
\`\`\`

# Layouts on request

# Comparison

<!-- layout: comparison -->

## Before

Slides drawn by hand, geometry drifting deck by deck.

## After

Slides compiled from content, geometry held by the engine.

# Pillars

<!-- layout: pillars -->

## Content first

You write meaning — never geometry.

## Brand by construction

The kit carries palette, fonts, logos.

## One scene, two outputs

The .pptx and the HTML share identical geometry.

# Timeline

<!-- layout: timeline -->

## Phase 1

Draft the story in Markdown.

## Phase 2

Validate — fix every diagnostic.

## Phase 3

Build, judge the density, present.

# Layers

<!-- layout: layers -->

## Outputs

PowerPoint, standalone HTML, live preview.

## Layout engine

Inference, slots, pagination.

## IR

Deck, slides, sections, blocks.

# SWOT

<!-- layout: swot -->

## Strengths

One source file under version control.

## Weaknesses

A syntax to learn.

## Opportunities

A kit per organization; CI on every push.

## Threats

Hand edits to the .pptx are lost at the next build.

# Grid

<!-- layout: grid -->

## Cells

Two to eight sections, placed row by row.

## Columns

Two by default, up to four.

## Headers

The headed parameter detaches a title bar.

## Tints

Cells can take semantic tints.

# Steps

<!-- layout: steps -->

## Parse

Markdown becomes blocks.

## Analyze

The layout is inferred or read.

## Place

Every block lands in a slot.

## Render

One scene, two outputs.

# Focus

<!-- layout: focus -->

Describe the content.

Geometry belongs to the engine, brand belongs to the kit.

# Cycle

<!-- layout: cycle -->

## Plan

Scope agreed with the sponsors.

## Build

Two-week iterations.

## Review

Adoption dashboard.

## Adjust

Feed the next plan.

# Hierarchy

<!-- layout: hierarchy -->

- Delivery
  - Engineering
    - Platform
    - Product
  - Design
  - Operations

# Venn

<!-- layout: venn -->

## Desirable

## Feasible

## Viable

# Radial

<!-- layout: radial -->

Compiler core

## CLI

## VS Code

## Playground

## CI

# Apex

<!-- layout: apex -->

## Vision

## Strategy

## Projects

## Daily work

# The official catalog

# Before / after

<!-- layout: before-after -->

## By hand

The brand varies by author; reuse is copy-paste.

## Compiled

The brand comes from the kit; the source is versioned.

# Pros / cons

<!-- layout: pros-cons -->

## Pros

- The intent is visible at a glance
- Validation checks the section bounds

## Cons

- One more name to remember
- Panels never paginate — brevity is enforced

# Roadmap

<!-- layout: roadmap -->

## Week 1

A first deck with the neutral theme.

## Week 2

Install the organization kit.

## Week 3

Custom layouts; CI compiles on every push.

# Journey

<!-- layout: journey -->

## Write

One Markdown file.

## Validate

Every diagnostic fixed.

## Build

HTML to judge, .pptx to deliver.

## Present

Notes, animations, presenter view.

# Priority matrix

<!-- layout: priority-matrix -->

## Quick wins

Validate before every build.

## Big bets

A kit that carries your brand.

## Fill-ins

Notes and step-by-step reveals.

## Time sinks

Hand-tuning geometry the engine redoes.

# Risk map

<!-- layout: risk-map -->

## Unknown icon

A warning; the slide survives.

## Missing image

A clean placeholder, never a broken slide.

## Overflowing panel

The compiler names exactly what to trim.

## Missing explicit kit

The build stops — fix the reference.

# Risk map, 3 × 3

<!-- layout: risk-map-3 -->

## Typo in a name

"Did you mean" catches it.

## Icon not in the set

Skipped, with a warning.

## Draft too dense

Densified one step, and reported.

## Stale vendored asset

Re-vendor before the build.

## Panel overflow

Named, with the text to trim.

## Chart data invalid

Degrades to a visible code block.

## Kit missing fonts

Both outputs fall back together.

## Hand edits to .pptx

Lost at the next build.

## No version control

The one risk the tool cannot fix.

# Funnel

<!-- layout: funnel -->

## 2,400 received

All channels combined.

## 1,100 eligible

After checking the criteria.

## 320 selected

Funded this year.

# Pyramid

<!-- layout: pyramid -->

## The message

The sentence the room should remember.

## The arguments

The three reasons that carry it.

## The evidence

Data, quotations, charts underneath.

# Key message

<!-- layout: key-message -->

33 layouts, one source file

Every one of them is on show in this deck.

# Portfolio

<!-- layout: portfolio -->

## CLI

build, validate, preview, vendor.

## VS Code

Live preview and diagnostics.

## Playground

This very page.

# RAID

<!-- layout: raid -->

## Risks

Recruitment slipping a quarter.

## Assumptions

The kit lands before the pilot.

## Issues

Two systems disagree on totals.

## Dependencies

The identity service, another team.

# Status list

<!-- layout: status-list -->

## Delivery

:::progress success
100 %
Online services
Delivered in April
:::

## Commitments

:::status
Scope, Schedule, Quality
!Budget
!!Recruitment
:::

# Kanban

<!-- layout: kanban -->

## To do

- Partner API
- Legacy archive

## Doing

- Data backfill
- Load testing

## Done

- Identity migrated
- Read traffic switched

# Team

<!-- layout: team -->

## Noor

Delivery lead.

## Marco

Data and reconciliation.

## Iris

Platform and rollback.

## Sam

Payments integration.

# OKR

<!-- layout: okr -->

## Ship the migration

:::progress success
92 %
Accounts backfilled
Zero variance, three runs
:::

## Keep the old stack boring

:::progress
100 %
Incident-free weeks, 9 of 9
Freeze holds to cut-over
:::

# The blocks

# Callout boxes

:::info
Use info for context the audience may skip.
:::

:::success
Use success for what is settled and working.
:::

:::warning
Use warning for the caveat that saves a ticket.
:::

:::danger
Keep danger for the step where something can be lost.
:::

# The takeaway box

Ordinary Markdown works everywhere: **bold**, *italic*, \`inline code\`,
links, and a status word set off as a badge — ==Shipped==, ==!At risk==.

:::key
The one thing to remember from this slide — set in the brand tint by
the \`:::key\` box.
:::

# Progress and status

:::progress success
62 % / 80 %
What is being delivered
April 2026 — on track
:::

:::status
Scope, Schedule, Quality
!Budget
!!Risks
:::

# Icons, in the theme's inks

## Primary

![](lucide:palette)

Any of ~2,000 Lucide icons, in the theme's primary colour.

## Neutral

![neutral](lucide:pen-tool)

The body-text ink — quieter.

## Secondary

![secondary](lucide:layers)

The secondary ink completes the set.

# Reveal step by step

<!-- animate -->

One comment, \`<!-- animate -->\`, and this slide appears on click:

- Lists reveal themselves point by point
- Columns, panels and metrics arrive as whole blocks
- Native on-click animations in PowerPoint, click-to-reveal in HTML

<!-- notes: Presenter notes ride along too — invisible on screen, in the notes pane of the .pptx, under the slide in HTML. -->
`,
  },
};
