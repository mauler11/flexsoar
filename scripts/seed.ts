/**
 * scripts/seed.ts
 *
 * Walks one shoe the whole way through the pipeline against the LIVE Supabase
 * project, then prints the ledger and the provenance chain it produced.
 *
 *   consignment draft -> submitted -> in_transit -> received ->
 *   authenticating -> authenticated -> completed
 *   item graded + authenticated -> minted -> listed -> purchased
 *
 * Run:
 *   node --env-file=.env.local --experimental-strip-types scripts/seed.ts
 *
 * ------------------------------------------------------------------
 * WHY THIS DOES NOT IMPORT lib/api/contract.ts
 *
 * Two hard reasons, not a preference:
 *
 *   1. The contract's read path and three of its mutations go through
 *      createServerSupabase(), which calls `cookies()` from next/headers.
 *      That only resolves inside a Next request scope; from plain node it
 *      throws. A seed script has no request.
 *   2. Most of what seeding needs has no RPC at all. 002_operations.sql has
 *      no function to create a user, a SKU, a consignment or an item, and
 *      none to grade or authenticate one. Those are direct table writes, and
 *      only the service role can make them — no table has an INSERT policy.
 *
 * So this talks to PostgREST directly with the service-role key. Where a
 * SECURITY DEFINER function does exist it is called by RPC with exactly the
 * argument names lib/api/contract.ts uses, so this still exercises the real
 * mutation path. AGENT_RULES.md's "all writes go through the contract" governs
 * components; a seed script establishing rows the schema has no RPC for is the
 * documented exception.
 *
 * ------------------------------------------------------------------
 * RE-RUNNABLE
 *
 * The two users and the SKU have fixed identities and are created only if
 * absent. Everything downstream — consignment, item, card, listing, order — is
 * created fresh on each run, so every run exercises the full path end to end
 * rather than reporting that there was nothing to do. Each run therefore adds
 * one card and one settled order.
 *
 * The fabricated settlement_ref ("seed_pi_<n>") is numbered from the count of
 * existing seed orders. No Stripe call is made; fn_purchase_card only records
 * a settlement that it is told already happened.
 */

import { createClient } from '@supabase/supabase-js';

import type {
  Cents,
  ConsignmentStatus,
  FloatValue,
  LedgerEntry,
  Timestamptz,
  UUID,
} from '@/lib/db/types';

// ------------------------------------------------------------
// FIXED IDENTITIES
// ------------------------------------------------------------

/**
 * users.id must equal users.auth_id — enforced by the users_id_matches_auth
 * trigger in 004_rls_and_grants.sql, because every RLS policy resolves
 * auth.uid() through that pair. These stand in for auth.users rows that do not
 * exist; `users.auth_id` is a bare unique uuid with no FK, so that is legal.
 *
 * Hard-coded rather than generated: the script has to find the same two users
 * on the next run, and AGENT_RULES.md rules out RNG anywhere in this codebase.
 */
const CONSIGNOR = {
  id: '5eed0000-0000-4000-8000-000000000001' as UUID,
  handle: 'seed_consignor',
  email: 'seed_consignor@flexsoar.test',
};

const BUYER = {
  id: '5eed0000-0000-4000-8000-000000000002' as UUID,
  handle: 'seed_buyer',
  email: 'seed_buyer@flexsoar.test',
};

/**
 * Natural key is (brand, model, colorway, size_us) — unique in 001_schema.sql.
 *
 * $180 puts the SKU in tier 3 (Rare: 12000..25000). Tier comes from this base
 * price alone; the float below never touches it.
 */
const SKU = {
  brand: 'Nike',
  model: 'Air Max 1',
  colorway: 'Seed Grey',
  size_us: 10.0,
  market_price_cents: 18_000 as Cents,
  sprite_key: 'lowtop',
};

/** Human-graded at intake. 0.062 = Factory New. Copied to the card, then immutable. */
const GRADED_FLOAT: FloatValue = 0.062;

/** What the consignor asks for the card. */
const LIST_PRICE_CENTS: Cents = 21_500;

/** The happy path through fn_advance_consignment's CASE block, in order. */
const CONSIGNMENT_PATH: ConsignmentStatus[] = [
  'submitted',
  'in_transit',
  'received',
  'authenticating',
  'authenticated',
  'completed',
];

// ------------------------------------------------------------
// CLIENT
// ------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run with: node --env-file=.env.local --experimental-strip-types scripts/seed.ts`,
    );
  }
  return value;
}

const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * Throws on error rather than returning it. A seed script that half-works
 * leaves the database in a state nobody can reason about, so every step is
 * fatal.
 */
function ok<T>(
  result: { data: T | null; error: { message: string; code?: string } | null },
  step: string,
): T {
  if (result.error) throw new Error(`${step}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${step}: returned no data`);
  return result.data;
}

// ------------------------------------------------------------
// OUTPUT
// ------------------------------------------------------------

const money = (cents: Cents | null): string =>
  cents === null ? '—' : `$${(cents / 100).toFixed(2)}`;

let stepNumber = 0;
function step(message: string): void {
  stepNumber += 1;
  console.log(`\n[${String(stepNumber).padStart(2, '0')}] ${message}`);
}

function detail(message: string): void {
  console.log(`     ${message}`);
}

function heading(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

/** Left-aligns text columns, right-aligns numeric ones. */
function table(headers: string[], rows: string[][], rightAlign: number[] = []): void {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length)),
  );

  const render = (cells: string[]): string =>
    cells
      .map((cell, i) =>
        rightAlign.includes(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]),
      )
      .join('  ')
      .trimEnd();

  console.log(`  ${render(headers)}`);
  console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  for (const row of rows) console.log(`  ${render(row)}`);
}

// ------------------------------------------------------------
// STEPS
// ------------------------------------------------------------

interface SeedUser {
  id: UUID;
  handle: string;
  level: number;
}

/** Created only if absent — this is the "fixed handle" half of re-runnability. */
async function ensureUser(spec: typeof CONSIGNOR, isConsignor: boolean): Promise<SeedUser> {
  const found = await supabase
    .from('users')
    .select('id, handle, level')
    .eq('handle', spec.handle)
    .maybeSingle();

  if (found.error) throw new Error(`look up ${spec.handle}: ${found.error.message}`);

  if (found.data) {
    const user = found.data as SeedUser;
    detail(`${spec.handle} already exists (level ${user.level}) — reused`);
    return user;
  }

  const created = ok(
    await supabase
      .from('users')
      // id = auth_id, per the users_id_matches_auth trigger.
      .insert({
        id: spec.id,
        auth_id: spec.id,
        handle: spec.handle,
        email: spec.email,
        country_code: 'MY',
        is_consignor: isConsignor,
      })
      .select('id, handle, level')
      .single(),
    `create ${spec.handle}`,
  ) as SeedUser;

  detail(`${spec.handle} created (level ${created.level})`);
  return created;
}

async function ensureSku(): Promise<{ id: UUID; market_price_cents: Cents }> {
  const found = await supabase
    .from('skus')
    .select('id, market_price_cents')
    .eq('brand', SKU.brand)
    .eq('model', SKU.model)
    .eq('colorway', SKU.colorway)
    .eq('size_us', SKU.size_us)
    .maybeSingle();

  if (found.error) throw new Error(`look up sku: ${found.error.message}`);

  if (found.data) {
    const sku = found.data as { id: UUID; market_price_cents: Cents };
    detail(`${SKU.brand} ${SKU.model} "${SKU.colorway}" US${SKU.size_us} already exists — reused`);
    return sku;
  }

  const created = ok(
    await supabase
      .from('skus')
      .insert({
        brand: SKU.brand,
        model: SKU.model,
        colorway: SKU.colorway,
        size_us: SKU.size_us,
        market_price_cents: SKU.market_price_cents,
        retail_price_cents: 15_000,
        price_confidence: 0.9,
        priced_at: new Date().toISOString(),
        demand_score: 42.5,
        sprite_key: SKU.sprite_key,
      })
      .select('id, market_price_cents')
      .single(),
    'create sku',
  ) as { id: UUID; market_price_cents: Cents };

  detail(`${SKU.brand} ${SKU.model} "${SKU.colorway}" US${SKU.size_us} created`);
  return created;
}

/** Numbered from the seed orders already recorded, so re-runs never collide. */
async function nextSettlementRef(): Promise<string> {
  const existing = await supabase
    .from('orders')
    .select('settlement_ref')
    .like('settlement_ref', 'seed_pi_%');

  if (existing.error) throw new Error(`count seed orders: ${existing.error.message}`);

  const count = ((existing.data as { settlement_ref: string }[] | null) ?? []).length;
  return `seed_pi_${String(count + 1).padStart(3, '0')}`;
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

async function main(): Promise<void> {
  heading('FlexSoar seed — intake to settlement, against the live project');
  console.log(`  ${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}`);
  console.log('  service-role client, no Stripe call, no RNG');

  // ---- participants -------------------------------------------------
  step('Ensuring the two seed users');
  const consignor = await ensureUser(CONSIGNOR, true);
  const buyer = await ensureUser(BUYER, false);

  step('Ensuring the SKU');
  const sku = await ensureSku();
  detail(`base oracle price ${money(sku.market_price_cents)} — this alone sets the tier`);

  // ---- consignment --------------------------------------------------
  step('Opening a consignment in draft');
  const consignment = ok(
    await supabase
      .from('consignments')
      .insert({
        consignor_id: consignor.id,
        status: 'draft',
        item_count: 1,
        intake_fee_cents: 0,
        notes: 'seed script',
      })
      .select('id, status')
      .single(),
    'create consignment',
  ) as { id: UUID; status: ConsignmentStatus };
  detail(`consignment ${consignment.id} (draft)`);

  step('Adding the physical item, ungraded');
  const item = ok(
    await supabase
      .from('items')
      .insert({
        sku_id: sku.id,
        consignment_id: consignment.id,
        consignor_id: consignor.id,
        status: 'pending_intake',
        photos: [],
      })
      .select('id, status')
      .single(),
    'create item',
  ) as { id: UUID; status: string };
  detail(`item ${item.id} (pending_intake, no float yet)`);

  step('Walking the consignment state machine via fn_advance_consignment');
  let from: ConsignmentStatus = 'draft';
  for (const to of CONSIGNMENT_PATH) {
    const advanced = await supabase.rpc('fn_advance_consignment', {
      p_id: consignment.id,
      p_to: to,
      p_actor: consignor.id,
      p_note: `seed: ${from} -> ${to}`,
    });
    if (advanced.error) {
      throw new Error(`fn_advance_consignment ${from} -> ${to}: ${advanced.error.message}`);
    }
    detail(`${from} -> ${to}`);
    from = to;
  }

  // ---- grading ------------------------------------------------------
  step('Grading and authenticating the item');
  detail('float is typed by a human at intake — never computed, never random');
  ok(
    await supabase
      .from('items')
      .update({
        float_value: GRADED_FLOAT,
        graded_by: consignor.id,
        graded_at: new Date().toISOString(),
        grading_notes: 'seed: light creasing on the toebox, clean midsole',
        authenticated_at: new Date().toISOString(),
        authenticated_by: consignor.id,
        custody_location: 'KL-WAREHOUSE-01',
        status: 'in_custody',
      })
      .eq('id', item.id)
      .select('id, float_value, status')
      .single(),
    'grade item',
  );
  detail(`float ${GRADED_FLOAT.toFixed(3)} (Factory New), status in_custody`);

  // ---- mint ---------------------------------------------------------
  step('Minting the card via fn_mint_card');
  const cardId = ok(
    await supabase.rpc('fn_mint_card', { p_item_id: item.id, p_owner_id: consignor.id }),
    'fn_mint_card',
  ) as UUID;

  const card = ok(
    await supabase
      .from('cards')
      .select('id, tier, float_value, float_percentile, mint_number, status, owner_id, minted_at')
      .eq('id', cardId)
      .single(),
    'read card',
  ) as {
    id: UUID;
    tier: number;
    float_value: FloatValue;
    float_percentile: number | null;
    mint_number: number;
    status: string;
    owner_id: UUID;
    minted_at: Timestamptz;
  };

  detail(`card ${card.id}`);
  detail(`tier ${card.tier} from the ${money(sku.market_price_cents)} base price, not from the float`);
  detail(`float ${Number(card.float_value).toFixed(3)} copied off the item, immutable from here`);
  detail(`mint #${card.mint_number}, percentile ${card.float_percentile ?? '—'}`);

  // ---- list ---------------------------------------------------------
  step('Listing the card via fn_list_card');
  const listingId = ok(
    await supabase.rpc('fn_list_card', {
      p_card_id: cardId,
      p_seller_id: consignor.id,
      p_price_cents: LIST_PRICE_CENTS,
    }),
    'fn_list_card',
  ) as UUID;

  const listing = ok(
    await supabase
      .from('listings')
      .select('id, price_cents, oracle_value_cents, status, early_access_level, public_at')
      .eq('id', listingId)
      .single(),
    'read listing',
  ) as {
    id: UUID;
    price_cents: Cents;
    oracle_value_cents: Cents | null;
    status: string;
    early_access_level: number;
    public_at: Timestamptz;
  };

  detail(`listing ${listing.id} at ${money(listing.price_cents)} (${listing.status})`);
  detail(`oracle fair value ${money(listing.oracle_value_cents)} — shown to both sides, never hidden`);
  detail(`early access to level ${listing.early_access_level} until ${listing.public_at}`);

  // ---- purchase -----------------------------------------------------
  const settlementRef = await nextSettlementRef();
  step(`Recording the sale via fn_purchase_card (settlement_ref "${settlementRef}")`);
  detail('money is treated as already moved buyer -> seller; this only records it');

  const orderId = ok(
    await supabase.rpc('fn_purchase_card', {
      p_listing_id: listingId,
      p_buyer_id: buyer.id,
      p_settlement_ref: settlementRef,
    }),
    'fn_purchase_card',
  ) as UUID;

  const order = ok(
    await supabase
      .from('orders')
      .select('id, gross_cents, fee_bps, fee_cents, net_cents, status, txn_id, settlement_ref')
      .eq('id', orderId)
      .single(),
    'read order',
  ) as {
    id: UUID;
    gross_cents: Cents;
    fee_bps: number;
    fee_cents: Cents;
    net_cents: Cents;
    status: string;
    txn_id: UUID | null;
    settlement_ref: string | null;
  };

  detail(`order ${order.id} (${order.status})`);
  detail(
    `gross ${money(order.gross_cents)} — fee ${money(order.fee_cents)} ` +
      `(${order.fee_bps} bps, from the SELLER's level) = net ${money(order.net_cents)}`,
  );

  // ---- ledger -------------------------------------------------------
  heading('LEDGER — every entry touching this card, oldest first');

  // Currency legs carry card_id null, so find the transactions through the
  // card legs first, then pull each transaction whole.
  const cardLegs = ok(
    await supabase.from('ledger_entries').select('txn_id').eq('card_id', cardId),
    'read card ledger legs',
  ) as { txn_id: UUID }[];

  const txnIds = [...new Set(cardLegs.map((leg) => leg.txn_id))];

  const entries = ok(
    await supabase
      .from('ledger_entries')
      .select(
        'id, txn_id, entry_type, asset, account_id, is_platform, amount_cents, card_id, direction, settlement_ref, created_at',
      )
      .in('txn_id', txnIds)
      .order('id', { ascending: true }),
    'read ledger',
  ) as LedgerEntry[];

  const handleOf = (accountId: UUID | null, isPlatform: boolean): string => {
    if (isPlatform || accountId === null) return 'PLATFORM';
    if (accountId === consignor.id) return consignor.handle;
    if (accountId === buyer.id) return buyer.handle;
    return accountId.slice(0, 8);
  };

  // Shorten the txn uuids to something readable, keeping them distinguishable.
  const txnLabel = new Map(txnIds.map((id, i) => [id, `txn#${i + 1}`]));

  table(
    ['txn', 'entry_type', 'asset', 'account', 'dir', 'amount', 'settlement_ref'],
    entries.map((entry) => [
      txnLabel.get(entry.txn_id) ?? entry.txn_id.slice(0, 8),
      entry.entry_type,
      entry.asset,
      handleOf(entry.account_id, entry.is_platform),
      entry.direction === 1 ? '+1' : '-1',
      entry.asset === 'currency' ? money(entry.amount_cents) : `card ${card.mint_number}`,
      entry.settlement_ref ?? '—',
    ]),
    [4, 5],
  );

  // The deferred ledger_balanced trigger enforces this server-side; restating
  // it here makes the printout self-evidently consistent. A mint has no
  // currency legs at all — say so rather than reporting a vacuous zero.
  console.log('');
  for (const txnId of txnIds) {
    const currency = entries.filter((e) => e.txn_id === txnId && e.asset === 'currency');
    const label = txnLabel.get(txnId);

    if (currency.length === 0) {
      console.log(`  ${label} has no currency legs (card movement only)`);
      continue;
    }

    const sum = currency.reduce(
      (total, e) => total + (e.amount_cents ?? 0) * (e.direction ?? 0),
      0,
    );
    console.log(
      `  ${label} ${currency.length} currency legs net to ${sum} ${sum === 0 ? '✓' : '✗'}`,
    );
  }

  // ---- provenance ---------------------------------------------------
  heading('PROVENANCE — the ownership chain, oldest hop first');

  const chain = ok(
    await supabase
      .from('card_provenance')
      .select('id, owner_id, owner_level, acquired_at, released_at, price_cents')
      .eq('card_id', cardId)
      .order('acquired_at', { ascending: true })
      .order('id', { ascending: true }),
    'read provenance',
  ) as {
    id: number;
    owner_id: UUID;
    owner_level: number;
    acquired_at: Timestamptz;
    released_at: Timestamptz | null;
    price_cents: Cents | null;
  }[];

  table(
    ['#', 'owner', 'lvl', 'acquired_at', 'released_at', 'price'],
    chain.map((hop, i) => [
      String(i + 1),
      handleOf(hop.owner_id, false),
      String(hop.owner_level),
      hop.acquired_at,
      hop.released_at ?? '(current owner)',
      money(hop.price_cents),
    ]),
    [0, 2, 5],
  );

  const open = chain.filter((hop) => hop.released_at === null);
  const finalCard = ok(
    await supabase.from('cards').select('owner_id, status').eq('id', cardId).single(),
    'read final card',
  ) as { owner_id: UUID; status: string };

  console.log('');
  console.log(`  exactly one open hop: ${open.length === 1 ? '✓' : `✗ (${open.length})`}`);
  console.log(
    `  open hop matches cards.owner_id: ${
      open[0]?.owner_id === finalCard.owner_id ? '✓' : '✗'
    } (${handleOf(finalCard.owner_id, false)}, card is ${finalCard.status})`,
  );

  heading('DONE');
  console.log(`  card      ${cardId}`);
  console.log(`  listing   ${listingId}`);
  console.log(`  order     ${orderId}`);
  console.log(`  re-run to walk another shoe through; the users and SKU are reused.\n`);
}

main().catch((thrown: unknown) => {
  // Verbatim, per AGENT_RULES.md.
  console.error(`\nseed failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  process.exit(1);
});
