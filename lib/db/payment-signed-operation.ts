/** Offline validation and durable storage only. Never signs, broadcasts or marks money paid. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { paymentRpc, type PaymentRpc } from './payment-v2';
export interface ExitPlan {
 operationId:string;networkId:string;genesis:string;program:string;action:'execute_outcome';expectedRevision:string;payloadDigest:string;
 instruction:{programId:string;dataBase64:string;accounts:{pubkey:string;isSigner:boolean;isWritable:boolean}[]};
}
export interface SignedOperationEnvelope {plan:ExitPlan;transactionBase64:string;transactionDigest:string;messageDigest:string;signature:string;blockhash:string;lastValidBlockHeight:string}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('invalid signed operation record');return v as Record<string,unknown>;};
function str(v:unknown):string {if(typeof v!=='string')throw new Error('invalid signed operation field');return v;}
function decimal(v:unknown):string {const s=str(v);if(!/^\d+$/.test(s)||BigInt(s)>=(BigInt(1)<<BigInt(64)))throw new Error('invalid unsigned validity/revision');return s;}
function b64(v:unknown):Buffer {const s=str(v),b=Buffer.from(s,'base64');if(b.toString('base64')!==s)throw new Error('noncanonical signed bytes');return b;}
export function parseExitPlan(value:unknown):ExitPlan {
 const r=record(value),ix=record(r.instruction);if(r.action!=='execute_outcome'||!Array.isArray(ix.accounts)||ix.accounts.length!==8)throw new Error('unsupported bounded operation');
 const accounts=ix.accounts.map(v=>{const a=record(v);if(typeof a.isSigner!=='boolean'||typeof a.isWritable!=='boolean')throw new Error('invalid account flags');return {pubkey:str(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable};});
 const plan:ExitPlan={operationId:str(r.operationId),networkId:str(r.networkId),genesis:str(r.genesis),program:str(r.program),action:r.action,expectedRevision:decimal(r.expectedRevision),payloadDigest:str(r.payloadDigest),instruction:{programId:str(ix.programId),dataBase64:str(ix.dataBase64),accounts}};
 if(plan.instruction.programId!==plan.program||!/^[0-9a-f]{64}$/.test(plan.payloadDigest))throw new Error('operation program/digest mismatch');
 const data=b64(ix.dataBase64),expected=Buffer.alloc(16);createHash('sha256').update('global:execute_outcome').digest().copy(expected,0,0,8);expected.writeBigUInt64LE(BigInt(plan.expectedRevision),8);
 if(!data.equals(expected)||accounts.some((a,i)=>a.isSigner||a.isWritable!==(i<6)))throw new Error('operation instruction mismatch');return plan;
}
/** expected must come from the leased DB context, independently of signed bytes. */
export function inspectSignedOperation(value:unknown,expected:ExitPlan):SignedOperationEnvelope {
 const r=record(value),plan=parseExitPlan(r.plan);if(JSON.stringify(plan)!==JSON.stringify(parseExitPlan(expected)))throw new Error('immutable operation plan mismatch');
 const raw=b64(r.transactionBase64);if(raw.length>1232)throw new Error('signed transaction exceeds packet size');
 const tx=VersionedTransaction.deserialize(raw),m=tx.message;
 if(!Buffer.from(tx.serialize()).equals(raw)||m.addressTableLookups.length||m.header.numRequiredSignatures!==1||tx.signatures.length!==1||m.compiledInstructions.length!==1)throw new Error('unsupported signed message layout/instructions');
 const keys=m.getAccountKeys(),ix=m.compiledInstructions[0],intent=plan.instruction;
 if(keys.get(ix.programIdIndex)?.toBase58()!==intent.programId||!Buffer.from(ix.data).equals(b64(intent.dataBase64))||ix.accountKeyIndexes.length!==intent.accounts.length)throw new Error('signed instruction differs from intent');
 ix.accountKeyIndexes.forEach((index,i)=>{const a=intent.accounts[i];if(keys.get(index)?.toBase58()!==a.pubkey||m.isAccountSigner(index)!==a.isSigner||m.isAccountWritable(index)!==a.isWritable)throw new Error('signed account differs from intent');});
 const signer=keys.get(0);if(!signer)throw new Error('missing fee signer');
 const message=m.serialize(),key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),signer.toBuffer()]),format:'der',type:'spki'});
 if(!verify(null,message,key,tx.signatures[0]))throw new Error('invalid Ed25519 signature');
 const envelope:SignedOperationEnvelope={plan,transactionBase64:raw.toString('base64'),transactionDigest:hash(raw),messageDigest:hash(message),signature:base58Encode(tx.signatures[0]),blockhash:m.recentBlockhash,lastValidBlockHeight:decimal(r.lastValidBlockHeight)};
 for(const name of ['transactionDigest','messageDigest','signature','blockhash'] as const)if(r[name]!==envelope[name])throw new Error('signed envelope '+name+' mismatch');return envelope;
}
export async function loadSignedOperation(executor:PaymentRpc,operationId:string,leaseId:string):Promise<{plan:ExitPlan;envelope:SignedOperationEnvelope|null}> {
 const r=record(await paymentRpc(executor,'fn_payment_v2_signed_operation',{p_operation_id:operationId,p_lease_id:leaseId}));const plan=parseExitPlan(r.plan);
 if(plan.operationId!==operationId)throw new Error('operation identity mismatch');return {plan,envelope:r.envelope===null?null:inspectSignedOperation(r.envelope,plan)};
}
/** Caller must obtain validity metadata from its trusted blockhash provider before signing.
 * Metadata is not signed by Solana; provider trust must be established by integration. */
export async function stageSignedOperation(executor:PaymentRpc,operationId:string,leaseId:string,value:unknown):Promise<SignedOperationEnvelope> {
 const current=await loadSignedOperation(executor,operationId,leaseId),e=inspectSignedOperation(value,current.plan);
 if(current.envelope&&JSON.stringify(current.envelope)!==JSON.stringify(e))throw new Error('signed operation cannot be replaced');
 await paymentRpc(executor,'fn_payment_v2_stage_signed_operation',{p_operation_id:operationId,p_lease_id:leaseId,p_envelope:e});return e;
}
export interface RecoveryObservation {
 networkId:string;genesis:string;program:string;saleAddress:string;signature:string;complete:boolean;signatureState:'finalized_success'|'finalized_failure'|'pending'|'not_found'|'unavailable';
 saleState:'funded'|'released'|'refunded'|'unknown';decisionRevision:string;outflowPaused:boolean;
 blockHeight:string;blockhash:string;blockhashValid:boolean;
}
export type RecoveryDecision={kind:'reconcile'}|{kind:'blocked';reason:string}|{kind:'retransmit_identical';bytes:Uint8Array};
/** A decision only, with no send primitive. A trusted observer must first check
 * original signature AND retained Sale state at a consistent finalized context. */
export function signedOperationRecovery(value:unknown,plan:ExitPlan,observed:RecoveryObservation):RecoveryDecision {
 const e=inspectSignedOperation(value,plan);
 if(observed.complete!==true||!['finalized_success','finalized_failure','pending','not_found','unavailable'].includes(observed.signatureState)||!['funded','released','refunded','unknown'].includes(observed.saleState)||typeof observed.outflowPaused!=='boolean'||observed.networkId!==plan.networkId||observed.program!==plan.program||observed.saleAddress!==plan.instruction.accounts[1].pubkey||observed.genesis!==plan.genesis||observed.signature!==e.signature||observed.signatureState==='unavailable'||observed.saleState==='unknown')return {kind:'blocked',reason:'authoritative chain observation unavailable or mismatched'};
 if(observed.saleState==='released'||observed.saleState==='refunded'||observed.signatureState==='finalized_success')return {kind:'reconcile'};
 if(observed.signatureState==='finalized_failure')return {kind:'blocked',reason:'finalized failure: verify and close original operation; replacement protocol not implemented'};
 if(observed.signatureState==='pending')return {kind:'blocked',reason:'wait for original signature outcome'};
 if(observed.decisionRevision!==plan.expectedRevision||observed.outflowPaused)return {kind:'blocked',reason:'hold/revision/pause requires reconciliation'};
 if(observed.blockhash!==e.blockhash||observed.blockhashValid!==true||BigInt(decimal(observed.blockHeight))>BigInt(e.lastValidBlockHeight))return {kind:'blocked',reason:'expired or invalid original transaction: no automatic replacement'};
 return {kind:'retransmit_identical',bytes:Buffer.from(e.transactionBase64,'base64')};
}
