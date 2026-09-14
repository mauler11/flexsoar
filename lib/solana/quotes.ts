/**
 * lib/solana/quotes.ts
 *
 * Backend-issued price quotes: the ledger prices in MYR, the chain settles
 * in USDC base units, and the number both sides agree on is pinned HERE —
 * HMAC-SHA256 over (listingId, buyerId, totalUnits, sellerUnits,
 * feeUnits, expiresAt) with a server secret. Stateless: no quote table,
 * nothing to clean up. The settle route re-verifies the HMAC and the
 * expiry, then demands the on-chain transfers match the quoted units
 * EXACTLY. A tampered quote fails closed; an expired quote fails closed.
 *
 * WebCrypto (subtle) only — no node:crypto import, so this runs in any
 * route runtime. Amounts are integers throughout; the 8% split mirrors
 * the program's fee math (price * 800 / 10000, floor, dust to seller).
 */

export const FEE_BPS = 800;

export interface Quote {
  listingId: string;
  buyerId: string;
  /** Total debited from the buyer, USDC base units. */
  totalUnits: number;
  sellerUnits: number;
  feeUnits: number;
  /** ISO timestamp. */
  expiresAt: string;
  /** HMAC-SHA256 hex over the payload above. */
  sig: string;
}

function secret(): string {
  const value = process.env['SOLANA_QUOTE_SECRET'];
  if (!value) {
    throw new Error(
      'SOLANA_QUOTE_SECRET is not set. Add it to .env.local — see DEPS.md.',
    );
  }
  return value;
}

async function hmacHex(message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function payload(q: Omit<Quote, 'sig'>): string {
  return [
    q.listingId,
    q.buyerId,
    q.totalUnits,
    q.sellerUnits,
    q.feeUnits,
    q.expiresAt,
  ].join('|');
}

/** Split a USDC total exactly the way the program does. */
export function splitFee(totalUnits: number): {
  sellerUnits: number;
  feeUnits: number;
} {
  if (!Number.isInteger(totalUnits) || totalUnits <= 0) {
    throw new Error(`quote total must be a positive integer, got ${totalUnits}`);
  }
  const feeUnits = Math.floor((totalUnits * FEE_BPS) / 10_000);
  return { sellerUnits: totalUnits - feeUnits, feeUnits };
}

export async function issueQuote(input: {
  listingId: string;
  buyerId: string;
  totalUnits: number;
  ttlSeconds?: number;
}): Promise<Quote> {
  const { sellerUnits, feeUnits } = splitFee(input.totalUnits);
  const base = {
    listingId: input.listingId,
    buyerId: input.buyerId,
    totalUnits: input.totalUnits,
    sellerUnits,
    feeUnits,
    expiresAt: new Date(
      Date.now() + (input.ttlSeconds ?? 300) * 1000,
    ).toISOString(),
  };
  return { ...base, sig: await hmacHex(payload(base)) };
}

/** True only when the signature matches AND the quote is unexpired. */
export async function verifyQuote(q: Quote): Promise<boolean> {
  const expected = await hmacHex(payload(q));
  if (expected.length !== q.sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ q.sig.charCodeAt(i);
  }
  if (diff !== 0) return false;
  return new Date(q.expiresAt).getTime() > Date.now();
}
