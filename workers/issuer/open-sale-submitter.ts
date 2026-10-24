import { VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { decodePermit, encodePermit } from '@/lib/solana/protocol-v2';
import type { IssuerDatabase, IssuerContext } from './types';
import { buildOpenSalePair, type OpenSalePairPins } from './open-sale-pair';
import type { OpenSalePairSignRequest, SignerAlert, SignerAlertSink } from '@/workers/signer/types';

export interface OpenSaleChainState { genesis:string;slot:string;program:string;permit:Uint8Array;state:number;minTotal:string;expiresAt:string }
export interface OpenSaleBlockhash { genesis:string;blockhash:string;blockhashBlockHeight:string;currentBlockHeight:string;currentSlot:string }
export interface OpenSaleRpc { readSale(address:string):Promise<OpenSaleChainState|null>; latestBlockhash():Promise<OpenSaleBlockhash> }
export interface OpenSaleSigner { signValidated(request:OpenSalePairSignRequest):Promise<{signedTransactionBase64url:string}>; publicKey:string }
export interface OpenSaleSender { sendRawTransaction(bytes:Uint8Array):Promise<string> }
export interface OpenSalePins extends OpenSalePairPins { networkId:string; saleAddress(permit:Uint8Array):string }
export interface OpenSaleSubmitterDeps {
  db:IssuerDatabase;rpc:readonly [OpenSaleRpc,OpenSaleRpc];signer:OpenSaleSigner;sender:OpenSaleSender;alerts:SignerAlertSink;pins:OpenSalePins;
  allowList:ReadonlySet<string>;nowSeconds():number;
}
export interface OpenSaleSubmissionResult { saleId:string;operationId:string;outcome:'submitted'|'already-present'|'unknown'|'refused';code?:string }
const SEND_LEASE_MARGIN_MS=10_000;
function fail(code:string):never{throw new Error(code)}
function bytesHex(value:unknown,length:number):Uint8Array{if(typeof value!=='string'||!new RegExp(`^[0-9a-f]{${length*2}}$`).test(value))fail('ISSUER_OPEN_LISTING_MISSING');return Uint8Array.from(Buffer.from(value,'hex'))}
function identical(a:OpenSaleChainState|null,b:OpenSaleChainState|null):boolean{
  if(a===null||b===null)return a===b;
  const close=(left:string,right:string,delta:bigint)=>{try{const x=BigInt(left),y=BigInt(right);return x<=y+delta&&y<=x+delta}catch{return false}};
  return a.genesis===b.genesis&&a.program===b.program&&a.state===b.state&&a.minTotal===b.minTotal&&a.expiresAt===b.expiresAt&&close(a.slot,b.slot,BigInt('32'))&&Buffer.from(a.permit).equals(Buffer.from(b.permit));
}
function exactPda(state:OpenSaleChainState|null,permitBytes:Uint8Array,minTotal:string,expiresAt:string,genesis:string,program:string):boolean{
  return !!state&&state.genesis===genesis&&state.program===program&&state.state===1&&Buffer.from(state.permit).equals(Buffer.from(permitBytes))&&state.minTotal===minTotal&&state.expiresAt===expiresAt;
}
function sameContext(a:IssuerContext,b:IssuerContext):boolean{
  const fields=['saleId','listingId','ownerId','ownerAuthId','state','quoteTotalUnits','quoteExpiresAt','sellerWallet','sellerToken','saleCommitment','cardCommitment','generation','program','genesis','templateHex'];
  return fields.every(field=>a[field]===b[field]);
}
function equalBlockhash(a:OpenSaleBlockhash,b:OpenSaleBlockhash):boolean{
  try{const currentA=BigInt(a.currentBlockHeight),currentB=BigInt(b.currentBlockHeight),issued=BigInt(a.blockhashBlockHeight),slotA=BigInt(a.currentSlot),slotB=BigInt(b.currentSlot);
    return a.genesis===b.genesis&&a.blockhash===b.blockhash&&a.blockhashBlockHeight===b.blockhashBlockHeight&&close(slotA,slotB,BigInt('32'))&&currentA>=issued&&currentB>=issued&&currentA-issued<=BigInt('150')&&currentB-issued<=BigInt('150');
  }catch{return false}
}
function close(a:bigint,b:bigint,delta:bigint):boolean{return a<=b+delta&&b<=a+delta}
async function alert(deps:OpenSaleSubmitterDeps,event:SignerAlert):Promise<void>{await deps.alerts.deliver(event)}
async function finish(deps:OpenSaleSubmitterDeps,lease:IssuerContext,outcome:'send_ack'|'send_unknown'|'preexisting_exact_pda'|'conflict'|'retryable_failure',signature:string|null):Promise<void>{
  await deps.db.finishOpenSale(String(lease.operationId),String(lease.leaseId),String(lease.fencingToken),outcome,signature);
}
function leaseListing(lease:IssuerContext):{message:Uint8Array;signature:Uint8Array;minTotal:string;expiresAt:string}{
  const listing=lease.listing as Record<string,unknown>|undefined;
  if(!listing)fail('ISSUER_OPEN_LISTING_MISSING');
  return {message:bytesHex(listing.messageHex,61),signature:bytesHex(listing.signatureHex,64),minTotal:String(listing.minTotalUnits),expiresAt:String(listing.expiresAt)};
}

/** Claims by 086 fencing token, re-reads state under that lease, and sends only
 * the paired listing/open transaction. An RPC acknowledgement is submitted only. */
export async function runOpenSaleSubmitter(deps:OpenSaleSubmitterDeps):Promise<OpenSaleSubmissionResult[]>{
  const candidates=await deps.db.openSaleQueue(20);if(candidates.length===0)return [];
  const leases=await deps.db.claimOpenSale(Math.min(20,candidates.length)),results:OpenSaleSubmissionResult[]=[];
  for(const lease of leases){
    const saleId=String(lease.saleId),operationId=String(lease.operationId),requestId=`${operationId}:${lease.fencingToken}`;
    let stage:'before-sign'|'after-sign'|'sending'='before-sign',signedSignature:string|null=null,templateBytes:Uint8Array|null=null,saleAddress='';
    try{
      if(!lease.leaseId||!lease.fencingToken||!lease.listing)fail('ISSUER_OPEN_LISTING_MISSING');
      const owner=await deps.db.subjectContext('sale',saleId,null);
      if(owner.found!==true||owner.ownerId!==owner.ownerAuthId||!deps.allowList.has(String(owner.ownerId)))fail('ISSUER_OPEN_CONTEXT_MISMATCH');
      const first=await deps.db.saleSigningContext(saleId);
      if(first.state!=='opening'||first.found!==true||String(first.saleId)!==saleId||String(first.genesis)!==deps.pins.genesis||String(first.program)!==deps.pins.program||String(first.actor)!==deps.pins.issuer)fail('ISSUER_OPEN_WRONG_STATE');
      const listing=leaseListing(lease),template=bytesHex(first.templateHex,690),permit=decodePermit(template);templateBytes=template;
      if(base58Encode(permit.saleId)!==String(first.saleCommitment)||base58Encode(permit.issuer)!==deps.pins.issuer||base58Encode(permit.program)!==deps.pins.program)fail('ISSUER_OPEN_CONTEXT_MISMATCH');
      await deps.db.renewOpenSaleLease(operationId,String(lease.leaseId),String(lease.fencingToken));
      saleAddress=deps.pins.saleAddress(permit.saleId);
      const [chainA,chainB]=await Promise.all([deps.rpc[0].readSale(saleAddress),deps.rpc[1].readSale(saleAddress)]);
      if(!identical(chainA,chainB)||chainA&&chainA.genesis!==deps.pins.genesis){await alert(deps,{operation:'open-sale-pair',requestId,refusalCode:'ISSUER_RPC_DISAGREEMENT'});await finish(deps,lease,'retryable_failure',null);results.push({saleId,operationId,outcome:'refused',code:'ISSUER_RPC_DISAGREEMENT'});continue;}
      if(chainA){
        if(!exactPda(chainA,template,listing.minTotal,listing.expiresAt,deps.pins.genesis,deps.pins.program)){await alert(deps,{operation:'open-sale-pair',requestId,refusalCode:'ISSUER_OPEN_ACCOUNT_CONFLICT'});await finish(deps,lease,'conflict',null);results.push({saleId,operationId,outcome:'refused',code:'ISSUER_OPEN_ACCOUNT_CONFLICT'});continue;}
        await finish(deps,lease,'preexisting_exact_pda',null);results.push({saleId,operationId,outcome:'already-present'});continue;
      }
      const [blockA,blockB]=await Promise.all([deps.rpc[0].latestBlockhash(),deps.rpc[1].latestBlockhash()]);
      if(!equalBlockhash(blockA,blockB)||blockA.genesis!==deps.pins.genesis||BigInt(blockA.currentBlockHeight)<BigInt(blockA.blockhashBlockHeight)||BigInt(blockA.currentBlockHeight)-BigInt(blockA.blockhashBlockHeight)>BigInt('150'))fail('ISSUER_RPC_DISAGREEMENT');
      const tx=await buildOpenSalePair({permitTemplate:template,listingMessage:listing.message,sellerSignature:listing.signature,blockhash:blockA.blockhash,pins:deps.pins});
      const request:OpenSalePairSignRequest={kind:'open-sale-pair',requestId,saleId,permitBase64url:Buffer.from(template).toString('base64url'),listingMessageBase64url:Buffer.from(listing.message).toString('base64url'),sellerSignatureBase64url:Buffer.from(listing.signature).toString('base64url'),blockhash:blockA.blockhash,currentBlockHeight:blockA.currentBlockHeight,currentSlot:blockA.currentSlot,blockhashBlockHeight:blockA.blockhashBlockHeight,transactionBase64url:Buffer.from(tx.serialize()).toString('base64url')};
      stage='after-sign';const signed=await deps.signer.signValidated(request),signedBytes=Buffer.from(signed.signedTransactionBase64url,'base64url'),signedTx=VersionedTransaction.deserialize(signedBytes);
      if(!Buffer.from(signedTx.message.serialize()).equals(Buffer.from(tx.message.serialize()))||!signedTx.signatures[0]||signedTx.signatures[0]!.every(byte=>byte===0))fail('ISSUER_TRANSACTION_INVALID');
      signedSignature=base58Encode(signedTx.signatures[0]!);
      await deps.db.renewOpenSaleLease(operationId,String(lease.leaseId),String(lease.fencingToken));
      const [currentOwner,current]=await Promise.all([deps.db.subjectContext('sale',saleId,null),deps.db.saleSigningContext(saleId)]);
      if(currentOwner.ownerId!==owner.ownerId||currentOwner.ownerAuthId!==owner.ownerAuthId||!sameContext(first,current)||current.state!=='opening')fail('ISSUER_OPEN_LEASE_LOST');
      const [beforeSendA,beforeSendB]=await Promise.all([deps.rpc[0].readSale(saleAddress),deps.rpc[1].readSale(saleAddress)]);
      if(!identical(beforeSendA,beforeSendB)||beforeSendA!==null)fail('ISSUER_OPEN_ACCOUNT_CONFLICT');
      const renewalStarted=Date.now(),renewedUntil=await deps.db.renewOpenSaleLease(operationId,String(lease.leaseId),String(lease.fencingToken));
      // Compare against the time before the RPC began; this is conservative
      // across the renewal round trip and does not depend on the issuer clock.
      const leaseMargin=Date.parse(renewedUntil)-renewalStarted;
      if(!Number.isFinite(leaseMargin)||leaseMargin<SEND_LEASE_MARGIN_MS)fail('ISSUER_OPEN_LEASE_LOST');
      // This commit-to-send window cannot be fenced by Postgres. If the lease
      // expires after renewal but before/while send, recover by observing the
      // PDA on both providers; never treat the send acknowledgement as success.
      stage='sending';const acknowledged=await deps.sender.sendRawTransaction(signedBytes);
      await finish(deps,lease,'send_ack',acknowledged);results.push({saleId,operationId,outcome:'submitted'});
    }catch(error){
      const code=error instanceof Error?error.message:'ISSUER_INTERNAL';
      if(stage==='sending'&&signedSignature){
        try{if(!templateBytes||!saleAddress)throw new Error('ISSUER_OPEN_CONTEXT_MISMATCH');const [a,b]=await Promise.all([deps.rpc[0].readSale(saleAddress),deps.rpc[1].readSale(saleAddress)]);
          if(identical(a,b)&&exactPda(a,templateBytes,leaseListing(lease).minTotal,leaseListing(lease).expiresAt,deps.pins.genesis,deps.pins.program)){await finish(deps,lease,'preexisting_exact_pda',signedSignature);results.push({saleId,operationId,outcome:'already-present'});continue;}
          await finish(deps,lease,'send_unknown',signedSignature);results.push({saleId,operationId,outcome:'unknown',code:'ISSUER_OPEN_SUBMIT_UNKNOWN'});continue;
        }catch{await finish(deps,lease,'send_unknown',signedSignature);results.push({saleId,operationId,outcome:'unknown',code:'ISSUER_OPEN_SUBMIT_UNKNOWN'});continue;}
      }
      await alert(deps,{operation:'open-sale-pair',requestId,refusalCode:code});
      await finish(deps,lease,stage==='after-sign'?'retryable_failure':'retryable_failure',null);
      results.push({saleId,operationId,outcome:'refused',code});
    }
  }
  return results;
}
