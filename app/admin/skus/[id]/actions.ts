"use server";

import { archiveSkuModel } from "@/lib/api/contract";
import { revalidatePath } from "next/cache";
import { ContractError } from "@/lib/api/contract";

export async function archiveSkuModelAction(modelId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await archiveSkuModel(modelId, reason);
    revalidatePath("/admin/skus");
    return { ok: true };
  } catch (e) {
    if (e instanceof ContractError) {
      return { ok: false, error: `${e.code}: ${e.message}` };
    }
    return { ok: false, error: "An unexpected error occurred" };
  }
}