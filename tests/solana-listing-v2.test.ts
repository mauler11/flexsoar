import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { FX_TOLERANCE_BPS, LISTING_SIZE, decodeListingMessage, encodeListing, listingBinding, listingFloor, listingForSale, listingSignatureInstruction, openSaleWithListing, verifyListingSignature, type ListingV2 } from '@/lib/solana/listing-v2';
import { encodePermit, KEY_FIELDS, type PermitV2 } from '@/lib/solana/protocol-v2';

const filled = (n: number) => new Uint8Array(32).fill(n);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex');
/** Same inputs and digests as protocol.rs `listing_message_wire_vector`. */
const VECTOR: ListingV2 = { domain: filled(1), program: filled(2), card: filled(3), saleId: filled(4), generation: BigInt(5), minTotal: BigInt(1_000_000), expiresAt: BigInt(1_900_000_000) };
const VECTOR_BINDING = '4f9cc37436893a4b2c837ac87fd40271bd5cce559c2a7534a853318aa259784f';
const VECTOR_SHA256 = 'f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830';

function ed25519Pair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Uint8Array.from(Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url'));
  return { raw, signer: (message: Uint8Array) => Uint8Array.from(sign(null, Buffer.from(message), privateKey)) };
}

describe('seller-signed listing message', () => {
  it('matches the published wire vector the Rust program is tested against', async () => {
    // Independent construction, not a call back into the encoder.
    const preimage = Buffer.alloc(136); [1, 2, 3, 4].forEach((n, i) => preimage.fill(n, i * 32, i * 32 + 32)); preimage.writeBigUInt64LE(BigInt(5), 128);
    expect(sha(preimage)).toBe(VECTOR_BINDING);
    expect(hex(await listingBinding(VECTOR))).toBe(VECTOR_BINDING);
    const tail = Buffer.alloc(16); tail.writeBigUInt64LE(BigInt(1_000_000), 0); tail.writeBigInt64LE(BigInt(1_900_000_000), 8);
    const expected = Buffer.concat([Buffer.from('FSOARV2-LIST\0', 'latin1'), Buffer.from(VECTOR_BINDING, 'hex'), tail]);
    const bytes = await encodeListing(VECTOR);
    expect(bytes.length).toBe(LISTING_SIZE); expect(LISTING_SIZE).toBe(61);
    expect(hex(bytes)).toBe(expected.toString('hex'));
    expect(sha(bytes)).toBe(VECTOR_SHA256);
    expect(hex(bytes.subarray(45))).toBe('40420f000000000000b33f7100000000');
  });
  it('binds each of the five fields and ignores nothing the seller signs', async () => {
    const base = hex(await listingBinding(VECTOR));
    for (const change of [{ domain: filled(9) }, { program: filled(9) }, { card: filled(9) }, { saleId: filled(9) }, { generation: BigInt(6) }]) {
      expect(hex(await listingBinding({ ...VECTOR, ...change }))).not.toBe(base);
    }
    // Floor and expiry are carried in the clear, so a different price is a different message.
    expect(hex(await encodeListing({ ...VECTOR, minTotal: BigInt(1) }))).not.toBe(hex(await encodeListing(VECTOR)));
    expect(hex(await encodeListing({ ...VECTOR, expiresAt: BigInt(1) }))).not.toBe(hex(await encodeListing(VECTOR)));
  });
  it('decodes only the canonical message and refuses invalid inputs', async () => {
    const good = await encodeListing(VECTOR);
    expect(decodeListingMessage(good)).toEqual({ binding: Uint8Array.from(Buffer.from(VECTOR_BINDING, 'hex')), minTotal: BigInt(1_000_000), expiresAt: BigInt(1_900_000_000) });
    expect(() => decodeListingMessage(good.subarray(0, 60))).toThrow(/invalid listing/);
    expect(() => decodeListingMessage(Uint8Array.from([...good, 0]))).toThrow(/invalid listing/);
    const wrongTag = Uint8Array.from(good); wrongTag[0] = 0; expect(() => decodeListingMessage(wrongTag)).toThrow(/invalid listing/);
    for (const bad of [{ minTotal: BigInt(0) }, { minTotal: BigInt(-1) }, { generation: BigInt(-1) }, { domain: new Uint8Array(31) }]) await expect(encodeListing({ ...VECTOR, ...bad })).rejects.toThrow(/invalid listing/);
  });
  it('computes the floor as the quoted total less 2%, rounded up so it is never looser than stated', () => {
    expect(FX_TOLERANCE_BPS).toBe(BigInt(200));
    expect(listingFloor(BigInt(1_000_000))).toBe(BigInt(980_000));
    expect(listingFloor(BigInt(1_000_001))).toBe(BigInt(980_001)); // 980_000.98 -> up
    expect(listingFloor(BigInt(1))).toBe(BigInt(1));
    expect(listingFloor(BigInt(1_000_000), BigInt(0))).toBe(BigInt(1_000_000));
    for (const bad of [BigInt(0), BigInt(-5)]) expect(() => listingFloor(bad)).toThrow(/invalid listing total/);
    for (const bad of [BigInt(-1), BigInt(10000)]) expect(() => listingFloor(BigInt(1_000_000), bad)).toThrow(/invalid FX tolerance/);
    const l = listingForSale({ domain: filled(1), program: filled(2), card: filled(3), saleId: filled(4), generation: BigInt(5) }, BigInt(1_000_000), BigInt(1_900_000_000));
    expect(l.minTotal).toBe(BigInt(980_000));
  });
  it('verifies a genuine signature and refuses forgeries, other signers, other messages and bad lengths', async () => {
    const seller = ed25519Pair(), other = ed25519Pair(), message = await encodeListing(VECTOR), signature = seller.signer(message);
    expect(await verifyListingSignature(seller.raw, message, signature)).toBe(true);
    expect(await verifyListingSignature(other.raw, message, signature)).toBe(false);
    expect(await verifyListingSignature(seller.raw, await encodeListing({ ...VECTOR, minTotal: BigInt(1) }), signature)).toBe(false);
    const flipped = Uint8Array.from(signature); flipped[0] ^= 1; expect(await verifyListingSignature(seller.raw, message, flipped)).toBe(false);
    expect(await verifyListingSignature(seller.raw, message.subarray(1), signature)).toBe(false);
    expect(await verifyListingSignature(seller.raw.subarray(1), message, signature)).toBe(false);
    expect(await verifyListingSignature(seller.raw, message, signature.subarray(1))).toBe(false);
  });
  it('emits the precompile layout the program parser accepts: one signature, every index self-referencing', async () => {
    const seller = ed25519Pair(), message = await encodeListing(VECTOR), ix = listingSignatureInstruction(seller.raw, message, seller.signer(message));
    expect(ix.programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111');
    expect(ix.keys.length).toBe(0);
    const d = Buffer.from(ix.data), at = (i: number) => d.readUInt16LE(i);
    expect(d[0]).toBe(1);
    expect([at(4), at(8), at(14)]).toEqual([0xffff, 0xffff, 0xffff]);
    expect(hex(d.subarray(at(6), at(6) + 32))).toBe(hex(seller.raw));
    expect(at(12)).toBe(LISTING_SIZE);
    expect(hex(d.subarray(at(10), at(10) + at(12)))).toBe(hex(message));
    expect(() => listingSignatureInstruction(seller.raw, message.subarray(1), new Uint8Array(64))).toThrow(/invalid listing message/);
  });
});

describe('pairing the listing with open_sale', () => {
  const program = new PublicKey(filled(2));
  function fixture(sellerKey: Uint8Array) {
    const permit = { mode: 0, generation: BigInt(5), revision: BigInt(1), custodyVersion: BigInt(1), authorityEpoch: BigInt(2), total: BigInt(1_000_000), net: BigInt(950_000), fee: BigInt(50_000), validFrom: BigInt(0), expiresAt: BigInt(1_900_000_000) } as unknown as PermitV2;
    KEY_FIELDS.forEach((k, i) => { (permit as unknown as Record<string, Uint8Array>)[k] = filled(i + 10); });
    Object.assign(permit, { domain: filled(1), program: filled(2), card: filled(3), saleId: filled(4), seller: sellerKey });
    return { open: new TransactionInstruction({ programId: program, keys: [], data: Buffer.concat([Buffer.alloc(8), Buffer.from(encodePermit(permit))]) }) };
  }
  it('returns [signature, open_sale] only for the matching sale and the real card owner', async () => {
    const seller = ed25519Pair(), { open } = fixture(seller.raw), message = await encodeListing(VECTOR);
    const pair = await openSaleWithListing(open, VECTOR, seller.signer(message));
    expect(pair.length).toBe(2); expect(pair[0].programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111'); expect(pair[1]).toBe(open);
    for (const bad of [{ card: filled(9) }, { saleId: filled(9) }, { program: filled(9) }, { domain: filled(9) }, { generation: BigInt(6) }]) {
      const listing = { ...VECTOR, ...bad };
      await expect(openSaleWithListing(open, listing, seller.signer(await encodeListing(listing)))).rejects.toThrow(/does not match the sale/);
    }
  });
  it('refuses a signature from anyone but the card owner, and a signature over different terms', async () => {
    const owner = ed25519Pair(), impostor = ed25519Pair(), { open } = fixture(owner.raw), message = await encodeListing(VECTOR);
    await expect(openSaleWithListing(open, VECTOR, impostor.signer(message))).rejects.toThrow(/does not verify for the card owner/);
    await expect(openSaleWithListing(open, VECTOR, owner.signer(await encodeListing({ ...VECTOR, minTotal: BigInt(1) })))).rejects.toThrow(/does not verify/);
    // Skipping the offline check exists so tests can exercise the on-chain refusal; it is never the default.
    await expect(openSaleWithListing(open, VECTOR, impostor.signer(message), false)).resolves.toHaveLength(2);
  });
});
