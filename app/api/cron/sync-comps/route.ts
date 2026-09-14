/**
 * app/api/cron/sync-comps/route.ts — GET /api/cron/sync-comps
 *
 * Daily live-market sync (Vercel Cron, 03:00 UTC — see vercel.json). For
 * every catalog model, pulls recent eBay SOLD listings, takes the median
 * into one MYR-sen point, and pins it on the model's tape as source
 * 'ebay'. This is what makes every graph move from day one, before the
 * first FlexSoar sale: the dashed market line refreshes daily whether or
 * not anything traded here.
 *
 * Models with fewer than 3 solds are skipped, not zero-filled — a median
 * of 1–2 is noise, and the chart's reference-only state already says so
 * honestly. Individual model failures never abort the batch.
 *
 * Auth: same CRON_SECRET bearer pattern as process-payouts. No EBAY_APP_ID
 * on the project yet (manual eBay developer setup) → reports skipped
 * rather than failing, so the schedule is safe to ship before the key.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  getPriceHistory,
  listSkuModels,
  recordMarketRefsService,
  updateFairMarketCache,
} from '@/lib/api/contract';
import { compForModel, medianSen } from '@/lib/market/ebay';

export const dynamic = 'force-dynamic';
// Hobby ceiling is 60s — models sync in chunks of 5 to stay under it.
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

/**
 * Recomputes one model's 054 display cache from its tape — median of the
 * trailing 90d, latest point as fallback, null when the tape is empty.
 * Same definition as fairMarketPrice() on the pages; the duplication is
 * one median call, kept beside the cron so the route never imports a
 * client component module.
 */
async function refreshCache(modelId: string): Promise<void> {
  const history = await getPriceHistory(modelId);
  const cutoff = Date.now() - 90 * 86400000;
  const inWindow = history.filter(
    (p) => new Date(p.observedAt).getTime() >= cutoff,
  );
  const pool = (inWindow.length > 0 ? inWindow : history.slice(-1)).map(
    (p) => p.priceCents,
  );
  await updateFairMarketCache(modelId, medianSen(pool));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.EBAY_APP_ID?.trim()) {
    return NextResponse.json(
      { synced: 0, skipped: ['EBAY_APP_ID not set'], failed: [] },
      { status: 200 },
    );
  }

  try {
    const models = await listSkuModels({ limit: 200 });
    const synced: string[] = [];
    const skipped: string[] = [];
    const failed: { model: string; error: string }[] = [];

    for (let i = 0; i < models.length; i += 5) {
      const chunk = models.slice(i, i + 5);
      const outcomes = await Promise.all(
        chunk.map(async (m) => {
          try {
            const comp = await compForModel(m.brand, m.model, m.colorway);
            if (comp.medianSen == null) {
              await refreshCache(m.id);
              return { status: 'skipped' as const, label: `${m.brand} ${m.model}` };
            }
            await recordMarketRefsService(m.id, [
              {
                priceCents: comp.medianSen,
                observedAt: new Date().toISOString(),
                source: 'ebay',
              },
            ]);
            await refreshCache(m.id);
            return { status: 'synced' as const, label: `${m.brand} ${m.model}` };
          } catch (thrown) {
            return {
              status: 'failed' as const,
              label: `${m.brand} ${m.model}`,
              error: thrown instanceof Error ? thrown.message : String(thrown),
            };
          }
        }),
      );
      for (const o of outcomes) {
        if (o.status === 'synced') synced.push(o.label);
        else if (o.status === 'skipped') skipped.push(o.label);
        else failed.push({ model: o.label, error: o.error });
      }
    }

    console.log(
      `[comps-cron] synced=${synced.length} skipped=${skipped.length} failed=${failed.length}`,
      failed.length > 0 ? failed : '',
    );
    return NextResponse.json(
      { synced: synced.length, skipped, failed },
      { status: 200 },
    );
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error('[comps-cron] batch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
