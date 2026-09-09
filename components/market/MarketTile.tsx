/**
 * components/market/MarketTile.tsx
 *
 * One live listing in the market grid. Thin wrapper over ListingCard that
 * keeps the established (listing, showNumericFloat) prop contract.
 */
import type { ListingSummary } from "@/lib/api/contract";
import { ListingCard } from "@/components/market/ListingCard";

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
  return <ListingCard listing={listing} showNumericFloat={showNumericFloat} />;
}