/** Explicit opt-in, owned loopback validator only. NO production key files.
 * First build the program with the reviewed SBF toolchain, then:
 * node solana/tests/local-v2.mjs --run-local-validator --program-so <built.so>
 * Needs existing @solana/web3.js installation, not @solana/spl-token.
 * SPL packing reference: https://github.com/solana-program/token/blob/main/interface/src/instruction.rs
 * This drives the ACTUAL compiled program; it is not a simulated escrow ledger.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2);
if(!args.includes('--run-local-validator'))throw new Error('Explicit --run-local-validator opt-in required. No network action taken.');
if(args.some(a=>/rpc|wallet|keypair|devnet|mainnet/i.test(a)))throw new Error('No supplied RPC/wallet/keypair/network arguments accepted.');
const so=args[args.indexOf('--program-so')+1];
if(!args.includes('--program-so')||!so?.endsWith('.so')||!existsSync(so))throw new Error('Explicit built .so required.');
const validator='solana-test-validator';
const help=execFileSync(validator,['--help'],{encoding:'utf8',windowsHide:true});
for(const flag of ['--upgradeable-program','--bind-address','--ledger','--rpc-port','--faucet-port','--gossip-port','--dynamic-port-range','--config','--mint'])if(!help.includes(flag))throw new Error(`Unsupported validator: missing ${flag}`);
const URL_RPC='http://127.0.0.1:18899';
assert.equal(new URL(URL_RPC).hostname,'127.0.0.1');
for(const port of [18899,18900,18901])await new Promise((ok,bad)=>{const s=net.createServer();s.once('error',()=>bad(new Error('Local test port occupied; refusing to reuse existing validator.')));s.listen(port,'127.0.0.1',()=>s.close(ok));});
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram,ComputeBudgetProgram,AddressLookupTableProgram,SYSVAR_RENT_PUBKEY,SYSVAR_INSTRUCTIONS_PUBKEY}=await import('@solana/web3.js');
// Generation happens only after all safety checks. Secrets remain in memory.
const bootstrap=Keypair.generate(),gov=[Keypair.generate(),Keypair.generate(),Keypair.generate()];
const roleNames=['issuer','inventory','receiver','authenticator','reviewer','release','reconciler','guardian'];
const roles=Object.fromEntries(roleNames.map(n=>[n,Keypair.generate()]));
const seller=Keypair.generate(),treasury=Keypair.generate(),buyers=[Keypair.generate(),Keypair.generate(),Keypair.generate()],mint=Keypair.generate();
const root=mkdtempSync(join(tmpdir(),'flexsoar-local-'));let child;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const program=new PublicKey('CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF');
const token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),ataProgram=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const hash=s=>createHash('sha256').update(s).digest(),disc=n=>hash(`global:${n}`).subarray(0,8),u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const keyBytes=k=>k.toBuffer(),pda=(...seeds)=>PublicKey.findProgramAddressSync(seeds,program)[0];
const config=pda(Buffer.from('config-v2'));
const ata=owner=>PublicKey.findProgramAddressSync([owner.toBuffer(),token.toBuffer(),mint.publicKey.toBuffer()],ataProgram)[0];
const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const ix=(name,keys,...data)=>new TransactionInstruction({programId:program,keys,data:Buffer.concat([disc(name),...data])});
const ataIx=owner=>new TransactionInstruction({programId:ataProgram,data:Buffer.from([1]),keys:[meta(bootstrap.publicKey,true,true),meta(ata(owner),false,true),meta(owner),meta(mint.publicKey),meta(SystemProgram.programId),meta(token)]});
const roleBytes=()=>Buffer.concat(roleNames.map(n=>roles[n].publicKey.toBuffer()));
const encode=p=>Buffer.concat([Buffer.from([70,83,79,65,82,86,50,0,2,p.mode]),...['domain','program','config','saleId','card','pair','attempt','beneficiary','policy','buyer','seller','treasury','mint','tokenProgram','buyerToken','sellerToken','treasuryToken','refundToken','issuer'].map(n=>p[n]),...['generation','revision','custodyVersion','authorityEpoch','total','net','fee','validFrom','expiresAt'].map(n=>u64(p[n]))]);
const attest=(p,sale,action,revision=0)=>Buffer.concat([Buffer.from([70,83,79,65,82,86,50,0,action]),sale.toBuffer(),p.attempt,p.pair,hash(`local-evidence-${action}`),u64(revision)]);
let nonce=0,checks=0,connection;
async function send(instructions,signers=[],tables=[]){
  const block=await connection.getLatestBlockhash('confirmed');
  const message=new TransactionMessage({payerKey:bootstrap.publicKey,recentBlockhash:block.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500000+(nonce++%10000)}),...instructions]}).compileToV0Message(tables);
  const tx=new VersionedTransaction(message);tx.sign([...new Map([bootstrap,...signers].map(k=>[k.publicKey.toBase58(),k])).values()]);
  assert.ok(tx.serialize().length<=1232,'reviewed lookup table must fit packet');
  // Failed commands must execute on our owned validator, not merely preflight.
  const signature=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:true});
  const confirmation=await connection.confirmTransaction({signature,...block},'confirmed');
  assert.equal(confirmation.value.err,null);return signature;
}
const balance=async address=>BigInt((await connection.getTokenAccountBalance(address,'confirmed')).value.amount);
async function mintTo(owner,amount){await send([new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true),meta(ata(owner),false,true),meta(bootstrap.publicKey,true)],data:Buffer.concat([Buffer.from([7]),u64(amount)])})]);}
async function table(addresses){
  let recentSlot=await connection.getSlot('finalized');
  for(let i=0;recentSlot===0;i++){if(i>150)throw new Error('Local finalized root unavailable');await pause(200);recentSlot=await connection.getSlot('finalized');}
  const [create,address]=AddressLookupTableProgram.createLookupTable({authority:bootstrap.publicKey,payer:bootstrap.publicKey,recentSlot});
  await send([create]);await send([AddressLookupTableProgram.extendLookupTable({authority:bootstrap.publicKey,payer:bootstrap.publicKey,lookupTable:address,addresses})]);
  const extended=await connection.getSlot('confirmed');for(let i=0;await connection.getSlot('confirmed')<=extended;i++){if(i>100)throw new Error('Lookup table activation timed out');await pause(100);}
  const value=(await connection.getAddressLookupTable(address)).value;assert.ok(value);return [value];
}
function buy(p,sale,card,escrow){return ix('buy_sale',[meta(config,false,true),meta(card,false,true),meta(sale,false,true),meta(roles.issuer.publicKey,true),meta(new PublicKey(p.buyer),true),meta(new PublicKey(p.buyerToken),false,true),meta(ata(seller.publicKey),false,true),meta(ata(treasury.publicKey),false,true),meta(escrow,false,true),meta(token),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],encode(p));}
function staff(name,p,sale,actor,action,revision=0,boolean){return ix(name,[meta(config),meta(sale,false,true),meta(actor.publicKey,true)],attest(p,sale,action,revision),...(boolean===undefined?[]:[Buffer.from([boolean?1:0])]));}
function governSale(name,p,sale,action,revision=0){return ix(name,[meta(config),meta(sale,false,true),meta(gov[0].publicKey,true),meta(gov[1].publicKey,true)],attest(p,sale,action,revision));}
const governKeys=()=>[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[1].publicKey,true)];
const outcome=(p,sale,escrow,revision)=>ix('execute_outcome',[meta(config,false,true),meta(sale,false,true),meta(escrow,false,true),meta(ata(seller.publicKey),false,true),meta(ata(treasury.publicKey),false,true),meta(new PublicKey(p.refundToken),false,true),meta(token),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],u64(revision));
try {
  // Never load the operator's default Solana config or client wallet. This
  // local config contains PUBLIC test context only; its wallet path is absent.
  const localConfig=join(root,'validator-config.json');
  writeFileSync(localConfig,JSON.stringify({json_rpc_url:URL_RPC,websocket_url:'ws://127.0.0.1:18900',keypair_path:join(root,'unused-wallet.json'),commitment:'confirmed'}),{flag:'wx',mode:0o600});
  child=spawn(validator,['--config',localConfig,'--url',URL_RPC,'--mint',bootstrap.publicKey.toBase58(),'--bind-address','127.0.0.1','--rpc-port','18899','--faucet-port','18901','--gossip-port','18902','--dynamic-port-range','19000-19020','--ledger',join(root,'ledger'),'--upgradeable-program',program.toBase58(),resolve(so),bootstrap.publicKey.toBase58()],{stdio:'ignore',windowsHide:true});
  let spawnError;child.on('error',e=>{spawnError=e;});
  connection=new Connection(URL_RPC,'confirmed');
  for(let i=0;;i++){if(spawnError)throw spawnError;if(child.exitCode!==null)throw new Error('Owned local validator exited');try{await connection.getGenesisHash();break;}catch{if(i>=120)throw new Error('Local validator startup timeout');await pause(500);}}
  for(const signer of [bootstrap,roles.issuer,roles.inventory]){const signature=await connection.requestAirdrop(signer.publicKey,10_000_000_000);await connection.confirmTransaction(signature,'confirmed');}
  await send([SystemProgram.createAccount({fromPubkey:bootstrap.publicKey,newAccountPubkey:mint.publicKey,lamports:await connection.getMinimumBalanceForRentExemption(82),space:82,programId:token}),new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true)],data:Buffer.concat([Buffer.from([20,6]),bootstrap.publicKey.toBuffer(),Buffer.from([0])])})],[mint]);
  await send([ataIx(seller.publicKey),ataIx(treasury.publicKey),...buyers.map(b=>ataIx(b.publicKey))]);
  const domain=new PublicKey(await connection.getGenesisHash()).toBuffer(),policy=hash('MY-USDC-ESCROW-1');
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),programData=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  await send([ix('initialize_v2',[meta(config,false,true),meta(bootstrap.publicKey,true,true),meta(programData),meta(mint.publicKey),meta(SystemProgram.programId)],domain,policy,treasury.publicKey.toBuffer(),roleBytes(),Buffer.concat(gov.map(g=>g.publicKey.toBuffer())))]);
  await send([ix('configure',governKeys(),roleBytes(),u64(2_000_000),u64(10_000_000))],gov.slice(0,2));
  await send([ix('set_pause',governKeys(),Buffer.from([0,0]))],gov.slice(0,2));
  await mintTo(buyers[2].publicKey,950_000);
  for(const [caseIndex,mode]of [0,1,0].entries()){
    const cardId=hash(`local-card-${caseIndex}`),pair=hash(`local-pair-${caseIndex}`),saleId=hash(`local-sale-${caseIndex}`),card=pda(Buffer.from('card-v2'),cardId),sale=pda(Buffer.from('sale-v2'),saleId),escrow=pda(Buffer.from('escrow-v2'),sale.toBuffer());
    for(const buyer of buyers.slice(0,2))await mintTo(buyer.publicKey,2_000_000);
    const before=await Promise.all(buyers.slice(0,2).map(b=>balance(ata(b.publicKey))));const sellerBefore=await balance(ata(seller.publicKey)),treasuryBefore=await balance(ata(treasury.publicKey));
    const p={mode,domain,program:program.toBuffer(),config:config.toBuffer(),saleId,card:cardId,pair,attempt:hash(`local-attempt-${caseIndex}-0`),beneficiary:hash('local-user-0'),policy,buyer:buyers[0].publicKey.toBuffer(),seller:seller.publicKey.toBuffer(),treasury:treasury.publicKey.toBuffer(),mint:mint.publicKey.toBuffer(),tokenProgram:token.toBuffer(),buyerToken:ata(buyers[0].publicKey).toBuffer(),sellerToken:ata(seller.publicKey).toBuffer(),treasuryToken:ata(treasury.publicKey).toBuffer(),refundToken:ata(buyers[0].publicKey).toBuffer(),issuer:roles.issuer.publicKey.toBuffer(),generation:1,revision:1,custodyVersion:1,authorityEpoch:2,total:1_000_000,net:950_000,fee:50_000,validFrom:0,expiresAt:Math.floor(Date.now()/1000)+3600};
    await send([ix('register_card',[meta(config),meta(card,false,true),meta(roles.inventory.publicKey,true,true),meta(roles.authenticator.publicKey,true),meta(SystemProgram.programId)],cardId,pair,seller.publicKey.toBuffer(),Buffer.from([mode]))],[roles.inventory,roles.authenticator]);
    const tables=await table([config,card,sale,escrow,mint.publicKey,ata(seller.publicKey),ata(treasury.publicKey),...buyers.map(b=>ata(b.publicKey)),token,SystemProgram.programId,SYSVAR_RENT_PUBKEY,SYSVAR_INSTRUCTIONS_PUBKEY]);
    await send([ix('open_sale',[meta(config),meta(card,false,true),meta(sale,false,true),meta(escrow,false,true),meta(mint.publicKey),meta(roles.issuer.publicKey,true,true),meta(token),meta(SystemProgram.programId),meta(SYSVAR_RENT_PUBKEY)],encode(p))],[roles.issuer],tables);
    const insufficient={...p,buyer:buyers[2].publicKey.toBuffer(),buyerToken:ata(buyers[2].publicKey).toBuffer(),refundToken:ata(buyers[2].publicKey).toBuffer()};
    await assert.rejects(send([buy(insufficient,sale,card,escrow)],[roles.issuer,buyers[2]],tables));
    assert.equal(await balance(ata(buyers[2].publicKey)),950000n);assert.equal(await balance(ata(seller.publicKey)),sellerBefore);assert.equal((await connection.getAccountInfo(sale)).data[698],1);checks++;
    await assert.rejects(send([buy({...p,expiresAt:1},sale,card,escrow)],[roles.issuer,buyers[0]],tables));checks++;
    if(mode===1){await send([ix('revise_sale',[meta(config),meta(card,false,true),meta(sale,false,true),meta(roles.issuer.publicKey,true)],u64(1))],[roles.issuer]);await assert.rejects(send([buy(p,sale,card,escrow)],[roles.issuer,buyers[0]],tables));p.revision=2;checks++;}
    const candidates=[p,{...p,buyer:buyers[1].publicKey.toBuffer(),buyerToken:ata(buyers[1].publicKey).toBuffer(),refundToken:ata(buyers[1].publicKey).toBuffer(),attempt:hash(`local-attempt-${caseIndex}-1`),beneficiary:hash('local-user-1')}];
    const race=await Promise.allSettled(candidates.map((q,i)=>send([buy(q,sale,card,escrow)],[roles.issuer,buyers[i]],tables)));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);const winner=race.findIndex(r=>r.status==='fulfilled'),win=candidates[winner];
    const after=await Promise.all(buyers.slice(0,2).map(b=>balance(ata(b.publicKey))));assert.equal(before[winner]-after[winner],1000000n);assert.equal(before[1-winner]-after[1-winner],0n);checks++;
    if(mode===1){assert.equal(await balance(ata(seller.publicKey))-sellerBefore,950000n);assert.equal(await balance(ata(treasury.publicKey))-treasuryBefore,50000n);checks++;continue;}
    assert.equal(await balance(escrow),1000000n);assert.equal(await balance(ata(seller.publicKey)),sellerBefore);assert.equal(await balance(ata(treasury.publicKey)),treasuryBefore);checks++;
    await assert.rejects(send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]));
    await assert.rejects(send([staff('record_receipt',win,sale,roles.issuer,0)],[roles.issuer]));
    await send([staff('record_receipt',win,sale,roles.receiver,0)],[roles.receiver]);
    await assert.rejects(send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]));checks++;
    const refund=caseIndex===0;
    await send([staff('record_authentication',win,sale,roles.authenticator,refund?2:1,0,!refund)],[roles.authenticator]);
    if(refund){await assert.rejects(send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]));await send([governSale('authorize_refund',win,sale,4)],gov.slice(0,2));}
    else{await send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]);await assert.rejects(send([governSale('authorize_refund',win,sale,4)],gov.slice(0,2)));}checks++;
    const dust=7n;await send([new TransactionInstruction({programId:token,keys:[meta(ata(buyers[1-winner].publicKey),false,true),meta(escrow,false,true),meta(buyers[1-winner].publicKey,true)],data:Buffer.concat([Buffer.from([3]),u64(dust)])})],[buyers[1-winner]]);
    await send([ix('set_pause',governKeys(),Buffer.from([1,0]))],gov.slice(0,2));
    if(caseIndex===2){
      // Future terms rotate; this ALREADY funded escrow must retain old accounts.
      await send([ix('update_future_terms',governKeys(),Keypair.generate().publicKey.toBuffer(),hash('local-future-policy'))],gov.slice(0,2));checks++;
    }
    await send([ix('emergency_pause',[meta(config,false,true),meta(roles.guardian.publicKey,true)],Buffer.from([1]))],[roles.guardian]);
    await assert.rejects(send([outcome(win,sale,escrow,1)]));assert.equal(await balance(escrow),1000007n);checks++;
    await send([ix('set_pause',governKeys(),Buffer.from([1,0]))],gov.slice(0,2));
    await assert.rejects(send([outcome(win,sale,escrow,0)]));
    const beforeRefund=await balance(new PublicKey(win.refundToken));
    await assert.rejects(send([outcome(win,sale,escrow,1),outcome(win,sale,escrow,1)]));
    assert.equal(await balance(escrow),1000007n);checks++;
    const exits=await Promise.allSettled([send([outcome(win,sale,escrow,1)]),send([outcome(win,sale,escrow,1)])]);assert.equal(exits.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await balance(escrow),dust);assert.equal((await connection.getAccountInfo(sale)).data[698],refund?5:4);
    if(refund){assert.equal(await balance(new PublicKey(win.refundToken))-beforeRefund,1000000n);assert.equal(await balance(ata(seller.publicKey)),sellerBefore);assert.equal(await balance(ata(treasury.publicKey)),treasuryBefore);}
    else{assert.equal(await balance(ata(seller.publicKey))-sellerBefore,950000n);assert.equal(await balance(ata(treasury.publicKey))-treasuryBefore,50000n);}
    await assert.rejects(send([outcome(win,sale,escrow,1)]));checks++;
    await send([ix('set_pause',governKeys(),Buffer.from([0,0]))],gov.slice(0,2));
  }
  console.log(`LOCAL VALIDATOR ONLY: ${checks} program/balance assertions passed; no database integration asserted.`);
} finally {
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(5000)]);}
  // Delete only the unique directory created by THIS helper, after process exit.
  if((!child||child.exitCode!==null)&&dirname(resolve(root))===resolve(tmpdir())&&basename(root).startsWith('flexsoar-local-'))rmSync(root,{recursive:true,force:true});
}
