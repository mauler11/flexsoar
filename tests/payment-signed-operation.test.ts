import { describe,it,expect,vi } from 'vitest';
import { mkdtempSync,writeFileSync,readFileSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction } from '@solana/web3.js';
import { outcomeInstruction } from '../lib/solana/v2-sdk';
import type { PermitV2 } from '../lib/solana/protocol-v2';
import { base58Encode } from '../lib/solana/base58';
import { inspectSignedOperation,stageSignedOperation,loadSignedOperation,signedOperationRecovery,type ExitPlan,type SignedOperationEnvelope,type RecoveryObservation } from '../lib/db/payment-signed-operation';
const bytes=(n:number)=>new Uint8Array(32).fill(n),key=(n:number)=>new PublicKey(bytes(n)).toBase58(),digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const p:PermitV2={mode:0,domain:bytes(1),program:bytes(2),config:bytes(3),saleId:bytes(4),card:bytes(5),pair:bytes(6),attempt:bytes(7),beneficiary:bytes(8),policy:bytes(9),buyer:bytes(10),seller:bytes(11),treasury:bytes(12),mint:bytes(13),tokenProgram:bytes(14),buyerToken:bytes(15),sellerToken:bytes(16),treasuryToken:bytes(17),refundToken:bytes(18),issuer:bytes(19),generation:BigInt(1),revision:BigInt(1),custodyVersion:BigInt(1),authorityEpoch:BigInt(1),total:BigInt(100),net:BigInt(95),fee:BigInt(5),validFrom:BigInt(1),expiresAt:BigInt(99)};
 const ix=await outcomeInstruction(key(2),p,BigInt(1)),payer=Keypair.generate(),blockhash=key(29);
 const plan:ExitPlan={operationId:'00000000-0000-0000-0000-000000000001',networkId:'00000000-0000-0000-0000-000000000002',genesis:key(1),program:key(2),action:'execute_outcome',expectedRevision:'1',payloadDigest:'ab'.repeat(32),instruction:{programId:ix.programId.toBase58(),dataBase64:ix.data.toString('base64'),accounts:ix.keys.map(k=>({pubkey:k.pubkey.toBase58(),isSigner:k.isSigner,isWritable:k.isWritable}))}};
 function sign(instructions:TransactionInstruction[]=[ix]):SignedOperationEnvelope{
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message());tx.sign([payer]);const raw=tx.serialize();
  return {plan,transactionBase64:Buffer.from(raw).toString('base64'),transactionDigest:digest(raw),messageDigest:digest(tx.message.serialize()),signature:base58Encode(tx.signatures[0]),blockhash,lastValidBlockHeight:'1000'};
 }
 const envelope=sign(),observation:RecoveryObservation={networkId:plan.networkId,program:plan.program,saleAddress:plan.instruction.accounts[1].pubkey,genesis:plan.genesis,signature:envelope.signature,complete:true,signatureState:'not_found',saleState:'funded',decisionRevision:'1',outflowPaused:false,blockHeight:'900',blockhash,blockhashValid:true};
 return {plan,envelope,observation,sign,ix};
}
describe('actual offline signed-operation validation; no database/concurrency proof',()=>{
 it('validates the actual offline SQL-fixture generator with the production inspector',async()=>{
  const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'flexsoar-payment-synthetic-')),input=join(dir,'flexsoar-payment-synthetic-plan.json'),output=join(dir,'flexsoar-payment-synthetic-envelope.json');
  try {writeFileSync(input,JSON.stringify(f.plan),{flag:'wx'});
   execFileSync(process.execPath,[resolve('tests/payment-db/make-signed-fixture.mjs'),'ISOLATED_SYNTHETIC_ONLY',input,output],{stdio:'pipe'});
   expect(inspectSignedOperation(JSON.parse(readFileSync(output,'utf8')),f.plan).plan).toEqual(f.plan);
  } finally {for(const p of [output,input])try{unlinkSync(p);}catch(e){if(!(e instanceof Error)||!('code' in e)||e.code!=='ENOENT')throw e;}rmdirSync(dir);}
 });
 it('validates actual SDK exit and sponsored network fee signature',async()=>{const f=await fixture();expect(inspectSignedOperation(f.envelope,f.plan)).toEqual(f.envelope);});
 it('rejects signature corruption even if unsigned hashes are recomputed',async()=>{const f=await fixture(),raw=Buffer.from(f.envelope.transactionBase64,'base64');raw.fill(0,1,65);expect(()=>inspectSignedOperation({...f.envelope,transactionBase64:raw.toString('base64'),transactionDigest:digest(raw)},f.plan)).toThrow('signature');});
 it('rejects wrong accounts/program/arguments and unrelated extra instructions',async()=>{const f=await fixture();
  const wrong=new TransactionInstruction({...f.ix,data:Buffer.alloc(16)});expect(()=>inspectSignedOperation(f.sign([wrong]),f.plan)).toThrow('intent');
  const program=new TransactionInstruction({...f.ix,programId:new PublicKey(bytes(27))});expect(()=>inspectSignedOperation(f.sign([program]),f.plan)).toThrow('intent');
  const accounts=new TransactionInstruction({...f.ix,keys:f.ix.keys.map((k,i)=>i===3?{...k,pubkey:new PublicKey(bytes(28))}:k)});expect(()=>inspectSignedOperation(f.sign([accounts]),f.plan)).toThrow('account');
  expect(()=>inspectSignedOperation(f.sign([f.ix,f.ix]),f.plan)).toThrow('layout');
 });
 it.each(['transactionDigest','messageDigest','blockhash','signature'] as const)('rejects tampered %s metadata',async field=>{const f=await fixture();expect(()=>inspectSignedOperation({...f.envelope,[field]:'wrong'},f.plan)).toThrow('mismatch');});
 it('persists before returning; lost response and lease takeover restore identical bytes',async()=>{
  const f=await fixture();let stored:SignedOperationEnvelope|null=null;let lose=true;
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{if(name==='fn_payment_v2_signed_operation')return {data:{plan:f.plan,envelope:stored},error:null};
   if(name==='fn_payment_v2_stage_signed_operation'){stored=args.p_envelope as SignedOperationEnvelope;if(lose){lose=false;throw new Error('ACK lost after commit');}return {data:null,error:null};}throw new Error('unexpected RPC');});
  await expect(stageSignedOperation({rpc},f.plan.operationId,'old-lease',f.envelope)).rejects.toThrow('ACK lost');
  const recovered=await loadSignedOperation({rpc},f.plan.operationId,'new-lease');expect(recovered.envelope).toEqual(f.envelope);
  expect(signedOperationRecovery(recovered.envelope,f.plan,f.observation)).toEqual({kind:'retransmit_identical',bytes:Buffer.from(f.envelope.transactionBase64,'base64')});
  await stageSignedOperation({rpc},f.plan.operationId,'new-lease',f.envelope);expect(stored).toEqual(f.envelope);
 });
 it('crash before persistence cannot produce a stored record or permission to broadcast',async()=>{const f=await fixture();const rpc=vi.fn(async(name:string)=>name==='fn_payment_v2_signed_operation'?{data:{plan:f.plan,envelope:null},error:null}:{data:null,error:{message:'storage unavailable'}});
  await expect(stageSignedOperation({rpc},f.plan.operationId,'lease',f.envelope)).rejects.toThrow('storage unavailable');});
 it('reconciles finalized sale outcome after lost broadcast response, regardless of signature lookup',async()=>{const f=await fixture();expect(signedOperationRecovery(f.envelope,f.plan,{...f.observation,saleState:'released'})).toEqual({kind:'reconcile'});});
 it.each([
  {complete:false},{signatureState:'unavailable' as const},{signatureState:'pending' as const},{signatureState:'finalized_failure' as const},
  {saleState:'unknown' as const},{blockHeight:'1001'},{blockhashValid:false},{outflowPaused:true},{decisionRevision:'2'},{genesis:'wrong'},{program:'wrong'},{saleAddress:'wrong'},{networkId:'wrong'},
 ])('fails closed on incomplete/expired/failed/stale observation %j',async change=>{const f=await fixture();expect(signedOperationRecovery(f.envelope,f.plan,{...f.observation,...change}).kind).toBe('blocked');});
 it('never replaces an already persisted signature',async()=>{const f=await fixture();const other=await fixture();const rpc=vi.fn(async()=>({data:{plan:f.plan,envelope:f.envelope},error:null}));await expect(stageSignedOperation({rpc},f.plan.operationId,'lease',{...other.envelope,plan:f.plan})).rejects.toThrow('replaced');expect(rpc).toHaveBeenCalledTimes(1);});
});
