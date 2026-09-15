/**
 * lib/solana/fx.ts
 *
 * MYR-per-USD for USDC quoting. The quote and build-tx routes both convert
 * the ledger's MYR ask into USDC base units, and both used to depend on a
 * single free endpoint — one outage blocked every Solana buy. Chain:
 *
 *   1. open.er-api.com (existing usdBaseRates),
 *   2. api.frankfurter.app (independent free provider, no key),
 *   3. SOLANA_MYR_PER_USD operator pin (explicit last resort),
 *   4. null — callers fail LOUDLY with 502, never with a guessed rate.
 *
 * The used rate travels inside the quote as `fxMyr`, so whichever source
 * wins is auditable per trade. A pinned rate drifts slowly (MYR/USD moves
 * ~0.1%/day) against 5-minute quote TTLs — acceptable, and always visible.
 */

import { usdBaseRates } from '@/lib/market/ebay';

async function frankfurterTable(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number> | null> {
  try {
    const res = await fetchImpl('https://api.frankfurter.app/latest?from=USD');
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: Record<string, unknown> };
    if (!body.rates) return null;
    const out: Record<string, number> = {};
    for (const [code, rate] of Object.entries(body.rates)) {
      if (typeof rate === 'number' && rate > 0) out[code] = rate;
    }
    return out;
  } catch {
    return null;
  }
}

/** Full USD-base FX table (target-per-USD), or null when both fail. */
export async function fxTable(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number> | null> {
  try {
    const rates = await usdBaseRates(fetchImpl);
    if (rates && typeof rates['MYR'] === 'number' && (rates['MYR'] as number) > 0) {
      return rates as Record<string, number>;
    }
  } catch {
    // Fall through to the second provider.
  }
  return frankfurterTable(fetchImpl);
}

function pinnedRate(): number | null {
  const raw = Number(process.env['SOLANA_MYR_PER_USD']);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** MYR per 1 USD, or null when every source failed. Pure + offline-testable. */
export async function myrPerUsd(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const table = await fxTable(fetchImpl);
  const live = table?.['MYR'];
  if (typeof live === 'number' && live > 0) return live;
  return pinnedRate();
}
