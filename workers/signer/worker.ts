import { readFileSync, readlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSignerCore, loadSignerKeyFile } from './core';
import type { SignRequest, SignerAlert, SignerRuntimeConfig } from './types';
import { validateSignerPins } from './validator';
import { assertCustodyFile, readCustodyFile, requireOrInitializeRateJournal, verifySignerStorage } from './storage';

type JsonObject=Record<string,unknown>;
function object(value:unknown):JsonObject{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('SIGNER_REQUEST_INVALID');return value as JsonObject}
function assertMappedCustodyIdentity(uid:number,gid:number):void{
  const mapped=(path:string,expected:number)=>{
    const rows=readFileSync(path,'utf8').trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
    if(!rows.some(([inside,outside,count])=>inside===0&&outside===expected&&count!==undefined&&count>=1))throw new Error('SIGNER_CUSTODY_IDENTITY_MISMATCH');
  };
  mapped('/proc/self/uid_map',uid);mapped('/proc/self/gid_map',gid);
}
function parseRequest(value:unknown):SignRequest{
  const request=object(value),kind=request.kind;
  const fields=kind==='open-sale-pair'?['kind','requestId','saleId','permitBase64url','listingMessageBase64url','sellerSignatureBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:kind==='buy-sale'?['kind','requestId','attemptId','permitSha256','permitBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:[];
  if(fields.length===0||Object.keys(request).sort().join('|')!==fields.sort().join('|')||fields.some(field=>typeof request[field]!=='string'))throw new Error('SIGNER_TYPED_REQUEST_REQUIRED');
  return request as unknown as SignRequest;
}
function loadConfig(path:string):SignerRuntimeConfig{
  const uid=process.getuid?.();if(uid===undefined)throw new Error('SIGNER_CUSTODY_IDENTITY_UNAVAILABLE');
  try{assertCustodyFile(path,dirname(path),uid)}catch{throw new Error('SIGNER_CONFIG_FILE_PERMISSIONS')}
  const config=object(JSON.parse(readCustodyFile(path,dirname(path))));
  if(config.custodyMode!=='key-file'||typeof config.custodyRoot!=='string'||typeof config.pinsFilePath!=='string'||typeof config.initializationMarkerPath!=='string'||typeof config.secretKeyPath!=='string'||typeof config.issuerPublicKey!=='string'||typeof config.auditPath!=='string'||typeof config.rateJournalPath!=='string'||typeof config.alertQueuePath!=='string'||!Number.isSafeInteger(config.signerUid)||!Number.isSafeInteger(config.signerGid)||!Number.isSafeInteger(config.allowedPeerUid)||!Number.isSafeInteger(config.allowedPeerPid)||Number(config.allowedPeerPid)<1)throw new Error('SIGNER_STARTUP_CONFIG_INVALID');
  assertMappedCustodyIdentity(Number(config.signerUid),Number(config.signerGid));
  verifySignerStorage({custodyRoot:config.custodyRoot,configPath:path,pinsFilePath:config.pinsFilePath,secretKeyPath:config.secretKeyPath,rateJournalPath:config.rateJournalPath,initializationMarkerPath:config.initializationMarkerPath,auditPath:String(config.auditPath),alertQueuePath:String(config.alertQueuePath),uid});
  requireOrInitializeRateJournal(String(config.rateJournalPath),String(config.initializationMarkerPath),String(config.custodyRoot),uid);
  const pins=object(JSON.parse(readCustodyFile(config.pinsFilePath,config.custodyRoot)));
  const result={...config,pins} as unknown as SignerRuntimeConfig;
  if(result.issuerPublicKey!==process.env.ISSUER_SIGNER_EXPECTED_PUBLIC_KEY)throw new Error('SIGNER_STARTUP_PUBLIC_KEY_MISMATCH');
  if(result.signerUid===result.allowedPeerUid&&!(result.devOnly===true&&process.env.ISSUER_SIGNER_DEV_MODE==='1'))throw new Error('SIGNER_SAME_USER_DEV_ONLY');
  return result;
}
class StdoutAlertSink {
  async deliver(event:SignerAlert):Promise<void>{process.stderr.write(`${JSON.stringify({type:'signer-refusal',...event})}\n`)}
}
export async function runSignerWorker(configPath=process.env.ISSUER_SIGNER_CONFIG):Promise<void>{
  if(!configPath)throw new Error('SIGNER_STARTUP_CONFIG_MISSING');
  const permittedEnv=new Set(['PATH','NODE_ENV','ISSUER_SIGNER_CONFIG','ISSUER_SIGNER_EXPECTED_PUBLIC_KEY','ISSUER_SIGNER_PARENT_NETNS','ISSUER_SIGNER_DEV_MODE']);
  if(Object.keys(process.env).some(name=>!permittedEnv.has(name)))throw new Error('SIGNER_ENVIRONMENT_NOT_ISOLATED');
  const parentNetns=process.env.ISSUER_SIGNER_PARENT_NETNS;
  const devices=readFileSync('/proc/self/net/dev','utf8').split('\n').slice(2).map(line=>line.split(':')[0]?.trim()).filter(name=>name);
  if(!parentNetns||readlinkSync('/proc/self/ns/net')===parentNetns||devices.some(name=>name!=='lo'))throw new Error('SIGNER_NETWORK_NAMESPACE_NOT_ISOLATED');
  if(readFileSync('/proc/net/route','utf8').trim().split('\n').length!==1)throw new Error('SIGNER_NETWORK_ROUTE_PRESENT');
  const config=loadConfig(configPath);validateSignerPins(config.pins);const keypair=loadSignerKeyFile(config);
  const core=createSignerCore(keypair,config.pins,{custodyRoot:config.custodyRoot,initializationMarkerPath:config.initializationMarkerPath,rateJournalPath:config.rateJournalPath,auditPath:config.auditPath,alertQueuePath:config.alertQueuePath,alerts:new StdoutAlertSink()});
  process.stdout.write(`${JSON.stringify({ready:true,publicKey:core.publicKey,isolated:true,noDatabaseEnv:true})}\n`);
  let input='';for await(const chunk of process.stdin){input+=String(chunk);let newline=input.indexOf('\n');while(newline>=0){const line=input.slice(0,newline);input=input.slice(newline+1);let response:unknown;try{response=await core.sign(parseRequest(JSON.parse(line)))}catch(error){response={error:error instanceof Error?error.message:'SIGNER_REQUEST_INVALID'}}process.stdout.write(`${JSON.stringify(response)}\n`);newline=input.indexOf('\n');}}
}
if(require.main===module)runSignerWorker().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'SIGNER_STARTUP_FAILED'}\n`);process.exitCode=1});
