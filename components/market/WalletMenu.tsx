/**
 * components/market/WalletMenu.tsx
 *
 * Header wallet button + modal (frontend prototype of the embedded-wallet
 * UX, Polymarket-arranged, dark theme kept): balance display sits left of
 * the button in the header (WalletBalance); the button opens a modal with
 * Overview / Settings tabs, a Deposit sub-view (currency + network shown
 * as FIXED rows — USDC on Solana is what the backend settles, so a
 * selector would fake a choice that doesn't exist), and no QR code.
 * No "Buy Crypto" on-ramp: there is none, and a dead button is worse than
 * a missing one. Every number shown is REAL (GET /api/solana/balances);
 * nothing here is mocked. Address provisioning for new users (embedded
 * key management) and any SOL-vs-USDC settlement change are backend
 * decisions explicitly out of scope — see docs/handoff/market.md.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FIAT_CURRENCIES, formatFiatFromUsd, formatSol, formatUsdc } from "@/lib/solana/balances";
import { LinkWalletButton } from "@/components/market/LinkWalletButton";
import { EmbeddedWalletSection } from "@/components/market/EmbeddedWalletSection";
import { FundingOptions } from "@/components/market/FundingOptions";
import { SendDialog } from "@/components/market/SendDialog";
import { Modal } from "@/components/market/Modal";
import { useFiat } from "@/components/market/Fiat";

interface BalancesResponse {
  wallet: string;
  solLamports: number;
  usdcUnits: number;
  usdcMint: string;
  fx: Record<string, number> | null;
  error?: string;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type View = "overview" | "deposit" | "send" | "settings";

/**
 * Balance block with the site-wide fiat controls. Reads the shared display
 * currency (same state as the header selector) — picking a fiat here
 * converts the whole site, not just this modal. Figures stay estimates
 * (USDC≈USD at live FX) with the exact USDC underneath.
 */
function FiatBalance({
  usdcUnits,
  solLamports,
  fx,
}: {
  usdcUnits: number;
  solLamports: number;
  fx: Record<string, number> | null;
}) {
  const { balanceCode, setBalanceCode, toggleBalanceFiat } = useFiat();
  // Estimates on for any fiat; MYR and USDC are both exact modes.
  const fiatOn = balanceCode !== "MYR" && balanceCode !== "USDC";
  const fiat = fiatOn ? formatFiatFromUsd(usdcUnits / 1_000_000, balanceCode, fx) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">Balance</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
          Display in Fiat
          <button
            type="button"
            role="switch"
            aria-checked={fiatOn}
            aria-label="Display in Fiat"
            onClick={toggleBalanceFiat}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              fiatOn ? "bg-accent" : "bg-line-strong"
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                fiatOn ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        </label>
      </div>
      {fiatOn && (
        <select
          value={balanceCode}
          onChange={(e) => setBalanceCode(e.target.value)}
          aria-label="Balance currency"
          className="w-full rounded-md border border-line-strong bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
        >
          <option value="USDC">USDC — Exact</option>
          {FIAT_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      )}
      <span className="text-2xl font-bold tabular-nums tracking-tight">
        {fiat ? (
          <>{fiat.text}</>
        ) : (
          <>
            {formatUsdc(usdcUnits)}{" "}
            <span className="text-sm font-semibold text-muted">USDC</span>
          </>
        )}
      </span>
      {fiat && (
        <span className="text-[11px] text-muted">
          {formatUsdc(usdcUnits)} USDC exact
        </span>
      )}
      <span className="text-[11px] text-muted">
        {formatSol(solLamports)} SOL for fees
      </span>
    </div>
  );
}

export function WalletMenu() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [tab, setTab] = useState<"overview" | "settings">("overview");
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
        // Modal falls back to the unlinked state on failure.
      }
    }
    if (open && !balance) load();
  }, [open, balance]);

  function close() {
    setOpen(false);
    setView("overview");
  }

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

  function switchTab(next: "overview" | "settings") {
    setTab(next);
    setView(next);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-[#0B0B0B] transition hover:brightness-110"
      >
        Wallet
      </button>

      {open && (
        <Modal onClose={close} closeLabel="Close wallet" panelClassName="max-w-sm">
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold tracking-tight">
                {view === "deposit" || view === "send" ? (
                  <button
                    type="button"
                    onClick={() => setView(tab)}
                    className="mr-2 text-muted transition hover:text-foreground"
                    aria-label="Back to wallet"
                  >
                    ‹
                  </button>
                ) : null}
                {view === "deposit" ? "Deposit" : view === "send" ? "Send" : "Wallet"}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-lg leading-none text-muted transition hover:text-foreground"
              >
                ×
              </button>
            </div>

            {view !== "deposit" && view !== "send" && (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1 text-sm font-semibold">
                {(["overview", "settings"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => switchTab(t)}
                    className={`rounded-lg px-3 py-1.5 capitalize transition ${
                      tab === t ? "bg-raised text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            {balance ? (
              <>
                {view === "overview" && tab === "overview" && balance && (
                  <FiatBalance
                    usdcUnits={balance.usdcUnits}
                    solLamports={balance.solLamports}
                    fx={balance.fx}
                  />
                )}
                {view === "overview" && tab === "overview" && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setView("deposit")}
                      className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-[#0B0B0B] transition hover:brightness-110"
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("send")}
                      className="rounded-xl border border-line-strong bg-background px-4 py-2.5 text-sm font-semibold transition hover:border-muted"
                    >
                      Send
                    </button>
                  </div>
                )}

                {view === "send" && balance?.usdcMint && (
                  <SendDialog
                    walletAddress={balance.wallet}
                    usdcMint={balance.usdcMint}
                    usdcUnits={balance.usdcUnits}
                    onClose={() => setView("overview")}
                  />
                )}

                {view === "deposit" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted">Currency</span>
                      <div className="rounded-xl border border-line-strong bg-background px-3 py-2">
                        <div className="text-sm font-semibold">USDC</div>
                        <div className="text-[11px] text-muted">USD Coin</div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted">Network</span>
                      <div className="rounded-xl border border-line-strong bg-background px-3 py-2 text-sm font-semibold">
                        Solana
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted">Address</span>
                      <div className="flex items-stretch gap-2">
                        <span className="min-w-0 flex-1 break-all rounded-xl border border-line-strong bg-background px-3 py-2 font-mono text-xs">
                          {balance.wallet}
                        </span>
                        <button
                          type="button"
                          onClick={copy}
                          className="shrink-0 rounded-xl border border-line-strong bg-background px-3 text-xs font-semibold transition hover:border-muted"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] leading-snug text-muted">
                      Send only USDC on Solana to this address. Anything else
                      may be unrecoverable.
                    </p>
                    <FundingOptions address={balance.wallet} />
                    <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
                      <span className="text-xs font-semibold">Use a different wallet</span>
                      <LinkWalletButton cta="Link wallet" />
                    </div>
                  </>
                )}

                {view === "settings" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted">Linked address</span>
                      <span className="font-mono text-xs">{short(balance.wallet)}</span>
                    </div>
                    <LinkWalletButton cta="Change payout wallet" />
                    <p className="text-[11px] leading-snug text-muted">
                      Your keys, your coins — FlexSoar never holds these
                      funds. Trades settle wallet-to-wallet on-chain.
                    </p>
                    <Link
                      href="/dashboard"
                      onClick={close}
                      className="text-center text-xs font-semibold text-accent hover:underline"
                    >
                      Manage in Dashboard →
                    </Link>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[11px] leading-snug text-muted">
                  Link a Solana wallet to see your balance, deposit, and buy
                  with USDC.
                </p>
                <LinkWalletButton cta="Link wallet" />
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
              <span className="h-px flex-1 bg-line" />
              <span>or</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <EmbeddedWalletSection />
          </div>
        </Modal>
      )}
    </>
  );
}
