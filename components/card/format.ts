/**
 * components/card/format.ts
 *
 * Display formatting for the card surfaces. Money stays integer cents
 * everywhere; these functions only change how cents are *shown*.
 *
 * MYR (sen) is the unit of account. Every price (listing price, oracle value,
 * sale gross/fee/net) is `formatMyr()`. FSC is earned-only store credit a
 * seller can be paid when Stripe cannot reach their country — it is never the
 * price of anything, so `formatFsc()` is only for an actual FSC amount (a
 * balance, a hold, a credit leg applied at checkout), never for a listing's
 * price or an oracle value, even though 1 FSC = RM1 internally. See
 * AGENT_RULES.md §5/§6.
 */

/** Integer sen -> "RM 180.00" (plain ASCII space, never ICU NBSP). */
export function formatMyr(cents: number): string {
  const [whole, frac] = (cents / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `RM ${grouped}.${frac}`;
}

/** Integer cents -> "180.00 FSC". For an actual FSC amount only — never a price. */
export function formatFsc(cents: number): string {
  const [whole, frac] = (cents / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac} FSC`;
}

/** Integer cents -> a plain "1,280.00" for tight labels. */
export function formatDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}
