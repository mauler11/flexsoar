/** D2 defence-in-depth checks against deliberately invalid GENESIS state, not state reachable through instructions.
 * Called by local-v2.mjs only after its validator has stopped, inside the same loopback-only network namespace.
 * No key files are read. Each fixture gets a fresh ledger and is discarded after its validator exits.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';

assert.ok(process.env.FLEXSOAR_PARENT_NETNS && process.env.FLEXSOAR_PARENT_NETNS !== readlinkSync('/proc/self/ns/net'));
const links=JSON.parse(execFileSync('ip',['-j','link','show'],{encoding:'utf8'}));
assert.ok(links.length===1 && links[0].ifname==='lo' && links[0].flags.includes('UP'));
const [so,mockSo]=process.argv.slice(2);assert.ok(so?.endsWith('.so') && mockSo?.endsWith('.so'));
const program=new PublicKey(readFileSync(new URL('../programs/flexsoar-settlement/src/lib.rs',import.meta.url),'utf8').match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)[1]);
const config=PublicKey.findProgramAddressSync([Buffer.from('config-v2')],program)[0];
const hash=s=>createHash('sha256').update(s).digest(),disc=n=>hash(`global:${n}`).subarray(0,8);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const url='http://127.0.0.1:18899';
let checks=0;
for(let seat=0;seat<3;seat++){
  const root=mkdtempSync(join(tmpdir(),'flexsoar-d2-genesis-'));
  const payer=Keypair.generate(),controller=Keypair.generate().publicKey,otherController=Keypair.generate().publicKey;
  const vault=id=>PublicKey.findProgramAddressSync([Buffer.from('mock-vault')],id)[0];
  const active=vault(controller),pending=vault(otherController);
  const members=Array.from({length:3},()=>Keypair.generate().publicKey);
  const badMembers=[...members];badMembers[seat]=pending;badMembers[(seat+1)%3]=active;
  const data=Buffer.alloc(819);hash('account:ConfigV2').copy(data,0,0,8);
  for(let i=0;i<8;i++)Keypair.generate().publicKey.toBuffer().copy(data,136+32*i);
  badMembers.forEach((k,i)=>k.toBuffer().copy(data,392+32*i));
  active.toBuffer().copy(data,488);hash('active-policy').copy(data,520);
  data.writeBigUInt64LE(1n,552);data[560]=1;
  pending.toBuffer().copy(data,594);otherController.toBuffer().copy(data,626);hash('pending-policy').copy(data,658);
  data[690]=1;data.writeBigUInt64LE(1n,691);
  const fixture=join(root,'config.json'),localConfig=join(root,'validator-config.json');
  writeFileSync(fixture,JSON.stringify({pubkey:config.toBase58(),account:{lamports:100_000_000,data:[data.toString('base64'),'base64'],owner:program.toBase58(),executable:false,rentEpoch:0,space:data.length}}));
  writeFileSync(localConfig,JSON.stringify({json_rpc_url:url,websocket_url:'ws://127.0.0.1:18900',keypair_path:join(root,'unused-wallet.json'),commitment:'confirmed'}));
  let errors='',spawnError;
  const child=spawn('solana-test-validator',['--config',localConfig,'--url',url,'--mint',payer.publicKey.toBase58(),'--bind-address','127.0.0.1','--rpc-port','18899','--faucet-port','18901','--gossip-port','18902','--dynamic-port-range','19000-19020','--ledger',join(root,'ledger'),
    '--upgradeable-program',program.toBase58(),resolve(so),payer.publicKey.toBase58(),
    '--upgradeable-program',controller.toBase58(),resolve(mockSo),payer.publicKey.toBase58(),
    '--upgradeable-program',otherController.toBase58(),resolve(mockSo),payer.publicKey.toBase58(),
    '--account',config.toBase58(),fixture],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  child.stderr.on('data',b=>{errors=(errors+b).slice(-8000);});child.on('error',e=>{spawnError=e;});
  try{
    const rpc=new Connection(url,'confirmed');
    for(let i=0;;i++){
      if(spawnError)throw spawnError;if(child.exitCode!==null)throw new Error(errors);
      try{await rpc.getGenesisHash();break;}catch{if(i>=120)throw new Error('Fixture validator startup timeout');await pause(500);}
    }
    const confirm=async signature=>{
      for(let i=0;i<150;i++){
        const s=(await rpc.getSignatureStatuses([signature])).value[0];
        if(s && ['confirmed','finalized'].includes(s.confirmationStatus))return s.err;
        await pause(200);
      }
      throw new Error('Fixture transaction confirmation timeout');
    };
    assert.equal(await confirm(await rpc.requestAirdrop(payer.publicKey,2_000_000_000)),null);
    const read=async()=>Buffer.from((await rpc.getAccountInfo(config)).data);
    assert.deepEqual(await read(),data,'fixture loaded byte-for-byte');
    const via=(id,name,keys,payload)=>new TransactionInstruction({programId:id,
      keys:[meta(program),...keys.map(k=>meta(k.pubkey,false,k.isWritable))],
      data:Buffer.concat([Buffer.from([keys.length]),Buffer.from(keys.map(k=>(k.isSigner?1:0)|(k.isWritable?2:0))),disc(name),payload])});
    const send=async instruction=>{
      const block=await rpc.getLatestBlockhash();
      const tx=new Transaction({feePayer:payer.publicKey,...block}).add(instruction);tx.sign(payer);
      return confirm(await rpc.sendRawTransaction(tx.serialize(),{skipPreflight:true}));
    };
    const revision=Buffer.alloc(8);revision.writeBigUInt64LE(1n);
    const accept=()=>via(otherController,'accept_governance_vault',[meta(config,false,true),meta(pending,true),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],revision);
    const rotate=keys=>via(controller,'rotate_governance',[meta(config,false,true),meta(active,true),meta(active,true)],Buffer.concat(keys.map(k=>k.toBuffer())));
    // Correct signer, direct controller CPI and current revision: only the key conflict rejects acceptance.
    assert.deepEqual(await send(accept()),{InstructionError:[0,{Custom:6017}]});assert.deepEqual(await read(),data);checks++;
    // An already-overlapping active vault cannot REMAIN in the dormant list through a rotation.
    assert.deepEqual(await send(rotate(badMembers)),{InstructionError:[0,{Custom:6017}]});assert.deepEqual(await read(),data);checks++;
    // Repair through the real instruction, then accept: proves the same CPI accounts/revision are otherwise valid.
    assert.equal(await send(rotate(members)),null);
    assert.deepEqual((await read()).subarray(392,488),Buffer.concat(members.map(k=>k.toBuffer())));checks++;
    assert.equal(await send(accept()),null);
    const accepted=await read();assert.deepEqual(accepted.subarray(488,520),pending.toBuffer());
    assert.ok(accepted.subarray(594,690).every(b=>b===0));checks++;
    console.log(`D2 genesis native seat ${seat}: accept 6017, retaining active member 6017, repair and accept PASS`);
  }finally{
    if(child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(5000)]);}
    assert.ok(child.exitCode!==null || child.signalCode!==null,'fixture validator must stop before another starts');
    if(dirname(resolve(root))===resolve(tmpdir()) && basename(root).startsWith('flexsoar-d2-genesis-'))rmSync(root,{recursive:true,force:true});
  }
}
console.log(`D2 GENESIS: ${checks} on-chain scenario groups passed (deliberately invalid genesis fixtures).`);
