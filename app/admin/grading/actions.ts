/**
 * app/admin/grading/actions.ts
 *
 * Server Actions for the grading screen: grade, authenticate, reject.
 *
 * THE FLOAT IS DERIVED HERE, ONCE. The client sends only the six component
 * scores; gradeFloatFromComponents() is the authority for the number that
 * reaches the database, tie-corrected where its binary-FP rounding provably
 * disagrees with the constraint's `numeric` rounding — see floatForSave().
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
import {
  computeFloatMilli,
  type ComponentScores,
} from "@/components/admin/grading/rubric";
import {
  authenticateItem,
  gradeFloatFromComponents,
  gradeItem,
  rejectItem,
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

/**
 * gradeFloatFromComponents(), tie-corrected.
 *
 * The contract's helper is the authority, but it computes in binary floating
 * point, and on exact half-milli ties (e.g. accessories 0.29 alone: sum
 * 0.0145) the FP product lands at 0.0144999…, rounds DOWN to 0.014 — while
 * the items_grade_components_sum constraint recomputes in Postgres `numeric`,
 * which rounds half away from zero to 0.015. Sending the helper's value for
 * any of those component sets is a guaranteed GRADE_COMPONENTS_MISMATCH: the
 * grade cannot be saved at all, and retrying cannot help. ~3% of the 2dp
 * component space hits this (2,522,964 of 84,280,662 swept combinations).
 *
 * So: take the helper's value, recompute exactly in integer space (which
 * reproduces `numeric` semantics including the half-up tie), and use the
 * exact value only where the two differ — the case where the helper's value
 * is provably unsaveable. Filed in docs/handoff/admin.md; when the contract
 * computes exactly, this correction becomes a no-op and dies.
 */
function floatForSave(components: GradeComponents): number {
  const authority = gradeFloatFromComponents(components);

  const hundredths = Object.fromEntries(
    Object.entries(components).map(([key, value]) => [key, Math.round(value * 100)]),
  ) as unknown as ComponentScores;
  const exact = computeFloatMilli(hundredths) / 1000;

  return exact === authority ? authority : exact;
}

export async function gradeItemAction(input: GradeInput): Promise<ActionResult> {
  try {
    await requireAdminAction();

    const invalid = checkComponents(input.components);
    if (invalid) return { ok: false, message: invalid };

    const float = floatForSave(input.components);
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
