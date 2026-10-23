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
  const positive=verify(control);assert.equal(positive.exit,0);assert.equal(positive.proof.pass,true);assert.equal(positive.proof.strictPass,true);
  const corrupt=Buffer.from(readFileSync(bPath));corrupt[actual.proof.diagnosticOnly.textSection.offset]^=1;
  const negative=join(root,'unrelated-code-change.so');writeFileSync(negative,corrupt);
  const refused=verify(negative);assert.equal(refused.exit,1);assert.equal(refused.proof.pass,false);assert.equal(refused.proof.strictPass,false);
  assert.equal(refused.proof.diagnosticOnly.rawAndEncodedNormalizationEqualsB,false);
  assert.equal(refused.proof.diagnosticOnly.allDifferencesAreRawOrEncodedIdBytes,false);
  console.log('3 byte-proof controls PASS: actual A/B passes the accepted encoded-ID proof (strict superseded, fails); raw-only control passes both; unrelated code mutation fails both.');
}finally{
  // Only synthetic controls in this freshly allocated directory; no reviewed artifact is modified.
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('flexsoar-id-proof-'));
  rmSync(root,{recursive:true,force:true});
}
