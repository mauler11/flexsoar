/**
 * lib/domain/rarity.ts
 *
 * Tier is VALUE. Float is CONDITION. They never mix.
 *
 * Tier comes from the SKU's base oracle price via `tier_bands`. A pristine
 * float on a cheap shoe is a mint-condition Common, never a Legendary. Nothing
 * in this file lets a float change a tier.
 *
 * `is_exceptional` is a FLAG, not a tier. It overrides the border colour to
 * red; `tier` still drives value bands and trade-up eligibility.
 */

import type { Cents, FloatValue, Tier } from '@/lib/db/types';

// ------------------------------------------------------------
// TIERS — mirrors the tier_bands rows inserted by 001_schema.sql
// ------------------------------------------------------------

export type TierName = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

export interface TierBandSpec {
  tier: Tier;
  name: TierName;
  /** Hex border colour. Overridden by EXCEPTIONAL_COLOR when the flag is set. */
  borderColor: string;
  /** Inclusive lower bound, USD cents. */
  minCents: Cents;
  /** Exclusive upper bound, USD cents. null = open ended. */
  maxCents: Cents | null;
}

/**
 * Exactly the rows in `tier_bands`. Bounds are USD cents:
 *   (1,'Common',    '#7A7A7A',     0,  6000)   -- under $60
 *   (2,'Uncommon',  '#35F07A',  6000, 12000)   -- $60 to $120
 *   (3,'Rare',      '#3B9EFF', 12000, 25000)   -- $120 to $250
 *   (4,'Epic',      '#A855F7', 25000, 50000)   -- $250 to $500
 *   (5,'Legendary', '#E8B33A', 50000,  null)   -- $500 and up
 */
export const TIER_BANDS: readonly TierBandSpec[] = [
  { tier: 1, name: 'Common', borderColor: '#7A7A7A', minCents: 0, maxCents: 6000 },
  { tier: 2, name: 'Uncommon', borderColor: '#35F07A', minCents: 6000, maxCents: 12000 },
  { tier: 3, name: 'Rare', borderColor: '#3B9EFF', minCents: 12000, maxCents: 25000 },
  { tier: 4, name: 'Epic', borderColor: '#A855F7', minCents: 25000, maxCents: 50000 },
  { tier: 5, name: 'Legendary', borderColor: '#E8B33A', minCents: 50000, maxCents: null },
] as const;

/** Red border for `cards.is_exceptional`. A flag, not a sixth tier. */
export const EXCEPTIONAL_COLOR = '#FF4444';

/**
 * Mirrors fn_tier_for_price(p_cents): the band where
 * `cents >= min_cents and (max_cents is null or cents < max_cents)`.
 *
 * Returns null when no band matches — a negative or non-finite price, the same
 * way the SQL function returns null. Callers must not fall back to a tier;
 * a SKU without an oracle price cannot be minted (fn_mint_card raises).
 */
export function tierForPrice(cents: Cents): Tier | null {
  if (!Number.isFinite(cents)) return null;
  for (const band of TIER_BANDS) {
    if (cents >= band.minCents && (band.maxCents === null || cents < band.maxCents)) {
      return band.tier;
    }
  }
  return null;
}

export function tierBand(tier: Tier): TierBandSpec {
  const band = TIER_BANDS.find((b) => b.tier === tier);
  if (!band) throw new Error(`unknown tier ${tier}`);
  return band;
}

export function tierName(tier: Tier): TierName {
  return tierBand(tier).name;
}

/**
 * The border colour a card renders with. Exceptional overrides the tier
 * colour; the tier itself is untouched.
 *
 * Colour must never be the only rarity signal — pair this with the escalating
 * frame ornament so cards stay readable in greyscale.
 */
export function borderColorFor(tier: Tier, isExceptional = false): string {
  return isExceptional ? EXCEPTIONAL_COLOR : tierBand(tier).borderColor;
}

// ------------------------------------------------------------
// FLOAT BANDS — condition, presentational only
// ------------------------------------------------------------

/** Factory New, Minimal Wear, Field-Tested, Well Worn, Battle-Scarred. */
export type FloatBand = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';

export interface FloatBandSpec {
  band: FloatBand;
  label: string;
  /** Inclusive lower bound. */
  min: FloatValue;
  /** Exclusive upper bound, except the last band which includes 1.000. */
  max: FloatValue;
}

/**
 * Condition bands over the 0.000 (factory new) .. 1.000 (well worn) scale.
 *
 * These are a display grouping only. They are NOT in the schema and carry no
 * value: the money-side curve is `sku_float_curve` / fn_float_multiplier, and
 * rarity is `tier_bands`. Changing a band boundary changes a label, nothing else.
 */
export const FLOAT_BANDS: readonly FloatBandSpec[] = [
  { band: 'FN', label: 'Factory New', min: 0.0, max: 0.07 },
  { band: 'MW', label: 'Minimal Wear', min: 0.07, max: 0.15 },
  { band: 'FT', label: 'Field-Tested', min: 0.15, max: 0.38 },
  { band: 'WW', label: 'Well Worn', min: 0.38, max: 0.45 },
  { band: 'BS', label: 'Battle-Scarred', min: 0.45, max: 1.0 },
] as const;

/**
 * Condition band for a human-graded float. Clamps out-of-range input to the
 * nearest band rather than throwing: `items.float_value` is constrained to
 * 0..1 by the DB, so anything else is a display bug, not a data decision.
 */
export function floatBand(float: FloatValue): FloatBand {
  if (!Number.isFinite(float) || float <= 0) return 'FN';
  if (float >= 1) return 'BS';
  for (const spec of FLOAT_BANDS) {
    if (float >= spec.min && float < spec.max) return spec.band;
  }
  return 'BS';
}

export function floatBandSpec(band: FloatBand): FloatBandSpec {
  const spec = FLOAT_BANDS.find((b) => b.band === band);
  if (!spec) throw new Error(`unknown float band ${band}`);
  return spec;
}

/** 'Factory New' for 0.062. */
export function floatBandLabel(float: FloatValue): string {
  return floatBandSpec(floatBand(float)).label;
}

/** Always 3 decimals, matching numeric(4,3). '0.062', never '0.06'. */
export function formatFloat(float: FloatValue): string {
  return float.toFixed(3);
}
