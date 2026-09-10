import { describe, expect, it } from 'vitest';
import { validateSkuRequestInput } from '@/components/market/sku-request';
import { SIZE_RUN } from '@/app/(market)/list/[modelId]/page';

describe('validateSkuRequestInput (044 product requests)', () => {
  const base = {
    brand: 'Nike',
    model: "Air Force 1 '07",
    colorway: 'Triple White',
    sizeUs: 9.5,
    notes: '',
    photos: [{ url: 'https://r2.dev/x.jpg', angle: 'lateral' }],
  };

  it('accepts a complete request', () => {
    const result = validateSkuRequestInput(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.brand).toBe('Nike');
      expect(result.value.photos).toHaveLength(1);
    }
  });

  it('rejects missing brand or model', () => {
    expect(validateSkuRequestInput({ ...base, brand: '  ' }).ok).toBe(false);
    expect(validateSkuRequestInput({ ...base, model: '' }).ok).toBe(false);
  });

  it('rejects out-of-range and non-half sizes', () => {
    expect(validateSkuRequestInput({ ...base, sizeUs: 2 }).ok).toBe(false);
    expect(validateSkuRequestInput({ ...base, sizeUs: 21 }).ok).toBe(false);
    expect(validateSkuRequestInput({ ...base, sizeUs: 9.3 }).ok).toBe(false);
    expect(validateSkuRequestInput({ ...base, sizeUs: null }).ok).toBe(true);
  });

  it('requires at least one uploaded https photo', () => {
    expect(validateSkuRequestInput({ ...base, photos: [] }).ok).toBe(false);
    expect(
      validateSkuRequestInput({
        ...base,
        photos: [{ url: 'blob:local', angle: 'lateral' }],
      }).ok,
    ).toBe(false);
  });

  it('caps photos at 8 and notes at 1000 chars', () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({
      url: `https://r2.dev/${i}.jpg`,
      angle: 'lateral',
    }));
    expect(validateSkuRequestInput({ ...base, photos }).ok).toBe(false);
    const result = validateSkuRequestInput({ ...base, notes: 'x'.repeat(2000) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notes).toHaveLength(1000);
  });
});

describe('SIZE_RUN (sell product page)', () => {
  it('covers US 3–13 in half sizes', () => {
    expect(SIZE_RUN[0]).toBe(3);
    expect(SIZE_RUN[SIZE_RUN.length - 1]).toBe(13);
    expect(SIZE_RUN).toHaveLength(21);
    for (const size of SIZE_RUN) {
      expect(size * 2).toBe(Math.floor(size * 2));
    }
  });
});
