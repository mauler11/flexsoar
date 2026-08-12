/**
 * app/admin/fulfilment/actions.ts
 *
 * The three things the packing bench can do to a redemption, behind the usual
 * is_admin re-check. Every RPC checks again inside the transaction; these exist
 * for the decent error.
 *
 * TWO WAYS TO SHIP, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   markShippedAction    warehouse stock. The contract's markShipped().
 *   confirmShipmentAction  a seller's own shoe. Same effect PLUS it credits
 *                        the seller's fulfilments_completed, which gates their
 *                        cash payout. Shipping a seller's parcel through
 *                        markShipped() would record the parcel correctly and
 *                        silently hold the seller's money back.
 *
 * The page picks for the operator — a row is in one section or the other, and
 * each section renders only its own control — so nobody has to know this. The
 * comment is here because the day someone "simplifies" the two into one is the
 * day sellers stop getting paid.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { confirmShipment, markDefault } from "@/components/admin/db-writes";
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

/**
 * Ship a SELLER-HELD redemption: the parcel, plus the seller's fulfilment
 * credit, in one transaction.
 *
 * Carrier and tracking are required for the same reason markShippedAction
 * requires them — a shipped row with no tracking is a dispute this screen
 * cannot settle later — and doubly so here, where the person who shipped it is
 * a seller whose payout now depends on the record being right.
 */
export async function confirmShipmentAction(
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

    await confirmShipment(input.redemptionId, carrier, tracking);

    revalidatePath("/admin/fulfilment");
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export interface MarkDefaultInput {
  redemptionId: UUID;
  note: string;
}

/**
 * Record that a seller did not ship what they owed.
 *
 * The note is required. The database would accept an empty one, but this
 * action marks a PERSON — `defaults_count` goes up, it feeds `is_restricted`,
 * and every future submission of theirs carries the badge. Nothing in this
 * console reverses any of that. A default with no written reason is an
 * accusation nobody can answer, so the reason is the price of the button.
 */
export async function markDefaultAction(
  input: MarkDefaultInput,
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const note = input.note.trim();
    if (!note) {
      return {
        ok: false,
        message:
          "a written reason is required — this marks the seller permanently",
      };
    }

    await markDefault(input.redemptionId, note);

    revalidatePath("/admin/fulfilment");
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}
