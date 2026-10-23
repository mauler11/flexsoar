/** Offline byte proof: node solana/scripts/verify-program-id-diff.mjs A.so B.so old-id new-id
 * ACCEPTED proof (founder decision, D2-finish): replacing every old-ID ENCODING in A (the raw 32-byte occurrence plus
 * BPF LDDW program-ID immediates) must reproduce B byte for byte, with every differing byte mapped. `pass` / exit code follow it.
 * SUPERSEDED strict condition (only complete contiguous 32-byte occurrences differ) is still computed and reported as
 * `strictPass`; it fails for real builds because LLVM folds Pubkey comparisons into LDDW immediates.
 * It additionally requires B to contain NO old-id encoding and A NO new-id encoding (raw or LDDW slice), including unchanged ones.
 * Builds are never patched. Output includes every differing offset (zero-based).
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
// Diagnostic only: LLVM also emits Pubkey comparisons as BPF LDDW immediates. These are NOT contiguous 32-byte occurrences
// and therefore cannot satisfy the strict proof above. Decode their ELF .text positions so a reviewer can audit the failure.
function textSection(elf){
  assert.equal(elf.subarray(0,6).toString('hex'),'7f454c460201','ELF64 little-endian required');
  assert.equal(elf.readUInt16LE(18),247,'BPF ELF required');
  const start=Number(elf.readBigUInt64LE(40)),size=elf.readUInt16LE(58),count=elf.readUInt16LE(60);
  const strings=start+size*elf.readUInt16LE(62),names=Number(elf.readBigUInt64LE(strings+24));
  for(let i=0;i<count;i++){
    const header=start+size*i,name=names+elf.readUInt32LE(header);
    if(elf.subarray(name,elf.indexOf(0,name)).toString()==='.text')return {offset:Number(elf.readBigUInt64LE(header+24)),size:Number(elf.readBigUInt64LE(header+32))};
  }
  throw new Error('Missing .text');
}
const section=textSection(a);assert.deepEqual(textSection(b),section);
// R4-2: count ANY encoding of an id left in a file: raw 32-byte occurrences plus LDDW immediates equal to one of its four 8-byte slices.
// B must carry no old-id encoding and A no new-id encoding, even where both files agree (an unchanged stale encoding is not a "difference").
function lddwSliceHits(elf,idBytes){
  const hits=[];
  for(let offset=section.offset;offset+16<=section.offset+section.size;offset+=8){
    if(elf[offset]!==0x18 || !elf.subarray(offset+8,offset+12).equals(Buffer.alloc(4)))continue;
    const immediate=Buffer.concat([elf.subarray(offset+4,offset+8),elf.subarray(offset+12,offset+16)]);
    for(let k=0;k<32;k+=8)if(immediate.equals(idBytes.subarray(k,k+8)))hits.push({instructionOffset:offset,idByteStart:k});
  }
  return hits;
}
const staleOldInB={raw:occurrences(b,oldBytes),lddw:lddwSliceHits(b,oldBytes)};
const staleNewInA={raw:occurrences(a,newBytes),lddw:lddwSliceHits(a,newBytes)};
const noStaleEncodings=staleOldInB.raw.length===0 && staleOldInB.lddw.length===0 && staleNewInA.raw.length===0 && staleNewInA.lddw.length===0;
const encodedIdLoads=[],encodedByteMap=new Map();
for(let offset=section.offset;offset+16<=section.offset+section.size;offset+=8){
  if(a[offset]!==0x18 || b[offset]!==0x18 || !a.subarray(offset,offset+4).equals(b.subarray(offset,offset+4)) ||
    !a.subarray(offset+8,offset+12).equals(Buffer.alloc(4)) || !b.subarray(offset+8,offset+12).equals(Buffer.alloc(4)))continue;
  const immediate=elf=>Buffer.concat([elf.subarray(offset+4,offset+8),elf.subarray(offset+12,offset+16)]);
  for(let idOffset=0;idOffset<32;idOffset+=8){
    if(immediate(a).equals(oldBytes.subarray(idOffset,idOffset+8)) && immediate(b).equals(newBytes.subarray(idOffset,idOffset+8))){
      encodedIdLoads.push({instructionOffset:offset,idByteStart:idOffset});
      for(let i=0;i<8;i++)encodedByteMap.set(offset+4+i+(i>=4?4:0),{instructionOffset:offset,idByteIndex:idOffset+i});
    }
  }
}
const differences=[];
for(let offset=0;offset<Math.max(a.length,b.length);offset++){
  if(a[offset]!==b[offset])differences.push({offset,a:a[offset]??null,b:b[offset]??null,
    occurrenceStart:matchingOccurrences.find(start=>offset>=start && offset<start+32)??null,
    encodedIdByte:encodedByteMap.get(offset)??null});
}
const normalized=Buffer.from(a);
for(const start of matchingOccurrences)newBytes.copy(normalized,start);
const strictPass=a.length===b.length && differences.length>0 && matchingOccurrences.length>0 &&
  differences.every(d=>d.occurrenceStart!==null) && normalized.equals(b);
const encodedNormalized=Buffer.from(normalized);
for(const [offset,{idByteIndex}]of encodedByteMap)encodedNormalized[offset]=newBytes[idByteIndex];
const accepted=a.length===b.length && differences.length>0 && matchingOccurrences.length>0 &&
  differences.every(d=>d.occurrenceStart!==null || d.encodedIdByte!==null) && encodedNormalized.equals(b) && noStaleEncodings;
const pass=accepted;
console.log(JSON.stringify({pass,proof:'encoded-ID normalization (accepted)',strictPass,strictStatus:'superseded by founder decision; kept for the record',offsetConvention:'zero-based file offsets, decimal',
  a:{programId:oldId,size:a.length,sha256:createHash('sha256').update(a).digest('hex'),idOccurrences:oldOccurrences},
  b:{programId:newId,size:b.length,sha256:createHash('sha256').update(b).digest('hex'),idOccurrences:newOccurrences},
  matchingOccurrences:matchingOccurrences.map(start=>({start,endInclusive:start+31})),
  differingBytes:differences.length,differences,normalizedAEqualsB:normalized.equals(b),
  diagnosticOnly:{explanation:'LDDW immediates are encoded ID fragments, NOT complete contiguous 32-byte ID occurrences. This does not pass the requested strict proof.',
    textSection:section,encodedIdLoads,allDifferencesAreRawOrEncodedIdBytes:differences.every(d=>d.occurrenceStart!==null || d.encodedIdByte!==null),
    rawAndEncodedNormalizationEqualsB:encodedNormalized.equals(b),noStaleEncodings,staleOldInB,staleNewInA}},null,2));
assert.ok(pass,'Binary changes are not confined to old-ID encodings (raw occurrence and LDDW immediates), or a stale old-ID encoding remains in B; inspect the proof output.');
