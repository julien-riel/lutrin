---
title: Renderer coverage fixture
subtitle: One instance of each of the nineteen block types
footer: Fixture ZQFOOTER
---

# Paragraph and bullets

Sample paragraph ZQPARA in **bold** and *italic*.

- Sample bullet ZQBULLET
- Second bullet

# Table

| Column ZQHEADER | Column ZQHEADER2 |
|---|---|
| Cell ZQCELL | value |
| second row | ZQLAST |

# Code

```js
const zqCode = 'ZQCODE';
```

# Callout

:::warning
Sample callout ZQALERT.
:::

:::success
Second sample callout ZQSUCCESS.
:::

# Metric

:::metric
ZQVALUE
Sample metric ZQLABEL
↑ +12 % ZQTREND
:::

# Progress

:::progress success
100 %
Complete bar ZQFULL
Shipped ZQPROGCAPTION
:::

:::progress
0 %
Empty bar ZQEMPTY
:::

# Status

:::status
Scope ZQBADGE, Quality
!Budget ZQWARNBADGE
:::

Inline ==Action ZQINLINE== and ==!!Urgent ZQINLINEWARN== in a sentence.

# Quote

> Sample quote ZQQUOTE.
>
> — Source ZQSOURCE

# Image and icon

![Sample image ZQIMAGE](pixel.png)

![](lucide:coffee)

# Diagram

```mermaid
flowchart LR
  A[ZQMERMAID] --> B[End]
```

# Equation

```math
E_{ZQMATH} = mc^2
```

# Chart

```chart
type: bar
categories: Q1, Q2
ZQSERIES: 3, 5
ZQOTHERSERIES: 4, 2
```

# Pillars

<!-- layout: pillars -->

## ZQHEADING2

- panel content

## Second pillar

- other content

# Milestones

<!-- layout: timeline -->

## ZQMILESTONE

First milestone of the fixture.

## 2027

Second milestone.

# Cycle diagram

<!-- layout: cycle -->

## ZQSMART

The first stage of the fixture cycle.

## A & B <c> "d"

## Third stage

# Pictogram

<!-- layout: pictogram -->

:::progress
38 %
Share of the fixture population
:::
