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
 *   - getAdminItem(id)        -> wants getItem(id) or ItemsQuery.id
 *   - getItemOwners(ids)      -> wants consignor_id on ItemSummary
 *   - getSkuFloatCurve(skuId) -> wants getFloatCurve(skuId)
 *   - getAdminSku(id)         -> wants getSku(id) or SkusQuery.id
 *
 * (getAdminRedemptions lived here until getRedemptions() landed on the
 * contract, and was deleted the same day — the promised lifecycle.)
 *
 * They are READS on the session client, relying on RLS the same way the
 * contract's own reads do: items_admin_read (004), cards_public_read (001),
 * curve_read (009). No write lives here and none may be added — AGENT_RULES:
 * all writes go through the contract.
 *
 * Column projections mirror the contract's style. Never select *.
 *
 * Server-only the same way the contract is: lib/supabase/server.ts reads
 * `next/headers`, so importing this from a client component is a build error.
 * (The `server-only` marker package is not a dependency of this repo.)
 */

import type {
  FloatCurveBand,
  GradeComponents,
  ItemSummary,
  Sku,
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
// A SKU's float curve, for the curve editor
// ------------------------------------------------------------

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
// One SKU, by id, for the edit form
// ------------------------------------------------------------

/** Same projection the contract's SKU reads use. skus_read is public. */
export async function getAdminSku(skuId: UUID): Promise<Sku | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("skus")
    .select(
      "id, brand, model, colorway, size_us, retail_price_cents, market_price_cents, " +
        "price_confidence, priced_at, demand_score, sprite_key, palette, mint_cap, created_at",
    )
    .eq("id", skuId)
    .maybeSingle();
  if (result.error) {
    throw new Error(`skus: ${result.error.message}`, { cause: result.error });
  }

  return (result.data as Sku | null) ?? null;
}
