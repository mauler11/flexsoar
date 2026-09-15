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
import { Banner } from "@/components/market/Banner";
import { FIAT_CURRENCIES, formatFiatFromUsd, formatSol, formatUsdc } from "@/lib/solana/balances";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import { FundingOptions } from "@/components/market/FundingOptions";
import { SendDialog } from "@/components/market/SendDialog";
import { Modal } from "@/components/market/Modal";
import { useFiat } from "@/components/market/Fiat";
import { isPrivyCheckoutEnabled } from "@/lib/solana/privy";

interface BalancesResponse {
  wallet: string;
  solLamports: number;
  usdcUnits: number;
  usdcMint: string;
  fx: Record<string, number> | null;
  error?: string;
}

type View = "deposit" | "withdraw" | "settings";

/**
 * Balance figure with optional fiat controls. Reads the wallet's own
 * display currency (same state as the header balance chip) — picking a
 * fiat here converts the chip too, never site prices. Figures are live FX
 * with the exact USDC underneath.
 */
function FiatBalance({
  usdcUnits,
  solLamports,
  fx,
  controls = true,
}: {
  usdcUnits: number;
  solLamports: number;
  fx: Record<string, number> | null;
  /** Hide the toggle + selector (Deposit tab shows the figure only). */
  controls?: boolean;
}) {
  const { balanceCode, setBalanceCode, toggleBalanceFiat } = useFiat();
  // Estimates on for any fiat; MYR and USDC are both exact modes.
  const fiatOn = balanceCode !== "MYR" && balanceCode !== "USDC";
  const fiat = fiatOn ? formatFiatFromUsd(usdcUnits / 1_000_000, balanceCode, fx) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">Balance</span>
        {controls && (
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
        )}
      </div>
      {controls && fiatOn && (
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

/**
 * Deposit tab: balance figure plus one green Add Funds button that opens
 * the funding rails directly — a single button, never a button behind a
 * button. With the rails flag off, FundingOptions renders nothing and the
 * plain transfer address shows instead (same address, zero new machinery).
 */
function DepositTab({
  wallet,
  usdcUnits,
  solLamports,
  fx,
}: {
  wallet: string;
  usdcUnits: number;
  solLamports: number;
  fx: Record<string, number> | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — address stays visible for manual copy.
    }
  }

  return (
    <>
      <FiatBalance
        usdcUnits={usdcUnits}
        solLamports={solLamports}
        fx={fx}
        controls={false}
      />
      <FundingOptions address={wallet} />
      {!isPrivyCheckoutEnabled() && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">
            Or send USDC on Solana to this address from any wallet or exchange.
          </span>
          <div className="flex items-stretch gap-2">
            <span className="min-w-0 flex-1 break-all rounded-xl border border-line-strong bg-background px-3 py-2 font-mono text-xs">
              {wallet}
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
      )}
    </>
  );
}

export function WalletMenu() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<View>("deposit");
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
        // Modal falls back to the unlinked state on failure.
      }
    }
    if (open && !balance) load();
  }, [open, balance]);

  function close() {
    setOpen(false);
    setTab("deposit");
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
              <h2 className="text-base font-bold tracking-tight">Wallet</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-lg leading-none text-muted transition hover:text-foreground"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-xl bg-background p-1 text-sm font-semibold">
              {(["deposit", "withdraw", "settings"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 capitalize transition ${
                    tab === t ? "bg-[#2E2E2E] text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "deposit" && (
              balance ? (
                <DepositTab
                  wallet={balance.wallet}
                  usdcUnits={balance.usdcUnits}
                  solLamports={balance.solLamports}
                  fx={balance.fx}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] leading-snug text-muted">
                    Link your FlexSoar wallet to deposit, see your balance,
                    and buy with USDC.
                  </p>
                  <EmbeddedLinkButton cta="Link wallet" />
                </div>
              )
            )}

            {tab === "withdraw" && (
              balance?.usdcMint ? (
                <>
                  <Banner tone="success" title="Withdrawals settle in seconds">
                    Wallet-to-wallet USDC — no fees beyond the network&apos;s
                    fraction of a cent.
                  </Banner>
                  <SendDialog
                    walletAddress={balance.wallet}
                    usdcMint={balance.usdcMint}
                    usdcUnits={balance.usdcUnits}
                    onClose={() => setTab("deposit")}
                  />
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] leading-snug text-muted">
                    Link your FlexSoar wallet first — withdrawals send from
                    the linked address.
                  </p>
                  <EmbeddedLinkButton cta="Link wallet" />
                </div>
              )
            )}

            {tab === "settings" && (
              <WalletSettings
                wallet={balance?.wallet ?? null}
                onClose={close}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Settings tab: linked address management plus both fiat controls — the
 * wallet balance currency (toggle + selector) and the site prices
 * currency. Both write the same shared state the header uses, so either
 * surface reflects the other instantly.
 */
function WalletSettings({
  wallet,
  onClose,
}: {
  wallet: string | null;
  onClose: () => void;
}) {
  const { balanceCode, setBalanceCode, toggleBalanceFiat, siteCode, setSiteCode } = useFiat();
  const balanceFiatOn = balanceCode !== "MYR" && balanceCode !== "USDC";
  return (
    <div className="flex flex-col gap-3">
      {!wallet && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-snug text-muted">
            Link a wallet first — display settings apply once there is a
            balance to show.
          </p>
          <EmbeddedLinkButton cta="Link wallet" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Balance currency
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            Display in Fiat
            <button
              type="button"
              role="switch"
              aria-checked={balanceFiatOn}
              aria-label="Display balance in Fiat"
              onClick={toggleBalanceFiat}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                balanceFiatOn ? "bg-accent" : "bg-line-strong"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                  balanceFiatOn ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </label>
        </div>
        <select
          value={balanceFiatOn ? balanceCode : "USDC"}
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
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Site prices currency
        </span>
        <select
          value={siteCode}
          onChange={(e) => setSiteCode(e.target.value)}
          aria-label="Site prices currency"
          className="w-full rounded-md border border-line-strong bg-background px-3 py-2 text-sm text-foreground focus:outline-none"
        >
          <option value="MYR">MYR — Exact (ledger)</option>
          <option value="USDC">USDC — Exact</option>
          {FIAT_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Your keys, your coins — FlexSoar never holds these funds. Trades
        settle wallet-to-wallet on-chain.
      </p>
      <Link
        href="/dashboard"
        onClick={onClose}
        className="text-center text-xs font-semibold text-accent hover:underline"
      >
        Manage in Dashboard →
      </Link>
    </div>
  );
}
