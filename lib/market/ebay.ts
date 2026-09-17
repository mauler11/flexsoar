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
 */

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
 * Recent solds for a keyword query. Returns [] (never throws) when the key
 * is missing, eBay errors, or the shape is unexpected — the cron skips the
 * model and reports it, rather than aborting the batch.
 */
export async function fetchEbaySolds(
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
 */
export async function compForModel(
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
