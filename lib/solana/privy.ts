/**
 * lib/solana/privy.ts
 *
 * Runtime adapters for Privy embedded Solana wallets. Zero Privy imports:
 * every function takes `unknown` and narrows it structurally, so this
 * module is offline-testable and can never drift with the SDK's types.
 * Verified against @privy-io/react-auth 3.42.0's own .d.ts:
 * signMessage/signAndSendTransaction resolve `{ signature: Uint8Array }`.
 *
 * The buy chain is `solana:devnet` until the mainnet checklist flips it —
 * same single place as the program's feature flag.
 */

import { base58Decode } from './base58';

/**
 * Buy chain is `solana:devnet` until the mainnet checklist flips it —
 * same single place as the program's feature flag.
 *
 * Env-driven so local dev stays on devnet while prod signs mainnet:
 * set NEXT_PUBLIC_SOLANA_CHAIN=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
 * (CAIP-2 mainnet id, same value as FUNDING_CHAIN) in Vercel.
 *
 * MUST agree with server-side SOLANA_CLUSTER (config.ts): devnet const
 * with a mainnet cluster (or vice versa) means the wallet signs for one
 * chain while quote/settle verify the other — every buy fails, or worse.
 */
export const SOLANA_CHAIN =
  process.env.NEXT_PUBLIC_SOLANA_CHAIN?.trim() || 'solana:devnet';

/**
 * Public (keyless) RPC for client-side broadcast, derived from the same
 * chain const above — never the Helius key (server-only). Used only by
 * the injected-wallet path, which signs locally and must broadcast
 * itself (Privy's embedded wallets broadcast over their own connection).
 * Mainnet public RPC is rate-limited; fine for rehearsal-scale buys.
 */
export function publicRpcUrl(): string {
  return SOLANA_CHAIN === 'solana:devnet'
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';
}

/**
 * Injected Solana provider (Phantom and wallet-standard extensions)
 * narrowed structurally — same unknown-and-narrow discipline as the
 * Privy adapters above. Only what the buy flow needs: an optional
 * connect, the current account, and sign-only (we broadcast ourselves
 * over publicRpcUrl so the transaction lands on OUR cluster even if the
 * extension is pointed elsewhere).
 */
export interface InjectedSolanaSigner {
  /** Base58 account, or '' when locked / never connected. */
  publicKeyText: string;
  connect: () => Promise<unknown>;
  signTransaction: (tx: unknown) => Promise<unknown>;
}

export function getInjectedSolana(): unknown {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, unknown>)["solana"] ?? null;
}

export function asInjectedSolanaSigner(candidate: unknown): InjectedSolanaSigner | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record['signTransaction'] !== 'function') return null;
  const pk = record['publicKey'];
  let text = '';
  if (typeof pk === 'string' && pk.length > 0) {
    text = pk;
  } else if (pk !== null && typeof pk === 'object') {
    const toBase58 = (pk as Record<string, unknown>)['toBase58'];
    if (typeof toBase58 === 'function') {
      try {
        const out = (toBase58 as () => unknown).call(pk);
        if (typeof out === 'string') text = out;
      } catch {
        text = '';
      }
    }
  }
  return {
    publicKeyText: text,
    connect:
      typeof record['connect'] === 'function'
        ? (record['connect'] as () => Promise<unknown>)
        : async () => {},
    signTransaction: record['signTransaction'] as (tx: unknown) => Promise<unknown>,
  };
}

/**
 * Parked Privy funding rails (method-picker deposits + card on-ramp).
 * Nothing below runs unless NEXT_PUBLIC_ENABLE_PRIVY_CHECKOUT === '1':
 * the current buy/deposit flows stay live until funding proves in sandbox.
 */
export function isPrivyCheckoutEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_PRIVY_CHECKOUT === '1';
}

/**
 * On-ramp destination: Solana mainnet USDC. Providers do not deliver to
 * testnets (Stripe's sandbox runs against mainnet chain IDs with play
 * money), so funding targets mainnet even while trading proves on devnet —
 * the address is identical on both clusters, only the funds' reality
 * differs. Flip PRIVY_FUNDING_ENV to production at launch.
 */
export const FUNDING_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const FUNDING_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const FUNDING_ENV =
  process.env.NEXT_PUBLIC_PRIVY_FUNDING_ENV === 'production' ? 'production' : 'sandbox';
/** Base fiat coverage (no setup). MYR arrives with the Meld KYB. */
export const FUNDING_FIAT_ASSETS = ['usd', 'eur'] as const;

/** A Solana wallet speaking the wallet-standard method shapes. */
export interface StandardSolanaWallet {
  address: string;
  signAndSendTransaction: (args: {
    chain: string;
    transaction: Uint8Array;
    address: string;
  }) => Promise<unknown>;
  signMessage: (args: {
    message: Uint8Array;
    address: string;
  }) => Promise<unknown>;
}

/** Narrow an unknown useWallets() entry to a Solana signing wallet. */
export function asSolanaSigningWallet(candidate: unknown): StandardSolanaWallet | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  if (record['chainType'] !== 'solana') return null;
  if (typeof record['address'] !== 'string') return null;
  if (
    typeof record['signAndSendTransaction'] !== 'function' ||
    typeof record['signMessage'] !== 'function'
  ) {
    return null;
  }
  return candidate as StandardSolanaWallet;
}

/** First Solana signing wallet in the list, or null. */
export function firstSolanaWallet(wallets: readonly unknown[]): StandardSolanaWallet | null {
  for (const candidate of wallets) {
    const wallet = asSolanaSigningWallet(candidate);
    if (wallet) return wallet;
  }
  return null;
}

/** Solana signing wallet for one address, or null (buyer must sign). */
export function walletForAddress(
  wallets: readonly unknown[],
  address: string,
): StandardSolanaWallet | null {
  for (const candidate of wallets) {
    const wallet = asSolanaSigningWallet(candidate);
    if (wallet && wallet.address === address) return wallet;
  }
  return null;
}

/**
 * Pull signature BYTES out of whatever a wallet resolved: raw bytes, a
 * base58 string, or `{ signature }` holding either. Null when unusable —
 * callers fail loudly instead of settling a malformed signature.
 */
export function extractSignatureBytes(result: unknown): Uint8Array | null {
  if (result instanceof Uint8Array) return result;
  if (typeof result === 'string') {
    try {
      return base58Decode(result);
    } catch {
      return null;
    }
  }
  if (typeof result === 'object' && result !== null) {
    const inner = (result as Record<string, unknown>)['signature'];
    if (inner instanceof Uint8Array) return inner;
    if (typeof inner === 'string') {
      try {
        return base58Decode(inner);
      } catch {
        return null;
      }
    }
  }
  return null;
}
