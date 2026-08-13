/**
 * components/market/bridge.ts
 *
 * The contract returns `CardSummary` / `SkuRef` / `ListingRef` shapes. The
 * presentational card components in components/card are written against the
 * full row types (Card / Sku / Listing from lib/db/types). This module is the
 * adapter between the two, so the market pages never hand a half-shaped object
 * to a card component.
 *
 * Fill values are only ever fields the card components do not render (created
 * timestamps, retail price, mint_cap, seller_id...) — nothing shown by the
 * surfaces is fabricated.
 */

import type { Card, Listing, Sku } from "@/lib/db/types";
import type { CardSummary, ListingRef, SkuRef } from "@/lib/api/contract";

/** CardSummary has every Card field except `exceptional_reason`. */
export function toCard(summary: CardSummary): Card {
  return { ...summary, exceptional_reason: null };
}

/** CardDetail carries the real reason; prefer it over toCard when available. */
export function toCardWithReason(
  summary: CardSummary & { exceptional_reason: string | null },
): Card {
  return { ...summary, exceptional_reason: summary.exceptional_reason };
}

/** SkuRef lacks the rows the card components do not read. */
export function toSku(sku: SkuRef): Sku {
  return {
    id: sku.id,
    brand: sku.brand,
    model: sku.model,
    colorway: sku.colorway,
    size_us: sku.size_us,
    retail_price_cents: null,
    market_price_cents: sku.market_price_cents,
    price_confidence: null,
    priced_at: null,
    demand_score: 0,
    sprite_key: sku.sprite_key,
    palette: sku.palette,
    art_url: sku.art_url,
    mint_cap: null,
    created_at: "",
  };
}

/** A live ListingRef, widened to the full Listing shape for CardTile/CardDetail. */
export function toListing(
  ref: ListingRef,
  overrides: { cardId: string; sellerId: string; createdAt?: string; soldAt?: string | null },
): Listing {
  return {
    id: ref.id,
    card_id: overrides.cardId,
    seller_id: overrides.sellerId,
    price_cents: ref.price_cents,
    status: ref.status,
    early_access_level: ref.early_access_level,
    public_at: ref.public_at,
    oracle_value_cents: ref.oracle_value_cents,
    created_at: overrides.createdAt ?? "",
    sold_at: overrides.soldAt ?? null,
  };
}

/** The card-summary listing embedded on the summary, if the card is live. */
export function toSummaryListing(
  summary: CardSummary,
  sellerId?: string,
): Listing | null {
  if (!summary.listing) return null;
  return toListing(summary.listing, {
    cardId: summary.id,
    sellerId: sellerId ?? summary.owner_id,
  });
}