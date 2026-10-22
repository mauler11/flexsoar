// H1: the legacy Stripe / payout surface is removed, and /api/solana/link-wallet keeps its ownership contract.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { base58Encode } from '../lib/solana/base58';
import { linkMessage, LINK_MESSAGE_TTL_MS } from '../lib/solana/wallet';
import { SOLANA_API_RULE } from '../lib/api/rate-limit';

// ------------------------------------------------------------
// Removed routes
// ------------------------------------------------------------
// Replaces the mirrored tests of app/api/webhooks/stripe/route.ts that lived in
// tests/invariants.test.ts (metadata parsing, cash-leg amount, error
// classification): that route and its logic no longer exist. App Router serves
// 404 for a path with no route or page file, so absence of the file IS the 404
// contract.

describe('H1: legacy Stripe / payout routes are gone (404)', () => {
  const removed: [string, string][] = [
    ['POST /api/webhooks/stripe', 'app/api/webhooks/stripe'],
    ['POST /api/webhooks/stripe-connect', 'app/api/webhooks/stripe-connect'],
    ['POST /api/consignor/connect', 'app/api/consignor/connect'],
    ['GET /api/cron/process-payouts', 'app/api/cron/process-payouts'],
    ['/consignor/connect/refresh', 'app/(market)/consignor/connect/refresh'],
    ['/consignor/connect/return', 'app/(market)/consignor/connect/return'],
  ];
  it.each(removed)('%s has no route or page file', (_url, dir) => {
    for (const f of ['route.ts', 'route.js', 'page.tsx', 'page.js']) {
      expect(existsSync(join(dir, f))).toBe(false);
    }
  });

  it('nothing in app/, components/ or lib/ fetches or links to the removed paths', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          // Code lines only: doc comments may still narrate the history.
          const code = readFileSync(path, 'utf8').split('\n')
            .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n');
          if (/['"`]\/(api\/webhooks\/stripe|api\/consignor\/connect|api\/cron\/process-payouts)|\/consignor\/connect\/(refresh|return)/.test(code)) {
            offenders.push(path.replace(/\\/g, '/'));
          }
        }
      }
    };
    for (const root of ['app', 'components', 'lib']) walk(root);
    // lib/api/contract.ts still builds the Connect onboarding URLs inside
    // createConnectAccount(), which nothing imports any more. track/data owns
    // that file; its removal is filed in docs/handoff/payment-security.md.
    expect(offenders.filter((f) => f !== 'lib/api/contract.ts')).toEqual([]);
  });

  it('nothing imports the Connect / payout functions that only the removed routes used', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && path.replace(/\\/g, '/') !== 'lib/api/contract.ts'
          && /\b(createConnectAccount|processAllDuePayouts)\b/.test(readFileSync(path, 'utf8'))) {
          importers.push(path);
        }
      }
    };
    for (const root of ['app', 'components', 'lib']) walk(root);
    expect(importers).toEqual([]);
  });

  it('the payouts page no longer renders Stripe Connect setup', () => {
    const page = readFileSync('app/(market)/payouts/page.tsx', 'utf8');
    expect(page).not.toContain('PayoutSetup');
    expect(page).not.toContain('stripe_connect');
    expect(existsSync('components/market/PayoutSetup.tsx')).toBe(false);
  });
});

// ------------------------------------------------------------
// /api/solana/link-wallet: ownership regression tests
// ------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  serviceUpdate: vi.fn(),
  serviceEq: vi.fn(),
  serviceFrom: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }),
  createServiceSupabase: async () => ({ from: mocks.serviceFrom }),
}));
vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));
import { GET, POST } from '../app/api/solana/link-wallet/route';

const SESSION_USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

async function wallet() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return {
    address: base58Encode(raw),
    sign: async (message: string) =>
      base58Encode(new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(message)))),
  };
}
const post = (body: unknown) =>
  POST(new Request('https://offline.invalid/api/solana/link-wallet', { method: 'POST', body: JSON.stringify(body) }));

describe('/api/solana/link-wallet: the session user links only a wallet it proves it owns', () => {
  beforeEach(() => {
    mocks.user = { id: SESSION_USER };
    mocks.serviceEq.mockReset().mockResolvedValue({ error: null });
    mocks.serviceUpdate.mockReset().mockReturnValue({ eq: mocks.serviceEq });
    mocks.serviceFrom.mockReset().mockReturnValue({ update: mocks.serviceUpdate });
  });

  it('GET and POST refuse without a session, before any write', async () => {
    mocks.user = null;
    expect((await GET()).status).toBe(401);
    expect((await post({ address: 'x', signature: 'y', issuedAt: new Date().toISOString() })).status).toBe(401);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it('GET derives the message from the session user, never from input', async () => {
    const body = await (await GET()).json();
    expect(body.userId).toBe(SESSION_USER);
    expect(body.message).toBe(linkMessage(SESSION_USER, body.issuedAt));
  });

  it('a valid signature over the session user\'s message writes exactly that address to exactly that user', async () => {
    const w = await wallet();
    const issuedAt = new Date().toISOString();
    const response = await post({ address: w.address, signature: await w.sign(linkMessage(SESSION_USER, issuedAt)), issuedAt });
    expect(response.status).toBe(200);
    expect(mocks.serviceFrom).toHaveBeenCalledWith('users');
    expect(mocks.serviceUpdate).toHaveBeenCalledWith({ solana_address: w.address });
    expect(mocks.serviceEq).toHaveBeenCalledWith('id', SESSION_USER);
  });

  it('a body naming another user cannot redirect the write (no userId input is read)', async () => {
    const w = await wallet();
    const issuedAt = new Date().toISOString();
    const response = await post({ userId: OTHER_USER, user: OTHER_USER, id: OTHER_USER,
      address: w.address, signature: await w.sign(linkMessage(SESSION_USER, issuedAt)), issuedAt });
    expect(response.status).toBe(200);
    expect(mocks.serviceEq).toHaveBeenCalledWith('id', SESSION_USER);
    expect(mocks.serviceEq).not.toHaveBeenCalledWith('id', OTHER_USER);
  });

  it('a signature made for another user\'s message is refused (user A cannot replay B\'s link)', async () => {
    const w = await wallet();
    const issuedAt = new Date().toISOString();
    const response = await post({ address: w.address, signature: await w.sign(linkMessage(OTHER_USER, issuedAt)), issuedAt });
    expect(response.status).toBe(400);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it('claiming someone else\'s wallet address with your own key is refused (ownership proven)', async () => {
    const mine = await wallet();
    const victim = await wallet();
    const issuedAt = new Date().toISOString();
    const response = await post({ address: victim.address, signature: await mine.sign(linkMessage(SESSION_USER, issuedAt)), issuedAt });
    expect(response.status).toBe(400);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it('an expired or future-dated message is refused', async () => {
    const w = await wallet();
    for (const issuedAt of [new Date(Date.now() - LINK_MESSAGE_TTL_MS - 1000).toISOString(), new Date(Date.now() + 60_000).toISOString()]) {
      const response = await post({ address: w.address, signature: await w.sign(linkMessage(SESSION_USER, issuedAt)), issuedAt });
      expect(response.status).toBe(400);
    }
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it('missing fields and malformed JSON are refused before any write', async () => {
    expect((await post({ address: 'x' })).status).toBe(400);
    expect((await POST(new Request('https://offline.invalid', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });
});

describe('/api/solana/link-wallet: per-session-user rate limit (same rule and 429 shape as proxy.ts)', () => {
  // Fresh user ids per test: the route's throttle store is module-level.
  let n = 0;
  const freshUser = () => `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`;
  const bad = () => post({ address: 'x' }); // fails validation after the throttle, so it still counts
  beforeEach(() => {
    mocks.serviceFrom.mockReset();
  });

  it(`POST: ${SOLANA_API_RULE.limit} per window per user, then 429 with Retry-After and no write`, async () => {
    mocks.user = { id: freshUser() };
    for (let i = 0; i < SOLANA_API_RULE.limit; i++) expect((await bad()).status).toBe(400);
    const blocked = await bad();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it('a blocked user does not block another user (keyed by session user, not shared)', async () => {
    const a = freshUser(), b = freshUser();
    mocks.user = { id: a };
    for (let i = 0; i <= SOLANA_API_RULE.limit; i++) await bad();
    expect((await bad()).status).toBe(429);
    mocks.user = { id: b };
    expect((await bad()).status).toBe(400);
  });

  it('GET and POST have separate buckets; GET is limited too', async () => {
    mocks.user = { id: freshUser() };
    for (let i = 0; i <= SOLANA_API_RULE.limit; i++) await bad();
    expect((await bad()).status).toBe(429);
    for (let i = 0; i < SOLANA_API_RULE.limit; i++) expect((await GET()).status).toBe(200);
    expect((await GET()).status).toBe(429);
  });

  it('the window resets', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
      mocks.user = { id: freshUser() };
      for (let i = 0; i < SOLANA_API_RULE.limit; i++) await bad();
      expect((await bad()).status).toBe(429);
      vi.setSystemTime(new Date(Date.now() + SOLANA_API_RULE.windowMs));
      expect((await bad()).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unauthenticated call is refused before the throttle and consumes nothing', async () => {
    mocks.user = null;
    for (let i = 0; i <= SOLANA_API_RULE.limit; i++) expect((await bad()).status).toBe(401);
  });
});
