/**
 * lib/mock/fixtures.ts
 *
 * Deterministic fixture data for previews and styleguides. Every id, float,
 * price, and timestamp is a literal — nothing here is generated, and there is
 * no RNG anywhere in this codebase.
 *
 * Import these for rendering. Never fetch from them, never write to them.
 *
 * All *_cents values are USD cents. 1 FSC = 1 USD. Ringgit is display only.
 *
 * Internal consistency held on purpose, so the fixtures behave like real rows:
 *   - `cards.tier` is always tierForPrice(sku.market_price_cents). Float never
 *     moves a tier: card 1 is a 0.021 float — near factory new — on a $45 SKU,
 *     and it is a Common.
 *   - `cards.float_percentile` is percent_rank() over float_value within the
 *     SKU, matching fn_refresh_float_percentiles().
 *   - `users.portfolio_value_cents` is the sum of fn_card_value_cents() over
 *     that user's active + locked cards, using the linear fallback multiplier
 *     `1.0 - float * 0.48` (no sku_float_curve rows exist yet).
 *   - `users.level` is the highest level whose rank_score_required is met by
 *     portfolio_value_cents + xp_total * 50, matching fn_refresh_levels().
 *   - A card carrying an early_access/public listing is 'locked'.
 *   - `orders` fee_bps is the SELLER's level fee, fee_cents is
 *     floor(gross * bps / 10000), and net_cents is gross - fee.
 *   - `card_provenance` follows fn_purchase_card exactly: on a sale the
 *     seller's open row gets released_at and price_cents set to the SALE
 *     price, and the buyer gets a new open row at that same price. A row's
 *     price_cents therefore means "sold for" once released_at is set, and
 *     "paid" while it is still open.
 *
 * The two early-access listings have a `public_at` far in the future so they
 * stay in the early-access state no matter when the fixtures are rendered.
 */

import type {
  Card,
  CardProvenance,
  Consignment,
  Item,
  Json,
  Listing,
  Order,
  Sku,
  User,
} from '@/lib/db/types';

// ------------------------------------------------------------
// IDS
// ------------------------------------------------------------

export const USER_IDS = {
  /** Level 2 Thug. Also the ops account that grades and authenticates. */
  aiman: 'a1000000-0000-4000-8000-000000000001',
  /** Level 5 Capo. Consignor of consignment-1, holds most of the inventory. */
  wenxin: 'a1000000-0000-4000-8000-000000000002',
  /** Level 7 Underboss. Consignor of consignment-2, holds the grails. */
  ravi: 'a1000000-0000-4000-8000-000000000003',
} as const;

export const SKU_IDS = {
  /** $45 — Tier 1 Common. */
  vans: '5c000000-0000-4000-8000-000000000001',
  /** $110 — Tier 2 Uncommon. */
  af1: '5c000000-0000-4000-8000-000000000002',
  /** $215 — Tier 3 Rare. */
  nb990: '5c000000-0000-4000-8000-000000000003',
  /** $425 — Tier 4 Epic. */
  aj1: '5c000000-0000-4000-8000-000000000004',
  /** $1,280 — Tier 5 Legendary. */
  sbDunk: '5c000000-0000-4000-8000-000000000005',
  /** $6,850 — Tier 5 Legendary. */
  yeezy2: '5c000000-0000-4000-8000-000000000006',
} as const;

export const CONSIGNMENT_IDS = {
  /** Completed intake, eight pairs. */
  first: 'c0000000-0000-4000-8000-000000000001',
  /** Authenticated, awaiting completion. Live transition for the admin board. */
  second: 'c0000000-0000-4000-8000-000000000002',
} as const;

const itemId = (n: number) => `17000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cardId = (n: number) => `ca000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const listingId = (n: number) => `11000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const orderId = (n: number) => `04000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const txnId = (n: number) => `77000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const ITEM_IDS = Array.from({ length: 12 }, (_, i) => itemId(i + 1));
export const CARD_IDS = Array.from({ length: 12 }, (_, i) => cardId(i + 1));
export const LISTING_IDS = Array.from({ length: 8 }, (_, i) => listingId(i + 1));
export const ORDER_IDS = Array.from({ length: 2 }, (_, i) => orderId(i + 1));

/** Four intake angles per item, the same set the grading queue shows. */
const photos = (slug: string): Json =>
  ['toe', 'lateral', 'sole', 'box'].map((angle) => ({
    url: `https://cdn.flexsoar.xyz/intake/${slug}/${angle}.webp`,
    angle,
  }));

/** The two hops card 1 has made since it was minted. */
const CARD_1_SALE_1_AT = '2026-06-20T09:41:00.000Z';
const CARD_1_SALE_2_AT = '2026-07-05T04:12:00.000Z';

// ------------------------------------------------------------
// USERS — three levels: Thug (2), Capo (5), Underboss (7)
// ------------------------------------------------------------

export const users: User[] = [
  {
    id: USER_IDS.aiman,
    auth_id: 'aa000000-0000-4000-8000-000000000001',
    handle: 'aiman_kl',
    email: 'aiman@flexsoar.xyz',
    country_code: 'MY',
    kyc_status: 'verified',
    is_consignor: false,
    is_admin: true,
    // 4,454 + 240 * 50 = 16,454 -> level 2 (needs 10,000)
    level: 2,
    xp_total: 240,
    portfolio_value_cents: 4454,
    created_at: '2026-03-04T02:15:00.000Z',
  },
  {
    id: USER_IDS.wenxin,
    auth_id: 'aa000000-0000-4000-8000-000000000002',
    handle: 'wenxin.ss15',
    email: 'wenxin@example.com',
    country_code: 'MY',
    kyc_status: 'verified',
    is_consignor: true,
    is_admin: false,
    // 102,335 + 13,200 * 50 = 762,335 -> level 5 (needs 750,000)
    level: 5,
    xp_total: 13200,
    portfolio_value_cents: 102335,
    created_at: '2026-01-19T09:40:00.000Z',
  },
  {
    id: USER_IDS.ravi,
    auth_id: 'aa000000-0000-4000-8000-000000000003',
    handle: 'ravi_bukit',
    email: 'ravi@example.com',
    country_code: 'MY',
    kyc_status: 'verified',
    is_consignor: true,
    is_admin: false,
    // 942,365 + 140,000 * 50 = 7,942,365 -> level 7 (needs 7,500,000)
    level: 7,
    xp_total: 140000,
    portfolio_value_cents: 942365,
    created_at: '2025-11-02T13:05:00.000Z',
  },
];

// ------------------------------------------------------------
// SKUS — market_price_cents (USD) places each one in a tier band
// ------------------------------------------------------------

export const skus: Sku[] = [
  {
    // $45 -> tier 1 Common
    id: SKU_IDS.vans,
    brand: 'Vans',
    model: 'Old Skool',
    colorway: 'Black / White',
    size_us: 9.5,
    retail_price_cents: 7000,
    market_price_cents: 4500,
    price_confidence: 0.96,
    priced_at: '2026-08-01T00:00:00.000Z',
    demand_score: 22.4,
    sprite_key: 'low-top',
    palette: { A: '#1B1B1B', B: '#3A3A3A', C: '#F2F2F2' },
    mint_cap: null,
    created_at: '2026-01-21T05:55:00.000Z',
  },
  {
    // $110 -> tier 2 Uncommon
    id: SKU_IDS.af1,
    brand: 'Nike',
    model: "Air Force 1 '07",
    colorway: 'Triple White',
    size_us: 10.0,
    retail_price_cents: 11500,
    market_price_cents: 11000,
    price_confidence: 0.94,
    priced_at: '2026-08-01T00:00:00.000Z',
    demand_score: 41.5,
    sprite_key: 'low-top',
    palette: { A: '#FFFFFF', B: '#E4E4E4', C: '#9A9A9A' },
    mint_cap: null,
    created_at: '2026-01-21T06:00:00.000Z',
  },
  {
    // $215 -> tier 3 Rare
    id: SKU_IDS.nb990,
    brand: 'New Balance',
    model: '990v6',
    colorway: 'Grey Day',
    size_us: 11.0,
    retail_price_cents: 20000,
    market_price_cents: 21500,
    price_confidence: 0.91,
    priced_at: '2026-08-01T00:00:00.000Z',
    demand_score: 55.8,
    sprite_key: 'low-top',
    palette: { A: '#8E9295', B: '#5C6063', C: '#D8D8D8' },
    mint_cap: null,
    created_at: '2026-02-08T04:30:00.000Z',
  },
  {
    // $425 -> tier 4 Epic
    id: SKU_IDS.aj1,
    brand: 'Jordan',
    model: 'Air Jordan 1 Retro High OG',
    colorway: 'Chicago Lost and Found',
    size_us: 10.5,
    retail_price_cents: 18000,
    market_price_cents: 42500,
    price_confidence: 0.87,
    priced_at: '2026-08-01T00:00:00.000Z',
    demand_score: 88.9,
    sprite_key: 'high-top',
    palette: { A: '#C8102E', B: '#F2EFE6', C: '#1B1B1B' },
    mint_cap: 250,
    created_at: '2026-02-14T08:10:00.000Z',
  },
  {
    // $1,280 -> tier 5 Legendary
    id: SKU_IDS.sbDunk,
    brand: 'Nike',
    model: 'SB Dunk Low',
    colorway: 'Travis Scott Cactus Jack',
    size_us: 9.0,
    retail_price_cents: 15000,
    market_price_cents: 128000,
    price_confidence: 0.81,
    priced_at: '2026-08-01T00:00:00.000Z',
    demand_score: 95.4,
    sprite_key: 'low-top',
    palette: { A: '#6E4B2A', B: '#B7202E', C: '#EDE6D6' },
    mint_cap: 60,
    created_at: '2026-03-02T11:45:00.000Z',
  },
  {
    // $6,850 -> tier 5 Legendary
    id: SKU_IDS.yeezy2,
    brand: 'Nike',
    model: 'Air Yeezy 2',
    colorway: 'Red October',
    size_us: 10.0,
    retail_price_cents: 25000,
    market_price_cents: 685000,
    price_confidence: 0.62,
    priced_at: '2026-08-01T00:00:00.000Z',
    demand_score: 99.1,
    sprite_key: 'high-top',
    palette: { A: '#C6202C', B: '#8E1620', C: '#3A0C10' },
    mint_cap: 5,
    created_at: '2026-03-02T11:50:00.000Z',
  },
];

// ------------------------------------------------------------
// CONSIGNMENTS
// ------------------------------------------------------------

export const consignments: Consignment[] = [
  {
    id: CONSIGNMENT_IDS.first,
    consignor_id: USER_IDS.wenxin,
    status: 'completed',
    item_count: 8,
    intake_fee_cents: 4000,
    submitted_at: '2026-05-02T03:00:00.000Z',
    received_at: '2026-05-06T07:20:00.000Z',
    completed_at: '2026-05-14T02:00:00.000Z',
    notes: 'Eight pairs, all with box. Dropped at the SS15 counter.',
    created_at: '2026-05-01T15:12:00.000Z',
  },
  {
    id: CONSIGNMENT_IDS.second,
    consignor_id: USER_IDS.ravi,
    status: 'authenticated',
    item_count: 4,
    intake_fee_cents: 2000,
    submitted_at: '2026-07-11T01:30:00.000Z',
    received_at: '2026-07-15T06:05:00.000Z',
    completed_at: null,
    notes: 'Grails. Red October needs a second authentication pass before payout.',
    created_at: '2026-07-10T22:48:00.000Z',
  },
];

// ------------------------------------------------------------
// ITEMS — 1:1 with cards, all graded, authenticated, and minted
// ------------------------------------------------------------

interface ItemSeed {
  n: number;
  sku: string;
  consignment: string;
  consignor: string;
  float: number;
  notes: string;
  /** 'minted' unless the card has been redeemed. */
  status: Item['status'];
  reserve: number;
}

const itemSeeds: ItemSeed[] = [
  { n: 1, sku: SKU_IDS.vans, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.021, notes: 'Deadstock. Sidewall bright, waffle sole unmarked, original box.', status: 'minted', reserve: 3800 },
  { n: 2, sku: SKU_IDS.vans, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.221, notes: 'Even toe creasing, foxing tape lightly scuffed.', status: 'minted', reserve: 3200 },
  { n: 3, sku: SKU_IDS.vans, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.518, notes: 'Heavy creasing, waffle tread worn flat at the forefoot.', status: 'redemption_hold', reserve: 2600 },
  { n: 4, sku: SKU_IDS.af1, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.084, notes: 'Crease-free toebox, midsole bright. Light heel scuff only.', status: 'minted', reserve: 9000 },
  { n: 5, sku: SKU_IDS.af1, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.312, notes: 'Toe creasing across both panels, midsole yellowing at the heel.', status: 'minted', reserve: 8000 },
  { n: 6, sku: SKU_IDS.nb990, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.145, notes: 'Mesh taut, no pilling. Faint sole dust.', status: 'minted', reserve: 18000 },
  { n: 7, sku: SKU_IDS.nb990, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.402, notes: 'Pilling on the collar, midsole compressed under the arch.', status: 'minted', reserve: 15000 },
  { n: 8, sku: SKU_IDS.aj1, consignment: CONSIGNMENT_IDS.first, consignor: USER_IDS.wenxin, float: 0.071, notes: 'Deadstock apart from a single try-on. Cracked leather intentional to the release.', status: 'minted', reserve: 38000 },
  { n: 9, sku: SKU_IDS.aj1, consignment: CONSIGNMENT_IDS.second, consignor: USER_IDS.ravi, float: 0.288, notes: 'Worn a handful of times. Toe crease across both panels.', status: 'minted', reserve: 33000 },
  { n: 10, sku: SKU_IDS.sbDunk, consignment: CONSIGNMENT_IDS.second, consignor: USER_IDS.ravi, float: 0.052, notes: 'Unworn, original laces bagged, box lid intact.', status: 'minted', reserve: 118000 },
  { n: 11, sku: SKU_IDS.sbDunk, consignment: CONSIGNMENT_IDS.second, consignor: USER_IDS.ravi, float: 0.463, notes: 'Visible wear throughout, suede rubbed through at the toe.', status: 'minted', reserve: 82000 },
  { n: 12, sku: SKU_IDS.yeezy2, consignment: CONSIGNMENT_IDS.second, consignor: USER_IDS.ravi, float: 0.011, notes: 'Deadstock. Original box, receipt, and both lace sets. Best example we have handled.', status: 'minted', reserve: 640000 },
];

export const items: Item[] = itemSeeds.map((seed) => ({
  id: itemId(seed.n),
  sku_id: seed.sku,
  consignment_id: seed.consignment,
  consignor_id: seed.consignor,
  status: seed.status,
  float_value: seed.float,
  graded_by: USER_IDS.aiman,
  graded_at:
    seed.consignment === CONSIGNMENT_IDS.first
      ? '2026-05-08T04:00:00.000Z'
      : '2026-07-17T03:30:00.000Z',
  grading_notes: seed.notes,
  photos: photos(`item-${String(seed.n).padStart(2, '0')}`),
  authenticated_at:
    seed.consignment === CONSIGNMENT_IDS.first
      ? '2026-05-09T02:10:00.000Z'
      : '2026-07-18T01:15:00.000Z',
  authenticated_by: USER_IDS.aiman,
  custody_location: 'KL-VAULT-A',
  reserve_price_cents: seed.reserve,
  created_at:
    seed.consignment === CONSIGNMENT_IDS.first
      ? '2026-05-06T07:20:00.000Z'
      : '2026-07-15T06:05:00.000Z',
}));

// ------------------------------------------------------------
// CARDS — 12 cards, all five tiers, one exceptional
// ------------------------------------------------------------

interface CardSeed {
  n: number;
  /** Mint number within the SKU. */
  mint: number;
  owner: string;
  tier: Card['tier'];
  /** percent_rank() over float_value within the SKU, x100. */
  percentile: number;
  status: Card['status'];
  mintedAt: string;
  exceptional?: { reason: string };
}

const cardSeeds: CardSeed[] = [
  // sku vans ($45 -> tier 1 Common). Floats 0.021 / 0.221 / 0.518.
  // Card 1 is the proof: a 0.021 float is near factory new, and on a $45 SKU
  // it is still a Common. Float is condition; tier is value.
  { n: 1, mint: 1, owner: USER_IDS.aiman, tier: 1, percentile: 0.0, status: 'active', mintedAt: '2026-05-10T02:00:00.000Z' },
  { n: 2, mint: 2, owner: USER_IDS.wenxin, tier: 1, percentile: 50.0, status: 'locked', mintedAt: '2026-05-10T02:00:05.000Z' },
  { n: 3, mint: 3, owner: USER_IDS.wenxin, tier: 1, percentile: 100.0, status: 'redeemed', mintedAt: '2026-05-10T02:00:10.000Z' },
  // sku af1 ($110 -> tier 2 Uncommon). Floats 0.084 / 0.312.
  { n: 4, mint: 1, owner: USER_IDS.wenxin, tier: 2, percentile: 0.0, status: 'locked', mintedAt: '2026-05-10T02:01:00.000Z' },
  { n: 5, mint: 2, owner: USER_IDS.wenxin, tier: 2, percentile: 100.0, status: 'active', mintedAt: '2026-05-10T02:01:05.000Z' },
  // sku nb990 ($215 -> tier 3 Rare). Floats 0.145 / 0.402.
  { n: 6, mint: 1, owner: USER_IDS.wenxin, tier: 3, percentile: 0.0, status: 'locked', mintedAt: '2026-05-10T02:02:00.000Z' },
  { n: 7, mint: 2, owner: USER_IDS.wenxin, tier: 3, percentile: 100.0, status: 'active', mintedAt: '2026-05-10T02:02:05.000Z' },
  // sku aj1 ($425 -> tier 4 Epic). Floats 0.071 / 0.288.
  { n: 8, mint: 1, owner: USER_IDS.wenxin, tier: 4, percentile: 0.0, status: 'locked', mintedAt: '2026-05-10T02:03:00.000Z' },
  { n: 9, mint: 2, owner: USER_IDS.ravi, tier: 4, percentile: 100.0, status: 'active', mintedAt: '2026-07-19T01:00:00.000Z' },
  // sku sbDunk ($1,280 -> tier 5 Legendary). Floats 0.052 / 0.463.
  { n: 10, mint: 1, owner: USER_IDS.ravi, tier: 5, percentile: 0.0, status: 'locked', mintedAt: '2026-07-19T01:01:00.000Z' },
  { n: 11, mint: 2, owner: USER_IDS.ravi, tier: 5, percentile: 100.0, status: 'active', mintedAt: '2026-07-19T01:01:05.000Z' },
  // sku yeezy2 ($6,850 -> tier 5 Legendary). Float 0.011.
  // Exceptional is a FLAG on top of tier 5, not a sixth tier.
  {
    n: 12,
    mint: 1,
    owner: USER_IDS.ravi,
    tier: 5,
    percentile: 0.0,
    status: 'active',
    mintedAt: '2026-07-19T01:02:00.000Z',
    exceptional: {
      reason:
        'Deadstock with box, receipt, and both lace sets. Lowest float recorded for this SKU.',
    },
  },
];

export const cards: Card[] = cardSeeds.map((seed) => {
  const item = items[seed.n - 1];
  return {
    id: cardId(seed.n),
    item_id: item.id,
    sku_id: item.sku_id,
    owner_id: seed.owner,
    float_value: item.float_value as number,
    tier: seed.tier,
    is_exceptional: seed.exceptional !== undefined,
    exceptional_reason: seed.exceptional?.reason ?? null,
    mint_number: seed.mint,
    float_percentile: seed.percentile,
    status: seed.status,
    minted_at: seed.mintedAt,
  };
});

// ------------------------------------------------------------
// LISTINGS — 8 total, 2 still inside their early-access window
// ------------------------------------------------------------

/**
 * fn_list_card hardcodes early_access_level 4: Enforcer and above see a
 * listing during its window. Of the fixture users only wenxin (5) and ravi (7)
 * clear that bar; aiman (2) hits EarlyAccessLocked.
 */
const EARLY_ACCESS_LEVEL = 4;

/** Fixed and far out, so the two early-access listings never lapse mid-render. */
const EARLY_ACCESS_PUBLIC_AT = '2031-01-01T00:00:00.000Z';

export const listings: Listing[] = [
  {
    id: listingId(1),
    card_id: cardId(2),
    seller_id: USER_IDS.wenxin,
    // Under oracle by more than 15% (4022 * 0.85 = 3418). The listing UI must
    // flag this, to both sides. It is deliberate; never hide it.
    price_cents: 3300,
    status: 'public',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: '2026-08-02T10:02:00.000Z',
    oracle_value_cents: 4022,
    created_at: '2026-08-02T10:00:00.000Z',
    sold_at: null,
  },
  {
    id: listingId(2),
    card_id: cardId(4),
    seller_id: USER_IDS.wenxin,
    price_cents: 11500,
    status: 'public',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: '2026-07-30T04:15:00.000Z',
    oracle_value_cents: 10556,
    created_at: '2026-07-30T04:00:00.000Z',
    sold_at: null,
  },
  {
    id: listingId(3),
    card_id: cardId(6),
    seller_id: USER_IDS.wenxin,
    price_cents: 21000,
    status: 'public',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: '2026-08-05T02:15:00.000Z',
    oracle_value_cents: 20003,
    created_at: '2026-08-05T02:00:00.000Z',
    sold_at: null,
  },
  {
    // Early access #1 — Epic, sold by wenxin (Capo, 15 minute window).
    // ravi (7) and wenxin (seller) can see it; aiman (2) cannot.
    id: listingId(4),
    card_id: cardId(8),
    seller_id: USER_IDS.wenxin,
    price_cents: 43500,
    status: 'early_access',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: EARLY_ACCESS_PUBLIC_AT,
    oracle_value_cents: 41051,
    created_at: '2026-08-09T14:00:00.000Z',
    sold_at: null,
  },
  {
    // Early access #2 — Legendary, sold by ravi (Underboss, 25 minute window).
    id: listingId(5),
    card_id: cardId(10),
    seller_id: USER_IDS.ravi,
    price_cents: 131000,
    status: 'early_access',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: EARLY_ACCESS_PUBLIC_AT,
    oracle_value_cents: 124805,
    created_at: '2026-08-09T15:30:00.000Z',
    sold_at: null,
  },
  {
    // Sold, hop 1 of card 1: wenxin minted it out of consignment-1 and sold
    // it to ravi. See orders[0] and card_provenance.
    id: listingId(6),
    card_id: cardId(1),
    seller_id: USER_IDS.wenxin,
    price_cents: 4300,
    status: 'sold',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: '2026-06-18T08:15:00.000Z',
    oracle_value_cents: 4454,
    created_at: '2026-06-18T08:00:00.000Z',
    sold_at: CARD_1_SALE_1_AT,
  },
  {
    // Sold, hop 2 of card 1: ravi flipped it to aiman. A card may carry any
    // number of closed listings; the unique index only covers early_access
    // and public.
    id: listingId(7),
    card_id: cardId(1),
    seller_id: USER_IDS.ravi,
    price_cents: 4900,
    status: 'sold',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: '2026-07-03T02:25:00.000Z',
    oracle_value_cents: 4454,
    created_at: '2026-07-03T02:00:00.000Z',
    sold_at: CARD_1_SALE_2_AT,
  },
  {
    // Cancelled: the card returned to 'active' under its seller.
    id: listingId(8),
    card_id: cardId(5),
    seller_id: USER_IDS.wenxin,
    price_cents: 9900,
    status: 'cancelled',
    early_access_level: EARLY_ACCESS_LEVEL,
    public_at: '2026-07-18T03:15:00.000Z',
    oracle_value_cents: 9352,
    created_at: '2026-07-18T03:00:00.000Z',
    sold_at: null,
  },
];

// ------------------------------------------------------------
// ORDERS — one per sold listing
// fee_bps is the SELLER's level fee: Capo 500, Underboss 350.
// ------------------------------------------------------------

export const orders: Order[] = [
  {
    id: orderId(1),
    listing_id: listingId(6),
    card_id: cardId(1),
    buyer_id: USER_IDS.ravi,
    seller_id: USER_IDS.wenxin,
    gross_cents: 4300,
    // wenxin is level 5 Capo.
    fee_bps: 500,
    fee_cents: 215, // floor(4300 * 500 / 10000)
    net_cents: 4085,
    settlement_ref: 'pi_3PfLq2AaBbCcDdEe0001',
    status: 'settled',
    txn_id: txnId(1),
    created_at: CARD_1_SALE_1_AT,
  },
  {
    id: orderId(2),
    listing_id: listingId(7),
    card_id: cardId(1),
    buyer_id: USER_IDS.aiman,
    seller_id: USER_IDS.ravi,
    gross_cents: 4900,
    // ravi is level 7 Underboss.
    fee_bps: 350,
    fee_cents: 171, // floor(4900 * 350 / 10000)
    net_cents: 4729,
    settlement_ref: 'pi_3PfLq2AaBbCcDdEe0002',
    status: 'settled',
    txn_id: txnId(2),
    created_at: CARD_1_SALE_2_AT,
  },
];

// ------------------------------------------------------------
// CARD PROVENANCE
//
// Card 1 has the full three-hop chain: minted to wenxin (Capo), sold to ravi
// (Underboss), flipped to aiman (Thug). Every other card is still with the
// user it was minted to, so it has a single open row.
//
// `id` is a bigserial, so the rows are numbered in insertion order, which is
// time order: the consignment-1 mints, then card 1's two hops, then the
// consignment-2 mints.
// ------------------------------------------------------------

interface MintHop {
  card: number;
  owner: string;
  level: number;
}

/** Cards minted out of consignment-1, to wenxin at level 5. */
const consignmentOneMints: MintHop[] = [2, 3, 4, 5, 6, 7, 8].map((card) => ({
  card,
  owner: USER_IDS.wenxin,
  level: 5,
}));

/** Cards minted out of consignment-2, to ravi at level 7. */
const consignmentTwoMints: MintHop[] = [9, 10, 11, 12].map((card) => ({
  card,
  owner: USER_IDS.ravi,
  level: 7,
}));

const mintHop = (id: number, hop: MintHop): CardProvenance => ({
  id,
  card_id: cardId(hop.card),
  owner_id: hop.owner,
  owner_level: hop.level,
  acquired_at: cardSeeds[hop.card - 1].mintedAt,
  released_at: null,
  price_cents: null,
});

export const cardProvenance: CardProvenance[] = [
  // Card 1, hop 1 of 3. Minted to wenxin, released when ravi bought it.
  // price_cents is the price it SOLD for, per fn_purchase_card.
  {
    id: 1,
    card_id: cardId(1),
    owner_id: USER_IDS.wenxin,
    owner_level: 5,
    acquired_at: cardSeeds[0].mintedAt,
    released_at: CARD_1_SALE_1_AT,
    price_cents: 4300,
  },
  ...consignmentOneMints.map((hop, i) => mintHop(i + 2, hop)),
  // Card 1, hop 2 of 3. ravi bought at 4,300 and sold at 4,900; the sale
  // overwrote price_cents, which is what the SQL does.
  {
    id: 9,
    card_id: cardId(1),
    owner_id: USER_IDS.ravi,
    owner_level: 7,
    acquired_at: CARD_1_SALE_1_AT,
    released_at: CARD_1_SALE_2_AT,
    price_cents: 4900,
  },
  // Card 1, hop 3 of 3. aiman holds it now, having paid 4,900.
  {
    id: 10,
    card_id: cardId(1),
    owner_id: USER_IDS.aiman,
    owner_level: 2,
    acquired_at: CARD_1_SALE_2_AT,
    released_at: null,
    price_cents: 4900,
  },
  ...consignmentTwoMints.map((hop, i) => mintHop(i + 11, hop)),
];

// ------------------------------------------------------------
// AGGREGATE
// ------------------------------------------------------------

export const FIXTURES = {
  users,
  skus,
  consignments,
  items,
  cards,
  listings,
  orders,
  cardProvenance,
} as const;

export const userById = (id: string): User | undefined =>
  users.find((u) => u.id === id);

export const skuById = (id: string): Sku | undefined => skus.find((s) => s.id === id);

export const itemById = (id: string): Item | undefined => items.find((i) => i.id === id);

export const cardById = (id: string): Card | undefined => cards.find((c) => c.id === id);

export const listingById = (id: string): Listing | undefined =>
  listings.find((l) => l.id === id);

export const consignmentById = (id: string): Consignment | undefined =>
  consignments.find((c) => c.id === id);

/** The active listing on a card, if it has one. */
export const activeListingForCard = (id: string): Listing | undefined =>
  listings.find(
    (l) => l.card_id === id && (l.status === 'early_access' || l.status === 'public'),
  );

/** The settled order for a sold listing, if there is one. */
export const orderForListing = (id: string): Order | undefined =>
  orders.find((o) => o.listing_id === id);

/** A card's ownership chain, oldest hop first. */
export const provenanceForCard = (id: string): CardProvenance[] =>
  cardProvenance
    .filter((p) => p.card_id === id)
    .sort((a, b) => a.acquired_at.localeCompare(b.acquired_at));
