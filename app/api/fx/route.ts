/**
 * app/api/fx/route.ts — GET /api/fx
 *
 * Public USD-base FX table for site-wide display conversion. No auth
 * (exchange rates are public data), no key — same provider chain as the
 * quote path (er-api → frankfurter). Display-only: settlement never reads
 * this route; quotes pin their own rate per trade.
 */

import { NextResponse } from 'next/server';

import { fxTable } from '@/lib/solana/fx';

/** 60s server cache: free providers see one request per minute per
    deployment, not one per client poll. */
export const revalidate = 60;

export async function GET(): Promise<NextResponse> {
  const rates = await fxTable().catch(() => null);
  if (!rates) {
    return NextResponse.json({ error: 'fx unavailable' }, { status: 502 });
  }
  return NextResponse.json({ rates }, { status: 200 });
}
