import { createHash } from 'node:crypto';
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '@/lib/solana/base58';
import { decodeListingMessage, listingBinding, verifyListingSignature } from '@/lib/solana/listing-v2';
import { decodePermit, encodePermit, type PermitV2 } from '@/lib/solana/protocol-v2';
import { v2Addresses } from '@/lib/solana/v2-sdk';

export interface OpenSalePairPins { issuer:string;program:string;genesis:string;mint:string;tokenProgram:string;systemProgram:string;rentSysvar:string;instructionsSysvar:string }
function fail(code:string):never{throw new Error(code)}
function b58(value:Uint8Array):string{return base58Encode(value)}
function openSaleInstruction(permit:PermitV2,pins:OpenSalePairPins):TransactionInstruction{
  const pda=v2Addresses(pins.program,permit.card,permit.saleId);
  const data=Buffer.concat([createHash('sha256').update('global:open_sale').digest().subarray(0,8),Buffer.from(encodePermit(permit))]);
  return new TransactionInstruction({programId:new PublicKey(pins.program),data,keys:[
    {pubkey:pda.config,isSigner:false,isWritable:false},{pubkey:pda.card,isSigner:false,isWritable:true},{pubkey:pda.sale,isSigner:false,isWritable:true},{pubkey:pda.escrow,isSigner:false,isWritable:true},
    {pubkey:new PublicKey(pins.mint),isSigner:false,isWritable:false},{pubkey:new PublicKey(pins.issuer),isSigner:true,isWritable:true},{pubkey:new PublicKey(pins.tokenProgram),isSigner:false,isWritable:false},
    {pubkey:new PublicKey(pins.systemProgram),isSigner:false,isWritable:false},{pubkey:new PublicKey(pins.rentSysvar),isSigner:false,isWritable:false},{pubkey:new PublicKey(pins.instructionsSysvar),isSigner:false,isWritable:false},
  ]});
}

/** The only issuer open-sale constructor. It always binds seller proof to DB permit
 * bytes and returns the ordered Ed25519/open pair; there is no bare builder export. */
export async function buildOpenSalePair(input:{permitTemplate:Uint8Array;listingMessage:Uint8Array;sellerSignature:Uint8Array;blockhash:string;pins:OpenSalePairPins}):Promise<VersionedTransaction>{
  const {permitTemplate,message,sellerSignature,pins}= {permitTemplate:input.permitTemplate,message:input.listingMessage,sellerSignature:input.sellerSignature,pins:input.pins};
  let permit:PermitV2;try{permit=decodePermit(permitTemplate)}catch{fail('ISSUER_OPEN_CONTEXT_MISMATCH')}
  if(permitTemplate.length!==690||b58(permit.program)!==pins.program||b58(permit.domain)!==pins.genesis||b58(permit.issuer)!==pins.issuer||b58(permit.mint)!==pins.mint||b58(permit.tokenProgram)!==pins.tokenProgram)fail('ISSUER_OPEN_CONTEXT_MISMATCH');
  const listing=decodeListingMessage(message),binding=await listingBinding({domain:permit.domain,program:permit.program,card:permit.card,saleId:permit.saleId,generation:permit.generation});
  const floor=(permit.total*BigInt('9800')+BigInt('9999'))/BigInt('10000');
  if(listing.minTotal<floor||listing.minTotal>permit.total||listing.expiresAt<permit.expiresAt||listing.expiresAt>permit.validFrom+BigInt('86400')||listing.binding.some((v,i)=>v!==binding[i]))fail('ISSUER_BARE_OPEN_REFUSED');
  if(!(await verifyListingSignature(permit.seller,message,sellerSignature)))fail('ISSUER_LISTING_SIGNATURE_INVALID');
  const proof=Ed25519Program.createInstructionWithPublicKey({publicKey:permit.seller,message,signature:sellerSignature});
  const instructions=[proof,openSaleInstruction(permit,pins)];
  if(instructions.length!==2||instructions[0]!.programId.toBase58()!==Ed25519Program.programId.toBase58()||instructions[1]!.programId.toBase58()!==pins.program)fail('ISSUER_BARE_OPEN_REFUSED');
  const messageV0=new TransactionMessage({payerKey:new PublicKey(pins.issuer),recentBlockhash:input.blockhash,instructions}).compileToLegacyMessage();
  return new VersionedTransaction(messageV0);
}
