/**
 * components/card/format.ts
 *
 * Display formatting for the card surfaces. Money stays integer cents
 * everywhere; these functions only change how cents are *shown*.
 *
 * FSC is the on-platform display unit and 1 FSC = 1 USD. Ringgit is display
 * only — it is never stored, priced, or settled in. The conversion below is a
 * fixed preview constant for the styleguide, not a rate source; a real quotes
 * feed would live in the oracle (track/data), never in a component.
 */

/** Display-only MYR preview rate. Not a rate source. */
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

/** Integer cents -> "43.00 FSC". The marketplace's display unit. */
export function formatFsc(cents: number): string {
  const [whole, frac] = (cents / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac} FSC`;
}

/** Integer cents -> "RM 180.60", beneath the FSC figure. */
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
