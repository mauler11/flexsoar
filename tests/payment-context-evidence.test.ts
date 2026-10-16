import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { encodePermit, type PermitV2 } from '@/lib/solana/protocol-v2';
import { claimAcknowledgementInstruction, decisionInstructionFromContext, openSaleInstructionFromContext, revokeSaleInstructionFromContext } from '@/lib/solana/v2-context';
import { acquireFinalizedEvidence, parseFinalizedRpcJson, validateRetainedFinalizedEvidence, type FinalizedRpcResult, type FinalizedTransactionSource, type ParsedFinalizedRpcResult } from '@/lib/solana/v2-evidence';
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

function signedSample() {
  const payer=Keypair.generate(),recipient=Keypair.generate().publicKey;
  const msg=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:base58Encode(k(21)),instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:1})]}).compileToV0Message();
  const transaction=new VersionedTransaction(msg);transaction.sign([payer]);
  const signature=base58Encode(transaction.signatures[0]);
  const encoded=Buffer.from(transaction.serialize()).toString('base64');
  const wire:FinalizedRpcResult={slot:42,blockTime:1234,transaction:[encoded,'base64'],meta:{err:null},version:0};
  const parsed:ParsedFinalizedRpcResult={slot:42,blockTime:1234,transaction:{signatures:[signature],message:{accountKeys:[{pubkey:payer.publicKey.toBase58(),signer:true,writable:true}],instructions:[]}},meta:{err:null}};
  return {signature,wire,parsed};
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
    await expect(acquireFinalizedEvidence(primary,source('archive:corrupt',genesis,{...sample,wire:{...sample.wire,meta:{err:{InstructionError:[0,'Custom']}}}}),expected,inspect)).rejects.toThrow(/conflict/);
  });

  it('rejects wrong message identity and conflicting primary/archive evidence',async()=>{
    const sample=signedSample(),other=signedSample(),genesis=base58Encode(k(61)),expected={networkId:uuid,genesis,program:publicKey(62).toBase58(),signature:sample.signature,subjectKind:'attestation' as const,subjectId:uuid,subjectAction:'receipt'};
    const inspect=(_tx:unknown,sig:string)=>{if(sig!==sample.signature)throw new Error('signature does not bind expected instruction');};
    const primary=source('primary',genesis,sample),archive=source('archive:different',genesis,other);
    await expect(acquireFinalizedEvidence(primary,archive,expected,inspect)).rejects.toThrow(/signature mismatch|conflict/);
    await expect(acquireFinalizedEvidence({ ...primary,getTransaction:async()=>null },null,expected,inspect)).rejects.toThrow(/history unavailable/);
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
    const compiled=tx.message.compiledInstructions[0],parsed={slot:55,blockTime:1234,transaction:{signatures:[signature],message:{accountKeys,instructions:[{programId:staticKeys[compiled.programIdIndex].toBase58(),accounts:compiled.accountKeyIndexes.map(i=>staticKeys[i].toBase58()),data:b58(compiled.data)}]}},meta:{err:null}};
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
