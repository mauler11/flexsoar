/**
 * components/admin/db-reads.ts
 *
 * LOCAL READ ADAPTERS — TEMPORARY, AND READS ONLY.
 *
 * Reads the admin screens need that `lib/api/contract.ts` does not expose
 * yet, each filed in docs/handoff/admin.md. The parallel-build rules allow a
 * local adapter for a contract gap; every one of these dies the day
 * track/data ships the real function:
 *
 *   - getSkuFloatCurve(skuId)      -> wants getFloatCurve(skuId)
 *   - getAdminSku(id)              -> wants a single-variant read; narrowed
 *                                   (027) to backing just the art-upload
 *                                   existence check now that the model page
 *                                   itself reads through getSkuModel()
 *   - getVariantCardCounts(ids)    -> wants card_count per variant.entry on
 *                                   SkuModelDetail.variants, the way
 *                                   listSkuModels() already aggregates it per
 *                                   model (027)
 *   - getPendingSubmissions() -> wants ItemsQuery to reach 'pending_review'
 *   - getSubmission(id)       -> wants the 013 columns on ItemSummary
 *   - getSellerHistory(id)    -> wants a trust read (012/013 columns on users)
 *   - getSellerHeldRedemptions() -> wants fulfiller_id/due_by/defaulted_at on
 *                                RedemptionSummary
 *   - getProofOverdue()       -> wants the items_proof_overdue view (013)
 *   - getPlatformConfig()     -> wants platform_config (011/013) on any surface
 *
 * The last six are all one shape of gap: migrations 010-013 are applied to the
 * live project but their `.sql` files are not in this worktree and nothing they
 * added has reached `lib/api/contract.ts` on any branch. `ItemStatus` in
 * lib/db/types.ts still has seven values and the database now has nine;
 * `RedemptionSummary` has no `due_by`. Filed as item 12 in
 * docs/handoff/admin.md, with the exact types asked for.
 *
 * getAdminItem() and getItemOwners() lived here until the 010-era sync landed
 * getItem() and consignor_id on the contract, and were deleted the same day —
 * the promised lifecycle.
 *
 * They are READS on the session client, relying on RLS the same way the
 * contract's own reads do: curve_read (009), items_admin_read (004),
 * redemptions_admin_read (009), the admin-read policy on `users` (006).
 * No write lives here and none may be added — the sanctioned local WRITE
 * adapters for this track live in components/admin/db-writes.ts and are
 * documented separately.
 *
 * Column projections mirror the contract's style. Never select *.
 *
 * Server-only the same way the contract is: lib/supabase/server.ts reads
 * `next/headers`, so importing this from a client component is a build error.
 * (The `server-only` marker package is not a dependency of this repo.)
 */

import type { FloatCurveBand, Sku, SkuRef } from "@/lib/api/contract";
import type { GradeComponents } from "@/lib/db/grading";
import type {
  Cents,
  FloatValue,
  ItemStatus,
  Json,
  RedemptionStatus,
  Timestamptz,
  UUID,
} from "@/lib/db/types";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The current bands, ordered by float_min — what setFloatCurve() will replace.
 * `curve_read` (009) is public, so no admin nuance here. An empty array is a
 * SKU on the linear fallback, which is a real state, not a failure.
 */
export async function getSkuFloatCurve(skuId: UUID): Promise<FloatCurveBand[]> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("sku_float_curve")
    .select("float_min, float_max, value_multiplier")
    .eq("sku_id", skuId)
    .order("float_min", { ascending: true });
  if (result.error) {
    throw new Error(`sku_float_curve: ${result.error.message}`, {
      cause: result.error,
    });
  }

  return (result.data ?? []) as FloatCurveBand[];
}

// ------------------------------------------------------------
// One SKU (variant), by id
// ------------------------------------------------------------

/**
 * A single variant row. As of 027 the model bench's edit page reads through
 * the contract's getSkuModel() instead — this now backs exactly one thing:
 * app/admin/skus/actions.ts's getSkuArtUploadUrlAction() confirming the
 * variant id it was handed actually exists before signing an R2 upload URL.
 * skus_read is public, so this needs no admin nuance of its own.
 */
export async function getAdminSku(skuId: UUID): Promise<Sku | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("skus")
    .select(
      "id, model_id, brand, model, colorway, size_us, retail_price_cents, market_price_cents, " +
        "size_multiplier, price_override_cents, " +
        "price_confidence, priced_at, demand_score, sprite_key, palette, mint_cap, created_at, art_url",
    )
    .eq("id", skuId)
    .maybeSingle();
  if (result.error) {
    throw new Error(`skus: ${result.error.message}`, { cause: result.error });
  }

  return (result.data as Sku | null) ?? null;
}

/**
 * Card counts for a set of variants, keyed by variant (skus.id) — the
 * per-size number the model detail page's VariantsTable needs, mirroring
 * exactly how the contract's own listSkuModels() aggregates a MODEL's total
 * card_count (027): a second query against `cards.sku_id`, not a join,
 * because PostgREST has no GROUP BY without a view or RPC and schema is
 * human-only. A variant with no cards is simply absent from the map — callers
 * read it with `?? 0`, same convention as listSkuModels()'s own maps.
 */
export async function getVariantCardCounts(
  variantIds: readonly UUID[],
): Promise<Map<UUID, number>> {
  const counts = new Map<UUID, number>();
  if (variantIds.length === 0) return counts;

  const supabase = await createServerSupabase();

  const result = await supabase
    .from("cards")
    .select("sku_id")
    .in("sku_id", variantIds as UUID[]);
  if (result.error) {
    throw new Error(`cards: ${result.error.message}`, { cause: result.error });
  }

  for (const row of (result.data ?? []) as { sku_id: UUID }[]) {
    counts.set(row.sku_id, (counts.get(row.sku_id) ?? 0) + 1);
  }
  return counts;
}

// ============================================================
// SUBMISSIONS AND SELLER CUSTODY — the 010-013 columns
// ============================================================
//
// Everything below reads columns and one view that exist in the live database
// but in no `.sql` file in this worktree and on no contract type. Each shape is
// declared here rather than in lib/db/types.ts, which is track/data's file and
// still describes the seven-value ItemStatus the database has outgrown.

/**
 * `items.status`, live. The contract's `ItemStatus` is the seven pre-013
 * values; 013 added the two a seller-submitted listing passes through before it
 * is either minted or sent back.
 *
 * Widened rather than redeclared, so a value the contract already knows about
 * still type-checks against it.
 */
export type SubmissionStatus =
  | ItemStatus
  | "pending_review"
  | "awaiting_seller_shipment";

/** `public.custody_model`. Who physically holds the shoe. */
export type CustodyModel = "warehouse" | "seller";

/** `public.payout_method`. What the seller asked to be paid in. */
export type PayoutMethod = "cash" | "credit" | "either";

/**
 * `public.grade_source`. 'seller_declared' is the whole reason this queue
 * exists: the six component scores on the row are the SELLER'S claim, not a
 * grader's, and approving mints a card off them.
 */
export type GradeSource = "flexsoar" | "seller_declared";

/** Whoever a row points at, from `public_profiles` — never from `users`. */
export interface ProfileRef {
  id: UUID;
  handle: string;
  level: number;
}

/**
 * One row of the pending_review queue, and the review bench's whole subject.
 *
 * `grade` carries the seller's declared component scores. It is all six or
 * none — items_grade_components_complete is still in force — so a partial set
 * is impossible and null means "declared nothing".
 */
export interface Submission {
  id: UUID;
  sku_id: UUID;
  consignor_id: UUID | null;
  status: SubmissionStatus;
  custody: CustodyModel;
  custody_holder_id: UUID | null;
  grade_source: GradeSource;
  /** What the seller wants for it. Seeds the approve dialog's price. */
  asking_price_cents: Cents | null;
  submitted_payout: PayoutMethod;
  last_proof_at: Timestamptz | null;
  photos: Json;
  grading_notes: string | null;
  /** The float the declared components imply, as stored. */
  float_value: FloatValue | null;
  grade: GradeComponents | null;
  created_at: Timestamptz;
  sku: SkuRef;
  /** The submitting seller. Null only on an orphaned row. */
  seller: ProfileRef | null;
}

const SUBMISSION_COLUMNS =
  "id, sku_id, consignor_id, status, custody, custody_holder_id, grade_source, " +
  "asking_price_cents, submitted_payout, last_proof_at, photos, grading_notes, " +
  "float_value, created_at, " +
  "grade_outsole, grade_midsole, grade_creasing, grade_upper, grade_heel, " +
  "grade_accessories";

/**
 * `items` has three FKs into `users`, so PostgREST refuses a bare
 * `public_profiles` embed with PGRST201 ("more than one relationship found")
 * and names them. Hinting the constraint is the documented fix and the only
 * one that survives another FK being added later. Verified live: unhinted
 * returns 300, hinted returns the profile.
 */
const SUBMISSION_SELECT =
  `${SUBMISSION_COLUMNS}, ` +
  "sku:skus!inner(id, brand, model, colorway, size_us, market_price_cents, " +
  "sprite_key, palette, art_url), " +
  "seller:public_profiles!items_consignor_id_fkey(id, handle, level)";

interface SubmissionRow {
  id: UUID;
  sku_id: UUID;
  consignor_id: UUID | null;
  status: SubmissionStatus;
  custody: CustodyModel;
  custody_holder_id: UUID | null;
  grade_source: GradeSource;
  asking_price_cents: Cents | null;
  submitted_payout: PayoutMethod;
  last_proof_at: Timestamptz | null;
  photos: Json;
  grading_notes: string | null;
  float_value: FloatValue | null;
  created_at: Timestamptz;
  grade_outsole: number | null;
  grade_midsole: number | null;
  grade_creasing: number | null;
  grade_upper: number | null;
  grade_heel: number | null;
  grade_accessories: number | null;
  sku: SkuRef | SkuRef[] | null;
  seller: ProfileRef | ProfileRef[] | null;
}

/** PostgREST hands a to-one embed back as an object or a one-element array. */
function embedOne<T>(embed: T | T[] | null | undefined): T | null {
  if (embed === null || embed === undefined) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function toSubmission(row: SubmissionRow): Submission {
  const sku = embedOne(row.sku);
  if (!sku) {
    // !inner on the SKU embed means this cannot happen from the query alone;
    // if it ever does, the row is unrenderable and silence would be worse.
    throw new Error(`items ${row.id}: sku embed missing from the row`);
  }

  // All six or none — items_grade_components_complete. Testing one is enough,
  // and matches how the contract's toItemSummary() reads the same columns.
  const grade: GradeComponents | null =
    row.grade_outsole == null
      ? null
      : {
          outsole: Number(row.grade_outsole),
          midsole: Number(row.grade_midsole),
          creasing: Number(row.grade_creasing),
          upper: Number(row.grade_upper),
          heel: Number(row.grade_heel),
          accessories: Number(row.grade_accessories),
        };

  return {
    id: row.id,
    sku_id: row.sku_id,
    consignor_id: row.consignor_id,
    status: row.status,
    custody: row.custody,
    custody_holder_id: row.custody_holder_id,
    grade_source: row.grade_source,
    asking_price_cents: row.asking_price_cents,
    submitted_payout: row.submitted_payout,
    last_proof_at: row.last_proof_at,
    photos: row.photos,
    grading_notes: row.grading_notes,
    float_value: row.float_value == null ? null : Number(row.float_value),
    grade,
    created_at: row.created_at,
    sku,
    seller: embedOne(row.seller),
  };
}

/**
 * The pending_review queue, oldest first — a seller waiting on a decision has
 * been waiting since `created_at`, and a queue is worked front to back.
 *
 * Visibility is items_admin_read (004). An empty array from a non-admin
 * session means "none you may see", not "none exist", exactly as getItems().
 */
export async function getPendingSubmissions(limit = 200): Promise<Submission[]> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("items")
    .select(SUBMISSION_SELECT)
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (result.error) {
    throw new Error(`items: ${result.error.message}`, { cause: result.error });
  }

  return ((result.data ?? []) as unknown as SubmissionRow[]).map(toSubmission);
}

/**
 * One submission by id, for the review bench. Not filtered by status: the
 * bench has to render a row someone else just approved or rejected, otherwise
 * the operator gets a 404 with no explanation of what changed under them.
 */
export async function getSubmission(itemId: UUID): Promise<Submission | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("items")
    .select(SUBMISSION_SELECT)
    .eq("id", itemId)
    .maybeSingle();
  if (result.error) {
    throw new Error(`items: ${result.error.message}`, { cause: result.error });
  }

  const row = result.data as unknown as SubmissionRow | null;
  return row ? toSubmission(row) : null;
}

// ------------------------------------------------------------
// Seller history — the trust columns 012/013 put on `users`
// ------------------------------------------------------------

/** One earlier submission by the same seller, for the history panel. */
export interface SellerHistoryItem {
  id: UUID;
  status: SubmissionStatus;
  created_at: Timestamptz;
  asking_price_cents: Cents | null;
  brand: string;
  model: string;
  size_us: number;
}

/**
 * What the reviewer needs to know about the person on the other end.
 *
 * `defaults_count` and `is_restricted` are the load-bearing pair: a seller who
 * has failed to ship what they sold is the whole risk of the seller-custody
 * model, and the number belongs on screen before the approve button, not in a
 * report afterwards.
 */
export interface SellerTrust {
  id: UUID;
  handle: string;
  level: number;
  fulfilments_completed: number;
  defaults_count: number;
  is_restricted: boolean;
}

export interface SellerHistory extends SellerTrust {
  /** Newest first, the row on screen excluded. */
  recent: SellerHistoryItem[];
}

const SELLER_TRUST_COLUMNS =
  "id, handle, level, fulfilments_completed, defaults_count, is_restricted";

/**
 * The trust record for a set of sellers, batched — the queue shows a badge per
 * row and N+1 reads for N rows is not a queue, it is a stall.
 *
 * Reads `users` directly rather than `public_profiles`, which is a deliberate
 * exception to the rule in AGENT_RULES that another user's handle comes from
 * the view: the view carries no trust columns (verified live — id, handle,
 * level, xp_total, portfolio_value_cents, created_at and nothing else), and
 * 006's admin-read policy on `users` is what makes this legal. A non-admin
 * session gets an EMPTY MAP, not an error, because RLS filters rows silently —
 * which is why every page calling this runs requireAdminPage() first, and why
 * the screens treat a missing entry as "unknown" rather than "clean".
 *
 * NEVER project `email` here. 006 draws that line and no admin screen in this
 * track has a use for it.
 */
export async function getSellerTrust(
  sellerIds: readonly UUID[],
): Promise<Map<UUID, SellerTrust>> {
  const map = new Map<UUID, SellerTrust>();
  const unique = [...new Set(sellerIds)];
  if (unique.length === 0) return map;

  const supabase = await createServerSupabase();

  const result = await supabase
    .from("users")
    .select(SELLER_TRUST_COLUMNS)
    .in("id", unique);
  if (result.error) {
    throw new Error(`users: ${result.error.message}`, { cause: result.error });
  }

  for (const row of (result.data ?? []) as SellerTrust[]) {
    map.set(row.id, row);
  }
  return map;
}

interface SellerHistoryRow {
  id: UUID;
  status: SubmissionStatus;
  created_at: Timestamptz;
  asking_price_cents: Cents | null;
  sku: { brand: string; model: string; size_us: number }[] | { brand: string; model: string; size_us: number } | null;
}

/**
 * One seller's trust record plus their recent submissions, for the panel on
 * the review bench.
 *
 * Null means the `users` row was not readable — which for a non-admin session
 * is indistinguishable from "no such seller", by design (see getSellerTrust).
 * The bench runs requireAdminPage() first, so null there is genuinely a
 * missing row.
 */
export async function getSellerHistory(
  sellerId: UUID,
  options: { excludeItemId?: UUID; limit?: number } = {},
): Promise<SellerHistory | null> {
  const supabase = await createServerSupabase();

  const trust = (await getSellerTrust([sellerId])).get(sellerId);
  if (!trust) return null;

  let builder = supabase
    .from("items")
    .select(
      "id, status, created_at, asking_price_cents, " +
        "sku:skus!inner(brand, model, size_us)",
    )
    .eq("consignor_id", sellerId);
  if (options.excludeItemId) {
    builder = builder.neq("id", options.excludeItemId);
  }

  const items = await builder
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 10);
  if (items.error) {
    throw new Error(`items: ${items.error.message}`, { cause: items.error });
  }

  return {
    ...trust,
    recent: ((items.data ?? []) as unknown as SellerHistoryRow[]).flatMap(
      (row) => {
        const sku = embedOne(row.sku);
        if (!sku) return [];
        return [
          {
            id: row.id,
            status: row.status,
            created_at: row.created_at,
            asking_price_cents: row.asking_price_cents,
            brand: sku.brand,
            model: sku.model,
            size_us: sku.size_us,
          },
        ];
      },
    ),
  };
}

// ------------------------------------------------------------
// Seller-held redemptions — who owes what, and by when
// ------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between `from` and `to`, floored, or null when `from` is absent
 * or still in the future.
 *
 * Floored on purpose: "1 day overdue" should mean a full day has elapsed.
 * Rounding up would put a row an hour late in the same bucket as one a day
 * late, and this number is quoted back to the operator in the mark-default
 * confirm before they mark a person.
 */
function wholeDaysSince(from: Timestamptz | null, to: number): number | null {
  if (!from) return null;
  const elapsed = to - new Date(from).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  return Math.floor(elapsed / MS_PER_DAY);
}

/**
 * A redemption whose shoe is not in the warehouse: the seller still has it and
 * owes it to the redeemer by `due_by`.
 *
 * `defaulted_at` and `shipped_at` are the two terminal stamps. Neither can be
 * cleared, so a row carrying either is history, not work.
 */
export interface SellerHeldRedemption {
  id: UUID;
  status: RedemptionStatus;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
  /** The shipment deadline 013 stamps at redemption. Null on legacy rows. */
  due_by: Timestamptz | null;
  /**
   * Whole days `due_by` is past, or null when there is no deadline or it has
   * not passed.
   *
   * DERIVED HERE, not in the page, for two reasons. The clock is read once per
   * query, so two rows a millisecond apart cannot disagree about what
   * "overdue" means. And a Server Component that calls Date.now() during
   * render is an impure render by React's rules — correct in practice for a
   * server-rendered page, and still the wrong place for it.
   */
  days_overdue: number | null;
  defaulted_at: Timestamptz | null;
  carrier: string | null;
  tracking_number: string | null;
  handling_fee_cents: Cents;
  shipping_address: Json;
  /** The seller who owes the parcel. */
  fulfiller: ProfileRef | null;
  /** Who redeemed and is waiting. */
  requester: ProfileRef | null;
  item: {
    id: UUID;
    status: SubmissionStatus;
    custody: CustodyModel;
    custody_location: string | null;
  };
  card: { id: UUID; mint_number: number; float_value: FloatValue };
  sku: { brand: string; model: string; colorway: string; size_us: number };
}

interface SellerHeldRow {
  id: UUID;
  status: RedemptionStatus;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
  due_by: Timestamptz | null;
  defaulted_at: Timestamptz | null;
  carrier: string | null;
  tracking_number: string | null;
  handling_fee_cents: Cents;
  shipping_address: Json;
  fulfiller: ProfileRef | ProfileRef[] | null;
  requester: ProfileRef | ProfileRef[] | null;
  item:
    | {
        id: UUID;
        status: SubmissionStatus;
        custody: CustodyModel;
        custody_location: string | null;
      }
    | {
        id: UUID;
        status: SubmissionStatus;
        custody: CustodyModel;
        custody_location: string | null;
      }[]
    | null;
  card:
    | SellerHeldCardRow
    | SellerHeldCardRow[]
    | null;
}

interface SellerHeldCardRow {
  id: UUID;
  mint_number: number;
  float_value: FloatValue;
  sku:
    | { brand: string; model: string; colorway: string; size_us: number }
    | { brand: string; model: string; colorway: string; size_us: number }[]
    | null;
}

/**
 * Every redemption a seller is fulfilling, oldest request first.
 *
 * The filter is `fulfiller_id is not null` — that column is what 013 sets when
 * the burned card's item was in seller custody, and it is the only thing that
 * distinguishes these from the warehouse queue. `.not(col, 'is', null)` rather
 * than `.is()` with a negate flag, for the reason the contract's getItems()
 * spells out: supabase-js accepts a third argument on `.is()` and ignores it,
 * silently inverting the filter.
 *
 * Rows come back under redemptions_admin_read (009), same as getRedemptions().
 */
export async function getSellerHeldRedemptions(
  limit = 200,
): Promise<SellerHeldRedemption[]> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("redemptions")
    .select(
      "id, status, requested_at, shipped_at, due_by, defaulted_at, carrier, " +
        "tracking_number, handling_fee_cents, shipping_address, " +
        "fulfiller:public_profiles!redemptions_fulfiller_id_fkey(id, handle, level), " +
        "requester:public_profiles!redemptions_user_id_fkey(id, handle, level), " +
        "item:items!inner(id, status, custody, custody_location), " +
        "card:cards!inner(id, mint_number, float_value, " +
        "sku:skus!inner(brand, model, colorway, size_us))",
    )
    .not("fulfiller_id", "is", null)
    .order("requested_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (result.error) {
    throw new Error(`redemptions: ${result.error.message}`, {
      cause: result.error,
    });
  }

  // One clock for the whole page of rows.
  const now = Date.now();

  return ((result.data ?? []) as unknown as SellerHeldRow[]).flatMap((row) => {
    const item = embedOne(row.item);
    const card = embedOne(row.card);
    const sku = card ? embedOne(card.sku) : null;
    // !inner on both embeds makes this unreachable from the query; a row that
    // somehow lost one is dropped rather than rendered half-blank, because a
    // fulfilment row with no shoe on it cannot be acted on anyway.
    if (!item || !card || !sku) return [];

    return [
      {
        id: row.id,
        status: row.status,
        requested_at: row.requested_at,
        shipped_at: row.shipped_at,
        due_by: row.due_by,
        days_overdue: wholeDaysSince(row.due_by, now),
        defaulted_at: row.defaulted_at,
        carrier: row.carrier,
        tracking_number: row.tracking_number,
        handling_fee_cents: row.handling_fee_cents,
        shipping_address: row.shipping_address,
        fulfiller: embedOne(row.fulfiller),
        requester: embedOne(row.requester),
        item,
        card: {
          id: card.id,
          mint_number: card.mint_number,
          float_value: Number(card.float_value),
        },
        sku,
      },
    ];
  });
}

// ------------------------------------------------------------
// Proof of possession — the items_proof_overdue view (013)
// ------------------------------------------------------------

/**
 * One seller-held item whose holder has not proven possession inside the
 * window. The view does the arithmetic; this track only renders it.
 */
export interface ProofOverdueItem {
  id: UUID;
  custody_holder_id: UUID | null;
  /** Null means possession was never proven, not "proven long ago". */
  last_proof_at: Timestamptz | null;
  /**
   * Whole days since the last proof, null when never proven. Derived here for
   * the same two reasons as `days_overdue` on a seller-held redemption.
   */
  days_since_proof: number | null;
  brand: string;
  model: string;
  holder: ProfileRef | null;
}

/**
 * The proof-of-possession backlog.
 *
 * The holder's handle is a second query rather than an embed: PostgREST cannot
 * be relied on to infer a view-to-view relationship, and with the view empty
 * live there is no way to prove an embed resolves. Two deterministic reads beat
 * one clever one that cannot be tested.
 *
 * The view's own columns are exactly id, custody_holder_id, last_proof_at,
 * brand, model — verified against the live OpenAPI spec.
 */
export async function getProofOverdue(limit = 200): Promise<ProofOverdueItem[]> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("items_proof_overdue")
    .select("id, custody_holder_id, last_proof_at, brand, model")
    .order("last_proof_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (result.error) {
    throw new Error(`items_proof_overdue: ${result.error.message}`, {
      cause: result.error,
    });
  }

  const rows = (result.data ?? []) as Omit<
    ProofOverdueItem,
    "holder" | "days_since_proof"
  >[];
  if (rows.length === 0) return [];

  const holderIds = [
    ...new Set(
      rows
        .map((row) => row.custody_holder_id)
        .filter((id): id is UUID => id !== null),
    ),
  ];

  const holders = new Map<UUID, ProfileRef>();
  if (holderIds.length > 0) {
    const profiles = await supabase
      .from("public_profiles")
      .select("id, handle, level")
      .in("id", holderIds);
    if (profiles.error) {
      throw new Error(`public_profiles: ${profiles.error.message}`, {
        cause: profiles.error,
      });
    }
    for (const profile of (profiles.data ?? []) as ProfileRef[]) {
      holders.set(profile.id, profile);
    }
  }

  const now = Date.now();

  return rows.map((row) => ({
    ...row,
    days_since_proof: wholeDaysSince(row.last_proof_at, now),
    holder: row.custody_holder_id
      ? (holders.get(row.custody_holder_id) ?? null)
      : null,
  }));
}

// ------------------------------------------------------------
// platform_config — the numbers the deadlines are derived from
// ------------------------------------------------------------

/**
 * The operator-tunable knobs (011/013). Publicly readable — verified with the
 * anon key — because the seller-facing app has to show the same deadlines.
 *
 * Read for DISPLAY only. `due_by` is stamped by the database at redemption and
 * the proof window is applied inside the view; recomputing either here would
 * be a second, drifting copy of a rule the database already owns.
 */
export interface PlatformConfig {
  /** Days a seller has to ship a redeemed shoe. */
  sellerShipmentDays: number | null;
  /** Days between required proofs of possession. */
  proofOfPossessionDays: number | null;
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("platform_config")
    .select("key, num_value")
    .in("key", ["seller_shipment_days", "proof_of_possession_days"]);
  if (result.error) {
    throw new Error(`platform_config: ${result.error.message}`, {
      cause: result.error,
    });
  }

  const byKey = new Map<string, number | null>();
  for (const row of (result.data ?? []) as {
    key: string;
    num_value: number | null;
  }[]) {
    byKey.set(row.key, row.num_value);
  }

  return {
    sellerShipmentDays: byKey.get("seller_shipment_days") ?? null,
    proofOfPossessionDays: byKey.get("proof_of_possession_days") ?? null,
  };
}
