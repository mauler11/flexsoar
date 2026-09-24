/**
 * components/market/CheckoutModal.tsx
 *
 * Single-Buy-Now checkout popup: order summary with the wallet action on
 * the right. Wallet-only by decision — the Stripe card path is parked
 * (backend dormant, re-addable), so there is no payment-method radio. The
 * buyer pays the total in USDC on Solana, full stop — the platform fee is
 * a seller-side matter (the 5% splits FROM the total on-chain, seller nets
 * 95%) and is deliberately not shown here.
 *
 * Short balance opens top-up instead of dying: the Privy funding rails
 * (flag-gated) or the plain deposit address otherwise.
 */
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { Modal } from "@/components/market/Modal";
import { SolanaBuyPanelRoot } from "@/components/market/PrivyBuyBridge";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import { FundingOptions } from "@/components/market/FundingOptions";
import { FiatAmount, useFiat } from "@/components/market/Fiat";
import { formatUsdc } from "@/lib/solana/balances";
import type { BuyPanelListing } from "./BuyPanel";

export interface BuyModalProps {
  listing: BuyPanelListing;
}

interface WalletState {
  wallet: string;
  usdcMint: string;
  usdcUnits: number;
}

export function CheckoutButton({ listing }: BuyModalProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="lg"
        disabled={false}
        onClick={() => setOpen(true)}
        className="py-3 text-base"
      >
        Buy
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)} closeLabel="Close checkout" panelClassName="max-w-2xl">
          <CheckoutModal listing={listing} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

export function CheckoutModal({ listing, onClose }: { listing: BuyPanelListing; onClose: () => void }) {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const { rates } = useFiat();

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const res = await fetch("/api/solana/balances");
        if (!res.ok) return;
        const body = (await res.json()) as WalletState & { usdcUnits?: number };
        if (live && typeof body.usdcUnits === "number") {
          setWallet({
            wallet: body.wallet,
            usdcMint: body.usdcMint,
            usdcUnits: body.usdcUnits,
          });
        }
      } catch {
        // Wallet section falls back to the link flow on failure.
      }
    }
    load();
    return () => {
      live = false;
    };
  }, []);

  const myr = rates?.["MYR"];
  const totalUnits =
    typeof myr === "number" && myr > 0
      ? Math.round(((listing.priceCents / 100) / myr) * 1_000_000)
      : null;
  const shortfall =
    wallet != null && totalUnits != null && wallet.usdcUnits < totalUnits;

  return (
    <div className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Checkout</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-lg leading-none text-muted transition hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold tracking-tight">Payment</h3>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-background px-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-sm font-extrabold text-accent">
              $
            </span>
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-semibold">Wallet (USDC)</span>
              <span className="tabular-nums text-[11px] text-muted">
                {wallet ? `${formatUsdc(wallet.usdcUnits)} USDC available` : "USDC on Solana"}
              </span>
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted">
            Settles USDC on Solana — your wallet signs, FlexSoar never
            touches the keys. No USDC yet? Top up below, then buy.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-background p-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-bold">Order summary</span>
              <span className="text-[11px] text-muted">1 item</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-2 text-sm">
              <span className="text-muted">Price</span>
              <FiatAmount cents={listing.priceCents} />
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-2 text-sm font-bold">
              <span>You pay</span>
              <FiatAmount cents={listing.priceCents} />
            </div>
          </div>

          {wallet ? (
            shortfall ? (
              <div className="flex flex-col gap-2">
                <Banner tone="warn" title="Insufficient balance">
                  This purchase needs {formatUsdc(totalUnits ?? 0)} USDC — you
                  hold {formatUsdc(wallet.usdcUnits)}. Top up, then buy.
                </Banner>
                <FundingOptions address={wallet.wallet} />
              </div>
            ) : (
              <SolanaBuyPanelRoot listingId={listing.id} priceCents={listing.priceCents} />
            )
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] leading-snug text-muted">
                Link your FlexSoar wallet to pay with balance.
              </p>
              <EmbeddedLinkButton cta="Link wallet" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
