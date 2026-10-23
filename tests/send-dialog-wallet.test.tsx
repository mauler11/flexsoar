/**
 * MW1: SendDialog finds its signing wallet through the SOLANA hook and the shared detector, and waits for Privy + wallets readiness.
 * The funding gate is NOT touched: FUNDING_AVAILABLE is mocked true here only to reach the inner dialog; tests/funding-paused.test.tsx
 * keeps proving the real constant is false and the dialog paused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const SOL = '6J88dRi3T5465bcntkrSWyT3o3bfM7Zd2KNMFPgUFoue';
const OTHER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const privy = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  walletsReady: true,
  solanaWallets: [] as unknown[],
  rootWalletsCalls: 0,
}));

vi.mock('@/lib/db/payment-v2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/payment-v2')>()),
  FUNDING_AVAILABLE: true,
}));
vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: privy.ready, authenticated: privy.authenticated }),
  useWallets: () => {
    privy.rootWalletsCalls += 1;
    return { ready: true, wallets: [] };
  },
}));
vi.mock('@privy-io/react-auth/solana', () => ({
  useWallets: () => ({ ready: privy.walletsReady, wallets: privy.solanaWallets }),
}));

import { SendDialog } from '@/components/market/SendDialog';

class FakeSolanaWallet {
  constructor(private readonly addr: string) {}
  get address() { return this.addr; }
  async signMessage() { return { signature: new Uint8Array(64) }; }
  async signAndSendTransaction() { return { signature: new Uint8Array(64) }; }
}
const evm = { chainType: 'ethereum', address: '0x1111111111111111111111111111111111111111', signMessage: async () => ({}) };

function render(): string {
  return renderToStaticMarkup(
    <SendDialog walletAddress={SOL} usdcMint={DEVNET_USDC} usdcUnits={5_000_000} onClose={() => {}} />,
  );
}

let savedAppId: string | undefined;
beforeEach(() => {
  savedAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'privy-app-under-test';
  Object.assign(privy, { ready: true, authenticated: true, walletsReady: true, solanaWallets: [], rootWalletsCalls: 0 });
});
afterEach(() => {
  if (savedAppId === undefined) delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  else process.env.NEXT_PUBLIC_PRIVY_APP_ID = savedAppId;
});

describe('SendDialog wallet detection (MW1)', () => {
  it('wallet present: the Send button is enabled', () => {
    privy.solanaWallets = [new FakeSolanaWallet(SOL)];
    const html = render();
    expect(html).toContain('To address');
    expect(html).toMatch(/<button[^>]*>Send<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Send<\/button>/);
    expect(privy.rootWalletsCalls).toBe(0);
  });

  it('wallets list not ready: Send is disabled and says Preparing', () => {
    privy.walletsReady = false;
    privy.solanaWallets = [new FakeSolanaWallet(SOL)];
    const html = render();
    expect(html).toContain('Preparing wallet…');
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Preparing wallet…<\/button>/);
  });

  it('Privy not ready: Send is disabled and says Preparing', () => {
    privy.ready = false;
    expect(render()).toContain('Preparing wallet…');
  });

  it('EVM-only wallets: the dialog renders, Send is enabled so the sign-in error can show on click, and no wallet is invented', () => {
    privy.solanaWallets = [evm];
    const html = render();
    expect(html).not.toContain('Preparing wallet…');
    expect(html).toContain('>Send<');
  });

  it('a Solana wallet at a different address does not satisfy the dialog (detector is address-scoped)', () => {
    privy.solanaWallets = [new FakeSolanaWallet(OTHER)];
    const html = render();
    expect(html).not.toContain('Preparing wallet…');
  });
});
