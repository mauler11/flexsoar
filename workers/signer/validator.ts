import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import {
  AddressLookupTableAccount, AddressLookupTableProgram, Ed25519Program,
  Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { decodeListingMessage, listingBinding, verifyListingSignature } from '@/lib/solana/listing-v2';
import { decodePermit, encodePermit, PERMIT_SIZE, validatePermit, type PermitV2 } from '@/lib/solana/protocol-v2';
import { v2Addresses, buyV2Instruction, buildV2Buy } from '@/lib/solana/v2-sdk';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/solana/sdk';
import type { LoadedLookupTable, SignRequest, SignerPins } from './types';

const ALT_PROGRAM=AddressLookupTableProgram.programId.toBase58();
const SIGNER_FAILURE='SIGNER_TRANSACTION_INVALID';
function bytes(value:string,length:number):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error(SIGNER_FAILURE);
  const out=Buffer.from(value,'base64url');if(out.length!==length||out.toString('base64url')!==value)throw new Error(SIGNER_FAILURE);return out;
}
function key(value:Uint8Array|string):PublicKey{return new PublicKey(value);}
function equal(a:Uint8Array,b:Uint8Array):boolean{return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function rawEd25519PublicKey(pubkey:string){return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(new PublicKey(pubkey).toBytes())]),format:'der',type:'spki'});}
function checkSignature(pubkey:string,message:Uint8Array,signature:Uint8Array):boolean{return verifySignature(null,Buffer.from(message),rawEd25519PublicKey(pubkey),Buffer.from(signature));}
function sha(bytesValue:Uint8Array):string{return createHash('sha256').update(bytesValue).digest('hex');}
function assert(condition:unknown,code=SIGNER_FAILURE):asserts condition{if(!condition)throw new Error(code);}
export function validateSignerPins(pins:SignerPins):void{
  for(const value of [pins.issuer,pins.program,pins.genesis,pins.mint,pins.tokenProgram,pins.associatedTokenProgram,pins.systemProgram,pins.rentSysvar,pins.instructionsSysvar,pins.ed25519Program]){
    assert(typeof value==='string'&&new PublicKey(value).toBase58()===value,'SIGNER_STARTUP_PIN_INVALID');
  }
  assert(pins.tokenProgram===TOKEN_PROGRAM_ID&&pins.associatedTokenProgram===ASSOCIATED_TOKEN_PROGRAM_ID&&pins.systemProgram===SystemProgram.programId.toBase58()&&pins.rentSysvar===SYSVAR_RENT_PUBKEY.toBase58()&&pins.instructionsSysvar===SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()&&pins.ed25519Program===Ed25519Program.programId.toBase58(),'SIGNER_STARTUP_PIN_INVALID');
  assert(Number.isSafeInteger(pins.maxBlockhashAge)&&pins.maxBlockhashAge>0&&pins.maxBlockhashAge<=150&&Number.isSafeInteger(pins.maxFloorToleranceBps)&&pins.maxFloorToleranceBps>=0&&pins.maxFloorToleranceBps<=200,'SIGNER_STARTUP_PIN_INVALID');
  assert(Array.isArray(pins.lookupTables),'SIGNER_STARTUP_PIN_INVALID');
  const tableIds=new Set<string>();
  for(const pin of pins.lookupTables){
    assert(new PublicKey(pin.address).toBase58()===pin.address&&pin.owner===ALT_PROGRAM&&/^[0-9a-f]{64}$/.test(pin.addressesSha256)&&Array.isArray(pin.addresses)&&pin.addresses.every((address:string)=>new PublicKey(address).toBase58()===address),'SIGNER_STARTUP_PIN_INVALID');
    assert(!tableIds.has(pin.address)&&sha(Buffer.concat(pin.addresses.map((address:string)=>Buffer.from(new PublicKey(address).toBytes()))))===pin.addressesSha256,'SIGNER_STARTUP_PIN_INVALID');tableIds.add(pin.address);
    assert(Number.isSafeInteger(Number(pin.lastExtendedSlot))&&BigInt(pin.deactivationSlot)>BigInt(pin.lastExtendedSlot),'SIGNER_STARTUP_PIN_INVALID');
  }
}
function permitFromRequest(encoded:string,pins:SignerPins):PermitV2{
  const permit=decodePermit(bytes(encoded,PERMIT_SIZE));validatePermit(permit,BigInt(Math.floor(Date.now()/1000)));
  assert(base58Encode(permit.program)===pins.program&&base58Encode(permit.issuer)===pins.issuer&&base58Encode(permit.domain)===pins.genesis);
  assert(base58Encode(permit.mint)===pins.mint&&base58Encode(permit.tokenProgram)===pins.tokenProgram);
  return permit;
}
function lookupTables(pins:SignerPins,currentSlot:bigint):LoadedLookupTable[]{
  assert(pins.lookupTables.length>0,'SIGNER_LOOKUP_TABLE_INVALID');
  const seen=new Set<string>(),addressesSeen=new Set<string>();return pins.lookupTables.map(pin=>{
    assert(pin.owner===ALT_PROGRAM&&/^[0-9a-f]{64}$/.test(pin.addressesSha256),'SIGNER_LOOKUP_TABLE_INVALID');
    assert(!seen.has(pin.address),'SIGNER_LOOKUP_TABLE_INVALID');seen.add(pin.address);
    assert(sha(Buffer.concat(pin.addresses.map(address=>Buffer.from(new PublicKey(address).toBytes()))))===pin.addressesSha256,'SIGNER_LOOKUP_TABLE_INVALID');
    for(const address of pin.addresses){assert(!addressesSeen.has(address),'SIGNER_LOOKUP_TABLE_INVALID');addressesSeen.add(address)}
    assert(BigInt(pin.lastExtendedSlot)<=currentSlot&&currentSlot<BigInt(pin.deactivationSlot),'SIGNER_LOOKUP_TABLE_INVALID');
    return {pin,account:new AddressLookupTableAccount({key:new PublicKey(pin.address),state:{deactivationSlot:BigInt(pin.deactivationSlot),lastExtendedSlot:Number(pin.lastExtendedSlot),lastExtendedSlotStartIndex:pin.addresses.length,authority:undefined,addresses:pin.addresses.map(address=>new PublicKey(address))}})};
  });
}
function checkFreshBlockhash(request:SignRequest,pins:SignerPins):void{
  assert([request.currentBlockHeight,request.currentSlot,request.blockhashBlockHeight].every(value=>/^(0|[1-9][0-9]*)$/.test(value)),'SIGNER_BLOCKHASH_STALE');
  const current=BigInt(request.currentBlockHeight),issued=BigInt(request.blockhashBlockHeight);
  assert(current>=issued&&current-issued<=BigInt(pins.maxBlockhashAge),'SIGNER_BLOCKHASH_STALE');
  assert(new PublicKey(request.blockhash).toBase58()===request.blockhash,'SIGNER_TRANSACTION_INVALID');
}
function openInstruction(permit:PermitV2,pins:SignerPins):TransactionInstruction{
  const addresses=v2Addresses(pins.program,permit.card,permit.saleId);
  const data=Buffer.concat([Buffer.from(createHash('sha256').update('global:open_sale').digest().subarray(0,8)),Buffer.from(encodePermit(permit))]);
  return new TransactionInstruction({programId:new PublicKey(pins.program),data,keys:[
    {pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:addresses.card,isSigner:false,isWritable:true},
    {pubkey:addresses.sale,isSigner:false,isWritable:true},{pubkey:addresses.escrow,isSigner:false,isWritable:true},
    {pubkey:new PublicKey(pins.mint),isSigner:false,isWritable:false},{pubkey:new PublicKey(pins.issuer),isSigner:true,isWritable:true},
    {pubkey:new PublicKey(pins.tokenProgram),isSigner:false,isWritable:false},{pubkey:new PublicKey(pins.systemProgram),isSigner:false,isWritable:false},
    {pubkey:new PublicKey(pins.rentSysvar),isSigner:false,isWritable:false},{pubkey:new PublicKey(pins.instructionsSysvar),isSigner:false,isWritable:false},
  ]});
}
async function validateOpen(request:Extract<SignRequest,{kind:'open-sale-pair'}>,pins:SignerPins):Promise<VersionedTransaction>{
  const permit=permitFromRequest(request.permitBase64url,pins),message=bytes(request.listingMessageBase64url,61),sellerSignature=bytes(request.sellerSignatureBase64url,64);
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.saleId));
  const listing=decodeListingMessage(message),binding=await listingBinding({domain:permit.domain,program:permit.program,card:permit.card,saleId:permit.saleId,generation:permit.generation});
  assert(equal(listing.binding,binding)&&listing.minTotal<=permit.total&&listing.minTotal>BigInt('0'));
  const minAllowed=(permit.total*(BigInt('10000')-BigInt(pins.maxFloorToleranceBps))+BigInt('9999'))/BigInt('10000');
  assert(listing.minTotal>=minAllowed&&listing.expiresAt>=permit.expiresAt&&listing.expiresAt<=permit.validFrom+BigInt('86400'));
  assert(await verifyListingSignature(permit.seller,message,sellerSignature));
  const ed=Ed25519Program.createInstructionWithPublicKey({publicKey:permit.seller,message,signature:sellerSignature});
  assert(ed.keys.length===0&&ed.programId.toBase58()===pins.ed25519Program);
  const expected=new TransactionMessage({payerKey:new PublicKey(pins.issuer),recentBlockhash:request.blockhash,instructions:[ed,openInstruction(permit,pins)]}).compileToLegacyMessage();
  const tx=deserialize(request.transactionBase64url);assert(tx.message.version==='legacy');
  validateNoDuplicates(tx);assert(equal(tx.message.serialize(),expected.serialize()));validateSignatureSlots(tx,pins.issuer,null,false);
  return tx;
}
async function validateBuy(request:Extract<SignRequest,{kind:'buy-sale'}>,pins:SignerPins):Promise<VersionedTransaction>{
  const permit=permitFromRequest(request.permitBase64url,pins),encoded=encodePermit(permit),digest=sha(encoded);
  assert(/^[0-9a-f]{64}$/.test(request.permitSha256)&&digest===request.permitSha256,'SIGNER_PERMIT_INVALID');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.attemptId),'SIGNER_PERMIT_INVALID');
  const currentSlot=BigInt(request.currentSlot),tables=lookupTables(pins,currentSlot),tableByAddress=new Map(tables.map(t=>[t.pin.address,t.account]));
  const expectedMessage=new TransactionMessage({payerKey:new PublicKey(pins.issuer),recentBlockhash:request.blockhash,instructions:[await buyV2Instruction(permit)]}).compileToV0Message(tables.map(t=>t.account));
  const tx=deserialize(request.transactionBase64url);assert(tx.message.version===0);validateNoDuplicates(tx);
  const lookups=tx.message.addressTableLookups;
  assert(lookups.length>0&&lookups.every(lookup=>tableByAddress.has(lookup.accountKey.toBase58())),'SIGNER_LOOKUP_TABLE_INVALID');
  assert(equal(tx.message.serialize(),expectedMessage.serialize()));validateSignatureSlots(tx,pins.issuer,base58Encode(permit.buyer),true);
  return tx;
}
function deserialize(encoded:string):VersionedTransaction{
  const raw=bytes(encoded,Buffer.from(encoded,'base64url').length);assert(Buffer.from(raw).toString('base64url')===encoded);
  const tx=VersionedTransaction.deserialize(Buffer.from(raw));assert(equal(tx.serialize(),raw));return tx;
}
function validateNoDuplicates(tx:VersionedTransaction):void{
  const message=tx.message,keys=message.version==='legacy'?message.accountKeys:message.staticAccountKeys;
  assert(new Set(keys.map(k=>k.toBase58())).size===keys.length);
  assert(message.compiledInstructions.length===new Set(message.compiledInstructions.map(ix=>`${ix.programIdIndex}:${Buffer.from(ix.data).toString('hex')}:${ix.accountKeyIndexes.join(',')}`)).size);
  for(const ix of message.compiledInstructions)assert(new Set(ix.accountKeyIndexes).size===ix.accountKeyIndexes.length);
}
function validateSignatureSlots(tx:VersionedTransaction,issuer:string,buyer:string|null,allowBuyerSignature:boolean):void{
  const message=tx.message,keys=message.version==='legacy'?message.accountKeys:message.staticAccountKeys,signerCount=message.header.numRequiredSignatures;
  assert(keys.slice(0,signerCount).map(k=>k.toBase58()).join('|')===(buyer?`${issuer}|${buyer}`:issuer));
  assert(tx.signatures.length===signerCount);
  const issuerSignature=tx.signatures[0]!;assert(issuerSignature.every(b=>b===0),'SIGNER_PREFILLED_SIGNATURE');
  if(buyer){const ix=1,buyerSignature=tx.signatures[ix]!;assert(allowBuyerSignature||buyerSignature.every(b=>b===0));if(buyerSignature.some(b=>b!==0))assert(checkSignature(buyer,tx.message.serialize(),buyerSignature));}
  else assert(signerCount===1);
}
export async function validateSignerRequest(request:SignRequest,pins:SignerPins):Promise<VersionedTransaction>{
  checkFreshBlockhash(request,pins);
  if(request.kind==='open-sale-pair')return validateOpen(request,pins);
  return validateBuy(request,pins);
}
/** Builds the buy transaction only from a database-issued permit and operator-pinned ALT contents. */
export async function buildPinnedBuyTransaction(permit:PermitV2,blockhash:string,currentSlot:string,pins:SignerPins):Promise<VersionedTransaction>{
  assert(/^(0|[1-9][0-9]*)$/.test(currentSlot),'SIGNER_LOOKUP_TABLE_INVALID');
  const tables=lookupTables(pins,BigInt(currentSlot)).map(table=>table.account);
  const raw=await buildV2Buy(permit,blockhash,pins.issuer,tables);
  return VersionedTransaction.deserialize(Buffer.from(raw));
}
export function signValidatedTransaction(transaction:VersionedTransaction,keypair:Keypair,issuer:string):string{
  const message=transaction.message.serialize(),before=transaction.signatures.map(signature=>Buffer.from(signature));
  const keys=transaction.message.version==='legacy'?transaction.message.accountKeys:transaction.message.staticAccountKeys;
  const slot=keys.slice(0,transaction.message.header.numRequiredSignatures).findIndex(keyValue=>keyValue.toBase58()===issuer);
  assert(slot>=0,'SIGNER_KEY_MISMATCH');transaction.sign([keypair]);
  assert(equal(transaction.message.serialize(),message),'SIGNER_SIGNATURE_MUTATION');
  for(let i=0;i<before.length;i++)if(i!==slot)assert(equal(transaction.signatures[i]!,before[i]!), 'SIGNER_SIGNATURE_MUTATION');
  const signature=transaction.signatures[slot]!;assert(checkSignature(issuer,message,signature),'SIGNER_SIGNATURE_INVALID');
  return Buffer.from(transaction.serialize()).toString('base64url');
}
