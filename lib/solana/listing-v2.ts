/** Seller-signed listing message (solo-operator design section 5, as amended by P1). Twin of
 * solana/programs/flexsoar-settlement/src/protocol.rs `listing_message`; tests/solana-listing-v2.test.ts and the Rust
 * `listing_message_wire_vector` test are pinned to one vector.
 *
 *   "FSOARV2-LIST\0" || binding || min_total u64le || list_expires_at i64le          (61 bytes)
 *   binding = SHA-256(domain || program || card || sale_id || generation u64le)
 *
 * The seller's wallet (the card's registered owner) signs these bytes off chain with no SOL. `open_sale` then requires an
 * Ed25519 precompile instruction for this message IMMEDIATELY before it; `buy_sale` refuses totals below `min_total`.
 * The message names the sale id, card and generation (through the binding) and a sale account can only be created once,
 * so a signature cannot be replayed on another sale, network or program.
 *
 * Deviation from the design text, forced by measurement: the five bound fields were listed inline (165 bytes). That makes
 * the `open_sale` transaction 1,276 bytes against the 1,232-byte packet limit; this form is 1,172. */
import { Ed25519Program, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { decodePermit, equalBytes } from './protocol-v2';

export const LISTING_TAG = new Uint8Array([70, 83, 79, 65, 82, 86, 50, 45, 76, 73, 83, 84, 0]); // "FSOARV2-LIST\0"
export const LISTING_SIZE = 61;
const MIN_OFFSET = 13 + 32;
/** Floor tolerance under the quoted price, in basis points. Founder decision 2026-10-22: 2%. */
export const FX_TOLERANCE_BPS = BigInt(200);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63)), I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);

/** What the seller is signing for: the sale it is bound to, the floor, and when the listing lapses. */
export interface ListingV2 {
  domain: Uint8Array; program: Uint8Array; card: Uint8Array; saleId: Uint8Array;
  generation: bigint; minTotal: bigint; expiresAt: bigint;
}
export interface ListingMessageV2 { binding: Uint8Array; minTotal: bigint; expiresAt: bigint }

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}

/** SHA-256 over the five fields the signature is bound to, exactly as the program recomputes it. */
export async function listingBinding(l: Pick<ListingV2, 'domain' | 'program' | 'card' | 'saleId' | 'generation'>): Promise<Uint8Array> {
  const preimage = new Uint8Array(32 * 4 + 8);
  [l.domain, l.program, l.card, l.saleId].forEach((field, i) => {
    if (!(field instanceof Uint8Array) || field.length !== 32) throw new Error(`invalid listing ${(['domain', 'program', 'card', 'saleId'] as const)[i]}`);
    preimage.set(field, i * 32);
  });
  if (l.generation < BigInt(0) || l.generation > U64_MAX) throw new Error('invalid listing generation');
  new DataView(preimage.buffer).setBigUint64(128, l.generation, true);
  return sha256(preimage);
}

export async function encodeListing(l: ListingV2): Promise<Uint8Array> {
  // Same rules as the program: a zero floor would make the signature meaningless.
  if (l.minTotal <= BigInt(0) || l.minTotal > U64_MAX) throw new Error('invalid listing floor');
  if (l.expiresAt < I64_MIN || l.expiresAt > I64_MAX) throw new Error('invalid listing expiry');
  const out = new Uint8Array(LISTING_SIZE); out.set(LISTING_TAG); out.set(await listingBinding(l), LISTING_TAG.length);
  const view = new DataView(out.buffer);
  view.setBigUint64(MIN_OFFSET, l.minTotal, true); view.setBigInt64(MIN_OFFSET + 8, l.expiresAt, true);
  return out;
}

export function decodeListingMessage(bytes: Uint8Array): ListingMessageV2 {
  if (bytes.length !== LISTING_SIZE || LISTING_TAG.some((b, i) => b !== bytes[i])) throw new Error('invalid listing message');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { binding: Uint8Array.from(bytes.subarray(13, 45)), minTotal: view.getBigUint64(MIN_OFFSET, true), expiresAt: view.getBigInt64(MIN_OFFSET + 8, true) };
}

/** Floor the seller is shown and signs: the quoted total less the FX tolerance, rounded UP so the guarantee is never looser
 * than stated. `totalUnits` is the USDC base-unit total (6 decimals) computed from the MYR price at listing time. */
export function listingFloor(totalUnits: bigint, toleranceBps: bigint = FX_TOLERANCE_BPS): bigint {
  if (totalUnits <= BigInt(0) || totalUnits > U64_MAX) throw new Error('invalid listing total');
  if (toleranceBps < BigInt(0) || toleranceBps >= BigInt(10000)) throw new Error('invalid FX tolerance');
  const scaled = totalUnits * (BigInt(10000) - toleranceBps), floor = scaled / BigInt(10000);
  return scaled % BigInt(10000) === BigInt(0) ? floor : floor + BigInt(1);
}

/** Listing the seller's wallet will be asked to `signMessage`, bound to this exact sale. */
export function listingForSale(sale: Pick<ListingV2, 'domain' | 'program' | 'card' | 'saleId' | 'generation'>,
  totalUnits: bigint, expiresAt: bigint, toleranceBps: bigint = FX_TOLERANCE_BPS): ListingV2 {
  return { ...sale, minTotal: listingFloor(totalUnits, toleranceBps), expiresAt };
}

/** Application-side check (Ed25519 cannot be verified in SQL): the signature is valid for these bytes under the seller key.
 * The program repeats the binding on chain; this keeps a bad signature from ever being stored or submitted. */
export async function verifyListingSignature(seller: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (seller.length !== 32 || signature.length !== 64 || message.length !== LISTING_SIZE) return false;
  try {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(seller), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, Uint8Array.from(signature), Uint8Array.from(message));
  } catch { return false; }
}

/** The precompile instruction `open_sale` expects directly before it. Layout is the runtime's own (all indexes self). */
export function listingSignatureInstruction(seller: Uint8Array, message: Uint8Array, signature: Uint8Array): TransactionInstruction {
  if (message.length !== LISTING_SIZE) throw new Error('invalid listing message');
  return Ed25519Program.createInstructionWithPublicKey({ publicKey: Uint8Array.from(seller), message: Uint8Array.from(message), signature: Uint8Array.from(signature) });
}

/** [signature instruction, open_sale] in the only order the program accepts. Refuses to pair a listing with an `open_sale`
 * for a different card, sale, generation, program or seller, so a mismatch fails here instead of costing a failed transaction.
 * The transaction must be fee-paid by the issuer: with any other payer it exceeds the 1,232-byte packet limit. */
export async function openSaleWithListing(open: TransactionInstruction, listing: ListingV2, signature: Uint8Array, verifyOffline = true): Promise<TransactionInstruction[]> {
  const permit = decodePermit(Uint8Array.from(open.data.subarray(8)));
  if (!equalBytes(permit.card, listing.card) || !equalBytes(permit.saleId, listing.saleId) || !equalBytes(permit.program, listing.program) ||
      !equalBytes(permit.domain, listing.domain) || permit.generation !== listing.generation || !open.programId.equals(new PublicKey(listing.program))) {
    throw new Error('listing does not match the sale being opened');
  }
  const message = await encodeListing(listing);
  if (verifyOffline && !(await verifyListingSignature(permit.seller, message, signature))) throw new Error('listing signature does not verify for the card owner');
  return [listingSignatureInstruction(permit.seller, message, signature), open];
}
