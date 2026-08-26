/**
 * scripts/seed.ts
 *
 * Walks one shoe the whole way through the pipeline against the LIVE Supabase
 * project, then prints the ledger and the provenance chain it produced. Also
 * leaves three more fixtures behind for the admin surfaces that have no other
 * way to be exercised against a fresh database — see ADMIN FIXTURES below.
 *
 *   consignment draft -> submitted -> in_transit -> received ->
 *   authenticating -> authenticated -> completed
 *   item graded + authenticated -> minted -> listed -> purchased -> redeemed
 *
 * ------------------------------------------------------------------
 * ADMIN FIXTURES (027 follow-up)
 *
 * scripts/seed.ts used to be the only thing populating a fresh database, and
 * it stopped at "purchased" — nothing here ever exercised /admin/submissions,
 * /admin/consignments' mid-flow view, or /admin/fulfilment's warehouse queue.
 * Three more things are seeded now, each unblocking one admin page:
 *
 *   1. The main card is REDEEMED after its purchase (fn_redeem_card), and its
 *      item is explicitly given `custody: 'warehouse'` so the redemption
 *      lands 'requested' rather than 'awaiting_seller' — the warehouse
 *      "Awaiting shipment" queue on /admin/fulfilment.
 *   2. A second, self-declared item is inserted directly with
 *      `status: 'pending_review'`, mirroring exactly what fn_submit_listing
 *      would write (that RPC needs a seller session this script does not
 *      have — see TWO CLIENTS below) — the queue on /admin/submissions.
 *   3. A second consignment is opened and advanced only to 'submitted',
 *      left there rather than walked to 'completed' — a live row on
 *      /admin/consignments with its TransitionControls still usable.
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
 * So this talks to PostgREST directly. Where a SECURITY DEFINER function does
 * exist it is called by RPC with exactly the argument names
 * lib/api/contract.ts uses, so this still exercises the real mutation path.
 * AGENT_RULES.md's "all writes go through the contract" governs components; a
 * seed script establishing rows the schema has no RPC for is the documented
 * exception.
 *
 * ------------------------------------------------------------------
 * TWO CLIENTS, BECAUSE 005 SPLIT THE CALLERS
 *
 *   service-role    direct table writes, fn_list_card, fn_purchase_card,
 *                   and the reads at the end. Bypasses RLS.
 *   admin session   fn_mint_card and fn_advance_consignment ONLY.
 *
 * 005_admin_guards.sql checks `is_admin` inside those two functions against
 * auth.uid(). The service key has no auth.uid(), so calling them with it is
 * refused outright ("admin privileges required"). They need a genuinely
 * signed-in admin, so this script creates one — a real auth.users row with a
 * password — and signs in with the anon key to get a session.
 *
 * That auth user is the only thing here that is not a plain table row. It is
 * created once and reused; see HANDOFF.md for how to remove it.
 *
 * ------------------------------------------------------------------
 * RE-RUNNABLE
 *
 * The two users and the SKU model + its size variants have fixed identities
 * and are created only if absent. Everything downstream — consignment, item,
 * card, listing, order, redemption, submission, second consignment — is
 * created fresh on each run, so every run exercises the full path end to end
 * rather than reporting that there was nothing to do. Each run therefore adds
 * one card, one settled order, one redemption, one pending_review submission,
 * and one more consignment sitting in 'submitted'.
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
 * The admin. Unlike the two above, this one needs a REAL auth.users row:
 * 005_admin_guards.sql resolves the caller through auth.uid(), so a fabricated
 * auth_id would not authenticate. Its id therefore comes from Supabase at
 * creation rather than being hard-coded.
 *
 * The password is a fixed test credential for a seeded dev account. Override
 * it with SEED_ADMIN_PASSWORD if the project is reachable by anyone else.
 */
const ADMIN = {
  handle: 'seed_admin',
  email: 'seed_admin@flexsoar.test',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'seed-admin-dev-only-3f9c2a',
};

/**
 * Natural key is (brand, model, colorway) — unique in 027_sku_models.sql
 * (sku_models_identity_uidx). $180 puts the model in tier 3 (Rare:
 * 12000..25000) via fn_tier_for_sku, which reads base_price_cents. Tier comes
 * from this alone; the float below never touches it.
 *
 * Two sizes on purpose: 027's whole success metric is "models with more than
 * one card", which is structurally impossible to measure with one size per
 * model. US10 carries the main pipeline below; US9 carries the pending_review
 * submission fixture, so both variants end up minted or mintable.
 */
const SKU_MODEL = {
  brand: 'Nike',
  model: 'Air Max 1',
  colorway: 'Seed Grey',
  base_price_cents: 18_000 as Cents,
  sprite_key: 'lowtop',
};

const MAIN_SIZE_US = 10.0;
const SUBMISSION_SIZE_US = 9.0;

/**
 * The six rubric scores a human would enter, per docs/GRADING_RUBRIC.md.
 * A near-deadstock pair: clean tread, no yellowing, faint flex crease, box and
 * original laces slightly off.
 *
 * The float is NOT written here — it is derived below, the way the rubric
 * requires and the way items_grade_components_sum enforces. Scoring the
 * components first is the whole point; picking the float and back-filling
 * components to justify it is exactly what 008 made impossible.
 */
const GRADE_COMPONENTS = {
  outsole: 0.08,
  midsole: 0.05,
  creasing: 0.06,
  upper: 0.05,
  heel: 0.05,
  accessories: 0.1,
};

/** Weights from 008_grading.sql / docs/GRADING_RUBRIC.md. */
const GRADE_WEIGHTS = {
  outsole: 0.25,
  midsole: 0.2,
  creasing: 0.2,
  upper: 0.2,
  heel: 0.1,
  accessories: 0.05,
};

/**
 * Mirrors the constraint (items_grade_components_sum) in INTEGER arithmetic,
 * the same way lib/db/grading.ts does (this script cannot import it — the
 * contract's module graph reaches next/headers). Binary FP rounds exact
 * half-milli ties down while Postgres numeric rounds them half away from
 * zero, so an FP version of this produced floats the constraint rejects —
 * see docs/handoff/admin.md item 5. Hundredths x whole percents land exactly
 * in ten-thousandths; one half-up rounding at the end matches numeric.
 *
 * Shared by both graded fixtures below (the main item's admin grade and the
 * submission's seller-declared grade) so the tricky rounding lives in one
 * place rather than two copies that could drift apart.
 */
function floatFromComponents(components: typeof GRADE_COMPONENTS): FloatValue {
  const tenThousandths =
    Math.round(components.outsole * 100) * Math.round(GRADE_WEIGHTS.outsole * 100) +
    Math.round(components.midsole * 100) * Math.round(GRADE_WEIGHTS.midsole * 100) +
    Math.round(components.creasing * 100) * Math.round(GRADE_WEIGHTS.creasing * 100) +
    Math.round(components.upper * 100) * Math.round(GRADE_WEIGHTS.upper * 100) +
    Math.round(components.heel * 100) * Math.round(GRADE_WEIGHTS.heel * 100) +
    Math.round(components.accessories * 100) * Math.round(GRADE_WEIGHTS.accessories * 100);
  return (Math.floor(tenThousandths / 10) + (tenThousandths % 10 >= 5 ? 1 : 0)) / 1000;
}

const GRADED_FLOAT: FloatValue = floatFromComponents(GRADE_COMPONENTS);

/** What the consignor asks for the card. */
const LIST_PRICE_CENTS: Cents = 21_500;

// ------------------------------------------------------------
// ADMIN FIXTURES — see the ADMIN FIXTURES note at the top of this file
// ------------------------------------------------------------

/** Handling fee recorded on the redemption below (013's ledger shape). */
const REDEMPTION_FEE_CENTS: Cents = 500;

/** shipping_address is jsonb; app/admin/fulfilment/page.tsx's formatAddress() reads these keys. */
const SHIP_TO = {
  name: 'Seed Buyer',
  line1: '1 Jalan Seed',
  line2: '',
  city: 'Kuala Lumpur',
  state: 'WP',
  postal_code: '50000',
  country: 'MY',
};

/**
 * A more worn pair than the main fixture, so the two submissions in the
 * pipeline are visibly distinct rather than copy-pasted numbers.
 */
const SUBMISSION_GRADE_COMPONENTS = {
  outsole: 0.65,
  midsole: 0.55,
  creasing: 0.6,
  upper: 0.7,
  heel: 0.6,
  accessories: 0.3,
};

const SUBMISSION_FLOAT: FloatValue = floatFromComponents(SUBMISSION_GRADE_COMPONENTS);

/** Placeholder https URLs — fn_submit_listing's own guard needs >= 4, all https. */
const SUBMISSION_PHOTOS = [
  'https://picsum.photos/seed/flexsoar-seed-sub-1/800',
  'https://picsum.photos/seed/flexsoar-seed-sub-2/800',
  'https://picsum.photos/seed/flexsoar-seed-sub-3/800',
  'https://picsum.photos/seed/flexsoar-seed-sub-4/800',
];

const SUBMISSION_ASKING_PRICE_CENTS: Cents = 16_000;

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

/** Bypasses RLS. Everything except the two admin-guarded RPCs. */
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

/**
 * A signed-in admin, for the two functions 005 guards.
 *
 * Idempotent, and in this order on purpose: try to sign in first, and only
 * reach for the Admin API if that fails. On a re-run the auth user already
 * exists and this is a single request.
 *
 * @returns a client carrying the admin's session, plus their `users.id`.
 */
async function ensureAdminSession(): Promise<{
  // `typeof supabase`, not ReturnType<typeof createClient>: the latter drops
  // createClient's generic defaults and degrades .rpc() args to never.
  client: typeof supabase;
  userId: UUID;
}> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let signIn = await client.auth.signInWithPassword({
    email: ADMIN.email,
    password: ADMIN.password,
  });

  if (signIn.error) {
    // No such auth user yet (or the password was rotated). Create it with the
    // service key. email_confirm skips the confirmation mail — there is no
    // inbox behind @flexsoar.test.
    const created = await supabase.auth.admin.createUser({
      email: ADMIN.email,
      password: ADMIN.password,
      email_confirm: true,
    });

    if (created.error) {
      throw new Error(
        `create the seed admin auth user: ${created.error.message}` +
          ' (if it exists with a different password, set SEED_ADMIN_PASSWORD)',
      );
    }
    detail(`${ADMIN.handle} auth user created`);

    signIn = await client.auth.signInWithPassword({
      email: ADMIN.email,
      password: ADMIN.password,
    });
    if (signIn.error) {
      throw new Error(`sign in as the seed admin: ${signIn.error.message}`);
    }
  }

  const authUserId = signIn.data.user?.id;
  if (!authUserId) throw new Error('sign in returned no user');

  // The users row behind the auth identity. id = auth_id, per the
  // users_id_matches_auth trigger, and is_admin is the whole point.
  const existing = await supabase
    .from('users')
    .select('id, is_admin')
    .eq('auth_id', authUserId)
    .maybeSingle();

  if (existing.error) throw new Error(`look up the admin user: ${existing.error.message}`);

  if (!existing.data) {
    // Service-role, necessarily: 006's users_self_insert policy allows a user
    // to provision themselves but pins `is_admin = false`, precisely so nobody
    // can self-promote. Seeding an admin is the legitimate exception, and it
    // is why this runs with the service key rather than through the session
    // that was just established above.
    ok(
      await supabase
        .from('users')
        .insert({
          id: authUserId,
          auth_id: authUserId,
          handle: ADMIN.handle,
          email: ADMIN.email,
          country_code: 'MY',
          is_admin: true,
        })
        .select('id')
        .single(),
      'create the admin users row',
    );
    detail(`${ADMIN.handle} users row created (is_admin)`);
  } else {
    const row = existing.data as { id: UUID; is_admin: boolean };
    if (!row.is_admin) {
      ok(
        await supabase
          .from('users')
          .update({ is_admin: true })
          .eq('id', row.id)
          .select('id')
          .single(),
        'promote the admin users row',
      );
      detail(`${ADMIN.handle} promoted to is_admin`);
    } else {
      detail(`${ADMIN.handle} already exists (is_admin) — reused`);
    }
  }

  return { client, userId: authUserId as UUID };
}

/**
 * Direct table write, service-role — NOT the fn_create_sku_model RPC.
 * fn_create_sku_model calls fn_require_admin(), which resolves the caller
 * through auth.uid(); the service key has none, so an RPC call would be
 * refused with "admin privileges required" exactly like fn_mint_card and
 * fn_advance_consignment are (see TWO CLIENTS above). This mirrors the same
 * exception the file's header already documents for tables with no usable
 * RPC path from a plain script.
 *
 * Never writes skus.market_price_cents anywhere in this file — see
 * ensureSkuVariant() below. base_price_cents here is the ORACLE.
 */
async function ensureSkuModel(): Promise<{ id: UUID; base_price_cents: Cents }> {
  const found = await supabase
    .from('sku_models')
    .select('id, base_price_cents')
    .eq('brand', SKU_MODEL.brand)
    .eq('model', SKU_MODEL.model)
    .eq('colorway', SKU_MODEL.colorway)
    .maybeSingle();

  if (found.error) throw new Error(`look up sku_model: ${found.error.message}`);

  if (found.data) {
    const model = found.data as { id: UUID; base_price_cents: Cents };
    detail(`${SKU_MODEL.brand} ${SKU_MODEL.model} "${SKU_MODEL.colorway}" already exists — reused`);
    return model;
  }

  const created = ok(
    await supabase
      .from('sku_models')
      .insert({
        brand: SKU_MODEL.brand,
        model: SKU_MODEL.model,
        colorway: SKU_MODEL.colorway,
        base_price_cents: SKU_MODEL.base_price_cents,
        price_confidence: 0.9,
        priced_at: new Date().toISOString(),
        demand_score: 42.5,
        sprite_key: SKU_MODEL.sprite_key,
      })
      .select('id, base_price_cents')
      .single(),
    'create sku_model',
  ) as { id: UUID; base_price_cents: Cents };

  detail(`${SKU_MODEL.brand} ${SKU_MODEL.model} "${SKU_MODEL.colorway}" created`);
  return created;
}

/**
 * A size variant beneath a model. Same service-role-vs-RPC reasoning as
 * ensureSkuModel(): fn_ensure_sku_variant is safe for any signed-in seller,
 * but it still requires a real session (fn_current_user_id()), which the
 * service key does not have — so this is a direct table write too.
 *
 * Supplies model_id and size_us ONLY (plus the placeholder identity columns
 * trg_sku_variant_derive immediately overwrites, mirroring
 * fn_ensure_sku_variant's own insert shape). market_price_cents is NEVER
 * supplied — trg_sku_variant_derive derives it from the model's
 * base_price_cents x size_multiplier and RAISES on a direct write.
 */
async function ensureSkuVariant(
  modelId: UUID,
  sizeUs: number,
): Promise<{ id: UUID; market_price_cents: Cents }> {
  const found = await supabase
    .from('skus')
    .select('id, market_price_cents')
    .eq('model_id', modelId)
    .eq('size_us', sizeUs)
    .maybeSingle();

  if (found.error) throw new Error(`look up variant US${sizeUs}: ${found.error.message}`);

  if (found.data) {
    const variant = found.data as { id: UUID; market_price_cents: Cents };
    detail(`US${sizeUs} variant already exists — reused`);
    return variant;
  }

  const created = ok(
    await supabase
      .from('skus')
      .insert({
        brand: '',
        model: '',
        colorway: '',
        model_id: modelId,
        size_us: sizeUs,
        size_multiplier: 1.0,
        retail_price_cents: 15_000,
      })
      .select('id, market_price_cents')
      .single(),
    `create variant US${sizeUs}`,
  ) as { id: UUID; market_price_cents: Cents };

  detail(`US${sizeUs} variant created — market price ${money(created.market_price_cents)} (derived)`);
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
  console.log('  service-role + an admin session, no Stripe call, no RNG');

  // ---- participants -------------------------------------------------
  step('Ensuring the two seed users');
  const consignor = await ensureUser(CONSIGNOR, true);
  const buyer = await ensureUser(BUYER, false);

  step('Signing in as the seed admin');
  detail('005 guards fn_mint_card and fn_advance_consignment on auth.uid()');
  const admin = await ensureAdminSession();
  detail(`session established, users.id ${admin.userId}`);

  step('Ensuring the SKU model');
  const model = await ensureSkuModel();
  detail(`base oracle price ${money(model.base_price_cents)} — this alone sets the tier`);

  step('Ensuring the size variants');
  const mainVariant = await ensureSkuVariant(model.id, MAIN_SIZE_US);
  const submissionVariant = await ensureSkuVariant(model.id, SUBMISSION_SIZE_US);
  detail(
    `US${MAIN_SIZE_US} market price ${money(mainVariant.market_price_cents)}, ` +
      `US${SUBMISSION_SIZE_US} ${money(submissionVariant.market_price_cents)} — both derived from the model`,
  );
  detail('two sizes under one model: "models with more than one card" now has a real case');

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
  detail('custody: warehouse — this item is physically authenticated below, not seller-held');
  const item = ok(
    await supabase
      .from('items')
      .insert({
        sku_id: mainVariant.id,
        consignment_id: consignment.id,
        consignor_id: consignor.id,
        status: 'pending_intake',
        custody: 'warehouse',
        photos: [],
      })
      .select('id, status')
      .single(),
    'create item',
  ) as { id: UUID; status: string };
  detail(`item ${item.id} (pending_intake, no float yet)`);

  step('Walking the consignment state machine via fn_advance_consignment');
  detail('on the admin session — service-role is refused here since 005');
  detail(`p_actor is deliberately wrong (${buyer.handle}); 005 ignores it and`);
  detail('records the session identity instead, so history cannot be forged');

  let from: ConsignmentStatus = 'draft';
  for (const to of CONSIGNMENT_PATH) {
    const advanced = await admin.client.rpc('fn_advance_consignment', {
      p_id: consignment.id,
      p_to: to,
      // Deliberately not the real actor. Proven below against
      // consignment_events, which records the admin regardless.
      p_actor: buyer.id,
      p_note: `seed: ${from} -> ${to}`,
    });
    if (advanced.error) {
      throw new Error(`fn_advance_consignment ${from} -> ${to}: ${advanced.error.message}`);
    }
    detail(`${from} -> ${to}`);
    from = to;
  }

  // ---- grading ------------------------------------------------------
  step('Grading the item via fn_grade_item');
  detail('scores are typed by a human against the rubric — never computed, never random');
  detail('the float is derived from them, not chosen: the DB constraint checks it');

  const graded = await admin.client.rpc('fn_grade_item', {
    p_item_id: item.id,
    p_float: GRADED_FLOAT,
    p_notes: 'seed: faint flex crease on the toebox, clean midsole, box slightly shelfworn',
    p_outsole: GRADE_COMPONENTS.outsole,
    p_midsole: GRADE_COMPONENTS.midsole,
    p_creasing: GRADE_COMPONENTS.creasing,
    p_upper: GRADE_COMPONENTS.upper,
    p_heel: GRADE_COMPONENTS.heel,
    p_accessories: GRADE_COMPONENTS.accessories,
  });
  if (graded.error) throw new Error(`fn_grade_item: ${graded.error.message}`);

  for (const [name, weight] of Object.entries(GRADE_WEIGHTS)) {
    const score = GRADE_COMPONENTS[name as keyof typeof GRADE_COMPONENTS];
    detail(
      `  ${name.padEnd(11)} ${score.toFixed(2)} x ${String(weight).padEnd(4)} = ` +
        (score * weight).toFixed(4),
    );
  }
  detail(`  ${'float'.padEnd(11)} ${GRADED_FLOAT.toFixed(3)} (Factory New)`);

  step('Authenticating the item via fn_authenticate_item');
  detail('graded and authenticated are independent; both done moves it to in_custody');
  const authed = await admin.client.rpc('fn_authenticate_item', {
    p_item_id: item.id,
    p_location: 'KL-WAREHOUSE-01',
  });
  if (authed.error) throw new Error(`fn_authenticate_item: ${authed.error.message}`);

  const afterGrading = ok(
    await supabase
      .from('items')
      .select(
        'status, float_value, grade_outsole, grade_midsole, grade_creasing, ' +
          'grade_upper, grade_heel, grade_accessories, graded_by, custody_location',
      )
      .eq('id', item.id)
      .single(),
    'read graded item',
  ) as { status: string; float_value: number; graded_by: UUID };

  detail(`status ${afterGrading.status}, float ${Number(afterGrading.float_value).toFixed(3)}`);
  // fn_grade_item stamps graded_by from the session, like 005 does for actors.
  detail(
    `graded_by recorded as ${afterGrading.graded_by === admin.userId ? ADMIN.handle : afterGrading.graded_by}`,
  );

  // ---- mint ---------------------------------------------------------
  step('Minting the card via fn_mint_card');
  detail('also on the admin session — the mint is admin-gated inside the function');
  const cardId = ok(
    await admin.client.rpc('fn_mint_card', {
      p_item_id: item.id,
      p_owner_id: consignor.id,
    }),
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
  detail(`tier ${card.tier} from the model's ${money(model.base_price_cents)} base price, not from the float`);
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

  // ---- redemption -----------------------------------------------------
  // Admin fixture 1/3 — see the ADMIN FIXTURES note at the top of this file.
  // fn_redeem_card is ownership-checked by p_user_id, not by auth.uid() (it
  // is not in 005's admin-guarded set), so the service-role client can call
  // it directly, same as fn_list_card and fn_purchase_card above.
  step('Redeeming the card via fn_redeem_card');
  detail("burning the card back into a physical shoe the buyer now owns");
  detail("item.custody is 'warehouse', so this lands 'requested', not 'awaiting_seller'");
  const redemptionId = ok(
    await supabase.rpc('fn_redeem_card', {
      p_card_id: cardId,
      p_user_id: buyer.id,
      p_address: SHIP_TO,
      p_fee_cents: REDEMPTION_FEE_CENTS,
    }),
    'fn_redeem_card',
  ) as UUID;

  const redemption = ok(
    await supabase
      .from('redemptions')
      .select('id, status, handling_fee_cents, requested_at')
      .eq('id', redemptionId)
      .single(),
    'read redemption',
  ) as { id: UUID; status: string; handling_fee_cents: Cents; requested_at: Timestamptz };

  detail(`redemption ${redemption.id} (${redemption.status}), fee ${money(redemption.handling_fee_cents)}`);
  detail("unblocks /admin/fulfilment's warehouse 'Awaiting shipment' queue");

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
    if (accountId === admin.userId) return ADMIN.handle;
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

  // ---- audit trail --------------------------------------------------
  heading('CONSIGNMENT EVENTS — the actor comes from the session, not p_actor');

  const events = ok(
    await supabase
      .from('consignment_events')
      .select('id, from_status, to_status, actor_id, note')
      .eq('consignment_id', consignment.id)
      .order('id', { ascending: true }),
    'read consignment events',
  ) as {
    id: number;
    from_status: ConsignmentStatus | null;
    to_status: ConsignmentStatus;
    actor_id: UUID | null;
    note: string | null;
  }[];

  table(
    ['from', 'to', 'actor_id recorded'],
    events.map((event) => [
      event.from_status ?? '—',
      event.to_status,
      handleOf(event.actor_id, false),
    ]),
  );

  const forged = events.filter((event) => event.actor_id === buyer.id);
  console.log('');
  console.log(`  every call passed p_actor = ${buyer.handle} (the wrong user)`);
  console.log(
    `  events recording ${buyer.handle}: ${forged.length} ${forged.length === 0 ? '✓' : '✗'}`,
  );
  console.log(
    `  events recording ${ADMIN.handle}: ` +
      `${events.filter((e) => e.actor_id === admin.userId).length}/${events.length} ✓`,
  );

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

  // ---- pending_review submission -------------------------------------
  // Admin fixture 2/3. Direct table write, not the fn_submit_listing RPC:
  // that function resolves the caller through fn_current_user_id() (auth.uid()),
  // and CONSIGNOR has no real auth.users row behind it (see FIXED IDENTITIES
  // above) — only ADMIN does. This insert matches fn_submit_listing's own
  // column list and values exactly (013_seller_custody.sql), just written
  // directly under the service key instead of through a seller session.
  heading('SUBMISSION — a self-declared item awaiting review');

  const submission = ok(
    await supabase
      .from('items')
      .insert({
        sku_id: submissionVariant.id,
        consignor_id: consignor.id,
        custody: 'seller',
        custody_holder_id: consignor.id,
        grade_source: 'seller_declared',
        status: 'pending_review',
        float_value: SUBMISSION_FLOAT,
        graded_by: consignor.id,
        graded_at: new Date().toISOString(),
        grading_notes: 'seed: seller-declared, worn but honest — see the component scores',
        photos: SUBMISSION_PHOTOS,
        asking_price_cents: SUBMISSION_ASKING_PRICE_CENTS,
        submitted_payout: 'credit',
        last_proof_at: new Date().toISOString(),
        grade_outsole: SUBMISSION_GRADE_COMPONENTS.outsole,
        grade_midsole: SUBMISSION_GRADE_COMPONENTS.midsole,
        grade_creasing: SUBMISSION_GRADE_COMPONENTS.creasing,
        grade_upper: SUBMISSION_GRADE_COMPONENTS.upper,
        grade_heel: SUBMISSION_GRADE_COMPONENTS.heel,
        grade_accessories: SUBMISSION_GRADE_COMPONENTS.accessories,
      })
      .select('id, status, float_value')
      .single(),
    'create submission',
  ) as { id: UUID; status: string; float_value: FloatValue };

  detail(`item ${submission.id} (${submission.status}), declared float ${Number(submission.float_value).toFixed(3)}`);
  detail(`asking ${money(SUBMISSION_ASKING_PRICE_CENTS)}, US${SUBMISSION_SIZE_US} of the same model`);
  detail('unblocks /admin/submissions — the pending_review queue');

  // ---- second consignment, left mid-flow ------------------------------
  // Admin fixture 3/3. Advanced only to 'submitted' via the same admin
  // session and RPC the main pipeline above uses, then left there — the
  // main pipeline's own consignment reaches 'completed' in this same run,
  // so without this one /admin/consignments would have nothing mid-flow to
  // show TransitionControls against.
  heading('SECOND CONSIGNMENT — left in submitted, not walked to completed');

  const secondConsignment = ok(
    await supabase
      .from('consignments')
      .insert({
        consignor_id: consignor.id,
        status: 'draft',
        item_count: 1,
        intake_fee_cents: 0,
        notes: 'seed script: intentionally left mid-flow for the admin bench',
      })
      .select('id, status')
      .single(),
    'create second consignment',
  ) as { id: UUID; status: ConsignmentStatus };

  const secondItem = ok(
    await supabase
      .from('items')
      .insert({
        sku_id: mainVariant.id,
        consignment_id: secondConsignment.id,
        consignor_id: consignor.id,
        status: 'pending_intake',
        custody: 'warehouse',
        photos: [],
      })
      .select('id')
      .single(),
    'create second consignment item',
  ) as { id: UUID };

  const advancedSecond = await admin.client.rpc('fn_advance_consignment', {
    p_id: secondConsignment.id,
    p_to: 'submitted',
    p_actor: consignor.id,
    p_note: 'seed: draft -> submitted',
  });
  if (advancedSecond.error) {
    throw new Error(`fn_advance_consignment (second) draft -> submitted: ${advancedSecond.error.message}`);
  }

  detail(`consignment ${secondConsignment.id} (submitted), item ${secondItem.id} (pending_intake)`);
  detail('unblocks /admin/consignments — a mid-flow row with TransitionControls still live');

  heading('DONE');
  console.log(`  card                ${cardId}`);
  console.log(`  listing             ${listingId}`);
  console.log(`  order               ${orderId}`);
  console.log(`  redemption          ${redemptionId}`);
  console.log(`  submission          ${submission.id}`);
  console.log(`  second consignment  ${secondConsignment.id}`);
  console.log(`  re-run to walk another shoe through; the users and SKU model are reused.\n`);
}

main().catch((thrown: unknown) => {
  // Verbatim, per AGENT_RULES.md.
  console.error(`\nseed failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  process.exit(1);
});
