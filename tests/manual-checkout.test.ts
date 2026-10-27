import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manualOrderMessages, orderReference, validateContact } from '@/lib/manual-checkout/order';

vi.mock('server-only', () => ({}));
vi.mock('@/config/manual-checkout.json', () => ({ default: {
  '11111111-1111-4111-8111-111111111111': { status: 'open' },
  '22222222-2222-4222-8222-222222222222': { status: 'reserved' },
} }));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getListing: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/api/contract', () => ({ getListing: mocks.getListing }));
vi.mock('@/lib/email/send', () => ({ sendManualOrderEmails: mocks.send }));
import { manualCheckoutStatus } from '@/lib/manual-checkout/config';
import { POST } from '@/app/api/manual-orders/route';

const id = '11111111-1111-4111-8111-111111111111';
const valid = { listingId: id, name: 'Buyer Name', email: 'buyer@example.com', phone: '+60 12-3456789', country: 'MY', website: '' };
let sequence = 0;
function request(body: unknown = valid, options: { ip?: string; origin?: string; raw?: boolean } = {}) {
  return new Request('https://flexsoar.net/api/manual-orders', { method: 'POST', headers: {
    origin: options.origin ?? 'https://flexsoar.net', 'content-type': 'application/json', 'x-forwarded-for': options.ip ?? `192.0.2.${++sequence}`,
  }, body: options.raw ? String(body) : JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv('MANUAL_CHECKOUT_ENABLED', 'true');
  vi.stubEnv('MANUAL_USDC_ADDRESS', '11111111111111111111111111111111');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://flexsoar.net');
  mocks.getUser.mockResolvedValue({ data: { user: { id: `buyer-${++sequence}` } }, error: null });
  mocks.getListing.mockResolvedValue({ id, seller_id: 'seller', status: 'public', order: null, price_cents: 45000,
    card: { sku: { brand: 'Nike', model: 'Dunk', colorway: 'Blue', size_us: 9 } } });
  mocks.send.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('manual checkout gates', () => {
  it.each(['', 'false', '1'])('is off unless explicitly true (%s)', async value => {
    vi.stubEnv('MANUAL_CHECKOUT_ENABLED', value);
    expect(manualCheckoutStatus(id)).toBe('unavailable');
    expect((await POST(request())).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('accepts only the allowlisted open state', () => {
    expect(manualCheckoutStatus(id)).toBe('open');
    expect(manualCheckoutStatus('22222222-2222-4222-8222-222222222222')).toBe('reserved');
    expect(manualCheckoutStatus('33333333-3333-4333-8333-333333333333')).toBe('unavailable');
    expect(manualCheckoutStatus('__proto__')).toBe('unavailable');
  });
  it.each(['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'])('refuses reserved/absent listing %s', async listingId => {
    expect((await POST(request({ ...valid, listingId }))).status).toBe(409);
    expect(mocks.getListing).not.toHaveBeenCalled();
  });
  it('refuses signed-out callers', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('refuses a different origin', async () => {
    expect((await POST(request(valid, { origin: 'https://attacker.test' }))).status).toBe(403);
  });
});

describe('request validation', () => {
  it.each([
    { name: '' }, { name: 'x'.repeat(101) }, { name: 'Name\r\nBcc: other@example.com' },
    { email: 'not-an-email' }, { email: 'x@example.com\r\n' }, { email: '<x>@example.com' },
    { phone: '12' }, { phone: '<script>' }, { country: 'ZZ' }, { country: 'Malaysia' },
    { listingId: '../bad' }, { website: null },
  ])('rejects invalid fields %j', async fields => {
    expect((await POST(request({ ...valid, ...fields }))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('normalizes and trims contact fields', () => {
    expect(validateContact({ ...valid, name: '  Buyer Name ', country: 'my' })).toEqual({ name: 'Buyer Name', email: valid.email, phone: valid.phone, country: 'MY' });
  });
  it('silently drops honeypot submissions', async () => {
    expect((await POST(request({ ...valid, website: 'spam.test' }))).status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.getListing).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await POST(request('{', { raw: true }))).status).toBe(400);
    expect((await POST(request('x'.repeat(5000), { raw: true }))).status).toBe(400);
  });
});

describe('server terms and email submission', () => {
  it('ignores client price, user and recipient; records the authenticated user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'actual-buyer' } }, error: null });
    const response = await POST(request({ ...valid, priceCents: 1, userId: 'attacker', address: 'attacker', sellerId: 'attacker' }));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.reference).toMatch(/^FS-[A-Z2-7]{8}$/);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 45000, userId: 'actual-buyer', listingId: id, reference: result.reference, address: '11111111111111111111111111111111' }));
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([null, { status: 'sold' }, { order: { id: 'order' } }, { price_cents: -1 }])('refuses unavailable listing %j', async override => {
    const original = await mocks.getListing();
    mocks.getListing.mockResolvedValue(override === null ? null : { ...original, ...override });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('refuses buying the caller own listing', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'seller' } }, error: null });
    expect((await POST(request())).status).toBe(409);
  });
  it('fails closed without configured payment instructions', async () => {
    vi.stubEnv('MANUAL_USDC_ADDRESS', '');
    expect((await POST(request())).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not claim success when Resend fails', async () => {
    mocks.send.mockRejectedValue(new Error('provider failure'));
    expect((await POST(request())).status).toBe(503);
  });
  it('creates correctly formatted, distinct cryptographic references', () => {
    const references = Array.from({ length: 10000 }, orderReference);
    expect(references.every(r => /^FS-[A-Z2-7]{8}$/.test(r))).toBe(true);
    expect(new Set(references).size).toBe(references.length);
  });
  it('escapes all user-controlled HTML, includes identity and payment instructions', () => {
    const messages = manualOrderMessages({ ...valid, name: '<img src=x onerror=alert(1)>', reference: 'FS-ABCDEFG2', userId: 'user', listingId: id, item: '<script>bad</script>', priceCents: 45000, address: 'wallet', qrUrl: 'https://flexsoar.net/payments/duitnow-qr.png' });
    expect(messages.support.html).not.toContain('<img');
    expect(messages.support.html).not.toContain('<script>');
    expect(messages.support.html).toContain('&lt;img');
    expect(messages.support.text).toContain('User ID: user');
    expect(messages.support.text).toContain(`Listing ID: ${id}`);
    expect(messages.buyer.text).toContain('RM 450.00');
    expect(messages.buyer.text).toContain('Screenshots are not proof of payment.');
    expect(messages.buyer.text).toContain('within 5 days.');
    expect(messages.buyer.html).toContain('/payments/duitnow-qr.png');
  });
});

describe('five requests per hour', () => {
  it('limits the same user even with changing IPs', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: `limited-${++sequence}` } }, error: null });
    for (let i = 0; i < 5; i++) expect((await POST(request())).status).toBe(201);
    const blocked = await POST(request());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledTimes(5);
  });
  it('limits the same IP across different accounts and resets after an hour', async () => {
    vi.useFakeTimers();
    try {
      const ip = `shared-${++sequence}`;
      for (let i = 0; i < 6; i++) {
        mocks.getUser.mockResolvedValue({ data: { user: { id: `unique-${++sequence}` } }, error: null });
        expect((await POST(request(valid, { ip }))).status).toBe(i < 5 ? 201 : 429);
      }
      vi.advanceTimersByTime(3_600_001);
      expect((await POST(request(valid, { ip }))).status).toBe(201);
    } finally { vi.useRealTimers(); }
  });
});
