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
 * THREE SANCTIONED EXTENSIONS.
 *
 * The freeze still holds for the original 16 functions: none of their
 * signatures, parameters or return types have changed. On explicit
 * instruction, surface was ADDED —
 *   008: gradeItem, authenticateItem, rejectItem, getItems
 *   009: markShipped, getRedemptions, upsertSku, setFloatCurve
 *   admin.md 3+4: getItem; consignment_id + consignor_id on ItemSummary
 * along with their query/input types and two ContractErrorCode members.
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

import type {
  Card,
  CardStatus,
  Cents,
  Consignment,
  ConsignmentEvent,
  ConsignmentStatus,
  FloatValue,
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
  Tier,
  Timestamptz,
  User,
  UUID,
} from '@/lib/db/types';

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
   * 011 fn_purchase_credit — a top-up amount that is zero or negative.
   */
  | 'INVALID_AMOUNT'
  /**
   * 011 fn_purchase_credit — the top-up is smaller than
   * platform_config.credit_purchase_min_cents.
   */
  | 'BELOW_MINIMUM_TOPUP'
  /**
   * 011 fn_purchase_card_with_credit — platform_config.credit_payout_enabled
   * is false, so the seller-takes-credit leg is switched off.
   */
  | 'CREDIT_SETTLEMENT_DISABLED'
  /**
   * 011 fn_purchase_card_with_credit — the buyer's credit balance is below
   * the listing price.
   */
  | 'INSUFFICIENT_CREDIT'
  /**
   * 011/012 — the payment method does not match the listing's payout_method:
   * buying a cash listing with credit, or a credit-only listing with cash.
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
    'id' | 'status' | 'photos' | 'grading_notes' | 'graded_at' | 'authenticated_at'
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
  status: ListingStatus;
  early_access_level: number;
  public_at: Timestamptz;
  oracle_value_cents: Cents | null;
  created_at: Timestamptz;
  sold_at: Timestamptz | null;
  card: CardSummary;
  seller: UserSummary;
}

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
  /** Who redeemed. Embedded profile — placeholder caveats from item 14 apply. */
  user: UserSummary;
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
   * Drives tier via tier_bands — for FUTURE mints only. Existing cards keep
   * the tier copied at mint; 003_retier.sql exists because this was once
   * misunderstood. Changing it re-tiers nothing retroactively.
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
  'level, xp_total, portfolio_value_cents, created_at';

const SKU_REF_COLUMNS =
  'id, brand, model, colorway, size_us, market_price_cents, sprite_key, palette, art_url';

const SKU_COLUMNS =
  'id, brand, model, colorway, size_us, retail_price_cents, market_price_cents, ' +
  'price_confidence, priced_at, demand_score, sprite_key, palette, art_url, mint_cap, created_at';

const CARD_SUMMARY_COLUMNS =
  'id, sku_id, item_id, owner_id, float_value, float_percentile, tier, ' +
  'is_exceptional, mint_number, status, minted_at';

const LISTING_REF_COLUMNS =
  'id, price_cents, status, early_access_level, public_at, oracle_value_cents';

const LISTING_COLUMNS =
  'id, card_id, seller_id, price_cents, status, early_access_level, public_at, ' +
  'oracle_value_cents, created_at, sold_at';

const ORDER_COLUMNS =
  'id, listing_id, card_id, buyer_id, seller_id, gross_cents, fee_bps, fee_cents, ' +
  'net_cents, settlement_ref, status, created_at';

const ITEM_SUMMARY_COLUMNS =
  'id, sku_id, consignment_id, consignor_id, status, float_value, graded_at, grading_notes, photos, ' +
  'authenticated_at, custody_location, reserve_price_cents, ' +
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
  graded_at: Timestamptz | null;
  grading_notes: string | null;
  photos: Json;
  authenticated_at: Timestamptz | null;
  custody_location: string | null;
  reserve_price_cents: Cents | null;
  grade_outsole: number | null;
  grade_midsole: number | null;
  grade_creasing: number | null;
  grade_upper: number | null;
  grade_heel: number | null;
  grade_accessories: number | null;
  sku: SkuRefRow | SkuRefRow[];
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
  user: PublicProfileRow | PublicProfileRow[];
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
    graded_at: row.graded_at,
    grading_notes: row.grading_notes,
    photos: row.photos,
    authenticated_at: row.authenticated_at,
    custody_location: row.custody_location,
    reserve_price_cents: row.reserve_price_cents,
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
 * fn_list_card(p_card_id, p_seller_id, p_price_cents) -> uuid
 *
 * Locks the card and opens an early-access window sized by the seller's level.
 *
 * fn_list_card does NOT accept a payout method yet — the migration is filed in
 * docs/handoff/data.md — so listing as 'credit' or 'either' is refused loudly
 * here rather than silently recording a 'cash' listing the seller never
 * elected. Once the migration lands, this guard is deleted and
 * `p_payout_method` is passed straight through.
 *
 * @returns the new listing id.
 * @throws NOT_OWNER, WRONG_STATUS, UNKNOWN (a payout_method other than 'cash',
 *         pending the migration).
 */
export async function listCard(
  cardId: UUID,
  sellerId: UUID,
  priceCents: Cents,
  payoutMethod: PayoutMethod = 'cash',
): Promise<UUID> {
  if (payoutMethod !== 'cash') {
    throw new ContractError(
      'UNKNOWN',
      `cannot list as '${payoutMethod}': fn_list_card has no payout_method argument yet. ` +
        'The migration is filed in docs/handoff/data.md; list as cash or promote it.',
      { payoutMethod },
    );
  }

  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_list_card', {
      p_card_id: cardId,
      p_seller_id: sellerId,
      p_price_cents: priceCents,
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
 * The caller's own FSC credit balance, in cents. The balance is read for the
 * signed-in user — there is deliberately no argument, so a session cannot ask
 * after someone else's. Zero is a valid balance, not an empty state.
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
 * fn_purchase_credit(p_user_id, p_cents, p_settlement_ref) -> uuid
 *
 * Credits FSC to a user in exchange for cash that has ALREADY settled through
 * Stripe. SERVICE-ROLE ONLY: call it from the payment_intent.succeeded webhook,
 * never from client code, exactly like purchaseCard().
 *
 * Idempotent on `settlementRef`: 011 refuses a second credit_purchase entry
 * with the same ref and returns null, so Stripe's at-least-once redelivery
 * records once. The minimum top-up (platform_config.credit_purchase_min_cents)
 * is enforced inside the SQL, not here.
 *
 * @param userId the buyer's users.id (which equals their auth id).
 * @param cents the USD cents actually captured.
 * @param settlementRef the Stripe payment_intent id.
 * @returns the credit txn id, or null when this settlement was already recorded.
 * @throws BELOW_MINIMUM_TOPUP, INVALID_AMOUNT.
 */
export async function purchaseCredit(
  userId: UUID,
  cents: Cents,
  settlementRef: string,
): Promise<UUID | null> {
  const supabase = createServiceSupabase();
  return unwrap(
    await supabase.rpc('fn_purchase_credit', {
      p_user_id: userId,
      p_cents: cents,
      p_settlement_ref: settlementRef,
    }),
    'fn_purchase_credit',
  ) as UUID | null;
}

/**
 * fn_purchase_card_with_credit(p_listing_id, p_buyer_id) -> uuid
 *
 * Buys a card paying with FSC credit. The buyer must be the signed-in user —
 * the SQL function does not compare p_buyer_id to auth.uid() (it is security
 * definer, so RLS would not stop a caller anyway), and the contract closes
 * that gap. The schema-level check is filed in docs/handoff/data.md as part of
 * the payout migration.
 *
 * Only 'credit'/'either' listings can be bought this way — a 'cash' listing
 * refuses with PAYOUT_MISMATCH, which keeps the loop closed: credit never has
 * to become money for anyone.
 *
 * @returns the new order id.
 * @throws UNAUTHENTICATED, FORBIDDEN (buyerId is not the session user),
 *         PAYOUT_MISMATCH, INSUFFICIENT_CREDIT, CREDIT_SETTLEMENT_DISABLED,
 *         SELF_PURCHASE, EARLY_ACCESS_LOCKED, WRONG_STATUS, NOT_FOUND.
 */
export async function purchaseCardWithCredit(
  listingId: UUID,
  buyerId: UUID,
): Promise<UUID> {
  const sessionUserId = await requireCurrentUserId();
  if (buyerId !== sessionUserId) {
    throw new ContractError(
      'FORBIDDEN',
      'credit purchases can only be made for the signed-in user',
      { buyerId, sessionUserId },
    );
  }

  const supabase = await createServerSupabase();
  return unwrap(
    await supabase.rpc('fn_purchase_card_with_credit', {
      p_listing_id: listingId,
      p_buyer_id: buyerId,
    }),
    'fn_purchase_card_with_credit',
  ) as UUID;
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

/**
 * Create or update a catalog SKU. Direct table write under skus_admin_write —
 * there is no RPC, the RLS policy is the guard, and a non-admin session is
 * refused by Postgres with 42501 (surfaced as FORBIDDEN).
 *
 * `market_price_cents` affects future mints only; tier is copied at mint and
 * existing cards keep theirs. See UpsertSkuInput.
 *
 * @returns the full row as written, id included — the caller needs it for
 *          setFloatCurve() after a create.
 * @throws FORBIDDEN, WRONG_STATUS (duplicate of brand/model/colorway/size),
 *         NOT_FOUND (update of an id that does not exist).
 */
export async function upsertSku(sku: UpsertSkuInput): Promise<Sku> {
  const supabase = await createServerSupabase();
  const { id, ...columns } = sku;

  if (id) {
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

  return unwrap(
    await supabase.from('skus').insert(columns).select(SKU_COLUMNS).single(),
    'skus',
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
        `user:public_profiles!inner(${PUBLIC_PROFILE_COLUMNS})`,
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

  return (rows ?? []).map((row) => ({
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
    user: toUserSummary(requireEmbed(row.user, 'redemptions.user')),
  }));
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

  // Tier is not a column on skus — it is the band the base oracle price falls
  // in, per fn_tier_for_price. Translate the tiers back into price ranges.
  if (query.tier?.length) {
    const arms = query.tier
      .map((tier) => TIER_BANDS.find((band) => band.tier === tier))
      .filter((band): band is (typeof TIER_BANDS)[number] => band !== undefined)
      .map((band) =>
        band.maxCents === null
          ? `market_price_cents.gte.${band.minCents}`
          : `and(market_price_cents.gte.${band.minCents},market_price_cents.lt.${band.maxCents})`,
      );

    if (arms.length > 0) builder = builder.or(arms.join(','));
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

// Re-exported so consumers import row types and the contract from one place.
export type {
  Card,
  Consignment,
  ConsignmentEvent,
  Item,
  Listing,
  Order,
  Sku,
  User,
};
