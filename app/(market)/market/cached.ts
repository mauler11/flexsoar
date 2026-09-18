/**
 * app/(market)/market/cached.ts
 *
 * Tiny TTL caches for the browse grid. Deliberately NOT unstable_cache:
 * a module-level Map works in every runtime (server, tests) with zero
 * framework coupling, and per-instance memory is fine for a 30s grid TTL.
 * Upgrade to the shared Data Cache only if cross-instance freshness ever
 * matters — it doesn't at 30 seconds.
 *
 * Two different lifetimes because the two queries have different
 * correctness constraints:
 *
 *   - Listings are viewer-dependent: the listings_visibility RLS policy
 *     shows early-access rows by level and own rows to the seller. This
 *     cache is per-instance but SHARED across viewers, so the viewer id is
 *     part of the key — without it, one user's early-access rows would leak
 *     into another user's grid. Key is the auth id, or 'anon'.
 *   - Platform config is identical for everyone: one global entry.
 *
 * Staleness contract: a just-sold card can linger in the grid for up to 30s.
 * That is display-only — the detail page reads uncached getListing(), and
 * the buy paths re-check availability server-side, so a stale tile can never
 * sell something twice. No on-demand invalidation yet: settlement lands via
 * the Stripe webhook, which lives in track/data-owned code; wire
 * revalidateTag there if 30s ever feels wrong.
 */
import {
  getListings,
  getPlatformConfig,
  type ListingsQuery,
} from "@/lib/api/contract";

/** Grid data TTL: freshness for shoppers vs DB load per filter click. */
const LISTINGS_TTL_MS = 30_000;

/** Platform flags change via admin action, rarely. */
const CONFIG_TTL_MS = 300_000;

/** Upper bound so one bad actor's filter permutations can't grow memory. */
const MAX_LISTINGS_ENTRIES = 200;

interface CacheEntry<T> {
  at: number;
  value: T;
}

const listingsCache = new Map<string, CacheEntry<Awaited<ReturnType<typeof getListings>>>>();
let configCache: CacheEntry<Awaited<ReturnType<typeof getPlatformConfig>>> | null = null;

function isFresh<T>(entry: CacheEntry<T> | undefined | null, ttlMs: number, now: number): entry is CacheEntry<T> {
  return entry != null && now - entry.at < ttlMs;
}

export async function cachedListings(
  viewerKey: string,
  query: ListingsQuery,
): Promise<Awaited<ReturnType<typeof getListings>>> {
  const key = `${viewerKey}:${JSON.stringify(query)}`;
  const now = Date.now();
  const hit = listingsCache.get(key);
  if (isFresh(hit, LISTINGS_TTL_MS, now)) return hit.value;

  const value = await getListings(query);
  if (listingsCache.size >= MAX_LISTINGS_ENTRIES) {
    for (const [k, entry] of listingsCache) {
      if (!isFresh(entry, LISTINGS_TTL_MS, now)) listingsCache.delete(k);
    }
    if (listingsCache.size >= MAX_LISTINGS_ENTRIES) listingsCache.clear();
  }
  listingsCache.set(key, { at: now, value });
  return value;
}

export async function cachedPlatformConfig(): Promise<
  Awaited<ReturnType<typeof getPlatformConfig>>
> {
  const now = Date.now();
  if (isFresh(configCache, CONFIG_TTL_MS, now)) return configCache.value;

  const value = await getPlatformConfig();
  configCache = { at: now, value };
  return value;
}

/** Test hook: drops all entries so cases start cold. */
export function clearMarketCaches(): void {
  listingsCache.clear();
  configCache = null;
}
