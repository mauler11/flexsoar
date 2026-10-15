// OFFLINE SYNTHETIC FIXTURE ONLY. No RPC, database, wallet files, operational keys or broadcast.
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,relative,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
const [ack,input,output]=process.argv.slice(2);
if(ack!=='ISOLATED_SYNTHETIC_ONLY')throw new Error('explicit synthetic-only acknowledgement required');
for(const p of [input,output]){if(!p||relative(resolve(tmpdir()),resolve(p)).startsWith('..')||!/^flexsoar-payment-synthetic-.*\.json$/.test(basename(p)))throw new Error('only named synthetic JSON artifacts inside OS TEMP allowed');}
const source=JSON.parse(readFileSync(input,'utf8').replace(/^\uFEFF/,'')),plan=source.plan??source;
if(plan.action!=='execute_outcome'||plan.instruction.programId!==plan.program||plan.instruction.accounts.length!==8)throw new Error('bounded synthetic exit plan required');
const payer=Keypair.generate(); // New valueless identity, never written or printed.
const ix=new TransactionInstruction({programId:new PublicKey(plan.program),data:Buffer.from(plan.instruction.dataBase64,'base64'),keys:plan.instruction.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable}))});
// Deliberately synthetic validity, not a live blockhash. This fixture must NEVER be sent.
const blockhash=new PublicKey(new Uint8Array(32).fill(31)).toBase58();
const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions:[ix]}).compileToV0Message());tx.sign([payer]);
const raw=tx.serialize(),hash=b=>createHash('sha256').update(b).digest('hex');
// Base58 via a local numeric encoding ONLY for artifact formatting, not payment validation.
function b58(b){const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+Buffer.from(b).toString('hex')),s='',zeros=0;while(n){s=alphabet[Number(n%BigInt(58))]+s;n/=BigInt(58);}for(const v of b){if(v)break;zeros++;}return '1'.repeat(zeros)+s;}
const envelope={plan,transactionBase64:Buffer.from(raw).toString('base64'),transactionDigest:hash(raw),messageDigest:hash(tx.message.serialize()),signature:b58(tx.signatures[0]),blockhash,lastValidBlockHeight:'1000'};
writeFileSync(output,JSON.stringify(envelope),{flag:'wx',mode:0o600});
process.stdout.write('Synthetic envelope written; no keys saved; NEVER broadcast this fixture.\n');
