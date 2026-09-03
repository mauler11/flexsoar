/**
 * FROZEN CONTRACT — signatures must not change. Only track/data may replace
 * the bodies.
 *
 * One exported function per RPC in 002_operations.sql, plus the read helpers
 * every UI track needs. Mutations map 1:1 onto the SECURITY DEFINER functions
 * via .rpc(); reads use .from() with explicit column projections.
 *
 * If you need something this file does not expose, append the request to
 * HANDOFF.md and work around it locally. Do not add a function here.
 *
 * ------------------------------------------------------------------
 * SANCTIONED EXTENSIONS.
 *
 * The freeze still holds for the original 16 functions: none of their
 * signatures, parameters or return types have changed. On explicit
 * instruction, surface was ADDED —
 *   008: gradeItem, authenticateItem, rejectItem, getItems
 *   009: markShipped, getRedemptions, upsertSku, setFloatCurve
 *   admin.md 3+4: getItem; consignment_id + consignor_id on ItemSummary
 *   015: replaceSkuArt
 *   018-020: purchaseCardSplit (the 4-arg fn_purchase_card), getPayoutMethodForUser,
 *     listConditionBands, getPlatformPosition, recordSweep, checkSolvency;
 *     condition_grade on ItemSummary/CardSummary/SubmissionSummary;
 *     credit_cents/cash_cents/seller_payout/payout_release_at on OrderSummary;
 *     show_numeric_float on PlatformConfig
 *   021: reserveCredit, releaseCreditHold, getCreditAvailable, getCreditHeld,
 *     expireCreditHolds; purchaseCardSplit's own signature extended in place
 *     with a 5th p_hold_id argument (it is a prior additive export, not one
 *     of the frozen 16, so this is an in-place change, not a new overload);
 *     new ContractErrorCode members for credit-hold provenance.
 *     purchaseCredit() and its BELOW_MINIMUM_TOPUP code are DELETED — 021
 *     revokes fn_purchase_credit's execute grant from every role including
 *     service_role. FSC is earned by selling, never bought. See
 *     docs/handoff/data.md for the one caller this left behind.
 *   022b: purchaseCardWithCredit() DELETED — 022b drops
 *     fn_purchase_card_with_credit(uuid, uuid), the last pre-019c
 *     credit-only settlement path, from the database. The unified
 *     fn_purchase_card(p_listing_id, p_buyer_id, p_settlement_ref,
 *     p_credit_cents, p_hold_id) (purchaseCard/purchaseCardSplit) is the
 *     only settlement entry point now. No caller existed anywhere in app/**.
 *     Also: 022b moves fn_expire_credit_holds()'s grant from `authenticated`
 *     (021) to `service_role` only. expireCreditHolds() (a prior additive
 *     export, in-place fix, not a new one) is switched from the session
 *     client to createServiceSupabase() to match — it was calling a function
 *     it no longer has execute on, and would have failed FORBIDDEN on every
 *     call. Needed so the checkout-webhook wiring in this pass has a working
 *     service-role path to sweep expired holds on checkout.session.expired.
 *   023a/023c: credit_hold_minutes on PlatformConfig (CREDIT_HOLD_MINUTES_FALLBACK
 *     for a database with no row); getVaultIntakeForCard, a new read of the
 *     023c vault_intakes table (not a frozen-contract write, so this is
 *     additive consistency, not a violation being closed).
 *   025: setCountry (fn_set_country — session client only, writes exactly the
 *     caller's own users.country_code, no p_user argument exists to write
 *     anyone else's); new ContractErrorCode member INVALID_COUNTRY_CODE.
 *     COUNTRY_NOT_SET (fn_payout_method_for_user's raise) landed earlier,
 *     ef83d6d — not re-added here.
 *   027: SKU identity split into model (sku_models: brand+model+colorway,
 *     the ORACLE base_price_cents, the shared art) + variant (skus: size_us,
 *     size_multiplier, price_override_cents). New: listSkuModels,
 *     getSkuModel, createSkuModel (fn_create_sku_model), updateSkuModel
 *     (direct table write, sku_models_admin_write), ensureSkuVariant
 *     (fn_ensure_sku_variant), updateSkuVariant (direct table write,
 *     skus_admin_write); model_id/size_multiplier/price_override_cents on
 *     Sku; new ContractErrorCode members MARKET_PRICE_IS_DERIVED,
 *     SKU_MODEL_IDENTITY_REQUIRED, INVALID_SKU_SIZE,
 *     SKU_CREATION_REQUIRES_MODEL. replaceSkuArt's signature is UNCHANGED —
 *     027 keeps it (uuid, text) -> skus, it just now writes the MODEL's art
 *     and propagates to every sibling size (fn_sync_sku_variants).
 *     upsertSku's body changed (its signature is NOT one of the frozen 16 —
 *     it is itself a 009 sanctioned extension): a direct write of
 *     market_price_cents now throws MARKET_PRICE_IS_DERIVED instead of
 *     reaching the database, and an insert (no id) throws
 *     SKU_CREATION_REQUIRES_MODEL — skus.model_id is NOT NULL as of 027 and
 *     UpsertSkuInput has no way to supply one. See upsertSku's doc comment
 *     and docs/handoff/data.md for the admin-track ask this creates.
 *     getSkus()'s tier filter also changed: SkusQuery.tier now matches on
 *     sku_models.base_price_cents (what fn_tier_for_sku actually reads),
 *     not skus.market_price_cents — those two only agree when a variant has
 *     no price_override and a 1.000 size_multiplier.
 *   027 follow-up (docs/handoff/admin.md item 14, the rename half): new
 *     renameSkuModel(), a direct table write under sku_models_admin_write
 *     (same guard shape as updateSkuModel(), which deliberately excludes
 *     brand/model/colorway — see UpdateSkuModelInput's doc comment, unchanged
 *     here). New ContractErrorCode member SKU_MODEL_IDENTITY_CONFLICT for a
 *     rename that collides with another model's (brand, model, colorway) —
 *     sku_models_identity_uidx — mapped instead of a raw 23505. Variant
 *     identity (skus.brand/model/colorway) propagates to every size on a
 *     rename through the EXISTING path (trg_sku_model_propagate ->
 *     fn_sync_sku_variants -> an UPDATE on skus, which unconditionally
 *     re-fires trg_sku_variant_derive's `new.brand/model/colorway := v_m.*`
 *     on every row it touches, not just the columns fn_sync_sku_variants'
 *     own SET list names) — verified by reading 027_sku_models.sql itself,
 *     not by probing the live project; see renameSkuModel()'s doc comment.
 * along with their query/input types and new ContractErrorCode members.
 * Additive only: nothing that existed before behaves differently.
 *
 * Each grant was for its request. It is not standing permission — the rule
 * above still applies to everything else, so file a handoff request rather
 * than appending more.
 * ------------------------------------------------------------------
 *
 * Rules this contract encodes:
 *   - Mutations map 1:1 onto the SECURITY DEFINER functions. No table has an
 *     INSERT or UPDATE policy, so there is no second write path.
 *   - Money settles buyer -> seller in Stripe BEFORE purchaseCard records it.
 *     purchaseCard is called from the webhook only, never from client code.
 *   - Reads project columns. Never select *.
 *   - Server errors surface verbatim. Never swallow one.
 *
 * ------------------------------------------------------------------
 * THIS MODULE IS SERVER-ONLY.
 *
 * It reaches lib/supabase/server.ts, which reads `next/headers` for the
 * session cookie and holds the service-role path for purchaseCard() and
 * refreshLevels(). Importing it from a client component is a build error, and
 * that is the point: the service role key must never enter a client bundle.
 *
 * Client components reach these functions through a Server Action or a route
 * handler. See HANDOFF.md.
 * ------------------------------------------------------------------
 */

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import {
  contractErrorCode,
  isNoRows,
  type PostgresErrorLike,
} from '@/lib/db/errors';
import {
  cardValueCents,
  floatMultiplier,
  type FloatCurveRow,
} from '@/lib/db/valuation';
import { TIER_BANDS } from '@/lib/domain/rarity';
import type { GradeComponents } from '@/lib/db/grading';
import {
  sendSubmissionApprovedEmail,
  type SubmissionApprovedEmailInput,
} from '@/lib/email/send';

import type {
  Card,
  CardStatus,
  Cents,
  ConditionGrade,
  Consignment,
  ConsignmentEvent,
  ConsignmentStatus,
  CustodyModel,
  FloatValue,
  GradeSource,
  Item,
  ItemStatus,
  Json,
  Listing,
  ListingStatus,
  Order,
  OrderStatus,
  PayoutMethod,
  RedemptionStatus,
  Sku,
  SkuModel,
  Tier,
  Timestamptz,
  User,
  UUID,
} from '@/lib/db/types';

import Stripe from 'stripe';

// ============================================================
// ERRORS
// ============================================================

/**
 * Postgres `raise exception` messages, mapped to codes UI tracks can branch
 * on. `message` always carries the server text verbatim.
 */
export type ContractErrorCode =
  | 'NOT_FOUND'
  | 'NOT_OWNER'
  | 'WRONG_STATUS'
  | 'EARLY_ACCESS_LOCKED'
  | 'MINT_CAP_REACHED'
  | 'NOT_GRADED'
  | 'NOT_AUTHENTICATED'
  | 'NO_ORACLE_PRICE'
  | 'ILLEGAL_TRANSITION'
  | 'SELF_PURCHASE'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  /**
   * A positive-amount check failed. 013 fn_submit_listing — 'price must be
   * positive'. 021 fn_reserve_credit — 'reserve amount must be positive', or
   * p_credit_cents greater than the listing's own price ('reserve of %
   * exceeds listing price %' — distinct from settlement, which clamps
   * p_credit_cents to the price silently rather than raising).
   */
  | 'INVALID_AMOUNT'
  /**
   * fn_purchase_card_core (019c/021) — 'FSC settlement is disabled' when
   * platform_config.credit_payout_enabled is false, so the seller-takes-
   * credit leg is switched off. 011/014's fn_purchase_card_with_credit
   * raised the same condition worded 'credit settlement is disabled'; that
   * function was dropped in 022b, so only the current wording applies now.
   */
  | 'CREDIT_SETTLEMENT_DISABLED'
  /**
   * Not enough spendable FSC. 021 fn_purchase_card_core — 'insufficient FSC:
   * balance %, requested %' (the buyer's ledger balance, ignoring holds).
   * 021 fn_reserve_credit — 'insufficient available FSC: % available, %
   * requested' (balance minus other active holds — see getCreditAvailable()).
   * Both raises map here; branch on the message if the distinction matters.
   */
  | 'INSUFFICIENT_CREDIT'
  /**
   * DEAD as of 022/022b: both raising functions are dropped — 011/014's
   * fn_purchase_card_with_credit ('listing % settles in cash and cannot be
   * bought with credit') and 012's payout-guarded fn_purchase_card ('listing
   * % settles in credit and cannot be bought with cash'). fn_purchase_card_core
   * (021, the only settlement function left) never refuses on payout method
   * at all — buyer settlement and seller payout are independent axes (see
   * AGENT_RULES.md section 5). This member is kept only because
   * app/api/webhooks/stripe/route.ts's isPermanentError() still checks
   * thrown.code === 'PAYOUT_MISMATCH'; that branch can no longer fire.
   */
  | 'PAYOUT_MISMATCH'
  /**
   * items_grade_components_sum: the six component scores were supplied, but
   * `float` is not their weighted sum. The grader scores components and the
   * float falls out — this fires when someone picked the float first. Show the
   * computed value and let them accept it.
   */
  | 'GRADE_COMPONENTS_MISMATCH'
  /**
   * items_grade_components_complete: some but not all six components. It is
   * all six or none; there is no partial grade.
   */
  | 'GRADE_COMPONENTS_INCOMPLETE'
  /**
   * 013 fn_submit_listing — users.is_restricted, so the account may not list
   * items.
   */
  | 'RESTRICTED'
  /**
   * 013 fn_submit_listing — cash/either settlement gated behind a completed-
   * fulfilment count (platform_config.cash_payout_min_fulfilments). The
   * seller is not yet proven; list for credit first.
   */
  | 'UNPROVEN_SELLER'
  /**
   * 013 fn_submit_listing / fn_record_proof — fewer than four photos.
   */
  | 'TOO_FEW_PHOTOS'
  /**
   * 013 fn_submit_listing / fn_record_proof — a photo entry that is not an
   * https URL.
   */
  | 'INVALID_PHOTO_URL'
  /**
   * 013 fn_confirm_shipment — the caller is neither the redemption's fulfiller
   * nor an admin.
   */
  | 'NOT_FULFILLER'
  /**
   * 013 fn_confirm_shipment — carrier and tracking are required together.
   */
  | 'INVALID_SHIPMENT'
  /**
   * fn_purchase_card_core (018-020/021, purchaseCardSplit) — 'a cash leg of
   * % cents requires a settlement_ref'. The cash remainder (price_cents -
   * credit_cents) is greater than zero but settlementRef is null or empty.
   * Cash-only and split settlements both need a real ref; FSC-only
   * (credit_cents = price_cents) is the one case that may pass null.
   */
  | 'SETTLEMENT_REF_REQUIRED'
  /**
   * 020 fn_guard_sweep (trigger on sweeps insert) — p_amount_cents is
   * greater than fn_platform_position().unswept_cents. Re-read the position
   * before retrying; sweepable_cents (unswept minus the chargeback reserve)
   * is the safe upper bound, not unswept_cents itself.
   */
  | 'SWEEP_EXCEEDS_UNSWEPT'
  /**
   * 021 fn_purchase_card_core — the credit leg has no provenance: no
   * p_hold_id, and the caller's own session (if any) does not match
   * p_buyer_id. This is what stops the webhook, which has no session at
   * all, from spending a buyer's FSC without a hold that buyer's own
   * session created. purchaseCardSplit() throws this itself, client-side,
   * before ever reaching the database — see its doc comment.
   */
  | 'CREDIT_PROVENANCE_REQUIRED'
  /**
   * 021 fn_purchase_card_core — 'credit hold % expired at %'. The hold was
   * still 'active' in the row, but its expires_at has passed; the row is
   * flipped to 'expired' in the same statement that raises this.
   */
  | 'CREDIT_HOLD_EXPIRED'
  /**
   * 021 fn_purchase_card_core ('credit hold % belongs to another user') and
   * fn_release_credit_hold ('hold % does not belong to you') — the hold's
   * user_id does not match the caller (settlement's p_buyer_id, or the
   * releasing session).
   */
  | 'CREDIT_HOLD_WRONG_USER'
  /**
   * 021 fn_purchase_card_core — 'credit hold % is for a different listing'.
   * The hold was reserved against a different listing than the one being
   * settled.
   */
  | 'CREDIT_HOLD_WRONG_LISTING'
  /**
   * 021 fn_purchase_card_core — 'credit hold % covers only % of %
   * requested'. The hold's amount_cents is smaller than the credit_cents
   * this settlement is asking to spend.
   */
  | 'CREDIT_HOLD_INSUFFICIENT'
  /**
   * 025_user_country.sql fn_payout_method_for_user — 'user % has no country
   * on file, so their payout cannot be determined - set one before listing'.
   * Reachable from settlement itself: fn_purchase_card_core
   * (021_credit_holds.sql:325) calls fn_payout_method_for_user(seller_id)
   * inside the transaction, so a pre-025 listing whose seller never set a
   * country raises this mid-settlement, after the buyer's card has already
   * been charged through Stripe. Same shape as CREDIT_HOLD_EXPIRED — not
   * swallowed into isPermanentError()'s quiet acknowledge, see the call site
   * in app/api/webhooks/stripe/route.ts.
   */
  | 'COUNTRY_NOT_SET'
  /**
   * 025_user_country.sql fn_set_country — 'country must be a two-letter ISO
   * country code, got %'. p_country, upper-cased and trimmed, does not match
   * `^[A-Z]{2}$`. Shape-only validation (025's own comment: not checked
   * against a table of real codes, since cash_payout_countries already
   * decides the only thing the platform acts on) — a syntactically valid but
   * unrecognised code is accepted and simply resolves to 'credit' payout.
   */
  | 'INVALID_COUNTRY_CODE'
  /**
   * 027_sku_models.sql trg_sku_variant_derive — 'skus.market_price_cents is
   * derived (%). Set sku_models.base_price_cents or skus.price_override_cents
   * instead of writing it directly.' upsertSku() throws this itself,
   * client-side, the moment a caller supplies market_price_cents — see its
   * doc comment. This code only reaches a caller from the database if some
   * other write path bypasses that guard.
   */
  | 'MARKET_PRICE_IS_DERIVED'
  /**
   * 027_sku_models.sql fn_create_sku_model — 'brand, model and colorway are
   * all required'. One of the three identity fields was blank after trimming.
   */
  | 'SKU_MODEL_IDENTITY_REQUIRED'
  /**
   * 027_sku_models.sql fn_ensure_sku_variant — 'size % is outside the
   * supported range (3 to 20)' or 'size % is not a whole or half size'.
   */
  | 'INVALID_SKU_SIZE'
  /**
   * upsertSku() throws this itself, client-side — skus.model_id is NOT NULL
   * as of 027 and UpsertSkuInput has no field to supply one, so a direct
   * insert (no id) can no longer succeed. Create the model first
   * (createSkuModel) then the variant (ensureSkuVariant).
   */
  | 'SKU_CREATION_REQUIRES_MODEL'
  /**
   * sku_models_identity_uidx (027_sku_models.sql) — renameSkuModel()'s new
   * (brand, model, colorway) triple already belongs to a DIFFERENT model.
   * Postgres 23505 on that constraint, mapped here instead of the generic
   * CODE_MAP fallback for 23505 (WRONG_STATUS — borrowed from the
   * listings/cards "already in that state" case, and misleading for an
   * identity collision). This is the expected way a duplicate-merge tool
   * would discover two rows describe the same shoe; renameSkuModel()'s own
   * doc comment has the full context.
   */
  | 'SKU_MODEL_IDENTITY_CONFLICT'
  | 'UNKNOWN';

export class ContractError extends Error {
  readonly code: ContractErrorCode;
  /** The raw PostgrestError or thrown value, kept for logging. */
  readonly detail: unknown;

  constructor(code: ContractErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.detail = detail;
  }
}

// ============================================================
// SHARED SHAPES
// ============================================================

/** `redemptions.shipping_address` jsonb payload. */
export interface ShippingAddress {
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  /** ISO 3166-1 alpha-2. */
  country_code: string;
  phone: string | null;
}

/** How to look a user up. */
export type UserLookup =
  | { id: UUID }
  | { handle: string }
  | { authId: UUID };

export interface UserSummary {
  id: UUID;
  handle: string;
  level: number;
  xp_total: number;
  portfolio_value_cents: Cents;
  is_admin: boolean;
  is_consignor: boolean;
  created_at: Timestamptz;
}

/**
 * One profile for app/(market)/u/[handle]. Reads the `public_profiles` view —
 * NEVER the `users` table — and joins `levels` for the rank name.
 * 006_users_rls.sql locked `users` down to self-read (or admin) and
 * 007_profile_updates.sql widened the view to carry portfolio_value_cents;
 * both make the "read the view, not the table" distinction load-bearing.
 *
 * Deliberately carries no email, auth_id, kyc_status, is_admin or is_consignor
 * — the view is the line 006 draws, and this is a read anyone, anonymous
 * visitor included, may make.
 */
export interface PublicProfile {
  id: UUID;
  handle: string;
  level: number;
  /** levels.name for the profile's level — "Runner" .. "Mob Boss". */
  rank_name: string;
  xp_total: number;
  portfolio_value_cents: Cents;
  created_at: Timestamptz;
}

/** The catalog columns a card needs to render. */
export interface SkuRef {
  id: UUID;
  brand: string;
  model: string;
  colorway: string;
  size_us: number;
  market_price_cents: Cents | null;
  sprite_key: string | null;
  palette: Json | null;
  /** Uploaded pixel-art PNG (012). null falls back to the sprite renderer. */
  art_url: string | null;
}

/**
 * listSkuModels() row (027). The metric 027 exists to make measurable is
 * "models with more than one card" — variant_count and card_count are computed
 * from skus/cards, not columns on sku_models itself.
 */
export interface SkuModelSummary extends SkuModel {
  variant_count: number;
  card_count: number;
}

/** getSkuModel() result (027): one model plus every size variant beneath it. */
export interface SkuModelDetail extends SkuModel {
  variants: Sku[];
}

/** The active listing on a card, if there is one. */
export interface ListingRef {
  id: UUID;
  price_cents: Cents;
  status: ListingStatus;
  early_access_level: number;
  public_at: Timestamptz;
  oracle_value_cents: Cents | null;
}

export interface CardSummary {
  id: UUID;
  sku_id: UUID;
  item_id: UUID;
  owner_id: UUID;
  float_value: FloatValue;
  float_percentile: number | null;
  tier: Tier;
  is_exceptional: boolean;
  mint_number: number;
  status: CardStatus;
  minted_at: Timestamptz;
  /**
   * 018-020, trigger-derived from float_value — always present on a card
   * (cards.float_value is NOT NULL). The display label for it comes from
   * listConditionBands(), not from formatting this string.
   */
  condition_grade: ConditionGrade;
  sku: SkuRef;
  /** Populated only for status in ('early_access','public'). */
  listing: ListingRef | null;
}

/** One hop in the ownership chain, oldest first. */
export interface ProvenanceEntry {
  owner: UserSummary;
  /** The owner's level at acquisition, frozen at that moment. */
  owner_level: number;
  acquired_at: Timestamptz;
  released_at: Timestamptz | null;
  price_cents: Cents | null;
}

export interface CardDetail extends CardSummary {
  exceptional_reason: string | null;
  owner: UserSummary;
  /** The physical side. Photos and grading notes come from intake. */
  item: Pick<
    Item,
    'id' | 'status' | 'photos' | 'grading_notes' | 'graded_at' | 'authenticated_at' | 'custody_location'
  >;
  /** fn_card_value_cents(). Shown beside any price, never hidden. */
  oracle_value_cents: Cents | null;
  provenance: ProvenanceEntry[];
}

export interface ListingSummary {
  id: UUID;
  card_id: UUID;
  seller_id: UUID;
  price_cents: Cents;
  fair_price_cents: Cents | null;
  status: ListingStatus;
  early_access_level: number;
  public_at: Timestamptz;
  oracle_value_cents: Cents | null;
  created_at: Timestamptz;
  sold_at: Timestamptz | null;
  card: CardSummary;
  seller: UserSummary;
}

/**
 * fn_payout_method_for_user's return, and orders.seller_payout — narrower
 * than PayoutMethod (018-020): a seller is always paid 'cash' or 'credit',
 * never 'either'. 'either' is a listing's own settlement election
 * (ItemSummary.submitted_payout / SubmitListingInput.payoutMethod) — the
 * buyer's side of the trade, not the seller's payout route.
 */
export type DerivedPayoutMethod = Extract<PayoutMethod, 'cash' | 'credit'>;

export interface OrderSummary {
  id: UUID;
  listing_id: UUID;
  card_id: UUID;
  buyer_id: UUID;
  seller_id: UUID;
  gross_cents: Cents;
  fee_bps: number;
  fee_cents: Cents;
  net_cents: Cents;
  settlement_ref: string | null;
  status: OrderStatus;
  created_at: Timestamptz;
  /**
   * 018-020 split settlement. credit_cents + cash_cents = gross_cents always
   * — the invariant fn_purchase_card_core enforces on write.
   */
  credit_cents: Cents;
  cash_cents: Cents;
  /**
   * fn_payout_method_for_user(seller_id), frozen at settlement — NEVER read
   * listings.payout_method for this; that column is a cached display value
   * only (see the WHAT CHANGED note in docs/handoff/data.md).
   */
  seller_payout: DerivedPayoutMethod | null;
  payout_release_at: Timestamptz | null;
}

export interface ListingDetail extends ListingSummary {
  /**
   * Null until the Stripe webhook calls purchaseCard. Poll getListing() after
   * checkout and wait for `order.status === 'settled'` — the client never
   * calls purchaseCard itself.
   */
  order: OrderSummary | null;
}

export interface ItemSummary {
  id: UUID;
  sku_id: UUID;
  /**
   * Link columns, added for docs/handoff/admin.md item 4: the mint action
   * resolves each item's consignor as the mint owner, and the grading bench
   * links back to the consignment. Null for house-owned or orphaned stock.
   */
  consignment_id: UUID | null;
  consignor_id: UUID | null;
  status: ItemStatus;
  float_value: FloatValue | null;
  /**
   * 018-020, trigger-derived from float_value — null exactly when float_value
   * is (pre-grade). See CardSummary.condition_grade for the minted-card
   * mirror, which is never null.
   */
  condition_grade: ConditionGrade | null;
  graded_at: Timestamptz | null;
  grading_notes: string | null;
  photos: Json;
  authenticated_at: Timestamptz | null;
  custody_location: string | null;
  reserve_price_cents: Cents | null;
  sku: SkuRef;
  /** Null until the item is minted. */
  card_id: UUID | null;
  /**
   * Added by 008. Null on rows graded before it, and null together — never a
   * partial set. Additive: existing readers that ignore this still compile.
   */
  grade: GradeComponents | null;
  /**
   * 013 custody. These are NOT NULL with defaults on every row (the migration
   * backfilled them), so unlike the `Item` db type they are not optional here
   * — a row from the database always carries them.
   */
  custody: CustodyModel;
  custody_holder_id: UUID | null;
  grade_source: GradeSource;
  asking_price_cents: Cents | null;
  submitted_payout: PayoutMethod;
  last_proof_at: Timestamptz | null;
}

/**
 * One review-queue row: a seller-held submission waiting for admin sign-off.
 * Added for 013. It is the sell-side mirror of RedemptionSummary: the item a
 * submitter declared, with the seller-declared condition and the admin's
 * review inputs. `grade` is present on every submission uploaded after 013 —
 * fn_submit_listing always writes all six scores.
 */
export interface SubmissionSummary {
  id: UUID;
  sku_id: UUID;
  status: ItemStatus;
  float_value: FloatValue | null;
  /** 018-020, trigger-derived from float_value. See ItemSummary.condition_grade. */
  condition_grade: ConditionGrade | null;
  /**
   * The seller's own six condition scores, always present on a 013
   * submission. NOT a FlexSoar grade — grade_source says which it is.
   */
  grade: GradeComponents;
  /** jsonb. The seller's proof-of-possession photos, 4+. */
  photos: Json;
  asking_price_cents: Cents | null;
  submitted_payout: PayoutMethod;
  custody: CustodyModel;
  custody_holder_id: UUID | null;
  grade_source: GradeSource;
  last_proof_at: Timestamptz | null;
  authenticated_at: Timestamptz | null;
  created_at: Timestamptz;
  sku: SkuRef;
  /** The seller who submitted — the custody holder, in the launch model. */
  seller: UserSummary;
}

/**
 * One fulfilment queue row: the redemption plus everything the packing bench
 * needs to act on it. Added for 009 alongside redemptions_admin_read.
 */
export interface RedemptionSummary {
  id: UUID;
  card_id: UUID;
  item_id: UUID;
  user_id: UUID;
  handling_fee_cents: Cents;
  /** ShippingAddress as written by redeemCard. Typed Json because jsonb. */
  shipping_address: Json;
  status: RedemptionStatus;
  carrier: string | null;
  tracking_number: string | null;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
  /** The burned claim, with its SKU — brand, model, size, sprite. */
  card: CardSummary;
  /** The physical side being pulled from custody. */
  item: Pick<Item, 'id' | 'status' | 'custody_location'>;
  /**
   * Who redeemed. Embedded profile — placeholder caveats from item 14 apply.
   * Embeds are disambiguated since 013 gave `redemptions` two FKs to `users`
   * (re-deemer through redemptions_user_id_fkey).
   */
  redeemer: UserSummary;
  /**
   * 013 seller custody. The holder who must dispatch the parcel — null for a
   * warehouse-fulfilled redemption (no fulfiller was ever assigned).
   */
  fulfiller: UserSummary | null;
}

export interface ConsignmentSummary extends Consignment {
  consignor: UserSummary;
}

export interface ConsignmentDetail extends ConsignmentSummary {
  items: ItemSummary[];
  /** Oldest first. */
  events: ConsignmentEvent[];
}

// ============================================================
// QUERIES
// ============================================================

export type CardSort =
  | 'recent'
  | 'float_asc'
  | 'float_desc'
  | 'mint_asc'
  | 'value_asc'
  | 'value_desc';

export interface CardsQuery {
  ownerId?: UUID;
  skuId?: UUID;
  status?: CardStatus[];
  tier?: Tier[];
  brand?: string;
  model?: string;
  sizeUs?: number;
  /** Inclusive. */
  floatMin?: FloatValue;
  /** Inclusive. */
  floatMax?: FloatValue;
  isExceptional?: boolean;
  sort?: CardSort;
  limit?: number;
  offset?: number;
}

export type ListingSort =
  | 'recent'
  | 'price_asc'
  | 'price_desc'
  | 'float_asc'
  | 'float_desc'
  | 'public_at_asc';

export interface ListingsQuery {
  status?: ListingStatus[];
  sellerId?: UUID;
  cardId?: UUID;
  skuId?: UUID;
  tier?: Tier[];
  brand?: string;
  model?: string;
  sizeUs?: number;
  floatMin?: FloatValue;
  floatMax?: FloatValue;
  priceMinCents?: Cents;
  priceMaxCents?: Cents;
  /**
   * Who is looking. Early-access listings stay visible to a viewer whose level
   * meets `early_access_level`, to the seller, and to nobody else until
   * `public_at`. Omit for the anonymous view.
   */
  viewerId?: UUID;
  sort?: ListingSort;
  limit?: number;
  offset?: number;
}

export interface ConsignmentsQuery {
  consignorId?: UUID;
  status?: ConsignmentStatus[];
  limit?: number;
  offset?: number;
}

/**
 * The grading queue. Added by 008 — nothing else exposes items across
 * consignments, and the admin queue is inherently a cross-consignment view.
 *
 * `graded` and `authenticated` filter on presence of the timestamp, not on
 * status, because the two are independent: an item can be authenticated before
 * it is graded or the other way round, and only when both have happened does
 * fn_grade_item / fn_authenticate_item move it to `in_custody`. The queue that
 * matters most is `{ graded: false }`.
 */
export interface ItemsQuery {
  status?: ItemStatus[];
  consignmentId?: UUID;
  /** true = graded_at is set; false = still ungraded. Omit for either. */
  graded?: boolean;
  /** true = authenticated_at is set; false = not yet. Omit for either. */
  authenticated?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * submitListing() input (013). The six condition scores are the seller's
 * self-declared rubric; fn_submit_listing computes the float from them the
 * same way the grader does, and grade_source records they are seller-claimed.
 */
export interface SubmitListingInput {
  skuId: UUID;
  priceCents: Cents;
  /** 'credit' is the default and the only unproven-seller-settable one. */
  payoutMethod: PayoutMethod;
  /**
   * Proof of possession, 4+. Every entry must be a plain https URL —
   * fn_submit_listing rejects anything else (INVALID_PHOTO_URL).
   */
  photos: string[];
  /** Six self-declared condition scores, each 0.00..1.00. */
  grade: GradeComponents;
  notes?: string | null;
}

/**
 * The fulfilment queue. What a session sees is what 009's policies allow:
 * admins everything, users their own redemptions, everyone else nothing.
 */
export interface RedemptionsQuery {
  status?: RedemptionStatus[];
  userId?: UUID;
  limit?: number;
  offset?: number;
}

/**
 * The review queue. Defaults to the admin's in-box — items sitting in
 * 'pending_review'. Visibility is 013's policies, exactly like the other
 * queues: admins see everything, a custody holder (or consignor) sees only
 * their own, and an empty array means "none you may see".
 */
export interface SubmissionsQuery {
  /** Defaults to ['pending_review']. Wildcard with the rest of ItemStatus. */
  status?: ItemStatus[];
  limit?: number;
  offset?: number;
}

/**
 * upsertSku() input. `id` present = update that row; absent = insert. The
 * four natural-key columns are required either way because the unique index
 * on (brand, model, colorway, size_us) is what a duplicate collides on, and
 * an insert missing any of them is rejected by NOT NULL regardless.
 */
export interface UpsertSkuInput {
  id?: UUID;
  brand: string;
  model: string;
  colorway: string;
  size_us: number;
  retail_price_cents?: Cents | null;
  /**
   * DEAD FOR WRITES as of 027 — skus.market_price_cents is now a derived
   * column (coalesce(price_override_cents, sku_models.base_price_cents x
   * size_multiplier)), maintained by a trigger that raises on a direct
   * write. Supplying this field makes upsertSku() throw
   * MARKET_PRICE_IS_DERIVED before it ever reaches the database — it never
   * silently drops or misroutes the value. Kept on the type only so an
   * existing caller that reads a Sku back and round-trips it into
   * UpsertSkuInput still compiles; use updateSkuModel() (the oracle) or
   * updateSkuVariant() (a per-size override) instead.
   */
  market_price_cents?: Cents | null;
  price_confidence?: number | null;
  priced_at?: Timestamptz | null;
  demand_score?: number;
  sprite_key?: string | null;
  /** Char -> hex map. Validate against the 9 sprite glyphs before saving. */
  palette?: Json | null;
  /** Uploaded pixel-art PNG (012). https-only, enforced by the column check. */
  art_url?: string | null;
  mint_cap?: number | null;
}

/** One band of a SKU's value curve. Lower bound inclusive, upper exclusive. */
export interface FloatCurveBand {
  float_min: FloatValue;
  float_max: FloatValue;
  /** numeric(4,3). 1.000 = full oracle price at this condition. */
  value_multiplier: number;
}

export interface SkusQuery {
  brand?: string;
  model?: string;
  sizeUs?: number;
  /** Free-text over brand / model / colorway. */
  search?: string;
  /** Tier of the SKU's base market price. */
  tier?: Tier[];
  limit?: number;
  offset?: number;
}

/** listSkuModels() / getSkuModel() input (027). */
export interface SkuModelsQuery {
  brand?: string;
  model?: string;
  /** Free-text over brand / model / colorway. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * updateSkuModel() input (027). Direct table write under
 * sku_models_admin_write — same guard shape as UpsertSkuInput. `art_url` is
 * deliberately absent: art is one asset per model and the only sanctioned
 * write path is replaceSkuArt() (fn_replace_sku_art), which propagates to
 * every size. Everything here is the model-level oracle and its metadata.
 */
export interface UpdateSkuModelInput {
  base_price_cents?: Cents | null;
  price_confidence?: number | null;
  priced_at?: Timestamptz | null;
  sprite_key?: string | null;
  /** Char -> hex map. Validate against the 9 sprite glyphs before saving. */
  palette?: Json | null;
  demand_score?: number;
}

/**
 * renameSkuModel() input. Separate from UpdateSkuModelInput on purpose: that
 * type deliberately excludes these three columns (see its doc comment and
 * docs/handoff/admin.md item 14) because a rename is a different decision
 * from an oracle-price edit, and giving it its own type keeps a caller from
 * accidentally renaming a model while only meaning to reprice it.
 *
 * All three are optional so a caller can fix one field (a colorway typo)
 * without restating the other two — but at least one must be supplied, and
 * whichever ARE supplied must be non-blank after trimming; renameSkuModel()
 * checks both itself, client-side, before touching the database.
 */
export interface RenameSkuModelInput {
  brand?: string;
  model?: string;
  colorway?: string;
}

/**
 * updateSkuVariant() input (027). Direct table write under skus_admin_write.
 * Deliberately just these two columns — market_price_cents is derived from
 * them by trg_sku_variant_derive and is not settable here or anywhere else.
 */
export interface UpdateSkuVariantInput {
  /** numeric(5,3), 0 < x <= 10. Ships flat at 1.000 for every variant. */
  size_multiplier?: number;
  /** Escape hatch for a size that genuinely diverges from base x multiplier. */
  price_override_cents?: Cents | null;
}

// ============================================================
// INTERNALS
// ============================================================
//
// Everything below the mutations/reads is private. Nothing here is exported:
// the contract's surface is exactly the functions and types declared above.

/** Column projections. Never `select *` — AGENT_RULES.md. */

/**
 * Every user embedded in someone else's row — a card's owner, a listing's
 * seller, a consignor, a hop on a provenance chain — comes from the
 * `public_profiles` view, NOT from `users`.
 *
 * 006_users_rls.sql put RLS on `users`: a session may read its own row and an
 * admin may read any, and that is all. RLS is row-level, so there is no policy
 * that could expose `handle` while hiding `email`; the view is how 006 draws
 * that line. Reading `users` for someone else's handle does not error, it
 * silently yields null — which an `!inner` embed turns into a listing that
 * vanishes from the market grid, and a plain embed turns into a NOT_FOUND out
 * of requireEmbed(). Verified against the live project.
 *
 * NEVER add `email` here. The view does not expose it, and that is the point.
 */
/**
 * 007_profile_updates.sql widened the view to carry portfolio_value_cents.
 * Everything else the embeds consume — id, handle, level, xp_total, created_at
 * — has been there since 006. See the toUserSummary() note for which
 * UserSummary fields still cannot come from here.
 */
const PUBLIC_PROFILE_COLUMNS =
  'id, handle, level, xp_total, portfolio_value_cents, created_at';

const USER_COLUMNS =
  'id, auth_id, handle, email, country_code, kyc_status, is_consignor, is_admin, ' +
  'level, xp_total, portfolio_value_cents, created_at, ' +
  'fulfilments_completed, defaults_count, is_restricted';

const SKU_REF_COLUMNS =
  'id, brand, model, colorway, size_us, market_price_cents, sprite_key, palette, art_url';

const SKU_COLUMNS =
  'id, model_id, brand, model, colorway, size_us, retail_price_cents, market_price_cents, ' +
  'size_multiplier, price_override_cents, ' +
  'price_confidence, priced_at, demand_score, sprite_key, palette, art_url, mint_cap, created_at';

/** sku_models column projection (027). Never `select *`. */
const SKU_MODEL_COLUMNS =
  'id, brand, model, colorway, base_price_cents, price_confidence, priced_at, ' +
  'sprite_key, palette, art_url, demand_score, created_at';

const CARD_SUMMARY_COLUMNS =
  'id, sku_id, item_id, owner_id, float_value, float_percentile, tier, ' +
  'is_exceptional, mint_number, status, minted_at, condition_grade';

const LISTING_REF_COLUMNS =
  'id, price_cents, status, early_access_level, public_at, oracle_value_cents';

const LISTING_COLUMNS =
  'id, card_id, seller_id, price_cents, fair_price_cents, status, early_access_level, public_at, ' +
  'oracle_value_cents, created_at, sold_at';

const ORDER_COLUMNS =
  'id, listing_id, card_id, buyer_id, seller_id, gross_cents, fee_bps, fee_cents, ' +
  'net_cents, settlement_ref, status, created_at, ' +
  'credit_cents, cash_cents, seller_payout, payout_release_at';

const ITEM_SUMMARY_COLUMNS =
  'id, sku_id, consignment_id, consignor_id, status, float_value, condition_grade, ' +
  'graded_at, grading_notes, photos, ' +
  'authenticated_at, custody_location, reserve_price_cents, ' +
  'custody, custody_holder_id, grade_source, asking_price_cents, submitted_payout, last_proof_at, ' +
  'grade_outsole, grade_midsole, grade_creasing, grade_upper, grade_heel, ' +
  'grade_accessories';

const CONSIGNMENT_COLUMNS =
  'id, consignor_id, status, item_count, intake_fee_cents, submitted_at, ' +
  'received_at, completed_at, notes, created_at';

const CONSIGNMENT_EVENT_COLUMNS =
  'id, consignment_id, from_status, to_status, actor_id, note, created_at';

/** The statuses that make a listing "live", per the partial unique index. */
const LIVE_LISTING_STATUSES: readonly ListingStatus[] = ['early_access', 'public'];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Ceiling for the sorts PostgREST cannot express — card value (a SQL function)
 * and a listing's float (a column on an embedded table). Those pull one window
 * of rows and rank them in JS, so `offset + limit` past this returns nothing.
 * Every other sort is ordered and paged by the database with no such ceiling.
 */
const JS_SORT_WINDOW = 1000;

/**
 * Never mutates `message`. The frozen doc comment on ContractError promises
 * the server text verbatim, so the call-site context rides in `detail`.
 */
function fail(error: PostgresErrorLike, context: string): never {
  const message = (error.message ?? '').trim() || 'the database returned an error';
  throw new ContractError(contractErrorCode(error), message, { context, error });
}

/** Throw on error, otherwise hand back data. Every call funnels through here. */
function unwrap<T>(
  result: { data: T; error: PostgresErrorLike | null },
  context: string,
): T {
  if (result.error) fail(result.error, context);
  return result.data;
}

/**
 * PostgREST returns a to-one embed as an object, but returns an array when it
 * cannot prove the relationship is to-one. Normalising here means a schema
 * detail never reshapes what a UI track receives.
 */
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (embed === null || embed === undefined) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function requireEmbed<T>(embed: T | T[] | null | undefined, what: string): T {
  const value = one(embed);
  if (value === null) {
    throw new ContractError(
      'NOT_FOUND',
      `${what} is missing from the row PostgREST returned`,
      { embed },
    );
  }
  return value;
}

interface PageBounds {
  from: number;
  to: number;
  size: number;
  offset: number;
}

function pageBounds(limit?: number, offset?: number): PageBounds {
  const size = Math.min(Math.max(1, Math.trunc(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const from = Math.max(0, Math.trunc(offset ?? 0));
  return { from, to: from + size - 1, size, offset: from };
}

/**
 * Strips the characters PostgREST reads as filter syntax. A search term is a
 * value, never a predicate — this is what keeps `a,b` from becoming two.
 */
function sanitizePattern(term: string): string {
  return term.replace(/[,()"\\%*]/g, ' ').trim();
}

/** Distinct, order-preserving. */
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * An omitted filter and an explicitly empty one both mean "no preference".
 * Passing `[]` straight to `.in()` would instead match nothing, which is a
 * confusing way for a UI that cleared its filter chips to get an empty grid.
 */
function statusFilter<T extends string>(
  requested: readonly T[] | undefined,
  fallback: readonly T[],
): T[] {
  return requested?.length ? [...requested] : [...fallback];
}

// ---- row shapes coming back from PostgREST ----

/** The SKU embed comes back exactly as SkuRef projects it. */
type SkuRefRow = SkuRef;

/** Exactly what `public_profiles` exposes. Deliberately narrower than User. */
interface PublicProfileRow {
  id: UUID;
  handle: string;
  level: number;
  xp_total: number;
  portfolio_value_cents: Cents;
  created_at: Timestamptz;
}

interface CardRow {
  id: UUID;
  sku_id: UUID;
  item_id: UUID;
  owner_id: UUID;
  float_value: FloatValue;
  float_percentile: number | null;
  tier: Tier;
  is_exceptional: boolean;
  mint_number: number;
  status: CardStatus;
  minted_at: Timestamptz;
  condition_grade: ConditionGrade;
  sku: SkuRefRow | SkuRefRow[];
}

interface ListingRefRow extends ListingRef {
  card_id: UUID;
}

interface ListingRow {
  id: UUID;
  card_id: UUID;
  seller_id: UUID;
  price_cents: Cents;
  fair_price_cents: Cents | null;
  status: ListingStatus;
  early_access_level: number;
  public_at: Timestamptz;
  oracle_value_cents: Cents | null;
  created_at: Timestamptz;
  sold_at: Timestamptz | null;
  card: CardRow | CardRow[];
  seller: PublicProfileRow | PublicProfileRow[];
}

interface ItemRow {
  id: UUID;
  sku_id: UUID;
  consignment_id: UUID | null;
  consignor_id: UUID | null;
  status: ItemStatus;
  float_value: FloatValue | null;
  condition_grade: ConditionGrade | null;
  graded_at: Timestamptz | null;
  grading_notes: string | null;
  photos: Json;
  authenticated_at: Timestamptz | null;
  custody_location: string | null;
  reserve_price_cents: Cents | null;
  custody: CustodyModel;
  custody_holder_id: UUID | null;
  grade_source: GradeSource;
  asking_price_cents: Cents | null;
  submitted_payout: PayoutMethod;
  last_proof_at: Timestamptz | null;
  grade_outsole: number | null;
  grade_midsole: number | null;
  grade_creasing: number | null;
  grade_upper: number | null;
  grade_heel: number | null;
  grade_accessories: number | null;
  sku: SkuRefRow | SkuRefRow[];
}

interface SubmissionRow extends ItemRow {
  created_at: Timestamptz;
  seller: PublicProfileRow | PublicProfileRow[];
}

interface ConsignmentRow extends Consignment {
  consignor: PublicProfileRow | PublicProfileRow[];
}

interface RedemptionRow {
  id: UUID;
  card_id: UUID;
  item_id: UUID;
  user_id: UUID;
  handling_fee_cents: Cents;
  shipping_address: Json;
  status: RedemptionStatus;
  carrier: string | null;
  tracking_number: string | null;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
  card: CardRow | CardRow[];
  item:
    | Pick<Item, 'id' | 'status' | 'custody_location'>
    | Pick<Item, 'id' | 'status' | 'custody_location'>[];
  redeemer: PublicProfileRow | PublicProfileRow[];
  fulfiller: PublicProfileRow | PublicProfileRow[] | null;
}

interface ProvenanceRow {
  owner_level: number;
  acquired_at: Timestamptz;
  released_at: Timestamptz | null;
  price_cents: Cents | null;
  owner: PublicProfileRow | PublicProfileRow[];
}

// ---- mappers ----

/**
 * A `public_profiles` row widened to the frozen `UserSummary` shape.
 *
 * ---- READ THIS BEFORE TRUSTING is_admin / is_consignor ON AN EMBEDDED USER ----
 *
 * `UserSummary` declares eight fields and the view exposes six. Two of them are
 * therefore NOT the values in the database — they are fixed placeholders,
 * because the view deliberately does not carry them and the contract is frozen
 * so the type cannot be narrowed to say so.
 *
 *   portfolio_value_cents  real since 007 widened the view (item 14 of the
 *                          handoff said this was defensible; 007 did it)
 *   is_admin               always false
 *   is_consignor           always false
 *
 * The first is now safe to render from an embedded user. The other two are not:
 * do not branch on them, and never use `is_admin` here for anything resembling
 * a permission check — an actual admin reads as false. `getUser()` still
 * returns the real row, for yourself or if you are an admin.
 *
 * Centralised in one function on purpose: the substitution is a real
 * compromise and should be visible in one place rather than smeared across six
 * call sites. Flagged in HANDOFF.md — the fix is columns on the view.
 */
function toUserSummary(row: PublicProfileRow): UserSummary {
  return {
    id: row.id,
    handle: row.handle,
    level: row.level,
    xp_total: row.xp_total,
    created_at: row.created_at,
    portfolio_value_cents: row.portfolio_value_cents,
    is_admin: false,
    is_consignor: false,
  };
}

function toCardSummary(row: CardRow, listing: ListingRef | null): CardSummary {
  return {
    id: row.id,
    sku_id: row.sku_id,
    item_id: row.item_id,
    owner_id: row.owner_id,
    float_value: row.float_value,
    float_percentile: row.float_percentile,
    tier: row.tier,
    is_exceptional: row.is_exceptional,
    mint_number: row.mint_number,
    status: row.status,
    minted_at: row.minted_at,
    condition_grade: row.condition_grade,
    sku: requireEmbed(row.sku, 'cards.sku'),
    listing,
  };
}

function toListingRef(row: ListingRefRow | ListingRow): ListingRef {
  return {
    id: row.id,
    price_cents: row.price_cents,
    status: row.status,
    early_access_level: row.early_access_level,
    public_at: row.public_at,
    oracle_value_cents: row.oracle_value_cents,
  };
}

/**
 * The six columns collapse to one object or to null. items_grade_components_complete
 * guarantees all-or-nothing at the database, so testing one column is enough —
 * but the others are checked anyway, because a null slipping into
 * GradeComponents would be a silently wrong 0.00 on a rubric row.
 */
function toGradeComponents(row: ItemRow): GradeComponents | null {
  const { grade_outsole, grade_midsole, grade_creasing } = row;
  const { grade_upper, grade_heel, grade_accessories } = row;

  if (
    grade_outsole === null ||
    grade_midsole === null ||
    grade_creasing === null ||
    grade_upper === null ||
    grade_heel === null ||
    grade_accessories === null
  ) {
    return null;
  }

  return {
    outsole: grade_outsole,
    midsole: grade_midsole,
    creasing: grade_creasing,
    upper: grade_upper,
    heel: grade_heel,
    accessories: grade_accessories,
  };
}

function toItemSummary(row: ItemRow, cardId: UUID | null): ItemSummary {
  return {
    id: row.id,
    sku_id: row.sku_id,
    consignment_id: row.consignment_id,
    consignor_id: row.consignor_id,
    status: row.status,
    float_value: row.float_value,
    condition_grade: row.condition_grade,
    graded_at: row.graded_at,
    grading_notes: row.grading_notes,
    photos: row.photos,
    authenticated_at: row.authenticated_at,
    custody_location: row.custody_location,
    reserve_price_cents: row.reserve_price_cents,
    custody: row.custody,
    custody_holder_id: row.custody_holder_id,
    grade_source: row.grade_source,
    asking_price_cents: row.asking_price_cents,
    submitted_payout: row.submitted_payout,
    last_proof_at: row.last_proof_at,
    sku: requireEmbed(row.sku, 'items.sku'),
    card_id: cardId,
    grade: toGradeComponents(row),
  };
}

function toConsignmentSummary(row: ConsignmentRow): ConsignmentSummary {
  const { consignor, ...consignment } = row;
  return {
    ...consignment,
    consignor: toUserSummary(requireEmbed(consignor, 'consignments.consignor')),
  };
}

// ---- shared sub-queries ----

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * The live listing on each of `cardIds`, keyed by card. One extra round trip
 * rather than a filtered embed: filtering a to-many embed by status is a
 * PostgREST subtlety that silently changes shape between versions, and this
 * cannot.
 */
async function liveListingsByCard(
  supabase: Supabase,
  cardIds: readonly UUID[],
): Promise<Map<UUID, ListingRef>> {
  const byCard = new Map<UUID, ListingRef>();
  if (cardIds.length === 0) return byCard;

  const rows = unwrap(
    await supabase
      .from('listings')
      .select(`card_id, ${LISTING_REF_COLUMNS}`)
      .in('card_id', cardIds as UUID[])
      .in('status', LIVE_LISTING_STATUSES as ListingStatus[]),
    'listings',
  ) as ListingRefRow[] | null;

  for (const row of rows ?? []) byCard.set(row.card_id, toListingRef(row));
  return byCard;
}

/** `sku_float_curve` rows for the SKUs in a page, for value ordering. */
async function floatCurvesFor(
  supabase: Supabase,
  skuIds: readonly UUID[],
): Promise<FloatCurveRow[]> {
  if (skuIds.length === 0) return [];

  const rows = unwrap(
    await supabase
      .from('sku_float_curve')
      .select('sku_id, float_min, float_max, value_multiplier')
      .in('sku_id', skuIds as UUID[]),
    'sku_float_curve',
  ) as FloatCurveRow[] | null;

  return rows ?? [];
}

/** The `.or()` arms that reproduce the `listings_visibility` RLS policy. */
async function listingVisibilityFilter(
  supabase: Supabase,
  viewerId: UUID | undefined,
): Promise<string> {
  const arms = [`status.eq.public`, `public_at.lte.${new Date().toISOString()}`];

  if (viewerId) {
    arms.push(`seller_id.eq.${viewerId}`);

    // public_profiles, not users: since 006 a session can only read its own
    // `users` row, so looking the level up there returns nothing whenever
    // viewerId is anyone but the caller. That failure is silent — the
    // early-access arm would just be dropped and the listing would look
    // invisible rather than locked. `level` is on the view, so this works for
    // any viewerId the caller passes.
    const result = await supabase
      .from('public_profiles')
      .select('level')
      .eq('id', viewerId)
      .maybeSingle();

    if (result.error && !isNoRows(result.error)) fail(result.error, 'public_profiles');
    const level = (result.data as { level: number } | null)?.level;
    if (typeof level === 'number') arms.push(`early_access_level.lte.${level}`);
  }

  return arms.join(',');
}

// ============================================================
// MUTATIONS — one per RPC in 002_operations.sql
// ============================================================

/**
 * fn_mint_card(p_item_id, p_owner_id) -> uuid
 *
 * The item must be in_custody, graded by a human, and authenticated. Tier is
 * assigned from the SKU's base oracle price; the float is copied across and is
 * immutable from here.
 *
 * ADMIN ONLY, AND RUNS ON THE SESSION CLIENT.
 * 005_admin_guards.sql granted execute back to `authenticated` and moved the
 * check inside the function: fn_require_admin() resolves auth.uid() to a
 * `users` row and raises unless `is_admin`. That check is the authorisation
 * boundary now — not the middleware gate, which does not cover Server Actions.
 *
 * It must NOT be called service-role. Under the service key auth.uid() is
 * null, fn_require_admin() finds no row, and the call is refused. The signed-in
 * caller has to be a real admin.
 *
 * @returns the new card id.
 * @throws FORBIDDEN ("admin privileges required"), MINT_CAP_REACHED,
 *         WRONG_STATUS, NOT_GRADED, NOT_AUTHENTICATED, NO_ORACLE_PRICE.
 */
export async function mintCard(itemId: UUID, ownerId: UUID): Promise<UUID> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_mint_card', { p_item_id: itemId, p_owner_id: ownerId }),
    'fn_mint_card',
  ) as UUID;
}

/**
 * fn_list_card(p_card_id, p_seller_id, p_price_cents, p_payout_method, p_fair_price_cents) -> uuid
 *
 * Lists a card. For vaulted items (custody = 'warehouse'), the listing goes
 * straight to 'public' and the card stays 'active'. For regular items,
 * early_access window applies and card is locked.
 *
 * @returns the new listing id.
 * @throws NOT_OWNER, WRONG_STATUS, UNKNOWN (payout_method other than 'credit').
 */
export async function listCard(
  cardId: UUID,
  sellerId: UUID,
  priceCents: Cents,
  payoutMethod: PayoutMethod = 'credit',
  fairPriceCents: Cents | null = null,
): Promise<UUID> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_list_card', {
      p_card_id: cardId,
      p_seller_id: sellerId,
      p_price_cents: priceCents,
      p_payout_method: payoutMethod,
      p_fair_price_cents: fairPriceCents,
    }),
    'fn_list_card',
  ) as UUID;
}

/**
 * fn_cancel_listing(p_listing_id, p_actor) -> void
 *
 * Seller only. Returns the card to 'active'.
 *
 * @throws NOT_OWNER, WRONG_STATUS.
 */
export async function cancelListing(listingId: UUID, actorId: UUID): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_cancel_listing', {
      p_listing_id: listingId,
      p_actor: actorId,
    }),
    'fn_cancel_listing',
  );
}

/**
 * fn_purchase_card(p_listing_id, p_buyer_id, p_settlement_ref) -> uuid
 *
 * Records a settlement that has ALREADY happened: money moved buyer -> seller
 * through Stripe before this call. Call it from the payment_intent.succeeded
 * webhook only — never from client code.
 *
 * Runs on the service-role client: the webhook arrives from Stripe with no
 * user session, so there is no cookie to act on behalf of. createServiceSupabase()
 * throws outright if a `window` exists, which is the runtime half of "never
 * from client code" — the compile-time half is that this module is server-only.
 *
 * @param settlementRef the Stripe payment_intent id.
 * @returns the new order id.
 * @throws EARLY_ACCESS_LOCKED, WRONG_STATUS, SELF_PURCHASE, NOT_FOUND.
 */
export async function purchaseCard(
  listingId: UUID,
  buyerId: UUID,
  settlementRef: string,
): Promise<UUID> {
  const supabase = createServiceSupabase();
  return unwrap(
    await supabase.rpc('fn_purchase_card', {
      p_listing_id: listingId,
      p_buyer_id: buyerId,
      p_settlement_ref: settlementRef,
    }),
    'fn_purchase_card',
  ) as UUID;
}

/**
 * fn_purchase_card(p_listing_id, p_buyer_id, p_settlement_ref, p_credit_cents, p_hold_id) -> uuid
 *
 * 018-020's split-settlement path, extended in place by 021 with a 5th
 * argument. This is a prior additive export (not one of the frozen 16), so
 * the signature changes here rather than growing a second variant — 022
 * dropped the pre-019c three-argument fn_purchase_card overloads for exactly
 * this reason: an arity variant wins over default-filling in Postgres, so a
 * second signature silently becomes a second settlement path. The same
 * applies on this side of the RPC boundary, hence editing in place.
 *
 * `creditCents` is the portion of the listing price the buyer pays in FSC;
 * the remainder is cash. Settlement rules, enforced in fn_purchase_card_core
 * and mirrored here client-side where they can be checked without a round
 * trip:
 *   - a cash leg (price_cents - creditCents > 0) requires a non-empty
 *     `settlementRef`. FSC-only (creditCents === the full price) is the one
 *     case it may be null, because no money moved through Stripe.
 *   - an FSC leg (creditCents > 0) requires EITHER a session matching the
 *     buyer OR a `holdId`. This function runs on the service-role client —
 *     the webhook has no session, ever — so in practice every call with an
 *     FSC leg MUST carry a `holdId` created earlier by the buyer's own
 *     session (via reserveCredit()). That is deliberate: it is what stops a
 *     compromised or buggy webhook caller from spending a buyer's FSC on
 *     its own say-so. This function throws CREDIT_PROVENANCE_REQUIRED
 *     itself when creditCents > 0 and holdId is null, rather than letting
 *     the round trip fail — the SQL raises the identical refusal
 *     ('spending FSC requires a session matching the buyer, or a credit
 *     hold') if this check is ever bypassed, so nothing relies on the
 *     client-side check alone.
 *
 * Same calling rule as purchaseCard(): this records a settlement that has
 * ALREADY happened. Call it from the payment_intent.succeeded webhook (for
 * the cash/split legs) — never from client code. SERVICE-ROLE, for the same
 * reason as purchaseCard(): the webhook has no session to act on behalf of.
 *
 * Seller payout is derived server-side from fn_payout_method_for_user, never
 * from listings.payout_method and never from anything this call passes in —
 * see getPayoutMethodForUser().
 *
 * @param settlementRef the Stripe payment_intent id, or null for an
 *   FSC-only settlement (creditCents === the full price).
 * @param creditCents the portion of the price paid in FSC, in cents.
 * @param holdId a credit_holds id created by the buyer's session via
 *   reserveCredit(), required whenever creditCents > 0. Pass null for a
 *   cash-only settlement.
 * @returns the new order id.
 * @throws EARLY_ACCESS_LOCKED, WRONG_STATUS, SELF_PURCHASE, NOT_FOUND,
 *         SETTLEMENT_REF_REQUIRED, INSUFFICIENT_CREDIT, INVALID_AMOUNT,
 *         CREDIT_PROVENANCE_REQUIRED, CREDIT_HOLD_EXPIRED,
 *         CREDIT_HOLD_WRONG_USER, CREDIT_HOLD_WRONG_LISTING,
 *         CREDIT_HOLD_INSUFFICIENT, CREDIT_SETTLEMENT_DISABLED.
 */
export async function purchaseCardSplit(
  listingId: UUID,
  buyerId: UUID,
  settlementRef: string | null,
  creditCents: Cents,
  holdId: UUID | null,
): Promise<UUID> {
  if (creditCents > 0 && !holdId) {
    throw new ContractError(
      'CREDIT_PROVENANCE_REQUIRED',
      'a webhook settlement with an FSC leg must carry a hold id created ' +
        'by the buyer\'s own session; service-role has no session to spend ' +
        'FSC on its own say-so',
      { listingId, buyerId, creditCents },
    );
  }

  const supabase = createServiceSupabase();
  return unwrap(
    await supabase.rpc('fn_purchase_card', {
      p_listing_id: listingId,
      p_buyer_id: buyerId,
      p_settlement_ref: settlementRef,
      p_credit_cents: creditCents,
      p_hold_id: holdId,
    }),
    'fn_purchase_card',
  ) as UUID;
}

/**
 * The signed-in caller's `users.id`, or an error. `users.id` equals the
 * Supabase auth id — 006's users_self_insert WITH CHECK pins both to
 * auth.uid(), enforced in lib/db/provision.ts — so auth.getUser() is the whole
 * resolution.
 *
 * @throws UNAUTHENTICATED when there is no session.
 */
async function requireCurrentUserId(): Promise<UUID> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new ContractError('UNAUTHENTICATED', 'no active session; sign in first', { error });
  }
  return data.user.id as UUID;
}

/**
 * fn_credit_balance(p_user) -> bigint
 *
 * The caller's own FSC LEDGER balance, in cents — NOT what they may actually
 * spend. This ignores active credit_holds: FSC already committed to another
 * in-flight checkout still counts here. AGENT_RULES.md section 5: "Spendable
 * FSC is fn_credit_available(), not fn_credit_balance()." Every UI surface
 * that shows a balance, and every check that gates a purchase, must use
 * getCreditAvailable() instead. This export stays — it is the true ledger
 * total and admin/solvency surfaces need it — but do not render it as "what
 * you can spend" and do not use it to decide whether a purchase can proceed.
 *
 * The balance is read for the signed-in user — there is deliberately no
 * argument, so a session cannot ask after someone else's. Zero is a valid
 * balance, not an empty state.
 *
 * @throws UNAUTHENTICATED.
 */
export async function getCreditBalance(): Promise<Cents> {
  const userId = await requireCurrentUserId();
  const supabase = await createServerSupabase();

  const balance = unwrap(
    await supabase.rpc('fn_credit_balance', { p_user: userId }),
    'fn_credit_balance',
  ) as number;

  return balance ?? 0;
}

/**
 * fn_credit_available(p_user) -> bigint
 *
 * The caller's own SPENDABLE FSC, in cents: fn_credit_balance() minus every
 * active, unexpired credit_holds row (getCreditHeld()). This is the number
 * every UI surface renders as "your balance" and every pre-purchase check
 * gates on — AGENT_RULES.md section 5. getCreditBalance() (the ledger total)
 * is NOT a substitute; the difference is FSC already committed to another
 * in-flight checkout.
 *
 * No argument, same reasoning as getCreditBalance(): a session cannot ask
 * after someone else's available balance.
 *
 * @throws UNAUTHENTICATED.
 */
export async function getCreditAvailable(): Promise<Cents> {
  const userId = await requireCurrentUserId();
  const supabase = await createServerSupabase();

  const available = unwrap(
    await supabase.rpc('fn_credit_available', { p_user: userId }),
    'fn_credit_available',
  ) as number;

  return available ?? 0;
}

/**
 * fn_credit_held(p_user) -> bigint
 *
 * The caller's own FSC currently committed to in-flight checkouts: the sum
 * of their active, unexpired credit_holds rows. getCreditBalance() -
 * getCreditHeld() = getCreditAvailable(); exposed separately so a UI can
 * show "X held in an open checkout" rather than just the net number.
 *
 * @throws UNAUTHENTICATED.
 */
export async function getCreditHeld(): Promise<Cents> {
  const userId = await requireCurrentUserId();
  const supabase = await createServerSupabase();

  const held = unwrap(
    await supabase.rpc('fn_credit_held', { p_user: userId }),
    'fn_credit_held',
  ) as number;

  return held ?? 0;
}

/**
 * fn_reserve_credit(p_listing_id, p_credit_cents) -> uuid
 *
 * Reserves FSC against an in-flight checkout, before Stripe Checkout is even
 * created. This closes the race 021 documents: without a reservation, a
 * buyer's FSC balance can be checked at checkout-intent time and spent
 * elsewhere before the webhook settles minutes later. Session client ONLY —
 * fn_current_user_id() resolves from auth.uid(), which is null under
 * service-role, so the webhook cannot call this on a buyer's behalf. That is
 * deliberate: a hold's provenance is exactly "a session that was actually
 * signed in as this buyer at reservation time," and nothing else may create
 * one. Pass the returned hold id to purchaseCardSplit() as holdId.
 *
 * At most one ACTIVE hold per (user, listing) — a second reserve on the same
 * listing releases the first rather than stacking (021's partial unique
 * index on (user_id, listing_id) where status = 'active', enforced by the
 * SQL deleting the prior active hold before inserting the new one).
 * Expired holds are swept internally before checking the balance, so a stale
 * hold never blocks a fresh reservation.
 *
 * @param creditCents the FSC amount to reserve, in cents. May not exceed the
 *   listing's own price_cents.
 * @returns the new credit_holds id.
 * @throws UNAUTHENTICATED, NOT_FOUND (no such listing), WRONG_STATUS
 *   (listing not early_access/public), SELF_PURCHASE, INVALID_AMOUNT
 *   (non-positive, or above the listing price), INSUFFICIENT_CREDIT
 *   (above getCreditAvailable()).
 */
export async function reserveCredit(listingId: UUID, creditCents: Cents): Promise<UUID> {
  await requireCurrentUserId();
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_reserve_credit', {
      p_listing_id: listingId,
      p_credit_cents: creditCents,
    }),
    'fn_reserve_credit',
  ) as UUID;
}

/**
 * fn_release_credit_hold(p_hold_id) -> void
 *
 * Releases a reservation before it is consumed — a buyer backing out of
 * checkout, or a checkout switching to a different payment split. Session
 * client, owner-or-admin (checked in the SQL against the hold's user_id).
 * Idempotent on an already-released, already-consumed, or already-expired
 * hold: the SQL returns without error rather than raising, so a client does
 * not need to track hold state to call this safely.
 *
 * @throws UNAUTHENTICATED, NOT_FOUND (no such hold), CREDIT_HOLD_WRONG_USER.
 */
export async function releaseCreditHold(holdId: UUID): Promise<void> {
  await requireCurrentUserId();
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_release_credit_hold', { p_hold_id: holdId }),
    'fn_release_credit_hold',
  );
}

/**
 * fn_expire_credit_holds() -> integer
 *
 * Sweeps every active hold whose expires_at has passed to 'expired', freeing
 * the FSC it committed. fn_reserve_credit() already calls this internally
 * before checking a new reservation's balance, so this export exists for a
 * caller that wants to force the sweep on its own schedule (a maintenance
 * page, a scheduled job, the Stripe webhook on checkout.session.expired).
 *
 * SERVICE-ROLE. 021 granted this to `authenticated`, but 022b revoked it from
 * `public`/`anon`/`authenticated` and granted it to `service_role` only —
 * "a stranger cannot drop everyone else's in-flight checkout holds by calling
 * it in a loop" (022b's own comment). This export used to call
 * createServerSupabase() (the session client), which has held no grant on this
 * function since 022b landed and would fail every call with FORBIDDEN;
 * verified by reading 021_credit_holds.sql:537 against
 * 022b_permissions_lockdown.sql:161-165 side by side. Fixed here rather than
 * left broken, since the Stripe webhook (022b_permissions_lockdown.sql, and
 * this migration is the reason webhooks need it at all) needs a working path
 * to sweep expired holds on checkout.session.expired. Not scoped to the
 * caller's own holds — it sweeps every user's expired holds — so no identity
 * is threaded through here.
 *
 * @returns the number of holds expired.
 */
export async function expireCreditHolds(): Promise<number> {
  const supabase = createServiceSupabase();
  const count = unwrap(
    await supabase.rpc('fn_expire_credit_holds'),
    'fn_expire_credit_holds',
  ) as number;

  return count ?? 0;
}

/**
 * fn_payout_method_for_user(p_user) -> payout_method
 *
 * The AUTHORITATIVE answer to "how will this seller be paid": 'cash' when
 * `users.country_code` is in `cash_payout_countries` (currently MY only),
 * 'credit' otherwise. Live-verified pre-025 (2026-08-21): a MY user resolved
 * 'cash', a null-country user and an unrecognised user id both resolved
 * 'credit'.
 *
 * SUPERSEDED by 025_user_country.sql, live now: a null or empty
 * country_code no longer resolves to 'credit' — it RAISES (mapped to
 * COUNTRY_NOT_SET, see ContractErrorCode). NULL meant "we do not know",
 * which 025's own comment distinguishes from "not Malaysian"; conflating the
 * two was the bug it closes. An unrecognised-but-present code (not in
 * `cash_payout_countries`) still resolves to 'credit' as before — only the
 * null/empty case changed.
 *
 * NEVER let a client supply a payout method and use it for routing —
 * `listings.payout_method` is a cached DISPLAY value only, not a source of
 * truth, and `submitted_payout` on ItemSummary is the seller's own election
 * at intake, not this. fn_purchase_card_core already calls this internally
 * to decide the seller's actual payout; this export exists purely as a READ
 * so the UI can tell a seller how they will be paid before they list.
 *
 * Not admin-gated and takes no session — live-verified working for anon,
 * an authenticated session, and service-role alike, since it is a query
 * over a user id the caller supplies, not the caller's own identity. Runs on
 * the session client for consistency with the rest of the read surface.
 *
 * @throws COUNTRY_NOT_SET (025) when p_user's country_code is null or empty.
 */
export async function getPayoutMethodForUser(userId: UUID): Promise<DerivedPayoutMethod> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_payout_method_for_user', { p_user: userId }),
    'fn_payout_method_for_user',
  ) as DerivedPayoutMethod;
}

/**
 * fn_set_country(p_country) -> void
 *
 * Self-service: sets the CALLING session's own `users.country_code`, and
 * nobody else's — 025_user_country.sql derives the row to update from
 * `fn_current_user_id()` inside the function; there is no `p_user`
 * argument, so this cannot write on another user's behalf no matter what
 * client code calls it from. SESSION CLIENT ONLY, never service-role: a
 * service-role call has no `auth.uid()`, so `fn_current_user_id()` resolves
 * null and the function raises 'sign in to set your country' rather than
 * silently writing nothing or writing the wrong row.
 *
 * Deliberately one column. 025's own comment: widening the `users` update
 * grant to arbitrary columns would let a client set `is_admin`, `level`,
 * `portfolio_value_cents`, or `is_restricted` — this function exists
 * specifically so the grant stays narrow.
 *
 * `p_country` is validated in SQL against ISO 3166-1 alpha-2 SHAPE only
 * (upper-cased, trimmed, `^[A-Z]{2}$`) — not against a table of real
 * country codes, since `cash_payout_countries` already decides the only
 * thing the platform acts on (see getPayoutMethodForUser's doc comment).
 *
 * @throws UNAUTHENTICATED (no session — requireCurrentUserId() below stops
 *   a genuinely anonymous caller before the RPC; a session with no matching
 *   `users` row still reaches SQL and gets the same code via 025's own
 *   'sign in to set your country' raise), INVALID_COUNTRY_CODE (not
 *   two letters after upper/trim).
 */
export async function setCountry(countryCode: string): Promise<void> {
  await requireCurrentUserId();
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_set_country', { p_country: countryCode }),
    'fn_set_country',
  );
}

/**
 * The redeem handling fee, in USD cents, when no platform_config row exists.
 *
 * 011 gave it a permanent home: platform_config['redemption_handling_fee_cents']
 * (seeded at 1500). The authoritative value is now getRedemptionHandlingFeeCents();
 * this constant is only the fallback for a database that has not been migrated.
 *
 * fn_redeem_card takes the fee as an argument (p_fee_cents) and the schema
 * records it on the redemption and in the ledger. Pass the config value to
 * redeemCard(), and never take the fee from client input.
 */
export const REDEMPTION_HANDLING_FEE_CENTS: Cents = 1500;

/**
 * The credit-hold TTL, in minutes, when no platform_config row exists.
 * 021 seeded this at 30; 024f raised the live value to 1440 (24h) so an
 * abandoned hold outlasts Stripe's webhook retries. 1440 is also exactly
 * Stripe Checkout's own expires_at ceiling — see
 * checkoutExpiresAtSeconds()'s use of credit_hold_minutes in
 * app/(market)/checkout-math.ts.
 *
 * DIRECTION OF RISK: raising this value (or the live config) beyond 1440 is
 * harmless — Stripe just clamps the Session's expires_at at its own 24h
 * ceiling regardless. LOWERING the live platform_config value while this
 * fallback constant stays 1440 is not: a caller reading only the fallback
 * would set a Checkout Session expiry that outlives the buyer's actual hold,
 * so a Session could still be paid after its hold already released the FSC
 * back — cash collected with no card transferred. Always prefer the live
 * getPlatformConfig().credit_hold_minutes value; this constant exists only
 * for a database with no platform_config row at all.
 */
export const CREDIT_HOLD_MINUTES_FALLBACK = 1440;

/** The live platform_config rows that UI code can branch on. */
export interface PlatformConfig {
  /** redemption_handling_fee_cents, USD cents charged to ship a redeemed item. */
  redemption_handling_fee_cents: Cents;
  /** credit_payout_enabled — master switch for the seller-takes-credit leg. */
  credit_payout_enabled: boolean;
  /** credit_payout_premium_bps — bonus credit a seller gets for electing credit. */
  credit_payout_premium_bps: number;
  /** credit_purchase_min_cents — the smallest FSC top-up. */
  credit_purchase_min_cents: Cents;
  /**
   * credit_hold_minutes (021) — how long a reserveCredit() hold stays
   * 'active' before fn_expire_credit_holds() can sweep it. Use this to bound
   * a Stripe Checkout Session's expires_at so the Session cannot outlive the
   * hold backing its FSC leg — see CREDIT_HOLD_MINUTES_FALLBACK's doc comment
   * for why lowering the live value matters and raising it does not.
   */
  credit_hold_minutes: number;
  /**
   * show_numeric_float (018-020) — live-verified false. While false, the raw
   * numeric float and float_percentile must not be shown to a non-admin
   * caller; render condition_grade (via listConditionBands()) instead. This
   * flag only tells the UI which to show — CardSummary.float_value and
   * float_percentile are unchanged (frozen fields) and still come back on
   * every read regardless of this flag; gating their display is a UI
   * decision, not something this contract can withhold.
   */
  show_numeric_float: boolean;
}

/**
 * The platform_config rows, mapped to a single object. config_read (011) is
 * `for select using (true)`, so an anonymous visitor can read this too.
 *
 * The two *_cents values are `bigint` in the schema (correct — money), so they
 * arrive as numbers and are typed Cents. Missing rows fall back to the same
 * values 011 seeds, so a half-migrated database still reads coherently.
 */
export async function getPlatformConfig(): Promise<PlatformConfig> {
  const supabase = await createServerSupabase();

  const rows = unwrap(
    await supabase.from('platform_config').select('key, num_value, bool_value'),
    'platform_config',
  ) as { key: string; num_value: number | null; bool_value: boolean | null }[] | null;

  const byKey = new Map((rows ?? []).map((row) => [row.key, row]));

  return {
    redemption_handling_fee_cents: (byKey.get('redemption_handling_fee_cents')
      ?.num_value as Cents | undefined) ?? REDEMPTION_HANDLING_FEE_CENTS,
    credit_payout_enabled:
      byKey.get('credit_payout_enabled')?.bool_value ?? true,
    credit_payout_premium_bps:
      byKey.get('credit_payout_premium_bps')?.num_value ?? 500,
    credit_purchase_min_cents:
      (byKey.get('credit_purchase_min_cents')?.num_value as Cents | undefined) ?? 500,
    credit_hold_minutes:
      byKey.get('credit_hold_minutes')?.num_value ?? CREDIT_HOLD_MINUTES_FALLBACK,
    show_numeric_float: byKey.get('show_numeric_float')?.bool_value ?? false,
  };
}

/**
 * The live redemption handling fee. Reads platform_config, falling back to the
 * constant when the row is missing. Pass it to redeemCard().
 */
export async function getRedemptionHandlingFeeCents(): Promise<Cents> {
  const config = await getPlatformConfig();
  return config.redemption_handling_fee_cents;
}

/**
 * fn_redeem_card(p_card_id, p_user_id, p_address, p_fee_cents) -> uuid
 *
 * Burns the claim and puts the physical item on redemption hold for shipping.
 *
 * @returns the new redemption id.
 * @throws NOT_OWNER, WRONG_STATUS.
 */
export async function redeemCard(
  cardId: UUID,
  userId: UUID,
  address: ShippingAddress,
  feeCents: Cents,
): Promise<UUID> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_redeem_card', {
      p_card_id: cardId,
      p_user_id: userId,
      p_address: address,
      p_fee_cents: feeCents,
    }),
    'fn_redeem_card',
  ) as UUID;
}

/**
 * fn_burn_card(p_card_id, p_reason) -> void
 *
 * Permanently burns a card, setting its status to 'burned'. This is a one-way
 * operation — the card can never be restored. Requires a written reason for
 * the audit trail.
 *
 * ADMIN ONLY. Runs on the session client with fn_require_admin() guard.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS
 *         (card already burned or redeemed).
 */
export async function burnCard(cardId: UUID, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_burn_card', { p_card_id: cardId, p_reason: reason }),
    'fn_burn_card',
  );
}

/**
 * fn_archive_sku_model(p_model_id, p_reason) -> void
 *
 * Archives a SKU model (soft delete). The model and its variants become hidden
 * from the catalog and cannot be used for new mints. Existing cards are
 * unaffected. This is a one-way operation — the model can never be restored.
 * Requires a written reason for the audit trail.
 *
 * ADMIN ONLY. Runs on the session client with fn_require_admin() guard.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND.
 */
export async function archiveSkuModel(modelId: UUID, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_archive_sku_model', { p_model_id: modelId, p_reason: reason }),
    'fn_archive_sku_model',
  );
}

/**
 * fn_advance_consignment(p_id, p_to, p_actor, p_note) -> void
 *
 * The state machine lives in the CASE block of the SQL function. Read it
 * there; do not re-derive the allowed edges from the enum order.
 *
 * ADMIN ONLY, and on the session client for the same reason as mintCard():
 * 005_admin_guards.sql checks is_admin inside the function via auth.uid(), so
 * a service-role call is refused.
 *
 * `actorId` IS NOW IGNORED BY THE DATABASE. Before 005 it was written straight
 * onto consignment_events, which meant passing someone else's id forged the
 * audit trail. 005 takes the actor from the session instead —
 * fn_require_admin() returns the caller's `users.id` and that is what gets
 * recorded. The parameter is kept only because this contract is frozen;
 * whatever you pass has no effect. Pass the signed-in user anyway, so the call
 * site stops lying the day the signature can change.
 *
 * @throws FORBIDDEN ("admin privileges required"), ILLEGAL_TRANSITION,
 *         NOT_FOUND.
 */
export async function advanceConsignment(
  consignmentId: UUID,
  to: ConsignmentStatus,
  actorId: UUID,
  note?: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_advance_consignment', {
      p_id: consignmentId,
      p_to: to,
      p_actor: actorId,
      p_note: note ?? null,
    }),
    'fn_advance_consignment',
  );
}

/**
 * fn_award_xp(p_user, p_type, p_delta, p_ref) -> void
 *
 * Append-only. XP is non-transferable and never redeemable.
 *
 * SERVICE-ROLE, AND ALMOST CERTAINLY NOT YOURS TO CALL.
 * 004_rls_and_grants.sql revoked execute from anon and authenticated,
 * classifying this as an internal helper: the mint, purchase and redemption
 * functions already award their own XP from inside the same transaction.
 * The revoke exists because XP feeds rank_score -> level -> seller_fee_bps,
 * so an unguarded award is a self-service fee discount.
 *
 * It stays exported because the contract is frozen. If you find yourself
 * reaching for it, the XP almost certainly belongs inside a SQL function
 * instead — write it to HANDOFF.md.
 */
export async function awardXp(
  userId: UUID,
  eventType: string,
  xpDelta: number,
  refId?: UUID | null,
): Promise<void> {
  const supabase = createServiceSupabase();
  unwrap(
    await supabase.rpc('fn_award_xp', {
      p_user: userId,
      p_type: eventType,
      p_delta: xpDelta,
      p_ref: refId ?? null,
    }),
    'fn_award_xp',
  );
}

/**
 * fn_refresh_levels() -> integer
 *
 * Nightly job. rank_score = portfolio_value_cents + (xp_total * 50).
 *
 * Service-role, like purchaseCard: a scheduled job has no session, and it
 * rewrites the level cache for every user rather than one.
 *
 * @returns the number of users whose level cache was rewritten.
 */
export async function refreshLevels(): Promise<number> {
  const supabase = createServiceSupabase();
  return unwrap(await supabase.rpc('fn_refresh_levels'), 'fn_refresh_levels') as number;
}

// ============================================================
// GRADING — added by 008_grading.sql
// ============================================================
//
// All three are admin-guarded the way 005 established: execute is granted to
// `authenticated` and fn_require_admin() checks auth.uid() inside the function.
// So they run on the SESSION client — service-role has no auth.uid() and is
// refused. Callers should still check is_admin in the page (HANDOFF item 7).

// The rubric arithmetic lives in lib/db/grading.ts so it is testable without
// dragging next/headers into the test runner — this module reaches it through
// lib/supabase/server.ts. Re-exported here so consumers keep one import path.
export { GRADE_WEIGHTS, gradeFloatFromComponents } from '@/lib/db/grading';
export type { GradeComponents } from '@/lib/db/grading';

/**
 * fn_grade_item(p_item_id, p_float, p_notes, p_outsole .. p_accessories) -> void
 *
 * Records a human grade. The item must be pending_intake or in_custody and
 * must not already be minted — a minted card holds an immutable copy of the
 * float, so re-grading would desync the two.
 *
 * `components` is optional at the database level, but pass it. When present
 * the constraint enforces that `float` really is their weighted sum, which is
 * what stops a grader picking a number and reverse-engineering the rubric to
 * justify it. Derive the float with gradeFloatFromComponents().
 *
 * The float is typed by a human. Never compute it from anything but the
 * rubric, and never randomise it — there is no RNG in this codebase.
 *
 * Sets status to in_custody once the item is also authenticated.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS,
 *         GRADE_COMPONENTS_MISMATCH, GRADE_COMPONENTS_INCOMPLETE.
 */
export async function gradeItem(
  itemId: UUID,
  float: FloatValue,
  notes?: string | null,
  components?: GradeComponents | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_grade_item', {
      p_item_id: itemId,
      p_float: float,
      p_notes: notes ?? null,
      p_outsole: components?.outsole ?? null,
      p_midsole: components?.midsole ?? null,
      p_creasing: components?.creasing ?? null,
      p_upper: components?.upper ?? null,
      p_heel: components?.heel ?? null,
      p_accessories: components?.accessories ?? null,
    }),
    'fn_grade_item',
  );
}

/**
 * fn_authenticate_item(p_item_id, p_location) -> void
 *
 * Marks the item authentic and records where it is being held. Independent of
 * grading and may happen either side of it; the item reaches in_custody, and
 * so becomes mintable, once both have happened.
 *
 * @param location custody_location. Left unchanged when omitted.
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS.
 */
export async function authenticateItem(
  itemId: UUID,
  location?: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_authenticate_item', {
      p_item_id: itemId,
      p_location: location ?? null,
    }),
    'fn_authenticate_item',
  );
}

/**
 * fn_reject_item(p_item_id, p_reason) -> void
 *
 * Failed authentication. Moves the item to returned_to_consignor and appends
 * 'REJECTED: <reason>' to grading_notes.
 *
 * The reason is appended to a permanent record the consignor can be shown, so
 * write it for them, not as an internal shorthand. A minted item cannot be
 * rejected.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS.
 */
export async function rejectItem(itemId: UUID, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_reject_item', { p_item_id: itemId, p_reason: reason }),
    'fn_reject_item',
  );
}

// ============================================================
// FULFILMENT & CATALOG — added by 009_rls_sweep.sql
// ============================================================
//
// markShipped follows the 005/008 pattern: granted to `authenticated`,
// fn_require_admin() inside, so it runs on the SESSION client and refuses
// service-role. upsertSku and setFloatCurve are different in kind: they are
// direct table writes with NO RPC — 009's skus_admin_write / curve_admin_write
// RLS policies are the entire guard. That only works on the session client;
// on service-role the policies are bypassed and anything would be written.

/**
 * fn_mark_shipped(p_redemption_id, p_carrier, p_tracking) -> void
 *
 * Ships a redemption: stamps carrier, tracking and shipped_at, sets the
 * redemption to 'shipped', and moves the physical item redemption_hold ->
 * shipped. Refuses a redemption that has already shipped — fulfilment is not
 * repeatable, the box left the building.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS.
 */
export async function markShipped(
  redemptionId: UUID,
  carrier: string,
  tracking: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_mark_shipped', {
      p_redemption_id: redemptionId,
      p_carrier: carrier,
      p_tracking: tracking,
    }),
    'fn_mark_shipped',
  );
}

// ============================================================
// SELF-SERVE SUBMISSIONS & SELLER CUSTODY — added by
// 013_seller_custody.sql
// ============================================================
//
// All six functions derive the caller from auth.uid() inside the SQL, so they
// run on the SESSION client: under service-role auth.uid() is null and every
// 013 guard refuses. None of them take a seller/owner id — p_*_id arguments
// identify the item or redemption, never the actor.

/**
 * fn_submit_listing(...) -> uuid
 *
 * The front door of the self-serve path (013). A seller declares an item they
 * keep at home — price, payout preference, proof-of-possession photos and
 * their own six condition scores. fn_submit_listing computes the float from
 * the scores exactly as the grader does, records it as seller_declared in
 * grade_source, and drops the item into 'pending_review'. Nothing is live
 * until an admin approves: that review is the fraud gate.
 *
 * Cash/either settlement is gated to proven sellers — a seller paid in cash
 * who never ships is an uncollateralised loss, so fn_submit_listing demands
 * platform_config.cash_payout_min_fulfilments completed fulfilments and
 * otherwise refuses with UNPROVEN_SELLER. Credit is the default and always
 * the fallback.
 *
 * @returns the created item id.
 * @throws UNAUTHENTICATED, RESTRICTED, INVALID_AMOUNT, UNPROVEN_SELLER,
 *         TOO_FEW_PHOTOS, INVALID_PHOTO_URL.
 */
export async function submitListing(input: SubmitListingInput): Promise<UUID> {
  const supabase = await createServerSupabase();

  return unwrap(
    await supabase.rpc('fn_submit_listing', {
      p_sku_id: input.skuId,
      p_price_cents: input.priceCents,
      p_payout: input.payoutMethod,
      p_photos: input.photos,
      p_outsole: input.grade.outsole,
      p_midsole: input.grade.midsole,
      p_creasing: input.grade.creasing,
      p_upper: input.grade.upper,
      p_heel: input.grade.heel,
      p_accessories: input.grade.accessories,
      p_notes: input.notes ?? null,
    }),
    'fn_submit_listing',
  ) as UUID;
}

/**
 * fn_approve_submission(p_item_id, p_price_cents) -> uuid
 *
 * The admin half of the review gate (013). Fiats the submission: moves the
 * item to 'in_custody', mints the card, and puts a 'public' listing live at
 * the submitted asking price (or p_price_cents when the admin overrides it).
 * Returns the listing id.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS.
 */
export async function approveSubmission(
  itemId: UUID,
  priceCents?: Cents | null,
): Promise<UUID> {
  const supabase = await createServerSupabase();

  const listingId = unwrap(
    await supabase.rpc('fn_approve_submission', {
      p_item_id: itemId,
      p_price_cents: priceCents ?? null,
    }),
    'fn_approve_submission',
  ) as UUID;

  await sendSubmissionApprovedEmailForListing(listingId);

  return listingId;
}

async function sendSubmissionApprovedEmailForListing(listingId: UUID): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: listing, error } = await supabase
    .from('listings')
    .select(
      `id, card:cards!inner(id, item:items!inner(consignor_id, sku:skus!inner(brand, model, colorway, size_us)), seller_id)`,
    )
    .eq('id', listingId)
    .maybeSingle();

  if (error || !listing) {
    console.error('[email] submission_approved — could not load listing for email:', { listingId, error });
    return;
  }

  const card = Array.isArray(listing.card) ? listing.card[0] : listing.card;
  const item = card?.item;
  const sku = item?.sku;
  const consignorId = item?.consignor_id;

  if (!card || !item || !sku || !consignorId) {
    console.error('[email] submission_approved — incomplete listing data:', { listingId, listing });
    return;
  }

  const { data: consignor, error: consignorError } = await supabase
    .from('users')
    .select('email, handle')
    .eq('id', consignorId)
    .maybeSingle();

  if (consignorError || !consignor?.email) {
    console.error('[email] submission_approved — could not load consignor:', { consignorId, error: consignorError });
    return;
  }

  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://flexsoar.net'}/market/${card.id}`;

  await sendSubmissionApprovedEmail({
    consignorEmail: consignor.email,
    consignorHandle: consignor.handle,
    shoeBrand: sku.brand,
    shoeModel: sku.model,
    shoeColorway: sku.colorway,
    shoeSizeUs: sku.size_us,
    listingUrl,
  });

  // Also write a notification row (notification table must exist)
  try {
    await supabase.from('notifications').insert({
      user_id: consignorId,
      type: 'submission_approved',
      payload: {
        card_id: card.id,
        listing_id: listingId,
        shoe_brand: sku.brand,
        shoe_model: sku.model,
        shoe_colorway: sku.colorway,
        shoe_size_us: sku.size_us,
        listing_url: listingUrl,
      },
    });
  } catch (notificationError) {
    // Notification table may not exist yet; log but don't fail the email
    console.warn('[notification] submission_approved — could not write notification:', notificationError);
  }
}

/**
 * fn_reject_submission(p_item_id, p_reason) -> void
 *
 * Rejects a pending review: the item returns to the seller ('returned_to
 * _consignor') and the reason is appended to grading_notes. The submission
 * cannot be resubmitted; it is dead.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS.
 */
export async function rejectSubmission(
  itemId: UUID,
  reason: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_reject_submission', {
      p_item_id: itemId,
      p_reason: reason,
    }),
    'fn_reject_submission',
  );
}

/**
 * fn_confirm_shipment(p_redemption_id, p_carrier, p_tracking) -> void
 *
 * Dispatch for a seller-held redemption: the custody holder (or an admin)
 * stamps carrier, tracking and shipped_at, moves the redemption to 'shipped'
 * and the item to 'shipped', and credits the fulfiller's
 * fulfilments_completed. Refuses once already shipped, refuses anyone who is
 * neither the fulfiller nor an admin.
 *
 * @throws NOT_FOUND, WRONG_STATUS, NOT_FULFILLER, INVALID_SHIPMENT.
 */
export async function confirmShipment(
  redemptionId: UUID,
  carrier: string,
  tracking: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_confirm_shipment', {
      p_redemption_id: redemptionId,
      p_carrier: carrier,
      p_tracking: tracking,
    }),
    'fn_confirm_shipment',
  );
}

/**
 * fn_mark_default(p_redemption_id, p_note) -> void
 *
 * The seller never shipped. FlexSoar absorbs the loss: the redemption is
 * marked defaulted, the item frees back to 'released', and the defaulting
 * seller is permanently restricted (is_restricted = true) with the note on
 * the item. Credit held by the seller is NOT clawed back here —
 * deliberately, 013 wants that to be a considered admin action with its own
 * written reason.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS.
 */
export async function markDefault(
  redemptionId: UUID,
  note: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_mark_default', {
      p_redemption_id: redemptionId,
      p_note: note,
    }),
    'fn_mark_default',
  );
}

/**
 * fn_record_proof(p_item_id, p_photos) -> void
 *
 * The custody holder re-photographs a held item to prove it still exists
 * (driven off items_proof_overdue). Writes the photos and stamps
 * last_proof_at. NOT a FlexSoar authentication — grade_source stays honest.
 *
 * SCHEMA FOLLOW-UP: 013 routes this through the existing fn_set_item_photos,
 * which calls fn_require_admin() — so a non-admin custody holder is refused
 * with FORBIDDEN in the current schema, pre-mint or not. The wrapper is
 * written against 013's intent; the refusal and the fix both belong in
 * docs/handoff/data.md.
 *
 * @throws NOT_FOUND, NOT_OWNER, FORBIDDEN (013 follow-up), TOO_FEW_PHOTOS,
 *         INVALID_PHOTO_URL, WRONG_STATUS (post-mint, "grading evidence is
 *         frozen").
 */
export async function recordProof(
  itemId: UUID,
  photos: string[],
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrap(
    await supabase.rpc('fn_record_proof', {
      p_item_id: itemId,
      p_photos: photos,
    }),
    'fn_record_proof',
  );
}

/**
 * Create or update a catalog SKU. Direct table write under skus_admin_write —
 * there is no RPC, the RLS policy is the guard, and a non-admin session is
 * refused by Postgres with 42501 (surfaced as FORBIDDEN).
 *
 * BOTH BRANCHES CHANGED UNDER 027 — this is a 009 sanctioned extension, not
 * one of the frozen 16, so the body (not the signature) was fixed in place:
 *
 * - `market_price_cents` is a DERIVED column as of 027
 *   (coalesce(price_override_cents, sku_models.base_price_cents x
 *   size_multiplier)), maintained by a trigger that RAISES on a direct write
 *   rather than silently ignoring it — the exact bug class AGENT_RULES.md
 *   warns against. Supplying it here throws MARKET_PRICE_IS_DERIVED before
 *   this function ever builds a query, so the value is never silently
 *   dropped OR misrouted to whichever model the caller meant (a variant's
 *   caller cannot know if it is the only size, so guessing which model to
 *   reprice would reprice every sibling size silently). Use
 *   updateSkuModel() for the oracle or updateSkuVariant() for a per-size
 *   override instead.
 * - `skus.model_id` is NOT NULL as of 027 and UpsertSkuInput has no field to
 *   supply one, so a plain insert (no `id`) can no longer succeed — it would
 *   hit a NOT NULL violation with no useful error. Refused up front instead,
 *   with SKU_CREATION_REQUIRES_MODEL naming the real replacement:
 *   createSkuModel() then ensureSkuVariant(). The update branch (an existing
 *   variant, `id` present) is unaffected — model_id already exists on the row.
 *
 * @returns the full row as written, id included — the caller needs it for
 *          setFloatCurve() after a create.
 * @throws FORBIDDEN, WRONG_STATUS (duplicate of brand/model/colorway/size),
 *         NOT_FOUND (update of an id that does not exist),
 *         MARKET_PRICE_IS_DERIVED (market_price_cents supplied),
 *         SKU_CREATION_REQUIRES_MODEL (insert with no id).
 */
export async function upsertSku(sku: UpsertSkuInput): Promise<Sku> {
  // Both guards below run before any Supabase client is touched — a bad call
  // is refused for free, and neither needs a request context to test.
  if (sku.market_price_cents !== undefined) {
    throw new ContractError(
      'MARKET_PRICE_IS_DERIVED',
      'skus.market_price_cents is derived as of 027 (base price x size ' +
        'multiplier, or an override) and cannot be written directly. Call ' +
        'updateSkuModel() to change the oracle, or updateSkuVariant() to set ' +
        'a price_override_cents on this one size.',
      { sku },
    );
  }

  const { id, ...columns } = sku;

  if (!id) {
    throw new ContractError(
      'SKU_CREATION_REQUIRES_MODEL',
      'upsertSku() can no longer create a SKU: skus.model_id is NOT NULL as ' +
        'of 027 and this function has no way to supply one. Call ' +
        'createSkuModel(brand, model, colorway) once per model, then ' +
        'ensureSkuVariant(modelId, sizeUs) for each size.',
      { sku },
    );
  }

  // id is guaranteed present past the check above — this function is
  // update-only as of 027 (see the doc comment).
  const supabase = await createServerSupabase();
  const result = await supabase
    .from('skus')
    .update(columns)
    .eq('id', id)
    .select(SKU_COLUMNS)
    .maybeSingle();

  if (result.error) fail(result.error, 'skus');
  if (!result.data) {
    // RLS makes "no such row" and "not yours to update" the same silence.
    // For skus the read policy is public, so absence really is absence —
    // unless the session is non-admin, in which case the UPDATE matched
    // nothing it was allowed to touch. Read it back to tell the two apart.
    const exists = await supabase
      .from('skus')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (exists.data) {
      throw new ContractError(
        'FORBIDDEN',
        `sku ${id} exists but the update wrote nothing — the session is not an admin`,
        { id },
      );
    }
    throw new ContractError('NOT_FOUND', `sku ${id} not found`, { id });
  }
  return result.data as Sku;
}

/**
 * fn_replace_sku_art(p_sku_id, p_art_url) -> skus
 *
 * The sanctioned replacement path for a SKU's pixel art: this changes the
 * rendered art on every existing card of the SKU, so it must be a deliberate
 * act. The trigger guard (fn_guard_sku_art_url, 015) blocks ordinary writes
 * once a SKU has art; this RPC lifts that guard for its own transaction, runs
 * SECURITY INVOKER under skus_admin_write, and requires an admin session via
 * fn_require_admin(). Pass null to clear the art.
 *
 * Ordinary art writes (first art, null -> value) still go through upsertSku
 * and are exempt from the guard.
 *
 * @returns the full row as written, id included.
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND (no such SKU).
 */
export async function replaceSkuArt(skuId: UUID, artUrl: string | null): Promise<Sku> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_replace_sku_art', {
      p_sku_id: skuId,
      p_art_url: artUrl,
    }),
    'fn_replace_sku_art',
  ) as Sku;
}

/**
 * Replace a SKU's entire float curve. Direct table writes under
 * curve_admin_write; the RLS policy is the guard, exactly as upsertSku.
 *
 * Replace, not merge: the curve is one object that happens to be stored as
 * rows, and fn_float_multiplier takes the first band that matches, so stale
 * leftovers from a previous curve would silently change valuations.
 *
 * NOT ATOMIC. PostgREST has no transactions, so this is a delete followed by
 * an insert. If the insert fails, the SKU is left with no curve — which is a
 * DEFINED state, not a broken one: fn_float_multiplier falls back to the
 * linear formula until the curve is re-saved. The failure is thrown either
 * way; retry the whole call.
 *
 * Bands are validated here because the table has no constraints on them: each
 * band needs 0 <= float_min < float_max <= 1 and bands must not overlap.
 * Passing an empty array clears the curve back to the linear fallback.
 *
 * @throws FORBIDDEN, UNKNOWN (malformed bands, message says which).
 */
export async function setFloatCurve(
  skuId: UUID,
  bands: readonly FloatCurveBand[],
): Promise<void> {
  const sorted = [...bands].sort((a, b) => a.float_min - b.float_min);
  for (let i = 0; i < sorted.length; i++) {
    const band = sorted[i];
    if (
      !Number.isFinite(band.value_multiplier) ||
      band.value_multiplier < 0 ||
      !(band.float_min >= 0 && band.float_min < band.float_max && band.float_max <= 1)
    ) {
      throw new ContractError(
        'UNKNOWN',
        `invalid float curve band [${band.float_min}, ${band.float_max}) x ${band.value_multiplier}: ` +
          'need 0 <= min < max <= 1 and a non-negative multiplier',
        { band },
      );
    }
    if (i > 0 && band.float_min < sorted[i - 1].float_max) {
      throw new ContractError(
        'UNKNOWN',
        `float curve bands overlap at ${band.float_min}: ` +
          `[${sorted[i - 1].float_min}, ${sorted[i - 1].float_max}) then ` +
          `[${band.float_min}, ${band.float_max})`,
        { bands: sorted },
      );
    }
  }

  const supabase = await createServerSupabase();

  // Deleting zero rows is success, so a non-admin session sails through the
  // delete (RLS silently matches nothing) and only trips on the insert —
  // unless the new curve is empty. Check admin-ness via the write policy
  // first: an insert-then-delete order would fix empty-curve but break
  // replace. Probe with the delete's returned rows instead.
  const del = await supabase
    .from('sku_float_curve')
    .delete()
    .eq('sku_id', skuId)
    .select('sku_id');
  if (del.error) fail(del.error, 'sku_float_curve');

  if (sorted.length === 0) {
    // Nothing to insert, so the RLS refusal above never had a chance to fire
    // for a non-admin — but their delete also matched nothing, so the curve
    // is untouched either way. Verify intent was honoured for admins: if rows
    // remain, the session was not allowed to delete them.
    const left = await supabase
      .from('sku_float_curve')
      .select('sku_id')
      .eq('sku_id', skuId)
      .limit(1);
    if (left.error) fail(left.error, 'sku_float_curve');
    if ((left.data ?? []).length > 0) {
      throw new ContractError(
        'FORBIDDEN',
        `the curve for sku ${skuId} was not cleared — the session is not an admin`,
        { skuId },
      );
    }
    return;
  }

  const inserted = await supabase
    .from('sku_float_curve')
    .insert(sorted.map((band) => ({ sku_id: skuId, ...band })));
  if (inserted.error) fail(inserted.error, 'sku_float_curve');
}

// ============================================================
// CATALOG — MODEL / VARIANT — added by 027_sku_models.sql
// ============================================================
//
// 027 splits SKU identity into a model (brand + model + colourway, the
// ORACLE base_price_cents, the shared art) and a variant (skus: size_us,
// size_multiplier, price_override_cents). See lib/db/types.ts's SkuModel/Sku
// doc comments and 027_sku_models.sql's own header for the full reasoning.

/**
 * Every catalog model, each with how many size variants and how many minted
 * cards it has. "Models with more than one card" is the metric 027 exists to
 * make measurable — see 027_sku_models.sql section C10 of
 * scripts/smoke_catalog.sql.
 *
 * Three queries, not a join: PostgREST has no GROUP BY aggregation without a
 * view or RPC, and neither is this track's to add (schema is human-only).
 * Fine at catalog scale (this is an admin listing, not a hot path).
 */
export async function listSkuModels(
  query: SkuModelsQuery = {},
): Promise<SkuModelSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  let builder = supabase.from('sku_models').select(SKU_MODEL_COLUMNS);

  if (query.brand !== undefined) builder = builder.eq('brand', query.brand);
  if (query.model !== undefined) builder = builder.eq('model', query.model);
  if (query.search) {
    const term = sanitizePattern(query.search);
    if (term) {
      builder = builder.or(
        [`brand.ilike.*${term}*`, `model.ilike.*${term}*`, `colorway.ilike.*${term}*`].join(','),
      );
    }
  }

  const models = unwrap(
    await builder
      .order('demand_score', { ascending: false })
      .order('id', { ascending: true })
      .range(page.from, page.to),
    'sku_models',
  ) as SkuModel[] | null;

  const rows = models ?? [];
  if (rows.length === 0) return [];

  const modelIds = rows.map((m) => m.id);

  const variantRows = (unwrap(
    await supabase.from('skus').select('id, model_id').in('model_id', modelIds),
    'skus',
  ) ?? []) as { id: UUID; model_id: UUID }[];

  const variantCounts = new Map<UUID, number>();
  const modelBySkuId = new Map<UUID, UUID>();
  for (const v of variantRows) {
    variantCounts.set(v.model_id, (variantCounts.get(v.model_id) ?? 0) + 1);
    modelBySkuId.set(v.id, v.model_id);
  }

  const cardCounts = new Map<UUID, number>();
  const variantIds = variantRows.map((v) => v.id);
  if (variantIds.length > 0) {
    const cardRows = (unwrap(
      await supabase.from('cards').select('sku_id').in('sku_id', variantIds),
      'cards',
    ) ?? []) as { sku_id: UUID }[];

    for (const c of cardRows) {
      const modelId = modelBySkuId.get(c.sku_id);
      if (modelId === undefined) continue;
      cardCounts.set(modelId, (cardCounts.get(modelId) ?? 0) + 1);
    }
  }

  return rows.map((m) => ({
    ...m,
    variant_count: variantCounts.get(m.id) ?? 0,
    card_count: cardCounts.get(m.id) ?? 0,
  }));
}

/**
 * One model plus every size variant beneath it, oldest size first.
 *
 * @returns null if no such model — same "absence, not an error" convention
 *          as getItem()/getListing().
 */
export async function getSkuModel(modelId: UUID): Promise<SkuModelDetail | null> {
  const supabase = await createServerSupabase();

  const modelResult = await supabase
    .from('sku_models')
    .select(SKU_MODEL_COLUMNS)
    .eq('id', modelId)
    .maybeSingle();
  if (modelResult.error && !isNoRows(modelResult.error)) fail(modelResult.error, 'sku_models');

  const model = modelResult.data as SkuModel | null;
  if (!model) return null;

  const variants = unwrap(
    await supabase
      .from('skus')
      .select(SKU_COLUMNS)
      .eq('model_id', modelId)
      .order('size_us', { ascending: true }),
    'skus',
  ) as Sku[] | null;

  return { ...model, variants: variants ?? [] };
}

/**
 * fn_create_sku_model(p_brand, p_model, p_colorway, p_base_price_cents) -> uuid
 *
 * Admin only. Idempotent on the identity triple (brand, model, colorway) —
 * returns the existing model's id on conflict rather than erroring, so a
 * seller-facing "type your shoe, create if nothing fits" flow can call this
 * without checking first. base_price_cents is the ORACLE: null is a valid,
 * deliberate "unpriced" state (fn_mint_card refuses on it), never a mistake
 * to default away.
 *
 * @throws FORBIDDEN, SKU_MODEL_IDENTITY_REQUIRED (blank brand/model/colorway),
 *         INVALID_AMOUNT (non-positive base price).
 */
export async function createSkuModel(
  brand: string,
  model: string,
  colorway: string,
  basePriceCents: Cents | null = null,
): Promise<UUID> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_create_sku_model', {
      p_brand: brand,
      p_model: model,
      p_colorway: colorway,
      p_base_price_cents: basePriceCents,
    }),
    'fn_create_sku_model',
  ) as UUID;
}

/**
 * Update a model's oracle price and metadata. Direct table write under
 * sku_models_admin_write, same guard shape as upsertSku(). Changing
 * base_price_cents propagates to every size variant's market_price_cents
 * (trg_sku_model_propagate -> fn_sync_sku_variants) and re-tiers every
 * FUTURE mint — cards.tier is stamped at mint and immutable, so nothing
 * already minted moves.
 *
 * `art_url` is not settable here — see UpdateSkuModelInput's doc comment;
 * use replaceSkuArt().
 *
 * @returns the full model row as written.
 * @throws FORBIDDEN, NOT_FOUND.
 */
export async function updateSkuModel(
  modelId: UUID,
  input: UpdateSkuModelInput,
): Promise<SkuModel> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('sku_models')
    .update(input)
    .eq('id', modelId)
    .select(SKU_MODEL_COLUMNS)
    .maybeSingle();

  if (result.error) fail(result.error, 'sku_models');
  if (!result.data) {
    // Same RLS-silence disambiguation as upsertSku(): sku_models_read is
    // public, so absence really is absence unless a non-admin session's
    // UPDATE matched a row it was not allowed to touch.
    const exists = await supabase.from('sku_models').select('id').eq('id', modelId).maybeSingle();
    if (exists.data) {
      throw new ContractError(
        'FORBIDDEN',
        `sku_model ${modelId} exists but the update wrote nothing — the session is not an admin`,
        { modelId },
      );
    }
    throw new ContractError('NOT_FOUND', `sku_model ${modelId} not found`, { modelId });
  }
  return result.data as SkuModel;
}

/**
 * Rename a model's brand / model / colorway. Direct table write under
 * sku_models_admin_write, same guard shape as updateSkuModel() — there is no
 * RPC for this (docs/handoff/admin.md item 14 filed exactly this gap).
 *
 * WHAT THIS DOES NOT DO: merge two models. sku_models_identity_uidx means a
 * rename that lands on an identity another model already has FAILS with
 * SKU_MODEL_IDENTITY_CONFLICT rather than combining them — that failure is
 * how a future duplicate-merge tool would discover "AJ1 Chicago" and
 * "Air Jordan 1 Retro High OG Chicago" describe the same shoe, but actually
 * merging them (moving the losing model's variants onto the survivor, then
 * deleting it) is unbuilt, is not this function's job, and is not added
 * here — see 027_sku_models.sql's own "APP-LAYER FOLLOW-UPS" note.
 *
 * VARIANT IDENTITY PROPAGATES ON RENAME, THROUGH THE EXISTING PATH — verified
 * by reading 027_sku_models.sql, not by probing the live project:
 *   1. This UPDATE changes sku_models.brand/model/colorway, which fires
 *      trg_sku_model_propagate (AFTER UPDATE, `when (old.* is distinct from
 *      new.*)` — a rename qualifies).
 *   2. That trigger calls fn_sync_sku_variants(new.id), which runs
 *      `UPDATE skus SET art_url = ..., sprite_key = ..., ... WHERE model_id =
 *      ...`. Its own SET list does not mention brand/model/colorway.
 *   3. But trg_sku_variant_derive is a BEFORE UPDATE trigger on skus with NO
 *      `when` clause, so it fires on EVERY update to a matched row —
 *      including this one — and unconditionally runs
 *      `new.brand := v_m.brand; new.model := v_m.model; new.colorway :=
 *      v_m.colorway;` before the row is written, reading v_m fresh (the
 *      rename already committed within the same transaction, being an
 *      earlier statement in it).
 *   4. So every sibling variant's brand/model/colorway copy is overwritten
 *      to the NEW identity as a side effect of step 2's update, even though
 *      fn_sync_sku_variants never names those columns itself.
 * This is an interaction between two functions, not a documented contract —
 * if a future migration adds a `when` clause to trg_sku_variant_derive or
 * changes fn_sync_sku_variants' WHERE clause, this stops being true. It has
 * NOT been verified against the live project (AGENT_RULES.md section 8) —
 * only read against the migration file.
 *
 * @returns the full model row as written.
 * @throws FORBIDDEN, NOT_FOUND, SKU_MODEL_IDENTITY_REQUIRED (a supplied
 *         field is blank after trimming, or none was supplied at all),
 *         SKU_MODEL_IDENTITY_CONFLICT (the new triple belongs to another
 *         model already — sku_models_identity_uidx).
 */
export async function renameSkuModel(
  modelId: UUID,
  input: RenameSkuModelInput,
): Promise<SkuModel> {
  const columns: { brand?: string; model?: string; colorway?: string } = {};
  for (const [key, value] of Object.entries(input) as [keyof RenameSkuModelInput, string | undefined][]) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new ContractError(
        'SKU_MODEL_IDENTITY_REQUIRED',
        `renameSkuModel(): ${key} was supplied but is blank after trimming`,
        { modelId, input },
      );
    }
    columns[key] = trimmed;
  }
  if (Object.keys(columns).length === 0) {
    throw new ContractError(
      'SKU_MODEL_IDENTITY_REQUIRED',
      'renameSkuModel(): supply at least one of brand, model, colorway',
      { modelId, input },
    );
  }

  const supabase = await createServerSupabase();

  const result = await supabase
    .from('sku_models')
    .update(columns)
    .eq('id', modelId)
    .select(SKU_MODEL_COLUMNS)
    .maybeSingle();

  if (result.error) fail(result.error, 'sku_models');
  if (!result.data) {
    // Same RLS-silence disambiguation as updateSkuModel()/upsertSku().
    const exists = await supabase.from('sku_models').select('id').eq('id', modelId).maybeSingle();
    if (exists.data) {
      throw new ContractError(
        'FORBIDDEN',
        `sku_model ${modelId} exists but the rename wrote nothing — the session is not an admin`,
        { modelId },
      );
    }
    throw new ContractError('NOT_FOUND', `sku_model ${modelId} not found`, { modelId });
  }
  return result.data as SkuModel;
}

/**
 * fn_ensure_sku_variant(p_model_id, p_size_us) -> uuid
 *
 * Any signed-in user. Idempotent per (model_id, size_us) — returns the
 * existing variant's id rather than forking a duplicate. Safe for a seller
 * to call directly: the variant's price is derived from the model, so
 * creating one confers no value, and a variant under an unpriced model is
 * simply unmintable (fn_mint_card already enforces that).
 *
 * @throws UNAUTHENTICATED, NOT_FOUND (no such model), INVALID_SKU_SIZE (not
 *         a whole/half size between 3 and 20).
 */
export async function ensureSkuVariant(modelId: UUID, sizeUs: number): Promise<UUID> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_ensure_sku_variant', {
      p_model_id: modelId,
      p_size_us: sizeUs,
    }),
    'fn_ensure_sku_variant',
  ) as UUID;
}

/**
 * Update a variant's size curve point or per-size price override. Direct
 * table write under skus_admin_write. market_price_cents is NOT settable
 * here (see UpdateSkuVariantInput) — trg_sku_variant_derive recomputes it
 * from whichever of these two changed.
 *
 * @returns the full variant row as written.
 * @throws FORBIDDEN, NOT_FOUND.
 */
export async function updateSkuVariant(
  skuId: UUID,
  input: UpdateSkuVariantInput,
): Promise<Sku> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('skus')
    .update(input)
    .eq('id', skuId)
    .select(SKU_COLUMNS)
    .maybeSingle();

  if (result.error) fail(result.error, 'skus');
  if (!result.data) {
    const exists = await supabase.from('skus').select('id').eq('id', skuId).maybeSingle();
    if (exists.data) {
      throw new ContractError(
        'FORBIDDEN',
        `sku ${skuId} exists but the update wrote nothing — the session is not an admin`,
        { skuId },
      );
    }
    throw new ContractError('NOT_FOUND', `sku ${skuId} not found`, { skuId });
  }
  return result.data as Sku;
}

/**
 * Delete a SKU variant. Direct table write under skus_admin_write.
 * Only succeeds if no cards or items reference this variant
 * (FKs on cards.sku_id and items.sku_id are RESTRICT).
 * sku_float_curve rows cascade; watchlists.sku_id is nullable.
 *
 * @throws FORBIDDEN, NOT_FOUND, WRONG_STATUS (cards/items exist).
 */
export async function deleteSkuVariant(skuId: UUID): Promise<void> {
  const supabase = await createServerSupabase();

  const cards = unwrap(
    await supabase.from('cards').select('id').eq('sku_id', skuId).limit(1),
    'cards',
  ) as { id: UUID }[] | null;

  if (cards && cards.length > 0) {
    throw new ContractError(
      'WRONG_STATUS',
      'Cannot delete SKU variant: minted cards exist for this size',
      { skuId },
    );
  }

  const items = unwrap(
    await supabase.from('items').select('id').eq('sku_id', skuId).limit(1),
    'items',
  ) as { id: UUID }[] | null;

  if (items && items.length > 0) {
    throw new ContractError(
      'WRONG_STATUS',
      'Cannot delete SKU variant: intake items exist for this size',
      { skuId },
    );
  }

  const result = await supabase
    .from('skus')
    .delete()
    .eq('id', skuId)
    .select('id');

  if (result.error) fail(result.error, 'skus');
  if (!result.data || result.data.length === 0) {
    const exists = await supabase.from('skus').select('id').eq('id', skuId).maybeSingle();
    if (exists.data) {
      throw new ContractError(
        'FORBIDDEN',
        `sku ${skuId} exists but the delete wrote nothing — the session is not an admin`,
        { skuId },
      );
    }
    throw new ContractError('NOT_FOUND', `sku ${skuId} not found`, { skuId });
  }
}

/**
 * Delete a SKU model. Direct table write under sku_models_admin_write.
 * Only succeeds if no variants (skus) reference this model
 * (FK on skus.model_id is RESTRICT).
 *
 * @throws FORBIDDEN, NOT_FOUND, WRONG_STATUS (variants exist).
 */
export async function deleteSkuModel(modelId: UUID): Promise<void> {
  const supabase = await createServerSupabase();

  const variants = unwrap(
    await supabase.from('skus').select('id').eq('model_id', modelId).limit(1),
    'skus',
  ) as { id: UUID }[] | null;

  if (variants && variants.length > 0) {
    throw new ContractError(
      'WRONG_STATUS',
      'Cannot delete model: size variants exist. Delete all variants first.',
      { modelId },
    );
  }

  const result = await supabase
    .from('sku_models')
    .delete()
    .eq('id', modelId)
    .select('id');

  if (result.error) fail(result.error, 'sku_models');
  if (!result.data || result.data.length === 0) {
    const exists = await supabase.from('sku_models').select('id').eq('id', modelId).maybeSingle();
    if (exists.data) {
      throw new ContractError(
        'FORBIDDEN',
        `sku_model ${modelId} exists but the delete wrote nothing — the session is not an admin`,
        { modelId },
      );
    }
    throw new ContractError('NOT_FOUND', `sku_model ${modelId} not found`, { modelId });
  }
}

// ============================================================
// PLATFORM EARNINGS — added by 020
// ============================================================
//
// All three are admin-guarded via fn_require_admin() inside the SQL — the
// 005/008 pattern — so they run on the SESSION client. Live-verified
// (2026-08-21): calling fn_platform_position from service-role is refused
// with "admin privileges required" (FORBIDDEN); a real admin session reads it
// fine.

/** fn_platform_position()'s row, shape live-verified against the project. */
export interface PlatformPosition {
  currency_balance_cents: Cents;
  credit_liability_cents: Cents;
  earned_gross_cents: Cents;
  swept_cents: Cents;
  /** Commission earned and not yet moved out. */
  unswept_cents: Cents;
  reserve_cents: Cents;
  /**
   * unswept_cents minus the chargeback reserve, floored at zero — the number
   * that is actually safe to sweep. Pass this (or less) to recordSweep(),
   * never unswept_cents itself.
   */
  sweepable_cents: Cents;
}

/**
 * fn_platform_position() -> row
 *
 * The platform's own earnings position: what has been earned, what has
 * already been swept to the bank, and what is safe to sweep next.
 * `earned_gross_cents` includes money already swept — never spend against it
 * directly, read `sweepable_cents`.
 *
 * ADMIN ONLY, SESSION CLIENT. `.single()` because the SQL function returns
 * exactly one row (`returns table(...)`, not a set).
 *
 * @throws FORBIDDEN ("admin privileges required").
 */
export async function getPlatformPosition(): Promise<PlatformPosition> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_platform_position').single(),
    'fn_platform_position',
  ) as PlatformPosition;
}

/**
 * fn_record_sweep(p_amount_cents, p_bank_ref, p_note) -> uuid
 *
 * Records that platform earnings were actually moved to the bank — a
 * bookkeeping entry, not the transfer itself; move the money first, exactly
 * like purchaseCard() records a settlement that already happened.
 *
 * ADMIN ONLY, SESSION CLIENT, same as getPlatformPosition(). Re-read
 * getPlatformPosition() beforehand and pass no more than `sweepable_cents` —
 * passing more than `unswept_cents` raises SWEEP_EXCEEDS_UNSWEPT.
 *
 * @param bankRef the bank's own reference for the transfer, for reconciliation.
 * @returns the new sweep record id.
 * @throws FORBIDDEN ("admin privileges required"), SWEEP_EXCEEDS_UNSWEPT.
 */
export async function recordSweep(
  amountCents: Cents,
  bankRef: string,
  note?: string | null,
): Promise<UUID> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_record_sweep', {
      p_amount_cents: amountCents,
      p_bank_ref: bankRef,
      p_note: note ?? null,
    }),
    'fn_record_sweep',
  ) as UUID;
}

/** fn_check_solvency()'s row, shape live-verified against the project. */
export interface SolvencyCheck {
  ok: boolean;
  expected_cents: Cents;
  /** Null when `actualCents` was omitted from checkSolvency(). */
  actual_cents: Cents | null;
  /** Null under the same condition as actual_cents. */
  variance_cents: Cents | null;
  liability_cents: Cents;
  unswept_cents: Cents;
  detail: string;
}

/**
 * fn_check_solvency(p_actual_cents) -> row
 *
 * Compares what the ledger expects the platform to be holding in cash
 * against `actualCents` (a real bank balance a human supplies) and reports
 * `ok` plus the variance. Omit `actualCents` to see only `expected_cents`
 * and the liability breakdown, with `actual_cents`/`variance_cents` null —
 * live-verified.
 *
 * ADMIN ONLY, SESSION CLIENT, same as getPlatformPosition().
 *
 * @throws FORBIDDEN ("admin privileges required").
 */
export async function checkSolvency(actualCents?: Cents | null): Promise<SolvencyCheck> {
  const supabase = await createServerSupabase();
  return unwrap(
    await supabase
      .rpc('fn_check_solvency', { p_actual_cents: actualCents ?? null })
      .single(),
    'fn_check_solvency',
  ) as SolvencyCheck;
}

// ============================================================
// READS
// ============================================================

/** Full card view: sku, owner, physical item, oracle value, ownership chain. */
export async function getCard(cardId: UUID): Promise<CardDetail | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('cards')
    .select(
      `${CARD_SUMMARY_COLUMNS}, exceptional_reason, ` +
        `sku:skus(${SKU_REF_COLUMNS}), ` +
        `owner:public_profiles(${PUBLIC_PROFILE_COLUMNS}), ` +
        `item:items(id, status, photos, grading_notes, graded_at, authenticated_at)`,
    )
    .eq('id', cardId)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'cards');

  const row = result.data as
    | (CardRow & {
        exceptional_reason: string | null;
        owner: PublicProfileRow | PublicProfileRow[];
        item: CardDetail['item'] | CardDetail['item'][];
      })
    | null;
  if (!row) return null;

  // fn_card_value_cents() by RPC rather than the JS mirror: for a single card
  // there is no reason to approximate what the database can answer exactly.
  const [listings, oracle, provenance] = await Promise.all([
    liveListingsByCard(supabase, [row.id]),
    supabase.rpc('fn_card_value_cents', { p_card: cardId }),
    supabase
      .from('card_provenance')
      .select(
        `owner_level, acquired_at, released_at, price_cents, ` +
          `owner:public_profiles(${PUBLIC_PROFILE_COLUMNS})`,
      )
      .eq('card_id', cardId)
      .order('acquired_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  const oracleValue = unwrap(oracle, 'fn_card_value_cents') as Cents | null;
  const chain = (unwrap(provenance, 'card_provenance') as ProvenanceRow[] | null) ?? [];

  return {
    ...toCardSummary(row, listings.get(row.id) ?? null),
    exceptional_reason: row.exceptional_reason,
    owner: toUserSummary(requireEmbed(row.owner, 'cards.owner')),
    item: requireEmbed(row.item, 'cards.item'),
    oracle_value_cents: oracleValue,
    provenance: chain.map((hop) => ({
      owner: toUserSummary(requireEmbed(hop.owner, 'card_provenance.owner')),
      owner_level: hop.owner_level,
      acquired_at: hop.acquired_at,
      released_at: hop.released_at,
      price_cents: hop.price_cents,
    })),
  };
}

/** Browse and inventory grids. Defaults to active + locked cards, newest first. */
export async function getCards(query: CardsQuery = {}): Promise<CardSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);
  const sort = query.sort ?? 'recent';
  const byValue = sort === 'value_asc' || sort === 'value_desc';

  // brand/model/size live on the SKU, so the embed has to be an inner join for
  // the filter to reach the parent row rather than just blanking the embed.
  const needsSkuJoin =
    query.brand !== undefined || query.model !== undefined || query.sizeUs !== undefined;

  let builder = supabase
    .from('cards')
    .select(
      `${CARD_SUMMARY_COLUMNS}, sku:skus${needsSkuJoin ? '!inner' : ''}(${SKU_REF_COLUMNS})`,
    )
    .in('status', statusFilter<CardStatus>(query.status, ['active', 'locked']));

  if (query.ownerId) builder = builder.eq('owner_id', query.ownerId);
  if (query.skuId) builder = builder.eq('sku_id', query.skuId);
  if (query.tier?.length) builder = builder.in('tier', query.tier as Tier[]);
  if (query.isExceptional !== undefined) {
    builder = builder.eq('is_exceptional', query.isExceptional);
  }
  if (query.floatMin !== undefined) builder = builder.gte('float_value', query.floatMin);
  if (query.floatMax !== undefined) builder = builder.lte('float_value', query.floatMax);
  if (query.brand !== undefined) builder = builder.eq('sku.brand', query.brand);
  if (query.model !== undefined) builder = builder.eq('sku.model', query.model);
  if (query.sizeUs !== undefined) builder = builder.eq('sku.size_us', query.sizeUs);

  if (byValue) {
    // Ranked in JS below; take a stable window so paging is repeatable.
    builder = builder.order('id', { ascending: true }).range(0, JS_SORT_WINDOW - 1);
  } else {
    switch (sort) {
      case 'float_asc':
        builder = builder.order('float_value', { ascending: true });
        break;
      case 'float_desc':
        builder = builder.order('float_value', { ascending: false });
        break;
      case 'mint_asc':
        builder = builder.order('mint_number', { ascending: true });
        break;
      default:
        builder = builder.order('minted_at', { ascending: false });
    }
    // id breaks ties so two pages never repeat or skip a row.
    builder = builder.order('id', { ascending: true }).range(page.from, page.to);
  }

  let rows = (unwrap(await builder, 'cards') as CardRow[] | null) ?? [];

  if (byValue) {
    const curve = await floatCurvesFor(supabase, unique(rows.map((r) => r.sku_id)));
    const valueOf = (row: CardRow): number => {
      const sku = one(row.sku);
      const value = cardValueCents(
        sku?.market_price_cents ?? null,
        floatMultiplier(curve, row.sku_id, row.float_value),
      );
      // An unpriced SKU cannot be valued; park it at the end either way.
      return value ?? (sort === 'value_asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    };

    rows = [...rows]
      .sort((a, b) => (sort === 'value_asc' ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)))
      .slice(page.offset, page.offset + page.size);
  }

  const listings = await liveListingsByCard(supabase, rows.map((r) => r.id));
  return rows.map((row) => toCardSummary(row, listings.get(row.id) ?? null));
}

/** Market grid. Pass `viewerId` so early-access visibility resolves correctly. */
export async function getListings(query: ListingsQuery = {}): Promise<ListingSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);
  const sort = query.sort ?? 'recent';
  const byFloat = sort === 'float_asc' || sort === 'float_desc';

  let builder = supabase
    .from('listings')
    .select(
      `${LISTING_COLUMNS}, ` +
        `card:cards!inner(${CARD_SUMMARY_COLUMNS}, sku:skus!inner(${SKU_REF_COLUMNS})), ` +
        `seller:public_profiles!inner(${PUBLIC_PROFILE_COLUMNS})`,
    )
    .in('status', statusFilter<ListingStatus>(query.status, LIVE_LISTING_STATUSES));

  if (query.sellerId) builder = builder.eq('seller_id', query.sellerId);
  if (query.cardId) builder = builder.eq('card_id', query.cardId);
  if (query.skuId) builder = builder.eq('card.sku_id', query.skuId);
  if (query.tier?.length) builder = builder.in('card.tier', query.tier as Tier[]);
  if (query.floatMin !== undefined) builder = builder.gte('card.float_value', query.floatMin);
  if (query.floatMax !== undefined) builder = builder.lte('card.float_value', query.floatMax);
  if (query.priceMinCents !== undefined) builder = builder.gte('price_cents', query.priceMinCents);
  if (query.priceMaxCents !== undefined) builder = builder.lte('price_cents', query.priceMaxCents);
  if (query.brand !== undefined) builder = builder.eq('card.sku.brand', query.brand);
  if (query.model !== undefined) builder = builder.eq('card.sku.model', query.model);
  if (query.sizeUs !== undefined) builder = builder.eq('card.sku.size_us', query.sizeUs);

  // Applied on top of the listings_visibility RLS policy, not instead of it —
  // this is what makes an omitted viewerId mean "the anonymous view".
  builder = builder.or(await listingVisibilityFilter(supabase, query.viewerId));

  if (byFloat) {
    // float_value is on the embedded card; PostgREST cannot order a parent by
    // it. Window, then rank in JS.
    builder = builder.order('id', { ascending: true }).range(0, JS_SORT_WINDOW - 1);
  } else {
    switch (sort) {
      case 'price_asc':
        builder = builder.order('price_cents', { ascending: true });
        break;
      case 'price_desc':
        builder = builder.order('price_cents', { ascending: false });
        break;
      case 'public_at_asc':
        builder = builder.order('public_at', { ascending: true });
        break;
      default:
        builder = builder.order('created_at', { ascending: false });
    }
    builder = builder.order('id', { ascending: true }).range(page.from, page.to);
  }

  let rows = (unwrap(await builder, 'listings') as ListingRow[] | null) ?? [];

  if (byFloat) {
    const floatOf = (row: ListingRow): number => one(row.card)?.float_value ?? 0;
    rows = [...rows]
      .sort((a, b) => (sort === 'float_asc' ? floatOf(a) - floatOf(b) : floatOf(b) - floatOf(a)))
      .slice(page.offset, page.offset + page.size);
  }

  return rows.map(toListingSummary);
}

/**
 * A listing's own card already carries that listing — no second query, and no
 * chance of the two disagreeing.
 */
function toListingSummary(row: ListingRow): ListingSummary {
  const card = requireEmbed(row.card, 'listings.card');
  const isLive = LIVE_LISTING_STATUSES.includes(row.status);

  return {
    id: row.id,
    card_id: row.card_id,
    seller_id: row.seller_id,
    price_cents: row.price_cents,
    fair_price_cents: row.fair_price_cents ?? null,
    status: row.status,
    early_access_level: row.early_access_level,
    public_at: row.public_at,
    oracle_value_cents: row.oracle_value_cents,
    created_at: row.created_at,
    sold_at: row.sold_at,
    card: toCardSummary(card, isLive ? toListingRef(row) : null),
    seller: toUserSummary(requireEmbed(row.seller, 'listings.seller')),
  };
}

/** Listing detail, including the settled order once the webhook has landed. */
export async function getListing(listingId: UUID): Promise<ListingDetail | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('listings')
    .select(
      `${LISTING_COLUMNS}, ` +
        `card:cards!inner(${CARD_SUMMARY_COLUMNS}, sku:skus!inner(${SKU_REF_COLUMNS})), ` +
        `seller:public_profiles!inner(${PUBLIC_PROFILE_COLUMNS})`,
    )
    .eq('id', listingId)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'listings');

  const row = result.data as ListingRow | null;
  if (!row) return null;

  // orders_own_read restricts this to the buyer and the seller; anyone else
  // gets null, which is the same answer as "not settled yet".
  const orders = unwrap(
    await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false })
      .limit(1),
    'orders',
  ) as OrderSummary[] | null;

  return { ...toListingSummary(row), order: orders?.[0] ?? null };
}

/** Consignment with its items and its full event trail. */
export async function getConsignment(
  consignmentId: UUID,
): Promise<ConsignmentDetail | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('consignments')
    .select(`${CONSIGNMENT_COLUMNS}, consignor:public_profiles(${PUBLIC_PROFILE_COLUMNS})`)
    .eq('id', consignmentId)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'consignments');

  const row = result.data as ConsignmentRow | null;
  if (!row) return null;

  const summary = toConsignmentSummary(row);

  // Reads as the user. 004_rls_and_grants.sql added items_admin_read and
  // items_consignor_read alongside items_public_read, so the pre-mint pipeline
  // is now visible to the admin grading queue and to the consignor through
  // their own session. The service-role workaround this used to need is gone.
  const [itemRows, eventRows] = await Promise.all([
    supabase
      .from('items')
      .select(`${ITEM_SUMMARY_COLUMNS}, sku:skus(${SKU_REF_COLUMNS})`)
      .eq('consignment_id', consignmentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('consignment_events')
      .select(CONSIGNMENT_EVENT_COLUMNS)
      .eq('consignment_id', consignmentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  const items = (unwrap(itemRows, 'items') as ItemRow[] | null) ?? [];
  const events = (unwrap(eventRows, 'consignment_events') as ConsignmentEvent[] | null) ?? [];

  // items -> card is 1:1 and the card may not exist yet, so it is a lookup
  // rather than an embed.
  const cardByItem = new Map<UUID, UUID>();
  if (items.length > 0) {
    const cards = unwrap(
      await supabase
        .from('cards')
        .select('id, item_id')
        .in('item_id', items.map((item) => item.id)),
      'cards',
    ) as { id: UUID; item_id: UUID }[] | null;

    for (const card of cards ?? []) cardByItem.set(card.item_id, card.id);
  }

  return {
    ...summary,
    items: items.map((item) => toItemSummary(item, cardByItem.get(item.id) ?? null)),
    events,
  };
}

/**
 * The grading queue: items across every consignment. Added by 008.
 *
 * Visibility is whatever the caller's session allows, and the three policies
 * differ sharply. An admin sees everything (items_admin_read). A consignor
 * sees their own (items_consignor_read). Anyone else sees only minted,
 * redemption_hold and shipped items (items_public_read) — so an anonymous
 * caller asking for `{ status: ['pending_intake'] }` gets an empty array
 * rather than an error. Empty here means "none you may see", not "none exist".
 *
 * Oldest first: a queue is worked front to back.
 */
/**
 * One item by id — the grading bench view. Added for docs/handoff/admin.md
 * item 3, retiring the getAdminItem() local adapter.
 *
 * Null means "no such item or none you may see": items_admin_read,
 * items_consignor_read and items_public_read decide, exactly as getItems().
 */
export async function getItem(itemId: UUID): Promise<ItemSummary | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('items')
    .select(`${ITEM_SUMMARY_COLUMNS}, sku:skus(${SKU_REF_COLUMNS})`)
    .eq('id', itemId)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'items');

  const row = result.data as ItemRow | null;
  if (!row) return null;

  // items -> card is 1:1 and the card may not exist yet — a lookup, not an
  // embed, same as getItems() and getConsignment().
  const card = await supabase
    .from('cards')
    .select('id')
    .eq('item_id', itemId)
    .maybeSingle();

  if (card.error && !isNoRows(card.error)) fail(card.error, 'cards');

  return toItemSummary(row, (card.data as { id: UUID } | null)?.id ?? null);
}

export async function getItems(query: ItemsQuery = {}): Promise<ItemSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  let builder = supabase
    .from('items')
    .select(`${ITEM_SUMMARY_COLUMNS}, sku:skus(${SKU_REF_COLUMNS})`);

  if (query.status?.length) builder = builder.in('status', query.status as ItemStatus[]);
  if (query.consignmentId) builder = builder.eq('consignment_id', query.consignmentId);
  // Presence of the timestamp, not of the status — the two are independent.
  //
  // `.not(col, 'is', null)` for the positive case, not `.is(col, null)` with a
  // negate flag: PostgREST's is-null test has no negating parameter in
  // supabase-js, and passing a third argument is accepted by the types and
  // then ignored, which silently inverts the filter.
  if (query.graded !== undefined) {
    builder = query.graded
      ? builder.not('graded_at', 'is', null)
      : builder.is('graded_at', null);
  }
  if (query.authenticated !== undefined) {
    builder = query.authenticated
      ? builder.not('authenticated_at', 'is', null)
      : builder.is('authenticated_at', null);
  }

  const rows = unwrap(
    await builder
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page.from, page.to),
    'items',
  ) as ItemRow[] | null;

  const items = rows ?? [];
  if (items.length === 0) return [];

  // items -> card is 1:1 and the card may not exist yet, so it is a lookup
  // rather than an embed. Same shape as getConsignment().
  const cards = unwrap(
    await supabase
      .from('cards')
      .select('id, item_id')
      .in('item_id', items.map((item) => item.id)),
    'cards',
  ) as { id: UUID; item_id: UUID }[] | null;

  const cardByItem = new Map<UUID, UUID>();
  for (const card of cards ?? []) cardByItem.set(card.item_id, card.id);

  return items.map((item) => toItemSummary(item, cardByItem.get(item.id) ?? null));
}

/**
 * The review queue: submissions an admin has not yet ruled on, before the
 * fraud gate closes. Defaults to 'pending_review' — getSubmissions() with no
 * arguments is the admin in-box. Oldest first, like the fulfilment queue.
 *
 * Visibility is 013's policies, exactly like the other queues: items_admin_read
 * gives admins the whole queue, items_holder_read gives the submitting seller
 * their own pre-mint submissions. An empty array means "none you may see",
 * not "no submissions". grade is the seller's own six scores, guaranteed
 * present on any 013 submission (fn_submit_listing always writes all six).
 */
export async function getSubmissions(
  query: SubmissionsQuery = {},
): Promise<SubmissionSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  const statuses =
    query.status && query.status.length > 0
      ? query.status
      : ['pending_review'];

  const rows = unwrap(
    await supabase
      .from('items')
      .select(
        `${ITEM_SUMMARY_COLUMNS}, created_at, ` +
          `sku:skus(${SKU_REF_COLUMNS}), ` +
          `seller:public_profiles!custody_holder_id(${PUBLIC_PROFILE_COLUMNS})`,
      )
      .in('status', statuses as ItemStatus[])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page.from, page.to),
    'items',
  ) as SubmissionRow[] | null;

  return (rows ?? []).map((row) => ({
    id: row.id,
    sku_id: row.sku_id,
    status: row.status,
    float_value: row.float_value,
    condition_grade: row.condition_grade,
    // fn_submit_listing writes all six scores on every submission, so this
    // cannot be the both-or-neither null that toGradeComponents guards.
    grade: toGradeComponents(row)!,
    photos: row.photos,
    asking_price_cents: row.asking_price_cents,
    submitted_payout: row.submitted_payout,
    custody: row.custody,
    custody_holder_id: row.custody_holder_id,
    grade_source: row.grade_source,
    last_proof_at: row.last_proof_at,
    authenticated_at: row.authenticated_at,
    created_at: row.created_at,
    sku: requireEmbed(row.sku, 'items.sku'),
    seller: toUserSummary(requireEmbed(row.seller, 'items.seller')),
  }));
}

/**
 * The fulfilment queue: redemption requests with the card, the physical item,
 * and who is waiting on the box. Added for 009.
 *
 * Visibility is 009's policies verbatim — redemptions_admin_read for admins,
 * redemptions_own_read for the requesting user, nothing for anyone else. An
 * empty array means "none you may see", not "none exist". Oldest first,
 * because fulfilment is a queue.
 *
 * `redemptions.status` is bare text with no constraint (flagged in
 * docs/handoff/admin.md); fn_redeem_card writes 'requested' and
 * fn_mark_shipped writes 'shipped', so those two are the values that exist
 * in practice.
 */
export async function getRedemptions(
  query: RedemptionsQuery = {},
): Promise<RedemptionSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  let builder = supabase
    .from('redemptions')
    .select(
      'id, card_id, item_id, user_id, handling_fee_cents, shipping_address, ' +
        'status, carrier, tracking_number, requested_at, shipped_at, ' +
        `card:cards!inner(${CARD_SUMMARY_COLUMNS}, sku:skus!inner(${SKU_REF_COLUMNS})), ` +
        'item:items!inner(id, status, custody_location), ' +
        // 013 added redemptions.fulfiller_id, so there are now two FKs from
        // redemptions to users and PostgREST refuses an un-hinted public_profiles
        // embed with PGRST201 (the /list & /dashboard 500s). Each embed names
        // its own FK constraint.
        `redeemer:public_profiles!redemptions_user_id_fkey(${PUBLIC_PROFILE_COLUMNS}), ` +
        `fulfiller:public_profiles!redemptions_fulfiller_id_fkey(${PUBLIC_PROFILE_COLUMNS})`,
    );

  if (query.status?.length) {
    builder = builder.in('status', query.status as RedemptionStatus[]);
  }
  if (query.userId) builder = builder.eq('user_id', query.userId);

  const rows = unwrap(
    await builder
      .order('requested_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page.from, page.to),
    'redemptions',
  ) as RedemptionRow[] | null;

  return (rows ?? []).map((row) => {
    const fulfiller = one(row.fulfiller);
    return {
      id: row.id,
      card_id: row.card_id,
      item_id: row.item_id,
      user_id: row.user_id,
      handling_fee_cents: row.handling_fee_cents,
      shipping_address: row.shipping_address,
      status: row.status,
      carrier: row.carrier,
      tracking_number: row.tracking_number,
      requested_at: row.requested_at,
      shipped_at: row.shipped_at,
      // A redeemed card has no live listing by definition — it is burned.
      card: toCardSummary(requireEmbed(row.card, 'redemptions.card'), null),
      item: requireEmbed(row.item, 'redemptions.item'),
      redeemer: toUserSummary(requireEmbed(row.redeemer, 'redemptions.redeemer')),
      fulfiller: fulfiller ? toUserSummary(fulfiller) : null,
    };
  });
}

/** Consignment queues, filterable by status for the admin board. */
export async function getConsignments(
  query: ConsignmentsQuery = {},
): Promise<ConsignmentSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  let builder = supabase
    .from('consignments')
    .select(`${CONSIGNMENT_COLUMNS}, consignor:public_profiles(${PUBLIC_PROFILE_COLUMNS})`);

  if (query.consignorId) builder = builder.eq('consignor_id', query.consignorId);
  if (query.status?.length) {
    builder = builder.in('status', query.status as ConsignmentStatus[]);
  }

  const rows = unwrap(
    await builder
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page.from, page.to),
    'consignments',
  ) as ConsignmentRow[] | null;

  return (rows ?? []).map(toConsignmentSummary);
}

/**
 * By id, handle, or auth id. Returns null when there is no such user.
 *
 * STILL READS `users`, AND SINCE 006 THAT MEANS YOURSELF OR — IF YOU ARE AN
 * ADMIN — ANYONE. For any other user it returns null, exactly as if the handle
 * did not exist.
 *
 * It cannot move to `public_profiles`: it returns `User`, which includes
 * `email`, and the whole point of 006 is that the view does not carry email.
 * Returning a `User` with a fabricated email would be far worse than returning
 * null.
 *
 * So this is no longer a way to look up a stranger's profile — see HANDOFF.md,
 * because `app/(market)/u/[handle]` needs exactly that and the frozen contract
 * has no read for it.
 */
export async function getUser(lookup: UserLookup): Promise<User | null> {
  const supabase = await createServerSupabase();

  let builder = supabase.from('users').select(USER_COLUMNS);

  if ('id' in lookup) builder = builder.eq('id', lookup.id);
  else if ('handle' in lookup) builder = builder.eq('handle', lookup.handle);
  else builder = builder.eq('auth_id', lookup.authId);

  const result = await builder.maybeSingle();
  if (result.error && !isNoRows(result.error)) fail(result.error, 'users');

  return (result.data as User | null) ?? null;
}

/**
 * Stripe Connect onboarding status for a user.
 * Sourced from the account.updated webhook data stored on the user row.
 */
export type ConnectOnboardingStatus =
  | 'not_started'
  | 'pending'
  | 'payout_ready';

/**
 * Connect account details stored on the user.
 */
export interface ConnectAccountInfo {
  /** The Stripe Connect account id, if created. */
  connect_account_id: string | null;
  /** Current onboarding state. */
  onboarding_status: ConnectOnboardingStatus;
  /** Whether the account can receive payouts. */
  payouts_enabled: boolean;
  /** Details on what's needed to complete onboarding, if pending. */
  requirements: string[] | null;
  /** When onboarding was last updated. */
  updated_at: Timestamptz | null;
}

/**
 * Get the Stripe Connect onboarding status for a user.
 * Reads the Connect webhook data landed on the user row.
 * Session client — users_self_read (006) allows self-read; admin reads any.
 *
 * @throws UNAUTHENTICATED (no session), FORBIDDEN (not self or admin).
 */
export async function getConnectOnboardingStatus(
  userId: UUID,
): Promise<ConnectAccountInfo | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('users')
    .select(
      'connect_account_id, connect_onboarding_status, connect_payouts_enabled, connect_requirements, connect_updated_at',
    )
    .eq('id', userId)
    .maybeSingle();

  if (result.error) fail(result.error, 'users');

  const row = result.data as
    | {
        connect_account_id: string | null;
        connect_onboarding_status: ConnectOnboardingStatus | null;
        connect_payouts_enabled: boolean | null;
        connect_requirements: string[] | null;
        connect_updated_at: Timestamptz | null;
      }
    | null;

  if (!row) return null;

  return {
    connect_account_id: row.connect_account_id,
    onboarding_status: row.connect_onboarding_status ?? 'not_started',
    payouts_enabled: row.connect_payouts_enabled ?? false,
    requirements: row.connect_requirements,
    updated_at: row.connect_updated_at,
  };
}

/**
 * A public profile by handle, from the `public_profiles` view joined to the
 * level's rank name. Returns null when there is no such user.
 *
 * READS NEVER THE `users` TABLE. Since 006 put RLS on `users`, a session can
 * read its own row and an admin any row, and any other lookup silently comes
 * back empty. The view is the public read path, and it is granted to `anon` as
 * well as `authenticated`, so an anonymous visitor can look a profile up too.
 *
 * Handles are citext, so lookup is case-insensitive; the returned handle is
 * the stored casing.
 */
export async function getPublicProfile(handle: string): Promise<PublicProfile | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('public_profiles')
    .select('id, handle, level, xp_total, portfolio_value_cents, created_at')
    .eq('handle', handle)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'public_profiles');

  const row = result.data as PublicProfileRow | null;
  if (!row) return null;

  // levels_read (009) is `for select using (true)`, so this works for anon too.
  const rank = await supabase
    .from('levels')
    .select('name')
    .eq('level', row.level)
    .maybeSingle();

  if (rank.error && !isNoRows(rank.error)) fail(rank.error, 'levels');

  return {
    ...row,
    rank_name: (rank.data as { name: string } | null)?.name ?? `Level ${row.level}`,
  };
}

/**
 * One `vault_intakes` (023c) row for a card — the 48h window between a
 * first-sale and the physical shoe reaching FlexSoar. This is a read, not a
 * write; the all-writes-through-contract rule doesn't cover it, so exposing
 * it is a consistency addition, not closing a violation.
 */
export interface VaultIntakeStatus {
  status: 'awaiting_shipment' | 'in_transit' | 'received' | 'defaulted' | 'cancelled';
  due_by: Timestamptz;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: Timestamptz | null;
}

interface VaultIntakeRow {
  status: VaultIntakeStatus['status'];
  due_by: Timestamptz;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: Timestamptz | null;
}

/**
 * The open (or most recently closed) vault_intakes row for a card, if any.
 * Session client — vault_intakes' own RLS (023c) is `consignor_id = self OR
 * buyer_id = self OR admin`, so a stranger gets null, same as "no intake"
 * would, and this function adds no access control of its own.
 */
export async function getVaultIntakeForCard(cardId: UUID): Promise<VaultIntakeStatus | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('vault_intakes')
    .select('status, due_by, carrier, tracking_number, shipped_at')
    .eq('card_id', cardId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'vault_intakes');

  return result.data as VaultIntakeRow | null;
}

/** Catalog search for the browse filters and the admin SKU screens. */
export async function getSkus(query: SkusQuery = {}): Promise<Sku[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  let builder = supabase.from('skus').select(SKU_COLUMNS);

  if (query.brand !== undefined) builder = builder.eq('brand', query.brand);
  if (query.model !== undefined) builder = builder.eq('model', query.model);
  if (query.sizeUs !== undefined) builder = builder.eq('size_us', query.sizeUs);

  if (query.search) {
    const term = sanitizePattern(query.search);
    if (term) {
      builder = builder.or(
        [`brand.ilike.*${term}*`, `model.ilike.*${term}*`, `colorway.ilike.*${term}*`].join(','),
      );
    }
  }

  // Tier is not a column on skus, and as of 027 it is not even the variant's
  // own price band any more — fn_tier_for_sku reads sku_models.base_price_cents,
  // not skus.market_price_cents (those two only agree when a variant has a
  // 1.000 size_multiplier and no price_override_cents). Resolve the requested
  // tiers against the MODEL first, then filter variants by model_id.
  if (query.tier?.length) {
    const arms = query.tier
      .map((tier) => TIER_BANDS.find((band) => band.tier === tier))
      .filter((band): band is (typeof TIER_BANDS)[number] => band !== undefined)
      .map((band) =>
        band.maxCents === null
          ? `base_price_cents.gte.${band.minCents}`
          : `and(base_price_cents.gte.${band.minCents},base_price_cents.lt.${band.maxCents})`,
      );

    if (arms.length === 0) return [];

    const modelRows = (unwrap(
      await supabase.from('sku_models').select('id').or(arms.join(',')),
      'sku_models',
    ) ?? []) as { id: UUID }[];

    if (modelRows.length === 0) return [];
    builder = builder.in(
      'model_id',
      modelRows.map((m) => m.id),
    );
  }

  const rows = unwrap(
    await builder
      .order('demand_score', { ascending: false })
      .order('id', { ascending: true })
      .range(page.from, page.to),
    'skus',
  ) as Sku[] | null;

  return rows ?? [];
}

/** One row of condition_bands, projected for display — never the float bounds. */
export interface ConditionBand {
  grade: ConditionGrade;
  label: string;
  sort_order: number;
}

/**
 * condition_bands: grade -> display label, oldest-condition first. Read-only
 * table, no admin gate (matches condition_bands_read granted to anon per the
 * live schema — same shape of grant as `levels`/`tier_bands`).
 *
 * Deliberately projects only `grade, label, sort_order` — NOT `min_float` /
 * `max_float`. Those are numeric float boundaries, and
 * platform_config.show_numeric_float gates the numeric float everywhere else
 * in the UI; exposing the band cutoffs here would leak the same information
 * through the back door. If a future task needs the bounds for an admin-only
 * screen, that is additive surface for that task to add, not this one.
 */
export async function listConditionBands(): Promise<ConditionBand[]> {
  const supabase = await createServerSupabase();
  const rows = unwrap(
    await supabase
      .from('condition_bands')
      .select('grade, label, sort_order')
      .order('sort_order', { ascending: true }),
    'condition_bands',
  ) as ConditionBand[] | null;

  return rows ?? [];
}

// ============================================================
// STRIPE CONNECT (Malaysia-only consignor payouts)
// ============================================================

/**
 * Stripe Connect Express account status for a consignor.
 * Used to determine if a consignor can receive automatic payouts.
 */
export interface StripeConnectAccount {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingComplete: boolean;
}

/**
 * Result of creating a Stripe Connect Express account onboarding link.
 */
export interface ConnectOnboardingLink {
  accountId: string;
  onboardingUrl: string;
  expiresAt: Timestamptz;
}

/**
 * createConnectAccount(consignorId) -> ConnectOnboardingLink
 *
 * Creates a Stripe Connect Express account for a Malaysian consignor and returns
 * an onboarding link. The consignor must have users.country_code = 'MY'.
 * Stores the account_id on the user row for future payouts.
 *
 * Malaysia-only: rejects any user whose country_code is not 'MY' (or null/empty).
 * This is a deliberate scope limitation for the initial Connect rollout.
 *
 * @throws FORBIDDEN (not a consignor), COUNTRY_NOT_SET (null/empty country),
 *   INVALID_COUNTRY_CODE (not 'MY'), Stripe API errors.
 */
export async function createConnectAccount(
  consignorId: UUID,
): Promise<ConnectOnboardingLink> {
  const supabase = await createServerSupabase();

  // Verify the user exists and is a Malaysian consignor
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, country_code, is_consignor, stripe_connect_account_id')
    .eq('id', consignorId)
    .maybeSingle();

  if (userError) fail(userError, 'users');
  if (!user) {
    throw new ContractError('NOT_FOUND', 'Consignor not found', { consignorId });
  }
  if (!user.is_consignor) {
    throw new ContractError('FORBIDDEN', 'User is not a consignor', { consignorId });
  }
  if (!user.country_code || user.country_code.toUpperCase() !== 'MY') {
    throw new ContractError(
      'INVALID_COUNTRY_CODE',
      'Stripe Connect onboarding is only available for Malaysian consignors (country_code=MY)',
      { consignorId, countryCode: user.country_code },
    );
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-08-26.dahlia' });

  let accountId = user.stripe_connect_account_id;

  // Create a new Connect account if one doesn't exist
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'MY',
      email: user.email,
      capabilities: {
        transfers: { requested: true },
      },
      business_type: 'individual',
    });
    accountId = account.id;

    // Store the account ID on the user
    await supabase
      .from('users')
      .update({ stripe_connect_account_id: accountId })
      .eq('id', consignorId);
  }

  // Create an account onboarding link
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://flexsoar.net';
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/consignor/connect/refresh`,
    return_url: `${baseUrl}/consignor/connect/return`,
    type: 'account_onboarding',
    collection_options: { fields: 'eventually_due' },
  });

  return {
    accountId,
    onboardingUrl: accountLink.url,
    expiresAt: new Date(accountLink.expires_at * 1000).toISOString(),
  };
}

/**
 * updateConnectAccountStatus(accountId) -> StripeConnectAccount
 *
 * Fetches the latest Connect account status from Stripe and updates the user's
 * payouts_enabled flag. Called from the account.updated webhook handler.
 *
 * Service-role only (no session). Admin-gated via fn_require_admin equivalent.
 */
export async function updateConnectAccountStatus(
  accountId: string,
): Promise<StripeConnectAccount> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-08-26.dahlia' });
  const account = await stripe.accounts.retrieve(accountId);

  const status: StripeConnectAccount = {
    accountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    onboardingComplete:
      (account.charges_enabled ?? false) && (account.payouts_enabled ?? false),
  };

  // Update the user's payouts_enabled flag
  const supabase = createServiceSupabase();
  await supabase
    .from('users')
    .update({ stripe_connect_payouts_enabled: status.onboardingComplete })
    .eq('stripe_connect_account_id', accountId);

  return status;
}

/**
 * Payout eligibility check result.
 * Used by the pg_cron scheduled payout function.
 */
export interface PayoutEligibility {
  orderId: UUID;
  eligible: boolean;
  reason: string;
  netCents: Cents;
  consignorId: UUID;
  connectAccountId: string | null;
}

/**
 * checkPayoutEligibility() -> PayoutEligibility[]
 *
 * Checks all settled orders for payout eligibility. An order is eligible when:
 *   1. payout_hold_days has elapsed since settlement (orders.payout_release_at <= now())
 *   2. Any associated vault_intakes row is 'received' (not awaiting_shipment/in_transit)
 *   3. net_cents has not yet been paid out (orders.paid_out = false)
 *   4. The consignor's Connect account is payout-capable (payouts_enabled = true)
 *
 * This is a READ-ONLY check — the actual payout execution is a separate step.
 * Designed to be called from a pg_cron job (service-role) matching the
 * fn_refresh_levels pattern.
 *
 * @returns Array of eligibility results for all settled orders not yet paid out.
 */
export async function checkPayoutEligibility(): Promise<PayoutEligibility[]> {
  const supabase = createServiceSupabase();

  const payoutHoldDays = 7; // fallback; could read from platform_config
  const holdCutoff = new Date(Date.now() - payoutHoldDays * 24 * 60 * 60 * 1000).toISOString();

  // Find settled orders not yet paid out where hold has elapsed
  const { data: orders, error } = await supabase
    .from('orders')
    .select(
      'id, seller_id, net_cents, payout_release_at, paid_out, credit_cents, cash_cents',
    )
    .eq('status', 'settled')
    .eq('paid_out', false)
    .lte('payout_release_at', holdCutoff);

  if (error) fail(error, 'orders');

  const results: PayoutEligibility[] = [];

  for (const order of orders ?? []) {
    const consignorId = order.seller_id;

    // Check Connect account
    const { data: user } = await supabase
      .from('users')
      .select('stripe_connect_account_id, stripe_connect_payouts_enabled, country_code')
      .eq('id', consignorId)
      .maybeSingle();

    const connectAccountId = user?.stripe_connect_account_id ?? null;
    const payoutsEnabled = user?.stripe_connect_payouts_enabled ?? false;

    // Check vault intake status (if first sale)
    const { data: intake } = await supabase
      .from('vault_intakes')
      .select('status')
      .eq('order_id', order.id)
      .maybeSingle();

    const vaultReceived = !intake || intake.status === 'received';

    let eligible = true;
    let reason = 'Eligible for payout';

    if (!vaultReceived) {
      eligible = false;
      reason = 'Vault intake not yet received (consignor has not shipped)';
    } else if (!connectAccountId) {
      eligible = false;
      reason = 'Consignor has no Stripe Connect account';
    } else if (!payoutsEnabled) {
      eligible = false;
      reason = 'Consignor Connect account not yet payout-capable';
    }

    results.push({
      orderId: order.id,
      eligible,
      reason,
      netCents: order.net_cents,
      consignorId,
      connectAccountId,
    });
  }

  return results;
}

/**
 * executePayout(orderId) -> { transferId: string }
 *
 * Executes a Stripe Transfer for a single eligible order and marks it paid_out.
 * This should ONLY be called after checkPayoutEligibility() confirms eligibility.
 *
 * @throws if order is not eligible, Connect account not ready, or Stripe API error.
 */
export async function executePayout(orderId: UUID): Promise<{ transferId: string }> {
  const supabase = createServiceSupabase();

  // Re-verify eligibility at execution time
  const eligibility = await checkPayoutEligibility();
  const match = eligibility.find((e) => e.orderId === orderId);

  if (!match) {
    throw new ContractError('NOT_FOUND', 'Order not found or already paid out', { orderId });
  }
  if (!match.eligible) {
    throw new ContractError(
      'WRONG_STATUS',
      `Order not eligible for payout: ${match.reason}`,
      { orderId },
    );
  }
  if (!match.connectAccountId) {
    throw new ContractError('NOT_FOUND', 'Consignor has no Connect account', { orderId });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-08-26.dahlia' });

  const transfer = await stripe.transfers.create({
    amount: match.netCents,
    currency: 'usd',
    destination: match.connectAccountId,
    metadata: {
      order_id: orderId,
      type: 'consignor_payout',
    },
  });

  // Mark order as paid out
  await supabase
    .from('orders')
    .update({ paid_out: true, stripe_transfer_id: transfer.id })
    .eq('id', orderId);

  return { transferId: transfer.id };
}

/**
 * processAllDuePayouts() -> { processed: number; failed: Array<{ orderId: UUID; error: string }> }
 *
 * Batch payout processor for pg_cron. Checks eligibility for all due orders
 * and executes payouts for eligible ones. Continues on individual failures.
 *
 * Designed to run as a scheduled pg_cron job (service-role).
 */
export async function processAllDuePayouts(): Promise<{
  processed: number;
  failed: Array<{ orderId: UUID; error: string }>;
}> {
  const eligibility = await checkPayoutEligibility();
  const eligible = eligibility.filter((e) => e.eligible);

  const failed: Array<{ orderId: UUID; error: string }> = [];
  let processed = 0;

  for (const e of eligible) {
    try {
      await executePayout(e.orderId);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ orderId: e.orderId, error: message });
    }
  }

  return { processed, failed };
}

// ============================================================
// NOTIFICATIONS
// ============================================================

export type NotificationType =
  | 'submission_approved'
  | 'card_sold'
  | 'card_redeemed'
  | 'payout_sent';

export interface Notification {
  id: UUID;
  user_id: UUID;
  type: NotificationType;
  payload: Json;
  read_at: Timestamptz | null;
  created_at: Timestamptz;
}

export interface ListNotificationsInput {
  userId: UUID;
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface ListNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
}

/**
 * listNotifications(input) -> ListNotificationsResult
 *
 * Lists notifications for a user, most recent first.
 * Supports pagination and unread-only filtering.
 */
export async function listNotifications(
  input: ListNotificationsInput,
): Promise<ListNotificationsResult> {
  const supabase = await createServerSupabase();

  let query = supabase
    .from('notifications')
    .select('id, user_id, type, payload, read_at, created_at')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false });

  if (input.unreadOnly) {
    query = query.is('read_at', null);
  }

  const pageSize = Math.min(Math.max(1, input.limit ?? 50), 200);
  const pageOffset = Math.max(0, input.offset ?? 0);

  const [rowsResult, countResult] = await Promise.all([
    query.range(pageOffset, pageOffset + pageSize - 1),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .is('read_at', null),
  ]);

  if (rowsResult.error) fail(rowsResult.error, 'notifications');

  const notifications = (rowsResult.data as Notification[] | null) ?? [];
  const unreadCount = countResult.count ?? 0;

  return { notifications, unreadCount };
}

/**
 * markNotificationRead(notificationId) -> void
 *
 * Marks a notification as read by setting read_at = now().
 * No-op if already read.
 */
export async function markNotificationRead(notificationId: UUID): Promise<void> {
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null);

  if (error) fail(error, 'notifications');
}

// Re-exported so consumers import row types and the contract from one place.
export type {
  Card,
  ConditionGrade,
  Consignment,
  ConsignmentEvent,
  Item,
  Listing,
  Order,
  Sku,
  User,
};
