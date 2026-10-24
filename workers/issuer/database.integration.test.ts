import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createIssuerDatabase } from './database';
import { handleIssuerRequest } from './service';
import { associatedTokenAddress } from '@/lib/solana/sdk';
import { base58Encode, decodeAddress } from '@/lib/solana/base58';
import { PaymentRpc } from '@/lib/db/payment-v2';
import { IssuerDeps } from './types';
import { createIssuerRateLimiter } from './rate-limit';

const container=process.env.P2C1_DB_CONTAINER;
const database='flexsoar_payment_v2_test';
const migrationFiles=['079_review_approval_is_not_authentication.sql','080_post_079_cleanup.sql','081_revoke_public_set_card_visibility.sql','081b_retire_prelaunch_test_item.sql','082_payment_v2_solo_operator_mode.sql','083_payment_v2_seller_listing_floor.sql','084_payment_v2_wallet_enrollment_and_views.sql','085_payment_v2_executor_action_fence.sql','086_payment_v2_issuer_subject_nonce_leases.sql'];
const fixtureFiles=['00_target_guard.sql','01_fixtures.sql','02_attestation_fixture.sql','03_completion_setup.sql'];
const testLogins=new Set(['payment_db_test_issuer','payment_db_test_verifier','payment_db_test_settler','payment_db_test_executor','payment_db_test_notifier']);
const scratch=mkdtempSync(join(tmpdir(),'p2c1-db-'));
afterAll(()=>rmSync(scratch,{recursive:true,force:true}));

function docker(args:string[],input?:string):string{
  const r=spawnSync('docker',args,{encoding:'utf8',input,windowsHide:true,maxBuffer:8*1024*1024});
  if(r.status!==0)throw new Error(`docker ${args.slice(0,4).join(' ')} failed: ${r.stderr||r.stdout}`);
  return r.stdout.trim();
}
function guarded():void{
  if(!container)throw new Error('P2C1_DB_CONTAINER is required for this opt-in local integration');
  const x=docker(['inspect',container,'--format','{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{json .Mounts}}']);
  if(x!=='none|{}|false|[]')throw new Error(`container isolation guard failed: ${x}`);
  const links=docker(['exec',container,'ip','-o','link']);if((links.match(/^\d+: /gm)||[]).length!==1)throw new Error('container has a non-loopback interface');
}
function psql(sql:string,login='supabase_admin',db=database):string{
  guarded();return docker(['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',login,'-d',db,'-c',sql]);
}
function installFresh078to086():void{
  guarded();
  psqlAdmin(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND pid<>pg_backend_pid()`,'postgres');
  psqlAdmin(`DROP DATABASE IF EXISTS ${database}`,'supabase_admin','postgres');
  psqlAdmin(`CREATE DATABASE ${database} TEMPLATE flexsoar_mig_test_20261021 OWNER postgres`,'supabase_admin','postgres');
  if(psql(`SELECT to_regprocedure('public.fn_payment_v2_reconcile_event(uuid)') IS NOT NULL AND to_regprocedure('public.fn_payment_v2_issuer_subject_context(text,uuid,uuid)') IS NULL`,'postgres')!=='t')throw new Error('source is not a clean 078 database');
  for(const f of migrationFiles){docker(['cp',join(process.cwd(),'supabase','migrations',f),`${container}:/tmp/${f}`]);docker(['exec',container!,'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres','-d',database,'-f',`/tmp/${f}`]);}
  for(const f of fixtureFiles){docker(['cp',join(process.cwd(),'tests','payment-db',f),`${container}:/tmp/${f}`]);}
  docker(['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-v','ON_ERROR_STOP=1','-v','payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY','-h','127.0.0.1','-U','supabase_admin','-d',database,'-f','/tmp/00_target_guard.sql']);
  for(const f of fixtureFiles.slice(1))docker(['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-v','ON_ERROR_STOP=1','-v','payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY','-h','127.0.0.1','-U','supabase_admin','-d',database,'-f',`/tmp/${f}`]);
  const rolesPath=join(process.cwd(),'tests','payment-db','35_workers_setup.sql');
  let roles=readFileSync(rolesPath,'utf8');
  const roleBlock=/DO \$roles\$[\s\S]*?END \$roles\$;\s*COMMIT;/;
  const existingRoles=`DO $roles$ DECLARE r text; login name; BEGIN
 FOREACH r IN ARRAY ARRAY['issuer','verifier','settler','executor','notifier'] LOOP
  login:=('payment_db_test_'||r)::name;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=login AND rolcanlogin AND NOT rolsuper AND NOT rolinherit) OR NOT pg_has_role(login,'payment_v2_'||r,'MEMBER') THEN RAISE EXCEPTION 'dedicated test principal mismatch: %',login; END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA payment_db_workers TO %I,%I',login,'payment_v2_'||r);
  EXECUTE format('GRANT SELECT,UPDATE(f) ON payment_db_workers.cases TO %I', 'payment_v2_'||r);
 END LOOP;
END $roles$;
COMMIT;`;
  roles=roles.replace(roleBlock,existingRoles);if(!roles.includes(existingRoles))throw new Error('could not transform fixture role-creation block');
  const temp=join(scratch,'35_workers_setup.sql');writeFileSync(temp,roles);docker(['cp',temp,`${container}:/tmp/35_workers_setup.sql`]);
  docker(['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-v','ON_ERROR_STOP=1','-v','payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY','-h','127.0.0.1','-U','supabase_admin','-d',database,'-f','/tmp/35_workers_setup.sql']);
}
function psqlAdmin(sql:string,login='supabase_admin',db=database):string{
  guarded();return docker(['exec',container!,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',login,'-d',db,'-c',sql]);
}
function expectIssuerRefusal(sql:string,code:string):void{
  guarded();const r=spawnSync('docker',['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','payment_db_test_issuer','-d',database,'-c',`BEGIN; SET LOCAL ROLE payment_v2_issuer; ${sql}; COMMIT;`],{encoding:'utf8',windowsHide:true});
  expect(r.status,`${r.stdout??''}${r.stderr??''}`).not.toBe(0);expect(`${r.stdout??''}${r.stderr??''}`).toContain(code);
}

const rpcSpecs:Record<string,string[]>={
 fn_payment_v2_consume_issuer_nonce:['text','bytea'],
 fn_payment_v2_issuer_subject_context:['text','uuid','uuid'],
 fn_payment_v2_issuer_enroll_wallet_checked:['uuid','uuid','bytea','bytea','bytea'],
 fn_payment_v2_prepare_sale:['uuid','uuid','jsonb'],
 fn_payment_v2_issuer_context:['uuid','text'],
 fn_payment_v2_record_listing:['uuid','bytea','bytea'],
};
function sqlArg(value:unknown,type:string):string{
  if(value===null)return `NULL::${type}`;
  if(type==='bytea')return `decode('${String(value).replace(/^\\x/,'')}','hex')`;
  const raw=type==='jsonb'?JSON.stringify(value):String(value);
  return `'${raw.replaceAll("'","''")}'::${type}`;
}
class DockerIssuerTransport implements PaymentRpc{
  async rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:{message:string;code?:string}|null}>{
    const types=rpcSpecs[name];if(!types)throw new Error(`integration transport refused unlisted RPC ${name}`);
    const keys={fn_payment_v2_consume_issuer_nonce:['p_kid','p_nonce'],fn_payment_v2_issuer_subject_context:['p_kind','p_subject_id','p_network_id'],fn_payment_v2_issuer_enroll_wallet_checked:['p_user','p_network','p_wallet','p_token_account','p_proof_digest'],fn_payment_v2_prepare_sale:['p_listing_id','p_network_id','p_terms'],fn_payment_v2_issuer_context:['p_sale_id','p_action'],fn_payment_v2_record_listing:['p_sale','p_message','p_signature']}[name]!;
    const argv=keys.map((key,i)=>sqlArg(args[key],types[i]!)).join(',');
    try{
      const out=docker(['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','payment_db_test_issuer','-d',database,'-c',`BEGIN; SET LOCAL ROLE payment_v2_issuer; SELECT public.fn_payment_v2_worker_identity('payment_v2_issuer'); SELECT jsonb_build_object('value',public.${name}(${argv}))::text; COMMIT;`]);
      const lines=out.split(/\r?\n/).filter(Boolean);return {data:JSON.parse(lines.at(-1)??'null').value,error:null};
    }catch(e){return {data:null,error:{code:'PAYMENT_DB_OUTCOME_UNKNOWN',message:e instanceof Error?e.message:'container RPC failed'}};}
  }
}

describe.skipIf(!container)('issuer real-login container integration',()=>{
  it('runs DB negative/retry/race cases and prepare → record-listing plus fake-RPC enrollment through the real login',async()=>{
    installFresh078to086();
    const contract=spawnSync(process.execPath,[join(process.cwd(),'tests','payment-db','086_issuer_contract.mjs'),container!],{encoding:'utf8',windowsHide:true,env:{...process.env,PAYMENT_DB_TARGET:database}});
    if(contract.status!==0)throw new Error(`fresh 086 contract suite failed: ${contract.stdout??''}${contract.stderr??''}`);
    installFresh078to086();
    const ids=JSON.parse(psql(`SELECT f FROM payment_db_workers.cases WHERE name='escrow'`)) as Record<string,string>,seller=ids.seller,listingId=ids.listing,networkId=ids.network;
    const rpc=new DockerIssuerTransport(),db=createIssuerDatabase(rpc),login=docker(['exec','-e','PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only',container!,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','payment_db_test_issuer','-d',database,'-c',"SELECT session_user||'|'||rolsuper::text FROM pg_roles WHERE rolname='payment_db_test_issuer'"]);
    expect(login).toBe('payment_db_test_issuer|false');
    const listing=JSON.parse(await db.subjectContext('listing',listingId,networkId).then(x=>JSON.stringify(x)));
    expect(listing).toMatchObject({found:true,ownerId:seller,ownerAuthId:seller,listingStatus:'public',cardStatus:'active',saleFenced:true});
    const jwtPair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwtPublic=jwtPair.publicKey.export({format:'jwk'}),jwtKid='e3ee4930-ea76-4189-8036-8fa384097de1';
    const jwk={...jwtPublic,kid:jwtKid,alg:'ES256',use:'sig',key_ops:['verify']};
    let now=Math.floor(Date.now()/1000);const kid=`p2c1-${Date.now()}`,hmacKey=Buffer.from('ephemeral-local-integration-only-hmac');
    psqlAdmin(`SET ROLE payment_v2_owner; INSERT INTO payment_v2.issuer_hmac_keys(kid,fingerprint) VALUES('${kid}',sha256(convert_to('${kid}-synthetic-fingerprint','UTF8'))); INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${kid}','staged','local P2c integration fixture'); INSERT INTO payment_v2.issuer_hmac_key_events(kid,event,reason) VALUES('${kid}','activated','local P2c integration fixture'); RESET ROLE;`);
    const sellerKey=generateKeyPairSync('ed25519'),sellerPub=sellerKey.publicKey.export({format:'jwk'}),sellerWalletBytes=Buffer.from(sellerPub.x!,'base64url'),sellerWallet=base58Encode(sellerWalletBytes);
    const mint=String(listing.mint),sellerAta=associatedTokenAddress(sellerWallet,mint),networkGenesis=String(listing.genesis);
    const proofNow=String(now),proofMessage=`FlexSoar wallet enrollment v1\nnetwork:${networkGenesis}\nuser:${seller}\nwallet:${sellerWallet}\nmint:${mint}\ntoken-account:${sellerAta}\nissued-at:${proofNow}`;
    const proofSig=cryptoSign(null,Buffer.from(proofMessage),sellerKey.privateKey),proofDigest=createHash('sha256').update(Buffer.concat([Buffer.from(proofMessage),proofSig])).digest('hex');
    const config={hmacKeys:new Map([[kid,hmacKey]]),activeHmacKid:kid,issuer:'https://issuer.example/auth/v1',audience:'authenticated',jwksUrl:'https://issuer.example/jwks',jwtKid,allowList:new Set([seller]),networkId,networkGenesis,mint,tokenProgram:String(listing.tokenProgram),associatedTokenProgram:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',tokenDecimals:6,program:String(listing.program),networkConfig:String(listing.config),saleAddress:()=>base58Encode(new Uint8Array(32).fill(17)),escrowAddress:()=>base58Encode(new Uint8Array(32).fill(18))};
    const deps:IssuerDeps={db,rpc:[{genesis:async()=>networkGenesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>account(address)},{genesis:async()=>networkGenesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>account(address)}],fx:[{quote:async()=>quote('provider-a','1')},{quote:async()=>quote('provider-b','1')}],jwks:{get:async()=>[jwk]},rateLimiter:createIssuerRateLimiter(),config,nowSeconds:()=>now};
    function account(address:string){const raw=decodeAddress(address);if(address===mint){const data=new Uint8Array(82);data[44]=6;data[45]=1;return {owner:config.tokenProgram,data,contextSlot:BigInt('100')}}const data=new Uint8Array(165);data.set(decodeAddress(mint),0);data.set(sellerWalletBytes,32);data[108]=1;return {owner:config.tokenProgram,data,contextSlot:BigInt('100')}}
    function quote(providerId:string,numerator:string){return {providerId,quoteId:`${providerId}-local`,numerator,denominator:'1',observedAt:new Date(now*1000).toISOString()}}
    function token(claims:Record<string,unknown>):string{const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url'),head=enc({alg:'ES256',kid:jwtKid,typ:'JWT'}),body=enc(claims),input=`${head}.${body}`;return `${input}.${cryptoSign('sha256',Buffer.from(input),{key:jwtPair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`}
    let nonceOrdinal=0;
    function signedRequest(path:string,body:Record<string,unknown>,userId=seller){const raw=Buffer.from(JSON.stringify(body)),nonce=Buffer.alloc(16,++nonceOrdinal).toString('base64url'),stamp=String(now),canonical=`flexsoar-issuer-v1\nPOST\n${path}\n${stamp}\n${nonce}\n${userId}\n${createHash('sha256').update(raw).digest('hex')}`,mac=createHmac('sha256',hmacKey).update(canonical).digest('hex'),access=token({iss:config.issuer,aud:config.audience,role:'authenticated',sub:userId,iat:now-1,exp:now+300});return {req:{method:'POST',path,secure:true,rawBody:raw,headers:{'content-type':'application/json; charset=utf-8','x-flexsoar-kid':kid,'x-flexsoar-timestamp':stamp,'x-flexsoar-nonce':nonce,'x-flexsoar-user':userId,'x-flexsoar-signature':mac,authorization:`Bearer ${access}`}},nonceHex:Buffer.from(nonce,'base64url').toString('hex')}}
    const businessSnapshot=()=>{
      const tables=psql(`SELECT 'payment_v2.'||tablename FROM pg_tables WHERE schemaname='payment_v2' AND tablename<>'issuer_hmac_nonces' UNION ALL SELECT 'public.'||tablename FROM pg_tables WHERE schemaname='public' AND tablename IN('users','listings','cards') ORDER BY 1`).split(/\r?\n/).filter(Boolean);
      const q=tables.map(t=>`SELECT '${t}'||'|'||md5(coalesce(string_agg(to_jsonb(x)::text,E'\\n' ORDER BY to_jsonb(x)::text),'')) FROM ${t} x`).join(' UNION ALL ');
      return psql(q);
    };
    function expectOneNonce(nonceHex:string){expect(psql(`SELECT count(*) FROM payment_v2.issuer_hmac_nonces WHERE kid='${kid}' AND nonce=decode('${nonceHex}','hex')`)).toBe('1')}
    async function refusal(path:string,body:Record<string,unknown>,expected:string){const before=businessSnapshot(),call=signedRequest(path,body),response=await handleIssuerRequest(call.req,deps);expect(response.body.error).toMatchObject({code:expected});expect(businessSnapshot()).toBe(before);expectOneNonce(call.nonceHex);}
    await refusal('/v1/enroll-wallet',{phase:'challenge',networkGenesis:'wrong-network',wallet:sellerWallet},'ISSUER_NETWORK_MISMATCH');
    await refusal('/v1/prepare-sale',{listingId,requestId:'11111111-1111-4111-8111-111111111111'},'ISSUER_LISTING_UNAVAILABLE');
    psqlAdmin(`SET session_replication_role='replica'; UPDATE payment_v2.sales SET fence=false WHERE listing_id='${listingId}'; UPDATE payment_v2.wallet_accounts SET wallet=decode('${sellerWalletBytes.toString('hex')}','hex'),token_account=decode('${Buffer.from(decodeAddress(sellerAta)).toString('hex')}','hex'),proof_digest=decode('${proofDigest}','hex') WHERE user_id='${seller}' AND network_id='${networkId}'; UPDATE public.users SET solana_address='${sellerWallet}' WHERE id='${seller}'; SET session_replication_role='origin';`);
    const requestId='11111111-1111-4111-8111-111111111111';
    let releasePriceRace!:()=>void,priceQuoteStarted!:()=>void;const priceGate=new Promise<void>(resolve=>{releasePriceRace=resolve}),priceStarted=new Promise<void>(resolve=>{priceQuoteStarted=resolve});
    deps.fx=[{quote:async()=>{priceQuoteStarted();await priceGate;return quote('provider-a','1')}},{quote:async()=>quote('provider-b','1')}];
    const priceRequest=signedRequest('/v1/prepare-sale',{listingId,requestId:'22222222-2222-4222-8222-222222222222'}),pricePending=handleIssuerRequest(priceRequest.req,deps);
    await priceStarted;const originalPrice=psql(`SELECT price_cents FROM public.listings WHERE id='${listingId}'`);
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.listings SET price_cents=price_cents+1 WHERE id='${listingId}'; SET session_replication_role='origin';`);const changedPriceSnapshot=businessSnapshot();releasePriceRace();
    const priceRace=await pricePending;expect(priceRace.body.error).toMatchObject({code:'ISSUER_LISTING_STALE'});expect(businessSnapshot()).toBe(changedPriceSnapshot);expectOneNonce(priceRequest.nonceHex);
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.listings SET price_cents=${originalPrice} WHERE id='${listingId}'; SET session_replication_role='origin';`);now+=61;

    let quoteCalls=0,releaseSame!:()=>void,releaseDistinct!:()=>void,resolveSameReady!:()=>void,resolveDistinctReady!:()=>void;
    const sameGate=new Promise<void>(resolve=>{releaseSame=resolve}),distinctGate=new Promise<void>(resolve=>{releaseDistinct=resolve}),sameReady=new Promise<void>(resolve=>{resolveSameReady=resolve}),distinctReady=new Promise<void>(resolve=>{resolveDistinctReady=resolve});
    const gatedQuote=(providerId:string)=>async()=>{const call=++quoteCalls;if(call===4)resolveSameReady();if(call===6)resolveDistinctReady();await (call<=4?sameGate:distinctGate);const rate=call<=2?'1':call<=4?'2':'3';return quote(providerId,rate)};
    deps.fx=[{quote:gatedQuote('provider-a')},{quote:gatedQuote('provider-b')}];
    const sameA=signedRequest('/v1/prepare-sale',{listingId,requestId}),sameB=signedRequest('/v1/prepare-sale',{listingId,requestId});
    const pendingA=handleIssuerRequest(sameA.req,deps),pendingB=handleIssuerRequest(sameB.req,deps);await sameReady;
    const distinct=signedRequest('/v1/prepare-sale',{listingId,requestId:'33333333-3333-4333-8333-333333333333'}),pendingDistinct=handleIssuerRequest(distinct.req,deps);await distinctReady;
    // Both requests have completed both FX reads. Hold their DB writers until
    // both have passed the second recovery read, then serialize the real RPCs:
    // the second call must take SQL's conflicting-idempotency-terms branch.
    let releaseFirstWriter!:()=>void;const firstWriterDone=new Promise<void>(resolve=>{releaseFirstWriter=resolve});
    const actualPrepareSale=db.prepareSale.bind(db);let writerArrivals=0,sqlConflictCount=0;
    let releaseWriters!:()=>void;const bothWritersReady=new Promise<void>(resolve=>{releaseWriters=resolve});
    db.prepareSale=async(...args)=>{
      const arrival=++writerArrivals;if(arrival===2)releaseWriters();await bothWritersReady;
      if(arrival===1){try{return await actualPrepareSale(...args)}finally{releaseFirstWriter()}}
      await firstWriterDone;
      try{return await actualPrepareSale(...args)}catch(error){if(error instanceof Error&&error.message.includes('PAYMENT_V2_SALE_IDEMPOTENCY_CONFLICT'))sqlConflictCount++;throw error}
    };
    releaseSame();const [prepared,prepared2]=await Promise.all([pendingA,pendingB]);
    db.prepareSale=actualPrepareSale;
    expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared2.status,JSON.stringify(prepared2.body)).toBe(200);expect(prepared2.body).toEqual(prepared.body);
    expect(writerArrivals).toBe(2);expect(sqlConflictCount).toBe(1);
    const saleBody=prepared.body as Record<string,unknown>,saleId=String(saleBody.saleId),stored=await db.subjectContext('prepare_recovery',requestId,null);
    expect(stored).toMatchObject({found:true,listingId,saleId});
    expect(saleBody.quote).toMatchObject({totalMicroUsdc:stored.quoteTotalUnits,validFrom:stored.quoteValidFrom,expiresAt:stored.quoteExpiresAt,fxSnapshot:stored.fxSnapshot});
    const fencedSnapshot=businessSnapshot();releaseDistinct();const fenceRace=await pendingDistinct;
    expect(fenceRace.body.error).toMatchObject({code:'ISSUER_LISTING_UNAVAILABLE'});expect(businessSnapshot()).toBe(fencedSnapshot);
    expectOneNonce(sameA.nonceHex);expectOneNonce(sameB.nonceHex);expectOneNonce(distinct.nonceHex);
    console.log(`P2C1D|prepare-same-request|PASS|both-writers-entered|sql-idempotency-conflict=${sqlConflictCount}|responses-equal-stored-snapshot|stored-sale=${saleId}|different-fx-snapshots`);
    console.log('P2C1R8|prepare-price-race|PASS|ISSUER_LISTING_STALE|no-stale-sale-write');
    console.log('P2C1R8|prepare-fence-race|PASS|ISSUER_LISTING_UNAVAILABLE|no-second-sale-write');

    now+=61;deps.fx=[{quote:async()=>{throw new Error('retry must use stored FX snapshot')}},{quote:async()=>{throw new Error('retry must use stored FX snapshot')}}];
    const recoveredCall=signedRequest('/v1/prepare-sale',{listingId,requestId}),recovered=await handleIssuerRequest(recoveredCall.req,deps);
    expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect(recovered.body).toEqual(prepared.body);expectOneNonce(recoveredCall.nonceHex);
    const listingMessage=Buffer.from(String((saleBody.listing as Record<string,unknown>).messageBase64url),'base64url'),badSig={saleId,messageBase64url:listingMessage.toString('base64url'),signatureBase64url:Buffer.alloc(64).toString('base64url')};
    await refusal('/v1/record-listing',badSig,'ISSUER_LISTING_SIGNATURE_INVALID');
    const validSig=cryptoSign(null,listingMessage,sellerKey.privateKey).toString('base64url');
    const signingContext=db.saleSigningContext.bind(db);let markCancelled!:()=>void;const cancelledAtSigningRead=new Promise<void>(resolve=>{markCancelled=resolve});
    db.saleSigningContext=async(id)=>{const value=await signingContext(id);psqlAdmin(`SET session_replication_role='replica'; UPDATE payment_v2.sales SET state='cancel_requested' WHERE id='${id}'; SET session_replication_role='origin';`);markCancelled();return value;};
    const cancelRequest=signedRequest('/v1/record-listing',{saleId,messageBase64url:listingMessage.toString('base64url'),signatureBase64url:validSig}),cancelPending=handleIssuerRequest(cancelRequest.req,deps);
    // The adapter changes state after the first DB read; the service's final reader must stop 083.
    await cancelledAtSigningRead;const cancelledSnapshot=businessSnapshot(),cancelled=await cancelPending;
    expect(cancelled.body.error).toMatchObject({code:'ISSUER_SALE_NOT_OPENING'});expect(businessSnapshot()).toBe(cancelledSnapshot);expectOneNonce(cancelRequest.nonceHex);
    psqlAdmin(`SET session_replication_role='replica'; UPDATE payment_v2.sales SET state='opening' WHERE id='${saleId}'; SET session_replication_role='origin';`);db.saleSigningContext=signingContext;
    console.log('P2C1R8|record-cancel-race|PASS|ISSUER_SALE_NOT_OPENING|no-stale-listing-write');
    const recorded=await handleIssuerRequest(signedRequest('/v1/record-listing',{saleId,messageBase64url:listingMessage.toString('base64url'),signatureBase64url:validSig}).req,deps);
    expect(recorded.status,JSON.stringify(recorded.body)).toBe(200);expect(recorded.body).toMatchObject({saleId,recorded:true});
    const recordedSnapshot=businessSnapshot();await db.recordListing(saleId,listingMessage,new Uint8Array(Buffer.from(validSig,'base64url')));expect(businessSnapshot()).toBe(recordedSnapshot);
    const conflictSignature=Buffer.alloc(64,0x44),conflictBefore=businessSnapshot();
    expectIssuerRefusal(`SELECT public.fn_payment_v2_record_listing('${saleId}',decode('${listingMessage.toString('hex')}','hex'),decode('${conflictSignature.toString('hex')}','hex'))`,'PAYMENT_V2_LISTING_CONFLICT');
    expect(businessSnapshot()).toBe(conflictBefore);console.log('P2C1R8|record-writer-retry|PASS|exact-bytes-idempotent|conflicting-bytes-refused');
    const count=Number(psql(`SELECT count(*) FROM payment_v2.issuer_hmac_nonces WHERE kid='${kid}'`));expect(count).toBe(nonceOrdinal);
    psqlAdmin(`SET session_replication_role='replica'; DELETE FROM payment_v2.wallet_accounts WHERE user_id='${seller}' AND network_id='${networkId}'; SET session_replication_role='origin';`);
    const enrollBody={phase:'complete',networkGenesis,wallet:sellerWallet,mint,tokenAccount:sellerAta,issuedAt:proofNow,signature:proofSig.toString('base64url')};
    const enrolled=await handleIssuerRequest(signedRequest('/v1/enroll-wallet',enrollBody).req,deps);
    expect(enrolled.status,JSON.stringify(enrolled.body)).toBe(200);expect(enrolled.body).toMatchObject({enrolled:true,wallet:sellerWallet,tokenAccount:sellerAta});
    expect(psql(`SELECT count(*) FROM payment_v2.wallet_accounts WHERE user_id='${seller}' AND network_id='${networkId}' AND wallet=decode('${sellerWalletBytes.toString('hex')}','hex') AND proof_digest=decode('${proofDigest}','hex')`)).toBe('1');
    expect(nonceOrdinal).toBe(11);

    const tokenAccountBytes=Buffer.from(decodeAddress(sellerAta)),digestBytes=Buffer.from(proofDigest,'hex');
    const enrollSql=(userId:string,network:string,wallet:Buffer,token:Buffer,digest:Buffer)=>`SELECT public.fn_payment_v2_issuer_enroll_wallet_checked('${userId}','${network}',decode('${wallet.toString('hex')}','hex'),decode('${token.toString('hex')}','hex'),decode('${digest.toString('hex')}','hex'))`;
    const dbRefusal=(sql:string,code:string)=>{const before=businessSnapshot();expectIssuerRefusal(sql,code);expect(businessSnapshot()).toBe(before);};
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.users SET auth_id=NULL WHERE id='${seller}'; SET session_replication_role='origin';`);
    dbRefusal(enrollSql(seller,networkId,sellerWalletBytes,tokenAccountBytes,digestBytes),'PAYMENT_V2_ISSUER_IDENTITY_MISMATCH');
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.users SET auth_id=id WHERE id='${seller}'; SET session_replication_role='origin';`);
    const otherWallet=Buffer.alloc(32,0x33),otherToken=Buffer.alloc(32,0x34),otherProof=Buffer.alloc(32,0x35);
    dbRefusal(enrollSql(seller,networkId,otherWallet,otherToken,otherProof),'PAYMENT_V2_WALLET_ADDRESS_MISMATCH');
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.users SET country_code='US' WHERE id='${seller}'; SET session_replication_role='origin';`);
    dbRefusal(enrollSql(seller,networkId,sellerWalletBytes,otherToken,otherProof),'PAYMENT_V2_WALLET_USER_NOT_MY');
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.users SET country_code='MY' WHERE id='${seller}'; SET session_replication_role='origin';`);
    dbRefusal(enrollSql(seller,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sellerWalletBytes,otherToken,otherProof),'PAYMENT_V2_WALLET_NETWORK_UNKNOWN');
    dbRefusal(enrollSql(seller,networkId,sellerWalletBytes,otherToken,digestBytes),'PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT');
    const buyerAddress=psql(`SELECT coalesce(solana_address,'') FROM public.users WHERE id='${ids.buyer}'`),buyerCountry=psql(`SELECT country_code FROM public.users WHERE id='${ids.buyer}'`);
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.users SET solana_address='${sellerWallet}',country_code='MY' WHERE id='${ids.buyer}'; SET session_replication_role='origin';`);
    dbRefusal(enrollSql(ids.buyer,networkId,sellerWalletBytes,tokenAccountBytes,otherProof),'PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED');
    psqlAdmin(`SET session_replication_role='replica'; UPDATE public.users SET solana_address=${buyerAddress?`'${buyerAddress}'`:'NULL'},country_code='${buyerCountry}' WHERE id='${ids.buyer}'; SET session_replication_role='origin';`);
    const exactRetrySnapshot=businessSnapshot();await db.enrollWalletChecked(seller,networkId,sellerWalletBytes,tokenAccountBytes,digestBytes);expect(businessSnapshot()).toBe(exactRetrySnapshot);
    const changedDigest=digestBytes.slice();changedDigest[0]^=1;
    dbRefusal(enrollSql(seller,networkId,sellerWalletBytes,tokenAccountBytes,changedDigest),'PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT');
    console.log('P2C1R8|enrollment-writer|PASS|auth_id|linked-wallet|non-MY|network|duplicate-wallet|duplicate-token|exact-retry|changed-proof-retry');
  },300000);
});
