/** Explicit synthetic integration in the attested Docker namespace ONLY.
 * Fixture administrator is isolated here; production worker transports never use it.
 * No environment discovery, operational keys, email or public RPC. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,mkdtempSync,readlinkSync,existsSync,statfsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {join} from 'node:path';
import net from 'node:net';
import {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram,AddressLookupTableProgram,SYSVAR_RENT_PUBKEY,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {v2Addresses,buyV2Instruction,discriminator,outcomeInstruction,attestationInstruction} from '../../lib/solana/v2-sdk.ts';
import {encodePermit,decodePermit} from '../../lib/solana/protocol-v2.ts';
import {LocalV2Observer} from '../../lib/solana/v2-observer.ts';
import {base58Encode,base58Decode} from '../../lib/solana/base58.ts';
import {observeAuthorityTransaction} from '../../lib/solana/v2-authority-observer.ts';
import {inspectAuthorityTransaction} from '../../lib/solana/v2-authority-observer.ts';
import {LocalFinalizedRpcSource,SnapshotFinalizedArchiveSource,acquireFinalizedEvidence} from '../../lib/solana/v2-evidence.ts';
import {openSaleInstructionFromContext,decisionInstructionFromContext,claimAcknowledgementInstruction} from '../../lib/solana/v2-context.ts';
import {reconcilePayments} from '../../lib/db/payment-reconciliation.ts';
import {createPaymentPostgresTransport} from '../../lib/db/payment-postgres.ts';
import {preparePaymentSale,authorizePaymentAttempt,recordPaymentLifecycle,recordPaymentAttestation,approvePaymentGovernance,finishPaymentOperation,paymentIssuerContext,paymentVerifierContext,paymentAcknowledgementContext,persistVerifiedPaymentEvidence,recoverCommittedClaimAcknowledgement,paymentWorkerIdentity} from '../../lib/db/payment-v2-workers.ts';
import {initiatePaymentAttempt,ownPaymentAttempts,recordPaymentDecision,paymentRpc,claimPaymentOperations} from '../../lib/db/payment-v2.ts';
import {loadSignedOperation,stageSignedOperation,signedOperationRecovery,inspectSignedOperation} from '../../lib/db/payment-signed-operation.ts';
import {observeSignedOutcome} from '../../lib/solana/v2-operation-observer.ts';

const args=process.argv.slice(2),reviewOnly=args[0]==='--record-expiry-review-isolated-integration',contextOnly=args[0]==='--context-evidence-isolated-integration',observeOnly=args[0]==='--observe-isolated-integration'||reviewOnly,resume=args[0]==='--resume-isolated-integration'||observeOnly||contextOnly;
if(!(args.length===1&&args[0]==='--run-isolated-integration')&&!(resume&&args.length===2&&/^\/state\/integrated-[A-Za-z0-9]+$/.test(args[1])))throw new Error('Explicit integration opt-in required');
const attestation=JSON.parse(readFileSync('/state/integration-host-attestation.json','utf8'));
assert.equal(attestation.containerId,'71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92');
assert.equal(attestation.network,'none');assert.equal(attestation.database,'flexsoar_payment_v2_integration_test');
assert.equal(attestation.namespace,readlinkSync('/proc/self/ns/net'));
assert.deepEqual(readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(s=>s.includes(':')).map(s=>s.split(':')[0].trim()),['lo']);
assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
assert.equal(createHash('sha256').update(readFileSync('/tools/program.so')).digest('hex'),'99aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c');
const disk=statfsSync('/state',{bigint:true});assert.ok(disk.bavail*disk.bsize>=5n*1024n*1024n*1024n,'local retention test requires5GiB free; do not reset/delete another ledger');
for(const port of [18899,18900,18901])await new Promise((ok,bad)=>{const s=net.createServer();s.once('error',bad);s.listen(port,'127.0.0.1',()=>s.close(ok));});
const root=resume?args[1]:mkdtempSync('/state/integrated-'),state=n=>join(root,n),results=resume&&existsSync(state('results.json'))?JSON.parse(readFileSync(state('results.json'),'utf8')):[];
console.log('EVIDENCE',root);
const result=(scenario,details)=>{results.push({scenario,details});writeFileSync(state('results.json'),JSON.stringify(results,null,2));console.log('PASS',scenario,JSON.stringify(details));};
const hash=s=>createHash('sha256').update(s).digest(),uuidHash=id=>hash(Buffer.from(id.replaceAll('-',''),'hex'));
const hex=b=>Buffer.from(b).toString('hex'),b58=b=>new PublicKey(b).toBase58();
// Explicitly retained valueless test identities permit process restart. Never load
// any key outside this newly created, attested integration evidence directory.
const saved=resume?JSON.parse(readFileSync(state('EPHEMERAL-LOCAL-ONLY-keys.json'),'utf8')):null;
const generate=name=>saved?Keypair.fromSecretKey(Uint8Array.from(saved[name])):Keypair.generate();
const bootstrap=generate('bootstrap'),mint=generate('mint'),treasury=generate('treasury'),seller=generate('seller'),buyers=[generate('buyer0'),generate('buyer1')];
const roleNames=['issuer','inventory','receiver','authenticator','reviewer','release','reconciler','guardian'];
const openTemplateBuyer=buyers[0].publicKey;
const roles=Object.fromEntries(roleNames.map(n=>[n,generate(n)])),gov=[generate('governor0'),generate('governor1'),generate('governor2')];
if(!resume)writeFileSync(state('EPHEMERAL-LOCAL-ONLY-keys.json'),JSON.stringify(Object.fromEntries(Object.entries({bootstrap,mint,treasury,seller,buyer0:buyers[0],buyer1:buyers[1],...roles,governor0:gov[0],governor1:gov[1],governor2:gov[2]}).map(([k,v])=>[k,Array.from(v.secretKey)]))),{flag:'wx',mode:0o600});
const program='CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF',token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),ataProgram=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const config=v2Addresses(program,hash('unused'),hash('unused')).config;
const ata=owner=>PublicKey.findProgramAddressSync([owner.toBuffer(),token.toBuffer(),mint.publicKey.toBuffer()],ataProgram)[0];
const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const ix=async(name,keys,...data)=>new TransactionInstruction({programId:new PublicKey(program),keys,data:Buffer.concat([Buffer.from(await discriminator('global:'+name)),...data])});
const rpc='http://127.0.0.1:18899',db='flexsoar_payment_v2_integration_test',connection=new Connection(rpc,'confirmed');
const envFor=login=>({PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:db,PGUSER:login,PGSSLMODE:'disable',PGPASSFILE:'/dev/null'});
function sql(input,login='supabase_admin',vars={}){return execFileSync('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1',...Object.entries(vars).flatMap(([k,v])=>['-v',k+'='+v])],{input,env:envFor(login),encoding:'utf8',maxBuffer:4*1024*1024}).trim();}
// This tiny ordinary-user transport belongs ONLY to the guarded test harness.
// It emulates authenticated request context over a separate restricted LOGIN.
function customer(user){const signatures={fn_payment_v2_initiate:[['p_listing_id','uuid'],['p_idempotency_key','uuid'],['p_policy_version','text'],['p_policy_digest','text']],fn_payment_v2_own_attempts:[['p_listing_id','uuid']],fn_payment_v2_record_decision:[['p_decision','jsonb']],fn_payment_v2_approve_refund:[['p_command_id','uuid']]};return {async rpc(name,args){try{const fields=signatures[name];assert.ok(fields);const parameters=fields.map(([k,t])=>`(:'payload'::jsonb ${t==='jsonb'?'->':'->>'} '${k}')::${t}`);const output=sql(`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub',:'subject',true) IS NOT NULL;SELECT jsonb_build_object('value',public.${name}(${parameters.join(',')}));COMMIT;`,'payment_integration_customer',{subject:user,payload:JSON.stringify(args)});return {data:JSON.parse(output.split('\n').at(-1)).value,error:null};}catch(e){return {data:null,error:{message:e.stderr?.toString()||e.message}};}}};}
const transport=label=>createPaymentPostgresTransport({role:'payment_v2_'+label,login:'payment_integration_'+label,host:'127.0.0.1',port:5432,database:db,sslMode:'disable'});
const issuer=transport('issuer'),verifier=transport('verifier'),settler=transport('settler');
const finalizedSource=new LocalFinalizedRpcSource(rpc,'local-primary');
async function retainAuthorityEvidence(signature,instruction,identity){
 const inspect=(tx,sig)=>inspectAuthorityTransaction(tx,sig,instruction);
 let evidence=await acquireFinalizedEvidence(finalizedSource,null,identity,inspect);
 if(contextOnly&&identity.subjectKind==='lifecycle'&&identity.subjectAction==='opened'&&identity.subjectId===JSON.parse(readFileSync(state('scenario-11.json'),'utf8')).saleId){
  const snapshot={signature,wire:evidence.rpcResult,parsed:evidence.parsedRpcResult,genesis:identity.genesis};
  const archiveFile=state('archive-'+signature+'-'+evidence.transactionDigest+'.json');
  if(existsSync(archiveFile)){const old=JSON.parse(readFileSync(archiveFile,'utf8'));assert.equal(old.wire.transaction[0],evidence.transactionBase64);assert.equal(old.parsed.transaction.signatures[0],signature);}
  else writeFileSync(archiveFile,JSON.stringify(snapshot),{flag:'wx'});
  const archive=new SnapshotFinalizedArchiveSource('archive:local-captured-snapshot',identity.genesis,async sig=>{const item=JSON.parse(readFileSync(archiveFile,'utf8'));return item.signature===sig?{wire:item.wire,parsed:item.parsed}:null;});
  const unavailable={label:'simulated-primary-outage',getGenesisHash:async()=>identity.genesis,getTransaction:async()=>null,getParsedTransaction:async()=>null};
  evidence=await acquireFinalizedEvidence(unavailable,archive,identity,inspect);
  assert.equal(evidence.sourceKind,'archive');result('captured-finalized-evidence-recovered-through-separate-local-archive-adapter',{signature,slot:evidence.slot,simulatedPrimaryOutage:true,ledgerPruned:false});
 }
 const evidenceId=await persistVerifiedPaymentEvidence(verifier,evidence);return {evidence,evidenceId};
}
assert.equal(sql('SELECT current_database()'),db);
if(!resume)writeFileSync(state('validator-config.json'),JSON.stringify({json_rpc_url:rpc,websocket_url:'ws://127.0.0.1:18900',keypair_path:state('unused-wallet-does-not-exist.json'),commitment:'finalized'}),{flag:'wx'});
const log=openSync(state('validator-'+Date.now()+'.log'),'wx');
// Agave's default10000-shred cleanup pruned early ACK history after restarts.
// Explicit test-only retention preserves a longer window; NEVER reconstructs
// already-pruned evidence and is not a production archival-service guarantee.
const child=spawn('/tools/runtime/ld-linux-x86-64.so.2',['--library-path','/tools/runtime','/tools/agave/solana-test-validator','--config',state('validator-config.json'),'--url',rpc,'--mint',bootstrap.publicKey.toBase58(),'--bind-address','127.0.0.1','--rpc-port','18899','--faucet-port','18901','--gossip-port','18902','--dynamic-port-range','19000-19020','--ledger',state('ledger'),'--limit-ledger-size','1000000','--upgradeable-program',program,'/tools/program.so',bootstrap.publicKey.toBase58()],{stdio:['ignore',log,log],env:{...process.env,RAYON_NUM_THREADS:'2'}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function finalizedClockTime(){
 const account=await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY,'finalized');
 if(!account||account.data.length<40||account.owner.toBase58()!=='Sysvar1111111111111111111111111111111111111')throw new Error('finalized Clock sysvar unavailable; refuse to invent chain time');
 const time=Number(account.data.readBigInt64LE(32));
 if(!Number.isSafeInteger(time)||time<0)throw new Error('invalid finalized Clock timestamp');
 return time;
}
async function wait(signature,finality='confirmed'){for(let i=0;i<300;i++){const s=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];if(s&&(s.confirmationStatus===finality||s.confirmationStatus==='finalized')){if(s.err){const tx=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});const e=new Error('CHAIN '+JSON.stringify(s.err)+' '+JSON.stringify(tx?.meta?.logMessages??[]));e.chainError=s.err;throw e;}return s;}await pause(200);}throw new Error('uncertain chain outcome: preserve signature '+signature);}
async function send(instructions,signers=[],tables=[],finality='confirmed',label=null){
 if(label&&existsSync(state(label+'.signed.json'))){const old=JSON.parse(readFileSync(state(label+'.signed.json'),'utf8'));const status=(await connection.getSignatureStatuses([old.signature],{searchTransactionHistory:true})).value[0];if(!status){assert.ok((await connection.isBlockhashValid(old.blockhash,'confirmed')).value,'expired original: no replacement');await connection.sendRawTransaction(Buffer.from(old.bytes,'base64'),{skipPreflight:true});}await wait(old.signature,finality);return old.signature;}
 const validity=await connection.getLatestBlockhash('confirmed');const message=new TransactionMessage({payerKey:bootstrap.publicKey,recentBlockhash:validity.blockhash,instructions}).compileToV0Message(tables);const tx=new VersionedTransaction(message);tx.sign([...new Map([bootstrap,...signers].map(k=>[k.publicKey.toBase58(),k])).values()]);assert.ok(tx.serialize().length<=1232,'LUT needed');
 const signature=base58Encode(tx.signatures[0]),journal=JSON.stringify({signature,bytes:Buffer.from(tx.serialize()).toString('base64'),...validity});
 writeFileSync(state('transaction-'+signature+'.json'),journal,{flag:'wx',mode:0o600});
 if(label)writeFileSync(state(label+'.signed.json'),journal,{flag:'wx',mode:0o600});
 assert.equal(await connection.sendRawTransaction(tx.serialize(),{skipPreflight:true}),signature);await wait(signature,finality);return signature;
}
const balance=async a=>BigInt((await connection.getTokenAccountBalance(a,'confirmed')).value.amount);
async function lookup(addresses){let slot=await connection.getSlot('finalized');while(!slot){await pause(200);slot=await connection.getSlot('finalized');}const [create,address]=AddressLookupTableProgram.createLookupTable({authority:bootstrap.publicKey,payer:bootstrap.publicKey,recentSlot:slot});await send([create]);await send([AddressLookupTableProgram.extendLookupTable({authority:bootstrap.publicKey,payer:bootstrap.publicKey,lookupTable:address,addresses})]);const current=await connection.getSlot();while(await connection.getSlot()<=current)await pause(200);return [(await connection.getAddressLookupTable(address)).value];}
const savedFixture=resume&&existsSync(state('public-fixture.json'))?JSON.parse(readFileSync(state('public-fixture.json'),'utf8')):null;
const people=savedFixture?.people??{},networkId=savedFixture?.networkId??randomUUID();
function person(label,key,role){if(people[label]){assert.equal(people[label].wallet,key.publicKey.toBase58());return;}people[label]={id:randomUUID(),wallet:key.publicKey.toBase58(),...(role?{role}:{}),...(['seller','buyer0','buyer1'].includes(label)?{token:ata(key.publicKey).toBase58()}:{})};}
for(const n of roleNames.filter(n=>n!=='issuer'))person(n,roles[n],n);
gov.forEach((k,i)=>person('governor'+i,k,'governor'));person('seller',seller);buyers.forEach((k,i)=>person('buyer'+i,k));
try{
 let genesis;for(let i=0;i<240;i++){if(child.exitCode!==null)throw new Error('validator exited');try{const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'readiness',method:'getHealth'})});const body=await response.json();if(body.result!=='ok')throw new Error('not healthy');genesis=await connection.getGenesisHash();break;}catch{await pause(500);}}assert.ok(genesis,'healthy validator readiness required');
 if(!existsSync(state('setup-complete'))){
 for(const k of [bootstrap,roles.issuer,roles.inventory])await wait(await connection.requestAirdrop(k.publicKey,10_000_000_000));
 await send([SystemProgram.createAccount({fromPubkey:bootstrap.publicKey,newAccountPubkey:mint.publicKey,lamports:await connection.getMinimumBalanceForRentExemption(82),space:82,programId:token}),new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true)],data:Buffer.concat([Buffer.from([20,6]),bootstrap.publicKey.toBuffer(),Buffer.from([0])])})],[mint]);
 for(const k of [seller,treasury,...buyers])await send([new TransactionInstruction({programId:ataProgram,data:Buffer.from([1]),keys:[meta(bootstrap.publicKey,true,true),meta(ata(k.publicKey),false,true),meta(k.publicKey),meta(mint.publicKey),meta(SystemProgram.programId),meta(token)]})]);
 for(const b of buyers)await send([new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true),meta(ata(b.publicKey),false,true),meta(bootstrap.publicKey,true)],data:Buffer.concat([Buffer.from([7]),u64(10000000)])})]);
 const policy=Buffer.from('834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5','hex');
 const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),programData=PublicKey.findProgramAddressSync([new PublicKey(program).toBuffer()],loader)[0];
 await send([await ix('initialize_v2',[meta(config,false,true),meta(bootstrap.publicKey,true,true),meta(programData),meta(mint.publicKey),meta(SystemProgram.programId)],new PublicKey(genesis).toBuffer(),policy,treasury.publicKey.toBuffer(),Buffer.concat(roleNames.map(n=>roles[n].publicKey.toBuffer())),Buffer.concat(gov.map(g=>g.publicKey.toBuffer())))]);
 const governKeys=[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[1].publicKey,true)];
 await send([await ix('configure',governKeys,Buffer.concat(roleNames.map(n=>roles[n].publicKey.toBuffer())),u64(2000000),u64(10000000))],gov.slice(0,2));await send([await ix('set_pause',governKeys,Buffer.from([0,0]))],gov.slice(0,2));
 const fixture={people,networkId,genesis,program,config:config.toBase58(),mint:mint.publicKey.toBase58(),tokenProgram:token.toBase58(),treasury:treasury.publicKey.toBase58(),treasuryToken:ata(treasury.publicKey).toBase58(),issuer:roles.issuer.publicKey.toBase58()};
 writeFileSync(state('public-fixture.json'),JSON.stringify(fixture,null,2));
 sql(readFileSync('/work/tests/payment-integration/01_signable_fixtures.sql','utf8'),'supabase_admin',{fixture:JSON.stringify(fixture)});
 writeFileSync(state('setup-complete'),'synthetic configuration committed');
 }
 if(savedFixture)assert.equal(genesis,savedFixture.genesis,'never replace an existing integration chain');
 const policy=Buffer.from('834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5','hex');
 const observer=new LocalV2Observer(rpc,program,genesis);
  if(contextOnly&&existsSync(state('scenario-11.json'))&&!existsSync(state('scenario-11-complete'))){
   const f=JSON.parse(readFileSync(state('scenario-11.json'),'utf8'));
   const eventId=sql(`SELECT e.id FROM payment_v2.events e JOIN payment_v2.consumptions c ON c.event_id=e.id WHERE e.sale_id='${f.saleId}' AND e.kind='direct'`);
   assert.match(eventId,/^[0-9a-f-]{36}$/i,'recover only the already committed direct purchase');
   const executor=transport('executor'),notifier=transport('notifier');
   const identities=await Promise.all([
    paymentWorkerIdentity(transport('issuer'),'payment_v2_issuer'),paymentWorkerIdentity(verifier,'payment_v2_verifier'),
    paymentWorkerIdentity(settler,'payment_v2_settler'),paymentWorkerIdentity(executor,'payment_v2_executor'),
    paymentWorkerIdentity(notifier,'payment_v2_notifier'),
   ]);
   assert.equal(new Set(identities).size,5,'each worker must have its own actual login');
   assert.throws(()=>sql(`SELECT public.fn_payment_v2_ack_context('${eventId}'::uuid)`,'payment_integration_issuer'),/permission denied/i,'issuer login cannot borrow settler context');
   assert.throws(()=>sql(`SELECT public.fn_payment_v2_issuer_context('${f.saleId}'::uuid,'open_sale')`,'payment_integration_verifier'),/permission denied/i,'verifier login cannot borrow issuer context');
   assert.throws(()=>sql('UPDATE payment_v2.verified_chain_evidence SET source_label=source_label WHERE false','payment_integration_verifier'),/permission denied/i,'verifier cannot directly mutate retained evidence');
   const outcome=await recoverCommittedClaimAcknowledgement(settler,verifier,eventId);
   assert.ok(outcome.kind==='receipt'||outcome.kind==='reconciled');
   const attempt=JSON.parse(sql(`SELECT jsonb_build_object('buyerId',buyer_id,'id',id) FROM payment_v2.attempts WHERE sale_id='${f.saleId}' AND state='direct'`));
   const visible=await ownPaymentAttempts(customer(attempt.buyerId),f.listingId);
   assert.equal(visible.find(x=>x.id===attempt.id)?.claim,'available','customer status must follow finalized claim reconciliation');
   result(outcome.kind==='reconciled'?'retained-finalized-acknowledgement-consumed-after-lost-lifecycle-response':'committed-acknowledgement-receipt-returned-without-history',{sale:f.saleId,eventId,workerLoginCount:identities.length,claim:'available',chainLookup:'none during recovery'});
   writeFileSync(state('scenario-11-complete'),'retained acknowledgement evidence reconciled without a new payment or chain lookup');
  }
 for(const [index,mode] of (observeOnly?[]:contextOnly?[[11,1],[12,0]]:[[0,1],[1,0],[2,0],[4,1],[5,0],[6,0]])){
  if(existsSync(state('scenario-'+index+'-complete')))continue;
  if(contextOnly&&index===11){
   const file=state('EPHEMERAL-LOCAL-ONLY-context-buyers.json');
   if(!existsSync(file))writeFileSync(file,JSON.stringify([0,1].map(()=>({id:randomUUID(),secret:Array.from(Keypair.generate().secretKey)}))),{flag:'wx',mode:0o600});
   const fresh=JSON.parse(readFileSync(file,'utf8')),publicBuyers=fresh.map((b,i)=>{buyers[i]=Keypair.fromSecretKey(Uint8Array.from(b.secret));const p={id:b.id,wallet:buyers[i].publicKey.toBase58(),token:ata(buyers[i].publicKey).toBase58()};people['buyer'+i]=p;return p;});
   if(sql(`SELECT count(*) FROM public.users WHERE id='${fresh[0].id}'`)==='0')sql(readFileSync('/work/tests/payment-integration/04_additional_buyers.sql','utf8'),'supabase_admin',{fixture:JSON.stringify({networkId,buyers:publicBuyers})});
   for(const [i,b]of buyers.entries()){
    if(!await connection.getAccountInfo(ata(b.publicKey)))await send([new TransactionInstruction({programId:ataProgram,data:Buffer.from([1]),keys:[meta(bootstrap.publicKey,true,true),meta(ata(b.publicKey),false,true),meta(b.publicKey),meta(mint.publicKey),meta(SystemProgram.programId),meta(token)]})],[],[],'confirmed','context-buyer-ata-'+i);
    await send([new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true),meta(ata(b.publicKey),false,true),meta(bootstrap.publicKey,true)],data:Buffer.concat([Buffer.from([7]),u64(10000000)])})],[],[],'confirmed','context-buyer-mint-'+i);
   }
  }
  if(contextOnly&&index===12){
   // The original buyer1 was deliberately relinked in an earlier recovery case.
   // Preserve that binding and use a new synthetic identity for this second slot.
   const file=state('EPHEMERAL-LOCAL-ONLY-context-buyer12.json');
   if(!existsSync(file))writeFileSync(file,JSON.stringify({id:randomUUID(),secret:Array.from(Keypair.generate().secretKey)}),{flag:'wx',mode:0o600});
   const fresh=JSON.parse(readFileSync(file,'utf8')),buyer=Keypair.fromSecretKey(Uint8Array.from(fresh.secret)),p={id:fresh.id,wallet:buyer.publicKey.toBase58(),token:ata(buyer.publicKey).toBase58()};
   buyers[1]=buyer;people.buyer1=p;
   if(sql(`SELECT count(*) FROM public.users WHERE id='${fresh.id}'`)==='0')sql(readFileSync('/work/tests/payment-integration/04_additional_buyers.sql','utf8'),'supabase_admin',{fixture:JSON.stringify({networkId,buyers:[p]})});
   if(!await connection.getAccountInfo(ata(buyer.publicKey)))await send([new TransactionInstruction({programId:ataProgram,data:Buffer.from([1]),keys:[meta(bootstrap.publicKey,true,true),meta(ata(buyer.publicKey),false,true),meta(buyer.publicKey),meta(mint.publicKey),meta(SystemProgram.programId),meta(token)]})],[],[],'confirmed','context-buyer12-ata');
   if(await balance(ata(buyer.publicKey))<1000000n)await send([new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true),meta(ata(buyer.publicKey),false,true),meta(bootstrap.publicKey,true)],data:Buffer.concat([Buffer.from([7]),u64(10000000)])})],[],[],'confirmed','context-buyer12-mint');
  }
  if(index>=5&&!contextOnly){
   const file=state('EPHEMERAL-LOCAL-ONLY-additional-buyers.json');
   if(!existsSync(file))writeFileSync(file,JSON.stringify([0,1].map(()=>({id:randomUUID(),secret:Array.from(Keypair.generate().secretKey)}))),{flag:'wx',mode:0o600});
   const next=JSON.parse(readFileSync(file,'utf8')),publicBuyers=next.map((b,i)=>{buyers[i]=Keypair.fromSecretKey(Uint8Array.from(b.secret));const p={id:b.id,wallet:buyers[i].publicKey.toBase58(),token:ata(buyers[i].publicKey).toBase58()};people['buyer'+i]=p;return p;});
   if(sql(`SELECT count(*) FROM public.users WHERE id='${next[0].id}'`)==='0')sql(readFileSync('/work/tests/payment-integration/04_additional_buyers.sql','utf8'),'supabase_admin',{fixture:JSON.stringify({networkId,buyers:publicBuyers})});
   for(const [i,b]of buyers.entries()){
    if(!await connection.getAccountInfo(ata(b.publicKey)))await send([new TransactionInstruction({programId:ataProgram,data:Buffer.from([1]),keys:[meta(bootstrap.publicKey,true,true),meta(ata(b.publicKey),false,true),meta(b.publicKey),meta(mint.publicKey),meta(SystemProgram.programId),meta(token)]})],[],[],'confirmed','additional-ata-'+i);
    await send([new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true),meta(ata(b.publicKey),false,true),meta(bootstrap.publicKey,true)],data:Buffer.concat([Buffer.from([7]),u64(10000000)])})],[],[],'confirmed','additional-mint-'+i);
   }
  }
  const path=state('scenario-'+index+'.json');
  const chainNow=await finalizedClockTime();assert.ok(Number.isSafeInteger(chainNow));
  const f=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{sellerId:people.seller.id,modelId:randomUUID(),skuId:randomUUID(),itemId:randomUUID(),cardId:randomUUID(),listingId:randomUUID(),saleId:randomUUID(),mode,inventoryStaff:people.inventory.id,reviewerStaff:people.reviewer.id,now:String(chainNow),idempotency:[randomUUID(),randomUUID()]};
  if(!existsSync(path))writeFileSync(path,JSON.stringify(f));
  if(sql(`SELECT count(*) FROM public.cards WHERE id='${f.cardId}'`)==='0')sql(readFileSync('/work/tests/payment-integration/02_inventory_fixture.sql','utf8'),'supabase_admin',{fixture:JSON.stringify(f)});
  const card=uuidHash(f.cardId),pair=uuidHash(f.itemId),saleId=uuidHash(f.saleId),a=v2Addresses(program,card,saleId),now=BigInt(f.now),expires=BigInt(Math.floor(Date.now()/1000))+(index===4?BigInt(90):BigInt(3600));
  const storedQuote=sql(`SELECT jsonb_build_object('validFrom',valid_from::text,'expiresAt',expires_at::text) FROM payment_v2.quote_books WHERE sale_id='${f.saleId}' ORDER BY created_at DESC,id DESC LIMIT 1`);
  const quote=storedQuote?JSON.parse(storedQuote):{validFrom:String(now-30n),expiresAt:String(expires)};
  const terms={id:f.saleId,saleAddress:a.sale.toBase58(),escrowAddress:a.escrow.toBase58(),totalUnits:'1000000',fxSnapshot:{myrSen:2000,usdcBaseUnits:'1000000',source:'isolated-local'},validFrom:quote.validFrom,expiresAt:quote.expiresAt};
  await preparePaymentSale(issuer,f.listingId,networkId,terms);
  // Open template's sale-wide fields equal the prepared immutable sale. Buyer and
  // attempt are not authorizations until the canonical DB permit is issued later.
  if(!await connection.getAccountInfo(a.card)){
   assert.ok(!existsSync(state('blocked-inventory-'+index+'.json')),'original inventory registration outcome uncertain; no replacement signature authorized');
   await send([await ix('register_card',[meta(config),meta(a.card,false,true),meta(roles.inventory.publicKey,true,true),meta(roles.authenticator.publicKey,true),meta(SystemProgram.programId)],card,pair,seller.publicKey.toBuffer(),Buffer.from([mode]))],[roles.inventory,roles.authenticator],[],'confirmed','register-'+index);
  }
  const tables=await lookup([config,a.card,a.sale,a.escrow,mint.publicKey,...[seller,treasury,...buyers].map(k=>ata(k.publicKey)),token,SystemProgram.programId,SYSVAR_RENT_PUBKEY]);
  const openingPersisted=sql(`SELECT count(*) FROM payment_v2.lifecycle_evidence WHERE sale_id='${f.saleId}' AND kind='opened'`)==='1';
  if(!openingPersisted){
   const openContext=await paymentIssuerContext(issuer,f.saleId,'open_sale');assert.equal(openContext.actor,roles.issuer.publicKey.toBase58());
   const opening=await openSaleInstructionFromContext(openContext);
   const opened=await send([opening],[roles.issuer],tables,'finalized','open-'+index);
   const observed=await retainAuthorityEvidence(opened,opening,{networkId:openContext.networkId,genesis:openContext.genesis,program:openContext.program,signature:opened,subjectKind:'lifecycle',subjectId:f.saleId,subjectAction:'opened'});
   await recordPaymentLifecycle(verifier,{saleId:f.saleId,kind:'opened',finality:'finalized',sale:openContext.sale,genesis:openContext.genesis,program:openContext.program,generation:openContext.generation,revision:openContext.revision,signature:opened,slot:observed.evidence.slot,executedAtSeconds:String(observed.evidence.blockTime),evidenceId:observed.evidenceId});
  }
  const attempts=await Promise.all(buyers.map((_,i)=>initiatePaymentAttempt(customer(people['buyer'+i].id),f.listingId,f.idempotency[i])));
  const permits=await Promise.all(attempts.map(async at=>decodePermit(Buffer.from(await authorizePaymentAttempt(issuer,at.id),'hex'))));
  const openedSnapshot=(await observer.scan()).find(x=>x.address===a.sale.toBase58());assert.ok(openedSnapshot,'sale must be observed from finalized program state');
  const boundKeys=['domain','program','config','saleId','card','pair','policy','seller','treasury','mint','tokenProgram','sellerToken','treasuryToken'];
  const sameSaleMismatch=permits.map((permit,index)=>boundKeys.filter(field=>Buffer.from(permit[field]).compare(Buffer.from(openedSnapshot.permit[field]))!==0).map(field=>({field,buyIndex:index}))).flat();
  const chainTime=await finalizedClockTime();
  const permitTiming=permits.map((permit,buyIndex)=>({buyIndex,validFrom:String(permit.validFrom),expiresAt:String(permit.expiresAt),chainTime,fee:String(permit.fee),net:String(permit.net),total:String(permit.total),mode:permit.mode,generation:String(permit.generation),revision:String(permit.revision),custodyVersion:String(permit.custodyVersion),authorityEpoch:String(permit.authorityEpoch)}));
  if(!f.balances){f.balances={buyers:await Promise.all(buyers.map(async b=>String(await balance(ata(b.publicKey))))),seller:String(await balance(ata(seller.publicKey))),treasury:String(await balance(ata(treasury.publicKey)))};writeFileSync(path,JSON.stringify(f));}
  const before=f.balances.buyers.map(BigInt),sb=BigInt(f.balances.seller),tb=BigInt(f.balances.treasury);
  const raced=await Promise.allSettled(permits.map(async(q,i)=>send([await buyV2Instruction(q)],[roles.issuer,buyers[i]],tables,'finalized','buy-'+index+'-'+i)));
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1,JSON.stringify({sameSaleMismatch,permitTiming,outcomes:raced.map(r=>r.status==='rejected'?{message:r.reason?.message,chainError:r.reason?.chainError}:{status:'finalized'})}));const winner=raced.findIndex(r=>r.status==='fulfilled'),loser=1-winner;
  assert.ok(raced[loser].reason.chainError,'loser must fail on-chain, not transport');
  assert.equal(before[loser],await balance(ata(buyers[loser].publicKey)));assert.equal(before[winner]-await balance(ata(buyers[winner].publicKey)),1000000n);
  const q=permits[winner],at=attempts[winner];
  if(index===4&&!existsSync(state('crash-after-funding'))){writeFileSync(state('crash-after-funding'),raced[winner].value);console.log('Waiting for original quote expiry before recovery restart');while(BigInt(Math.floor(Date.now()/1000))<=expires)await pause(500);throw new Error('INJECTED process stop after finalized funding, before database settlement; resume this exact run');}
  const lostSettler={async rpc(name,args){const response=await settler.rpc(name,args);if(index===4&&name==='fn_payment_v2_reconcile_event'&&!response.error&&!existsSync(state('lost-settlement-response'))){writeFileSync(state('lost-settlement-response'),JSON.stringify(response.data));throw new Error('INJECTED actual database commit response lost');}return response;}};
  let recovery=await reconcilePayments(verifier,observer,20,lostSettler);
  if(index===4&&recovery.failed.length){assert.equal(recovery.failed.length,1);assert.match(recovery.failed[0].error,/INJECTED actual database commit response lost/);recovery=await reconcilePayments(transport('verifier'),observer,20,transport('settler'));result('database-commit-response-loss-recovered',{sale:f.saleId});}
  assert.deepEqual(recovery.failed,[]);assert.ok([0,1].includes(recovery.processed));
  const status=async()=> (await ownPaymentAttempts(customer(people['buyer'+winner].id),f.listingId)).find(x=>x.id===at.id);
   let s=await status();const terminalEscrow=['released','refunded'].includes(s.funding),previouslyAcknowledged=sql(`SELECT count(*) FROM payment_v2.lifecycle_evidence WHERE sale_id='${f.saleId}' AND kind='acknowledged'`)==='1';
   if(mode)assert.equal(s.funding,'direct');else assert.ok(s.funding==='funded'||terminalEscrow,'unexpected escrow state');
   assert.equal(s.claim,previouslyAcknowledged?(s.funding==='refunded'?'quarantined':'available'):mode||s.funding==='released'?'unreconciled':s.funding==='refunded'?'quarantined':'pending_vault');
  assert.equal(sql(`SELECT count(*) FROM public.orders WHERE payment_v2_attempt_id='${at.id}'`),'1');
  assert.equal(sql(`SELECT sum(units) FROM payment_v2.usdc_journal j JOIN payment_v2.events e ON e.id=j.event_id WHERE e.attempt_id='${at.id}'`),'0');
  assert.equal(sql(`SELECT owner_id FROM public.cards WHERE id='${f.cardId}'`),people['buyer'+winner].id);
  assert.equal((await reconcilePayments(verifier,observer,20,settler)).processed,0);
  result(mode?'direct-funded-and-reconciled':'escrow-funded-and-reconciled',{index,sale:f.saleId,attempt:at.id,signature:raced[winner].value,loserPrincipalDebit:'0',claim:s.claim});
   if(mode){assert.equal(await balance(ata(seller.publicKey))-sb,950000n);assert.equal(await balance(ata(treasury.publicKey))-tb,50000n);}
   else if(s.funding==='funded'){assert.equal(await balance(a.escrow),1000000n);assert.equal(await balance(ata(seller.publicKey)),sb);assert.equal(await balance(ata(treasury.publicKey)),tb);}
   else if(s.funding==='released'){assert.equal(await balance(a.escrow),0n);assert.equal(await balance(ata(seller.publicKey))-sb,950000n);assert.equal(await balance(ata(treasury.publicKey))-tb,50000n);}
   else {assert.equal(await balance(a.escrow),0n);assert.equal(await balance(ata(buyers[winner].publicKey)),before[winner]);assert.equal(await balance(ata(seller.publicKey)),sb);assert.equal(await balance(ata(treasury.publicKey)),tb);}
  // Continue only with outcomes supported by reviewed immutable authority context.
  writeFileSync(state('pending-scenario-'+index+'.json'),JSON.stringify({fixture:f,winner,attempt:at.id,permitHex:hex(encodePermit(q)),sale:a.sale.toBase58()},null,2));
  async function decision(action,actor,revision){
   const escrowId=sql(`SELECT id FROM payment_v2.escrows WHERE sale_id='${f.saleId}'`);
   const dfile=state('decision-'+index+'-'+action+'.json');
   const d=existsSync(dfile)?JSON.parse(readFileSync(dfile,'utf8')):{escrowId,commandId:randomUUID(),expectedRevision:String(revision),action,evidenceDigest:hex(hash('synthetic-exact-pair-evidence:'+f.itemId+':'+action)),pairCommitment:hex(pair),...(action==='refund'?{refundReason:'approved_loss'}:{})};
   if(!existsSync(dfile))writeFileSync(dfile,JSON.stringify(d));
   await recordPaymentDecision(customer(people[actor].id),d);
   if(action==='refund')await approvePaymentGovernance(customer(people.governor1.id),d.commandId);
   const context=await paymentVerifierContext(verifier,'decision',d.commandId),derived=await decisionInstructionFromContext(context);
   const keys=[...Object.values(roles),...gov],signers=derived.actors.map(pubkey=>{const found=keys.find(k=>k.publicKey.toBase58()===pubkey);assert.ok(found,'trusted context actor must have its distinct ephemeral test signer');return found;});
   const instruction=derived.instruction;
   const signature=await send([instruction],signers,[],'finalized','attestation-'+index+'-'+action);
   const retained=await retainAuthorityEvidence(signature,instruction,{networkId:context.networkId,genesis:context.genesis,program:context.program,signature,subjectKind:'attestation',subjectId:d.commandId,subjectAction:context.action});
   await recordPaymentAttestation(verifier,{commandId:context.decisionId,finality:'finalized',sale:context.sale,genesis:context.genesis,program:context.program,action:context.action,evidenceDigest:hex(base58Decode(context.evidenceDigest)),pairCommitment:hex(base58Decode(context.pairCommitment)),actor:signers[0].publicKey.toBase58(),resultingRevision:context.resultingRevision,signature,slot:retained.evidence.slot,executedAtSeconds:String(retained.evidence.blockTime),evidenceId:retained.evidenceId});
  }
  if(!mode&&!terminalEscrow){
   if(index===1||index===12){
    await decision('receipt','receiver',0);
    assert.equal((await status()).authentication,'pending');assert.equal((await status()).claim,'pending_vault');assert.equal(await balance(a.escrow),1000000n);
    result('receipt-alone-does-not-authenticate-or-release',{sale:f.saleId});
    await decision('authentication_pass','authenticator',0);
    assert.equal((await status()).authentication,'pass');assert.equal((await status()).claim,'pending_vault');assert.equal(await balance(a.escrow),1000000n);
    result('authentication-alone-does-not-release',{sale:f.saleId});
    await decision('release','release',0);
   }else await decision('refund','governor0',0);
   // Exact execute_outcome plan comes from the real leased database operation.
   const executor=transport('executor'),opfile=state('outcome-operation-'+index+'.json');
   let operation;
   if(existsSync(opfile))operation=JSON.parse(readFileSync(opfile,'utf8'));
   else{operation=(await claimPaymentOperations(executor,randomUUID())).find(o=>o.action==='execute_outcome'&&o.payload.saleId===f.saleId);assert.ok(operation,'bounded outcome operation exists');writeFileSync(opfile,JSON.stringify(operation));}
   const current=await loadSignedOperation(executor,operation.id,operation.leaseId);
   let envelope=current.envelope;
   if(!envelope){
    const intent=current.plan.instruction,validity=await connection.getLatestBlockhash('confirmed');
    const instruction=new TransactionInstruction({programId:new PublicKey(intent.programId),data:Buffer.from(intent.dataBase64,'base64'),keys:intent.accounts.map(k=>({...k,pubkey:new PublicKey(k.pubkey)}))});
    const tx=new VersionedTransaction(new TransactionMessage({payerKey:bootstrap.publicKey,recentBlockhash:validity.blockhash,instructions:[instruction]}).compileToV0Message());tx.sign([bootstrap]);
    const raw=Buffer.from(tx.serialize()),message=tx.message.serialize();
    envelope={plan:current.plan,transactionBase64:raw.toString('base64'),transactionDigest:hex(hash(raw)),messageDigest:hex(hash(message)),signature:base58Encode(tx.signatures[0]),blockhash:validity.blockhash,lastValidBlockHeight:String(validity.lastValidBlockHeight)};
    assert.equal(sql(`SELECT count(*) FROM payment_v2.signed_operations WHERE operation_id='${operation.id}'`),'0');
    // Actual database persistence commits; deliberately discard its response.
    const lostResponse={async rpc(name,args){const response=await executor.rpc(name,args);if(name==='fn_payment_v2_stage_signed_operation'&&!response.error)throw new Error('INJECTED persisted response lost');return response;}};
    await assert.rejects(stageSignedOperation(lostResponse,operation.id,operation.leaseId,envelope),/INJECTED persisted response lost/);
    envelope=(await loadSignedOperation(executor,operation.id,operation.leaseId)).envelope;
    assert.ok(envelope);result('signed-envelope-commit-lost-response-recovered',{operation:operation.id,signature:envelope.signature});
   }
   if(index===6){
    // Real five-minute expiry, not an UPDATE to lease timestamps. Retain a
    // funded obligation and deliberately do NOT broadcast this signed outcome.
    const until=Date.parse(sql(`SELECT lease_until FROM payment_v2.operations WHERE id='${operation.id}'`));
    assert.ok(Number.isFinite(until));console.log('Waiting for actual operation lease expiry; signed outcome will remain unbroadcast');
    while(Date.now()<=until+1000)await pause(500);
    const takeover=createPaymentPostgresTransport({role:'payment_v2_executor',login:'payment_integration_executor_b',host:'127.0.0.1',port:5432,database:db,sslMode:'disable'});
    const next=(await claimPaymentOperations(takeover,randomUUID())).find(o=>o.id===operation.id);assert.ok(next);assert.notEqual(next.leaseId,operation.leaseId);assert.equal(next.signature,envelope.signature);assert.equal(next.recoveryOnly,true);
    const retained=await loadSignedOperation(takeover,next.id,next.leaseId);assert.deepEqual(retained.envelope,envelope);
    await assert.rejects(finishPaymentOperation(executor,operation,'unknown',envelope.signature,'stale after takeover'),/PAYMENT_V2_OPERATION_LEASE_LOST/);
    const observation=await observeSignedOutcome(rpc,current.plan,envelope),decision=signedOperationRecovery(envelope,current.plan,observation);
    assert.equal(observation.signatureState,'not_found');assert.equal(observation.saleState,'funded');assert.equal(observation.blockhashValid,false);assert.equal(decision.kind,'blocked');assert.match(decision.reason,/expired or invalid original/);
    await finishPaymentOperation(takeover,next,'unknown',envelope.signature,'REVIEW_REQUIRED: '+decision.reason+'; original signature retained; do not sign a replacement or pay again');
    assert.equal((await status()).claim,'pending_vault');assert.equal(await balance(a.escrow),1000000n);assert.equal(await balance(ata(buyers[winner].publicKey)),before[winner]-1000000n);
    result('actual-lease-takeover-expired-envelope-blocked',{operation:operation.id,signature:envelope.signature,claim:'pending_vault',classification:'explicit fail-closed funded obligation; no replacement or refund executed'});
    writeFileSync(state('scenario-'+index+'-complete'),'fail-closed expiry/lease scenario completed; NOT a terminal financial settlement');continue;
   }
   // The original signed bytes, not a replacement transaction, survive restart.
   let recoveryDecision;
   for(let tries=0;tries<150;tries++){
    try{const observation=await observeSignedOutcome(rpc,current.plan,envelope);recoveryDecision=signedOperationRecovery(envelope,current.plan,observation);
     if(recoveryDecision.kind==='blocked'&&recoveryDecision.reason==='expired or invalid original transaction: no automatic replacement'&&Number(observation.blockHeight)<=Number(envelope.lastValidBlockHeight)){await pause(200);continue;}break;
    }catch(e){if(!/newer than observed account context/.test(e.message))throw e;await pause(200);}
   }
   assert.ok(recoveryDecision);assert.notEqual(recoveryDecision.kind,'blocked','uncertain/expired operations must stop, never replace');
   if(recoveryDecision.kind==='retransmit_identical')await connection.sendRawTransaction(recoveryDecision.bytes,{skipPreflight:true});/* deliberately discard returned signature */
   await wait(envelope.signature,'finalized');
   const noBookkeeping=await status();assert.equal(noBookkeeping.funding,'funded');
   result('outcome-finalized-before-bookkeeping',{sale:f.saleId,signature:envelope.signature,originalBytesDigest:envelope.transactionDigest});
   const reconciled=await reconcilePayments(verifier,observer,20,settler);assert.deepEqual(reconciled.failed,[]);
   s=await status();assert.equal(s.funding,index===1||index===12?'released':'refunded');assert.equal(s.claim,index===1||index===12?'unreconciled':'quarantined');
   if(index===1||index===12){assert.equal(await balance(ata(seller.publicKey))-sb,950000n);assert.equal(await balance(ata(treasury.publicKey))-tb,50000n);}
   else{assert.equal(await balance(ata(buyers[winner].publicKey)),before[winner]);assert.equal(await balance(ata(seller.publicKey)),sb);assert.equal(await balance(ata(treasury.publicKey)),tb);}
   // Stale terminal execution must fail on-chain, with no second principal move.
    await assert.rejects(send([await outcomeInstruction(program,q,1n)],[],[],'finalized','stale-terminal-'+index),e=>!!e.chainError);
   result(index===1||index===12?'escrow-release-reconciled':'full-principal-refund-reconciled',{sale:f.saleId,claim:s.claim});
  }
  // Digest derives from an ACTUAL committed consumption returned through the
  // dedicated settler, not a simulated commit marker or client-provided digest.
   const eventId=sql(`SELECT e.id FROM payment_v2.events e WHERE e.attempt_id='${at.id}' AND kind='${mode?'direct':[1,12].includes(index)?'released':'refunded'}'`);
  const committed=await paymentRpc(settler,'fn_payment_v2_reconcile_event',{p_event_id:eventId});
  assert.equal(committed.attemptId,at.id);assert.equal(committed.saleId,f.saleId);assert.equal(committed.eventId,eventId);
   const ackContext=await paymentAcknowledgementContext(settler,eventId);assert.equal(ackContext.orderId,committed.orderId);assert.equal(ackContext.eventId,eventId);
   if(previouslyAcknowledged){
    assert.equal(ackContext.receipt.saleId,f.saleId);assert.equal(ackContext.receipt.outcome,ackContext.kind);assert.equal((await status()).claim,ackContext.kind==='refunded'?'quarantined':'available');
    result('committed-acknowledgement-receipt-returned-without-new-chain-observation',{sale:f.saleId,eventId,signature:ackContext.receipt.signature,claim:(await status()).claim});
    writeFileSync(state('scenario-'+index+'-complete'),'committed ACK receipt returned; lifecycle already reconciled');continue;
   }
  const ack=await claimAcknowledgementInstruction(ackContext);assert.deepEqual(ackContext.actors,[roles.reconciler.publicKey.toBase58()]);
  const ackSignature=await send([ack],[roles.reconciler],[],'finalized','ack-'+index);
  const control=await connection.getAccountInfo(a.card,'finalized');assert.equal(control.data[153],1);
   assert.equal((await status()).claim,mode||index===1||index===12?'unreconciled':'quarantined','chain ack alone does not unlock DB');
  if(index===4&&!existsSync(state('crash-after-ack'))){
   const replacement=Keypair.generate().publicKey.toBase58();
   sql(`UPDATE public.users SET solana_address=:'replacement' WHERE id=:'buyer'::uuid`,'supabase_admin',{replacement,buyer:people['buyer'+winner].id});
   assert.equal((await status()).claim,'unreconciled');
   writeFileSync(state('crash-after-ack'),JSON.stringify({ackSignature,replacement}));throw new Error('INJECTED process stop after finalized acknowledgement and synthetic wallet relink, before lifecycle database commit; resume this exact run');
  }
  const ackEvidence=await retainAuthorityEvidence(ackSignature,ack,{networkId:ackContext.networkId,genesis:ackContext.genesis,program:ackContext.program,signature:ackSignature,subjectKind:'lifecycle',subjectId:f.saleId,subjectAction:'acknowledged'});
  await recordPaymentLifecycle(verifier,{saleId:ackContext.saleId,kind:'acknowledged',finality:'finalized',sale:ackContext.sale,genesis:ackContext.genesis,program:ackContext.program,generation:ackContext.generation,revision:ackContext.revision,outcome:ackContext.kind==='direct'?'direct':ackContext.kind==='released'?'released':'refunded',cardCommitment:hex(base58Decode(ackContext.cardCommitment)),signature:ackSignature,slot:ackEvidence.evidence.slot,executedAtSeconds:String(ackEvidence.evidence.blockTime),evidenceId:ackEvidence.evidenceId});
  assert.equal((await status()).claim,mode||index===1||index===12?'available':'quarantined');
  result('finalized-claim-acknowledged',{sale:f.saleId,signature:ackSignature,claim:(await status()).claim,actualConsumption:committed});
  const receiptAgain=await paymentAcknowledgementContext(settler,eventId);assert.equal(receiptAgain.receipt.signature,ackSignature);result('committed-acknowledgement-receipt-returned-without-new-chain-observation',{sale:f.saleId,signature:receiptAgain.receipt.signature});
  writeFileSync(state('scenario-'+index+'-complete'),'actual integrated assertions completed');
 }
 // Read-only audit of persisted terminal envelopes after process restart. The
 // fixture administrator reads audit rows only here; no worker claims that this
 // bypasses lease authorization. The actual production observer/policy is used.
  for(const index of (contextOnly?[]:[1,2])){
  const operation=JSON.parse(readFileSync(state('outcome-operation-'+index+'.json'),'utf8'));
  const raw=JSON.parse(sql(`SELECT envelope FROM payment_v2.signed_operations WHERE operation_id='${operation.id}'`));
  const envelope=inspectSignedOperation(raw,raw.plan),observation=await observeSignedOutcome(rpc,envelope.plan,envelope);
  assert.equal(signedOperationRecovery(envelope,envelope.plan,observation).kind,'reconcile');
  const snapshot=(await observer.scan()).find(s=>s.address===envelope.plan.instruction.accounts[1].pubkey);assert.ok(snapshot);
  const refund=index===1,signers=refund?gov.slice(0,2):[roles.release];
  const contrary=await attestationInstruction(program,config.toBase58(),snapshot.address,signers.map(k=>k.publicKey.toBase58()),refund?'authorize_refund':'authorize_release',
   {sale:new PublicKey(snapshot.address).toBytes(),attempt:snapshot.permit.attempt,pair:snapshot.permit.pair,evidence:hash('terminal-contradiction-'+index),revision:snapshot.decisionRevision,action:refund?4:3});
  await assert.rejects(send([contrary],signers,[],'confirmed','terminal-contrary-'+index),e=>!!e.chainError);
  result('opposite-terminal-authorization-rejected-on-chain',{sale:snapshot.address,attempted:refund?'refund_after_release':'release_after_refund'});
  await assert.rejects(finishPaymentOperation(transport('executor'),operation,'unknown',envelope.signature,'stale process must not complete observed operation'),/PAYMENT_V2_OPERATION_LEASE_LOST/);
  result('observed-operation-stale-worker-rejected',{operation:operation.id});
  result('terminal-original-envelope-recovery',{operation:operation.id,signature:envelope.signature,finalizedState:observation.saleState,blockhashStillValid:observation.blockhashValid});
 }
 if(observeOnly&&existsSync(state('blocked-inventory-3.json'))){
  const blocked=JSON.parse(readFileSync(state('blocked-inventory-3.json'),'utf8')),f=JSON.parse(readFileSync(state('scenario-3.json'),'utf8'));
  const address=v2Addresses(program,uuidHash(f.cardId),uuidHash(f.saleId)).card;
  const account=await connection.getAccountInfo(address,'finalized'),signatureStatus=(await connection.getSignatureStatuses([blocked.signature],{searchTransactionHistory:true})).value[0];
  if(account){assert.equal(account.owner.toBase58(),program);assert.equal(hex(account.data.subarray(8,40)),hex(uuidHash(f.cardId)));assert.equal(hex(account.data.subarray(40,72)),hex(uuidHash(f.itemId)));assert.equal(hex(account.data.subarray(72,104)),hex(seller.publicKey.toBytes()));}
  const audit={signature:blocked.signature,signatureStatus,cardExists:!!account,card:address.toBase58(),classification:account?'expected registration exists; do not repeat registration':'BLOCKED: uncertain registration, no replacement authorized'};
  writeFileSync(state('registration-outcome-audit-'+Date.now()+'.json'),JSON.stringify(audit,null,2));console.log('REGISTRATION AUDIT',JSON.stringify(audit));
 }
 const completed=(contextOnly?[11,12]:[0,1,2,4,5]).filter(i=>existsSync(state('scenario-'+i+'-complete'))).map(i=>{const f=JSON.parse(readFileSync(state('scenario-'+i+'.json'),'utf8'));return {saleId:f.saleId,listingId:f.listingId,outcome:[0,4,11].includes(i)?'direct':i===1||i===12?'released':'refunded'};});
  assert.ok(completed.length>=(contextOnly?2:3));
 sql(readFileSync('/work/tests/payment-integration/03_outcome_assertions.sql','utf8'),'supabase_admin',{cases:JSON.stringify(completed)});
 result('actual-integrated-accounting-audit',{terminalSales:completed.length,classification:'does not count blocked/held cases as terminal success'});
 if(!reviewOnly&&!contextOnly)for(const index of [0,1,2,4,5].filter(i=>existsSync(state('scenario-'+i+'-complete')))){
  const f=JSON.parse(readFileSync(state('scenario-'+index+'.json'),'utf8')),a=v2Addresses(program,uuidHash(f.cardId),uuidHash(f.saleId));
  const eventId=sql(`SELECT id FROM payment_v2.events WHERE sale_id='${f.saleId}' AND kind='${[0,4].includes(index)?'direct':index===1?'released':'refunded'}'`);
  const receipt=await paymentRpc(settler,'fn_payment_v2_reconcile_event',{p_event_id:eventId});assert.equal(receipt.saleId,f.saleId);
  const acknowledgement=await ix('acknowledge_claim',[meta(config),meta(a.card,false,true),meta(a.sale),meta(roles.reconciler.publicKey,true)],hash(JSON.stringify(receipt)));
  const retained=JSON.parse(readFileSync(state('ack-'+index+'.signed.json'),'utf8'));
  try{await observeAuthorityTransaction(rpc,genesis,retained.signature,acknowledgement);}
  catch(error){
   const history=await connection.getParsedTransaction(retained.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
   const signatureStatus=(await connection.getSignatureStatuses([retained.signature],{searchTransactionHistory:true})).value[0];
   const originalSlot=Number(sql(`SELECT (proof->>'slot')::bigint FROM payment_v2.lifecycle_evidence WHERE sale_id='${f.saleId}' AND kind='acknowledged'`));assert.ok(Number.isSafeInteger(originalSlot)&&originalSlot>0);
   const archived=await (await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'history-diagnostic',method:'getBlock',params:[originalSlot,{encoding:'jsonParsed',commitment:'finalized',transactionDetails:'full',rewards:false,maxSupportedTransactionVersion:0}]})})).json();
   writeFileSync(state('authority-history-gap-'+index+'-'+Date.now()+'.json'),JSON.stringify({index,signature:retained.signature,transactionPresent:history!==null,slot:history?.slot,blockTime:history?.blockTime,metaPresent:!!history?.meta,transactionPresentKeys:history?Object.keys(history):[],signatureStatus,originalSlot,archivalBlockPresent:!!archived.result,archivalError:archived.error,matchingBlockTransactions:archived.result?.transactions?.filter(t=>t.transaction.signatures[0]===retained.signature).length??0,error:String(error)},null,2));
   throw error;
  }
 }
 if(contextOnly){const oldEvent=sql("SELECT e.id FROM payment_v2.events e JOIN payment_v2.consumptions c ON c.event_id=e.id ORDER BY e.created_at LIMIT 1");const oldReceipt=await paymentAcknowledgementContext(settler,oldEvent);assert.ok(oldReceipt.receipt?.signature);result('historical-committed-receipt-recovered-without-fresh-primary-history',{eventId:oldEvent,signature:oldReceipt.receipt.signature,chainRetrieval:'not requested'});}
 if(!reviewOnly&&!contextOnly)result('all-completed-acknowledgements-reverified',{count:completed.length});
 if(reviewOnly){
  const original=JSON.parse(readFileSync(state('outcome-operation-6.json'),'utf8'));
  const executor=createPaymentPostgresTransport({role:'payment_v2_executor',login:'payment_integration_executor_b',host:'127.0.0.1',port:5432,database:db,sslMode:'disable'});
  const leased=(await claimPaymentOperations(executor,randomUUID())).find(o=>o.id===original.id);assert.ok(leased,'original operation must be available to its dedicated recovery worker');assert.equal(leased.recoveryOnly,true);
  const retained=await loadSignedOperation(executor,leased.id,leased.leaseId);assert.ok(retained.envelope);
  const observed=await observeSignedOutcome(rpc,retained.plan,retained.envelope),decision=signedOperationRecovery(retained.envelope,retained.plan,observed);
  assert.equal(observed.signatureState,'not_found');assert.equal(observed.saleState,'funded');assert.equal(observed.blockhashValid,false);assert.equal(decision.kind,'blocked');assert.match(decision.reason,/expired or invalid original/);
  await finishPaymentOperation(executor,leased,'unknown',retained.envelope.signature,'REVIEW_REQUIRED: '+decision.reason+'; original signature retained; do not sign a replacement or pay again');
  const persisted=JSON.parse(sql(`SELECT jsonb_build_object('state',state,'signature',signature,'error',last_error) FROM payment_v2.operations WHERE id='${original.id}'`));assert.equal(persisted.state,'unknown');assert.equal(persisted.signature,retained.envelope.signature);assert.match(persisted.error,/REVIEW_REQUIRED/);
  result('expired-original-durable-review-obligation',{operation:original.id,signature:persisted.signature,state:persisted.state,financialOutcome:'still funded; no broadcast or replacement'});
 }
}catch(error){writeFileSync(state('failure-'+Date.now()+'.txt'),String(error.stack||error));throw error;}
finally{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(10000)]);if(child.exitCode===null)child.kill('SIGKILL');}
