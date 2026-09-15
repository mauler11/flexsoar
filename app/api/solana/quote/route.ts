/**
 * app/api/solana/quote/route.ts — GET /api/solana/quote?listingId=
 *
 * Issues the HMAC-signed price quote a buy settles against: the listing's
 * MYR ask converted to USDC base units at live FX, split 5% exactly the
 * way the program splits it. Fails LOUDLY (not silently) when:
 *   - the listing is not live, or the caller owns it / is signed out,
 *   - the seller never linked a payout wallet (056),
 *   - the caller (buyer) never linked a wallet,
 *   - the total exceeds the pre-audit per-trade cap.
 *
 * The quote is the number the settle route demands on-chain to the unit.
 * Nothing here moves money.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { getListing } from '@/lib/api/contract';
import { myrPerUsd } from '@/lib/solana/fx';
import { maxTradeUnits } from '@/lib/solana/config';
import { issueQuote, splitFee } from '@/lib/solana/quotes';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const buyerId = auth.user?.id ?? null;
  if (!buyerId) {
    return NextResponse.json({ error: 'sign in to buy' }, { status: 401 });
  }

  const listingId = request.nextUrl.searchParams.get('listingId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) {
    return NextResponse.json({ error: 'invalid listing' }, { status: 400 });
  }

  const listing = await getListing(listingId).catch(() => null);
  if (!listing || listing.status !== 'public' || !listing.card) {
    return NextResponse.json({ error: 'listing is not live' }, { status: 404 });
  }
  if (listing.seller_id === buyerId) {
    return NextResponse.json({ error: 'cannot buy your own listing' }, { status: 400 });
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
  if (!sellerWallet) {
    return NextResponse.json(
      { error: 'seller has no linked payout wallet yet' },
      { status: 409 },
    );
  }
  if (!buyerWallet) {
    return NextResponse.json(
      { error: 'link your wallet first' },
      { status: 409 },
    );
  }

  const myr = await myrPerUsd();
  if (!myr) {
    return NextResponse.json({ error: 'fx unavailable — try again shortly' }, { status: 502 });
  }
  const totalUnits = Math.round(((listing.price_cents / 100) / myr) * 1_000_000);
  if (!Number.isInteger(totalUnits) || totalUnits <= 0) {
    return NextResponse.json({ error: 'unpriceable listing' }, { status: 500 });
  }
  if (totalUnits > maxTradeUnits()) {
    return NextResponse.json(
      { error: 'listing exceeds the pre-audit per-trade cap' },
      { status: 409 },
    );
  }

  const quote = await issueQuote({ listingId, buyerId, totalUnits });
  const { feeUnits } = splitFee(totalUnits);
  return NextResponse.json(
    {
      ...quote,
      buyerWallet,
      sellerWallet,
      fxMyr: myr,
      feeUnits,
    },
    { status: 200 },
  );
}
