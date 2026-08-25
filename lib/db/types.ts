/**
 * lib/db/types.ts
 *
 * Hand-written mirror of `001_schema.sql`. No live Supabase connection, no
 * codegen. If the schema changes, this file changes with it — the .sql files
 * are the source of truth.
 *
 * Conventions carried over from the schema:
 *   - Column names stay snake_case, exactly as PostgREST returns them.
 *   - Money is always integer cents. Never a float.
 *   - Condition floats are numeric(4,3): 0.000 (factory new) .. 1.000 (well worn).
 *   - bigint / bigserial columns arrive as JSON numbers over PostgREST.
 *   - No Insert/Update types on purpose: no table has an INSERT or UPDATE
 *     policy. Every write goes through the SECURITY DEFINER functions in
 *     002_operations.sql, surfaced by lib/api/contract.ts.
 */

// ------------------------------------------------------------
// SCALARS
// ------------------------------------------------------------

/** Postgres `uuid`. */
export type UUID = string;

/** Postgres `timestamptz`, ISO 8601 with offset. */
export type Timestamptz = string;

/**
 * Integer USD cents. Every `*_cents` column in the schema is USD.
 * 1 FSC = 1 USD = 100 cents. FSC is a display unit; ringgit is display only.
 */
export type Cents = number;

/** Postgres `numeric(4,3)` condition float, 0.000 .. 1.000. */
export type FloatValue = number;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

/** `tier_bands.tier` — check (tier between 1 and 5). */
export type Tier = 1 | 2 | 3 | 4 | 5;

/** `ledger_entries.direction` — check (direction in (-1,1)). */
export type LedgerDirection = -1 | 1;

// ------------------------------------------------------------
// ENUMS (create type ...)
// ------------------------------------------------------------

export type ConsignmentStatus =
  | 'draft'
  | 'submitted'
  | 'in_transit'
  | 'received'
  | 'authenticating'
  | 'authenticated'
  | 'rejected'
  | 'return_pending'
  | 'returned'
  | 'completed';

export type ItemStatus =
  | 'pending_intake'
  | 'in_custody'
  | 'pending_review'
  | 'awaiting_seller_shipment'
  | 'minted'
  | 'redemption_hold'
  | 'shipped'
  | 'released'
  | 'returned_to_consignor';

/**
 * 023a_card_status_pending_vault.sql added 'pending_vault': ownership has
 * transferred but the physical shoe hasn't reached FlexSoar yet (first-sale
 * custody model, 023c). Distinct from 'locked' (has a live listing) — a
 * pending_vault card has no listing and must not transfer, list, trade or
 * redeem until vault-in flips it to 'active'.
 */
export type CardStatus = 'active' | 'locked' | 'burned' | 'redeemed' | 'pending_vault';

export type ListingStatus =
  | 'early_access'
  | 'public'
  | 'sold'
  | 'cancelled'
  | 'expired';

/**
 * What a seller elects to be paid in (011). 'either' opens both doors and the
 * buyer picks. The payout always mirrors the buyer's payment method — credit
 * never converts to money for anyone.
 */
export type PayoutMethod = 'cash' | 'credit' | 'either';

/**
 * 013_seller_custody.sql — where the physical item lives and who is answerable
 * for it. 'seller' is the launch model (the seller is a bailee keeping the
 * shoe); 'warehouse' is the existing consignment pipeline.
 */
export type CustodyModel = 'warehouse' | 'seller';

/**
 * 013 — how `items.float_value` was arrived at. 'seller_declared' is the
 * seller's own six scores from a submission; 'flexsoar' is a rubric grade at
 * intake. The two are deliberately distinct — never render them identically.
 */
export type GradeSource = 'flexsoar' | 'seller_declared';

/**
 * `public.condition_grade` — 018-020. Derived from `float_value` by trigger on
 * both `items` and `cards`; never write it directly. `condition_bands` holds
 * the label/sort_order/float-range mapping — read it with listConditionBands()
 * rather than hard-coding the boundaries, since platform_config.show_numeric_float
 * gates whether the numeric float itself may be shown alongside this.
 * Order matches condition_bands.sort_order, live-verified 2026-08-21.
 */
export type ConditionGrade =
  | 'factory_new'
  | 'minimal_wear'
  | 'field_tested'
  | 'well_worn'
  | 'battle_scarred';

export const CONDITION_GRADES: readonly ConditionGrade[] = [
  'factory_new',
  'minimal_wear',
  'field_tested',
  'well_worn',
  'battle_scarred',
] as const;

export type LedgerEntryType =
  | 'mint'
  | 'sale_gross'
  | 'sale_fee'
  | 'sale_net'
  | 'card_transfer'
  | 'trade_up_burn'
  | 'trade_up_mint'
  | 'redemption_burn'
  | 'consignment_fee'
  | 'subscription_fee'
  | 'handling_fee'
  /**
   * 011_credit_ledger.sql, asset = 'credit'. Also missing before 018-020;
   * live-verified against ledger_entries (2026-08-21). '_gross'/'_net'/'_fee'
   * mirror the currency sale_* triad one-for-one, just on the FSC leg.
   */
  | 'credit_purchase'
  | 'credit_sale_gross'
  | 'credit_sale_net'
  | 'credit_sale_fee';

/**
 * 011_credit_ledger.sql added 'credit' as a third asset class alongside
 * 'currency' and 'card' — live-verified against ledger_entries (2026-08-21):
 * credit_purchase / credit_sale_gross / credit_sale_net / credit_sale_fee rows
 * all carry asset = 'credit'. This was missing here even before 018-020.
 */
export type AssetClass = 'currency' | 'card' | 'credit';

export const CONSIGNMENT_STATUSES: readonly ConsignmentStatus[] = [
  'draft',
  'submitted',
  'in_transit',
  'received',
  'authenticating',
  'authenticated',
  'rejected',
  'return_pending',
  'returned',
  'completed',
] as const;

export const ITEM_STATUSES: readonly ItemStatus[] = [
  'pending_intake',
  'in_custody',
  'pending_review',
  'awaiting_seller_shipment',
  'minted',
  'redemption_hold',
  'shipped',
  'released',
  'returned_to_consignor',
] as const;

export const CARD_STATUSES: readonly CardStatus[] = [
  'active',
  'locked',
  'burned',
  'redeemed',
  'pending_vault',
] as const;

export const LISTING_STATUSES: readonly ListingStatus[] = [
  'early_access',
  'public',
  'sold',
  'cancelled',
  'expired',
] as const;

/**
 * Columns typed `text` in the schema rather than an enum. The known values are
 * listed for autocomplete; the `(string & {})` arm keeps the column faithful to
 * the DB, which does not constrain them.
 */
type OpenText<T extends string> = T | (string & {});

/** `users.kyc_status` — text, default 'none'. */
export type KycStatus = OpenText<'none' | 'pending' | 'verified' | 'rejected'>;

/** `orders.status` — text, default 'pending'. fn_purchase_card writes 'settled'. */
export type OrderStatus = OpenText<'pending' | 'settled' | 'refunded' | 'failed'>;

/** `redemptions.status` — text, default 'requested'. */
export type RedemptionStatus = OpenText<
  'requested' | 'picking' | 'shipped' | 'delivered' | 'cancelled'
>;

/** `subscriptions.status` — text, provider-driven. */
export type SubscriptionStatus = OpenText<
  'active' | 'past_due' | 'cancelled' | 'incomplete'
>;

// ------------------------------------------------------------
// USERS
// ------------------------------------------------------------

export interface User {
  id: UUID;
  auth_id: UUID | null;
  /** citext, unique. */
  handle: string;
  /** citext, unique. */
  email: string;
  /** char(2), ISO 3166-1 alpha-2. */
  country_code: string | null;
  kyc_status: KycStatus;
  is_consignor: boolean;
  is_admin: boolean;
  /** Cache. Rewritten by fn_refresh_levels(). */
  level: number;
  /** Cache. Incremented by fn_award_xp(). */
  xp_total: number;
  /** Cache. Rewritten by fn_refresh_levels(). */
  portfolio_value_cents: Cents;
  created_at: Timestamptz;
  /**
   * Seller trust counters (013). Optional to the type because the shared
   * lib/mock fixtures predate 013 and cannot be edited here — the DB always
   * sends them (NOT NULL DEFAULT 0 / false).
   */
  fulfilments_completed?: number;
  defaults_count?: number;
  is_restricted?: boolean;
}

// ------------------------------------------------------------
// CATALOG
// ------------------------------------------------------------

export interface Sku {
  id: UUID;
  /**
   * The model this size belongs to (027). brand/model/colorway below are a
   * MAINTAINED COPY of the model's — trg_sku_variant_derive overwrites
   * whatever is written here on every insert/update. Never write them.
   *
   * Optional to the type because the shared lib/mock fixtures and
   * components/market/bridge.ts predate 027 and cannot be edited here — the
   * DB always sends it (NOT NULL). Same convention as User's
   * fulfilments_completed above.
   */
  model_id?: UUID;
  brand: string;
  model: string;
  colorway: string;
  /** numeric(4,1). */
  size_us: number;
  retail_price_cents: Cents | null;
  /**
   * DERIVED as of 027: coalesce(price_override_cents, sku_models.base_price_cents
   * x size_multiplier), maintained by trg_sku_variant_derive. Writing this
   * directly RAISES. Set sku_models.base_price_cents (updateSkuModel) or
   * price_override_cents (updateSkuVariant) instead. Still the right column
   * for VALUE (fn_card_value_cents) — TIER comes from the model instead, via
   * fn_tier_for_sku / getSkuModel().
   */
  market_price_cents: Cents | null;
  /**
   * numeric(5,3). Size curve point. 1.000 for every variant today (027 ships
   * flat). Optional to the type for the same lib/mock/bridge.ts reason as
   * model_id above — the DB always sends it (NOT NULL DEFAULT 1.000).
   */
  size_multiplier?: number;
  /** Escape hatch for a size that genuinely diverges from base x multiplier (027). Admin-set only. */
  price_override_cents?: Cents | null;
  /** numeric(3,2), 0.00 .. 1.00. */
  price_confidence: number | null;
  priced_at: Timestamptz | null;
  /** numeric(5,2). */
  demand_score: number;
  /** Pixel-art base map id. */
  sprite_key: string | null;
  /** Colourway swap for the sprite: char -> hex. */
  palette: Json | null;
  /** Uploaded pixel-art PNG (012). Absent or null falls back to the sprite renderer. */
  art_url?: string | null;
  /** null = uncapped. */
  mint_cap: number | null;
  created_at: Timestamptz;
}

/**
 * sku_models (027). Brand + model + colourway — the level a human merges
 * duplicates at, size stripped out. Carries the ORACLE price and the single
 * art asset shared by every size variant beneath it.
 */
export interface SkuModel {
  id: UUID;
  brand: string;
  model: string;
  colorway: string;
  /**
   * The oracle. Sets TIER via fn_tier_for_sku and feeds every variant's
   * market_price_cents. Null means unpriced: fn_mint_card refuses, so an
   * unpriced model physically cannot become a card. Admin-set only.
   */
  base_price_cents: Cents | null;
  /** numeric(3,2), 0.00 .. 1.00. */
  price_confidence: number | null;
  priced_at: Timestamptz | null;
  /** Pixel-art base map id, shared by every variant. */
  sprite_key: string | null;
  /** Colourway swap for the sprite: char -> hex. */
  palette: Json | null;
  /** Shared by every size. Write only through fn_replace_sku_art (replaceSkuArt). */
  art_url: string | null;
  /** numeric(5,2). */
  demand_score: number;
  created_at: Timestamptz;
}

/** Value multiplier by condition. Oracle writes this per SKU. */
export interface SkuFloatCurve {
  sku_id: UUID;
  float_min: FloatValue;
  float_max: FloatValue;
  /** numeric(4,3). */
  value_multiplier: number;
}

/**
 * Rarity ladder. Tier comes from the SKU's BASE market price, never from
 * float. Float is condition; tier is value.
 */
export interface TierBand {
  tier: Tier;
  name: string;
  /** Hex, e.g. '#7A7A7A'. Overridden to red when cards.is_exceptional. */
  border_color: string;
  min_cents: Cents;
  /** null = open ended. */
  max_cents: Cents | null;
}

// ------------------------------------------------------------
// CONSIGNMENT
// ------------------------------------------------------------

export interface Consignment {
  id: UUID;
  consignor_id: UUID;
  status: ConsignmentStatus;
  item_count: number;
  intake_fee_cents: Cents;
  submitted_at: Timestamptz | null;
  received_at: Timestamptz | null;
  completed_at: Timestamptz | null;
  notes: string | null;
  created_at: Timestamptz;
}

export interface ConsignmentEvent {
  /** bigserial. */
  id: number;
  consignment_id: UUID;
  from_status: ConsignmentStatus | null;
  to_status: ConsignmentStatus;
  actor_id: UUID | null;
  note: string | null;
  created_at: Timestamptz;
}

// ------------------------------------------------------------
// ITEMS — physical truth
// ------------------------------------------------------------

export interface Item {
  id: UUID;
  sku_id: UUID;
  consignment_id: UUID | null;
  consignor_id: UUID | null;
  status: ItemStatus;
  /** Human-graded at intake. Copied to the card at mint, immutable after. */
  float_value: FloatValue | null;
  graded_by: UUID | null;
  graded_at: Timestamptz | null;
  grading_notes: string | null;
  /**
   * The six rubric components behind `float_value`, added by 008_grading.sql.
   * Each is numeric(3,2), 0.00 .. 1.00, per docs/GRADING_RUBRIC.md.
   *
   * Two check constraints tie them to the float:
   *   items_grade_components_complete  all six, or none
   *   items_grade_components_sum       when present, float_value must equal
   *                                    the weighted sum, rounded to 3dp
   *
   * Weights: outsole 25%, midsole 20%, creasing 20%, upper 20%, heel 10%,
   * accessories 5%. The grader scores components and the float falls out —
   * never the reverse. Null on rows graded before 008.
   */
  grade_outsole: number | null;
  grade_midsole: number | null;
  grade_creasing: number | null;
  grade_upper: number | null;
  grade_heel: number | null;
  grade_accessories: number | null;
  /** jsonb, default '[]'. Intake photos. */
  photos: Json;
  authenticated_at: Timestamptz | null;
  authenticated_by: UUID | null;
  custody_location: string | null;
  reserve_price_cents: Cents | null;
  created_at: Timestamptz;
  /**
   * 013 custody. Optional to the type because lib/mock fixtures predate 013;
   * the DB always sends custody + grade_source + submitted_payout (NOT NULL
   * with defaults) and nulls the rest as appropriate.
   */
  custody?: CustodyModel;
  custody_holder_id?: UUID | null;
  grade_source?: GradeSource;
  asking_price_cents?: Cents | null;
  submitted_payout?: PayoutMethod;
  last_proof_at?: Timestamptz | null;
  /**
   * 018-020, trigger-derived from float_value — null exactly when float_value
   * is null (pre-grade). Optional to the type for the same reason as the 013
   * fields above: lib/mock fixtures predate this migration. The DB always
   * sends it (NOT NULL is not the constraint here — nullability tracks
   * float_value's).
   */
  condition_grade?: ConditionGrade | null;
}

// ------------------------------------------------------------
// CARDS
// ------------------------------------------------------------

export interface Card {
  id: UUID;
  /** unique — one physical item, one claim, strictly 1:1. */
  item_id: UUID;
  sku_id: UUID;
  /** Cache of the ledger, written in the same transaction. */
  owner_id: UUID;
  /** Immutable after mint. */
  float_value: FloatValue;
  /** From the SKU's base oracle price. Float never promotes rarity. */
  tier: Tier;
  /**
   * A FLAG, not a tier. Red border overrides the tier colour while tier keeps
   * driving value bands and trade-up rules.
   */
  is_exceptional: boolean;
  exceptional_reason: string | null;
  /** unique per (sku_id, mint_number). */
  mint_number: number;
  /** numeric(5,2), 0.00 .. 100.00. Rewritten by fn_refresh_float_percentiles(). */
  float_percentile: number | null;
  status: CardStatus;
  minted_at: Timestamptz;
  /**
   * 018-020, trigger-derived from float_value. cards.float_value is NOT NULL,
   * so unlike Item this is always populated on a real row — live-verified.
   * Optional here only for lib/mock fixture back-compat (they predate the
   * migration and do not set it); a genuine DB row never omits it.
   */
  condition_grade?: ConditionGrade;
}

export interface CardProvenance {
  /** bigserial. */
  id: number;
  card_id: UUID;
  owner_id: UUID;
  /** Owner's level at acquisition time. */
  owner_level: number;
  acquired_at: Timestamptz;
  released_at: Timestamptz | null;
  price_cents: Cents | null;
}

// ------------------------------------------------------------
// LEDGER — append-only, blocks UPDATE and DELETE by trigger
// ------------------------------------------------------------

export interface LedgerEntry {
  /** bigserial. */
  id: number;
  /** Currency entries sharing a txn_id must net to zero. */
  txn_id: UUID;
  entry_type: LedgerEntryType;
  asset: AssetClass;
  /** null = platform. */
  account_id: UUID | null;
  is_platform: boolean;
  /** Non-null iff asset = 'currency'. */
  amount_cents: Cents | null;
  /** Non-null iff asset = 'card'. */
  card_id: UUID | null;
  direction: LedgerDirection | null;
  settlement_ref: string | null;
  created_at: Timestamptz;
}

// ------------------------------------------------------------
// MARKETPLACE
// ------------------------------------------------------------

export interface Listing {
  id: UUID;
  card_id: UUID;
  seller_id: UUID;
  /** check (price_cents > 0). */
  price_cents: Cents;
  status: ListingStatus;
  /** Minimum buyer level during the early-access window. */
  early_access_level: number;
  /** When the listing opens to everyone. */
  public_at: Timestamptz;
  /** Shown to BOTH sides before confirm. Never hide it. */
  oracle_value_cents: Cents | null;
  created_at: Timestamptz;
  sold_at: Timestamptz | null;
}

export interface Order {
  id: UUID;
  listing_id: UUID;
  card_id: UUID;
  buyer_id: UUID;
  seller_id: UUID;
  gross_cents: Cents;
  /** From the SELLER's level. */
  fee_bps: number;
  fee_cents: Cents;
  net_cents: Cents;
  /** Stripe payment_intent. Money moved buyer -> seller before this row existed. */
  settlement_ref: string | null;
  status: OrderStatus;
  txn_id: UUID | null;
  created_at: Timestamptz;
  /**
   * 018-020 split settlement. credit_cents + cash_cents = gross_cents;
   * credit_cents > 0 requires no settlement_ref condition of its own, but any
   * cash_cents > 0 does — fn_purchase_card enforces both. NOT NULL DEFAULT 0
   * in the schema; optional here only because lib/mock/fixtures.ts predates
   * the migration and does not set them.
   */
  credit_cents?: Cents;
  cash_cents?: Cents;
  /**
   * fn_payout_method_for_user(seller_id) at settlement time, frozen onto the
   * order — never 'either' (that is a listing election, not a payout route).
   * Null on orders settled before 018-020 (live-verified: pre-migration rows
   * read back null here).
   */
  seller_payout?: PayoutMethod | null;
  /** platform_config.payout_hold_days after settlement. Null pre-migration. */
  payout_release_at?: Timestamptz | null;
}

// ------------------------------------------------------------
// REDEMPTION
// ------------------------------------------------------------

export interface Redemption {
  id: UUID;
  /** unique — a card redeems once. */
  card_id: UUID;
  item_id: UUID;
  user_id: UUID;
  handling_fee_cents: Cents;
  /** jsonb. See ShippingAddress in lib/api/contract.ts. */
  shipping_address: Json;
  status: RedemptionStatus;
  carrier: string | null;
  tracking_number: string | null;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
}

// ------------------------------------------------------------
// GAMIFICATION
// ------------------------------------------------------------

/** Append-only. XP is non-transferable and never redeemable. */
export interface XpEvent {
  /** bigserial. */
  id: number;
  user_id: UUID;
  event_type: string;
  xp_delta: number;
  ref_id: UUID | null;
  created_at: Timestamptz;
}

export interface Level {
  level: number;
  name: string;
  /** rank_score = portfolio_value_cents + (xp_total * 50). */
  rank_score_required: number;
  seller_fee_bps: number;
  early_access_minutes: number;
  max_watchlist_alerts: number;
  trade_up_slots: number;
  /** jsonb, default '{}'. */
  perks: Json;
}

export interface LevelSnapshot {
  /** bigserial. */
  id: number;
  user_id: UUID;
  portfolio_value_cents: Cents;
  xp_total: number;
  rank_score: number;
  level: number;
  previous_level: number | null;
  created_at: Timestamptz;
}

export interface Subscription {
  id: UUID;
  user_id: UUID;
  plan: string;
  status: SubscriptionStatus;
  price_cents: Cents;
  current_period_end: Timestamptz | null;
  provider_ref: string | null;
}

export interface Watchlist {
  /** bigserial. */
  id: number;
  user_id: UUID;
  sku_id: UUID | null;
  max_float: FloatValue | null;
  max_price_cents: Cents | null;
  notify: boolean;
  created_at: Timestamptz;
}

export interface Referral {
  /** bigserial. */
  id: number;
  referrer_id: UUID;
  /** unique — a user is referred once. */
  referee_id: UUID;
  qualified_at: Timestamptz | null;
  xp_awarded: number;
}

// ------------------------------------------------------------
// TABLE MAP
// ------------------------------------------------------------

/** Table name -> row type. Keys match the SQL table names exactly. */
export interface Tables {
  users: User;
  skus: Sku;
  sku_float_curve: SkuFloatCurve;
  tier_bands: TierBand;
  consignments: Consignment;
  consignment_events: ConsignmentEvent;
  items: Item;
  cards: Card;
  card_provenance: CardProvenance;
  ledger_entries: LedgerEntry;
  listings: Listing;
  orders: Order;
  redemptions: Redemption;
  xp_events: XpEvent;
  levels: Level;
  level_snapshots: LevelSnapshot;
  subscriptions: Subscription;
  watchlists: Watchlist;
  referrals: Referral;
}

export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T];
