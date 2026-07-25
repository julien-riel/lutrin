---
title: What a status board needs
subtitle: Progress bars, badges, aligned figures — and an engine that fits them
author: Lutrin
date: July 2026
footer: New in the compiler · one source, two deliverables
---

# Five additions

- **Progress bars** and **status badges**, as blocks and inline
- **Figures that line up**: a Markdown delimiter row is now honoured
- **Saturated panels**, with the ink chosen for you
- A **text scale** a layout can ask for — and the engine pulls by itself
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
45 %
Paper forms
In development
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

# One source, two deliverables

Everything in this deck came out of one `.md` file and two small JSON layouts.
The `.pptx` and the HTML are born of the same scene: the same geometry to the
pixel, the same tints, the same wrap.

Where PowerPoint cannot follow — a rounded background on a text run, an
OpenType feature switch — the difference is written down rather than left to
be discovered when the file opens in front of a committee.

<!-- notes: geometry is shared in deck/, not duplicated in the two renderers; a parity test sweeps both dispatch tables and fails the moment one of them drifts. -->
