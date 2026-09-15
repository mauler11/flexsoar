/**
 * lib/solana/balances.ts
 *
 * Pure parsing for the read-only balance display: SOL lamports from
 * getBalance, summed USDC base units from getTokenAccountsByOwner
 * (jsonParsed). No RPC calls here — the route injects fetch, tests inject
 * fixtures. Mint-checked per account: a stray non-USDC account in the
 * response is skipped, never counted.
 */

interface TokenAmountInfo {
  mint?: string;
  tokenAmount?: { amount?: string; decimals?: number };
}

interface TokenAccountEntry {
  account?: {
    data?: {
      parsed?: { info?: TokenAmountInfo };
    };
  };
}

/** Sum USDC base units across parsed token accounts, mint-filtered. */
export function sumUsdcUnits(
  accounts: readonly TokenAccountEntry[],
  usdcMint: string,
): { units: number; decimals: number | null } {
  let units = 0;
  let decimals: number | null = null;
  for (const entry of accounts) {
    const info = entry.account?.data?.parsed?.info;
    if (info?.mint !== usdcMint) continue;
    const amount = Number(info.tokenAmount?.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) continue;
    units += amount;
    if (typeof info.tokenAmount?.decimals === 'number') {
      decimals = info.tokenAmount.decimals;
    }
  }
  return { units, decimals };
}

/** Format base units with 6-decimal USDC display (trailing zeros trimmed). */
export function formatUsdc(units: number): string {
  if (!Number.isFinite(units) || units < 0) return '0';
  const whole = Math.floor(units / 1_000_000);
  const frac = String(units % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Format lamports as SOL, trimming trailing zeros (fee dust stays visible). */
export function formatSol(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports < 0) return '0';
  const sol = lamports / 1_000_000_000;
  return sol >= 1000 ? Math.round(sol).toString() : String(Number(sol.toFixed(9)));
}
