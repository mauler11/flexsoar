/**
 * lib/solana/config.ts
 *
 * Single home for Solana chain configuration. The mint, RPC URL, treasury,
 * and trade cap used to be copy-pasted across the quote / build-tx / settle
 * routes — that duplication is how a redeploy once shipped a program whose
 * hardcoded mint disagreed with the verifier's env mint (every buy failing
 * on-chain with WrongMint). One function each, imported everywhere.
 */

/** USDC mint for the active cluster. Env wins, cluster default otherwise. */
export function usdcMint(): string {
  const configured = process.env['SOLANA_USDC_MINT']?.trim();
  if (configured) return configured;
  return (process.env['SOLANA_CLUSTER'] ?? 'devnet') === 'mainnet-beta'
    ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    : '4zMMC9srt5Ri5X14GAgXhaHii3L6VUHdfBMqBGE3ter';
}

/** Helius RPC URL. Throws — a missing key must fail loudly, never silently. */
export function rpcUrl(): string {
  const key = process.env['HELIUS_API_KEY'];
  if (!key) {
    throw new Error(
      'HELIUS_API_KEY is not set. Add it to .env.local — see DEPS.md.',
    );
  }
  const cluster = process.env['SOLANA_CLUSTER'] ?? 'devnet';
  const host =
    cluster === 'mainnet-beta'
      ? 'https://mainnet.helius-rpc.com'
      : 'https://devnet.helius-rpc.com';
  return `${host}/?api-key=${key}`;
}

/** Fee sink, or null when unconfigured (build-tx/settle refuse without it). */
export function treasuryAddress(): string | null {
  return process.env['SOLANA_TREASURY']?.trim() || null;
}

/** Pre-audit per-trade cap, USDC base units. Mirrors MAX_PRICE_BASE_UNITS. */
export function maxTradeUnits(): number {
  const raw = Number(process.env['SOLANA_MAX_TRADE_UNITS'] ?? 500_000_000);
  return Number.isInteger(raw) && raw > 0 ? raw : 500_000_000;
}
