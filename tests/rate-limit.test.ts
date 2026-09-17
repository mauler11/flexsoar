import { describe, expect, it } from 'vitest';
import {
  CRON_RULE,
  RATE_LIMITED_PREFIXES,
  SOLANA_API_RULE,
  checkRateLimit,
  clientIp,
  createRateLimitStore,
  retryAfterSeconds,
} from '@/lib/api/rate-limit';

describe('rate-limit', () => {
  describe('checkRateLimit', () => {
    it('allows up to the limit, then blocks', () => {
      const store = createRateLimitStore();
      const rule = { limit: 3, windowMs: 60_000 };
      expect(checkRateLimit(store, 'ip', rule, 0).allowed).toBe(true);
      expect(checkRateLimit(store, 'ip', rule, 1).allowed).toBe(true);
      const third = checkRateLimit(store, 'ip', rule, 2);
      expect(third.allowed).toBe(true);
      expect(third.remaining).toBe(0);
      const fourth = checkRateLimit(store, 'ip', rule, 3);
      expect(fourth.allowed).toBe(false);
      expect(fourth.remaining).toBe(0);
    });

    it('isolates keys from each other', () => {
      const store = createRateLimitStore();
      const rule = { limit: 1, windowMs: 60_000 };
      expect(checkRateLimit(store, 'a', rule, 0).allowed).toBe(true);
      expect(checkRateLimit(store, 'a', rule, 1).allowed).toBe(false);
      expect(checkRateLimit(store, 'b', rule, 1).allowed).toBe(true);
    });

    it('opens a fresh window after expiry', () => {
      const store = createRateLimitStore();
      const rule = { limit: 1, windowMs: 1_000 };
      expect(checkRateLimit(store, 'ip', rule, 0).allowed).toBe(true);
      expect(checkRateLimit(store, 'ip', rule, 500).allowed).toBe(false);
      const after = checkRateLimit(store, 'ip', rule, 1_000);
      expect(after.allowed).toBe(true);
      expect(after.remaining).toBe(0);
    });

    it('reports resetAt inside the verdict', () => {
      const store = createRateLimitStore();
      const rule = { limit: 5, windowMs: 60_000 };
      const verdict = checkRateLimit(store, 'ip', rule, 10_000);
      expect(verdict.resetAt).toBe(70_000);
    });
  });

  describe('clientIp', () => {
    const req = (headers: Record<string, string>) =>
      new Request('https://flexsoar.net/api/solana/quote', { headers });

    it('takes the first x-forwarded-for entry', () => {
      expect(
        clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })),
      ).toBe('1.2.3.4');
    });

    it('falls back to x-real-ip, then unknown', () => {
      expect(clientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
      expect(clientIp(req({}))).toBe('unknown');
    });
  });

  describe('retryAfterSeconds', () => {
    it('rounds up to whole seconds, minimum 1', () => {
      expect(retryAfterSeconds(61_500, 0)).toBe(62);
      expect(retryAfterSeconds(0, 1_000)).toBe(1);
    });
  });

  describe('rules', () => {
    it('production rules are positive and cron is stricter', () => {
      expect(SOLANA_API_RULE.limit).toBeGreaterThan(0);
      expect(SOLANA_API_RULE.windowMs).toBeGreaterThan(0);
      expect(CRON_RULE.limit).toBeLessThanOrEqual(SOLANA_API_RULE.limit);
      expect(RATE_LIMITED_PREFIXES.map((p) => p.prefix)).toEqual([
        '/api/solana/',
        '/api/cron/',
      ]);
    });
  });
});
