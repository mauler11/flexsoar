/**
 * MW1: EmbeddedWalletSection / EmbeddedLinkButton read Solana wallets from the SOLANA hook ("@privy-io/react-auth/solana"), through the
 * shared detector. The package-root useWallets() returns Ethereum wallets only, so a mock of it here deliberately holds a Solana wallet
 * the components must never see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const SOL = '6J88dRi3T5465bcntkrSWyT3o3bfM7Zd2KNMFPgUFoue';

const privy = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  walletsReady: true,
  solanaWallets: [] as unknown[],
  rootWallets: [] as unknown[],
  rootWalletsCalls: 0,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: privy.ready, authenticated: privy.authenticated, login: () => {}, logout: () => {} }),
  useWallets: () => {
    privy.rootWalletsCalls += 1;
    return { ready: true, wallets: privy.rootWallets };
  },
}));
vi.mock('@privy-io/react-auth/solana', () => ({
  useWallets: () => ({ ready: privy.walletsReady, wallets: privy.solanaWallets }),
  useCreateWallet: () => ({ createWallet: async () => {} }),
}));

import { EmbeddedLinkButton, EmbeddedWalletSection } from '@/components/market/EmbeddedWalletSection';

// Mirrors ConnectedStandardSolanaWallet: address is a prototype getter, no chainType field.
class FakeSolanaWallet {
  get address() { return SOL; }
  async signMessage() { return { signature: new Uint8Array(64) }; }
}
const evm = { chainType: 'ethereum', address: '0x1111111111111111111111111111111111111111', signMessage: async () => ({}) };

let savedAppId: string | undefined;
beforeEach(() => {
  savedAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'privy-app-under-test';
  Object.assign(privy, { ready: true, authenticated: true, walletsReady: true, solanaWallets: [], rootWallets: [], rootWalletsCalls: 0 });
});
afterEach(() => {
  if (savedAppId === undefined) delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  else process.env.NEXT_PUBLIC_PRIVY_APP_ID = savedAppId;
});

describe('EmbeddedWalletSection (MW1)', () => {
  it('shows the Solana wallet and the link button when the Solana hook holds one', () => {
    privy.solanaWallets = [new FakeSolanaWallet()];
    const html = renderToStaticMarkup(<EmbeddedWalletSection />);
    expect(html).toContain('6J88dRi3');
    expect(html).toContain('Link embedded wallet');
    expect(html).not.toContain('no Solana wallet');
  });

  it('does not read the package-root useWallets (a Solana wallet there would be ignored)', () => {
    privy.rootWallets = [new FakeSolanaWallet()];
    const html = renderToStaticMarkup(<EmbeddedWalletSection />);
    expect(privy.rootWalletsCalls).toBe(0);
    expect(html).toContain('no Solana wallet');
  });

  it('says "Preparing" and never "no wallet" while Privy is not ready', () => {
    privy.ready = false;
    const html = renderToStaticMarkup(<EmbeddedWalletSection />);
    expect(html).toContain('Preparing embedded wallets');
    expect(html).not.toContain('no Solana wallet');
  });

  it('says "Preparing" and never "no wallet" while the wallets list is not ready', () => {
    privy.walletsReady = false;
    const html = renderToStaticMarkup(<EmbeddedWalletSection />);
    expect(html).toContain('Preparing embedded wallets');
    expect(html).not.toContain('no Solana wallet');
    expect(html).not.toContain('Create FlexSoar wallet');
  });

  it('offers login when signed out', () => {
    privy.authenticated = false;
    expect(renderToStaticMarkup(<EmbeddedWalletSection />)).toContain('Continue with email');
  });

  it('EVM-only wallets: reports no Solana wallet and offers to create one', () => {
    privy.solanaWallets = [evm];
    const html = renderToStaticMarkup(<EmbeddedWalletSection />);
    expect(html).toContain('no Solana wallet');
    expect(html).toContain('Create FlexSoar wallet');
    expect(html).not.toContain('Link embedded wallet');
  });
});

describe('EmbeddedLinkButton (MW1)', () => {
  const props = { cta: 'Link wallet' };

  it('wallet present: renders the link button, not the missing state', () => {
    privy.solanaWallets = [new FakeSolanaWallet()];
    const html = renderToStaticMarkup(<EmbeddedLinkButton {...props} />);
    expect(html).toContain('Link wallet');
    expect(html).not.toContain('no Solana wallet');
  });

  it('not ready (Privy or wallets list): preparing, never "no wallet"', () => {
    privy.walletsReady = false;
    let html = renderToStaticMarkup(<EmbeddedLinkButton {...props} />);
    expect(html).toContain('Preparing wallet');
    expect(html).not.toContain('no Solana wallet');
    privy.walletsReady = true;
    privy.ready = false;
    html = renderToStaticMarkup(<EmbeddedLinkButton {...props} />);
    expect(html).toContain('Preparing wallet');
    expect(html).not.toContain('no Solana wallet');
  });

  it('EVM-only: missing state with an inventory that shows only what the Solana hook returned', () => {
    privy.solanaWallets = [evm];
    const html = renderToStaticMarkup(<EmbeddedLinkButton {...props} />);
    expect(html).toContain('no Solana wallet');
    expect(html).toContain('Create FlexSoar wallet');
    expect(html).toContain('ethereum/0x11…1111');
  });

  it('empty Solana list once ready: missing, inventory "none"', () => {
    const html = renderToStaticMarkup(<EmbeddedLinkButton {...props} />);
    expect(html).toContain('no Solana wallet');
    expect(html).toContain('session wallets: none');
  });
});
