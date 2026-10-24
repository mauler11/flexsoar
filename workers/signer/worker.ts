import { readFileSync } from 'node:fs';
import { createSignerCore, loadSignerKeyFile } from './core';
import type { SignRequest, SignerAlert, SignerRuntimeConfig } from './types';
import { validateSignerPins } from './validator';

type JsonObject=Record<string,unknown>;
function object(value:unknown):JsonObject{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('SIGNER_REQUEST_INVALID');return value as JsonObject}
function parseRequest(value:unknown):SignRequest{
  const request=object(value),kind=request.kind;
  const fields=kind==='open-sale-pair'?['kind','requestId','saleId','permitBase64url','listingMessageBase64url','sellerSignatureBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:kind==='buy-sale'?['kind','requestId','attemptId','permitSha256','permitBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:[];
  if(fields.length===0||Object.keys(request).sort().join('|')!==fields.sort().join('|')||fields.some(field=>typeof request[field]!=='string'))throw new Error('SIGNER_TYPED_REQUEST_REQUIRED');
  return request as unknown as SignRequest;
}
function loadConfig(path:string):SignerRuntimeConfig{
  const config=object(JSON.parse(readFileSync(path,'utf8')));
  if(config.custodyMode!=='key-file'||!config.pins||typeof config.pins!=='object'||typeof config.secretKeyPath!=='string'||typeof config.issuerPublicKey!=='string'||typeof config.auditPath!=='string'||typeof config.rateJournalPath!=='string'||typeof config.alertQueuePath!=='string')throw new Error('SIGNER_STARTUP_CONFIG_INVALID');
  return config as unknown as SignerRuntimeConfig;
}
class StdoutAlertSink {
  async deliver(event:SignerAlert):Promise<void>{process.stderr.write(`${JSON.stringify({type:'signer-refusal',...event})}\n`)}
}
export async function runSignerWorker(configPath=process.env.ISSUER_SIGNER_CONFIG):Promise<void>{
  if(!configPath)throw new Error('SIGNER_STARTUP_CONFIG_MISSING');
  const config=loadConfig(configPath);validateSignerPins(config.pins);const keypair=loadSignerKeyFile(config);
  const core=createSignerCore(keypair,config.pins,{rateJournalPath:config.rateJournalPath,auditPath:config.auditPath,alertQueuePath:config.alertQueuePath,alerts:new StdoutAlertSink()});
  process.stdout.write(`${JSON.stringify({ready:true,publicKey:core.publicKey})}\n`);
  let input='';for await(const chunk of process.stdin){input+=String(chunk);let newline=input.indexOf('\n');while(newline>=0){const line=input.slice(0,newline);input=input.slice(newline+1);let response:unknown;try{response=await core.sign(parseRequest(JSON.parse(line)))}catch(error){response={error:error instanceof Error?error.message:'SIGNER_REQUEST_INVALID'}}process.stdout.write(`${JSON.stringify(response)}\n`);newline=input.indexOf('\n');}}
}
if(require.main===module)runSignerWorker().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'SIGNER_STARTUP_FAILED'}\n`);process.exitCode=1});
