/**
 * app/api/cron/process-payouts/route.ts — GET /api/cron/process-payouts
 *
 * Scheduled payout runner (Vercel Cron, daily 02:00 UTC — see vercel.json).
 * Pays every eligible order via processAllDuePayouts() and reports per-order
 * results. Individual failures never abort the batch; they come back in
 * `failed` for a human to reconcile.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
 * when CRON_SECRET is set on the project. Anything else gets 401 — there is
 * deliberately no session/admin-cookie path, so this can never be triggered
 * from the UI by accident.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { processAllDuePayouts } from '@/lib/api/contract';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await processAllDuePayouts();
    console.log(
      `[payout-cron] processed=${result.processed} failed=${result.failed.length}`,
      result.failed.length > 0 ? result.failed : '',
    );
    return NextResponse.json(
      { processed: result.processed, failed: result.failed },
      { status: 200 },
    );
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error('[payout-cron] batch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
