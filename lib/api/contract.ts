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
const USER_SUMMARY_COLUMNS =
  'id, handle, level, xp_total, portfolio_value_cents, is_admin, is_consignor, created_at';

const USER_COLUMNS =
  'id, auth_id, handle, email, country_code, kyc_status, is_consignor, is_admin, ' +
  'level, xp_total, portfolio_value_cents, created_at';

const SKU_REF_COLUMNS =
  'id, brand, model, colorway, size_us, market_price_cents, sprite_key, palette';

const SKU_COLUMNS =
  'id, brand, model, colorway, size_us, retail_price_cents, market_price_cents, ' +
  'price_confidence, priced_at, demand_score, sprite_key, palette, mint_cap, created_at';

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
  'id, sku_id, status, float_value, graded_at, grading_notes, photos, ' +
  'authenticated_at, custody_location, reserve_price_cents';

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
  seller: UserSummary | UserSummary[];
}

interface ItemRow {
  id: UUID;
  sku_id: UUID;
  status: ItemStatus;
  float_value: FloatValue | null;
  graded_at: Timestamptz | null;
  grading_notes: string | null;
  photos: Json;
  authenticated_at: Timestamptz | null;
  custody_location: string | null;
  reserve_price_cents: Cents | null;
  sku: SkuRefRow | SkuRefRow[];
}

interface ConsignmentRow extends Consignment {
  consignor: UserSummary | UserSummary[];
}

interface ProvenanceRow {
  owner_level: number;
  acquired_at: Timestamptz;
  released_at: Timestamptz | null;
  price_cents: Cents | null;
  owner: UserSummary | UserSummary[];
}

// ---- mappers ----

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

function toItemSummary(row: ItemRow, cardId: UUID | null): ItemSummary {
  return {
    id: row.id,
    sku_id: row.sku_id,
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
  };
}

function toConsignmentSummary(row: ConsignmentRow): ConsignmentSummary {
  const { consignor, ...consignment } = row;
  return {
    ...consignment,
    consignor: requireEmbed(consignor, 'consignments.consignor'),
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

    const result = await supabase
      .from('users')
      .select('level')
      .eq('id', viewerId)
      .maybeSingle();

    if (result.error && !isNoRows(result.error)) fail(result.error, 'users');
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
 * @returns the new listing id.
 * @throws NOT_OWNER, WRONG_STATUS.
 */
export async function listCard(
  cardId: UUID,
  sellerId: UUID,
  priceCents: Cents,
): Promise<UUID> {
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
        `owner:users(${USER_SUMMARY_COLUMNS}), ` +
        `item:items(id, status, photos, grading_notes, graded_at, authenticated_at)`,
    )
    .eq('id', cardId)
    .maybeSingle();

  if (result.error && !isNoRows(result.error)) fail(result.error, 'cards');

  const row = result.data as
    | (CardRow & {
        exceptional_reason: string | null;
        owner: UserSummary | UserSummary[];
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
          `owner:users(${USER_SUMMARY_COLUMNS})`,
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
    owner: requireEmbed(row.owner, 'cards.owner'),
    item: requireEmbed(row.item, 'cards.item'),
    oracle_value_cents: oracleValue,
    provenance: chain.map((hop) => ({
      owner: requireEmbed(hop.owner, 'card_provenance.owner'),
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
        `seller:users!inner(${USER_SUMMARY_COLUMNS})`,
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
    seller: requireEmbed(row.seller, 'listings.seller'),
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
        `seller:users!inner(${USER_SUMMARY_COLUMNS})`,
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
    .select(`${CONSIGNMENT_COLUMNS}, consignor:users(${USER_SUMMARY_COLUMNS})`)
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

/** Consignment queues, filterable by status for the admin board. */
export async function getConsignments(
  query: ConsignmentsQuery = {},
): Promise<ConsignmentSummary[]> {
  const supabase = await createServerSupabase();
  const page = pageBounds(query.limit, query.offset);

  let builder = supabase
    .from('consignments')
    .select(`${CONSIGNMENT_COLUMNS}, consignor:users(${USER_SUMMARY_COLUMNS})`);

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

/** By id, handle, or auth id. Returns null when there is no such user. */
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
