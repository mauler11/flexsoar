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
