import { afterEach, describe, expect, it, vi } from 'vitest';
const batch = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { batch = { send: batch }; } }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.resetModules(); });
describe('manual order Resend integration', () => {
  const order = { name: '<Buyer>', email: 'buyer@example.com', phone: '+60123456789', country: 'MY', reference: 'FS-ABCDEFG2', userId: 'signed-in-user', listingId: 'listing', item: 'Nike Dunk', priceCents: 45000, address: 'wallet', qrUrl: 'https://flexsoar.net/payments/duitnow-qr.png' };
  it('sends support and buyer messages as one idempotent batch', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('SUPPORT_EMAIL', 'support@example.com'); vi.stubEnv('FROM_EMAIL', 'orders@example.com');
    batch.mockResolvedValue({ data: { data: [{ id: 'support' }, { id: 'buyer' }] }, error: null });
    const { sendManualOrderEmails } = await import('@/lib/email/send');
    await sendManualOrderEmails(order);
    expect(batch).toHaveBeenCalledWith([
      expect.objectContaining({ from: 'orders@example.com', to: 'support@example.com', text: expect.stringContaining('User ID: signed-in-user') }),
      expect.objectContaining({ from: 'orders@example.com', to: 'buyer@example.com', text: expect.stringContaining('FS-ABCDEFG2') }),
    ], { idempotencyKey: 'manual-order/FS-ABCDEFG2' });
    expect(batch.mock.calls[0][0][0].html).toContain('&lt;Buyer&gt;');
  });
  it('fails without a Resend binding', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const { sendManualOrderEmails } = await import('@/lib/email/send');
    await expect(sendManualOrderEmails(order)).rejects.toThrow('RESEND_API_KEY');
    expect(batch).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: { message: 'rejected' } },
    { data: { data: [{ id: 'only-one' }] }, error: null },
  ])('refuses provider failure/partial acceptance', async result => {
    vi.stubEnv('RESEND_API_KEY', 'test-key'); batch.mockResolvedValue(result);
    const { sendManualOrderEmails } = await import('@/lib/email/send');
    await expect(sendManualOrderEmails(order)).rejects.toThrow();
  });
});
