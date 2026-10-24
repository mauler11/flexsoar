import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { validateSignerRequest, signValidatedTransaction } from './validator';
import type { SignRequest, SignResponse, SignerAlert, SignerAlertSink, SignerClock, SignerPins, SignerRuntimeConfig } from './types';
import { assertCustodyFile, assertCustodyRoot, createRateJournalInitializationMarker, requireOrInitializeRateJournal } from './storage';

const RATE_LIMITS={'open-sale-pair':2,'buy-sale':5} as const;
const WINDOW_SECONDS=60;
function syncFd(fd:number):void{if(process.platform==='linux')fsyncSync(fd)}
function durableAppend(path:string,line:string):void{
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const fd=openSync(path,'a',0o600);
  try{writeFileSync(fd,line);syncFd(fd)}finally{closeSync(fd)}
}
function persistJournal(path:string,journal:{lastNow:number;accepted:Record<string,number[]>}):void{
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const temp=`${path}.${process.pid}.tmp`;
  writeFileSync(temp,JSON.stringify(journal),{flag:'wx',mode:0o600});const fd=openSync(temp,'r');try{syncFd(fd)}finally{closeSync(fd)}
  renameSync(temp,path);if(process.platform==='linux'){const dir=openSync(dirname(path),'r');try{syncFd(dir)}finally{closeSync(dir)}}
}
function readJournal(path:string,custodyRoot:string,markerPath:string):{lastNow:number;accepted:Record<string,number[]>}{
  requireOrInitializeRateJournal(path,markerPath,custodyRoot);
  assertCustodyFile(path,custodyRoot);
  const parsed=JSON.parse(readFileSync(path,'utf8')) as {lastNow:number;accepted:Record<string,number[]>};
  if(!Number.isSafeInteger(parsed.lastNow)||!parsed.accepted||!Array.isArray(parsed.accepted['open-sale-pair'])||!Array.isArray(parsed.accepted['buy-sale']))throw new Error('SIGNER_RATE_JOURNAL_CORRUPT');
  return parsed;
}

/** Key-file custody is intentionally fixed at startup. The process boundary does not
 * authorize requests: a compromised issuer can still request any structurally valid
 * signature, bounded by the founder-accepted floor, buyer co-signature, canary caps,
 * and signer rate limit (issuer-service-design.md §11.1). There is no fallback mode. */
export function loadSignerKeyFile(config:SignerRuntimeConfig):Keypair{
  if(config.custodyMode!=='key-file')throw new Error('SIGNER_CUSTODY_MODE_UNSUPPORTED');
  const signerUid=process.getuid?.();
  if(signerUid===undefined)throw new Error('SIGNER_KEY_FILE_PERMISSIONS');
  try{assertCustodyFile(config.secretKeyPath,config.custodyRoot,signerUid)}catch{throw new Error('SIGNER_KEY_FILE_PERMISSIONS')}
  const raw=JSON.parse(readFileSync(config.secretKeyPath,'utf8')) as unknown;
  if(!Array.isArray(raw)||raw.length!==64||raw.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error('SIGNER_KEY_FILE_INVALID');
  const keypair=Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  if(keypair.publicKey.toBase58()!==config.issuerPublicKey||keypair.publicKey.toBase58()!==config.pins.issuer)throw new Error('SIGNER_KEY_MISMATCH');
  return keypair;
}

export interface SignerCore { sign(request:SignRequest):Promise<SignResponse>; publicKey:string }
export function createSignerCore(keypair:Keypair,pins:SignerPins,options:{rateJournalPath:string;auditPath:string;alertQueuePath:string;alerts:SignerAlertSink;custodyRoot?:string;initializationMarkerPath?:string;clock?:SignerClock}):SignerCore{
  if(keypair.publicKey.toBase58()!==pins.issuer)throw new Error('SIGNER_KEY_MISMATCH');
  const custodyRoot=options.custodyRoot??dirname(options.rateJournalPath),markerPath=options.initializationMarkerPath??join(custodyRoot,'.rate-journal-init');
  assertCustodyRoot(custodyRoot);
  const clock=options.clock??{nowSeconds:()=>Math.floor(Date.now()/1000)};
  let enabled=true;
  const alert=async(event:SignerAlert):Promise<void>=>{
    const line=`${JSON.stringify({...event,at:clock.nowSeconds()})}\n`;
    try{durableAppend(options.auditPath,line)}catch{enabled=false;throw new Error('SIGNER_AUDIT_UNAVAILABLE')}
    try{await options.alerts.deliver(event)}catch(error){
      try{durableAppend(options.alertQueuePath,line);durableAppend(options.alertQueuePath,`${JSON.stringify({...event,at:clock.nowSeconds(),refusalCode:'SIGNER_ALERT_DELIVERY_FAILED'})}\n`)}catch{enabled=false;throw new Error('SIGNER_ALERT_QUEUE_UNAVAILABLE')}
      enabled=false;throw new Error('SIGNER_ALERT_DELIVERY_FAILED', {cause:error});
    }
  };
  return {publicKey:keypair.publicKey.toBase58(),async sign(request){
    const requestId=typeof request.requestId==='string'&&request.requestId.length<=128?request.requestId:'invalid-request';
    if(!enabled)throw new Error('SIGNER_DISABLED');
    let journal:{lastNow:number;accepted:Record<string,number[]>};
    try{journal=readJournal(options.rateJournalPath,custodyRoot,markerPath)}catch{enabled=false;await alert({operation:request.kind,requestId,refusalCode:'SIGNER_RATE_JOURNAL_CORRUPT'});throw new Error('SIGNER_RATE_JOURNAL_CORRUPT')}
    const now=clock.nowSeconds();
    if(now<journal.lastNow){enabled=false;await alert({operation:request.kind,requestId,refusalCode:'SIGNER_CLOCK_ROLLBACK'});throw new Error('SIGNER_CLOCK_ROLLBACK')}
    const old=journal.accepted[request.kind].filter(t=>t>now-WINDOW_SECONDS);
    if(old.length>=RATE_LIMITS[request.kind]){journal.lastNow=now;journal.accepted[request.kind]=old;try{persistJournal(options.rateJournalPath,journal)}catch{enabled=false}
      await alert({operation:request.kind,requestId,refusalCode:'SIGNER_RATE_LIMITED'});throw new Error('SIGNER_RATE_LIMITED')}
    try{
      const tx=await validateSignerRequest(request,pins);
      journal.lastNow=now;journal.accepted[request.kind]=[...old,now];
      try{persistJournal(options.rateJournalPath,journal)}catch{enabled=false;await alert({operation:request.kind,requestId,refusalCode:'SIGNER_RATE_JOURNAL_WRITE_FAILED'});throw new Error('SIGNER_RATE_JOURNAL_WRITE_FAILED')}
      const result=signValidatedTransaction(tx,keypair,pins.issuer);
      return {signedTransactionBase64url:result};
    }catch(error){
      const code=error instanceof Error&&/^SIGNER_/.test(error.message)?error.message:'SIGNER_TRANSACTION_INVALID';
      try{await alert({operation:request.kind,requestId,refusalCode:code})}catch{}
      throw new Error(code);
    }
  }};
}

export function signerPublicKeyFromBytes(bytes:Uint8Array):string{
  if(bytes.length!==64)throw new Error('SIGNER_KEY_FILE_INVALID');return base58Encode(bytes.subarray(32));
}
