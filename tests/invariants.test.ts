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

import { describe, expect, it } from 'vitest';

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
import { TIER_BANDS, tierForPrice } from '../lib/domain/rarity';
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
import type { Card, Sku, User } from '../lib/db/types';

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
 * fn_payout_method_for_user (018-020). cash_payout_countries live-verified
 * against the project (2026-08-21): exactly one row, country_code 'MY'.
 * Decoupled from HOW the buyer paid — splitSettlement() above never looks at
 * the seller, and this never looks at the buyer's payment method.
 */
const CASH_PAYOUT_COUNTRIES = ['MY'];
const derivePayoutMethod = (countryCode: string | null | undefined): 'cash' | 'credit' =>
  countryCode && CASH_PAYOUT_COUNTRIES.includes(countryCode) ? 'cash' : 'credit';

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
  it('resolves MY to cash and everything else — including null — to credit', () => {
    expect(derivePayoutMethod('MY')).toBe('cash');
    expect(derivePayoutMethod('SG')).toBe('credit');
    expect(derivePayoutMethod('US')).toBe('credit');
    expect(derivePayoutMethod(null)).toBe('credit');
    expect(derivePayoutMethod(undefined)).toBe('credit');
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
  | 'SETTLEMENT_REF_REQUIRED' | 'CREDIT_HOLD_EXPIRED' | 'UNKNOWN';

/**
 * Mirrors isPermanentError() in route.ts. CREDIT_HOLD_EXPIRED is deliberately
 * excluded — route.ts intercepts it before this check runs, because unlike
 * every code here it means the buyer's cash already moved through Stripe and
 * needs louder handling than a quiet acknowledge.
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

  it('lets an unmapped code fall through to a 500 retry rather than silently acknowledging', () => {
    expect(isPermanentError('UNKNOWN')).toBe(false);
  });
});
