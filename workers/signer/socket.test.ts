import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { Ed25519Program, Keypair, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { UnixIssuerSigner } from './socket';
import type { OpenSalePairSignRequest, SignRequest } from './types';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@/lib/solana/sdk';

const dirs:string[]=[],children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0)){child.kill('SIGTERM');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const linuxIt=it.skipIf(process.platform!=='linux');
function waitForSocket(path:string,child:ChildProcess):Promise<void>{return new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(child.exitCode!==null){clearInterval(timer);reject(new Error('peer credential helper exited during startup'));return}try{const stat=lstatSync(path);if(stat.isSocket()){clearInterval(timer);resolve();return}}catch{}if(Date.now()-started>10000){clearInterval(timer);reject(new Error('peer credential helper startup timeout'))}},25)})}
function fakeWorker(path:string,pubkey:string):void{
  writeFileSync(path,`const fs=require('node:fs');const parent=process.env.ISSUER_SIGNER_PARENT_NETNS,actual=fs.readlinkSync('/proc/self/ns/net'),interfaces=fs.readFileSync('/proc/self/net/dev','utf8').split('\\n').slice(2).map(line=>line.split(':')[0].trim()).filter(Boolean),routeLines=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').length;const isolated=!!parent&&actual!==parent&&interfaces.every(name=>name==='lo')&&routeLines===1;const noDbEnv=Object.keys(process.env).every(name=>!/(DATABASE|POSTGRES|SUPABASE|PGHOST|PGUSER|PGPASSWORD)/i.test(name));process.stdout.write(JSON.stringify({ready:true,publicKey:${JSON.stringify(pubkey)},isolated,noDatabaseEnv:noDbEnv,diagnostic:{parent,actual,interfaces,routeLines}})+'\\n');let input='';process.stdin.on('data',chunk=>{input+=String(chunk);let i;while((i=input.indexOf('\\n'))>=0){let req;try{req=JSON.parse(input.slice(0,i))}catch{process.stdout.write(JSON.stringify({error:'SIGNER_REQUEST_INVALID'})+'\\n');input=input.slice(i+1);continue}input=input.slice(i+1);const fields=req.kind==='open-sale-pair'?['kind','requestId','saleId','permitBase64url','listingMessageBase64url','sellerSignatureBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:req.kind==='buy-sale'?['kind','requestId','attemptId','permitSha256','permitBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:[];const valid=fields.length>0&&Object.keys(req).sort().join('|')===fields.sort().join('|');process.stdout.write(JSON.stringify(valid?{signedTransactionBase64url:'test-signature',isolated,noDatabaseEnv:noDbEnv}:{error:'SIGNER_TYPED_REQUEST_REQUIRED'})+'\\n')}})`,{mode:0o600});
}
async function launch(root:string,allowedUid:number,gid:number,pubkey:string,allowedPid=process.pid){
  const socket=join(root,'signer.sock'),worker=join(root,'fake-worker.js'),peer=fileURLToPath(new URL('./peer-socket.py',import.meta.url));fakeWorker(worker,pubkey);
  const python='/usr/bin/python3',unshare='/usr/bin/unshare',node=process.execPath;
  const child=spawn(python,[peer,socket,String(allowedUid),String(allowedPid),String(gid),unshare,node,worker],{stdio:['ignore','ignore','inherit'],env:{PATH:'/usr/bin:/bin',NODE_ENV:'production',ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:pubkey,ISSUER_SIGNER_CONFIG:'/tmp/fake-config'}});children.push(child);await waitForSocket(socket,child);return socket;
}
function request():OpenSalePairSignRequest{return {kind:'open-sale-pair',requestId:'socket-test',saleId:'11111111-1111-4111-8111-111111111111',permitBase64url:'AA',listingMessageBase64url:'AA',sellerSignatureBase64url:'AA',blockhash:'11111111111111111111111111111111',currentBlockHeight:'10',currentSlot:'10',blockhashBlockHeight:'9',transactionBase64url:'AA'}}
function rawExchange(path:string,bytes:Uint8Array):Promise<Record<string,unknown>|null>{return new Promise((resolve,reject)=>{const socket=connect(path),received:Buffer[]=[];socket.once('error',error=>received.length===0?resolve(null):reject(error));socket.once('connect',()=>socket.write(bytes));socket.on('data',chunk=>received.push(Buffer.from(chunk)));socket.once('end',()=>{const data=Buffer.concat(received);if(data.length<4)return resolve(null);const size=data.readUInt32BE(0);if(size!==data.length-4)return reject(new Error('bad response frame'));try{resolve(JSON.parse(data.subarray(4).toString('utf8')) as Record<string,unknown>)}catch(error){reject(error)}})})}
function encodeFrame(value:unknown):Buffer{const body=Buffer.from(JSON.stringify(value));const prefix=Buffer.alloc(4);prefix.writeUInt32BE(body.length);return Buffer.concat([prefix,body])}
describe('signer Unix peer credentials',()=>{
  linuxIt('accepts the configured issuer UID and PID, and refuses a different process',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const key=Keypair.generate().publicKey.toBase58(),root=mkdtempSync(join(tmpdir(),'signer-peer-'));dirs.push(root);
    const socket=await launch(root,uid,gid,key),client=new UnixIssuerSigner(socket,uid,key);
    await expect(client.signValidated(request())).resolves.toMatchObject({signedTransactionBase64url:'test-signature'});
    const script=`const net=require('node:net');let connected=false;const s=net.createConnection(process.argv[1],()=>{connected=true;s.write(Buffer.from([0,0,0,2,123,125]))});s.on('data',()=>process.exit(3));s.on('end',()=>process.exit(0));s.on('error',()=>process.exit(connected?0:2));setTimeout(()=>process.exit(4),2000)`;
    const other=spawn(process.execPath,['-e',script,socket],{stdio:'ignore'});const code=await new Promise<number|null>(resolve=>other.once('exit',resolve));expect(code).toBe(0);
  });
  linuxIt('checks the actual peer UID before forwarding requests',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const key=Keypair.generate().publicKey.toBase58(),root=mkdtempSync(join(tmpdir(),'signer-peer-uid-'));dirs.push(root);chmodSync(root,0o711);
    const socket=await launch(root,uid+1,gid,key);chmodSync(socket,0o666);
    expect(await rawExchange(socket,encodeFrame(request()))).toBeNull();
  });
  linuxIt('refuses unknown request kinds, malformed frames and client fields outside the typed schema',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const key=Keypair.generate().publicKey.toBase58(),root=mkdtempSync(join(tmpdir(),'signer-peer-frame-'));dirs.push(root);chmodSync(root,0o711);
    const socket=await launch(root,uid,gid,key),client=new UnixIssuerSigner(socket,uid,key);
    await expect(client.signValidated({...request(),transaction:'client supplied'} as unknown as SignRequest)).rejects.toThrow('SIGNER_TYPED_REQUEST_REQUIRED');
    const unknown=await rawExchange(socket,encodeFrame({kind:'sign-anything'}));expect(unknown).toMatchObject({error:'SIGNER_TYPED_REQUEST_REQUIRED'});
    const malformed=await rawExchange(socket,Buffer.from([0,0,0,2,123,34]));expect(malformed).toMatchObject({error:'SIGNER_SOCKET_REQUEST_INVALID'});
    const fake=await rawExchange(socket,encodeFrame(request()));expect(fake).toMatchObject({isolated:true,noDatabaseEnv:true});
  });
  linuxIt('starts the real key-file signer in a private network namespace without DB environment',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const root=mkdtempSync(join(tmpdir(),'signer-real-worker-'));dirs.push(root);const issuer=Keypair.generate();
    const publicKey=issuer.publicKey.toBase58(),keyFile=join(root,'issuer-key.json'),configFile=join(root,'signer-config.json'),socket=join(root,'signer.sock');
    writeFileSync(keyFile,JSON.stringify([...issuer.secretKey]),{mode:0o600});
    const pins={issuer:publicKey,program:Keypair.generate().publicKey.toBase58(),genesis:Keypair.generate().publicKey.toBase58(),mint:Keypair.generate().publicKey.toBase58(),tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId.toBase58(),rentSysvar:SYSVAR_RENT_PUBKEY.toBase58(),instructionsSysvar:SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),ed25519Program:Ed25519Program.programId.toBase58(),lookupTables:[],maxBlockhashAge:150,maxFloorToleranceBps:200};
    writeFileSync(configFile,JSON.stringify({custodyMode:'key-file',secretKeyPath:keyFile,issuerPublicKey:publicKey,allowedPeerUid:uid,signerUid:uid,signerGid:gid,socketGroupGid:gid,socketPath:socket,rateJournalPath:join(root,'rate.json'),auditPath:join(root,'audit.jsonl'),alertQueuePath:join(root,'alert.jsonl'),pins}),{mode:0o600});
    const peer=fileURLToPath(new URL('./peer-socket.py',import.meta.url)),launcher=fileURLToPath(new URL('./worker-launcher.cjs',import.meta.url));
    const child=spawn('/usr/bin/python3',[peer,socket,String(uid),String(process.pid),String(gid),'/usr/bin/unshare',process.execPath,launcher],{stdio:['ignore','ignore','inherit'],env:{PATH:'/usr/bin:/bin',NODE_ENV:'production',ISSUER_SIGNER_CONFIG:configFile,ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:publicKey}});children.push(child);
    await waitForSocket(socket,child);
    const signer=new UnixIssuerSigner(socket,uid,publicKey);
    await expect(signer.signValidated(request())).rejects.toThrow('SIGNER_TRANSACTION_INVALID');
  });
});
