/** Real RPC adapters. Missing schema is an error, never a production mock store. */
import { PAYMENT_POLICY_V1, paymentPolicyDigest } from '@/lib/solana/payment-policy';
export interface PaymentRpc { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }
export interface AttemptStatus {
  id: string; listingId: string; mode: 'seller_held_escrow' | 'vaulted_direct';
  funding: string; dispatch: string; authentication: string; sellerSettlement: string;
  claim: string; signatures: string[]; operationPending: boolean;
}
export interface PaymentDecision {
  escrowId: string; commandId: string; expectedRevision: string;
  action: 'receipt' | 'authentication_pass' | 'authentication_fail' | 'release' | 'refund' | 'dispute';
  evidenceDigest: string; pairCommitment: string;
}
export class PaymentSchemaUnavailable extends Error {}
export async function paymentRpc(client: PaymentRpc, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) throw new PaymentSchemaUnavailable(`${name}: ${result.error.code ?? 'RPC_ERROR'}: ${result.error.message}`);
  return result.data;
}
export function parseAttempt(value: unknown): AttemptStatus {
  if (!value || typeof value !== 'object') throw new Error('invalid durable attempt');
  const row = value as Record<string, unknown>;
  for (const key of ['id', 'listingId', 'funding', 'dispatch', 'authentication', 'sellerSettlement', 'claim']) if (typeof row[key] !== 'string') throw new Error(`invalid attempt ${key}`);
  if (!['seller_held_escrow', 'vaulted_direct'].includes(String(row.mode)) || !Array.isArray(row.signatures) || row.signatures.some(s => typeof s !== 'string') || typeof row.operationPending !== 'boolean') throw new Error('invalid attempt state');
  return { id: String(row.id), listingId: String(row.listingId), mode: row.mode as AttemptStatus['mode'], funding: String(row.funding), dispatch: String(row.dispatch), authentication: String(row.authentication), sellerSettlement: String(row.sellerSettlement), claim: String(row.claim), signatures: row.signatures as string[], operationPending: row.operationPending };
}
export async function ownPaymentAttempts(client: PaymentRpc, listingId: string): Promise<AttemptStatus[]> {
  const data = await paymentRpc(client, 'fn_payment_v2_own_attempts', { p_listing_id: listingId });
  if (!Array.isArray(data)) throw new Error('invalid attempt list');
  return data.map(parseAttempt).map(a => { if (a.listingId !== listingId) throw new Error('attempt listing mismatch'); return a; });
}
export async function recordPaymentDecision(client: PaymentRpc, d: PaymentDecision): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(d.escrowId) || !/^[0-9a-f-]{36}$/i.test(d.commandId)) throw new Error('escrow and idempotent command IDs required');
  if (!/^[a-f0-9]{64}$/.test(d.evidenceDigest) || !/^[a-f0-9]{64}$/.test(d.pairCommitment) || !/^\d+$/.test(d.expectedRevision)) throw new Error('exact pair, revision and evidence required');
  if (!['receipt','authentication_pass','authentication_fail','release','refund','dispute'].includes(d.action)) throw new Error('invalid decision');
  const data = await paymentRpc(client, 'fn_payment_v2_record_decision', { p_decision: d });
  if (typeof data !== 'string' || !data) throw new Error('missing durable operation ID'); return data;
}
export async function initiatePaymentAttempt(client: PaymentRpc, listingId: string, idempotencyKey: string): Promise<AttemptStatus> {
  if (!/^[0-9a-f-]{36}$/i.test(listingId) || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw new Error('listing and initiation IDs required');
  const data = await paymentRpc(client,'fn_payment_v2_initiate',{p_listing_id:listingId,p_idempotency_key:idempotencyKey,p_policy_version:PAYMENT_POLICY_V1.version,p_policy_digest:await paymentPolicyDigest()});
  const attempt=parseAttempt(data);if(attempt.listingId!==listingId)throw new Error('attempt listing mismatch');return attempt;
}
export async function attachPaymentCandidate(client: PaymentRpc, attemptId: string, signature: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^[1-9A-HJ-NP-Za-km-z]{80,96}$/.test(signature)) throw new Error('invalid payment candidate');
  await paymentRpc(client,'fn_payment_v2_attach_candidate',{p_attempt_id:attemptId,p_signature:signature});
}
export interface PaymentOperation { id:string; payloadDigest:string; expectedRevision:string; action:string }
export async function claimPaymentOperations(client: PaymentRpc, workerId: string): Promise<PaymentOperation[]> {
  if(!/^[0-9a-f-]{36}$/i.test(workerId))throw new Error('worker identity required');
  const data=await paymentRpc(client,'fn_payment_v2_claim_operations',{p_worker_id:workerId,p_limit:10});
  if(!Array.isArray(data))throw new Error('invalid operation lease response');
  return data.map(value=>{
    if(!value||typeof value!=='object')throw new Error('invalid operation');
    for(const key of ['id','payloadDigest','expectedRevision','action'])if(typeof value[key]!=='string')throw new Error('invalid immutable operation');
    return {id:value.id,payloadDigest:value.payloadDigest,expectedRevision:value.expectedRevision,action:value.action};
  });
}
export const FUNDING_AVAILABLE = false; // No env override: missing schema/program/signer integration cannot enable it.
