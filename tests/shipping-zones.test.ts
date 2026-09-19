import { describe, expect, it } from 'vitest';

import {
  SHIPPING_ZONES,
  shippingZoneForPostcode,
} from '@/lib/market/shipping';

describe('shipping zones', () => {
  it('maps Klang Valley prefixes to A', () => {
    expect(shippingZoneForPostcode('47830')).toBe('A'); // Damansara Damai origin
    expect(shippingZoneForPostcode('40000')).toBe('A'); // Shah Alam
    expect(shippingZoneForPostcode('50000')).toBe('A'); // KL
    expect(shippingZoneForPostcode('62000')).toBe('A'); // Putrajaya
    expect(shippingZoneForPostcode('63000')).toBe('A'); // Cyberjaya
  });

  it('maps the rest of the Peninsula to B', () => {
    expect(shippingZoneForPostcode('10000')).toBe('B'); // Penang
    expect(shippingZoneForPostcode('80000')).toBe('B'); // Johor
    expect(shippingZoneForPostcode('25000')).toBe('B'); // Kuantan
    expect(shippingZoneForPostcode('07000')).toBe('B'); // Langkawi
    expect(shippingZoneForPostcode('39000')).toBe('B'); // Cameron Highlands
    expect(shippingZoneForPostcode('49000')).toBe('B'); // the 49 gap
  });

  it('maps East Malaysia to C', () => {
    expect(shippingZoneForPostcode('88000')).toBe('C'); // Kota Kinabalu
    expect(shippingZoneForPostcode('93000')).toBe('C'); // Kuching
    expect(shippingZoneForPostcode('87000')).toBe('C'); // Labuan
  });

  it('rejects malformed and unknown postcodes instead of guessing', () => {
    expect(shippingZoneForPostcode('')).toBeNull();
    expect(shippingZoneForPostcode('4783')).toBeNull();
    expect(shippingZoneForPostcode('478300')).toBeNull();
    expect(shippingZoneForPostcode('ABCDE')).toBeNull();
    expect(shippingZoneForPostcode(' 47830 ')).toBe('A'); // surrounding space is fine
    expect(shippingZoneForPostcode('00000')).toBeNull();
    expect(shippingZoneForPostcode('99999')).toBeNull();
  });

  it('seed rates match the approved launch figures', () => {
    expect(SHIPPING_ZONES.A.seedRateCents).toBe(1000);
    expect(SHIPPING_ZONES.B.seedRateCents).toBe(1200);
    expect(SHIPPING_ZONES.C.seedRateCents).toBe(3000);
  });
});
