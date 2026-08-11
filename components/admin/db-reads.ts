/**
 * components/admin/db-reads.ts
 *
 * LOCAL READ ADAPTERS — TEMPORARY, AND READS ONLY.
 *
 * Three reads the admin screens need that `lib/api/contract.ts` does not
 * expose yet, each filed in docs/handoff/admin.md. The parallel-build rules
 * allow a local adapter for a contract gap; every one of these dies the day
 * track/data ships the real function:
 *
 *   - getAdminItem(id)        -> wants getItem(id) or ItemsQuery.id
 *   - getItemOwners(ids)      -> wants consignor_id on ItemSummary
 *   - getAdminRedemptions()   -> wants getRedemptions()
 *
 * They are READS on the session client, relying on RLS the same way the
 * contract's own reads do: items_admin_read (004), redemptions_admin_read
 * (009), cards_public_read (001), public_profiles (007). No write lives here
 * and none may be added — AGENT_RULES: all writes go through the contract.
 *
 * Column projections mirror the contract's style. Never select *.
 *
 * Server-only the same way the contract is: lib/supabase/server.ts reads
 * `next/headers`, so importing this from a client component is a build error.
 * (The `server-only` marker package is not a dependency of this repo.)
 */

import type {
  GradeComponents,
  ItemSummary,
  SkuRef,
} from "@/lib/api/contract";
import type { ItemStatus, Json, Timestamptz, UUID } from "@/lib/db/types";
import { createServerSupabase } from "@/lib/supabase/server";

// ------------------------------------------------------------
// One item, by id
// ------------------------------------------------------------

/** ItemSummary plus the two link columns the contract's shape leaves out. */
export interface AdminItem extends ItemSummary {
  consignment_id: UUID | null;
  consignor_id: UUID | null;
}

interface AdminItemRow {
  id: UUID;
  sku_id: UUID;
  consignment_id: UUID | null;
  consignor_id: UUID | null;
  status: ItemStatus;
  float_value: number | null;
  graded_at: Timestamptz | null;
  grading_notes: string | null;
  photos: Json;
  authenticated_at: Timestamptz | null;
  custody_location: string | null;
  reserve_price_cents: number | null;
  grade_outsole: number | null;
  grade_midsole: number | null;
  grade_creasing: number | null;
  grade_upper: number | null;
  grade_heel: number | null;
  grade_accessories: number | null;
  sku: SkuRef | null;
}

const ADMIN_ITEM_COLUMNS =
  "id, sku_id, consignment_id, consignor_id, status, float_value, graded_at, " +
  "grading_notes, photos, authenticated_at, custody_location, reserve_price_cents, " +
  "grade_outsole, grade_midsole, grade_creasing, grade_upper, grade_heel, grade_accessories";

const SKU_REF_COLUMNS =
  "id, brand, model, colorway, size_us, market_price_cents, sprite_key, palette";

/** All-or-nothing, same as the contract's mapper — 008 guarantees it. */
function toGrade(row: AdminItemRow): GradeComponents | null {
  if (
    row.grade_outsole === null ||
    row.grade_midsole === null ||
    row.grade_creasing === null ||
    row.grade_upper === null ||
    row.grade_heel === null ||
    row.grade_accessories === null
  ) {
    return null;
  }
  return {
    outsole: row.grade_outsole,
    midsole: row.grade_midsole,
    creasing: row.grade_creasing,
    upper: row.grade_upper,
    heel: row.grade_heel,
    accessories: row.grade_accessories,
  };
}

export async function getAdminItem(itemId: UUID): Promise<AdminItem | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("items")
    .select(`${ADMIN_ITEM_COLUMNS}, sku:skus(${SKU_REF_COLUMNS})`)
    .eq("id", itemId)
    .maybeSingle();
  if (result.error) {
    throw new Error(`items: ${result.error.message}`, { cause: result.error });
  }

  const row = result.data as AdminItemRow | null;
  if (!row) return null;
  if (!row.sku) throw new Error(`items.sku embed missing for ${itemId}`);

  // items -> card is 1:1 and may not exist yet; a lookup, not an embed —
  // the same shape the contract's getItems() uses.
  const card = await supabase
    .from("cards")
    .select("id")
    .eq("item_id", itemId)
    .maybeSingle();
  if (card.error) {
    throw new Error(`cards: ${card.error.message}`, { cause: card.error });
  }

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
    sku: row.sku,
    card_id: (card.data as { id: UUID } | null)?.id ?? null,
    grade: toGrade(row),
  };
}

// ------------------------------------------------------------
// Item -> consignor, for the mint owner
// ------------------------------------------------------------

/**
 * Who a mint goes to: the item's consignor. fn_mint_card takes an owner id
 * and ItemSummary does not carry one, so the batch action resolves it here.
 */
export async function getItemOwners(itemIds: UUID[]): Promise<Map<UUID, UUID | null>> {
  const owners = new Map<UUID, UUID | null>();
  if (itemIds.length === 0) return owners;

  const supabase = await createServerSupabase();
  const result = await supabase
    .from("items")
    .select("id, consignor_id")
    .in("id", itemIds);
  if (result.error) {
    throw new Error(`items: ${result.error.message}`, { cause: result.error });
  }

  for (const row of (result.data ?? []) as { id: UUID; consignor_id: UUID | null }[]) {
    owners.set(row.id, row.consignor_id);
  }
  return owners;
}

// ------------------------------------------------------------
// Redemptions, for the fulfilment screen
// ------------------------------------------------------------

export interface AdminRedemption {
  id: UUID;
  status: string;
  handling_fee_cents: number;
  shipping_address: Json;
  carrier: string | null;
  tracking_number: string | null;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
  card: {
    id: UUID;
    mint_number: number;
    float_value: number;
    sku: { brand: string; model: string; colorway: string; size_us: number };
  };
  requester: { handle: string; level: number };
}

interface AdminRedemptionRow {
  id: UUID;
  status: string;
  handling_fee_cents: number;
  shipping_address: Json;
  carrier: string | null;
  tracking_number: string | null;
  requested_at: Timestamptz;
  shipped_at: Timestamptz | null;
  card: AdminRedemption["card"] | null;
  requester: AdminRedemption["requester"] | null;
}

/**
 * Oldest unshipped first — fulfilment is a queue, and the request that has
 * waited longest is the one to pick up next.
 *
 * The requester embeds from `public_profiles`, never `users` — since 006 an
 * embed on `users` silently yields null for anyone but the caller.
 */
export async function getAdminRedemptions(): Promise<AdminRedemption[]> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("redemptions")
    .select(
      "id, status, handling_fee_cents, shipping_address, carrier, tracking_number, " +
        "requested_at, shipped_at, " +
        "card:cards(id, mint_number, float_value, " +
        "sku:skus(brand, model, colorway, size_us)), " +
        "requester:public_profiles(handle, level)",
    )
    .order("requested_at", { ascending: true });
  if (result.error) {
    throw new Error(`redemptions: ${result.error.message}`, { cause: result.error });
  }

  return ((result.data ?? []) as unknown as AdminRedemptionRow[]).map((row) => {
    if (!row.card) throw new Error(`redemptions.card embed missing for ${row.id}`);
    return {
      ...row,
      card: row.card,
      // fn_redeem_card writes user_id from a real users row, so a missing
      // profile embed should be impossible; degrade readably if it happens.
      requester: row.requester ?? { handle: "(unknown)", level: 0 },
    };
  });
}
