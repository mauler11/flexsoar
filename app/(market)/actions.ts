'use server';

/**
 * app/(market)/actions.ts
 *
 * Every mutation the market surface needs, one Server Action each. The
 * contract stays server-only: client components call these, never the contract
 * directly.
 *
 * Whatever the UI can be trusted to decide upstream (which button renders) is
 * re-checked here against the session. ownership, the early-access gate, and
 * self-purchase are all enforced again before a Session is created or an RPC
 * fires — the webhook's fn_purchase_card is the last line, not the first.
 *
 * Errors surface by redirecting with the message verbatim in `?error=`, the
 * same pattern app/(auth) uses — AGENT_RULES says never swallow a server
 * error.
 */

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Stripe from 'stripe';

import {
  getCard,
  getListing,
  getListings,
  getRedemptionHandlingFeeCents,
  getUser,
  listCard,
  cancelListing,
  redeemCard,
  getCreditAvailable,
  getPlatformConfig,
  reserveCredit,
  releaseCreditHold,
  purchaseCardSplit,
  setCountry,
  markNotificationRead,
} from '@/lib/api/contract';
import type { ShippingAddress } from '@/lib/api/contract';
import type { UUID } from '@/lib/db/types';
import { createServerSupabase } from '@/lib/supabase/server';
import { sendRedemptionRequestedEmail } from '@/lib/email/send';
import { isCleanUsername } from '@/lib/auth/handle';
import { safeNextPath } from '@/app/(auth)/paths';
import { currentUserId, currentUserLevel } from '@/app/(market)/queries';
import { isValidCountryCode } from '@/components/market/intake/intake-config';
import {
  CREDIT_HOLD_MINUTES_FALLBACK,
  cashLegCents,
  checkoutExpiresAtSeconds,
  isFscOnlyPurchase,
  validateRequestedCredit,
} from '@/app/(market)/checkout-math';
import {
  SHIPPING_ZONES,
  shippingZoneForPostcode,
  type ShippingZoneCode,
} from '@/lib/market/shipping';

/** The market route for a card id. Cards and listings live under (market). */
function cardPath(cardId: UUID): string {
  return `/card/${cardId}`;
}

/** Redirect carrying the server text verbatim, never swallowed. */
function redirectWithError(path: string, message: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

/** Redirect an anonymous caller to sign-in, remembering where they were going. */
function requireSignedIn(backTo: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(safeNextPath(backTo))}`);
}

function errorText(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown ?? 'unknown error');
}

/** The site origin for Stripe's success/cancel URLs and Checkout Sessions. */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) {
    throw new Error(
      'cannot determine the site origin: no Host header and NEXT_PUBLIC_SITE_URL is unset',
    );
  }
  const proto = headerList.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

// ------------------------------------------------------------
// LISTING — owner only
// ------------------------------------------------------------

/**
 * `listCard` the card the caller owns. The price is always in integer cents
 * and positive; the 15%-below-oracle warning is the UI's job, this action does
 * not refuse a low price (fn_list_card stores whatever > 0 it is given).
 */
export async function listCardAction(formData: FormData): Promise<void> {
  const cardId = String(formData.get('card_id') ?? '');
  const priceCents = Number(formData.get('price_cents'));
  const countryRaw = String(formData.get('country_code') ?? '').trim().toUpperCase();
  const backTo = cardPath(cardId);

  const me = await currentUserId();
  if (!me) requireSignedIn(backTo);

  if (!/^[0-9a-f-]{36}$/i.test(cardId)) {
    redirectWithError(backTo, 'invalid card id');
  }
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    redirectWithError(backTo, 'price must be a whole number of cents greater than zero');
  }

  try {
    const detail = await getCard(cardId);
    if (!detail) {
      redirectWithError(backTo, 'card not found');
    }
    if (detail.owner.id !== me) {
      redirectWithError(backTo, 'not your card');
    }
    if (detail.status !== 'active') {
      redirectWithError(backTo, `card is ${detail.status}, expected active`);
    }
    if (detail.listing) {
      redirectWithError(backTo, 'card already has a live listing');
    }

    // fn_list_card calls fn_payout_method_for_user internally
    // (019c_settlement.sql:360) and (025) raises COUNTRY_NOT_SET for a
    // seller with none on file. ListForm only sends country_code when it
    // rendered its own picker (the owner had none) — see its doc comment —
    // so this write lands right before the call that needs it, and only
    // when there was actually nothing on file.
    if (countryRaw) {
      if (!isValidCountryCode(countryRaw)) {
        redirectWithError(backTo, 'select a valid country before listing');
      }
      await setCountry(countryRaw);
    }

    await listCard(cardId, me, priceCents);
  } catch (thrown) {
    redirectWithError(backTo, errorText(thrown));
  }

  redirect(backTo);
}

/** Seller only. The RPC checks ownership again; this is the friendly gate. */
export async function cancelListingAction(formData: FormData): Promise<void> {
  const listingId = String(formData.get('listing_id') ?? '');

  const me = await currentUserId();
  if (!me) {
    redirect('/sign-in');
  }

  try {
    const listing = await getListing(listingId);
    if (!listing) {
      redirectWithError(`/card`, 'listing not found');
    }
    if (listing.seller_id !== me) {
      redirectWithError(cardPath(listing.card_id), 'not your listing');
    }
    await cancelListing(listingId, me);
    redirect(cardPath(listing.card_id));
  } catch (thrown) {
    // The redirect() two lines up throws Next's own internal control-flow
    // error on the success path — rethrow it before treating `thrown` as a
    // real failure, or a successful cancel renders an error banner instead
    // of navigating. Pre-existing gap in this function, fixed while in here
    // for the same class of bug in createCheckoutAction below.
    unstable_rethrow(thrown);
    const listing = await getListing(listingId).catch(() => null);
    redirectWithError(listing ? cardPath(listing.card_id) : `/card`, errorText(thrown));
  }
}

// ------------------------------------------------------------
// PURCHASE — Stripe Checkout redirect; the webhook records the sale
// ------------------------------------------------------------

/**
 * Builds a Checkout Session and redirects the browser to Stripe — or, when
 * FSC covers the whole price, settles directly and never talks to Stripe at
 * all.
 *
 * Order of operations matters (docs/handoff/data.md item 13's ask): reserve
 * the FSC hold BEFORE creating anything Stripe-side. If the reserve fails,
 * nothing else happens. If a Stripe Session fails to create afterward, the
 * hold is released rather than left stranded — same for the direct-settle
 * path below.
 *
 * The cash leg — everything after this action — is recorded by
 * app/api/webhooks/stripe, never here. Stripe only receives the buyer id
 * (users.id), listing id, and (when an FSC leg exists) the credit amount and
 * hold id it needs to attribute the payment — see
 * payment_intent_data.metadata, which the webhook refuses to acknowledge
 * without listing_id/buyer_id and reads credit_cents/hold_id for the split.
 *
 * @param creditCentsRequested FSC to apply, in cents. Validated against
 *   getCreditAvailable() server-side — a request above what the buyer can
 *   actually spend is REFUSED, never silently clamped. Omit or pass 0 for an
 *   all-cash purchase.
 */
export async function createCheckoutAction(
  listingId: UUID,
  creditCentsRequested: number = 0,
): Promise<void> { throw new Error('Stripe and FSC purchases are dormant. New USDC funding is paused; recover existing payments without paying again.'); }

/**
 * The post-checkout poll target. Wraps getListing() so a client component can
 * wait for `order.status === 'settled'` without importing the contract.
 * Constrained to what the OrderPoll UI renders.
 */
export async function getListingForOrderAction(
  listingId: UUID,
): Promise<{
  listingId: UUID;
  status: string;
  priceCents: number;
  orderStatus: string | null;
  orderId: UUID | null;
  soldAt: string | null;
} | null> {
  const listing = await getListing(listingId).catch(() => null);
  if (!listing) return null;
  return {
    listingId: listing.id,
    status: listing.status,
    priceCents: listing.price_cents,
    orderStatus: listing.order?.status ?? null,
    orderId: listing.order?.id ?? null,
    soldAt: listing.sold_at,
  };
}

// ------------------------------------------------------------
// REDEMPTION — owner only (paid flow: quote → Stripe → verify → burn)
// ------------------------------------------------------------
// The old free redeemCardAction was removed with the inline form: every
// redemption now goes through createRedemptionCheckoutAction (pay) +
// completeRedemptionAction (verify + burn). No path may burn without
// a verified shipping payment, except the explicit zero-total branch
// inside creation.

// ------------------------------------------------------------
// REDEMPTION WITH SHIPPING CHECKOUT — owner only
// ------------------------------------------------------------

/**
 * Step 1 of paid redemption: validates the card and address, quotes live,
 * and redirects to a Stripe Checkout for the shipping total (zone rate +
 * handling fee, both read live — never typed by the client).
 *
 * The handling fee is the live platform_config value, so zeroing the config
 * removes it without a deploy. Malaysia-only: the zone map covers MY
 * postcodes and anything else is rejected before money moves.
 *
 * Nothing burns here. The card burns in completeRedemptionAction after
 * Stripe confirms payment — a buyer who bails at Stripe loses nothing.
 */
export async function createRedemptionCheckoutAction(
  formData: FormData,
): Promise<void> { throw new Error('Stripe redemption checkout is dormant. Pending or unresolved claims cannot be redeemed.'); }

/**
 * Sends the redemption confirmation email. Email failure never unwinds a
 * paid redemption — it returns the error text for the UI to state plainly.
 */
async function sendRedemptionEmail(
  userId: string,
  detail: NonNullable<Awaited<ReturnType<typeof getCard>>>,
  address: ShippingAddress,
  quote: { zoneName: string; rateCents: number },
  handlingCents: number,
  totalCents: number,
): Promise<{ mailed: boolean; mailError?: string }> {
  try {
    const user = await getUser({ id: userId as UUID }).catch(() => null);
    const origin = await siteOrigin().catch(() => 'https://flexsoar.net');
    const email = user?.email ?? null;
    if (!email) return { mailed: false, mailError: 'no email on file — add one to receive confirmations' };
    const sku = detail.sku;
    const addressLine = [
      address.recipient_name,
      address.line1,
      address.line2,
      `${address.postal_code} ${address.city}`,
      address.state,
      'Malaysia',
    ]
      .filter(Boolean)
      .join(', ');
    const result = await sendRedemptionRequestedEmail({
      redeemerEmail: email,
      redeemerHandle: detail.owner.handle,
      shoeBrand: sku.brand,
      shoeModel: sku.model,
      shoeColorway: sku.colorway,
      shoeSizeUs: sku.size_us,
      shippingZoneName: quote.zoneName,
      shippingCents: quote.rateCents,
      handlingCents,
      totalPaidCents: totalCents,
      addressLine,
      cardUrl: `${origin}/card/${detail.id}`,
    });
    if (!result.success) return { mailed: false, mailError: result.error ?? 'email failed to send' };
    return { mailed: true };
  } catch (thrown) {
    return { mailed: false, mailError: errorText(thrown) };
  }
}

export interface CompleteRedemptionResult {
  ok: boolean;
  message?: string;
  mailed?: boolean;
  mailError?: string;
}

/**
 * Step 2 of paid redemption, run when the buyer returns from Stripe:
 * verifies the session actually got paid (server-side retrieve — the
 * success_url alone proves nothing), re-checks the quote hasn't moved,
 * then burns and emails. Idempotent: a card that is already redeemed
 * (retry, double-click, back-button) returns success without re-burning.
 *
 * The paid-but-closed-tab edge (user pays, never returns) is NOT closed
 * here — that needs the webhook to complete redemptions (data lane). This
 * path covers every user who comes back, which is the launch flow.
 */
export async function completeRedemptionAction(
  sessionId: string,
  cardId: string,
): Promise<CompleteRedemptionResult> { return { ok:false, message:'Legacy Stripe completion is disabled. Preserve the original payment reference for authorized recovery; do not pay again.' }; }

// ------------------------------------------------------------
// NOTIFICATIONS
// ------------------------------------------------------------

/**
 * Marks a notification as read. Called directly from NotificationBell client component.
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const me = await currentUserId();
  if (!me) {
    redirect('/sign-in');
  }

  try {
    await markNotificationRead(notificationId);
  } catch (thrown) {
    redirectWithError('/market', errorText(thrown));
  }
}

// ------------------------------------------------------------
// TERMS ACCEPTANCE
// ------------------------------------------------------------

/**
 * Records the caller's Terms acceptance (047, tour checkbox). Session
 * UPDATE of a self-attestation timestamp — row scoped by users_self_update,
 * column by its grant. Returns a result so the tour can close optimistically.
 */
export async function recordTosAcceptanceAction(): Promise<{ ok: boolean; message?: string }> {
  const me = await currentUserId();
  if (!me) {
    return { ok: false, message: 'Sign in to record acceptance.' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('users')
    .update({ tos_accepted_at: new Date().toISOString() })
    .eq('id', me);

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

// ------------------------------------------------------------
// PROFILE VISIBILITY
// ------------------------------------------------------------

/**
 * Flips one card's show_in_profile flag (046) via fn_set_card_visibility,
 * which enforces owner-or-admin itself. Returns a result instead of
 * redirecting so callers can flip optimistically and revalidate in place —
 * a full navigation per toggle feels broken.
 */
export async function toggleCardVisibilityAction(
  cardId: string,
  show: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const me = await currentUserId();
  if (!me) {
    return { ok: false, message: 'Sign in to change visibility.' };
  }
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) {
    return { ok: false, message: 'Bad card id.' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('fn_set_card_visibility', {
    p_card_id: cardId,
    p_show: show,
  });

  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Flips the caller's show_trade_history flag (046). Session UPDATE — the
 * row is scoped by users_self_update and the column by its grant. Returns
 * a result for the same optimistic-toggle reason as above.
 */
export async function toggleTradeHistoryAction(
  show: boolean,
  next: string,
): Promise<{ ok: boolean; message?: string }> {
  const me = await currentUserId();
  if (!me) {
    return { ok: false, message: 'Sign in to change visibility.' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('users')
    .update({ show_trade_history: show })
    .eq('id', me);

  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath(safeNextPath(next) || '/dashboard');
  return { ok: true };
}

/**
 * Changes the caller's own username. Format + uniqueness are enforced by
 * the database (007's shape check, case-insensitive unique index); this
 * pre-checks the same rules client-predictably via lib/auth/handle so the
 * error reads like guidance, not a Postgres refusal. Returns the new
 * handle for navigation — the profile URL moves with it.
 */
export async function updateHandleAction(
  rawHandle: string,
): Promise<{ ok: boolean; handle?: string; message?: string }> {
  const me = await currentUserId();
  if (!me) return { ok: false, message: 'Sign in to change your username.' };
  const handle = rawHandle.trim();
  if (!isCleanUsername(handle)) {
    return {
      ok: false,
      message: 'Usernames are 3–24 characters: lowercase letters, numbers, underscores — exactly as typed.',
    };
  }
  const supabase = await createServerSupabase();
  const current = await getUser({ id: me }).catch(() => null);
  const { error } = await supabase
    .from('users')
    .update({ handle })
    .eq('id', me);
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, message: 'That username is taken — try another.' };
    }
    return { ok: false, message: error.message.trim() || 'username update failed' };
  }
  const oldHandle = current?.handle ?? null;
  if (oldHandle && oldHandle !== handle) revalidatePath(`/u/${oldHandle}`);
  revalidatePath(`/u/${handle}`);
  return { ok: true, handle };
}

/**
 * Top market hits for the mobile search overlay. Read-only, session-scoped
 * (getListings enforces RLS visibility), capped at 6 — the overlay links
 * out to /market?q= for the full grid. Empty query returns [] without
 * touching the database.
 */
export async function searchMarketAction(
  query: string,
): Promise<{ ok: boolean; listings?: import('@/lib/api/contract').ListingSummary[]; message?: string }> {
  const q = query.trim().slice(0, 60);
  if (!q) return { ok: true, listings: [] };
  try {
    const listings = await getListings({ search: q, sort: 'recent', limit: 6 });
    return { ok: true, listings };
  } catch (thrown) {
    return {
      ok: false,
      message: thrown instanceof Error ? thrown.message : 'Search failed — try again.',
    };
  }
}

export interface ShippingQuote {
  zone: ShippingZoneCode;
  zoneName: string;
  rateCents: number;
  etaNote: string;
  /** False when the shipping_zones table is absent and the approved seed applies. */
  live: boolean;
}

/**
 * Courier quote for a redemption postcode (MY-only, origin Damansara
 * Damai). Pure mapping decides the zone; the rate comes from the
 * shipping_zones table when present, else the approved seed — the table
 * is the rate source of truth the moment the migration lands, so a later
 * counter-check changes one row, never code.
 *
 * Read-only and session-safe to call unsigned: it reveals a public price
 * for a zone, nothing personal. Freezing the figure onto the redemption
 * is redeemCard's job (data lane), not this action's.
 */
export async function getShippingQuoteAction(
  postcode: string,
): Promise<{ ok: true; quote: ShippingQuote } | { ok: false; message: string }> {
  const zone = shippingZoneForPostcode(postcode);
  if (!zone) {
    return {
      ok: false,
      message: /^\d{5}$/.test(postcode.trim())
        ? 'We don\u2019t recognise that postcode — double-check it.'
        : 'Enter a 5-digit Malaysian postcode.',
    };
  }
  const meta = SHIPPING_ZONES[zone];
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('rate_cents')
      .eq('code', zone)
      .maybeSingle();
    const rate = (data as { rate_cents: number } | null)?.rate_cents;
    if (!error && Number.isInteger(rate) && (rate as number) >= 0) {
      return {
        ok: true,
        quote: {
          zone,
          zoneName: meta.name,
          rateCents: rate as number,
          etaNote: meta.etaNote,
          live: true,
        },
      };
    }
  } catch {
    // Table absent or unreadable — fall through to the approved seed.
  }
  return {
    ok: true,
    quote: {
      zone,
      zoneName: meta.name,
      rateCents: meta.seedRateCents,
      etaNote: meta.etaNote,
      live: false,
    },
  };
}

export interface RedemptionQuote {
  zone: ShippingZoneCode;
  zoneName: string;
  rateCents: number;
  handlingCents: number;
  totalCents: number;
  etaNote: string;
}

/**
 * The single computation behind both the displayed quote and the charged
 * total: zone rate (table-first, seed fallback) + live handling fee.
 * CompleteRedemptionAction re-runs this exact function and compares
 * against what Stripe collected — one definition, never two numbers.
 */
async function redemptionQuote(
  postalCode: string,
): Promise<{ ok: true; quote: RedemptionQuote } | { ok: false; message: string }> {
  const zone = await getShippingQuoteAction(postalCode);
  if (!zone.ok) return zone;
  const handlingCents = await getRedemptionHandlingFeeCents().catch(() => 0);
  return {
    ok: true,
    quote: {
      zone: zone.quote.zone,
      zoneName: zone.quote.zoneName,
      rateCents: zone.quote.rateCents,
      handlingCents,
      totalCents: zone.quote.rateCents + handlingCents,
      etaNote: zone.quote.etaNote,
    },
  };
}

/**
 * Quote preview for the redeem popup. Read-only wrapper over the same
 * computation checkout and completion use.
 */
export async function getRedemptionQuoteAction(
  postalCode: string,
): Promise<{ ok: true; quote: RedemptionQuote } | { ok: false; message: string }> {
  return redemptionQuote(postalCode);
}