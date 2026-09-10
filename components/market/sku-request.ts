/**
 * components/market/sku-request.ts
 *
 * Pure validation for product requests (044). Lives outside the Server
 * Actions file because 'use server' modules may only export async functions —
 * and outside the contract because lib/api/contract.ts is frozen.
 */

export interface SkuRequestInput {
  brand: string;
  model: string;
  colorway: string;
  sizeUs: number | null;
  notes: string;
  photos: Array<{ url: unknown; angle: unknown }>;
}

/**
 * Returns the cleaned input or a human message. Exported for tests; the
 * submit action applies it and then writes.
 */
export function validateSkuRequestInput(input: SkuRequestInput):
  | { ok: true; value: { brand: string; model: string; colorway: string; sizeUs: number | null; notes: string; photos: Array<{ url: string; angle: string }> } }
  | { ok: false; message: string } {
  const brand = input.brand.trim().slice(0, 120);
  const model = input.model.trim().slice(0, 120);
  const colorway = input.colorway.trim().slice(0, 120);
  const notes = input.notes.trim().slice(0, 1000);

  if (!brand || !model) {
    return { ok: false, message: "Brand and model are required." };
  }
  let sizeUs: number | null = null;
  if (input.sizeUs !== null) {
    if (!Number.isFinite(input.sizeUs) || input.sizeUs < 3 || input.sizeUs > 20) {
      return { ok: false, message: "Size must be between US 3 and US 20." };
    }
    if (input.sizeUs * 2 !== Math.floor(input.sizeUs * 2)) {
      return { ok: false, message: "Size must be a whole or half size." };
    }
    sizeUs = input.sizeUs;
  }
  if (!Array.isArray(input.photos) || input.photos.length < 1) {
    return { ok: false, message: "Add at least one photo of the shoe." };
  }
  if (input.photos.length > 8) {
    return { ok: false, message: "At most 8 photos per request." };
  }
  const photos: Array<{ url: string; angle: string }> = [];
  for (const p of input.photos) {
    if (
      typeof p !== "object" || p === null ||
      typeof p.url !== "string" || !p.url.startsWith("https://") ||
      typeof p.angle !== "string"
    ) {
      return { ok: false, message: "Every photo must be an uploaded https URL." };
    }
    photos.push({ url: p.url, angle: p.angle });
  }
  return { ok: true, value: { brand, model, colorway, sizeUs, notes, photos } };
}
