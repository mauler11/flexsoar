/**
 * components/market/MarketTile.tsx
 *
 * One live listing in the market grid. The listing is a ListingSummary from
 * the contract; the presentational CardTile is shaped by full row types, so
 * the bridge adapts first.
 */
import type { ListingSummary } from "@/lib/api/contract";
import { toCard, toSku, toSummaryListing } from "@/components/market/bridge";
import { CardTile } from "@/components/card/CardTile";

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
    </div>
  );
}