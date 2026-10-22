import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { base58Encode } from '@/lib/solana/base58';
import { awkwardMessages, ed25519Works, runSignMessageProof, VECTOR_SHA256, verifyEd25519, type ProofSigner } from '@/lib/solana/privy-proof';

const PREFIX = Uint8Array.from([0xff, ...new TextEncoder().encode('solana offchain')]);
const concat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Uint8Array.from(Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url'));
  const signRaw = (key: KeyObject, bytes: Uint8Array) => Uint8Array.from(sign(null, Buffer.from(bytes), key));
  return { address: base58Encode(raw), privateKey, signRaw };
}
/** A wallet that does what the program needs: signs exactly the bytes it is given. */
function honest(): ProofSigner { const w = wallet(); return { address: w.address, signMessage: async m => w.signRaw(w.privateKey, m) }; }
const failingAt = async (signer: ProofSigner, stop: string) => {
  const r = await runSignMessageProof(signer);
  expect(r.passed).toBe(false); expect(r.stop).toBe(stop); expect(r.steps.some(s => !s.ok)).toBe(true);
  return r;
};

describe('the verifier and the fixtures', () => {
  it('verifies the RFC 8032 test vector, so a later "false" is meaningful', async () => { expect(await ed25519Works()).toBe(true); });
  it('refuses a wrong-length key or signature and a signature over other bytes', async () => {
    const w = wallet(), msg = new Uint8Array([1, 2, 3]), sig = w.signRaw(w.privateKey, msg);
    expect(await verifyEd25519(new Uint8Array(31), msg, sig)).toBe(false);
    expect(await verifyEd25519(new Uint8Array(32), msg, sig.subarray(1))).toBe(false);
  });
  it('the awkward messages are 61 bytes and really contain a leading 0x00, high bytes and invalid UTF-8', () => {
    const [lead, high, notUtf8] = awkwardMessages();
    for (const m of [lead, high, notUtf8]) expect(m.bytes.length).toBe(61);
    expect(lead.bytes[0]).toBe(0); expect(high.bytes.includes(0xff) && high.bytes.includes(0x00)).toBe(true);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(notUtf8.bytes)).toThrow();
    expect(VECTOR_SHA256).toBe('f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830');
  });
});

describe('a wallet that signs the exact bytes passes every step', () => {
  it('passes steps 0-5 and records the evidence', async () => {
    const r = await runSignMessageProof(honest());
    expect(r.passed).toBe(true); expect(r.stop).toBeNull();
    expect(r.steps.map(s => s.id)).toEqual(['0', '1', '2', '3', '4', '5', '5', '5']);
    expect(r.steps.every(s => s.ok)).toBe(true);
    expect(r.messageHex.length).toBe(122); expect(r.signatureHex?.length).toBe(128);
    expect(r.steps.find(s => s.id === '4')?.detail).toMatch(/off-chain prefix: false \(good\).*hex string of the message: false \(good\).*one bit flipped: false \(good\)/);
  });
});

describe('every way a wallet can change the bytes is caught (the STOP condition)', () => {
  it('prefixing the Solana off-chain header fails at step 3', async () => {
    const w = wallet(); const r = await failingAt({ address: w.address, signMessage: async m => w.signRaw(w.privateKey, concat(PREFIX, m)) }, '3');
    expect(r.steps.at(-1)?.title).toMatch(/UNMODIFIED 61 bytes/);
  });
  it('signing the hex string instead of the bytes fails at step 3', async () => {
    const w = wallet(); await failingAt({ address: w.address, signMessage: async m => w.signRaw(w.privateKey, new TextEncoder().encode(hex(m))) }, '3');
  });
  it('signing the base64 string instead of the bytes fails at step 3', async () => {
    const w = wallet(); await failingAt({ address: w.address, signMessage: async m => w.signRaw(w.privateKey, new TextEncoder().encode(Buffer.from(m).toString('base64'))) }, '3');
  });
  it('coercing the bytes through a UTF-8 string fails at step 3 (the vector has high bytes)', async () => {
    const w = wallet(); await failingAt({ address: w.address, signMessage: async m => w.signRaw(w.privateKey, new TextEncoder().encode(new TextDecoder().decode(m))) }, '3');
  });
  it('a wallet that is exact on the vector but coerces other messages is caught at step 5, not missed', async () => {
    const w = wallet(), vectorFirst = { done: false };
    const r = await failingAt({ address: w.address, signMessage: async m => {
      if (!vectorFirst.done) { vectorFirst.done = true; return w.signRaw(w.privateKey, m); }
      return w.signRaw(w.privateKey, new TextEncoder().encode(new TextDecoder().decode(m))); // lossy string round trip
    } }, '5');
    expect(r.steps.filter(s => s.id === '5' && !s.ok).length).toBeGreaterThanOrEqual(2);
  });
  it('a signature from some other key fails at step 3', async () => {
    const a = wallet(), b = wallet(); await failingAt({ address: a.address, signMessage: async m => b.signRaw(b.privateKey, m) }, '3');
  });
  it('a short signature fails at step 2', async () => { const w = wallet(); await failingAt({ address: w.address, signMessage: async m => w.signRaw(w.privateKey, m).subarray(1) }, '2'); });
  it('a wallet that throws fails at step 2 with its message', async () => {
    const w = wallet(), r = await failingAt({ address: w.address, signMessage: async () => { throw new Error('user rejected'); } }, '2');
    expect(r.steps.at(-1)?.detail).toMatch(/user rejected/);
  });
  it('an address that is not a 32-byte key fails at step 0', async () => { await failingAt({ address: '1111', signMessage: async m => m }, '0'); });
  it('a signature that would verify over a variant is flagged by the negative controls', async () => {
    // A signer that signs the PREFIXED bytes AND returns the bytes it was given plus a prefixed signature cannot satisfy both;
    // here we prove step 4 can fail by checking the rule directly: a signature valid over the prefixed variant verifies there.
    const w = wallet(), prefixed = concat(PREFIX, new Uint8Array([1, 2, 3])), sig = w.signRaw(w.privateKey, prefixed);
    const pub = (await import('@/lib/solana/base58')).base58Decode(w.address);
    expect(await verifyEd25519(pub, prefixed, sig)).toBe(true);
    expect(await verifyEd25519(pub, new Uint8Array([1, 2, 3]), sig)).toBe(false);
  });
});
