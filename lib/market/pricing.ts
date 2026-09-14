/**
 * lib/market/pricing.ts
 *
 * The tape's pure math: change %, range windowing, and the Fair Market
 * Price (median of the model's tape, trailing 90d — FlexSoar sales AND
 * market refs, a sale is market data). Plain module deliberately: server
 * pages call fairMarketPrice() during render, and anything behind a
 * "use client" boundary (PriceChart.tsx) cannot be invoked from the
 * server — only rendered. Keep this file free of React, next/headers,
 * and Supabase so both sides share the one definition.
 */

import type { PricePoint } from '@/lib/api/contract';

export interface PriceChange {
  /** Null when fewer than two points exist. */
  pct: number | null;
  firstCents: number | null;
  lastCents: number | null;
}

/** Change %: last point vs first point in the rendered window. */
export function priceChange(points: readonly PricePoint[]): PriceChange {
  if (points.length < 2) {
    const only = points.length === 1 ? points[0].priceCents : null;
    return { pct: null, firstCents: only, lastCents: only };
  }
  const firstCents = points[0].priceCents;
  const lastCents = points[points.length - 1].priceCents;
  if (firstCents <= 0) {
    return { pct: null, firstCents, lastCents };
  }
  return {
    pct: ((lastCents - firstCents) / firstCents) * 100,
    firstCents,
    lastCents,
  };
}

export type ChartRange = '1M' | '6M' | '1Y' | 'ALL';

const RANGE_DAYS: Record<ChartRange, number | null> = {
  '1M': 31,
  '6M': 183,
  '1Y': 365,
  ALL: null,
};

/**
 * Window the tape by age. A range that chops the tape to one point or
 * none tells nothing — falls back to the full tape rather than an empty
 * chart.
 */
export function filterByRange(
  points: readonly PricePoint[],
  range: ChartRange,
  nowMs: number = Date.now(),
): PricePoint[] {
  const days = RANGE_DAYS[range];
  if (days == null) return [...points];
  const cutoff = nowMs - days * 86400000;
  const inWindow = points.filter(
    (p) => new Date(p.observedAt).getTime() >= cutoff,
  );
  return inWindow.length >= 2 ? inWindow : [...points];
}

/**
 * The Fair Market Price: median of the tape inside a trailing window,
 * falling back to the latest point, then to null. Nobody sets this
 * number: admins pin reference points, buyers close sales, and this
 * reads the result.
 */
export function fairMarketPrice(
  points: readonly PricePoint[],
  windowDays: number = 90,
  nowMs: number = Date.now(),
): number | null {
  if (points.length === 0) return null;
  const cutoff = nowMs - windowDays * 86400000;
  const inWindow = points.filter(
    (p) => new Date(p.observedAt).getTime() >= cutoff,
  );
  const pool = (inWindow.length > 0 ? inWindow : [points[points.length - 1]])
    .map((p) => p.priceCents)
    .sort((a, b) => a - b);
  const mid = Math.floor(pool.length / 2);
  return pool.length % 2 === 1
    ? pool[mid]
    : Math.round((pool[mid - 1] + pool[mid]) / 2);
}
