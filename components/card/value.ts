/**
 * components/card/value.ts
 *
 * Display-only valuation helpers for card previews.
 *
 * oracleValueCents mirrors fn_card_value_cents() in 002_operations.sql exactly:
 *   floor(skus.market_price_cents * fn_float_multiplier(sku, float))
 * with fn_float_multiplier falling through to the linear fallback
 * `1.0 - float * 0.48` while no sku_float_curve rows exist.
 *
 * The styleguide and card components use this so a card's "value" reads the
 * same as the ledger would once track/data lands. It is pure props -> cents,
 * never a fetch.
 */
import type { Card, Sku } from "@/lib/db/types";

/** Mirrors fn_float_multiplier's linear fallback. */
export function floatMultiplier(float: number): number {
  return 1.0 - float * 0.48;
}

/** Mirrors fn_card_value_cents. Returns null when the SKU has no oracle price. */
export function oracleValueCents(card: Card, sku: Sku): number | null {
  if (sku.market_price_cents == null) return null;
  const multiplier = floatMultiplier(card.float_value);
  return Math.floor(sku.market_price_cents * multiplier);
}

/**
 * The listing price when the card is live, else its oracle value. Null when
 * neither exists.
 */
export function displayPriceCents(
  card: Card,
  sku: Sku,
  priceCents: number | null | undefined,
): number | null {
  return priceCents ?? oracleValueCents(card, sku);
}
