/**
 * FROZEN CONTRACT — signatures must not change. Only track/data may replace
 * the bodies.
 *
 * One exported function per RPC in 002_operations.sql, plus the read helpers
 * every UI track needs. Nothing here touches Supabase; track/data swaps each
 * NOT_IMPLEMENTED body for an .rpc() / .from() call and leaves the signature
 * exactly as it is.
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
 */

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
// MUTATIONS — one per RPC in 002_operations.sql
// ============================================================

/**
 * fn_mint_card(p_item_id, p_owner_id) -> uuid
 *
 * The item must be in_custody, graded by a human, and authenticated. Tier is
 * assigned from the SKU's base oracle price; the float is copied across and is
 * immutable from here.
 *
 * @returns the new card id.
 * @throws MINT_CAP_REACHED, WRONG_STATUS, NOT_GRADED, NOT_AUTHENTICATED,
 *         NO_ORACLE_PRICE.
 */
export async function mintCard(itemId: UUID, ownerId: UUID): Promise<UUID> {
  throw new Error('NOT_IMPLEMENTED');
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
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * fn_cancel_listing(p_listing_id, p_actor) -> void
 *
 * Seller only. Returns the card to 'active'.
 *
 * @throws NOT_OWNER, WRONG_STATUS.
 */
export async function cancelListing(listingId: UUID, actorId: UUID): Promise<void> {
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * fn_purchase_card(p_listing_id, p_buyer_id, p_settlement_ref) -> uuid
 *
 * Records a settlement that has ALREADY happened: money moved buyer -> seller
 * through Stripe before this call. Call it from the payment_intent.succeeded
 * webhook only — never from client code.
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
  throw new Error('NOT_IMPLEMENTED');
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
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * fn_advance_consignment(p_id, p_to, p_actor, p_note) -> void
 *
 * The state machine lives in the CASE block of the SQL function. Read it
 * there; do not re-derive the allowed edges from the enum order.
 *
 * @throws ILLEGAL_TRANSITION, NOT_FOUND.
 */
export async function advanceConsignment(
  consignmentId: UUID,
  to: ConsignmentStatus,
  actorId: UUID,
  note?: string | null,
): Promise<void> {
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * fn_award_xp(p_user, p_type, p_delta, p_ref) -> void
 *
 * Append-only. XP is non-transferable and never redeemable.
 */
export async function awardXp(
  userId: UUID,
  eventType: string,
  xpDelta: number,
  refId?: UUID | null,
): Promise<void> {
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * fn_refresh_levels() -> integer
 *
 * Nightly job. rank_score = portfolio_value_cents + (xp_total * 50).
 *
 * @returns the number of users whose level cache was rewritten.
 */
export async function refreshLevels(): Promise<number> {
  throw new Error('NOT_IMPLEMENTED');
}

// ============================================================
// READS
// ============================================================

/** Full card view: sku, owner, physical item, oracle value, ownership chain. */
export async function getCard(cardId: UUID): Promise<CardDetail | null> {
  throw new Error('NOT_IMPLEMENTED');
}

/** Browse and inventory grids. Defaults to active + locked cards, newest first. */
export async function getCards(query?: CardsQuery): Promise<CardSummary[]> {
  throw new Error('NOT_IMPLEMENTED');
}

/** Market grid. Pass `viewerId` so early-access visibility resolves correctly. */
export async function getListings(query?: ListingsQuery): Promise<ListingSummary[]> {
  throw new Error('NOT_IMPLEMENTED');
}

/** Listing detail, including the settled order once the webhook has landed. */
export async function getListing(listingId: UUID): Promise<ListingDetail | null> {
  throw new Error('NOT_IMPLEMENTED');
}

/** Consignment with its items and its full event trail. */
export async function getConsignment(
  consignmentId: UUID,
): Promise<ConsignmentDetail | null> {
  throw new Error('NOT_IMPLEMENTED');
}

/** Consignment queues, filterable by status for the admin board. */
export async function getConsignments(
  query?: ConsignmentsQuery,
): Promise<ConsignmentSummary[]> {
  throw new Error('NOT_IMPLEMENTED');
}

/** By id, handle, or auth id. Returns null when there is no such user. */
export async function getUser(lookup: UserLookup): Promise<User | null> {
  throw new Error('NOT_IMPLEMENTED');
}

/** Catalog search for the browse filters and the admin SKU screens. */
export async function getSkus(query?: SkusQuery): Promise<Sku[]> {
  throw new Error('NOT_IMPLEMENTED');
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
