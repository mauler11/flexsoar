/** USDC settlement/recovery. No payment is initiated by this endpoint.
 * Orders are durable completed receipts only; pending-payment durability,
 * exclusive attempts, and atomic eligibility require the migration handoff.
 */
import { NextResponse } from 'next/server';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { recoverOrSettlePayment, type PaymentOrder } from '@/lib/db/purchase-payment';
import { verifyQuoteSignature, type Quote } from '@/lib/solana/quotes';
import { base58Decode } from '@/lib/solana/base58';
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
  if (body.version === 2) {
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
  const listingId = body.listingId;
  const signature = body.signature;
  const quote = body.quote as Quote | undefined;
  if (typeof listingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(listingId) ||
      typeof signature !== 'string' || signature.length < 80 || signature.length > 96 ||
      !quote || typeof quote !== 'object' || quote.buyerId !== buyerId || quote.listingId !== listingId) {
    return NextResponse.json({ error: 'invalid payment identity' }, { status: 400 });
  }
  try { if (base58Decode(signature).length !== 64) throw new Error(); } catch {
    return NextResponse.json({ error: 'invalid payment signature' }, { status: 400 });
  }
  try {
    // Authenticate the original quote even after expiry. A previously settled
    // receipt needs no new signature, live listing, or current wallet link.
    if (!(await verifyQuoteSignature(quote))) return NextResponse.json({ error: 'invalid quote' }, { status: 400 });
    const service = createServiceSupabase();
    const reference = `sol:${signature}`;
    const findOrder = async (): Promise<PaymentOrder | null> => {
      const result = await service.from('orders')
        .select('id, listing_id, buyer_id, settlement_ref, status')
        .eq('settlement_ref', reference).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data as PaymentOrder | null;
    };
    // Existing orders support authorized receipt lookup, not proof that the
    // legacy payment was verified. No immutable attempt/network/quote context
    // exists in this schema. A timestamp window cannot supply that authority.
    const blocked = async (): Promise<never> => {
      throw new Error('authoritative purchase authorization unavailable; preserve payment evidence for operator resolution; do not pay again');
    };
    const orderId = await recoverOrSettlePayment({ buyerId, listingId, reference }, {
      findOrder, verify: blocked, settle: blocked,
    });
    return NextResponse.json({ ok: true, orderId, slot: null, receiptOnly: true, paymentVerified: false });
  } catch (error) {
    // This does not persist a recovery obligation. It is an API contract for
    // market's retry-only UI; durable attempts need a human migration.
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'settlement unavailable',
      recoveryRequired: true, retrySettlementOnly: true, signature, listingId,
    }, { status: 409 });
  }
}
