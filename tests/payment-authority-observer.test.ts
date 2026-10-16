import {describe,it,expect} from 'vitest';
import {PublicKey,TransactionInstruction} from '@solana/web3.js';
import {inspectAuthorityTransaction,observeAuthorityTransaction} from '../lib/solana/v2-authority-observer';
import {base58Encode} from '../lib/solana/base58';
import type {V2Transaction} from '../lib/solana/v2-observer';
const key=(n:number)=>new PublicKey(new Uint8Array(32).fill(n));
const instruction=new TransactionInstruction({programId:key(1),data:Buffer.from([7,8,9]),keys:[{pubkey:key(2),isSigner:true,isWritable:false},{pubkey:key(3),isSigner:false,isWritable:true}]});
function transaction():V2Transaction{return {slot:42,transaction:{signatures:['test-signature'],message:{accountKeys:[{pubkey:key(4).toBase58(),signer:true,writable:true},{pubkey:key(2).toBase58(),signer:true,writable:false},{pubkey:key(3).toBase58(),signer:false,writable:true}],instructions:[{programId:key(5).toBase58(),accounts:[],data:base58Encode(new Uint8Array([1]))},{programId:key(1).toBase58(),accounts:[key(2).toBase58(),key(3).toBase58()],data:base58Encode(instruction.data)}]}},meta:{err:null}};}
describe('production authority instruction observation (offline fixtures)',()=>{
 it('accepts independent fee sponsorship and legitimate extra instructions',()=>expect(()=>inspectAuthorityTransaction(transaction(),'test-signature',instruction)).not.toThrow());
 for(const defect of ['program','bytes','account','signer','writable','failure','signature','duplicate'] as const)it('rejects '+defect,()=>{
  const tx=transaction(),message=tx.transaction.message;
  if(defect==='program')message.instructions[1].programId=key(6).toBase58();
  if(defect==='bytes')message.instructions[1].data=base58Encode(new Uint8Array([7,8,10]));
  if(defect==='account')message.instructions[1].accounts![1]=key(7).toBase58();
  if(defect==='signer')message.accountKeys[1].signer=false;
  if(defect==='writable')message.accountKeys[2].writable=false;
  if(defect==='failure')tx.meta.err={InstructionError:[0,1]};
  if(defect==='signature')tx.transaction.signatures[0]='different';
  if(defect==='duplicate')message.instructions.push({...message.instructions[1]});
  expect(()=>inspectAuthorityTransaction(tx,'test-signature',instruction)).toThrow();
 });
 it('does not accept a transaction from another genesis',async()=>{
  const request:typeof fetch=async()=>new Response(JSON.stringify({result:key(8).toBase58()}));
  await expect(observeAuthorityTransaction('http://127.0.0.1:18899',key(9).toBase58(),'test',instruction,request)).rejects.toThrow('genesis mismatch');
 });
 it('requires finalized observation and a chain timestamp',async()=>{
  const methods:string[]=[];
  const request:typeof fetch=async(_url,options)=>{const query=JSON.parse(String(options?.body));methods.push(query.method);if(query.method==='getTransaction')expect(query.params[1].commitment).toBe('finalized');return new Response(JSON.stringify({result:query.method==='getGenesisHash'?key(9).toBase58():{...transaction(),blockTime:null}}));};
  await expect(observeAuthorityTransaction('http://127.0.0.1:18899',key(9).toBase58(),'test-signature',instruction,request)).rejects.toThrow('evidence unavailable');
  expect(methods).toEqual(['getGenesisHash','getTransaction']);
 });
});
