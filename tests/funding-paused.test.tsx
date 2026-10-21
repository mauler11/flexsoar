/**
 * C10 deploy: wallet funding is paused while payments aren't live.
 *
 * Privy is mocked so every hook RECORDS its call and, by default, throws the
 * way a hook used outside PrivyProvider does. Any render that reaches a Privy
 * hook therefore fails, and `hookCalls` proves no hook mounted at all. A
 * second mode hands back a ready, authenticated Privy session with a spy
 * addFunds, to prove the rail refuses even when Privy itself would allow it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const privy = vi.hoisted(() => ({
  mode: 'no-provider' as 'no-provider' | 'ready',
  hookCalls: [] as string[],
  addFunds: vi.fn(async () => ({ method: 'fiat', status: 'confirmed' })),
  login: vi.fn(),
}));

vi.mock('@privy-io/react-auth', () => {
  function hook<T>(name: string, ready: () => T): () => T {
    return () => {
      privy.hookCalls.push(name);
      if (privy.mode === 'no-provider') {
        throw new Error(`${name} was called outside PrivyProvider`);
      }
      return ready();
    };
  }
  return {
    PrivyProvider: ({ children }: { children: unknown }) => children,
    usePrivy: hook('usePrivy', () => ({
      ready: true,
      authenticated: true,
      login: privy.login,
      logout: vi.fn(),
    })),
    useWallets: hook('useWallets', () => ({ wallets: [] })),
    useAddFunds: hook('useAddFunds', () => ({ addFunds: privy.addFunds })),
  };
});

vi.mock('@privy-io/react-auth/solana', () => ({
  useCreateWallet: () => {
    privy.hookCalls.push('useCreateWallet');
    throw new Error('useCreateWallet was called outside PrivyProvider');
  },
}));

// IntakeWizard imports server actions; ReviewPane never calls them.
vi.mock('@/app/(market)/list/actions', () => ({
  submitListingIntakeAction: vi.fn(),
  getUploadTargetAction: vi.fn(),
  findOrCreateSkuModelAction: vi.fn(),
  searchSkuModelsAction: vi.fn(),
}));

import { FUNDING_AVAILABLE } from '@/lib/db/payment-v2';
import { PAYMENTS_NOT_LIVE, SELLER_PAYOUT_METHOD_LABEL } from '@/app/(market)/payout-copy';
import {
  FundingOptions,
  FundingPausedNotice,
  fundingAvailable,
  useFundRail,
  type FundMode,
} from '@/components/market/FundingOptions';
import {
  WalletDepositPanel,
  WalletMenu,
  WalletWithdrawPanel,
  type BalancesResponse,
} from '@/components/market/WalletMenu';
import { SendDialog } from '@/components/market/SendDialog';
import {
  EmbeddedLinkButton,
  EmbeddedWalletSection,
} from '@/components/market/EmbeddedWalletSection';
import { ReviewPane } from '@/components/market/intake/IntakeWizard';
import type { Sku } from '@/lib/db/types';

const APP_ID = 'NEXT_PUBLIC_PRIVY_APP_ID';
const WALLET = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const linkedBalance: BalancesResponse = {
  wallet: WALLET,
  solLamports: 5_000_000,
  usdcUnits: 12_340_000,
  usdcMint: DEVNET_USDC,
  fx: null,
};

/** No funding rail, sign prompt, or send form may render while paused. */
const LIVE_RAIL_COPY = [
  'Add Funds',
  'Transfer Crypto',
  'Deposit with Card',
  'Send USDC',
  'Withdrawals settle in seconds',
  'Continue with email',
];

function expectPaused(html: string) {
  expect(html).toContain("Payments aren&#x27;t live yet");
  expect(html).toContain(PAYMENTS_NOT_LIVE.replace("'", '&#x27;'));
  for (const copy of LIVE_RAIL_COPY) expect(html).not.toContain(copy);
}

let savedAppId: string | undefined;

beforeEach(() => {
  savedAppId = process.env[APP_ID];
  delete process.env[APP_ID];
  privy.mode = 'no-provider';
  privy.hookCalls.length = 0;
  privy.addFunds.mockClear();
  privy.login.mockClear();
});

afterEach(() => {
  if (savedAppId === undefined) delete process.env[APP_ID];
  else process.env[APP_ID] = savedAppId;
});

describe('funding gate', () => {
  it('is the payments-launch constant, false at C10', () => {
    expect(FUNDING_AVAILABLE).toBe(false);
    expect(fundingAvailable()).toBe(false);
  });

  it('cannot be switched on by configuring the Privy app id', () => {
    process.env[APP_ID] = 'privy-app-under-test';
    expect(fundingAvailable()).toBe(false);
  });
});

describe('paused funding notice', () => {
  it('renders the shared not-live copy and no rail', () => {
    expectPaused(renderToStaticMarkup(<FundingPausedNotice />));
  });

  for (const appId of [undefined, 'privy-app-under-test']) {
    const label = appId ? 'with' : 'without';

    it(`FundingOptions is paused and mounts no Privy hook ${label} an app id`, () => {
      if (appId) process.env[APP_ID] = appId;
      expectPaused(renderToStaticMarkup(<FundingOptions address={WALLET} />));
      expect(privy.hookCalls).toEqual([]);
      expect(privy.addFunds).not.toHaveBeenCalled();
    });

    it(`wallet Deposit tab is paused for a linked wallet ${label} an app id`, () => {
      if (appId) process.env[APP_ID] = appId;
      const html = renderToStaticMarkup(<WalletDepositPanel balance={linkedBalance} />);
      expectPaused(html);
      expect(html).toContain('12.34');
      expect(privy.hookCalls).toEqual([]);
    });

    it(`wallet Withdraw tab is paused for a linked wallet ${label} an app id`, () => {
      if (appId) process.env[APP_ID] = appId;
      const html = renderToStaticMarkup(
        <WalletWithdrawPanel balance={linkedBalance} onDone={() => {}} />,
      );
      expectPaused(html);
      expect(privy.hookCalls).toEqual([]);
    });

    it(`SendDialog is paused and never mounts its signing path ${label} an app id`, () => {
      if (appId) process.env[APP_ID] = appId;
      const html = renderToStaticMarkup(
        <SendDialog
          walletAddress={WALLET}
          usdcMint={DEVNET_USDC}
          usdcUnits={linkedBalance.usdcUnits}
          onClose={() => {}}
        />,
      );
      expectPaused(html);
      expect(html).not.toContain('To address');
      expect(privy.hookCalls).toEqual([]);
    });
  }
});

describe('useFundRail cannot reach addFunds while funding is unavailable', () => {
  function captureRail(): ReturnType<typeof useFundRail> {
    const captured: { rail: ReturnType<typeof useFundRail> | null } = { rail: null };
    function Probe() {
      captured.rail = useFundRail(WALLET);
      return null;
    }
    renderToStaticMarkup(<Probe />);
    if (!captured.rail) throw new Error('probe did not render');
    return captured.rail;
  }

  for (const mode of ['all', 'fiat', 'crypto'] as FundMode[]) {
    it(`start("${mode}") refuses even with a ready, authenticated Privy session`, async () => {
      process.env[APP_ID] = 'privy-app-under-test';
      privy.mode = 'ready';
      const rail = captureRail();
      expect(rail.ready).toBe(true);
      await rail.start(mode);
      expect(privy.addFunds).not.toHaveBeenCalled();
      expect(privy.login).not.toHaveBeenCalled();
    });
  }
});

describe('wallet components render without the Privy provider', () => {
  it('WalletMenu renders its trigger', () => {
    const html = renderToStaticMarkup(<WalletMenu />);
    expect(html).toContain('Wallet');
    expect(privy.hookCalls).toEqual([]);
  });

  it('Deposit tab for an unlinked account shows the notice and the unavailable-link note', () => {
    const html = renderToStaticMarkup(<WalletDepositPanel balance={null} />);
    expectPaused(html);
    expect(html).toContain('Wallet linking is unavailable');
    expect(privy.hookCalls).toEqual([]);
  });

  it('Withdraw tab for an unlinked account shows the notice only', () => {
    const html = renderToStaticMarkup(
      <WalletWithdrawPanel balance={null} onDone={() => {}} />,
    );
    expectPaused(html);
    expect(privy.hookCalls).toEqual([]);
  });

  it('EmbeddedWalletSection renders nothing', () => {
    expect(renderToStaticMarkup(<EmbeddedWalletSection />)).toBe('');
    expect(privy.hookCalls).toEqual([]);
  });

  it('EmbeddedLinkButton renders the unavailable note', () => {
    const html = renderToStaticMarkup(<EmbeddedLinkButton cta="Link wallet" />);
    expect(html).toContain('Wallet linking is unavailable');
    expect(html).not.toContain('Link wallet</button>');
    expect(privy.hookCalls).toEqual([]);
  });
});

describe('intake wizard review copy', () => {
  const sku: Sku = {
    id: '00000000-0000-0000-0000-000000000001',
    brand: 'Nike',
    model: 'Air Jordan 1',
    colorway: 'Chicago',
    size_us: 10.5,
    retail_price_cents: 75_000,
    market_price_cents: 120_000,
    price_confidence: null,
    priced_at: null,
    demand_score: 0,
    sprite_key: null,
    palette: null,
    mint_cap: null,
    created_at: '2026-10-21T00:00:00Z',
  };

  function review(payout: 'cash' | 'credit'): string {
    return renderToStaticMarkup(
      <ReviewPane
        sku={sku}
        photos={[]}
        declaredFloat={0.123}
        priceCents={150_000}
        payout={payout}
        countryCode="MY"
        notes=""
        onNotesChange={() => {}}
        error={null}
        isNewModel={false}
        isUnpricedModel={false}
      />,
    );
  }

  it('labels the payout with the shared USDC string and the not-live line', () => {
    const html = review('cash');
    expect(html).toContain(`>${SELLER_PAYOUT_METHOD_LABEL}<`);
    expect(html).toContain(PAYMENTS_NOT_LIVE.replace("'", '&#x27;'));
  });

  for (const payout of ['cash', 'credit'] as const) {
    it(`says nothing about cash, credit, bank or buy now (payout=${payout})`, () => {
      const html = review(payout);
      expect(html).not.toMatch(/\bcash\b|\bcredit\b|\bbank\b|buy now/i);
    });
  }
});

describe('vercel.json', () => {
  it('schedules no cron jobs for this launch', () => {
    const config: unknown = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', 'vercel.json'), 'utf8'),
    );
    expect(config).toEqual({ $schema: 'https://openapi.vercel.sh/vercel.json' });
  });
});
