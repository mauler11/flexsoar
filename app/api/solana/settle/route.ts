/**
 * app/api/solana/settle/route.ts — POST /api/solana/settle
 *
 * Settles a Solana buy into the ledger. Body: { listingId, signature,
 * quote }. Exactly one happy path, in order:
 *
 *   1. Session buyer matches quote.buyerId (no one settles for anyone else).
 *   2. Quote HMAC + expiry verify (tampered or stale quotes fail closed).
 *   3. The transaction verifies on-chain via Helius: buyer debited the
 *      quoted total, seller wallet credited net, treasury credited the fee,
 *      all in the configured USDC mint. Anything else fails closed.
 *   4. purchaseCardSplit() records the card transfer with
 *      settlement_ref = `sol:<signature>`, cash-only (creditCents 0) —
 *      the ledger stays MYR-denominated; chain amounts never enter it.
 *
 * Double-submit safety comes from the ledger, not from here: a replayed
 * signature for an already-sold listing fails inside purchaseCardSplit
 * (WRONG_STATUS), settling nothing twice.
 */

import { NextResponse } from 'next/server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { getListing, purchaseCardSplit } from '@/lib/api/contract';
import { verifyQuote, type Quote } from '@/lib/solana/quotes';
import { treasuryAddress, usdcMint } from '@/lib/solana/config';
import { verifyBuyTransaction } from '@/lib/solana/verify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const buyerId = auth.user?.id ?? null;
  if (!buyerId) {
    return NextResponse.json({ error: 'sign in to settle' }, { status: 401 });
  }

  let body: { listingId?: string; signature?: string; quote?: Quote };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'malformed request' }, { status: 400 });
  }
  const { listingId = '', signature = '', quote } = body;
  if (!/^[0-9a-f-]{36}$/i.test(listingId) || !signature || !quote) {
    return NextResponse.json(
      { error: 'listingId, signature and quote are required' },
      { status: 400 },
    );
  }
  if (quote.buyerId !== buyerId || quote.listingId !== listingId) {
    return NextResponse.json({ error: 'quote does not belong to this buyer' }, { status: 400 });
  }
  if (!(await verifyQuote(quote))) {
    return NextResponse.json(
      { error: 'quote invalid or expired — request a fresh one' },
      { status: 400 },
    );
  }

  const listing = await getListing(listingId).catch(() => null);
  if (!listing || listing.status !== 'public') {
    return NextResponse.json({ error: 'listing is not live' }, { status: 409 });
  }

  const service = await createServiceSupabase();
  const wallets = await service
    .from('users')
    .select('id, solana_address')
    .in('id', [listing.seller_id, buyerId]);
  if (wallets.error) {
    return NextResponse.json({ error: wallets.error.message }, { status: 500 });
  }
  const rows = (wallets.data ?? []) as { id: string; solana_address: string | null }[];
  const sellerWallet = rows.find((r) => r.id === listing.seller_id)?.solana_address ?? null;
  const buyerWallet = rows.find((r) => r.id === buyerId)?.solana_address ?? null;
  if (!sellerWallet || !buyerWallet) {
    return NextResponse.json({ error: 'wallets unlinked mid-trade' }, { status: 409 });
  }
  const treasuryWallet = treasuryAddress();
  if (!treasuryWallet) {
    return NextResponse.json({ error: 'treasury not configured' }, { status: 500 });
  }

  const checked = await verifyBuyTransaction(signature, {
    buyerWallet,
    sellerWallet,
    treasuryWallet,
    usdcMint: usdcMint(),
    totalUnits: quote.totalUnits,
    sellerUnits: quote.sellerUnits,
    feeUnits: quote.feeUnits,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 402 });
  }

  try {
    const orderId = await purchaseCardSplit(listingId, buyerId, `sol:${signature}`, 0, null);
    return NextResponse.json({ ok: true, orderId, slot: checked.slot }, { status: 200 });
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : 'settlement failed' },
      { status: 409 },
    );
  }
}
