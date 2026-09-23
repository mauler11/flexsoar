import { describe, expect, it } from 'vitest';

import { portfolioSeries } from '@/lib/market/portfolio';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

describe('portfolio series', () => {
  it('values each day from the latest tape point at-or-before it', () => {
    const series = portfolioSeries(
      [
        {
          cardId: 'a',
          acquiredAtMs: NOW - 10 * DAY,
          costCents: 10000,
          tape: [
            { tMs: NOW - 5 * DAY, priceCents: 12000 },
            { tMs: NOW - 2 * DAY, priceCents: 15000 },
          ],
          fallbackCents: 11000,
        },
      ],
      7,
      NOW,
    );
    expect(series.points).toHaveLength(7);
    // Six days ago: acquired, no tape yet → fallback.
    expect(series.points[0].valueCents).toBe(11000);
    // Three days ago: first tape point rules.
    expect(series.points[3].valueCents).toBe(12000);
    // Today: latest tape point.
    expect(series.points[6].valueCents).toBe(15000);
    expect(series.valuedCount).toBe(1);
    expect(series.costCents).toBe(10000);
    expect(series.currentCents).toBe(15000);
  });

  it('excludes cards acquired after a day, and cards with no cost or value', () => {
    const series = portfolioSeries(
      [
        {
          cardId: 'new',
          acquiredAtMs: NOW - 1 * DAY,
          costCents: 5000,
          tape: [],
          fallbackCents: 6000,
        },
        { cardId: 'nocost', acquiredAtMs: NOW - 9 * DAY, costCents: null, tape: [], fallbackCents: 6000 },
        { cardId: 'noval', acquiredAtMs: NOW - 9 * DAY, costCents: 5000, tape: [], fallbackCents: null },
      ],
      7,
      NOW,
    );
    // Six days ago the new card wasn't owned yet → 0.
    expect(series.points[0].valueCents).toBe(0);
    // Today only the new card counts.
    expect(series.points[6].valueCents).toBe(6000);
    expect(series.valuedCount).toBe(1);
    expect(series.totalCount).toBe(3);
  });

  it('flatlines an empty book like an empty Courtyard chart', () => {
    const series = portfolioSeries([], 7, NOW);
    expect(series.points).toHaveLength(7);
    expect(series.points.every((p) => p.valueCents === 0)).toBe(true);
    expect(series.currentCents).toBe(0);
  });
});
