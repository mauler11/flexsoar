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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { base58Decode, base58Encode, decodeAddress } from '../lib/solana/base58';
import { formatSol, formatUsdc, sumUsdcUnits } from '../lib/solana/balances';
import { myrPerUsd } from '../lib/solana/fx';
import { issueQuote, splitFee, verifyQuote } from '../lib/solana/quotes';
import { verifyWalletLink, linkMessage } from '../lib/solana/wallet';
import { verifyBuyTransaction } from '../lib/solana/verify';
import {
  buildBuyTx,
  buyDiscriminator,
  encodeU64,
  vaultRefForCard,
  associatedTokenAddress,
  configPda,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '../lib/solana/sdk';

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

describe('quotes — 5% split, HMAC round-trip, tamper and expiry', () => {
  it('splitFee mirrors the program: floor(price * 500 / 10000), dust to seller', () => {
    expect(splitFee(1_000_000)).toEqual({ sellerUnits: 950_000, feeUnits: 50_000 });
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

describe('sdk — unsigned buy transaction layout', () => {
  const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hN5He8JJxLyrs3Mw8';

  it('one instruction, exact account order, sighash-prefixed 48-byte data', async () => {
    const { Keypair, PublicKey, Transaction } = await import('@solana/web3.js');
    const buyer = Keypair.generate().publicKey.toBase58();
    const seller = Keypair.generate().publicKey.toBase58();
    const buyerAta = Keypair.generate().publicKey.toBase58();
    const sellerAta = Keypair.generate().publicKey.toBase58();
    const treasuryAta = Keypair.generate().publicKey.toBase58();
    const config = Keypair.generate().publicKey.toBase58();
    const program = Keypair.generate().publicKey.toBase58();
    const vaultRef = await vaultRefForCard('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(vaultRef.length).toBe(32);
    const unsigned = await buildBuyTx({
      programId: program,
      buyer,
      seller,
      buyerAta,
      sellerAta,
      treasuryAta,
      config,
      priceUnits: 1_000_000,
      vaultRef,
      recentBlockhash: BLOCKHASH,
    });
    const tx = Transaction.from(Buffer.from(unsigned, 'base64'));
    expect(tx.instructions.length).toBe(1);
    const ix = tx.instructions[0];
    expect(ix.programId.toBase58()).toBe(program);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      buyer,
      seller,
      buyerAta,
      sellerAta,
      treasuryAta,
      config,
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ]);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys.slice(1).every((k) => !k.isSigner)).toBe(true);
    const sighash = await buyDiscriminator();
    expect(ix.data.slice(0, 8)).toEqual(Buffer.from(sighash));
    expect(ix.data.length).toBe(48);
    // u64 LE price at offset 8, vault ref at offset 16.
    expect(ix.data.readBigUInt64LE(8).toString()).toBe('1000000');
    expect(ix.data.slice(16)).toEqual(Buffer.from(vaultRef));
  });

  it('encodeU64 is little-endian; bad vault refs never reach the chain', async () => {
    const { Keypair } = await import('@solana/web3.js');
    expect(encodeU64(1_000_000)).toEqual(
      new Uint8Array([64, 66, 15, 0, 0, 0, 0, 0]),
    );
    const program = Keypair.generate().publicKey.toBase58();
    const buyer = Keypair.generate().publicKey.toBase58();
    await expect(
      buildBuyTx({
        programId: program,
        buyer,
        seller: buyer,
        buyerAta: buyer,
        sellerAta: buyer,
        treasuryAta: buyer,
        config: buyer,
        priceUnits: 1_000_000,
        vaultRef: new Uint8Array(31),
        recentBlockhash: BLOCKHASH,
      }),
    ).rejects.toThrow(/32 bytes/);
  });
});

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
  sellerUnits: 950_000,
  feeUnits: 50_000,
};

const SIG = '5'.repeat(88);

describe('verifyBuyTransaction — balance deltas, mint-checked', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('accepts the exact quoted split', async () => {
    const out = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      rpcResult({ slot: 42, err: null, meta: { err: null, ...balances(-1_000_000, 950_000, 50_000) } }) as unknown as typeof fetch,
    );
    expect(out).toEqual({ ok: true, slot: 42 });
  });

  it('rejects shorted fees, wrong mints, failed and missing transactions', async () => {
    const shortFee = await verifyBuyTransaction(
      SIG,
      EXPECTED,
      rpcResult({ slot: 1, err: null, meta: { err: null, ...balances(-1_000_000, 965_000, 35_000) } }) as unknown as typeof fetch,
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

describe('build-tx helpers — base58 round-trip, deterministic ATAs', () => {
  it('base58Encode inverts base58Decode, leading zeros included', () => {
    expect(base58Encode(new Uint8Array([0]))).toBe('1');
    expect(base58Encode(base58Decode('11111111111111111111111111111111'))).toBe(
      '11111111111111111111111111111111',
    );
    const raw = new Uint8Array([0, 0, 1, 2, 250, 255]);
    expect(base58Decode(base58Encode(raw))).toEqual(raw);
  });

  it('associatedTokenAddress is deterministic and owner-specific', async () => {
    const { Keypair } = await import('@solana/web3.js');
    const ownerA = Keypair.generate().publicKey.toBase58();
    const ownerB = Keypair.generate().publicKey.toBase58();
    const mint = Keypair.generate().publicKey.toBase58();
    expect(associatedTokenAddress(ownerA, mint)).toBe(
      associatedTokenAddress(ownerA, mint),
    );
    expect(associatedTokenAddress(ownerA, mint)).not.toBe(
      associatedTokenAddress(ownerB, mint),
    );
    expect(() => associatedTokenAddress('not-an-address', mint)).toThrow();
  });

  it('configPda derives from the config seed and rejects bad program ids', async () => {
    const { Keypair, PublicKey } = await import('@solana/web3.js');
    const program = Keypair.generate().publicKey.toBase58();
    const [expected] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('config')],
      new PublicKey(program),
    );
    expect(configPda(program)).toBe(expected.toBase58());
    expect(() => configPda('FSxSettle1111111111111111111111111111111111')).toThrow();
  });

  it('associated token program id is the canonical one', () => {
    expect(ASSOCIATED_TOKEN_PROGRAM_ID).toBe(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    );
  });
});

describe('myrPerUsd — provider chain with operator pin last', () => {
  const pin = process.env.SOLANA_MYR_PER_USD;

  function ratesFetch(myr: number) {
    return (async (_url?: unknown) => ({
      ok: true,
      json: async () => ({ rates: { MYR: myr } }),
    })) as unknown as typeof fetch;
  }

  const deadFetch = (async (_url?: unknown) => ({
    ok: false,
    json: async () => ({}),
  })) as unknown as typeof fetch;

  afterEach(() => {
    if (pin === undefined) delete process.env.SOLANA_MYR_PER_USD;
    else process.env.SOLANA_MYR_PER_USD = pin;
  });

  it('takes the primary provider and never touches the fallback', async () => {
    delete process.env.SOLANA_MYR_PER_USD;
    const failIfCalled = (async (url: string | URL | Request) => {
      if (String(url).includes('frankfurter')) throw new Error('fallback must not run');
      return { ok: true, json: async () => ({ rates: { MYR: 4.7 } }) };
    }) as unknown as typeof fetch;
    await expect(myrPerUsd(failIfCalled)).resolves.toBe(4.7);
  });

  it('falls to frankfurter when the primary is down', async () => {
    delete process.env.SOLANA_MYR_PER_USD;
    const mixed = (async (url: string | URL | Request) => {
      if (String(url).includes('frankfurter')) return ratesFetch(4.8)('https://x');
      return deadFetch('https://x');
    }) as unknown as typeof fetch;
    await expect(myrPerUsd(mixed)).resolves.toBe(4.8);
  });

  it('uses the operator pin only when both providers fail', async () => {
    process.env.SOLANA_MYR_PER_USD = '4.65';
    await expect(myrPerUsd(deadFetch)).resolves.toBe(4.65);
  });

  it('fails closed with no pin and rejects a garbage pin', async () => {
    delete process.env.SOLANA_MYR_PER_USD;
    await expect(myrPerUsd(deadFetch)).resolves.toBeNull();
    process.env.SOLANA_MYR_PER_USD = 'not-a-number';
    await expect(myrPerUsd(deadFetch)).resolves.toBeNull();
  });
});

describe('balances — mint-filtered sums and display formatting', () => {
  const MINT = 'USDC111111111111111111111111111111111111111';

  function entry(mint: string, amount: string, decimals = 6) {
    return {
      account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
    };
  }

  it('sums only the configured mint across accounts', () => {
    expect(
      sumUsdcUnits(
        [entry(MINT, '1000000'), entry(MINT, '250000'), entry('NOPE', '999999999')],
        MINT,
      ),
    ).toEqual({ units: 1250000, decimals: 6 });
    expect(sumUsdcUnits([], MINT)).toEqual({ units: 0, decimals: null });
  });

  it('formats USDC without trailing zeros and SOL at fee scale', () => {
    expect(formatUsdc(1_250_000)).toBe('1.25');
    expect(formatUsdc(1_000_000)).toBe('1');
    expect(formatUsdc(3)).toBe('0.000003');
    expect(formatUsdc(-5)).toBe('0');
    expect(formatSol(8_000)).toBe('0.000008');
    expect(formatSol(2_500_000_000)).toBe('2.5');
  });
});
