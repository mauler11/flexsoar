/**
 * app/admin/grading/actions.ts
 *
 * Server Actions for the grading screen: grade, authenticate, reject, and
 * sign presigned R2 uploads for intake photos.
 *
 * THE FLOAT IS DERIVED HERE, ONCE. The client sends only the six component
 * scores; the contract's gradeFloatFromComponents() is the authority for the
 * number that reaches the database. It computes in integer space, so it
 * matches the items_grade_components_sum constraint's `numeric` rounding
 * exactly (the half-milli tie class is pinned by tests/invariants.test.ts).
 * The panel's live preview (components/admin/grading/rubric.ts) is display
 * maths; if anything still disagreed, items_grade_components_sum rejects the
 * save rather than storing either value.
 *
 * Every action re-checks is_admin: middleware does not run on an action
 * invoked from an already-loaded page. The database checks again inside each
 * function; this check exists for the decent error.
 */
"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/components/admin/action-result";
import { requireAdminAction } from "@/components/admin/auth";
import { getItemPhotoUploadUrl } from "@/components/admin/r2";
import {
  authenticateItem,
  getItem,
  gradeFloatFromComponents,
  gradeItem,
  rejectItem,
  type ContractErrorCode,
  type GradeComponents,
} from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

export interface GradeInput {
  itemId: UUID;
  /** The six rubric scores, 0.00–1.00 at two decimals. Never a total. */
  components: GradeComponents;
  notes?: string | null;
}

/** An action's inputs cross the wire; never trust them to be 2dp in range. */
function checkComponents(components: GradeComponents): string | null {
  for (const [key, value] of Object.entries(components)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return `component ${key} is ${value}; scores are 0.00 to 1.00`;
    }
    if (Math.round(value * 100) !== value * 100) {
      return `component ${key} is ${value}; scores carry two decimals`;
    }
  }
  return null;
}

export async function gradeItemAction(input: GradeInput): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const invalid = checkComponents(input.components);
    if (invalid) return { ok: false, message: invalid };

    const float = gradeFloatFromComponents(input.components);
    const notes = input.notes?.trim();

    await gradeItem(input.itemId, float, notes ? notes : null, input.components);

    revalidatePath("/admin/grading");
    revalidatePath(`/admin/grading/${input.itemId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export interface AuthenticateInput {
  itemId: UUID;
  /** Where the shoe is being held. Optional; leaves custody_location alone. */
  location?: string | null;
}

export async function authenticateItemAction(
  input: AuthenticateInput,
): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const location = input.location?.trim();
    await authenticateItem(input.itemId, location ? location : null);

    revalidatePath("/admin/grading");
    revalidatePath(`/admin/grading/${input.itemId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export interface RejectInput {
  itemId: UUID;
  reason: string;
}

/**
 * Failed authentication. The reason lands in grading_notes as a permanent
 * `REJECTED: …` line the consignor can be shown, so it is required on both
 * sides of the wire — same house rule as a consignment rejection.
 */
export async function rejectItemAction(input: RejectInput): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, message: "a rejection needs a reason — none was given" };
    }

    await rejectItem(input.itemId, reason);

    revalidatePath("/admin/grading");
    revalidatePath(`/admin/grading/${input.itemId}`);
    return { ok: true };
  } catch (thrown) {
    return failure(thrown);
  }
}

export interface PhotoUploadInput {
  itemId: UUID;
  filename: string;
  contentType: string;
}

export type PhotoUploadResult =
  | { ok: true; uploadUrl: string; publicUrl: string; key: string }
  | { ok: false; message: string; code?: ContractErrorCode };

/**
 * Sign a presigned PUT URL for one intake photo.
 *
 * Only the URL crosses the wire — the file itself is PUT by the browser
 * straight to R2 (see components/admin/r2.ts), so the 1MB server-action body
 * limit never sees it. The action still guards admin, an existing, gradable,
 * unminted item, and a sane file name/type before signing anything.
 *
 * Persisting the returned public URL into items.photos is deliberately NOT
 * done here: `items` has no UPDATE policy and the contract exposes no write
 * for photos, so any write would have to bypass the contract. That gap is
 * filed in docs/handoff/admin.md.
 */
export async function getItemPhotoUploadUrlAction(
  input: PhotoUploadInput,
): Promise<PhotoUploadResult> {
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

    const item = await getItem(input.itemId);
    if (!item) {
      return { ok: false, message: "no such item" };
    }
    if (item.card_id) {
      return { ok: false, message: "this item is minted — its float is immutable" };
    }
    if (item.status !== "pending_intake" && item.status !== "in_custody") {
      return {
        ok: false,
        message: `this item is ${item.status.replace(/_/g, " ")} and cannot take intake photos`,
      };
    }

    const upload = await getItemPhotoUploadUrl(
      input.itemId,
      filename,
      contentType,
    );

    return { ok: true, ...upload };
  } catch (thrown) {
    // failure() is typed as ActionResult (ok:true carries no payload), but
    // it is only ever reached with a thrown value, so the success arm is
    // unreachable — kept as a guard so the mapping stays honest.
    const failed = failure(thrown);
    if (failed.ok) return { ok: false, message: "upload failed" };
    return { ok: false, message: failed.message, code: failed.code };
  }
}
