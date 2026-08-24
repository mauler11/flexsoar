'use server';

/**
 * app/(market)/list/actions.ts
 *
 * Server Actions for the self-serve listing wizard (/list) and its payout
 * gate. Structured results the client wizard renders in place — a wizard must
 * stay put and show the outcome inline, unlike the card-page actions which
 * redirect.
 *
 * No RPC seam: the intake write goes straight through the contract's
 * `submitListing` (013), and photo uploads are signed DIRECTLY here through
 * the shared `lib/r2/sign.ts` — there is no `fn_get_upload_target` database
 * function anywhere. The key is built server-side (`intake/<userId>/…`), so a
 * client can choose neither its namespace nor its extension.
 */

import {
  submitListing,
  getUser,
  ContractError,
} from "@/lib/api/contract";
import { gradeFloatFromComponents } from "@/lib/db/grading";
import type { GradeComponents } from "@/lib/db/grading";
import { currentUserId, CASH_PAYOUT_MIN_FULFILMENTS } from "@/app/(market)/queries";
import { signUploadUrl } from "@/lib/r2/sign";
import {
  REQUIRED_PHOTO_COUNT,
  isValidCountryCode,
  type IntakePhoto,
  type PayoutMethod,
} from "@/components/market/intake/intake-config";

export type ActionResult<Ok extends object> =
  | ({ ok: true } & Ok)
  | { ok: false; code: string; message: string };

// ------------------------------------------------------------
// Photo upload — presigned PUT signed right here in the action
// ------------------------------------------------------------

export interface UploadTargetResult {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
}

/** Intake accepts exactly these photo formats — no heic, no gif. */
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Hard cap: 8MB. Server-side, so it cannot be bypassed with a client spoof. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function getUploadTargetAction(input: {
  contentType: string;
  sizeBytes: number;
}): Promise<ActionResult<{ target: UploadTargetResult }>> {
  const me = await currentUserId();
  if (!me) {
    return { ok: false, code: "SIGN_IN_REQUIRED", message: "Sign in to upload photos." };
  }

  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      message: "Photos must be JPEG, PNG, or WebP.",
    };
  }
  if (
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_UPLOAD_BYTES
  ) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "Photos must be 8MB or smaller.",
    };
  }

  try {
    // Key is `intake/<userId>/<uuid>.<ext>` — the caller's id and a uuid, all
    // decided here; the client's filename never reaches the key. httpsOnly:
    // intake photos must be https (010's fn_set_item_photos rule).
    const upload = await signUploadUrl({
      scope: "intake",
      id: me,
      contentType: input.contentType,
      httpsOnly: true,
    });
    return {
      ok: true,
      target: {
        uploadUrl: upload.uploadUrl,
        objectKey: upload.key,
        publicUrl: upload.publicUrl,
      },
    };
  } catch (thrown) {
    return {
      ok: false,
      code: "UPLOAD_TARGET_FAILED",
      message: thrown instanceof Error ? thrown.message : "upload target failed",
    };
  }
}

// ------------------------------------------------------------
// The "not listed" path
// ------------------------------------------------------------

/**
 * Pending handoff M2 (sku_requests). There is no backend table or function to
 * record a request, and the RPC seam that used to fake it is gone, so this
 * validates the form and then says exactly that — nothing is silently dropped.
 */
export async function fileSkuRequestAction(
  formData: FormData,
): Promise<ActionResult<{ requestId: string }>> {
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const colorway = String(formData.get("colorway") ?? "").trim() || null;
  const sizeRaw = String(formData.get("size") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);

  if (!brand || !model) {
    return { ok: false, code: "INVALID", message: "Brand and model are required." };
  }
  const sizeUs = sizeRaw ? Number(sizeRaw) : null;
  if (sizeRaw && (!Number.isFinite(sizeUs) || sizeUs! <= 0)) {
    return { ok: false, code: "INVALID", message: "Size must be a number greater than zero." };
  }

  return {
    ok: false,
    code: "REQUEST_LEDGER_PENDING",
    message:
      "The SKU request ledger isn't wired yet (handoff M2) — nothing was recorded. " +
      "Pick a listed shoe from the catalog, or contact support about pricing this one.",
  };
}

// ------------------------------------------------------------
// The intake submission — straight through the contract (013)
// ------------------------------------------------------------

function validateComponents(raw: Record<string, unknown>): GradeComponents | null {
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

/** Friendly message for the contract codes submitListing can raise. */
function submitErrorMessage(code: string, detail: string): string {
  switch (code) {
    case "RESTRICTED":
      return "Your account is restricted from listing right now.";
    case "UNPROVEN_SELLER":
      return detail || "Cash payout needs more completed fulfilments — list for credit first.";
    case "INVALID_AMOUNT":
      return "Set a price in whole cents greater than zero.";
    case "TOO_FEW_PHOTOS":
      return "Upload at least 4 photos first (they must be uploaded, not just selected).";
    case "INVALID_PHOTO_URL":
      return "One photo has an invalid URL — remove and re-upload it.";
    default:
      return detail || "submission failed";
  }
}

export async function submitListingIntakeAction(
  formData: FormData,
): Promise<ActionResult<{ itemId: string; float: number }>> {
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
  const countryRaw = String(formData.get("country_code") ?? "").trim().toUpperCase();
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

  // Capture country before a consignor can list — fn_payout_method_for_user
  // resolves a null users.country_code to 'credit' with no error anywhere, so
  // a seller who skips this is silently paid FSC instead of cash. Refused
  // server-side; the wizard's own required-field UI is convenience only.
  //
  // NOT YET PERSISTED to users.country_code: no contract export exists to
  // write it, and users' self-update grant (007_profile_updates.sql) covers
  // only `handle` — writing this column needs a track/data contract export
  // plus a migration widening that grant (filed in docs/handoff/market.md).
  // This check is real and not skippable, but until that lands it validates
  // the seller made a real choice on THIS submission; it cannot make
  // fn_payout_method_for_user resolve any differently for them yet.
  if (!isValidCountryCode(countryRaw)) {
    return {
      ok: false,
      code: "COUNTRY_REQUIRED",
      message: "Select your country before submitting — it decides whether you're paid in cash or FSC.",
    };
  }

  try {
    const itemId = await submitListing({
      skuId,
      priceCents: reservePriceCents,
      payoutMethod,
      photos: photoList.map((p) => p.url),
      grade,
      notes,
    });
    return { ok: true, itemId, float: declaredFloat };
  } catch (thrown) {
    if (thrown instanceof ContractError) {
      return {
        ok: false,
        code: thrown.code === "UNPROVEN_SELLER" ? "CASH_LOCKED" : "SUBMIT_FAILED",
        message: submitErrorMessage(thrown.code, thrown.message),
      };
    }
    return {
      ok: false,
      code: "SUBMIT_FAILED",
      message: thrown instanceof Error ? thrown.message : "submission failed",
    };
  }
}

// ------------------------------------------------------------
// Payout gate — mirrors what fn_submit_listing itself enforces (013)
// ------------------------------------------------------------

export interface PayoutEligibility {
  cashEligible: boolean;
  fulfilledShipments: number;
  threshold: number;
}

export async function getPayoutEligibilityAction(): Promise<PayoutEligibility | null> {
  const me = await currentUserId();
  if (!me) return null;

  // users.fulfilments_completed is the live count 013 increments on
  // fn_confirm_shipment. The threshold mirrors the seeded platform_config row
  // (cash_payout_min_fulfilments), which the contract doesn't expose yet —
  // flagged as a partial M4. The authoritative gate is inside fn_submit_listing.
  const user = await getUser({ id: me });
  const fulfilledShipments = user?.fulfilments_completed ?? 0;

  return {
    cashEligible: fulfilledShipments >= CASH_PAYOUT_MIN_FULFILMENTS,
    fulfilledShipments,
    threshold: CASH_PAYOUT_MIN_FULFILMENTS,
  };
}