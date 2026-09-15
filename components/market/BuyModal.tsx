/**
 * components/market/BuyModal.tsx
 *
 * Courtyard-arranged purchase box: order summary (price, 5% platform fee,
 * total) with two rail options underneath — FlexSoar Balance (the embedded
 * or linked wallet settling USDC on-chain, exactly the proven path) and
 * Card (Stripe checkout, the proven fiat path). No new rails here: a
 * Privy card on-ramp would slot into the Card section once its KYB,
 * sandbox proof, and fee picture land — until then the button says Stripe
 * plainly instead of pretending otherwise.
 */
"use client";

import { useTransition } from "react";
import { createCheckoutAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { SolanaBuyPanelRoot } from "@/components/market/PrivyBuyBridge";
import { FiatAmount } from "@/components/market/Fiat";
import type { BuyPanelListing } from "./BuyPanel";

export function BuyModal({ listing }: { listing: BuyPanelListing }) {
  const [pending, startTransition] = useTransition();
  const feeCents = Math.floor((listing.priceCents * 500) / 10000);

  function checkout() {
    startTransition(() => createCheckoutAction(listing.id, 0));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-background p-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Price</span>
          <FiatAmount cents={listing.priceCents} />
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Platform fee (5%)</span>
          <FiatAmount cents={feeCents} />
        </div>
        <div className="flex items-baseline justify-between border-t border-line pt-1.5 font-semibold">
          <span>You pay</span>
          <FiatAmount cents={listing.priceCents} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          FlexSoar Balance
        </span>
        <SolanaBuyPanelRoot listingId={listing.id} priceCents={listing.priceCents} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Card
        </span>
        <Button
          type="button"
          size="lg"
          disabled={pending}
          onClick={checkout}
          className="py-3 text-base"
        >
          {pending ? "Redirecting…" : "Buy with Card"}
        </Button>
        <p className="text-[11px] text-muted">
          Card checkout runs through Stripe. Direct crypto on-ramp arrives later.
        </p>
      </div>
    </div>
  );
}
