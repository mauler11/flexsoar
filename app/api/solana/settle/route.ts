/** USDC settlement/recovery. No payment is initiated by this endpoint.
 * v2 only: the caller attaches a candidate signature to its OWN attempt
 * (session RPC); the independent finalized observer consumes it later.
 *
 * The legacy quote-based branch (service-credential `orders` read) was
 * removed in H1: no client called it, new legacy quotes cannot be issued
 * (quote/build-tx return 503), and the buyer-bound legacy receipt lookup it
 * offered is served by /api/solana/receipts through the session.
 */
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { attachPaymentCandidate } from '@/lib/api/contract';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const session = await createServerSupabase();
  const { data: auth } = await session.auth.getUser();
  const buyerId = auth.user?.id;
  if (!buyerId) return NextResponse.json({ error: 'sign in to settle' }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: 'malformed request' }, { status: 400 });
  }
  if (!input || typeof input !== 'object') return NextResponse.json({ error: 'malformed request' }, { status: 400 });
  const body = input as Record<string, unknown>;
  if (body.version !== 2) {
    return NextResponse.json({
      error: 'Legacy settlement has been removed. Past purchases are listed by /api/solana/receipts; do not pay again.',
      code: 'LEGACY_SETTLEMENT_REMOVED', receiptsPath: '/api/solana/receipts',
    }, { status: 410 });
  }
  try {
    if (typeof body.attemptId !== 'string' || typeof body.signature !== 'string') throw new Error('attempt and candidate signature required');
    // Session RPC must own-check original attempt. Attaching evidence cannot
    // mark it paid; the independent finalized observer consumes it later.
    await attachPaymentCandidate(session, body.attemptId, body.signature);
    return NextResponse.json({pending:true,recoveryRequired:true,retrySettlementOnly:true,attemptId:body.attemptId},{status:202});
  } catch(e) {
    return NextResponse.json({error:e instanceof Error?e.message:'Candidate recording unavailable',recoveryRequired:true,retrySettlementOnly:true},{status:503});
  }
}
