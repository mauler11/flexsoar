/**
 * app/(market)/checkout-math.ts
 *
 * Pure decision logic for FSC-aware checkout — no Supabase, no Stripe, no
 * `next/headers`. Split out of actions.ts (which is `'use server'` and may
 * only export async functions) so this is directly unit-testable without
 * paying to resolve the Stripe/Supabase module graph, the same reasoning
 * track/data used for the webhook's own pure-logic tests (see
 * docs/handoff/data.md item 13, STEP 5).
 */

/**
 * The live `platform_config.credit_hold_minutes` value (verified live,
 * 2026-08-23: 1440). Not exposed by `getPlatformConfig()` — it only returns
 * `redemption_handling_fee_cents` / `credit_payout_enabled` /
 * `credit_payout_premium_bps` / `credit_purchase_min_cents` /
 * `show_numeric_float`. Filed in docs/handoff/market.md asking track/data to
 * add it; this fallback mirrors the existing `REDEMPTION_HANDLING_FEE_CENTS`
 * pattern in lib/api/contract.ts until then.
 */
export const CREDIT_HOLD_MINUTES_FALLBACK = 1440;

/** Stripe Checkout Session `expires_at` bounds: 30 minutes .. 24 hours. */
const STRIPE_MIN_EXPIRY_SECONDS = 30 * 60;
const STRIPE_MAX_EXPIRY_SECONDS = 24 * 60 * 60;
/**
 * A minute of slack below Stripe's exact 24h ceiling. credit_hold_minutes is
 * 1440 (exactly 24h) today; computing `now + 1440*60` and sending it to
 * Stripe a few hundred milliseconds later can land microseconds past what
 * Stripe's own clock considers "24 hours from creation" and get refused.
 * Shaving a minute off the ceiling costs nothing (the hold still outlives
 * the session either way) and removes the race.
 */
const STRIPE_MAX_EXPIRY_SAFETY_SECONDS = STRIPE_MAX_EXPIRY_SECONDS - 60;

export interface CreditRequestValidation {
  ok: boolean;
  /** Clamped to 0 on refusal — never read this when `ok` is false. */
  creditCents: number;
  error?: string;
}

/**
 * Validates the buyer-editable FSC amount server-side. A blank/omitted field
 * means "no FSC leg", not an error — the field is optional and the buyer may
 * lower it to zero. Anything else must be a non-negative integer that does
 * not exceed the listing price, and — the one the task calls out by name —
 * must not exceed what `getCreditAvailable()` says the buyer can actually
 * spend. All three are REFUSALS, not silent clamps: a client that posts more
 * than it may spend gets an error back, not a quietly-substituted lower
 * number it never agreed to.
 */
export function validateRequestedCredit(
  raw: unknown,
  priceCents: number,
  availableCents: number,
): CreditRequestValidation {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, creditCents: 0 };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false,
      creditCents: 0,
      error: 'FSC amount must be a whole number of cents, zero or more',
    };
  }
  if (parsed > priceCents) {
    return {
      ok: false,
      creditCents: 0,
      error: `requested ${parsed} FSC but the listing price is only ${priceCents}`,
    };
  }
  if (parsed > availableCents) {
    return {
      ok: false,
      creditCents: 0,
      error: `requested ${parsed} FSC but only ${availableCents} is available`,
    };
  }

  return { ok: true, creditCents: parsed };
}

/** The portion of the price that must move through Stripe. Never negative. */
export function cashLegCents(priceCents: number, creditCents: number): number {
  return Math.max(priceCents - creditCents, 0);
}

/** True when FSC alone covers the full price — no Stripe session at all. */
export function isFscOnlyPurchase(priceCents: number, creditCents: number): boolean {
  return cashLegCents(priceCents, creditCents) === 0;
}

/**
 * The Stripe Checkout Session `expires_at` (unix seconds) that keeps a
 * session from outliving the FSC hold it carries — a session that outlives
 * its hold means cash could be collected with no card transferred (the hold
 * frees the FSC out from under a settlement that is still in flight). Clamped
 * to Stripe's own [30min, 24h) bounds so a future config change can never
 * produce a value Stripe itself would reject.
 */
export function checkoutExpiresAtSeconds(nowMs: number, holdMinutes: number): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  const raw = nowSeconds + Math.round(holdMinutes * 60);
  const min = nowSeconds + STRIPE_MIN_EXPIRY_SECONDS;
  const max = nowSeconds + STRIPE_MAX_EXPIRY_SAFETY_SECONDS;
  return Math.min(Math.max(raw, min), max);
}
