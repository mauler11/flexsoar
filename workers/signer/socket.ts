import { connect, type Socket } from 'node:net';
import { lstatSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SignRequest, SignResponse, SignerRuntimeConfig } from './types';

const MAX_FRAME=2*1024*1024;
function frame(value:unknown):Buffer{const body=Buffer.from(JSON.stringify(value),'utf8');if(body.length>MAX_FRAME)throw new Error('SIGNER_REQUEST_TOO_LARGE');const head=Buffer.alloc(4);head.writeUInt32BE(body.length);return Buffer.concat([head,body]);}
function socketStat(path:string,ownerUid:number):void{
  const info=lstatSync(path,{bigint:true});if(!info.isSocket()||info.uid!==BigInt(ownerUid)||(info.mode&BigInt('511'))!==BigInt('432'))throw new Error('SIGNER_SOCKET_PERMISSIONS');
}
export class UnixIssuerSigner {
  constructor(private readonly socketPath:string,private readonly signerUid:number,readonly publicKey:string){}
  signValidated(request:SignRequest):Promise<SignResponse>{
    const expected=request.kind==='open-sale-pair'?['kind','requestId','saleId','permitBase64url','listingMessageBase64url','sellerSignatureBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:['kind','requestId','attemptId','permitSha256','permitBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url'];
    if(Object.keys(request).sort().join('|')!==expected.sort().join('|'))return Promise.reject(new Error('SIGNER_TYPED_REQUEST_REQUIRED'));
    try{socketStat(this.socketPath,this.signerUid)}catch(error){return Promise.reject(error)}
    return new Promise((resolvePromise,reject)=>{
      const socket:Socket=connect(this.socketPath);let received=Buffer.alloc(0),expectedLength:number|null=null,settled=false;
      const done=(error?:Error,value?:SignResponse)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolvePromise(value!)};
      socket.once('error',error=>done(error));socket.once('connect',()=>socket.write(frame(request)));
      socket.once('end',()=>{if(!settled)done(new Error('SIGNER_PEER_REFUSED'))});
      socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(expectedLength===null&&received.length>=4){expectedLength=received.readUInt32BE(0);if(expectedLength<2||expectedLength>MAX_FRAME)return done(new Error('SIGNER_RESPONSE_INVALID'));}
        if(expectedLength!==null&&received.length>=expectedLength+4){try{const result=JSON.parse(received.subarray(4,expectedLength+4).toString('utf8')) as Record<string,unknown>;if(typeof result.error==='string')return done(new Error(result.error));if(typeof result.signedTransactionBase64url!=='string')return done(new Error('SIGNER_RESPONSE_INVALID'));done(undefined,{signedTransactionBase64url:result.signedTransactionBase64url});}catch{done(new Error('SIGNER_RESPONSE_INVALID'));}}
      });
      socket.setTimeout(5000,()=>done(new Error('SIGNER_UNAVAILABLE')));
    });
  }
  health():Promise<{ok:true}|{ok:false;code:'SIGNER_UNAVAILABLE'}>{return new Promise(resolveHealth=>{try{socketStat(this.socketPath,this.signerUid);connect(this.socketPath).once('connect',function(this:Socket){this.destroy();resolveHealth({ok:true})}).once('error',()=>resolveHealth({ok:false,code:'SIGNER_UNAVAILABLE'}))}catch{resolveHealth({ok:false,code:'SIGNER_UNAVAILABLE'})}})}
}

/** Starts the isolated socket front end from the signer-owned process. Production
 * issuers only connect with UnixIssuerSigner; they never launch or own custody files. */
export function startKeyFileSigner(config:SignerRuntimeConfig,paths:{python:string;unshare:string;node:string;workerScript:string;peerSocketScript:string;configFile:string}):ChildProcess{
  if(process.platform!=='linux'||config.custodyMode!=='key-file')throw new Error('SIGNER_STARTUP_UNSUPPORTED');
  const signerUid=process.getuid?.();if(signerUid===undefined||signerUid!==config.signerUid)throw new Error('SIGNER_IDENTITY_MISMATCH');
  // Founder-approved residual: same-UID development collapses process and
  // custody isolation. It is refused by default and is never production mode.
  if(config.allowedPeerUid===config.signerUid&&!(config.devOnly===true&&process.env.FLEXSOAR_SIGNER_DEV_MODE==='1'))throw new Error('SIGNER_SAME_USER_DEV_ONLY');
  if(!Number.isSafeInteger(config.allowedPeerPid)||config.allowedPeerPid<1)throw new Error('SIGNER_PEER_IDENTITY_INVALID');
  const env:{PATH:string;NODE_ENV:'production';ISSUER_SIGNER_CONFIG:string;ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:string;ISSUER_SIGNER_DEV_MODE?:string}={PATH:'/usr/bin:/bin',NODE_ENV:'production',ISSUER_SIGNER_CONFIG:paths.configFile,ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:config.issuerPublicKey};
  if(config.devOnly===true&&process.env.FLEXSOAR_SIGNER_DEV_MODE==='1')env.ISSUER_SIGNER_DEV_MODE='1';
  const child=spawn(paths.python,[paths.peerSocketScript,config.socketPath,String(config.allowedPeerUid),String(config.allowedPeerPid),String(config.socketGroupGid),paths.unshare,paths.node,paths.workerScript],{
    stdio:['ignore','ignore','inherit'],windowsHide:true,env,
  });
  return child;
}
