/**
 * components/market/MarketTile.tsx
 *
 * One live listing in the market grid. The listing is a ListingSummary from
 * the contract; the presentational CardTile is shaped by full row types, so
 * the bridge adapts first. Under the tile, an early-access strip reads the
 * level gate and the ticking countdown for listings still in their window.
 */
import type { ListingSummary } from "@/lib/api/contract";
import { toCard, toSku, toSummaryListing } from "@/components/market/bridge";
import { CardTile } from "@/components/card/CardTile";
import { Countdown } from "@/components/market/Countdown";

export interface MarketTileProps {
  listing: ListingSummary;
  /**
   * Mirrors getPlatformConfig().show_numeric_float — forwarded straight to
   * CardTile, which already defaults to false (the safe, live-verified
   * value) when omitted. See CardTile's own doc comment for why the default
   * matters: every float is a seller's self-assessment at launch.
   */
  showNumericFloat?: boolean;
}

export function MarketTile({ listing, showNumericFloat }: MarketTileProps) {
  const card = toCard(listing.card);
  const sku = toSku(listing.card.sku);
  const listingForCard = toSummaryListing(listing.card, listing.seller_id);
  const early = listing.status === "early_access";

  return (
    <div className="flex w-[188px] flex-col gap-1.5">
      <CardTile
        card={card}
        sku={sku}
        priceCents={listing.price_cents}
        listing={listingForCard}
        href={`/card/${listing.card_id}`}
        showNumericFloat={showNumericFloat}
      />
      {early && (
        <div className="flex items-center justify-between gap-2 border border-accent/50 bg-overlay px-2 py-1 font-mono text-[9px] uppercase tracking-tight text-accent">
          <span title="Early-access window — visible to LV 0+ or level holders">
            EA · LV {listing.early_access_level}
          </span>
          <Countdown target={listing.public_at} label="" />
        </div>
      )}
    </div>
  );
}