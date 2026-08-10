/**
 * lib/db/valuation.ts
 *
 * A faithful JS mirror of fn_float_multiplier() and fn_card_value_cents()
 * from 002_operations.sql.
 *
 * WHY THIS EXISTS: `CardsQuery.sort` offers 'value_asc' / 'value_desc', and
 * PostgREST cannot order by the result of a SQL function. The alternatives
 * were to drop those sorts (the contract is frozen — not an option) or to sort
 * in JS. So contract.ts pulls the SKU float curves alongside the cards and
 * ranks them here, using the same arithmetic the database uses.
 *
 * The single-card value on CardDetail does NOT come through here — that calls
 * fn_card_value_cents() directly by RPC, which is exact by construction. This
 * mirror is for ordering a page of rows, nothing else.
 *
 * If 002_operations.sql changes either function, change this file with it.
 * The .sql files are the source of truth.
 */

import type { Cents, FloatValue, UUID } from '@/lib/db/types';

/** The `sku_float_curve` columns this module needs. */
export interface FloatCurveRow {
  sku_id: UUID;
  float_min: FloatValue;
  float_max: FloatValue;
  value_multiplier: number;
}

/**
 * fn_float_multiplier(p_sku, p_float):
 *
 *   select coalesce(
 *     (select value_multiplier from sku_float_curve
 *       where sku_id = p_sku and p_float >= float_min and p_float < float_max
 *       limit 1),
 *     1.0 - (p_float * 0.48)
 *   );
 *
 * Lower bound inclusive, upper bound exclusive — the same shape as
 * fn_tier_for_price. The linear fallback applies per SKU until the oracle
 * fills that SKU's curve.
 */
export function floatMultiplier(
  curve: readonly FloatCurveRow[],
  skuId: UUID,
  float: FloatValue,
): number {
  const band = curve.find(
    (row) => row.sku_id === skuId && float >= row.float_min && float < row.float_max,
  );

  return band ? band.value_multiplier : 1.0 - float * 0.48;
}

/**
 * fn_card_value_cents(p_card):
 *
 *   select floor(s.market_price_cents * fn_float_multiplier(...))::bigint
 *
 * Returns null when the SKU has no oracle price, matching the SQL: the join
 * produces null and nothing can be valued. Callers must not substitute a
 * fallback — a SKU without an oracle price cannot even be minted.
 */
export function cardValueCents(
  marketPriceCents: Cents | null,
  multiplier: number,
): Cents | null {
  if (marketPriceCents === null || !Number.isFinite(marketPriceCents)) return null;
  return Math.floor(marketPriceCents * multiplier);
}
