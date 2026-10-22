/** Privy `signMessage` proof (docs/handoff/solana-p1b.md section 7, steps 1-5), as a library with no Privy or browser dependency.
 *
 * The seller signs 61 raw bytes and the program needs a plain Ed25519 signature over EXACTLY those bytes. The question this answers
 * is whether a given wallet's `signMessage` signs the bytes it is given (no prefix, no domain wrapping, no string re-encoding).
 *
 *   0. the verifier itself works (RFC 8032 test vector 1), so a later "false" means something;
 *   1. the message is the shared listing vector (61 bytes, SHA-256 f7125fc0...);
 *   2. the wallet signs it and returns 64 signature bytes;
 *   3. the signature verifies over the UNMODIFIED 61 bytes under the wallet's address            <- the pass/fail that matters;
 *   4. negative controls: the same signature must NOT verify over the message with the Solana off-chain prefix, over the message's hex
 *      string, or over the message with one bit flipped (proves the check can fail);
 *   5. three more messages carrying 0x00, 0xff and invalid UTF-8 must each sign and verify over their exact bytes, which catches string
 *      coercion that the vector alone would not.
 *
 * STOP rule: if step 3 or step 5 fails, or any variant verifies only after re-encoding, do not change what the program verifies. */
import { LISTING_SIZE, encodeListing, type ListingV2 } from './listing-v2';
import { base58Decode } from './base58';

export const VECTOR_LISTING: ListingV2 = {
  domain: new Uint8Array(32).fill(1), program: new Uint8Array(32).fill(2), card: new Uint8Array(32).fill(3), saleId: new Uint8Array(32).fill(4),
  generation: BigInt(5), minTotal: BigInt(1_000_000), expiresAt: BigInt(1_900_000_000),
};
export const VECTOR_SHA256 = 'f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830';
const RFC8032_TEST1 = {
  publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  signature: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
};
/** What Solana wallets conventionally put in front of an off-chain message. */
const OFFCHAIN_PREFIX = Uint8Array.from([0xff, ...new TextEncoder().encode('solana offchain')]);

export interface ProofSigner { address: string; signMessage: (message: Uint8Array) => Promise<Uint8Array> }
export interface ProofStep { id: string; title: string; ok: boolean; detail: string }
export interface ProofReport { address: string; startedAt: string; steps: ProofStep[]; passed: boolean; stop: string | null; messageHex: string; signatureHex: string | null }

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map(x => parseInt(x, 16)));
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** Generic Ed25519 verification (any message length). Returns false on any error; use `ed25519Works` first so false is meaningful. */
export async function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, Uint8Array.from(signature), Uint8Array.from(message));
  } catch { return false; }
}
export async function ed25519Works(): Promise<boolean> { return verifyEd25519(fromHex(RFC8032_TEST1.publicKey), new Uint8Array(0), fromHex(RFC8032_TEST1.signature)); }

async function sha256Hex(b: Uint8Array): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(b)))); }

/** Messages that expose string coercion: a leading 0x00, high bytes, and bytes that are not valid UTF-8. */
export function awkwardMessages(): { name: string; bytes: Uint8Array }[] {
  const leadingZero = new Uint8Array(LISTING_SIZE); for (let i = 1; i < LISTING_SIZE; i++) leadingZero[i] = (i * 7) & 0xff;
  const highBytes = new Uint8Array(LISTING_SIZE); for (let i = 0; i < LISTING_SIZE; i++) highBytes[i] = i % 2 === 0 ? 0xff : 0x00;
  const notUtf8 = new Uint8Array(LISTING_SIZE); notUtf8.set([0xc0, 0xaf, 0xff, 0xfe, 0x80, 0x00, 0xed, 0xa0, 0x80]); for (let i = 9; i < LISTING_SIZE; i++) notUtf8[i] = 0x41;
  return [{ name: 'leading 0x00', bytes: leadingZero }, { name: '0xff and 0x00 interleaved', bytes: highBytes }, { name: 'invalid UTF-8 sequences', bytes: notUtf8 }];
}

export async function runSignMessageProof(signer: ProofSigner): Promise<ProofReport> {
  const steps: ProofStep[] = [];
  const add = (id: string, title: string, ok: boolean, detail: string) => { steps.push({ id, title, ok, detail }); return ok; };
  const finish = (stop: string | null, messageHex: string, signatureHex: string | null): ProofReport =>
    ({ address: signer.address, startedAt: new Date().toISOString(), steps, passed: stop === null && steps.every(s => s.ok), stop, messageHex, signatureHex });

  let publicKey: Uint8Array;
  try { publicKey = base58Decode(signer.address); if (publicKey.length !== 32) throw new Error('not 32 bytes'); }
  catch { add('0', 'wallet address is a 32-byte public key', false, `address ${signer.address} does not decode to 32 bytes`); return finish('0', '', null); }

  if (!await ed25519Works()) { add('0', 'this browser verifies Ed25519 (RFC 8032 test vector 1)', false, 'WebCrypto Ed25519 is unavailable or broken; use a current Chrome, Edge, Firefox or Safari'); return finish('0', '', null); }
  add('0', 'this browser verifies Ed25519 (RFC 8032 test vector 1)', true, 'known-good signature verified, so a later "false" is meaningful');

  const message = await encodeListing(VECTOR_LISTING), messageHex = hex(message), digest = await sha256Hex(message);
  if (!add('1', 'message is the shared 61-byte listing vector', message.length === LISTING_SIZE && digest === VECTOR_SHA256, `length ${message.length}, sha256 ${digest}`)) return finish('1', messageHex, null);

  let signature: Uint8Array;
  try { signature = await signer.signMessage(message); }
  catch (e) { add('2', 'wallet signs the message', false, `signMessage threw: ${e instanceof Error ? e.message : String(e)}`); return finish('2', messageHex, null); }
  if (!(signature instanceof Uint8Array) || signature.length !== 64) { add('2', 'wallet returns a 64-byte signature', false, `got ${signature instanceof Uint8Array ? signature.length + ' bytes' : typeof signature}`); return finish('2', messageHex, null); }
  add('2', 'wallet returns a 64-byte signature', true, `signature ${hex(signature).slice(0, 16)}...`);
  const signatureHex = hex(signature);

  if (!add('3', 'signature verifies over the UNMODIFIED 61 bytes under the wallet address (the pass/fail that matters)', await verifyEd25519(publicKey, message, signature),
    'false here means the wallet signed something other than the bytes it was given (a prefix, a wrapper, or a re-encoding)')) return finish('3', messageHex, signatureHex);

  const flipped = Uint8Array.from(message); flipped[40] ^= 1;
  const controls: [string, Uint8Array][] = [['message with the Solana off-chain prefix', concat(OFFCHAIN_PREFIX, message)], ['the hex string of the message', new TextEncoder().encode(messageHex)], ['message with one bit flipped', flipped]];
  const verdicts = await Promise.all(controls.map(async ([name, bytes]) => [name, await verifyEd25519(publicKey, bytes, signature)] as const));
  add('4', 'negative controls: the same signature does NOT verify over any of the variants', verdicts.every(([, v]) => !v), verdicts.map(([n, v]) => `${n}: ${v ? 'VERIFIES (bad)' : 'false (good)'}`).join('; '));

  for (const { name, bytes } of awkwardMessages()) {
    let sig: Uint8Array;
    try { sig = await signer.signMessage(bytes); } catch (e) { add('5', `wallet signs a message with ${name}`, false, `signMessage threw: ${e instanceof Error ? e.message : String(e)}`); continue; }
    add('5', `signature over ${name} verifies over its exact bytes`, sig instanceof Uint8Array && await verifyEd25519(publicKey, bytes, sig), `${bytes.length} bytes, starts ${hex(bytes.subarray(0, 6))}`);
  }
  const failed = steps.find(s => !s.ok);
  return finish(failed ? failed.id : null, messageHex, signatureHex);
}
