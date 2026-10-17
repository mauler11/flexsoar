/**
 * Fresh, valueless local-chain verification of the production finalized RPC
 * adapter. Uses a new ledger below /state and only loopback inside the attested
 * container namespace; it never touches the populated integration ledger/DB.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, openSync, statfsSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { AddressLookupTableProgram, Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { LocalFinalizedRpcSource, SnapshotFinalizedArchiveSource, acquireFinalizedEvidence, validateRetainedFinalizedEvidence } from '../../lib/solana/v2-evidence.ts';

const attestation=JSON.parse(readFileSync('/state/integration-host-attestation.json','utf8'));
assert.equal(attestation.containerId,'71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92');
assert.equal(attestation.network,'none');
assert.equal(attestation.database,'flexsoar_payment_v2_integration_test');
assert.equal(attestation.namespace,readlinkSync('/proc/self/ns/net'));
assert.deepEqual(readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(line=>line.includes(':')).map(line=>line.split(':')[0].trim()),['lo']);
assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1,'namespace must have no non-loopback route');
const disk=statfsSync('/state',{bigint:true});assert.ok(disk.bavail*disk.bsize>=5n*1024n*1024n*1024n,'local evidence test requires5GiB free; do not prune another ledger');
assert.ok(process.argv[2]==='--run-isolated-evidence-adapter','explicit local-only test switch required');

const root=mkdtempSync('/state/evidence-adapter-'),rpc='http://127.0.0.1:18911',log=openSync(join(root,'validator.log'),'wx');
for(const port of [18911,18912,18913,18914])await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
const bootstrap=Keypair.generate(),payer=Keypair.generate(),destination=Keypair.generate().publicKey,legacyDestination=Keypair.generate().publicKey;
writeFileSync(join(root,'validator-config.json'),JSON.stringify({json_rpc_url:rpc,websocket_url:'ws://127.0.0.1:18912',keypair_path:join(root,'no-operational-wallet.json'),commitment:'finalized'}),{flag:'wx'});
const child=spawn('/tools/runtime/ld-linux-x86-64.so.2',['--library-path','/tools/runtime','/tools/agave/solana-test-validator','--config',join(root,'validator-config.json'),'--url',rpc,'--ledger',join(root,'ledger'),'--bind-address','127.0.0.1','--rpc-port','18911','--faucet-port','18913','--gossip-port','18914','--dynamic-port-range','19030-19050','--limit-ledger-size','1000000','--mint',bootstrap.publicKey.toBase58()],{stdio:['ignore',log,log],env:{PATH:process.env.PATH??'/tools/agave:/usr/bin:/bin',RAYON_NUM_THREADS:'2'}});
const connection=new Connection(rpc,'finalized'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function send(instructions,lookupTables=[]){
  const validity=await connection.getLatestBlockhash('finalized'),message=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:validity.blockhash,instructions});
  const compiled=lookupTables.length?message.compileToV0Message(lookupTables):message.compileToLegacyMessage();
  const tx=new VersionedTransaction(compiled);tx.sign([payer]);
  const signature=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:2,preflightCommitment:'finalized'});
  const status=await connection.confirmTransaction({signature,...validity},'finalized');
  assert.equal(status.value.err,null,`local validator transaction failed: ${JSON.stringify(status.value.err)}`);
  return signature;
}
async function healthy(){
  for(let i=0;i<180;i++){
    if(child.exitCode!==null)throw new Error(`isolated local validator exited ${child.exitCode}`);
    try{const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'local-evidence-health',method:'getHealth'})});if(response.ok&&(await response.json()).result==='ok')return;}catch{}
    await pause(500);
  }
  throw new Error('loopback local validator did not become healthy');
}
function inspectExpected(expected){return (observed,signature)=>{
  assert.equal(observed.meta?.err,null);assert.equal(observed.transaction.signatures[0],signature);
  const ix=observed.transaction.message.instructions;
  assert.equal(ix.length,1);assert.equal(ix[0].programId,SystemProgram.programId.toBase58());
  assert.equal(ix[0].parsed?.type,'transfer');
  assert.equal(ix[0].parsed?.info.source,payer.publicKey.toBase58());
  assert.equal(ix[0].parsed?.info.destination,expected);
  assert.equal(String(ix[0].parsed?.info.lamports),'1000000');
};}
try{
  await healthy();
  const genesis=await connection.getGenesisHash();
  const airdrop=await connection.requestAirdrop(payer.publicKey,2_000_000_000);
  await connection.confirmTransaction(airdrop,'finalized');
  const source=new LocalFinalizedRpcSource(rpc,'local-primary');
  const legacySignature=await send([SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:legacyDestination,lamports:1_000_000})]);
  const legacyExpected={networkId:randomUUID(),genesis,program:SystemProgram.programId.toBase58(),signature:legacySignature,subjectKind:'lifecycle',subjectId:randomUUID(),subjectAction:'offline_local_transfer_legacy'};
  const legacy=await acquireFinalizedEvidence(source,null,legacyExpected,inspectExpected(legacyDestination.toBase58()));
  await validateRetainedFinalizedEvidence(legacy,legacyExpected,inspectExpected(legacyDestination.toBase58()));

  // The ALT program accepts a slot present in SlotHashes, not an estimated
  // `currentSlot - 1` (which can already have aged out during a slow test).
  const confirmedSlot=await connection.getSlot('confirmed'),recentSlot=Math.max(0,confirmedSlot-1);
  assert.ok(recentSlot>0,'confirmed local slot required for lookup-table creation');
  const [createTable,tableKey]=AddressLookupTableProgram.createLookupTable({authority:payer.publicKey,payer:payer.publicKey,recentSlot});
  await send([createTable]);
  await send([AddressLookupTableProgram.extendLookupTable({authority:payer.publicKey,payer:payer.publicKey,lookupTable:tableKey,addresses:[destination]})]);
  const extended=await connection.getAddressLookupTable(tableKey,{commitment:'finalized'});assert.ok(extended.value);
  while(await connection.getSlot('finalized')<=extended.value.state.lastExtendedSlot)await pause(200);
  const v0Signature=await send([SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:destination,lamports:1_000_000})],[extended.value]);
  const expected={networkId:randomUUID(),genesis,program:SystemProgram.programId.toBase58(),signature:v0Signature,subjectKind:'lifecycle',subjectId:randomUUID(),subjectAction:'offline_local_transfer_v0_lookup'};
  const inspect=inspectExpected(destination.toBase58());
  const first=await acquireFinalizedEvidence(source,null,expected,inspect);
  const parsedMeta=first.parsedRpcResult.meta,compiledMeta=first.parsedRpcResult.compiledRpcResult.meta;
  assert.ok(first.parsedRpcResult.lookupTableEvidence.length===1,'v0 lookup proof retained');
  assert.equal(Object.hasOwn(parsedMeta,'loadedAddresses'),false,'jsonParsed encoding does not need loadedAddresses');
  assert.ok(compiledMeta.loadedAddresses,'compiled json encoding supplies loadedAddresses');
  assert.deepEqual(compiledMeta.loadedAddresses,{writable:[destination.toBase58()],readonly:[]});
  const archived={wire:first.rpcResult,parsed:first.parsedRpcResult};
  const archive=new SnapshotFinalizedArchiveSource('archive:captured-local-rpc',genesis,async signature=>signature===v0Signature?archived:null);
  const originalContext=first.parsedRpcResult.lookupTableEvidence[0].contextSlot;
  let later;
  for(let tries=0;tries<30;tries++){
    while(await connection.getSlot('finalized')<=originalContext)await pause(250);
    later=await acquireFinalizedEvidence(source,archive,expected,inspect);
    if(later.parsedRpcResult.lookupTableEvidence[0].contextSlot>originalContext)break;
    await pause(400);
  }
  assert.ok(later.parsedRpcResult.lookupTableEvidence[0].contextSlot>originalContext,'primary and captured archive have distinct valid lookup observation slots');
  assert.equal(later.sourceKind,'primary');
  await validateRetainedFinalizedEvidence(later,expected,inspect);
  const summary={containerId:attestation.containerId,database:'flexsoar_payment_v2_integration_test',topology:'network none, shared helper namespace with loopback only',genesis,legacy:{slot:legacy.slot,signaturePresent:true,retainedValidation:'pass'},v0Lookup:{slot:first.slot,lookupAccount:tableKey.toBase58(),loadedAddress:destination.toBase58(),base64LoadedAddressesPresent:Object.hasOwn(first.rpcResult.meta,'loadedAddresses'),jsonParsedLoadedAddressesPresent:Object.hasOwn(first.parsedRpcResult.meta,'loadedAddresses'),compiledJsonLoadedAddressesPresent:Object.hasOwn(first.parsedRpcResult.compiledRpcResult.meta,'loadedAddresses'),contextSlot:first.parsedRpcResult.lookupTableEvidence[0].contextSlot,retainedValidation:'pass'},archiveAgreement:{signature:v0Signature,archiveContextSlot:originalContext,primaryContextSlot:later.parsedRpcResult.lookupTableEvidence[0].contextSlot,ledgerPruned:false,archive:'snapshot captured from this local validator; simulated archive adapter, not independent provider'}};
  writeFileSync(join(root,'verification.json'),JSON.stringify(summary,null,2),{flag:'wx'});
  console.log('LOCAL_EVIDENCE_ADAPTER_PASS',JSON.stringify(summary));
}catch(error){
  writeFileSync(join(root,'failure.txt'),String(error?.stack??error),{flag:'wx'});
  throw error;
}finally{
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(10000)]);
  if(child.exitCode===null)child.kill('SIGKILL');
}
