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

async function fromFrankfurter(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl('https://api.frankfurter.app/latest?from=USD');
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: Record<string, unknown> };
    const myr = body.rates?.['MYR'];
    return typeof myr === 'number' && myr > 0 ? myr : null;
  } catch {
    return null;
  }
}

function pinnedRate(): number | null {
  const raw = Number(process.env['SOLANA_MYR_PER_USD']);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** MYR per 1 USD, or null when every source failed. Pure + offline-testable. */
export async function myrPerUsd(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const rates = await usdBaseRates(fetchImpl);
  const primary = rates?.['MYR'];
  if (typeof primary === 'number' && primary > 0) return primary;
  const secondary = await fromFrankfurter(fetchImpl);
  if (secondary != null) return secondary;
  return pinnedRate();
}
