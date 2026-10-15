export const PAYMENT_POLICY_V1 = Object.freeze({
  version: 'MY-USDC-ESCROW-1', dispatchSeconds: 48 * 3600, evidenceGraceSeconds: 24 * 3600,
  peninsularReviewDays: 7, eastMalaysiaReviewDays: 14, traceEscalationDays: 7,
  authenticationBusinessDays: 2, rejectionChallengeSeconds: 48 * 3600,
  disputeReviewBusinessDays: 5, refundPrincipalBps: 10_000, manualRefundApproval: true,
});
/** Version rows must be immutable; digest covers ALL rules, not version label alone. */
export async function paymentPolicyDigest(): Promise<string> {
  const entries=Object.entries(PAYMENT_POLICY_V1).sort(([a],[b])=>a<b?-1:a>b?1:0);
  const bytes=new TextEncoder().encode(JSON.stringify(entries));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function dispatchReview(fundedAt: number, now: number, evidence: 'label' | 'carrier_accepted' | 'reviewed_dropoff' | 'unknown'): 'awaiting_dispatch' | 'in_transit' | 'review_required' {
  if (!Number.isFinite(fundedAt) || !Number.isFinite(now)) throw new Error('invalid timestamps');
  if (evidence === 'carrier_accepted' || evidence === 'reviewed_dropoff') return 'in_transit';
  return now >= fundedAt + (PAYMENT_POLICY_V1.dispatchSeconds + PAYMENT_POLICY_V1.evidenceGraceSeconds) * 1000 ? 'review_required' : 'awaiting_dispatch';
}
// Business-day deadlines deliberately require a supplied operational calendar.
// No calendar, carrier-loss liability or timer-to-refund rule is fabricated.
