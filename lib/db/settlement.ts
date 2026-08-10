/**
 * lib/db/settlement.ts
 *
 * The two reads the Stripe webhook needs before it may record a sale. Both
 * run on the service-role client, because a webhook arrives from Stripe with
 * no session: there is no cookie, so every RLS policy keyed on auth.uid()
 * evaluates false and both of these reads would come back empty.
 *
 * Nothing else may import this module. It is not a general read path — the
 * general read path is lib/api/contract.ts, which runs as the user.
 */

import { createServiceSupabase } from '@/lib/supabase/server';
import type { Cents, ListingStatus, OrderStatus, UUID } from '@/lib/db/types';

export interface SettledOrder {
  id: UUID;
  listing_id: UUID;
  status: OrderStatus;
}

/**
 * The order already recorded for a payment intent, if there is one.
 *
 * Stripe delivers at-least-once, so the same payment_intent.succeeded arrives
 * more than once in normal operation. Without this check the second delivery
 * calls fn_purchase_card on a listing that is already 'sold', gets a
 * WRONG_STATUS back, and — if the webhook answered with a non-2xx — Stripe
 * would keep retrying a settlement that already succeeded.
 */
export async function findOrderBySettlementRef(
  settlementRef: string,
): Promise<SettledOrder | null> {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase
    .from('orders')
    .select('id, listing_id, status')
    .eq('settlement_ref', settlementRef)
    .limit(1);

  if (error) {
    throw new Error(`could not check for an existing order: ${error.message}`);
  }

  return ((data as SettledOrder[] | null) ?? [])[0] ?? null;
}

export interface ListingForSettlement {
  id: UUID;
  seller_id: UUID;
  price_cents: Cents;
  status: ListingStatus;
}

/**
 * The listing a payment intent claims to be paying for.
 *
 * Read before recording so the webhook can check that what Stripe captured
 * matches what the listing asks. fn_purchase_card writes the ledger from
 * `listings.price_cents`, never from the Stripe amount, so a mismatch means
 * the ledger would disagree with the money that actually moved.
 */
export async function findListingForSettlement(
  listingId: UUID,
): Promise<ListingForSettlement | null> {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase
    .from('listings')
    .select('id, seller_id, price_cents, status')
    .eq('id', listingId)
    .limit(1);

  if (error) {
    throw new Error(`could not read the listing: ${error.message}`);
  }

  return ((data as ListingForSettlement[] | null) ?? [])[0] ?? null;
}
