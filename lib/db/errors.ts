/**
 * lib/db/errors.ts
 *
 * Postgres errors -> ContractError codes, so tracks C and D can branch on a
 * stable code instead of regexing server prose in a component.
 *
 * The mapping is derived from the exact `raise exception` strings in
 * 002_operations.sql, and each rule names the function it comes from. If a
 * .sql file changes a message, this file changes with it — the .sql files are
 * the source of truth.
 *
 * This module maps to a *code* only. lib/api/contract.ts builds the
 * ContractError itself, and always passes the server text through verbatim:
 * AGENT_RULES.md says surface server errors verbatim, never swallow one. The
 * code is an addition on top of the message, never a replacement for it.
 *
 * The `ContractErrorCode` import is type-only and erases at compile time, so
 * there is no import cycle with contract.ts at runtime.
 */

import type { ContractErrorCode } from '@/lib/api/contract';

/**
 * The shape supabase-js returns as `error`. Declared structurally rather than
 * imported from @supabase/supabase-js so this module does not depend on the
 * vendor shims, and so a plain object from a test can be passed straight in.
 */
export interface PostgresErrorLike {
  message: string;
  /** SQLSTATE, or a PGRST* code from PostgREST itself. */
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Message patterns, most specific first. Order is load-bearing:
 * `listing % is in early access until %` also matches the generic
 * `listing % is %` status pattern, so it has to be tested before it.
 */
const MESSAGE_RULES: readonly { pattern: RegExp; code: ContractErrorCode }[] = [
  // 005_admin_guards.sql, fn_require_admin() — raised by fn_mint_card and
  // fn_advance_consignment before anything else, so it is checked first here
  // too. Fires when the caller is not an admin, and also when the call was
  // made service-role: auth.uid() is null there, so no users row resolves.
  { pattern: /admin privileges required/i, code: 'FORBIDDEN' },

  // 008_grading.sql — the two check constraints on items. Matched by
  // constraint name, which Postgres puts in the message verbatim:
  // 'new row for relation "items" violates check constraint "<name>"'.
  // These come back as SQLSTATE 23514, which on its own says only "a check
  // failed" — the name is the only thing that says which.
  { pattern: /items_grade_components_sum/i, code: 'GRADE_COMPONENTS_MISMATCH' },
  { pattern: /items_grade_components_complete/i, code: 'GRADE_COMPONENTS_INCOMPLETE' },

  // 009_rls_sweep.sql — fn_mark_shipped. 'redemption % not found' rides the
  // generic not-found rule below.
  { pattern: /is already shipped/i, code: 'WRONG_STATUS' },

  // 011_credit_ledger.sql — fn_purchase_credit.
  // 'credit purchase must be positive, got %'
  { pattern: /credit purchase must be positive/i, code: 'INVALID_AMOUNT' },
  // fn_purchase_credit — 'minimum top-up is % cents, got %'
  { pattern: /minimum top-up is .+ cents/i, code: 'BELOW_MINIMUM_TOPUP' },
  // fn_purchase_card_with_credit — 'credit settlement is disabled'
  { pattern: /credit settlement is disabled/i, code: 'CREDIT_SETTLEMENT_DISABLED' },
  // fn_purchase_card_with_credit — 'insufficient credit: balance %, price %'
  { pattern: /insufficient credit/i, code: 'INSUFFICIENT_CREDIT' },

  // 011 fn_purchase_card_with_credit — 'listing % settles in cash and cannot
  // be bought with credit'; 012 fn_purchase_card — 'listing % settles in
  // credit and cannot be bought with cash'. Must precede the generic
  // `^listing\s+\S+\s+is\s+\S+$` status rule below (it does not match it — the
  // word is 'settles' — but the two belong next to each other).
  { pattern: /settles in (?:cash|credit) and cannot be bought/i, code: 'PAYOUT_MISMATCH' },

  // 013_seller_custody.sql — fn_submit_listing. Fires when the session has no
  // users row at all (unprovisioned sign-in) — same recovery as UNAUTHENTICATED.
  { pattern: /sign in to list an item/i, code: 'UNAUTHENTICATED' },
  // fn_submit_listing — 'this account cannot list items' (is_restricted)
  { pattern: /this account cannot list items/i, code: 'RESTRICTED' },
  // fn_submit_listing — cash / either settlement gated behind a completed-
  // fulfilment count, per platform_config.cash_payout_min_fulfilments.
  // 'cash settlement needs % completed fulfilments (you have %); list for credit first'
  { pattern: /cash settlement needs .+ completed fulfilments/i, code: 'UNPROVEN_SELLER' },
  // fn_submit_listing and fn_set_item_photos (010) — the submission and proof
  // gates both refuse fewer than four photos.
  { pattern: /at least 4 photos are required/i, code: 'TOO_FEW_PHOTOS' },
  // fn_submit_listing and fn_set_item_photos (010) — every photo must be an
  // https URL.
  { pattern: /photo entries must be https URLs/i, code: 'INVALID_PHOTO_URL' },
  // fn_submit_listing — 'price must be positive'. Same recovery as the 011
  // 'credit purchase must be positive' rule above.
  { pattern: /price must be positive/i, code: 'INVALID_AMOUNT' },
  // fn_confirm_shipment — the caller is neither the redemption's fulfiller nor
  // an admin.
  { pattern: /only the holder of this item can confirm shipment/i, code: 'NOT_FULFILLER' },
  // fn_record_proof — the caller is not the item's custody holder.
  { pattern: /you are not holding this item/i, code: 'NOT_OWNER' },
  // fn_confirm_shipment — carrier and tracking are required together.
  { pattern: /carrier and tracking are both required/i, code: 'INVALID_SHIPMENT' },
  // fn_reject_submission — 'item % is not pending review'
  { pattern: /is not pending review/i, code: 'WRONG_STATUS' },
  // fn_mark_default — 'redemption % is warehouse-fulfilled'
  { pattern: /is warehouse-fulfilled/i, code: 'WRONG_STATUS' },
  // fn_set_item_photos (010) via fn_record_proof — 'item % is minted; its
  // grading evidence is frozen', so proof cannot be recorded post-mint.
  { pattern: /grading evidence is frozen/i, code: 'WRONG_STATUS' },

  // 008_grading.sql — fn_grade_item, fn_reject_item. Checked before the
  // generic status rules below, which would otherwise not match at all.
  { pattern: /is already minted; its float is immutable/i, code: 'WRONG_STATUS' },
  { pattern: /is minted and cannot be rejected/i, code: 'WRONG_STATUS' },
  // 'item % is %, cannot be graded' / 'cannot be authenticated'
  { pattern: /,\s*cannot be (graded|authenticated)/i, code: 'WRONG_STATUS' },

  // fn_purchase_card — 'listing % is in early access until %'
  { pattern: /is in early access until/i, code: 'EARLY_ACCESS_LOCKED' },

  // fn_mint_card — 'sku % mint cap of % reached'
  { pattern: /mint cap of .+ reached/i, code: 'MINT_CAP_REACHED' },
  // fn_mint_card — 'item % has no human-assigned float'
  { pattern: /has no human-assigned float/i, code: 'NOT_GRADED' },
  // fn_mint_card — 'item % is not authenticated'
  { pattern: /is not authenticated/i, code: 'NOT_AUTHENTICATED' },
  // fn_mint_card — 'sku % has no oracle price; cannot assign tier'
  { pattern: /has no oracle price/i, code: 'NO_ORACLE_PRICE' },

  // fn_advance_consignment — 'illegal consignment transition % -> %'
  { pattern: /illegal consignment transition/i, code: 'ILLEGAL_TRANSITION' },

  // fn_purchase_card — 'cannot buy your own listing'
  { pattern: /cannot buy your own listing/i, code: 'SELF_PURCHASE' },

  // fn_list_card — 'card % is not owned by %'
  { pattern: /is not owned by/i, code: 'NOT_OWNER' },
  // fn_cancel_listing — 'not your listing'; fn_redeem_card — 'not your card'
  { pattern: /^not your (listing|card)$/i, code: 'NOT_OWNER' },

  // fn_mint_card, fn_list_card, fn_purchase_card, fn_advance_consignment —
  // '<thing> % not found'
  { pattern: /\bnot found\b/i, code: 'NOT_FOUND' },

  // fn_mint_card, fn_list_card, fn_redeem_card —
  // '<thing> % is %, expected <status>'. Must precede the bare form below.
  { pattern: /,\s*expected\s+\w+/i, code: 'WRONG_STATUS' },

  // fn_cancel_listing, fn_purchase_card — 'listing % is %'
  { pattern: /^listing\s+\S+\s+is\s+\S+$/i, code: 'WRONG_STATUS' },

  // 001_schema.sql, trg_ledger_immutable
  { pattern: /ledger_entries is append-only/i, code: 'FORBIDDEN' },
];

/**
 * SQLSTATE / PostgREST codes, consulted only when no message rule matched.
 *
 * P0001 is plpgsql's default for a bare `raise exception`, so it carries no
 * information beyond "one of the messages above" and is deliberately absent.
 */
const CODE_MAP: Readonly<Record<string, ContractErrorCode>> = {
  // A card already has a live listing (the partial unique index on
  // listings(card_id)), or an item is already minted (cards.item_id unique).
  // Both read as "that row is not in the state you thought it was".
  '23505': 'WRONG_STATUS',
  // References a row that does not exist.
  '23503': 'NOT_FOUND',
  // plpgsql's explicit "no row" (fn_replace_sku_art raises this with errcode
  // P0002 when the SKU is absent). Reads as NOT_FOUND like 23503.
  'P0002': 'NOT_FOUND',
  // RLS refused it, or the role lacks the grant.
  '42501': 'FORBIDDEN',
  // PostgREST: JWT missing, malformed, or expired.
  PGRST301: 'UNAUTHENTICATED',
  PGRST302: 'UNAUTHENTICATED',
};

/**
 * The ContractErrorCode a given Postgres error maps to. Falls back to
 * 'UNKNOWN' rather than guessing — an unmapped error still surfaces its
 * message verbatim, it just cannot be branched on.
 */
export function contractErrorCode(error: PostgresErrorLike): ContractErrorCode {
  const message = (error.message ?? '').trim();

  for (const rule of MESSAGE_RULES) {
    if (rule.pattern.test(message)) return rule.code;
  }

  return CODE_MAP[error.code ?? ''] ?? 'UNKNOWN';
}

/**
 * PostgREST's "no rows returned" from `.single()`. Not a failure for a read
 * that is allowed to come back empty — getCard() and friends return null.
 */
export function isNoRows(error: PostgresErrorLike | null | undefined): boolean {
  return error?.code === 'PGRST116';
}
