/**
 * lib/api/rate-limit.ts
 *
 * Per-IP fixed-window rate limiting for abuse-prone API prefixes, enforced
 * in proxy.ts (the only choke point that sees every request). Pure and
 * edge-safe: no Node APIs, injectable clock, no next/server import — proxy.ts
 * translates the verdict into the 429.
 *
 * Scope is deliberately narrow: /api/solana/* (each quote/build-tx fans out
 * to Helius RPC + FX providers, so unbounded calls are a cost vector) and
 * /api/cron/* (bearer-protected, but a leaked CRON_SECRET must not mean
 * unlimited payout sweeps). Webhooks are NOT throttled here — Stripe retries
 * on 429 and delayed settlement is worse than a spurious retry.
 *
 * Limitation: the store is in-memory per runtime instance. On Vercel that
 * means per-region-per-function, so a distributed attacker gets limit ×
 * instances. This stops casual abuse, credential-stuffing volume, and
 * accidental loops — not a botnet. The real fix is a shared counter
 * (Upstash Redis); do that when abuse, not before.
 */

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export type RateLimitStore = Map<string, Bucket>;

/** Throttle for the Solana money routes: generous to humans, finite to loops. */
export const SOLANA_API_RULE: RateLimitRule = { limit: 30, windowMs: 60_000 };

/** Backstop for the bearer-authed crons: a leaked secret must still be slow. */
export const CRON_RULE: RateLimitRule = { limit: 10, windowMs: 60_000 };

/** Prefixes enforced in proxy.ts, with their rules. */
export const RATE_LIMITED_PREFIXES: ReadonlyArray<{
  prefix: string;
  rule: RateLimitRule;
}> = [
  { prefix: '/api/solana/', rule: SOLANA_API_RULE },
  { prefix: '/api/cron/', rule: CRON_RULE },
];

/** One store per runtime instance; created in proxy.ts module scope. */
export function createRateLimitStore(): RateLimitStore {
  return new Map();
}

/**
 * Fixed-window check. Mutates the store. `now` is injectable for tests and
 * defaults to Date.now() in production.
 */
export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitVerdict {
  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    // Cheap hygiene: when starting a fresh window and the store is large,
    // sweep expired buckets so one bad actor can't grow memory unboundedly.
    if (store.size > 5000) {
      for (const [k, b] of store) {
        if (now >= b.resetAt) store.delete(k);
      }
    }
    const resetAt = now + rule.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(rule.limit - 1, 0), resetAt };
  }
  if (bucket.count >= rule.limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return {
    allowed: true,
    remaining: rule.limit - bucket.count,
    resetAt: bucket.resetAt,
  };
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for with the real client
 * first; x-real-ip is the fallback. Spoofable by nature — this is a
 * throttle key, not an identity proof.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}

/** Whole seconds until resetAt, minimum 1 — for the Retry-After header. */
export function retryAfterSeconds(resetAt: number, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
