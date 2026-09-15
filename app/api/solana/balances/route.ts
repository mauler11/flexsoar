/**
 * app/api/solana/balances/route.ts — GET /api/solana/balances
 *
 * Read-only balance display for the caller's linked wallet: SOL lamports
 * (fee coverage) plus summed USDC base units for the configured mint.
 * The Helius key never leaves the server — both RPC calls happen here,
 * the browser only sees the totals. No wallet linked → 409 with nothing
 * to display; the UI renders nothing in that case instead of nagging.
 */

import { NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase/server';
import { rpcUrl, usdcMint } from '@/lib/solana/config';
import { sumUsdcUnits } from '@/lib/solana/balances';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: 'sign in to see balances' }, { status: 401 });
  }

  const { data } = await supabase
    .from('users')
    .select('solana_address')
    .eq('id', userId)
    .maybeSingle();
  const wallet =
    (data as { solana_address?: string | null } | null)?.solana_address ?? null;
  if (!wallet) {
    return NextResponse.json({ error: 'no wallet linked' }, { status: 409 });
  }

  const mint = usdcMint();
  let rpc: string;
  try {
    rpc = rpcUrl();
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : 'rpc not configured' },
      { status: 501 },
    );
  }

  try {
    const [solRes, tokenRes] = await Promise.all([
      fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'flexsoar-balance',
          method: 'getBalance',
          params: [wallet, { commitment: 'confirmed' }],
        }),
      }),
      fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'flexsoar-tokens',
          method: 'getTokenAccountsByOwner',
          params: [
            wallet,
            { mint },
            { encoding: 'jsonParsed', commitment: 'confirmed' },
          ],
        }),
      }),
    ]);
    if (!solRes.ok || !tokenRes.ok) {
      return NextResponse.json(
        { error: 'balance rpc unreachable — try again shortly' },
        { status: 502 },
      );
    }
    const solBody = (await solRes.json()) as { result?: { value?: number } };
    const tokenBody = (await tokenRes.json()) as {
      result?: { value?: { account?: unknown }[] };
    };
    const solLamports = solBody.result?.value ?? 0;
    const { units, decimals } = sumUsdcUnits(
      (tokenBody.result?.value ?? []) as Parameters<typeof sumUsdcUnits>[0],
      mint,
    );
    return NextResponse.json(
      { wallet, solLamports, usdcUnits: units, usdcDecimals: decimals, usdcMint: mint },
      { status: 200 },
    );
  } catch (thrown) {
    return NextResponse.json(
      { error: thrown instanceof Error ? `balance rpc failed: ${thrown.message}` : 'balance rpc failed' },
      { status: 502 },
    );
  }
}
