/**
 * app/api/webhooks/stripe/route.ts — POST /api/webhooks/stripe
 *
 * The only caller of purchaseCard() in the codebase, and the only place a card
 * changes hands for money.
 *
 * The order of events is fixed and one-directional:
 *
 *   1. Buyer pays through Stripe Checkout. Money moves buyer -> seller there.
 *   2. Stripe sends payment_intent.succeeded here.
 *   3. This route verifies the signature, then records what already happened
 *      by calling purchaseCard().
 *
 * Nothing in the client can start step 3. Track/market polls getListing()
 * after checkout and waits for `order.status === 'settled'`.
 *
 * ---- ON STATUS CODES ----
 * Stripe retries any non-2xx for days. So:
 *   4xx/5xx  only when a retry could plausibly succeed (a transient database
 *            failure) or when the request is not really from Stripe.
 *   200      when the event is understood and permanently not actionable — a
 *            missing metadata field, an amount that does not match, an event
 *            type we do not handle. Those are logged loudly; retrying them
 *            just buries the log under duplicates.
 */

import Stripe from 'stripe';
import { NextResponse, type NextRequest } from 'next/server';

import {
  ContractError,
  purchaseCard,
  purchaseCredit,
} from '@/lib/api/contract';
import {
  findListingForSettlement,
  findOrderBySettlementRef,
} from '@/lib/db/settlement';

/** The one event that moves a card. Everything else is acknowledged and dropped. */
const HANDLED_EVENT = 'payment_intent.succeeded';

/** Every *_cents column in the schema is USD. 1 FSC = 1 USD. */
const SETTLEMENT_CURRENCY = 'usd';

/** Metadata `purpose` that routes a settlement to the credit ledger (011). */
const TOPUP_PURPOSE = 'credit_topup';

/**
 * Refusals that will reproduce identically on redelivery. Acknowledge and log,
 * never feed them back to Stripe's retry loop.
 */
function isPermanentError(thrown: unknown): boolean {
  if (!(thrown instanceof ContractError)) return false;
  // Card purchase (fn_purchase_card, include 012's payout guard).
  if (
    thrown.code === 'SELF_PURCHASE' ||
    thrown.code === 'EARLY_ACCESS_LOCKED' ||
    thrown.code === 'WRONG_STATUS' ||
    thrown.code === 'NOT_FOUND' ||
    thrown.code === 'PAYOUT_MISMATCH'
  ) {
    return true;
  }
  // Credit top-up (fn_purchase_credit).
  return thrown.code === 'BELOW_MINIMUM_TOPUP' || thrown.code === 'INVALID_AMOUNT';
}

/** 200 + a reason. The event is understood and will never become actionable. */
function acknowledge(reason: string, detail?: unknown): NextResponse {
  console.error(`[stripe-webhook] not recorded: ${reason}`, detail ?? '');
  return NextResponse.json({ received: true, recorded: false, reason }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env['STRIPE_SECRET_KEY'];
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

  if (!apiKey || !webhookSecret) {
    // Genuinely retryable: someone can set the variable and redeploy.
    console.error('[stripe-webhook] STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET unset');
    return NextResponse.json({ error: 'webhook is not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing stripe-signature header' }, { status: 400 });
  }

  // The RAW body. Parsing to JSON first and re-serialising changes the bytes
  // and the signature no longer verifies.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(apiKey);
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (thrown) {
    // Unverified: this is not Stripe, or the secret is wrong. Never retryable,
    // and never a reason to touch the database.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`[stripe-webhook] signature verification failed: ${message}`);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (event.type !== HANDLED_EVENT) {
    return NextResponse.json({ received: true, recorded: false }, { status: 200 });
  }

  const intent = event.data.object as Stripe.PaymentIntent;
  const metadata = intent.metadata ?? {};

  // ---- Credit top-up: cash in for FSC. fn_purchase_credit is idempotent on
  // the intent id, so redelivery records once. The card-purchase path below is
  // unchanged.
  if (metadata.purpose === TOPUP_PURPOSE) {
    const userId = metadata.user_id;
    const cents = Number(metadata.cents);

    if (!userId || !Number.isInteger(cents) || cents <= 0) {
      return acknowledge(
        'credit_topup intent has no user_id, or a cents that is not a positive integer',
        { paymentIntent: intent.id, userId, cents: metadata.cents },
      );
    }

    if (intent.currency?.toLowerCase() !== SETTLEMENT_CURRENCY) {
      return acknowledge('settled in a currency other than USD', {
        purpose: TOPUP_PURPOSE,
        userId,
        currency: intent.currency,
        paymentIntent: intent.id,
      });
    }

    // fn_purchase_credit credits `cents` to the ledger; if Stripe actually
    // captured a different amount the ledger would record money that did not
    // move. Refuse and let a human reconcile, same as the listing path.
    if (intent.amount_received !== cents) {
      return acknowledge('topup captured amount does not match the requested cents', {
        userId,
        requested: cents,
        captured: intent.amount_received,
        paymentIntent: intent.id,
      });
    }

    try {
      const txnId = await purchaseCredit(userId, cents, intent.id);
      return NextResponse.json(
        { received: true, recorded: true, txnId, duplicate: txnId === null },
        { status: 200 },
      );
    } catch (thrown) {
      if (isPermanentError(thrown)) {
        return acknowledge(thrown instanceof Error ? thrown.message : String(thrown), {
          intent: intent.id,
          userId,
          cents,
        });
      }

      const message = thrown instanceof Error ? thrown.message : String(thrown);
      console.error(`[stripe-webhook] ${intent.id} failed, asking Stripe to retry: ${message}`);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const listingId = metadata.listing_id;
  const buyerId = metadata.buyer_id;

  if (!listingId || !buyerId) {
    return acknowledge(
      'payment intent has no listing_id/buyer_id metadata — set both when creating the ' +
        'Checkout Session, or the sale cannot be attributed',
      { paymentIntent: intent.id },
    );
  }

  try {
    // Stripe delivers at-least-once. If this intent is already recorded, the
    // work is done — say so rather than letting fn_purchase_card raise on a
    // listing that is now 'sold'.
    const existing = await findOrderBySettlementRef(intent.id);
    if (existing) {
      return NextResponse.json(
        { received: true, recorded: true, orderId: existing.id, duplicate: true },
        { status: 200 },
      );
    }

    const listing = await findListingForSettlement(listingId);
    if (!listing) {
      return acknowledge('no such listing', { listingId, paymentIntent: intent.id });
    }

    // fn_purchase_card writes the ledger from listings.price_cents and ignores
    // the Stripe amount entirely, so if the two disagree the ledger would
    // record money that did not move. Refuse and let a human reconcile.
    if (intent.currency?.toLowerCase() !== SETTLEMENT_CURRENCY) {
      return acknowledge('settled in a currency other than USD', {
        listingId,
        currency: intent.currency,
        paymentIntent: intent.id,
      });
    }

    if (intent.amount_received < listing.price_cents) {
      return acknowledge('captured less than the listing price', {
        listingId,
        captured: intent.amount_received,
        price_cents: listing.price_cents,
        paymentIntent: intent.id,
      });
    }

    const orderId = await purchaseCard(listingId, buyerId, intent.id);

    return NextResponse.json(
      { received: true, recorded: true, orderId },
      { status: 200 },
    );
  } catch (thrown) {
    if (isPermanentError(thrown)) {
      // A refusal that reproduces on every delivery — acknowledge and log
      // rather than asking Stripe to loop for days.
      return acknowledge(thrown instanceof Error ? thrown.message : String(thrown), {
        code: thrown instanceof ContractError ? thrown.code : undefined,
        listingId,
        buyerId,
        paymentIntent: intent.id,
      });
    }

    // Anything else — a dropped connection, a database that is down — could
    // work on the next delivery. Let Stripe retry.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`[stripe-webhook] ${intent.id} failed, asking Stripe to retry: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
