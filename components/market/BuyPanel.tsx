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
import { Countdown } from "@/components/market/Countdown";
import { OrderPoll } from "@/components/market/OrderPoll";
import { formatFsc, formatMyr } from "@/components/card/format";

export interface BuyPanelListing {
  id: string;
  cardId: string;
  priceCents: number;
  oracleValueCents: number | null;
  status: string;
  earlyAccessLevel: number;
  publicAt: string;
  sellerId: string;
}

export interface BuyPanelProps {
  listing: BuyPanelListing;
  viewerId: string | null;
  viewerLevel: number | null;
  /** The listing this page returned from checkout for; poll it to settle. */
  checkoutActive: boolean;
}

export function BuyPanel({
  listing,
  viewerId,
  viewerLevel,
  checkoutActive,
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

  const isPublic =
    listing.status === "public" || unlocked;
  const earlyEligible =
    viewerId != null &&
    viewerLevel != null &&
    viewerLevel >= listing.earlyAccessLevel;
  const buyable = isPublic || earlyEligible;
  const underOracle =
    listing.oracleValueCents != null &&
    listing.priceCents < listing.oracleValueCents * 0.85;

  function checkout() {
    startTransition(() => createCheckoutAction(listing.id));
  }

  return (
    <div className="flex flex-col gap-3 border border-line bg-overlay p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={isPublic ? "accent" : "info"}>
          {isPublic ? "Public" : "Early access"}
        </Badge>
        {!isPublic && (
          <Badge tone="info">LV {listing.earlyAccessLevel}+</Badge>
        )}
      </div>

      <div>
        <div className="text-2xl font-bold tracking-tight">
          {formatFsc(listing.priceCents)}
        </div>
        <div className="font-mono text-[11px] tracking-tight text-muted">
          {formatMyr(listing.priceCents)}
        </div>
      </div>

      {listing.oracleValueCents != null && (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          Oracle fair value {formatFsc(listing.oracleValueCents)}
        </p>
      )}

      {underOracle && (
        <Banner tone="warn" title="Ask under oracle value">
          This ask is more than 15% below the oracle&apos;s fair value.
        </Banner>
      )}

      {!isPublic && (
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-tight text-muted">
          <span>Unlocks</span>
          <Countdown
            target={listing.publicAt}
            className="text-accent"
            onUnlock={() => setUnlocked(true)}
          />
        </div>
      )}

      <Button
        type="button"
        size="lg"
        disabled={!buyable || pending}
        onClick={checkout}
      >
        {pending
          ? "Redirecting…"
          : buyable
            ? "Buy with Stripe"
            : viewerId == null
              ? `Sign in · LV ${listing.earlyAccessLevel}+`
              : `Level ${listing.earlyAccessLevel} required · you are LV ${viewerLevel ?? 0}`}
      </Button>
      <p className="font-mono text-[9px] uppercase tracking-tight text-muted">
        Sale is recorded when payment settles — never by this page.
      </p>
    </div>
  );
}