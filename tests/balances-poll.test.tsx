import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EffectCallback } from 'react';

const harness = vi.hoisted(() => ({
  funding: false,
  effects: [] as EffectCallback[],
}));

// Run the real components' effect callbacks explicitly: server rendering alone
// would never execute effects and could falsely pass the no-fetch regression.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useEffect: (effect: EffectCallback) => { harness.effects.push(effect); },
    // Open WalletMenu on its first render; all other initial state is preserved.
    useState: (initial: unknown) => react.useState(initial === false ? true : initial),
  };
});
vi.mock('@/lib/db/payment-v2', () => ({
  get FUNDING_AVAILABLE() { return harness.funding; },
}));
vi.mock('@/components/market/Fiat', () => ({ useFiat: () => ({ balanceCode: 'USDC' }) }));
vi.mock('@/components/market/Modal', () => ({ Modal: () => null }));
vi.mock('@/components/market/EmbeddedWalletSection', () => ({ EmbeddedLinkButton: () => null }));
vi.mock('@/components/market/FundingOptions', () => ({
  fundingAvailable: () => harness.funding,
  FundingPausedNotice: () => null,
  useFundRail: vi.fn(),
}));
vi.mock('@/components/market/SendDialog', () => ({ SendDialog: () => null }));

import { WalletBalance } from '@/components/market/WalletBalance';
import { WalletMenu } from '@/components/market/WalletMenu';

const fetchMock = vi.fn<typeof fetch>();
const cleanups: (() => void)[] = [];
function runEffect(effect: EffectCallback) {
  const cleanup = effect();
  if (cleanup) cleanups.push(cleanup);
  return cleanup;
}
function mount(Component: typeof WalletBalance | typeof WalletMenu) {
  renderToStaticMarkup(<Component />);
  expect(harness.effects).toHaveLength(1);
  const effect = harness.effects[0];
  return { effect, cleanup: runEffect(effect) };
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.funding = true;
  harness.effects.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

for (const Component of [WalletBalance, WalletMenu]) {
  describe(Component.name, () => {
    it('does not fetch or schedule polling when funding is off', async () => {
      harness.funding = false;
      mount(Component);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    for (const status of [501, 503]) {
      it(`fetches once then stops on ${status}, including later effect setup`, async () => {
        fetchMock.mockResolvedValue(new Response(null, { status }));
        const mounted = mount(Component);
        await vi.advanceTimersByTimeAsync(180_000);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/solana/balances');
        expect(vi.getTimerCount()).toBe(0);
        // Reopening the menu reruns this effect with the same component ref.
        mounted.cleanup?.();
        runEffect(mounted.effect);
        await vi.advanceTimersByTimeAsync(180_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    }
  });
}

it('keeps the minute refresh when balances are available and cleans up on unmount', async () => {
  fetchMock.mockImplementation(async () => Response.json({ usdcUnits: 1_000_000 }));
  const mounted = mount(WalletBalance);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  mounted.cleanup?.();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('continues the existing retry behaviour for other failures', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
  mount(WalletBalance);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
