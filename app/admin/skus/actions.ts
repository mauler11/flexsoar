/**
 * app/admin/skus/actions.ts
 *
 * Catalog writes. upsertSku() and setFloatCurve() are direct table writes
 * guarded only by RLS — no RPC, no fn_require_admin() — which means a
 * non-admin session gets zero rows written SILENTLY rather than an error.
 * The contract turns that silence back into codes: FORBIDDEN when the row
 * exists but nothing was written, NOT_FOUND when there is no such row. The
 * screens surface the two differently; the codes ride on ActionResult.
 *
 * The is_admin re-check here is therefore doing more work than usual: on the
 * RPC-guarded actions it upgrades an error, on these it is the only check
 * that runs BEFORE a write is attempted.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { getAdminSku } from "@/components/admin/db-reads";
import { getSkuArtUploadUrl } from "@/components/admin/r2";
import {
  setFloatCurve,
  upsertSku,
  type ContractErrorCode,
  type FloatCurveBand,
  type UpsertSkuInput,
} from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

export type UpsertSkuResult =
  | { ok: true; skuId: UUID }
  | { ok: false; message: string; code?: ContractErrorCode };

export async function upsertSkuAction(
  input: UpsertSkuInput,
): Promise<UpsertSkuResult> {
  try {
    await requireAdminAction();

    const sku = await upsertSku(input);

    revalidatePath("/admin/skus");
    revalidatePath(`/admin/skus/${sku.id}`);
    return { ok: true, skuId: sku.id };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok
      ? { ok: false, message: "unknown failure" }
      : { ok: false, message: f.message, code: f.code };
  }
}

export async function setFloatCurveAction(
  skuId: UUID,
  bands: FloatCurveBand[],
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    await setFloatCurve(skuId, bands);

    revalidatePath(`/admin/skus/${skuId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export type SkuArtUploadResult =
  | { ok: true; uploadUrl: string; publicUrl: string; key: string }
  | { ok: false; message: string };

/**
 * Sign a presigned PUT URL for one SKU's pixel art, under `sku-art/<skuId>/`.
 * Same pattern as the grading bench photo upload: the browser uploads the
 * bytes straight to R2 so the 1MB server-action limit never sees them.
 *
 * Persisting the returned public URL is a separate step — see
 * setSkuArtUrlAction() below.
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

    const sku = await getAdminSku(input.skuId);
    if (!sku) {
      return { ok: false, message: "no such sku" };
    }

    const upload = await getSkuArtUploadUrl(
      input.skuId,
      filename,
      contentType,
    );

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

export type SetSkuArtUrlResult =
  | { ok: true; artUrl: string | null }
  | { ok: false; message: string; code?: ContractErrorCode };

/**
 * Persists an uploaded art URL onto skus.art_url through upsertSku(). The
 * contract requires the natural-key columns (brand, model, colorway,
 * size_us) on every write, so this reads the current row first and writes
 * them back unchanged alongside the new art_url.
 */
export async function setSkuArtUrlAction(
  skuId: UUID,
  artUrl: string,
): Promise<SetSkuArtUrlResult> {
  try {
    await requireAdminAction();

    const current = await getAdminSku(skuId);
    if (!current) {
      return { ok: false, message: "no such sku" };
    }

    const sku = await upsertSku({
      id: skuId,
      brand: current.brand,
      model: current.model,
      colorway: current.colorway,
      size_us: current.size_us,
      art_url: artUrl,
    });

    revalidatePath("/admin/skus");
    revalidatePath(`/admin/skus/${skuId}`);
    return { ok: true, artUrl: sku.art_url ?? null };
  } catch (thrown) {
    const f = failure(thrown);
    return f.ok
      ? { ok: false, message: "unknown failure" }
      : { ok: false, message: f.message, code: f.code };
  }
}
