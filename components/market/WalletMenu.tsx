/**
 * components/market/WalletMenu.tsx
 *
 * Header wallet button + dropdown (frontend prototype of the embedded-wallet
 * UX): shows the linked address with copy, live USDC/SOL figures, and a
 * dashboard manage link — or a link-wallet CTA when unlinked. Every number
 * shown is REAL (GET /api/solana/balances, same source as WalletBalance);
 * nothing here is mocked. Address provisioning for new users (embedded
 * key management) and any SOL-vs-USDC settlement change are backend
 * decisions explicitly out of scope — see docs/handoff/market.md.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatSol, formatUsdc } from "@/lib/solana/balances";
import { LinkWalletButton } from "@/components/market/LinkWalletButton";

interface BalancesResponse {
  wallet: string;
  solLamports: number;
  usdcUnits: number;
  error?: string;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletMenu() {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<BalancesResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const res = await fetch("/api/solana/balances");
        if (!res.ok) return;
        const body = (await res.json()) as BalancesResponse;
        if (live && typeof body.usdcUnits === "number") setBalance(body);
      } catch {
        // Dropdown simply shows the unlinked state on failure.
      }
    }
    if (open && !balance) load();
  }, [open, balance]);

  async function copy() {
    if (!balance) return;
    try {
      await navigator.clipboard.writeText(balance.wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — address stays visible for manual copy.
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-raised px-2.5 py-1 text-xs font-semibold text-foreground transition hover:border-muted"
      >
        <span aria-hidden>◎</span>
        {balance ? `${formatUsdc(balance.usdcUnits)} USDC` : "Wallet"}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close wallet menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div className="absolute right-0 z-50 mt-2 flex w-72 flex-col gap-3 rounded-2xl border border-line bg-raised p-4 shadow-soft">
            {balance ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted">
                    Deposit address (Solana)
                  </span>
                  <button
                    type="button"
                    onClick={copy}
                    title="Copy address"
                    className="rounded-lg border border-line-strong bg-background px-2 py-1.5 font-mono text-xs text-foreground transition hover:border-muted"
                  >
                    {copied ? "Copied ✓" : short(balance.wallet)}
                  </button>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">USDC</span>
                  <span className="font-semibold tabular-nums">
                    {formatUsdc(balance.usdcUnits)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">SOL (fees)</span>
                  <span className="font-semibold tabular-nums">
                    {formatSol(balance.solLamports)}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-muted">
                  Your keys, your coins — FlexSoar never holds these funds.
                  Trades settle wallet-to-wallet on-chain.
                </p>
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="text-center text-xs font-semibold text-accent hover:underline"
                >
                  Manage in Dashboard →
                </Link>
              </>
            ) : (
              <>
                <p className="text-[11px] leading-snug text-muted">
                  Link a Solana wallet to see your balance and buy with USDC.
                </p>
                <LinkWalletButton cta="Link wallet" />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
