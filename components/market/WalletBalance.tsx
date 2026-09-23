/**
 * components/market/WalletBalance.tsx
 *
 * Balance chip for the caller's linked wallet, rendered in the SITE display
 * currency (useFiat): USDC shows the exact on-chain figure, any fiat shows
 * the live-FX estimate with ≈ and the exact USDC in the tooltip. Fetches
 * GET /api/solana/balances on mount, refreshes every minute; renders
 * NOTHING when unlinked, signed out, or unreachable. Silence is deliberate:
 * ambient information — the buy flow owns every loud failure.
 * Non-custodial throughout: display only, no keys, no transfers.
 */
"use client";

import { useEffect, useState } from "react";
import { formatSol, formatUsdc, formatFiatFromUsd } from "@/lib/solana/balances";
import { useFiat } from "@/components/market/Fiat";

interface BalancesResponse {
  wallet: string;
  solLamports: number;
  usdcUnits: number;
  fx: Record<string, number> | null;
  error?: string;
}

export function WalletBalance({
  className,
  label,
}: {
  className?: string;
  /** Optional leading label — renders as a row; omitted keeps the bare chip. */
  label?: string;
}) {
  const { balanceCode } = useFiat();
  const [balance, setBalance] = useState<BalancesResponse | null>(null);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const res = await fetch("/api/solana/balances");
        if (!res.ok) return;
        const body = (await res.json()) as BalancesResponse;
        if (live && typeof body.usdcUnits === "number") setBalance(body);
      } catch {
        // Ambient display stays silent; the buy flow reports real failures.
      }
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (!balance) return null;

  const usd = balance.usdcUnits / 1_000_000;
  // The header site selector never touches this chip: it follows the
  // wallet's own currency (modal selector + switch).
  const shaped =
    balanceCode === "USDC"
      ? { text: `${formatUsdc(balance.usdcUnits)} USDC`, estimated: false }
      : formatFiatFromUsd(usd, balanceCode, balance.fx);
  const text = shaped?.text ?? `${formatUsdc(balance.usdcUnits)} USDC`;
  const estimated = shaped?.estimated ?? false;

  const chip = (
    <span
      role="img"
      aria-label={`Wallet balance: ${text}`}
      title={
        estimated
          ? `Estimate · exact ${formatUsdc(balance.usdcUnits)} USDC · ${formatSol(balance.solLamports)} SOL for fees`
          : `USDC for buys · ${formatSol(balance.solLamports)} SOL for fees`
      }
      className={
        className ??
        "hidden rounded-xl border border-line-strong bg-[#262626] px-3 py-1.5 text-sm font-bold tabular-nums text-foreground sm:inline-block"
      }
    >
      {text}
    </span>
  );

  if (!label) return chip;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted">{label}</span>
      {chip}
    </div>
  );
}
