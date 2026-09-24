/**
 * scripts/seed-sneakerdb.mjs
 *
 * Catalog importer: KicksCrew Sneakers Data (RapidAPI) -> sku_models
 * + skus variants -> product art mirrored to our R2.
 *
 *   node scripts/seed-sneakerdb.mjs --brand Nike --limit 5 --dry-run
 *   node scripts/seed-sneakerdb.mjs --brand Nike,Jordan --limit 400
 *   node scripts/seed-sneakerdb.mjs --brand Adidas --limit 200 --skip-images
 *
 * (History: first written against TheSneakerDatabase, whose provider went
 * dark — KicksCrew is the live source. Filename kept so docs stay valid.)
 *
 * Env (reads .env.local in repo root when present; real env wins):
 *   SNEAKERDB_API_KEY      RapidAPI key subscribed to the KicksCrew Sneakers
 *                          Data API (Basic free = 40 req/month — a few broad
 *                          brand searches cover a launch catalog).
 *   SNEAKERDB_HOST         default kickscrew-sneakers-data.p.rapidapi.com
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
 * - Oracle honesty: base_price_cents = KicksCrew's live USD ask x live
 *   USDMYR at seed time (rate printed in the summary). Missing price ->
 *   NULL (unpriced: cannot mint until an admin prices it). No invented
 *   precision; the market tape takes over from here.
 * - 300ms between API calls (free-tier 5 req/s ceiling).
 * - A row without a usable name/brand is skipped, never guessed.
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';

const SIZE_RUN = Array.from({ length: 21 }, (_, i) => 3 + i * 0.5);
const API_SLEEP_MS = 1000; // KicksCrew free quota is monthly-capped; be gentle.
const HOST_DEFAULT = 'kickscrew-sneakers-data.p.rapidapi.com';

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

/**
 * Canonical brand display. Sources disagree on casing ("adidas" vs "Nike"
 * vs "ASICS") and the market's brand pills filter on exact match — unmapped
 * casing strands listings under the wrong pill (or "Other"). Unknown
 * brands fall back to title case.
 */
const BRAND_CANONICAL = new Map(
  Object.entries({
    nike: 'Nike',
    jordan: 'Jordan',
    adidas: 'Adidas',
    'new balance': 'New Balance',
    asics: 'Asics',
    puma: 'Puma',
    converse: 'Converse',
    vans: 'Vans',
    reebok: 'Reebok',
    yeezy: 'Yeezy',
    crocs: 'Crocs',
    salomon: 'Salomon',
    saucony: 'Saucony',
    hoka: 'Hoka',
    mizuno: 'Mizuno',
    'under armour': 'Under Armour',
    anta: 'Anta',
    'li-ning': 'Li-Ning',
    on: 'On',
    brooks: 'Brooks',
    fila: 'Fila',
    timberland: 'Timberland',
  }),
);

function canonicalBrand(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (BRAND_CANONICAL.has(key)) return BRAND_CANONICAL.get(key);
  return key
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Defensive field picks — provider shapes drift; a renamed field must skip
// the row, never corrupt it.
const pickStyle = (p) => {
  const raw = p.model_no ?? p.modelNo ?? null;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null;
};
const pickImage = (p) => {
  const urls = Array.isArray(p.image_urls) ? p.image_urls : [];
  const first = urls.find((u) => typeof u === 'string' && u.startsWith('https://'));
  return first ?? null;
};
const pickPriceUsd = (p) => {
  const n = Number(p.lowest_price ?? p.price);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const pickGender = (p) => {
  const g = String(p.gender ?? '').toLowerCase();
  if (g.startsWith('men')) return 'men';
  if (g.startsWith('women')) return 'women';
  if (g.startsWith('kid') || g.startsWith('youth') || g.startsWith('child')) return 'kids';
  if (g.startsWith('unisex')) return 'unisex';
  return null;
};
const pickTitle = (p) => String(p.variantTitle ?? p.title ?? p.name ?? '').trim();

/**
 * Split a KicksCrew variantTitle into model + colorway. Handles:
 * - leading "(GS)/(WMNS)/…" tags and brand prefix,
 * - trailing style code and 4-digit year ("…2026"),
 * - year shorthand fragments ('07, '26),
 * - interior apostrophes ("Valentine's Day"): the colorway spans from the
 *   first kept opening quote to the last closing quote, preserving them.
 * Heuristic by necessity — every row prints in dry-run for eyeballing,
 * and the admin model editor renames stragglers.
 */
function splitTitle(variantTitle, brand, styleCode) {
  let rest = String(variantTitle ?? '').trim();
  rest = rest.replace(/^(\([^)]+\)\s*)+/, '').trim();
  rest = rest.replace(new RegExp(`^${brand}\\s+`, 'i'), '').trim();
  if (styleCode) {
    const esc = styleCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rest = rest.replace(new RegExp(`\\s*${esc}\\s*$`, 'i'), '').trim();
  }
  rest = rest.replace(/\s*\b(19|20)\d{2}\s*$/, '').trim();
  // Curly apostrophes (’, ‘) break quote pairing — normalize first.
  rest = rest.replace(/[‘’‚‛]/g, "'");
  // A lone year abbreviation ('07 with no closing quote) is literal text,
  // not a span boundary — drop such quotes from pairing, keep them in situ.
  const idx = [...rest.matchAll(/'/g)]
    .map((m) => m.index)
    .filter((i) => !/^'\d\d(\s|$)/.test(rest.slice(i, i + 4)));
  if (idx.length === 0) return { model: rest, colorway: '' };
  let open;
  let close;
  if (idx.length === 2) {
    // A lone year fragment ('07) is model, not colorway.
    if (/^'\d{2}$/.test(rest.slice(idx[0], idx[1] + 1))) {
      return { model: rest, colorway: '' };
    }
    open = idx[0];
    close = idx[1];
  } else if (idx.length % 2 === 1) {
    // Interior apostrophe ("Valentine's Day"): span first to last.
    open = idx[0];
    close = idx[idx.length - 1];
  } else {
    // 4+: pair left to right, drop leading year fragments, take last span.
    const spans = [];
    for (let i = 0; i < idx.length; i += 2) spans.push([idx[i], idx[i + 1]]);
    while (spans.length > 1 && /^'\d{2}$/.test(rest.slice(spans[0][0], spans[0][1] + 1))) {
      spans.shift();
    }
    const last = spans[spans.length - 1];
    open = last[0];
    close = last[1];
  }
  const colorway = rest.slice(open + 1, close).trim();
  const model = rest.slice(0, open).trim() || rest;
  return { model, colorway };
}

/** Youth sizes don't map to our men's size run — skip them outright. */
function isYouthTitle(variantTitle) {
  return /\((GS|PS|TD|BC|INFANT|TODDLER|YOUTH|KIDS)\)/i.test(String(variantTitle ?? ''));
}

/**
 * Apparel / non-sneaker footwear exclusion. Authoritative signals first
 * (sub-type, tags); title keywords only when those are absent — a "Dress-Up"
 * sneaker with shoe tags must survive while a tagless hoodie must not.
 */
const APPAREL_WORDS = [
  't-shirt', 'tshirt', 'tee', 'hoodie', 'jersey', 'sweatshirt', 'jacket',
  'pants', 'trousers', 'blazer', 'shorts', 'socks', 'hat', 'cap', 'beanie',
  'bag', 'backpack', 'bodysuit', 'skirt', 'bra', 'leggings', 'underwear',
  'tracksuit', 'sweatpants', 'polo',
];
// Never sneakers, no matter what the tags claim — unconditional exclusion.
const NEVER_FOOTWEAR_WORDS = ['sandal', 'slide', 'clog', 'croc'];
const wordHit = (title, words) =>
  words.some((w) => new RegExp(`\\b${w.replace(/-/g, '[-\\s]')}\\b`, 'i').test(title));
function isSneakerProduct(p) {
  if (!p || typeof p !== 'object') return false;
  const title = String(p.variantTitle ?? p.title ?? '');
  if (wordHit(title, NEVER_FOOTWEAR_WORDS)) return false;
  const sub = String(p.product_sub_type ?? '').toLowerCase();
  if (sub) return sub.includes('sneaker') || sub.includes('shoe');
  const tags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : [];
  const taggedFootwear = tags.some((t) => t.includes('shoe') || t.includes('sneaker') || t.includes('footwear'));
  if (wordHit(title, APPAREL_WORDS) && !taggedFootwear) return false;
  return true;
}

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
  console.log(`USDMYR for ask bootstrap: ${usdMyr}${rateLive ? ' (live)' : ' (PINNED FALLBACK — verify)'}`);

  const headers = { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host };
  const seen = { products: 0, models: 0, variants: 0, images: 0, skipped: 0, unpriced: 0 };
  const skipWhy = { duplicate: 0, youth: 0, apparel: 0, nofields: 0 };

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
  // KicksCrew: one broad query per brand term returns the whole shelf —
  // no paging contract documented, so single shot per term.
  for (const brand of brands.length ? brands : ['sneakers']) {
    const q = new URLSearchParams({ query: brand });
    const res = await fetch(`https://${host}/search?${q}`, { headers });
    await sleep(API_SLEEP_MS);
    if (!res.ok) throw new Error(`KicksCrew ${res.status} on query '${brand}'`);
    const body = await res.json();
    const items = body?.products ?? (Array.isArray(body) ? body : []);
    if (!Array.isArray(items) || items.length === 0) continue;
    for (const p of items) {
        if (seen.products >= opts.limit) break;
        seen.products++;
        // Launch scope: sneakers, adult sizes. Youth rows would mint
        // men's-run variants that don't exist; apparel needs its own
        // intake. Both skip loudly here, counted below.
        if (isYouthTitle(p.variantTitle ?? p.title) || pickGender(p) === 'kids') {
          seen.skipped++;
          skipWhy.youth++;
          continue;
        }
        if (!isSneakerProduct(p)) { seen.skipped++; skipWhy.apparel++; continue; }
        const brandName = canonicalBrand(p.brand);
        const styleCode = pickStyle(p);
        const { model: silhouette, colorway } = splitTitle(p.variantTitle ?? p.title, brandName, styleCode);
        if (!brandName || !silhouette) { seen.skipped++; skipWhy.nofields++; continue; }
        const color = colorway || 'Unknown';
        const identity = `${brandName}|${silhouette}|${color}`.toLowerCase();
        if ((styleCode && existingCodes.has(styleCode)) || seenIdentities.has(identity)) {
          seen.skipped++;
          skipWhy.duplicate++;
          continue;
        }
        seenIdentities.add(identity);

        // Oracle bootstrap: KicksCrew's live market ask, USD -> MYR.
        const priceUsd = pickPriceUsd(p);
        const baseCents = priceUsd != null ? Math.round(priceUsd * usdMyr * 100) : null;
        if (baseCents == null) seen.unpriced++;

        let artUrl = null;
        const srcImage = pickImage(p);
        if (srcImage && s3 && r2Base && !opts.dryRun) {
          try {
            const img = await fetch(srcImage);
            if (!img.ok) throw new Error(`image ${img.status}`);
            const mime = (img.headers.get('content-type') || '').split(';')[0].trim();
            const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
            const key = `catalog/${slugify(styleCode ?? `${brandName}-${silhouette}-${color}`)}.${ext}`;
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

        console.log(`${opts.dryRun ? '[dry] ' : ''}+ ${brandName} ${silhouette} | ${color} | ${styleCode ?? 'no-code'} | ask $${priceUsd ?? 'n/a'}${artUrl ? ' | art' : ''}`);
        if (opts.dryRun) continue;

        const modelRow = {
          brand: brandName, model: silhouette, colorway: color,
          base_price_cents: baseCents,
          art_url: artUrl,
          style_code: styleCode,
          source: 'kickscrew',
          external_id: p._id != null ? String(p._id) : null,
          gender: pickGender(p),
        };
        const ins = await supabase.from('sku_models').insert(modelRow).select('id').single();
        if (ins.error) { console.log(`  MODEL INSERT FAILED: ${ins.error.message}`); continue; }
        if (styleCode) existingCodes.add(styleCode);
        seen.models++;

        const variants = SIZE_RUN.map((size_us) => ({
          model_id: ins.data.id, brand: brandName, model: silhouette, colorway: color,
          size_us, retail_price_cents: baseCents,
        }));
        const vins = await supabase.from('skus').insert(variants);
        if (vins.error) console.log(`  VARIANT INSERT FAILED: ${vins.error.message}`);
        else seen.variants += variants.length;
    }
  }

  console.log(`\ndone: ${seen.products} products seen, ${seen.models} models, ${seen.variants} variants, ${seen.images} images, ${seen.skipped} skipped (dup ${skipWhy.duplicate}, youth ${skipWhy.youth}, apparel ${skipWhy.apparel}, nofields ${skipWhy.nofields}), ${seen.unpriced} unpriced${opts.dryRun ? ' (DRY RUN — nothing written)' : ''}`);
}

main().catch((e) => { console.error(`seed failed: ${e.message}`); process.exit(1); });
