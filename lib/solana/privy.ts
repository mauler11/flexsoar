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

/** Target chain for embedded sends. Devnet until mainnet launch. */
export const SOLANA_CHAIN = 'solana:devnet';

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
