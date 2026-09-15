/**
 * components/market/WalletBalance.tsx
 *
 * Read-only balance chip for the caller's linked wallet: USDC (the spending
 * money) plus SOL (the fee money — an empty-SOL wallet can't sign anything).
 * Fetches GET /api/solana/balances on mount and refreshes every minute;
 * renders NOTHING when unlinked, signed out, or unreachable. Silence is
 * deliberate: this is ambient information, and the buy flow already owns
 * every loud failure. Non-custodial throughout — display only, no keys,
 * no transfers, nothing to approve.
 */
"use client";

import { useEffect, useState } from "react";
import { formatSol, formatUsdc } from "@/lib/solana/balances";

interface BalancesResponse {
  wallet: string;
  solLamports: number;
  usdcUnits: number;
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

  const chip = (
    <span
      title={`USDC for buys · ${formatSol(balance.solLamports)} SOL for fees`}
      className={
        className ??
        "hidden rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold tabular-nums text-foreground sm:inline-block"
      }
    >
      {formatUsdc(balance.usdcUnits)} USDC
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
