/** Converts role-scoped immutable database contexts into exact protocol instructions.
 * No API accepts caller-provided expected account lists or authorization bytes. */
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { base58Decode } from './base58';
import { decodePermit, consumptionDigestV1, equalBytes } from './protocol-v2';
import { TOKEN_PROGRAM_ID } from './sdk';
import { discriminator, v2Addresses, attestationInstruction } from './v2-sdk';

function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('invalid trusted payment context');return v as Record<string,unknown>;}
function text(r:Record<string,unknown>,k:string):string{if(typeof r[k]!=='string'||!r[k])throw new Error(`missing trusted context ${k}`);return r[k] as string;}
function key(r:Record<string,unknown>,k:string):PublicKey{return new PublicKey(text(r,k));}
function bytes32(v:unknown):Uint8Array{if(typeof v!=='string')throw new Error('missing trusted 32-byte key');const b=base58Decode(v);if(b.length!==32)throw new Error('trusted key length mismatch');return b;}
function uuidBytes(v:unknown):Uint8Array{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw new Error('invalid trusted context UUID');return Buffer.from(v.replaceAll('-',''),'hex');}
const meta=(pubkey:PublicKey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});

export async function openSaleInstructionFromContext(value:unknown):Promise<TransactionInstruction>{
 const c=record(value);if(c.formatVersion!==1||c.action!=='open_sale')throw new Error('unsupported issuer context');
 const program=text(c,'program'),templateHex=text(c,'templateHex');if(!/^[0-9a-f]{1380}$/.test(templateHex))throw new Error('invalid canonical sale template');
 const permit=decodePermit(Buffer.from(templateHex,'hex'));
 if(permit.mode!==c.mode||BigInt(c.generation as string)!==permit.generation||BigInt(c.revision as string)!==permit.revision||BigInt(c.custodyVersion as string)!==permit.custodyVersion||
    !equalBytes(permit.domain,bytes32(c.genesis))||!equalBytes(permit.program,new PublicKey(program).toBytes())||!equalBytes(permit.config,key(c,'config').toBytes())||
    !equalBytes(permit.saleId,bytes32(c.saleCommitment))||!equalBytes(permit.card,bytes32(c.cardCommitment))||!equalBytes(permit.pair,bytes32(c.pairCommitment))||
    !equalBytes(permit.seller,key(c,'seller').toBytes())||!equalBytes(permit.sellerToken,key(c,'sellerToken').toBytes())||!equalBytes(permit.treasury,key(c,'treasury').toBytes())||!equalBytes(permit.treasuryToken,key(c,'treasuryToken').toBytes())||
    !equalBytes(permit.issuer,key(c,'actor').toBytes())||!equalBytes(permit.mint,key(c,'mint').toBytes())||!equalBytes(permit.tokenProgram,key(c,'tokenProgram').toBytes())||
    !equalBytes(permit.attempt,new Uint8Array(32))||!equalBytes(permit.beneficiary,new Uint8Array(32))||!equalBytes(permit.buyer,new Uint8Array(32))||!equalBytes(permit.buyerToken,new Uint8Array(32))||!equalBytes(permit.refundToken,new Uint8Array(32))||permit.total!==BigInt(text(c,'totalUnits'))||
    permit.validFrom!==BigInt(text(c,'validFrom'))||permit.expiresAt!==BigInt(text(c,'expiresAt'))||permit.fee!==permit.total*BigInt(500)/BigInt(10000)||permit.net+permit.fee!==permit.total)throw new Error('sale template differs from authoritative context');
 const addresses=v2Addresses(program,permit.card,permit.saleId);if(addresses.sale.toBase58()!==text(c,'sale')||addresses.escrow.toBase58()!==text(c,'escrow')||addresses.config.toBase58()!==text(c,'config'))throw new Error('sale PDA differs from authoritative context');
 return new TransactionInstruction({programId:new PublicKey(program),keys:[meta(addresses.config),meta(addresses.card,false,true),meta(addresses.sale,false,true),meta(addresses.escrow,false,true),meta(key(c,'mint')),meta(key(c,'actor'),true,true),meta(new PublicKey(TOKEN_PROGRAM_ID)),meta(SystemProgram.programId),meta(SYSVAR_RENT_PUBKEY)],data:Buffer.concat([Buffer.from(await discriminator('global:open_sale')),Buffer.from(templateHex,'hex')])});
}

export async function revokeSaleInstructionFromContext(value:unknown):Promise<TransactionInstruction>{
 const c=record(value);if(c.formatVersion!==1||c.action!=='revoke_sale')throw new Error('unsupported issuer context');
 const program=text(c,'program'),addresses=v2Addresses(program,bytes32(c.cardCommitment),bytes32(c.saleCommitment));
 if(addresses.sale.toBase58()!==text(c,'sale')||addresses.config.toBase58()!==text(c,'config'))throw new Error('revoke sale PDA differs from authoritative context');
 return new TransactionInstruction({programId:new PublicKey(program),keys:[meta(addresses.config),meta(addresses.card,false,true),meta(addresses.sale,false,true),meta(key(c,'actor'),true)],data:Buffer.from(await discriminator('global:revoke_sale'))});
}

export async function decisionInstructionFromContext(value:unknown):Promise<{instruction:TransactionInstruction;actors:string[]}>{
 const c=record(value);if(c.formatVersion!==1||c.kind!=='decision'||!Array.isArray(c.actors)||!c.actors.every(a=>typeof a==='string'))throw new Error('unsupported verifier decision context');
 const action=text(c,'action'),name=text(c,'instruction'),actors=c.actors as string[];
 const actions:Record<string,[string,number]>={receipt:['record_receipt',0],authentication_pass:['record_authentication',1],authentication_fail:['record_authentication',2],review_authentication_pass:['review_authentication',8],review_authentication_fail:['review_authentication',8],release:['authorize_release',3],refund:['authorize_refund',4],dispute:['dispute_hold',5],resolve_dispute_release:['resolve_dispute',6],resolve_dispute_refund:['resolve_dispute',7]};
 const bound=actions[action];if(!bound||bound[0]!==name||bound[1]!==Number(c.actionCode)||new Set(actors).size!==actors.length||actors.some(a=>!/^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(a)))throw new Error('decision context instruction binding mismatch');
 const passed=action==='authentication_pass'||action==='review_authentication_pass'||action==='resolve_dispute_refund';
 const attestation={sale:bytes32(c.sale),attempt:bytes32(c.attempt),pair:bytes32(c.pairCommitment),evidence:bytes32(c.evidenceDigest),revision:BigInt(text(c,'expectedRevision')),action:Number(c.actionCode)};
 const instruction=await attestationInstruction(text(c,'program'),text(c,'config'),text(c,'sale'),actors,name,attestation,
   ['record_authentication','review_authentication','resolve_dispute'].includes(name)?passed:undefined);
 return {instruction,actors};
}

export async function claimAcknowledgementInstruction(value:unknown):Promise<TransactionInstruction>{
 const c=record(value);if(c.formatVersion!==1||typeof c.actors!=='object'||!Array.isArray(c.actors)||c.actors.length!==1||typeof c.actors[0]!=='string')throw new Error('unsupported acknowledgement context');
 if(!['funded','direct','released','refunded'].includes(text(c,'kind'))||!/^[0-9a-f]{64}$/.test(text(c,'proofDigest'))||!/^[0-9a-f]{64}$/.test(text(c,'consumptionDigest')))throw new Error('invalid committed acknowledgement evidence');
 const derived=await consumptionDigestV1({networkId:text(c,'networkId'),eventId:text(c,'eventId'),saleId:text(c,'saleId'),attemptId:text(c,'attemptId'),orderId:text(c,'orderId'),kind:text(c,'kind') as 'funded'|'direct'|'released'|'refunded',genesis:bytes32(c.genesis),proofDigest:Uint8Array.from(Buffer.from(text(c,'proofDigest'),'hex'))});
 if(Buffer.from(derived).toString('hex')!==text(c,'consumptionDigest'))throw new Error('committed consumption digest mismatch');
 const addresses=v2Addresses(text(c,'program'),bytes32(c.cardCommitment),bytes32(c.saleCommitment));
 if(addresses.sale.toBase58()!==text(c,'sale'))throw new Error('acknowledgement sale PDA mismatch');
 const data=Buffer.concat([Buffer.from(await discriminator('global:acknowledge_claim')),Buffer.from(derived)]);
 return new TransactionInstruction({programId:new PublicKey(text(c,'program')),keys:[meta(key(c,'config')),meta(addresses.card,false,true),meta(addresses.sale),meta(new PublicKey(c.actors[0]),true)],data});
}

export function attemptIdFromContext(value:unknown):string{return text(record(value),'attemptId');}
export function uuidBytesForContext(value:unknown):Uint8Array{return uuidBytes(value);}
