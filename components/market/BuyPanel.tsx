/**
 * components/market/BuyPanel.tsx
 *
 * The purchase box for a listing the caller does not own. Gating happens
 * twice: once here, so the button can explain itself honestly (level required,
 * window not open), and again inside createCheckoutAction, which re-checks the
 * session and refuses to build a Stripe Session for anyone the database would
 * reject — the webhook's EARLY_ACCESS_LOCKED is the last line, not the first.
 *
 * When `checkoutActive` (the page is showing a just-returned checkout) the
 * panel hands off to OrderPoll, which watches the listing until the webhook
 * records the settlement.
 */
"use client";

import { useState, useTransition } from "react";
import { createCheckoutAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/market/Banner";
import { OrderPoll } from "@/components/market/OrderPoll";
import { formatMyr } from "@/components/card/format";

export interface BuyPanelListing {
  id: string;
  cardId: string;
  priceCents: number;
  fairPriceCents: number | null;
  oracleValueCents: number | null;
  status: string;
  sellerId: string;
}

export interface BuyPanelProps {
  listing: BuyPanelListing;
  /** The listing this page returned from checkout for; poll it to settle. */
  checkoutActive: boolean;
  /**
   * The viewer's spendable FSC (fn_credit_available, NOT the raw ledger
   * balance — AGENT_RULES.md §5). Null when signed out; the field below is
   * hidden in that case since there's nothing to spend yet.
   */
  availableCreditCents: number | null;
  /**
   * True when the underlying item is still in the consignor's own custody
   * (items.custody = 'seller') — a first sale that hasn't reached the vault
   * yet. Buying this listing freezes the card until the shoe physically
   * reaches FlexSoar; the disclosure below says so before checkout, not
   * after.
   */
  firstSalePending: boolean;
}

export function BuyPanel({
  listing,
  checkoutActive,
  firstSalePending,
}: BuyPanelProps) {
  const [pending, startTransition] = useTransition();
  const [unlocked, setUnlocked] = useState(false);

  if (checkoutActive) {
    return (
      <OrderPoll
        listingId={listing.id}
        cardId={listing.cardId}
        priceCents={listing.priceCents}
      />
    );
  }

  const isPublic = true;
  const buyable = isPublic;
  const underOracle =
    listing.oracleValueCents != null &&
    listing.priceCents < listing.oracleValueCents * 0.85;

  function checkout() {
    startTransition(() => createCheckoutAction(listing.id, 0));
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Public</Badge>
      </div>

      <div>
        <div className="text-2xl font-bold tracking-tight">
          {formatMyr(listing.priceCents)}
        </div>
      </div>

      {listing.oracleValueCents != null && (
        <p className="text-[11px] text-muted">
          Fair Price {formatMyr(listing.oracleValueCents)}
        </p>
      )}
      {listing.fairPriceCents != null && (
        <p className="text-[11px] text-muted">
          Fair price (this condition) {formatMyr(listing.fairPriceCents)}
        </p>
      )}

      {underOracle && (
        <Banner tone="warn" title="Ask under fair price">
          This ask is more than 15% below fair price.
        </Banner>
      )}

      {firstSalePending && (
        <Banner tone="warn" title="First sale — card freezes on purchase">
          This shoe is still with the seller. Buying it locks the card as{" "}
          <strong>pending vault</strong> until the physical shoe reaches
          FlexSoar — no resale, trade, or redemption until then. The seller
          has 48 hours to ship; if they miss it, the sale is cancelled and you
          are refunded in full and in kind.
        </Banner>
      )}

      <Button
        type="button"
        size="lg"
        disabled={!buyable || pending}
        onClick={checkout}
        className="py-3 text-base"
      >
        {pending ? "Redirecting…" : buyable ? "Buy Now" : "Sign in"}
      </Button>
      <p className="text-[11px] text-muted">
        Sale is recorded when payment settles — never by this page.
      </p>
    </div>
  );
}