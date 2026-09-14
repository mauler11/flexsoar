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

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type TrendDirection = 'up' | 'down' | 'flat';

export interface Trend {
  /** Short-window median vs long-window median, in basis points. */
  bps: number | null;
  direction: TrendDirection;
}

/**
 * Momentum: trailing-14d median vs trailing-90d median. More robust than
 * first-vs-last (one odd comp flips that arrow). Flat when within ±200bps
 * or when either window is empty.
 */
export function trend(
  points: readonly PricePoint[],
  nowMs: number = Date.now(),
  shortDays: number = 14,
  longDays: number = 90,
): Trend {
  const cutoffShort = nowMs - shortDays * 86400000;
  const cutoffLong = nowMs - longDays * 86400000;
  const short = median(
    points
      .filter((p) => new Date(p.observedAt).getTime() >= cutoffShort)
      .map((p) => p.priceCents),
  );
  const long = median(
    points
      .filter((p) => new Date(p.observedAt).getTime() >= cutoffLong)
      .map((p) => p.priceCents),
  );
  if (short == null || long == null || long <= 0) {
    return { bps: null, direction: 'flat' };
  }
  const bps = Math.round(((short - long) / long) * 10000);
  return {
    bps,
    direction: bps > 200 ? 'up' : bps < -200 ? 'down' : 'flat',
  };
}

export type VolatilityBand = 'calm' | 'lively' | 'wild';

export interface Volatility {
  /** (window high − low) ÷ window median, in percent. */
  pct: number | null;
  band: VolatilityBand | null;
}

/** Spread of the trailing window: calm <10%, lively <25%, else wild. */
export function volatility(
  points: readonly PricePoint[],
  nowMs: number = Date.now(),
  windowDays: number = 90,
): Volatility {
  const cutoff = nowMs - windowDays * 86400000;
  const pool = points
    .filter((p) => new Date(p.observedAt).getTime() >= cutoff)
    .map((p) => p.priceCents);
  if (pool.length < 2) return { pct: null, band: null };
  const med = median(pool);
  if (med == null || med <= 0) return { pct: null, band: null };
  const pct = ((Math.max(...pool) - Math.min(...pool)) / med) * 100;
  return {
    pct,
    band: pct < 10 ? 'calm' : pct < 25 ? 'lively' : 'wild',
  };
}

/** FlexSoar sales (not refs) closed in the trailing 30d — the exit count. */
export function salesLast30d(
  points: readonly PricePoint[],
  nowMs: number = Date.now(),
): number {
  const cutoff = nowMs - 30 * 86400000;
  return points.filter(
    (p) =>
      p.source === 'flexsoar' && new Date(p.observedAt).getTime() >= cutoff,
  ).length;
}

export interface MarketRead {
  fairMarket: number | null;
  trend: Trend;
  volatility: Volatility;
  sales30d: number;
  /** (fair − retail) ÷ retail in percent. Null without both. */
  vsRetailPct: number | null;
  /** One descriptive line for the panel — stats, never advice. */
  summary: string;
}

/**
 * The whole "should I care" read in one pure call. Summary strings are
 * descriptive (counts, direction, discount) — the platform shows weather,
 * traders decide whether to sail.
 */
export function marketRead(
  points: readonly PricePoint[],
  retailCents: number | null,
  nowMs: number = Date.now(),
): MarketRead {
  const fairMarket = fairMarketPrice(points, 90, nowMs);
  const t = trend(points, nowMs);
  const v = volatility(points, nowMs);
  const sales30d = salesLast30d(points, nowMs);
  const vsRetailPct =
    fairMarket != null && retailCents != null && retailCents > 0
      ? ((fairMarket - retailCents) / retailCents) * 100
      : null;

  const hasTape = points.length > 0;
  const hasSale = points.some((p) => p.source === 'flexsoar');
  let summary: string;
  if (!hasTape) {
    summary = 'No market data yet — reference only.';
  } else if (!hasSale) {
    summary = 'Reference only — no FlexSoar sale yet.';
  } else {
    const bits: string[] = [];
    bits.push(
      t.direction === 'up'
        ? 'climbing'
        : t.direction === 'down'
          ? 'cooling'
          : 'steady',
    );
    bits.push(sales30d === 1 ? '1 sale in 30d' : `${sales30d} sales in 30d`);
    if (vsRetailPct != null) {
      bits.push(
        vsRetailPct >= 0
          ? `${vsRetailPct.toFixed(0)}% over retail`
          : `${Math.abs(vsRetailPct).toFixed(0)}% under retail`,
      );
    }
    summary = bits.join(' · ') + '.';
  }
  return { fairMarket, trend: t, volatility: v, sales30d, vsRetailPct, summary };
}
