/**
 * app/admin/consignments/actions.ts
 *
 * Server Actions for the consignment screens.
 *
 * Every export here re-checks `is_admin` before touching the contract, because
 * middleware does not run on an action invoked from an already-loaded page.
 * The database checks again inside the transaction; this one exists to return
 * a sentence instead of a Postgres refusal.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { isAllowedTransition } from "@/components/admin/consignments/transitions";
import { advanceConsignment } from "@/lib/api/contract";
import type { ConsignmentStatus, UUID } from "@/lib/db/types";

export interface AdvanceInput {
  consignmentId: UUID;
  /** The status shown to the operator when they clicked. */
  from: ConsignmentStatus;
  to: ConsignmentStatus;
  note?: string | null;
}

/**
 * Moves one consignment along the state machine.
 *
 * `from` is checked against the mirrored edge table before the call — not as
 * authorisation, but to catch a stale page: if the row moved on since it
 * rendered, this says so in the operator's terms rather than surfacing
 * `illegal consignment transition received -> submitted` from a screen that
 * was showing a legal-looking button a second ago. Everything else, including
 * the real edge check, is the database's.
 *
 * `actorId` is passed for the call site's honesty only. 005 takes the actor
 * from `fn_require_admin()` and ignores the argument, so a wrong id cannot
 * forge history (docs/HANDOFF-shared.md item 11).
 */
export async function advanceConsignmentAction(
  input: AdvanceInput,
): Promise<ActionResult> {
  try {
    const admin = await requireAdminAction();

    if (!isAllowedTransition(input.from, input.to)) {
      return {
        ok: false,
        message:
          `${input.from} -> ${input.to} is not a transition this machine allows. ` +
          `If the buttons looked right, the consignment moved since this page loaded — reload it.`,
      };
    }

    const note = input.note?.trim();

    // Not a database rule — a house rule this track holds on both sides of the
    // wire. A rejection is the transition a consignor will be shown and will
    // argue with, it lands in an append-only event row, and there is no edge
    // back to add the reason later.
    if (input.to === "rejected" && !note) {
      return { ok: false, message: "a rejection needs a reason — none was given" };
    }

    await advanceConsignment(
      input.consignmentId,
      input.to,
      admin.id,
      note ? note : null,
    );

    revalidatePath("/admin/consignments");
    revalidatePath(`/admin/consignments/${input.consignmentId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}
