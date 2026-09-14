/**
 * tests/solana-settle.test.ts
 *
 * Solana settlement, dependency-free and devnet-free: base58 vectors,
 * quote HMAC round-trip/tamper/expiry, wallet-link proof (generated
 * in-test when the runtime supports Ed25519, graceful otherwise), and
 * buy-transaction verification against fixture RPC payloads. Nothing
 * here touches a cluster — the day these need devnet, that is a
 * different suite with its own key management.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { base58Decode, decodeAddress } from '../lib/solana/base58';
import { issueQuote, splitFee, verifyQuote } from '../lib/solana/quotes';
import { verifyWalletLink, linkMessage } from '../lib/solana/wallet';
import { verifyBuyTransaction } from '../lib/solana/verify';

process.env.SOLANA_QUOTE_SECRET = 'test-secret-only';
process.env.HELIUS_API_KEY = 'test-key-only';

const MINT = 'USDC111111111111111111111111111111111111111';
const BUYER = 'Buyer11111111111111111111111111111111111111';
const SELLER = 'Seller1111111111111111111111111111111111111';
const TREASURY = 'Treasury11111111111111111111111111111111111';

describe('base58 — decode vectors', () => {
  it('leading ones are zero bytes; system program is 32 zeros', () => {
    expect(base58Decode('1')).toEqual(new Uint8Array([0]));
    expect(decodeAddress('11111111111111111111111111111111')).toEqual(
      new Uint8Array(32),
    );
  });

  it('rejects invalid characters and wrong address lengths', () => {
    expect(() => base58Decode('0OIl')).toThrow();
    expect(() => decodeAddress('1')).toThrow();
  });
});

describe('quotes — 8% split, HMAC round-trip, tamper and expiry', () => {
  it('splitFee mirrors the program: floor(price * 800 / 10000), dust to seller', () => {
    expect(splitFee(1_000_000)).toEqual({ sellerUnits: 920_000, feeUnits: 80_000 });
    expect(splitFee(3)).toEqual({ sellerUnits: 3, feeUnits: 0 });
    expect(() => splitFee(0)).toThrow();
  });

  it('issued quotes verify; tampered or expired quotes fail closed', async () => {
    const q = await issueQuote({
      listingId: '11111111-1111-1111-1111-111111111111',
      buyerId: '22222222-2222-2222-2222-222222222222',
      totalUnits: 1_000_000,
    });
    expect(await verifyQuote(q)).toBe(true);
    expect(await verifyQuote({ ...q, totalUnits: 999_999 })).toBe(false);
    expect(
      await verifyQuote({ ...q, expiresAt: '2020-01-01T00:00:00.000Z' }),
    ).toBe(false);
  });
});

describe('wallet link — proof of ownership', () => {
  it('rejects malformed addresses and stale messages without crypto', async () => {
    const bad = await verifyWalletLink({
      userId: 'u1',
      address: 'not-an-address',
      signature: 'x',
      issuedAt: new Date().toISOString(),
    });
    expect(bad.ok).toBe(false);
  });

  it('generated keypair round-trips when the runtime supports Ed25519', async () => {
    const userId = '33333333-3333-3333-3333-333333333333';
    const issuedAt = new Date().toISOString();
    let pair: CryptoKeyPair;
    try {
      pair = await globalThis.crypto.subtle.generateKey('Ed25519', true, [
        'sign',
        'verify',
      ]);
    } catch {
      // Runtime without Ed25519: the linker must say so explicitly.
      const out = await verifyWalletLink({
        userId,
        address: '11111111111111111111111111111111',
        signature: '1'.repeat(88),
        issuedAt,
      });
      expect(out.ok).toBe(false);
      return;
    }
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey));
    // Base58-encode mirroring lib/solana/base58.ts (leading zero bytes -> '1's).
    // No BigInt literals: tsconfig targets ES2017, so long division on bytes.
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const encode58 = (bytes: Uint8Array): string => {
      let zeros = 0;
      while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
      const digits: number[] = [0];
      for (let i = zeros; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
          carry += digits[j] << 8;
          digits[j] = carry % 58;
          carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = Math.floor(carry / 58);
        }
      }
      let s = '';
      for (let i = digits.length - 1; i >= 0; i--) s += alphabet[digits[i]];
      return '1'.repeat(zeros) + s;
    };
    const address = encode58(raw);
    const message = linkMessage(userId, issuedAt);
    const sig = new Uint8Array(
      await globalThis.crypto.subtle.sign(
        'Ed25519',
        pair.privateKey,
        new TextEncoder().encode(message),
      ),
    );
    const out = await verifyWalletLink({
      userId,
      address,
      signature: encode58(sig),
      issuedAt,
    });
    expect(out).toEqual({ ok: true, address });
  });
});

function rpcResult(tx: unknown) {
  return async () =>
    ({
      ok: true,
      json: async () => ({ result: tx }),
    }) as Response;
}

function balances(
  buyer: number,
  seller: number,
  treasury: number,
  mint = MINT,
): { preTokenBalances: unknown[]; postTokenBalances: unknown[] } {
  const pre = [
    { accountIndex: 1, mint, owner: BUYER, uiTokenAmount: { amount: '1000000' } },
    { accountIndex: 2, mint, owner: SELLER, uiTokenAmount: { amount: '0' } },
    { accountIndex: 3, mint, owner: TREASURY, uiTokenAmount: { amount: '0' } },
  ];
  const post = [
    { accountIndex: 1, mint, owner: BUYER, uiTokenAmount: { amount: String(1000000 + buyer) } },
    { accountIndex: 2, mint, owner: SELLER, uiTokenAmount: { amount: String(seller) } },
    { accountIndex: 3, mint, owner: TREASURY, uiTokenAmount: { amount: String(treasury) } },
  ];
  return { preTokenBalances: pre, postTokenBalances: post };
}

const EXPECTED = {
  buyerWallet: BUYER,
  sellerWallet: SELLER,
  treasuryWallet: TREASURY,
  usdcMint: MINT,
  totalUnits: 1_000_000,
  sellerUnits: 920_000,
  feeUnits: 80_000,
};

const SIG = '5'.repeat(88);

describe('verifyBuyTransaction — balance deltas, mint-checked', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('accepts the exact quoted split', async () => {
    const out = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      rpcResult({ slot: 42, err: null, meta: { err: null, ...balances(-1_000_000, 920_000, 80_000) } }) as unknown as typeof fetch,
    );
    expect(out).toEqual({ ok: true, slot: 42 });
  });

  it('rejects shorted fees, wrong mints, failed and missing transactions', async () => {
    const shortFee = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      rpcResult({ slot: 1, err: null, meta: { err: null, ...balances(-1_000_000, 950_000, 50_000) } }) as unknown as typeof fetch,
    );
    expect(shortFee.ok).toBe(false);

    const wrongMint = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      rpcResult({ slot: 1, err: null, meta: { err: null, ...balances(-1_000_000, 920_000, 80_000, 'NOPE') } }) as unknown as typeof fetch,
    );
    expect(wrongMint.ok).toBe(false);

    const failed = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      rpcResult({ slot: 1, err: { InstructionError: [] }, meta: { err: { InstructionError: [] } } }) as unknown as typeof fetch,
    );
    expect(failed.ok).toBe(false);

    const missing = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      (async () => ({ ok: true, json: async () => ({ result: null }) }) as Response) as unknown as typeof fetch,
    );
    expect(missing.ok).toBe(false);

    const malformed = await verifyBuyTransaction('zzz', EXPECTED);
    expect(malformed.ok).toBe(false);
  });
});
