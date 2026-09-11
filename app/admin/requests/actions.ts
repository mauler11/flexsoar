'use server';

/**
 * app/admin/requests/actions.ts
 *
 * Review queue for product requests (044). Every export re-checks is_admin
 * (requireAdminAction) — the DB policies are the real boundary, this is the
 * operator-facing error. Approve creates the model + size variant through
 * the existing admin-gated contract functions, then notifies the requester
 * (service client straight to fn_notify — no new contract function).
 */

import { requireAdminAction } from "@/components/admin/auth";
import { createSkuModel, ensureSkuVariant } from "@/lib/api/contract";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import type { UUID } from "@/lib/db/types";
import type { ActionResult } from "@/app/(market)/list/actions";

export interface ReviewResult {
  requestId: UUID;
  status: "approved" | "rejected";
  modelId: UUID | null;
}

async function notifyRequester(
  userId: UUID,
  type: "request_approved" | "request_rejected",
  payload: Record<string, unknown>,
): Promise<void> {
  // Best-effort, but LOUD: 049's prehistory is a swallowed rpc error (the
  // type CHECK rejected the new types) that made approvals look notifying.
  // supabase-js resolves — never throws — on database errors, so the
  // result MUST be inspected; try/catch alone catches nothing here.
  try {
    const service = createServiceSupabase();
    const { error } = await service.rpc("fn_notify", {
      p_user: userId,
      p_type: type,
      p_payload: payload,
    });
    if (error) {
      console.error("[requests] notify refused:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        type,
        userId,
      });
    }
  } catch (thrown) {
    console.error("[requests] notify threw:", {
      message: thrown instanceof Error ? thrown.message : String(thrown),
      type,
      userId,
    });
  }
}

export async function reviewSkuRequestAction(input: {
  requestId: string;
  decision: "approve" | "reject";
  note?: string;
}): Promise<ActionResult<ReviewResult>> {
  let admin;
  try {
    admin = await requireAdminAction();
  } catch (thrown) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: thrown instanceof Error ? thrown.message : "admin privileges required",
    };
  }

  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) {
    return { ok: false, code: "INVALID", message: "Bad request id." };
  }
  if (input.decision !== "approve" && input.decision !== "reject") {
    return { ok: false, code: "INVALID", message: "Decision must be approve or reject." };
  }
  const note = (input.note ?? "").trim().slice(0, 500);

  const supabase = await createServerSupabase();
  const { data: row, error: readError } = await supabase
    .from("sku_requests")
    .select("id, requester_id, brand, model, colorway, size_us, status")
    .eq("id", input.requestId)
    .maybeSingle();

  if (readError || !row) {
    return { ok: false, code: "NOT_FOUND", message: "Request not found." };
  }
  const request = row as {
    id: UUID;
    requester_id: UUID;
    brand: string;
    model: string;
    colorway: string;
    size_us: number | null;
    status: string;
  };
  if (request.status !== "pending") {
    return { ok: false, code: "WRONG_STATUS", message: `Already ${request.status}.` };
  }

  try {
    let modelId: UUID | null = null;

    if (input.decision === "approve") {
      modelId = await createSkuModel(
        request.brand,
        request.model,
        request.colorway,
        null,
      );
      if (request.size_us != null) {
        await ensureSkuVariant(modelId, request.size_us);
      }
    }

    const { error: updateError } = await supabase
      .from("sku_requests")
      .update({
        status: input.decision === "approve" ? "approved" : "rejected",
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      })
      .eq("id", request.id);

    if (updateError) {
      return { ok: false, code: "SUBMIT_FAILED", message: updateError.message };
    }

    await notifyRequester(
      request.requester_id,
      input.decision === "approve" ? "request_approved" : "request_rejected",
      {
        brand: request.brand,
        model: request.model,
        colorway: request.colorway,
        ...(modelId ? { model_id: modelId } : {}),
        ...(note ? { review_note: note } : {}),
      },
    );

    return {
      ok: true,
      requestId: request.id,
      status: input.decision === "approve" ? "approved" : "rejected",
      modelId,
    };
  } catch (thrown) {
    return {
      ok: false,
      code: "SUBMIT_FAILED",
      message: thrown instanceof Error ? thrown.message : "review failed",
    };
  }
}
