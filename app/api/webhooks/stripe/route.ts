/**
 * app/api/webhooks/stripe/route.ts — POST /api/webhooks/stripe
 *
 * The only caller of purchaseCard()/purchaseCardSplit() in the codebase, and
 * the only place a card changes hands for money.
 *
 * The order of events is fixed and one-directional:
 *
 *   1. Buyer starts Stripe Checkout. If the checkout carries an FSC leg,
 *      track/market's checkout action must have reserved it first
 *      (reserveCredit()) and carried the hold id + FSC amount into
 *      payment_intent_data.metadata — the same place listing_id/buyer_id
 *      already live (see app/(market)/actions.ts). Money for the cash leg
 *      moves buyer -> seller through Stripe.
 *   2. Stripe sends checkout.session.completed here. This route verifies the
 *      signature, retrieves the underlying PaymentIntent to read its
 *      metadata (hold id, FSC amount), and records what already happened by
 *      calling purchaseCardSplit() — the 5-argument fn_purchase_card.
 *   3. If the buyer abandons checkout instead, Stripe sends
 *      checkout.session.expired. Any FSC this buyer reserved for it must be
 *      freed rather than stranded until the hold's own TTL — see the
 *      dedicated section below for what that can and cannot do given the
 *      grants on fn_release_credit_hold / fn_expire_credit_holds.
 *
 * Nothing in the client can start step 2/3 itself. Track/market polls
 * getListing() after checkout and waits for `order.status === 'settled'`.
 *
 * WHY checkout.session.completed AND NOT payment_intent.succeeded
 * ------------------------------------------------------------------
 * payment_intent.succeeded fires for any PaymentIntent this Stripe account
 * ever creates, Checkout or not. checkout.session.completed is scoped to the
 * Checkout flow this app exclusively uses (app/(market)/actions.ts never
 * creates a bare PaymentIntent), and it is the event this task specifies. A
 * Checkout Session can complete with payment_status 'unpaid' when a delayed
 * payment method is used, so this route does not trust session.payment_status
 * — it retrieves the real PaymentIntent and checks intent.status ===
 * 'succeeded' before recording anything, same idea as the amount/currency
 * checks below: verify what Stripe actually captured, not what the event
 * implies.
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
  expireCreditHolds,
  purchaseCardSplit,
} from '@/lib/api/contract';
import {
  findListingForSettlement,
  findOrderBySettlementRef,
  type ListingForSettlement,
} from '@/lib/db/settlement';
import { createServiceSupabase } from '@/lib/supabase/server';
import { sendCardSoldEmail, type CardSoldEmailInput } from '@/lib/email/send';

/** The two Checkout Session events this route understands. Everything else is acknowledged and dropped. */
const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
]);

/** Every *_cents column in the schema is USD. 1 FSC = 1 USD. */
const SETTLEMENT_CURRENCY = 'usd';

/**
 * Refusals that will reproduce identically on redelivery — the metadata and
 * database state that triggered them do not change between Stripe retries —
 * so none of these should be handed back to Stripe's retry loop.
 *
 * CREDIT_HOLD_EXPIRED and COUNTRY_NOT_SET are deliberately NOT included here
 * even though both are just as non-retryable: each means the buyer's cash has
 * already moved through Stripe and this settlement did not happen, which
 * needs louder handling than a quiet acknowledge. See isCreditHoldExpired(),
 * isCountryNotSet(), and their call sites below.
 */
function isPermanentError(thrown: unknown): boolean {
  if (!(thrown instanceof ContractError)) return false;
  return (
    thrown.code === 'SELF_PURCHASE' ||
    thrown.code === 'EARLY_ACCESS_LOCKED' ||
    thrown.code === 'WRONG_STATUS' ||
    thrown.code === 'NOT_FOUND' ||
    thrown.code === 'PAYOUT_MISMATCH' ||
    // 021's FSC-leg refusals, all reachable now that this route carries a
    // credit leg through to purchaseCardSplit().
    thrown.code === 'INSUFFICIENT_CREDIT' ||
    thrown.code === 'CREDIT_SETTLEMENT_DISABLED' ||
    thrown.code === 'CREDIT_PROVENANCE_REQUIRED' ||
    thrown.code === 'CREDIT_HOLD_WRONG_USER' ||
    thrown.code === 'CREDIT_HOLD_WRONG_LISTING' ||
    thrown.code === 'CREDIT_HOLD_INSUFFICIENT' ||
    thrown.code === 'SETTLEMENT_REF_REQUIRED'
  );
}

/**
 * fn_purchase_card_core — 'credit hold % expired at %'. The buyer has already
 * been charged (this only fires from the checkout.session.completed branch,
 * after Stripe capture) and settlement did not happen, so the buyer holds
 * neither a card nor their FSC back. Not swallowed into isPermanentError()'s
 * quiet acknowledge — see the call site.
 */
function isCreditHoldExpired(thrown: unknown): thrown is ContractError {
  return thrown instanceof ContractError && thrown.code === 'CREDIT_HOLD_EXPIRED';
}

/**
 * 025_user_country.sql fn_payout_method_for_user, raised from inside
 * fn_purchase_card_core (021_credit_holds.sql:325) — the seller has no
 * country on file, so their payout method cannot be resolved. Fires only
 * from the checkout.session.completed branch, after Stripe has already
 * captured the buyer's card, and it is a permanent condition (retrying will
 * keep hitting the same missing column) — but it is NOT a quiet
 * isPermanentError() acknowledge, same reasoning as isCreditHoldExpired()
 * above: the buyer's cash already moved and no order was recorded, so this
 * needs the loud path, not a buried log line. See the call site.
 */
function isCountryNotSet(thrown: unknown): thrown is ContractError {
  return thrown instanceof ContractError && thrown.code === 'COUNTRY_NOT_SET';
}

/** 200 + a reason. The event is understood and will never become actionable. */
function acknowledge(reason: string, detail?: unknown): NextResponse {
  console.error(`[stripe-webhook] not recorded: ${reason}`, detail ?? '');
  return NextResponse.json({ received: true, recorded: false, reason }, { status: 200 });
}

interface ParsedSettlementMetadata {
  listingId: string;
  buyerId: string;
  /** The FSC portion of the price, in cents. 0 when the checkout never reserved credit. */
  creditCents: number;
  /** A credit_holds id created by reserveCredit(), or null for a pure-cash checkout. */
  holdId: string | null;
}

/**
 * Reads the buyer/listing/FSC-leg fields track/market's checkout action sets
 * on payment_intent_data.metadata (app/(market)/actions.ts) — the same place
 * listing_id/buyer_id already live. credit_cents and hold_id are both
 * optional: a checkout that never reserved FSC (every checkout today, until
 * track/market wires reserveCredit() into createCheckoutAction — see
 * docs/handoff/data.md item 11) omits them entirely, and this must keep
 * behaving exactly like a pure-cash settlement, same as before this pass.
 */
function parseSettlementMetadata(
  metadata: Stripe.Metadata,
): ParsedSettlementMetadata | { error: string } {
  const listingId = metadata['listing_id'];
  const buyerId = metadata['buyer_id'];
  if (!listingId || !buyerId) {
    return {
      error:
        'payment intent has no listing_id/buyer_id metadata — set both when creating the ' +
        'Checkout Session, or the sale cannot be attributed',
    };
  }

  const rawCredit = metadata['credit_cents'];
  let creditCents = 0;
  if (rawCredit !== undefined && rawCredit !== '') {
    const parsed = Number(rawCredit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: `payment intent metadata has a malformed credit_cents value: ${rawCredit}` };
    }
    creditCents = parsed;
  }

  const rawHold = metadata['hold_id'];
  const holdId = rawHold && rawHold.trim() !== '' ? rawHold : null;

  return { listingId, buyerId, creditCents, holdId };
}

/** `session.payment_intent` is a string id unless the event expanded it. */
function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent.id;
}

/**
 * Fetches the real PaymentIntent so this route can read its metadata and its
 * authoritative status/amount — never trust the Checkout Session's own
 * payment_status for this, since it reads 'unpaid' for delayed payment
 * methods even after checkout.session.completed fires.
 */
async function resolvePaymentIntent(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<Stripe.PaymentIntent | null> {
  const id = paymentIntentId(session);
  if (!id) return null;
  return stripe.paymentIntents.retrieve(id);
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<NextResponse> {
  const intent = await resolvePaymentIntent(stripe, session);
  if (!intent) {
    return acknowledge('checkout session completed with no payment_intent — nothing to settle', {
      sessionId: session.id,
    });
  }

  if (intent.status !== 'succeeded') {
    return acknowledge('payment intent has not succeeded (delayed payment method?)', {
      sessionId: session.id,
      paymentIntent: intent.id,
      status: intent.status,
    });
  }

  const parsed = parseSettlementMetadata(intent.metadata ?? {});
  if ('error' in parsed) {
    return acknowledge(parsed.error, { paymentIntent: intent.id });
  }
  const { listingId, buyerId, creditCents, holdId } = parsed;

  // Hoisted out of the try block so the catch below can still name the
  // seller in the COUNTRY_NOT_SET log — that error can only be thrown after
  // this is populated, but TS does not know that from inside the catch.
  let listing: ListingForSettlement | null = null;

  try {
    // Stripe delivers at-least-once. If this intent is already recorded, the
    // work is done — say so rather than letting fn_purchase_card raise on a
    // listing that is now 'sold'. fn_purchase_card's own idempotency on
    // settlement_ref (017) is the second line of defence if this check and a
    // redelivery race each other.
    const existing = await findOrderBySettlementRef(intent.id);
    if (existing) {
      return NextResponse.json(
        { received: true, recorded: true, orderId: existing.id, duplicate: true },
        { status: 200 },
      );
    }

    listing = await findListingForSettlement(listingId);
    if (!listing) {
      return acknowledge('no such listing', { listingId, paymentIntent: intent.id });
    }

    // fn_purchase_card writes the ledger from listings.price_cents and ignores
    // the Stripe amount entirely, so if the two disagree the ledger would
    // record money that did not move.
    if (intent.currency?.toLowerCase() !== SETTLEMENT_CURRENCY) {
      return acknowledge('settled in a currency other than USD', {
        listingId,
        currency: intent.currency,
        paymentIntent: intent.id,
      });
    }

    // The cash leg is price minus whatever FSC this checkout reserved.
    // fn_purchase_card_core clamps credit_cents to the price itself, so mirror
    // that clamp here for the comparison rather than letting a bogus
    // credit_cents (above price) make this check pass when it should not.
    const expectedCashCents = Math.max(listing.price_cents - Math.min(creditCents, listing.price_cents), 0);
    if (expectedCashCents > 0 && intent.amount_received < expectedCashCents) {
      return acknowledge('captured less than the expected cash leg', {
        listingId,
        captured: intent.amount_received,
        expectedCashCents,
        paymentIntent: intent.id,
      });
    }

    // A cash leg requires a non-empty settlement_ref (019c/021's own rule) —
    // intent.id always is one here, since Checkout only reaches 'succeeded'
    // with a real PaymentIntent id.
    const orderId = await purchaseCardSplit(listingId, buyerId, intent.id, creditCents, holdId);

    await sendCardSoldEmailForOrder(orderId);

    return NextResponse.json({ received: true, recorded: true, orderId }, { status: 200 });
  } catch (thrown) {
    if (isCreditHoldExpired(thrown)) {
      // The buyer has been charged through Stripe and this settlement did
      // NOT happen — no card, no order, and their FSC hold is now 'expired'
      // rather than consumed. Retrying will not help: the hold's expiry is
      // permanent, so raising this again on every redelivery just buries the
      // log. Acknowledge so Stripe stops retrying, but make this impossible
      // to miss and do not attempt any automatic recovery — no forced retry
      // with a fresh hold, no refund — leave it for a human to reconcile.
      const detail = {
        paymentIntent: intent.id,
        listingId,
        buyerId,
        creditCents,
        holdId,
        amountReceived: intent.amount_received,
        currency: intent.currency,
      };
      console.error(
        '[stripe-webhook] CRITICAL — CREDIT HOLD EXPIRED AFTER PAYMENT CAPTURED. ' +
          'Buyer was charged and holds no card. Manual reconciliation required.',
        detail,
      );
      console.error(
        `[stripe-webhook] CRITICAL — payment_intent=${intent.id} buyer=${buyerId} ` +
          `listing=${listingId} hold=${holdId}: ${thrown.message}`,
      );
      return NextResponse.json(
        {
          received: true,
          recorded: false,
          reason:
            'credit hold expired after payment was captured — buyer charged, no card ' +
            'delivered, requires manual reconciliation',
          paymentIntent: intent.id,
        },
        { status: 200 },
      );
    }

    if (isCountryNotSet(thrown)) {
      // Same shape as CREDIT_HOLD_EXPIRED above: the buyer has been charged
      // through Stripe and this settlement did NOT happen, because
      // fn_purchase_card_core could not resolve the seller's payout method.
      // Retrying will not help — the seller's country is out-of-band from
      // this webhook and cannot fix itself between deliveries — so
      // acknowledge to stop Stripe's retry loop, but make this impossible to
      // miss and leave the order for a human to reconcile. Recovery: the
      // seller sets their country (self-service only — fn_set_country
      // updates exactly the caller's own row, so no admin surface can do
      // this on their behalf), and then the settlement must be replayed —
      // this codebase has no in-app replay for a settlement that failed
      // after Stripe capture, so that means resending this payment intent's
      // checkout.session.completed event from the Stripe dashboard or API.
      const detail = {
        paymentIntent: intent.id,
        listingId,
        buyerId,
        sellerId: listing?.seller_id ?? 'unknown — listing lookup did not complete before this error',
        creditCents,
        holdId,
        amountReceived: intent.amount_received,
        currency: intent.currency,
      };
      console.error(
        '[stripe-webhook] CRITICAL — SELLER COUNTRY NOT SET AFTER PAYMENT CAPTURED. ' +
          'Buyer was charged and holds no card. Manual reconciliation required: seller must ' +
          'set a country, then this payment intent\'s checkout.session.completed event must ' +
          'be replayed from Stripe.',
        detail,
      );
      console.error(
        `[stripe-webhook] CRITICAL — payment_intent=${intent.id} buyer=${buyerId} ` +
          `seller=${detail.sellerId} listing=${listingId}: ${thrown.message}`,
      );
      return NextResponse.json(
        {
          received: true,
          recorded: false,
          reason:
            'seller has no country on file — buyer charged, no card delivered, requires ' +
            'manual reconciliation',
          paymentIntent: intent.id,
        },
        { status: 200 },
      );
    }

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

/**
 * Sends the "card sold — 48h shipping window" email to the consignor.
 * Fetches the vault_intakes row for the order to get the exact due_by timestamp.
 * Failure to send does not affect the sale — the sale is real regardless.
 */
async function sendCardSoldEmailForOrder(orderId: string): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: intake, error: intakeError } = await supabase
    .from('vault_intakes')
    .select('id, due_by, consignor_id, item:items!inner(sku:skus!inner(brand, model, colorway, size_us)), card:cards!inner(id), order:orders!inner(gross_cents)')
    .eq('order_id', orderId)
    .maybeSingle();

  if (intakeError || !intake) {
    console.error('[email] card_sold_48h — no vault_intakes row for order:', { orderId, error: intakeError });
    return;
  }

  const item = Array.isArray(intake.item) ? intake.item[0] : intake.item;
  const card = Array.isArray(intake.card) ? intake.card[0] : intake.card;
  const order = Array.isArray(intake.order) ? intake.order[0] : intake.order;
  const sku = item?.sku;
  const consignorId = intake.consignor_id;

  if (!item || !card || !order || !sku || !consignorId) {
    console.error('[email] card_sold_48h — incomplete intake data:', { orderId, intake });
    return;
  }

  const { data: consignor, error: consignorError } = await supabase
    .from('users')
    .select('email, handle')
    .eq('id', consignorId)
    .maybeSingle();

  if (consignorError || !consignor?.email) {
    console.error('[email] card_sold_48h — could not load consignor:', { consignorId, error: consignorError });
    return;
  }

  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://flexsoar.net'}/market/${card.id}`;

  await sendCardSoldEmail({
    consignorEmail: consignor.email,
    consignorHandle: consignor.handle,
    shoeBrand: sku.brand,
    shoeModel: sku.model,
    shoeColorway: sku.colorway,
    shoeSizeUs: sku.size_us,
    salePriceCents: order.gross_cents,
    dueBy: intake.due_by,
    listingUrl,
  });

  // Also write a notification row (notification table must exist)
  try {
    await supabase.from('notifications').insert({
      user_id: consignorId,
      type: 'card_sold',
      payload: {
        order_id: orderId,
        card_id: card.id,
        shoe_brand: sku.brand,
        shoe_model: sku.model,
        shoe_colorway: sku.colorway,
        shoe_size_us: sku.size_us,
        sale_price_cents: order.gross_cents,
        due_by: intake.due_by,
        listing_url: listingUrl,
      },
    });
  } catch (notificationError) {
    // Notification table may not exist yet; log but don't fail the email
    console.warn('[notification] card_sold_48h — could not write notification:', notificationError);
  }
}

/**
 * checkout.session.expired — the buyer abandoned checkout. Any FSC reserved
 * for it must come back rather than sit stuck until the hold's own TTL.
 *
 * WHAT THIS CANNOT DO. fn_release_credit_hold(p_hold_id) — the function that
 * releases exactly one hold — is granted to `authenticated` only
 * (021_credit_holds.sql:534, unchanged by 022b); it is not granted to
 * `service_role` at all. Its own guard would refuse a service-role call
 * anyway even if it were granted (fn_current_user_id() is null under
 * service-role, and fn_is_admin() has no session to resolve). The webhook has
 * no session by construction, so it cannot call this RPC — verified by
 * reading the grant list in both 021 and 022b, not assumed.
 *
 * WHAT THIS DOES INSTEAD. fn_expire_credit_holds() — a global sweep of every
 * hold whose expires_at has passed, not just this one — is granted to
 * `service_role` (022b_permissions_lockdown.sql:165). It is the only
 * service-role-callable surface 021/022b leave for freeing a hold, so that is
 * what this calls. This is not the same as releasing THIS hold on demand: it
 * only frees this buyer's FSC once the hold's own credit_hold_minutes TTL has
 * separately elapsed. Track/market's checkout action should set the Stripe
 * Checkout Session's own `expires_at` no earlier than the hold's expiry (both
 * currently default-configured independently — see docs/handoff/data.md), or
 * this sweep can run before the hold is actually due and do nothing. Filed as
 * a handoff item rather than assumed fixed.
 */
async function handleCheckoutExpired(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<NextResponse> {
  const intent = await resolvePaymentIntent(stripe, session);
  const metadata = intent?.metadata ?? session.metadata ?? {};
  const holdId = metadata['hold_id'];

  if (!holdId) {
    return acknowledge('checkout session expired with no hold_id in its metadata — nothing to release', {
      sessionId: session.id,
    });
  }

  try {
    const sweptCount = await expireCreditHolds();
    console.log(
      `[stripe-webhook] checkout session ${session.id} expired; swept ${sweptCount} due ` +
        `hold(s) globally (targeting hold ${holdId})`,
    );
    return NextResponse.json(
      { received: true, recorded: false, sweptHolds: sweptCount },
      { status: 200 },
    );
  } catch (thrown) {
    // A database hiccup here is retryable — Stripe will redeliver
    // checkout.session.expired, and the sweep is idempotent either way.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(
      `[stripe-webhook] failed to sweep expired holds for session ${session.id}: ${message}`,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

  const stripe = new Stripe(apiKey);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (thrown) {
    // Unverified: this is not Stripe, or the secret is wrong. Never retryable,
    // and never a reason to touch the database.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`[stripe-webhook] signature verification failed: ${message}`);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, recorded: false }, { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (event.type === 'checkout.session.completed') {
    return handleCheckoutCompleted(stripe, session);
  }
  return handleCheckoutExpired(stripe, session);
}
