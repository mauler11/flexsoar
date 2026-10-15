import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SYSVAR_INSTRUCTIONS_PUBKEY, type AddressLookupTableAccount } from '@solana/web3.js';
import { encodePermit, encodeAttestation, type PermitV2, type AttestationV2 } from './protocol-v2';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, associatedTokenAddress } from './sdk';
export function v2Addresses(program: string, card: Uint8Array, saleId: Uint8Array) {
  const key = new PublicKey(program);
  const derive = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, key)[0];
  const sale = derive(new TextEncoder().encode('sale-v2'), saleId);
  return { config:derive(new TextEncoder().encode('config-v2')), card:derive(new TextEncoder().encode('card-v2'),card), sale,
    escrow:derive(new TextEncoder().encode('escrow-v2'),sale.toBytes()) };
}
export async function discriminator(name: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))).slice(0,8);
}
export async function buyV2Instruction(p: PermitV2): Promise<TransactionInstruction> {
  const programId = new PublicKey(p.program); const a = v2Addresses(programId.toBase58(),p.card,p.saleId);
  if (!a.config.equals(new PublicKey(p.config)) || !new PublicKey(p.tokenProgram).equals(new PublicKey(TOKEN_PROGRAM_ID))) throw new Error('wrong protocol accounts');
  const fields: [PublicKey,boolean,boolean][] = [
    [a.config,false,true],[a.card,false,true],[a.sale,false,true],[new PublicKey(p.issuer),true,false],[new PublicKey(p.buyer),true,false],
    [new PublicKey(p.buyerToken),false,true],[new PublicKey(p.sellerToken),false,true],[new PublicKey(p.treasuryToken),false,true],
    [a.escrow,false,true],[new PublicKey(TOKEN_PROGRAM_ID),false,false],[SYSVAR_INSTRUCTIONS_PUBKEY,false,false],
  ];
  return new TransactionInstruction({programId,keys:fields.map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable})),
    data:Buffer.concat([Buffer.from(await discriminator('global:buy_sale')),Buffer.from(encodePermit(p))])});
}
/** Requires issuer co-signing later; returns unsigned bytes only. Lookup tables
 * are explicit, never fetched from an untrusted client or created implicitly. */
export async function buildV2Buy(p: PermitV2, blockhash: string, feePayer: string, tables: AddressLookupTableAccount[]): Promise<Uint8Array> {
  const message = new TransactionMessage({payerKey:new PublicKey(feePayer),recentBlockhash:blockhash,instructions:[await buyV2Instruction(p)]}).compileToV0Message(tables);
  const bytes = new VersionedTransaction(message).serialize();
  if (bytes.length > 1232) throw new Error('v2 message exceeds packet size; reviewed address lookup table required'); return bytes;
}
export async function attestationInstruction(program: string, config: string, sale: string, signers: string[], name: string, a: AttestationV2, passed?: boolean): Promise<TransactionInstruction> {
  const allowed = ['record_receipt','record_authentication','review_authentication','authorize_release','authorize_refund','dispute_hold','resolve_dispute'];
  if (!allowed.includes(name) || signers.length !== (['authorize_refund','resolve_dispute'].includes(name) ? 2 : 1)) throw new Error('unsupported authority command');
  const booleanRequired = ['record_authentication','review_authentication','resolve_dispute'].includes(name);
  if (booleanRequired && typeof passed !== 'boolean') throw new Error('explicit verdict required');
  const actions:Record<string,number>={record_receipt:0,record_authentication:passed?1:2,review_authentication:8,authorize_release:3,authorize_refund:4,dispute_hold:5,resolve_dispute:passed?7:6};
  if(a.action!==actions[name])throw new Error('attestation action mismatch');
  return new TransactionInstruction({programId:new PublicKey(program),keys:[
    {pubkey:new PublicKey(config),isSigner:false,isWritable:false},{pubkey:new PublicKey(sale),isSigner:false,isWritable:true},
    ...signers.map(s=>({pubkey:new PublicKey(s),isSigner:true,isWritable:false})),
  ],data:Buffer.concat([Buffer.from(await discriminator(`global:${name}`)),Buffer.from(encodeAttestation(a)),...(booleanRequired?[Buffer.from([passed?1:0])]:[])])});
}
export async function outcomeInstruction(program: string, p: PermitV2, revision: bigint): Promise<TransactionInstruction> {
  if(revision<BigInt(0)||revision>=(BigInt(1)<<BigInt(64)))throw new Error('invalid disposition revision');
  const a=v2Addresses(program,p.card,p.saleId);const data=Buffer.alloc(16);
  data.set(await discriminator('global:execute_outcome'));data.writeBigUInt64LE(revision,8);
  return new TransactionInstruction({programId:new PublicKey(program),data,keys:[
    {pubkey:a.config,isSigner:false,isWritable:true},{pubkey:a.sale,isSigner:false,isWritable:true},{pubkey:a.escrow,isSigner:false,isWritable:true},
    ...[p.sellerToken,p.treasuryToken,p.refundToken].map(bytes=>({pubkey:new PublicKey(bytes),isSigner:false,isWritable:true})),
    {pubkey:new PublicKey(TOKEN_PROGRAM_ID),isSigner:false,isWritable:false},
    {pubkey:SYSVAR_INSTRUCTIONS_PUBKEY,isSigner:false,isWritable:false},
  ]});
}
/** Recreate only the SAME bound ATA; this does not retarget a refund/payout. */
export function recreateBoundAta(payer: string, owner: string, mint: string, expected: string): TransactionInstruction {
  if (associatedTokenAddress(owner,mint) !== expected) throw new Error('destination differs from immutable ATA');
  return new TransactionInstruction({programId:new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),data:Buffer.from([1]),keys:[
    {pubkey:new PublicKey(payer),isSigner:true,isWritable:true},{pubkey:new PublicKey(expected),isSigner:false,isWritable:true},
    {pubkey:new PublicKey(owner),isSigner:false,isWritable:false},{pubkey:new PublicKey(mint),isSigner:false,isWritable:false},
    {pubkey:new PublicKey('11111111111111111111111111111111'),isSigner:false,isWritable:false},
    {pubkey:new PublicKey(TOKEN_PROGRAM_ID),isSigner:false,isWritable:false},
  ]});
}
