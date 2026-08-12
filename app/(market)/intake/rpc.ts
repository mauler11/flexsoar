/**
 * app/(market)/intake/rpc.ts
 *
 * SERVER-ONLY write seam for the self-serve listing flow.
 *
 * WHY THIS FILE EXISTS (and why it isn't in lib/api/contract.ts):
 * AGENT_RULES freezes the contract and reserves its body for track/data. The
 * self-serve intake has no contract function yet — filed as docs/handoff/market.md
 * items M1–M3. These functions call the requested RPCs BY NAME through the
 * session client (exactly the mechanism the contract's own mutations use:
 * supabase.rpc, SECURITY DEFINER, session cookies). No direct table writes,
 * no .sql edits, no contract edits.
 *
 * When track/data ships `submitListingIntake`, `fileSkuRequest` and
 * `getUploadTarget` on the contract, DELETE the matching wrapper here and
 * import from the contract — this file dies the day that happens.
 *
 * A named-but-absent RPC fails with PostgrestError code 42883 ("function …
 * does not exist"). We surface that as a typed `IntakeUnavailableError` so the
 * UI can say exactly what is missing instead of drowning the seller in SQL.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import type { PostgresErrorLike } from "@/lib/db/errors";
import type { GradeComponents } from "@/lib/db/grading";
import type { IntakePhoto, PayoutMethod } from "@/components/market/intake/intake-config";

/** Raised when the RPC this lane needs hasn't shipped yet (handoff M1–M3). */
export class IntakeUnavailableError extends Error {
  readonly rpc: string;
  constructor(rpc: string, message: string) {
    super(message);
    this.name = "IntakeUnavailableError";
    this.rpc = rpc;
  }
}

function isRpcMissing(error: PostgresErrorLike): boolean {
  return (
    error.code === "42883" ||
    /function .* does not exist/i.test(error.message) ||
    /could not find the function/i.test(error.message)
  );
}

function unavailable(rpc: string): never {
  throw new IntakeUnavailableError(
    rpc,
    `The intake ledger isn't wired yet — ${rpc} isn't deployed. Nothing was recorded. ` +
      "This is a data-track handoff item (docs/handoff/market.md M1).",
  );
}

// ------------------------------------------------------------
// M1 — the submission itself
// ------------------------------------------------------------

export interface SubmitIntakeInput {
  skuId: string;
  /** [{ url, angle }] — https URLs, angles from PHOTO_ANGLES keys. */
  photos: IntakePhoto[];
  /** Six self-declared condition answers. Stored as self_declared, never grade_*. */
  components: GradeComponents;
  /** Integer USD cents. */
  reservePriceCents: number;
  payoutMethod: PayoutMethod;
  notes?: string | null;
}

export async function submitListingIntake(input: SubmitIntakeInput): Promise<string> {
  const supabase = await createServerSupabase();
  const result = await supabase.rpc("fn_submit_listing_intake", {
    p_sku_id: input.skuId,
    p_photo_urls: input.photos,
    p_components: input.components,
    p_reserve_price_cents: input.reservePriceCents,
    p_payout_method: input.payoutMethod,
    p_notes: input.notes ?? null,
  });

  if (result.error) {
    if (isRpcMissing(result.error)) unavailable("fn_submit_listing_intake");
    throw new Error(result.error.message.trim() || "fn_submit_listing_intake failed");
  }
  const id = result.data;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("fn_submit_listing_intake returned no consignment id");
  }
  return id;
}

// ------------------------------------------------------------
// M2 — the "not listed" request
// ------------------------------------------------------------

export interface SkuRequestInput {
  brand: string;
  model: string;
  colorway?: string | null;
  sizeUs?: number | null;
  notes?: string | null;
}

export async function fileSkuRequest(input: SkuRequestInput): Promise<string> {
  const supabase = await createServerSupabase();
  const result = await supabase.rpc("fn_file_sku_request", {
    p_brand: input.brand,
    p_model: input.model,
    p_colorway: input.colorway ?? null,
    p_size_us: input.sizeUs ?? null,
    p_notes: input.notes ?? null,
  });

  if (result.error) {
    if (isRpcMissing(result.error)) unavailable("fn_file_sku_request");
    throw new Error(result.error.message.trim() || "fn_file_sku_request failed");
  }
  const id = result.data;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("fn_file_sku_request returned no request id");
  }
  return id;
}

// ------------------------------------------------------------
// M3 — presigned upload target (R2 via a shared signer, pending)
// ------------------------------------------------------------

export interface UploadTarget {
  /** PUT this file body here (presigned, short-lived). */
  uploadUrl: string;
  /** Store in the photos payload. */
  objectKey: string;
  /** The https URL the admin photo viewer renders. */
  publicUrl: string;
}

export async function getUploadTarget(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<UploadTarget> {
  // The shared signer (components/admin/r2.ts or a storage wrapper) is filed
  // as M3. Until it ships, the seam returns a typed "not shared" signal so the
  // photo step can explain itself instead of guessing.
  const supabase = await createServerSupabase();
  const result = await supabase.rpc("fn_get_upload_target", {
    p_file_name: input.fileName,
    p_content_type: input.contentType,
    p_size_bytes: input.sizeBytes,
  });

  if (result.error) {
    if (isRpcMissing(result.error)) unavailable("fn_get_upload_target");
    throw new Error(result.error.message.trim() || "fn_get_upload_target failed");
  }
  const row = result.data as Partial<UploadTarget> | null;
  if (!row || !row.uploadUrl || !row.objectKey || !row.publicUrl) {
    throw new Error("fn_get_upload_target returned an incomplete target");
  }
  return row as UploadTarget;
}