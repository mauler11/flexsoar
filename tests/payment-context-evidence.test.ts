import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { AddressLookupTableAccount, AddressLookupTableProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { encodePermit, type PermitV2 } from '@/lib/solana/protocol-v2';
import { claimAcknowledgementInstruction, decisionInstructionFromContext, openSaleInstructionFromContext, revokeSaleInstructionFromContext } from '@/lib/solana/v2-context';
import { acquireFinalizedEvidence, EvidenceSourceUnavailableError, EvidenceValidationError, LocalFinalizedRpcSource, parseFinalizedRpcJson, validateRetainedFinalizedEvidence, type FinalizedRpcResult, type FinalizedTransactionSource, type ParsedFinalizedRpcResult } from '@/lib/solana/v2-evidence';
import { v2Addresses } from '@/lib/solana/v2-sdk';
import { encodeConsumptionBindingV1 } from '@/lib/solana/protocol-v2';
import { recoverCommittedClaimAcknowledgement } from '@/lib/db/payment-v2-workers';
import type { PaymentRpc } from '@/lib/db/payment-v2';
import { vi } from 'vitest';

const uuid = '11111111-2222-4333-8444-555555555555';
const k = (n: number) => new Uint8Array(32).fill(n);
const publicKey = (n: number) => Keypair.fromSeed(k(n)).publicKey;
const b58 = (v: Uint8Array) => base58Encode(v);

function permit(): PermitV2 {
  const p:PermitV2={ domain:k(1),program:k(2),config:k(3),saleId:k(4),card:k(5),pair:k(6),attempt:new Uint8Array(32),beneficiary:new Uint8Array(32),policy:k(9),buyer:new Uint8Array(32),seller:k(11),treasury:k(12),mint:k(13),tokenProgram:k(14),buyerToken:new Uint8Array(32),sellerToken:k(16),treasuryToken:k(17),refundToken:new Uint8Array(32),issuer:k(19),generation:BigInt(1),revision:BigInt(1),custodyVersion:BigInt(1),authorityEpoch:BigInt(1),total:BigInt(100),net:BigInt(95),fee:BigInt(5),validFrom:BigInt(1),expiresAt:BigInt(9),mode:1 };
  p.config=v2Addresses(base58Encode(p.program),p.card,p.saleId).config.toBytes();return p;
}

function authorityOpenContext(): Record<string, unknown> {
  const p=permit(), program=base58Encode(p.program), addresses=v2Addresses(program,p.card,p.saleId);
  return {formatVersion:1,action:'open_sale',program,config:base58Encode(p.config),sale:addresses.sale.toBase58(),escrow:addresses.escrow.toBase58(),genesis:base58Encode(p.domain),saleCommitment:base58Encode(p.saleId),cardCommitment:base58Encode(p.card),pairCommitment:base58Encode(p.pair),seller:base58Encode(p.seller),sellerToken:base58Encode(p.sellerToken),treasury:base58Encode(p.treasury),treasuryToken:base58Encode(p.treasuryToken),mint:base58Encode(p.mint),tokenProgram:base58Encode(p.tokenProgram),totalUnits:'100',validFrom:'1',expiresAt:'9',generation:'1',revision:'1',custodyVersion:'1',mode:1,actor:base58Encode(p.issuer),templateHex:Buffer.from(encodePermit(p)).toString('hex')};
}

function signedSample(mode:'legacy'|'v0'|'lookup'='v0') {
  const payer=Keypair.generate(),recipient=Keypair.generate(),tableKey=Keypair.generate().publicKey;
  const recentBlockhash=base58Encode(k(21));
  const instruction=mode==='lookup'
    ?SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient.publicKey,lamports:1})
    :SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:recipient.publicKey,lamports:1,space:0,programId:SystemProgram.programId});
  let lookupTable:AddressLookupTableAccount|undefined,lookupProof:ParsedFinalizedRpcResult['lookupTableEvidence'][number]|undefined;
  if(mode==='lookup'){
    const tableData=Buffer.alloc(56+32);tableData.writeUInt32LE(1,0);tableData.writeBigUInt64LE(BigInt('18446744073709551615'),4);tableData.writeBigUInt64LE(BigInt(0),12);tableData[20]=0;tableData[21]=0;recipient.publicKey.toBuffer().copy(tableData,56);
    lookupTable=new AddressLookupTableAccount({key:tableKey,state:AddressLookupTableAccount.deserialize(tableData)});
    lookupProof={address:tableKey.toBase58(),owner:AddressLookupTableProgram.programId.toBase58(),contextSlot:42,dataBase64:tableData.toString('base64'),dataDigest:createHash('sha256').update(tableData).digest('hex')};
  }
  const builder=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash,instructions:[instruction]});
  const message=mode==='legacy'?builder.compileToLegacyMessage():builder.compileToV0Message(lookupTable?[lookupTable]:[]);
  const transaction=new VersionedTransaction(message);transaction.sign(mode==='lookup'?[payer]:[payer,recipient]);
  const signature=base58Encode(transaction.signatures[0]),bytes=Buffer.from(transaction.serialize()),version=transaction.message.version;
  const staticKeys=version==='legacy'?transaction.message.accountKeys:transaction.message.staticAccountKeys;
  const compiled=version==='legacy'?transaction.message.instructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:[...ix.accounts],data:ix.data})):
    transaction.message.compiledInstructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:[...ix.accountKeyIndexes],data:base58Encode(ix.data)}));
  const addressTableLookups=version==='legacy'?[]:transaction.message.addressTableLookups.map(x=>({accountKey:x.accountKey.toBase58(),writableIndexes:[...x.writableIndexes],readonlyIndexes:[...x.readonlyIndexes]}));
  const loadedWritable=mode==='lookup'?[recipient.publicKey.toBase58()]:[],loadedReadonly:string[]=[];
  const keyRows=staticKeys.map((key,index)=>({pubkey:key.toBase58(),signer:index<transaction.message.header.numRequiredSignatures,
    writable:index<transaction.message.header.numRequiredSignatures?index<transaction.message.header.numRequiredSignatures-transaction.message.header.numReadonlySignedAccounts:index<staticKeys.length-transaction.message.header.numReadonlyUnsignedAccounts}));
  if(mode==='lookup')keyRows.push({pubkey:recipient.publicKey.toBase58(),signer:false,writable:true});
  const rawMessage={header:transaction.message.header,accountKeys:staticKeys.map(x=>x.toBase58()),recentBlockhash,
    instructions:compiled,addressTableLookups};
  const meta={err:null,...(mode==='lookup'?{loadedAddresses:{writable:loadedWritable,readonly:loadedReadonly}}:{})},parsedMeta={...meta};delete parsedMeta.loadedAddresses;
  const parsed:ParsedFinalizedRpcResult={slot:42,blockTime:1234,transaction:{signatures:transaction.signatures.map(base58Encode),message:{accountKeys:keyRows,
    instructions:compiled.map(ix=>({programId:keyRows[ix.programIdIndex].pubkey,accounts:ix.accounts.map(index=>keyRows[index].pubkey),data:ix.data}))}},meta:parsedMeta,
    compiledRpcResult:{slot:42,blockTime:1234,version:version==='legacy'?'legacy':version,transaction:{signatures:transaction.signatures.map(base58Encode),message:rawMessage},meta},
    lookupTableEvidence:lookupProof?[lookupProof]:[]};
  const wire:FinalizedRpcResult={slot:42,blockTime:1234,transaction:[bytes.toString('base64'),'base64'],meta:structuredClone(meta),version:version==='legacy'?'legacy':version};
  return {signature,wire,parsed,transaction};
}

function source(label:string,genesis:string,sample:ReturnType<typeof signedSample>):FinalizedTransactionSource {
  return {label,getGenesisHash:async()=>genesis,getTransaction:async()=>sample.wire,getParsedTransaction:async()=>sample.parsed};
}

describe('payment operation contexts and retained finalized evidence',()=>{
  it('preserves large integer RPC metadata without IEEE-754 rounding',()=>{
    const parsed=parseFinalizedRpcJson('{"preBalances":[500000009936971900],"fee":5000,"text":"9007199254740993"}') as {preBalances:unknown[];fee:number;text:string};
    expect(parsed.preBalances[0]).toBe('500000009936971900');expect(parsed.fee).toBe(5000);expect(parsed.text).toBe('9007199254740993');
  });
  it('derives an opening instruction from the immutable permit and rejects substituted terms/accounts',async()=>{
    const context=authorityOpenContext(), instruction=await openSaleInstructionFromContext(context);
    expect(instruction.data.length).toBe(698);
    await expect(openSaleInstructionFromContext({...context,seller:publicKey(90).toBase58()})).rejects.toThrow(/authoritative context/);
    await expect(openSaleInstructionFromContext({...context,escrow:publicKey(91).toBase58()})).rejects.toThrow(/PDA/);
    await expect(openSaleInstructionFromContext({...context,totalUnits:'101'})).rejects.toThrow(/authoritative context/);
    const revoke={...context,action:'revoke_sale',templateHex:null};
    const revokeIx=await revokeSaleInstructionFromContext(revoke);expect(revokeIx.data.length).toBe(8);
    await expect(revokeSaleInstructionFromContext({...revoke,sale:publicKey(99).toBase58()})).rejects.toThrow(/PDA/);
  });

  it('derives decision actors, action and revision from a trusted context and rejects substitution',async()=>{
    const actor=publicKey(31).toBase58();
    const context={formatVersion:1,kind:'decision',action:'authentication_fail',instruction:'record_authentication',actionCode:2,actors:[actor],program:publicKey(32).toBase58(),config:publicKey(33).toBase58(),sale:publicKey(34).toBase58(),attempt:publicKey(35).toBase58(),pairCommitment:publicKey(36).toBase58(),evidenceDigest:publicKey(37).toBase58(),expectedRevision:'7'};
    const derived=await decisionInstructionFromContext(context);
    expect(derived.actors).toEqual([actor]);expect(derived.instruction.data.at(-1)).toBe(0);
    await expect(decisionInstructionFromContext({...context,actors:[publicKey(38).toBase58()]})).resolves.toMatchObject({actors:[publicKey(38).toBase58()]});
    await expect(decisionInstructionFromContext({...context,actionCode:1})).rejects.toThrow(/binding mismatch/);
    await expect(decisionInstructionFromContext({...context,expectedRevision:'8'})).resolves.not.toBe(derived);
  });

  it('uses deterministic committed consumption for claim acknowledgement and rejects changed digest',async()=>{
    const fields={formatVersion:1,eventId:uuid,saleId:'22222222-2222-4333-8444-555555555555',attemptId:'33333333-2222-4333-8444-555555555555',orderId:'44444444-2222-4333-8444-555555555555',networkId:'55555555-2222-4333-8444-555555555555',saleCommitment:base58Encode(k(41)),cardCommitment:base58Encode(k(42)),genesis:base58Encode(k(43)),program:publicKey(44).toBase58(),config:publicKey(45).toBase58(),sale:'',kind:'direct',proofDigest:'ab'.repeat(32),consumptionDigest:'00'.repeat(32),actors:[publicKey(46).toBase58()]};
    fields.sale=v2Addresses(fields.program,k(42),k(41)).sale.toBase58();
    const {createHash}=await import('node:crypto');
    const digest=createHash('sha256').update((await import('@/lib/solana/protocol-v2')).encodeConsumptionBindingV1({networkId:fields.networkId,eventId:fields.eventId,saleId:fields.saleId,attemptId:fields.attemptId,orderId:fields.orderId,kind:'direct',genesis:k(43),proofDigest:Buffer.from(fields.proofDigest,'hex')})).digest('hex');
    fields.consumptionDigest=digest;
    const ix=await claimAcknowledgementInstruction(fields);expect(ix.data.subarray(8).toString('hex')).toBe(digest);
    await expect(claimAcknowledgementInstruction({...fields,consumptionDigest:'cd'.repeat(32)})).rejects.toThrow(/digest mismatch/);
  });

  it('recovers valid evidence from an explicitly configured archive and revalidates retained bytes offline',async()=>{
    const sample=signedSample(),genesis=base58Encode(k(51)),expected={networkId:uuid,genesis,program:publicKey(52).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'};
    const primary:FinalizedTransactionSource={label:'primary-local',getGenesisHash:async()=>genesis,getTransaction:async()=>null,getParsedTransaction:async()=>null};
    const archive=source('archive:fixture',genesis,sample);
    const inspect=(_tx:unknown,sig:string)=>{if(sig!==sample.signature)throw new Error('wrong instruction identity');};
    const retained=await acquireFinalizedEvidence(primary,archive,expected,inspect);
    expect(retained.sourceKind).toBe('archive');expect(retained.finality).toBe('finalized');
    expect((await validateRetainedFinalizedEvidence(retained,expected,inspect)).signature).toBe(sample.signature);
    await expect(validateRetainedFinalizedEvidence({...retained,networkId:'66666666-2222-4333-8444-555555555555'},expected,inspect)).rejects.toThrow(/integrity mismatch/);
    await expect(acquireFinalizedEvidence(primary,source('archive:wrong',base58Encode(k(53)),sample),expected,inspect)).rejects.toThrow(/genesis mismatch/);
    await expect(acquireFinalizedEvidence(primary,source('archive:corrupt',genesis,{...sample,wire:{...sample.wire,meta:{err:{InstructionError:[0,'Custom']}}}}),expected,inspect)).rejects.toThrow(/invalid finalized/);
  });

  it('rejects wrong message identity and conflicting primary/archive evidence',async()=>{
    const sample=signedSample(),genesis=base58Encode(k(61)),expected={networkId:uuid,genesis,program:publicKey(62).toBase58(),signature:sample.signature,subjectKind:'attestation' as const,subjectId:uuid,subjectAction:'receipt'};
    const inspect=(_tx:unknown,sig:string)=>{if(sig!==sample.signature)throw new Error('signature does not bind expected instruction');};
    const other={...sample,wire:{...sample.wire,slot:43,blockTime:1235},parsed:{...sample.parsed,slot:43,blockTime:1235,compiledRpcResult:{...sample.parsed.compiledRpcResult,slot:43,blockTime:1235}}};
    const primary=source('primary',genesis,sample),archive=source('archive:different',genesis,other);
    await expect(acquireFinalizedEvidence(primary,archive,expected,inspect)).rejects.toThrow(/conflict/);
    await expect(acquireFinalizedEvidence({ ...primary,getTransaction:async()=>null },null,expected,inspect)).rejects.toThrow(/history unavailable/);
  });

  it('compares source semantics while ignoring valid lookup observation context slots',async()=>{
    const sample=signedSample('lookup'),genesis=b58(k(63)),expected={networkId:uuid,genesis,program:publicKey(64).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'};
    const laterContext=structuredClone(sample);laterContext.parsed.lookupTableEvidence[0].contextSlot=43;
    await expect(acquireFinalizedEvidence(source('primary-context-42',genesis,sample),source('archive:context-43',genesis,laterContext),expected,()=>{})).resolves.toMatchObject({sourceKind:'primary',slot:42});
    const omittedWireLoaded=structuredClone(sample);delete omittedWireLoaded.wire.meta.loadedAddresses;
    await expect(acquireFinalizedEvidence(source('primary-omits-optional-loaded-metadata',genesis,omittedWireLoaded),source('archive:includes-optional-loaded-metadata',genesis,sample),expected,()=>{})).resolves.toMatchObject({sourceKind:'primary'});

    const invalidSlot=structuredClone(sample);invalidSlot.parsed.lookupTableEvidence[0].contextSlot=41;
    await expect(acquireFinalizedEvidence(source('primary-invalid-context',genesis,invalidSlot),null,expected,()=>{})).rejects.toThrow(/lookup table state/);

    const changed=structuredClone(sample),table=Buffer.from(changed.parsed.lookupTableEvidence[0].dataBase64,'base64'),newAddress=publicKey(65);
    newAddress.toBuffer().copy(table,56);changed.parsed.lookupTableEvidence[0].dataBase64=table.toString('base64');changed.parsed.lookupTableEvidence[0].dataDigest=createHash('sha256').update(table).digest('hex');
    const changedLoaded=changed.parsed.compiledRpcResult.meta.loadedAddresses as {writable:string[];readonly:string[]};changedLoaded.writable=[newAddress.toBase58()];
    changed.parsed.transaction.message.accountKeys.at(-1)!.pubkey=newAddress.toBase58();
    changed.parsed.transaction.message.instructions[0].accounts![1]=newAddress.toBase58();
    changed.wire.meta={...changed.wire.meta,loadedAddresses:{writable:[newAddress.toBase58()],readonly:[]}};
    await expect(acquireFinalizedEvidence(source('primary-original-address',genesis,sample),source('archive:changed-address',genesis,changed),expected,()=>{})).rejects.toThrow(/conflict/);

    const changedExecution=structuredClone(sample);
    changedExecution.wire.meta={...changedExecution.wire.meta,fee:99};
    changedExecution.parsed.meta={...changedExecution.parsed.meta,fee:99};
    changedExecution.parsed.compiledRpcResult.meta={...changedExecution.parsed.compiledRpcResult.meta,fee:99};
    await expect(acquireFinalizedEvidence(source('primary-execution-a',genesis,sample),source('archive:execution-b',genesis,changedExecution),expected,()=>{})).rejects.toThrow(/conflict/);
  });

  it('falls back only for absent or explicitly unavailable sources',async()=>{
    const sample=signedSample(),genesis=base58Encode(k(65)),expected={networkId:uuid,genesis,program:publicKey(66).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'},inspect=()=>{};
    const absent={...source('primary-absent',genesis,sample),getTransaction:async()=>null};
    expect((await acquireFinalizedEvidence(absent,source('archive:absent-fallback',genesis,sample),expected,inspect)).sourceKind).toBe('archive');
    const unavailable={...source('primary-unavailable',genesis,sample),getGenesisHash:async()=>{throw new EvidenceSourceUnavailableError('primary-unavailable','getGenesisHash');}};
    expect((await acquireFinalizedEvidence(unavailable,source('archive:unavailable-fallback',genesis,sample),expected,inspect)).sourceKind).toBe('archive');
    const optionalArchive={...source('archive:offline',genesis,sample),getGenesisHash:async()=>{throw new EvidenceSourceUnavailableError('archive:offline','getGenesisHash');}};
    expect((await acquireFinalizedEvidence(source('primary-valid',genesis,sample),optionalArchive,expected,inspect)).sourceKind).toBe('primary');
    const arbitrary={...source('primary-bug',genesis,sample),getTransaction:async()=>{throw new Error('programmer bug');}};
    await expect(acquireFinalizedEvidence(arbitrary,source('archive:must-not-hide-bug',genesis,sample),expected,inspect)).rejects.toThrow('programmer bug');
  });

  it('classifies only explicit transport/service failures as source unavailability',async()=>{
    const httpUnavailable=new LocalFinalizedRpcSource('http://127.0.0.1:8899','local-primary',async()=>new Response('unavailable',{status:503}));
    await expect(httpUnavailable.getGenesisHash()).rejects.toBeInstanceOf(EvidenceSourceUnavailableError);
    const rpcUnavailable=new LocalFinalizedRpcSource('http://127.0.0.1:8899','local-primary',async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:'x',error:{code:-32009,message:'history unavailable'}}),{status:200}));
    await expect(rpcUnavailable.getGenesisHash()).rejects.toBeInstanceOf(EvidenceSourceUnavailableError);
    const malformed=new LocalFinalizedRpcSource('http://127.0.0.1:8899','local-primary',async()=>new Response('{bad json',{status:200}));
    await expect(malformed.getGenesisHash()).rejects.toThrow(/malformed source JSON/);
    const unknownError=new LocalFinalizedRpcSource('http://127.0.0.1:8899','local-primary',async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:'x',error:{code:-32603,message:'internal error'}}),{status:200}));
    await expect(unknownError.getGenesisHash()).rejects.not.toBeInstanceOf(EvidenceSourceUnavailableError);
  });

  it('never lets valid archive evidence conceal invalid primary evidence, or vice versa',async()=>{
    const sample=signedSample(),genesis=base58Encode(k(67)),expected={networkId:uuid,genesis,program:publicKey(68).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'},inspect=()=>{};
    const invalidPrimary={...sample,parsed:structuredClone(sample.parsed)};invalidPrimary.parsed.transaction.message.instructions[0].programId=publicKey(69).toBase58();
    await expect(acquireFinalizedEvidence(source('primary-invalid',genesis,invalidPrimary),source('archive:valid',genesis,sample),expected,inspect)).rejects.toBeInstanceOf(EvidenceValidationError);
    await expect(acquireFinalizedEvidence(source('primary-invalid',genesis,invalidPrimary),source('archive:valid',genesis,sample),expected,inspect)).rejects.toThrow(/program id mismatch/);
    const invalidArchive={...sample,parsed:structuredClone(sample.parsed)};invalidArchive.parsed.transaction.message.instructions[0].data='111';
    await expect(acquireFinalizedEvidence(source('primary-valid',genesis,sample),source('archive:invalid',genesis,invalidArchive),expected,inspect)).rejects.toThrow(/instruction data mismatch/);
    const wrongGenesis={...source('archive:wrong-network',base58Encode(k(70)),sample)};
    await expect(acquireFinalizedEvidence(source('primary-valid',genesis,sample),wrongGenesis,expected,inspect)).rejects.toThrow(/genesis mismatch/);
    const malformed={...sample,wire:{...sample.wire,transaction:['not base64!','base64'] as [string,'base64']}};
    await expect(acquireFinalizedEvidence(source('primary-malformed',genesis,malformed),source('archive:valid',genesis,sample),expected,inspect)).rejects.toThrow(/base64|transaction/);
    await expect(acquireFinalizedEvidence(source('primary-inspect-fails',genesis,sample),source('archive:valid',genesis,sample),expected,()=>{throw new Error('instruction verifier rejection');})).rejects.toThrow('instruction verifier rejection');
  });

  it('binds all parsed message fields to signed wire bytes on acquisition and retained recovery',async()=>{
    const sample=signedSample(),genesis=base58Encode(k(71)),expected={networkId:uuid,genesis,program:publicKey(72).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'},inspect=()=>{};
    const retained=await acquireFinalizedEvidence(source('primary-bind',genesis,sample),null,expected,inspect);
    const mutations:Array<[string,(parsed:ParsedFinalizedRpcResult)=>void,RegExp]>=[
      ['program id',p=>{p.transaction.message.instructions[0].programId=publicKey(73).toBase58();},/program id mismatch/],
      ['instruction data',p=>{p.transaction.message.instructions[0].data='111';},/instruction data mismatch/],
      ['account',p=>{p.transaction.message.instructions[0].accounts![0]=publicKey(74).toBase58();},/account order mismatch/],
      ['account order',p=>{p.transaction.message.instructions[0].accounts!.reverse();},/account order mismatch/],
      ['signer privilege',p=>{p.transaction.message.accountKeys[0].signer=!p.transaction.message.accountKeys[0].signer;},/privileges mismatch/],
      ['writable privilege',p=>{p.transaction.message.accountKeys[0].writable=!p.transaction.message.accountKeys[0].writable;},/privileges mismatch/],
      ['signature list',p=>{p.transaction.signatures[1]=base58Encode(k(75));},/signature list mismatch/],
    ];
    for(const [label,mutate,pattern] of mutations){
      const altered={...sample,parsed:structuredClone(sample.parsed)};mutate(altered.parsed);
      await expect(acquireFinalizedEvidence(source(`primary-${label.replaceAll(' ','-')}`,genesis,altered),null,expected,inspect),`acquisition should reject changed ${label}`).rejects.toThrow(pattern);
      const retainedAltered={...retained,parsedRpcResult:structuredClone(retained.parsedRpcResult)};mutate(retainedAltered.parsedRpcResult);
      await expect(validateRetainedFinalizedEvidence(retainedAltered,expected,inspect),`retained recovery should reject changed ${label}`).rejects.toThrow(pattern);
    }
    const alteredCompiled={...sample,parsed:structuredClone(sample.parsed)};alteredCompiled.parsed.compiledRpcResult.transaction.message.instructions[0].data='111';
    await expect(acquireFinalizedEvidence(source('primary-compiled-data',genesis,alteredCompiled),null,expected,inspect)).rejects.toThrow(/compiled RPC message/);
  });

  it('accepts supported legacy, v0 and proven lookup-table messages and rejects missing or changed lookup proof',async()=>{
    const genesis=base58Encode(k(76)),inspect=()=>{};
    for(const mode of ['legacy','v0','lookup'] as const){
      const sample=signedSample(mode),expected={networkId:uuid,genesis,program:publicKey(77).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'};
      const result=await acquireFinalizedEvidence(source(`primary-${mode}`,genesis,sample),null,expected,inspect);
      expect((await validateRetainedFinalizedEvidence(result,expected,inspect)).signature).toBe(sample.signature);
      if(mode==='lookup'){
        const absent={...sample,parsed:{...sample.parsed,lookupTableEvidence:[]}};
        await expect(acquireFinalizedEvidence(source('primary-no-lookup-proof',genesis,absent),null,expected,inspect)).rejects.toThrow(/lookup table evidence/);
        const changed={...result,parsedRpcResult:structuredClone(result.parsedRpcResult)};changed.parsedRpcResult.lookupTableEvidence[0].dataBase64=Buffer.alloc(88).toString('base64');
        await expect(validateRetainedFinalizedEvidence(changed,expected,inspect)).rejects.toThrow(/lookup table|digest/);
      }
    }
  });

  it('accepts compiled RPC stackHeight variants and rejects altered wire instruction fields',async()=>{
    const genesis=b58(k(78)),sample=signedSample(),expected={networkId:uuid,genesis,program:publicKey(79).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'};
    for(const stackHeight of [undefined,null,1] as const){
      const candidate=structuredClone(sample),instruction=candidate.parsed.compiledRpcResult.transaction.message.instructions[0];
      if(stackHeight===undefined)delete instruction.stackHeight;else instruction.stackHeight=stackHeight;
      const acquired=await acquireFinalizedEvidence(source(`stack-height-${String(stackHeight)}`,genesis,candidate),null,expected,()=>{});
      await expect(validateRetainedFinalizedEvidence(acquired,expected,()=>{})).resolves.toMatchObject({signature:sample.signature});
    }
    const invalidStack=structuredClone(sample);invalidStack.parsed.compiledRpcResult.transaction.message.instructions[0].stackHeight=0;
    await expect(acquireFinalizedEvidence(source('stack-height-invalid',genesis,invalidStack),null,expected,()=>{})).rejects.toThrow(/stackHeight/);
    const alterations=[
      (ix:{programIdIndex:number;accounts:number[];data:string})=>{ix.programIdIndex++;},
      (ix:{programIdIndex:number;accounts:number[];data:string})=>{ix.accounts.reverse();},
      (ix:{programIdIndex:number;accounts:number[];data:string})=>{ix.data='111';},
    ];
    for(const alter of alterations){const candidate=structuredClone(sample);alter(candidate.parsed.compiledRpcResult.transaction.message.instructions[0]);await expect(acquireFinalizedEvidence(source('wire-instruction-alteration',genesis,candidate),null,expected,()=>{})).rejects.toThrow(/compiled RPC message/);}
  });

  it('handles actual Solana RPC encoding shapes with loaded addresses only in json',async()=>{
    const sample=signedSample('lookup'),calls:Record<string,unknown>[]=[];
    const parsed=structuredClone(sample.parsed);parsed.meta={err:null};
    const payer=parsed.transaction.message.accountKeys.find(row=>row.signer)?.pubkey;
    const destination=sample.parsed.lookupTableEvidence[0].address?new PublicKey(Buffer.from(sample.parsed.lookupTableEvidence[0].dataBase64,'base64').subarray(56,88)).toBase58():'';
    parsed.transaction.message.instructions=[{programId:SystemProgram.programId.toBase58(),parsed:{type:'transfer',info:{source:payer??'',destination,lamports:'1'}}}];
    const genesis=b58(k(80)),expected={networkId:uuid,genesis,program:publicKey(81).toBase58(),signature:sample.signature,subjectKind:'lifecycle' as const,subjectId:uuid,subjectAction:'opened'};
    const rpc=new LocalFinalizedRpcSource('http://127.0.0.1:8899','local-rpc-fixture',async(_url,init)=>{
      const request=JSON.parse(String(init?.body)) as Record<string,unknown>;calls.push(request);
      const method=String(request.method),params=request.params as unknown[],encoding=(params[1] as Record<string,unknown>|undefined)?.encoding;
      let result:unknown;
      if(method==='getGenesisHash')result=genesis;
      else if(method==='getTransaction'&&encoding==='base64')result=sample.wire;
      else if(method==='getTransaction'&&encoding==='jsonParsed')result=parsed;
      else if(method==='getTransaction'&&encoding==='json')result=sample.parsed.compiledRpcResult;
      else if(method==='getAccountInfo')result={context:{slot:43},value:{owner:AddressLookupTableProgram.programId.toBase58(),data:[sample.parsed.lookupTableEvidence[0].dataBase64,'base64']}};
      else throw new Error(`unexpected RPC method ${method}`);
      return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'content-type':'application/json'}});
    });
    const acquired=await acquireFinalizedEvidence(rpc,null,expected,()=>{});
    expect(acquired.parsedRpcResult.meta).not.toHaveProperty('loadedAddresses');
    expect(acquired.parsedRpcResult.compiledRpcResult.meta.loadedAddresses).toEqual({writable:[destination],readonly:[]});
    expect(calls.map(call=>((call.params as unknown[])[1] as Record<string,unknown>|undefined)?.encoding)).toEqual(expect.arrayContaining(['base64','json','jsonParsed']));
    await expect(validateRetainedFinalizedEvidence(acquired,expected,()=>{})).resolves.toMatchObject({signature:sample.signature});
  });

  it('consumes retained ACK evidence through distinct worker adapters without a chain lookup',async()=>{
    const eventId='11111111-2222-4333-8444-555555555555',saleId='22222222-2222-4333-8444-555555555555',attemptId='33333333-2222-4333-8444-555555555555',orderId='44444444-2222-4333-8444-555555555555',networkId='55555555-2222-4333-8444-555555555555';
    const programKey=publicKey(71),actor=Keypair.fromSeed(k(72)),saleCommitment=k(73),cardCommitment=k(74),genesis=k(75),proofDigest='ab'.repeat(32),addresses=v2Addresses(programKey.toBase58(),cardCommitment,saleCommitment);
    const consumptionDigest=createHash('sha256').update(encodeConsumptionBindingV1({networkId,eventId,saleId,attemptId,orderId,kind:'direct',genesis,proofDigest:Buffer.from(proofDigest,'hex')})).digest('hex');
    const context={formatVersion:1,eventId,saleId,attemptId,orderId,networkId,saleCommitment:b58(saleCommitment),cardCommitment:b58(cardCommitment),genesis:b58(genesis),program:programKey.toBase58(),config:publicKey(76).toBase58(),sale:addresses.sale.toBase58(),kind:'direct',proofDigest,consumptionDigest,actors:[actor.publicKey.toBase58()],generation:'4',revision:'9',signature:'5'.repeat(88),receipt:null};
    const instruction=await claimAcknowledgementInstruction(context);
    const tx=new VersionedTransaction(new TransactionMessage({payerKey:actor.publicKey,recentBlockhash:b58(k(77)),instructions:[instruction]}).compileToV0Message());tx.sign([actor]);
    const bytes=Buffer.from(tx.serialize()),signature=b58(tx.signatures[0]),staticKeys=tx.message.staticAccountKeys,required=tx.message.header.numRequiredSignatures,roSigned=tx.message.header.numReadonlySignedAccounts,roUnsigned=tx.message.header.numReadonlyUnsignedAccounts;
    const accountKeys=staticKeys.map((key,index)=>({pubkey:key.toBase58(),signer:index<required,writable:index<required-roSigned||index>=required&&index<staticKeys.length-roUnsigned}));
    const compiled=tx.message.compiledInstructions[0],rawInstruction={programIdIndex:compiled.programIdIndex,accounts:[...compiled.accountKeyIndexes],data:b58(compiled.data)},compiledRpcResult={slot:55,blockTime:1234,version:0,transaction:{signatures:[signature],message:{header:tx.message.header,accountKeys:staticKeys.map(k=>k.toBase58()),recentBlockhash:tx.message.recentBlockhash,instructions:[rawInstruction],addressTableLookups:[]}},meta:{err:null}},parsed={slot:55,blockTime:1234,transaction:{signatures:[signature],message:{accountKeys,instructions:[{programId:staticKeys[compiled.programIdIndex].toBase58(),accounts:compiled.accountKeyIndexes.map(i=>staticKeys[i].toBase58()),data:b58(compiled.data)}]}},meta:{err:null},compiledRpcResult,lookupTableEvidence:[]};
    const rpcResult={slot:55,blockTime:1234,transaction:[bytes.toString('base64'),'base64'] as [string,'base64'],meta:{err:null},version:0};
    const encoded=bytes.toString('base64'),wrapped=encoded.match(/.{1,76}/g)!.join('\n');
    const evidence={id:uuid,formatVersion:1,subjectKind:'lifecycle',subjectId:saleId,subjectAction:'acknowledged',networkId,genesis:b58(genesis),program:programKey.toBase58(),signature,slot:'55',blockTime:'1234',finality:'finalized',sourceKind:'primary',sourceLabel:'test-primary',transactionBase64:wrapped,transactionDigest:createHash('sha256').update(bytes).digest('hex'),messageDigest:createHash('sha256').update(tx.message.serialize()).digest('hex'),rpcResult,parsedRpcResult:parsed,rpcResultDigest:'cd'.repeat(32)};
    const savedProof:Record<string,unknown>[]=[];
    const makeClient=(login:string,role:string):PaymentRpc=>({rpc:vi.fn(async(name,args)=>({data:name==='fn_payment_v2_worker_identity'?{login,role:args.p_required_role,superuser:false}:name==='fn_payment_v2_ack_context'?context:name==='fn_payment_v2_read_chain_evidence'?evidence:name==='fn_payment_v2_record_lifecycle'?(savedProof.push(args.p_proof as Record<string,unknown>),null):null,error:null}))});
    const recovered=await recoverCommittedClaimAcknowledgement(makeClient('settler_login','payment_v2_settler'),makeClient('verifier_login','payment_v2_verifier'),eventId);
    expect(recovered).toEqual({kind:'reconciled',signature,claim:'available'});
    expect(savedProof[0]).toMatchObject({saleId,kind:'acknowledged',outcome:'direct',generation:'4',revision:'9',cardCommitment:Buffer.from(cardCommitment).toString('hex'),signature,evidenceId:uuid});
  });

  it('keeps ACKs with never-verified history blocked and returns committed receipts without reading chain evidence',async()=>{
    const eventId=uuid,receipt={saleId:uuid,kind:'acknowledged',outcome:'direct',signature:'5'.repeat(88)};
    const context={eventId,saleId:uuid,generation:'1',revision:'1',sale:b58(k(80)),genesis:b58(k(81)),program:b58(k(82)),networkId:uuid,cardCommitment:b58(k(83)),kind:'direct',signature:'6'.repeat(88),receipt};
    const calls:string[]=[];
    const client=(login:string,role:string,evidence:unknown):PaymentRpc=>({rpc:vi.fn(async(name,args)=>{calls.push(name);return {data:name==='fn_payment_v2_worker_identity'?{login,role:args.p_required_role,superuser:false}:name==='fn_payment_v2_ack_context'?context:evidence,error:null};})});
    await expect(recoverCommittedClaimAcknowledgement(client('s','payment_v2_settler',null),client('v','payment_v2_verifier',null),eventId)).resolves.toEqual({kind:'receipt',receipt});
    expect(calls).not.toContain('fn_payment_v2_read_chain_evidence');
    const noReceipt={...context,receipt:null};
    const blocked=(login:string,role:string,evidence:unknown):PaymentRpc=>({rpc:vi.fn(async(name,args)=>({data:name==='fn_payment_v2_worker_identity'?{login,role:args.p_required_role,superuser:false}:name==='fn_payment_v2_ack_context'?noReceipt:evidence,error:null}))});
    await expect(recoverCommittedClaimAcknowledgement(blocked('s','payment_v2_settler',null),blocked('v','payment_v2_verifier',null),eventId)).rejects.toThrow('PAYMENT_V2_ACK_HISTORY_UNVERIFIED_REVIEW_REQUIRED');
  });
});
