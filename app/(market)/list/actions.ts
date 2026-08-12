'use server';

/**
 * app/(market)/list/actions.ts
 *
 * Server Actions for the self-serve listing wizard (/list) and its payout
 * gate. These return structured results the client wizard renders in place —
 * unlike the card-page actions, which redirect with ?error=, a wizard must
 * stay put and show the outcome inline.
 *
 * All three writes route through app/(market)/intake/rpc.ts (the local seam
 * that calls the handoff RPCs M1–M3 by name). Reads for the payout gate go
 * through the frozen contract.
 */

import { getRedemptions } from "@/lib/api/contract";
import { gradeFloatFromComponents } from "@/lib/db/grading";
import type { GradeComponents } from "@/lib/db/grading";
import { currentUserId, CASH_FULFILMENT_THRESHOLD } from "@/app/(market)/queries";
import {
  fileSkuRequest,
  getUploadTarget,
  submitListingIntake,
  IntakeUnavailableError,
} from "@/app/(market)/intake/rpc";
import {
  REQUIRED_PHOTO_COUNT,
  type IntakePhoto,
  type PayoutMethod,
} from "@/components/market/intake/intake-config";

export type ActionResult<Ok extends object> =
  | ({ ok: true } & Ok)
  | { ok: false; code: string; message: string };

// ------------------------------------------------------------
// M3 — presigned upload target
// ------------------------------------------------------------

export interface UploadTargetResult {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
}

export async function getUploadTargetAction(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<ActionResult<{ target: UploadTargetResult }>> {
  const me = await currentUserId();
  if (!me) {
    return { ok: false, code: "SIGN_IN_REQUIRED", message: "Sign in to upload photos." };
  }

  try {
    const target = await getUploadTarget(input);
    return {
      ok: true,
      target: {
        uploadUrl: target.uploadUrl,
        objectKey: target.objectKey,
        publicUrl: target.publicUrl,
      },
    };
  } catch (thrown) {
    if (thrown instanceof IntakeUnavailableError) {
      return {
        ok: false,
        code: "SIGNER_NOT_SHARED",
        message: thrown.message,
      };
    }
    return {
      ok: false,
      code: "UPLOAD_TARGET_FAILED",
      message: thrown instanceof Error ? thrown.message : "upload target failed",
    };
  }
}

// ------------------------------------------------------------
// M2 — the "not listed" request
// ------------------------------------------------------------

export async function fileSkuRequestAction(
  formData: FormData,
): Promise<ActionResult<{ requestId: string }>> {
  const me = await currentUserId();
  if (!me) {
    return {
      ok: false,
      code: "SIGN_IN_REQUIRED",
      message: "Sign in to request an unlisted shoe.",
    };
  }

  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const colorway = String(formData.get("colorway") ?? "").trim() || null;
  const sizeRaw = String(formData.get("size") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!brand || !model) {
    return { ok: false, code: "INVALID", message: "Brand and model are required." };
  }
  const sizeUs = sizeRaw ? Number(sizeRaw) : null;
  if (sizeRaw && (!Number.isFinite(sizeUs) || sizeUs! <= 0)) {
    return { ok: false, code: "INVALID", message: "Size must be a number greater than zero." };
  }

  try {
    const requestId = await fileSkuRequest({
      brand,
      model,
      colorway,
      sizeUs,
      notes,
    });
    return { ok: true, requestId };
  } catch (thrown) {
    if (thrown instanceof IntakeUnavailableError) {
      return { ok: false, code: "REQUEST_NOT_WIRED", message: thrown.message };
    }
    return {
      ok: false,
      code: "REQUEST_FAILED",
      message: thrown instanceof Error ? thrown.message : "request failed",
    };
  }
}

// ------------------------------------------------------------
// M1 — the submission
// ------------------------------------------------------------

export interface SubmitIntakePayload {
  skuId: string;
  photos: IntakePhoto[];
  components: GradeComponents;
  reservePriceCents: number;
  payoutMethod: PayoutMethod;
  notes: string;
}

function validateComponents(
  raw: Record<string, unknown>,
): GradeComponents | null {
  const parsed: GradeComponents = {
    outsole: Number(raw.outsole),
    midsole: Number(raw.midsole),
    creasing: Number(raw.creasing),
    upper: Number(raw.upper),
    heel: Number(raw.heel),
    accessories: Number(raw.accessories),
  };
  for (const value of Object.values(parsed)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) return null;
    const rounded = Math.round(value * 100) / 100;
    if (rounded !== value) return null;
  }
  // Every answer must be present — a partial self-assessment is rejected here
  // before it ever reaches the ledger.
  return parsed;
}

export async function submitListingIntakeAction(
  formData: FormData,
): Promise<ActionResult<{ consignmentId: string; float: number }>> {
  const me = await currentUserId();
  if (!me) {
    return {
      ok: false,
      code: "SIGN_IN_REQUIRED",
      message: "Sign in to submit your listing.",
    };
  }

  const skuId = String(formData.get("sku_id") ?? "").trim();
  const photosRaw = String(formData.get("photos") ?? "");
  const componentsRaw = String(formData.get("components") ?? "");
  const reserveRaw = String(formData.get("reserve_price_cents") ?? "");
  const payoutRaw = String(formData.get("payout_method") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);

  if (!/^[0-9a-f-]{36}$/i.test(skuId)) {
    return { ok: false, code: "INVALID", message: "Choose a shoe from the catalog." };
  }

  let photos: unknown;
  let components: unknown;
  try {
    photos = JSON.parse(photosRaw);
    components = JSON.parse(componentsRaw);
  } catch {
    return { ok: false, code: "INVALID", message: "Malformed form payload." };
  }

  if (
    !Array.isArray(photos) ||
    photos.length < REQUIRED_PHOTO_COUNT ||
    !photos.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as IntakePhoto).url === "string" &&
        (p as IntakePhoto).url.startsWith("https://") &&
        typeof (p as IntakePhoto).angle === "string",
    )
  ) {
    return {
      ok: false,
      code: "PHOTOS_NOT_UPLOADED",
      message: `Upload at least ${REQUIRED_PHOTO_COUNT} photos first (they must be uploaded, not just selected).`,
    };
  }
  const photoList = photos as IntakePhoto[];

  if (typeof components !== "object" || components === null || Array.isArray(components)) {
    return { ok: false, code: "INVALID", message: "Condition answers are missing." };
  }
  const grade = validateComponents(components as Record<string, unknown>);
  if (!grade) {
    return { ok: false, code: "INVALID", message: "Answer all six condition questions." };
  }
  const declaredFloat = gradeFloatFromComponents(grade);

  const reservePriceCents = Number(reserveRaw);
  if (!Number.isInteger(reservePriceCents) || reservePriceCents <= 0) {
    return { ok: false, code: "INVALID", message: "Set a price in whole cents greater than zero." };
  }

  if (payoutRaw !== "credit" && payoutRaw !== "cash") {
    return { ok: false, code: "INVALID", message: "Choose a payout method." };
  }
  const payoutMethod = payoutRaw as PayoutMethod;

  // Cash is gated on completed fulfilments, re-checked here against the live
  // session — the client-side lock is a convenience, this is the gate.
  if (payoutMethod === "cash") {
    const redemptions = await getRedemptions({ userId: me });
    const fulfilled = redemptions.filter((r) => r.status === "shipped").length;
    if (fulfilled < CASH_FULFILMENT_THRESHOLD) {
      return {
        ok: false,
        code: "CASH_LOCKED",
        message: `Cash payouts unlock after ${CASH_FULFILMENT_THRESHOLD} completed fulfilment(s) — you have ${fulfilled}. Pick credit, or ask support.`,
      };
    }
  }

  try {
    const consignmentId = await submitListingIntake({
      skuId,
      photos: photoList,
      components: grade,
      reservePriceCents,
      payoutMethod,
      notes,
    });
    return { ok: true, consignmentId, float: declaredFloat };
  } catch (thrown) {
    if (thrown instanceof IntakeUnavailableError) {
      return { ok: false, code: "INTAKE_NOT_WIRED", message: thrown.message };
    }
    return {
      ok: false,
      code: "SUBMIT_FAILED",
      message: thrown instanceof Error ? thrown.message : "submission failed",
    };
  }
}

// ------------------------------------------------------------
// M4 — payout gate (cash unlocks after completed fulfilments)
// ------------------------------------------------------------

export interface PayoutEligibility {
  cashEligible: boolean;
  fulfilledShipments: number;
  threshold: number;
}

export async function getPayoutEligibilityAction(): Promise<PayoutEligibility | null> {
  const me = await currentUserId();
  if (!me) return null;

  const redemptions = await getRedemptions({ userId: me });
  const fulfilledShipments = redemptions.filter((r) => r.status === "shipped").length;

  return {
    cashEligible: fulfilledShipments >= CASH_FULFILMENT_THRESHOLD,
    fulfilledShipments,
    threshold: CASH_FULFILMENT_THRESHOLD,
  };
}
