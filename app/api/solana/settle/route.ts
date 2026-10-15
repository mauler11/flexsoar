/** USDC settlement/recovery. No payment is initiated by this endpoint.
 * Orders are durable completed receipts only; pending-payment durability,
 * exclusive attempts, and atomic eligibility require the migration handoff.
 */
import { NextResponse } from 'next/server';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { purchaseCardSplit } from '@/lib/api/contract';
import { recoverOrSettlePayment, type PaymentOrder } from '@/lib/db/purchase-payment';
import { verifyQuoteSignature, type Quote } from '@/lib/solana/quotes';
import { base58Decode } from '@/lib/solana/base58';
import { treasuryAddress, usdcMint } from '@/lib/solana/config';
import { verifyPurchaseTransaction } from '@/lib/solana/verify';

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
    let slot: number | null = null;
    const orderId = await recoverOrSettlePayment({ buyerId, listingId, reference }, {
      findOrder,
      verify: async () => {
        // Service read deliberately sees sold/cancelled rows for recovery;
        // session RLS hides them. Never substitute a new live listing.
        const listingResult = await service.from('listings')
          .select('id, card_id, seller_id, status').eq('id', listingId).maybeSingle();
        if (listingResult.error) throw new Error(listingResult.error.message);
        const listing = listingResult.data;
        if (!listing || listing.seller_id === buyerId) throw new Error('invalid purchase listing');
        const wallets = await service.from('users').select('id, solana_address').in('id', [listing.seller_id, buyerId]);
        if (wallets.error) throw new Error(wallets.error.message);
        const rows = wallets.data as { id: string; solana_address: string | null }[] | null;
        const buyerWallet = rows?.find((r) => r.id === buyerId)?.solana_address;
        const sellerWallet = rows?.find((r) => r.id === listing.seller_id)?.solana_address;
        const treasuryWallet = treasuryAddress();
        const programId = process.env['SOLANA_PROGRAM_ID']?.trim();
        if (!buyerWallet || !sellerWallet || !treasuryWallet || !programId) throw new Error('payment configuration or wallet binding unavailable');
        const checked = await verifyPurchaseTransaction(signature, {
          buyerWallet, sellerWallet, treasuryWallet, programId,
          cardId: listing.card_id, usdcMint: usdcMint(),
          totalUnits: quote.totalUnits, sellerUnits: quote.sellerUnits,
          feeUnits: quote.feeUnits, expiresAt: quote.expiresAt,
        });
        if (!checked.ok) throw new Error(checked.reason);
        slot = checked.slot;
        // These are advisory checks only. The existing SQL does not perform
        // these invariants under the settlement locks: PUBLIC LAUNCH BLOCKER.
        const card = await service.from('cards').select('owner_id, status').eq('id', listing.card_id).maybeSingle();
        if (card.error) throw new Error(card.error.message);
        if (listing.status !== 'public' || card.data?.owner_id !== listing.seller_id ||
            !['active', 'locked'].includes(card.data?.status ?? '')) {
          throw new Error('payment verified but claim unavailable; operator resolution required');
        }
      },
      settle: () => purchaseCardSplit(listingId, buyerId, reference, 0, null),
    });
    return NextResponse.json({ ok: true, orderId, slot });
  } catch (error) {
    // This does not persist a recovery obligation. It is an API contract for
    // market's retry-only UI; durable attempts need a human migration.
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'settlement unavailable',
      recoveryRequired: true, retrySettlementOnly: true, signature, listingId,
    }, { status: 409 });
  }
}
