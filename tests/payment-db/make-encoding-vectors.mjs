// OFFLINE ONLY: installed SDK/production TS encoders, no RPC, signing or wallets.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
const require=createRequire(import.meta.url);
const src=readFileSync(new URL('../../lib/solana/protocol-v2.ts',import.meta.url),'utf8');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {encodePermit,KEY_FIELDS,U64_FIELDS}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const [mode,input,output]=process.argv.slice(2);
if(mode==='vectors'){
 const values=[['zero32',Buffer.alloc(32)],['ff32',Buffer.alloc(32,255)],['leading_zero',Buffer.concat([Buffer.alloc(3),Buffer.alloc(29,17)])],['ascending32',Buffer.from(Array.from({length:32},(_,i)=>i))],
 ...['11111111111111111111111111111111','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','So11111111111111111111111111111111111111112'].map((s,i)=>['public_key_'+i,Buffer.from(new PublicKey(s).toBytes())]),
 ['signature64',Buffer.from(Array.from({length:64},(_,i)=>(i*37+11)%256))],['ff_signature64',Buffer.alloc(64,255)],['leading_zero_signature64',Buffer.concat([Buffer.alloc(2),Buffer.alloc(62,7)])]];
 const nums=[0n,1n,255n,256n,2n**53n-1n,2n**53n+1n,2n**63n-1n,2n**64n-1n,-1n,-(2n**63n)];
 const p={mode:0,validFrom:-8n,expiresAt:9n};KEY_FIELDS.forEach((k,i)=>p[k]=new Uint8Array(32).fill(i+1));U64_FIELDS.forEach((k,i)=>p[k]=BigInt(i+1));
 const lines=['-- Generated offline by make-encoding-vectors.mjs; bs58@'+require('bs58/package.json').version+' and Node Buffer integer encoders.',
 'CREATE TEMP TABLE sdk_keys(label text,raw bytea,encoded text);','INSERT INTO sdk_keys VALUES '+values.map(([k,b])=>`('${k}',decode('${b.toString('hex')}','hex'),'${bs58.encode(b)}')`).join(',\n')+';',
 'CREATE TEMP TABLE sdk_integers(value numeric,expected bytea);','INSERT INTO sdk_integers VALUES '+nums.map(n=>{const b=Buffer.alloc(8);if(n<0)b.writeBigInt64LE(n);else b.writeBigUInt64LE(n);return `(${n},decode('${b.toString('hex')}','hex'))`;}).join(',\n')+';',
 `CREATE TEMP TABLE sdk_permit(expected bytea); INSERT INTO sdk_permit VALUES(decode('${Buffer.from(encodePermit(p)).toString('hex')}','hex'));`];
 writeFileSync(input,lines.join('\n')+'\n');
 console.log('Generated 10 SDK key/signature vectors, 10 integer vectors and existing Rust/TS fixed permit.');
}else if(mode==='permit'){
 const row=JSON.parse(readFileSync(input,'utf8').trim());const p={...row.model};KEY_FIELDS.forEach(k=>p[k]=Uint8Array.from(Buffer.from(p[k],'hex')));[...U64_FIELDS,'validFrom','expiresAt'].forEach(k=>p[k]=BigInt(p[k]));
 const expected=Buffer.from(encodePermit(p)).toString('hex');if(expected!==row.actual)throw new Error('Actual SQL authorize_attempt permit differs from production TypeScript encoder');
 writeFileSync(output,JSON.stringify({...row,expected,encoder:'production protocol-v2.ts encodePermit',sha256:createHash('sha256').update(Buffer.from(expected,'hex')).digest('hex')}),{flag:'wx'});
 console.log('Actual SQL permit matches production TypeScript encoding: 690 bytes.');
}else throw new Error('vectors <output.sql> OR permit <SQL-export.json> <new-comparison.json>');
