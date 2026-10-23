/** Controls for the offline byte-proof tool. Usage: node solana/tests/program-id-diff.mjs A.so B.so old-id new-id */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
const [aPath,bPath,oldId,newId]=process.argv.slice(2);
const root=mkdtempSync(join(tmpdir(),'flexsoar-id-proof-'));
const verify=path=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/verify-program-id-diff.mjs',import.meta.url)),aPath,path,oldId,newId],{encoding:'utf8',maxBuffer:2_000_000,windowsHide:true});
  assert.equal(result.error,undefined);
  return {exit:result.status,proof:JSON.parse(result.stdout)};
};
try{
  const actual=verify(bPath);
  assert.equal(actual.exit,0);assert.equal(actual.proof.pass,true);assert.equal(actual.proof.strictPass,false);
  assert.equal(actual.proof.diagnosticOnly.rawAndEncodedNormalizationEqualsB,true);
  assert.equal(actual.proof.diagnosticOnly.allDifferencesAreRawOrEncodedIdBytes,true);
  const rawOnly=Buffer.from(readFileSync(aPath)),oldBytes=new PublicKey(oldId).toBuffer(),newBytes=new PublicKey(newId).toBuffer();
  let replacements=0;
  for(let i=rawOnly.indexOf(oldBytes);i>=0;i=rawOnly.indexOf(oldBytes,i+32)){newBytes.copy(rawOnly,i);replacements++;}
  assert.ok(replacements>0);
  const control=join(root,'raw-only.so');writeFileSync(control,rawOnly);
  // A raw-only change satisfies the SUPERSEDED strict rule but leaves old-id LDDW fragments in the candidate: the accepted proof refuses it.
  const positive=verify(control);assert.equal(positive.exit,1);assert.equal(positive.proof.pass,false);assert.equal(positive.proof.strictPass,true);
  assert.ok(positive.proof.diagnosticOnly.staleOldInB.lddw.length>0);
  const corrupt=Buffer.from(readFileSync(bPath));corrupt[actual.proof.diagnosticOnly.textSection.offset]^=1;
  const negative=join(root,'unrelated-code-change.so');writeFileSync(negative,corrupt);
  const refused=verify(negative);assert.equal(refused.exit,1);assert.equal(refused.proof.pass,false);assert.equal(refused.proof.strictPass,false);
  assert.equal(refused.proof.diagnosticOnly.rawAndEncodedNormalizationEqualsB,false);
  assert.equal(refused.proof.diagnosticOnly.allDifferencesAreRawOrEncodedIdBytes,false);
  // R4-2 adversarial controls. Each synthetic B-candidate must be REFUSED (exit 1, pass false); none touches the reviewed artifacts.
  const aBytes=readFileSync(aPath),bBytes=readFileSync(bPath),loads=actual.proof.diagnosticOnly.encodedIdLoads;
  const rawStart=actual.proof.matchingOccurrences[0].start;
  const slot=(buf,off,bytes)=>{bytes.copy(buf,off+4,0,4);bytes.copy(buf,off+12,4,8);};
  const refuse=(name,buf)=>{const f=join(root,name);writeFileSync(f,buf);const r=verify(f);assert.equal(r.exit,1,name);assert.equal(r.proof.pass,false,name);return r;};
  // (i) a mapped LDDW immediate altered to a value that is not the new-id slice
  { const c=Buffer.from(bBytes);c[loads[0].instructionOffset+4]^=0x55;refuse('lddw-wrong-value.so',c); }
  // (ii) a byte inside the raw region altered to a wrong value
  { const c=Buffer.from(bBytes);c[rawStart+5]^=0x55;refuse('raw-wrong-value.so',c); }
  // (iii) stale old-id encodings left in B, while every other byte is the intended substitution: raw occurrence, and one LDDW
  { const c=Buffer.from(bBytes);oldBytes.copy(c,rawStart);const r=refuse('stale-raw.so',c);assert.ok(r.proof.diagnosticOnly.staleOldInB.raw.length>0); }
  { const last=loads[loads.length-1],c=Buffer.from(bBytes);slot(c,last.instructionOffset,oldBytes.subarray(last.idByteStart,last.idByteStart+8));
    const r=refuse('stale-lddw.so',c);assert.ok(r.proof.diagnosticOnly.staleOldInB.lddw.length>0); }
  // (iv) length change: appended and truncated
  refuse('appended.so',Buffer.concat([bBytes,Buffer.from([0])]));refuse('truncated.so',bBytes.subarray(0,bBytes.length-1));
  // (v) an LDDW whose A immediate is old slice k but whose B immediate is new slice j != k
  { const l=loads.find(x=>x.idByteStart===0)??loads[0],j=(l.idByteStart+8)%32,c=Buffer.from(bBytes);slot(c,l.instructionOffset,newBytes.subarray(j,j+8));refuse('lddw-swapped-slice.so',c); }
  // (vi) a new-id encoding already present in A is also refused
  { const c=Buffer.from(aBytes);newBytes.copy(c,rawStart);const f=join(root,'a-has-new.so');writeFileSync(f,c);
    const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/verify-program-id-diff.mjs',import.meta.url)),f,bPath,oldId,newId],{encoding:'utf8',maxBuffer:2_000_000,windowsHide:true});assert.equal(r.status,1); }
  console.log('3 original (adapted) + 8 adversarial byte-proof controls PASS: actual A/B passes (strict superseded, fails); raw-only passes strict but is refused by the accepted proof (stale LDDW); unrelated mutation, wrong LDDW value, wrong raw value, stale raw, stale LDDW, appended, truncated, swapped slice, and new-id-in-A all refused.');
}finally{
  // Only synthetic controls in this freshly allocated directory; no reviewed artifact is modified.
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('flexsoar-id-proof-'));
  rmSync(root,{recursive:true,force:true});
}
