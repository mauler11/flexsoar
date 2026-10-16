/** Typed contracts for dedicated database-login adapters. No service-role fallback,
 * signing, network sends, or notification delivery. Provisioning remains required. */
import { paymentRpc, type PaymentRpc, type PaymentOperation } from './payment-v2';
import type { VerifiedTransactionEvidence } from '@/lib/solana/v2-evidence';
import { validateRetainedFinalizedEvidence } from '@/lib/solana/v2-evidence';
import { claimAcknowledgementInstruction } from '@/lib/solana/v2-context';
import { inspectAuthorityTransaction } from '@/lib/solana/v2-authority-observer';
import { base58Decode } from '@/lib/solana/base58';
function uuid(value:string):void { if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('durable UUID required'); }
function object(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid payment context');return value as Record<string,unknown>;}
export interface PaymentSaleTerms {id:string;saleAddress:string;escrowAddress:string;totalUnits:string;fxSnapshot:Record<string,unknown>;validFrom:string;expiresAt:string}
export async function preparePaymentSale(issuer:PaymentRpc,listingId:string,networkId:string,terms:PaymentSaleTerms):Promise<string>{
 uuid(listingId);uuid(networkId);uuid(terms.id);
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(terms.saleAddress)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(terms.escrowAddress)||!/^\d+$/.test(terms.totalUnits)||!/^[-]?\d+$/.test(terms.validFrom)||!/^[-]?\d+$/.test(terms.expiresAt))throw new Error('invalid issuer sale terms');
 const id=await paymentRpc(issuer,'fn_payment_v2_prepare_sale',{p_listing_id:listingId,p_network_id:networkId,p_terms:terms});if(typeof id!=='string')throw new Error('missing durable sale');uuid(id);return id;
}
export async function authorizePaymentAttempt(issuer:PaymentRpc,attemptId:string):Promise<string>{
 uuid(attemptId);const data=await paymentRpc(issuer,'fn_payment_v2_authorize_attempt',{p_attempt_id:attemptId});
 if(typeof data!=='string'||!/^[0-9a-f]{1380}$/.test(data))throw new Error('invalid immutable permit');return data;
}
export async function paymentOperationContext(executor:PaymentRpc,operation:Pick<PaymentOperation,'id'|'leaseId'>):Promise<Record<string,unknown>>{
 uuid(operation.id);uuid(operation.leaseId);return object(await paymentRpc(executor,'fn_payment_v2_operation_context',{p_operation_id:operation.id,p_lease_id:operation.leaseId}));
}
export async function paymentIssuerContext(issuer:PaymentRpc,saleId:string,action:'open_sale'|'revoke_sale'):Promise<Record<string,unknown>>{
 uuid(saleId);return object(await paymentRpc(issuer,'fn_payment_v2_issuer_context',{p_sale_id:saleId,p_action:action}));
}
export async function paymentVerifierContext(verifier:PaymentRpc,kind:'attempt'|'decision'|'lifecycle',subjectId:string):Promise<Record<string,unknown>>{
 uuid(subjectId);return object(await paymentRpc(verifier,'fn_payment_v2_verifier_context',{p_kind:kind,p_subject_id:subjectId}));
}
export async function paymentAttemptContext(verifier:PaymentRpc,attempt:string,genesis:string,program:string):Promise<Record<string,unknown>>{
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(attempt)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(genesis)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(program))throw new Error('immutable chain attempt context required');
 return object(await paymentRpc(verifier,'fn_payment_v2_attempt_context',{p_attempt:attempt,p_genesis:genesis,p_program:program}));
}
export async function paymentAcknowledgementContext(settler:PaymentRpc,eventId:string):Promise<Record<string,unknown>>{
 uuid(eventId);return object(await paymentRpc(settler,'fn_payment_v2_ack_context',{p_event_id:eventId}));
}
/** Reconciles a claim acknowledgement from its already retained, previously
 * verified finalized transaction. This path never broadcasts or fetches history.
 * If verification evidence was never retained, it remains a manual review case. */
export async function recoverCommittedClaimAcknowledgement(settler:PaymentRpc,verifier:PaymentRpc,eventId:string):Promise<{kind:'receipt';receipt:Record<string,unknown>}|{kind:'reconciled';signature:string;claim:'available'|'quarantined'}>{
 uuid(eventId);
 if(settler===verifier)throw new Error('Dedicated settler and verifier connections required');
 const [settlerLogin,verifierLogin]=await Promise.all([
  paymentWorkerIdentity(settler,'payment_v2_settler'),paymentWorkerIdentity(verifier,'payment_v2_verifier'),
 ]);
 if(settlerLogin===verifierLogin)throw new Error('Dedicated settler and verifier must use distinct database logins');
 const context=await paymentAcknowledgementContext(settler,eventId);
 if(context.eventId!==eventId||typeof context.saleId!=='string'||typeof context.generation!=='string'||typeof context.revision!=='string'||typeof context.sale!=='string'||typeof context.genesis!=='string'||typeof context.program!=='string'||typeof context.networkId!=='string'||typeof context.cardCommitment!=='string'||!['direct','released','refunded'].includes(String(context.kind)))throw new Error('invalid committed acknowledgement context');
 if(context.receipt!==null&&context.receipt!==undefined){
  const receipt=object(context.receipt);
  if(receipt.saleId!==context.saleId||receipt.kind!=='acknowledged'||receipt.outcome!==context.kind||typeof receipt.signature!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{80,96}$/.test(receipt.signature))throw new Error('conflicting committed acknowledgement receipt');
  return {kind:'receipt',receipt};
 }
 const stored=await readVerifiedPaymentEvidence(verifier,'lifecycle',context.saleId,'acknowledged');
 if(!stored)throw new Error('PAYMENT_V2_ACK_HISTORY_UNVERIFIED_REVIEW_REQUIRED');
 if(typeof stored.signature!=='string'||typeof stored.id!=='string'||typeof stored.slot!=='string'||typeof stored.blockTime!=='string')throw new Error('invalid retained acknowledgement evidence');
 const expected={networkId:context.networkId,genesis:context.genesis,program:context.program,signature:stored.signature,subjectKind:'lifecycle' as const,subjectId:context.saleId,subjectAction:'acknowledged'};
 const instruction=await claimAcknowledgementInstruction(context);
 const evidence=await validateRetainedFinalizedEvidence(stored,expected,(transaction,signature)=>inspectAuthorityTransaction(transaction,signature,instruction));
 const cardCommitment=Buffer.from(base58Decode(context.cardCommitment)).toString('hex');
 if(cardCommitment.length!==64||evidence.slot!==Number(stored.slot)||evidence.blockTime!==Number(stored.blockTime))throw new Error('retained acknowledgement metadata mismatch');
 await recordPaymentLifecycle(verifier,{saleId:context.saleId,kind:'acknowledged',finality:'finalized',sale:context.sale,genesis:context.genesis,program:context.program,generation:context.generation,revision:context.revision,outcome:context.kind,cardCommitment,signature:evidence.signature,slot:evidence.slot,executedAtSeconds:String(evidence.blockTime),evidenceId:stored.id});
 return {kind:'reconciled',signature:evidence.signature,claim:context.kind==='refunded'?'quarantined':'available'};
}
/** Persist only after the configured finalized observer checked this exact
 * transaction against an immutable context. The DB digest is integrity evidence,
 * not an independent chain-finality oracle. */
export async function persistVerifiedPaymentEvidence(verifier:PaymentRpc,evidence:VerifiedTransactionEvidence):Promise<string>{
 uuid(evidence.networkId);uuid(evidence.subjectId);
 if(evidence.formatVersion!==1||evidence.finality!=='finalized'||!['primary','archive'].includes(evidence.sourceKind)||!/^[-A-Za-z0-9._:]{1,96}$/.test(evidence.sourceLabel)||!/^([0-9a-f]{64})$/.test(evidence.transactionDigest)||!/^([0-9a-f]{64})$/.test(evidence.messageDigest)||!evidence.parsedRpcResult||typeof evidence.parsedRpcResult!=='object')throw new Error('invalid verified evidence envelope');
 const id=await paymentRpc(verifier,'fn_payment_v2_store_chain_evidence',{p_evidence:evidence});if(typeof id!=='string')throw new Error('missing durable evidence id');uuid(id);return id;
}
export async function readVerifiedPaymentEvidence(verifier:PaymentRpc,subjectKind:string,subjectId:string,subjectAction:string):Promise<Record<string,unknown>|null>{
 uuid(subjectId);const value=await paymentRpc(verifier,'fn_payment_v2_read_chain_evidence',{p_subject_kind:subjectKind,p_subject_id:subjectId,p_subject_action:subjectAction});return value===null?null:object(value);
}
/** Reports transport state only AFTER stageSignedOperation has durably stored the
 * complete envelope. Database rejects signature-only submission. Unknown/submitted
 * operations recover that identity; bookkeeping failure never permits replacement. */
export async function finishPaymentOperation(executor:PaymentRpc,operation:Pick<PaymentOperation,'id'|'leaseId'>,outcome:'retry'|'submitted'|'unknown',signature:string|null,error:string|null):Promise<void>{
 uuid(operation.id);uuid(operation.leaseId);
 if(outcome==='retry'&&signature!==null)throw new Error('signed operation is recovery-only');
 if(!['retry','submitted','unknown'].includes(outcome)||(signature!==null&&!/^[1-9A-HJ-NP-Za-km-z]{80,96}$/.test(signature))||(outcome!=='retry'&&!signature))throw new Error('signed operation identity required');
 await paymentRpc(executor,'fn_payment_v2_finish_operation',{p_operation_id:operation.id,p_lease_id:operation.leaseId,p_outcome:outcome,p_signature:signature,p_error:error});
}
/** Caller is a dedicated verifier after independent finalized instruction/account
 * verification. This adapter does not turn a supplied digest into chain proof. */
export async function recordPaymentAttestation(verifier:PaymentRpc,proof:Record<string,unknown>):Promise<void>{
 await paymentRpc(verifier,'fn_payment_v2_record_attestation',{p_proof:proof});
}
export async function recordPaymentLifecycle(verifier:PaymentRpc,proof:Record<string,unknown>):Promise<void>{
 await paymentRpc(verifier,'fn_payment_v2_record_lifecycle',{p_proof:proof});
}
export async function approvePaymentGovernance(client:PaymentRpc,commandId:string):Promise<string>{
 uuid(commandId);const id=await paymentRpc(client,'fn_payment_v2_approve_refund',{p_command_id:commandId});if(typeof id!=='string')throw new Error('missing governance operation');uuid(id);return id;
}
export interface PaymentOutboxJob{id:string;leaseId:string;userId:string;kind:string;payload:Record<string,unknown>;deliveryKey:string}
export async function claimPaymentOutbox(notifier:PaymentRpc,limit=20):Promise<PaymentOutboxJob[]>{
 if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('invalid outbox limit');
 const rows=await paymentRpc(notifier,'fn_payment_v2_claim_outbox',{p_limit:limit});if(!Array.isArray(rows))throw new Error('invalid outbox response');
 return rows.map(row=>{const r=object(row);for(const k of ['id','leaseId','userId','kind','deliveryKey'])if(typeof r[k]!=='string')throw new Error('invalid outbox lease');
  const id=String(r.id),leaseId=String(r.leaseId),userId=String(r.userId);uuid(id);uuid(leaseId);uuid(userId);if(r.deliveryKey!==id)throw new Error('outbox delivery identity mismatch');
  return {id,leaseId,userId,kind:String(r.kind),payload:object(r.payload),deliveryKey:id};});
}
export async function finishPaymentOutbox(notifier:PaymentRpc,job:Pick<PaymentOutboxJob,'id'|'leaseId'>,delivered:boolean,error:string|null):Promise<void>{
 uuid(job.id);uuid(job.leaseId);await paymentRpc(notifier,'fn_payment_v2_finish_outbox',{p_id:job.id,p_lease_id:job.leaseId,p_delivered:delivered,p_error:error});
}

export async function recordPaymentOperationFailure(verifier:PaymentRpc,operationId:string,proof:Record<string,unknown>):Promise<void>{
 uuid(operationId);await paymentRpc(verifier,'fn_payment_v2_record_operation_failure',{p_operation_id:operationId,p_proof:proof});
}

export async function paymentWorkerIdentity(client:PaymentRpc,role:'payment_v2_issuer'|'payment_v2_verifier'|'payment_v2_settler'|'payment_v2_executor'|'payment_v2_notifier'):Promise<string>{
 const r=object(await paymentRpc(client,'fn_payment_v2_worker_identity',{p_required_role:role}));
 if(typeof r.login!=='string'||!r.login||r.role!==role||r.superuser!==false)throw new Error('Dedicated database connection identity mismatch');return r.login;
}
