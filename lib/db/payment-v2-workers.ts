/** Typed contracts for dedicated database-login adapters. No service-role fallback,
 * signing, network sends, or notification delivery. Provisioning remains required. */
import { paymentRpc, type PaymentRpc, type PaymentOperation } from './payment-v2';
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
