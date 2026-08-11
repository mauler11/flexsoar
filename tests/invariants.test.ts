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
