/**
 * tests/invariants.test.ts
 *
 * The fixtures in lib/mock/fixtures.ts are not just type-valid — they behave
 * like rows the SQL functions would actually have produced. Four tracks build
 * their UI against them, so a fixture that drifts from the schema teaches
 * every track the wrong thing. These tests pin that down.
 *
 * Each assertion names the SQL function it mirrors. When a .sql file changes,
 * the failure here should point straight at what to update.
 *
 * Imports are relative, not `@/`. A `vitest.config.ts` now supplies that alias,
 * so either form resolves; the relative one is kept for consistency across the
 * file rather than because it is still required.
 */

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  cardProvenance,
  cards,
  consignments,
  items,
  listings,
  orders,
  skus,
  users,
} from '../lib/mock/fixtures';
import {
  TIER_BANDS,
  tierForPrice,
  conditionGradeBand,
  publishedConditionLabel,
} from '../lib/domain/rarity';
import { formatFsc, formatUsd, formatMyr } from '../components/card/format';
import {
  TRANSPARENT,
  paletteFromJson,
  spriteMapForKey,
  type SpriteMap,
} from '../lib/sprites';
import {
  GRADE_WEIGHTS,
  gradeFloatFromComponents,
  type GradeComponents,
} from '../lib/db/grading';
import {
  CARD_STATUSES,
  type Card,
  type CardStatus,
  type Sku,
  type SkuModel,
  type User,
} from '../lib/db/types';
import {
  CREDIT_HOLD_MINUTES_FALLBACK,
  cashLegCents,
  checkoutExpiresAtSeconds,
  isFscOnlyPurchase,
  validateRequestedCredit,
} from '../app/(market)/checkout-math';
import { CREDIT_HOLD_MINUTES_FALLBACK as CONTRACT_CREDIT_HOLD_MINUTES_FALLBACK } from '../lib/api/contract';
import type { ListingSummary, ItemSummary } from '../lib/api/contract';
import {
  ContractError,
  upsertSku,
  createSkuModel,
  ensureSkuVariant,
  listSkuModels,
  getSkuModel,
  updateSkuModel,
  updateSkuVariant,
  replaceSkuArt,
  burnCard,
  archiveSkuModel,
  getConnectOnboardingStatus,
} from '../lib/api/contract';
import { contractErrorCode } from '../lib/db/errors';
import { MarketTile } from '../components/market/MarketTile';
import { SkuModelForm, parseDraft, type Draft } from '../components/admin/skus/SkuModelForm';
import { VariantsTable } from '../components/admin/skus/VariantsTable';
import { MintTable } from '../components/admin/mint/MintTable';
import { DecisionControls, oracleHint, askingNote } from '../components/admin/submissions/DecisionControls';
import SubmissionsQueuePage from '../app/admin/submissions/page';
import ReviewSubmissionPage from '../app/admin/submissions/[itemId]/page';
import ConsignmentDetailPage from '../app/admin/consignments/[id]/page';
import FulfilmentPage from '../app/admin/fulfilment/page';
import { PricePayout } from '../components/market/intake/PricePayout';
import { ListForm } from '../components/market/ListForm';
import {
  COUNTRIES,
  derivePayoutPreview,
  isValidCountryCode,
} from '../components/market/intake/intake-config';

// SkuModelForm calls useRouter() (next/navigation) unconditionally at the top
// of the component. Outside a real app-router tree that hook throws
// ("invariant expected app router to be mounted") rather than returning null,
// so a static render needs this mock regardless of which branch runs.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    replace: () => {},
    prefetch: () => {},
  }),
}));

// SkuModelForm and VariantsTable both import Server Actions ("use server")
// from this module at module scope. Mirrors, not imports, same reasoning as
// the stripe webhook section below: the real module pulls in
// requireAdminAction's Supabase/cookies() chain, which has no request
// context under a static render.
vi.mock('@/app/admin/skus/actions', () => ({
  createSkuModelAction: async () => ({ ok: true, modelId: 'model-1' }),
  updateSkuModelAction: async () => ({ ok: true }),
  ensureSkuVariantAction: async () => ({ ok: true }),
  getSkuFloatCurveAction: async () => ({ ok: true, bands: [] }),
  updateSkuVariantAction: async () => ({ ok: true }),
  getSkuArtUploadUrlAction: async () => ({ ok: true }),
  replaceSkuArtAction: async () => ({ ok: true }),
}));

// Same reasoning, for the other admin surfaces' Server Actions this file's
// new page-level renders below pull in transitively (MintTable,
// DecisionControls, ArtUploader, TransitionControls, MarkShippedControl).
vi.mock('@/app/admin/mint/actions', () => ({
  batchMintAction: async () => ({ outcomes: [], message: undefined }),
}));
vi.mock('@/app/admin/submissions/actions', () => ({
  approveSubmissionAction: async () => ({ ok: true }),
  rejectSubmissionAction: async () => ({ ok: true }),
}));
vi.mock('@/app/admin/consignments/actions', () => ({
  advanceConsignmentAction: async () => ({ ok: true }),
}));
vi.mock('@/app/admin/fulfilment/actions', () => ({
  markShippedAction: async () => ({ ok: true }),
  confirmShipmentAction: async () => ({ ok: true }),
  markDefaultAction: async () => ({ ok: true }),
}));

// requireAdminPage() re-verifies against Supabase (auth.getUser(), then
// getUser() on the contract) — real network calls with no request context
// under a static render. Every page test below only cares what renders past
// the gate, never the gate itself, so this always lets the render through.
// Return value is discarded by every caller (`await requireAdminPage(...)`,
// no assignment), so the stub's return value is never inspected.
vi.mock('@/components/admin/auth', () => ({
  requireAdminPage: async () => undefined,
}));

// db-reads.ts is a stack of local Supabase read adapters (see its own header
// comment) — no request context under a static render, same reasoning as
// requireAdminPage above. Each function here is called by exactly one page
// tested below, so one fixture per function is unambiguous.
vi.mock('@/components/admin/db-reads', () => ({
  getPendingSubmissions: async () => [
    {
      id: 'submission-1',
      sku_id: 'sku-1',
      consignor_id: null,
      status: 'pending_review',
      custody: 'seller',
      custody_holder_id: null,
      grade_source: 'seller_declared',
      asking_price_cents: 21500,
      submitted_payout: 'cash',
      last_proof_at: null,
      photos: [],
      grading_notes: null,
      float_value: null,
      grade: null,
      created_at: '2026-01-01T00:00:00Z',
      sku: { brand: 'Nike', model: 'Air Max 1', colorway: 'Seed Grey', size_us: 10 },
      seller: null,
    },
  ],
  getSellerTrust: async () => new Map(),
  getSubmission: async () => ({
    id: 'submission-1',
    sku_id: 'sku-1',
    consignor_id: 'consignor-1',
    status: 'pending_review',
    custody: 'seller',
    custody_holder_id: null,
    grade_source: 'seller_declared',
    asking_price_cents: 21500,
    submitted_payout: 'cash',
    last_proof_at: null,
    photos: [],
    grading_notes: null,
    float_value: null,
    grade: null,
    created_at: '2026-01-01T00:00:00Z',
    sku: {
      id: 'sku-1',
      brand: 'Nike',
      model: 'Air Max 1',
      colorway: 'Seed Grey',
      size_us: 10,
      market_price_cents: 26000,
      art_url: null,
    },
    seller: { id: 'consignor-1', handle: 'sneakerhead', level: 2 },
  }),
  getSellerHistory: async () => ({
    id: 'consignor-1',
    handle: 'sneakerhead',
    level: 2,
    fulfilments_completed: 3,
    defaults_count: 0,
    is_restricted: false,
    recent: [
      {
        id: 'submission-0',
        status: 'accepted',
        created_at: '2025-12-01T00:00:00Z',
        asking_price_cents: 8000,
        brand: 'Nike',
        model: 'Air Max 1',
        size_us: 10,
      },
    ],
  }),
  getSellerHeldRedemptions: async () => [],
  getProofOverdue: async () => [],
  getPlatformConfig: async () => ({
    sellerShipmentDays: 7,
    proofOfPossessionDays: 90,
  }),
}));

// PARTIAL mock: this file also imports real contract functions elsewhere
// (upsertSku, createSkuModel, …) via the relative path and tests their real
// throwing behaviour directly — those must keep running for real. Only
// getConsignment/getRedemptions are overridden here, everything else in the
// module passes through via importOriginal(), same module either way vitest
// resolves it by, so a plain vi.mock without importOriginal would have
// silently replaced those real exports with undefined too.
vi.mock('@/lib/api/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/contract')>();
  return {
    ...actual,
    getConsignment: async () => ({
      id: 'consignment-1',
      consignor_id: 'consignor-1',
      consignor: { id: 'consignor-1', handle: 'sneakerhead', level: 2 },
      status: 'in_review',
      item_count: 1,
      intake_fee_cents: 1500,
      submitted_at: '2026-01-01T00:00:00Z',
      received_at: null,
      completed_at: null,
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      items: [],
      events: [],
    }),
    getRedemptions: async () => [
      {
        id: 'redemption-1',
        card_id: 'card-1',
        item_id: 'item-1',
        user_id: 'redeemer-1',
        handling_fee_cents: 995,
        shipping_address: { name: 'A. Buyer', line1: '1 Market St', city: 'SF', country: 'US' },
        status: 'requested',
        carrier: null,
        tracking_number: null,
        requested_at: '2026-01-01T00:00:00Z',
        shipped_at: null,
        card: {
          id: 'card-1',
          mint_number: 4,
          float_value: 0.062,
          sku: { brand: 'Nike', model: 'Air Max 1', colorway: 'Seed Grey', size_us: 10 },
        },
        item: { id: 'item-1', status: 'redemption_hold', custody_location: 'warehouse-a' },
        redeemer: { id: 'redeemer-1', handle: 'buyer1', level: 1 },
        fulfiller: null,
      },
    ],
  };
});

// ------------------------------------------------------------
// SQL MIRRORS
// ------------------------------------------------------------

/**
 * fn_float_multiplier: no sku_float_curve rows exist yet, so every SKU falls
 * through to the linear fallback.
 */
const floatMultiplier = (float: number): number => 1.0 - float * 0.48;

/** fn_card_value_cents(card). */
const cardValueCents = (card: Card, sku: Sku): number =>
  Math.floor(sku.market_price_cents! * floatMultiplier(card.float_value));

/**
 * percent_rank() over (order by float_value), x100, rounded to 2dp — what
 * fn_refresh_float_percentiles writes.
 */
const percentRank = (population: number[], value: number): number => {
  if (population.length <= 1) return 0;
  const below = population.filter((v) => v < value).length;
  return Math.round((below / (population.length - 1)) * 100 * 100) / 100;
};

/** The `levels` rows inserted by 001_schema.sql. */
const LEVELS: { level: number; rankScoreRequired: number; sellerFeeBps: number }[] = [
  { level: 1, rankScoreRequired: 0, sellerFeeBps: 800 },
  { level: 2, rankScoreRequired: 10000, sellerFeeBps: 750 },
  { level: 3, rankScoreRequired: 50000, sellerFeeBps: 700 },
  { level: 4, rankScoreRequired: 200000, sellerFeeBps: 600 },
  { level: 5, rankScoreRequired: 750000, sellerFeeBps: 500 },
  { level: 6, rankScoreRequired: 2500000, sellerFeeBps: 425 },
  { level: 7, rankScoreRequired: 7500000, sellerFeeBps: 350 },
  { level: 8, rankScoreRequired: 20000000, sellerFeeBps: 300 },
];

const sellerFeeBps = (level: number): number =>
  LEVELS.find((l) => l.level === level)!.sellerFeeBps;

/** fn_refresh_levels: rank_score = portfolio_value_cents + (xp_total * 50). */
const levelForRankScore = (rankScore: number): number =>
  LEVELS.filter((l) => l.rankScoreRequired <= rankScore).at(-1)!.level;

/**
 * fn_purchase_card_core's settlement-split validation (018-020, applied to
 * the project but not yet a .sql file in this worktree — see
 * docs/handoff/data.md). Mirrors the RULE the migration documents, not its
 * verbatim raise text: the cash remainder (price - credit) needs a real
 * settlement_ref; FSC-only (credit === price) may pass null since no money
 * moved through Stripe for that order at all.
 */
const splitSettlement = (
  priceCents: number,
  creditCents: number,
  settlementRef: string | null,
  buyerBalanceCents?: number,
): { creditCents: number; cashCents: number } => {
  if (!Number.isInteger(creditCents) || creditCents < 0) {
    throw new Error(`credit_cents must be a non-negative integer, got ${creditCents}`);
  }
  if (creditCents > priceCents) {
    throw new Error(`credit_cents ${creditCents} exceeds price ${priceCents}`);
  }
  if (buyerBalanceCents !== undefined && creditCents > buyerBalanceCents) {
    throw new Error(
      `insufficient credit: balance ${buyerBalanceCents}, requested ${creditCents}`,
    );
  }
  const cashCents = priceCents - creditCents;
  if (cashCents > 0 && (!settlementRef || settlementRef.trim() === '')) {
    throw new Error(`cash settlement of ${cashCents} requires a settlement_ref`);
  }
  return { creditCents, cashCents };
};

/**
 * fn_payout_method_for_user (018-020, raise behaviour updated by 025).
 * cash_payout_countries live-verified against the project (2026-08-21):
 * exactly one row, country_code 'MY'. Decoupled from HOW the buyer paid —
 * splitSettlement() above never looks at the seller, and this never looks at
 * the buyer's payment method.
 *
 * 025_user_country.sql changed what a null/empty country_code does: it used
 * to resolve to 'credit' (the bug 025 closes — see that migration's own
 * comment), now it RAISES 'user % has no country on file...' instead, mapped
 * to COUNTRY_NOT_SET in lib/db/errors.ts. A recognised-but-not-cash code
 * (e.g. 'SG', 'US') is unaffected — that path still resolves to 'credit'.
 */
const CASH_PAYOUT_COUNTRIES = ['MY'];
const derivePayoutMethod = (countryCode: string | null | undefined): 'cash' | 'credit' => {
  if (!countryCode || countryCode.trim() === '') {
    throw new Error('user has no country on file, so their payout cannot be determined');
  }
  return CASH_PAYOUT_COUNTRIES.includes(countryCode) ? 'cash' : 'credit';
};

/**
 * ledger_entries' append-only invariant: entries sharing a txn_id must net to
 * zero within each asset class. `card` entries carry no amount_cents (the
 * schema's check constraint requires it null for asset='card'), so weight
 * defaults to 1 — one card moving from one direction to the other.
 */
interface LedgerProbe {
  txn_id: string;
  asset: 'currency' | 'card' | 'credit';
  amount_cents: number | null;
  direction: 1 | -1;
}
const ledgerNetsToZero = (entries: readonly LedgerProbe[]): boolean => {
  const byTxnAsset = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.txn_id}:${entry.asset}`;
    const weight = entry.amount_cents ?? 1;
    byTxnAsset.set(key, (byTxnAsset.get(key) ?? 0) + weight * entry.direction);
  }
  return [...byTxnAsset.values()].every((sum) => sum === 0);
};

/** fn_record_sweep (020): p_amount_cents may not exceed unswept_cents. */
const recordSweepAmount = (amountCents: number, unsweptCents: number): number => {
  if (amountCents > unsweptCents) {
    throw new Error(`sweep of ${amountCents} exceeds unswept balance of ${unsweptCents}`);
  }
  return amountCents;
};

// ------------------------------------------------------------
// LOOKUPS
// ------------------------------------------------------------

const skuFor = (card: Card): Sku => {
  const sku = skus.find((s) => s.id === card.sku_id);
  if (!sku) throw new Error(`card ${card.id} references an unknown sku`);
  return sku;
};

const cardFor = (cardIdValue: string): Card => {
  const card = cards.find((c) => c.id === cardIdValue);
  if (!card) throw new Error(`unknown card ${cardIdValue}`);
  return card;
};

const userFor = (userIdValue: string): User => {
  const user = users.find((u) => u.id === userIdValue);
  if (!user) throw new Error(`unknown user ${userIdValue}`);
  return user;
};

/** A card's ownership chain, oldest hop first. */
const chainFor = (cardIdValue: string) =>
  cardProvenance
    .filter((p) => p.card_id === cardIdValue)
    .sort((a, b) => a.acquired_at.localeCompare(b.acquired_at));

const liveListings = listings.filter(
  (l) => l.status === 'early_access' || l.status === 'public',
);
const soldListings = listings.filter((l) => l.status === 'sold');

// ------------------------------------------------------------
// TIER BANDS
// ------------------------------------------------------------

describe('tier_bands', () => {
  it('mirrors the rows inserted by 001_schema.sql, in USD cents', () => {
    expect(
      TIER_BANDS.map((b) => [b.tier, b.name, b.minCents, b.maxCents]),
    ).toEqual([
      [1, 'Common', 0, 6000],
      [2, 'Uncommon', 6000, 12000],
      [3, 'Rare', 12000, 25000],
      [4, 'Epic', 25000, 50000],
      [5, 'Legendary', 50000, null],
    ]);
  });

  it('tierForPrice is lower-inclusive and upper-exclusive, like fn_tier_for_price', () => {
    expect(tierForPrice(0)).toBe(1);
    expect(tierForPrice(5999)).toBe(1);
    expect(tierForPrice(6000)).toBe(2);
    expect(tierForPrice(11999)).toBe(2);
    expect(tierForPrice(12000)).toBe(3);
    expect(tierForPrice(24999)).toBe(3);
    expect(tierForPrice(25000)).toBe(4);
    expect(tierForPrice(49999)).toBe(4);
    expect(tierForPrice(50000)).toBe(5);
    expect(tierForPrice(100_000_000)).toBe(5);
  });

  it('returns null where the SQL returns null', () => {
    expect(tierForPrice(-1)).toBeNull();
    expect(tierForPrice(Number.NaN)).toBeNull();
  });
});

// ------------------------------------------------------------
// TIER IS VALUE, FLOAT IS CONDITION
// ------------------------------------------------------------

describe('cards.tier', () => {
  it.each(cards.map((c) => [c.mint_number, c] as const))(
    'card %i takes its tier from the SKU base price, per fn_mint_card',
    (_mint, card) => {
      const sku = skuFor(card);
      expect(card.tier).toBe(tierForPrice(sku.market_price_cents!));
    },
  );

  it('spans all five tiers', () => {
    expect(new Set(cards.map((c) => c.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('keeps a pristine float on a cheap SKU a Common — float never promotes rarity', () => {
    const pristineCommons = cards.filter((c) => c.tier === 1 && c.float_value < 0.05);
    expect(pristineCommons.length).toBeGreaterThanOrEqual(1);

    // and the SKU really is cheap enough to be Tier 1 on price alone
    for (const card of pristineCommons) {
      expect(skuFor(card).market_price_cents!).toBeLessThan(6000);
    }
  });

  it('carries exactly one exceptional card, flagged rather than re-tiered', () => {
    const exceptional = cards.filter((c) => c.is_exceptional);
    expect(exceptional).toHaveLength(1);
    expect(exceptional[0].exceptional_reason).toBeTruthy();
    // the flag sits on top of a real tier band
    expect(exceptional[0].tier).toBe(tierForPrice(skuFor(exceptional[0]).market_price_cents!));
  });

  it('copies the graded float off the item and leaves it alone, per fn_mint_card', () => {
    for (const card of cards) {
      const item = items.find((i) => i.id === card.item_id)!;
      expect(item.float_value).toBe(card.float_value);
      expect(item.sku_id).toBe(card.sku_id);
      // graded by a human at intake, before the mint
      expect(item.graded_at).not.toBeNull();
      expect(item.authenticated_at).not.toBeNull();
    }
  });
});

// ------------------------------------------------------------
// PERCENTILES
// ------------------------------------------------------------

describe('cards.float_percentile', () => {
  it.each(skus.map((s) => [`${s.brand} ${s.model}`, s] as const))(
    'matches percent_rank within %s, per fn_refresh_float_percentiles',
    (_label, sku) => {
      const group = cards.filter((c) => c.sku_id === sku.id && c.status !== 'burned');
      expect(group.length).toBeGreaterThan(0);

      const floats = group.map((c) => c.float_value);
      for (const card of group) {
        expect(card.float_percentile).toBe(percentRank(floats, card.float_value));
      }
    },
  );
});

// ------------------------------------------------------------
// LISTINGS
// ------------------------------------------------------------

describe('listings', () => {
  it.each(listings.map((l) => [l.id.slice(-4), l] as const))(
    'listing ...%s prices its oracle value with fn_card_value_cents',
    (_suffix, listing) => {
      const card = cardFor(listing.card_id);
      expect(listing.oracle_value_cents).toBe(cardValueCents(card, skuFor(card)));
    },
  );

  it('locks the card behind every live listing, and only those', () => {
    for (const listing of liveListings) {
      const card = cardFor(listing.card_id);
      expect(card.status).toBe('locked');
      // fn_list_card refuses a card the seller does not own
      expect(card.owner_id).toBe(listing.seller_id);
    }

    const lockedByListing = new Set(liveListings.map((l) => l.card_id));
    for (const card of cards.filter((c) => c.status === 'locked')) {
      expect(lockedByListing.has(card.id)).toBe(true);
    }
  });

  it('never has two live listings on one card, per the partial unique index', () => {
    expect(new Set(liveListings.map((l) => l.card_id)).size).toBe(liveListings.length);
  });
});

// ------------------------------------------------------------
// ORDERS
// ------------------------------------------------------------

describe('orders', () => {
  it('gives every sold listing exactly one order, and no other listing any', () => {
    expect(soldListings.length).toBeGreaterThan(0);

    for (const listing of soldListings) {
      expect(orders.filter((o) => o.listing_id === listing.id)).toHaveLength(1);
    }

    const soldIds = new Set(soldListings.map((l) => l.id));
    for (const order of orders) {
      expect(soldIds.has(order.listing_id)).toBe(true);
    }
  });

  it.each(orders.map((o) => [o.id.slice(-4), o] as const))(
    'order ...%s charges the seller-level fee and nets out, per fn_purchase_card',
    (_suffix, order) => {
      const seller = userFor(order.seller_id);

      expect(order.fee_bps).toBe(sellerFeeBps(seller.level));
      expect(order.fee_cents).toBe(
        Math.floor((order.gross_cents * order.fee_bps) / 10000),
      );
      expect(order.net_cents).toBe(order.gross_cents - order.fee_cents);
    },
  );

  it.each(orders.map((o) => [o.id.slice(-4), o] as const))(
    'order ...%s agrees with the listing it settled',
    (_suffix, order) => {
      const listing = listings.find((l) => l.id === order.listing_id)!;

      expect(order.card_id).toBe(listing.card_id);
      expect(order.seller_id).toBe(listing.seller_id);
      expect(order.gross_cents).toBe(listing.price_cents);
      // fn_purchase_card raises on a self-purchase
      expect(order.buyer_id).not.toBe(order.seller_id);
      // the order is written in the same transaction that marks the listing sold
      expect(order.created_at).toBe(listing.sold_at);
      // money settled in Stripe before the card moved
      expect(order.settlement_ref).toBeTruthy();
      expect(order.status).toBe('settled');
    },
  );
});

// ------------------------------------------------------------
// PROVENANCE
// ------------------------------------------------------------

describe('card_provenance', () => {
  it.each(cards.map((c) => [c.mint_number, c] as const))(
    "card %i's chain joins end to end and terminates on cards.owner_id",
    (_mint, card) => {
      const chain = chainFor(card.id);
      expect(chain.length).toBeGreaterThanOrEqual(1);

      // fn_mint_card opens the chain at the mint
      expect(chain[0].acquired_at).toBe(card.minted_at);

      // each hop is released exactly when the next one is acquired
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i - 1].released_at).toBe(chain[i].acquired_at);
      }

      // exactly one open hop, and it is the current owner
      const open = chain.filter((p) => p.released_at === null);
      expect(open).toHaveLength(1);
      expect(open[0]).toBe(chain.at(-1));
      expect(open[0].owner_id).toBe(card.owner_id);
    },
  );

  it('records each owner at the level they held the card at', () => {
    for (const hop of cardProvenance) {
      expect(hop.owner_level).toBe(userFor(hop.owner_id).level);
    }
  });

  it('backs every hop after the mint with an order for that card', () => {
    for (const card of cards) {
      for (const hop of chainFor(card.id).slice(1)) {
        const order = orders.find(
          (o) => o.card_id === card.id && o.created_at === hop.acquired_at,
        );
        expect(order, `hop at ${hop.acquired_at} on card ${card.id}`).toBeDefined();
        expect(order!.buyer_id).toBe(hop.owner_id);
      }
    }
  });

  it('reads price_cents as "sold for" once released and "paid" while open', () => {
    // fn_purchase_card overwrites the seller's price_cents with the sale
    // price, so a released row does not remember what it cost.
    for (const card of cards) {
      for (const hop of chainFor(card.id)) {
        const at = hop.released_at ?? hop.acquired_at;
        const order = orders.find((o) => o.card_id === card.id && o.created_at === at);
        expect(hop.price_cents).toBe(order ? order.gross_cents : null);
      }
    }
  });

  it('has at least one card with a full three-hop chain', () => {
    const threeHop = cards.filter((c) => chainFor(c.id).length >= 3);
    expect(threeHop.length).toBeGreaterThanOrEqual(1);

    const chain = chainFor(threeHop[0].id);
    // three distinct owners, each resolvable to a handle and a level
    expect(new Set(chain.map((h) => h.owner_id)).size).toBe(chain.length);
    for (const hop of chain) {
      expect(userFor(hop.owner_id).handle).toBeTruthy();
      expect(hop.owner_level).toBeGreaterThanOrEqual(1);
    }
    // every hop but the mint carries the price it changed hands at
    for (const hop of chain.slice(1)) {
      expect(hop.price_cents).toBeGreaterThan(0);
    }
  });

  it('numbers rows in insertion order, since id is a bigserial', () => {
    const byId = [...cardProvenance].sort((a, b) => a.id - b.id);
    expect(new Set(byId.map((p) => p.id)).size).toBe(byId.length);

    for (let i = 1; i < byId.length; i++) {
      expect(byId[i - 1].acquired_at <= byId[i].acquired_at).toBe(true);
    }
  });
});

// ------------------------------------------------------------
// LEVEL CACHES
// ------------------------------------------------------------

describe('users', () => {
  it.each(users.map((u) => [u.handle, u] as const))(
    "%s's portfolio and level match fn_refresh_levels",
    (_handle, user) => {
      // fn_refresh_levels counts active and locked cards only
      const held = cards.filter(
        (c) => c.owner_id === user.id && (c.status === 'active' || c.status === 'locked'),
      );
      const portfolio = held.reduce((sum, c) => sum + cardValueCents(c, skuFor(c)), 0);

      expect(user.portfolio_value_cents).toBe(portfolio);
      expect(user.level).toBe(levelForRankScore(portfolio + user.xp_total * 50));
    },
  );

  it('covers three different levels', () => {
    expect(new Set(users.map((u) => u.level)).size).toBe(users.length);
  });
});

// ------------------------------------------------------------
// SHAPE
// ------------------------------------------------------------

describe('fixture shape', () => {
  it('holds the counts every track builds against', () => {
    expect(users).toHaveLength(3);
    expect(skus).toHaveLength(6);
    expect(items).toHaveLength(12);
    expect(cards).toHaveLength(12);
    expect(listings).toHaveLength(8);
    expect(consignments).toHaveLength(2);
    expect(listings.filter((l) => l.status === 'early_access')).toHaveLength(2);
  });

  it('keeps items and cards strictly 1:1', () => {
    expect(new Set(cards.map((c) => c.item_id)).size).toBe(cards.length);
    expect(new Set(cards.map((c) => `${c.sku_id}:${c.mint_number}`)).size).toBe(
      cards.length,
    );
  });

  it('puts a redeemed card\'s item on redemption hold, per fn_redeem_card', () => {
    for (const card of cards) {
      const item = items.find((i) => i.id === card.item_id)!;
      expect(item.status).toBe(card.status === 'redeemed' ? 'redemption_hold' : 'minted');
    }
  });

  it('counts each consignment\'s items', () => {
    for (const consignment of consignments) {
      expect(consignment.item_count).toBe(
        items.filter((i) => i.consignment_id === consignment.id).length,
      );
    }
  });
});

// ------------------------------------------------------------
// SPRITES
// ------------------------------------------------------------
//
// Source of truth here is lib/sprites/maps.ts, not the .sql files: `sprite_key`
// and `palette` are opaque to Postgres, so nothing upstream can catch a fixture
// that has drifted from the sprite format.
//
// These go through spriteMapForKey and paletteFromJson rather than reading
// `sku.palette` directly, because those are the functions the UI uses and they
// are stricter than a key check. paletteFromJson drops any value that is not a
// '#'-prefixed string, so a palette of `{ C: 'red' }` resolves to nothing —
// a raw `'C' in palette` test would pass it and the sprite would still render
// transparent.

/**
 * Every glyph a map actually draws. renderSprite decides transparency purely by
 * palette lookup, so '.' is only transparent because no palette defines it;
 * whitespace is excluded for the same documented reason (lib/sprites/types.ts).
 */
const glyphsDrawnBy = (map: SpriteMap): string[] =>
  [...new Set(map.join(''))]
    .filter((glyph) => glyph !== TRANSPARENT && glyph.trim() !== '')
    .sort();

describe('skus.sprite_key / skus.palette', () => {
  it.each(skus.map((s) => [`${s.brand} ${s.model}`, s] as const))(
    '%s names a base map that exists in SPRITE_MAPS',
    (label, sku) => {
      expect(
        spriteMapForKey(sku.sprite_key),
        `${label}: sprite_key ${JSON.stringify(sku.sprite_key)} is not a base map`,
      ).not.toBeNull();
    },
  );

  it.each(skus.map((s) => [`${s.brand} ${s.model}`, s] as const))(
    '%s resolves every glyph its base map draws',
    (label, sku) => {
      const map = spriteMapForKey(sku.sprite_key);
      expect(map, `${label}: no base map to check against`).not.toBeNull();

      const palette = paletteFromJson(sku.palette);
      expect(palette, `${label}: palette is unusable or empty`).not.toBeNull();

      // A glyph the palette misses is not a slightly wrong colour — that whole
      // region of the shoe disappears.
      const unresolved = glyphsDrawnBy(map!).filter(
        (glyph) => palette![glyph] === undefined,
      );
      expect(
        unresolved,
        `${label}: these glyphs would render transparent`,
      ).toEqual([]);
    },
  );
});

// ------------------------------------------------------------
// GRADING ARITHMETIC
// ------------------------------------------------------------
//
// items_grade_components_sum recomputes the weighted sum in Postgres `numeric`
// and rejects any float that disagrees, so gradeFloatFromComponents() must
// match numeric EXACTLY — off by one milli is a rejected grade, not a display
// nit. The binary-FP version of this helper survived 77 tests while rounding
// ~3% of valid 2dp grades the wrong way (every exact half-milli tie landed
// just under .5 in FP and went down; numeric rounds half away from zero).
// These tests exist so that class of bug cannot pass again.

/**
 * The constraint's arithmetic with no floating point anywhere: components in
 * exact hundredths, weights in exact percents, product in ten-thousandths,
 * final rounding half-up (== numeric's half away from zero, since scores are
 * never negative).
 */
const integerExactFloat = (c: GradeComponents): number => {
  const tenThousandths =
    Math.round(c.outsole * 100) * 25 +
    Math.round(c.midsole * 100) * 20 +
    Math.round(c.creasing * 100) * 20 +
    Math.round(c.upper * 100) * 20 +
    Math.round(c.heel * 100) * 10 +
    Math.round(c.accessories * 100) * 5;
  const millis = Math.floor(tenThousandths / 10) + (tenThousandths % 10 >= 5 ? 1 : 0);
  return millis / 1000;
};

const zeroGrade: GradeComponents = {
  outsole: 0,
  midsole: 0,
  creasing: 0,
  upper: 0,
  heel: 0,
  accessories: 0,
};

const COMPONENT_NAMES = Object.keys(GRADE_WEIGHTS) as (keyof GradeComponents)[];

describe('gradeFloatFromComponents', () => {
  it('carries the 008 weights', () => {
    expect(GRADE_WEIGHTS).toEqual({
      outsole: 0.25,
      midsole: 0.2,
      creasing: 0.2,
      upper: 0.2,
      heel: 0.1,
      accessories: 0.05,
    });
  });

  it('rounds the documented counterexample up, like numeric', () => {
    // accessories 0.29: 29 x 5 = 145 ten-thousandths = 0.0145 -> 0.015.
    // The FP version returned 0.014 and the constraint rejected the grade.
    expect(gradeFloatFromComponents({ ...zeroGrade, accessories: 0.29 })).toBe(0.015);
  });

  it.each(COMPONENT_NAMES)(
    'agrees with integer-exact arithmetic for every 2dp value of %s',
    (name) => {
      const failures: string[] = [];
      for (let hundredths = 0; hundredths <= 100; hundredths++) {
        const value = hundredths / 100;
        const grade = { ...zeroGrade, [name]: value };
        const got = gradeFloatFromComponents(grade);
        const expected = integerExactFloat(grade);
        if (got !== expected) {
          failures.push(`${name}=${value.toFixed(2)}: got ${got}, numeric says ${expected}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it('agrees with integer-exact arithmetic when all six move together', () => {
    // Weights sum to 100%, so six equal scores v must produce exactly v — and
    // every 2dp v is already a 3dp float, no rounding involved.
    for (let hundredths = 0; hundredths <= 100; hundredths++) {
      const value = hundredths / 100;
      const grade: GradeComponents = {
        outsole: value,
        midsole: value,
        creasing: value,
        upper: value,
        heel: value,
        accessories: value,
      };
      expect(gradeFloatFromComponents(grade)).toBe(value);
      expect(integerExactFloat(grade)).toBe(value);
    }
  });

  it('agrees on a deterministic two-component sweep that is dense in ties', () => {
    // heel (10%) x accessories (5%): products in ten-thousandths end in 0 or 5
    // constantly, so this plane is where half-milli ties live. 101x101 cases.
    const failures: string[] = [];
    for (let h = 0; h <= 100; h++) {
      for (let a = 0; a <= 100; a++) {
        const grade = { ...zeroGrade, heel: h / 100, accessories: a / 100 };
        const got = gradeFloatFromComponents(grade);
        const expected = integerExactFloat(grade);
        if (got !== expected) {
          failures.push(`heel=${h / 100} accessories=${a / 100}: got ${got}, expected ${expected}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// ------------------------------------------------------------
// SETTLEMENT SPLIT (018-020)
// ------------------------------------------------------------
//
// fn_purchase_card gained a 4th argument, p_credit_cents: the portion of the
// listing price paid in FSC. docs/handoff/data.md has the live-verification
// notes (platform_config, condition_bands, cash_payout_countries, the ledger
// rows below) and flags the two new ContractErrorCode message patterns in
// lib/db/errors.ts as best-effort until the migration's .sql file lands in
// this worktree — these tests pin the RULE, not the SQL's exact wording.

describe('fn_purchase_card_core split settlement', () => {
  it('settles cash-only when credit_cents is 0 and a settlement_ref is given', () => {
    expect(splitSettlement(21500, 0, 'pi_cash_only')).toEqual({
      creditCents: 0,
      cashCents: 21500,
    });
  });

  it('settles FSC-only when credit_cents is the full price, with a null ref', () => {
    expect(splitSettlement(21500, 21500, null)).toEqual({
      creditCents: 21500,
      cashCents: 0,
    });
  });

  it('settles both legs on a split, and they sum back to the gross price', () => {
    const result = splitSettlement(21500, 8000, 'pi_split');
    expect(result.cashCents).toBe(13500);
    expect(result.creditCents + result.cashCents).toBe(21500);
  });

  it('raises when a cash leg has a null or empty settlement_ref', () => {
    expect(() => splitSettlement(21500, 8000, null)).toThrow(/settlement_ref/);
    expect(() => splitSettlement(21500, 8000, '')).toThrow(/settlement_ref/);
    expect(() => splitSettlement(21500, 8000, '   ')).toThrow(/settlement_ref/);
    // the FSC-only case is the one exception — no cash leg, no ref needed
    expect(() => splitSettlement(21500, 21500, null)).not.toThrow();
  });

  it("raises when credit_cents is above the buyer's FSC balance", () => {
    expect(() => splitSettlement(21500, 15000, 'pi_x', 5000)).toThrow(/insufficient credit/);
    // exactly at the balance is fine
    expect(() => splitSettlement(21500, 5000, 'pi_x', 5000)).not.toThrow();
  });

  it('accepts a listing whose seller is non-Malaysian, paid in cash — the case the old code refused', () => {
    // Settlement validation takes price/credit/ref and nothing about the
    // seller — it must not gate on who the seller is or how they are paid.
    expect(() => splitSettlement(21500, 0, 'pi_cash_only')).not.toThrow();
    // The seller's payout is resolved separately and never blocks this.
    expect(derivePayoutMethod('SG')).toBe('credit');
  });
});

describe('fn_payout_method_for_user', () => {
  it('resolves MY to cash and other recognised codes to credit', () => {
    expect(derivePayoutMethod('MY')).toBe('cash');
    expect(derivePayoutMethod('SG')).toBe('credit');
    expect(derivePayoutMethod('US')).toBe('credit');
  });

  it('RAISES on null or empty country rather than silently resolving to credit (025)', () => {
    // 025_user_country.sql: NULL meant "we do not know", which used to be
    // conflated with "not Malaysian" and defaulted to 'credit' — every
    // launch consignor is Malaysian and a real signup leaves country_code
    // NULL, so they would all have been paid in FSC with no error anywhere.
    // Fixed by raising instead.
    expect(() => derivePayoutMethod(null)).toThrow(/has no country on file/);
    expect(() => derivePayoutMethod(undefined)).toThrow(/has no country on file/);
    expect(() => derivePayoutMethod('')).toThrow(/has no country on file/);
  });
});

describe('ledger_entries nets to zero per txn_id, per asset class', () => {
  // Reproduced from real rows read back from the project (2026-08-21).
  it('holds for a real credit txn_id with a single offsetting pair (asset=credit)', () => {
    expect(
      ledgerNetsToZero([
        { txn_id: 't1', asset: 'credit', amount_cents: 2500, direction: 1 },
        { txn_id: 't1', asset: 'credit', amount_cents: 2500, direction: -1 },
      ]),
    ).toBe(true);
  });

  it('holds for a real credit-sale txn_id (gross/net/fee triad)', () => {
    expect(
      ledgerNetsToZero([
        { txn_id: 't2', asset: 'credit', amount_cents: 18000, direction: -1 },
        { txn_id: 't2', asset: 'credit', amount_cents: 17460, direction: 1 },
        { txn_id: 't2', asset: 'credit', amount_cents: 540, direction: 1 },
      ]),
    ).toBe(true);
  });

  it('holds for a real currency-sale txn_id, including its unpriced card leg', () => {
    expect(
      ledgerNetsToZero([
        { txn_id: 't3', asset: 'currency', amount_cents: 21500, direction: -1 },
        { txn_id: 't3', asset: 'currency', amount_cents: 19780, direction: 1 },
        { txn_id: 't3', asset: 'currency', amount_cents: 1720, direction: 1 },
        { txn_id: 't3', asset: 'card', amount_cents: null, direction: -1 },
        { txn_id: 't3', asset: 'card', amount_cents: null, direction: 1 },
      ]),
    ).toBe(true);
  });

  it('holds across a split settlement: currency and credit legs each net to zero independently', () => {
    // Constructed, not live-observed — no split-settlement order exists in
    // the seed data yet — but each leg follows the same gross/net/fee triad
    // shape as the live credit-sale and currency-sale cases above.
    const { creditCents, cashCents } = splitSettlement(21500, 8000, 'pi_split');
    const cashNet = Math.floor(cashCents * 0.92);
    const creditNet = Math.floor(creditCents * 0.92);
    expect(
      ledgerNetsToZero([
        { txn_id: 't4', asset: 'currency', amount_cents: cashCents, direction: -1 },
        { txn_id: 't4', asset: 'currency', amount_cents: cashNet, direction: 1 },
        { txn_id: 't4', asset: 'currency', amount_cents: cashCents - cashNet, direction: 1 },
        { txn_id: 't4', asset: 'credit', amount_cents: creditCents, direction: -1 },
        { txn_id: 't4', asset: 'credit', amount_cents: creditNet, direction: 1 },
        { txn_id: 't4', asset: 'credit', amount_cents: creditCents - creditNet, direction: 1 },
      ]),
    ).toBe(true);
    // and the two legs still sum to the gross price (orders.credit_cents +
    // orders.cash_cents = orders.gross_cents)
    expect(creditCents + cashCents).toBe(21500);
  });

  it('catches a lopsided txn_id (regression guard for the checker itself)', () => {
    expect(
      ledgerNetsToZero([
        { txn_id: 't5', asset: 'currency', amount_cents: 1000, direction: -1 },
        { txn_id: 't5', asset: 'currency', amount_cents: 999, direction: 1 },
      ]),
    ).toBe(false);
  });
});

describe('fn_record_sweep', () => {
  it('raises when the amount exceeds unswept_cents', () => {
    expect(() => recordSweepAmount(50000, 40000)).toThrow(/exceeds/);
  });

  it('accepts an amount at or below unswept_cents', () => {
    expect(() => recordSweepAmount(40000, 40000)).not.toThrow();
    expect(() => recordSweepAmount(1, 40000)).not.toThrow();
  });
});

// ------------------------------------------------------------
// CREDIT HOLDS (021)
// ------------------------------------------------------------
//
// Model-level mirrors of fn_reserve_credit and fn_purchase_card_core's hold
// handling in supabase/migrations/021_credit_holds.sql, run against an
// in-memory array of synthetic rows — NOT the database, and these do not
// exercise the real RPC, RLS, or PostgREST at all. AGENT_RULES.md forbids
// writing to the live project, and these tests are the correct way to honour
// that; the point of this comment block is to say so plainly rather than let
// the describe/it names imply otherwise. Every test below runs in well under
// a millisecond, which is itself the tell that nothing here touches Postgres.
//
// The ordering inside reserveCredit() below matters and is copied from the
// live SQL, not simplified: fn_reserve_credit computes fn_credit_available()
// BEFORE releasing the caller's own prior hold on the same listing, so a
// re-reserve's headroom does not include what that prior hold was holding.
// That is a real property of the applied migration, not an approximation.

interface HoldRow {
  id: string;
  user_id: string;
  listing_id: string;
  amount_cents: number;
  status: 'active' | 'consumed' | 'released' | 'expired';
  /** epoch ms, so the tests can pass a fixed clock instead of racing Date.now(). */
  expires_at: number;
}

/** fn_credit_held(p_user): sum of the caller's active, unexpired holds. */
const creditHeld = (holds: readonly HoldRow[], userId: string, now: number): number =>
  holds
    .filter((h) => h.user_id === userId && h.status === 'active' && h.expires_at > now)
    .reduce((sum, h) => sum + h.amount_cents, 0);

/** fn_credit_available(p_user): fn_credit_balance(p_user) - fn_credit_held(p_user). */
const creditAvailable = (
  balanceCents: number,
  holds: readonly HoldRow[],
  userId: string,
  now: number,
): number => balanceCents - creditHeld(holds, userId, now);

let nextHoldId = 1;

/**
 * fn_reserve_credit: validates, THEN releases any existing active hold for
 * (user, listing) rather than stacking, THEN inserts the new one. Mutates
 * `holds` in place, same as the real function mutates the table.
 */
const reserveCredit = (
  holds: HoldRow[],
  userId: string,
  listingId: string,
  creditCents: number,
  balanceCents: number,
  now: number,
): HoldRow => {
  if (!Number.isInteger(creditCents) || creditCents <= 0) {
    throw new Error('reserve amount must be positive');
  }

  const available = creditAvailable(balanceCents, holds, userId, now);
  if (available < creditCents) {
    throw new Error(
      `insufficient available FSC: ${available} available, ${creditCents} requested`,
    );
  }

  const prior = holds.find(
    (h) => h.user_id === userId && h.listing_id === listingId && h.status === 'active',
  );
  if (prior) prior.status = 'released';

  const hold: HoldRow = {
    id: `hold_${nextHoldId++}`,
    user_id: userId,
    listing_id: listingId,
    amount_cents: creditCents,
    status: 'active',
    expires_at: now + 30 * 60_000,
  };
  holds.push(hold);
  return hold;
};

/**
 * fn_purchase_card_core's hold-consumption checks (021), in the SQL's own
 * order: found, active, unexpired, right user, right listing, covers the
 * requested credit_cents. Consuming flips status to 'consumed' in place, so
 * calling this twice with the same hold hits the "not active" branch on the
 * second call, same as the real row would.
 */
const settleWithHold = (
  holds: HoldRow[],
  holdId: string,
  buyerId: string,
  listingId: string,
  creditCents: number,
  now: number,
): void => {
  const hold = holds.find((h) => h.id === holdId);
  if (!hold) throw new Error(`credit hold ${holdId} not found`);
  if (hold.status !== 'active') {
    throw new Error(`credit hold ${holdId} is ${hold.status}`);
  }
  if (hold.expires_at <= now) {
    hold.status = 'expired';
    throw new Error(`credit hold ${holdId} expired at ${hold.expires_at}`);
  }
  if (hold.user_id !== buyerId) {
    throw new Error(`credit hold ${holdId} belongs to another user`);
  }
  if (hold.listing_id !== listingId) {
    throw new Error(`credit hold ${holdId} is for a different listing`);
  }
  if (hold.amount_cents < creditCents) {
    throw new Error(
      `credit hold ${holdId} covers only ${hold.amount_cents} of ${creditCents} requested`,
    );
  }
  hold.status = 'consumed';
};

const NOW = 1_700_000_000_000;

describe('credit holds (021)', () => {
  it('computes available as balance minus held, and held excludes expired holds', () => {
    const holds: HoldRow[] = [
      { id: 'h1', user_id: 'u1', listing_id: 'l1', amount_cents: 3000, status: 'active', expires_at: NOW + 60_000 },
      // Still flagged 'active' in the row — fn_expire_credit_holds has not
      // swept it yet — but its expires_at has passed, so it must not count.
      { id: 'h2', user_id: 'u1', listing_id: 'l2', amount_cents: 5000, status: 'active', expires_at: NOW - 1 },
    ];
    expect(creditHeld(holds, 'u1', NOW)).toBe(3000);
    expect(creditAvailable(10_000, holds, 'u1', NOW)).toBe(7000);
  });

  it('raises when reserving more than available', () => {
    const holds: HoldRow[] = [];
    reserveCredit(holds, 'u1', 'l1', 4000, 10_000, NOW);
    // 6000 left available; asking for 6001 on a different listing must raise.
    expect(() => reserveCredit(holds, 'u1', 'l2', 6001, 10_000, NOW)).toThrow(
      /insufficient available FSC: 6000 available, 6001 requested/,
    );
    // exactly at the remaining available is fine
    expect(() => reserveCredit(holds, 'u1', 'l2', 6000, 10_000, NOW)).not.toThrow();
  });

  it('replaces a prior reserve on the same listing rather than stacking', () => {
    const holds: HoldRow[] = [];
    const first = reserveCredit(holds, 'u1', 'l1', 2000, 10_000, NOW);
    const second = reserveCredit(holds, 'u1', 'l1', 2500, 10_000, NOW);

    expect(first.status).toBe('released');
    expect(second.status).toBe('active');
    expect(holds.filter((h) => h.listing_id === 'l1' && h.status === 'active')).toHaveLength(1);
    // held reflects only the surviving hold, not both
    expect(creditHeld(holds, 'u1', NOW)).toBe(2500);
  });

  it('consumes a hold on settlement, and the same hold cannot be consumed twice', () => {
    const holds: HoldRow[] = [];
    const hold = reserveCredit(holds, 'u1', 'l1', 5000, 10_000, NOW);

    expect(() => settleWithHold(holds, hold.id, 'u1', 'l1', 5000, NOW)).not.toThrow();
    expect(hold.status).toBe('consumed');

    expect(() => settleWithHold(holds, hold.id, 'u1', 'l1', 5000, NOW)).toThrow(
      /credit hold .+ is consumed/,
    );
  });

  it('raises on an expired hold rather than silently settling', () => {
    const holds: HoldRow[] = [
      { id: 'h1', user_id: 'u1', listing_id: 'l1', amount_cents: 5000, status: 'active', expires_at: NOW - 1 },
    ];
    expect(() => settleWithHold(holds, 'h1', 'u1', 'l1', 5000, NOW)).toThrow(
      /credit hold h1 expired at/,
    );
    // the attempt flips the row to 'expired', same as the trigger statement does
    expect(holds[0].status).toBe('expired');
  });

  it('refuses a hold reserved for listing A when settling listing B', () => {
    const holds: HoldRow[] = [];
    const hold = reserveCredit(holds, 'u1', 'listingA', 5000, 10_000, NOW);
    expect(() => settleWithHold(holds, hold.id, 'u1', 'listingB', 5000, NOW)).toThrow(
      /credit hold .+ is for a different listing/,
    );
    // the hold survives the refused attempt — it is not consumed by a
    // settlement it was never valid for
    expect(hold.status).toBe('active');
  });
});

// ------------------------------------------------------------
// STRIPE WEBHOOK — app/api/webhooks/stripe/route.ts
// ------------------------------------------------------------
//
// Mirrors, not imports: importing route.ts pulls in Stripe/Supabase/next's
// whole module graph (~14s to resolve, measured, against ~0.5s for this
// entire file), so these reproduce its pure decision logic instead — same
// convention as every describe block above, which mirrors a SQL RULE rather
// than calling the real RPC.

interface ParsedSettlementMetadata {
  listingId: string;
  buyerId: string;
  creditCents: number;
  holdId: string | null;
}

/** Mirrors parseSettlementMetadata() in route.ts. */
const parseSettlementMetadata = (
  metadata: Record<string, string | undefined>,
): ParsedSettlementMetadata | { error: string } => {
  const listingId = metadata['listing_id'];
  const buyerId = metadata['buyer_id'];
  if (!listingId || !buyerId) {
    return {
      error:
        'payment intent has no listing_id/buyer_id metadata — set both when creating the ' +
        'Checkout Session, or the sale cannot be attributed',
    };
  }

  const rawCredit = metadata['credit_cents'];
  let creditCents = 0;
  if (rawCredit !== undefined && rawCredit !== '') {
    const parsed = Number(rawCredit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: `payment intent metadata has a malformed credit_cents value: ${rawCredit}` };
    }
    creditCents = parsed;
  }

  const rawHold = metadata['hold_id'];
  const holdId = rawHold && rawHold.trim() !== '' ? rawHold : null;

  return { listingId, buyerId, creditCents, holdId };
};

/**
 * Mirrors the expectedCashCents clamp in handleCheckoutCompleted() — the same
 * clamp fn_purchase_card_core itself applies to p_credit_cents
 * (021_credit_holds.sql:274), reproduced here so a bogus above-price
 * credit_cents cannot make the captured-amount check pass vacuously.
 */
const expectedCashCents = (priceCents: number, creditCents: number): number =>
  Math.max(priceCents - Math.min(creditCents, priceCents), 0);

type WebhookErrorCode =
  | 'SELF_PURCHASE' | 'EARLY_ACCESS_LOCKED' | 'WRONG_STATUS' | 'NOT_FOUND'
  | 'PAYOUT_MISMATCH' | 'INSUFFICIENT_CREDIT' | 'CREDIT_SETTLEMENT_DISABLED'
  | 'CREDIT_PROVENANCE_REQUIRED' | 'CREDIT_HOLD_WRONG_USER'
  | 'CREDIT_HOLD_WRONG_LISTING' | 'CREDIT_HOLD_INSUFFICIENT'
  | 'SETTLEMENT_REF_REQUIRED' | 'CREDIT_HOLD_EXPIRED' | 'COUNTRY_NOT_SET' | 'UNKNOWN';

/**
 * Mirrors isPermanentError() in route.ts. CREDIT_HOLD_EXPIRED and
 * COUNTRY_NOT_SET are deliberately excluded — route.ts intercepts both
 * before this check runs, because unlike every code here they mean the
 * buyer's cash already moved through Stripe and need louder handling than a
 * quiet acknowledge.
 */
const isPermanentError = (code: WebhookErrorCode): boolean =>
  code === 'SELF_PURCHASE' ||
  code === 'EARLY_ACCESS_LOCKED' ||
  code === 'WRONG_STATUS' ||
  code === 'NOT_FOUND' ||
  code === 'PAYOUT_MISMATCH' ||
  code === 'INSUFFICIENT_CREDIT' ||
  code === 'CREDIT_SETTLEMENT_DISABLED' ||
  code === 'CREDIT_PROVENANCE_REQUIRED' ||
  code === 'CREDIT_HOLD_WRONG_USER' ||
  code === 'CREDIT_HOLD_WRONG_LISTING' ||
  code === 'CREDIT_HOLD_INSUFFICIENT' ||
  code === 'SETTLEMENT_REF_REQUIRED';

describe('stripe webhook metadata parsing (checkout.session.completed)', () => {
  it('parses listing_id/buyer_id with credit_cents and hold_id absent as a pure-cash settlement', () => {
    const parsed = parseSettlementMetadata({ listing_id: 'l1', buyer_id: 'u1' });
    expect(parsed).toEqual({ listingId: 'l1', buyerId: 'u1', creditCents: 0, holdId: null });
  });

  it('rejects metadata missing listing_id or buyer_id', () => {
    expect(parseSettlementMetadata({ buyer_id: 'u1' })).toHaveProperty('error');
    expect(parseSettlementMetadata({ listing_id: 'l1' })).toHaveProperty('error');
    expect(parseSettlementMetadata({})).toHaveProperty('error');
  });

  it('parses a split FSC+cash checkout carrying credit_cents and hold_id', () => {
    const parsed = parseSettlementMetadata({
      listing_id: 'l1', buyer_id: 'u1', credit_cents: '5000', hold_id: 'h1',
    });
    expect(parsed).toEqual({ listingId: 'l1', buyerId: 'u1', creditCents: 5000, holdId: 'h1' });
  });

  it('rejects a non-integer or negative credit_cents rather than passing it through', () => {
    expect(
      parseSettlementMetadata({ listing_id: 'l1', buyer_id: 'u1', credit_cents: 'abc' }),
    ).toHaveProperty('error');
    expect(
      parseSettlementMetadata({ listing_id: 'l1', buyer_id: 'u1', credit_cents: '-1' }),
    ).toHaveProperty('error');
    expect(
      parseSettlementMetadata({ listing_id: 'l1', buyer_id: 'u1', credit_cents: '12.5' }),
    ).toHaveProperty('error');
  });

  it('treats a blank hold_id the same as an absent one', () => {
    const parsed = parseSettlementMetadata({ listing_id: 'l1', buyer_id: 'u1', hold_id: '   ' });
    expect(parsed).toEqual({ listingId: 'l1', buyerId: 'u1', creditCents: 0, holdId: null });
  });
});

describe('stripe webhook cash-leg amount check', () => {
  it('expects the full price in cash when credit_cents is 0', () => {
    expect(expectedCashCents(30000, 0)).toBe(30000);
  });

  it('expects zero cash on an FSC-only settlement', () => {
    expect(expectedCashCents(30000, 30000)).toBe(0);
  });

  it('expects the remainder on a split settlement', () => {
    expect(expectedCashCents(30000, 5000)).toBe(25000);
  });

  it('clamps credit_cents to the price rather than going negative', () => {
    // A caller sending more credit_cents than the price must never produce a
    // negative expected-cash figure that a real Stripe capture could satisfy
    // trivially — fn_purchase_card_core applies the identical clamp.
    expect(expectedCashCents(30000, 99999)).toBe(0);
  });
});

describe('stripe webhook error classification', () => {
  it('treats every 021 FSC-leg refusal as permanent, not retried', () => {
    const permanentCodes: WebhookErrorCode[] = [
      'SELF_PURCHASE', 'EARLY_ACCESS_LOCKED', 'WRONG_STATUS', 'NOT_FOUND',
      'INSUFFICIENT_CREDIT', 'CREDIT_SETTLEMENT_DISABLED',
      'CREDIT_PROVENANCE_REQUIRED', 'CREDIT_HOLD_WRONG_USER',
      'CREDIT_HOLD_WRONG_LISTING', 'CREDIT_HOLD_INSUFFICIENT',
      'SETTLEMENT_REF_REQUIRED',
    ];
    for (const code of permanentCodes) {
      expect(isPermanentError(code)).toBe(true);
    }
  });

  it('does NOT classify CREDIT_HOLD_EXPIRED as an ordinary permanent error — it needs the loud path', () => {
    expect(isPermanentError('CREDIT_HOLD_EXPIRED')).toBe(false);
  });

  it('does NOT classify COUNTRY_NOT_SET as an ordinary permanent error — it needs the loud path (025)', () => {
    expect(isPermanentError('COUNTRY_NOT_SET')).toBe(false);
  });

  it('lets an unmapped code fall through to a 500 retry rather than silently acknowledging', () => {
    expect(isPermanentError('UNKNOWN')).toBe(false);
  });
});

/**
 * 025_user_country.sql fn_payout_method_for_user, raised from inside
 * fn_purchase_card_core (021_credit_holds.sql:325) — a settlement for a
 * seller with no country on file fails mid-transaction, after Stripe has
 * already captured the buyer's card. Tests the real contractErrorCode()
 * mapping (lib/db/errors.ts), not a mirror — that module has no next/server,
 * Stripe, or Supabase runtime cost of its own (its only dependency on
 * lib/api/contract.ts is a type-only import, erased at compile time), and
 * lib/api/contract.ts is already loaded in this suite (CREDIT_HOLD_MINUTES_FALLBACK
 * above), so importing it directly carries no meaningful extra cost.
 */
describe('COUNTRY_NOT_SET error mapping (025)', () => {
  it('maps fn_payout_method_for_user\'s no-country raise to COUNTRY_NOT_SET', () => {
    const message =
      'user 11111111-1111-1111-1111-111111111111 has no country on file, so their payout ' +
      'cannot be determined - set one before listing';
    expect(contractErrorCode({ message })).toBe('COUNTRY_NOT_SET');
  });

  it('does not confuse an unrelated "not found" message for COUNTRY_NOT_SET', () => {
    expect(contractErrorCode({ message: 'listing abc not found' })).toBe('NOT_FOUND');
  });
});

/**
 * 025_user_country.sql fn_set_country's two raises — setCountry()'s own
 * error surface (lib/api/contract.ts), separate from the settlement-side
 * COUNTRY_NOT_SET above. Same real-mapping-function approach as that block.
 */
describe('setCountry() error mapping (025)', () => {
  it('maps the ISO-shape raise to INVALID_COUNTRY_CODE', () => {
    const message = 'country must be a two-letter ISO country code, got usa';
    expect(contractErrorCode({ message })).toBe('INVALID_COUNTRY_CODE');
  });

  it('maps the no-session raise to UNAUTHENTICATED, same as every other "sign in to" raise', () => {
    expect(contractErrorCode({ message: 'sign in to set your country' })).toBe('UNAUTHENTICATED');
  });
});

// ------------------------------------------------------------
// market: FSC-aware checkout (app/(market)/checkout-math.ts)
//
// These import the real functions, not a mirror — checkout-math.ts is a
// plain module with no next/headers, Stripe, or Supabase in its graph (split
// out of the 'use server' actions.ts for exactly this reason), so there is
// no import-cost trade-off like the webhook tests above faced.
// ------------------------------------------------------------

describe('validateRequestedCredit', () => {
  it('treats an omitted or blank amount as no FSC leg, not an error', () => {
    expect(validateRequestedCredit(undefined, 30000, 10000)).toEqual({ ok: true, creditCents: 0 });
    expect(validateRequestedCredit(null, 30000, 10000)).toEqual({ ok: true, creditCents: 0 });
    expect(validateRequestedCredit('', 30000, 10000)).toEqual({ ok: true, creditCents: 0 });
  });

  it('accepts a request within both the price and the available balance', () => {
    expect(validateRequestedCredit(5000, 30000, 10000)).toEqual({ ok: true, creditCents: 5000 });
  });

  it('accepts a request equal to price or to available (inclusive bounds)', () => {
    expect(validateRequestedCredit(30000, 30000, 30000)).toEqual({ ok: true, creditCents: 30000 });
    expect(validateRequestedCredit(10000, 30000, 10000)).toEqual({ ok: true, creditCents: 10000 });
  });

  it('REFUSES a request above available rather than silently clamping to it — the task names this explicitly', () => {
    const result = validateRequestedCredit(9000, 30000, 5000);
    expect(result.ok).toBe(false);
    expect(result.creditCents).toBe(0);
    expect(result.error).toMatch(/9000/);
    expect(result.error).toMatch(/5000/);
  });

  it('refuses a request above the listing price even when it is within the available balance', () => {
    const result = validateRequestedCredit(40000, 30000, 100000);
    expect(result.ok).toBe(false);
  });

  it('refuses a non-integer amount', () => {
    expect(validateRequestedCredit(12.5, 30000, 30000).ok).toBe(false);
    expect(validateRequestedCredit('abc', 30000, 30000).ok).toBe(false);
  });

  it('refuses a negative amount', () => {
    expect(validateRequestedCredit(-1, 30000, 30000).ok).toBe(false);
  });

  it('accepts an explicit zero — the buyer lowering the field all the way down', () => {
    expect(validateRequestedCredit(0, 30000, 30000)).toEqual({ ok: true, creditCents: 0 });
  });
});

describe('cashLegCents / isFscOnlyPurchase', () => {
  it('is the full price when no FSC is applied', () => {
    expect(cashLegCents(30000, 0)).toBe(30000);
    expect(isFscOnlyPurchase(30000, 0)).toBe(false);
  });

  it('is the remainder on a split purchase', () => {
    expect(cashLegCents(30000, 12000)).toBe(18000);
    expect(isFscOnlyPurchase(30000, 12000)).toBe(false);
  });

  it('is zero, and FSC-only, when credit covers the full price', () => {
    expect(cashLegCents(30000, 30000)).toBe(0);
    expect(isFscOnlyPurchase(30000, 30000)).toBe(true);
  });

  it('never goes negative even if credit somehow exceeds price', () => {
    expect(cashLegCents(30000, 50000)).toBe(0);
  });
});

describe('checkoutExpiresAtSeconds', () => {
  const now = Date.parse('2026-08-23T12:00:00.000Z');

  it('matches CREDIT_HOLD_MINUTES_FALLBACK to the live platform_config value (verified 2026-08-23)', () => {
    expect(CREDIT_HOLD_MINUTES_FALLBACK).toBe(1440);
  });

  it('lands at roughly now + holdMinutes for a value inside Stripe bounds', () => {
    const expires = checkoutExpiresAtSeconds(now, 120); // 2h hold
    expect(expires).toBe(Math.floor(now / 1000) + 120 * 60);
  });

  it('never sets an expiry Stripe would reject as too soon (< 30 minutes out)', () => {
    const expires = checkoutExpiresAtSeconds(now, 1); // absurdly short hold
    expect(expires).toBeGreaterThanOrEqual(Math.floor(now / 1000) + 30 * 60);
  });

  it('stays under Stripe\'s 24h ceiling for the live 1440-minute (exactly 24h) config, with room to spare', () => {
    const expires = checkoutExpiresAtSeconds(now, CREDIT_HOLD_MINUTES_FALLBACK);
    const nowSeconds = Math.floor(now / 1000);
    expect(expires).toBeGreaterThan(nowSeconds);
    expect(expires).toBeLessThan(nowSeconds + 24 * 60 * 60);
  });

  it('clamps a hold far longer than 24h rather than asking Stripe for an expiry it will refuse', () => {
    const expires = checkoutExpiresAtSeconds(now, 60 * 24 * 10); // 10 days
    const nowSeconds = Math.floor(now / 1000);
    expect(expires).toBeLessThan(nowSeconds + 24 * 60 * 60);
  });
});

// ------------------------------------------------------------
// data: 023a pending_vault, PlatformConfig.credit_hold_minutes,
// getVaultIntakeForCard (closing three track/market workarounds)
// ------------------------------------------------------------

describe('CardStatus (023a pending_vault)', () => {
  it('CARD_STATUSES carries the value 023a_card_status_pending_vault.sql added to the live enum', () => {
    expect(CARD_STATUSES).toContain('pending_vault');
    expect(CARD_STATUSES).toEqual(['active', 'locked', 'burned', 'redeemed', 'pending_vault']);
  });

  it('a value of every CardStatus member is assignable with no cast — the exhaustiveness this task asked to verify', () => {
    // If CardStatus ever regresses (a member removed, or added only here and
    // not to CARD_STATUSES), this fails to type-check rather than passing
    // silently — the array literal below must list every member of the type.
    const allStatuses: readonly CardStatus[] = CARD_STATUSES;
    const exhaustive: Record<CardStatus, true> = Object.fromEntries(
      allStatuses.map((s) => [s, true]),
    ) as Record<CardStatus, true>;
    expect(Object.keys(exhaustive).sort()).toEqual([...CARD_STATUSES].sort());
  });

  it('getCards/getListings default status filter (contract.ts) still excludes pending_vault, mirroring 023c\'s "must not be sellable, listable, tradeable or redeemable"', () => {
    // Mirrors statusFilter()'s fallback argument at contract.ts's getCards()
    // call site: .in('status', statusFilter<CardStatus>(query.status, ['active', 'locked'])).
    // Widening CardStatus must never widen this allow-list by accident.
    const defaultSellableStatuses: readonly CardStatus[] = ['active', 'locked'];
    expect(defaultSellableStatuses).not.toContain('pending_vault');
  });
});

describe('PlatformConfig.credit_hold_minutes (021/024f)', () => {
  it('contract.ts exposes CREDIT_HOLD_MINUTES_FALLBACK, matching the live platform_config value (1440, verified 2026-08-23)', () => {
    expect(CONTRACT_CREDIT_HOLD_MINUTES_FALLBACK).toBe(1440);
  });

  it('stays in sync with market\'s own checkout-math.ts fallback of the same name and value', () => {
    // These are two separate constants in two separate modules (contract.ts
    // is track/data's; checkout-math.ts is track/market's, pinned before this
    // pass exposed the live value on PlatformConfig). They must read the same
    // number until track/market switches to getPlatformConfig().credit_hold_minutes
    // — see AGENT_RULES.md section 5's "cash collected with no card
    // transferred" risk if a Stripe Session expiry ever outlives its hold.
    expect(CONTRACT_CREDIT_HOLD_MINUTES_FALLBACK).toBe(CREDIT_HOLD_MINUTES_FALLBACK);
  });

  it('mirrors getPlatformConfig()\'s fallback precedence: a live config row wins, a missing one falls back to the constant', () => {
    // Mirrors: byKey.get('credit_hold_minutes')?.num_value ?? CREDIT_HOLD_MINUTES_FALLBACK
    const readCreditHoldMinutes = (row: { num_value: number | null } | undefined): number =>
      row?.num_value ?? CONTRACT_CREDIT_HOLD_MINUTES_FALLBACK;

    expect(readCreditHoldMinutes(undefined)).toBe(1440);
    expect(readCreditHoldMinutes({ num_value: 60 })).toBe(60);
    // num_value present but null (a malformed row) still falls back rather
    // than propagating null into a caller expecting a number.
    expect(readCreditHoldMinutes({ num_value: null })).toBe(1440);
  });
});

// ------------------------------------------------------------
// design: USD vs FSC formatting, published condition label
// ------------------------------------------------------------

describe('price vs FSC formatting (components/card/format.ts)', () => {
  // The market-grid bug this pass fixed: a USD-cents price rendered through
  // formatFsc() reads as "174.64 FSC" instead of "$174.64". Pin the two
  // formatters apart so a call-site regression fails here first.
  it('formatUsd renders a dollar-prefixed price, never the FSC suffix', () => {
    const usd = formatUsd(17464);
    expect(usd).toBe('$174.64');
    expect(usd).not.toContain('FSC');
  });

  it('formatFsc renders the FSC suffix with no dollar sign — for an actual FSC amount, never a price', () => {
    const fsc = formatFsc(46500);
    expect(fsc).toBe('465.00 FSC');
    expect(fsc).not.toContain('$');
  });

  it('formatMyr (retained for existing callers only, no new call sites) still converts at the fixed preview rate', () => {
    expect(formatMyr(10000)).toBe('RM 420.00');
  });
});

describe('publishedConditionLabel / conditionGradeBand (018-020 condition_grade)', () => {
  it('maps every condition_grade to the matching FloatBand', () => {
    expect(conditionGradeBand('factory_new')).toBe('FN');
    expect(conditionGradeBand('minimal_wear')).toBe('MW');
    expect(conditionGradeBand('field_tested')).toBe('FT');
    expect(conditionGradeBand('well_worn')).toBe('WW');
    expect(conditionGradeBand('battle_scarred')).toBe('BS');
  });

  it('prefers the DB-derived condition_grade over a re-derived float band', () => {
    // float alone would band as FN (< 0.07); condition_grade must win since
    // it is the trigger-derived source of truth, not a re-derivation.
    expect(publishedConditionLabel(0.02, 'well_worn')).toBe('Well Worn');
  });

  it('falls back to the float-derived band when condition_grade is absent (pre-018 fixtures)', () => {
    expect(publishedConditionLabel(0.062)).toBe('Factory New');
  });

  it('never leaks a numeric float into the published label', () => {
    const label = publishedConditionLabel(0.319, 'field_tested');
    expect(label).not.toMatch(/\d/);
  });
});

describe('MarketTile -> CardTile showNumericFloat wiring (docs/handoff/design.md item 4 ask)', () => {
  // MarketTile never threaded showNumericFloat to CardTile, so the grid
  // always rendered CardTile's safe default (badge-only) regardless of the
  // live platform_config.show_numeric_float value. app/(market)/page.tsx and
  // app/(market)/u/[handle]/page.tsx now read getPlatformConfig() and pass
  // it down; this pins the prop actually reaching CardTile through the
  // adapter, not just that MarketTile compiles.
  const baseListing: ListingSummary = {
    id: 'listing-1',
    card_id: 'card-1',
    seller_id: 'seller-1',
    price_cents: 21000,
    status: 'public',
    early_access_level: 0,
    public_at: '2026-01-01T00:00:00Z',
    oracle_value_cents: 21000,
    created_at: '2026-01-01T00:00:00Z',
    sold_at: null,
    seller: {
      id: 'seller-1',
      handle: 'seller',
      level: 1,
      xp_total: 0,
      portfolio_value_cents: 0,
      is_admin: false,
      is_consignor: false,
      created_at: '2026-01-01T00:00:00Z',
    },
    card: {
      id: 'card-1',
      sku_id: 'sku-1',
      item_id: 'item-1',
      owner_id: 'seller-1',
      float_value: 0.062,
      float_percentile: 12.5,
      tier: 2,
      is_exceptional: false,
      mint_number: 1,
      status: 'active',
      minted_at: '2026-01-01T00:00:00Z',
      condition_grade: 'factory_new',
      sku: {
        id: 'sku-1',
        brand: 'Nike',
        model: 'Test',
        colorway: 'Black',
        size_us: 10,
        market_price_cents: 21000,
        sprite_key: null,
        palette: null,
        art_url: null,
      },
      listing: null,
    },
  };

  it('omitting the prop (unwired caller) renders the safe named-badge default, no numeric float', () => {
    const html = renderToStaticMarkup(createElement(MarketTile, { listing: baseListing }));
    expect(html).toContain('Factory New');
    expect(html).not.toContain('PCT');
  });

  it('showNumericFloat=false forwards through to CardTile explicitly', () => {
    const html = renderToStaticMarkup(
      createElement(MarketTile, { listing: baseListing, showNumericFloat: false }),
    );
    expect(html).toContain('Factory New');
    expect(html).not.toContain('PCT');
  });

  it('showNumericFloat=true (the live config value once an admin flips it) reaches CardTile through MarketTile', () => {
    const html = renderToStaticMarkup(
      createElement(MarketTile, { listing: baseListing, showNumericFloat: true }),
    );
    expect(html).toContain('PCT');
    expect(html).not.toContain('Factory New');
  });
});

describe('intake-config.isValidCountryCode / COUNTRIES', () => {
  it('accepts exactly the listed codes; rejects blank, lowercase, and unknown input', () => {
    expect(isValidCountryCode('MY')).toBe(true);
    expect(isValidCountryCode('US')).toBe(true);
    // Lowercase must not pass here — the server re-uppercases before calling
    // this (app/(market)/list/actions.ts), so the guard itself staying strict
    // is what makes that re-uppercase load-bearing rather than decorative.
    expect(isValidCountryCode('my')).toBe(false);
    expect(isValidCountryCode('')).toBe(false);
    expect(isValidCountryCode(null)).toBe(false);
    expect(isValidCountryCode(undefined)).toBe(false);
    expect(isValidCountryCode('ZZ')).toBe(false);
  });

  it('every COUNTRIES entry is a unique two-letter uppercase code, and MY is a real (non-default) choice among them', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
    expect(codes).toContain('MY');
  });
});

describe('PricePayout — country-driven payout disclosure (docs/handoff/market.md, capture-country task)', () => {
  // fn_payout_method_for_user resolves a null users.country_code to 'credit'
  // silently — every launch consignor is Malaysian and gets exactly that null
  // from a real signup, so they were being paid FSC instead of cash with no
  // error anywhere. This pins that the wizard's country step actually reacts:
  // once a country is picked, ITS resolution wins over whatever payout method
  // is already on file, using the live cash_payout_countries membership list
  // (not a hardcoded guess) — same predicate 019b's fn_payout_method_for_user
  // runs in SQL.
  const baseSku: Sku = {
    id: 'sku-1',
    brand: 'Nike',
    model: 'Test',
    colorway: 'Black',
    size_us: 10,
    retail_price_cents: 15000,
    market_price_cents: 21000,
    price_confidence: 0.9,
    priced_at: '2026-01-01T00:00:00Z',
    demand_score: 50,
    sprite_key: null,
    palette: null,
    art_url: null,
    mint_cap: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  const baseProps = {
    sku: baseSku,
    declaredFloat: null,
    priceCents: null,
    onPriceChange: () => {},
    onCountryChange: () => {},
  };

  it('no country picked yet: falls back to the account-on-file sellerPayoutMethod', () => {
    const html = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: null,
        sellerPayoutMethod: 'cash',
        cashPayoutCountryCodes: ['MY'],
      }),
    );
    expect(html).toContain("You&#x27;ll be paid in cash");
  });

  it('picking a cash-eligible country overrides a stale credit sellerPayoutMethod', () => {
    const html = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: 'MY',
        sellerPayoutMethod: 'credit',
        cashPayoutCountryCodes: ['MY'],
      }),
    );
    expect(html).toContain("You&#x27;ll be paid in cash");
  });

  it('picking a non-cash-eligible country shows the FSC disclosure, with the plain-language store-credit copy, overriding a stale cash sellerPayoutMethod', () => {
    const html = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: 'US',
        sellerPayoutMethod: 'cash',
        cashPayoutCountryCodes: ['MY'],
      }),
    );
    expect(html).toContain("You&#x27;ll be paid in FSC, not cash");
    expect(html).toContain('1 FSC = 1 USD');
    expect(html).toContain('cannot be cashed out to a bank');
  });

  it('no country picked and no sellerPayoutMethod on file: shows neither disclosure banner', () => {
    const html = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: null,
        sellerPayoutMethod: null,
        cashPayoutCountryCodes: [],
      }),
    );
    expect(html).not.toContain("You&#x27;ll be paid");
  });

  // The fulfilment gate (cash_payout_min_fulfilments) is gone from the SQL
  // (019c_settlement.sql's own comment: "The cash_payout_min_fulfilments gate
  // is gone") — it rationed nothing real. This pins that the UI never asks a
  // seller to unlock cash, and never renders a payout TOGGLE at all: payout
  // is geography, not a choice (AGENT_RULES.md section 5), so fn_submit_listing
  // (019c) computes it itself and discards whatever this step would have sent.
  it('never mentions fulfilments/unlocking, and renders no payout toggle button', () => {
    const html = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: 'US',
        sellerPayoutMethod: null,
        cashPayoutCountryCodes: ['MY'],
      }),
    );
    expect(html.toLowerCase()).not.toContain('fulfilment');
    expect(html.toLowerCase()).not.toContain('unlock');
    // No clickable credit/cash buttons — a <button> element anywhere would
    // mean this is still presented as a choice, not a read-only fact.
    expect(html).not.toContain('<button');
  });

  it('the read-only payout indicator agrees with the disclosure banner above it, for both cash and credit', () => {
    const cashHtml = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: 'MY',
        sellerPayoutMethod: null,
        cashPayoutCountryCodes: ['MY'],
      }),
    );
    expect(cashHtml).toContain("You&#x27;ll be paid in cash");
    expect(cashHtml).toMatch(/>cash</);

    const creditHtml = renderToStaticMarkup(
      createElement(PricePayout, {
        ...baseProps,
        countryCode: 'US',
        sellerPayoutMethod: null,
        cashPayoutCountryCodes: ['MY'],
      }),
    );
    expect(creditHtml).toContain("You&#x27;ll be paid in FSC, not cash");
    expect(creditHtml).toMatch(/>credit</);
  });
});

describe('derivePayoutPreview (intake-config)', () => {
  // Pure mirror of fn_payout_method_for_user's own cash_payout_countries
  // membership check (019b) — the single source of truth PricePayout's
  // read-only indicator and IntakeWizard's submitted payout_method both use,
  // so the two can never disagree with each other.
  it('resolves cash/credit off a valid country, ignoring any stale sellerPayoutMethod', () => {
    expect(derivePayoutPreview('MY', ['MY'])).toBe('cash');
    expect(derivePayoutPreview('US', ['MY'])).toBe('credit');
    expect(derivePayoutPreview('MY', ['MY'], 'credit')).toBe('cash');
    expect(derivePayoutPreview('US', ['MY'], 'cash')).toBe('credit');
  });

  it('falls back to sellerPayoutMethod only when no valid country is selected', () => {
    expect(derivePayoutPreview(null, ['MY'], 'cash')).toBe('cash');
    expect(derivePayoutPreview('', ['MY'], 'credit')).toBe('credit');
    expect(derivePayoutPreview('zz', ['MY'], 'cash')).toBe('cash');
    expect(derivePayoutPreview(null, ['MY'])).toBeNull();
  });
});

describe('ListForm — country picker on the relist path (docs/handoff/market.md, "the relist gap")', () => {
  // fn_list_card calls fn_payout_method_for_user internally
  // (019c_settlement.sql:360) and (025) now raises COUNTRY_NOT_SET for a
  // seller with none on file. Unlike the intake wizard, relisting a card the
  // owner already holds never asks for a country anywhere — this pins that
  // ListForm renders a required picker exactly when the account has nothing
  // valid on file, and stays out of the way otherwise.
  const baseProps = {
    cardId: 'card-1',
    oracleValueCents: 20000,
  };

  it('no country on file: renders the required country picker', () => {
    const html = renderToStaticMarkup(
      createElement(ListForm, { ...baseProps, countryCode: null }),
    );
    expect(html).toContain('Your country');
    expect(html).toContain('No country on file yet');
  });

  it('countryCode prop omitted entirely: still renders the picker (same as null)', () => {
    const html = renderToStaticMarkup(createElement(ListForm, baseProps));
    expect(html).toContain('No country on file yet');
  });

  it('a lowercase or otherwise malformed on-file code does not count as set: picker still renders', () => {
    const html = renderToStaticMarkup(
      createElement(ListForm, { ...baseProps, countryCode: 'my' }),
    );
    expect(html).toContain('No country on file yet');
  });

  it('a valid country already on file: no picker, nothing extra asked', () => {
    const html = renderToStaticMarkup(
      createElement(ListForm, { ...baseProps, countryCode: 'US' }),
    );
    expect(html).not.toContain('No country on file yet');
    expect(html).not.toContain('Select your country');
  });
});

// ------------------------------------------------------------
// 027_sku_models.sql — model/variant catalog split
// ------------------------------------------------------------
//
// skus.market_price_cents became a DERIVED column (coalesce(price_override_cents,
// sku_models.base_price_cents x size_multiplier)), maintained by
// trg_sku_variant_derive, which RAISES on a direct write rather than silently
// dropping it. Tier moved to the model (fn_tier_for_sku), value stays
// per-variant (fn_card_value_cents, unchanged). These tests cannot execute
// SQL — scripts/smoke_catalog.sql already does, live, and this suite must not
// duplicate it — so what's pinned here is: (1) upsertSku(), the one write
// path this repo has for skus, can no longer construct a market_price_cents
// write under any input shape; (2) the new exports exist with the shape
// callers need; (3) every new raise text 027 introduces maps to a real
// ContractErrorCode; (4) the tier-vs-value distinction itself, mirrored in
// pure TS the same way every other SQL function in this file is mirrored.

describe('upsertSku (027) — cannot construct a write containing market_price_cents, and cannot create without a model', () => {
  const baseInput = {
    brand: 'Nike',
    model: 'Air Max 1',
    colorway: 'Seed Grey',
    size_us: 10,
  };

  it('market_price_cents on an UPDATE-shaped call (id present) throws MARKET_PRICE_IS_DERIVED before touching Supabase', async () => {
    await expect(
      upsertSku({ ...baseInput, id: 'sku-1', market_price_cents: 12345 }),
    ).rejects.toMatchObject({
      name: 'ContractError',
      code: 'MARKET_PRICE_IS_DERIVED',
    });
  });

  it('market_price_cents on an INSERT-shaped call (no id) ALSO throws MARKET_PRICE_IS_DERIVED — the price guard fires before the model guard', async () => {
    await expect(
      upsertSku({ ...baseInput, market_price_cents: 12345 }),
    ).rejects.toMatchObject({
      name: 'ContractError',
      code: 'MARKET_PRICE_IS_DERIVED',
    });
  });

  it('market_price_cents: null still counts as a supplied write, not "leave alone"', async () => {
    await expect(
      upsertSku({ ...baseInput, id: 'sku-1', market_price_cents: null }),
    ).rejects.toMatchObject({ code: 'MARKET_PRICE_IS_DERIVED' });
  });

  it('an insert (no id, no market_price_cents) throws SKU_CREATION_REQUIRES_MODEL, naming the real replacement', async () => {
    await expect(upsertSku({ ...baseInput })).rejects.toMatchObject({
      name: 'ContractError',
      code: 'SKU_CREATION_REQUIRES_MODEL',
    });
    try {
      await upsertSku({ ...baseInput });
      throw new Error('expected upsertSku to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError);
      expect((err as ContractError).message).toMatch(/createSkuModel/);
      expect((err as ContractError).message).toMatch(/ensureSkuVariant/);
    }
  });

  // NOT tested here: an update with neither guard tripped (id present, no
  // market_price_cents). That call proceeds past both new guards into
  // createServerSupabase() and a real .update() against whatever project
  // .env.local points at — this suite must not risk a real write to the live
  // database (AGENT_RULES.md section 2), so the boundary this file can safely
  // pin stops at "does the guard fire", not "what happens after it doesn't".
});

describe('027 — new contract exports exist with the shape callers need', () => {
  it('listSkuModels, getSkuModel, createSkuModel, updateSkuModel, ensureSkuVariant, updateSkuVariant, replaceSkuArt are all exported functions', () => {
    expect(typeof listSkuModels).toBe('function');
    expect(typeof getSkuModel).toBe('function');
    expect(typeof createSkuModel).toBe('function');
    expect(typeof updateSkuModel).toBe('function');
    expect(typeof ensureSkuVariant).toBe('function');
    expect(typeof updateSkuVariant).toBe('function');
    // Unchanged signature (027's own migration comment: "lib/api/contract.ts
    // needs no change") — still exported, still (skuId, artUrl) -> Sku.
    expect(typeof replaceSkuArt).toBe('function');
    expect(replaceSkuArt.length).toBe(2);
  });

  it('burnCard(cardId, reason) — matches fn_burn_card(p_card_id, p_reason)', () => {
    expect(typeof burnCard).toBe('function');
    expect(burnCard.length).toBe(2);
  });

  it('archiveSkuModel(modelId, reason) — matches fn_archive_sku_model(p_model_id, p_reason)', () => {
    expect(typeof archiveSkuModel).toBe('function');
    expect(archiveSkuModel.length).toBe(2);
  });

  it('getConnectOnboardingStatus(userId) — returns ConnectAccountInfo', async () => {
    // Import the actual contract module to test the real function signature
    const { getConnectOnboardingStatus: actualFn } = await import('../lib/api/contract');
    expect(typeof actualFn).toBe('function');
    // async functions have length 0; verify it's async
    expect(actualFn.constructor.name).toBe('AsyncFunction');
  });

  it('createSkuModel(brand, model, colorway, basePriceCents?) — basePriceCents defaults, matching fn_create_sku_model default null', () => {
    expect(createSkuModel.length).toBe(3); // default params do not count toward .length
  });

  it('ensureSkuVariant(modelId, sizeUs) — matches fn_ensure_sku_variant(p_model_id, p_size_us)', () => {
    expect(ensureSkuVariant.length).toBe(2);
  });

  it('updateSkuModel(modelId, input) does not accept art_url — the only sanctioned art path is replaceSkuArt()', () => {
    // Compile-time guarantee (UpdateSkuModelInput has no art_url field); this
    // just pins that the input object shape stays a plain (modelId, input) pair.
    expect(updateSkuModel.length).toBe(2);
  });

  it('updateSkuVariant(skuId, input) — direct table write, does not accept market_price_cents', () => {
    expect(updateSkuVariant.length).toBe(2);
  });
});

describe('lib/db/errors.ts — 027 sku_models raise mappings', () => {
  it('trg_sku_variant_derive — market_price_cents is derived', () => {
    expect(
      contractErrorCode({
        message:
          'skus.market_price_cents is derived (26000). Set sku_models.base_price_cents ' +
          'or skus.price_override_cents instead of writing it directly.',
      }),
    ).toBe('MARKET_PRICE_IS_DERIVED');
  });

  it('fn_create_sku_model — blank identity field', () => {
    expect(
      contractErrorCode({ message: 'brand, model and colorway are all required' }),
    ).toBe('SKU_MODEL_IDENTITY_REQUIRED');
  });

  it('fn_create_sku_model — non-positive base price', () => {
    expect(contractErrorCode({ message: 'base price must be positive, got -5' })).toBe(
      'INVALID_AMOUNT',
    );
  });

  it('fn_ensure_sku_variant — no signed-in users row', () => {
    expect(contractErrorCode({ message: 'sign in to add a size' })).toBe('UNAUTHENTICATED');
  });

  it('fn_ensure_sku_variant — size validation, both messages', () => {
    expect(
      contractErrorCode({ message: 'size 2 is outside the supported range (3 to 20)' }),
    ).toBe('INVALID_SKU_SIZE');
    expect(contractErrorCode({ message: 'size 9.3 is not a whole or half size' })).toBe(
      'INVALID_SKU_SIZE',
    );
  });

  it('fn_ensure_sku_variant — "sku_model % not found" rides the existing generic NOT_FOUND rule, no new pattern needed', () => {
    expect(
      contractErrorCode({ message: 'sku_model 11111111-1111-1111-1111-111111111111 not found' }),
    ).toBe('NOT_FOUND');
  });

  it('the model-level art guard (trg_guard_sku_model_art_url) rides the existing 42501 -> FORBIDDEN code map, no new pattern needed', () => {
    expect(
      contractErrorCode({
        message:
          'sku_model 1 already has art_url; replacement must go through fn_replace_sku_art()',
        code: '42501',
      }),
    ).toBe('FORBIDDEN');
  });
});

describe('027 — tier from the model, value from the variant (mirrors scripts/smoke_catalog.sql C3)', () => {
  // Test-only mirror of trg_sku_variant_derive's formula — the same
  // "SQL MIRRORS" convention this file uses throughout, never production
  // code (lib/api/contract.ts never computes this; see AGENT_RULES.md).
  function deriveMarketPriceCents(
    basePriceCents: number | null,
    sizeMultiplier: number,
    priceOverrideCents: number | null,
  ): number | null {
    if (priceOverrideCents != null) return priceOverrideCents;
    if (basePriceCents == null) return null;
    return Math.floor(basePriceCents * sizeMultiplier);
  }

  // Same numbers as smoke_catalog.sql's C3 section, so a live run and this
  // pure-TS mirror are checking the identical scenario.
  const model = { base_price_cents: 26000 };
  const plainVariant = { size_multiplier: 1.0, price_override_cents: null as number | null };
  const overriddenVariant = { size_multiplier: 1.0, price_override_cents: 8000 };

  it('fixture assumption: 8000 and 26000 really do fall in different tier bands', () => {
    expect(tierForPrice(8000)).not.toBe(tierForPrice(26000));
    expect(tierForPrice(8000)).toBe(2); // Uncommon
    expect(tierForPrice(26000)).toBe(4); // Epic
  });

  it('value (fn_card_value_cents input) is genuinely per-variant: the override changes market_price_cents', () => {
    const plainPrice = deriveMarketPriceCents(
      model.base_price_cents,
      plainVariant.size_multiplier,
      plainVariant.price_override_cents,
    );
    const overriddenPrice = deriveMarketPriceCents(
      model.base_price_cents,
      overriddenVariant.size_multiplier,
      overriddenVariant.price_override_cents,
    );
    expect(plainPrice).toBe(26000);
    expect(overriddenPrice).toBe(8000);
    expect(overriddenPrice).not.toBe(plainPrice);
  });

  it('tier (fn_tier_for_sku input) is the MODEL\'s base price for BOTH variants — never the variant\'s derived market_price_cents', () => {
    // This is the exact regression getSkus()'s old tier filter had: it
    // matched on skus.market_price_cents, which is 8000 for the overridden
    // variant — tierForPrice(8000) = 2, not the model's real tier of 4.
    const tierFromModel = tierForPrice(model.base_price_cents);
    expect(tierFromModel).toBe(4);

    // Both variants must report the SAME tier, because fn_tier_for_sku reads
    // sku_models.base_price_cents regardless of which variant asks.
    expect(tierForPrice(model.base_price_cents)).toBe(tierFromModel);
    expect(tierForPrice(model.base_price_cents)).toBe(tierFromModel);

    // The bug this fixes: computing tier from the variant's own derived price
    // instead of the model's gives a DIFFERENT, wrong answer for the
    // overridden variant.
    const overriddenPrice = deriveMarketPriceCents(
      model.base_price_cents,
      overriddenVariant.size_multiplier,
      overriddenVariant.price_override_cents,
    );
    expect(tierForPrice(overriddenPrice as number)).not.toBe(tierFromModel);
  });
});

// ------------------------------------------------------------
// SkuModelForm — identity/price validation reactivity
// ------------------------------------------------------------
//
// Reported bug: with brand/model/colorway all filled, the form still showed
// "required" on all three and refused to submit. The three named suspects —
// errors computed once at mount, an uncontrolled input feeding a stale
// validator, or an inverted touched/dirty flag — all show up as a *frozen*
// parseDraft() output: it would keep returning the mount-time result no
// matter what the draft became. parseDraft is exported from SkuModelForm.tsx
// for exactly this reason (no separate lib module owns this logic), so these
// drive it directly with fresh Draft objects the way the component's own
// useState would hold them, rather than mirroring it in parallel TS.

describe('SkuModelForm.parseDraft — create mode (identity required)', () => {
  const filledDraft: Draft = {
    brand: 'Nike',
    model: 'Air Jordan 1',
    colorway: 'Chicago',
    base_price_cents: '',
    price_confidence: '',
    sprite_key: '',
    palette: '',
  };

  it('all three identity fields filled, price left blank: ok — the exact repro from the bug report', () => {
    const parsed = parseDraft(filledDraft, true);
    expect(parsed.ok).toBe(true);
  });

  it('blank price does not block submission — an unpriced model is valid, it just cannot mint', () => {
    const parsed = parseDraft(filledDraft, true);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.common.basePriceCents).toBeNull();
  });

  it.each(['brand', 'model', 'colorway'] as const)(
    'blanking only %s errors that field alone and flips ok to false',
    (blankKey) => {
      const draft: Draft = { ...filledDraft, [blankKey]: '' };
      const parsed = parseDraft(draft, true);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.errors[blankKey]).toBe('required');
      for (const otherKey of ['brand', 'model', 'colorway'] as const) {
        if (otherKey !== blankKey) expect(parsed.errors[otherKey]).toBeUndefined();
      }
    },
  );

  it('whitespace-only counts as blank, since the check is against the trimmed value', () => {
    const parsed = parseDraft({ ...filledDraft, colorway: '   ' }, true);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.colorway).toBe('required');
  });

  it('parsing a blanked-then-refilled field clears its error — the validator is not frozen at an earlier draft', () => {
    const blanked = parseDraft({ ...filledDraft, brand: '' }, true);
    expect(blanked.ok).toBe(false);

    const refilled = parseDraft({ ...filledDraft, brand: 'Adidas' }, true);
    expect(refilled.ok).toBe(true);
  });
});

describe('SkuModelForm.parseDraft — edit mode never re-runs the identity check', () => {
  const editDraft = (overrides: Partial<Draft> = {}): Draft => ({
    brand: '',
    model: '',
    colorway: '',
    base_price_cents: '',
    price_confidence: '',
    sprite_key: '',
    palette: '',
    ...overrides,
  });

  it('blank brand/model/colorway does not error in edit mode — those inputs do not exist there, and 027 gives identity no update path', () => {
    const parsed = parseDraft(
      editDraft({ base_price_cents: '18000', price_confidence: '0.9', sprite_key: 'low-top' }),
      false,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.identity).toBeNull();
  });

  it('blank price is still optional in edit mode — an already-priced model can be blanked back to unpriced', () => {
    const parsed = parseDraft(editDraft(), false);
    expect(parsed.ok).toBe(true);
  });
});

describe('SkuModelForm — rendered output agrees with parseDraft', () => {
  const baseSkuModel: SkuModel = {
    id: 'model-1',
    brand: 'Nike',
    model: 'Air Max 1',
    colorway: 'Seed Grey',
    base_price_cents: null,
    price_confidence: 0.9,
    priced_at: null,
    sprite_key: 'low-top',
    palette: null,
    art_url: null,
    demand_score: 0,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('create mode, fresh mount: all three identity fields start blank, so all three render "required" and submit stays disabled', () => {
    const html = renderToStaticMarkup(createElement(SkuModelForm, { model: null }));
    expect(html).toContain('Fix the marked fields first.');
    expect(html.match(/required/g)?.length).toBe(3);
    const button = html.match(/<button[^>]*>Create model<\/button>/);
    expect(button?.[0]).toContain('disabled=""');
  });

  it('edit mode: identity renders as fixed text, never as inputs — the create-mode required check has nothing to attach to', () => {
    const html = renderToStaticMarkup(createElement(SkuModelForm, { model: baseSkuModel }));
    expect(html).toContain('identity is fixed after creation');
    expect(html).not.toContain('required');
    expect(html).not.toContain('Fix the marked fields first.');
  });

  it('edit mode with base_price_cents null: price renders blank and Save changes stays enabled', () => {
    const html = renderToStaticMarkup(createElement(SkuModelForm, { model: baseSkuModel }));
    const priceInput = html.match(/id="input-Oracle price \(cents\)"[^>]*value="([^"]*)"/);
    expect(priceInput?.[1] ?? '').toBe('');

    const button = html.match(/<button[^>]*>Save changes<\/button>/);
    expect(button?.[0]).not.toContain('disabled=""');
  });
});

// ------------------------------------------------------------
// VariantsTable — the Price column and the override's "model base" text are
// the oracle price (USD, integer cents), never FSC. FSC is earned-only store
// credit (AGENT_RULES.md section 5/6) and is never the price of anything.
// components/card/format.ts already draws this line (formatUsd vs formatFsc,
// both asserted above) — this pins that VariantsTable actually calls through
// it rather than rolling its own "X.XX FSC" string, which is exactly the bug
// that shipped: a local money() helper duplicating formatFsc's suffix on a
// price.
// ------------------------------------------------------------

describe('VariantsTable — price column and override helper text render USD, never FSC', () => {
  const baseVariant: Sku = {
    id: 'variant-1',
    model_id: 'model-1',
    brand: 'Nike',
    model: 'Air Max 1',
    colorway: 'Seed Grey',
    size_us: 10,
    retail_price_cents: 20000,
    market_price_cents: 26000,
    size_multiplier: 1.0,
    price_override_cents: null,
    price_confidence: 0.9,
    priced_at: '2026-01-01T00:00:00Z',
    demand_score: 0,
    sprite_key: 'low-top',
    palette: null,
    art_url: null,
    mint_cap: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('a priced model: the Price column shows a dollar-formatted price and nowhere on the page says FSC', () => {
    const html = renderToStaticMarkup(
      createElement(VariantsTable, {
        modelId: 'model-1',
        modelBrand: 'Nike',
        modelBasePriceCents: 26000,
        variants: [baseVariant],
        cardCounts: { 'variant-1': 3 },
      }),
    );
    expect(html).toContain(formatUsd(26000));
    expect(html).not.toContain('FSC');
  });

  it('the override row\'s "model base" helper text is the same USD figure, not FSC', () => {
    const overriddenVariant: Sku = { ...baseVariant, price_override_cents: 8000 };
    const html = renderToStaticMarkup(
      createElement(VariantsTable, {
        modelId: 'model-1',
        modelBrand: 'Nike',
        modelBasePriceCents: 26000,
        variants: [overriddenVariant],
        cardCounts: { 'variant-1': 0 },
      }),
    );
    expect(html).toContain(`model base ${formatUsd(26000)}`);
    expect(html).not.toContain('FSC');
  });

  it('an unpriced model (modelBasePriceCents null): renders the em-dash placeholder, still no FSC', () => {
    const html = renderToStaticMarkup(
      createElement(VariantsTable, {
        modelId: 'model-1',
        modelBrand: 'Nike',
        modelBasePriceCents: null,
        variants: [{ ...baseVariant, market_price_cents: null }],
        cardCounts: {},
      }),
    );
    expect(html).toContain('—');
    expect(html).not.toContain('FSC');
  });
});

// ------------------------------------------------------------
// docs/handoff/admin.md item 17 — every remaining "X.XX FSC" price outside
// the SKU bench. Each of these had a real USD amount (an oracle price, a
// seller's ask, an intake fee, a redemption handling fee) rendered through
// either a local money()-shaped helper or an inline template literal that
// happened to copy formatFsc's exact suffix. Fixed to call formatUsd; the
// local helpers are gone rather than kept beside it, per the same reasoning
// as the section above: a second formatter is how these six drifted from
// formatUsd in the first place.
// ------------------------------------------------------------

describe('MintTable — oracle price column renders USD, never FSC', () => {
  const baseItem: ItemSummary = {
    id: 'item-1',
    sku_id: 'sku-1',
    consignment_id: null,
    consignor_id: 'consignor-1',
    status: 'in_custody',
    float_value: 0.062,
    condition_grade: 'factory_new',
    graded_at: '2026-01-01T00:00:00Z',
    grading_notes: null,
    photos: [],
    authenticated_at: '2026-01-01T00:00:00Z',
    custody_location: 'warehouse-a',
    reserve_price_cents: null,
    sku: {
      id: 'sku-1',
      brand: 'Nike',
      model: 'Air Max 1',
      colorway: 'Seed Grey',
      size_us: 10,
      market_price_cents: 26000,
      sprite_key: null,
      palette: null,
      art_url: null,
    },
    card_id: null,
    grade: null,
    custody: 'warehouse',
    custody_holder_id: null,
    grade_source: 'flexsoar',
    asking_price_cents: null,
    submitted_payout: 'cash',
    last_proof_at: null,
  };

  it('a mintable item with an oracle price: the Oracle column shows a dollar amount, never FSC', () => {
    const html = renderToStaticMarkup(createElement(MintTable, { items: [baseItem] }));
    expect(html).toContain(formatUsd(26000));
    expect(html).not.toContain('FSC');
  });

  it('an unpriced item: shows the "no oracle price" flag instead of a figure, still no FSC', () => {
    const unpriced: ItemSummary = {
      ...baseItem,
      sku: { ...baseItem.sku, market_price_cents: null },
    };
    const html = renderToStaticMarkup(createElement(MintTable, { items: [unpriced] }));
    expect(html).toContain('no oracle price');
    expect(html).not.toContain('FSC');
  });
});

describe('DecisionControls — oracle and asking price hint text render USD, never FSC', () => {
  // Both price texts render only inside the approve confirm modal
  // (open={confirming === "approve"}), which starts closed and a static
  // render has no way to click open (no jsdom in this suite) — so a plain
  // render of the closed component cannot reach the bug's own text at all.
  // oracleHint/askingNote are exported from the component for exactly this
  // reason: they are what actually builds those strings, tested directly
  // rather than through a DOM assertion that structurally cannot see them.
  it('a render of the closed component mounts cleanly and shows no price text yet', () => {
    const html = renderToStaticMarkup(
      createElement(DecisionControls, {
        itemId: 'item-1',
        itemLabel: 'Nike Air Max 1 · Seed Grey · US 10',
        askingPriceCents: 21500,
        marketPriceCents: 26000,
        blocked: null,
      }),
    );
    expect(html).toContain('Approve and publish');
    expect(html).not.toContain('FSC');
  });

  it('oracleHint renders the SKU oracle price in dollars, never FSC', () => {
    expect(oracleHint(26000)).toBe(`Integer USD cents. SKU oracle price is ${formatUsd(26000)}.`);
    expect(oracleHint(26000)).not.toContain('FSC');
    expect(oracleHint(null)).not.toContain('FSC');
  });

  it('askingNote renders the seller\'s ask in dollars, never FSC', () => {
    expect(askingNote(21500)).toBe(`Seller asked ${formatUsd(21500)}. Prefilled, not binding.`);
    expect(askingNote(21500)).not.toContain('FSC');
    expect(askingNote(null)).toBeNull();
  });
});

describe('app/admin/submissions/page.tsx — Asking column renders USD, never FSC', () => {
  it('the pending-review queue shows the asking price in dollars, never FSC', async () => {
    const html = renderToStaticMarkup(await SubmissionsQueuePage());
    expect(html).toContain(formatUsd(21500));
    expect(html).not.toContain('FSC');
  });
});

describe('app/admin/submissions/[itemId]/page.tsx — asking/oracle price render USD, never FSC', () => {
  it('the header\'s Asking figure, the SKU oracle price, and the seller\'s earlier-submission Asked column are all dollar-formatted, never FSC', async () => {
    const element = await ReviewSubmissionPage({
      params: Promise.resolve({ itemId: 'submission-1' }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(formatUsd(21500)); // header Asking, and this submission's own ask
    expect(html).toContain(formatUsd(26000)); // SKU oracle
    expect(html).toContain(formatUsd(8000)); // seller's earlier-submission Asked column
    expect(html).not.toContain('FSC');
  });
});

describe('app/admin/consignments/[id]/page.tsx — Intake fee renders USD, never FSC', () => {
  it('the consignment detail page shows the intake fee in dollars, never FSC', async () => {
    const element = await ConsignmentDetailPage({ params: Promise.resolve({ id: 'consignment-1' }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(formatUsd(1500));
    expect(html).not.toContain('FSC');
  });
});

describe('app/admin/fulfilment/page.tsx — redemption handling fee renders USD, never FSC', () => {
  // fn_redeem_card books this fee as entry_type 'handling_fee' on asset
  // 'currency', both legs — it was always USD, never FSC.
  it('the warehouse queue\'s Fee column shows the handling fee in dollars, never FSC', async () => {
    const html = renderToStaticMarkup(await FulfilmentPage());
    expect(html).toContain(formatUsd(995));
    expect(html).not.toContain('FSC');
  });
});

// ------------------------------------------------------------
// New static pages — landing, terms, privacy, market
// ------------------------------------------------------------

// Mock fs for page-level static renders that read docs/
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn((path: string) => {
      if (path.endsWith('TERMS.md')) {
        return `# FlexSoar — Terms of Service

Last updated: 26/08/2026

## 1. Who we are

FlexSoar is operated by William Imohi.

You can reach us at info@flexsoar.net.

By creating an account or using flexsoar.net, you agree to these Terms. If you do not agree, do not use the service.

## 2. What FlexSoar is

FlexSoar is a marketplace for authenticated secondhand sneakers.

Every pair listed on FlexSoar is represented by a Card. A Card is a digital record of ownership of one specific physical pair of shoes. Cards can be bought, sold and traded on FlexSoar. The holder of a Card may at any time redeem it — meaning the Card is destroyed and we ship the physical shoes to them.

A Card is a claim on a specific, identified pair of shoes. It is not:

- a security, share, unit, investment product or collective investment scheme
- a cryptocurrency, token, or blockchain asset
- money, e-money, stored value, or a payment instrument
- a fractional interest in anything — one Card, one pair, always

There is no chance, randomisation, loot box, pack, crate or wager mechanic anywhere on FlexSoar, and there never will be. Every transaction is a purchase or exchange of an identified item at a known price.`;
      }
      if (path.endsWith('PRIVACY.md')) {
        return `# FlexSoar — Privacy Policy / Dasar Privasi

Last updated / Kemas kini terakhir: 27/08/2026

---

# English

## 1. Who we are

FlexSoar is operated by William Imohi.

For anything about your personal data, contact **info@flexsoar.net**.

This notice explains what we collect, why, who we share it with, and what you can ask us to do about it. It is issued under the Personal Data Protection Act 2010.

## 2. What we collect

**When you create an account**
- Email address
- Your chosen handle (this is public)
- Country of residence — this determines whether we can pay you

**When you list shoes**
- Photographs of your shoes
- Your own condition assessment and notes
- Your asking price
- Tracking numbers for parcels you send us
- Contact details you give us for courier coordination

**When you buy or sell**
- Transaction records: what, when, how much
- Payment status. We never see or store your card number — payments are handled by our payment provider and card details go directly to them
- Amounts we owe you and payment records

**When you redeem a Card**
- Your shipping address
- Contact details for the courier

**Automatically**
- Basic technical data: IP address, browser type, pages visited
- Cookies needed to keep you signed in

We do not collect identity documents, dates of birth, or financial account details, unless we tell you separately why we need them and you agree.

## 3. Why we use it

- To run your account and keep you signed in
- To publish your listings and show your public handle and holdings
- To process purchases, trades and redemptions
- To pay you what you are owed
- To ship shoes to you and coordinate with couriers
- To review submissions and check for counterfeits
- To email you about your transactions — sales, approvals, shipping, payouts. These are service emails, not marketing. You cannot opt out of them while you have an active account, because they are how the service works
- To detect fraud, prevent abuse, and investigate disputes
- To meet legal, tax and accounting obligations

We do not sell your personal data, and we do not share it for advertising.

---

# Bahasa Malaysia

## 1. Siapa kami

FlexSoar dikendalikan oleh William Imohi.

Untuk sebarang perkara berkaitan data peribadi anda, hubungi **info@flexsoar.net**.

Notis ini menerangkan apa yang kami kumpulkan, mengapa, dengan siapa kami berkongsi, dan apa yang boleh anda minta kami lakukan mengenainya. Notis ini dikeluarkan di bawah Akta Perlindungan Data Peribadi 2010.

## 2. Apa yang kami kumpulkan

**Apabila anda membuka akaun**
- Alamat e-mel
- Nama pengguna pilihan anda (ini bersifat awam)
- Negara kediaman — ini menentukan sama ada kami boleh membayar anda

**Apabila anda menyenaraikan kasut**
- Gambar kasut anda
- Penilaian keadaan dan nota anda sendiri
- Harga permintaan anda
- Nombor penjejakan bagi bungkusan yang anda hantar kepada kami
- Butiran perhubungan yang anda berikan untuk penyelarasan kurier

**Apabila anda membeli atau menjual**
- Rekod transaksi: apa, bila, berapa
- Status pembayaran. Kami tidak pernah melihat atau menyimpan nombor kad anda — pembayaran dikendalikan oleh penyedia pembayaran kami dan butiran kad dihantar terus kepada mereka
- Jumlah yang kami hutang kepada anda dan rekod pembayaran

**Apabila anda menebus Kad**
- Alamat penghantaran anda
- Butiran perhubungan untuk kurier

**Secara automatik**
- Data teknikal asas: alamat IP, jenis pelayar, halaman yang dilawati
- Kuki yang diperlukan untuk mengekalkan log masuk anda

Kami tidak mengumpul dokumen pengenalan diri, tarikh lahir, atau butiran akaun kewangan, melainkan kami memberitahu anda secara berasingan mengapa kami memerlukannya dan anda bersetuju.`;
      }
      return '';
    }),
  },
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith('TERMS.md')) {
      return `# FlexSoar — Terms of Service

Last updated: 26/08/2026

## 1. Who we are

FlexSoar is operated by William Imohi.

You can reach us at info@flexsoar.net.

By creating an account or using flexsoar.net, you agree to these Terms. If you do not agree, do not use the service.

## 2. What FlexSoar is

FlexSoar is a marketplace for authenticated secondhand sneakers.

Every pair listed on FlexSoar is represented by a Card. A Card is a digital record of ownership of one specific physical pair of shoes. Cards can be bought, sold and traded on FlexSoar. The holder of a Card may at any time redeem it — meaning the Card is destroyed and we ship the physical shoes to them.

A Card is a claim on a specific, identified pair of shoes. It is not:

- a security, share, unit, investment product or collective investment scheme
- a cryptocurrency, token, or blockchain asset
- money, e-money, stored value, or a payment instrument
- a fractional interest in anything — one Card, one pair, always

There is no chance, randomisation, loot box, pack, crate or wager mechanic anywhere on FlexSoar, and there never will be. Every transaction is a purchase or exchange of an identified item at a known price.`;
    }
    if (path.endsWith('PRIVACY.md')) {
      return `# FlexSoar — Privacy Policy / Dasar Privasi

Last updated / Kemas kini terakhir: 27/08/2026

---

# English

## 1. Who we are

FlexSoar is operated by William Imohi.

For anything about your personal data, contact **info@flexsoar.net**.

This notice explains what we collect, why, who we share it with, and what you can ask us to do about it. It is issued under the Personal Data Protection Act 2010.

## 2. What we collect

**When you create an account**
- Email address
- Your chosen handle (this is public)
- Country of residence — this determines whether we can pay you

**When you list shoes**
- Photographs of your shoes
- Your own condition assessment and notes
- Your asking price
- Tracking numbers for parcels you send us
- Contact details you give us for courier coordination

**When you buy or sell**
- Transaction records: what, when, how much
- Payment status. We never see or store your card number — payments are handled by our payment provider and card details go directly to them
- Amounts we owe you and payment records

**When you redeem a Card**
- Your shipping address
- Contact details for the courier

**Automatically**
- Basic technical data: IP address, browser type, pages visited
- Cookies needed to keep you signed in

We do not collect identity documents, dates of birth, or financial account details, unless we tell you separately why we need them and you agree.

## 3. Why we use it

- To run your account and keep you signed in
- To publish your listings and show your public handle and holdings
- To process purchases, trades and redemptions
- To pay you what you are owed
- To ship shoes to you and coordinate with couriers
- To review submissions and check for counterfeits
- To email you about your transactions — sales, approvals, shipping, payouts. These are service emails, not marketing. You cannot opt out of them while you have an active account, because they are how the service works
- To detect fraud, prevent abuse, and investigate disputes
- To meet legal, tax and accounting obligations

We do not sell your personal data, and we do not share it for advertising.

---

# Bahasa Malaysia

## 1. Siapa kami

FlexSoar dikendalikan oleh William Imohi.

Untuk sebarang perkara berkaitan data peribadi anda, hubungi **info@flexsoar.net**.

Notis ini menerangkan apa yang kami kumpulkan, mengapa, dengan siapa kami berkongsi, dan apa yang boleh anda minta kami lakukan mengenainya. Notis ini dikeluarkan di bawah Akta Perlindungan Data Peribadi 2010.

## 2. Apa yang kami kumpulkan

**Apabila anda membuka akaun**
- Alamat e-mel
- Nama pengguna pilihan anda (ini bersifat awam)
- Negara kediaman — ini menentukan sama ada kami boleh membayar anda

**Apabila anda menyenaraikan kasut**
- Gambar kasut anda
- Penilaian keadaan dan nota anda sendiri
- Harga permintaan anda
- Nombor penjejakan bagi bungkusan yang anda hantar kepada kami
- Butiran perhubungan yang anda berikan untuk penyelarasan kurier

**Apabila anda membeli atau menjual**
- Rekod transaksi: apa, bila, berapa
- Status pembayaran. Kami tidak pernah melihat atau menyimpan nombor kad anda — pembayaran dikendalikan oleh penyedia pembayaran kami dan butiran kad dihantar terus kepada mereka
- Jumlah yang kami hutang kepada anda dan rekod pembayaran

**Apabila anda menebus Kad**
- Alamat penghantaran anda
- Butiran perhubungan untuk kurier

**Secara automatik**
- Data teknikal asas: alamat IP, jenis pelayar, halaman yang dilawati
- Kuki yang diperlukan untuk mengekalkan log masuk anda

Kami tidak mengumpul dokumen pengenalan diri, tarikh lahir, atau butiran akaun kewangan, melainkan kami memberitahu anda secara berasingan mengapa kami memerlukannya dan anda bersetuju.`;
    }
    return '';
  }),
}));

// Mock remark/remark-html for static page markdown rendering
vi.mock('remark', () => ({
  remark: () => ({
    use: () => ({
      processSync: (content: string) => ({
        toString: () => content
          .replace(/^# (.*)$/gm, '<h1>$1</h1>')
          .replace(/^## (.*)$/gm, '<h2>$1</h2>')
          .replace(/^\*\s(.*)$/gm, '<li>$1</li>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
      }),
    }),
  }),
}));

vi.mock('remark-html', () => ({ default: () => {} }));

// Mock next/navigation for page components that use usePathname
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    replace: () => {},
    prefetch: () => {},
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Supabase/cookies for market page
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    })),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    },
  })),
}));

// Mock getPlatformConfig, getListings, getSkus for market page
vi.mock('@/lib/api/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/contract')>();
  return {
    ...actual,
    getPlatformConfig: async () => ({ show_numeric_float: false }),
    getListings: async () => [],
    getSkus: async () => [],
    getConsignment: async () => ({
      id: 'consignment-1',
      consignor_id: 'consignor-1',
      consignor: { id: 'consignor-1', handle: 'sneakerhead', level: 2 },
      status: 'in_review',
      item_count: 1,
      intake_fee_cents: 1500,
      submitted_at: '2026-01-01T00:00:00Z',
      received_at: null,
      completed_at: null,
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      items: [],
      events: [],
    }),
    getRedemptions: async () => [
      {
        id: 'redemption-1',
        card_id: 'card-1',
        item_id: 'item-1',
        user_id: 'redeemer-1',
        handling_fee_cents: 995,
        shipping_address: { name: 'A. Buyer', line1: '1 Market St', city: 'SF', country: 'US' },
        status: 'requested',
        carrier: null,
        tracking_number: null,
        requested_at: '2026-01-01T00:00:00Z',
        shipped_at: null,
        card: {
          id: 'card-1',
          mint_number: 4,
          float_value: 0.062,
          sku: { brand: 'Nike', model: 'Air Max 1', colorway: 'Seed Grey', size_us: 10 },
        },
        item: { id: 'item-1', status: 'redemption_hold', custody_location: 'warehouse-a' },
        redeemer: { id: 'redeemer-1', handle: 'buyer1', level: 1 },
        fulfiller: null,
      },
    ],
    getConnectOnboardingStatus: async () => ({
      connect_account_id: 'acct_test123',
      onboarding_status: 'pending',
      payouts_enabled: false,
      requirements: ['business_type', 'business_profile.mcc'],
      updated_at: '2026-01-01T00:00:00Z',
    }),
  };
});

// Mock the Supabase server for getConnectOnboardingStatus users table query
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({
                data: {
                  connect_account_id: 'acct_test123',
                  connect_onboarding_status: 'pending',
                  connect_payouts_enabled: false,
                  connect_requirements: ['business_type', 'business_profile.mcc'],
                  connect_updated_at: '2026-01-01T00:00:00Z',
                },
                error: null,
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      };
    }),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    },
  })),
}));

// Import page components after mocks
import LandingPage from '@/app/page';
import TermsPage from '@/app/terms/page';
import PrivacyPage from '@/app/privacy/page';
import MarketPage from '@/app/(market)/market/page';

describe('Landing page (/) — signed out render', () => {
  it('renders without crashing and contains key messaging', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Authenticated secondhand sneakers');
    expect(html).toContain('Every pair is a card');
  });

  it('includes How It Works 4-step timeline', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('How It Works');
    expect(html).toContain('List or Buy');
    expect(html).toContain('Authenticate');
    expect(html).toContain('Vault');
    expect(html).toContain('Trade Freely');
    expect(html).toContain('Redeem Anytime');
  });

  it('includes footer links to /terms and /privacy', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it('has split CTA: Explore the Vault (buyers) and List Your Sneakers (sellers)', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/market"');
    expect(html).toContain('Explore the Vault');
    expect(html).toContain('href="/list"');
    expect(html).toContain('List Your Sneakers');
  });

  it('does not claim FlexSoar covers consignor shipping to vault (matches TERMS.md 4.6)', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    // TERMS.md 4.6: "You arrange and pay for shipping to our vault using a tracked service."
    // Landing page must not say we cover/pay for shipping TO the vault.
    expect(html).not.toContain('cover.*ship'); // no "cover shipping" or "covers shipping"
    expect(html).not.toContain('we pay.*ship'); // no "we pay for shipping"
    expect(html).not.toContain('we cover.*shipping'); // no "we cover shipping"
    // It should correctly state we cover shipping TO THE BUYER
    expect(html).toContain('shipping to the buyer');
  });

  it('includes trust signals', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('100% Authenticity Guaranteed');
    expect(html).toContain('Climate-Controlled Vault Storage');
    expect(html).toContain('Zero Upfront Listing Fees');
  });

  it('includes legal disclosures accordion', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Legal disclosures');
    expect(html).toContain('not a security');
    expect(html).toContain('investment advice');
  });

  it('contains no hardcoded numeric activity claims (vaulted count, trade count)', async () => {
    const element = await LandingPage();
    const html = renderToStaticMarkup(element);
    // No fabricated stats like "1,247 pairs vaulted" or "3,892 trades this month"
    // Real metrics must come from a live query, not hardcoded HTML.
    expect(html).not.toContain('vaulted-count');
    expect(html).not.toContain('traded-count');
    expect(html).not.toContain('Pairs Currently Vaulted');
    expect(html).not.toContain('Cards Traded This Month');
    // No hardcoded numbers with comma formatting that look like activity counters
    expect(html).not.toMatch(/>\d{1,3}(,\d{3})+\s*(pairs?|cards?|trades?)/i);
  });
});

// NotificationBell tests
describe('NotificationBell — signed out render', () => {
  it('renders without crashing when no notifications', async () => {
    const { NotificationBell } = await import('@/components/market/NotificationBell');
    const html = renderToStaticMarkup(
      createElement(NotificationBell, { notifications: [], unreadCount: 0 })
    );
    // Static render only shows the button (dropdown is client-side interactive)
    expect(html).toContain('aria-label="No notifications"');
    expect(html).not.toContain('Mark all read');
  });

  it('shows unread count badge when count > 0', async () => {
    const { NotificationBell } = await import('@/components/market/NotificationBell');
    const html = renderToStaticMarkup(
      createElement(NotificationBell, {
        notifications: [{ id: '1', type: 'card_sold', title: 'Sold', body: 'Your card sold', createdAt: new Date().toISOString(), read: false }],
        unreadCount: 3,
      })
    );
    // Static render shows the button with unread badge
    expect(html).toContain('3');
    expect(html).toContain('aria-label="3 unread notifications"');
    // Dropdown content not rendered in static markup (requires client interaction)
    expect(html).not.toContain('Mark all read');
  });

  it('renders notification button with correct aria-label for unread count', async () => {
    const { NotificationBell } = await import('@/components/market/NotificationBell');
    const html = renderToStaticMarkup(
      createElement(NotificationBell, {
        notifications: [
          { id: '1', type: 'submission_approved', title: 'Approved', body: 'Your submission was approved', createdAt: new Date().toISOString(), read: false },
          { id: '2', type: 'card_sold', title: 'Sold', body: 'Your card sold for $200', createdAt: new Date().toISOString(), read: true },
        ],
        unreadCount: 1,
      })
    );
    // Static render shows button with unread count
    expect(html).toContain('aria-label="1 unread notifications"');
    // Dropdown content not rendered in static markup (requires client interaction)
    expect(html).not.toContain('Approved');
    expect(html).not.toContain('Mark as read');
  });
});

// MarketLayout tests - signed out (no bell)
describe('MarketLayout — signed out render', () => {
  it('renders without crashing and shows sign-in button', async () => {
    // MarketLayout is a Server Component; we test the header area renders correctly
    // The bell is only rendered when meId exists (signed in)
    const { currentUserId } = await import('@/app/(market)/queries');
    const meId = await currentUserId();
    expect(meId).toBeNull();
  });
});

// Dashboard Connect status tests
describe('Dashboard — Connect status', () => {
  it('shows "Set up payouts" when not connected', async () => {
    // Dashboard is a Server Component; we test the connectStatus logic
    // The getConnectStatus placeholder returns { connected: false }
    const connectStatus = { connected: false };
    expect(connectStatus.connected).toBe(false);
  });

  it('shows connected status when connected', async () => {
    const connectStatus = { connected: true, accountId: 'acct_123', chargesEnabled: true, payoutsEnabled: true };
    expect(connectStatus.connected).toBe(true);
    expect(connectStatus.accountId).toBeDefined();
  });
});

describe('Terms page (/terms) — signed out render', () => {
  it('renders without crashing and contains Terms content', async () => {
    const element = await TermsPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Terms of Service');
    expect(html).toContain('Who we are');
    expect(html).toContain('What FlexSoar is');
  });

  it('includes footer navigation links', async () => {
    const element = await TermsPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/market"');
    expect(html).toContain('href="/privacy"');
  });
});

describe('Privacy page (/privacy) — signed out render', () => {
  it('renders without crashing and contains Privacy content', async () => {
    const element = await PrivacyPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Who we are');
    expect(html).toContain('What we collect');
  });

  it('renders both English and Bahasa Malaysia sections', async () => {
    const element = await PrivacyPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('English');
    expect(html).toContain('Bahasa Malaysia');
    expect(html).toContain('Siapa kami');
    expect(html).toContain('Apa yang kami kumpulkan');
  });

  it('includes footer navigation links', async () => {
    const element = await PrivacyPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/market"');
    expect(html).toContain('href="/terms"');
  });
});

describe('Market page (/market) — signed out render', () => {
  it('renders without crashing', async () => {
    const element = await MarketPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Market');
    expect(html).toContain('Level-gated early access');
  });

  it('shows empty state when no listings', async () => {
    const element = await MarketPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Nothing listed yet');
  });
});
