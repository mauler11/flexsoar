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
