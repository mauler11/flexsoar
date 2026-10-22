import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, signUploadUrl } from '@/lib/r2/sign';
import { getUploadTargetAction } from '@/app/(market)/list/actions';

vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomUUID: () => '00000000-0000-4000-8000-000000000001',
}));
vi.mock('@/app/(market)/queries', () => ({ currentUserId: async () => 'user-1' }));
vi.mock('@/lib/api/contract', () => ({ ContractError: class extends Error {} }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }));

const input = { scope: 'intake' as const, id: 'user-1', contentType: 'image/jpeg', httpsOnly: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-access-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret-key');
  vi.stubEnv('R2_BUCKET', 'test-bucket');
  vi.stubEnv('R2_PUBLIC_URL', 'https://media.example.com');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('C13: signed R2 intake upload length', () => {
  it.each([1, MAX_UPLOAD_BYTES])('accepts %i bytes and includes content-length in the real signature', async (sizeBytes) => {
    const upload = await signUploadUrl({ ...input, sizeBytes });
    const url = new URL(upload.uploadUrl);
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-length');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changing only the declared length changes the signature for the same key and time', async () => {
    const small = await signUploadUrl({ ...input, sizeBytes: 1024 });
    const larger = await signUploadUrl({ ...input, sizeBytes: 1025 });
    expect(small.key).toBe(larger.key);
    const a = new URL(small.uploadUrl).searchParams;
    const b = new URL(larger.uploadUrl).searchParams;
    expect(a.get('X-Amz-Date')).toBe(b.get('X-Amz-Date'));
    expect(a.get('X-Amz-Signature')).not.toBe(b.get('X-Amz-Signature'));
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_UPLOAD_BYTES + 1])('refuses to sign invalid length %s', async (sizeBytes) => {
    await expect(signUploadUrl({ ...input, sizeBytes })).rejects.toThrow('between 1 byte and 8MB');
  });

  it('the action forwards the allowed boundary to the signer', async () => {
    const result = await getUploadTargetAction({ contentType: 'image/jpeg', sizeBytes: MAX_UPLOAD_BYTES });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(new URL(result.target.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_UPLOAD_BYTES + 1])('the action rejects invalid declaration %s', async (sizeBytes) => {
    const result = await getUploadTargetAction({ contentType: 'image/jpeg', sizeBytes });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
  });
});
