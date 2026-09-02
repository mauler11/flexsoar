/**
 * app/api/webhooks/stripe-connect/route.ts — POST /api/webhooks/stripe-connect
 *
 * Handles Stripe Connect account.updated events to track when a consignor's
 * Express account becomes payout-capable (charges_enabled && payouts_enabled).
 *
 * This is separate from the checkout webhook because:
 * - Different Stripe webhook endpoint (configured in Stripe Dashboard for Connect)
 * - Different event types (account.updated vs checkout.session.*)
 * - Service-role only, no user session
 */

import Stripe from 'stripe';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';

const STRIPE_CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('[stripe-connect-webhook] STRIPE_SECRET_KEY not configured');
}

const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'account.updated',
]);

function acknowledge(reason: string, detail?: unknown): NextResponse {
  console.log(`[stripe-connect-webhook] acknowledged: ${reason}`, detail ?? '');
  return NextResponse.json({ received: true, processed: false, reason }, { status: 200 });
}

async function handleAccountUpdated(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<NextResponse> {
  const account = event.data.object as Stripe.Account;

  // Only care about Express accounts that have completed onboarding
  if (account.type !== 'express') {
    return acknowledge('non-express account, ignoring', { accountId: account.id, type: account.type });
  }

  const isOnboardingComplete = account.charges_enabled && account.payouts_enabled;

  console.log(`[stripe-connect-webhook] account.updated`, {
    accountId: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    onboardingComplete: isOnboardingComplete,
  });

  if (!isOnboardingComplete) {
    return acknowledge('onboarding not yet complete', { accountId: account.id });
  }

  const supabase = createServiceSupabase();

  // Find the user with this Connect account ID and update their payouts_enabled flag
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, handle, stripe_connect_account_id, stripe_connect_payouts_enabled')
    .eq('stripe_connect_account_id', account.id)
    .maybeSingle();

  if (userError) {
    console.error('[stripe-connect-webhook] failed to find user for account', {
      accountId: account.id,
      error: userError.message,
    });
    // Don't return error - acknowledge so Stripe doesn't retry
    return NextResponse.json({ received: true, processed: false, reason: 'user lookup failed' }, { status: 200 });
  }

  if (!user) {
    console.warn('[stripe-connect-webhook] no user found for Connect account', { accountId: account.id });
    return acknowledge('no user linked to this Connect account', { accountId: account.id });
  }

  // Update the user's payouts_enabled flag
  const { error: updateError } = await supabase
    .from('users')
    .update({ stripe_connect_payouts_enabled: true })
    .eq('id', user.id);

  if (updateError) {
    console.error('[stripe-connect-webhook] failed to update user', {
      userId: user.id,
      error: updateError.message,
    });
    return NextResponse.json({ received: true, processed: false, reason: 'user update failed' }, { status: 200 });
  }

  console.log(`[stripe-connect-webhook] consignor ${user.handle} (${user.id}) is now payout-capable`);

  return NextResponse.json({ received: true, processed: true, userId: user.id }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[stripe-connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing stripe-signature header' }, { status: 400 });
  }

  const payload = await request.text();

  let stripe: Stripe;
  try {
    stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });
  } catch {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-connect-webhook] signature verification failed: ${message}`);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, processed: false }, { status: 200 });
  }

  if (event.type === 'account.updated') {
    return handleAccountUpdated(stripe, event);
  }

  return NextResponse.json({ received: true, processed: false }, { status: 200 });
}