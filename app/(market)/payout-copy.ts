/**
 * app/(market)/payout-copy.ts
 *
 * Seller payout copy, defined once (founder decision, 2026-10-20). Listings
 * are priced in MYR; the buyer pays USDC at a short-lived locked rate; the
 * seller gets 95% of that USDC on-chain to their linked Solana wallet and
 * FlexSoar keeps 5%. Malaysia-only sellers at launch. No bank/cash payout, no
 * store credit. Payments are not live yet, so nothing here may imply a seller
 * can be paid today.
 */

export const SELLER_PAYOUT_TITLE = "You'll be paid in USDC";

export const SELLER_PAYOUT_SUMMARY =
  "Listings are priced in RM. When a card sells, you get 95% of the buyer's USDC payment, sent on Solana to your linked wallet — FlexSoar keeps 5%. Selling is Malaysia-only at launch.";

export const NO_BANK_PAYOUT = "There is no bank or cash payout and no store credit.";

export const PAYMENTS_NOT_LIVE = "Payments aren't live yet, so no sale can be paid out today.";
