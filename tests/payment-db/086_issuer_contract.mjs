// Isolated-container contract suite for migration 086. Run after 03 and 35.
// This test creates only synthetic fixture state in flexsoar_payment_v2_test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const container = process.argv[2];
const database = 'flexsoar_payment_v2_test';
assert.ok(container, 'usage: node tests/payment-db/086_issuer_contract.mjs <container-id>');

function exec(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function isolated() {
  const inspect = exec(['inspect', container, '--format', '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{json .Mounts}}']);
  assert.equal(inspect.status, 0, inspect.output);
  assert.equal(inspect.output.trim(), 'none|{}|false|[]', 'container isolation changed');
  const links = exec(['exec', container, 'sh', '-lc', 'ip -o link']);
  assert.equal(links.status, 0, links.output);
  assert.equal((links.output.match(/^[0-9]+: /gm) ?? []).length, 1, 'non-loopback interface found');
  assert.match(links.output, /^1: lo:/m, 'loopback interface missing');
}

function psql(sql, user = 'supabase_admin', workerRole = '') {
  isolated();
  const opts = `-c payment_v2.test_identity=synthetic-payment-v2-only${workerRole ? ` -c role=${workerRole}` : ''}`;
  const result = exec(['exec', '-e', `PGOPTIONS=${opts}`, container, 'psql', '-q', '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-h', '127.0.0.1', '-U', user, '-d', database, '-c', sql]);
  if (result.status !== 0) throw new Error(result.output);
  return result.output.trim();
}

function refused(sql, code, user = 'payment_db_test_issuer', workerRole = 'payment_v2_issuer') {
  isolated();
  const opts = `-c payment_v2.test_identity=synthetic-payment-v2-only -c role=${workerRole}`;
  const result = exec(['exec', '-e', `PGOPTIONS=${opts}`, container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', user, '-d', database, '-c', sql]);
  assert.notEqual(result.status, 0, `expected refusal ${code}`);
  assert.match(result.output, new RegExp(code), result.output);
}

// The target guard is checked in every fresh connection before any assertion.
psql(`DO $g$ BEGIN IF current_database()<>'${database}' OR inet_server_addr() NOT IN('127.0.0.1'::inet,'::1'::inet) OR current_setting('payment_v2.test_identity',true) IS DISTINCT FROM 'synthetic-payment-v2-only' THEN RAISE EXCEPTION 'target guard'; END IF; END $g$;`);

const badCombos = [
  `('network',gen_random_uuid(),gen_random_uuid())`,
  `('listing',NULL,NULL)`, `('listing',gen_random_uuid(),NULL)`,
  `('sale',NULL,NULL)`, `('sale',gen_random_uuid(),gen_random_uuid())`,
  `('attempt',NULL,NULL)`, `('attempt',gen_random_uuid(),gen_random_uuid())`,
  `('prepare_recovery',NULL,NULL)`, `('prepare_recovery',gen_random_uuid(),gen_random_uuid())`,
];
for (const args of badCombos) refused(`SELECT public.fn_payment_v2_issuer_subject_context${args}`, 'PAYMENT_V2_ISSUER_NULLABILITY');
refused(`SELECT public.fn_payment_v2_issuer_subject_context('invalid',NULL,NULL)`, 'PAYMENT_V2_ISSUER_KIND_UNSUPPORTED');

const absentIds = psql(`SELECT gen_random_uuid()::text||'|'||gen_random_uuid()::text||'|'||gen_random_uuid()::text||'|'||gen_random_uuid()::text`).split('|');
const [absentSale, absentListing, absentAttempt, absentNetwork] = absentIds;
refused(`SELECT public.fn_payment_v2_issuer_subject_context('network',NULL,'${absentNetwork}')`, 'PAYMENT_V2_ISSUER_SUBJECT_MISSING');
refused(`SELECT public.fn_payment_v2_issuer_subject_context('listing','${absentListing}','${absentNetwork}')`, 'PAYMENT_V2_ISSUER_SUBJECT_MISSING');
refused(`SELECT public.fn_payment_v2_issuer_subject_context('sale','${absentSale}',NULL)`, 'PAYMENT_V2_ISSUER_SUBJECT_MISSING');
refused(`SELECT public.fn_payment_v2_issuer_subject_context('attempt','${absentAttempt}',NULL)`, 'PAYMENT_V2_ISSUER_SUBJECT_MISSING');
const recovery = psql(`SELECT public.fn_payment_v2_issuer_subject_context('prepare_recovery','${absentSale}',NULL)->>'found'`, 'payment_db_test_issuer', 'payment_v2_issuer');
assert.equal(recovery, 'false', 'prepare_recovery must represent absence explicitly');

// Owned subject rows carry both identity values. A foreign subject comparison is a hard service refusal.
const fixture = psql(`SELECT (f->>'listing')||'|'||(f->>'sale')||'|'||(f->>'attempt')||'|'||(f->>'network')||'|'||(f->>'seller')||'|'||(f->>'buyer') FROM payment_db_workers.cases WHERE name='escrow'`, 'payment_db_test_issuer', 'payment_v2_issuer').split('|');
assert.equal(fixture.length, 6, 'expected 35 synthetic worker fixture');
const [listing, sale, attempt, network, seller, buyer] = fixture;
const listingContext = JSON.parse(psql(`SELECT public.fn_payment_v2_issuer_subject_context('listing','${listing}','${network}')`, 'payment_db_test_issuer', 'payment_v2_issuer'));
assert.equal(listingContext.ownerId, seller);
assert.equal(listingContext.ownerAuthId, seller);
assert.notEqual(listingContext.ownerAuthId, buyer, 'foreign user must not match returned owner');
assert.equal(JSON.parse(psql(`SELECT public.fn_payment_v2_issuer_subject_context('sale','${sale}',NULL)`, 'payment_db_test_issuer', 'payment_v2_issuer')).ownerAuthId, seller);
assert.equal(JSON.parse(psql(`SELECT public.fn_payment_v2_issuer_subject_context('attempt','${attempt}',NULL)`, 'payment_db_test_issuer', 'payment_v2_issuer')).ownerAuthId, buyer);
assert.equal(JSON.parse(psql(`SELECT public.fn_payment_v2_issuer_subject_context('network',NULL,'${network}')`, 'payment_db_test_issuer', 'payment_v2_issuer')).networkId, network);

// Establish one fully synthetic, opening, fenced, signed-listing operation for lease tests.
const listingMessage = `decode('46534f415256322d4c49535400','hex')||sha256(convert_to('lease-${sale}','UTF8'))||decode(repeat('00',16),'hex')`;
psql(`UPDATE payment_v2.sales SET state='opening',fence=true WHERE id='${sale}'; UPDATE payment_v2.operations SET state='pending',ready=true,lease_id=NULL,leased_by=NULL,lease_until=NULL,available_at=clock_timestamp(),issuer_fencing_token=0 WHERE sale_id='${sale}' AND action='open_sale'; INSERT INTO payment_v2.sale_listings(sale_id,message,signature,signer,binding,min_total_units,expires_at) SELECT s.id,${listingMessage},decode(repeat('5a',64),'hex'),s.seller_wallet,substring(${listingMessage} FROM 14 FOR 32),1,extract(epoch FROM clock_timestamp())::bigint+3600 FROM payment_v2.sales s WHERE s.id='${sale}';`);
const baseOperation = psql(`SELECT id::text FROM payment_v2.operations WHERE sale_id='${sale}' AND action='open_sale' ORDER BY created_at,id LIMIT 1`);

// Two concurrent claimers must receive different operation rows. The second waits on
// the sale lock only after SKIP LOCKED has selected its distinct operation.
psql(`UPDATE payment_v2.operations SET available_at=clock_timestamp()+interval '1 hour' WHERE id='${baseOperation}'; INSERT INTO payment_v2.operations(sale_id,action,payload,payload_digest,expected_revision,ready,state,created_at,available_at) SELECT sale_id,'open_sale',payload,payload_digest,expected_revision,true,'pending',clock_timestamp()-interval '1 second',clock_timestamp() FROM payment_v2.operations WHERE id='${baseOperation}'; INSERT INTO payment_v2.operations(sale_id,action,payload,payload_digest,expected_revision,ready,state,created_at,available_at) SELECT sale_id,'open_sale',payload,payload_digest,expected_revision,true,'pending',clock_timestamp(),clock_timestamp() FROM payment_v2.operations WHERE id='${baseOperation}'`);
const concurrentClaims = async (sleepSeconds) => {
  isolated();
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn('docker', ['exec', '-e', 'PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only -c role=payment_v2_issuer', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-h', '127.0.0.1', '-U', 'payment_db_test_issuer', '-d', database, '-c', `BEGIN; SELECT public.fn_payment_v2_claim_open_sale(1); SELECT pg_sleep(${sleepSeconds}); COMMIT;`], { windowsHide: true });
    let output = ''; child.stdout.on('data', (x) => { output += x; }); child.stderr.on('data', (x) => { output += x; }); child.on('close', (status) => resolve({ status, output }));
  });
};
const claimA = concurrentClaims(1);
await new Promise((resolve) => setTimeout(resolve, 150));
const claimB = concurrentClaims(0);
const claimResults = await Promise.all([claimA, claimB]);
assert.deepEqual(claimResults.map((x) => x.status), [0, 0], claimResults.map((x) => x.output).join('\n'));
const claimRows = claimResults.map((x) => {
  const jsonLine = x.output.split(/\r?\n/).find((line) => line.startsWith('[{"saleId"'));
  assert.ok(jsonLine, x.output);
  return JSON.parse(jsonLine)[0];
});
assert.notEqual(claimRows[0].operationId, claimRows[1].operationId, 'concurrent claimers must not lease the same operation');
const lease = claimRows[0];
const otherLogin = `payment_db_test_issuer_${Date.now()}`;
psql(`CREATE ROLE ${otherLogin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT payment_v2_issuer TO ${otherLogin};`);
refused(`SELECT public.fn_payment_v2_renew_open_sale_lease('${lease.operationId}','${lease.leaseId}',${lease.fencingToken})`, 'PAYMENT_V2_OPERATION_LEASE_LOST', otherLogin, 'payment_v2_issuer');
const signature = psql(`SELECT payment_v2.b58(decode(repeat('ab',64),'hex'))`);
refused(`SELECT public.fn_payment_v2_finish_open_sale('${lease.operationId}','${lease.leaseId}',${lease.fencingToken},'send_ack','${signature}')`, 'PAYMENT_V2_OPERATION_LEASE_LOST', otherLogin, 'payment_v2_issuer');
refused(`SELECT public.fn_payment_v2_renew_open_sale_lease('${lease.operationId}','${lease.leaseId}',${lease.fencingToken - 1})`, 'PAYMENT_V2_OPERATION_LEASE_LOST');
refused(`SELECT public.fn_payment_v2_finish_open_sale('${lease.operationId}','${lease.leaseId}',${lease.fencingToken - 1},'send_ack','${signature}')`, 'PAYMENT_V2_OPERATION_LEASE_LOST');
psql(`SELECT public.fn_payment_v2_renew_open_sale_lease('${lease.operationId}','${lease.leaseId}',${lease.fencingToken})`, 'payment_db_test_issuer', 'payment_v2_issuer');
psql(`UPDATE payment_v2.operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${lease.operationId}'`);
refused(`SELECT public.fn_payment_v2_renew_open_sale_lease('${lease.operationId}','${lease.leaseId}',${lease.fencingToken})`, 'PAYMENT_V2_OPERATION_LEASE_LOST');
refused(`SELECT public.fn_payment_v2_finish_open_sale('${lease.operationId}','${lease.leaseId}',${lease.fencingToken},'send_ack','${signature}')`, 'PAYMENT_V2_OPERATION_LEASE_LOST');
psql(`UPDATE payment_v2.operations SET state='unknown',lease_id=NULL,leased_by=NULL,lease_until=NULL WHERE id='${lease.operationId}'`);
const reclaimed = JSON.parse(psql(`SELECT public.fn_payment_v2_claim_open_sale(1)`, 'payment_db_test_issuer', 'payment_v2_issuer'))[0];
assert.equal(reclaimed.operationId, lease.operationId);
assert.equal(reclaimed.fencingToken, lease.fencingToken + 1, 'every claim increments durable fence');
refused(`SELECT public.fn_payment_v2_renew_open_sale_lease('${lease.operationId}','${lease.leaseId}',${lease.fencingToken})`, 'PAYMENT_V2_OPERATION_LEASE_LOST');
const nonOpenOperation = psql(`INSERT INTO payment_v2.operations(sale_id,action,payload,payload_digest,expected_revision,ready,state,created_at,available_at) SELECT sale_id,'execute_outcome',payload,payload_digest,expected_revision,true,'pending',clock_timestamp(),clock_timestamp() FROM payment_v2.operations WHERE id='${baseOperation}' RETURNING id`);
refused(`SELECT public.fn_payment_v2_renew_open_sale_lease('${nonOpenOperation}','${reclaimed.leaseId}',${reclaimed.fencingToken})`, 'PAYMENT_V2_OPERATION_LEASE_LOST');
psql(`SELECT public.fn_payment_v2_finish_open_sale('${lease.operationId}','${reclaimed.leaseId}',${reclaimed.fencingToken},'send_ack','${signature}')`, 'payment_db_test_issuer', 'payment_v2_issuer');
assert.equal(psql(`SELECT o.state||'|'||s.state FROM payment_v2.operations o JOIN payment_v2.sales s ON s.id=o.sale_id WHERE o.id='${lease.operationId}'`), 'submitted|opening', 'send acknowledgement must not mark sale successful');

// A maxed-out fencing token refuses without wrapping or mutating the operation.
psql(`UPDATE payment_v2.operations SET available_at=clock_timestamp()+interval '1 hour' WHERE id='${lease.operationId}'`);
const exhaustedOperation = psql(`INSERT INTO payment_v2.operations(sale_id,action,payload,payload_digest,expected_revision,ready,state,issuer_fencing_token,created_at,available_at) SELECT sale_id,'open_sale',payload,payload_digest,expected_revision,true,'pending',9223372036854775807,clock_timestamp()-interval '1 hour',clock_timestamp() FROM payment_v2.operations WHERE id='${baseOperation}' RETURNING id`);
refused(`SELECT public.fn_payment_v2_claim_open_sale(1)`, 'PAYMENT_V2_ISSUER_FENCE_EXHAUSTED');
assert.equal(psql(`SELECT state||'|'||issuer_fencing_token FROM payment_v2.operations WHERE id='${exhaustedOperation}'`), 'pending|9223372036854775807', 'exhaustion refusal must preserve max token');

// User identity drift is a hard missing-subject refusal; users.id must equal auth_id.
const priorAuthId = psql(`SELECT auth_id::text FROM public.users WHERE id='${seller}'`);
psql(`BEGIN; ALTER TABLE public.users DISABLE TRIGGER users_id_matches_auth; UPDATE public.users SET auth_id=gen_random_uuid() WHERE id='${seller}'; ALTER TABLE public.users ENABLE TRIGGER users_id_matches_auth; COMMIT;`);
refused(`SELECT public.fn_payment_v2_issuer_subject_context('listing','${listing}','${network}')`, 'PAYMENT_V2_ISSUER_SUBJECT_MISSING');
psql(`BEGIN; ALTER TABLE public.users DISABLE TRIGGER users_id_matches_auth; UPDATE public.users SET auth_id='${priorAuthId}' WHERE id='${seller}'; ALTER TABLE public.users ENABLE TRIGGER users_id_matches_auth; COMMIT;`);

// Network duplicate pair is structurally impossible by the migration's existing unique key.
refused(`INSERT INTO payment_v2.networks(id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units) SELECT gen_random_uuid(),genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,false,max_trade_units,max_escrow_units FROM payment_v2.networks WHERE id='${network}'`, 'duplicate key value violates unique constraint', 'supabase_admin', 'payment_v2_owner');

// Owner SQL lifecycle: staged -> active, immutable kid and fingerprint.
const kid = `test-086-${Date.now()}`;
const stagedKid = `${kid}-staged`;
psql(`SET ROLE payment_v2_owner; INSERT INTO payment_v2.issuer_hmac_keys(kid,fingerprint) VALUES('${kid}',sha256(convert_to('${kid}-synthetic-fingerprint','UTF8'))); INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${kid}','staged','test-only staged key'); INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${kid}','activated','test-only activate key'); INSERT INTO payment_v2.issuer_hmac_keys(kid,fingerprint) VALUES('${stagedKid}',sha256(convert_to('${stagedKid}-synthetic-fingerprint','UTF8'))); INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${stagedKid}','staged','test-only staged key'); RESET ROLE;`);
refused(`INSERT INTO payment_v2.issuer_hmac_keys(kid,fingerprint) VALUES('direct-runtime-write',sha256(convert_to('direct-runtime-write','UTF8')))`, 'permission denied', 'payment_db_test_issuer', 'payment_v2_issuer');
refused(`INSERT INTO payment_v2.issuer_hmac_keys(kid,fingerprint) VALUES('${kid}',sha256(convert_to('reuse','UTF8')))`, 'duplicate key value', 'supabase_admin', 'payment_v2_owner');
refused(`INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${stagedKid}','activated','should refuse overlapping active key')`, 'PAYMENT_V2_ISSUER_KEY_LIFECYCLE', 'supabase_admin', 'payment_v2_owner');
refused(`SELECT public.fn_payment_v2_consume_issuer_nonce('${kid}',decode('01','hex'))`, 'PAYMENT_V2_ISSUER_NONCE_MALFORMED');
refused(`SELECT public.fn_payment_v2_consume_issuer_nonce('${stagedKid}',decode('31323334353637383930313233343536','hex'))`, 'PAYMENT_V2_ISSUER_KEY_INACTIVE');
refused(`SELECT public.fn_payment_v2_issuer_enroll_wallet_checked(gen_random_uuid(),gen_random_uuid(),decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'))`, 'PAYMENT_V2_ISSUER_IDENTITY_MISMATCH');
const nonce = '0102030405060708090a0b0c0d0e0f10';
psql(`SELECT public.fn_payment_v2_consume_issuer_nonce('${kid}',decode('${nonce}','hex'))`, 'payment_db_test_issuer', 'payment_v2_issuer');
refused(`SELECT public.fn_payment_v2_consume_issuer_nonce('${kid}',decode('${nonce}','hex'))`, 'PAYMENT_V2_ISSUER_NONCE_REPLAY');
refused(`SELECT public.fn_payment_v2_consume_issuer_nonce('unknown-kid',decode('11111111111111111111111111111111','hex'))`, 'PAYMENT_V2_ISSUER_KEY_INACTIVE');
refused(`SELECT kid FROM payment_v2.issuer_hmac_keys`, 'permission denied');
refused(`SELECT payment_v2.cleanup_issuer_nonces(100)`, 'permission denied', 'payment_db_test_issuer', 'payment_v2_issuer');
assert.equal(psql(`SELECT payment_v2.cleanup_issuer_nonces(100)`), '0', 'cleanup must retain unexpired nonce');

// Concurrent duplicate nonce consumption: one transaction inserts and holds the unique key;
// the second waits, then receives the replay refusal after the first commits.
const concurrentNonce = '1112131415161718191a1b1c1d1e1f20';
isolated();
const opts = '-c payment_v2.test_identity=synthetic-payment-v2-only -c role=payment_v2_issuer';
const start = (sleep) => import('node:child_process').then(({ spawn }) => new Promise((resolve) => {
  isolated();
  const child = spawn('docker', ['exec', '-e', `PGOPTIONS=${opts}`, container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'payment_db_test_issuer', '-d', database, '-c', `BEGIN; SELECT public.fn_payment_v2_consume_issuer_nonce('${kid}',decode('${concurrentNonce}','hex')); SELECT pg_sleep(${sleep}); COMMIT;`], { windowsHide: true });
  let output = ''; child.stdout.on('data', (x) => { output += x; }); child.stderr.on('data', (x) => { output += x; }); child.on('close', (status) => resolve({ status, output }));
}));
const one = await start(1);
await new Promise((resolve) => setTimeout(resolve, 150));
const two = await start(0);
const both = await Promise.all([one, two]);
assert.equal(both.filter((x) => x.status === 0).length, 1, both.map((x) => x.output).join('\n'));
assert.equal(both.filter((x) => x.output.includes('PAYMENT_V2_ISSUER_NONCE_REPLAY')).length, 1, both.map((x) => x.output).join('\n'));

// Retired key cannot consume a nonce; key history is append-only.
psql(`SET ROLE payment_v2_owner; INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${kid}','retired','test-only retire key'); RESET ROLE;`);
refused(`SELECT public.fn_payment_v2_consume_issuer_nonce('${kid}',decode('2122232425262728292a2b2c2d2e2f30','hex'))`, 'PAYMENT_V2_ISSUER_KEY_INACTIVE');
refused(`UPDATE payment_v2.issuer_hmac_key_events SET reason='changed' WHERE kid='${kid}'`, 'PAYMENT_V2_IMMUTABLE', 'supabase_admin', 'payment_v2_owner');
psql(`DROP ROLE ${otherLogin}`);

console.log('T086|PASS|subject nullability/missing/identity, network uniqueness, claim/renew/finish races and refusals, fence exhaustion, nonce replay/concurrency/lifecycle/cleanup');
