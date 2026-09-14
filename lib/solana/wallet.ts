/**
 * lib/solana/wallet.ts
 *
 * Seller wallet linkage: a wallet proves ownership by signing
 *   FlexSoar wallet link\nuser:<users.id>\nissued:<ISO timestamp>
 * and the backend verifies the Ed25519 signature with WebCrypto —
 * zero new dependencies. Accepted only when the message names the
 * caller's own users.id and was issued within the last 10 minutes
 * (replay inside the window re-links the same address: idempotent,
 * gains an attacker nothing without the victim's session).
 *
 * Storage is users.solana_address (056, human-run). The quote and
 * settle paths read it as the ONLY seller destination — a seller who
 * never linked cannot be paid, which fails loudly at quote time
 * instead of silently mid-settlement.
 */

import { base58Decode, decodeAddress } from './base58';

export const LINK_MESSAGE_TTL_MS = 10 * 60 * 1000;

export function linkMessage(userId: string, issuedAt: string): string {
  return `FlexSoar wallet link\nuser:${userId}\nissued:${issuedAt}`;
}

/**
 * Verify a wallet-link signature. Returns the address on success so the
 * caller stores exactly what verified — never an address from the body.
 */
export async function verifyWalletLink(input: {
  userId: string;
  address: string;
  signature: string;
  issuedAt: string;
  nowMs?: number;
}): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
  let pubkey: Uint8Array;
  let sig: Uint8Array;
  try {
    pubkey = decodeAddress(input.address);
  } catch {
    return { ok: false, reason: 'address is not a valid solana address' };
  }
  try {
    sig = base58Decode(input.signature);
  } catch {
    return { ok: false, reason: 'signature is not valid base58' };
  }
  if (sig.length !== 64) {
    return { ok: false, reason: 'signature must decode to 64 bytes' };
  }
  const issued = new Date(input.issuedAt).getTime();
  const now = input.nowMs ?? Date.now();
  if (!Number.isFinite(issued) || issued > now || now - issued > LINK_MESSAGE_TTL_MS) {
    return { ok: false, reason: 'link message expired — sign a fresh one' };
  }
  let valid: boolean;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      pubkey.slice().buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    valid = await globalThis.crypto.subtle.verify(
      'Ed25519',
      key,
      sig.slice().buffer as ArrayBuffer,
      new TextEncoder().encode(linkMessage(input.userId, input.issuedAt)),
    );
  } catch {
    return {
      ok: false,
      reason: 'signature verification unavailable in this runtime',
    };
  }
  if (!valid) {
    return { ok: false, reason: 'signature does not match this wallet and message' };
  }
  return { ok: true, address: input.address };
}
