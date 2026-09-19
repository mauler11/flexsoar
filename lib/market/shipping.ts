/**
 * lib/market/shipping.ts
 *
 * Redemption courier quotes, option A: a flat zone table, Malaysia-only,
 * origin Damansara Damai (47830) every time. No API key, nothing to expire.
 *
 * Zones (approved seeds, counter-verified before launch):
 *   A  Klang Valley (Selangor/KL/Putrajaya)       RM10
 *   B  Rest of Peninsular Malaysia                RM12
 *   C  Sabah / Sarawak / Labuan                   RM30
 *
 * Assumption baked into the rates: one pair, boxed, billable at or under
 * 2kg (volumetric). Oversize boxes bill more at the counter — fulfilment
 * flags those manually; the quote never pretends to cover them.
 *
 * Pure module deliberately: postcode mapping has no I/O, so it is fully
 * unit-tested here. Rates themselves live in the shipping_zones table
 * (DB wins); the SEED_RATES below are the approved fallback when the table
 * is absent, never a second source of truth to drift.
 */

export type ShippingZoneCode = 'A' | 'B' | 'C';

export interface ShippingZone {
  code: ShippingZoneCode;
  name: string;
  /** Approved seed rate, MYR sen. DB row wins when present. */
  seedRateCents: number;
  etaNote: string;
}

export const ORIGIN_POSTCODE = '47830';
export const ORIGIN_LABEL = 'Damansara Damai, Petaling Jaya';

export const SHIPPING_ZONES: Record<ShippingZoneCode, ShippingZone> = {
  A: {
    code: 'A',
    name: 'Klang Valley',
    seedRateCents: 1000,
    etaNote: '1–3 working days, Klang Valley',
  },
  B: {
    code: 'B',
    name: 'Peninsular Malaysia',
    seedRateCents: 1200,
    etaNote: '3–5 working days, Peninsular Malaysia',
  },
  C: {
    code: 'C',
    name: 'East Malaysia',
    seedRateCents: 3000,
    etaNote: '5–7 working days; K3 customs form handled by us',
  },
};

/**
 * Zone for a Malaysian postcode, or null when the postcode is not a
 * recognised MY prefix. Strict by design: an unknown prefix must surface
 * as "check your postcode", never as a guessed zone — guessing Zone B for
 * an East MY typo donates RM18 per parcel.
 *
 * Prefix map (first two digits):
 *   A  40–48 (Selangor), 50–63 (KL/Putrajaya/Cyberjaya)
 *   C  87–98 (Labuan/Sabah/Sarawak)
 *   B  01–39, 49, 64–86 (rest of Peninsula)
 */
export function shippingZoneForPostcode(raw: string): ShippingZoneCode | null {
  const postcode = raw.trim();
  if (!/^\d{5}$/.test(postcode)) return null;
  const prefix = Number(postcode.slice(0, 2));
  if (
    (prefix >= 40 && prefix <= 48) ||
    (prefix >= 50 && prefix <= 63)
  ) {
    return 'A';
  }
  if (prefix >= 87 && prefix <= 98) return 'C';
  if (
    (prefix >= 1 && prefix <= 39) ||
    prefix === 49 ||
    (prefix >= 64 && prefix <= 86)
  ) {
    return 'B';
  }
  return null;
}
