/**
 * scripts/refresh-kickscrew-asks.mjs
 *
 * Writes KicksCrew's live USD asks into market_refs (source 'kickscrew'),
 * one point per model — the PriceChart's dashed market line and the Fair
 * Market Price feed on exactly this. Run monthly by hand (free quota is
 * 40 req/month; one run costs ~6):
 *
 *   node scripts/refresh-kickscrew-asks.mjs --dry-run
 *   node scripts/refresh-kickscrew-asks.mjs
 *
 * Env (reads .env.local in repo root when present; real env wins):
 *   SNEAKERDB_API_KEY, SNEAKERDB_HOST (same as the seed importer)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Rules:
 * - Matches products to models by style_code only — no fuzzy matching, a
 *   near-miss price on the wrong shoe is worse than no point.
 * - Skips models with a kickscrew ref from the last 20h (idempotent
 *   reruns; an accidental double-run writes nothing twice).
 * - USD -> MYR at live open.er-api rates (logged); pinned 4.079374 fallback.
 * - Writes nothing but market_refs rows. Oracle, tiers, and listings are
 *   untouched — refs are reference context, never authority.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const HOST_DEFAULT = 'kickscrew-sneakers-data.p.rapidapi.com';
const BRAND_QUERIES = ['Nike', 'Jordan', 'Adidas', 'New Balance', 'Asics', 'Puma'];
const API_SLEEP_MS = 1000;

function loadLocalEnv() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
    }
  } catch { /* env must provide everything */ }
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (env or .env.local)`);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dryRun = process.argv.includes('--dry-run');

async function main() {
  loadLocalEnv();
  const apiKey = requireEnv('SNEAKERDB_API_KEY');
  const host = (process.env.SNEAKERDB_HOST || HOST_DEFAULT).trim();
  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let usdMyr = 4.079374;
  try {
    const fx = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();
    if (typeof fx?.rates?.MYR === 'number' && fx.rates.MYR > 0) usdMyr = fx.rates.MYR;
  } catch { /* pinned fallback */ }
  console.log(`USDMYR: ${usdMyr}`);

  // Model inventory keyed by style code.
  const models = new Map();
  {
    let from = 0;
    for (;;) {
      const r = await supabase.from('sku_models').select('id,brand,model,style_code').not('style_code', 'is', null).range(from, from + 999);
      if (r.error) throw new Error(`model inventory failed: ${r.error.message}`);
      for (const m of r.data ?? []) models.set(String(m.style_code).toUpperCase(), m);
      if ((r.data ?? []).length < 1000) break;
      from += 1000;
    }
  }
  // Skip models refreshed in the last 20h (rerun safety).
  const freshCutoff = new Date(Date.now() - 20 * 3600_000).toISOString();
  {
    const r = await supabase.from('market_refs').select('model_id').eq('source', 'kickscrew').gte('observed_at', freshCutoff);
    if (r.error) throw new Error(`freshness check failed: ${r.error.message}`);
    var freshIds = new Set((r.data ?? []).map((x) => x.model_id));
  }
  console.log(`models with style codes: ${models.size}, fresh in last 20h: ${freshIds.size}`);

  const headers = { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host };
  let calls = 0;
  let points = 0;
  let skipped = 0;
  for (const brand of BRAND_QUERIES) {
    const res = await fetch(`https://${host}/search?${new URLSearchParams({ query: brand })}`, { headers });
    calls++;
    await sleep(API_SLEEP_MS);
    if (!res.ok) {
      console.log(`  ${brand}: HTTP ${res.status} — skipped`);
      continue;
    }
    const body = await res.json();
    const items = Array.isArray(body?.products) ? body.products : [];
    let brandPoints = 0;
    for (const p of items) {
      const code = typeof p?.model_no === 'string' ? p.model_no.trim().toUpperCase() : null;
      const price = Number(p?.lowest_price ?? p?.price);
      if (!code || !models.has(code) || !(price > 0)) continue;
      const model = models.get(code);
      if (freshIds.has(model.id)) continue;
      const cents = Math.round(price * usdMyr * 100);
      if (dryRun) {
        console.log(`[dry] ${model.brand} ${model.model} <- $${price} = RM ${(cents / 100).toFixed(2)}`);
      } else {
        const ins = await supabase.from('market_refs').insert({
          model_id: model.id, price_cents: cents, source: 'kickscrew',
        });
        if (ins.error) {
          console.log(`  REF INSERT FAILED ${code}: ${ins.error.message}`);
          continue;
        }
        freshIds.add(model.id);
      }
      brandPoints++;
      points++;
    }
    console.log(`${brand}: ${items.length} products, ${brandPoints} points${dryRun ? ' (DRY RUN)' : ''}`);
    skipped += items.length - brandPoints;
  }
  console.log(`\ndone: ${calls} api calls, ${points} points, ${skipped} unmatched/fresh-skipped${dryRun ? ' (DRY RUN — nothing written)' : ''}`);
}

main().catch((e) => { console.error(`refresh failed: ${e.message}`); process.exit(1); });
