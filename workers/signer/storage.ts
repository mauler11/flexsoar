import { lstatSync, openSync, readFileSync, unlinkSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
  const markerFd=openSync(markerPath,'wx',0o600);try{writeFileSync(markerFd,'flexsoar-signer-rate-journal-initialized-v1\n');fsyncSync(markerFd)}finally{closeSync(markerFd)}
}
export function requireOrInitializeRateJournal(path:string,markerPath:string,custodyRoot:string,uid=uidNow()):void{
  const root=assertCustodyRoot(custodyRoot,uid);
  try{assertCustodyFile(path,root,uid);try{assertCustodyFile(markerPath,root,uid);unlinkSync(markerPath)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  assertCustodyFile(markerPath,root,uid);
  const marker=readFileSync(markerPath,'utf8');if(marker!=='flexsoar-signer-rate-journal-initialized-v1\n')throw new Error('SIGNER_RATE_JOURNAL_INIT_MARKER_INVALID');
  const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify({lastNow:0,accepted:{'open-sale-pair':[],'buy-sale':[]}}));fsyncSync(fd)}finally{closeSync(fd)}
  unlinkSync(markerPath);if(process.platform==='linux'){const dir=openSync(root,'r');try{fsyncSync(dir)}finally{closeSync(dir)}}
}
