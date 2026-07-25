---
title: What a status board needs
subtitle: Progress bars, badges, aligned figures — and an engine that fits them
author: Lutrin
date: July 2026
footer: New in the compiler · one source, two deliverables
---

# What is new

- **Progress bars** and **status badges**, as blocks and inline — now with the
  **target** a bar is judged against
- **Figures that line up**: a Markdown delimiter row is now honoured
- **Saturated panels**, with the ink chosen for you
- A **text scale** a layout can ask for — and the engine pulls by itself
- Five chart types: **stacked**, **share**, **waterfall**, **gantt**, and a
  **target line** on any of them
- Everything below is in **this one file**, compiled to `.pptx` and to HTML

<!-- notes: the same source produced both deliverables; open them side by side. -->

# Where the programme stands

<!-- layout: status-list -->

## Citizen services

:::progress success
100 %
Online services
Delivered 15 April
:::

:::progress
45 % / 70 %
Paper forms
Committed 70 % by June
:::

## Back office

:::progress warning
25 %
Data migration
Under analysis
:::

:::progress danger
5 %
Legacy decommissioning
Blocked on procurement
:::

<!-- notes: four tints, four states. The percentage rides inside the fill when the bar is wide enough, and steps outside when it is not — both renderers decide that the same way. -->

# What is under control, and what is not

:::status
Scope, Schedule, Quality, Delivery
!Budget, !Stakeholders
!!Recruitment
:::

Nothing, one `!` and two `!!` are all the syntax there is: plain reads as
under control, one mark as worth watching, two as critical, and `?` as
information.

The same badge works inside a sentence. Each commitment carries an ==Owner==;
one that slips is tagged ==!At risk==; one that has stopped moving is
==!!Blocked==, and a note for information only is ==?FYI==.

<!-- notes: in the .pptx an inline badge is a highlighted run rather than a pill — DrawingML gives a text run no rounded background. A :::status row, placed by the engine, is drawn as real rounded shapes in both. -->

# The money column lines up

| Line item | Share | Committed | Remaining |
|---|---:|---:|---:|
| Licences | 42 % | 1 517 k$ | 883 k$ |
| Integration | 31 % | 1 120 k$ | 640 k$ |
| Change management | 27 % | 975 k$ | 402 k$ |
| **Total** | **100 %** | **3 612 k$** | **1 925 k$** |

Writing `|---:|` used to be parsed and thrown away. It is now honoured in both
outputs, and a right-aligned column also asks for tabular figures — without
them the right edge lines up while the thousands stay ragged, which is the
whole reason one right-aligns money.

# A verdict beside its reading

<!-- layout: scorecard -->

## 6 of 8

Commitments met this quarter

Two moved to May. Neither sits on the critical path.

## What the number hides

- Recruitment is the single blocker: two positions unfilled since February
- The data-migration window closes on 30 May
- Everything else is tracking to plan

<!-- notes: the saturated panel picks its own ink — dark on the green, white on the red — and imposes it on every block that writes straight onto it. Nobody names a colour anywhere in this file. -->

# Where the programme stands

<!-- layout: board -->

## Delivery

:::progress success
100 %
Online services
:::

:::progress
45 %
Paper forms
:::

## Commitments

:::status
Scope, Schedule, Quality
!Budget
!!Recruitment
:::

Each commitment carries an ==Owner==.

## Budget

| Line item | Committed |
|---|---:|
| Licences | 1 517 k$ |
| Integration | 1 120 k$ |
| Change | 975 k$ |

## To escalate

- Two developer positions unfilled since February
- The data-migration window closes on 30 May
- Procurement has not confirmed the decommissioning date

<!-- notes: four panels, one of them saturated, from four `##` sections and a six-line layouts/board.json. No coordinate is written anywhere. -->

# The portfolio, six at a time

<!-- layout: board-six -->

## Online services

:::progress success
100 %
Delivered
:::

## Paper forms

:::progress
45 % / 70 %
Target 70 %
:::

## Data migration

:::progress warning
25 %
Analysis
:::

## Permits

:::status
Scope, Schedule
!Budget
:::

## Mobile app

:::status
Quality
?Business case
:::

## Decommissioning

:::status
!!Procurement
:::

<!-- notes: same layout family as the four-panel board — `cols: 3` and nothing else. Six sections, two rows. -->

# Eight programmes, one page

<!-- layout: board-eight -->

## Online services

Delivered · 3 612 k$

## Paper forms

In development · 1 120 k$

## Data migration

Under analysis · 975 k$

## Recruitment

Two positions unfilled since February

## Permits

Awaiting sign-off · 640 k$

## Mobile app

Business case in review

## Partner API

Contract signed · Q3 start

## Decommissioning

Blocked on procurement

<!-- notes: `cols: 4`, `density: dense`, and the fourth tint cycles onto whatever needs flagging. Eight is the ceiling the grid generator publishes. -->

# Six panels and a band

<!-- layout: board-banner -->

## Online services

Delivered 15 April

## Paper forms

45 % — June

## Data migration

25 % — under analysis

## Permits

Awaiting sign-off

## Mobile app

Business case in review

## Partner API

Contract signed

## What the committee is asked to decide

Confirm the 30 May migration window, or the paper-forms commitment moves to
September and the decommissioning date with it.

<!-- notes: the seventh cell carries `span: 3` in the layout JSON — it takes the whole row, and the two gutters it covers with it. The deck says nothing about width. -->

# The engine fits it for you

<!-- layout: comparison -->

## Before

A block that did not fit used to leave its region and land on whatever was
underneath it. The compiler reported it as a warning — which is fine for a
deck you are writing by hand, and useless for one generated from data, where
nobody reads the log and the author never sees the sentence that overflowed.

The workaround was to shorten the text by hand, one word at a time, until the
line count happened to come out right. That is not editing: it is fighting
the tool. And it has to be redone every time the underlying figures move,
which for a status board is every single month.

The first time this deck's own dashboard was rebuilt, three panels out of six
came out overprinted and unreadable, and the only fix available was to cut
sentences until they stopped colliding. Every one of those cuts had to be
made again the following month, because the numbers behind them had changed
and the text had grown by a line.

## Now

A region that overflows is re-flowed one step down the text scale, twice at
most, and the deck says so through an informational diagnostic. Below that it
stops and asks you to cut: text at six points is not a fit, it is a failure
with the evidence hidden. A slide that can paginate still paginates — a
legible second slide beats a cramped single one.

The whole region steps down together, never one block inside it. Three type
sizes in the same panel read as a bug rather than as a fit, and the step is
discrete for the same reason: a panel that is merely comparable to its
neighbour is worth more than one fitted to the millimetre.

Pagination still wins wherever it is available: a flowing slide is split into
a "(cont.)" rather than squeezed, because a legible second slide is worth
more than a single cramped one. Densification is for the regions that cannot
be split — a panel, a column, a cell of a board.

These two columns are the demonstration. Neither of them fits at the deck's
ordinary size, and neither of them overflows.

<!-- notes: run `lutrin validate` on this file: this slide reports SLIDE_DENSIFIED, and nothing else does. -->

# Where the money went

```chart
type: waterfall
categories: Budget, Volume, Price, FX, Overruns, Actual
Committed: 3900, -180, 240, -95, -253, 3612
```

The one chart here where colour carries the **sign** and not the identity: a
rise is a rise, a fall is a fall, and the two anchors are neither. The first
and last categories anchor to zero by default; `totals:` names them when the
bridge has a subtotal in the middle.

<!-- notes: the numbers on the bars are drawn by the engine and are not optional — a bridge without them is a shape. -->

# What it costs, quarter by quarter

```chart
type: stacked-bar
categories: Q1, Q2, Q3, Q4
Salaries: 1200, 1250, 1260, 1310
Infrastructure: 420, 430, 510, 480
Services: 260, 300, 280, 340
```

`stacked-bar` adds the series up; `share-bar` normalises each category to
100 % when the mix matters more than the magnitude. The scale reads the
per-category totals, so the tallest column always fits.

# Requests closed, against the commitment

```chart
type: bar
categories: Jan, Feb, Mar, Apr, May
Closed: 180, 205, 240, 232, 268
target: 220
```

`target:` is the line a series is judged against. It is not a sixth series in
a sixth colour — it is the ink of the page, dashed — and it enters the scale,
so it can never fall outside its own frame.

The scale always holds zero, here as everywhere: a bar chart whose baseline is
not zero exaggerates every difference on it. For a series that lives in a
narrow band far from zero — an availability figure between 99 % and 100 % — say
so with a `:::metric` and its trend rather than a chart that will look flat.

# Three options, five criteria

```chart
type: rating
categories: Fit to process, Cost of change, Risk, Time to value
Rebuild in house: 4, 2, 4, 2
Extend the platform: 3, 4, 3, 4
Buy the module: 2, 5, 2, 5
scale: 5
```

The Harvey ball, and it is drawn rather than typeset. The half-filled disc
character is absent from WGL4 — this slide will not print it, for the same
reason — so a kit with a narrow face would put a tofu box in front of the
committee; and an OOXML wedge a viewer ignores draws a confidently wrong score.
An SVG rasterised like every other figure here has neither failure mode.

`scale:` is declared and never inferred: one new score elsewhere must not
rescale this table.

# The plan

```chart
type: gantt
categories: Q1, Q2, Q3, Q4, Q1 2027
now: Q2
Discovery: Q1 - Q2
Build: Q2 - Q4
Partner API: Q1, Q3 - Q4
Rollout: Q4 - Q1 2027
```

A span is `from - to`, both ends included; a comma puts two bars on one lane.
Until now **duration existed nowhere in this engine** — milestones and steps,
never a start and an end.

# Risks, assumptions, issues, dependencies

<!-- layout: raid -->

## Risks

- A winter storm could delay the June release
- Two developer positions unfilled since February

## Assumptions

- Procurement confirms the decommissioning date by 30 May
- The partner API stays backward compatible

## Issues

- The data-migration window closes on 30 May
- Two of eight milestones moved to May

## Dependencies

- Côte-des-Neiges and Ville-Marie sign off on the permit flow
- The SCAEC confirms the business need for the mobile app

<!-- notes: this layout is six lines of JSON on top of `swot` — no code at all. The four tints are chosen so that Assumptions and Dependencies read alike: both are things we rely on and do not own. -->

# One source, two deliverables

Everything in this deck came out of one `.md` file and two small JSON layouts.
The `.pptx` and the HTML are born of the same scene: the same geometry to the
pixel, the same tints, the same wrap.

Where PowerPoint cannot follow — a rounded background on a text run, an
OpenType feature switch — the difference is written down rather than left to
be discovered when the file opens in front of a committee.

<!-- notes: geometry is shared in deck/, not duplicated in the two renderers; a parity test sweeps both dispatch tables and fails the moment one of them drifts. -->
