/**
 * app/api/solana/link-wallet/route.ts — POST /api/solana/link-wallet
 *
 * Links the caller's USDC payout wallet after Ed25519 proof-of-ownership.
 * Body: { address, signature, issuedAt }. The stored value is the address
 * that VERIFIED, never an address taken on trust.
 *
 * Service-role write, deliberately: users RLS permits handle-only
 * self-update, and an Ed25519 proof is inexpressible in RLS. The
 * signature over the caller-bound fresh message IS the authorization —
 * see lib/solana/wallet.ts. No session, no link; wrong wallet, no link.
 */

import { NextResponse } from 'next/server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server';
import { verifyWalletLink } from '@/lib/solana/wallet';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: 'sign in to link a wallet' }, { status: 401 });
  }

  let body: { address?: string; signature?: string; issuedAt?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'malformed request' }, { status: 400 });
  }
  if (!body.address || !body.signature || !body.issuedAt) {
    return NextResponse.json(
      { error: 'address, signature and issuedAt are required' },
      { status: 400 },
    );
  }

  const checked = await verifyWalletLink({
    userId,
    address: body.address,
    signature: body.signature,
    issuedAt: body.issuedAt,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }

  const service = await createServiceSupabase();
  const { error } = await service
    .from('users')
    .update({ solana_address: checked.address })
    .eq('id', userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, address: checked.address }, { status: 200 });
}
