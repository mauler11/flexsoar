/**
 * app/api/solana/build-tx/route.ts — GET /api/solana/build-tx?listingId=
 *
 * One call that hands an injected wallet everything it needs to execute a
 * buy on the configured cluster: the HMAC quote (the number settle demands to the unit), the
 * deterministic ATAs, the config PDA, a fresh blockhash, and the UNSIGNED
 * buy transaction (base64) for the wallet to sign and send.
 *
 * Fails LOUDLY, never silently:
 *   - 401 signed out, 400 bad id / own listing, 404 listing not live,
 *   - 409 seller/buyer wallet unlinked or listing over the pre-audit cap,
 *   - 501 program not deployed (SOLANA_PROGRAM_ID unset or placeholder),
 *   - 502 FX or blockhash unavailable.
 *
 * Nothing here moves money. The wallet signs; /api/solana/settle verifies
 * balance deltas and records the ledger transfer.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { PublicKey } from '@solana/web3.js';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { getListing } from '@/lib/api/contract';
import { myrPerUsd } from '@/lib/solana/fx';
import { maxTradeUnits, rpcUrl, treasuryAddress, usdcMint } from '@/lib/solana/config';
import { issueQuote } from '@/lib/solana/quotes';
import {
  associatedTokenAddress,
  buildBuyTx,
  configPda,
  vaultRefForCard,
} from '@/lib/solana/sdk';

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

  const programId = process.env['SOLANA_PROGRAM_ID']?.trim() ?? '';
  try {
    new PublicKey(programId);
  } catch {
    return NextResponse.json(
      { error: 'settlement program not deployed yet (SOLANA_PROGRAM_ID)' },
      { status: 501 },
    );
  }
  const treasuryWallet = treasuryAddress();
  if (!treasuryWallet) {
    return NextResponse.json(
      { error: 'treasury not configured (SOLANA_TREASURY)' },
      { status: 501 },
    );
  }
  try {
    new PublicKey(treasuryWallet);
  } catch {
    return NextResponse.json(
      { error: 'treasury not configured (SOLANA_TREASURY)' },
      { status: 501 },
    );
  }
  const mint = usdcMint();
  try {
    new PublicKey(mint);
  } catch {
    return NextResponse.json({ error: 'USDC mint misconfigured' }, { status: 500 });
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
    return NextResponse.json({ error: 'link your wallet first' }, { status: 409 });
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

  let buyerAta: string;
  let sellerAta: string;
  let treasuryAta: string;
  let config: string;
  try {
    buyerAta = associatedTokenAddress(buyerWallet, mint);
    sellerAta = associatedTokenAddress(sellerWallet, mint);
    treasuryAta = associatedTokenAddress(treasuryWallet, mint);
    config = configPda(programId);
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : 'address derivation failed' },
      { status: 500 },
    );
  }

  let rpc: string;
  try {
    rpc = rpcUrl();
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : 'rpc not configured' },
      { status: 501 },
    );
  }
  let recentBlockhash: string;
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'flexsoar-blockhash',
        method: 'getLatestBlockhash',
        params: [{ commitment: 'confirmed' }],
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `blockhash rpc unreachable (http ${res.status})` },
        { status: 502 },
      );
    }
    const body = (await res.json()) as {
      result?: { value?: { blockhash?: string } };
    };
    recentBlockhash = body.result?.value?.blockhash ?? '';
    if (!recentBlockhash) {
      return NextResponse.json({ error: 'blockhash rpc returned nothing' }, { status: 502 });
    }
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? `blockhash rpc failed: ${thrown.message}` : 'blockhash rpc failed' },
      { status: 502 },
    );
  }

  let unsignedTx: string;
  try {
    unsignedTx = await buildBuyTx({
      programId,
      buyer: buyerWallet,
      seller: sellerWallet,
      buyerAta,
      sellerAta,
      treasuryAta,
      config,
      priceUnits: totalUnits,
      vaultRef: await vaultRefForCard(listing.card_id),
      recentBlockhash,
    });
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : 'transaction build failed' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      quote,
      unsignedTx,
      buyerWallet,
      sellerWallet,
      treasuryWallet,
      buyerAta,
      sellerAta,
      treasuryAta,
      config,
      programId,
      usdcMint: mint,
      fxMyr: myr,
    },
    { status: 200 },
  );
}
