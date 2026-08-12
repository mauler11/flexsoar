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
 * fresh card is whoever consigned the shoe. ItemSummary has carried
 * consignor_id since track/data added it, so the caller passes it alongside
 * each item id — no owner lookup adapter.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { mintCard, type ContractErrorCode } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

/** An item to mint, with the consignor who will own the card. */
export interface MintRequest {
  itemId: UUID;
  consignorId: UUID | null;
}

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

export async function batchMintAction(
  requests: MintRequest[],
): Promise<BatchMintResult> {
  try {
    await requireAdminAction();
    if (requests.length === 0) {
      return { outcomes: [], message: "nothing selected" };
    }
  } catch (thrown) {
    const f = failure(thrown);
    return { outcomes: [], message: f.ok ? undefined : f.message };
  }

  const outcomes: MintOutcome[] = [];
  for (const { itemId, consignorId } of requests) {
    if (!consignorId) {
      outcomes.push({
        itemId,
        ok: false,
        message:
          "item has no consignor on record, so there is no one to mint the card to",
      });
      continue;
    }
    try {
      const cardId = await mintCard(itemId, consignorId);
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
