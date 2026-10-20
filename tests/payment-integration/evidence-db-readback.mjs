/** Dedicated-worker readback/recovery checks against the already reviewed
 * integration DB only. Reuses an existing immutable committed receipt; it does
 * not create a new sale or alter the accepted flexsoar_payment_v2_test DB. */
import assert from 'node:assert/strict';
import { readFileSync, readlinkSync } from 'node:fs';
import { createPaymentPostgresTransport } from '../../lib/db/payment-postgres.ts';
import { paymentWorkerIdentity, paymentAcknowledgementContext, paymentAttemptContext, paymentVerifierContext, readVerifiedPaymentEvidence, persistVerifiedPaymentEvidence, recoverCommittedClaimAcknowledgement } from '../../lib/db/payment-v2-workers.ts';
import { claimAcknowledgementInstruction } from '../../lib/solana/v2-context.ts';
import { inspectAuthorityTransaction } from '../../lib/solana/v2-authority-observer.ts';
import { inspectV2Transaction } from '../../lib/solana/v2-observer.ts';
import { decodePermit } from '../../lib/solana/protocol-v2.ts';
import { validateRetainedFinalizedEvidence } from '../../lib/solana/v2-evidence.ts';

assert.ok(process.argv[2]==='--read-existing-evidence-isolated-only','explicit isolated DB readback switch required');
const attestation=JSON.parse(readFileSync('/state/integration-host-attestation.json','utf8'));
assert.equal(attestation.containerId,'71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92');
assert.equal(attestation.network,'none');assert.equal(attestation.database,'flexsoar_payment_v2_integration_test');
assert.equal(attestation.namespace,readlinkSync('/proc/self/ns/net'));
assert.deepEqual(readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(line=>line.includes(':')).map(line=>line.split(':')[0].trim()),['lo']);
assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);

const database='flexsoar_payment_v2_integration_test';
const transport=label=>createPaymentPostgresTransport({role:'payment_v2_'+label,login:'payment_integration_'+label,host:'127.0.0.1',port:5432,database,sslMode:'disable'});
const verifier=transport('verifier'),settler=transport('settler'),issuer=transport('issuer');
const identities=await Promise.all([
  paymentWorkerIdentity(verifier,'payment_v2_verifier'),paymentWorkerIdentity(settler,'payment_v2_settler'),paymentWorkerIdentity(issuer,'payment_v2_issuer'),
]);
assert.equal(new Set(identities).size,3,'readback must use distinct dedicated non-admin worker connections');

// The results manifest contains public synthetic IDs and signatures, not keys.
// Select a previously completed direct event so the settled-receipt fast path
// can be exercised without making a new chain request or changing claim state.
const results=JSON.parse(readFileSync('/state/integrated-JXopR6/results.json','utf8'));
const candidates=results.filter(row=>row?.details?.actualConsumption?.eventId&&row?.details?.actualConsumption?.attemptId);
assert.ok(candidates.length,'existing synthetic integration manifest has a committed consumption');
let selected,ack;
for(const row of [...candidates].reverse()){
  const eventId=row.details.actualConsumption.eventId;
  try{const context=await paymentAcknowledgementContext(settler,eventId);if(context.kind==='direct'&&context.receipt){selected={row,eventId,context};ack=context;break;}}catch{}
}
assert.ok(selected,'a committed direct-sale receipt is required for receipt-only retry coverage');
assert.equal(ack.eventId,selected.eventId);

const firstReceipt=await recoverCommittedClaimAcknowledgement(settler,verifier,selected.eventId);
const duplicateReceipt=await recoverCommittedClaimAcknowledgement(settler,verifier,selected.eventId);
assert.equal(firstReceipt.kind,'receipt');assert.deepEqual(duplicateReceipt,firstReceipt,'duplicate recovery returns the same committed receipt');
let verifierContextError=null;
try{await paymentVerifierContext(verifier,'attempt',ack.attemptId);}catch(error){verifierContextError=error instanceof Error?error.message:String(error);}

let stored=await readVerifiedPaymentEvidence(verifier,'lifecycle',ack.saleId,'acknowledged'),subjectKind='lifecycle',subjectId=ack.saleId,subjectAction='acknowledged',inspect;
if(stored){const instruction=await claimAcknowledgementInstruction(ack);inspect=(tx,signature)=>inspectAuthorityTransaction(tx,signature,instruction);}
else{
  stored=await readVerifiedPaymentEvidence(verifier,'payment_event',ack.attemptId,'direct');subjectKind='payment_event';subjectId=ack.attemptId;subjectAction='direct';
  if(stored){const attempt=await paymentAttemptContext(verifier,ack.attemptCommitment,ack.genesis,ack.program),permit=decodePermit(Buffer.from(String(attempt.permitHex),'hex'));const snapshot={address:String(attempt.sale),permit,state:3,fundedSlot:Number(stored.slot),fundedAt:BigInt(stored.blockTime),outcomeSlot:Number(stored.slot),decisionRevision:BigInt(String(attempt.revision??'1'))};inspect=(tx,signature)=>inspectV2Transaction(tx,signature,snapshot,'direct');}
}
if(!stored||!inspect){console.log('DATABASE_EVIDENCE_READBACK_BLOCKED',JSON.stringify({database,receiptRecovery:'PASS: committed receipt returned twice without chain lookup',lifecycleEvidenceReadable:!!stored&&subjectKind==='lifecycle',paymentEventEvidenceReadable:!!stored&&subjectKind==='payment_event',verifierContextError,reason:'dedicated verifier read RPC returned NULL for retained evidence subjects; no schema or data repair authorized'}));process.exitCode=2;
}else{

assert.equal(stored.subjectId,subjectId);assert.equal(stored.subjectAction,subjectAction);
if(subjectKind==='lifecycle')assert.equal(stored.signature,ack.receipt.signature);
assert.ok(stored.parsedRpcResult?.compiledRpcResult?.transaction?.message?.instructions,'compiled json response persisted');
assert.ok(Array.isArray(stored.parsedRpcResult.lookupTableEvidence),'lookup proof collection persisted');

const expected={networkId:ack.networkId,genesis:ack.genesis,program:ack.program,signature:stored.signature,subjectKind,subjectId,subjectAction};
const checked=await validateRetainedFinalizedEvidence(stored,expected,inspect);
assert.equal(checked.signature,stored.signature);
const before=JSON.stringify({id:stored.id,transactionDigest:stored.transactionDigest,parsedResultDigest:stored.parsedResultDigest,signature:stored.signature,parsed:stored.parsedRpcResult});
const persistedId=await persistVerifiedPaymentEvidence(verifier,checked);
assert.equal(persistedId,stored.id,'idempotent persistence returns the same evidence row');
const readback=await readVerifiedPaymentEvidence(verifier,subjectKind,subjectId,subjectAction);
assert.equal(JSON.stringify({id:readback.id,transactionDigest:readback.transactionDigest,parsedResultDigest:readback.parsedResultDigest,signature:readback.signature,parsed:readback.parsedRpcResult}),before,'stored compiled response and lookup proof are unchanged');

const tampered=structuredClone(checked);
tampered.parsedRpcResult.compiledRpcResult.transaction.message.instructions[0].data='111';
await assert.rejects(validateRetainedFinalizedEvidence(tampered,expected,inspect),'tampered instruction must fail before any lifecycle RPC');
await assert.rejects(persistVerifiedPaymentEvidence(verifier,tampered),'conflicting evidence must not replace the immutable row');
const afterConflict=await readVerifiedPaymentEvidence(verifier,subjectKind,subjectId,subjectAction);
assert.equal(JSON.stringify({id:afterConflict.id,transactionDigest:afterConflict.transactionDigest,parsedResultDigest:afterConflict.parsedResultDigest,signature:afterConflict.signature,parsed:afterConflict.parsedRpcResult}),before,'conflict rejection preserves immutable evidence');

console.log('ISOLATED_DATABASE_EVIDENCE_READBACK_PASS',JSON.stringify({database,workerLoginsDistinct:true,eventId:ack.eventId,saleId:ack.saleId,subjectKind,subjectAction,evidenceId:stored.id,compiledResponsePersisted:true,lookupProofCount:stored.parsedRpcResult.lookupTableEvidence.length,idempotentPersistedSameId:true,tamperRejectedBeforeLifecycle:true,conflictingPersistRejected:true,committedReceiptRecoveredTwice:true,chainLookupDuringReceiptRetry:false,pendingAcknowledgementFixtureAvailable:false}));
}
