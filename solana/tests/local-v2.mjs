/** Explicit opt-in, owned loopback validator only. NO production key files.
 * First build the program with the reviewed SBF toolchain, then:
 * bash solana/tests/run-local-v2.sh <built.so> (inside Ubuntu)
 * Needs existing @solana/web3.js installation, not @solana/spl-token.
 * SPL packing reference: https://github.com/solana-program/token/blob/main/interface/src/instruction.rs
 * This drives the ACTUAL compiled program; it is not a simulated escrow ledger.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { initializeV2 } from '../scripts/init-v2.mjs';
const args=process.argv.slice(2);
if(!args.includes('--run-local-validator'))throw new Error('Explicit --run-local-validator opt-in required. No network action taken.');
if(args.some(a=>/rpc|wallet|keypair|devnet|mainnet/i.test(a)))throw new Error('No supplied RPC/wallet/keypair/network arguments accepted.');
const so=args[args.indexOf('--program-so')+1];
if(!args.includes('--program-so')||!so?.endsWith('.so')||!existsSync(so))throw new Error('Explicit built .so required.');
const validator='solana-test-validator';
const help=execFileSync(validator,['--help'],{encoding:'utf8',windowsHide:true});
for(const flag of ['--upgradeable-program','--bind-address','--ledger','--rpc-port','--faucet-port','--gossip-port','--dynamic-port-range','--config','--mint'])if(!help.includes(flag))throw new Error(`Unsupported validator: missing ${flag}`);
// Agave 2.1's RPC/pubsub/faucet ignore --bind-address. Require a NEW
// rootless network namespace containing ONLY loopback before generating keys.
const parentNetwork=process.env.FLEXSOAR_PARENT_NETNS;
if(!parentNetwork||parentNetwork===readlinkSync('/proc/self/ns/net'))throw new Error('Use run-local-v2.sh: private network namespace required.');
const links=JSON.parse(execFileSync('ip',['-j','link','show'],{encoding:'utf8'}));
if(!Array.isArray(links)||links.length!==1||links[0].ifname!=='lo'||!links[0].flags.includes('UP'))throw new Error('Local test namespace must contain only active loopback.');
const URL_RPC='http://127.0.0.1:18899';
assert.equal(new URL(URL_RPC).hostname,'127.0.0.1');
for(const port of [18899,18900,18901])await new Promise((ok,bad)=>{const s=net.createServer();s.once('error',()=>bad(new Error('Local test port occupied; refusing to reuse existing validator.')));s.listen(port,'127.0.0.1',()=>s.close(ok));});
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram,ComputeBudgetProgram,AddressLookupTableProgram,Ed25519Program,SYSVAR_RENT_PUBKEY,SYSVAR_INSTRUCTIONS_PUBKEY}=await import('@solana/web3.js');
// Optional TEST-ONLY vault emulator (solana/test-programs/mock-vault): a PDA that signs through CPI like a Squads vault.
const mockSo=process.env.FLEXSOAR_MOCK_VAULT_SO;
if(mockSo&&!existsSync(mockSo))throw new Error('FLEXSOAR_MOCK_VAULT_SO set but the file does not exist.');
const mockId=Keypair.generate().publicKey,mockId2=Keypair.generate().publicKey; // two copies of the mock: the second is 'the wrong program'
// Generation happens only after all safety checks. Secrets remain in memory.
const bootstrap=Keypair.generate(),gov=[Keypair.generate(),Keypair.generate(),Keypair.generate()];
const roleNames=['issuer','inventory','receiver','authenticator','reviewer','release','reconciler','guardian'];
const roles=Object.fromEntries(roleNames.map(n=>[n,Keypair.generate()]));
const seller=Keypair.generate(),treasury=Keypair.generate(),buyers=[Keypair.generate(),Keypair.generate(),Keypair.generate()],mint=Keypair.generate();
const root=mkdtempSync(join(tmpdir(),'flexsoar-local-'));let child;let validatorErrors='';
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
let nonce=0,checks=0,connection;const retained=[];
class LocalInstructionFailure extends Error {
  constructor(signature,chainError){super(`Local transaction ${signature}: ${JSON.stringify(chainError)}`);this.chainError=chainError;}
}
const isInstructionFailure=e=>e instanceof LocalInstructionFailure && Array.isArray(e.chainError?.InstructionError);
// Transport, serialization, sponsorship or confirmation failures must NOT pass
// a test that claims the actual program rejected a command.
async function rejectsOnChain(promise){await assert.rejects(promise,isInstructionFailure);}
function checkRaceLoser(results){for(const r of results)if(r.status==='rejected')assert.ok(isInstructionFailure(r.reason),String(r.reason));}
async function send(instructions,signers=[],tables=[],payer=bootstrap){
  const block=await connection.getLatestBlockhash('confirmed');
  const message=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:block.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500000+(nonce++%10000)}),...instructions]}).compileToV0Message(tables);
  const tx=new VersionedTransaction(message);tx.sign([...new Map([payer,...signers].map(k=>[k.publicKey.toBase58(),k])).values()]);
  assert.ok(tx.serialize().length<=1232,'reviewed lookup table must fit packet');
  // Failed commands must execute on our owned validator, not merely preflight.
  const signature=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:true});
  const confirmation=await connection.confirmTransaction({signature,...block},'confirmed');
  if(confirmation.value.err)throw new LocalInstructionFailure(signature,confirmation.value.err);
  for(const name of cuNames)if(instructions.some(i=>i.programId.equals(program)&&i.data.subarray(0,8).equals(disc(name))))cuLog.push({name,signature});
  return signature;
}
// Compute units are read back from the validator for the whole transaction (incl. precompile + budget ix).
const cuNames=['open_sale','buy_sale','authorize_release','propose_governance_vault','cancel_governance_vault_proposal','set_release_delay','set_pause'],cuLog=[];
async function reportComputeUnits(){
  const byName={};
  for(const {name,signature}of cuLog){
    const tx=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
    (byName[name]??=[]).push(tx.meta.computeUnitsConsumed);
  }
  for(const [name,values]of Object.entries(byName))console.log(`CU ${name}: n=${values.length} min=${Math.min(...values)} max=${Math.max(...values)} all=${values.join(',')}`);
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
// Seller-signed listing (design section 5). Byte-for-byte twin of protocol.rs::listing_message and lib/solana/listing-v2.ts.
const i64=n=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b;};
const LISTING_FLOOR=980_000; // 2% FX tolerance under the 1_000_000 sale price
const nowSeconds=()=>Math.floor(Date.now()/1000);
const listingBinding=(p,o={})=>createHash('sha256').update(Buffer.concat([o.domain??p.domain,o.program??p.program,o.card??p.card,o.saleId??p.saleId,u64(o.generation??p.generation)])).digest();
const listingMessage=(p,min,exp,o={})=>Buffer.concat([Buffer.from('FSOARV2-LIST\0','latin1'),listingBinding(p,o),u64(min),i64(exp)]);
const listed=(p,{min=LISTING_FLOOR,exp=nowSeconds()+3600,signer=seller,over,message}={})=>Ed25519Program.createInstructionWithPrivateKey({privateKey:signer.secretKey,message:message??listingMessage(p,min,exp,over)});
const openSale=(p,card,sale,escrow)=>ix('open_sale',[meta(config),meta(card,false,true),meta(sale,false,true),meta(escrow,false,true),meta(mint.publicKey),meta(roles.issuer.publicKey,true,true),meta(token),meta(SystemProgram.programId),meta(SYSVAR_RENT_PUBKEY),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],encode(p));
// A refusal must come from the intended check, not from any failure: assert the program's custom error code.
async function rejectsWith(code,promise){await assert.rejects(promise,e=>isInstructionFailure(e)&&e.chainError.InstructionError[1]?.Custom===code,`expected custom error ${code}`);}
const FAULT={Authority:6001,Binding:6002,Locked:6003,Paused:6004,Cap:6005,ListingInvalid:6007,ListingSigner:6008,ListingExpired:6009,BelowFloor:6010,ReleaseDelay:6011,DelayRange:6012,NoPendingVault:6013,WrongController:6014,NotDirectCall:6015,StaleProposal:6016,VaultConflict:6017};
function buy(p,sale,card,escrow){return ix('buy_sale',[meta(config,false,true),meta(card,false,true),meta(sale,false,true),meta(roles.issuer.publicKey,true),meta(new PublicKey(p.buyer),true),meta(new PublicKey(p.buyerToken),false,true),meta(ata(seller.publicKey),false,true),meta(ata(treasury.publicKey),false,true),meta(escrow,false,true),meta(token),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],encode(p));}
function staff(name,p,sale,actor,action,revision=0,boolean){return ix(name,[meta(config),meta(sale,false,true),meta(actor.publicKey,true)],attest(p,sale,action,revision),...(boolean===undefined?[]:[Buffer.from([boolean?1:0])]));}
function governSale(name,p,sale,action,revision=0){return ix(name,[meta(config),meta(sale,false,true),meta(gov[0].publicKey,true),meta(gov[1].publicKey,true)],attest(p,sale,action,revision));}
const governKeys=()=>[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[1].publicKey,true)];
const acknowledge=(sale,card,actor)=>ix('acknowledge_claim',[meta(config),meta(card,false,true),meta(sale),meta(actor.publicKey,true)],hash('local-simulated-db-commit'));
const outcome=(p,sale,escrow,revision)=>ix('execute_outcome',[meta(config,false,true),meta(sale,false,true),meta(escrow,false,true),meta(ata(seller.publicKey),false,true),meta(ata(treasury.publicKey),false,true),meta(new PublicKey(p.refundToken),false,true),meta(token),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],u64(revision));
try {
  // Never load the operator's default Solana config or client wallet. This
  // local config contains PUBLIC test context only; its wallet path is absent.
  const localConfig=join(root,'validator-config.json');
  writeFileSync(localConfig,JSON.stringify({json_rpc_url:URL_RPC,websocket_url:'ws://127.0.0.1:18900',keypair_path:join(root,'unused-wallet.json'),commitment:'confirmed'}),{flag:'wx',mode:0o600});
  child=spawn(validator,['--config',localConfig,'--url',URL_RPC,'--mint',bootstrap.publicKey.toBase58(),'--bind-address','127.0.0.1','--rpc-port','18899','--faucet-port','18901','--gossip-port','18902','--dynamic-port-range','19000-19020','--ledger',join(root,'ledger'),'--upgradeable-program',program.toBase58(),resolve(so),bootstrap.publicKey.toBase58(),...(mockSo?['--upgradeable-program',mockId.toBase58(),resolve(mockSo),bootstrap.publicKey.toBase58(),'--upgradeable-program',mockId2.toBase58(),resolve(mockSo),bootstrap.publicKey.toBase58()]:[])],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  child.stderr.setEncoding('utf8');child.stderr.on('data',data=>{validatorErrors=(validatorErrors+data).slice(-8000);});
  let spawnError;child.on('error',e=>{spawnError=e;});
  connection=new Connection(URL_RPC,'confirmed');
  for(let i=0;;i++){if(spawnError)throw spawnError;if(child.exitCode!==null)throw new Error(`Owned local validator exited: ${validatorErrors}`);try{await connection.getGenesisHash();break;}catch{if(i>=120)throw new Error('Local validator startup timeout');await pause(500);}}
  for(const signer of [bootstrap,roles.issuer,roles.inventory]){const signature=await connection.requestAirdrop(signer.publicKey,10_000_000_000);await connection.confirmTransaction(signature,'confirmed');}
  await send([SystemProgram.createAccount({fromPubkey:bootstrap.publicKey,newAccountPubkey:mint.publicKey,lamports:await connection.getMinimumBalanceForRentExemption(82),space:82,programId:token}),new TransactionInstruction({programId:token,keys:[meta(mint.publicKey,false,true)],data:Buffer.concat([Buffer.from([20,6]),bootstrap.publicKey.toBuffer(),Buffer.from([0])])})],[mint]);
  await send([ataIx(seller.publicKey),ataIx(treasury.publicKey),...buyers.map(b=>ataIx(b.publicKey))]);
  const domain=new PublicKey(await connection.getGenesisHash()).toBuffer(),policy=hash('MY-USDC-ESCROW-1');
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),programData=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  await rejectsOnChain(send([ix('initialize_v2',[meta(config,false,true),meta(roles.inventory.publicKey,true,true),meta(programData),meta(mint.publicKey),meta(SystemProgram.programId)],domain,policy,treasury.publicKey.toBuffer(),roleBytes(),Buffer.concat(gov.map(g=>g.publicKey.toBuffer())))],[roles.inventory]));
  assert.equal(await connection.getAccountInfo(config),null);checks++;
  // Initialization goes through the reviewed script (solana/scripts/init-v2.mjs): pinned manifest, genesis check, fresh-program
  // inventory, simulation, and a field-by-field readback. Its refusals are exercised first, against the real program and cluster.
  const genesisKey=new PublicKey(domain).toBase58();
  const manifestFor=(over={})=>({cluster:'localnet',genesisHash:genesisKey,programId:program.toBase58(),mint:mint.publicKey.toBase58(),domain:genesisKey,policyDigest:policy.toString('hex'),treasury:treasury.publicKey.toBase58(),bootstrap:bootstrap.publicKey.toBase58(),roles:Object.fromEntries(roleNames.map(n=>[n,roles[n].publicKey.toBase58()])),governance:gov.map(g=>g.publicKey.toBase58()),...over});
  const refusedInit=async(why,pattern,opts)=>{await assert.rejects(initializeV2({connection,commitment:'confirmed',...opts}),e=>pattern.test(e.message),why);assert.equal(await connection.getAccountInfo(config),null,`${why}: nothing created`);checks++;};
  const otherCluster=Keypair.generate().publicKey.toBase58();
  await refusedInit('RPC genesis differs from the pinned manifest',/does not match the pinned/,{manifest:manifestFor({genesisHash:otherCluster,domain:otherCluster})});
  await refusedInit('domain differs from the pinned genesis',/domain must equal the pinned genesis/,{manifest:manifestFor({domain:otherCluster})});
  await refusedInit('mainnet-beta genesis is refused',/mainnet-beta is not supported/,{manifest:manifestFor({genesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',domain:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'})});
  await refusedInit('bootstrap is not the upgrade authority',/upgrade authority is/,{manifest:manifestFor({bootstrap:roles.issuer.publicKey.toBase58()})});
  await refusedInit('mint is not a 6-decimal token mint',/6 decimals/,{manifest:manifestFor({mint:SystemProgram.programId.toBase58()})});
  await refusedInit('a role key is reused',/duplicate key/,{manifest:manifestFor({governance:[gov[0].publicKey.toBase58(),gov[1].publicKey.toBase58(),roles.issuer.publicKey.toBase58()]})});
  await refusedInit('manifest carries an unknown field',/unknown manifest field/,{manifest:{...manifestFor(),extra:1}});
  await refusedInit('manifest is missing a field',/missing treasury/,{manifest:(({treasury:_t,...rest})=>rest)(manifestFor())});
  await refusedInit('a real run with a key that is not the bootstrap key',/not the manifest bootstrap key/,{manifest:manifestFor(),bootstrap:roles.issuer,dryRun:false});
  const rehearsal=await initializeV2({connection,manifest:manifestFor(),dryRun:true,commitment:'confirmed'});
  assert.equal(rehearsal.dryRun,true);assert.equal(rehearsal.plan.config,config.toBase58());assert.ok(rehearsal.unitsConsumed>0);
  assert.equal(await connection.getAccountInfo(config),null);checks++; // the dry run simulated and created nothing
  const initResult=await initializeV2({connection,manifest:manifestFor(),bootstrap,dryRun:false,commitment:'confirmed'});
  assert.equal(initResult.verified,true);
  { const d=(await connection.getAccountInfo(config)).data; assert.equal(d.length,819);assert.equal(d[690],1,'layout_version');assert.ok(d.subarray(691,819).every(b=>b===0)&&d.subarray(594,690).every(b=>b===0)); }
  checks++;
  await refusedInitExisting();
  async function refusedInitExisting(){await assert.rejects(initializeV2({connection,commitment:'confirmed',manifest:manifestFor(),dryRun:true}),e=>/already owns \d+ account|already exists/.test(e.message),'a second run finds the program is no longer fresh');checks++;}
  await rejectsOnChain(send([ix('buy',[],u64(1),hash('old-card-ref'))]));checks++;
  await rejectsOnChain(send([ix('initialize',[])]));checks++;
  await rejectsOnChain(send([ix('configure',[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[0].publicKey,true)],roleBytes(),u64(2_000_000),u64(10_000_000))],[gov[0]]));checks++;
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
    await send([listed(p),openSale(p,card,sale,escrow)],[roles.issuer],tables,roles.issuer); // issuer pays: another payer overruns the 1232-byte packet
    for(const [field,value] of Object.entries({domain:hash('wrong-domain'),program:SystemProgram.programId.toBuffer(),config:SystemProgram.programId.toBuffer(),card:hash('wrong-card'),pair:hash('wrong-pair'),mode:1-mode,generation:2,custodyVersion:2,authorityEpoch:3,mint:bootstrap.publicKey.toBuffer(),tokenProgram:SystemProgram.programId.toBuffer(),treasuryToken:ata(seller.publicKey).toBuffer(),total:1_000_001,refundToken:ata(buyers[1].publicKey).toBuffer()})){
      await rejectsOnChain(send([buy({...p,[field]:value},sale,card,escrow)],[roles.issuer,buyers[0]],tables));checks++;
    }
    for(const [index,signers]of [[3,[buyers[0]]],[4,[roles.issuer]]]){
      const unsigned=buy(p,sale,card,escrow);unsigned.keys[index].isSigner=false;
      await rejectsOnChain(send([unsigned],signers,tables));checks++;
    }
    assert.equal((await connection.getAccountInfo(sale)).data[698],1);
    assert.equal(await balance(ata(buyers[0].publicKey)),before[0]);
    const insufficient={...p,buyer:buyers[2].publicKey.toBuffer(),buyerToken:ata(buyers[2].publicKey).toBuffer(),refundToken:ata(buyers[2].publicKey).toBuffer()};
    await rejectsOnChain(send([buy(insufficient,sale,card,escrow)],[roles.issuer,buyers[2]],tables));
    assert.equal(await balance(ata(buyers[2].publicKey)),950000n);assert.equal(await balance(ata(seller.publicKey)),sellerBefore);assert.equal((await connection.getAccountInfo(sale)).data[698],1);checks++;
    await rejectsOnChain(send([buy({...p,expiresAt:1},sale,card,escrow)],[roles.issuer,buyers[0]],tables));checks++;
    if(mode===1){await send([ix('revise_sale',[meta(config),meta(card,false,true),meta(sale,false,true),meta(roles.issuer.publicKey,true)],u64(1))],[roles.issuer]);await rejectsOnChain(send([buy(p,sale,card,escrow)],[roles.issuer,buyers[0]],tables));p.revision=2;checks++;}
    p.expiresAt=Math.floor(Date.now()/1000)+8;
    const candidates=[p,{...p,buyer:buyers[1].publicKey.toBuffer(),buyerToken:ata(buyers[1].publicKey).toBuffer(),refundToken:ata(buyers[1].publicKey).toBuffer(),attempt:hash(`local-attempt-${caseIndex}-1`),beneficiary:hash('local-user-1')}];
    const race=await Promise.allSettled(candidates.map((q,i)=>send([buy(q,sale,card,escrow)],[roles.issuer,buyers[i]],tables)));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);checkRaceLoser(race);const winner=race.findIndex(r=>r.status==='fulfilled'),win=candidates[winner];
    await rejectsOnChain(send([ix('revoke_sale',[meta(config),meta(card,false,true),meta(sale,false,true),meta(roles.issuer.publicKey,true)])],[roles.issuer]));
    await rejectsOnChain(send([ix('revise_sale',[meta(config),meta(card,false,true),meta(sale,false,true),meta(roles.issuer.publicKey,true)],u64(win.revision))],[roles.issuer]));checks++;
    const after=await Promise.all(buyers.slice(0,2).map(b=>balance(ata(b.publicKey))));assert.equal(before[winner]-after[winner],1000000n);assert.equal(before[1-winner]-after[1-winner],0n);checks++;
    if(mode===1){
      assert.equal(await balance(ata(seller.publicKey))-sellerBefore,950000n);assert.equal(await balance(ata(treasury.publicKey))-treasuryBefore,50000n);
      await rejectsOnChain(send([acknowledge(sale,card,roles.issuer)],[roles.issuer]));
      await send([acknowledge(sale,card,roles.reconciler)],[roles.reconciler]);
      const control=(await connection.getAccountInfo(card)).data;
      assert.equal(control[153],1);assert.equal(control[104],1);assert.deepEqual(control.subarray(72,104),win.buyer);
      await rejectsOnChain(send([buy(win,sale,card,escrow)],[roles.issuer,buyers[winner]],tables));checks++;retained.push({sale,permit:win,state:3});continue;
    }
    assert.equal(await balance(escrow),1000000n);assert.equal(await balance(ata(seller.publicKey)),sellerBefore);assert.equal(await balance(ata(treasury.publicKey)),treasuryBefore);checks++;
    await rejectsOnChain(send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]));
    await rejectsOnChain(send([staff('record_receipt',win,sale,roles.issuer,0)],[roles.issuer]));
    await rejectsOnChain(send([staff('record_authentication',win,sale,roles.authenticator,1,0,true)],[roles.authenticator]));
    await rejectsOnChain(send([staff('record_receipt',{...win,pair:hash('wrong-delivered-pair')},sale,roles.receiver,0)],[roles.receiver]));checks++;
    await send([staff('record_receipt',win,sale,roles.receiver,0)],[roles.receiver]);
    await rejectsOnChain(send([acknowledge(sale,card,roles.reconciler)],[roles.reconciler]));
    assert.equal((await connection.getAccountInfo(card)).data[153],0);
    await rejectsOnChain(send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]));checks++;
    const refund=caseIndex===0;
    await send([staff('record_authentication',win,sale,roles.authenticator,refund?2:1,0,!refund)],[roles.authenticator]);
    if(refund){await rejectsOnChain(send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]));await send([governSale('authorize_refund',win,sale,4)],gov.slice(0,2));}
    else{await send([staff('authorize_release',win,sale,roles.release,3)],[roles.release]);await rejectsOnChain(send([governSale('authorize_refund',win,sale,4)],gov.slice(0,2)));}checks++;
    const dust=7n;await send([new TransactionInstruction({programId:token,keys:[meta(ata(buyers[1-winner].publicKey),false,true),meta(escrow,false,true),meta(buyers[1-winner].publicKey,true)],data:Buffer.concat([Buffer.from([3]),u64(dust)])})],[buyers[1-winner]]);
    await send([ix('set_pause',governKeys(),Buffer.from([1,0]))],gov.slice(0,2));
    if(caseIndex===2){
      // Future terms rotate; this ALREADY funded escrow must retain old accounts.
      await send([ix('update_future_terms',governKeys(),Keypair.generate().publicKey.toBuffer(),hash('local-future-policy'))],gov.slice(0,2));checks++;
    }
    await send([ix('emergency_pause',[meta(config,false,true),meta(roles.guardian.publicKey,true)],Buffer.from([1]))],[roles.guardian]);
    await rejectsOnChain(send([outcome(win,sale,escrow,1)]));assert.equal(await balance(escrow),1000007n);checks++;
    await send([ix('set_pause',governKeys(),Buffer.from([1,0]))],gov.slice(0,2));
    await rejectsOnChain(send([outcome(win,sale,escrow,0)]));
    // Recovery commands remain executable after the original permit expires.
    while(Math.floor(Date.now()/1000)<=win.expiresAt)await pause(250);
    const beforeRefund=await balance(new PublicKey(win.refundToken));
    await rejectsOnChain(send([outcome(win,sale,escrow,1),outcome(win,sale,escrow,1)]));
    assert.equal(await balance(escrow),1000007n);checks++;
    const exits=await Promise.allSettled([send([outcome(win,sale,escrow,1)]),send([outcome(win,sale,escrow,1)]),send([governSale('authorize_refund',win,sale,4,1)],gov.slice(0,2))]);assert.equal(exits.filter(r=>r.status==='fulfilled').length,1);checkRaceLoser(exits);
    assert.equal(await balance(escrow),dust);assert.equal((await connection.getAccountInfo(sale)).data[698],refund?5:4);
    if(refund){assert.equal(await balance(new PublicKey(win.refundToken))-beforeRefund,1000000n);assert.equal(await balance(ata(seller.publicKey)),sellerBefore);assert.equal(await balance(ata(treasury.publicKey)),treasuryBefore);}
    else{assert.equal(await balance(ata(seller.publicKey))-sellerBefore,950000n);assert.equal(await balance(ata(treasury.publicKey))-treasuryBefore,50000n);}
    await rejectsOnChain(send([outcome(win,sale,escrow,1)]));checks++;
    await send([acknowledge(sale,card,roles.reconciler)],[roles.reconciler]);
    const control=(await connection.getAccountInfo(card)).data;
    assert.equal(control[153],1);assert.equal(control[154],refund?1:0);
    if(!refund)assert.deepEqual(control.subarray(72,104),win.buyer);
    await rejectsOnChain(send([acknowledge(sale,card,roles.reconciler)],[roles.reconciler]));checks++;
    retained.push({sale,permit:win,state:refund?5:4});
    console.log(`LOCAL case ${caseIndex}: ${refund?'full refund':'95/5 release'}; original permit expired, terminal retained, replay rejected`);
    await send([ix('set_pause',governKeys(),Buffer.from([0,0]))],gov.slice(0,2));
  }
  const finalSlot=await connection.getSlot('confirmed');
  for(let i=0;await connection.getSlot('finalized')<finalSlot;i++){
    if(i>=120)throw new Error('Local finalized recovery evidence timed out');await pause(500);
  }
  for(const {sale,permit,state}of retained){
    const data=(await connection.getAccountInfo(sale,'finalized')).data;
    assert.equal(data.length,1090);assert.equal(data[698],state); // 961 before P1; +32 (auth time, delay, floor, listing expiry) +1 layout_version +96 reserved
    assert.equal(data[993],1,"layout_version");assert.ok(data.subarray(994,1090).every(b=>b===0));
    assert.equal(data.readBigUInt64LE(977),BigInt(LISTING_FLOOR));assert.ok(data.readBigInt64LE(985)>BigInt(nowSeconds())); // min_total, list_expires_at
    assert.deepEqual(data.subarray(8,698),encode(permit));
    assert.ok(data.readBigUInt64LE(700)>0n);
    assert.ok(data.readBigInt64LE(708)>=BigInt(permit.validFrom)&&data.readBigInt64LE(708)<BigInt(permit.expiresAt));
    if(state!==3)assert.ok(data.readBigUInt64LE(716)>0n);
  }checks++;
  // ======================= P1 upgrade scenarios =======================
  // Run AFTER the original groups above, which are unchanged apart from the listing instruction that open_sale now requires.
  // Each refusal asserts the program's own custom error code, so a refusal cannot pass for an unrelated reason.
  const p1Start=checks;
  const readConfig=async()=>(await connection.getAccountInfo(config)).data,readSale=async s=>(await connection.getAccountInfo(s)).data;
  const gSet=(funding,outflow=false)=>send([ix('set_pause',governKeys(),Buffer.from([funding?1:0,outflow?1:0]))],gov.slice(0,2));
  const setDelay=(n,keys=governKeys(),signers=gov.slice(0,2))=>send([ix('set_release_delay',keys,i64(n))],signers);
  const chainNow=async()=>{for(let i=0;i<40;i++){const t=await connection.getBlockTime(await connection.getSlot('confirmed')).catch(()=>null);if(t)return t;await pause(250);}throw new Error('chain time unavailable');};
  const waitChain=async t=>{while(await chainNow()<=t)await pause(400);};
  const split=total=>{const fee=Math.floor(total*500/10000);return {total,fee,net:total-fee};};
  // The main loop's last case rotated treasury/policy to unfunded accounts; restore the originals so fresh sales reuse the ATAs.
  await gSet(true);
  await send([ix('update_future_terms',governKeys(),treasury.publicKey.toBuffer(),policy)],gov.slice(0,2));
  await gSet(false);
  const epoch=Number((await readConfig()).readBigUInt64LE(552));
  await mintTo(buyers[0].publicKey,10_000_000);
  const fresh=async(label,mode=0)=>{
    const cardId=hash(`p1-card-${label}`),pair=hash(`p1-pair-${label}`),saleId=hash(`p1-sale-${label}`),card=pda(Buffer.from('card-v2'),cardId),sale=pda(Buffer.from('sale-v2'),saleId),escrow=pda(Buffer.from('escrow-v2'),sale.toBuffer());
    const p={mode,domain,program:program.toBuffer(),config:config.toBuffer(),saleId,card:cardId,pair,attempt:hash(`p1-attempt-${label}`),beneficiary:hash('p1-user'),policy,buyer:buyers[0].publicKey.toBuffer(),seller:seller.publicKey.toBuffer(),treasury:treasury.publicKey.toBuffer(),mint:mint.publicKey.toBuffer(),tokenProgram:token.toBuffer(),buyerToken:ata(buyers[0].publicKey).toBuffer(),sellerToken:ata(seller.publicKey).toBuffer(),treasuryToken:ata(treasury.publicKey).toBuffer(),refundToken:ata(buyers[0].publicKey).toBuffer(),issuer:roles.issuer.publicKey.toBuffer(),generation:1,revision:1,custodyVersion:1,authorityEpoch:epoch,...split(1_000_000),validFrom:0,expiresAt:nowSeconds()+7200};
    await send([ix('register_card',[meta(config),meta(card,false,true),meta(roles.inventory.publicKey,true,true),meta(roles.authenticator.publicKey,true),meta(SystemProgram.programId)],cardId,pair,seller.publicKey.toBuffer(),Buffer.from([mode]))],[roles.inventory,roles.authenticator]);
    const tables=await table([config,card,sale,escrow,mint.publicKey,ata(seller.publicKey),ata(treasury.publicKey),...buyers.map(b=>ata(b.publicKey)),token,SystemProgram.programId,SYSVAR_RENT_PUBKEY,SYSVAR_INSTRUCTIONS_PUBKEY]);
    return {p,card,sale,escrow,tables};
  };
  const openTx=(s,pre)=>send([...pre,openSale(s.p,s.card,s.sale,s.escrow)],[roles.issuer],s.tables,roles.issuer);
  const openFor=(s,opts)=>openTx(s,[listed(s.p,opts)]);
  const buyFor=(s,total)=>send([buy({...s.p,...split(total)},s.sale,s.card,s.escrow)],[roles.issuer,buyers[0]],s.tables);

  // --- 1. Seller-signed listing: every refusal path on open_sale ---
  const L=await fresh('listing'),L2=await fresh('listing-replay'),X=await fresh('expiry');
  const goodMessage=()=>listingMessage(L.p,LISTING_FLOOR,nowSeconds()+3600);
  for(const [why,code,pre] of [
    ['no signature instruction',FAULT.ListingInvalid,[]],
    ['signature not immediately before open_sale',FAULT.ListingInvalid,[listed(L.p),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1})]],
    ['signed by someone other than the card owner',FAULT.ListingSigner,[listed(L.p,{signer:Keypair.generate()})]],
    ['signed for a different sale id',FAULT.ListingInvalid,[listed(L.p,{over:{saleId:hash('other-sale')}})]],
    ['signed for a different card',FAULT.ListingInvalid,[listed(L.p,{over:{card:hash('other-card')}})]],
    ['signed for a different generation',FAULT.ListingInvalid,[listed(L.p,{over:{generation:2}})]],
    ['signed for a different network (domain)',FAULT.ListingInvalid,[listed(L.p,{over:{domain:hash('other-domain')}})]],
    ['signed for a different program',FAULT.ListingInvalid,[listed(L.p,{over:{program:SystemProgram.programId.toBuffer()}})]],
    ['trailing byte after the message',FAULT.ListingInvalid,[listed(L.p,{message:Buffer.concat([goodMessage(),Buffer.from([0])])})]],
    ['truncated message',FAULT.ListingInvalid,[listed(L.p,{message:goodMessage().subarray(0,60)})]],
    ['expired when opened',FAULT.ListingExpired,[listed(L.p,{exp:nowSeconds()-1})]],
    ['zero price floor',FAULT.ListingExpired,[listed(L.p,{min:0})]],
    ['signature valid for ANOTHER sale replayed on this one',FAULT.ListingInvalid,[listed(L2.p)]],
  ]){await rejectsWith(code,openTx(L,pre));checks++;}
  // A forged signature never reaches the program: the runtime's own Ed25519 precompile (instruction 1) rejects the transaction.
  const forged=Ed25519Program.createInstructionWithPublicKey({publicKey:seller.publicKey.toBytes(),message:goodMessage(),signature:Buffer.alloc(64,1)});
  await assert.rejects(openTx(L,[forged]),e=>isInstructionFailure(e)&&e.chainError.InstructionError[0]===1,'forged signature must fail in the precompile');checks++;
  assert.equal(await connection.getAccountInfo(L.sale),null);checks++; // nothing was created by any refused attempt
  const listExpiry=nowSeconds()+3600;
  await openFor(L,{exp:listExpiry});
  let ld=await readSale(L.sale);
  assert.equal(ld.length,1090);assert.equal(ld[993],1);assert.equal(ld.readBigUInt64LE(977),BigInt(LISTING_FLOOR));assert.equal(ld.readBigInt64LE(985),BigInt(listExpiry));assert.equal(ld.readBigInt64LE(961),0n);checks++;
  await assert.rejects(openFor(L,{exp:listExpiry}),isInstructionFailure);checks++; // the same signed listing cannot open a second sale account

  // --- 2. Floor and listing expiry on buy_sale ---
  const xExpiry=(await chainNow())+12;
  await openFor(X,{exp:xExpiry}); // lapses while the scenarios below run
  for(const total of [979_999,940_000,1]){await rejectsWith(FAULT.BelowFloor,buyFor(L,total));checks++;}
  assert.equal((await readSale(L.sale))[698],1);
  await buyFor(L,LISTING_FLOOR); // exactly the floor is allowed
  assert.equal((await readSale(L.sale))[698],2);assert.equal(await balance(L.escrow),BigInt(LISTING_FLOOR));checks++;

  // --- 3. Release delay: governance-set, snapshotted per sale, measured from the passing authentication ---
  await rejectsWith(FAULT.Paused,setDelay(5));checks++; // funding is live
  await gSet(true);
  await rejectsWith(FAULT.Authority,setDelay(5,[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[0].publicKey,true)],[gov[0]]));checks++; // one governor is not enough
  await rejectsWith(FAULT.DelayRange,setDelay(-1));await rejectsWith(FAULT.DelayRange,setDelay(2_592_001));checks++;
  await setDelay(2_592_000);assert.equal((await readConfig()).readBigInt64LE(586),2_592_000n);await setDelay(0);await setDelay(6);
  assert.equal((await readConfig()).readBigInt64LE(586),6n);checks++;
  const w={...L.p,...split(LISTING_FLOOR)}; // the terms stored by the buy at exactly the floor
  await send([staff('record_receipt',w,L.sale,roles.receiver,0)],[roles.receiver]);
  await send([staff('record_authentication',w,L.sale,roles.authenticator,1,0,true)],[roles.authenticator]);
  ld=await readSale(L.sale);const authAt=ld.readBigInt64LE(961);
  assert.ok(authAt>0n&&ld.readBigInt64LE(969)===6n,'authentication time and delay snapshot are recorded');checks++;
  await rejectsWith(FAULT.ReleaseDelay,send([staff('authorize_release',w,L.sale,roles.release,3)],[roles.release]));checks++;
  await setDelay(0); // governance shortens the delay AFTER this sale authenticated: its own snapshot still applies
  await rejectsWith(FAULT.ReleaseDelay,send([staff('authorize_release',w,L.sale,roles.release,3)],[roles.release]));checks++;
  await waitChain(Number(authAt)+6);
  await send([staff('authorize_release',w,L.sale,roles.release,3)],[roles.release]);
  const sellerBeforeRelease=await balance(ata(seller.publicKey)),treasuryBeforeRelease=await balance(ata(treasury.publicKey));
  await send([outcome(w,L.sale,L.escrow,1)]);
  assert.equal(await balance(ata(seller.publicKey))-sellerBeforeRelease,BigInt(split(LISTING_FLOOR).net));assert.equal(await balance(ata(treasury.publicKey))-treasuryBeforeRelease,BigInt(split(LISTING_FLOOR).fee));checks++;

  // --- 4. Release delay after a REVIEWED authentication (auth fail -> hold -> reviewer pass -> governance clears -> release) ---
  const R=await fresh('review');
  await setDelay(6);await gSet(false); // open_sale and buy_sale need funding live; the delay was set while paused
  await openFor(R);
  await buyFor(R,1_000_000);
  const rw=R.p;
  await send([staff('record_receipt',rw,R.sale,roles.receiver,0)],[roles.receiver]);
  await send([staff('record_authentication',rw,R.sale,roles.authenticator,2,0,false)],[roles.authenticator]);
  assert.equal((await readSale(R.sale)).readBigInt64LE(961),0n);checks++; // a failed authentication starts no clock
  await send([staff('dispute_hold',rw,R.sale,roles.guardian,5,0)],[roles.guardian]);
  await send([staff('review_authentication',rw,R.sale,roles.reviewer,8,1,true)],[roles.reviewer]);
  const reviewAt=(await readSale(R.sale)).readBigInt64LE(961);
  assert.ok(reviewAt>0n&&(await readSale(R.sale)).readBigInt64LE(969)===6n);checks++; // the passing review starts the clock
  await send([ix('resolve_dispute',[meta(config),meta(R.sale,false,true),meta(gov[0].publicKey,true),meta(gov[1].publicKey,true)],attest(rw,R.sale,6,1),Buffer.from([0]))],gov.slice(0,2));
  await rejectsWith(FAULT.ReleaseDelay,send([staff('authorize_release',rw,R.sale,roles.release,3,2)],[roles.release]));checks++;
  await waitChain(Number(reviewAt)+6);
  await send([staff('authorize_release',rw,R.sale,roles.release,3,2)],[roles.release]);checks++;

  // --- 5. The seller's own listing expiry stops a late buy, whatever the issuer signs ---
  await waitChain(xExpiry+1);
  await rejectsWith(FAULT.ListingExpired,buyFor(X,1_000_000));checks++;
  assert.equal((await readSale(X.sale))[698],1);

  // --- 6. Governance: guardian pauses alone; two-phase vault enrollment (R1-02) ---
  await rejectsOnChain(send([ix('emergency_pause',[meta(config,false,true),meta(roles.issuer.publicKey,true)],Buffer.from([0]))],[roles.issuer]));checks++; // only the guardian key
  await send([ix('emergency_pause',[meta(config,false,true),meta(roles.guardian.publicKey,true)],Buffer.from([0]))],[roles.guardian]); // alone: no governor involved
  let cfg=await readConfig();assert.equal(cfg[560],1);assert.equal(cfg[561],0);checks++;
  const mockPda=id=>PublicKey.findProgramAddressSync([Buffer.from('mock-vault')],id)[0];
  const unsignable=PublicKey.findProgramAddressSync([Buffer.from('typo')],SystemProgram.programId)[0]; // off-curve, but no program derives or can sign for it
  assert.ok(!PublicKey.isOnCurve(unsignable.toBytes()));
  const POLICY=hash('p1-vault-policy'),ZERO=PublicKey.default;
  const propose=(v,controller,pol=POLICY,keys=governKeys())=>ix('propose_governance_vault',keys,v.toBuffer(),controller.toBuffer(),pol);
  const accept=(v,rev=0)=>ix('accept_governance_vault',[meta(config,false,true),meta(v,true),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],u64(rev));
  const state=async()=>{const d=await readConfig();return {active:new PublicKey(d.subarray(488,520)),activePolicy:Buffer.from(d.subarray(520,552)),pending:new PublicKey(d.subarray(594,626)),controller:new PublicKey(d.subarray(626,658)),pendingPolicy:Buffer.from(d.subarray(658,690))};};
  const rejectsBuiltin=async(name,promise)=>assert.rejects(promise,e=>isInstructionFailure(e)&&e.chainError.InstructionError[1]===name,`expected runtime error ${name}`);
  const nativeStillGoverns=async why=>{await setDelay(86_400);assert.equal((await readConfig()).readBigInt64LE(586),86_400n,why);await gSet(true);}; // 2-of-3 native keys still work
  const nativeGovernedCalls=[['set_pause',governKeys(),Buffer.from([0,0])],['set_release_delay',governKeys(),i64(5)],['configure',governKeys(),roleBytes(),u64(2_000_000),u64(10_000_000)],['update_future_terms',governKeys(),treasury.publicKey.toBuffer(),policy]];
  let vaultChecks='SKIPPED (no mock vault .so supplied; CPI-signed vault path NOT exercised)';

  // 6a. Proposal refusals. Every one leaves governance and the pending slot untouched.
  const V1=mockPda(mockId),V2=mockPda(mockId2);
  await gSet(false);
  await rejectsWith(FAULT.Authority,send([propose(V1,mockId)],gov.slice(0,2)));checks++; // funding must be paused
  await gSet(true);
  await rejectsWith(FAULT.Authority,send([propose(Keypair.generate().publicKey,mockId)],gov.slice(0,2)));checks++; // NEGATIVE CURVE: a wallet-style (on-curve) key can never be a vault
  await rejectsWith(FAULT.Authority,send([propose(V1,mockId,Buffer.alloc(32))],gov.slice(0,2)));checks++; // needs a policy digest
  await rejectsWith(FAULT.Authority,send([propose(V1,ZERO)],gov.slice(0,2)));checks++; // needs a controlling program
  await rejectsWith(FAULT.Authority,send([propose(V1,V1)],gov.slice(0,2)));checks++; // the controller cannot be the vault itself
  await rejectsWith(FAULT.Authority,send([propose(V1,mockId,POLICY,[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[0].publicKey,true)])],[gov[0]]));checks++; // one governor
  let st=await state();assert.ok(st.pending.equals(ZERO)&&st.active.equals(ZERO));checks++;
  { const stranger=Keypair.generate(); await rejectsWith(FAULT.Authority,send([accept(stranger.publicKey)],[stranger])); } // nothing pending: a real signer that is not the (empty) pending key is refused
  checks++;

  // 6b. TYPO / UNSIGNABLE ADDRESS never activates, and native governance keeps working throughout.
  await send([propose(unsignable,mockId)],gov.slice(0,2));
  st=await state();assert.ok(st.pending.equals(unsignable)&&st.active.equals(ZERO)&&st.controller.equals(mockId)&&st.pendingPolicy.equals(POLICY));checks++;
  await nativeStillGoverns('native governance is unchanged while a proposal is pending');checks++;
  await rejectsWith(3010,send([ix('accept_governance_vault',[meta(config,false,true),meta(unsignable,false),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],u64(0))]));checks++; // AccountNotSigner: nobody can sign for it
  if(mockSo){
    // The mock program signs for its OWN PDA through invoke_signed, and marks any account flagged "signer" as a signer in the CPI.
    const viaMock=(id,name,keys,...data)=>{
      const inner=ix(name,keys,...data),flags=inner.keys.map(k=>(k.isSigner?1:0)|(k.isWritable?2:0)),pdas=[V1,V2,unsignable];
      return new TransactionInstruction({programId:id,keys:[meta(program),...inner.keys.map(k=>meta(k.pubkey,k.isSigner&&!pdas.some(p=>p.equals(k.pubkey)),k.isWritable))],data:Buffer.concat([Buffer.from([inner.keys.length]),Buffer.from(flags),inner.data])});
    };
    const acceptVia=(id,v,rev)=>viaMock(id,'accept_governance_vault',[meta(config,false,true),meta(v,true),meta(SYSVAR_INSTRUCTIONS_PUBKEY)],u64(rev));
    // C -> D -> settlement: the top-level program (mock `outer`) calls the other mock (`inner`), which calls accept. `forward` makes
    // the inner mock pass the vault along as a signer (the signer privilege the outer mock created); otherwise the inner mock
    // signs with its own PDA. Either way settlement runs at stack height 3.
    const nestedAccept=(outer,inner,v,rev,forward)=>{
      const acceptData=Buffer.concat([disc('accept_governance_vault'),u64(rev)]);
      const innerPayload=Buffer.concat([Buffer.from([3]),Buffer.from([2,forward?1:0,0]),acceptData]); // inner mock: config (w), vault, sysvar
      const accounts=[meta(inner),meta(program),meta(config,false,true),meta(v),meta(SYSVAR_INSTRUCTIONS_PUBKEY)];
      return new TransactionInstruction({programId:outer,keys:accounts,data:Buffer.concat([Buffer.from([4]),Buffer.from([0,2,0,0]),innerPayload])});
    };
    const revision=async()=>(await readConfig()).readBigUInt64LE(691);
    const rolesWith=(name,key)=>Buffer.concat(roleNames.map(n=>(n===name?key:roles[n].publicKey).toBuffer()));
    const configureWith=(rolesBytes,signers=gov.slice(0,2))=>send([ix('configure',governKeys(),rolesBytes,u64(2_000_000),u64(10_000_000))],signers);
    const POLICY2=hash('p1-vault-policy-2');
    await rejectsBuiltin('PrivilegeEscalation',send([acceptVia(mockId,unsignable,await revision())]));checks++;
    st=await state();assert.ok(st.active.equals(ZERO));checks++; // still not activated

    // 6c. WRONG CONTROLLER / WRONG PROGRAM. Pending vault is mock #1's PDA, but the proposal names mock #2 as its controller.
    await send([propose(V1,mockId2)],gov.slice(0,2));
    await rejectsWith(FAULT.WrongController,send([acceptVia(mockId,V1,await revision())]));checks++; // valid vault signature, direct CPI, wrong top-level program
    await rejectsBuiltin('PrivilegeEscalation',send([acceptVia(mockId2,V1,await revision())]));checks++; // the named controller cannot sign for a PDA it does not own
    await rejectsWith(FAULT.Authority,send([acceptVia(mockId2,V2,await revision())]));checks++; // its own PDA, but not the pending vault
    st=await state();assert.ok(st.active.equals(ZERO)&&st.pending.equals(V1));checks++;
    await nativeStillGoverns('a vault that never accepts leaves native governance working');checks++;

    // 6c2. R2-01: DIRECT CPI ONLY. In both nested shapes the top-level program IS the named controller and the vault really signs;
    // only the stack height (3, not 2) distinguishes them from a legitimate accept.
    await send([propose(V2,mockId)],gov.slice(0,2)); // controller C = mock #1, vault = D's (mock #2) PDA
    await rejectsWith(FAULT.NotDirectCall,send([nestedAccept(mockId,mockId2,V2,await revision(),false)]));checks++; // C -> D -> settlement, D signs with its own PDA
    st=await state();assert.ok(st.active.equals(ZERO)&&st.pending.equals(V2));checks++;
    await send([propose(V1,mockId)],gov.slice(0,2)); // controller C = mock #1, vault = C's own PDA
    await rejectsWith(FAULT.NotDirectCall,send([nestedAccept(mockId,mockId2,V1,await revision(),true)]));checks++; // C -> D, C's vault signer passed onward to settlement
    st=await state();assert.ok(st.active.equals(ZERO)&&st.pending.equals(V1));checks++;

    // 6c3. R2-05: proposal identity and cancellation. Revisions only ever increase.
    const r0=await revision();
    await send([propose(V1,mockId,POLICY2)],gov.slice(0,2)); // same vault and controller, ONLY the policy digest differs
    const r1=await revision();assert.ok(r1>r0&&r1===r0+BigInt(1));checks++;
    await rejectsWith(FAULT.StaleProposal,send([acceptVia(mockId,V1,r0)]));checks++; // an accept approved for the old proposal cannot activate the new one
    st=await state();assert.ok(st.active.equals(ZERO)&&st.pendingPolicy.equals(POLICY2));checks++;
    await rejectsWith(FAULT.Authority,send([ix('cancel_governance_vault_proposal',[meta(config,false,true),meta(gov[0].publicKey,true),meta(gov[0].publicKey,true)])],[gov[0]]));checks++; // one governor cannot cancel
    await send([ix('cancel_governance_vault_proposal',governKeys())],gov.slice(0,2));
    st=await state();assert.ok(st.pending.equals(ZERO)&&st.controller.equals(ZERO)&&st.pendingPolicy.every(b=>b===0));
    assert.equal(await revision(),r1,'cancel never decreases or resets the revision');checks++;
    await rejectsWith(FAULT.Authority,send([acceptVia(mockId,V1,r1)]));checks++; // cancel then accept: nothing pending to accept
    await rejectsWith(FAULT.NoPendingVault,send([ix('cancel_governance_vault_proposal',governKeys())],gov.slice(0,2)));checks++;
    await send([propose(V1,mockId)],gov.slice(0,2));
    const r2=await revision();assert.ok(r2===r1+BigInt(1)&&r2>r0);checks++;
    for(const stale of [r0,r1])await rejectsWith(FAULT.StaleProposal,send([acceptVia(mockId,V1,stale)]));
    checks++;
    assert.ok((await state()).active.equals(ZERO));

    // 6c4. R2-04: a vault never shares a key with a role or native member, in either order.
    // Order 1: V1 is pending, then governance tries to give it to a role / native seat.
    await rejectsWith(FAULT.VaultConflict,configureWith(rolesWith('reconciler',V1)));checks++;
    await rejectsWith(FAULT.VaultConflict,send([ix('rotate_governance',governKeys(),Buffer.concat([gov[0].publicKey.toBuffer(),gov[1].publicKey.toBuffer(),V1.toBuffer()]))],gov.slice(0,2)));checks++;
    // Order 2: a role already holds the key, then it is proposed as the vault.
    await send([ix('cancel_governance_vault_proposal',governKeys())],gov.slice(0,2));
    const roleKey=PublicKey.findProgramAddressSync([Buffer.from('role-key')],SystemProgram.programId)[0]; // off-curve, so only the role check can refuse it
    await configureWith(rolesWith('reconciler',roleKey));
    assert.ok(new PublicKey((await readConfig()).subarray(136+32*6,136+32*7)).equals(roleKey));
    await rejectsWith(FAULT.VaultConflict,send([propose(roleKey,mockId)],gov.slice(0,2)));checks++;
    await configureWith(roleBytes()); // restore the original roles
    assert.ok(new PublicKey((await readConfig()).subarray(136+32*6,136+32*7)).equals(roles.reconciler.publicKey));checks++;
    // A native member is excluded too.
    await send([ix('rotate_governance',governKeys(),Buffer.concat([gov[0].publicKey.toBuffer(),gov[1].publicKey.toBuffer(),roleKey.toBuffer()]))],gov.slice(0,2)); // a native seat holds the key
    await rejectsWith(FAULT.VaultConflict,send([propose(roleKey,mockId)],gov.slice(0,2)));checks++;
    await send([ix('rotate_governance',governKeys(),Buffer.concat(gov.map(g=>g.publicKey.toBuffer())))],gov.slice(0,2)); // restore native members
    assert.ok(new PublicKey((await readConfig()).subarray(392+64,392+96)).equals(gov[2].publicKey));checks++;
    await nativeStillGoverns('role and member conflicts left native governance intact');

    // 6d. Correct proposal. Acceptance is refused while funding is live, then succeeds once, directly, with the current revision.
    await send([propose(V1,mockId)],gov.slice(0,2));
    const live=await revision();
    await gSet(false);
    await rejectsWith(FAULT.Paused,send([acceptVia(mockId,V1,live)]));checks++;
    await gSet(true);
    { const signature=await send([acceptVia(mockId,V1,live)]); cuLog.push({name:'accept_governance_vault (whole tx, via mock CPI)',signature}); } // the DIRECT-CPI positive
    st=await state();assert.ok(st.active.equals(V1)&&st.activePolicy.equals(POLICY)&&st.pending.equals(ZERO)&&st.controller.equals(ZERO)&&st.pendingPolicy.every(b=>b===0));
    assert.equal(await revision(),live,'accepting does not change the revision');checks++;
    await rejectsWith(FAULT.Authority,send([acceptVia(mockId,V1,live)]));checks++; // replay: nothing pending any more
    for(const [name,keys,...data]of nativeGovernedCalls){await rejectsWith(FAULT.Authority,send([ix(name,keys,...data)],gov.slice(0,2)));checks++;} // natives are shut out
    await rejectsWith(FAULT.Authority,send([propose(V2,mockId2)],gov.slice(0,2)));checks++; // and cannot re-propose either
    await rejectsWith(FAULT.Authority,send([ix('cancel_governance_vault_proposal',governKeys())],gov.slice(0,2)));checks++; // nor cancel
    await rejectsOnChain(send([ix('set_pause',[meta(config,false,true),meta(V1),meta(V1)],Buffer.from([0,0]))]));checks++; // the vault cannot be impersonated without a CPI signature

    // 6e. Vault-governed operation, guardian alone.
    const vaultKeys=[meta(config,false,true),meta(V1,true),meta(V1,true)];
    await rejectsWith(FAULT.Authority,send([viaMock(mockId,'set_pause',[meta(config,false,true),meta(V1,true),meta(gov[0].publicKey,true)],Buffer.from([0,0]))],[gov[0]]));checks++; // vault + one native key is not governance
    await send([viaMock(mockId,'set_pause',vaultKeys,Buffer.from([0,0]))]);
    cfg=await readConfig();assert.equal(cfg[560],0,'vault unpaused funding');checks++;
    await send([ix('emergency_pause',[meta(config,false,true),meta(roles.guardian.publicKey,true)],Buffer.from([0]))],[roles.guardian]);
    cfg=await readConfig();assert.equal(cfg[560],1,'guardian paused alone while the vault governs');checks++;
    await rejectsWith(FAULT.Authority,send([ix('set_pause',governKeys(),Buffer.from([0,0]))],gov.slice(0,2)));checks++;
    await send([viaMock(mockId,'set_release_delay',vaultKeys,i64(86_400))]);
    assert.equal((await readConfig()).readBigInt64LE(586),86_400n);checks++;
    await send([viaMock(mockId,'set_pause',vaultKeys,Buffer.from([0,0]))]);
    assert.equal((await readConfig())[560],0);checks++;
    vaultChecks='exercised with CPI-signed PDA vaults (mock programs; NOT the Squads program)';
  }
  console.log(`P1 scenarios: ${checks-p1Start} groups passed; vault path: ${vaultChecks}`);
  await reportComputeUnits();
  console.log(`LOCAL VALIDATOR ONLY: ${checks} on-chain scenario groups passed; no database integration asserted.`);
} finally {
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(5000)]);}
  // Delete only the unique directory created by THIS helper, after process exit.
  if((!child||child.exitCode!==null)&&dirname(resolve(root))===resolve(tmpdir())&&basename(root).startsWith('flexsoar-local-'))rmSync(root,{recursive:true,force:true});
}
// The web3.js websocket client keeps retrying against the stopped validator and would keep this process alive for hours.
// Reached only on success (a failure throws and exits non-zero before here): every assertion has already passed.
process.exit(0);
