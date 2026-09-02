"use server";

import { burnCard } from "@/lib/api/contract";
import { revalidatePath } from "next/cache";
import { ContractError } from "@/lib/api/contract";

export async function burnCardAction(cardId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await burnCard(cardId, reason);
    revalidatePath("/admin/cards");
    return { ok: true };
  } catch (e) {
    if (e instanceof ContractError) {
      return { ok: false, error: `${e.code}: ${e.message}` };
    }
    return { ok: false, error: "An unexpected error occurred" };
  }
}