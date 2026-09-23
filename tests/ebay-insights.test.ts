import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearEbayCaches,
  fetchEbaySolds,
  fetchInsightsSolds,
  getEbayAppToken,
  sneakerCategoryIds,
} from '@/lib/market/ebay';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  clearEbayCaches();
  vi.stubEnv('EBAY_APP_ID', 'test-app-id');
  vi.stubEnv('EBAY_CERT_ID', 'test-cert-id');
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearEbayCaches();
});

describe('ebay app token', () => {
  it('returns null without a cert id', async () => {
    vi.stubEnv('EBAY_CERT_ID', '');
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    expect(await getEbayAppToken(fetchImpl as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caches the token until near expiry', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'tok123', expires_in: 7200 }),
    );
    expect(await getEbayAppToken(fetchImpl as typeof fetch)).toBe('tok123');
    expect(await getEbayAppToken(fetchImpl as typeof fetch)).toBe('tok123');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null when eBay refuses (unapproved scope)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'denied' }, false));
    expect(await getEbayAppToken(fetchImpl as typeof fetch)).toBeNull();
  });
});

describe('sneaker categories', () => {
  it('keeps athletic categories, max four', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        categorySuggestions: {
          categoryTreeNode: [
            { category: { categoryId: '1', categoryName: "Men's Athletic Shoes" } },
            { category: { categoryId: '2', categoryName: "Women's Athletic Shoes" } },
            { category: { categoryId: '3', categoryName: 'Handbags' } },
            { category: { categoryId: '4', categoryName: 'Athletic Socks' } },
            { category: { categoryId: '5', categoryName: 'Kids Athletic Shoes' } },
            { category: { categoryId: '6', categoryName: 'Athletic Shorts' } },
          ],
        },
      }),
    );
    expect(await sneakerCategoryIds('tok', fetchImpl as typeof fetch)).toEqual([
      '1',
      '2',
      '4',
      '5',
    ]);
  });
});

describe('insights solds', () => {
  function impl() {
    return vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/identity/v1/oauth2/token')) {
        return jsonResponse({ access_token: 'tok', expires_in: 7200 });
      }
      if (u.includes('get_category_suggestions')) {
        return jsonResponse({
          categorySuggestions: {
            categoryTreeNode: [
              { category: { categoryId: '9', categoryName: 'Athletic Shoes' } },
            ],
          },
        });
      }
      return jsonResponse({
        itemSales: [
          {
            lastSoldPrice: { value: '120.00', currency: 'USD' },
            lastSoldDate: '2026-09-01T00:00:00.000Z',
          },
          {
            price: { value: '99.99', currency: 'USD' },
            itemEndDate: '2026-09-02T00:00:00.000Z',
          },
          { lastSoldPrice: { value: 'junk', currency: 'USD' }, lastSoldDate: 'x' },
          { lastSoldPrice: { value: '50', currency: 'USD' } },
        ],
      });
    });
  }

  it('maps prices and dates, drops malformed rows', async () => {
    const solds = await fetchInsightsSolds('nike', impl() as typeof fetch);
    expect(solds).toEqual([
      { price: 120, currency: 'USD', endedAt: '2026-09-01T00:00:00.000Z' },
      { price: 99.99, currency: 'USD', endedAt: '2026-09-02T00:00:00.000Z' },
    ]);
  });

  it('fetchEbaySolds prefers insights, falls back to finding', async () => {
    const finding = {
      findCompletedItemsResponse: [
        {
          searchResult: [
            {
              item: [
                {
                  sellingStatus: [{ currentPrice: [{ __value__: '80', '@currencyId': 'USD' }] }],
                  listingInfo: [{ endTime: ['2026-09-03T00:00:00.000Z'] }],
                },
              ],
            },
          ],
        },
      ],
    };
    // Insights healthy → finding never called.
    const healthy = impl();
    const via = await fetchEbaySolds('nike', healthy as typeof fetch);
    expect(via).toHaveLength(2);
    expect(
      (healthy as ReturnType<typeof vi.fn>).mock.calls.some((c: unknown[]) =>
        String(c[0]).includes('FindingService'),
      ),
    ).toBe(false);

    // Insights denied → finding fallback serves.
    clearEbayCaches();
    const denied = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/identity/v1/oauth2/token')) {
        return jsonResponse({ error: 'denied' }, false);
      }
      if (u.includes('FindingService')) return jsonResponse(finding);
      return jsonResponse({}, false);
    });
    const fallback = await fetchEbaySolds('nike', denied as typeof fetch);
    expect(fallback).toEqual([
      { price: 80, currency: 'USD', endedAt: '2026-09-03T00:00:00.000Z' },
    ]);
  });
});
