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
import Stripe from 'stripe';

import {
  getCard,
  getListing,
  listCard,
  cancelListing,
  redeemCard,
  getCreditAvailable,
  reserveCredit,
  releaseCreditHold,
  purchaseCardSplit,
} from '@/lib/api/contract';
import type { ShippingAddress } from '@/lib/api/contract';
import type { UUID } from '@/lib/db/types';
import { safeNextPath } from '@/app/(auth)/paths';
import { currentUserId, currentUserLevel, REDEMPTION_HANDLING_FEE_CENTS } from '@/app/(market)/queries';
import {
  CREDIT_HOLD_MINUTES_FALLBACK,
  cashLegCents,
  checkoutExpiresAtSeconds,
  isFscOnlyPurchase,
  validateRequestedCredit,
} from '@/app/(market)/checkout-math';

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
): Promise<void> {
  const backTo = `/card`;
  const me = await currentUserId();
  if (!me) requireSignedIn(backTo);

  const origin = await siteOrigin();

  let listing;
  try {
    listing = await getListing(listingId);
  } catch (thrown) {
    redirectWithError(backTo, errorText(thrown));
  }
  if (!listing) {
    redirectWithError(backTo, 'listing not found or not yet visible to you');
  }

  const cardLink = cardPath(listing.card_id);

  if (listing.seller_id === me) {
    redirectWithError(cardLink, 'cannot buy your own listing');
  }
  if (listing.status !== 'early_access' && listing.status !== 'public') {
    redirectWithError(cardLink, `listing is ${listing.status}`);
  }

  // Early-access gate, re-checked before money moves. fn_purchase_card raises
  // the same EARLY_ACCESS_LOCKED at webhook time, but by then the buyer has
  // paid — refusing here is the actual protection.
  const now = Date.now();
  if (listing.status === 'early_access' && new Date(listing.public_at).getTime() > now) {
    const level = (await currentUserLevel()) ?? 0;
    if (level < listing.early_access_level) {
      redirectWithError(
        cardLink,
        `listing ${listingId} is in early access until ${listing.public_at} — ` +
          `level ${listing.early_access_level} required`,
      );
    }
  }

  // The FSC leg. getCreditAvailable() (never getCreditBalance() — AGENT_RULES.md
  // §5) is the buyer's own spendable balance, re-read here rather than trusted
  // from whatever the browser last rendered — a second tab or a stale page
  // could otherwise post a number that was true a minute ago and is not now.
  const available = await getCreditAvailable();
  const validated = validateRequestedCredit(creditCentsRequested, listing.price_cents, available);
  if (!validated.ok) {
    redirectWithError(cardLink, validated.error ?? 'invalid FSC amount');
  }
  const creditCents = validated.creditCents;

  let holdId: UUID | null = null;
  if (creditCents > 0) {
    try {
      // fn_reserve_credit replaces any prior active hold on this same
      // (buyer, listing) rather than stacking — a retry here cannot double-
      // reserve.
      holdId = await reserveCredit(listingId, creditCents);
    } catch (thrown) {
      redirectWithError(cardLink, errorText(thrown));
    }
  }

  if (isFscOnlyPurchase(listing.price_cents, creditCents)) {
    // FSC covers the whole price: no cash leg, so nothing for Stripe to
    // collect and no PaymentIntent for a webhook to ever receive. Settling
    // here — through the same purchaseCardSplit() the webhook calls for a
    // cash/split settlement — is the only way to record this at all, since
    // no checkout.session.completed event will ever fire for it.
    // purchaseCardSplit() always runs service-role internally regardless of
    // caller; the provenance guarantee 021 asks for still holds here exactly
    // as it does from the webhook — this settlement carries the `holdId`
    // this buyer's own session just reserved, which fn_purchase_card_core
    // verifies belongs to this buyer and this listing before spending it.
    try {
      const orderId = await purchaseCardSplit(listingId, me, null, creditCents, holdId);
      redirect(`${cardLink}?order=${listing.id}&orderId=${orderId}`);
    } catch (thrown) {
      // redirect() above throws Next's own control-flow error on success —
      // rethrow it before releasing a hold that was actually just consumed.
      unstable_rethrow(thrown);
      if (holdId) await releaseCreditHold(holdId).catch(() => {});
      redirectWithError(cardLink, errorText(thrown));
    }
  }

  const apiKey = process.env['STRIPE_SECRET_KEY'];
  if (!apiKey) {
    if (holdId) await releaseCreditHold(holdId).catch(() => {});
    redirectWithError(cardLink, 'checkout is not configured (STRIPE_SECRET_KEY unset)');
  }

  const sku = listing.card.sku;
  const productName = `${sku.brand} ${sku.model} — ${sku.colorway} · US ${sku.size_us} ` +
    `· Mint #${String(listing.card.mint_number).padStart(2, '0')}`;

  // The cash leg is price minus whatever FSC this checkout reserved — never
  // the full price. The webhook mirrors this exact clamp when it verifies
  // what Stripe actually captured (app/api/webhooks/stripe/route.ts).
  const cashCents = cashLegCents(listing.price_cents, creditCents);

  // A session that outlives its FSC hold means cash could be collected after
  // the hold has already freed the buyer's FSC back out from under it —
  // "cash collected with no card transferred." credit_hold_minutes isn't on
  // getPlatformConfig() yet (filed in docs/handoff/market.md); the fallback
  // mirrors the live value (1440, verified 2026-08-23).
  const expiresAtSeconds = checkoutExpiresAtSeconds(now, CREDIT_HOLD_MINUTES_FALLBACK);

  try {
    const stripe = new Stripe(apiKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: cashCents,
            product_data: { name: productName },
          },
        },
      ],
      // The webhook attributes the sale from these keys. An intent without
      // listing_id/buyer_id is acknowledged and logged as "not recorded" —
      // never a sale. credit_cents/hold_id are present only when this
      // checkout actually reserved FSC — an all-cash checkout omits them
      // entirely, which the webhook already treats identically to "no FSC
      // leg" (docs/handoff/data.md item 13).
      payment_intent_data: {
        metadata: {
          listing_id: listing.id,
          buyer_id: me,
          ...(creditCents > 0
            ? { credit_cents: String(creditCents), hold_id: holdId ?? '' }
            : {}),
        },
      },
      metadata: { listing_id: listing.id, buyer_id: me },
      expires_at: expiresAtSeconds,
      success_url: `${origin}${cardLink}?order=${listing.id}`,
      cancel_url: `${origin}${cardLink}`,
    });

    if (!session.url) {
      if (holdId) await releaseCreditHold(holdId).catch(() => {});
      redirectWithError(cardLink, 'stripe returned no checkout url');
    }
    redirect(session.url);
  } catch (thrown) {
    // redirect() above throws Next's own control-flow error on success —
    // rethrow it before releasing a hold that the Session it points at still
    // needs (pre-existing gap in this function's original cash-only form,
    // fixed while extending it for the FSC leg).
    unstable_rethrow(thrown);
    if (holdId) await releaseCreditHold(holdId).catch(() => {});
    const message =
      thrown instanceof Stripe.errors.StripeError
        ? thrown.message
        : errorText(thrown);
    redirectWithError(cardLink, message);
  }
}

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
// REDEMPTION — owner only
// ------------------------------------------------------------

/**
 * Submits a redemption request for an owned card. The handling fee is the
 * server-side constant, shown to the user before they confirm — the form
 * sends the address only.
 */
export async function redeemCardAction(formData: FormData): Promise<void> {
  const cardId = String(formData.get('card_id') ?? '');
  const backTo = cardPath(cardId);

  const me = await currentUserId();
  if (!me) requireSignedIn(backTo);

  if (!/^[0-9a-f-]{36}$/i.test(cardId)) {
    redirectWithError(backTo, 'invalid card id');
  }

  const address: ShippingAddress = {
    recipient_name: String(formData.get('recipient_name') ?? '').trim(),
    line1: String(formData.get('line1') ?? '').trim(),
    line2: String(formData.get('line2') ?? '').trim() || null,
    city: String(formData.get('city') ?? '').trim(),
    state: String(formData.get('state') ?? '').trim() || null,
    postal_code: String(formData.get('postal_code') ?? '').trim(),
    country_code: String(formData.get('country_code') ?? '').trim().toUpperCase(),
    phone: String(formData.get('phone') ?? '').trim() || null,
  };

  if (!address.recipient_name || !address.line1 || !address.city || !address.postal_code) {
    redirectWithError(backTo, 'recipient name, address line 1, city and postal code are required');
  }
  if (!/^[A-Z]{2}$/.test(address.country_code)) {
    redirectWithError(backTo, 'country must be a two-letter ISO 3166-1 alpha-2 code');
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
      redirectWithError(backTo, 'redeem a card only after cancelling its live listing');
    }

    await redeemCard(cardId, me, address, REDEMPTION_HANDLING_FEE_CENTS);
  } catch (thrown) {
    redirectWithError(backTo, errorText(thrown));
  }

  redirect(`${backTo}?redeemed=1`);
}