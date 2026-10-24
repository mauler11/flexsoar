import { constants as fsConstants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function uidNow():number{return process.getuid?.()??0;}
function privateDirectory(path:string,uid:number):void{
  if(process.platform!=='linux')return;
  const info=lstatSync(path,{bigint:true});
  if(!info.isDirectory()||info.uid!==BigInt(uid)||(info.mode&BigInt('511'))!==BigInt('448'))throw new Error('SIGNER_PRIVATE_DIRECTORY_INVALID');
}
export function assertCustodyFile(path:string,custodyRoot:string,uid=uidNow()):void{
  const root=resolve(custodyRoot),file=resolve(path);
  if(process.platform==='linux')privateDirectory(root,uid);
  if(dirname(file)!==root)throw new Error('SIGNER_PRIVATE_FILE_INVALID');
  const info=lstatSync(file,{bigint:true});
  if(!info.isFile()||(process.platform==='linux'&&(info.uid!==BigInt(uid)||(info.mode&BigInt('511'))!==BigInt('384'))))throw new Error('SIGNER_PRIVATE_FILE_INVALID');
}
function childPath(path:string,custodyRoot:string):{root:string;file:string;name:string}{
  const root=resolve(custodyRoot),file=resolve(path);if(dirname(file)!==root)throw new Error('SIGNER_PRIVATE_FILE_INVALID');return {root,file,name:basename(file)};
}
/** Open a direct custody child through an already-open directory descriptor. */
export function openCustodyFile(path:string,custodyRoot:string,flags:number,mode=0o600):number{
  const {root,file,name}=childPath(path,custodyRoot);
  if(process.platform!=='linux')return openSync(file,flags,mode);
  const uid=uidNow();assertCustodyRoot(root,uid);
  const rootFd=openSync(root,fsConstants.O_RDONLY|fsConstants.O_DIRECTORY|fsConstants.O_NOFOLLOW);
  try{
    const rootInfo=fstatSync(rootFd,{bigint:true});if(!rootInfo.isDirectory()||rootInfo.uid!==BigInt(uid)||(rootInfo.mode&BigInt('511'))!==BigInt('448'))throw new Error('SIGNER_PRIVATE_DIRECTORY_INVALID');
    const fd=openSync(`/proc/self/fd/${rootFd}/${name}`,flags|fsConstants.O_NOFOLLOW,mode),info=fstatSync(fd,{bigint:true});
    if(!info.isFile()||info.uid!==BigInt(uid)||(info.mode&BigInt('511'))!==BigInt('384')){closeSync(fd);throw new Error('SIGNER_PRIVATE_FILE_INVALID');}
    return fd;
  }finally{closeSync(rootFd)}
}
export function readCustodyFile(path:string,custodyRoot:string,encoding:BufferEncoding='utf8'):string{
  const fd=openCustodyFile(path,custodyRoot,fsConstants.O_RDONLY);try{return readFileSync(fd,encoding)}finally{closeSync(fd)}
}
export function appendCustodyFile(path:string,custodyRoot:string,content:string):void{
  const fd=openCustodyFile(path,custodyRoot,fsConstants.O_WRONLY|fsConstants.O_APPEND|fsConstants.O_CREAT,0o600);try{writeFileSync(fd,content);if(process.platform==='linux')fsyncSync(fd)}finally{closeSync(fd)}
}
export function atomicWriteCustodyFile(path:string,custodyRoot:string,content:string):void{
  const {root,name}=childPath(path,custodyRoot),temp=resolve(root,`${name}.${process.pid}.${randomUUID()}.tmp`);
  const fd=openCustodyFile(temp,root,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL,0o600);
  try{writeFileSync(fd,content);if(process.platform==='linux')fsyncSync(fd)}finally{closeSync(fd)}
  if(process.platform==='linux'){
    const rootFd=openSync(root,fsConstants.O_RDONLY|fsConstants.O_DIRECTORY|fsConstants.O_NOFOLLOW);
    try{renameSync(`/proc/self/fd/${rootFd}/${basename(temp)}`,`/proc/self/fd/${rootFd}/${name}`);fsyncSync(rootFd)}finally{closeSync(rootFd)}
  }else renameSync(temp,path);
}
export function unlinkCustodyFile(path:string,custodyRoot:string):void{
  const {root,name,file}=childPath(path,custodyRoot);
  if(process.platform==='linux'){
    const rootFd=openSync(root,fsConstants.O_RDONLY|fsConstants.O_DIRECTORY|fsConstants.O_NOFOLLOW);try{unlinkSync(`/proc/self/fd/${rootFd}/${name}`)}finally{closeSync(rootFd)}
  }else unlinkSync(file);
}
export function assertCustodyRoot(path:string,uid=uidNow()):string{
  const root=resolve(path);privateDirectory(root,uid);
  if(process.platform==='linux'){
    let parent=dirname(root);
    while(parent!==dirname(parent)){
      const info=lstatSync(parent,{bigint:true}),mode=info.mode&BigInt('511'),sticky=(info.mode&BigInt('512'))!==BigInt('0');
      // User namespaces render unmapped root-owned ancestors as overflow UID.
      // Such ancestors are safe when not group/other writable; sticky shared
      // temp roots are safe because only the entry owner may rename/unlink it.
      if(!info.isDirectory()||((mode&BigInt('18'))!==BigInt('0')&&!(sticky&&(mode&BigInt('2'))!==BigInt('0'))))throw new Error('SIGNER_CUSTODY_PARENT_INVALID');
      parent=dirname(parent);
    }
  }
  return root;
}
export function verifySignerStorage(options:{custodyRoot:string;configPath:string;pinsFilePath:string;secretKeyPath:string;rateJournalPath:string;initializationMarkerPath:string;auditPath?:string;alertQueuePath?:string;uid?:number}):void{
  const uid=options.uid??uidNow(),root=assertCustodyRoot(options.custodyRoot,uid);
  for(const path of [options.configPath,options.pinsFilePath,options.secretKeyPath])assertCustodyFile(path,root,uid);
  for(const path of [options.rateJournalPath,options.initializationMarkerPath,...[options.auditPath,options.alertQueuePath].filter((v):v is string=>!!v)]){
    if(dirname(resolve(path))!==root)throw new Error('SIGNER_PRIVATE_FILE_INVALID');
    try{assertCustodyFile(path,root,uid)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
}
export function createRateJournalInitializationMarker(markerPath:string,custodyRoot:string,uid=uidNow()):void{
  const root=assertCustodyRoot(custodyRoot,uid);
  if(dirname(resolve(markerPath))!==root)throw new Error('SIGNER_PRIVATE_FILE_INVALID');
  const markerFd=openCustodyFile(markerPath,root,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL,0o600);try{writeFileSync(markerFd,'flexsoar-signer-rate-journal-initialized-v1\n');if(process.platform==='linux')fsyncSync(markerFd)}finally{closeSync(markerFd)}
}
export function requireOrInitializeRateJournal(path:string,markerPath:string,custodyRoot:string,uid=uidNow()):void{
  const root=assertCustodyRoot(custodyRoot,uid);
  try{const fd=openCustodyFile(path,root,fsConstants.O_RDONLY);closeSync(fd);try{const markerFd=openCustodyFile(markerPath,root,fsConstants.O_RDONLY);closeSync(markerFd);unlinkCustodyFile(markerPath,root)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const marker=readCustodyFile(markerPath,root);if(marker!=='flexsoar-signer-rate-journal-initialized-v1\n')throw new Error('SIGNER_RATE_JOURNAL_INIT_MARKER_INVALID');
  const fd=openCustodyFile(path,root,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL,0o600);try{writeFileSync(fd,JSON.stringify({lastNow:0,accepted:{'open-sale-pair':[],'buy-sale':[]}}));if(process.platform==='linux')fsyncSync(fd)}finally{closeSync(fd)}
  unlinkCustodyFile(markerPath,root);if(process.platform==='linux'){const dir=openSync(root,fsConstants.O_RDONLY|fsConstants.O_DIRECTORY|fsConstants.O_NOFOLLOW);try{fsyncSync(dir)}finally{closeSync(dir)}}
}
