/**
 * lib/solana/sdk.ts
 *
 * Unsigned-transaction builder for the `buy` instruction. Hand-rolled on
 * @solana/web3.js (no Anchor client, no IDL to drift): the instruction
 * layout is sighash("global:buy") ++ u64 LE price ++ [u8;32] vault_ref,
 * and the account order mirrors the program's Buy struct exactly. The
 * caller (wallet adapter / embedded wallet) signs and sends; verification
 * stays balance-delta based in lib/solana/verify.ts, so this builder and
 * the verifier can never disagree about what a valid buy looks like.
 *
 * Pure and offline-testable: no RPC calls here. Blockhash and ATAs come
 * from the caller (or ataFor() below for the deterministic ones).
 */

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** Associated Token program — ATA derivation needs no @solana/spl-token. */
export const ASSOCIATED_TOKEN_PROGRAM_ID =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Deterministic USDC account for (owner, mint). Throws on malformed
 * input — a bad ATA must fail here, never as a chain transaction that
 * burns the buyer's fee.
 */
export function associatedTokenAddress(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBytes(),
      new PublicKey(TOKEN_PROGRAM_ID).toBytes(),
      new PublicKey(mint).toBytes(),
    ],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  return ata.toBase58();
}

/** The program's singleton config PDA: seeds [b"config"]. */
export function configPda(programId: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('config')],
    new PublicKey(programId),
  );
  return pda.toBase58();
}

/** sha256("global:buy")[0..8] — the Anchor discriminator, computed not pasted. */
export async function buyDiscriminator(): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('global:buy'),
  );
  return new Uint8Array(digest).slice(0, 8);
}

/** Opaque chain linkage for a card: sha256("flexsoar:card:<uuid>"). */
export async function vaultRefForCard(cardId: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`flexsoar:card:${cardId}`),
  );
  return new Uint8Array(digest);
}

/** u64 LE encode for the price argument. */
export function encodeU64(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`price must be a non-negative integer, got ${value}`);
  }
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  if (v !== 0) throw new Error(`price overflows u64: ${value}`);
  return out;
}

export interface BuyTxInput {
  programId: string;
  buyer: string;
  seller: string;
  buyerAta: string;
  sellerAta: string;
  treasuryAta: string;
  config: string;
  priceUnits: number;
  vaultRef: Uint8Array;
  recentBlockhash: string;
}

/**
 * Build the UNSIGNED buy transaction (base64) for a wallet to sign.
 * Exactly one instruction; the buyer is the sole signer. Throws on a
 * vault_ref that is not 32 bytes — a malformed ref must never reach
 * the chain, where it would settle nothing but burn the buyer's fee.
 */
export async function buildBuyTx(input: BuyTxInput): Promise<string> {
  if (input.vaultRef.length !== 32) {
    throw new Error(
      `vault_ref must be 32 bytes, got ${input.vaultRef.length}`,
    );
  }
  const sighash = await buyDiscriminator();
  const data = new Uint8Array(8 + 8 + 32);
  data.set(sighash, 0);
  data.set(encodeU64(input.priceUnits), 8);
  data.set(input.vaultRef, 16);

  const ix = new TransactionInstruction({
    programId: new PublicKey(input.programId),
    keys: [
      { pubkey: new PublicKey(input.buyer), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(input.seller), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(input.buyerAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.sellerAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.treasuryAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.config), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction({ recentBlockhash: input.recentBlockhash, feePayer: new PublicKey(input.buyer) });
  tx.add(ix);
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}
