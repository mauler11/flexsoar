/**
 * components/market/BuyPanel.tsx
 *
 * Server-selected manual request CTA plus recovery for historical payments.
 * Submission rechecks availability and reads the current price on the server.
 */
"use client";

import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/market/Banner";
import { CheckoutButton } from "@/components/market/CheckoutModal";
import { FiatAmount } from "@/components/market/Fiat";

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
  manualStatus?: "open" | "reserved" | "unavailable";
  /**
   * True when the underlying item is still in the consignor's own custody
   * (items.custody = 'seller') — a first sale that hasn't reached the vault
   * yet. This disclosure is shown before a manual order request.
   */
  firstSalePending: boolean;
}

export function BuyPanel({
  listing,
  manualStatus = "unavailable",
  firstSalePending,
}: BuyPanelProps) {
  const underOracle =
    listing.oracleValueCents != null &&
    listing.priceCents < listing.oracleValueCents * 0.85;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Public</Badge>
      </div>

      <div>
        <div className="text-2xl font-bold tracking-tight">
          <FiatAmount cents={listing.priceCents} />
        </div>
      </div>

      {listing.fairPriceCents != null && (
        <p className="text-[11px] text-muted">
          Fair Market Price <FiatAmount cents={listing.fairPriceCents} />
        </p>
      )}

      {underOracle && (
        <Banner tone="warn" title="Ask under Fair Market Price">
          This ask is more than 15% below Fair Market Price.
        </Banner>
      )}

      {firstSalePending && (
        <Banner tone="info" title="Seller-held pair">
          Held by the seller. FlexSoar collects and authenticates every pair before your card transfers. Full refund if it fails authentication or isn&apos;t delivered to us.
        </Banner>
      )}

      {manualStatus === "open" ? (
        <a className="rounded-xl bg-accent px-4 py-2 text-center font-semibold text-[#0B0B0B]" href={`/order/${listing.id}`}>Order now</a>
      ) : (
        <button type="button" disabled className="rounded-xl border border-line px-4 py-2 text-muted">{manualStatus === "reserved" ? "Reserved" : "Coming soon"}</button>
      )}
      <CheckoutButton listing={listing} />
      <p className="text-[11px] text-muted">
        Order requests are reviewed manually. Payment status recovers past attempts only.
      </p>
    </div>
  );
}
