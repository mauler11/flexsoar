/** Fixed-width Borsh wire contract shared with protocol.rs. No JSON signing. */
export const PROTOCOL_TAG = new Uint8Array([70, 83, 79, 65, 82, 86, 50, 0]);
export const KEY_FIELDS = ['domain', 'program', 'config', 'saleId', 'card', 'pair',
  'attempt', 'beneficiary', 'policy', 'buyer', 'seller', 'treasury', 'mint',
  'tokenProgram', 'buyerToken', 'sellerToken', 'treasuryToken', 'refundToken', 'issuer'] as const;
export const U64_FIELDS = ['generation', 'revision', 'custodyVersion', 'authorityEpoch', 'total', 'net', 'fee'] as const;
export type PermitV2 = Record<typeof KEY_FIELDS[number], Uint8Array> &
  Record<typeof U64_FIELDS[number] | 'validFrom' | 'expiresAt', bigint> & { mode: 0 | 1 };
export const PERMIT_SIZE = 690;
const U64_MAX = (BigInt('1') << BigInt('64')) - BigInt('1');
export function encodePermit(p: PermitV2): Uint8Array {
  if (p.mode !== 0 && p.mode !== 1) throw new Error('unsupported custody mode');
  const out = new Uint8Array(PERMIT_SIZE); out.set(PROTOCOL_TAG); out[8] = 2; out[9] = p.mode;
  let offset = 10;
  for (const key of KEY_FIELDS) {
    if (!(p[key] instanceof Uint8Array) || p[key].length !== 32) throw new Error(`invalid ${key}`);
    out.set(p[key], offset); offset += 32;
  }
  const view = new DataView(out.buffer);
  for (const key of U64_FIELDS) {
    if (p[key] < BigInt('0') || p[key] > U64_MAX) throw new Error(`invalid ${key}`);
    view.setBigUint64(offset, p[key], true); offset += 8;
  }
  for (const key of ['validFrom', 'expiresAt'] as const) {
    if (p[key] < -(BigInt('1') << BigInt('63')) || p[key] >= (BigInt('1') << BigInt('63'))) throw new Error(`invalid ${key}`);
    view.setBigInt64(offset, p[key], true); offset += 8;
  }
  return out;
}
export function decodePermit(bytes: Uint8Array): PermitV2 {
  if (bytes.length !== PERMIT_SIZE || PROTOCOL_TAG.some((b, i) => b !== bytes[i]) || bytes[8] !== 2 || bytes[9] > 1) throw new Error('invalid v2 permit');
  const keys = Object.fromEntries(KEY_FIELDS.map((k, i) => [k, Uint8Array.from(bytes.subarray(10 + i * 32, 42 + i * 32))])) as Record<typeof KEY_FIELDS[number], Uint8Array>;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = Object.fromEntries(U64_FIELDS.map((k, i) => [k, view.getBigUint64(618 + i * 8, true)])) as Record<typeof U64_FIELDS[number], bigint>;
  return { ...keys, ...units, mode: bytes[9] as 0 | 1, validFrom: view.getBigInt64(674, true), expiresAt: view.getBigInt64(682, true) };
}
export function validatePermit(p: PermitV2, executionTime: bigint): void {
  encodePermit(p);
  if (p.total <= BigInt('0') || p.fee !== p.total * BigInt('500') / BigInt('10000') || p.net !== p.total - p.fee) throw new Error('invalid split');
  if (p.validFrom >= p.expiresAt || executionTime < p.validFrom || executionTime >= p.expiresAt) throw new Error('authorization not valid at execution');
  if (equalBytes(p.buyer, p.seller) || equalBytes(p.buyer, p.treasury) || equalBytes(p.seller, p.treasury)) throw new Error('payment roles overlap');
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
/** Transaction cosigning, not an offline detached permit: issuer and buyer sign
 * the instruction containing these bytes. Funding remains disabled in app. */
export async function permitDigest(p: PermitV2): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(encodePermit(p))));
}
export interface AttestationV2 { sale: Uint8Array; attempt: Uint8Array; pair: Uint8Array; evidence: Uint8Array; revision: bigint; action: number }
export function encodeAttestation(a: AttestationV2): Uint8Array {
  if (!Number.isInteger(a.action) || a.action < 0 || a.action > 255 || a.revision < BigInt('0') || a.revision > U64_MAX) throw new Error('invalid attestation');
  const out = new Uint8Array(145); out.set(PROTOCOL_TAG); out[8] = a.action;
  for (const [i, b] of [a.sale, a.attempt, a.pair, a.evidence].entries()) {
    if (b.length !== 32) throw new Error('invalid attestation commitment'); out.set(b, 9 + i * 32);
  }
  new DataView(out.buffer).setBigUint64(137, a.revision, true); return out;
}
