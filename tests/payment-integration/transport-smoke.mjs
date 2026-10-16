// Actual psql connections, production transport and adapters. Never funds or mutates accepted fixtures.
import assert from 'node:assert/strict';
import {createPaymentPostgresTransport} from '../../lib/db/payment-postgres.ts';
import {paymentWorkerIdentity} from '../../lib/db/payment-v2-workers.ts';
for(const label of ['issuer','verifier','settler','executor','notifier']){
 const role='payment_v2_'+label,login='payment_integration_'+label;
 const rpc=createPaymentPostgresTransport({role,login,host:'127.0.0.1',port:5432,database:'flexsoar_payment_v2_test',sslMode:'disable'});
 assert.equal(await paymentWorkerIdentity(rpc,role),login);
 await assert.rejects(()=>rpc.rpc('fn_payment_v2_reconcile_event',{p_event_id:'00000000-0000-0000-0000-000000000000',extra:'forbidden'}),/not allowed/);
 console.log('ACTUAL DEDICATED TRANSPORT PASS',label);
}
