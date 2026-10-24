import { afterEach, describe, expect, it } from 'vitest';
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { AddressLookupTableAccount, AddressLookupTableProgram, Ed25519Program, Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { associatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/solana/sdk';
import { encodeListing, listingBinding, listingFloor, verifyListingSignature } from '@/lib/solana/listing-v2';
import { decodePermit, encodePermit, type PermitV2 } from '@/lib/solana/protocol-v2';
import { buyV2Instruction, v2Addresses } from '@/lib/solana/v2-sdk';
import { createSignerCore } from './core';
import { validateSignerPins, validateSignerRequest } from './validator';
import { buildOpenSalePair } from '@/workers/issuer/open-sale-pair';
import { runOpenSaleSubmitter } from '@/workers/issuer/open-sale-submitter';
import type { OpenSalePairSignRequest, SignerAlert, SignerPins } from './types';
import type { IssuerContext, IssuerDatabase } from '@/workers/issuer/types';

const tempRoots:string[]=[];
afterEach(()=>{for(const path of tempRoots.splice(0))rmSync(path,{recursive:true,force:true});});
function temp(){const root=mkdtempSync(join(tmpdir(),'issuer-signer-test-'));tempRoots.push(root);return root;}
function keyBytes(key:PublicKey|Keypair):Uint8Array{return key instanceof Keypair?key.publicKey.toBytes():key.toBytes();}
function hashAddressList(addresses:readonly string[]):string{return createHash('sha256').update(Buffer.concat(addresses.map(address=>Buffer.from(new PublicKey(address).toBytes())))).digest('hex');}
async function createFixture(){
  const issuer=Keypair.generate(),seller=Keypair.generate(),buyer=Keypair.generate(),treasury=Keypair.generate(),mint=Keypair.generate().publicKey,program=Keypair.generate().publicKey,domain=Keypair.generate().publicKey;
  const card=Keypair.generate().publicKey.toBytes(),saleId=Keypair.generate().publicKey.toBytes(),addresses=v2Addresses(program.toBase58(),card,saleId);
  const attempt=Uint8Array.from(createHash('sha256').update('local-attempt').digest());
  const permit:PermitV2={domain:domain.toBytes(),program:program.toBytes(),config:addresses.config.toBytes(),saleId,card,pair:Keypair.generate().publicKey.toBytes(),attempt,beneficiary:Keypair.generate().publicKey.toBytes(),policy:Keypair.generate().publicKey.toBytes(),buyer:buyer.publicKey.toBytes(),seller:seller.publicKey.toBytes(),treasury:treasury.publicKey.toBytes(),mint:mint.toBytes(),tokenProgram:new PublicKey(TOKEN_PROGRAM_ID).toBytes(),buyerToken:new PublicKey(associatedTokenAddress(buyer.publicKey.toBase58(),mint.toBase58())).toBytes(),sellerToken:new PublicKey(associatedTokenAddress(seller.publicKey.toBase58(),mint.toBase58())).toBytes(),treasuryToken:new PublicKey(associatedTokenAddress(treasury.publicKey.toBase58(),mint.toBase58())).toBytes(),refundToken:Keypair.generate().publicKey.toBytes(),issuer:issuer.publicKey.toBytes(),generation:BigInt('1'),revision:BigInt('1'),custodyVersion:BigInt('1'),authorityEpoch:BigInt('1'),total:BigInt('1000000'),net:BigInt('950000'),fee:BigInt('50000'),validFrom:BigInt(Math.floor(Date.now()/1000)-5),expiresAt:BigInt(Math.floor(Date.now()/1000)+300),mode:1};
  const pins:SignerPins={issuer:issuer.publicKey.toBase58(),program:program.toBase58(),genesis:domain.toBase58(),mint:mint.toBase58(),tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId.toBase58(),rentSysvar:SYSVAR_RENT_PUBKEY.toBase58(),instructionsSysvar:SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),ed25519Program:Ed25519Program.programId.toBase58(),lookupTables:[],maxBlockhashAge:150,maxFloorToleranceBps:200};
  const message=await encodeListing({domain:permit.domain,program:permit.program,card:permit.card,saleId:permit.saleId,generation:permit.generation,minTotal:listingFloor(permit.total),expiresAt:permit.expiresAt+BigInt('1000')});
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seller.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  const sellerSignature=Uint8Array.from(cryptoSign(null,Buffer.from(message),privateKey));
  return {issuer,seller,buyer,treasury,permit,pins,message,sellerSignature};
}
const blockhash=Keypair.generate().publicKey.toBase58();
function openRequest(f:Awaited<ReturnType<typeof createFixture>>,transactionBase64url:string):OpenSalePairSignRequest{return {kind:'open-sale-pair',requestId:'open-test-request',saleId:'11111111-1111-4111-8111-111111111111',permitBase64url:Buffer.from(encodePermit(f.permit)).toString('base64url'),listingMessageBase64url:Buffer.from(f.message).toString('base64url'),sellerSignatureBase64url:Buffer.from(f.sellerSignature).toString('base64url'),blockhash,currentBlockHeight:'100',currentSlot:'100',blockhashBlockHeight:'95',transactionBase64url};}
function openTx(f:Awaited<ReturnType<typeof createFixture>>,mutate?:(instructions:TransactionInstruction[])=>TransactionInstruction[],payer=f.pins.issuer):string{
  const proof=Ed25519Program.createInstructionWithPublicKey({publicKey:f.permit.seller,message:f.message,signature:f.sellerSignature}),pda=v2Addresses(f.pins.program,f.permit.card,f.permit.saleId);
  const keys=[pda.config,pda.card,pda.sale,pda.escrow,new PublicKey(f.pins.mint),new PublicKey(f.pins.issuer),new PublicKey(TOKEN_PROGRAM_ID),SystemProgram.programId,SYSVAR_RENT_PUBKEY,SYSVAR_INSTRUCTIONS_PUBKEY];
  const flags:[boolean,boolean][]=[[false,false],[false,true],[false,true],[false,true],[false,false],[true,true],[false,false],[false,false],[false,false],[false,false]];
  const data=Buffer.concat([createHash('sha256').update('global:open_sale').digest().subarray(0,8),Buffer.from(encodePermit(f.permit))]);
  const open=new TransactionInstruction({programId:new PublicKey(f.pins.program),data,keys:keys.map((pubkey,i)=>({pubkey,isSigner:flags[i]![0],isWritable:flags[i]![1]}))});
  let instructions=[proof,open];if(mutate)instructions=mutate(instructions);
  return Buffer.from(new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(payer),recentBlockhash:blockhash,instructions}).compileToLegacyMessage()).serialize()).toString('base64url');
}
async function buyRequest(f:Awaited<ReturnType<typeof createFixture>>){
  const addresses=v2Addresses(f.pins.program,f.permit.card,f.permit.saleId),tableAddress=Keypair.generate().publicKey.toBase58(),tableAddresses=[addresses.config.toBase58(),addresses.card.toBase58(),addresses.sale.toBase58(),addresses.escrow.toBase58(),base58Encode(f.permit.buyerToken),base58Encode(f.permit.sellerToken),base58Encode(f.permit.treasuryToken)];
  const unique=[...new Set(tableAddresses)].filter(address=>address!==f.pins.issuer&&address!==base58Encode(f.permit.buyer));
  const pin={address:tableAddress,owner:AddressLookupTableProgram.programId.toBase58(),addresses:unique,addressesSha256:hashAddressList(unique),lastExtendedSlot:'1',deactivationSlot:'18446744073709551615'};
  const table=new AddressLookupTableAccount({key:new PublicKey(tableAddress),state:{deactivationSlot:BigInt(pin.deactivationSlot),lastExtendedSlot:1,lastExtendedSlotStartIndex:unique.length,authority:undefined,addresses:unique.map(address=>new PublicKey(address))}});
  const pins={...f.pins,lookupTables:[pin]},bytes=await import('@/lib/solana/v2-sdk').then(m=>m.buildV2Buy(f.permit,blockhash,f.pins.issuer,[table]));
  const request={kind:'buy-sale' as const,requestId:'buy-test-request',attemptId:'11111111-1111-4111-8111-111111111111',permitSha256:createHash('sha256').update(encodePermit(f.permit)).digest('hex'),permitBase64url:Buffer.from(encodePermit(f.permit)).toString('base64url'),blockhash,currentBlockHeight:'100',currentSlot:'100',blockhashBlockHeight:'95',transactionBase64url:Buffer.from(bytes).toString('base64url')};
  return {pins,request,table};
}
function signerCore(f:Awaited<ReturnType<typeof createFixture>>,root=temp(),alerts:SignerAlert[]=[],clock={value:1000}){
  return createSignerCore(f.issuer,f.pins,{rateJournalPath:join(root,'rate.json'),auditPath:join(root,'audit.jsonl'),alertQueuePath:join(root,'alert-queue.jsonl'),assertOwnedFile:()=>{},clock:{nowSeconds:()=>clock.value},alerts:{deliver:async(event)=>{alerts.push(event)}}});
}
function expectUnsigned(request:OpenSalePairSignRequest):void{const tx=VersionedTransaction.deserialize(Buffer.from(request.transactionBase64url,'base64url'));expect(tx.signatures.every(sig=>sig.every(byte=>byte===0))).toBe(true);}
function workerSources(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const path=join(directory,entry.name);return entry.isDirectory()?workerSources(path):/\.(ts|js|py)$/.test(entry.name)&&!entry.name.endsWith('.test.ts')?[path]:[];});}

describe('key-file issuer signer',()=>{
  it('keeps the raw open instruction private to the paired builder/validator and send reachable only from the submitter',()=>{
    const sources=workerSources(resolve(process.cwd(),'workers')),raw=sources.filter(path=>/global:open_sale/.test(readFileSync(path,'utf8'))),senders=sources.filter(path=>/sendRawTransaction\s*\(/.test(readFileSync(path,'utf8')));
    expect(raw.map(path=>path.replaceAll('\\','/').split('/workers/')[1]).sort()).toEqual(['issuer/open-sale-pair.ts','signer/validator.ts']);
    expect(senders.map(path=>path.replaceAll('\\','/').split('/workers/')[1])).toEqual(['issuer/open-sale-submitter.ts']);
    for(const path of sources){const source=readFileSync(path,'utf8');expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+openSaleInstruction\b/);if(/executor/i.test(path))expect(source).not.toMatch(/from\s+['"][^'"]*(?:issuer\/open-sale-submitter|signer\/socket)/);}
  });
  it('pins startup programs and accepts only the canonical paired open transaction',async()=>{
    const f=await createFixture();expect(()=>validateSignerPins(f.pins)).not.toThrow();
    const request=openRequest(f,openTx(f)),validated=await validateSignerRequest(request,f.pins);
    expect(validated.message.version).toBe('legacy');expect(validated.message.compiledInstructions).toHaveLength(2);
    const wrongPins={...f.pins,tokenProgram:f.pins.systemProgram};expect(()=>validateSignerPins(wrongPins)).toThrow('SIGNER_STARTUP_PIN_INVALID');
  });
  it('refuses open-sale account, flag, program, data, proof, order, extra-instruction and fee-payer mutations before signatures',async()=>{
    const f=await createFixture(),bad:OpenSalePairSignRequest[]=[];
    const mutate=(fn:(instructions:TransactionInstruction[])=>TransactionInstruction[])=>openRequest(f,openTx(f,fn));
    for(let i=0;i<10;i++)bad.push(mutate(ixs=>{ixs[1]!.keys[i]!.pubkey=Keypair.generate().publicKey;return ixs}));
    for(let i=0;i<10;i++)if(i!==5)bad.push(mutate(ixs=>{ixs[1]!.keys[i]!.isWritable=!ixs[1]!.keys[i]!.isWritable;return ixs}));
    for(let i=0;i<10;i++)if(i!==5)bad.push(mutate(ixs=>{ixs[1]!.keys[i]!.isSigner=!ixs[1]!.keys[i]!.isSigner;return ixs}));
    bad.push(mutate(ixs=>{ixs[1]!.programId=Keypair.generate().publicKey;return ixs}));
    bad.push(mutate(ixs=>{ixs[1]!.data[8]^=1;return ixs}));
    bad.push(mutate(ixs=>{ixs[0]!.data[0]^=1;return ixs}));
    bad.push(mutate(ixs=>[ixs[1]!,ixs[0]!]));
    bad.push(mutate(ixs=>[...ixs,new TransactionInstruction({programId:SystemProgram.programId,keys:[],data:Buffer.alloc(0)})]));
    bad.push(openRequest(f,openTx(f,undefined,Keypair.generate().publicKey.toBase58())));
    const alerts:SignerAlert[]=[],core=signerCore(f,temp(),alerts);
    for(const request of bad){expectUnsigned(request);await expect(core.sign(request)).rejects.toThrow();expectUnsigned(request);}
    expect(alerts).toHaveLength(bad.length);
  });
  it('validates buy permit, ALT owner/address/content/expansion, then signs only issuer while preserving buyer slot',async()=>{
    const f=await createFixture(),built=await buyRequest(f);validateSignerPins(built.pins);
    const tx=await validateSignerRequest(built.request,built.pins);expect(tx.message.version).toBe(0);
    const root=temp(),alerts:SignerAlert[]=[],core=createSignerCore(f.issuer,built.pins,{rateJournalPath:join(root,'rates.json'),auditPath:join(root,'audit.jsonl'),alertQueuePath:join(root,'alerts.jsonl'),assertOwnedFile:()=>{},alerts:{deliver:async event=>{alerts.push(event)}}});
    const signed=await core.sign(built.request),signedTx=VersionedTransaction.deserialize(Buffer.from(signed.signedTransactionBase64url,'base64url'));
    expect(signedTx.signatures[0]!.some(byte=>byte!==0)).toBe(true);expect(signedTx.signatures[1]!.every(byte=>byte===0)).toBe(true);
    const buyerSignedTx=VersionedTransaction.deserialize(Buffer.from(built.request.transactionBase64url,'base64url'));buyerSignedTx.sign([f.buyer]);
    const buyerSignedRequest={...built.request,transactionBase64url:Buffer.from(buyerSignedTx.serialize()).toString('base64url')};
    const coSigned=await core.sign(buyerSignedRequest),coSignedTx=VersionedTransaction.deserialize(Buffer.from(coSigned.signedTransactionBase64url,'base64url'));
    expect(coSignedTx.signatures[1]).toEqual(buyerSignedTx.signatures[1]);
    const alteredPins={...built.pins,lookupTables:[{...built.pins.lookupTables[0]!,owner:f.pins.systemProgram}]};
    await expect(validateSignerRequest(built.request,alteredPins)).rejects.toThrow('SIGNER_LOOKUP_TABLE_INVALID');
    const alteredContents={...built.pins,lookupTables:[{...built.pins.lookupTables[0]!,addresses:[...built.pins.lookupTables[0]!.addresses,Keypair.generate().publicKey.toBase58()]}]};
    await expect(validateSignerRequest(built.request,alteredContents)).rejects.toThrow('SIGNER_LOOKUP_TABLE_INVALID');expect(alerts).toHaveLength(0);
    const mutatedInstruction=await buyV2Instruction(f.permit);mutatedInstruction.keys[5]!.pubkey=Keypair.generate().publicKey;
    const alteredMessage=new TransactionMessage({payerKey:f.issuer.publicKey,recentBlockhash:blockhash,instructions:[mutatedInstruction]}).compileToV0Message([built.table]);
    const alteredTx=new VersionedTransaction(alteredMessage),alteredRequest={...built.request,transactionBase64url:Buffer.from(alteredTx.serialize()).toString('base64url')};
    await expect(validateSignerRequest(alteredRequest,built.pins)).rejects.toThrow('SIGNER_TRANSACTION_INVALID');
  });
  it('refuses every buy instruction account, flag, data, program, fee-payer and extra-instruction mutation before signing',async()=>{
    const f=await createFixture(),built=await buyRequest(f),original=VersionedTransaction.deserialize(Buffer.from(built.request.transactionBase64url,'base64url'));
    const mutations:Array<(ixs:TransactionInstruction[],payer:PublicKey)=>{ixs:TransactionInstruction[];payer:PublicKey}>=[];
    const compiled=TransactionMessage.decompile(original.message,{addressLookupTableAccounts:[built.table]});
    for(let i=0;i<compiled.instructions[0]!.keys.length;i++)mutations.push(ixs=>{ixs[0]!.keys[i]!.pubkey=Keypair.generate().publicKey;return {ixs,payer:new PublicKey(f.pins.issuer)}});
    for(let i=0;i<compiled.instructions[0]!.keys.length;i++)mutations.push(ixs=>{ixs[0]!.keys[i]!.isWritable=!ixs[0]!.keys[i]!.isWritable;return {ixs,payer:new PublicKey(f.pins.issuer)}});
    for(let i=0;i<compiled.instructions[0]!.keys.length;i++)mutations.push(ixs=>{ixs[0]!.keys[i]!.isSigner=!ixs[0]!.keys[i]!.isSigner;return {ixs,payer:new PublicKey(f.pins.issuer)}});
    mutations.push(ixs=>{ixs[0]!.data[8]^=1;return {ixs,payer:new PublicKey(f.pins.issuer)}});
    mutations.push(ixs=>{ixs[0]!.programId=Keypair.generate().publicKey;return {ixs,payer:new PublicKey(f.pins.issuer)}});
    mutations.push(ixs=>({ixs:[...ixs,new TransactionInstruction({programId:SystemProgram.programId,keys:[],data:Buffer.alloc(0)})],payer:new PublicKey(f.pins.issuer)}));
    mutations.push(ixs=>({ixs,payer:Keypair.generate().publicKey}));
    const alerts:SignerAlert[]=[],core=signerCore(f,temp(),alerts);
    for(const mutate of mutations){
      const draft=TransactionMessage.decompile(original.message,{addressLookupTableAccounts:[built.table]}),changed=mutate(draft.instructions,draft.payerKey);
      const message=new TransactionMessage({payerKey:changed.payer,recentBlockhash:blockhash,instructions:changed.ixs}).compileToV0Message([built.table]);
      const request={...built.request,transactionBase64url:Buffer.from(new VersionedTransaction(message).serialize()).toString('base64url')};
      await expect(core.sign(request)).rejects.toThrow();
    }
    expect(alerts).toHaveLength(mutations.length);
  });
  it('enforces durable per-operation rate limits, clock rollback and alert failure fail-closed',async()=>{
    const f=await createFixture(),request=openRequest(f,openTx(f)),root=temp(),alerts:SignerAlert[]=[],clock={value:1000},core=signerCore(f,root,alerts,clock);
    await core.sign(request);await core.sign(request);await expect(core.sign(request)).rejects.toThrow('SIGNER_RATE_LIMITED');expect(alerts.at(-1)?.refusalCode).toBe('SIGNER_RATE_LIMITED');
    const rollback=signerCore(f,temp(),[],clock);await rollback.sign(request);clock.value=900;await expect(rollback.sign(request)).rejects.toThrow('SIGNER_CLOCK_ROLLBACK');
    const alertRoot=temp(),failed=createSignerCore(f.issuer,f.pins,{rateJournalPath:join(alertRoot,'rate.json'),auditPath:join(alertRoot,'audit.jsonl'),alertQueuePath:join(alertRoot,'queue.jsonl'),assertOwnedFile:()=>{},alerts:{deliver:async()=>{throw Error('alert sink down')}}});
    await expect(failed.sign({...request,transactionBase64url:'bad'})).rejects.toThrow('SIGNER_TRANSACTION_INVALID');expect(readFileSync(join(alertRoot,'queue.jsonl'),'utf8')).toContain('SIGNER_ALERT_DELIVERY_FAILED');await expect(failed.sign(request)).rejects.toThrow('SIGNER_DISABLED');
  });
  it('refuses a corrupted rate journal and alerts without emitting a signature',async()=>{
    const f=await createFixture(),root=temp(),request=openRequest(f,openTx(f)),alerts:SignerAlert[]=[],path=join(root,'rates.json');writeFileSync(path,'not-json');
    const core=createSignerCore(f.issuer,f.pins,{rateJournalPath:path,auditPath:join(root,'audit.jsonl'),alertQueuePath:join(root,'queue.jsonl'),assertOwnedFile:()=>{},alerts:{deliver:async event=>{alerts.push(event)}}});
    expectUnsigned(request);await expect(core.sign(request)).rejects.toThrow('SIGNER_RATE_JOURNAL_CORRUPT');expectUnsigned(request);expect(alerts[0]?.refusalCode).toBe('SIGNER_RATE_JOURNAL_CORRUPT');
  });
  it('uses the 086 fenced claim so two concurrent submitters can send only one paired open transaction',async()=>{
    const f=await createFixture(),root=temp(),ownerId='11111111-1111-4111-8111-111111111111',saleId='22222222-2222-4222-8222-222222222222',listingId='33333333-3333-4333-8333-333333333333';
    const context:IssuerContext={found:true,saleId,listingId,ownerId,ownerAuthId:ownerId,state:'opening',genesis:f.pins.genesis,program:f.pins.program,actor:f.pins.issuer,saleCommitment:base58Encode(f.permit.saleId),templateHex:Buffer.from(encodePermit(f.permit)).toString('hex'),quoteTotalUnits:'1000000',quoteExpiresAt:String(f.permit.expiresAt),sellerWallet:base58Encode(f.permit.seller),sellerToken:base58Encode(f.permit.sellerToken),cardCommitment:base58Encode(f.permit.card),generation:'1'};
    const listing={messageHex:Buffer.from(f.message).toString('hex'),signatureHex:Buffer.from(f.sellerSignature).toString('hex'),signerHex:Buffer.from(f.permit.seller).toString('hex'),bindingHex:Buffer.from(await listingBinding({domain:f.permit.domain,program:f.permit.program,card:f.permit.card,saleId:f.permit.saleId,generation:f.permit.generation})).toString('hex'),minTotalUnits:listingFloor(f.permit.total).toString(),expiresAt:String(f.permit.expiresAt+BigInt('1000'))};
    const lease:IssuerContext={found:true,operationId:'44444444-4444-4444-8444-444444444444',saleId,leaseId:'55555555-5555-4555-8555-555555555555',fencingToken:'1',listing,saleCommitment:context.saleCommitment};
    let claimed=false,sendCalls=0;const finished:string[]=[];
    const db:IssuerDatabase={consumeIssuerNonce:async()=>{},subjectContext:async()=>context,saleSigningContext:async()=>context,listingForOpen:async()=>({found:true,...listing}),enrollWalletChecked:async()=>{},prepareSale:async()=>saleId,recordListing:async()=>{},authorizeAttempt:async()=>'',openSaleQueue:async()=>[context],claimOpenSale:async()=>{if(claimed)return[];claimed=true;return[lease]},renewOpenSaleLease:async()=>{},finishOpenSale:async(_op,_lease,_token,outcome)=>{finished.push(outcome)}};
    const block={genesis:f.pins.genesis,blockhash,currentBlockHeight:'100',currentSlot:'100',blockhashBlockHeight:'95'};
    const rpc={readSale:async()=>null,latestBlockhash:async()=>block},alerts:SignerAlert[]=[];
    const core=createSignerCore(f.issuer,f.pins,{rateJournalPath:join(root,'rates.json'),auditPath:join(root,'audit.jsonl'),alertQueuePath:join(root,'alerts.jsonl'),assertOwnedFile:()=>{},alerts:{deliver:async(event:SignerAlert)=>{alerts.push(event)}}});
    const signer={publicKey:core.publicKey,signValidated:core.sign};
    const deps={db,rpc:[rpc,rpc] as const,signer,sender:{sendRawTransaction:async()=>{sendCalls++;return base58Encode(new Uint8Array(64).fill(1))}},alerts:{deliver:async(event:SignerAlert)=>{alerts.push(event)}},pins:{...f.pins,networkId:'66666666-6666-4666-8666-666666666666',saleAddress:()=>Keypair.generate().publicKey.toBase58()},allowList:new Set([ownerId]),nowSeconds:()=>Math.floor(Date.now()/1000)};
    const [a,b]=await Promise.all([runOpenSaleSubmitter(deps),runOpenSaleSubmitter(deps)]);
    expect(sendCalls).toBe(1);expect([...a,...b]).toEqual([{saleId,operationId:String(lease.operationId),outcome:'submitted'}]);expect(finished).toEqual(['send_ack']);expect(alerts).toEqual([]);
  });
});
