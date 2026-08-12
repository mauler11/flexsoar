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
 *   - getSkuFloatCurve(skuId) -> wants getFloatCurve(skuId)
 *   - getAdminSku(id)         -> wants getSku(id) or SkusQuery.id
 *   - getSkuArtUrls(ids)      -> wants art_url on Sku (contract gap)
 *
 * getAdminItem() and getItemOwners() lived here until the 010-era sync landed
 * getItem() and consignor_id on the contract, and were deleted the same day —
 * the promised lifecycle.
 *
 * They are READS on the session client, relying on RLS the same way the
 * contract's own reads do: curve_read (009). No write lives here and none may
 * be added — AGENT_RULES: all writes go through the contract.
 *
 * Column projections mirror the contract's style. Never select *.
 *
 * Server-only the same way the contract is: lib/supabase/server.ts reads
 * `next/headers`, so importing this from a client component is a build error.
 * (The `server-only` marker package is not a dependency of this repo.)
 */

import type { FloatCurveBand, Sku } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";
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
// One SKU, by id, for the edit form
// ------------------------------------------------------------

/**
 * Same projection the contract's SKU reads use, plus the art_url the contract
 * does not carry yet (docs/handoff/admin.md). skus_read is public.
 */
export async function getAdminSku(skuId: UUID): Promise<SkuWithArt | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from("skus")
    .select(
      "id, brand, model, colorway, size_us, retail_price_cents, market_price_cents, " +
        "price_confidence, priced_at, demand_score, sprite_key, palette, mint_cap, created_at, art_url",
    )
    .eq("id", skuId)
    .maybeSingle();
  if (result.error) {
    throw new Error(`skus: ${result.error.message}`, { cause: result.error });
  }

  return (result.data as SkuWithArt | null) ?? null;
}

// ------------------------------------------------------------
// art_url for a page of SKUs, for the catalog list
// ------------------------------------------------------------

/** A SKU plus its art_url, which the contract's Sku type lacks. */
export type SkuWithArt = Sku & { art_url: string | null };

/**
 * The art_url overlay for the catalog list: the list reads through the
 * contract's getSkus(), then this fills in the one column the contract does
 * not expose. Dies the day art_url lands on Sku.
 */
export async function getSkuArtUrls(
  skuIds: readonly UUID[],
): Promise<Map<UUID, string | null>> {
  const supabase = await createServerSupabase();
  const map = new Map<UUID, string | null>();

  if (skuIds.length === 0) return map;

  const result = await supabase
    .from("skus")
    .select("id, art_url")
    .in("id", skuIds as UUID[]);
  if (result.error) {
    throw new Error(`skus: ${result.error.message}`, { cause: result.error });
  }

  for (const row of result.data ?? []) {
    map.set(row.id as UUID, (row as { art_url: string | null }).art_url);
  }
  return map;
}
