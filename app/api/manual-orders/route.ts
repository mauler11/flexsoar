import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getListing } from '@/lib/api/contract';
import { checkRateLimit, createRateLimitStore, clientIp, retryAfterSeconds } from '@/lib/api/rate-limit';
import { manualCheckoutStatus, manualPaymentConfig } from '@/lib/manual-checkout/config';
import { LISTING_ID, orderReference, validateContact } from '@/lib/manual-checkout/order';
import { sendManualOrderEmails } from '@/lib/email/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const rateStore = createRateLimitStore();
const rule = { limit: 5, windowMs: 3_600_000 };
const reply = (body: object, status: number, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Expected JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body required');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new Error('Request too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: Request): Promise<NextResponse> {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid request origin' }, 403);
  const session = await createServerSupabase();
  const { data, error } = await session.auth.getUser();
  if (error || !data.user) return reply({ error: 'Sign in to request an order' }, 401);
  const user = checkRateLimit(rateStore, `user:${data.user.id}`, rule);
  const ip = checkRateLimit(rateStore, `ip:${clientIp(request)}`, rule);
  if (!user.allowed || !ip.allowed) return reply({ error: 'Too many requests. Try again later.' }, 429, { 'Retry-After': String(retryAfterSeconds(Math.max(user.resetAt, ip.resetAt))) });
  let body: unknown;
  try { body = await readBody(request); } catch { return reply({ error: 'Invalid request body (maximum 4 KB)' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid request' }, 400);
  const honeypot: unknown = Reflect.get(body, 'website');
  if (typeof honeypot !== 'string') return reply({ error: 'Invalid request' }, 400);
  if (honeypot) return reply({ message: 'Request received' }, 200);
  const listingId: unknown = Reflect.get(body, 'listingId');
  if (typeof listingId !== 'string' || !LISTING_ID.test(listingId)) return reply({ error: 'Invalid listing' }, 400);
  if (manualCheckoutStatus(listingId) !== 'open') return reply({ error: 'This listing is not accepting order requests' }, 409);
  let contact;
  try { contact = validateContact(body); } catch (e) { return reply({ error: e instanceof Error ? e.message : 'Invalid details' }, 400); }
  try {
    // Always read current server terms. Client-supplied price/user/recipient fields are ignored.
    const listing = await getListing(listingId);
    if (!listing || listing.status !== 'public' || listing.order || listing.seller_id === data.user.id) return reply({ error: 'Listing unavailable' }, 409);
    if (!Number.isSafeInteger(listing.price_cents) || listing.price_cents <= 0) return reply({ error: 'Listing price unavailable' }, 409);
    const payment = manualPaymentConfig();
    const reference = orderReference();
    const sku = listing.card.sku;
    await sendManualOrderEmails({ ...contact, reference, userId: data.user.id, listingId,
      item: `${sku.brand} ${sku.model} ${sku.colorway} (US ${sku.size_us})`, priceCents: listing.price_cents,
      address: payment.address, qrUrl: payment.qrUrl });
    return reply({ reference, message: 'Order request received. Check your email. This does not reserve the pair; wait for availability confirmation before paying.' }, 201);
  } catch {
    return reply({ error: 'We could not confirm your request emails. Contact support before submitting again or paying.' }, 503);
  }
}
