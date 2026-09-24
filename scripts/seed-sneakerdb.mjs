/**
 * scripts/seed-sneakerdb.mjs
 *
 * Catalog importer: TheSneakerDatabase (RapidAPI, free tier) -> sku_models
 * + skus variants -> product art mirrored to our R2.
 *
 *   node scripts/seed-sneakerdb.mjs --brand Nike --limit 100 --dry-run
 *   node scripts/seed-sneakerdb.mjs --brand Nike,Jordan --limit 400
 *   node scripts/seed-sneakerdb.mjs --brand Adidas --limit 200 --skip-images
 *
 * Env (reads .env.local in repo root when present; real env wins):
 *   SNEAKERDB_API_KEY      RapidAPI key (free tier is enough to start)
 *   SNEAKERDB_HOST         default the-sneaker-database.p.rapidapi.com
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *   R2_PUBLIC_URL (images only; skipped gracefully when absent)
 *
 * Rules the script obeys, so a human never has to audit row by row:
 * - PREREQUISITE: the style_code migration must be applied first. The
 *   script probes for the column and aborts with instructions otherwise.
 * - Idempotent: existing (brand, style_code) or (brand, model, colorway)
 *   rows are skipped, never duplicated or overwritten. Reruns only add.
 * - Art is set on INSERT only (015's guard blocks art_url UPDATEs anyway);
 *   models that already exist keep whatever art they have.
 * - Oracle honesty: base_price_cents = USD retail x live USDMYR at seed
 *   time (rate printed in the summary). Missing retail -> NULL (unpriced:
 *   cannot mint until an admin prices it). No invented precision.
 * - 300ms between API calls (free-tier 5 req/s ceiling).
 * - A row without a usable name/brand is skipped, never guessed.
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';

const SIZE_RUN = Array.from({ length: 21 }, (_, i) => 3 + i * 0.5);
const API_SLEEP_MS = 300;
const HOST_DEFAULT = 'the-sneaker-database.p.rapidapi.com';

function loadLocalEnv() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
    }
  } catch {
    // No local env file — real environment must provide everything.
  }
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (env or .env.local)`);
  return v;
}

function args() {
  const out = { brand: null, limit: 50, dryRun: false, skipImages: false };
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const next = raw[i + 1];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-images') out.skipImages = true;
    else if (a === '--brand' && next && !next.startsWith('--')) { out.brand = next; i++; }
    else if (a === '--limit' && next && !next.startsWith('--')) { out.limit = Math.max(1, Number(next) | 0); i++; }
    else if (a.startsWith('--brand=')) out.brand = a.slice(8);
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, Number(a.slice(8)) | 0);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'product';

// Defensive field picks — the v2 shape is documented but versioned;
// a renamed field must skip the row, never corrupt it.
const pickStyle = (p) => p.styleId ?? p.styleID ?? p.style_id ?? null;
const pickImage = (p) => {
  const im = p.image;
  if (typeof im === 'string') return im;
  return im?.original ?? im?.small ?? im?.thumbnail ?? null;
};
const pickRetailUsd = (p) => {
  const n = Number(p.retailPrice ?? p.retail_price);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const pickGender = (p) => {
  const g = String(p.gender ?? '').toLowerCase();
  return ['men', 'women', 'kids', 'unisex', 'youth'].includes(g) ? g : null;
};

async function main() {
  loadLocalEnv();
  const opts = args();
  const apiKey = requireEnv('SNEAKERDB_API_KEY');
  const host = (process.env.SNEAKERDB_HOST || HOST_DEFAULT).trim();

  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 0. Migration gate: style_code must exist before a single row is read.
  {
    const probe = await supabase.from('sku_models').select('style_code').limit(1);
    if (probe.error && /style_code|column|schema cache/i.test(probe.error.message)) {
      throw new Error(
        'sku_models.style_code is missing — run the catalog migration first, then re-run this script.',
      );
    }
    if (probe.error) throw new Error(`migration probe failed: ${probe.error.message}`);
  }

  // R2 is optional: without it, art stays null and rows still import.
  let s3 = null;
  let r2Base = '';
  const r2vals = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].map(
    (k) => process.env[k]?.trim(),
  );
  if (!opts.skipImages && r2vals.every(Boolean)) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2vals[0]}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2vals[1], secretAccessKey: r2vals[2] },
    });
    r2Base = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  } else if (!opts.skipImages) {
    console.log('R2 env incomplete — importing rows with art_url left null.');
  }

  // Live USD->MYR for the retail bootstrap (logged; estimates, not oracle truth).
  let usdMyr = 4.7;
  let rateLive = false;
  try {
    const fx = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();
    if (typeof fx?.rates?.MYR === 'number' && fx.rates.MYR > 0) {
      usdMyr = fx.rates.MYR;
      rateLive = true;
    }
  } catch { /* pinned fallback below */ }
  console.log(`USDMYR for retail bootstrap: ${usdMyr}${rateLive ? ' (live)' : ' (PINNED FALLBACK — verify)'}`);

  const headers = { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host };
  const seen = { products: 0, models: 0, variants: 0, images: 0, skipped: 0, unpriced: 0 };

  const existingCodes = new Set();
  {
    // Paged code inventory for idempotency (style_code only; small table).
    let from = 0;
    for (;;) {
      const r = await supabase.from('sku_models').select('style_code').not('style_code', 'is', null).range(from, from + 999);
      if (r.error) throw new Error(`style inventory failed: ${r.error.message}`);
      for (const row of r.data ?? []) existingCodes.add(row.style_code);
      if ((r.data ?? []).length < 1000) break;
      from += 1000;
    }
  }

  const brands = (opts.brand ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const seenIdentities = new Set();
  let page = 1;
  outer: for (;;) {
    let pageNew = 0;
    for (const brand of brands.length ? brands : ['']) {
      const q = new URLSearchParams({ limit: '100', page: String(page) });
      if (brand) q.set('brand', brand);
      const res = await fetch(`https://${host}/v2/sneakers?${q}`, { headers });
      await sleep(API_SLEEP_MS);
      if (!res.ok) throw new Error(`SneakerDB ${res.status} on page ${page} (brand '${brand || 'all'}')`);
      const body = await res.json();
      const items = body?.results ?? body?.data ?? (Array.isArray(body) ? body : []);
      if (!Array.isArray(items) || items.length === 0) break outer;
      for (const p of items) {
        if (seen.products >= opts.limit) break outer;
        seen.products++;
        const brandName = String(p.brand ?? '').trim();
        const silhouette = String(p.shoe ?? p.model ?? '').trim();
        const colorway = String(p.colorway ?? '').trim();
        if (!brandName || !silhouette || !colorway) { seen.skipped++; continue; }
        const styleCode = pickStyle(p) ? String(pickStyle(p)).trim().toUpperCase() : null;
        const identity = `${brandName}|${silhouette}|${colorway}`.toLowerCase();
        if ((styleCode && existingCodes.has(styleCode)) || seenIdentities.has(identity)) {
          seen.skipped++;
          continue;
        }
        seenIdentities.add(identity);

        const retailUsd = pickRetailUsd(p);
        const baseCents = retailUsd != null ? Math.round(retailUsd * usdMyr * 100) : null;
        if (baseCents == null) seen.unpriced++;

        let artUrl = null;
        const srcImage = pickImage(p);
        if (srcImage && s3 && r2Base && !opts.dryRun) {
          try {
            const img = await fetch(srcImage);
            if (!img.ok) throw new Error(`image ${img.status}`);
            const mime = (img.headers.get('content-type') || '').split(';')[0].trim();
            const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
            const key = `catalog/${slugify(styleCode ?? `${brandName}-${silhouette}-${colorway}`)}.${ext}`;
            const buf = Buffer.from(await img.arrayBuffer());
            await s3.send(new PutObjectCommand({
              Bucket: r2vals[3], Key: key, Body: buf,
              ContentType: mime.startsWith('image/') ? mime : 'image/jpeg',
            }));
            artUrl = `${r2Base}/${key}`;
            seen.images++;
          } catch (e) {
            console.log(`  art failed for ${brandName} ${silhouette} (${styleCode ?? 'no-code'}): ${e.message}`);
          }
        }

        console.log(`${opts.dryRun ? '[dry] ' : ''}+ ${brandName} ${silhouette} | ${colorway} | ${styleCode ?? 'no-code'} | retail ${retailUsd != null ? `$${retailUsd}` : 'n/a'}${artUrl ? ' | art' : ''}`);
        pageNew++;
        if (opts.dryRun) continue;

        const modelRow = {
          brand: brandName, model: silhouette, colorway,
          base_price_cents: baseCents,
          art_url: artUrl,
          style_code: styleCode,
          source: 'sneakerdb',
          external_id: p.id != null ? String(p.id) : null,
          gender: pickGender(p),
        };
        const ins = await supabase.from('sku_models').insert(modelRow).select('id').single();
        if (ins.error) { console.log(`  MODEL INSERT FAILED: ${ins.error.message}`); continue; }
        if (styleCode) existingCodes.add(styleCode);
        seen.models++;

        const variants = SIZE_RUN.map((size_us) => ({
          model_id: ins.data.id, brand: brandName, model: silhouette, colorway,
          size_us, retail_price_cents: baseCents,
        }));
        const vins = await supabase.from('skus').insert(variants);
        if (vins.error) console.log(`  VARIANT INSERT FAILED: ${vins.error.message}`);
        else seen.variants += variants.length;
      }
    }
    page++;
    if (pageNew === 0) break; // API ignores paging (or catalog exhausted) — same rows would repeat.
    if (page > 50) break; // sanity ceiling
  }

  console.log(`\ndone: ${seen.products} products seen, ${seen.models} models, ${seen.variants} variants, ${seen.images} images, ${seen.skipped} skipped, ${seen.unpriced} unpriced${opts.dryRun ? ' (DRY RUN — nothing written)' : ''}`);
}

main().catch((e) => { console.error(`seed failed: ${e.message}`); process.exit(1); });
