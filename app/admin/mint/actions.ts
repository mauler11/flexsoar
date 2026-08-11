/**
 * app/admin/mint/actions.ts
 *
 * Batch mint. One mintCard() per item, sequentially, each its own database
 * transaction — there is deliberately no all-or-nothing wrapper, because the
 * items are independent: a cap hit on one SKU is no reason to hold up a mint
 * on another. The result reports per item and the screen keeps the failures
 * on view.
 *
 * THE OWNER IS THE CONSIGNOR. fn_mint_card takes an owner id; the owner of a
 * fresh card is whoever consigned the shoe. ItemSummary does not carry
 * consignor_id, so it is resolved through the local adapter — filed in
 * docs/handoff/admin.md.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { getItemOwners } from "@/components/admin/db-reads";
import { mintCard, type ContractErrorCode } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

export interface MintOutcome {
  itemId: UUID;
  ok: boolean;
  cardId?: UUID;
  message?: string;
  code?: ContractErrorCode;
}

export interface BatchMintResult {
  outcomes: MintOutcome[];
  /** Set when the batch could not start at all (auth, owner lookup). */
  message?: string;
}

export async function batchMintAction(itemIds: UUID[]): Promise<BatchMintResult> {
  let owners: Map<UUID, UUID | null>;
  try {
    await requireAdminAction();
    if (itemIds.length === 0) {
      return { outcomes: [], message: "nothing selected" };
    }
    owners = await getItemOwners(itemIds);
  } catch (thrown) {
    const f = failure(thrown);
    return { outcomes: [], message: f.ok ? undefined : f.message };
  }

  const outcomes: MintOutcome[] = [];
  for (const itemId of itemIds) {
    const owner = owners.get(itemId);
    if (!owner) {
      outcomes.push({
        itemId,
        ok: false,
        message:
          "item has no consignor on record, so there is no one to mint the card to",
      });
      continue;
    }
    try {
      const cardId = await mintCard(itemId, owner);
      outcomes.push({ itemId, ok: true, cardId });
    } catch (thrown) {
      const f = failure(thrown);
      outcomes.push({
        itemId,
        ok: false,
        message: f.ok ? "unknown failure" : f.message,
        code: f.ok ? undefined : f.code,
      });
    }
  }

  revalidatePath("/admin/mint");
  revalidatePath("/admin/grading");
  return { outcomes };
}
