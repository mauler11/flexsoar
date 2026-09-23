/**
 * lib/market/ebay.ts
 *
 * Live market data in: eBay Finding API `findCompletedItems` (recent SOLD
 * listings) per model, medianed into one MYR-sen reference point. This is
 * the only ready-made price source used — official API, app-key auth, no
 * scraping, no ToS breach. StockX/GOAT offer no public API; anything
 * claiming to be one is an undocumented endpoint that can vanish or
 * rate-block the platform on someone else's schedule.
 *
 * Plain fetch module (no next/headers, no Supabase) so tests drive it with
 * an injected fetch. The cron route supplies the real one.
 *
 * The one exception is ebayChallengeResponse(), which uses node:crypto —
 * it only ever runs in the deletion-webhook route and in tests, both
 * Node. Never import this module from a client component.
 */

import { createHash } from 'node:crypto';

export interface EbaySold {
  /** Sold price in the listing's own currency. */
  price: number;
  currency: string;
  endedAt: string;
}

export interface EbayComps {
  query: string;
  /** Median sold price, converted to MYR sen. Null when too few solds. */
  medianSen: number | null;
  sampleSize: number;
  fxUsed: number | null;
}

/** eBay Finding API needs nothing but the app key — manual setup, Vercel env. */
function appId(): string | null {
  const key = process.env.EBAY_APP_ID?.trim();
  return key ? key : null;
}

/** Cert ID (client secret) for the OAuth client-credentials grant. */
function certId(): string | null {
  const secret = process.env.EBAY_CERT_ID?.trim();
  return secret ? secret : null;
}

/** OAuth scope gating item_sales/search. Granted via Application Growth Check. */
const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

interface EbayAppToken {
  token: string;
  expiresAtMs: number;
}

let cachedToken: EbayAppToken | null = null;
let cachedCategories: { ids: string[]; expiresAtMs: number } | null = null;

/** Test hook: drop the module caches between cases. */
export function clearEbayCaches(): void {
  cachedToken = null;
  cachedCategories = null;
}

/**
 * OAuth application token (client-credentials grant), cached until near
 * expiry. Null when unconfigured or refused — callers fall back, never
 * throw, so a missing EBAY_CERT_ID or a denied scope reads as "no comps".
 */
export async function getEbayAppToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const id = appId();
  const secret = certId();
  if (!id || !secret) return null;
  try {
    const credentials =
      typeof btoa === 'function'
        ? btoa(`${id}:${secret}`)
        : Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetchImpl('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(INSIGHTS_SCOPE)}`,
    });
    if (!res.ok) {
      cachedToken = null;
      return null;
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (typeof body.access_token !== 'string' || !body.access_token) return null;
    const ttlMs =
      typeof body.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in * 1000
        : 3600_000;
    cachedToken = { token: body.access_token, expiresAtMs: Date.now() + ttlMs };
    return cachedToken.token;
  } catch {
    return null;
  }
}

/**
 * Athletic-footwear category ids, resolved live through the Taxonomy API
 * (no hardcoded ids to rot) and cached 24h. Empty when unresolvable —
 * item_sales/search requires ≥1 category, so callers skip the model.
 */
export async function sneakerCategoryIds(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  if (cachedCategories && cachedCategories.expiresAtMs > Date.now()) {
    return cachedCategories.ids;
  }
  try {
    const res = await fetchImpl(
      'https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=sneakers',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      categorySuggestions?: {
        categoryTreeNode?: Array<{
          category?: { categoryId?: string; categoryName?: string };
        }>;
      };
    };
    const nodes = body?.categorySuggestions?.categoryTreeNode ?? [];
    const ids = nodes
      .filter((n) => /athletic/i.test(n?.category?.categoryName ?? ''))
      .map((n) => n?.category?.categoryId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, 4);
    if (ids.length > 0) {
      cachedCategories = { ids, expiresAtMs: Date.now() + 24 * 3600_000 };
    }
    return ids;
  } catch {
    return [];
  }
}

interface InsightsSale {
  lastSoldPrice?: { value?: string; currency?: string };
  price?: { value?: string; currency?: string };
  lastSoldDate?: string;
  itemEndDate?: string;
  soldDate?: string;
}

/**
 * Recent solds via Marketplace Insights item_sales/search (90-day window).
 * Returns [] (never throws) when unapproved/unconfigured/erroring — the
 * cron skips the model and reports it, same contract as the Finding path.
 */
export async function fetchInsightsSolds(
  keywords: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbaySold[]> {
  const token = await getEbayAppToken(fetchImpl);
  if (!token) return [];
  const categoryIds = await sneakerCategoryIds(token, fetchImpl);
  if (categoryIds.length === 0) return [];
  try {
    const url =
      'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search' +
      `?q=${encodeURIComponent(keywords)}` +
      `&category_ids=${categoryIds.join(',')}` +
      '&limit=25';
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { itemSales?: InsightsSale[] };
    const sales = Array.isArray(body?.itemSales) ? body.itemSales : [];
    const solds: EbaySold[] = [];
    for (const item of sales) {
      const priceRaw = item.lastSoldPrice ?? item.price;
      const price = Number(priceRaw?.value);
      const currency =
        typeof priceRaw?.currency === 'string' && priceRaw.currency
          ? priceRaw.currency
          : 'USD';
      const endedAt =
        item.lastSoldDate ?? item.itemEndDate ?? item.soldDate ?? null;
      if (Number.isFinite(price) && price > 0 && endedAt) {
        solds.push({ price, currency, endedAt });
      }
    }
    return solds;
  } catch {
    return [];
  }
}

/** Median of sold prices in MYR sen. Trims top/bottom 10% at 10+ samples. */
export function medianSen(pricesSen: readonly number[]): number | null {
  if (pricesSen.length === 0) return null;
  const sorted = [...pricesSen].sort((a, b) => a - b);
  let window = sorted;
  if (sorted.length >= 10) {
    const cut = Math.floor(sorted.length * 0.1);
    window = sorted.slice(cut, sorted.length - cut);
  }
  const mid = Math.floor(window.length / 2);
  const median =
    window.length % 2 === 1
      ? window[mid]
      : Math.round((window[mid - 1] + window[mid]) / 2);
  return Math.round(median);
}

/** USD-base FX table. Free endpoint, no key. Null on any failure. */
export async function usdBaseRates(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number> | null> {
  try {
    const res = await fetchImpl('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: Record<string, number> };
    const myr = body.rates?.MYR;
    if (typeof myr !== 'number' || myr <= 0 || !body.rates) return null;
    return body.rates;
  } catch {
    return null;
  }
}

/** USD-base FX to MYR. Free endpoint, no key. Null on any failure. */
export async function usdToMyr(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  return (await usdBaseRates(fetchImpl))?.MYR ?? null;
}

/** Listing-currency price to MYR sen through the USD-base table. */
export function toMyrSen(
  price: number,
  currency: string,
  rates: Record<string, number>,
): number | null {
  const myr = rates.MYR;
  const from = rates[currency];
  if (!Number.isFinite(price) || price <= 0 || !(myr > 0) || !(from > 0)) {
    return null;
  }
  return Math.round(((price / from) * myr) * 100);
}

interface FindingItem {
  sellingStatus?: [{ currentPrice?: [{ __value__?: string; '@currencyId'?: string }] }];
  listingInfo?: [{ endTime?: [string] }];
}

/**
 * Recent solds for a keyword query. Insights first (OAuth item_sales,
 * the supported sold-data API), Finding as fallback where it still
 * answers. Returns [] (never throws) when both are unavailable — the cron
 * skips the model and reports it, rather than aborting the batch.
 */
export async function fetchEbaySolds(
  keywords: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbaySold[]> {
  if (certId()) {
    const viaInsights = await fetchInsightsSolds(keywords, fetchImpl);
    if (viaInsights.length > 0) return viaInsights;
  }
  return fetchFindingSolds(keywords, fetchImpl);
}

/**
 * Legacy Finding API path: app-key GET, JSON REST payload. Kept as the
 * fallback — deprecated upstream and edge-blocked (empty 418) from our
 * egress, but costs nothing to attempt where it answers.
 */
export async function fetchFindingSolds(
  keywords: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbaySold[]> {
  const key = appId();
  if (!key) return [];
  try {
    const url =
      'https://svcs.ebay.com/services/search/FindingService/v1' +
      '?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0' +
      `&SECURITY-APPNAME=${encodeURIComponent(key)}` +
      '&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD' +
      `&keywords=${encodeURIComponent(keywords)}` +
      '&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true' +
      '&sortOrder=EndTimeRecent&paginationInput.entriesPerPage=25';
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      findCompletedItemsResponse?: [
        { searchResult?: [{ item?: FindingItem[] }] },
      ];
    };
    const items =
      body.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];
    const solds: EbaySold[] = [];
    for (const item of items) {
      const priceRaw = item.sellingStatus?.[0]?.currentPrice?.[0];
      const price = Number(priceRaw?.__value__);
      const currency = priceRaw?.['@currencyId'] ?? 'USD';
      const endedAt = item.listingInfo?.[0]?.endTime?.[0];
      if (Number.isFinite(price) && price > 0 && endedAt) {
        solds.push({ price, currency, endedAt });
      }
    }
    return solds;
  } catch {
    return [];
  }
}

/**
 * One model's daily comp: median of recent eBay solds in MYR sen.
 * Minimum 3 solds or the model is skipped (a median of 1–2 is noise, not
 * data). Non-USD solds convert through the same USD-base table via USD.
 */export async function compForModel(
  brand: string,
  model: string,
  colorway: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayComps> {
  const query = `${brand} ${model} ${colorway}`.trim();
  const [solds, rates] = await Promise.all([
    fetchEbaySolds(query, fetchImpl),
    usdBaseRates(fetchImpl),
  ]);
  if (solds.length < 3 || rates == null) {
    return {
      query,
      medianSen: null,
      sampleSize: solds.length,
      fxUsed: rates?.MYR ?? null,
    };
  }
  const inSen = solds
    .map((s) => toMyrSen(s.price, s.currency, rates))
    .filter((v): v is number => v != null);
  if (inSen.length < 3) {
    return { query, medianSen: null, sampleSize: solds.length, fxUsed: rates.MYR };
  }
  return {
    query,
    medianSen: medianSen(inSen),
    sampleSize: solds.length,
    fxUsed: rates.MYR,
  };
}

export const EBAY_DELETION_ENDPOINT_DEFAULT =
  'https://flexsoar.net/api/webhooks/ebay-deletion';

/**
 * Marketplace Account Deletion challenge response: SHA-256 hex of
 * challengeCode + verificationToken + endpoint, concatenated in exactly
 * that order (eBay rejects any other order). Node runtime only — the
 * route handler and tests both run server-side.
 */
export function ebayChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string,
): string {
  const hash = createHash('sha256');
  hash.update(challengeCode);
  hash.update(verificationToken);
  hash.update(endpoint);
  return hash.digest('hex');
}
