import { afterEach, describe, expect, it } from 'vitest';
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { UnixIssuerSigner } from './socket';
import type { OpenSalePairSignRequest } from './types';

const dirs:string[]=[],children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0)){child.kill('SIGTERM');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const linuxIt=it.skipIf(process.platform!=='linux');
function waitForSocket(path:string,child:ChildProcess):Promise<void>{return new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(child.exitCode!==null){clearInterval(timer);reject(new Error('peer credential helper exited during startup'));return}try{const stat=lstatSync(path);if(stat.isSocket()){clearInterval(timer);resolve();return}}catch{}if(Date.now()-started>5000){clearInterval(timer);reject(new Error('peer credential helper startup timeout'))}},25)})}
function fakeWorker(path:string,pubkey:string):void{
  writeFileSync(path,`process.stdout.write(JSON.stringify({ready:true,publicKey:${JSON.stringify(pubkey)}})+'\\n');let input='';process.stdin.on('data',chunk=>{input+=String(chunk);let i;while((i=input.indexOf('\\n'))>=0){const req=JSON.parse(input.slice(0,i));input=input.slice(i+1);process.stdout.write(JSON.stringify(req.kind==='open-sale-pair'?{signedTransactionBase64url:'test-signature'}:{error:'SIGNER_TYPED_REQUEST_REQUIRED'})+'\\n')}})`,{mode:0o600});
}
function request():OpenSalePairSignRequest{return {kind:'open-sale-pair',requestId:'socket-test',saleId:'11111111-1111-4111-8111-111111111111',permitBase64url:'AA',listingMessageBase64url:'AA',sellerSignatureBase64url:'AA',blockhash:'11111111111111111111111111111111',currentBlockHeight:'10',currentSlot:'10',blockhashBlockHeight:'9',transactionBase64url:'AA'}}
async function launch(root:string,allowedUid:number,gid:number,pubkey:string){
  const socket=join(root,'signer.sock'),worker=join(root,'fake-worker.js'),peer=fileURLToPath(new URL('./peer-socket.py',import.meta.url));fakeWorker(worker,pubkey);
  const child=spawn('python3',[peer,socket,String(allowedUid),String(gid),process.execPath,worker],{stdio:'ignore',env:{...process.env,ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:pubkey}});children.push(child);await waitForSocket(socket,child);return socket;
}
describe('signer Unix peer credentials',()=>{
  linuxIt('routes a typed request only from the configured UID and refuses a different local UID',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const key=Keypair.generate().publicKey.toBase58(),root=mkdtempSync(join(tmpdir(),'signer-peer-'));dirs.push(root);
    const allowedSocket=await launch(root,uid,gid,key),client=new UnixIssuerSigner(allowedSocket,uid,key);
    await expect(client.signValidated(request())).resolves.toEqual({signedTransactionBase64url:'test-signature'});
    const maliciousRoot=mkdtempSync(join(tmpdir(),'signer-peer-deny-'));dirs.push(maliciousRoot);
    const refusedSocket=await launch(maliciousRoot,uid+1,gid,key),maliciousClient=new UnixIssuerSigner(refusedSocket,uid+1,key);
    await expect(maliciousClient.signValidated(request())).rejects.toThrow();
  });
});
