/**
 * app/api/webhooks/ebay-deletion/route.ts
 *
 * eBay Marketplace Account Deletion compliance endpoint. eBay disables
 * production keysets without one, so this route exists even though
 * FlexSoar stores zero eBay user data.
 *
 *   GET  ?challenge_code=…  → 200 {"challengeResponse": sha256(
 *                               challengeCode + token + endpoint)}
 *   POST (deletion notice)  → logged + 200. There is nothing to delete:
 *                               sold-listing aggregates only, no eBay
 *                               accounts, tokens, or personal data.
 *
 * Env: EBAY_DELETION_TOKEN (32–80 chars, alnum/_/-), EBAY_DELETION_ENDPOINT
 * (defaults to the production URL — the hash must use the EXACT string
 * registered in the eBay console, or verification fails).
 *
 * No session, no rate limit, no auth: eBay calls this server-to-server.
 * Keep it up — eBay disables the keyset if it stays down ~30 days.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  EBAY_DELETION_ENDPOINT_DEFAULT,
  ebayChallengeResponse,
} from '@/lib/market/ebay';

export const dynamic = 'force-dynamic';

function endpoint(): string {
  return (
    process.env['EBAY_DELETION_ENDPOINT']?.trim() ||
    EBAY_DELETION_ENDPOINT_DEFAULT
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const challengeCode = request.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) {
    return NextResponse.json({ error: 'missing challenge_code' }, { status: 400 });
  }
  const token = process.env['EBAY_DELETION_TOKEN']?.trim();
  if (!token) {
    console.error('[ebay-deletion] challenge received but EBAY_DELETION_TOKEN is unset');
    return NextResponse.json({ error: 'verification not configured' }, { status: 500 });
  }
  return NextResponse.json({
    challengeResponse: ebayChallengeResponse(challengeCode, token, endpoint()),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let topic = 'unknown';
  let notificationId = 'unknown';
  try {
    const body = (await request.json()) as {
      metadata?: { topic?: string };
      notification?: { notificationId?: string };
    };
    topic = body?.metadata?.topic ?? topic;
    notificationId = body?.notification?.notificationId ?? notificationId;
  } catch {
    // Unparseable body still gets a 200 — eBay retries non-2xx for days
    // and there is nothing here that a retry could fix or break.
  }
  console.log('[ebay-deletion] notice acknowledged', { topic, notificationId });
  return NextResponse.json({ received: true });
}
