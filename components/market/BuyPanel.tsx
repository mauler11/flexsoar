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
import { formatFsc, formatMyr } from "@/components/card/format";

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
  availableCreditCents,
  firstSalePending,
}: BuyPanelProps) {
  const [pending, startTransition] = useTransition();
  const [unlocked, setUnlocked] = useState(false);

  const maxCreditCents = Math.min(availableCreditCents ?? 0, listing.priceCents);
  const [creditInput, setCreditInput] = useState(() => (maxCreditCents / 100).toFixed(2));

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

  // Clamped for DISPLAY only — the server independently re-validates against
  // getCreditAvailable() and REFUSES an over-available request rather than
  // clamping it (createCheckoutAction). This just keeps the input honest
  // about what the buyer can actually apply. Plain arithmetic, not useMemo —
  // this runs after the checkoutActive early return, so a hook here would
  // violate rules-of-hooks, and the computation is cheap enough not to need
  // memoizing anyway.
  const parsedCredit = Math.round(Number(creditInput) * 100);
  const creditCents =
    !Number.isFinite(parsedCredit) || parsedCredit < 0
      ? 0
      : Math.min(parsedCredit, maxCreditCents);

  const cashCents = Math.max(listing.priceCents - creditCents, 0);
  const fscOnly = cashCents === 0 && creditCents > 0;

  function checkout() {
    startTransition(() => createCheckoutAction(listing.id, creditCents));
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
        <p className="text-[10px] tracking-tight text-muted">
          Oracle fair value {formatMyr(listing.oracleValueCents)}
        </p>
      )}
      {listing.fairPriceCents != null && (
        <p className="text-[10px] tracking-tight text-muted">
          Fair price (this condition) {formatMyr(listing.fairPriceCents)}
        </p>
      )}

      {underOracle && (
        <Banner tone="warn" title="Ask under oracle value">
          This ask is more than 15% below the oracle&apos;s fair value.
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

      {buyable && (
        <div className="flex flex-col gap-1.5 rounded-xl rounded-xl border border-line bg-overlay p-3">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="buy-credit-input"
              className="text-[10px] uppercase tracking-tight text-muted"
            >
              Apply FSC
            </label>
            <span className="text-[9px] uppercase tracking-tight text-muted">
              {formatFsc(maxCreditCents)} available
            </span>
          </div>
          <input
            id="buy-credit-input"
            type="number"
            inputMode="decimal"
            min={0}
            max={maxCreditCents / 100}
            step="0.01"
            value={creditInput}
            disabled={maxCreditCents <= 0}
            onChange={(e) => setCreditInput(e.target.value)}
            className="rounded-xl border border-line-strong bg-overlay px-2.5 py-2 text-[13px] text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="FSC to apply to this purchase"
          />
          <div className="flex items-baseline justify-between text-[10px] tracking-tight text-muted">
            <span>{fscOnly ? "Settles entirely in FSC" : "Due by card"}</span>
            <span className="text-foreground">
              {fscOnly ? formatFsc(creditCents) : formatMyr(cashCents)}
            </span>
          </div>
        </div>
      )}

      <Button
        type="button"
        size="lg"
        disabled={!buyable || pending}
        onClick={checkout}
      >
        {pending
          ? fscOnly
            ? "Settling…"
            : "Redirecting…"
          : buyable
            ? fscOnly
              ? "Pay with FSC"
              : creditCents > 0
                ? `Pay ${formatMyr(cashCents)} + ${formatFsc(creditCents)}`
                : "Buy with Stripe"
            : "Sign in"}
      </Button>
      <p className="text-[9px] uppercase tracking-tight text-muted">
        {fscOnly
          ? "FSC settles immediately — no card charge, no Stripe redirect."
          : "Sale is recorded when payment settles — never by this page."}
      </p>
    </div>
  );
}