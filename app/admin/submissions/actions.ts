/**
 * app/admin/submissions/actions.ts
 *
 * The two decisions the review bench can take on a seller's submission.
 *
 * They deliberately do NOT go through the same door:
 *
 *   reject  -> the contract's rejectItem(), because fn_reject_item already
 *              does exactly this job for an unminted item.
 *   approve -> the local adapter in components/admin/db-writes.ts, because
 *              nothing on the contract mints and publishes in one transaction
 *              and doing it in two would strand cards.
 *
 * The one thing rejecting through the contract costs is a guard.
 * `fn_reject_item` (008, read from supabase/migrations/008_grading.sql) checks
 * admin and "not minted", and nothing else — it does not restrict to
 * `status = 'pending_review'` the way 013's `fn_reject_submission` does. In
 * practice the gap is closed by the same not-minted check: the only way a row
 * leaves pending_review by approval is by being minted, and a minted item
 * cannot be rejected. What is left is the narrow case of rejecting a row that
 * was ALREADY rejected, which re-appends a second REJECTED line to
 * grading_notes rather than raising. Filed in docs/handoff/admin.md item 12;
 * the screen closes it by not offering the button on a decided row.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { approveSubmission } from "@/components/admin/db-writes";
import { rejectItem } from "@/lib/api/contract";
import type { Cents, UUID } from "@/lib/db/types";

export interface ApproveSubmissionInput {
  itemId: UUID;
  /** The listing price, in USD cents. */
  priceCents: Cents;
}

/**
 * Approve: mint the card off the seller's declared grade and publish it at
 * `priceCents`, in one transaction.
 *
 * The price is validated here rather than trusted from the client because it
 * is the number the marketplace charges. A non-integer would be rejected by
 * the `int` parameter anyway, but zero and negative would not be, and neither
 * is a price — a free listing is a bug that costs a real seller a real shoe.
 *
 * No upper bound is imposed: this console has no business deciding that a
 * genuinely expensive pair is a typo, and the reviewer is looking at the
 * seller's asking price and the SKU's market price side by side when they
 * type it.
 */
export async function approveSubmissionAction(
  input: ApproveSubmissionInput,
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const price = input.priceCents;
    if (!Number.isInteger(price)) {
      return {
        ok: false,
        message: "price must be a whole number of cents",
      };
    }
    if (price <= 0) {
      return {
        ok: false,
        message: "price must be greater than zero — there is no free listing",
      };
    }

    await approveSubmission(input.itemId, price);

    revalidatePath("/admin/submissions");
    revalidatePath(`/admin/submissions/${input.itemId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export interface RejectSubmissionInput {
  itemId: UUID;
  reason: string;
}

/**
 * Reject: send the submission back with a written reason.
 *
 * The reason is required here even though the database would take an empty
 * string, for the reason the grading bench requires one — it is appended to
 * `grading_notes` as a permanent `REJECTED: …` line that the seller can be
 * shown, and there is no second pass to fill it in. Write it for them.
 */
export async function rejectSubmissionAction(
  input: RejectSubmissionInput,
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const reason = input.reason.trim();
    if (!reason) {
      return {
        ok: false,
        message: "a written reason is required — the seller is shown it",
      };
    }

    await rejectItem(input.itemId, reason);

    revalidatePath("/admin/submissions");
    revalidatePath(`/admin/submissions/${input.itemId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}
