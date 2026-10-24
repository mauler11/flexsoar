import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, chownSync, copyFileSync, constants as fsConstants, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { Ed25519Program, Keypair, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { UnixIssuerSigner } from './socket';
import { openCustodyFile, verifySignerStorage } from './storage';
import type { OpenSalePairSignRequest, SignRequest } from './types';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@/lib/solana/sdk';

const dirs:string[]=[],children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0)){if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}}for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const linuxIt=it.skipIf(process.platform!=='linux');
const hasCrossUidAccounts=spawnSync('/usr/bin/getent',['passwd','flexsoar-issuer'],{encoding:'utf8'}).status===0&&spawnSync('/usr/bin/getent',['passwd','family'],{encoding:'utf8'}).status===0&&spawnSync('/usr/bin/getent',['group','users'],{encoding:'utf8'}).status===0;
const rootLinuxIt=it.skipIf(process.platform!=='linux'||process.getuid?.()!==0||!hasCrossUidAccounts);
function waitForSocket(path:string,child:ChildProcess):Promise<void>{return new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(child.exitCode!==null){clearInterval(timer);reject(new Error('peer credential helper exited during startup'));return}try{const stat=lstatSync(path);if(stat.isSocket()){clearInterval(timer);resolve();return}}catch{}if(Date.now()-started>10000){clearInterval(timer);reject(new Error('peer credential helper startup timeout'))}},25)})}
function fakeWorker(path:string,pubkey:string):void{
  writeFileSync(path,`const fs=require('node:fs');const parent=process.env.ISSUER_SIGNER_PARENT_NETNS,actual=fs.readlinkSync('/proc/self/ns/net'),interfaces=fs.readFileSync('/proc/self/net/dev','utf8').split('\\n').slice(2).map(line=>line.split(':')[0].trim()).filter(Boolean),routeLines=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').length;const isolated=!!parent&&actual!==parent&&interfaces.every(name=>name==='lo')&&routeLines===1;const noDbEnv=Object.keys(process.env).every(name=>!/(DATABASE|POSTGRES|SUPABASE|PGHOST|PGUSER|PGPASSWORD)/i.test(name));process.stdout.write(JSON.stringify({ready:true,publicKey:${JSON.stringify(pubkey)},isolated,noDatabaseEnv:noDbEnv,diagnostic:{parent,actual,interfaces,routeLines}})+'\\n');let input='';process.stdin.on('data',chunk=>{input+=String(chunk);let i;while((i=input.indexOf('\\n'))>=0){let req;try{req=JSON.parse(input.slice(0,i))}catch{process.stdout.write(JSON.stringify({error:'SIGNER_REQUEST_INVALID'})+'\\n');input=input.slice(i+1);continue}input=input.slice(i+1);const fields=req.kind==='open-sale-pair'?['kind','requestId','saleId','permitBase64url','listingMessageBase64url','sellerSignatureBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:req.kind==='buy-sale'?['kind','requestId','attemptId','permitSha256','permitBase64url','blockhash','currentBlockHeight','currentSlot','blockhashBlockHeight','transactionBase64url']:[];const valid=fields.length>0&&Object.keys(req).sort().join('|')===fields.sort().join('|');process.stdout.write(JSON.stringify(valid?{signedTransactionBase64url:'test-signature',isolated,noDatabaseEnv:noDbEnv}:{error:'SIGNER_TYPED_REQUEST_REQUIRED'})+'\\n')}})`,{mode:0o600});
}
async function launch(root:string,allowedUid:number,gid:number,pubkey:string,allowedPid=process.pid){
  const socket=join(root,'signer.sock'),worker=join(root,'fake-worker.js'),peer=fileURLToPath(new URL('./peer-socket.py',import.meta.url));fakeWorker(worker,pubkey);
  const python='/usr/bin/python3',unshare='/usr/bin/unshare',node=process.execPath;
  if(process.getuid?.()===0){const publicNode=join(root,'node');copyFileSync(node,publicNode);chmodSync(publicNode,0o755);}
  const executable=process.getuid?.()===0?join(root,'node'):node;
  const child=spawn(python,[peer,socket,String(allowedUid),String(allowedPid),String(gid),unshare,executable,worker],{stdio:['ignore','ignore','inherit'],env:{PATH:'/usr/bin:/bin',NODE_ENV:'production',ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:pubkey,ISSUER_SIGNER_CONFIG:'/tmp/fake-config'}});children.push(child);await waitForSocket(socket,child);return socket;
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
  linuxIt('closes a partial frame after the bounded socket read timeout',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const key=Keypair.generate().publicKey.toBase58(),root=mkdtempSync(join(tmpdir(),'signer-peer-timeout-'));dirs.push(root);chmodSync(root,0o711);
    const socket=await launch(root,uid,gid,key),started=Date.now();
    const response=await rawExchange(socket,Buffer.from([0,0,0,8,123,125]));
    expect(Date.now()-started).toBeGreaterThan(1500);expect(response).toMatchObject({error:'SIGNER_SOCKET_REQUEST_INVALID'});
  });
  linuxIt('starts the real key-file signer in a private network namespace without DB environment',async()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined)throw new Error('Linux SO_PEERCRED UID/GID unavailable');
    const root=mkdtempSync(join(tmpdir(),'signer-real-worker-'));dirs.push(root);const issuer=Keypair.generate();
    const publicKey=issuer.publicKey.toBase58(),keyFile=join(root,'issuer-key.json'),configFile=join(root,'signer-config.json'),pinsFile=join(root,'signer-pins.json'),socket=join(root,'signer.sock'),marker=join(root,'.rate-journal-init');
    writeFileSync(keyFile,JSON.stringify([...issuer.secretKey]),{mode:0o600});
    const pins={issuer:publicKey,program:Keypair.generate().publicKey.toBase58(),genesis:Keypair.generate().publicKey.toBase58(),mint:Keypair.generate().publicKey.toBase58(),tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId.toBase58(),rentSysvar:SYSVAR_RENT_PUBKEY.toBase58(),instructionsSysvar:SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),ed25519Program:Ed25519Program.programId.toBase58(),lookupTables:[],maxBlockhashAge:150,maxFloorToleranceBps:200};
    const rateJournalPath=join(root,'rate.json');writeFileSync(marker,'flexsoar-signer-rate-journal-initialized-v1\n',{mode:0o600});writeFileSync(pinsFile,JSON.stringify(pins),{mode:0o600});writeFileSync(configFile,JSON.stringify({custodyMode:'key-file',custodyRoot:root,pinsFilePath:pinsFile,initializationMarkerPath:marker,secretKeyPath:keyFile,issuerPublicKey:publicKey,allowedPeerUid:uid,allowedPeerPid:process.pid,signerUid:uid,signerGid:gid,socketGroupGid:gid,socketPath:socket,rateJournalPath,auditPath:join(root,'audit.jsonl'),alertQueuePath:join(root,'alert.jsonl'),devOnly:true}),{mode:0o600});
    const peer=fileURLToPath(new URL('./peer-socket.py',import.meta.url)),launcher=fileURLToPath(new URL('./worker-launcher.cjs',import.meta.url)),nodePath=process.getuid?.()===0?join(root,'node'):process.execPath;
    if(nodePath!==process.execPath){copyFileSync(process.execPath,nodePath);chmodSync(nodePath,0o755);}
    const child=spawn('/usr/bin/python3',[peer,socket,String(uid),String(process.pid),String(gid),'/usr/bin/unshare',nodePath,launcher],{stdio:['ignore','ignore','inherit'],env:{PATH:'/usr/bin:/bin',NODE_ENV:'production',ISSUER_SIGNER_CONFIG:configFile,ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:publicKey,ISSUER_SIGNER_DEV_MODE:'1'}});children.push(child);
    await waitForSocket(socket,child);
    const signer=new UnixIssuerSigner(socket,uid,publicKey);
    await expect(signer.signValidated(request())).rejects.toThrow('SIGNER_TRANSACTION_INVALID');
  });
  rootLinuxIt('accepts the configured flexsoar-issuer UID and refuses a different UID with signer under family UID',async()=>{
    const account=(name:string)=>{const result=spawnSync('/usr/bin/getent',['passwd',name],{encoding:'utf8'});if(result.status!==0)throw new Error(`missing local account ${name}`);const fields=result.stdout.trim().split(':');return {uid:Number(fields[2]),gid:Number(fields[3])};};
    const issuer=account('flexsoar-issuer'),signerAccount=account('family'),users=spawnSync('/usr/bin/getent',['group','users'],{encoding:'utf8'});
    if(users.status!==0)throw new Error('missing local users group');const usersGid=Number(users.stdout.trim().split(':')[2]);
    const custodyRoot=mkdtempSync(join(tmpdir(),'signer-cross-custody-')),socketRoot=mkdtempSync(join(tmpdir(),'signer-cross-socket-'));dirs.push(custodyRoot,socketRoot);chownSync(custodyRoot,signerAccount.uid,signerAccount.gid);chmodSync(custodyRoot,0o700);chownSync(socketRoot,signerAccount.uid,usersGid);chmodSync(socketRoot,0o770);
    const nodePath=join(socketRoot,'node');copyFileSync(process.execPath,nodePath);chownSync(nodePath,signerAccount.uid,usersGid);chmodSync(nodePath,0o755);
    const keypair=Keypair.generate(),publicKey=keypair.publicKey.toBase58(),keyFile=join(custodyRoot,'issuer-key.json'),configFile=join(custodyRoot,'signer-config.json'),pinsFile=join(custodyRoot,'signer-pins.json'),rateJournalPath=join(custodyRoot,'rate.json'),marker=join(custodyRoot,'.rate-journal-init'),socket=join(socketRoot,'signer.sock'),pidFile=join(socketRoot,'issuer.pid'),clientFile=join(socketRoot,'issuer-client.cjs');
    writeFileSync(keyFile,JSON.stringify([...keypair.secretKey]),{mode:0o600});chownSync(keyFile,signerAccount.uid,signerAccount.gid);
    const pins={issuer:publicKey,program:Keypair.generate().publicKey.toBase58(),genesis:Keypair.generate().publicKey.toBase58(),mint:Keypair.generate().publicKey.toBase58(),tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId.toBase58(),rentSysvar:SYSVAR_RENT_PUBKEY.toBase58(),instructionsSysvar:SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),ed25519Program:Ed25519Program.programId.toBase58(),lookupTables:[],maxBlockhashAge:150,maxFloorToleranceBps:200};
    const config={custodyMode:'key-file',custodyRoot,pinsFilePath:pinsFile,initializationMarkerPath:marker,secretKeyPath:keyFile,issuerPublicKey:publicKey,allowedPeerUid:issuer.uid,allowedPeerPid:0,signerUid:signerAccount.uid,signerGid:signerAccount.gid,socketGroupGid:usersGid,socketPath:socket,rateJournalPath,auditPath:join(custodyRoot,'audit.jsonl'),alertQueuePath:join(custodyRoot,'alert.jsonl')};
    const configTemp=join(custodyRoot,'signer-config.tmp');writeFileSync(configTemp,JSON.stringify(config),{mode:0o600});chownSync(configTemp,signerAccount.uid,signerAccount.gid);writeFileSync(pinsFile,JSON.stringify(pins),{mode:0o600});chownSync(pinsFile,signerAccount.uid,signerAccount.gid);writeFileSync(rateJournalPath,JSON.stringify({lastNow:1000,accepted:{'open-sale-pair':[],'buy-sale':[]}}),{mode:0o600});chownSync(rateJournalPath,signerAccount.uid,signerAccount.gid);chownSync(configTemp,signerAccount.uid,signerAccount.gid);
    // Publish config with a predictable name only after ownership and mode are set.
    const { renameSync } = await import('node:fs');renameSync(configTemp,configFile);
    writeFileSync(clientFile,`const fs=require('node:fs'),net=require('node:net');const pidFile=process.argv[2],socketPath=process.argv[3];fs.writeFileSync(pidFile,String(process.pid));const timer=setInterval(()=>{if(!fs.existsSync(socketPath))return;clearInterval(timer);const s=net.createConnection(socketPath);let data=Buffer.alloc(0),length=null;s.on('connect',()=>{const b=Buffer.from(JSON.stringify(${JSON.stringify(request())})),h=Buffer.alloc(4);h.writeUInt32BE(b.length);s.write(Buffer.concat([h,b]))});s.on('data',c=>{data=Buffer.concat([data,c]);if(length===null&&data.length>=4)length=data.readUInt32BE(0)});s.on('end',()=>{if(length===null||data.length<length+4){console.log('REFUSED');process.exit(0)}console.log(data.subarray(4,length+4).toString());process.exit(0)});s.on('error',e=>{console.error(e.message);process.exit(2)})},10);setTimeout(()=>process.exit(3),10000);`,{mode:0o640});chownSync(clientFile,signerAccount.uid,usersGid);
    const client=spawn('/usr/sbin/runuser',['-u','flexsoar-issuer','--',nodePath,clientFile,pidFile,socket],{stdio:['ignore','pipe','inherit']});children.push(client);
    const started=Date.now();while(true){try{if(readFileSync(pidFile,'utf8').trim())break}catch{}if(Date.now()-started>10000)throw new Error('issuer process did not publish its PID');await new Promise(resolve=>setTimeout(resolve,20));}
    const allowedPid=readFileSync(pidFile,'utf8').trim(),peer=fileURLToPath(new URL('./peer-socket.py',import.meta.url)),launcher=fileURLToPath(new URL('./worker-launcher.cjs',import.meta.url));
    writeFileSync(configFile,JSON.stringify({...config,allowedPeerPid:Number(allowedPid)}));chownSync(configFile,signerAccount.uid,signerAccount.gid);chmodSync(configFile,0o600);
    const broker=spawn('/usr/sbin/runuser',['-u','family','--','/usr/bin/python3',peer,socket,String(issuer.uid),allowedPid,String(usersGid),'/usr/bin/unshare',nodePath,launcher],{stdio:['ignore','ignore','inherit'],env:{PATH:'/usr/bin:/bin',NODE_ENV:'production',ISSUER_SIGNER_CONFIG:configFile,ISSUER_SIGNER_EXPECTED_PUBLIC_KEY:publicKey}});children.push(broker);
    await waitForSocket(socket,broker);
    const output=await new Promise<string>((resolve,reject)=>{let value='';client.stdout?.on('data',chunk=>value+=String(chunk));client.once('error',reject);client.once('exit',code=>code===0?resolve(value):reject(new Error(`issuer client exited ${code}: ${value}`)));});
    expect(output).toContain('SIGNER_TRANSACTION_INVALID');
    const protectedAttempt=spawn('/usr/sbin/runuser',['-u','flexsoar-issuer','--',nodePath,'-e',`const fs=require('node:fs'),paths=process.argv.slice(1),out=[];for(const p of paths){for(const [op,fn] of [['read',()=>fs.readFileSync(p)],['replace',()=>fs.writeFileSync(p,'tamper')],['unlink',()=>fs.unlinkSync(p)]]){try{fn();out.push(op+':unexpected')}catch(e){out.push(op+':'+e.code)}}}try{fs.readdirSync(process.argv.at(-1));out.push('traverse:unexpected')}catch(e){out.push('traverse:'+e.code)}console.log(out.join('|'))`,keyFile,configFile,pinsFile,rateJournalPath,custodyRoot],{stdio:['ignore','pipe','inherit']});
    const protectedOutput=await new Promise<string>((resolve,reject)=>{let value='';protectedAttempt.stdout?.on('data',chunk=>value+=String(chunk));protectedAttempt.once('error',reject);protectedAttempt.once('exit',code=>code===0?resolve(value):reject(new Error(`issuer custody probe exited ${code}`)));});
    expect(protectedOutput).toContain('read:EACCES');expect(protectedOutput).toContain('replace:EACCES');expect(protectedOutput).toContain('unlink:EACCES');expect(protectedOutput).toContain('traverse:EACCES');
    expect(readFileSync(rateJournalPath,'utf8')).toBe(JSON.stringify({lastNow:1000,accepted:{'open-sale-pair':[],'buy-sale':[]}}));
    const other=spawn('/usr/sbin/runuser',['-u','family','--',nodePath,'-e',`const net=require('node:net');let connected=false;const s=net.createConnection(process.argv[1],()=>{connected=true;s.write(Buffer.from([0,0,0,2,123,125]))});s.on('end',()=>process.exit(connected?0:2));s.on('error',()=>process.exit(connected?0:2));setTimeout(()=>process.exit(3),2000)`,socket]);
    const otherCode=await new Promise<number|null>(resolve=>other.once('exit',resolve));expect(otherCode).toBe(0);
  });
  rootLinuxIt('checks real config ownership and 0600 mode at signer startup',()=>{
    const uid=process.getuid?.(),gid=process.getgid?.();if(uid===undefined||gid===undefined||uid!==0)throw new Error('root needed for real ownership mutation test');
    const root=mkdtempSync(join(tmpdir(),'signer-config-perms-'));dirs.push(root);chmodSync(root,0o700);
    const config=join(root,'config.json'),pins=join(root,'pins.json'),key=join(root,'key.json'),journal=join(root,'rate.json'),marker=join(root,'.init');
    for(const path of [config,pins,key,journal])writeFileSync(path,'{}',{mode:0o600});
    const paths={custodyRoot:root,configPath:config,pinsFilePath:pins,secretKeyPath:key,rateJournalPath:journal,initializationMarkerPath:marker};
    expect(()=>verifySignerStorage(paths)).not.toThrow();
    const link=join(root,'config-link');symlinkSync(config,link);expect(()=>openCustodyFile(link,root,fsConstants.O_RDONLY)).toThrow();
    chmodSync(config,0o644);expect(()=>verifySignerStorage(paths)).toThrow();chmodSync(config,0o600);
    chownSync(config,uid+1,gid);expect(()=>verifySignerStorage(paths)).toThrow();
  });
});
