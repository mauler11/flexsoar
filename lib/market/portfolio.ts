/**
 * lib/market/portfolio.ts
 *
 * Unrealized portfolio math for the profile P/L graph. Pure module (no
 * I/O): the page resolves each holding's model tape, this turns tapes +
 * acquisition costs into a daily value series and totals.
 *
 * Honesty rules, same as the strip this replaces:
 * - A card counts as valued only with BOTH a cost (open provenance hop)
 *   and a value source (tape point at-or-before the day, else the live
 *   ask/oracle fallback). Anything else is excluded and counted, never
 *   invented.
 * - Sold cards are out of scope: provenance records no release price, so
 *   realized P/L cannot be computed from it.
 */

export interface HoldingTapeInput {
  cardId: string;
  /** Open-hop acquisition timestamp. Cards acquired after a day are absent from it. */
  acquiredAtMs: number;
  /** Open-hop price, null when the hop carries none. */
  costCents: number | null;
  /** Model tape, any order. Empty when the model has never traded. */
  tape: ReadonlyArray<{ tMs: number; priceCents: number }>;
  /** Live ask, else oracle — the value when the tape is silent. */
  fallbackCents: number | null;
}

export interface PortfolioPoint {
  tMs: number;
  valueCents: number;
}

export interface PortfolioSeries {
  points: PortfolioPoint[];
  /** Cards with cost + value that feed the line. */
  valuedCount: number;
  totalCount: number;
  costCents: number;
  currentCents: number;
}

const DAY_MS = 86_400_000;

function startOfDayUtc(tMs: number): number {
  const d = new Date(tMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Daily portfolio value, oldest first, `days` points ending today. A day's
 * value sums every valued card acquired on or before it, each at its
 * latest tape point at-or-before that day (else its fallback).
 */
export function portfolioSeries(
  holdings: readonly HoldingTapeInput[],
  days: number,
  nowMs: number = Date.now(),
): PortfolioSeries {
  const today = startOfDayUtc(nowMs);
  const valued = holdings.filter(
    (h) =>
      h.costCents != null &&
      (h.tape.length > 0 || h.fallbackCents != null),
  );
  const tapes = new Map(
    valued.map((h) => [
      h.cardId,
      [...h.tape].sort((a, b) => a.tMs - b.tMs),
    ]),
  );

  const points: PortfolioPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const dayEnd = today - back * DAY_MS + DAY_MS - 1;
    let value = 0;
    for (const h of valued) {
      if (h.acquiredAtMs > dayEnd) continue;
      const tape = tapes.get(h.cardId) ?? [];
      let v: number | null = null;
      for (let i = tape.length - 1; i >= 0; i--) {
        if (tape[i].tMs <= dayEnd) {
          v = tape[i].priceCents;
          break;
        }
      }
      value += v ?? h.fallbackCents ?? 0;
    }
    points.push({ tMs: today - back * DAY_MS, valueCents: value });
  }

  const costCents = valued.reduce((s, h) => s + (h.costCents ?? 0), 0);
  return {
    points,
    valuedCount: valued.length,
    totalCount: holdings.length,
    costCents,
    currentCents: points.length > 0 ? points[points.length - 1].valueCents : 0,
  };
}
