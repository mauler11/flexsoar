import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { GridSkeleton, TileSkeleton } from '@/components/market/MarketSkeleton';
import { RarityBand } from '@/components/card/RarityBand';
import { borderColorFor } from '@/lib/domain/rarity';

vi.mock('@/lib/api/contract', () => ({
  getListings: vi.fn(async () => []),
  getPlatformConfig: vi.fn(async () => ({ show_numeric_float: false })),
}));

import {
  cachedListings,
  cachedPlatformConfig,
  clearMarketCaches,
} from '@/app/(market)/market/cached';
import { getListings, getPlatformConfig } from '@/lib/api/contract';

describe('market skeletons', () => {
  it('TileSkeleton renders pulse placeholders, no listing data', () => {
    const html = renderToStaticMarkup(createElement(TileSkeleton));
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('Buy Now');
  });

  it('GridSkeleton renders twelve tiles on the market grid classes', () => {
    const html = renderToStaticMarkup(createElement(GridSkeleton));
    const tiles = html.match(/aspect-\[4\/3\]/g) ?? [];
    expect(tiles).toHaveLength(12);
    expect(html).toContain('grid-cols-2');
  });
});

describe('rarity band', () => {
  it('renders the tier colour band, agreeing with TierBadge', () => {
    const html = renderToStaticMarkup(
      createElement(RarityBand, { tier: 5 }),
    );
    expect(html).toContain(borderColorFor(5));
  });

  it('exceptional renders red, like TierBadge', () => {
    const html = renderToStaticMarkup(
      createElement(RarityBand, { tier: 2, isExceptional: true }),
    );
    expect(html).toContain(borderColorFor(2, true));
    expect(html).toContain('#FF4444');
  });
});

describe('market cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.mocked(getListings).mockClear();
    vi.mocked(getPlatformConfig).mockClear();
    clearMarketCaches();
  });

  // Never leak fake timers/Date into other test files sharing a worker.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves repeat identical queries from cache', async () => {
    const query = { sort: 'recent' } as const;
    await cachedListings('anon', { ...query });
    await cachedListings('anon', { ...query });
    expect(vi.mocked(getListings)).toHaveBeenCalledTimes(1);
  });

  it('isolates viewers: anon and a user never share entries', async () => {
    const query = { sort: 'recent' } as const;
    await cachedListings('anon', { ...query });
    await cachedListings('user-123', { ...query });
    expect(vi.mocked(getListings)).toHaveBeenCalledTimes(2);
  });

  it('refetches after the 30s listings TTL', async () => {
    const query = { sort: 'recent' } as const;
    await cachedListings('anon', { ...query });
    vi.setSystemTime(1_000_000 + 31_000);
    await cachedListings('anon', { ...query });
    expect(vi.mocked(getListings)).toHaveBeenCalledTimes(2);
  });

  it('caches platform config globally across viewers', async () => {
    await cachedPlatformConfig();
    await cachedPlatformConfig();
    expect(vi.mocked(getPlatformConfig)).toHaveBeenCalledTimes(1);
  });
});
