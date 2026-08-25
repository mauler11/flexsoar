/**
 * app/admin/skus/actions.ts
 *
 * Catalog writes for the MODEL bench (027). Every mutation here maps 1:1 onto
 * a `lib/api/contract.ts` export — createSkuModel, updateSkuModel,
 * ensureSkuVariant, updateSkuVariant, replaceSkuArt, setFloatCurve. Nothing in
 * this file calls `.from(...).insert()`/`.update()` itself; the contract does.
 *
 * updateSkuModel() and updateSkuVariant() are direct table writes guarded
 * only by RLS (sku_models_admin_write / skus_admin_write) — no RPC, no
 * fn_require_admin() inside a transaction — which means a non-admin session
 * gets zero rows written SILENTLY rather than an error. The contract turns
 * that silence back into codes: FORBIDDEN when the row exists but nothing was
 * written, NOT_FOUND when there is no such row. requireAdminAction() here
 * runs first regardless, same reasoning as the old flat-SKU actions.ts.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { getAdminSku, getSkuFloatCurve } from "@/components/admin/db-reads";
import { getSkuArtUploadUrl } from "@/components/admin/r2";
import {
  createSkuModel,
  ensureSkuVariant,
  replaceSkuArt,
  setFloatCurve,
  updateSkuModel,
  updateSkuVariant,
  type ContractErrorCode,
  type FloatCurveBand,
  type Sku,
  type UpdateSkuModelInput,
  type UpdateSkuVariantInput,
} from "@/lib/api/contract";
import type { Cents, SkuModel, UUID } from "@/lib/db/types";

function revalidateModel(modelId: UUID) {
  revalidatePath("/admin/skus");
  revalidatePath(`/admin/skus/${modelId}`);
}

// ============================================================
// MODEL
// ============================================================

export type CreateSkuModelResult =
  | { ok: true; modelId: UUID }
  | { ok: false; message: string; code?: ContractErrorCode };

/** fn_create_sku_model via createSkuModel(). Admin only, idempotent on identity. */
export async function createSkuModelAction(input: {
  brand: string;
  model: string;
  colorway: string;
  basePriceCents: Cents | null;
}): Promise<CreateSkuModelResult> {
  try {
    await requireAdminAction();

    const modelId = await createSkuModel(
      input.brand,
      input.model,
      input.colorway,
      input.basePriceCents,
    );

    revalidateModel(modelId);
    return { ok: true, modelId };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok ? { ok: false, message: "unknown failure" } : { ok: false, message: f.message, code: f.code };
  }
}

export type UpdateSkuModelResult =
  | { ok: true; model: SkuModel }
  | { ok: false; message: string; code?: ContractErrorCode };

/** Direct table write under sku_models_admin_write, via updateSkuModel(). */
export async function updateSkuModelAction(
  modelId: UUID,
  input: UpdateSkuModelInput,
): Promise<UpdateSkuModelResult> {
  try {
    await requireAdminAction();

    const model = await updateSkuModel(modelId, input);

    revalidateModel(modelId);
    return { ok: true, model };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok ? { ok: false, message: "unknown failure" } : { ok: false, message: f.message, code: f.code };
  }
}

// ============================================================
// VARIANT
// ============================================================

export type EnsureSkuVariantResult =
  | { ok: true; skuId: UUID }
  | { ok: false; message: string; code?: ContractErrorCode };

/** fn_ensure_sku_variant via ensureSkuVariant(). Idempotent per (model, size). */
export async function ensureSkuVariantAction(
  modelId: UUID,
  sizeUs: number,
): Promise<EnsureSkuVariantResult> {
  try {
    await requireAdminAction();

    const skuId = await ensureSkuVariant(modelId, sizeUs);

    revalidateModel(modelId);
    return { ok: true, skuId };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok ? { ok: false, message: "unknown failure" } : { ok: false, message: f.message, code: f.code };
  }
}

export type UpdateSkuVariantResult =
  | { ok: true; variant: Sku }
  | { ok: false; message: string; code?: ContractErrorCode };

/**
 * Direct table write under skus_admin_write, via updateSkuVariant(). Only
 * size_multiplier and price_override_cents — market_price_cents is derived
 * by trg_sku_variant_derive and settable nowhere.
 *
 * `modelId` is not part of the write; it is here only so this action can
 * revalidate the model page it was called from without a second read.
 */
export async function updateSkuVariantAction(
  skuId: UUID,
  modelId: UUID,
  input: UpdateSkuVariantInput,
): Promise<UpdateSkuVariantResult> {
  try {
    await requireAdminAction();

    const variant = await updateSkuVariant(skuId, input);

    revalidateModel(modelId);
    return { ok: true, variant };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok ? { ok: false, message: "unknown failure" } : { ok: false, message: f.message, code: f.code };
  }
}

// ============================================================
// FLOAT CURVE — unchanged by 027, still keyed on the variant
// ============================================================

export async function setFloatCurveAction(
  skuId: UUID,
  bands: FloatCurveBand[],
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    await setFloatCurve(skuId, bands);

    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export type GetSkuFloatCurveResult =
  | { ok: true; bands: FloatCurveBand[] }
  | { ok: false; message: string };

/**
 * Wraps the local getSkuFloatCurve() read adapter (docs/handoff/admin.md item
 * 4 — no contract read exists yet) so the client-side variants table can load
 * one variant's curve lazily, on opening its curve modal, instead of eagerly
 * fetching every size's curve on page load.
 */
export async function getSkuFloatCurveAction(skuId: UUID): Promise<GetSkuFloatCurveResult> {
  try {
    await requireAdminAction();

    const bands = await getSkuFloatCurve(skuId);
    return { ok: true, bands };
  } catch (thrown) {
    return { ok: false, message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

// ============================================================
// ART — model-level as of 027, addressed through any one variant
// ============================================================

export type SkuArtUploadResult =
  | { ok: true; uploadUrl: string; publicUrl: string; key: string }
  | { ok: false; message: string };

/**
 * Sign a presigned PUT URL for a model's pixel art, under
 * `sku-art/<variant skuId>/` — same R2 layout as before 027; nothing depends
 * on the id being a model id rather than a variant id, and keeping it a
 * variant id means fn_replace_sku_art (below) needs no second lookup.
 */
export async function getSkuArtUploadUrlAction(input: {
  skuId: UUID;
  filename: string;
  contentType: string;
}): Promise<SkuArtUploadResult> {
  try {
    await requireAdminAction();

    const filename = input.filename.trim();
    const contentType = input.contentType.trim();
    if (!filename || !contentType) {
      return { ok: false, message: "a file name and type are required" };
    }
    if (!contentType.startsWith("image/")) {
      return { ok: false, message: `${contentType} is not an image` };
    }

    const variant = await getAdminSku(input.skuId);
    if (!variant) {
      return { ok: false, message: "no such size variant" };
    }

    const upload = await getSkuArtUploadUrl(input.skuId, filename, contentType);

    return { ok: true, ...upload };
  } catch (thrown) {
    // failure() is typed as ActionResult (ok:true carries no payload), but it
    // is only ever reached with a thrown value, so the success arm is
    // unreachable — kept as a guard so the mapping stays honest.
    const failed = failure(thrown);
    if (failed.ok) return { ok: false, message: "upload failed" };
    return { ok: false, message: failed.message };
  }
}

/**
 * Every page that renders a model's art, so an art write revalidates all of
 * them. The market home and card detail routes live under the (market) route
 * group, so their tags use that form.
 */
function revalidateArtPaths(modelId: UUID) {
  revalidatePath("/admin/skus");
  revalidatePath(`/admin/skus/${modelId}`);
  // Art can also be uploaded from a submission's review bench.
  revalidatePath("/admin/submissions/[itemId]", "page");
  revalidatePath("/(market)/card/[id]", "page");
  revalidatePath("/");
}

export type ReplaceSkuArtResult =
  | { ok: true; artUrl: string | null }
  | { ok: false; message: string; code?: ContractErrorCode };

/**
 * The ONLY write path for a model's art, first upload or replacement alike —
 * see ArtUploader.tsx's file header for why upsertSku() is never used for
 * this any more. `skuId` is any one variant of the model; fn_replace_sku_art
 * resolves it to that variant's model_id and writes sku_models.art_url,
 * propagating to every sibling size via fn_sync_sku_variants. Always runs
 * requireAdminAction() before writing, since this changes art already
 * rendered on every card of every size of the model.
 */
export async function replaceSkuArtAction(
  skuId: UUID,
  artUrl: string | null,
): Promise<ReplaceSkuArtResult> {
  try {
    await requireAdminAction();

    const sku = await replaceSkuArt(skuId, artUrl);

    revalidateArtPaths(sku.model_id ?? skuId);
    return { ok: true, artUrl: sku.art_url ?? null };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok ? { ok: false, message: "unknown failure" } : { ok: false, message: f.message, code: f.code };
  }
}
