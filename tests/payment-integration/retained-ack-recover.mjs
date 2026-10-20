/** Recovery-only companion to integrated.mjs --retained-ack-recovery-isolated-integration.
 * Consumes the ALREADY retained, finalized ACK evidence of index 14 through the dedicated
 * settler/verifier logins. It never starts a validator, never contacts a chain, never signs,
 * and refuses to run while any owned validator port is listening. */
import assert from 'node:assert/strict';
import { readFileSync, readlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { createPaymentPostgresTransport } from '../../lib/db/payment-postgres.ts';
import { paymentWorkerIdentity, readVerifiedPaymentEvidence, recoverCommittedClaimAcknowledgement } from '../../lib/db/payment-v2-workers.ts';

const args=process.argv.slice(2);
assert.ok(args.length===3&&args[0]==='--recover-retained-ack-isolated-only'&&/^\/state\/integrated-[A-Za-z0-9]+$/.test(args[1])&&['1','2','3'].includes(args[2]),'explicit isolated recovery switch, run directory and attempt 1|2|3 required');
const root=args[1],attempt=Number(args[2]),state=n=>join(root,n);
const attestation=JSON.parse(readFileSync('/state/integration-host-attestation.json','utf8'));
assert.equal(attestation.containerId,'71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92');
assert.equal(attestation.network,'none');assert.equal(attestation.database,'flexsoar_payment_v2_integration_test');
assert.equal(attestation.namespace,readlinkSync('/proc/self/ns/net'));
assert.deepEqual(readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(line=>line.includes(':')).map(line=>line.split(':')[0].trim()),['lo']);
assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
// No chain is reachable during recovery: every owned validator port must refuse connections.
for(const port of [18899,18900,18901])await new Promise((ok,bad)=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();bad(new Error('validator port '+port+' is listening; recovery must run without any chain'));});s.once('error',e=>e.code==='ECONNREFUSED'?ok():bad(e));});

const marker=JSON.parse(readFileSync(state('crash-after-ack-evidence-14.json'),'utf8'));
for(const k of ['eventId','saleId','attemptId','evidenceId'])assert.match(String(marker[k]),/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
assert.match(String(marker.ackSignature),/^[1-9A-HJ-NP-Za-km-z]{80,96}$/);

const database='flexsoar_payment_v2_integration_test';
const transport=label=>createPaymentPostgresTransport({role:'payment_v2_'+label,login:'payment_integration_'+label,host:'127.0.0.1',port:5432,database,sslMode:'disable'});
const verifier=transport('verifier'),settler=transport('settler');
const identities=await Promise.all([paymentWorkerIdentity(verifier,'payment_v2_verifier'),paymentWorkerIdentity(settler,'payment_v2_settler')]);
assert.equal(new Set(identities).size,2,'distinct dedicated non-admin worker logins required');

const retained=await readVerifiedPaymentEvidence(verifier,'lifecycle',marker.saleId,'acknowledged');
assert.ok(retained,'retained ACK evidence must exist before recovery');
assert.equal(retained.id,marker.evidenceId);assert.equal(retained.signature,marker.ackSignature);
assert.ok(retained.parsedRpcResult?.compiledRpcResult,'retained evidence must carry the compiled RPC result');

const outcome=await recoverCommittedClaimAcknowledgement(settler,verifier,marker.eventId);
if(attempt===1){
 assert.ok(!existsSync(state('scenario-14-recovered.json')),'first recovery must start from the uncommitted state');
 assert.deepEqual(outcome,{kind:'reconciled',signature:marker.ackSignature,claim:'available'});
 writeFileSync(state('scenario-14-recovered.json'),JSON.stringify({attempt,outcome,evidenceId:retained.id}),{flag:'wx'});
}else{
 assert.ok(existsSync(state('scenario-14-recovered.json')),'repeat recovery requires the first reconciliation');
 assert.equal(outcome.kind,'receipt');assert.equal(outcome.receipt.signature,marker.ackSignature);assert.equal(outcome.receipt.saleId,marker.saleId);assert.equal(outcome.receipt.kind,'acknowledged');
 if(attempt===3)assert.deepEqual(outcome,JSON.parse(readFileSync(state('recovery-14-2.json'),'utf8')).outcome,'repeat recoveries return the identical receipt');
 writeFileSync(state('recovery-14-'+attempt+'.json'),JSON.stringify({attempt,outcome}),{flag:'wx'});
}
console.log('RETAINED_ACK_RECOVERY_PASS',JSON.stringify({attempt,eventId:marker.eventId,saleId:marker.saleId,evidenceId:retained.id,outcome,chainContacted:false,workerLoginsDistinct:true}));
