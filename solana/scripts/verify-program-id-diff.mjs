/** Offline byte proof: node solana/scripts/verify-program-id-diff.mjs A.so B.so old-id new-id
 * Exits nonzero unless EVERY differing byte belongs to a complete old/new 32-byte ID occurrence
 * at the same offset. Builds are never patched. Output includes every differing offset (zero-based).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const [aPath,bPath,oldId,newId]=process.argv.slice(2);
assert.ok(aPath && bPath && oldId && newId,'Usage: verify-program-id-diff.mjs A.so B.so old-id new-id');
const a=readFileSync(aPath),b=readFileSync(bPath),oldBytes=new PublicKey(oldId).toBuffer(),newBytes=new PublicKey(newId).toBuffer();
assert.notDeepEqual(oldBytes,newBytes);
const occurrences=(data,needle)=>{
  const offsets=[];
  for(let i=data.indexOf(needle);i!==-1;i=data.indexOf(needle,i+1))offsets.push(i);
  return offsets;
};
const oldOccurrences=occurrences(a,oldBytes),newOccurrences=occurrences(b,newBytes);
const matchingOccurrences=oldOccurrences.filter(start=>newOccurrences.includes(start));
const differences=[];
for(let offset=0;offset<Math.max(a.length,b.length);offset++){
  if(a[offset]!==b[offset])differences.push({offset,a:a[offset]??null,b:b[offset]??null,
    occurrenceStart:matchingOccurrences.find(start=>offset>=start && offset<start+32)??null});
}
const normalized=Buffer.from(a);
for(const start of matchingOccurrences)newBytes.copy(normalized,start);
const pass=a.length===b.length && differences.length>0 && matchingOccurrences.length>0 &&
  differences.every(d=>d.occurrenceStart!==null) && normalized.equals(b);
console.log(JSON.stringify({pass,offsetConvention:'zero-based file offsets, decimal',
  a:{programId:oldId,size:a.length,sha256:createHash('sha256').update(a).digest('hex'),idOccurrences:oldOccurrences},
  b:{programId:newId,size:b.length,sha256:createHash('sha256').update(b).digest('hex'),idOccurrences:newOccurrences},
  matchingOccurrences:matchingOccurrences.map(start=>({start,endInclusive:start+31})),
  differingBytes:differences.length,differences,normalizedAEqualsB:normalized.equals(b)},null,2));
assert.ok(pass,'Binary changes are not confined to complete program-ID byte occurrences; inspect the proof output.');
