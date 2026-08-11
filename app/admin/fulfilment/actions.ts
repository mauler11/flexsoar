/**
 * app/admin/fulfilment/actions.ts
 *
 * markShipped(), behind the usual is_admin re-check. fn_mark_shipped checks
 * again inside the transaction; this one exists for the decent error.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { markShipped } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

export interface MarkShippedInput {
  redemptionId: UUID;
  carrier: string;
  tracking: string;
}

/**
 * Carrier and tracking are required here even though the database would take
 * empty strings: a "shipped" row with no tracking is a dispute this screen
 * cannot settle later, and shipped_at is written once — there is no un-ship
 * to come back and fill it in.
 */
export async function markShippedAction(
  input: MarkShippedInput,
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const carrier = input.carrier.trim();
    const tracking = input.tracking.trim();
    if (!carrier || !tracking) {
      return {
        ok: false,
        message: "carrier and tracking number are both required to mark shipped",
      };
    }

    await markShipped(input.redemptionId, carrier, tracking);

    revalidatePath("/admin/fulfilment");
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}
