/**
 * components/market/CheckoutModal.tsx
 *
 * Single-Buy-Now checkout popup (Courtyard-arranged): payment-method radio
 * on the left, order summary with the action on the right. The buyer pays
 * the total, full stop — the platform fee is a seller-side matter (the 5%
 * splits FROM the total on-chain, seller nets 95%) and is deliberately not
 * shown here, so the summary states only what the buyer owes.
 *
 *   - Card → existing Stripe checkout redirect (the only true one-step
 *     card payment; raw PANs never touch our UI — PCI stays with Stripe).
 *   - Wallet → the proven USDC balance flow inline ("Buy with Balance").
 *     Short balance opens top-up instead of dying: the Privy funding rails
 *     (flag-gated) or the plain deposit address otherwise.
 */
"use client";

import { useEffect, useState, useTransition } from "react";
import { createCheckoutAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { Modal } from "@/components/market/Modal";
import { SolanaBuyPanelRoot } from "@/components/market/PrivyBuyBridge";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import { FundingOptions } from "@/components/market/FundingOptions";
import { FiatAmount, useFiat } from "@/components/market/Fiat";
import { formatUsdc } from "@/lib/solana/balances";
import { isPrivyCheckoutEnabled } from "@/lib/solana/privy";
import type { BuyPanelListing } from "./BuyPanel";

export interface BuyModalProps {
  listing: BuyPanelListing;
}

type Method = "card" | "wallet";

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
        Buy Now
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
  const [method, setMethod] = useState<Method>("wallet");
  const [pending, startTransition] = useTransition();
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

  function checkoutCard() {
    startTransition(() => createCheckoutAction(listing.id, 0));
  }

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
          <h3 className="text-sm font-bold tracking-tight">Payment Method</h3>
          <div
            role="radiogroup"
            aria-label="Payment method"
            className="flex flex-col gap-2 rounded-2xl border border-line bg-background p-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={method === "card"}
              onClick={() => setMethod("card")}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                method === "card" ? "bg-raised" : "hover:bg-raised/60"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  method === "card" ? "border-accent" : "border-muted"
                }`}
              >
                {method === "card" && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
              Card (Stripe)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === "wallet"}
              onClick={() => setMethod("wallet")}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                method === "wallet" ? "bg-raised" : "hover:bg-raised/60"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  method === "wallet" ? "border-accent" : "border-muted"
                }`}
              >
                {method === "wallet" && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
              <span className="flex-1">Wallet (USDC)</span>
              <span className="tabular-nums text-muted">
                {wallet ? `${formatUsdc(wallet.usdcUnits)} USDC` : "—"}
              </span>
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted">
            Card pays by Stripe redirect. Wallet settles USDC on-chain —
            no card fees, same total either way.
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

          {method === "card" ? (
            <Button
              type="button"
              size="lg"
              disabled={pending}
              onClick={checkoutCard}
              className="py-3 text-base"
            >
              {pending ? "Redirecting…" : "Buy now"}
            </Button>
          ) : wallet ? (
            shortfall ? (
              <div className="flex flex-col gap-2">
                <Banner tone="warn" title="Insufficient balance">
                  This purchase needs {formatUsdc(totalUnits ?? 0)} USDC — you
                  hold {formatUsdc(wallet.usdcUnits)}. Top up, then buy.
                </Banner>
                {isPrivyCheckoutEnabled() ? (
                  <FundingOptions address={wallet.wallet} />
                ) : (
                  <p className="text-[11px] leading-snug text-muted">
                    Send USDC on Solana to{" "}
                    <span className="font-mono">
                      {wallet.wallet.slice(0, 6)}…{wallet.wallet.slice(-4)}
                    </span>{" "}
                    from any wallet or exchange, then retry.
                  </p>
                )}
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
