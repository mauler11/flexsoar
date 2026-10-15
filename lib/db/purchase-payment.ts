/** Orchestrates retries using orders as the only existing durable receipt.
 * It cannot persist an unrecorded chain payment: that requires a migration.
 */
export interface PaymentOrder {
  id: string;
  listing_id: string;
  buyer_id: string;
  settlement_ref: string | null;
  status: string;
}
export interface PaymentIdentity { buyerId: string; listingId: string; reference: string }

export function authorizedPaymentOrder(order: PaymentOrder, identity: PaymentIdentity): boolean {
  return order.buyer_id === identity.buyerId && order.listing_id === identity.listingId &&
    order.settlement_ref === identity.reference && order.status === 'settled';
}

export interface PaymentSettlementDependencies {
  findOrder: () => Promise<PaymentOrder | null>;
  verify: () => Promise<void>;
  settle: () => Promise<string>;
}

/** Both successful RPC responses and ambiguous failures are reconciled against
 * the persisted receipt. Unique consumption is still the DATABASE's job.
 */
export async function recoverOrSettlePayment(identity: PaymentIdentity, deps: PaymentSettlementDependencies): Promise<string> {
  const existing = await deps.findOrder();
  if (existing) {
    if (!authorizedPaymentOrder(existing, identity)) throw new Error('payment receipt does not match this purchase');
    return existing.id;
  }
  let failure: unknown;
  let returnedOrderId: string | undefined;
  try { await deps.verify(); returnedOrderId = await deps.settle(); } catch (error) { failure = error; }
  const recorded = await deps.findOrder();
  if (recorded) {
    if (!authorizedPaymentOrder(recorded, identity)) throw new Error('payment receipt does not match this purchase');
    if (returnedOrderId !== undefined && returnedOrderId !== recorded.id) {
      throw new Error('settlement returned a conflicting order; operator resolution required');
    }
    return recorded.id;
  }
  throw failure instanceof Error ? failure : new Error('payment has no matching settlement receipt; resolution required');
}

/** Interim classification until immutable settlement_rail exists. A missing
 * reference is NOT evidence of Stripe payment. Stripe execution is dormant.
 */
export function stripePayoutBlockReason(reference: string | null): string {
  if (reference?.trim().toLowerCase().startsWith('sol:')) return 'USDC settlement must never receive a Stripe payout';
  if (!reference?.startsWith('pi_')) return 'no explicit Stripe payment evidence';
  return 'Stripe payouts are dormant';
}
