/**
 * lib/solana/privy-wallet-detect.ts
 *
 * Decides, from the state of Privy's SOLANA hooks, whether the logged-in user has an embedded Solana wallet. Zero Privy imports: it takes
 * `unknown` and narrows structurally, like lib/solana/privy.ts, so it is offline-testable.
 *
 * Why it exists (PP1): the package root's `useWallets()` returns Ethereum `ConnectedWallet`s only. A Solana embedded wallet appears
 * solely in `useWallets()` from "@privy-io/react-auth/solana" (class `ConnectedStandardSolanaWallet`), whose instances carry NO
 * `chainType` field, so lib/solana/privy.ts `asSolanaSigningWallet` (which requires chainType === "solana") cannot match them either.
 * "Missing" must also never be decided before BOTH Privy and the wallets list are ready.
 */
import { base58Decode } from './base58';

/** What the proof page needs from a Solana wallet: its address and the standard signMessage shape ({ message } only). */
export interface SolanaProofWallet {
  address: string;
  signMessage: (input: { message: Uint8Array }) => Promise<unknown>;
}

export type SolanaWalletDetection =
  | { status: 'waiting' }
  | { status: 'signed-out' }
  | { status: 'missing'; seen: string[] }
  | { status: 'found'; wallet: SolanaProofWallet; address: string };

export interface DetectionInput {
  /** usePrivy().ready */
  privyReady: boolean;
  /** useWallets().ready from "@privy-io/react-auth/solana" */
  walletsReady: boolean;
  /** usePrivy().authenticated */
  authenticated: boolean;
  /** useWallets().wallets from "@privy-io/react-auth/solana" */
  wallets: readonly unknown[];
}

function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try { return base58Decode(value).length === 32; } catch { return false; }
}

/** A Solana signing wallet: base58 32-byte address, a signMessage function, and (if it declares one) chainType "solana". */
export function isSolanaProofWallet(candidate: unknown): candidate is SolanaProofWallet {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const record = candidate as Record<string, unknown>; // `address` is a prototype getter on Privy's class: plain property access works
  if (record['chainType'] !== undefined && record['chainType'] !== 'solana') return false;
  return isSolanaAddress(record['address']) && typeof record['signMessage'] === 'function';
}

/** Short diagnostic for a wallet the list returned but we did not accept: chain/address, never anything secret. */
export function describeWallet(candidate: unknown): string {
  if (typeof candidate !== 'object' || candidate === null) return 'unknown';
  const record = candidate as Record<string, unknown>;
  const chain = typeof record['chainType'] === 'string' ? record['chainType'] : '?';
  const address = typeof record['address'] === 'string' && record['address'].length > 10 ? `${record['address'].slice(0, 4)}…${record['address'].slice(-4)}` : '?';
  return `${chain}/${address}`;
}

export function detectSolanaWallet(input: DetectionInput): SolanaWalletDetection {
  if (!input.privyReady || !input.walletsReady) return { status: 'waiting' };
  if (!input.authenticated) return { status: 'signed-out' };
  for (const candidate of input.wallets) {
    if (isSolanaProofWallet(candidate)) return { status: 'found', wallet: candidate, address: candidate.address };
  }
  return { status: 'missing', seen: input.wallets.map(describeWallet) };
}
