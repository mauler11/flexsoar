import { describe, expect, it } from 'vitest';

import { ebayChallengeResponse } from '@/lib/market/ebay';

describe('ebay deletion challenge', () => {
  const endpoint = 'https://flexsoar.net/api/webhooks/ebay-deletion';
  const token = 'abcDEF123-_abcDEF123-_abcDEF123-_12';

  it('returns a 64-char lowercase hex digest', () => {
    const out = ebayChallengeResponse('123', token, endpoint);
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    expect(ebayChallengeResponse('xyz', token, endpoint)).toBe(
      ebayChallengeResponse('xyz', token, endpoint),
    );
  });

  it('order matters: challenge + token + endpoint is not commutative', () => {
    const a = ebayChallengeResponse('cc', 'tt', 'ee');
    const b = ebayChallengeResponse('tt', 'cc', 'ee');
    expect(a).not.toBe(b);
  });
});
