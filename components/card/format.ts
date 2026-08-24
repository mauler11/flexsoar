/**
 * components/card/format.ts
 *
 * Display formatting for the card surfaces. Money stays integer cents
 * everywhere; these functions only change how cents are *shown*.
 *
 * USD is the unit of account. Every price (listing price, oracle value, sale
 * gross/fee/net) is `formatUsd()`. FSC is earned-only store credit a seller
 * can be paid when Stripe cannot reach their country — it is never the price
 * of anything, so `formatFsc()` is only for an actual FSC amount (a balance,
 * a hold, a credit leg applied at checkout), never for a listing's price or
 * an oracle value, even though 1 FSC = 1 USD internally. See
 * AGENT_RULES.md §5/§6.
 *
 * `formatMyr()` is retained only because other tracks' already-shipped
 * screens still call it; do not add a new call site. AGENT_RULES.md §6 is
 * explicit that ringgit is never shown — a converted figure goes stale and
 * implies a rate FlexSoar does not offer. `MYR_PER_USD` was always a fixed
 * preview constant, never a rate source.
 */

/** Display-only MYR preview rate. Not a rate source. Do not add new callers. */
export const MYR_PER_USD = 4.2;

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents -> "$43.00". */
export function formatUsd(cents: number): string {
  return usdFormatter.format(cents / 100);
}

/** Integer cents -> "43.00 FSC". For an actual FSC amount only — never a price. */
export function formatFsc(cents: number): string {
  const [whole, frac] = (cents / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac} FSC`;
}

/** Integer cents -> "RM 180.60". Do not add new callers — see header. */
export function formatMyr(cents: number): string {
  const myr = (cents / 100) * MYR_PER_USD;
  const [whole, frac] = myr.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `RM ${grouped}.${frac}`;
}

/** Integer cents -> a plain "1,280.00" for tight labels. */
export function formatDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}
